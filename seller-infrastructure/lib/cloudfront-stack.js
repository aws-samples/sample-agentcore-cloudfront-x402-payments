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
            // L1 rules carry the detection + allow + (override-injected) Monetize rules.
            rules: rules,
        });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWRmcm9udC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNsb3VkZnJvbnQtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHVFQUF5RDtBQUN6RCw0RUFBOEQ7QUFDOUQsdURBQXlDO0FBQ3pDLDZEQUErQztBQUUvQyxxQ0FBMEM7QUFDMUMsK0NBQWlDO0FBQ2pDLDJDQUE2QjtBQUM3QixtRUFHbUM7QUFFbkMseUVBQXlFO0FBQ3pFLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUU1RCxNQUFNLGNBQWMsR0FBRyw0Q0FBNEMsQ0FBQztBQUVwRSxNQUFhLGVBQWdCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDNUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixnRUFBZ0U7UUFDaEUsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFbEQsaURBQWlEO1FBQ2pELE1BQU0sYUFBYSxHQUFHLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3pELGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87WUFDeEMsaUJBQWlCLEVBQUUsSUFBSTtZQUN2QixJQUFJLEVBQUU7Z0JBQ0o7b0JBQ0UsY0FBYyxFQUFFLENBQUMsRUFBRSxDQUFDLFdBQVcsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7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QUUsd0JBQXdCO1NBQ3JDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDNUMsS0FBSyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ3BCLFVBQVUsRUFBRSxpRUFBaUU7Z0JBQzdFLFlBQVksRUFBRSwrQ0FBK0M7Z0JBQzdELGFBQWEsRUFBRSxnREFBZ0Q7YUFDaEUsQ0FBQztZQUNGLFdBQVcsRUFBRSxnRUFBZ0U7U0FDOUUsQ0FBQyxDQUFDO1FBRUgsNkNBQTZDO1FBQzdDLHVCQUF1QjtRQUN2Qiw2Q0FBNkM7UUFDN0MseUJBQWUsQ0FBQyx1QkFBdUIsQ0FBQyxhQUFhLEVBQUU7WUFDckQsRUFBRSxFQUFFLEVBQUUsaUJBQWlCLEVBQUUsTUFBTSxFQUFFLG9FQUFvRSxFQUFFO1lBQ3ZHLEVBQUUsRUFBRSxFQUFFLGtCQUFrQixFQUFFLE1BQU0sRUFBRSw0RUFBNEUsRUFBRTtTQUNqSCxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRVQseUJBQWUsQ0FBQyx1QkFBdUIsQ0FBQyxZQUFZLEVBQUU7WUFDcEQsRUFBRSxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLDZEQUE2RCxFQUFFO1lBQ2xHLEVBQUUsRUFBRSxFQUFFLG1CQUFtQixFQUFFLE1BQU0sRUFBRSx1REFBdUQsRUFBRTtZQUM1RixFQUFFLEVBQUUsRUFBRSxtQkFBbUIsRUFBRSxNQUFNLEVBQUUsK0VBQStFLEVBQUU7WUFDcEgsRUFBRSxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLCtGQUErRixFQUFFO1NBQ3JJLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQS9VRCwwQ0ErVUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgY2xvdWRmcm9udCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udCc7XG5pbXBvcnQgKiBhcyBvcmlnaW5zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250LW9yaWdpbnMnO1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCAqIGFzIHdhZnYyIGZyb20gJ2F3cy1jZGstbGliL2F3cy13YWZ2Mic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuaW1wb3J0ICogYXMgZG90ZW52IGZyb20gJ2RvdGVudic7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHtcbiAgYnVpbGRNb25ldGl6YXRpb25Db25maWcsXG4gIGJ1aWxkV2ViQWNsUnVsZXMsXG59IGZyb20gJy4vd2FmL21vbmV0aXphdGlvbi1jb25maWcnO1xuXG4vLyBMb2FkIC5lbnYgZnJvbSBwcm9qZWN0IHJvb3QgKFBBWU1FTlRfUkVDSVBJRU5UX0FERFJFU1MgPSBwYXllZSB3YWxsZXQpXG5kb3RlbnYuY29uZmlnKHsgcGF0aDogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy5lbnYnKSB9KTtcblxuY29uc3QgREVGQVVMVF9QQVlfVE8gPSAnMHgyNDg0MkYzMTM2RmEyYTNkZjgzNWQzNmI0YzNjYjQ5NzJkNDA1NTAyJztcblxuZXhwb3J0IGNsYXNzIFg0MDJTZWxsZXJTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIFVuaXF1ZSBzdWZmaXggZm9yIHBvbGljeSBuYW1lcyB0byBhdm9pZCBjb25mbGljdHMgb24gcmVkZXBsb3lcbiAgICBjb25zdCBzdWZmaXggPSBjZGsuTmFtZXMudW5pcXVlSWQodGhpcykuc2xpY2UoLTgpO1xuXG4gICAgLy8gQ3JlYXRlIFMzIGJ1Y2tldCBmb3Igc3RhdGljIGNvbnRlbnQgKG9wdGlvbmFsKVxuICAgIGNvbnN0IGNvbnRlbnRCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdDb250ZW50QnVja2V0Jywge1xuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlLFxuICAgICAgY29yczogW1xuICAgICAgICB7XG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IFtzMy5IdHRwTWV0aG9kcy5HRVQsIHMzLkh0dHBNZXRob2RzLkhFQURdLFxuICAgICAgICAgIGFsbG93ZWRPcmlnaW5zOiBbJyonXSxcbiAgICAgICAgICBhbGxvd2VkSGVhZGVyczogWycqJ10sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENhY2hpbmcgUG9saWNpZXNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBDYWNoZSBwb2xpY3kgZm9yIHBheW1lbnQtcHJvdGVjdGVkIEFQSSBlbmRwb2ludHNcbiAgICAvLyBEaXNhYmxlZCAtIGVhY2ggcmVxdWVzdCByZXF1aXJlcyB1bmlxdWUgcGF5bWVudCB2ZXJpZmljYXRpb25cbiAgICBjb25zdCBwYXltZW50QXBpQ2FjaGVQb2xpY3kgPSBuZXcgY2xvdWRmcm9udC5DYWNoZVBvbGljeShcbiAgICAgIHRoaXMsXG4gICAgICAnUGF5bWVudEFwaUNhY2hlUG9saWN5JyxcbiAgICAgIHtcbiAgICAgICAgY2FjaGVQb2xpY3lOYW1lOiBgWDQwMi1QYXltZW50QXBpLU5vQ2FjaGUtJHtzdWZmaXh9YCxcbiAgICAgICAgY29tbWVudDogJ05vIGNhY2hpbmcgZm9yIHg0MDIgcGF5bWVudC1wcm90ZWN0ZWQgZW5kcG9pbnRzJyxcbiAgICAgICAgZGVmYXVsdFR0bDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMCksXG4gICAgICAgIG1pblR0bDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMCksXG4gICAgICAgIG1heFR0bDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMCksXG4gICAgICAgIC8vIE5vdGU6IGhlYWRlckJlaGF2aW9yIGNhbm5vdCBiZSBzZXQgd2hlbiBjYWNoaW5nIGlzIGRpc2FibGVkIChUVEw9MClcbiAgICAgICAgLy8gUGF5bWVudCBoZWFkZXJzIGFyZSBmb3J3YXJkZWQgdmlhIHRoZSBvcmlnaW4gcmVxdWVzdCBwb2xpY3kgaW5zdGVhZFxuICAgICAgICBxdWVyeVN0cmluZ0JlaGF2aW9yOiBjbG91ZGZyb250LkNhY2hlUXVlcnlTdHJpbmdCZWhhdmlvci5ub25lKCksXG4gICAgICAgIGNvb2tpZUJlaGF2aW9yOiBjbG91ZGZyb250LkNhY2hlQ29va2llQmVoYXZpb3Iubm9uZSgpLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBDYWNoZSBwb2xpY3kgZm9yIHN0YXRpYyBhc3NldHMgKGltYWdlcywgQ1NTLCBKUywgZm9udHMpXG4gICAgLy8gVGhlc2UgZG9uJ3QgcmVxdWlyZSBwYXltZW50IGFuZCBjYW4gYmUgY2FjaGVkIGFnZ3Jlc3NpdmVseVxuICAgIGNvbnN0IHN0YXRpY0Fzc2V0c0NhY2hlUG9saWN5ID0gbmV3IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3koXG4gICAgICB0aGlzLFxuICAgICAgJ1N0YXRpY0Fzc2V0c0NhY2hlUG9saWN5JyxcbiAgICAgIHtcbiAgICAgICAgY2FjaGVQb2xpY3lOYW1lOiBgWDQwMi1TdGF0aWNBc3NldHMtTG9uZ0NhY2hlLSR7c3VmZml4fWAsXG4gICAgICAgIGNvbW1lbnQ6ICdMb25nLXRlcm0gY2FjaGluZyBmb3Igc3RhdGljIGFzc2V0cyB0aGF0IGRvIG5vdCByZXF1aXJlIHBheW1lbnQnLFxuICAgICAgICBkZWZhdWx0VHRsOiBjZGsuRHVyYXRpb24uZGF5cygxKSxcbiAgICAgICAgbWluVHRsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygxKSxcbiAgICAgICAgbWF4VHRsOiBjZGsuRHVyYXRpb24uZGF5cygzNjUpLFxuICAgICAgICBoZWFkZXJCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZUhlYWRlckJlaGF2aW9yLm5vbmUoKSxcbiAgICAgICAgcXVlcnlTdHJpbmdCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZVF1ZXJ5U3RyaW5nQmVoYXZpb3Iubm9uZSgpLFxuICAgICAgICBjb29raWVCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZUNvb2tpZUJlaGF2aW9yLm5vbmUoKSxcbiAgICAgICAgZW5hYmxlQWNjZXB0RW5jb2RpbmdHemlwOiB0cnVlLFxuICAgICAgICBlbmFibGVBY2NlcHRFbmNvZGluZ0Jyb3RsaTogdHJ1ZSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gQ2FjaGUgcG9saWN5IGZvciBwdWJsaWMgY29udGVudCAobm9uLXBheW1lbnQtcHJvdGVjdGVkIHBhZ2VzKVxuICAgIC8vIFNob3J0IFRUTCB0byBiYWxhbmNlIGZyZXNobmVzcyB3aXRoIHBlcmZvcm1hbmNlXG4gICAgY29uc3QgcHVibGljQ29udGVudENhY2hlUG9saWN5ID0gbmV3IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3koXG4gICAgICB0aGlzLFxuICAgICAgJ1B1YmxpY0NvbnRlbnRDYWNoZVBvbGljeScsXG4gICAgICB7XG4gICAgICAgIGNhY2hlUG9saWN5TmFtZTogYFg0MDItUHVibGljQ29udGVudC1TaG9ydENhY2hlLSR7c3VmZml4fWAsXG4gICAgICAgIGNvbW1lbnQ6ICdTaG9ydC10ZXJtIGNhY2hpbmcgZm9yIHB1YmxpYyBjb250ZW50IHBhZ2VzJyxcbiAgICAgICAgZGVmYXVsdFR0bDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIG1pblR0bDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMSksXG4gICAgICAgIG1heFR0bDogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICBoZWFkZXJCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZUhlYWRlckJlaGF2aW9yLm5vbmUoKSxcbiAgICAgICAgcXVlcnlTdHJpbmdCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZVF1ZXJ5U3RyaW5nQmVoYXZpb3IuYWxsKCksXG4gICAgICAgIGNvb2tpZUJlaGF2aW9yOiBjbG91ZGZyb250LkNhY2hlQ29va2llQmVoYXZpb3Iubm9uZSgpLFxuICAgICAgICBlbmFibGVBY2NlcHRFbmNvZGluZ0d6aXA6IHRydWUsXG4gICAgICAgIGVuYWJsZUFjY2VwdEVuY29kaW5nQnJvdGxpOiB0cnVlLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gUmVzcG9uc2UgSGVhZGVycyBQb2xpY3lcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCByZXNwb25zZUhlYWRlcnNQb2xpY3kgPSBuZXcgY2xvdWRmcm9udC5SZXNwb25zZUhlYWRlcnNQb2xpY3koXG4gICAgICB0aGlzLFxuICAgICAgJ1Jlc3BvbnNlSGVhZGVyc1BvbGljeScsXG4gICAgICB7XG4gICAgICAgIHJlc3BvbnNlSGVhZGVyc1BvbGljeU5hbWU6IGBYNDAyLVJlc3BvbnNlSGVhZGVycy0ke3N1ZmZpeH1gLFxuICAgICAgICBjb21tZW50OiAnQ09SUyBhbmQgeDQwMiBwYXltZW50IHJlc3BvbnNlIGhlYWRlcnMnLFxuICAgICAgICBjb3JzQmVoYXZpb3I6IHtcbiAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dPcmlnaW5zOiBbJyonXSxcbiAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dIZWFkZXJzOiBbXG4gICAgICAgICAgICAnQ29udGVudC1UeXBlJyxcbiAgICAgICAgICAgICdYLVBheW1lbnQtU2lnbmF0dXJlJyxcbiAgICAgICAgICAgICdQYXltZW50LVNpZ25hdHVyZScsXG4gICAgICAgICAgICAnQWNjZXB0JyxcbiAgICAgICAgICAgICdPcmlnaW4nLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgYWNjZXNzQ29udHJvbEFsbG93TWV0aG9kczogWydHRVQnLCAnSEVBRCcsICdPUFRJT05TJ10sXG4gICAgICAgICAgYWNjZXNzQ29udHJvbEV4cG9zZUhlYWRlcnM6IFtcbiAgICAgICAgICAgICdYLVBBWU1FTlQtUkVTUE9OU0UnLFxuICAgICAgICAgICAgJ1gtUEFZTUVOVC1SRVFVSVJFRCcsXG4gICAgICAgICAgICAnWC1SZXF1ZXN0LUlkJyxcbiAgICAgICAgICBdLFxuICAgICAgICAgIGFjY2Vzc0NvbnRyb2xBbGxvd0NyZWRlbnRpYWxzOiBmYWxzZSxcbiAgICAgICAgICBhY2Nlc3NDb250cm9sTWF4QWdlOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgb3JpZ2luT3ZlcnJpZGU6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFNlY3VyaXR5IGhlYWRlcnMgZm9yIGJlc3QgcHJhY3RpY2VzXG4gICAgICAgIHNlY3VyaXR5SGVhZGVyc0JlaGF2aW9yOiB7XG4gICAgICAgICAgY29udGVudFR5cGVPcHRpb25zOiB7IG92ZXJyaWRlOiB0cnVlIH0sXG4gICAgICAgICAgZnJhbWVPcHRpb25zOiB7XG4gICAgICAgICAgICBmcmFtZU9wdGlvbjogY2xvdWRmcm9udC5IZWFkZXJzRnJhbWVPcHRpb24uREVOWSxcbiAgICAgICAgICAgIG92ZXJyaWRlOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcmVmZXJyZXJQb2xpY3k6IHtcbiAgICAgICAgICAgIHJlZmVycmVyUG9saWN5OiBjbG91ZGZyb250LkhlYWRlcnNSZWZlcnJlclBvbGljeS5TVFJJQ1RfT1JJR0lOX1dIRU5fQ1JPU1NfT1JJR0lOLFxuICAgICAgICAgICAgb3ZlcnJpZGU6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB4c3NQcm90ZWN0aW9uOiB7XG4gICAgICAgICAgICBwcm90ZWN0aW9uOiB0cnVlLFxuICAgICAgICAgICAgbW9kZUJsb2NrOiB0cnVlLFxuICAgICAgICAgICAgb3ZlcnJpZGU6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgLy8gQ3VzdG9tIGhlYWRlcnMgZm9yIGNhY2hlIGRlYnVnZ2luZ1xuICAgICAgICBjdXN0b21IZWFkZXJzQmVoYXZpb3I6IHtcbiAgICAgICAgICBjdXN0b21IZWFkZXJzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGhlYWRlcjogJ1gtQ2FjaGUtUG9saWN5JyxcbiAgICAgICAgICAgICAgdmFsdWU6ICd4NDAyLXNlbGxlcicsXG4gICAgICAgICAgICAgIG92ZXJyaWRlOiBmYWxzZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE5hdGl2ZSBXQUYgeDQwMiBtb25ldGl6YXRpb25cbiAgICAvL1xuICAgIC8vIFBBUktJTkcgTE9UOiBNb25ldGl6YXRpb25Db25maWcgKyBwZXItcnVsZSBNb25ldGl6ZSBhY3Rpb25zIGFyZSBhbiBBV1MgV0FGXG4gICAgLy8gcHJldmlldyBjYXBhYmlsaXR5IG5vdCB5ZXQgaW4gcmVsZWFzZWQgQ2xvdWRGb3JtYXRpb24vQ0RLLiBUaGUgV2ViQUNMIGJlbG93XG4gICAgLy8gc3ludGhlc2l6ZXMgdG9kYXkgd2l0aCBCb3QgQ29udHJvbCBkZXRlY3Rpb24gKyBhbGxvdyBydWxlczsgdGhlIG1vbmV0aXphdGlvblxuICAgIC8vIGZpZWxkcyBhcmUgaW5qZWN0ZWQgdmlhIEwxIGFkZFByb3BlcnR5T3ZlcnJpZGUgc28gdGhleSBkZXBsb3kgdmVyYmF0aW0gb25jZVxuICAgIC8vIHN1cHBvcnQgc2hpcHMuIFVudGlsIHRoZW4gdGhleSBhcmUgaW5lcnQuIFRyYWNraW5nOiBzZWUgUFIgZGVzY3JpcHRpb24uXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IHBheVRvID0gcHJvY2Vzcy5lbnYuUEFZTUVOVF9SRUNJUElFTlRfQUREUkVTUyB8fCBERUZBVUxUX1BBWV9UTztcbiAgICBjb25zdCBydWxlcyA9IGJ1aWxkV2ViQWNsUnVsZXMoJ3g0MDJzZWxsZXInKTtcblxuICAgIGNvbnN0IHdlYkFjbCA9IG5ldyB3YWZ2Mi5DZm5XZWJBQ0wodGhpcywgJ1g0MDJXZWJBQ0wnLCB7XG4gICAgICBuYW1lOiBgeDQwMi1zZWxsZXItYWNsLSR7c3VmZml4fWAsXG4gICAgICBzY29wZTogJ0NMT1VERlJPTlQnLFxuICAgICAgZGVmYXVsdEFjdGlvbjogeyBhbGxvdzoge30gfSxcbiAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICBtZXRyaWNOYW1lOiBgeDQwMi1zZWxsZXItYWNsLSR7c3VmZml4fWAsXG4gICAgICB9LFxuICAgICAgLy8gTDEgcnVsZXMgY2FycnkgdGhlIGRldGVjdGlvbiArIGFsbG93ICsgKG92ZXJyaWRlLWluamVjdGVkKSBNb25ldGl6ZSBydWxlcy5cbiAgICAgIHJ1bGVzOiBydWxlcyBhcyB1bmtub3duIGFzIHdhZnYyLkNmbldlYkFDTC5SdWxlUHJvcGVydHlbXSxcbiAgICB9KTtcblxuICAgIC8vIFBBUktJTkcgTE9UOiBpbmplY3QgdGhlIHByZXZpZXcgTW9uZXRpemF0aW9uQ29uZmlnIChyZWplY3RlZCBieSByZWxlYXNlZCBDRk4pLlxuICAgIHdlYkFjbC5hZGRQcm9wZXJ0eU92ZXJyaWRlKCdNb25ldGl6YXRpb25Db25maWcnLCBidWlsZE1vbmV0aXphdGlvbkNvbmZpZyhwYXlUbykpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENsb3VkRnJvbnQgRGlzdHJpYnV0aW9uXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ3JlYXRlIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIHdpdGggb3B0aW1pemVkIGNhY2hpbmdcbiAgICBjb25zdCBkaXN0cmlidXRpb24gPSBuZXcgY2xvdWRmcm9udC5EaXN0cmlidXRpb24odGhpcywgJ1g0MDJEaXN0cmlidXRpb24nLCB7XG4gICAgICBjb21tZW50OiAneDQwMiBQYXltZW50LVByb3RlY3RlZCBDb250ZW50IERpc3RyaWJ1dGlvbicsXG4gICAgICB3ZWJBY2xJZDogd2ViQWNsLmF0dHJBcm4sXG4gICAgICBkZWZhdWx0QmVoYXZpb3I6IHtcbiAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRF9PUFRJT05TLFxuICAgICAgICAvLyBEZWZhdWx0IGJlaGF2aW9yIG11c3Qgbm90IGNhY2hlIOKAlCBwYWlkIGNvbnRlbnQgaXMgdmVyaWZpZWQgcGVyIHJlcXVlc3QuXG4gICAgICAgIGNhY2hlUG9saWN5OiBwYXltZW50QXBpQ2FjaGVQb2xpY3ksXG4gICAgICAgIHJlc3BvbnNlSGVhZGVyc1BvbGljeTogcmVzcG9uc2VIZWFkZXJzUG9saWN5LFxuICAgICAgICBjb21wcmVzczogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBhZGRpdGlvbmFsQmVoYXZpb3JzOiB7XG4gICAgICAgIC8vIE1DUCBkaXNjb3ZlcnkgZW5kcG9pbnQgLSBOTyBwYXltZW50IHJlcXVpcmVkLCBzaG9ydCBjYWNoaW5nXG4gICAgICAgICcvbWNwLyonOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRF9PUFRJT05TLFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRF9PUFRJT05TLFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBwdWJsaWNDb250ZW50Q2FjaGVQb2xpY3ksXG4gICAgICAgICAgcmVzcG9uc2VIZWFkZXJzUG9saWN5OiByZXNwb25zZUhlYWRlcnNQb2xpY3ksXG4gICAgICAgICAgY29tcHJlc3M6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBheW1lbnQtcHJvdGVjdGVkIEFQSSBlbmRwb2ludHMgLSBOTyBjYWNoaW5nXG4gICAgICAgICcvYXBpLyonOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRF9PUFRJT05TLFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRF9PUFRJT05TLFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBwYXltZW50QXBpQ2FjaGVQb2xpY3ksXG4gICAgICAgICAgcmVzcG9uc2VIZWFkZXJzUG9saWN5OiByZXNwb25zZUhlYWRlcnNQb2xpY3ksXG4gICAgICAgICAgY29tcHJlc3M6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFN0YXRpYyBhc3NldHMgLSBhZ2dyZXNzaXZlIGNhY2hpbmdcbiAgICAgICAgJy9zdGF0aWMvKic6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKGNvbnRlbnRCdWNrZXQpLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZVBvbGljeTogc3RhdGljQXNzZXRzQ2FjaGVQb2xpY3ksXG4gICAgICAgICAgcmVzcG9uc2VIZWFkZXJzUG9saWN5OiByZXNwb25zZUhlYWRlcnNQb2xpY3ksXG4gICAgICAgICAgY29tcHJlc3M6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIC8vIEltYWdlcyAtIGFnZ3Jlc3NpdmUgY2FjaGluZ1xuICAgICAgICAnKi5qcGcnOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IHN0YXRpY0Fzc2V0c0NhY2hlUG9saWN5LFxuICAgICAgICAgIGNvbXByZXNzOiBmYWxzZSwgLy8gSW1hZ2VzIGFyZSBhbHJlYWR5IGNvbXByZXNzZWRcbiAgICAgICAgfSxcbiAgICAgICAgJyoucG5nJzoge1xuICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4oY29udGVudEJ1Y2tldCksXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVkTWV0aG9kczogY2xvdWRmcm9udC5DYWNoZWRNZXRob2RzLkNBQ0hFX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBzdGF0aWNBc3NldHNDYWNoZVBvbGljeSxcbiAgICAgICAgICBjb21wcmVzczogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgICcqLnN2Zyc6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKGNvbnRlbnRCdWNrZXQpLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZVBvbGljeTogc3RhdGljQXNzZXRzQ2FjaGVQb2xpY3ksXG4gICAgICAgICAgY29tcHJlc3M6IHRydWUsIC8vIFNWR3MgYmVuZWZpdCBmcm9tIGNvbXByZXNzaW9uXG4gICAgICAgIH0sXG4gICAgICAgIC8vIENTUyBhbmQgSlMgLSBhZ2dyZXNzaXZlIGNhY2hpbmdcbiAgICAgICAgJyouY3NzJzoge1xuICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4oY29udGVudEJ1Y2tldCksXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVkTWV0aG9kczogY2xvdWRmcm9udC5DYWNoZWRNZXRob2RzLkNBQ0hFX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBzdGF0aWNBc3NldHNDYWNoZVBvbGljeSxcbiAgICAgICAgICBjb21wcmVzczogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgJyouanMnOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IHN0YXRpY0Fzc2V0c0NhY2hlUG9saWN5LFxuICAgICAgICAgIGNvbXByZXNzOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICAvLyBGb250cyAtIGFnZ3Jlc3NpdmUgY2FjaGluZ1xuICAgICAgICAnKi53b2ZmMic6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKGNvbnRlbnRCdWNrZXQpLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZVBvbGljeTogc3RhdGljQXNzZXRzQ2FjaGVQb2xpY3ksXG4gICAgICAgICAgY29tcHJlc3M6IGZhbHNlLCAvLyBGb250cyBhcmUgYWxyZWFkeSBjb21wcmVzc2VkXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgLy8gRW5hYmxlIEhUVFAvMiBhbmQgSFRUUC8zIGZvciBiZXR0ZXIgcGVyZm9ybWFuY2VcbiAgICAgIGh0dHBWZXJzaW9uOiBjbG91ZGZyb250Lkh0dHBWZXJzaW9uLkhUVFAyX0FORF8zLFxuICAgICAgLy8gUHJpY2UgY2xhc3MgLSB1c2UgYWxsIGVkZ2UgbG9jYXRpb25zIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgICBwcmljZUNsYXNzOiBjbG91ZGZyb250LlByaWNlQ2xhc3MuUFJJQ0VfQ0xBU1NfQUxMLFxuICAgICAgLy8gTG9nZ2luZyBkaXNhYmxlZCBmb3IgZGVtbyBzaW1wbGljaXR5XG4gICAgICAvLyBDbG91ZEZyb250IHN0YW5kYXJkIGxvZ2dpbmcgcmVxdWlyZXMgQUNMLWVuYWJsZWQgYnVja2V0c1xuICAgICAgZW5hYmxlTG9nZ2luZzogZmFsc2UsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gT3V0cHV0c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEaXN0cmlidXRpb25Eb21haW5OYW1lJywge1xuICAgICAgdmFsdWU6IGRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZEZyb250IERpc3RyaWJ1dGlvbiBEb21haW4gTmFtZScsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMkRpc3RyaWJ1dGlvbkRvbWFpbicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGlzdHJpYnV0aW9uVXJsJywge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7ZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRGcm9udCBEaXN0cmlidXRpb24gVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyRGlzdHJpYnV0aW9uVXJsJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEaXN0cmlidXRpb25JZCcsIHtcbiAgICAgIHZhbHVlOiBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkRnJvbnQgRGlzdHJpYnV0aW9uIElEIChmb3IgY2FjaGUgaW52YWxpZGF0aW9uKScsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMkRpc3RyaWJ1dGlvbklkJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDb250ZW50QnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiBjb250ZW50QnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIENvbnRlbnQgQnVja2V0IE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJDb250ZW50QnVja2V0JyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQYXltZW50QXBpRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHtkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZX0vYXBpL2AsXG4gICAgICBkZXNjcmlwdGlvbjogJ1BheW1lbnQtcHJvdGVjdGVkIEFQSSBlbmRwb2ludCAocmVxdWlyZXMgeDQwMiBwYXltZW50KScsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheW1lbnRBcGlFbmRwb2ludCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2FjaGVQb2xpY3lTdW1tYXJ5Jywge1xuICAgICAgdmFsdWU6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcGF5bWVudEFwaTogJ05vIGNhY2hpbmcgKFRUTD0wKSAtIGVhY2ggcmVxdWVzdCByZXF1aXJlcyBwYXltZW50IHZlcmlmaWNhdGlvbicsXG4gICAgICAgIHN0YXRpY0Fzc2V0czogJ0xvbmctdGVybSBjYWNoaW5nIChkZWZhdWx0IDEgZGF5LCBtYXggMSB5ZWFyKScsXG4gICAgICAgIHB1YmxpY0NvbnRlbnQ6ICdTaG9ydC10ZXJtIGNhY2hpbmcgKGRlZmF1bHQgNSBtaW4sIG1heCAxIGhvdXIpJyxcbiAgICAgIH0pLFxuICAgICAgZGVzY3JpcHRpb246ICdTdW1tYXJ5IG9mIGNhY2hpbmcgcG9saWNpZXMgYXBwbGllZCB0byBkaWZmZXJlbnQgY29udGVudCB0eXBlcycsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDREsgTmFnIFN1cHByZXNzaW9uc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhjb250ZW50QnVja2V0LCBbXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLVMxJywgcmVhc29uOiAnRGVtbyBwcm9qZWN0IOKAlCBhY2Nlc3MgbG9ncyBub3QgcmVxdWlyZWQgZm9yIHRlc3RuZXQgY29udGVudCBidWNrZXQnIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLVMxMCcsIHJlYXNvbjogJ0J1Y2tldCBpcyBvbmx5IGFjY2Vzc2VkIHZpYSBDbG91ZEZyb250IE9BSSwgbm90IGRpcmVjdGx5IG92ZXIgdGhlIGludGVybmV0JyB9LFxuICAgIF0sIHRydWUpO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGRpc3RyaWJ1dGlvbiwgW1xuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1DRlIxJywgcmVhc29uOiAnRGVtbyBwcm9qZWN0IOKAlCBnZW8gcmVzdHJpY3Rpb25zIG5vdCBuZWVkZWQgZm9yIHRlc3RuZXQgZGVtbycgfSxcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtQ0ZSMycsIHJlYXNvbjogJ0RlbW8gcHJvamVjdCDigJQgQ2xvdWRGcm9udCBhY2Nlc3MgbG9nZ2luZyBub3QgcmVxdWlyZWQnIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUNGUjQnLCByZWFzb246ICdVc2luZyBkZWZhdWx0IENsb3VkRnJvbnQgdmlld2VyIGNlcnRpZmljYXRlIHdoaWNoIHJlcXVpcmVzIGRlZmF1bHQgU1NMIHBvbGljeScgfSxcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtQ0ZSNycsIHJlYXNvbjogJ1VzaW5nIGxlZ2FjeSBTM09yaWdpbiB3aXRoIE9BSSDigJQgbWlncmF0aW9uIHRvIFMzQnVja2V0T3JpZ2luIHdpdGggT0FDIGlzIGEgZnV0dXJlIGltcHJvdmVtZW50JyB9LFxuICAgIF0pO1xuICB9XG59XG4iXX0=