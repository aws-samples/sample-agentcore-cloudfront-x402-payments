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
exports.X402SellerStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const cloudfront = __importStar(require("aws-cdk-lib/aws-cloudfront"));
const origins = __importStar(require("aws-cdk-lib/aws-cloudfront-origins"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const wafv2 = __importStar(require("aws-cdk-lib/aws-wafv2"));
const cdk_nag_1 = require("cdk-nag");
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const monetization_config_1 = require("./waf/monetization-config");
// Load .env from project root (PAYMENT_RECIPIENT_ADDRESS = payee wallet)
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const DEFAULT_PAY_TO = '0x24842F3136Fa2a3df835d36b4c3cb4972d405502';
class X402SellerStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Unique suffix for policy names to avoid conflicts on redeploy
        const suffix = cdk.Names.uniqueId(this).slice(-8);
        // Create S3 bucket for static content (optional)
        const contentBucket = new s3.Bucket(this, 'ContentBucket', {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            cors: [
                {
                    allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
                    allowedOrigins: ['*'],
                    allowedHeaders: ['*'],
                },
            ],
        });
        // =========================================================================
        // Caching Policies
        // =========================================================================
        // Cache policy for payment-protected API endpoints
        // Disabled - each request requires unique payment verification
        const paymentApiCachePolicy = new cloudfront.CachePolicy(this, 'PaymentApiCachePolicy', {
            cachePolicyName: `X402-PaymentApi-NoCache-${suffix}`,
            comment: 'No caching for x402 payment-protected endpoints',
            defaultTtl: cdk.Duration.seconds(0),
            minTtl: cdk.Duration.seconds(0),
            maxTtl: cdk.Duration.seconds(0),
            // Note: headerBehavior cannot be set when caching is disabled (TTL=0)
            // Payment headers are forwarded via the origin request policy instead
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        });
        // Cache policy for static assets (images, CSS, JS, fonts)
        // These don't require payment and can be cached aggressively
        const staticAssetsCachePolicy = new cloudfront.CachePolicy(this, 'StaticAssetsCachePolicy', {
            cachePolicyName: `X402-StaticAssets-LongCache-${suffix}`,
            comment: 'Long-term caching for static assets that do not require payment',
            defaultTtl: cdk.Duration.days(1),
            minTtl: cdk.Duration.seconds(1),
            maxTtl: cdk.Duration.days(365),
            headerBehavior: cloudfront.CacheHeaderBehavior.none(),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
        });
        // Cache policy for public content (non-payment-protected pages)
        // Short TTL to balance freshness with performance
        const publicContentCachePolicy = new cloudfront.CachePolicy(this, 'PublicContentCachePolicy', {
            cachePolicyName: `X402-PublicContent-ShortCache-${suffix}`,
            comment: 'Short-term caching for public content pages',
            defaultTtl: cdk.Duration.minutes(5),
            minTtl: cdk.Duration.seconds(1),
            maxTtl: cdk.Duration.hours(1),
            headerBehavior: cloudfront.CacheHeaderBehavior.none(),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
        });
        // =========================================================================
        // Response Headers Policy
        // =========================================================================
        const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'ResponseHeadersPolicy', {
            responseHeadersPolicyName: `X402-ResponseHeaders-${suffix}`,
            comment: 'CORS and x402 payment response headers',
            corsBehavior: {
                accessControlAllowOrigins: ['*'],
                accessControlAllowHeaders: [
                    'Content-Type',
                    'X-Payment-Signature',
                    'Payment-Signature',
                    'Accept',
                    'Origin',
                ],
                accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
                accessControlExposeHeaders: [
                    'X-PAYMENT-RESPONSE',
                    'X-PAYMENT-REQUIRED',
                    'X-Request-Id',
                ],
                accessControlAllowCredentials: false,
                accessControlMaxAge: cdk.Duration.hours(1),
                originOverride: true,
            },
            // Security headers for best practices
            securityHeadersBehavior: {
                contentTypeOptions: { override: true },
                frameOptions: {
                    frameOption: cloudfront.HeadersFrameOption.DENY,
                    override: true,
                },
                referrerPolicy: {
                    referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
                    override: true,
                },
                xssProtection: {
                    protection: true,
                    modeBlock: true,
                    override: true,
                },
            },
            // Custom headers for cache debugging
            customHeadersBehavior: {
                customHeaders: [
                    {
                        header: 'X-Cache-Policy',
                        value: 'x402-seller',
                        override: false,
                    },
                ],
            },
        });
        // =========================================================================
        // Native WAF x402 monetization
        //
        // PARKING LOT: MonetizationConfig + per-rule Monetize actions are an AWS WAF
        // preview capability not yet in released CloudFormation/CDK. The WebACL below
        // synthesizes today with Bot Control detection + allow rules; the monetization
        // fields are injected via L1 addPropertyOverride so they deploy verbatim once
        // support ships. Until then they are inert. Tracking: see PR description.
        // =========================================================================
        const payTo = process.env.PAYMENT_RECIPIENT_ADDRESS || DEFAULT_PAY_TO;
        const rules = (0, monetization_config_1.buildWebAclRules)('x402seller');
        const webAcl = new wafv2.CfnWebACL(this, 'X402WebACL', {
            name: `x402-seller-acl-${suffix}`,
            scope: 'CLOUDFRONT',
            defaultAction: { allow: {} },
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: `x402-seller-acl-${suffix}`,
            },
        });
        // The rule array carries the detection + allow rules and the preview Monetize
        // actions in the WAF JSON (PascalCase) contract. It is injected via L1
        // addPropertyOverride rather than the typed `rules` prop so the preview
        // `Monetize` action passes through CloudFormation verbatim (the released CDK
        // RuleProperty type does not yet model it).
        webAcl.addPropertyOverride('Rules', rules);
        // PARKING LOT: inject the preview MonetizationConfig (rejected by released CFN).
        webAcl.addPropertyOverride('MonetizationConfig', (0, monetization_config_1.buildMonetizationConfig)(payTo));
        // =========================================================================
        // CloudFront Distribution
        // =========================================================================
        // Create CloudFront distribution with optimized caching
        const distribution = new cloudfront.Distribution(this, 'X402Distribution', {
            comment: 'x402 Payment-Protected Content Distribution',
            webAclId: webAcl.attrArn,
            defaultBehavior: {
                origin: new origins.S3Origin(contentBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                // Default behavior must not cache — paid content is verified per request.
                cachePolicy: paymentApiCachePolicy,
                responseHeadersPolicy: responseHeadersPolicy,
                compress: true,
            },
            additionalBehaviors: {
                // MCP discovery endpoint - NO payment required, short caching
                '/mcp/*': {
                    origin: new origins.S3Origin(contentBucket),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                    cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                    cachePolicy: publicContentCachePolicy,
                    responseHeadersPolicy: responseHeadersPolicy,
                    compress: true,
                },
                // Payment-protected API endpoints - NO caching
                '/api/*': {
                    origin: new origins.S3Origin(contentBucket),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                    cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                    cachePolicy: paymentApiCachePolicy,
                    responseHeadersPolicy: responseHeadersPolicy,
                    compress: true,
                },
                // Static assets - aggressive caching
                '/static/*': {
                    origin: new origins.S3Origin(contentBucket),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                    cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
                    cachePolicy: staticAssetsCachePolicy,
                    responseHeadersPolicy: responseHeadersPolicy,
                    compress: true,
                },
                // Images - aggressive caching
                '*.jpg': {
                    origin: new origins.S3Origin(contentBucket),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                    cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
                    cachePolicy: staticAssetsCachePolicy,
                    compress: false, // Images are already compressed
                },
                '*.png': {
                    origin: new origins.S3Origin(contentBucket),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                    cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
                    cachePolicy: staticAssetsCachePolicy,
                    compress: false,
                },
                '*.svg': {
                    origin: new origins.S3Origin(contentBucket),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                    cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
                    cachePolicy: staticAssetsCachePolicy,
                    compress: true, // SVGs benefit from compression
                },
                // CSS and JS - aggressive caching
                '*.css': {
                    origin: new origins.S3Origin(contentBucket),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                    cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
                    cachePolicy: staticAssetsCachePolicy,
                    compress: true,
                },
                '*.js': {
                    origin: new origins.S3Origin(contentBucket),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                    cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
                    cachePolicy: staticAssetsCachePolicy,
                    compress: true,
                },
                // Fonts - aggressive caching
                '*.woff2': {
                    origin: new origins.S3Origin(contentBucket),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                    cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
                    cachePolicy: staticAssetsCachePolicy,
                    compress: false, // Fonts are already compressed
                },
            },
            // Enable HTTP/2 and HTTP/3 for better performance
            httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
            // Price class - use all edge locations for best performance
            priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
            // Logging disabled for demo simplicity
            // CloudFront standard logging requires ACL-enabled buckets
            enableLogging: false,
        });
        // =========================================================================
        // Outputs
        // =========================================================================
        new cdk.CfnOutput(this, 'DistributionDomainName', {
            value: distribution.distributionDomainName,
            description: 'CloudFront Distribution Domain Name',
            exportName: 'X402DistributionDomain',
        });
        new cdk.CfnOutput(this, 'DistributionUrl', {
            value: `https://${distribution.distributionDomainName}`,
            description: 'CloudFront Distribution URL',
            exportName: 'X402DistributionUrl',
        });
        new cdk.CfnOutput(this, 'DistributionId', {
            value: distribution.distributionId,
            description: 'CloudFront Distribution ID (for cache invalidation)',
            exportName: 'X402DistributionId',
        });
        new cdk.CfnOutput(this, 'ContentBucketName', {
            value: contentBucket.bucketName,
            description: 'S3 Content Bucket Name',
            exportName: 'X402ContentBucket',
        });
        new cdk.CfnOutput(this, 'PaymentApiEndpoint', {
            value: `https://${distribution.distributionDomainName}/api/`,
            description: 'Payment-protected API endpoint (requires x402 payment)',
            exportName: 'X402PaymentApiEndpoint',
        });
        new cdk.CfnOutput(this, 'CachePolicySummary', {
            value: JSON.stringify({
                paymentApi: 'No caching (TTL=0) - each request requires payment verification',
                staticAssets: 'Long-term caching (default 1 day, max 1 year)',
                publicContent: 'Short-term caching (default 5 min, max 1 hour)',
            }),
            description: 'Summary of caching policies applied to different content types',
        });
        // ==========================================
        // CDK Nag Suppressions
        // ==========================================
        cdk_nag_1.NagSuppressions.addResourceSuppressions(contentBucket, [
            { id: 'AwsSolutions-S1', reason: 'Demo project — access logs not required for testnet content bucket' },
            { id: 'AwsSolutions-S10', reason: 'Bucket is only accessed via CloudFront OAI, not directly over the internet' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(distribution, [
            { id: 'AwsSolutions-CFR1', reason: 'Demo project — geo restrictions not needed for testnet demo' },
            { id: 'AwsSolutions-CFR3', reason: 'Demo project — CloudFront access logging not required' },
            { id: 'AwsSolutions-CFR4', reason: 'Using default CloudFront viewer certificate which requires default SSL policy' },
            { id: 'AwsSolutions-CFR7', reason: 'Using legacy S3Origin with OAI — migration to S3BucketOrigin with OAC is a future improvement' },
        ]);
    }
}
exports.X402SellerStack = X402SellerStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWRmcm9udC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNsb3VkZnJvbnQtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHVFQUF5RDtBQUN6RCw0RUFBOEQ7QUFDOUQsdURBQXlDO0FBQ3pDLDZEQUErQztBQUUvQyxxQ0FBMEM7QUFDMUMsK0NBQWlDO0FBQ2pDLDJDQUE2QjtBQUM3QixtRUFHbUM7QUFFbkMseUVBQXlFO0FBQ3pFLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUU1RCxNQUFNLGNBQWMsR0FBRyw0Q0FBNEMsQ0FBQztBQUVwRSxNQUFhLGVBQWdCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDNUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixnRUFBZ0U7UUFDaEUsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFbEQsaURBQWlEO1FBQ2pELE1BQU0sYUFBYSxHQUFHLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3pELGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87WUFDeEMsaUJBQWlCLEVBQUUsSUFBSTtZQUN2QixJQUFJLEVBQUU7Z0JBQ0o7b0JBQ0UsY0FBYyxFQUFFLENBQUMsRUFBRSxDQUFDLFdBQVcsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7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QUFFO1lBQzVDLEtBQUssRUFBRSxXQUFXLFlBQVksQ0FBQyxzQkFBc0IsT0FBTztZQUM1RCxXQUFXLEVBQUUsd0RBQXdEO1lBQ3JFLFVBQVUsRUFBRSx3QkFBd0I7U0FDckMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUM1QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDcEIsVUFBVSxFQUFFLGlFQUFpRTtnQkFDN0UsWUFBWSxFQUFFLCtDQUErQztnQkFDN0QsYUFBYSxFQUFFLGdEQUFnRDthQUNoRSxDQUFDO1lBQ0YsV0FBVyxFQUFFLGdFQUFnRTtTQUM5RSxDQUFDLENBQUM7UUFFSCw2Q0FBNkM7UUFDN0MsdUJBQXVCO1FBQ3ZCLDZDQUE2QztRQUM3Qyx5QkFBZSxDQUFDLHVCQUF1QixDQUFDLGFBQWEsRUFBRTtZQUNyRCxFQUFFLEVBQUUsRUFBRSxpQkFBaUIsRUFBRSxNQUFNLEVBQUUsb0VBQW9FLEVBQUU7WUFDdkcsRUFBRSxFQUFFLEVBQUUsa0JBQWtCLEVBQUUsTUFBTSxFQUFFLDRFQUE0RSxFQUFFO1NBQ2pILEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFVCx5QkFBZSxDQUFDLHVCQUF1QixDQUFDLFlBQVksRUFBRTtZQUNwRCxFQUFFLEVBQUUsRUFBRSxtQkFBbUIsRUFBRSxNQUFNLEVBQUUsNkRBQTZELEVBQUU7WUFDbEcsRUFBRSxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLHVEQUF1RCxFQUFFO1lBQzVGLEVBQUUsRUFBRSxFQUFFLG1CQUFtQixFQUFFLE1BQU0sRUFBRSwrRUFBK0UsRUFBRTtZQUNwSCxFQUFFLEVBQUUsRUFBRSxtQkFBbUIsRUFBRSxNQUFNLEVBQUUsK0ZBQStGLEVBQUU7U0FDckksQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBcFZELDBDQW9WQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBjbG91ZGZyb250IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250JztcbmltcG9ydCAqIGFzIG9yaWdpbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQtb3JpZ2lucyc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgd2FmdjIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXdhZnYyJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSAnY2RrLW5hZyc7XG5pbXBvcnQgKiBhcyBkb3RlbnYgZnJvbSAnZG90ZW52JztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQge1xuICBidWlsZE1vbmV0aXphdGlvbkNvbmZpZyxcbiAgYnVpbGRXZWJBY2xSdWxlcyxcbn0gZnJvbSAnLi93YWYvbW9uZXRpemF0aW9uLWNvbmZpZyc7XG5cbi8vIExvYWQgLmVudiBmcm9tIHByb2plY3Qgcm9vdCAoUEFZTUVOVF9SRUNJUElFTlRfQUREUkVTUyA9IHBheWVlIHdhbGxldClcbmRvdGVudi5jb25maWcoeyBwYXRoOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLmVudicpIH0pO1xuXG5jb25zdCBERUZBVUxUX1BBWV9UTyA9ICcweDI0ODQyRjMxMzZGYTJhM2RmODM1ZDM2YjRjM2NiNDk3MmQ0MDU1MDInO1xuXG5leHBvcnQgY2xhc3MgWDQwMlNlbGxlclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gVW5pcXVlIHN1ZmZpeCBmb3IgcG9saWN5IG5hbWVzIHRvIGF2b2lkIGNvbmZsaWN0cyBvbiByZWRlcGxveVxuICAgIGNvbnN0IHN1ZmZpeCA9IGNkay5OYW1lcy51bmlxdWVJZCh0aGlzKS5zbGljZSgtOCk7XG5cbiAgICAvLyBDcmVhdGUgUzMgYnVja2V0IGZvciBzdGF0aWMgY29udGVudCAob3B0aW9uYWwpXG4gICAgY29uc3QgY29udGVudEJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0NvbnRlbnRCdWNrZXQnLCB7XG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IHRydWUsXG4gICAgICBjb3JzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogW3MzLkh0dHBNZXRob2RzLkdFVCwgczMuSHR0cE1ldGhvZHMuSEVBRF0sXG4gICAgICAgICAgYWxsb3dlZE9yaWdpbnM6IFsnKiddLFxuICAgICAgICAgIGFsbG93ZWRIZWFkZXJzOiBbJyonXSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQ2FjaGluZyBQb2xpY2llc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIENhY2hlIHBvbGljeSBmb3IgcGF5bWVudC1wcm90ZWN0ZWQgQVBJIGVuZHBvaW50c1xuICAgIC8vIERpc2FibGVkIC0gZWFjaCByZXF1ZXN0IHJlcXVpcmVzIHVuaXF1ZSBwYXltZW50IHZlcmlmaWNhdGlvblxuICAgIGNvbnN0IHBheW1lbnRBcGlDYWNoZVBvbGljeSA9IG5ldyBjbG91ZGZyb250LkNhY2hlUG9saWN5KFxuICAgICAgdGhpcyxcbiAgICAgICdQYXltZW50QXBpQ2FjaGVQb2xpY3knLFxuICAgICAge1xuICAgICAgICBjYWNoZVBvbGljeU5hbWU6IGBYNDAyLVBheW1lbnRBcGktTm9DYWNoZS0ke3N1ZmZpeH1gLFxuICAgICAgICBjb21tZW50OiAnTm8gY2FjaGluZyBmb3IgeDQwMiBwYXltZW50LXByb3RlY3RlZCBlbmRwb2ludHMnLFxuICAgICAgICBkZWZhdWx0VHRsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygwKSxcbiAgICAgICAgbWluVHRsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygwKSxcbiAgICAgICAgbWF4VHRsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygwKSxcbiAgICAgICAgLy8gTm90ZTogaGVhZGVyQmVoYXZpb3IgY2Fubm90IGJlIHNldCB3aGVuIGNhY2hpbmcgaXMgZGlzYWJsZWQgKFRUTD0wKVxuICAgICAgICAvLyBQYXltZW50IGhlYWRlcnMgYXJlIGZvcndhcmRlZCB2aWEgdGhlIG9yaWdpbiByZXF1ZXN0IHBvbGljeSBpbnN0ZWFkXG4gICAgICAgIHF1ZXJ5U3RyaW5nQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVRdWVyeVN0cmluZ0JlaGF2aW9yLm5vbmUoKSxcbiAgICAgICAgY29va2llQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVDb29raWVCZWhhdmlvci5ub25lKCksXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIENhY2hlIHBvbGljeSBmb3Igc3RhdGljIGFzc2V0cyAoaW1hZ2VzLCBDU1MsIEpTLCBmb250cylcbiAgICAvLyBUaGVzZSBkb24ndCByZXF1aXJlIHBheW1lbnQgYW5kIGNhbiBiZSBjYWNoZWQgYWdncmVzc2l2ZWx5XG4gICAgY29uc3Qgc3RhdGljQXNzZXRzQ2FjaGVQb2xpY3kgPSBuZXcgY2xvdWRmcm9udC5DYWNoZVBvbGljeShcbiAgICAgIHRoaXMsXG4gICAgICAnU3RhdGljQXNzZXRzQ2FjaGVQb2xpY3knLFxuICAgICAge1xuICAgICAgICBjYWNoZVBvbGljeU5hbWU6IGBYNDAyLVN0YXRpY0Fzc2V0cy1Mb25nQ2FjaGUtJHtzdWZmaXh9YCxcbiAgICAgICAgY29tbWVudDogJ0xvbmctdGVybSBjYWNoaW5nIGZvciBzdGF0aWMgYXNzZXRzIHRoYXQgZG8gbm90IHJlcXVpcmUgcGF5bWVudCcsXG4gICAgICAgIGRlZmF1bHRUdGw6IGNkay5EdXJhdGlvbi5kYXlzKDEpLFxuICAgICAgICBtaW5UdGw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDEpLFxuICAgICAgICBtYXhUdGw6IGNkay5EdXJhdGlvbi5kYXlzKDM2NSksXG4gICAgICAgIGhlYWRlckJlaGF2aW9yOiBjbG91ZGZyb250LkNhY2hlSGVhZGVyQmVoYXZpb3Iubm9uZSgpLFxuICAgICAgICBxdWVyeVN0cmluZ0JlaGF2aW9yOiBjbG91ZGZyb250LkNhY2hlUXVlcnlTdHJpbmdCZWhhdmlvci5ub25lKCksXG4gICAgICAgIGNvb2tpZUJlaGF2aW9yOiBjbG91ZGZyb250LkNhY2hlQ29va2llQmVoYXZpb3Iubm9uZSgpLFxuICAgICAgICBlbmFibGVBY2NlcHRFbmNvZGluZ0d6aXA6IHRydWUsXG4gICAgICAgIGVuYWJsZUFjY2VwdEVuY29kaW5nQnJvdGxpOiB0cnVlLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBDYWNoZSBwb2xpY3kgZm9yIHB1YmxpYyBjb250ZW50IChub24tcGF5bWVudC1wcm90ZWN0ZWQgcGFnZXMpXG4gICAgLy8gU2hvcnQgVFRMIHRvIGJhbGFuY2UgZnJlc2huZXNzIHdpdGggcGVyZm9ybWFuY2VcbiAgICBjb25zdCBwdWJsaWNDb250ZW50Q2FjaGVQb2xpY3kgPSBuZXcgY2xvdWRmcm9udC5DYWNoZVBvbGljeShcbiAgICAgIHRoaXMsXG4gICAgICAnUHVibGljQ29udGVudENhY2hlUG9saWN5JyxcbiAgICAgIHtcbiAgICAgICAgY2FjaGVQb2xpY3lOYW1lOiBgWDQwMi1QdWJsaWNDb250ZW50LVNob3J0Q2FjaGUtJHtzdWZmaXh9YCxcbiAgICAgICAgY29tbWVudDogJ1Nob3J0LXRlcm0gY2FjaGluZyBmb3IgcHVibGljIGNvbnRlbnQgcGFnZXMnLFxuICAgICAgICBkZWZhdWx0VHRsOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgbWluVHRsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygxKSxcbiAgICAgICAgbWF4VHRsOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgIGhlYWRlckJlaGF2aW9yOiBjbG91ZGZyb250LkNhY2hlSGVhZGVyQmVoYXZpb3Iubm9uZSgpLFxuICAgICAgICBxdWVyeVN0cmluZ0JlaGF2aW9yOiBjbG91ZGZyb250LkNhY2hlUXVlcnlTdHJpbmdCZWhhdmlvci5hbGwoKSxcbiAgICAgICAgY29va2llQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVDb29raWVCZWhhdmlvci5ub25lKCksXG4gICAgICAgIGVuYWJsZUFjY2VwdEVuY29kaW5nR3ppcDogdHJ1ZSxcbiAgICAgICAgZW5hYmxlQWNjZXB0RW5jb2RpbmdCcm90bGk6IHRydWUsXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBSZXNwb25zZSBIZWFkZXJzIFBvbGljeVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIGNvbnN0IHJlc3BvbnNlSGVhZGVyc1BvbGljeSA9IG5ldyBjbG91ZGZyb250LlJlc3BvbnNlSGVhZGVyc1BvbGljeShcbiAgICAgIHRoaXMsXG4gICAgICAnUmVzcG9uc2VIZWFkZXJzUG9saWN5JyxcbiAgICAgIHtcbiAgICAgICAgcmVzcG9uc2VIZWFkZXJzUG9saWN5TmFtZTogYFg0MDItUmVzcG9uc2VIZWFkZXJzLSR7c3VmZml4fWAsXG4gICAgICAgIGNvbW1lbnQ6ICdDT1JTIGFuZCB4NDAyIHBheW1lbnQgcmVzcG9uc2UgaGVhZGVycycsXG4gICAgICAgIGNvcnNCZWhhdmlvcjoge1xuICAgICAgICAgIGFjY2Vzc0NvbnRyb2xBbGxvd09yaWdpbnM6IFsnKiddLFxuICAgICAgICAgIGFjY2Vzc0NvbnRyb2xBbGxvd0hlYWRlcnM6IFtcbiAgICAgICAgICAgICdDb250ZW50LVR5cGUnLFxuICAgICAgICAgICAgJ1gtUGF5bWVudC1TaWduYXR1cmUnLFxuICAgICAgICAgICAgJ1BheW1lbnQtU2lnbmF0dXJlJyxcbiAgICAgICAgICAgICdBY2NlcHQnLFxuICAgICAgICAgICAgJ09yaWdpbicsXG4gICAgICAgICAgXSxcbiAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dNZXRob2RzOiBbJ0dFVCcsICdIRUFEJywgJ09QVElPTlMnXSxcbiAgICAgICAgICBhY2Nlc3NDb250cm9sRXhwb3NlSGVhZGVyczogW1xuICAgICAgICAgICAgJ1gtUEFZTUVOVC1SRVNQT05TRScsXG4gICAgICAgICAgICAnWC1QQVlNRU5ULVJFUVVJUkVEJyxcbiAgICAgICAgICAgICdYLVJlcXVlc3QtSWQnLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgYWNjZXNzQ29udHJvbEFsbG93Q3JlZGVudGlhbHM6IGZhbHNlLFxuICAgICAgICAgIGFjY2Vzc0NvbnRyb2xNYXhBZ2U6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgICBvcmlnaW5PdmVycmlkZTogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgLy8gU2VjdXJpdHkgaGVhZGVycyBmb3IgYmVzdCBwcmFjdGljZXNcbiAgICAgICAgc2VjdXJpdHlIZWFkZXJzQmVoYXZpb3I6IHtcbiAgICAgICAgICBjb250ZW50VHlwZU9wdGlvbnM6IHsgb3ZlcnJpZGU6IHRydWUgfSxcbiAgICAgICAgICBmcmFtZU9wdGlvbnM6IHtcbiAgICAgICAgICAgIGZyYW1lT3B0aW9uOiBjbG91ZGZyb250LkhlYWRlcnNGcmFtZU9wdGlvbi5ERU5ZLFxuICAgICAgICAgICAgb3ZlcnJpZGU6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgICByZWZlcnJlclBvbGljeToge1xuICAgICAgICAgICAgcmVmZXJyZXJQb2xpY3k6IGNsb3VkZnJvbnQuSGVhZGVyc1JlZmVycmVyUG9saWN5LlNUUklDVF9PUklHSU5fV0hFTl9DUk9TU19PUklHSU4sXG4gICAgICAgICAgICBvdmVycmlkZTogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHhzc1Byb3RlY3Rpb246IHtcbiAgICAgICAgICAgIHByb3RlY3Rpb246IHRydWUsXG4gICAgICAgICAgICBtb2RlQmxvY2s6IHRydWUsXG4gICAgICAgICAgICBvdmVycmlkZTogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICAvLyBDdXN0b20gaGVhZGVycyBmb3IgY2FjaGUgZGVidWdnaW5nXG4gICAgICAgIGN1c3RvbUhlYWRlcnNCZWhhdmlvcjoge1xuICAgICAgICAgIGN1c3RvbUhlYWRlcnM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaGVhZGVyOiAnWC1DYWNoZS1Qb2xpY3knLFxuICAgICAgICAgICAgICB2YWx1ZTogJ3g0MDItc2VsbGVyJyxcbiAgICAgICAgICAgICAgb3ZlcnJpZGU6IGZhbHNlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gTmF0aXZlIFdBRiB4NDAyIG1vbmV0aXphdGlvblxuICAgIC8vXG4gICAgLy8gUEFSS0lORyBMT1Q6IE1vbmV0aXphdGlvbkNvbmZpZyArIHBlci1ydWxlIE1vbmV0aXplIGFjdGlvbnMgYXJlIGFuIEFXUyBXQUZcbiAgICAvLyBwcmV2aWV3IGNhcGFiaWxpdHkgbm90IHlldCBpbiByZWxlYXNlZCBDbG91ZEZvcm1hdGlvbi9DREsuIFRoZSBXZWJBQ0wgYmVsb3dcbiAgICAvLyBzeW50aGVzaXplcyB0b2RheSB3aXRoIEJvdCBDb250cm9sIGRldGVjdGlvbiArIGFsbG93IHJ1bGVzOyB0aGUgbW9uZXRpemF0aW9uXG4gICAgLy8gZmllbGRzIGFyZSBpbmplY3RlZCB2aWEgTDEgYWRkUHJvcGVydHlPdmVycmlkZSBzbyB0aGV5IGRlcGxveSB2ZXJiYXRpbSBvbmNlXG4gICAgLy8gc3VwcG9ydCBzaGlwcy4gVW50aWwgdGhlbiB0aGV5IGFyZSBpbmVydC4gVHJhY2tpbmc6IHNlZSBQUiBkZXNjcmlwdGlvbi5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgcGF5VG8gPSBwcm9jZXNzLmVudi5QQVlNRU5UX1JFQ0lQSUVOVF9BRERSRVNTIHx8IERFRkFVTFRfUEFZX1RPO1xuICAgIGNvbnN0IHJ1bGVzID0gYnVpbGRXZWJBY2xSdWxlcygneDQwMnNlbGxlcicpO1xuXG4gICAgY29uc3Qgd2ViQWNsID0gbmV3IHdhZnYyLkNmbldlYkFDTCh0aGlzLCAnWDQwMldlYkFDTCcsIHtcbiAgICAgIG5hbWU6IGB4NDAyLXNlbGxlci1hY2wtJHtzdWZmaXh9YCxcbiAgICAgIHNjb3BlOiAnQ0xPVURGUk9OVCcsXG4gICAgICBkZWZhdWx0QWN0aW9uOiB7IGFsbG93OiB7fSB9LFxuICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgIG1ldHJpY05hbWU6IGB4NDAyLXNlbGxlci1hY2wtJHtzdWZmaXh9YCxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBUaGUgcnVsZSBhcnJheSBjYXJyaWVzIHRoZSBkZXRlY3Rpb24gKyBhbGxvdyBydWxlcyBhbmQgdGhlIHByZXZpZXcgTW9uZXRpemVcbiAgICAvLyBhY3Rpb25zIGluIHRoZSBXQUYgSlNPTiAoUGFzY2FsQ2FzZSkgY29udHJhY3QuIEl0IGlzIGluamVjdGVkIHZpYSBMMVxuICAgIC8vIGFkZFByb3BlcnR5T3ZlcnJpZGUgcmF0aGVyIHRoYW4gdGhlIHR5cGVkIGBydWxlc2AgcHJvcCBzbyB0aGUgcHJldmlld1xuICAgIC8vIGBNb25ldGl6ZWAgYWN0aW9uIHBhc3NlcyB0aHJvdWdoIENsb3VkRm9ybWF0aW9uIHZlcmJhdGltICh0aGUgcmVsZWFzZWQgQ0RLXG4gICAgLy8gUnVsZVByb3BlcnR5IHR5cGUgZG9lcyBub3QgeWV0IG1vZGVsIGl0KS5cbiAgICB3ZWJBY2wuYWRkUHJvcGVydHlPdmVycmlkZSgnUnVsZXMnLCBydWxlcyk7XG5cbiAgICAvLyBQQVJLSU5HIExPVDogaW5qZWN0IHRoZSBwcmV2aWV3IE1vbmV0aXphdGlvbkNvbmZpZyAocmVqZWN0ZWQgYnkgcmVsZWFzZWQgQ0ZOKS5cbiAgICB3ZWJBY2wuYWRkUHJvcGVydHlPdmVycmlkZSgnTW9uZXRpemF0aW9uQ29uZmlnJywgYnVpbGRNb25ldGl6YXRpb25Db25maWcocGF5VG8pKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDbG91ZEZyb250IERpc3RyaWJ1dGlvblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIENyZWF0ZSBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiB3aXRoIG9wdGltaXplZCBjYWNoaW5nXG4gICAgY29uc3QgZGlzdHJpYnV0aW9uID0gbmV3IGNsb3VkZnJvbnQuRGlzdHJpYnV0aW9uKHRoaXMsICdYNDAyRGlzdHJpYnV0aW9uJywge1xuICAgICAgY29tbWVudDogJ3g0MDIgUGF5bWVudC1Qcm90ZWN0ZWQgQ29udGVudCBEaXN0cmlidXRpb24nLFxuICAgICAgd2ViQWNsSWQ6IHdlYkFjbC5hdHRyQXJuLFxuICAgICAgZGVmYXVsdEJlaGF2aW9yOiB7XG4gICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4oY29udGVudEJ1Y2tldCksXG4gICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRF9PUFRJT05TLFxuICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQURfT1BUSU9OUyxcbiAgICAgICAgLy8gRGVmYXVsdCBiZWhhdmlvciBtdXN0IG5vdCBjYWNoZSDigJQgcGFpZCBjb250ZW50IGlzIHZlcmlmaWVkIHBlciByZXF1ZXN0LlxuICAgICAgICBjYWNoZVBvbGljeTogcGF5bWVudEFwaUNhY2hlUG9saWN5LFxuICAgICAgICByZXNwb25zZUhlYWRlcnNQb2xpY3k6IHJlc3BvbnNlSGVhZGVyc1BvbGljeSxcbiAgICAgICAgY29tcHJlc3M6IHRydWUsXG4gICAgICB9LFxuICAgICAgYWRkaXRpb25hbEJlaGF2aW9yczoge1xuICAgICAgICAvLyBNQ1AgZGlzY292ZXJ5IGVuZHBvaW50IC0gTk8gcGF5bWVudCByZXF1aXJlZCwgc2hvcnQgY2FjaGluZ1xuICAgICAgICAnL21jcC8qJzoge1xuICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4oY29udGVudEJ1Y2tldCksXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQURfT1BUSU9OUyxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQURfT1BUSU9OUyxcbiAgICAgICAgICBjYWNoZVBvbGljeTogcHVibGljQ29udGVudENhY2hlUG9saWN5LFxuICAgICAgICAgIHJlc3BvbnNlSGVhZGVyc1BvbGljeTogcmVzcG9uc2VIZWFkZXJzUG9saWN5LFxuICAgICAgICAgIGNvbXByZXNzOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXltZW50LXByb3RlY3RlZCBBUEkgZW5kcG9pbnRzIC0gTk8gY2FjaGluZ1xuICAgICAgICAnL2FwaS8qJzoge1xuICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4oY29udGVudEJ1Y2tldCksXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQURfT1BUSU9OUyxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQURfT1BUSU9OUyxcbiAgICAgICAgICBjYWNoZVBvbGljeTogcGF5bWVudEFwaUNhY2hlUG9saWN5LFxuICAgICAgICAgIHJlc3BvbnNlSGVhZGVyc1BvbGljeTogcmVzcG9uc2VIZWFkZXJzUG9saWN5LFxuICAgICAgICAgIGNvbXByZXNzOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICAvLyBTdGF0aWMgYXNzZXRzIC0gYWdncmVzc2l2ZSBjYWNoaW5nXG4gICAgICAgICcvc3RhdGljLyonOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IHN0YXRpY0Fzc2V0c0NhY2hlUG9saWN5LFxuICAgICAgICAgIHJlc3BvbnNlSGVhZGVyc1BvbGljeTogcmVzcG9uc2VIZWFkZXJzUG9saWN5LFxuICAgICAgICAgIGNvbXByZXNzOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICAvLyBJbWFnZXMgLSBhZ2dyZXNzaXZlIGNhY2hpbmdcbiAgICAgICAgJyouanBnJzoge1xuICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4oY29udGVudEJ1Y2tldCksXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVkTWV0aG9kczogY2xvdWRmcm9udC5DYWNoZWRNZXRob2RzLkNBQ0hFX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBzdGF0aWNBc3NldHNDYWNoZVBvbGljeSxcbiAgICAgICAgICBjb21wcmVzczogZmFsc2UsIC8vIEltYWdlcyBhcmUgYWxyZWFkeSBjb21wcmVzc2VkXG4gICAgICAgIH0sXG4gICAgICAgICcqLnBuZyc6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKGNvbnRlbnRCdWNrZXQpLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZVBvbGljeTogc3RhdGljQXNzZXRzQ2FjaGVQb2xpY3ksXG4gICAgICAgICAgY29tcHJlc3M6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICAnKi5zdmcnOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IHN0YXRpY0Fzc2V0c0NhY2hlUG9saWN5LFxuICAgICAgICAgIGNvbXByZXNzOiB0cnVlLCAvLyBTVkdzIGJlbmVmaXQgZnJvbSBjb21wcmVzc2lvblxuICAgICAgICB9LFxuICAgICAgICAvLyBDU1MgYW5kIEpTIC0gYWdncmVzc2l2ZSBjYWNoaW5nXG4gICAgICAgICcqLmNzcyc6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKGNvbnRlbnRCdWNrZXQpLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZVBvbGljeTogc3RhdGljQXNzZXRzQ2FjaGVQb2xpY3ksXG4gICAgICAgICAgY29tcHJlc3M6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgICcqLmpzJzoge1xuICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4oY29udGVudEJ1Y2tldCksXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVkTWV0aG9kczogY2xvdWRmcm9udC5DYWNoZWRNZXRob2RzLkNBQ0hFX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBzdGF0aWNBc3NldHNDYWNoZVBvbGljeSxcbiAgICAgICAgICBjb21wcmVzczogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgLy8gRm9udHMgLSBhZ2dyZXNzaXZlIGNhY2hpbmdcbiAgICAgICAgJyoud29mZjInOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IHN0YXRpY0Fzc2V0c0NhY2hlUG9saWN5LFxuICAgICAgICAgIGNvbXByZXNzOiBmYWxzZSwgLy8gRm9udHMgYXJlIGFscmVhZHkgY29tcHJlc3NlZFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIC8vIEVuYWJsZSBIVFRQLzIgYW5kIEhUVFAvMyBmb3IgYmV0dGVyIHBlcmZvcm1hbmNlXG4gICAgICBodHRwVmVyc2lvbjogY2xvdWRmcm9udC5IdHRwVmVyc2lvbi5IVFRQMl9BTkRfMyxcbiAgICAgIC8vIFByaWNlIGNsYXNzIC0gdXNlIGFsbCBlZGdlIGxvY2F0aW9ucyBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgICAgcHJpY2VDbGFzczogY2xvdWRmcm9udC5QcmljZUNsYXNzLlBSSUNFX0NMQVNTX0FMTCxcbiAgICAgIC8vIExvZ2dpbmcgZGlzYWJsZWQgZm9yIGRlbW8gc2ltcGxpY2l0eVxuICAgICAgLy8gQ2xvdWRGcm9udCBzdGFuZGFyZCBsb2dnaW5nIHJlcXVpcmVzIEFDTC1lbmFibGVkIGJ1Y2tldHNcbiAgICAgIGVuYWJsZUxvZ2dpbmc6IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE91dHB1dHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGlzdHJpYnV0aW9uRG9tYWluTmFtZScsIHtcbiAgICAgIHZhbHVlOiBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRGcm9udCBEaXN0cmlidXRpb24gRG9tYWluIE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJEaXN0cmlidXRpb25Eb21haW4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Rpc3RyaWJ1dGlvblVybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke2Rpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkRnJvbnQgRGlzdHJpYnV0aW9uIFVSTCcsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMkRpc3RyaWJ1dGlvblVybCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGlzdHJpYnV0aW9uSWQnLCB7XG4gICAgICB2YWx1ZTogZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbklkLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZEZyb250IERpc3RyaWJ1dGlvbiBJRCAoZm9yIGNhY2hlIGludmFsaWRhdGlvbiknLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJEaXN0cmlidXRpb25JZCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ29udGVudEJ1Y2tldE5hbWUnLCB7XG4gICAgICB2YWx1ZTogY29udGVudEJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdTMyBDb250ZW50IEJ1Y2tldCBOYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyQ29udGVudEJ1Y2tldCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUGF5bWVudEFwaUVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7ZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWV9L2FwaS9gLFxuICAgICAgZGVzY3JpcHRpb246ICdQYXltZW50LXByb3RlY3RlZCBBUEkgZW5kcG9pbnQgKHJlcXVpcmVzIHg0MDIgcGF5bWVudCknLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXltZW50QXBpRW5kcG9pbnQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NhY2hlUG9saWN5U3VtbWFyeScsIHtcbiAgICAgIHZhbHVlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHBheW1lbnRBcGk6ICdObyBjYWNoaW5nIChUVEw9MCkgLSBlYWNoIHJlcXVlc3QgcmVxdWlyZXMgcGF5bWVudCB2ZXJpZmljYXRpb24nLFxuICAgICAgICBzdGF0aWNBc3NldHM6ICdMb25nLXRlcm0gY2FjaGluZyAoZGVmYXVsdCAxIGRheSwgbWF4IDEgeWVhciknLFxuICAgICAgICBwdWJsaWNDb250ZW50OiAnU2hvcnQtdGVybSBjYWNoaW5nIChkZWZhdWx0IDUgbWluLCBtYXggMSBob3VyKScsXG4gICAgICB9KSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3VtbWFyeSBvZiBjYWNoaW5nIHBvbGljaWVzIGFwcGxpZWQgdG8gZGlmZmVyZW50IGNvbnRlbnQgdHlwZXMnLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQ0RLIE5hZyBTdXBwcmVzc2lvbnNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoY29udGVudEJ1Y2tldCwgW1xuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1TMScsIHJlYXNvbjogJ0RlbW8gcHJvamVjdCDigJQgYWNjZXNzIGxvZ3Mgbm90IHJlcXVpcmVkIGZvciB0ZXN0bmV0IGNvbnRlbnQgYnVja2V0JyB9LFxuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1TMTAnLCByZWFzb246ICdCdWNrZXQgaXMgb25seSBhY2Nlc3NlZCB2aWEgQ2xvdWRGcm9udCBPQUksIG5vdCBkaXJlY3RseSBvdmVyIHRoZSBpbnRlcm5ldCcgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhkaXN0cmlidXRpb24sIFtcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtQ0ZSMScsIHJlYXNvbjogJ0RlbW8gcHJvamVjdCDigJQgZ2VvIHJlc3RyaWN0aW9ucyBub3QgbmVlZGVkIGZvciB0ZXN0bmV0IGRlbW8nIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUNGUjMnLCByZWFzb246ICdEZW1vIHByb2plY3Qg4oCUIENsb3VkRnJvbnQgYWNjZXNzIGxvZ2dpbmcgbm90IHJlcXVpcmVkJyB9LFxuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1DRlI0JywgcmVhc29uOiAnVXNpbmcgZGVmYXVsdCBDbG91ZEZyb250IHZpZXdlciBjZXJ0aWZpY2F0ZSB3aGljaCByZXF1aXJlcyBkZWZhdWx0IFNTTCBwb2xpY3knIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUNGUjcnLCByZWFzb246ICdVc2luZyBsZWdhY3kgUzNPcmlnaW4gd2l0aCBPQUkg4oCUIG1pZ3JhdGlvbiB0byBTM0J1Y2tldE9yaWdpbiB3aXRoIE9BQyBpcyBhIGZ1dHVyZSBpbXByb3ZlbWVudCcgfSxcbiAgICBdKTtcbiAgfVxufVxuIl19