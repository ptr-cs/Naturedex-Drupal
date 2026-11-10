# AWS deployment

**Status: deployed** to us-east-1 on November 9, 2026, at **https://dlp9hw0zcp41x.cloudfront.net**, through the manual Deploy workflow. The first deployment succeeded on its first attempt in about 16 minutes.

It shares the account with the WordPress edition, so it was deployed with `ACCOUNT_AUDITING=false`: that stack's GuardDuty detector and CloudTrail trail cover this one too. **If the WordPress stack is torn down, set `ACCOUNT_AUDITING` to `true` and redeploy**, or the account loses both.

## Recommendation

Run Drupal as one container on ECS Fargate behind CloudFront, with RDS for MySQL. This is the WordPress edition's design, so the two can be compared, minus its file storage: Drupal keeps everything in the database. Expect **about $62–64 a month** at low traffic, or about $2.10 a day for a short run.

## Architecture

```
Visitor ──HTTPS──▶ CloudFront + WAF
                      │  VPC origin (no public load balancer)
                      ▼
          Internal Application Load Balancer
                      │
                      ▼
          ECS Fargate task (Apache, PHP 8.5, Drupal 11.4.11)
                      │
                      ▼
              RDS MySQL 8.4 (TLS required and verified)

EventBridge ─ hourly ─▶ one-off task: naturedex-task cron
```

Everything is one stack, `NaturedexDrupal`, in **us-east-1**, the only region where CloudFront accepts WAF ACLs and certificates.

| Decision | Choice | Why |
| --- | --- | --- |
| Image | Official `drupal:11.4.11-php8.5-apache-trixie`, plus the module, theme, built assets, and seed data | Same Drupal and PHP minor version as the local tests. Code is immutable in the image |
| Compute | Fargate, 0.5 vCPU, 1 GB, ARM, one task | No servers to patch, and a task can be replaced at any time |
| Database | RDS MySQL 8.4, `db.t4g.micro`, Single-AZ | Drupal's most common production database. Multi-AZ would double the cost |
| Files | None shared | Drupal stores content, sessions, and caches in the database. CSS/JS aggregates and compiled templates are rebuilt by each task on demand. This removes the WordPress edition's EFS and its backups |
| Public entry | CloudFront only | The load balancer has no public address, so it can't be reached around the WAF |
| Network | No NAT gateway | Tasks sit in public subnets with no inbound internet rules |
| Secrets | Secrets Manager, injected by ECS | `settings.php` holds no secrets. The hash salt and database password are separate secrets |

## How Drupal sits behind CloudFront

The hop from the load balancer to the container is plain HTTP, and the load balancer's address replaces the visitor's. An HTTP middleware in `naturedex_core` (`CloudFrontMiddleware`, switched on by `docker/settings.php`) restores both from CloudFront's own headers, before Drupal's page cache sees the request. That is safe because only the load balancer can reach the container, and only CloudFront can reach the load balancer.

Drupal's built-in reverse-proxy settings can't do this here: the load balancer overwrites `X-Forwarded-Proto` with `http`, and appends CloudFront's address to `X-Forwarded-For`. Changing `$_SERVER` in `settings.php` doesn't work either, because Drupal builds its request object before loading settings. The first CI smoke test caught that.

| Header | Used for |
| --- | --- |
| `Host` | Drupal's trusted host check and the links it builds. The stack passes the CloudFront domain (and a custom domain, if any) as the only trusted hosts |
| `CloudFront-Forwarded-Proto` | Marks the request as HTTPS, so session cookies are `Secure` and links use `https` |
| `CloudFront-Viewer-Address` | Becomes the client address, so Drupal's login flood control counts per visitor rather than locking out everyone at once |

## How caching works

Drupal clears its own page cache precisely, through cache tags, whenever anything is saved. CloudFront can't see those tags, so it keeps pages briefly.

