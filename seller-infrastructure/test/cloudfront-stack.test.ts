import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { X402SellerStack } from '../lib/cloudfront-stack';

describe('X402SellerStack (native WAF)', () => {
  const app = new cdk.App();
  const stack = new X402SellerStack(app, 'TestStack', {
    env: { region: 'us-east-1', account: '123456789012' },
  });
  const template = Template.fromStack(stack);

  it('creates a CLOUDFRONT-scoped WebACL', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Scope: 'CLOUDFRONT',
    });
  });

  it('the WebACL pins Bot Control v6', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: 'AWSBotControl',
          Statement: Match.objectLike({
            ManagedRuleGroupStatement: Match.objectLike({
              Name: 'AWSManagedRulesBotControlRuleSet',
              Version: 'Version_6.0',
            }),
          }),
        }),
      ]),
    });
  });

  it('injects the preview MonetizationConfig via override', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      MonetizationConfig: Match.objectLike({
        CurrencyMode: 'TEST',
      }),
    });
  });

  it('the distribution references the WebACL', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        WebACLId: Match.anyValue(),
      }),
    });
  });

  it('no Lambda@Edge function associations remain', () => {
    const dists = template.findResources('AWS::CloudFront::Distribution');
    const json = JSON.stringify(dists);
    expect(json).not.toContain('LambdaFunctionAssociations');
  });
});
