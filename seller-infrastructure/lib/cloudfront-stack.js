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
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const cdk_nag_1 = require("cdk-nag");
const path = __importStar(require("path"));
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
        // Create Lambda@Edge function for payment verification
        const paymentVerifier = new cloudfront.experimental.EdgeFunction(this, 'PaymentVerifier', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'payment-verifier.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, 'lambda-edge')),
            memorySize: 128,
            timeout: cdk.Duration.seconds(20),
            // Note: Lambda@Edge doesn't support environment variables directly
            // The bucket name is configured in content-config.ts via CONTENT_BUCKET env var
            // which must be set at build time or use the default bucket name
        });
        // Grant Lambda@Edge permission to read from the content bucket
        contentBucket.grantRead(paymentVerifier);
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
        // Origin Request Policies
        // =========================================================================
        // Origin request policy for payment APIs
        // Forward payment headers to Lambda@Edge for verification
        const paymentApiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'PaymentApiOriginRequestPolicy', {
            originRequestPolicyName: `X402-PaymentApi-ForwardHeaders-${suffix}`,
            comment: 'Forward payment headers to origin for x402 verification',
            headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('X-Payment-Signature', 'Payment-Signature', 'Content-Type', 'Accept'),
            queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
            cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
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
        // CloudFront Distribution
        // =========================================================================
        // Create CloudFront distribution with optimized caching
        const distribution = new cloudfront.Distribution(this, 'X402Distribution', {
            comment: 'x402 Payment-Protected Content Distribution',
            defaultBehavior: {
                origin: new origins.S3Origin(contentBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                // Default behavior uses payment verification for all content
                cachePolicy: paymentApiCachePolicy,
                originRequestPolicy: paymentApiOriginRequestPolicy,
                responseHeadersPolicy: responseHeadersPolicy,
                edgeLambdas: [
                    {
                        functionVersion: paymentVerifier.currentVersion,
                        eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
                    },
                ],
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
                    edgeLambdas: [
                        {
                            functionVersion: paymentVerifier.currentVersion,
                            eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
                        },
                    ],
                    compress: true,
                },
                // Payment-protected API endpoints - NO caching
                '/api/*': {
                    origin: new origins.S3Origin(contentBucket),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                    cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                    cachePolicy: paymentApiCachePolicy,
                    originRequestPolicy: paymentApiOriginRequestPolicy,
                    responseHeadersPolicy: responseHeadersPolicy,
                    edgeLambdas: [
                        {
                            functionVersion: paymentVerifier.currentVersion,
                            eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
                        },
                    ],
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
        cdk_nag_1.NagSuppressions.addResourceSuppressions(paymentVerifier, [
            { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is required for Lambda@Edge CloudWatch logging' },
            { id: 'AwsSolutions-IAM5', reason: 'Wildcard scoped to content bucket — Lambda@Edge reads S3 objects to serve paid content' },
            { id: 'AwsSolutions-L1', reason: 'Lambda@Edge runtime pinned for compatibility — CloudFront replication requires stable runtime' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(distribution, [
            { id: 'AwsSolutions-CFR1', reason: 'Demo project — geo restrictions not needed for testnet demo' },
            { id: 'AwsSolutions-CFR2', reason: 'Demo project — WAF not required for testnet payment demo' },
            { id: 'AwsSolutions-CFR3', reason: 'Demo project — CloudFront access logging not required' },
            { id: 'AwsSolutions-CFR4', reason: 'Using default CloudFront viewer certificate which requires default SSL policy' },
            { id: 'AwsSolutions-CFR7', reason: 'Using legacy S3Origin with OAI — migration to S3BucketOrigin with OAC is a future improvement' },
        ]);
    }
}
exports.X402SellerStack = X402SellerStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWRmcm9udC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNsb3VkZnJvbnQtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHVFQUF5RDtBQUN6RCw0RUFBOEQ7QUFDOUQsK0RBQWlEO0FBQ2pELHVEQUF5QztBQUV6QyxxQ0FBMEM7QUFDMUMsMkNBQTZCO0FBRTdCLE1BQWEsZUFBZ0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUM1QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLGdFQUFnRTtRQUNoRSxNQUFNLE1BQU0sR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUVsRCxpREFBaUQ7UUFDakQsTUFBTSxhQUFhLEdBQUcsSUFBSSxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDekQsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztZQUN4QyxpQkFBaUIsRUFBRSxJQUFJO1lBQ3ZCLElBQUksRUFBRTtnQkFDSjtvQkFDRSxjQUFjLEVBQUUsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztvQkFDekQsY0FBYyxFQUFFLENBQUMsR0FBRyxDQUFDO29CQUNyQixjQUFjLEVBQUUsQ0FBQyxHQUFHLENBQUM7aUJBQ3RCO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFFSCx1REFBdUQ7UUFDdkQsTUFBTSxlQUFlLEdBQUcsSUFBSSxVQUFVLENBQUMsWUFBWSxDQUFDLFlBQVksQ0FDOUQsSUFBSSxFQUNKLGlCQUFpQixF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NEVBQTRFLEVBQUU7WUFDakgsRUFBRSxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLHdGQUF3RixFQUFFO1lBQzdILEVBQUUsRUFBRSxFQUFFLGlCQUFpQixFQUFFLE1BQU0sRUFBRSwrRkFBK0YsRUFBRTtTQUNuSSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRVQseUJBQWUsQ0FBQyx1QkFBdUIsQ0FBQyxZQUFZLEVBQUU7WUFDcEQsRUFBRSxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLDZEQUE2RCxFQUFFO1lBQ2xHLEVBQUUsRUFBRSxFQUFFLG1CQUFtQixFQUFFLE1BQU0sRUFBRSwwREFBMEQsRUFBRTtZQUMvRixFQUFFLEVBQUUsRUFBRSxtQkFBbUIsRUFBRSxNQUFNLEVBQUUsdURBQXVELEVBQUU7WUFDNUYsRUFBRSxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLCtFQUErRSxFQUFFO1lBQ3BILEVBQUUsRUFBRSxFQUFFLG1CQUFtQixFQUFFLE1BQU0sRUFBRSwrRkFBK0YsRUFBRTtTQUNySSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF2WEQsMENBdVhDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGNsb3VkZnJvbnQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQnO1xuaW1wb3J0ICogYXMgb3JpZ2lucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udC1vcmlnaW5zJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGNsYXNzIFg0MDJTZWxsZXJTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIFVuaXF1ZSBzdWZmaXggZm9yIHBvbGljeSBuYW1lcyB0byBhdm9pZCBjb25mbGljdHMgb24gcmVkZXBsb3lcbiAgICBjb25zdCBzdWZmaXggPSBjZGsuTmFtZXMudW5pcXVlSWQodGhpcykuc2xpY2UoLTgpO1xuXG4gICAgLy8gQ3JlYXRlIFMzIGJ1Y2tldCBmb3Igc3RhdGljIGNvbnRlbnQgKG9wdGlvbmFsKVxuICAgIGNvbnN0IGNvbnRlbnRCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdDb250ZW50QnVja2V0Jywge1xuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlLFxuICAgICAgY29yczogW1xuICAgICAgICB7XG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IFtzMy5IdHRwTWV0aG9kcy5HRVQsIHMzLkh0dHBNZXRob2RzLkhFQURdLFxuICAgICAgICAgIGFsbG93ZWRPcmlnaW5zOiBbJyonXSxcbiAgICAgICAgICBhbGxvd2VkSGVhZGVyczogWycqJ10sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIExhbWJkYUBFZGdlIGZ1bmN0aW9uIGZvciBwYXltZW50IHZlcmlmaWNhdGlvblxuICAgIGNvbnN0IHBheW1lbnRWZXJpZmllciA9IG5ldyBjbG91ZGZyb250LmV4cGVyaW1lbnRhbC5FZGdlRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgJ1BheW1lbnRWZXJpZmllcicsXG4gICAgICB7XG4gICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgICBoYW5kbGVyOiAncGF5bWVudC12ZXJpZmllci5oYW5kbGVyJyxcbiAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICdsYW1iZGEtZWRnZScpKSxcbiAgICAgICAgbWVtb3J5U2l6ZTogMTI4LFxuICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygyMCksXG4gICAgICAgIC8vIE5vdGU6IExhbWJkYUBFZGdlIGRvZXNuJ3Qgc3VwcG9ydCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZGlyZWN0bHlcbiAgICAgICAgLy8gVGhlIGJ1Y2tldCBuYW1lIGlzIGNvbmZpZ3VyZWQgaW4gY29udGVudC1jb25maWcudHMgdmlhIENPTlRFTlRfQlVDS0VUIGVudiB2YXJcbiAgICAgICAgLy8gd2hpY2ggbXVzdCBiZSBzZXQgYXQgYnVpbGQgdGltZSBvciB1c2UgdGhlIGRlZmF1bHQgYnVja2V0IG5hbWVcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gR3JhbnQgTGFtYmRhQEVkZ2UgcGVybWlzc2lvbiB0byByZWFkIGZyb20gdGhlIGNvbnRlbnQgYnVja2V0XG4gICAgY29udGVudEJ1Y2tldC5ncmFudFJlYWQocGF5bWVudFZlcmlmaWVyKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDYWNoaW5nIFBvbGljaWVzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ2FjaGUgcG9saWN5IGZvciBwYXltZW50LXByb3RlY3RlZCBBUEkgZW5kcG9pbnRzXG4gICAgLy8gRGlzYWJsZWQgLSBlYWNoIHJlcXVlc3QgcmVxdWlyZXMgdW5pcXVlIHBheW1lbnQgdmVyaWZpY2F0aW9uXG4gICAgY29uc3QgcGF5bWVudEFwaUNhY2hlUG9saWN5ID0gbmV3IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3koXG4gICAgICB0aGlzLFxuICAgICAgJ1BheW1lbnRBcGlDYWNoZVBvbGljeScsXG4gICAgICB7XG4gICAgICAgIGNhY2hlUG9saWN5TmFtZTogYFg0MDItUGF5bWVudEFwaS1Ob0NhY2hlLSR7c3VmZml4fWAsXG4gICAgICAgIGNvbW1lbnQ6ICdObyBjYWNoaW5nIGZvciB4NDAyIHBheW1lbnQtcHJvdGVjdGVkIGVuZHBvaW50cycsXG4gICAgICAgIGRlZmF1bHRUdGw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDApLFxuICAgICAgICBtaW5UdGw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDApLFxuICAgICAgICBtYXhUdGw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDApLFxuICAgICAgICAvLyBOb3RlOiBoZWFkZXJCZWhhdmlvciBjYW5ub3QgYmUgc2V0IHdoZW4gY2FjaGluZyBpcyBkaXNhYmxlZCAoVFRMPTApXG4gICAgICAgIC8vIFBheW1lbnQgaGVhZGVycyBhcmUgZm9yd2FyZGVkIHZpYSB0aGUgb3JpZ2luIHJlcXVlc3QgcG9saWN5IGluc3RlYWRcbiAgICAgICAgcXVlcnlTdHJpbmdCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZVF1ZXJ5U3RyaW5nQmVoYXZpb3Iubm9uZSgpLFxuICAgICAgICBjb29raWVCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZUNvb2tpZUJlaGF2aW9yLm5vbmUoKSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gQ2FjaGUgcG9saWN5IGZvciBzdGF0aWMgYXNzZXRzIChpbWFnZXMsIENTUywgSlMsIGZvbnRzKVxuICAgIC8vIFRoZXNlIGRvbid0IHJlcXVpcmUgcGF5bWVudCBhbmQgY2FuIGJlIGNhY2hlZCBhZ2dyZXNzaXZlbHlcbiAgICBjb25zdCBzdGF0aWNBc3NldHNDYWNoZVBvbGljeSA9IG5ldyBjbG91ZGZyb250LkNhY2hlUG9saWN5KFxuICAgICAgdGhpcyxcbiAgICAgICdTdGF0aWNBc3NldHNDYWNoZVBvbGljeScsXG4gICAgICB7XG4gICAgICAgIGNhY2hlUG9saWN5TmFtZTogYFg0MDItU3RhdGljQXNzZXRzLUxvbmdDYWNoZS0ke3N1ZmZpeH1gLFxuICAgICAgICBjb21tZW50OiAnTG9uZy10ZXJtIGNhY2hpbmcgZm9yIHN0YXRpYyBhc3NldHMgdGhhdCBkbyBub3QgcmVxdWlyZSBwYXltZW50JyxcbiAgICAgICAgZGVmYXVsdFR0bDogY2RrLkR1cmF0aW9uLmRheXMoMSksXG4gICAgICAgIG1pblR0bDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMSksXG4gICAgICAgIG1heFR0bDogY2RrLkR1cmF0aW9uLmRheXMoMzY1KSxcbiAgICAgICAgaGVhZGVyQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVIZWFkZXJCZWhhdmlvci5ub25lKCksXG4gICAgICAgIHF1ZXJ5U3RyaW5nQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVRdWVyeVN0cmluZ0JlaGF2aW9yLm5vbmUoKSxcbiAgICAgICAgY29va2llQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVDb29raWVCZWhhdmlvci5ub25lKCksXG4gICAgICAgIGVuYWJsZUFjY2VwdEVuY29kaW5nR3ppcDogdHJ1ZSxcbiAgICAgICAgZW5hYmxlQWNjZXB0RW5jb2RpbmdCcm90bGk6IHRydWUsXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIENhY2hlIHBvbGljeSBmb3IgcHVibGljIGNvbnRlbnQgKG5vbi1wYXltZW50LXByb3RlY3RlZCBwYWdlcylcbiAgICAvLyBTaG9ydCBUVEwgdG8gYmFsYW5jZSBmcmVzaG5lc3Mgd2l0aCBwZXJmb3JtYW5jZVxuICAgIGNvbnN0IHB1YmxpY0NvbnRlbnRDYWNoZVBvbGljeSA9IG5ldyBjbG91ZGZyb250LkNhY2hlUG9saWN5KFxuICAgICAgdGhpcyxcbiAgICAgICdQdWJsaWNDb250ZW50Q2FjaGVQb2xpY3knLFxuICAgICAge1xuICAgICAgICBjYWNoZVBvbGljeU5hbWU6IGBYNDAyLVB1YmxpY0NvbnRlbnQtU2hvcnRDYWNoZS0ke3N1ZmZpeH1gLFxuICAgICAgICBjb21tZW50OiAnU2hvcnQtdGVybSBjYWNoaW5nIGZvciBwdWJsaWMgY29udGVudCBwYWdlcycsXG4gICAgICAgIGRlZmF1bHRUdGw6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICBtaW5UdGw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDEpLFxuICAgICAgICBtYXhUdGw6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgaGVhZGVyQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVIZWFkZXJCZWhhdmlvci5ub25lKCksXG4gICAgICAgIHF1ZXJ5U3RyaW5nQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVRdWVyeVN0cmluZ0JlaGF2aW9yLmFsbCgpLFxuICAgICAgICBjb29raWVCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZUNvb2tpZUJlaGF2aW9yLm5vbmUoKSxcbiAgICAgICAgZW5hYmxlQWNjZXB0RW5jb2RpbmdHemlwOiB0cnVlLFxuICAgICAgICBlbmFibGVBY2NlcHRFbmNvZGluZ0Jyb3RsaTogdHJ1ZSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE9yaWdpbiBSZXF1ZXN0IFBvbGljaWVzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gT3JpZ2luIHJlcXVlc3QgcG9saWN5IGZvciBwYXltZW50IEFQSXNcbiAgICAvLyBGb3J3YXJkIHBheW1lbnQgaGVhZGVycyB0byBMYW1iZGFARWRnZSBmb3IgdmVyaWZpY2F0aW9uXG4gICAgY29uc3QgcGF5bWVudEFwaU9yaWdpblJlcXVlc3RQb2xpY3kgPSBuZXcgY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5KFxuICAgICAgdGhpcyxcbiAgICAgICdQYXltZW50QXBpT3JpZ2luUmVxdWVzdFBvbGljeScsXG4gICAgICB7XG4gICAgICAgIG9yaWdpblJlcXVlc3RQb2xpY3lOYW1lOiBgWDQwMi1QYXltZW50QXBpLUZvcndhcmRIZWFkZXJzLSR7c3VmZml4fWAsXG4gICAgICAgIGNvbW1lbnQ6ICdGb3J3YXJkIHBheW1lbnQgaGVhZGVycyB0byBvcmlnaW4gZm9yIHg0MDIgdmVyaWZpY2F0aW9uJyxcbiAgICAgICAgaGVhZGVyQmVoYXZpb3I6IGNsb3VkZnJvbnQuT3JpZ2luUmVxdWVzdEhlYWRlckJlaGF2aW9yLmFsbG93TGlzdChcbiAgICAgICAgICAnWC1QYXltZW50LVNpZ25hdHVyZScsXG4gICAgICAgICAgJ1BheW1lbnQtU2lnbmF0dXJlJyxcbiAgICAgICAgICAnQ29udGVudC1UeXBlJyxcbiAgICAgICAgICAnQWNjZXB0J1xuICAgICAgICApLFxuICAgICAgICBxdWVyeVN0cmluZ0JlaGF2aW9yOiBjbG91ZGZyb250Lk9yaWdpblJlcXVlc3RRdWVyeVN0cmluZ0JlaGF2aW9yLmFsbCgpLFxuICAgICAgICBjb29raWVCZWhhdmlvcjogY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0Q29va2llQmVoYXZpb3Iubm9uZSgpLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gUmVzcG9uc2UgSGVhZGVycyBQb2xpY3lcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCByZXNwb25zZUhlYWRlcnNQb2xpY3kgPSBuZXcgY2xvdWRmcm9udC5SZXNwb25zZUhlYWRlcnNQb2xpY3koXG4gICAgICB0aGlzLFxuICAgICAgJ1Jlc3BvbnNlSGVhZGVyc1BvbGljeScsXG4gICAgICB7XG4gICAgICAgIHJlc3BvbnNlSGVhZGVyc1BvbGljeU5hbWU6IGBYNDAyLVJlc3BvbnNlSGVhZGVycy0ke3N1ZmZpeH1gLFxuICAgICAgICBjb21tZW50OiAnQ09SUyBhbmQgeDQwMiBwYXltZW50IHJlc3BvbnNlIGhlYWRlcnMnLFxuICAgICAgICBjb3JzQmVoYXZpb3I6IHtcbiAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dPcmlnaW5zOiBbJyonXSxcbiAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dIZWFkZXJzOiBbXG4gICAgICAgICAgICAnQ29udGVudC1UeXBlJyxcbiAgICAgICAgICAgICdYLVBheW1lbnQtU2lnbmF0dXJlJyxcbiAgICAgICAgICAgICdQYXltZW50LVNpZ25hdHVyZScsXG4gICAgICAgICAgICAnQWNjZXB0JyxcbiAgICAgICAgICAgICdPcmlnaW4nLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgYWNjZXNzQ29udHJvbEFsbG93TWV0aG9kczogWydHRVQnLCAnSEVBRCcsICdPUFRJT05TJ10sXG4gICAgICAgICAgYWNjZXNzQ29udHJvbEV4cG9zZUhlYWRlcnM6IFtcbiAgICAgICAgICAgICdYLVBBWU1FTlQtUkVTUE9OU0UnLFxuICAgICAgICAgICAgJ1gtUEFZTUVOVC1SRVFVSVJFRCcsXG4gICAgICAgICAgICAnWC1SZXF1ZXN0LUlkJyxcbiAgICAgICAgICBdLFxuICAgICAgICAgIGFjY2Vzc0NvbnRyb2xBbGxvd0NyZWRlbnRpYWxzOiBmYWxzZSxcbiAgICAgICAgICBhY2Nlc3NDb250cm9sTWF4QWdlOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgb3JpZ2luT3ZlcnJpZGU6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFNlY3VyaXR5IGhlYWRlcnMgZm9yIGJlc3QgcHJhY3RpY2VzXG4gICAgICAgIHNlY3VyaXR5SGVhZGVyc0JlaGF2aW9yOiB7XG4gICAgICAgICAgY29udGVudFR5cGVPcHRpb25zOiB7IG92ZXJyaWRlOiB0cnVlIH0sXG4gICAgICAgICAgZnJhbWVPcHRpb25zOiB7XG4gICAgICAgICAgICBmcmFtZU9wdGlvbjogY2xvdWRmcm9udC5IZWFkZXJzRnJhbWVPcHRpb24uREVOWSxcbiAgICAgICAgICAgIG92ZXJyaWRlOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcmVmZXJyZXJQb2xpY3k6IHtcbiAgICAgICAgICAgIHJlZmVycmVyUG9saWN5OiBjbG91ZGZyb250LkhlYWRlcnNSZWZlcnJlclBvbGljeS5TVFJJQ1RfT1JJR0lOX1dIRU5fQ1JPU1NfT1JJR0lOLFxuICAgICAgICAgICAgb3ZlcnJpZGU6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB4c3NQcm90ZWN0aW9uOiB7XG4gICAgICAgICAgICBwcm90ZWN0aW9uOiB0cnVlLFxuICAgICAgICAgICAgbW9kZUJsb2NrOiB0cnVlLFxuICAgICAgICAgICAgb3ZlcnJpZGU6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgLy8gQ3VzdG9tIGhlYWRlcnMgZm9yIGNhY2hlIGRlYnVnZ2luZ1xuICAgICAgICBjdXN0b21IZWFkZXJzQmVoYXZpb3I6IHtcbiAgICAgICAgICBjdXN0b21IZWFkZXJzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGhlYWRlcjogJ1gtQ2FjaGUtUG9saWN5JyxcbiAgICAgICAgICAgICAgdmFsdWU6ICd4NDAyLXNlbGxlcicsXG4gICAgICAgICAgICAgIG92ZXJyaWRlOiBmYWxzZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENsb3VkRnJvbnQgRGlzdHJpYnV0aW9uXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ3JlYXRlIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIHdpdGggb3B0aW1pemVkIGNhY2hpbmdcbiAgICBjb25zdCBkaXN0cmlidXRpb24gPSBuZXcgY2xvdWRmcm9udC5EaXN0cmlidXRpb24odGhpcywgJ1g0MDJEaXN0cmlidXRpb24nLCB7XG4gICAgICBjb21tZW50OiAneDQwMiBQYXltZW50LVByb3RlY3RlZCBDb250ZW50IERpc3RyaWJ1dGlvbicsXG4gICAgICBkZWZhdWx0QmVoYXZpb3I6IHtcbiAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRF9PUFRJT05TLFxuICAgICAgICAvLyBEZWZhdWx0IGJlaGF2aW9yIHVzZXMgcGF5bWVudCB2ZXJpZmljYXRpb24gZm9yIGFsbCBjb250ZW50XG4gICAgICAgIGNhY2hlUG9saWN5OiBwYXltZW50QXBpQ2FjaGVQb2xpY3ksXG4gICAgICAgIG9yaWdpblJlcXVlc3RQb2xpY3k6IHBheW1lbnRBcGlPcmlnaW5SZXF1ZXN0UG9saWN5LFxuICAgICAgICByZXNwb25zZUhlYWRlcnNQb2xpY3k6IHJlc3BvbnNlSGVhZGVyc1BvbGljeSxcbiAgICAgICAgZWRnZUxhbWJkYXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBmdW5jdGlvblZlcnNpb246IHBheW1lbnRWZXJpZmllci5jdXJyZW50VmVyc2lvbixcbiAgICAgICAgICAgIGV2ZW50VHlwZTogY2xvdWRmcm9udC5MYW1iZGFFZGdlRXZlbnRUeXBlLk9SSUdJTl9SRVFVRVNULFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIGNvbXByZXNzOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGFkZGl0aW9uYWxCZWhhdmlvcnM6IHtcbiAgICAgICAgLy8gTUNQIGRpc2NvdmVyeSBlbmRwb2ludCAtIE5PIHBheW1lbnQgcmVxdWlyZWQsIHNob3J0IGNhY2hpbmdcbiAgICAgICAgJy9tY3AvKic6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKGNvbnRlbnRCdWNrZXQpLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgICAgY2FjaGVkTWV0aG9kczogY2xvdWRmcm9udC5DYWNoZWRNZXRob2RzLkNBQ0hFX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IHB1YmxpY0NvbnRlbnRDYWNoZVBvbGljeSxcbiAgICAgICAgICByZXNwb25zZUhlYWRlcnNQb2xpY3k6IHJlc3BvbnNlSGVhZGVyc1BvbGljeSxcbiAgICAgICAgICBlZGdlTGFtYmRhczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBmdW5jdGlvblZlcnNpb246IHBheW1lbnRWZXJpZmllci5jdXJyZW50VmVyc2lvbixcbiAgICAgICAgICAgICAgZXZlbnRUeXBlOiBjbG91ZGZyb250LkxhbWJkYUVkZ2VFdmVudFR5cGUuT1JJR0lOX1JFUVVFU1QsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgY29tcHJlc3M6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBheW1lbnQtcHJvdGVjdGVkIEFQSSBlbmRwb2ludHMgLSBOTyBjYWNoaW5nXG4gICAgICAgICcvYXBpLyonOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRF9PUFRJT05TLFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRF9PUFRJT05TLFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBwYXltZW50QXBpQ2FjaGVQb2xpY3ksXG4gICAgICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogcGF5bWVudEFwaU9yaWdpblJlcXVlc3RQb2xpY3ksXG4gICAgICAgICAgcmVzcG9uc2VIZWFkZXJzUG9saWN5OiByZXNwb25zZUhlYWRlcnNQb2xpY3ksXG4gICAgICAgICAgZWRnZUxhbWJkYXM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgZnVuY3Rpb25WZXJzaW9uOiBwYXltZW50VmVyaWZpZXIuY3VycmVudFZlcnNpb24sXG4gICAgICAgICAgICAgIGV2ZW50VHlwZTogY2xvdWRmcm9udC5MYW1iZGFFZGdlRXZlbnRUeXBlLk9SSUdJTl9SRVFVRVNULFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIGNvbXByZXNzOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICAvLyBTdGF0aWMgYXNzZXRzIC0gYWdncmVzc2l2ZSBjYWNoaW5nXG4gICAgICAgICcvc3RhdGljLyonOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IHN0YXRpY0Fzc2V0c0NhY2hlUG9saWN5LFxuICAgICAgICAgIHJlc3BvbnNlSGVhZGVyc1BvbGljeTogcmVzcG9uc2VIZWFkZXJzUG9saWN5LFxuICAgICAgICAgIGNvbXByZXNzOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICAvLyBJbWFnZXMgLSBhZ2dyZXNzaXZlIGNhY2hpbmdcbiAgICAgICAgJyouanBnJzoge1xuICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4oY29udGVudEJ1Y2tldCksXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVkTWV0aG9kczogY2xvdWRmcm9udC5DYWNoZWRNZXRob2RzLkNBQ0hFX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBzdGF0aWNBc3NldHNDYWNoZVBvbGljeSxcbiAgICAgICAgICBjb21wcmVzczogZmFsc2UsIC8vIEltYWdlcyBhcmUgYWxyZWFkeSBjb21wcmVzc2VkXG4gICAgICAgIH0sXG4gICAgICAgICcqLnBuZyc6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKGNvbnRlbnRCdWNrZXQpLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZVBvbGljeTogc3RhdGljQXNzZXRzQ2FjaGVQb2xpY3ksXG4gICAgICAgICAgY29tcHJlc3M6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICAnKi5zdmcnOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IHN0YXRpY0Fzc2V0c0NhY2hlUG9saWN5LFxuICAgICAgICAgIGNvbXByZXNzOiB0cnVlLCAvLyBTVkdzIGJlbmVmaXQgZnJvbSBjb21wcmVzc2lvblxuICAgICAgICB9LFxuICAgICAgICAvLyBDU1MgYW5kIEpTIC0gYWdncmVzc2l2ZSBjYWNoaW5nXG4gICAgICAgICcqLmNzcyc6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKGNvbnRlbnRCdWNrZXQpLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZVBvbGljeTogc3RhdGljQXNzZXRzQ2FjaGVQb2xpY3ksXG4gICAgICAgICAgY29tcHJlc3M6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgICcqLmpzJzoge1xuICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4oY29udGVudEJ1Y2tldCksXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVkTWV0aG9kczogY2xvdWRmcm9udC5DYWNoZWRNZXRob2RzLkNBQ0hFX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBzdGF0aWNBc3NldHNDYWNoZVBvbGljeSxcbiAgICAgICAgICBjb21wcmVzczogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgLy8gRm9udHMgLSBhZ2dyZXNzaXZlIGNhY2hpbmdcbiAgICAgICAgJyoud29mZjInOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IHN0YXRpY0Fzc2V0c0NhY2hlUG9saWN5LFxuICAgICAgICAgIGNvbXByZXNzOiBmYWxzZSwgLy8gRm9udHMgYXJlIGFscmVhZHkgY29tcHJlc3NlZFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIC8vIEVuYWJsZSBIVFRQLzIgYW5kIEhUVFAvMyBmb3IgYmV0dGVyIHBlcmZvcm1hbmNlXG4gICAgICBodHRwVmVyc2lvbjogY2xvdWRmcm9udC5IdHRwVmVyc2lvbi5IVFRQMl9BTkRfMyxcbiAgICAgIC8vIFByaWNlIGNsYXNzIC0gdXNlIGFsbCBlZGdlIGxvY2F0aW9ucyBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgICAgcHJpY2VDbGFzczogY2xvdWRmcm9udC5QcmljZUNsYXNzLlBSSUNFX0NMQVNTX0FMTCxcbiAgICAgIC8vIExvZ2dpbmcgZGlzYWJsZWQgZm9yIGRlbW8gc2ltcGxpY2l0eVxuICAgICAgLy8gQ2xvdWRGcm9udCBzdGFuZGFyZCBsb2dnaW5nIHJlcXVpcmVzIEFDTC1lbmFibGVkIGJ1Y2tldHNcbiAgICAgIGVuYWJsZUxvZ2dpbmc6IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE91dHB1dHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGlzdHJpYnV0aW9uRG9tYWluTmFtZScsIHtcbiAgICAgIHZhbHVlOiBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRGcm9udCBEaXN0cmlidXRpb24gRG9tYWluIE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJEaXN0cmlidXRpb25Eb21haW4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Rpc3RyaWJ1dGlvblVybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke2Rpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkRnJvbnQgRGlzdHJpYnV0aW9uIFVSTCcsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMkRpc3RyaWJ1dGlvblVybCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGlzdHJpYnV0aW9uSWQnLCB7XG4gICAgICB2YWx1ZTogZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbklkLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZEZyb250IERpc3RyaWJ1dGlvbiBJRCAoZm9yIGNhY2hlIGludmFsaWRhdGlvbiknLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJEaXN0cmlidXRpb25JZCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ29udGVudEJ1Y2tldE5hbWUnLCB7XG4gICAgICB2YWx1ZTogY29udGVudEJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdTMyBDb250ZW50IEJ1Y2tldCBOYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyQ29udGVudEJ1Y2tldCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUGF5bWVudEFwaUVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7ZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWV9L2FwaS9gLFxuICAgICAgZGVzY3JpcHRpb246ICdQYXltZW50LXByb3RlY3RlZCBBUEkgZW5kcG9pbnQgKHJlcXVpcmVzIHg0MDIgcGF5bWVudCknLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXltZW50QXBpRW5kcG9pbnQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NhY2hlUG9saWN5U3VtbWFyeScsIHtcbiAgICAgIHZhbHVlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHBheW1lbnRBcGk6ICdObyBjYWNoaW5nIChUVEw9MCkgLSBlYWNoIHJlcXVlc3QgcmVxdWlyZXMgcGF5bWVudCB2ZXJpZmljYXRpb24nLFxuICAgICAgICBzdGF0aWNBc3NldHM6ICdMb25nLXRlcm0gY2FjaGluZyAoZGVmYXVsdCAxIGRheSwgbWF4IDEgeWVhciknLFxuICAgICAgICBwdWJsaWNDb250ZW50OiAnU2hvcnQtdGVybSBjYWNoaW5nIChkZWZhdWx0IDUgbWluLCBtYXggMSBob3VyKScsXG4gICAgICB9KSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3VtbWFyeSBvZiBjYWNoaW5nIHBvbGljaWVzIGFwcGxpZWQgdG8gZGlmZmVyZW50IGNvbnRlbnQgdHlwZXMnLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQ0RLIE5hZyBTdXBwcmVzc2lvbnNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoY29udGVudEJ1Y2tldCwgW1xuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1TMScsIHJlYXNvbjogJ0RlbW8gcHJvamVjdCDigJQgYWNjZXNzIGxvZ3Mgbm90IHJlcXVpcmVkIGZvciB0ZXN0bmV0IGNvbnRlbnQgYnVja2V0JyB9LFxuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1TMTAnLCByZWFzb246ICdCdWNrZXQgaXMgb25seSBhY2Nlc3NlZCB2aWEgQ2xvdWRGcm9udCBPQUksIG5vdCBkaXJlY3RseSBvdmVyIHRoZSBpbnRlcm5ldCcgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhwYXltZW50VmVyaWZpZXIsIFtcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsIHJlYXNvbjogJ0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSBpcyByZXF1aXJlZCBmb3IgTGFtYmRhQEVkZ2UgQ2xvdWRXYXRjaCBsb2dnaW5nJyB9LFxuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JywgcmVhc29uOiAnV2lsZGNhcmQgc2NvcGVkIHRvIGNvbnRlbnQgYnVja2V0IOKAlCBMYW1iZGFARWRnZSByZWFkcyBTMyBvYmplY3RzIHRvIHNlcnZlIHBhaWQgY29udGVudCcgfSxcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtTDEnLCByZWFzb246ICdMYW1iZGFARWRnZSBydW50aW1lIHBpbm5lZCBmb3IgY29tcGF0aWJpbGl0eSDigJQgQ2xvdWRGcm9udCByZXBsaWNhdGlvbiByZXF1aXJlcyBzdGFibGUgcnVudGltZScgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhkaXN0cmlidXRpb24sIFtcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtQ0ZSMScsIHJlYXNvbjogJ0RlbW8gcHJvamVjdCDigJQgZ2VvIHJlc3RyaWN0aW9ucyBub3QgbmVlZGVkIGZvciB0ZXN0bmV0IGRlbW8nIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUNGUjInLCByZWFzb246ICdEZW1vIHByb2plY3Qg4oCUIFdBRiBub3QgcmVxdWlyZWQgZm9yIHRlc3RuZXQgcGF5bWVudCBkZW1vJyB9LFxuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1DRlIzJywgcmVhc29uOiAnRGVtbyBwcm9qZWN0IOKAlCBDbG91ZEZyb250IGFjY2VzcyBsb2dnaW5nIG5vdCByZXF1aXJlZCcgfSxcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtQ0ZSNCcsIHJlYXNvbjogJ1VzaW5nIGRlZmF1bHQgQ2xvdWRGcm9udCB2aWV3ZXIgY2VydGlmaWNhdGUgd2hpY2ggcmVxdWlyZXMgZGVmYXVsdCBTU0wgcG9saWN5JyB9LFxuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1DRlI3JywgcmVhc29uOiAnVXNpbmcgbGVnYWN5IFMzT3JpZ2luIHdpdGggT0FJIOKAlCBtaWdyYXRpb24gdG8gUzNCdWNrZXRPcmlnaW4gd2l0aCBPQUMgaXMgYSBmdXR1cmUgaW1wcm92ZW1lbnQnIH0sXG4gICAgXSk7XG4gIH1cbn1cbiJdfQ==