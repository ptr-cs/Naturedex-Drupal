import { App } from 'aws-cdk-lib';
import { NaturedexStack } from '../lib/naturedex-stack.js';

const app = new App();
const context = (key: string) => String(app.node.tryGetContext(key) ?? '');

new NaturedexStack(app, 'NaturedexDrupal', {
  env: { region: 'us-east-1' },
  alarmEmail: context('alarmEmail') || undefined,
  domainName: context('domainName') || undefined,
  hostedZoneId: context('hostedZoneId') || undefined,
  hostedZoneName: context('hostedZoneName') || undefined,
  // GuardDuty allows one detector per account and region. Pass
  // -c accountAuditing=false when another stack already provides one.
  accountAuditing: context('accountAuditing') !== 'false',
});
