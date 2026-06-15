"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = __importStar(require("aws-cdk-lib"));
const assertions_1 = require("aws-cdk-lib/assertions");
const cloudfront_stack_1 = require("../lib/cloudfront-stack");
describe('X402SellerStack (native WAF)', () => {
    const app = new cdk.App();
    const stack = new cloudfront_stack_1.X402SellerStack(app, 'TestStack', {
        env: { region: 'us-east-1', account: '123456789012' },
    });
    const template = assertions_1.Template.fromStack(stack);
    it('creates a CLOUDFRONT-scoped WebACL', () => {
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            Scope: 'CLOUDFRONT',
        });
    });
    it('the WebACL pins Bot Control v6', () => {
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            Rules: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
                    Name: 'AWSBotControl',
                    Statement: assertions_1.Match.objectLike({
                        ManagedRuleGroupStatement: assertions_1.Match.objectLike({
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
            MonetizationConfig: assertions_1.Match.objectLike({
                CurrencyMode: 'TEST',
            }),
        });
    });
    it('the distribution references the WebACL', () => {
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: assertions_1.Match.objectLike({
                WebACLId: assertions_1.Match.anyValue(),
            }),
        });
    });
    it('no Lambda@Edge function associations remain', () => {
        const dists = template.findResources('AWS::CloudFront::Distribution');
        const json = JSON.stringify(dists);
        expect(json).not.toContain('LambdaFunctionAssociations');
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWRmcm9udC1zdGFjay50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY2xvdWRmcm9udC1zdGFjay50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHVEQUF5RDtBQUN6RCw4REFBMEQ7QUFFMUQsUUFBUSxDQUFDLDhCQUE4QixFQUFFLEdBQUcsRUFBRTtJQUM1QyxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUMxQixNQUFNLEtBQUssR0FBRyxJQUFJLGtDQUFlLENBQUMsR0FBRyxFQUFFLFdBQVcsRUFBRTtRQUNsRCxHQUFHLEVBQUUsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLE9BQU8sRUFBRSxjQUFjLEVBQUU7S0FDdEQsQ0FBQyxDQUFDO0lBQ0gsTUFBTSxRQUFRLEdBQUcscUJBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUM7SUFFM0MsRUFBRSxDQUFDLG9DQUFvQyxFQUFFLEdBQUcsRUFBRTtRQUM1QyxRQUFRLENBQUMscUJBQXFCLENBQUMsb0JBQW9CLEVBQUU7WUFDbkQsS0FBSyxFQUFFLFlBQVk7U0FDcEIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMsZ0NBQWdDLEVBQUUsR0FBRyxFQUFFO1FBQ3hDLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyxvQkFBb0IsRUFBRTtZQUNuRCxLQUFLLEVBQUUsa0JBQUssQ0FBQyxTQUFTLENBQUM7Z0JBQ3JCLGtCQUFLLENBQUMsVUFBVSxDQUFDO29CQUNmLElBQUksRUFBRSxlQUFlO29CQUNyQixTQUFTLEVBQUUsa0JBQUssQ0FBQyxVQUFVLENBQUM7d0JBQzFCLHlCQUF5QixFQUFFLGtCQUFLLENBQUMsVUFBVSxDQUFDOzRCQUMxQyxJQUFJLEVBQUUsa0NBQWtDOzRCQUN4QyxPQUFPLEVBQUUsYUFBYTt5QkFDdkIsQ0FBQztxQkFDSCxDQUFDO2lCQUNILENBQUM7YUFDSCxDQUFDO1NBQ0gsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMscURBQXFELEVBQUUsR0FBRyxFQUFFO1FBQzdELFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyxvQkFBb0IsRUFBRTtZQUNuRCxrQkFBa0IsRUFBRSxrQkFBSyxDQUFDLFVBQVUsQ0FBQztnQkFDbkMsWUFBWSxFQUFFLE1BQU07YUFDckIsQ0FBQztTQUNILENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLHdDQUF3QyxFQUFFLEdBQUcsRUFBRTtRQUNoRCxRQUFRLENBQUMscUJBQXFCLENBQUMsK0JBQStCLEVBQUU7WUFDOUQsa0JBQWtCLEVBQUUsa0JBQUssQ0FBQyxVQUFVLENBQUM7Z0JBQ25DLFFBQVEsRUFBRSxrQkFBSyxDQUFDLFFBQVEsRUFBRTthQUMzQixDQUFDO1NBQ0gsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMsNkNBQTZDLEVBQUUsR0FBRyxFQUFFO1FBQ3JELE1BQU0sS0FBSyxHQUFHLFFBQVEsQ0FBQyxhQUFhLENBQUMsK0JBQStCLENBQUMsQ0FBQztRQUN0RSxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ25DLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLDRCQUE0QixDQUFDLENBQUM7SUFDM0QsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBUZW1wbGF0ZSwgTWF0Y2ggfSBmcm9tICdhd3MtY2RrLWxpYi9hc3NlcnRpb25zJztcbmltcG9ydCB7IFg0MDJTZWxsZXJTdGFjayB9IGZyb20gJy4uL2xpYi9jbG91ZGZyb250LXN0YWNrJztcblxuZGVzY3JpYmUoJ1g0MDJTZWxsZXJTdGFjayAobmF0aXZlIFdBRiknLCAoKSA9PiB7XG4gIGNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG4gIGNvbnN0IHN0YWNrID0gbmV3IFg0MDJTZWxsZXJTdGFjayhhcHAsICdUZXN0U3RhY2snLCB7XG4gICAgZW52OiB7IHJlZ2lvbjogJ3VzLWVhc3QtMScsIGFjY291bnQ6ICcxMjM0NTY3ODkwMTInIH0sXG4gIH0pO1xuICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG5cbiAgaXQoJ2NyZWF0ZXMgYSBDTE9VREZST05ULXNjb3BlZCBXZWJBQ0wnLCAoKSA9PiB7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OldBRnYyOjpXZWJBQ0wnLCB7XG4gICAgICBTY29wZTogJ0NMT1VERlJPTlQnLFxuICAgIH0pO1xuICB9KTtcblxuICBpdCgndGhlIFdlYkFDTCBwaW5zIEJvdCBDb250cm9sIHY2JywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpXQUZ2Mjo6V2ViQUNMJywge1xuICAgICAgUnVsZXM6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgIE5hbWU6ICdBV1NCb3RDb250cm9sJyxcbiAgICAgICAgICBTdGF0ZW1lbnQ6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgTWFuYWdlZFJ1bGVHcm91cFN0YXRlbWVudDogTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICAgIE5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNCb3RDb250cm9sUnVsZVNldCcsXG4gICAgICAgICAgICAgIFZlcnNpb246ICdWZXJzaW9uXzYuMCcsXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSksXG4gICAgICBdKSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgaXQoJ2luamVjdHMgdGhlIHByZXZpZXcgTW9uZXRpemF0aW9uQ29uZmlnIHZpYSBvdmVycmlkZScsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6V0FGdjI6OldlYkFDTCcsIHtcbiAgICAgIE1vbmV0aXphdGlvbkNvbmZpZzogTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgIEN1cnJlbmN5TW9kZTogJ1RFU1QnLFxuICAgICAgfSksXG4gICAgfSk7XG4gIH0pO1xuXG4gIGl0KCd0aGUgZGlzdHJpYnV0aW9uIHJlZmVyZW5jZXMgdGhlIFdlYkFDTCcsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q2xvdWRGcm9udDo6RGlzdHJpYnV0aW9uJywge1xuICAgICAgRGlzdHJpYnV0aW9uQ29uZmlnOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgV2ViQUNMSWQ6IE1hdGNoLmFueVZhbHVlKCksXG4gICAgICB9KSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgaXQoJ25vIExhbWJkYUBFZGdlIGZ1bmN0aW9uIGFzc29jaWF0aW9ucyByZW1haW4nLCAoKSA9PiB7XG4gICAgY29uc3QgZGlzdHMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkNsb3VkRnJvbnQ6OkRpc3RyaWJ1dGlvbicpO1xuICAgIGNvbnN0IGpzb24gPSBKU09OLnN0cmluZ2lmeShkaXN0cyk7XG4gICAgZXhwZWN0KGpzb24pLm5vdC50b0NvbnRhaW4oJ0xhbWJkYUZ1bmN0aW9uQXNzb2NpYXRpb25zJyk7XG4gIH0pO1xufSk7XG4iXX0=