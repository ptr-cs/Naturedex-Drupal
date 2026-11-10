import { fileURLToPath } from 'node:url';
import {
  ArnFormat,
  CfnOutput,
  Duration,
  IgnoreMode,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cloudtrail as cloudtrail,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cloudwatchActions,
  aws_ec2 as ec2,
  aws_ecr_assets as ecrAssets,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_events as events,
  aws_events_targets as eventTargets,
  aws_guardduty as guardduty,
  aws_logs as logs,
  aws_rds as rds,
  aws_route53 as route53,
  aws_route53_targets as route53Targets,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
  aws_wafv2 as wafv2,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { contentSecurityPolicy } from './csp.js';

export interface NaturedexStackProps extends StackProps {
  /** Receives alarms. Without it, alarms are recorded but nobody is told. */
  alarmEmail?: string;
  /** Leave empty to use the CloudFront domain. */
  domainName?: string;
  hostedZoneId?: string;
  /** The zone's own name, such as example.com for naturedex.example.com. */
  hostedZoneName?: string;
  /**
   * Account-wide GuardDuty and a CloudTrail trail. An account and region can
   * have only one GuardDuty detector, so turn this off when another stack
   * (such as the WordPress edition) already provides them.
   */
  accountAuditing: boolean;
}

const containerName = 'drupal';
const databaseName = 'drupal';
/** Created by the bootstrap task (docker/db-user.php) with rights on databaseName only. */
export const appDatabaseUser = 'naturedex_app';
/** Must match naturedex_core's Session\SessionConfiguration over HTTPS. */
export const sessionCookie = 'SSESSnaturedex';
// com.amazonaws.global.cloudfront.origin-facing in us-east-1. Prefix list IDs
// differ by region, and this stack only runs in us-east-1.
const cloudFrontOriginFacingPrefixList = 'pl-3b927c52';
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Paths Drupal serves straight from files in the image (or regenerates). */
export const assetPaths = ['/core/*', '/modules/*', '/themes/*', '/sites/*'];
/** Paths that depend on who is signed in, or accept writes. */
export const dynamicPaths = [
  '/admin*',
  '/user*',
  '/node/*',
  '/editor',
  '/api/*',
  '/session/*',
  '/batch*',
  '/system/*',
  '/entity_reference_autocomplete/*',
  '/taxonomy/*',
];

/**
 * One stack in us-east-1, the only region where CloudFront accepts WAF ACLs and
 * ACM certificates, so nothing has to cross regions.
 */
export class NaturedexStack extends Stack {
  constructor(scope: Construct, id: string, props: NaturedexStackProps) {
    super(scope, id, props);

    // Tasks use public subnets with no inbound rules instead of a NAT gateway,
    // which would cost more than the application containers do.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    const privateSubnets = { subnetType: ec2.SubnetType.PRIVATE_ISOLATED };
    const publicSubnets = { subnetType: ec2.SubnetType.PUBLIC };

    const engine = rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_4_10 });
    const database = new rds.DatabaseInstance(this, 'Database', {
      engine,
      parameterGroup: new rds.ParameterGroup(this, 'DatabaseParameters', {
        engine,
        parameters: { require_secure_transport: '1' },
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: privateSubnets,
      databaseName,
      credentials: rds.Credentials.fromGeneratedSecret('naturedex'),
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false,
      backupRetention: Duration.days(7),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      publiclyAccessible: false,
    });

    // There is no shared file storage: Drupal stores everything in the
    // database, and regenerates CSS/JS aggregates and compiled templates in
    // each task on demand.
    const hashSalt = new secretsmanager.Secret(this, 'HashSalt', {
      description: 'Drupal hash_salt: one-time login links, form tokens, and more',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });
    // Drupal connects as this account, never as the RDS master user.
    const appDatabaseSecret = new rds.DatabaseSecret(this, 'AppDatabaseUser', { username: appDatabaseUser });
    const adminPassword = new secretsmanager.Secret(this, 'AdminPassword', {
      description: 'First Drupal administrator password',
      generateSecretString: { passwordLength: 32 },
    });

    const albSecurityGroup = new ec2.SecurityGroup(this, 'LoadBalancerSg', {
      vpc,
      allowAllOutbound: true,
      description: 'Internal load balancer reached through CloudFront VPC origin',
    });
    // The load balancer has no public address. AWS documents this managed list
    // for VPC origins; allowing the VPC's own range does not admit CloudFront.
    albSecurityGroup.addIngressRule(
      ec2.Peer.prefixList(cloudFrontOriginFacingPrefixList),
      ec2.Port.tcp(80),
      'CloudFront VPC origin',
    );
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      vpcSubnets: privateSubnets,
      internetFacing: false,
      securityGroup: albSecurityGroup,
      dropInvalidHeaderFields: true,
    });
    const listener = loadBalancer.addListener('Http', { port: 80, open: false });

    const webAcl = this.createWebAcl();
    const zone =
      props.domainName && props.hostedZoneId && props.hostedZoneName
        ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
            hostedZoneId: props.hostedZoneId,
            zoneName: props.hostedZoneName,
          })
        : undefined;
    const certificate = zone
      ? new acm.Certificate(this, 'Certificate', {
          domainName: props.domainName!,
          validation: acm.CertificateValidation.fromDns(zone),
        })
      : undefined;

    const origin = origins.VpcOrigin.withApplicationLoadBalancer(loadBalancer, {
      httpPort: 80,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
    });
    const publicHeaders = this.responseHeaders('Public', true);
    const adminHeaders = this.responseHeaders('Admin', false);

    // Drupal checks the host it is asked for against its trusted hosts, and
    // builds links from it. The scheme and visitor address restore what the
    // plain-HTTP hop from the load balancer loses; see docker/settings.php.
    const toOrigin = new cloudfront.OriginRequestPolicy(this, 'ViewerHost', {
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
        'Host',
        'CloudFront-Forwarded-Proto',
        'CloudFront-Viewer-Address',
      ),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
    });
    // Drupal sends s-maxage on anonymous pages and no-store otherwise, so this
    // policy only has to separate signed-in visitors from everybody else.
    const pageCache = new cloudfront.CachePolicy(this, 'PageCache', {
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.seconds(0),
      maxTtl: Duration.days(1),
      cookieBehavior: cloudfront.CacheCookieBehavior.allowList(sessionCookie),
      // Anything else is dropped from the cache key, so a random query string
      // can't force a cache miss. ?page= is the journal's pager. The
      // ?collection=1 link is unaffected: it's read in the browser.
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.allowList('page'),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });
    const assetCache = new cloudfront.CachePolicy(this, 'AssetCache', {
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.days(1),
      maxTtl: Duration.days(30),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      // Drupal versions assets with a bare ?token, and names CSS/JS aggregates
      // by ?include=&delta=&theme=, so every query string is part of the key.
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });
    const dynamic: cloudfront.BehaviorOptions = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_AND_CLOUDFRONT_2022,
      responseHeadersPolicy: adminHeaders,
    };
    const assets: cloudfront.BehaviorOptions = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: assetCache,
      originRequestPolicy: toOrigin,
      responseHeadersPolicy: publicHeaders,
    };

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Naturedex Drupal',
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate,
      webAclId: webAcl.attrArn,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      // The default cloudfront.net certificate has a fixed policy, so this only
      // applies once a custom domain is configured.
      minimumProtocolVersion: certificate ? cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021 : undefined,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: pageCache,
        originRequestPolicy: toOrigin,
        responseHeadersPolicy: publicHeaders,
      },
      additionalBehaviors: {
        ...Object.fromEntries(dynamicPaths.map((path) => [path, dynamic])),
        ...Object.fromEntries(assetPaths.map((path) => [path, assets])),
      },
    });

    const hosts = [distribution.distributionDomainName, ...(props.domainName ? [props.domainName] : [])];
    const siteUrl = `https://${props.domainName || distribution.distributionDomainName}`;

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });
    const taskDefinition = (name: string) =>
      new ecs.FargateTaskDefinition(this, name, {
        cpu: 512,
        memoryLimitMiB: 1024,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });

    const masterSecret = database.secret!;
    const containerBase = {
      image: ecs.ContainerImage.fromAsset(repositoryRoot, {
        file: 'docker/Dockerfile',
        platform: ecrAssets.Platform.LINUX_ARM64,
        // Otherwise node_modules and .runtime would be staged into cdk.out.
        ignoreMode: IgnoreMode.DOCKER,
      }),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'drupal',
        logRetention: logs.RetentionDays.ONE_MONTH,
      }),
      environment: {
        NATUREDEX_HOSTS: hosts.join(','),
        NATUREDEX_DB_NAME: databaseName,
        NATUREDEX_DB_HOST: database.dbInstanceEndpointAddress,
      },
    };
    const siteSecrets = {
      NATUREDEX_DB_USER: ecs.Secret.fromSecretsManager(appDatabaseSecret, 'username'),
      NATUREDEX_DB_PASSWORD: ecs.Secret.fromSecretsManager(appDatabaseSecret, 'password'),
      NATUREDEX_HASH_SALT: ecs.Secret.fromSecretsManager(hashSalt),
    };

    const task = taskDefinition('Task');
    task.addContainer(containerName, {
      ...containerBase,
      portMappings: [{ containerPort: 80 }],
      secrets: siteSecrets,
    });

    // The admin password and the database master login are only needed to
    // create the database account and install Drupal, so the container that
    // faces visitors never holds them.
    const bootstrapTask = taskDefinition('BootstrapTask');
    bootstrapTask.addContainer(containerName, {
      ...containerBase,
      command: ['naturedex-bootstrap'],
      environment: { ...containerBase.environment, NATUREDEX_ADMIN_USER: 'naturedex-admin' },
      secrets: {
        ...siteSecrets,
        NATUREDEX_DB_ADMIN_USER: ecs.Secret.fromSecretsManager(masterSecret, 'username'),
        NATUREDEX_DB_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(masterSecret, 'password'),
        NATUREDEX_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(adminPassword),
      },
    });

    const taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSg', {
      vpc,
      // HTTPS reaches ECR, Secrets Manager, and logs. The database rule below
      // adds its own outbound port.
      allowAllOutbound: false,
      description: 'Drupal tasks; inbound only from the load balancer',
    });
    taskSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'AWS service endpoints');
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: task,
      desiredCount: 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: true,
      vpcSubnets: publicSubnets,
      securityGroups: [taskSecurityGroup],
      circuitBreaker: { enable: true, rollback: true },
      // No ECS Exec: it would give a root shell in the web container. One-off
      // commands run as separate tasks instead; see docs/deployment-aws.md.
      enableExecuteCommand: false,
      healthCheckGracePeriod: Duration.seconds(60),
    });
    const targets = listener.addTargets('Drupal', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      deregistrationDelay: Duration.seconds(30),
      // A static file, so a database blip can't make ECS replace a healthy task.
      healthCheck: { path: '/healthz.html', healthyHttpCodes: '200', interval: Duration.seconds(30) },
    });
    database.connections.allowDefaultPortFrom(taskSecurityGroup);

    // Cached pages rarely reach Drupal, so its cron can't depend on visits.
    new events.Rule(this, 'DrupalCron', {
      description: 'Runs Drupal cron: expired sessions, cache and log cleanup',
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [
        new eventTargets.EcsTask({
          cluster,
          taskDefinition: task,
          subnetSelection: publicSubnets,
          assignPublicIp: true,
          securityGroups: [taskSecurityGroup],
          containerOverrides: [{ containerName, command: ['naturedex-task', 'cron'] }],
        }),
      ],
    });

    this.createAuditLogging(webAcl, props.accountAuditing);
    this.createAlerts(props, targets, loadBalancer, database);

    if (zone) {
      new route53.ARecord(this, 'Alias', {
        zone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
      });
    }

    new CfnOutput(this, 'SiteUrl', { value: siteUrl });
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'ServiceName', { value: service.serviceName });
    new CfnOutput(this, 'BootstrapTaskDefinitionArn', { value: bootstrapTask.taskDefinitionArn });
    new CfnOutput(this, 'TaskSecurityGroupId', { value: taskSecurityGroup.securityGroupId });
    new CfnOutput(this, 'PublicSubnetIds', {
      value: vpc.publicSubnets.map((subnet) => subnet.subnetId).join(','),
    });
    new CfnOutput(this, 'AdminPasswordSecretArn', { value: adminPassword.secretArn });
  }

  private responseHeaders(name: string, withCsp: boolean) {
    return new cloudfront.ResponseHeadersPolicy(this, `${name}Headers`, {
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
            override: true,
          },
        ],
      },
      securityHeadersBehavior: {
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: false, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.SAMEORIGIN, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        // Drupal's admin theme relies on inline settings this policy would block.
        ...(withCsp ? { contentSecurityPolicy: { contentSecurityPolicy, override: true } } : {}),
      },
    });
  }

  private createWebAcl() {
    const visibility = (metricName: string) => ({
      cloudWatchMetricsEnabled: true,
      metricName,
      sampledRequestsEnabled: true,
    });
    const managed = (priority: number, name: string, countOnly: string[] = []): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name,
          ruleActionOverrides: countOnly.map((rule) => ({ name: rule, actionToUse: { count: {} } })),
        },
      },
      visibilityConfig: visibility(name),
    });
    const path = (searchString: string, positionalConstraint: string) => ({
      byteMatchStatement: {
        fieldToMatch: { uriPath: {} },
        positionalConstraint,
        searchString,
        textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
      },
    });

    return new wafv2.CfnWebACL(this, 'WebAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('naturedex-drupal'),
      rules: [
        // Until the bootstrap task runs, the database is empty and the web
        // installer would let any visitor claim the site. Installs and database
        // updates run as one-off tasks instead. Apache refuses these too.
        {
          name: 'BlockInstallAndUpdateScripts',
          priority: 0,
          action: { block: {} },
          statement: {
            orStatement: {
              statements: [
                '/core/install.php',
                '/install.php',
                '/update.php',
                '/core/update.php',
                '/core/rebuild.php',
                '/core/authorize.php',
              ].map((script) => path(script, 'EXACTLY')),
            },
          },
          visibilityConfig: visibility('BlockInstallAndUpdateScripts'),
        },
        // Drupal's flood control also limits failed logins per account and
        // address; this stops volume before it reaches the server.
        {
          name: 'LimitLoginAttempts',
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              aggregateKeyType: 'IP',
              evaluationWindowSec: 300,
              limit: 20,
              scopeDownStatement: {
                orStatement: {
                  statements: [path('/user/login', 'STARTS_WITH'), path('/user/password', 'STARTS_WITH')],
                },
              },
            },
          },
          visibilityConfig: visibility('LimitLoginAttempts'),
        },
        // Some requests always reach the origin, such as made-up addresses and
        // forged session cookies. A page view is one such request and its assets
        // are excluded, so this only stops someone hammering a small server.
        {
          name: 'LimitOriginRequests',
          priority: 2,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              aggregateKeyType: 'IP',
              evaluationWindowSec: 300,
              limit: 300,
              scopeDownStatement: {
                notStatement: {
                  statement: {
                    orStatement: {
                      statements: assetPaths.map((pattern) => path(pattern.replace('*', ''), 'STARTS_WITH')),
                    },
                  },
                },
              },
            },
          },
          visibilityConfig: visibility('LimitOriginRequests'),
        },
        // Field notes are long, and may legitimately contain HTML as text. These
        // two rules would block ordinary saves; Drupal validates and escapes it.
        managed(3, 'AWSManagedRulesCommonRuleSet', ['SizeRestrictions_BODY', 'CrossSiteScripting_BODY']),
        managed(4, 'AWSManagedRulesKnownBadInputsRuleSet'),
        managed(5, 'AWSManagedRulesPHPRuleSet'),
      ],
    });
  }

  /**
   * Records what reached the site and, when enabled, who changed the account
   * and suspicious activity. Logs must not become a new place to steal sessions
   * from, so the WAF log drops the headers that carry credentials.
   */
  private createAuditLogging(webAcl: wafv2.CfnWebACL, accountAuditing: boolean) {
    if (accountAuditing) {
      const trailBucket = new s3.Bucket(this, 'AuditTrail', {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        lifecycleRules: [{ expiration: Duration.days(90) }],
        // Evidence should outlive the stack. It expires by itself after 90 days.
        removalPolicy: RemovalPolicy.RETAIN,
      });
      new cloudtrail.Trail(this, 'Trail', {
        bucket: trailBucket,
        isMultiRegionTrail: true,
        includeGlobalServiceEvents: true,
        enableFileValidation: true,
      });
      new guardduty.CfnDetector(this, 'ThreatDetection', {
        enable: true,
        findingPublishingFrequency: 'FIFTEEN_MINUTES',
      });
    }

    // WAF requires this name prefix. The suffix keeps it apart from the
    // WordPress edition's log group in the same account.
    const logGroupName = 'aws-waf-logs-naturedex-drupal';
    const wafLogs = new logs.LogGroup(this, 'WafLogs', {
      logGroupName,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const logging = new wafv2.CfnLoggingConfiguration(this, 'WafLogging', {
      resourceArn: webAcl.attrArn,
      // WAF rejects the ":*" suffix that logGroupArn ends with.
      logDestinationConfigs: [
        this.formatArn({
          service: 'logs',
          resource: 'log-group',
          resourceName: logGroupName,
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        }),
      ],
      redactedFields: ['cookie', 'authorization', 'x-csrf-token'].map((Name) => ({ singleHeader: { Name } })),
    });
    logging.node.addDependency(wafLogs);
  }

  private createAlerts(
    props: NaturedexStackProps,
    targets: elbv2.ApplicationTargetGroup,
    loadBalancer: elbv2.ApplicationLoadBalancer,
    database: rds.DatabaseInstance,
  ) {
    const topic = new sns.Topic(this, 'Alarms');
    if (props.alarmEmail) topic.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail));
    const action = new cloudwatchActions.SnsAction(topic);
    if (props.accountAuditing) {
      new events.Rule(this, 'SevereThreats', {
        description: 'Sends high-severity GuardDuty findings to the alarm topic',
        eventPattern: {
          source: ['aws.guardduty'],
          detailType: ['GuardDuty Finding'],
          detail: { severity: [{ numeric: ['>=', 7] }] },
        },
        targets: [new eventTargets.SnsTopic(topic)],
      });
    }
    const alarm = (
      id: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      comparisonOperator = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    ) =>
      new cloudwatch.Alarm(this, id, {
        metric,
        threshold,
        comparisonOperator,
        evaluationPeriods: 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(action);

    alarm(
      'NoHealthyTasks',
      targets.metrics.healthyHostCount({ period: Duration.minutes(1) }),
      1,
      cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    );
    alarm(
      'ServerErrors',
      loadBalancer.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: Duration.minutes(5) }),
      10,
    );
    alarm(
      'DatabaseStorageLow',
      database.metricFreeStorageSpace(),
      2 * 1024 ** 3,
      cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    );
  }
}