| Request | Behavior |
| --- | --- |
| Public pages | Cached at the edge for 5 minutes (404s for 1 minute). Browsers always revalidate: `naturedex_core` turns Drupal's `public, max-age=300` into `max-age=0, s-maxage=300`. Only `?page=` is in the cache key, so other query strings can't force a miss |
| `/core/*`, `/modules/*`, `/themes/*`, `/sites/*` | Cached for a day. Every query string is in the key, because Drupal names CSS/JS aggregates by query |
| `/admin*`, `/user*`, `/node/*`, `/editor`, `/api/*`, `/session/*`, and a few other Drupal paths | Never cached; all methods allowed |
| Signed-in visitors on public pages | Bypass the shared cache |

The last row needs a known cookie name. Drupal normally names the session cookie after a hash of the host, which isn't known until CloudFront exists. `naturedex_core` fixes it to `SSESSnaturedex`, and CloudFront adds that cookie to the cache key. Drupal answers signed-in requests with `private, no-cache`, so they are never stored.

**A published or edited note can take up to 5 minutes to appear for visitors.** Instant updates would need a CloudFront invalidation on save. That is not worth building for a journal.

## Security

- WAF: AWS common, known-bad-input, and PHP rule sets. It also blocks the install, update, rebuild, and authorize scripts, limits `/user/login` and `/user/password` to 20 requests per 5 minutes per IP, and limits non-asset requests to 300 per 5 minutes per IP.
- Two common-rule-set rules are set to count, not block: `SizeRestrictions_BODY` and `CrossSiteScripting_BODY`. Otherwise they would reject long field notes and notes that mention HTML. Drupal validates and escapes that content.
- The install and update scripts are blocked at both the WAF and Apache. Between stack creation and the bootstrap task the database is empty, and the web installer would let anyone claim the site.
- The database connection requires TLS (a parameter group setting) and **verifies the server certificate** against the RDS CA bundle, which the image pins by checksum.
- Audit trail: CloudTrail with file validation (kept 90 days in S3), GuardDuty, and WAF logs of every request (kept 30 days). Severe GuardDuty findings go to the alarm topic. WAF logs redact `cookie`, `authorization`, and `x-csrf-token`. An account can have only one GuardDuty detector, so set `ACCOUNT_AUDITING=false` if the WordPress edition's stack is still running.
- The admin password and the RDS master login exist only in the one-off bootstrap task, not in the container that serves visitors. Drupal connects as `naturedex_app`, which the bootstrap task creates (`docker/db-user.php`) with rights on the `drupal` database only, and which must use TLS.
- There is no ECS Exec, so nobody can open a shell in the running site. One-off commands run as separate tasks.
- Sessions: the cookie ends when the browser closes, and Drupal forgets a session after 12 idle hours (core keeps both for 23 days).
- Less fingerprinting: no `X-Generator` header; core's `CHANGELOG.txt`, `INSTALL.txt`, and readmes return 403; `/user/1` and a missing account both return 404, so accounts can't be counted.
- Deploys need approval: the Deploy workflow runs in the `production` GitHub environment, which requires a reviewer and allows only `main`, and the AWS role trusts only that environment's tokens. A branch ruleset blocks force-pushes to and deletion of `main`. Dependabot alerts and security updates are on.
- A daily workflow (`drupal-security.yml`) fails, and so emails the repository owner, when the pinned Drupal release is marked insecure, a newer security release exists on its branch, or the branch loses support.
- Tasks can reach only HTTPS and the database outbound.
- Security headers, including the CSP, are sent by CloudFront. A browser test loads public pages under that exact CSP.
- Code can't change on the server, and Drupal updates arrive only through a new image. Account registration is administrator-only.

## Monthly cost estimate

On-demand, us-east-1, low traffic, 730 hours a month. Unit rates were checked against the AWS Price List API on November 9, 2026. Usage behind the small items is estimated, and tax is not included.

| Item | Rate | Per month |
| --- | --- | ---: |
| Load balancer | $0.0225/hour, plus $0.008 per capacity-unit hour | $16.50–17 |
| Fargate, one ARM task (0.5 vCPU, 1 GB) | $0.03238 per vCPU-hour, $0.00356 per GB-hour | $14.42 |
| RDS `db.t4g.micro`, Single-AZ | $0.016/hour | $11.68 |
| RDS storage, 20 GB gp3 | $0.115 per GB-month; backups up to 20 GB are free | $2.30 |
| WAF: web ACL and 6 rules | $5 per ACL, $1 per rule, $0.60 per million requests | $11.00 |
| Public IPv4 address for the task | $0.005/hour | $3.65 |
| Secrets Manager, 3 secrets | $0.40 each | $1.20 |
| CloudWatch: 3 alarms, task and WAF logs | $0.10 per alarm, plus light log ingestion | about $1 |
| Hourly cron tasks (about a minute each) | Fargate rates | $0.25 |
| ECR image (about 210 MB per deployed version) | Storage per GB-month | under $0.10 |
| CloudFront | Inside the always-free tier at this traffic | $0 |
| **Total** | | **about $62–64** |

