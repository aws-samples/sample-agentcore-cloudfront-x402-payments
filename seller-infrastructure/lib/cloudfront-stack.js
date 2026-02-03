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
const path = __importStar(require("path"));
class X402SellerStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
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
            timeout: cdk.Duration.seconds(5),
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
            cachePolicyName: 'X402-PaymentApi-NoCache',
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
            cachePolicyName: 'X402-StaticAssets-LongCache',
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
            cachePolicyName: 'X402-PublicContent-ShortCache',
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
            originRequestPolicyName: 'X402-PaymentApi-ForwardHeaders',
            comment: 'Forward payment headers to origin for x402 verification',
            headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('X-Payment-Signature', 'Payment-Signature', 'Content-Type', 'Accept'),
            queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
            cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
        });
        // =========================================================================
        // Response Headers Policy
        // =========================================================================
        const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'ResponseHeadersPolicy', {
            responseHeadersPolicyName: 'X402-ResponseHeaders',
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
                // Default behavior uses public content caching for non-API paths
                cachePolicy: publicContentCachePolicy,
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
                    edgeLambdas: [
                        {
                            functionVersion: paymentVerifier.currentVersion,
                            eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
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
                            eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
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
    }
}
exports.X402SellerStack = X402SellerStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWRmcm9udC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNsb3VkZnJvbnQtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHVFQUF5RDtBQUN6RCw0RUFBOEQ7QUFDOUQsK0RBQWlEO0FBQ2pELHVEQUF5QztBQUV6QywyQ0FBNkI7QUFFN0IsTUFBYSxlQUFnQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzVDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsaURBQWlEO1FBQ2pELE1BQU0sYUFBYSxHQUFHLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3pELGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87WUFDeEMsaUJBQWlCLEVBQUUsSUFBSTtZQUN2QixJQUFJLEVBQUU7Z0JBQ0o7b0JBQ0UsY0FBYyxFQUFFLENBQUMsRUFBRSxDQUFDLFdBQVcsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7b0JBQ3pELGNBQWMsRUFBRSxDQUFDLEdBQUcsQ0FBQztvQkFDckIsY0FBYyxFQUFFLENBQUMsR0FBRyxDQUFDO2lCQUN0QjthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsdURBQXVEO1FBQ3ZELE1BQU0sZUFBZSxHQUFHLElBQUksVUFBVSxDQUFDLFlBQVksQ0FBQyxZQUFZLENBQzlELElBQUksRUFDSixpQkFBaUIsRUFDakI7WUFDRSxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ25DLE9BQU8sRUFBRSwwQkFBMEI7WUFDbkMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FB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V0FBVyxZQUFZLENBQUMsc0JBQXNCLE9BQU87WUFDNUQsV0FBVyxFQUFFLHdEQUF3RDtZQUNyRSxVQUFVLEVBQUUsd0JBQXdCO1NBQ3JDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDNUMsS0FBSyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ3BCLFVBQVUsRUFBRSxpRUFBaUU7Z0JBQzdFLFlBQVksRUFBRSwrQ0FBK0M7Z0JBQzdELGFBQWEsRUFBRSxnREFBZ0Q7YUFDaEUsQ0FBQztZQUNGLFdBQVcsRUFBRSxnRUFBZ0U7U0FDOUUsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBdlZELDBDQXVWQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBjbG91ZGZyb250IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250JztcbmltcG9ydCAqIGFzIG9yaWdpbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQtb3JpZ2lucyc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuXG5leHBvcnQgY2xhc3MgWDQwMlNlbGxlclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gQ3JlYXRlIFMzIGJ1Y2tldCBmb3Igc3RhdGljIGNvbnRlbnQgKG9wdGlvbmFsKVxuICAgIGNvbnN0IGNvbnRlbnRCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdDb250ZW50QnVja2V0Jywge1xuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlLFxuICAgICAgY29yczogW1xuICAgICAgICB7XG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IFtzMy5IdHRwTWV0aG9kcy5HRVQsIHMzLkh0dHBNZXRob2RzLkhFQURdLFxuICAgICAgICAgIGFsbG93ZWRPcmlnaW5zOiBbJyonXSxcbiAgICAgICAgICBhbGxvd2VkSGVhZGVyczogWycqJ10sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIExhbWJkYUBFZGdlIGZ1bmN0aW9uIGZvciBwYXltZW50IHZlcmlmaWNhdGlvblxuICAgIGNvbnN0IHBheW1lbnRWZXJpZmllciA9IG5ldyBjbG91ZGZyb250LmV4cGVyaW1lbnRhbC5FZGdlRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgJ1BheW1lbnRWZXJpZmllcicsXG4gICAgICB7XG4gICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgICBoYW5kbGVyOiAncGF5bWVudC12ZXJpZmllci5oYW5kbGVyJyxcbiAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICdsYW1iZGEtZWRnZScpKSxcbiAgICAgICAgbWVtb3J5U2l6ZTogMTI4LFxuICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICAgICAgLy8gTm90ZTogTGFtYmRhQEVkZ2UgZG9lc24ndCBzdXBwb3J0IGVudmlyb25tZW50IHZhcmlhYmxlcyBkaXJlY3RseVxuICAgICAgICAvLyBUaGUgYnVja2V0IG5hbWUgaXMgY29uZmlndXJlZCBpbiBjb250ZW50LWNvbmZpZy50cyB2aWEgQ09OVEVOVF9CVUNLRVQgZW52IHZhclxuICAgICAgICAvLyB3aGljaCBtdXN0IGJlIHNldCBhdCBidWlsZCB0aW1lIG9yIHVzZSB0aGUgZGVmYXVsdCBidWNrZXQgbmFtZVxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBHcmFudCBMYW1iZGFARWRnZSBwZXJtaXNzaW9uIHRvIHJlYWQgZnJvbSB0aGUgY29udGVudCBidWNrZXRcbiAgICBjb250ZW50QnVja2V0LmdyYW50UmVhZChwYXltZW50VmVyaWZpZXIpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENhY2hpbmcgUG9saWNpZXNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBDYWNoZSBwb2xpY3kgZm9yIHBheW1lbnQtcHJvdGVjdGVkIEFQSSBlbmRwb2ludHNcbiAgICAvLyBEaXNhYmxlZCAtIGVhY2ggcmVxdWVzdCByZXF1aXJlcyB1bmlxdWUgcGF5bWVudCB2ZXJpZmljYXRpb25cbiAgICBjb25zdCBwYXltZW50QXBpQ2FjaGVQb2xpY3kgPSBuZXcgY2xvdWRmcm9udC5DYWNoZVBvbGljeShcbiAgICAgIHRoaXMsXG4gICAgICAnUGF5bWVudEFwaUNhY2hlUG9saWN5JyxcbiAgICAgIHtcbiAgICAgICAgY2FjaGVQb2xpY3lOYW1lOiAnWDQwMi1QYXltZW50QXBpLU5vQ2FjaGUnLFxuICAgICAgICBjb21tZW50OiAnTm8gY2FjaGluZyBmb3IgeDQwMiBwYXltZW50LXByb3RlY3RlZCBlbmRwb2ludHMnLFxuICAgICAgICBkZWZhdWx0VHRsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygwKSxcbiAgICAgICAgbWluVHRsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygwKSxcbiAgICAgICAgbWF4VHRsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygwKSxcbiAgICAgICAgLy8gTm90ZTogaGVhZGVyQmVoYXZpb3IgY2Fubm90IGJlIHNldCB3aGVuIGNhY2hpbmcgaXMgZGlzYWJsZWQgKFRUTD0wKVxuICAgICAgICAvLyBQYXltZW50IGhlYWRlcnMgYXJlIGZvcndhcmRlZCB2aWEgdGhlIG9yaWdpbiByZXF1ZXN0IHBvbGljeSBpbnN0ZWFkXG4gICAgICAgIHF1ZXJ5U3RyaW5nQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVRdWVyeVN0cmluZ0JlaGF2aW9yLm5vbmUoKSxcbiAgICAgICAgY29va2llQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVDb29raWVCZWhhdmlvci5ub25lKCksXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIENhY2hlIHBvbGljeSBmb3Igc3RhdGljIGFzc2V0cyAoaW1hZ2VzLCBDU1MsIEpTLCBmb250cylcbiAgICAvLyBUaGVzZSBkb24ndCByZXF1aXJlIHBheW1lbnQgYW5kIGNhbiBiZSBjYWNoZWQgYWdncmVzc2l2ZWx5XG4gICAgY29uc3Qgc3RhdGljQXNzZXRzQ2FjaGVQb2xpY3kgPSBuZXcgY2xvdWRmcm9udC5DYWNoZVBvbGljeShcbiAgICAgIHRoaXMsXG4gICAgICAnU3RhdGljQXNzZXRzQ2FjaGVQb2xpY3knLFxuICAgICAge1xuICAgICAgICBjYWNoZVBvbGljeU5hbWU6ICdYNDAyLVN0YXRpY0Fzc2V0cy1Mb25nQ2FjaGUnLFxuICAgICAgICBjb21tZW50OiAnTG9uZy10ZXJtIGNhY2hpbmcgZm9yIHN0YXRpYyBhc3NldHMgdGhhdCBkbyBub3QgcmVxdWlyZSBwYXltZW50JyxcbiAgICAgICAgZGVmYXVsdFR0bDogY2RrLkR1cmF0aW9uLmRheXMoMSksXG4gICAgICAgIG1pblR0bDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMSksXG4gICAgICAgIG1heFR0bDogY2RrLkR1cmF0aW9uLmRheXMoMzY1KSxcbiAgICAgICAgaGVhZGVyQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVIZWFkZXJCZWhhdmlvci5ub25lKCksXG4gICAgICAgIHF1ZXJ5U3RyaW5nQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVRdWVyeVN0cmluZ0JlaGF2aW9yLm5vbmUoKSxcbiAgICAgICAgY29va2llQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVDb29raWVCZWhhdmlvci5ub25lKCksXG4gICAgICAgIGVuYWJsZUFjY2VwdEVuY29kaW5nR3ppcDogdHJ1ZSxcbiAgICAgICAgZW5hYmxlQWNjZXB0RW5jb2RpbmdCcm90bGk6IHRydWUsXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIENhY2hlIHBvbGljeSBmb3IgcHVibGljIGNvbnRlbnQgKG5vbi1wYXltZW50LXByb3RlY3RlZCBwYWdlcylcbiAgICAvLyBTaG9ydCBUVEwgdG8gYmFsYW5jZSBmcmVzaG5lc3Mgd2l0aCBwZXJmb3JtYW5jZVxuICAgIGNvbnN0IHB1YmxpY0NvbnRlbnRDYWNoZVBvbGljeSA9IG5ldyBjbG91ZGZyb250LkNhY2hlUG9saWN5KFxuICAgICAgdGhpcyxcbiAgICAgICdQdWJsaWNDb250ZW50Q2FjaGVQb2xpY3knLFxuICAgICAge1xuICAgICAgICBjYWNoZVBvbGljeU5hbWU6ICdYNDAyLVB1YmxpY0NvbnRlbnQtU2hvcnRDYWNoZScsXG4gICAgICAgIGNvbW1lbnQ6ICdTaG9ydC10ZXJtIGNhY2hpbmcgZm9yIHB1YmxpYyBjb250ZW50IHBhZ2VzJyxcbiAgICAgICAgZGVmYXVsdFR0bDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIG1pblR0bDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMSksXG4gICAgICAgIG1heFR0bDogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICBoZWFkZXJCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZUhlYWRlckJlaGF2aW9yLm5vbmUoKSxcbiAgICAgICAgcXVlcnlTdHJpbmdCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZVF1ZXJ5U3RyaW5nQmVoYXZpb3IuYWxsKCksXG4gICAgICAgIGNvb2tpZUJlaGF2aW9yOiBjbG91ZGZyb250LkNhY2hlQ29va2llQmVoYXZpb3Iubm9uZSgpLFxuICAgICAgICBlbmFibGVBY2NlcHRFbmNvZGluZ0d6aXA6IHRydWUsXG4gICAgICAgIGVuYWJsZUFjY2VwdEVuY29kaW5nQnJvdGxpOiB0cnVlLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gT3JpZ2luIFJlcXVlc3QgUG9saWNpZXNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBPcmlnaW4gcmVxdWVzdCBwb2xpY3kgZm9yIHBheW1lbnQgQVBJc1xuICAgIC8vIEZvcndhcmQgcGF5bWVudCBoZWFkZXJzIHRvIExhbWJkYUBFZGdlIGZvciB2ZXJpZmljYXRpb25cbiAgICBjb25zdCBwYXltZW50QXBpT3JpZ2luUmVxdWVzdFBvbGljeSA9IG5ldyBjbG91ZGZyb250Lk9yaWdpblJlcXVlc3RQb2xpY3koXG4gICAgICB0aGlzLFxuICAgICAgJ1BheW1lbnRBcGlPcmlnaW5SZXF1ZXN0UG9saWN5JyxcbiAgICAgIHtcbiAgICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeU5hbWU6ICdYNDAyLVBheW1lbnRBcGktRm9yd2FyZEhlYWRlcnMnLFxuICAgICAgICBjb21tZW50OiAnRm9yd2FyZCBwYXltZW50IGhlYWRlcnMgdG8gb3JpZ2luIGZvciB4NDAyIHZlcmlmaWNhdGlvbicsXG4gICAgICAgIGhlYWRlckJlaGF2aW9yOiBjbG91ZGZyb250Lk9yaWdpblJlcXVlc3RIZWFkZXJCZWhhdmlvci5hbGxvd0xpc3QoXG4gICAgICAgICAgJ1gtUGF5bWVudC1TaWduYXR1cmUnLFxuICAgICAgICAgICdQYXltZW50LVNpZ25hdHVyZScsXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZScsXG4gICAgICAgICAgJ0FjY2VwdCdcbiAgICAgICAgKSxcbiAgICAgICAgcXVlcnlTdHJpbmdCZWhhdmlvcjogY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UXVlcnlTdHJpbmdCZWhhdmlvci5hbGwoKSxcbiAgICAgICAgY29va2llQmVoYXZpb3I6IGNsb3VkZnJvbnQuT3JpZ2luUmVxdWVzdENvb2tpZUJlaGF2aW9yLm5vbmUoKSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFJlc3BvbnNlIEhlYWRlcnMgUG9saWN5XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgcmVzcG9uc2VIZWFkZXJzUG9saWN5ID0gbmV3IGNsb3VkZnJvbnQuUmVzcG9uc2VIZWFkZXJzUG9saWN5KFxuICAgICAgdGhpcyxcbiAgICAgICdSZXNwb25zZUhlYWRlcnNQb2xpY3knLFxuICAgICAge1xuICAgICAgICByZXNwb25zZUhlYWRlcnNQb2xpY3lOYW1lOiAnWDQwMi1SZXNwb25zZUhlYWRlcnMnLFxuICAgICAgICBjb21tZW50OiAnQ09SUyBhbmQgeDQwMiBwYXltZW50IHJlc3BvbnNlIGhlYWRlcnMnLFxuICAgICAgICBjb3JzQmVoYXZpb3I6IHtcbiAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dPcmlnaW5zOiBbJyonXSxcbiAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dIZWFkZXJzOiBbXG4gICAgICAgICAgICAnQ29udGVudC1UeXBlJyxcbiAgICAgICAgICAgICdYLVBheW1lbnQtU2lnbmF0dXJlJyxcbiAgICAgICAgICAgICdQYXltZW50LVNpZ25hdHVyZScsXG4gICAgICAgICAgICAnQWNjZXB0JyxcbiAgICAgICAgICAgICdPcmlnaW4nLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgYWNjZXNzQ29udHJvbEFsbG93TWV0aG9kczogWydHRVQnLCAnSEVBRCcsICdPUFRJT05TJ10sXG4gICAgICAgICAgYWNjZXNzQ29udHJvbEV4cG9zZUhlYWRlcnM6IFtcbiAgICAgICAgICAgICdYLVBBWU1FTlQtUkVTUE9OU0UnLFxuICAgICAgICAgICAgJ1gtUEFZTUVOVC1SRVFVSVJFRCcsXG4gICAgICAgICAgICAnWC1SZXF1ZXN0LUlkJyxcbiAgICAgICAgICBdLFxuICAgICAgICAgIGFjY2Vzc0NvbnRyb2xBbGxvd0NyZWRlbnRpYWxzOiBmYWxzZSxcbiAgICAgICAgICBhY2Nlc3NDb250cm9sTWF4QWdlOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgb3JpZ2luT3ZlcnJpZGU6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFNlY3VyaXR5IGhlYWRlcnMgZm9yIGJlc3QgcHJhY3RpY2VzXG4gICAgICAgIHNlY3VyaXR5SGVhZGVyc0JlaGF2aW9yOiB7XG4gICAgICAgICAgY29udGVudFR5cGVPcHRpb25zOiB7IG92ZXJyaWRlOiB0cnVlIH0sXG4gICAgICAgICAgZnJhbWVPcHRpb25zOiB7XG4gICAgICAgICAgICBmcmFtZU9wdGlvbjogY2xvdWRmcm9udC5IZWFkZXJzRnJhbWVPcHRpb24uREVOWSxcbiAgICAgICAgICAgIG92ZXJyaWRlOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcmVmZXJyZXJQb2xpY3k6IHtcbiAgICAgICAgICAgIHJlZmVycmVyUG9saWN5OiBjbG91ZGZyb250LkhlYWRlcnNSZWZlcnJlclBvbGljeS5TVFJJQ1RfT1JJR0lOX1dIRU5fQ1JPU1NfT1JJR0lOLFxuICAgICAgICAgICAgb3ZlcnJpZGU6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB4c3NQcm90ZWN0aW9uOiB7XG4gICAgICAgICAgICBwcm90ZWN0aW9uOiB0cnVlLFxuICAgICAgICAgICAgbW9kZUJsb2NrOiB0cnVlLFxuICAgICAgICAgICAgb3ZlcnJpZGU6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgLy8gQ3VzdG9tIGhlYWRlcnMgZm9yIGNhY2hlIGRlYnVnZ2luZ1xuICAgICAgICBjdXN0b21IZWFkZXJzQmVoYXZpb3I6IHtcbiAgICAgICAgICBjdXN0b21IZWFkZXJzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGhlYWRlcjogJ1gtQ2FjaGUtUG9saWN5JyxcbiAgICAgICAgICAgICAgdmFsdWU6ICd4NDAyLXNlbGxlcicsXG4gICAgICAgICAgICAgIG92ZXJyaWRlOiBmYWxzZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENsb3VkRnJvbnQgRGlzdHJpYnV0aW9uXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ3JlYXRlIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIHdpdGggb3B0aW1pemVkIGNhY2hpbmdcbiAgICBjb25zdCBkaXN0cmlidXRpb24gPSBuZXcgY2xvdWRmcm9udC5EaXN0cmlidXRpb24odGhpcywgJ1g0MDJEaXN0cmlidXRpb24nLCB7XG4gICAgICBjb21tZW50OiAneDQwMiBQYXltZW50LVByb3RlY3RlZCBDb250ZW50IERpc3RyaWJ1dGlvbicsXG4gICAgICBkZWZhdWx0QmVoYXZpb3I6IHtcbiAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRF9PUFRJT05TLFxuICAgICAgICAvLyBEZWZhdWx0IGJlaGF2aW9yIHVzZXMgcHVibGljIGNvbnRlbnQgY2FjaGluZyBmb3Igbm9uLUFQSSBwYXRoc1xuICAgICAgICBjYWNoZVBvbGljeTogcHVibGljQ29udGVudENhY2hlUG9saWN5LFxuICAgICAgICByZXNwb25zZUhlYWRlcnNQb2xpY3k6IHJlc3BvbnNlSGVhZGVyc1BvbGljeSxcbiAgICAgICAgY29tcHJlc3M6IHRydWUsXG4gICAgICB9LFxuICAgICAgYWRkaXRpb25hbEJlaGF2aW9yczoge1xuICAgICAgICAvLyBNQ1AgZGlzY292ZXJ5IGVuZHBvaW50IC0gTk8gcGF5bWVudCByZXF1aXJlZCwgc2hvcnQgY2FjaGluZ1xuICAgICAgICAnL21jcC8qJzoge1xuICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4oY29udGVudEJ1Y2tldCksXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQURfT1BUSU9OUyxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQURfT1BUSU9OUyxcbiAgICAgICAgICBjYWNoZVBvbGljeTogcHVibGljQ29udGVudENhY2hlUG9saWN5LFxuICAgICAgICAgIHJlc3BvbnNlSGVhZGVyc1BvbGljeTogcmVzcG9uc2VIZWFkZXJzUG9saWN5LFxuICAgICAgICAgIGVkZ2VMYW1iZGFzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGZ1bmN0aW9uVmVyc2lvbjogcGF5bWVudFZlcmlmaWVyLmN1cnJlbnRWZXJzaW9uLFxuICAgICAgICAgICAgICBldmVudFR5cGU6IGNsb3VkZnJvbnQuTGFtYmRhRWRnZUV2ZW50VHlwZS5WSUVXRVJfUkVRVUVTVCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICBjb21wcmVzczogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF5bWVudC1wcm90ZWN0ZWQgQVBJIGVuZHBvaW50cyAtIE5PIGNhY2hpbmdcbiAgICAgICAgJy9hcGkvKic6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKGNvbnRlbnRCdWNrZXQpLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgICAgY2FjaGVkTWV0aG9kczogY2xvdWRmcm9udC5DYWNoZWRNZXRob2RzLkNBQ0hFX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IHBheW1lbnRBcGlDYWNoZVBvbGljeSxcbiAgICAgICAgICBvcmlnaW5SZXF1ZXN0UG9saWN5OiBwYXltZW50QXBpT3JpZ2luUmVxdWVzdFBvbGljeSxcbiAgICAgICAgICByZXNwb25zZUhlYWRlcnNQb2xpY3k6IHJlc3BvbnNlSGVhZGVyc1BvbGljeSxcbiAgICAgICAgICBlZGdlTGFtYmRhczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBmdW5jdGlvblZlcnNpb246IHBheW1lbnRWZXJpZmllci5jdXJyZW50VmVyc2lvbixcbiAgICAgICAgICAgICAgZXZlbnRUeXBlOiBjbG91ZGZyb250LkxhbWJkYUVkZ2VFdmVudFR5cGUuVklFV0VSX1JFUVVFU1QsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgY29tcHJlc3M6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFN0YXRpYyBhc3NldHMgLSBhZ2dyZXNzaXZlIGNhY2hpbmdcbiAgICAgICAgJy9zdGF0aWMvKic6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKGNvbnRlbnRCdWNrZXQpLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZVBvbGljeTogc3RhdGljQXNzZXRzQ2FjaGVQb2xpY3ksXG4gICAgICAgICAgcmVzcG9uc2VIZWFkZXJzUG9saWN5OiByZXNwb25zZUhlYWRlcnNQb2xpY3ksXG4gICAgICAgICAgY29tcHJlc3M6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIC8vIEltYWdlcyAtIGFnZ3Jlc3NpdmUgY2FjaGluZ1xuICAgICAgICAnKi5qcGcnOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IHN0YXRpY0Fzc2V0c0NhY2hlUG9saWN5LFxuICAgICAgICAgIGNvbXByZXNzOiBmYWxzZSwgLy8gSW1hZ2VzIGFyZSBhbHJlYWR5IGNvbXByZXNzZWRcbiAgICAgICAgfSxcbiAgICAgICAgJyoucG5nJzoge1xuICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4oY29udGVudEJ1Y2tldCksXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVkTWV0aG9kczogY2xvdWRmcm9udC5DYWNoZWRNZXRob2RzLkNBQ0hFX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBzdGF0aWNBc3NldHNDYWNoZVBvbGljeSxcbiAgICAgICAgICBjb21wcmVzczogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgICcqLnN2Zyc6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKGNvbnRlbnRCdWNrZXQpLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZVBvbGljeTogc3RhdGljQXNzZXRzQ2FjaGVQb2xpY3ksXG4gICAgICAgICAgY29tcHJlc3M6IHRydWUsIC8vIFNWR3MgYmVuZWZpdCBmcm9tIGNvbXByZXNzaW9uXG4gICAgICAgIH0sXG4gICAgICAgIC8vIENTUyBhbmQgSlMgLSBhZ2dyZXNzaXZlIGNhY2hpbmdcbiAgICAgICAgJyouY3NzJzoge1xuICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4oY29udGVudEJ1Y2tldCksXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVkTWV0aG9kczogY2xvdWRmcm9udC5DYWNoZWRNZXRob2RzLkNBQ0hFX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBzdGF0aWNBc3NldHNDYWNoZVBvbGljeSxcbiAgICAgICAgICBjb21wcmVzczogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgJyouanMnOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihjb250ZW50QnVja2V0KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IHN0YXRpY0Fzc2V0c0NhY2hlUG9saWN5LFxuICAgICAgICAgIGNvbXByZXNzOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICAvLyBGb250cyAtIGFnZ3Jlc3NpdmUgY2FjaGluZ1xuICAgICAgICAnKi53b2ZmMic6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKGNvbnRlbnRCdWNrZXQpLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZVBvbGljeTogc3RhdGljQXNzZXRzQ2FjaGVQb2xpY3ksXG4gICAgICAgICAgY29tcHJlc3M6IGZhbHNlLCAvLyBGb250cyBhcmUgYWxyZWFkeSBjb21wcmVzc2VkXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgLy8gRW5hYmxlIEhUVFAvMiBhbmQgSFRUUC8zIGZvciBiZXR0ZXIgcGVyZm9ybWFuY2VcbiAgICAgIGh0dHBWZXJzaW9uOiBjbG91ZGZyb250Lkh0dHBWZXJzaW9uLkhUVFAyX0FORF8zLFxuICAgICAgLy8gUHJpY2UgY2xhc3MgLSB1c2UgYWxsIGVkZ2UgbG9jYXRpb25zIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgICBwcmljZUNsYXNzOiBjbG91ZGZyb250LlByaWNlQ2xhc3MuUFJJQ0VfQ0xBU1NfQUxMLFxuICAgICAgLy8gTG9nZ2luZyBkaXNhYmxlZCBmb3IgZGVtbyBzaW1wbGljaXR5XG4gICAgICAvLyBDbG91ZEZyb250IHN0YW5kYXJkIGxvZ2dpbmcgcmVxdWlyZXMgQUNMLWVuYWJsZWQgYnVja2V0c1xuICAgICAgZW5hYmxlTG9nZ2luZzogZmFsc2UsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gT3V0cHV0c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEaXN0cmlidXRpb25Eb21haW5OYW1lJywge1xuICAgICAgdmFsdWU6IGRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZEZyb250IERpc3RyaWJ1dGlvbiBEb21haW4gTmFtZScsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMkRpc3RyaWJ1dGlvbkRvbWFpbicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGlzdHJpYnV0aW9uVXJsJywge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7ZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRGcm9udCBEaXN0cmlidXRpb24gVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyRGlzdHJpYnV0aW9uVXJsJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEaXN0cmlidXRpb25JZCcsIHtcbiAgICAgIHZhbHVlOiBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkRnJvbnQgRGlzdHJpYnV0aW9uIElEIChmb3IgY2FjaGUgaW52YWxpZGF0aW9uKScsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMkRpc3RyaWJ1dGlvbklkJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDb250ZW50QnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiBjb250ZW50QnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIENvbnRlbnQgQnVja2V0IE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJDb250ZW50QnVja2V0JyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQYXltZW50QXBpRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHtkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZX0vYXBpL2AsXG4gICAgICBkZXNjcmlwdGlvbjogJ1BheW1lbnQtcHJvdGVjdGVkIEFQSSBlbmRwb2ludCAocmVxdWlyZXMgeDQwMiBwYXltZW50KScsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheW1lbnRBcGlFbmRwb2ludCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2FjaGVQb2xpY3lTdW1tYXJ5Jywge1xuICAgICAgdmFsdWU6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcGF5bWVudEFwaTogJ05vIGNhY2hpbmcgKFRUTD0wKSAtIGVhY2ggcmVxdWVzdCByZXF1aXJlcyBwYXltZW50IHZlcmlmaWNhdGlvbicsXG4gICAgICAgIHN0YXRpY0Fzc2V0czogJ0xvbmctdGVybSBjYWNoaW5nIChkZWZhdWx0IDEgZGF5LCBtYXggMSB5ZWFyKScsXG4gICAgICAgIHB1YmxpY0NvbnRlbnQ6ICdTaG9ydC10ZXJtIGNhY2hpbmcgKGRlZmF1bHQgNSBtaW4sIG1heCAxIGhvdXIpJyxcbiAgICAgIH0pLFxuICAgICAgZGVzY3JpcHRpb246ICdTdW1tYXJ5IG9mIGNhY2hpbmcgcG9saWNpZXMgYXBwbGllZCB0byBkaWZmZXJlbnQgY29udGVudCB0eXBlcycsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==