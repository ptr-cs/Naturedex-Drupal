import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { assetPaths, dynamicPaths, NaturedexStack, sessionCookie } from '../lib/naturedex-stack.js';

function synth(extra = {}) {
  return Template.fromStack(
    new NaturedexStack(new App(), 'Test', {
      env: { region: 'us-east-1' },
      accountAuditing: true,
      ...extra,
    }),
  );
}

type Behavior = { PathPattern: string; CachePolicyId: unknown; AllowedMethods: string[] };

describe('the Naturedex Drupal AWS stack', () => {
  let template: Template;
  let behaviors: Behavior[];
  let distribution: Record<string, any>;
  beforeAll(() => {
    template = synth();
    [distribution] = Object.values(template.findResources('AWS::CloudFront::Distribution')).map(
      (resource) => resource.Properties.DistributionConfig,
    );
    behaviors = distribution.CacheBehaviors;
  });

  it('adds no NAT gateway, the largest avoidable fixed cost', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
  });

  it('keeps all state in the database, with no shared file system', () => {
    template.resourceCountIs('AWS::EFS::FileSystem', 0);
  });

  it('keeps the load balancer and database off the internet', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internal' });
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      PubliclyAccessible: false,
      StorageEncrypted: true,
      DeletionProtection: true,
    });
  });

  it('lets only the load balancer reach the tasks', () => {
    const rules = Object.values(template.findResources('AWS::EC2::SecurityGroupIngress')).map(
      (resource) => resource.Properties,
    );
    const inline = Object.values(template.findResources('AWS::EC2::SecurityGroup')).flatMap(
      (resource) => resource.Properties.SecurityGroupIngress ?? [],
    );
    const open = [...rules, ...inline].filter((rule) => rule.CidrIp === '0.0.0.0/0' || rule.CidrIpv6 === '::/0');
    expect(open).toEqual([]);
  });

  it("admits CloudFront to the load balancer through AWS's managed list", () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      Description: 'CloudFront VPC origin',
      SourcePrefixListId: Match.stringLikeRegexp('^pl-'),
      FromPort: 80,
    });
  });

  it('protects the database from stack deletion', () => {
    template.hasResource('AWS::RDS::DBInstance', { DeletionPolicy: 'Snapshot' });
  });

  it('requires TLS to the database rather than relying on the default', () => {
    template.hasResourceProperties('AWS::RDS::DBParameterGroup', {
      Parameters: { require_secure_transport: '1' },
    });
  });

  it('passes secrets by reference, never as plain environment values', () => {
    for (const definition of Object.values(template.findResources('AWS::ECS::TaskDefinition'))) {
      const [container] = definition.Properties.ContainerDefinitions;
      const plain = container.Environment.map((entry: { Name: string }) => entry.Name);
      expect(plain.filter((name: string) => /PASSWORD|SECRET|SALT/.test(name))).toEqual([]);
    }
  });

  it('gives the admin password to the install task, not the web container', () => {
    const containers = Object.values(template.findResources('AWS::ECS::TaskDefinition')).map(
      (definition) => definition.Properties.ContainerDefinitions[0],
    );
    const secrets = (container: { Secrets: Array<{ Name: string }> }) => container.Secrets.map((entry) => entry.Name);
    const web = containers.find((container) => container.PortMappings?.length);
    const install = containers.find((container) => container.Command?.includes('naturedex-bootstrap'));
    expect(secrets(web)).toEqual(expect.arrayContaining(['NATUREDEX_DB_PASSWORD', 'NATUREDEX_HASH_SALT']));
    expect(secrets(web)).not.toContain('NATUREDEX_ADMIN_PASSWORD');
    expect(secrets(install)).toContain('NATUREDEX_ADMIN_PASSWORD');
  });

  it('trusts only the hosts CloudFront serves', () => {
    const web = Object.values(template.findResources('AWS::ECS::TaskDefinition'))
      .map((definition) => definition.Properties.ContainerDefinitions[0])
      .find((container) => container.PortMappings?.length);
    const hosts = web.Environment.find((entry: { Name: string }) => entry.Name === 'NATUREDEX_HOSTS');
    expect(JSON.stringify(hosts.Value)).toContain('DomainName');
  });

  it('limits what a compromised task could reach', () => {
    const groups = Object.values(
      template.findResources('AWS::EC2::SecurityGroup', {
        Properties: { GroupDescription: Match.stringLikeRegexp('Drupal tasks') },
      }),
    );
    const open = groups[0].Properties.SecurityGroupEgress.filter(
      (rule: { CidrIp?: string }) => rule.CidrIp === '0.0.0.0/0',
    );
    expect(open).toEqual([expect.objectContaining({ FromPort: 443, ToPort: 443 })]);
  });

  it('drops malformed headers at the load balancer', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      LoadBalancerAttributes: Match.arrayWith([
        { Key: 'routing.http.drop_invalid_header_fields.enabled', Value: 'true' },
      ]),
    });
  });

  it('separates signed-in visitors in the page cache by the fixed session cookie name', () => {
    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
          CookiesConfig: { CookieBehavior: 'whitelist', Cookies: [sessionCookie] },
        }),
      }),
    });
    const module = readFileSync(
      new URL('../../drupal/modules/naturedex_core/src/Session/SessionConfiguration.php', import.meta.url),
      'utf8',
    );
    expect(sessionCookie).toBe(`SSESS${/NAME = '(\w+)'/.exec(module)?.[1]}`);
  });

  it('never caches sign-in, administration, the API, or the Writing desk', () => {
    const cachingDisabled = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
    for (const path of dynamicPaths) {
      const behavior = behaviors.find((entry) => entry.PathPattern === path);
      expect(behavior?.CachePolicyId, path).toBe(cachingDisabled);
      expect(behavior?.AllowedMethods, path).toContain('POST');
    }
    for (const path of ['/user*', '/editor', '/api/*', '/admin*', '/session/*'])
      expect(dynamicPaths).toContain(path);
  });

  it('allows writes only on the uncached behaviors', () => {
    expect(distribution.DefaultCacheBehavior.AllowedMethods).not.toContain('POST');
    for (const path of assetPaths)
      // CloudFormation omits AllowedMethods for the GET/HEAD default.
      expect(behaviors.find((entry) => entry.PathPattern === path)?.AllowedMethods ?? ['GET', 'HEAD']).not.toContain('POST');
  });

  it('sends Drupal the visitor’s host, scheme, and address on cached behaviors', () => {
    template.hasResourceProperties('AWS::CloudFront::OriginRequestPolicy', {
      OriginRequestPolicyConfig: Match.objectLike({
        HeadersConfig: {
          HeaderBehavior: 'whitelist',
          Headers: ['Host', 'CloudFront-Forwarded-Proto', 'CloudFront-Viewer-Address'],
        },
      }),
    });
  });

  it('ignores page query strings that could force cache misses', () => {
    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        DefaultTTL: 0,
        ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
          QueryStringsConfig: { QueryStringBehavior: 'whitelist', QueryStrings: ['page'] },
        }),
      }),
    });
  });

  it('stays within CloudFront’s limit of 25 cache behaviors', () => {
    expect(behaviors.length).toBeLessThanOrEqual(25);
  });

  it('blocks the install and update scripts, and limits login attempts', () => {
    const [acl] = Object.values(template.findResources('AWS::WAFv2::WebACL'));
    const names = acl.Properties.Rules.map((rule: { Name: string }) => rule.Name);
    expect(names).toEqual(
      expect.arrayContaining(['BlockInstallAndUpdateScripts', 'LimitLoginAttempts', 'AWSManagedRulesPHPRuleSet']),
    );
    const scripts = JSON.stringify(acl.Properties.Rules.find((rule: { Name: string }) => rule.Name === 'BlockInstallAndUpdateScripts'));
    for (const script of ['/core/install.php', '/update.php', '/core/rebuild.php']) expect(scripts).toContain(script);
  });

  it('rate limits requests that reach the origin, but not cached assets', () => {
    const [acl] = Object.values(template.findResources('AWS::WAFv2::WebACL'));
    const rule = acl.Properties.Rules.find((entry: { Name: string }) => entry.Name === 'LimitOriginRequests');
    expect(rule.Action).toEqual({ Block: {} });
    expect(rule.Statement.RateBasedStatement.Limit).toBe(300);
    expect(JSON.stringify(rule.Statement)).toContain('/sites/');
    const priorities = acl.Properties.Rules.map((entry: { Priority: number }) => entry.Priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it('keeps an audit trail that can prove it was not altered', () => {
    template.hasResourceProperties('AWS::CloudTrail::Trail', {
      IsMultiRegionTrail: true,
      IncludeGlobalServiceEvents: true,
      EnableLogFileValidation: true,
    });
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true, RestrictPublicBuckets: true }),
    });
  });

  it('detects threats and sends severe ones to the alarm topic', () => {
    template.hasResourceProperties('AWS::GuardDuty::Detector', { Enable: true });
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({ source: ['aws.guardduty'] }),
    });
  });

  it('can leave account-wide auditing to a stack that already has it', () => {
    const shared = synth({ accountAuditing: false });
    shared.resourceCountIs('AWS::GuardDuty::Detector', 0);
    shared.resourceCountIs('AWS::CloudTrail::Trail', 0);
    shared.resourceCountIs('AWS::WAFv2::LoggingConfiguration', 1);
  });

  it('logs WAF traffic without storing credentials', () => {
    const [config] = Object.values(template.findResources('AWS::WAFv2::LoggingConfiguration'));
    const redacted = config.Properties.RedactedFields.map(
      (field: { SingleHeader: { Name: string } }) => field.SingleHeader.Name,
    );
    expect(redacted).toEqual(['cookie', 'authorization', 'x-csrf-token']);
    const destination = JSON.stringify(config.Properties.LogDestinationConfigs);
    expect(destination).toContain('aws-waf-logs-naturedex-drupal');
    expect(destination).not.toContain(':*');
  });

  it('runs Drupal cron on a schedule, because cached visits cannot trigger it', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 hour)',
      Targets: Match.arrayWith([
        Match.objectLike({
          EcsParameters: Match.anyValue(),
          Input: Match.stringLikeRegexp('naturedex-task.*cron'),
        }),
      ]),
    });
  });

  it('raises alarms, and subscribes an address only when given one', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 3);
    template.resourceCountIs('AWS::SNS::Subscription', 0);
    synth({ alarmEmail: 'alarms@example.com' }).resourceCountIs('AWS::SNS::Subscription', 1);
  });

  it('leaves spending limits to the account budgets', () => {
    template.resourceCountIs('AWS::Budgets::Budget', 0);
  });

  it('adds a certificate and DNS record only when given a domain', () => {
    template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    const withDomain = synth({
      domainName: 'naturedex.example.com',
      hostedZoneId: 'Z123456ABCDEFG',
      hostedZoneName: 'example.com',
    });
    withDomain.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    withDomain.hasResourceProperties('AWS::Route53::RecordSet', { Name: 'naturedex.example.com.' });
  });
});