That is about **$2.10 a day**: roughly $15 for a week, $30 for two weeks.

GuardDuty and CloudTrail are not counted, because the WordPress stack provides them for the whole account. If this stack runs alone with `ACCOUNT_AUDITING=true`, add about $2–5.

The fixed costs dominate: the load balancer, the task, the database, and the WAF are about 90% of the bill whatever the traffic. After `cdk destroy`, the retained 20 GB database snapshot costs about $1.90 a month ($0.095 per GB-month) until deleted. Spending limits are set as AWS budgets on the account, not in this stack.

## Deployment

GitHub Actions does the work, so Docker isn't needed locally. CI runs every test, then builds the production image on ARM and boots it against MySQL 8.4 with TLS required (`docker/smoke-test.sh`). The Deploy workflow is started by hand and signs in to AWS through OIDC, with no stored keys.

### One-time setup

```sh
aws login
cd infra && npm ci

# Skip if the account is already bootstrapped (the WordPress edition did this).
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1

# The deploy role. If the account already has a GitHub OIDC provider, pass its
# ARN as ExistingProviderArn; see the template for finding the subject.
aws cloudformation deploy --template-file infra/github-oidc.yaml \
  --stack-name NaturedexDrupalGitHubOidc --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides Repository=SUBJECT

gh variable set AWS_DEPLOY_ROLE_ARN --body ROLE_ARN
# Only if another stack in the account already runs GuardDuty:
gh variable set ACCOUNT_AUDITING --body false
# Optional:
gh variable set ALARM_EMAIL --body you@example.com
```

The role trusts only jobs in this repository's `production` environment, and can only assume the CDK bootstrap roles. Create the environment before the first deploy, with yourself as reviewer and `main` as the only allowed branch:

```sh
gh api -X PUT repos/OWNER/NAME/environments/production --input - <<'JSON'
{"reviewers":[{"type":"User","id":YOUR_USER_ID}],"prevent_self_review":false,
 "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api -X POST repos/OWNER/NAME/environments/production/deployment-branch-policies -f name=main -f type=branch
```

### Each deployment

```sh
gh workflow run deploy.yml
```

Then approve it in the run's page on GitHub (or `gh api` the pending deployment).

### First install

Run this once, after the first deployment, with the stack's outputs. Confirm first that `/core/install.php` returns 403.

```sh
aws ecs run-task --cluster CLUSTER --task-definition BOOTSTRAP_TASK_ARN \
  --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[SUBNET_IDS],securityGroups=[TASK_SG],assignPublicIp=ENABLED}'
```

It creates Drupal's database account, installs Drupal into RDS, enables the module and themes, and imports the seed content. It's safe to repeat: it skips what exists and only adds missing seeds. Sign in at `/user/login` as `naturedex-admin`; read the password with `aws secretsmanager get-secret-value --secret-id ADMIN_PASSWORD_SECRET_ARN`. Create editor and contributor accounts at `/admin/people`.

## Operations

**Release.** The Deploy workflow builds the image and rolls it out. A new task must pass health checks before the old one stops, and a failing release rolls back automatically.

**Drupal or PHP updates.** Change the image tag in `docker/Dockerfile` and `DRUPAL_VERSION` in `scripts/runtime.mjs`, run `npm run verify`, then deploy. If the release has database updates, run them once as a one-off task (`update.php` is blocked), for example with a temporary `composer require drush/drush && vendor/bin/drush updatedb`. Nothing on the site updates itself; the daily `drupal-security.yml` workflow says when a security release is waiting. Redeploying also rebuilds the image with current OS updates, so redeploy when Debian fixes the image's open CVEs (ECR scans each pushed image).

**One-off commands.** Run the web task definition as a separate task with a different command, for example `naturedex-task rebuild` (clear caches):

```sh
aws ecs run-task --cluster CLUSTER --task-definition WEB_TASK_FAMILY --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[SUBNET_IDS],securityGroups=[TASK_SG],assignPublicIp=ENABLED}' \
  --overrides '{"containerOverrides":[{"name":"drupal","command":["naturedex-task","rebuild"]}]}'
```

Its output is in the task's CloudWatch log stream. ECS Exec is off; turning it on (`enableExecuteCommand`) would also need session logging.

**Backups.** RDS keeps 7 days of point-in-time recovery, and the database is the only state. Do one restore drill early.

**Availability.** Single task and Single-AZ database. For higher availability, raise `desiredCount` to 2 and enable `multiAz`. No shared storage is needed for a second task.

**Teardown.** The database has deletion protection, so turn that off first, then destroy from `infra/`:

```sh
aws rds modify-db-instance --db-instance-identifier DB_ID --no-deletion-protection --apply-immediately
npx cdk destroy
```

RDS leaves a final snapshot, and the CloudTrail bucket is kept (it empties itself after 90 days). Delete them by hand when finished. Delete `NaturedexDrupalGitHubOidc` last.

## What has been tested

- **CI**, on every push: the full unit and browser suites on Linux, then the production image built on ARM and booted against MySQL 8.4 with TLS required. The smoke test installs Drupal, re-runs the install to prove it changes nothing, runs cron, checks every public route and blocked script, the cache headers, CSS aggregate generation, the CloudFront header handling (https links, a `Secure` `SSESSnaturedex` cookie, the visitor address recorded on the session), and a draft saved through the API.
- **The live site**, after the first install:
  - Public pages, the API, 404s, and blocked installer and update scripts return the expected codes; links are `https`; all 24 species are served.
  - Pages come from CloudFront's cache with `max-age=0, public, s-maxage=300`, and carry the CSP and HSTS headers. Plain HTTP redirects to HTTPS.
  - In a real browser: signing in sets a `Secure`, `HttpOnly` `SSESSnaturedex` cookie; a field note containing HTML was published through the Writing desk (passing the WAF's body rules), appeared to visitors with the HTML shown as text, and was deleted; Drupal's admin opens.

### What the first runs found

| Problem | Cause | Fix |
| --- | --- | --- |
| Links used `http` behind CloudFront | Drupal builds its request before loading `settings.php`, so changing `$_SERVER` there came too late | A middleware updates the request before the page cache |
| A republished species looked stale in one browser test, on CI only | Drupal's page cache uses the second a page was cached as its `ETag`; a page cached twice in one second revalidates as unchanged | Check as a newly arriving visitor |

### Security hardening, November 10, 2026

An audit of the running deployment found no critical or high issues. These followed from it: the separate database account, no ECS Exec, shorter sessions, less fingerprinting, deploy approval through a GitHub environment, a branch ruleset, Dependabot, and the daily release check. Not changed:

- Sign-in is still password-only. Drupal core has no second factor; a WAF IP allowlist for `/user/login` and `/admin*` would work but would lock out sign-ins from other networks. The password is 32 random characters, and the WAF and Drupal both limit attempts.
- TLS 1.0 and 1.1 are accepted on the default `*.cloudfront.net` certificate. Only a custom domain can use `TLSv1.2_2021`, which the stack applies when one is configured.
- The base image has open Debian CVEs with no fix yet (libxml2, glibc, cyrus-sasl2). The site never parses visitors' XML. Redeploying picks up fixes once Debian ships them.

### What has not been tested

- The WAF rate limits, because triggering them would block the tester's address.
- A restore from backup.
- Manual accessibility checks, recorded in [accessibility.md](accessibility.md).

## Sources

- [CloudFront VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)
- [CloudFront request headers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html)
- [Using SSL/TLS with RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)
- [Drupal: trusted host settings](https://www.drupal.org/docs/getting-started/installing-drupal/trusted-host-settings)
- [Official Drupal Docker image](https://hub.docker.com/_/drupal)
