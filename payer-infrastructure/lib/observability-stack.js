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
exports.ObservabilityStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const cloudwatch_actions = __importStar(require("aws-cdk-lib/aws-cloudwatch-actions"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
class ObservabilityStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        this.alarms = [];
        const cloudfrontDistId = props?.cloudfrontDistributionId || 'DISTRIBUTION_ID';
        const gatewayLogGroup = props?.gatewayLogGroupName || '/aws/bedrock-agentcore/gateway/x402-payer-agent';
        const enableAlerts = props?.enableAlerts !== false;
        // =========================================================================
        // SNS Topic for Alerts
        // =========================================================================
        if (enableAlerts) {
            this.alertTopic = new sns.Topic(this, 'X402AlertTopic', {
                topicName: 'x402-enterprise-demo-alerts',
                displayName: 'x402 Enterprise Demo Alerts',
            });
            // Add email subscription if provided
            if (props?.alertEmail) {
                new sns.Subscription(this, 'AlertEmailSubscription', {
                    topic: this.alertTopic,
                    protocol: sns.SubscriptionProtocol.EMAIL,
                    endpoint: props.alertEmail,
                });
            }
            // Create alerting rules
            this.createAlertingRules(cloudfrontDistId);
        }
        // =========================================================================
        // Main Overview Dashboard - End-to-End Payment Flow
        // =========================================================================
        this.mainDashboard = new cloudwatch.Dashboard(this, 'X402MainDashboard', {
            dashboardName: 'x402-enterprise-demo-overview',
        });
        // Header
        this.mainDashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: `# x402 Enterprise Demo - Overview Dashboard
Monitor the complete payment flow from payer agent to seller infrastructure.
        
**Architecture:** Payer Agent (AgentCore) → CloudFront (Seller) → AWS WAF (native x402 monetization)`,
            width: 24,
            height: 2,
        }));
        // Key Metrics Summary Row
        this.mainDashboard.addWidgets(new cloudwatch.SingleValueWidget({
            title: 'Total Requests (24h)',
            metrics: [
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'RequestCount',
                    statistic: 'Sum',
                    period: cdk.Duration.hours(24),
                }),
            ],
            width: 6,
            height: 4,
        }), new cloudwatch.SingleValueWidget({
            title: 'Payments Settled (24h)',
            metrics: [
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'PaymentSettled',
                    statistic: 'Sum',
                    period: cdk.Duration.hours(24),
                }),
            ],
            width: 6,
            height: 4,
        }), new cloudwatch.SingleValueWidget({
            title: 'Payment Success Rate',
            metrics: [
                new cloudwatch.MathExpression({
                    expression: '100 * settled / (settled + failed)',
                    usingMetrics: {
                        settled: new cloudwatch.Metric({
                            namespace: 'X402/PaymentVerifier',
                            metricName: 'PaymentSettled',
                            statistic: 'Sum',
                            period: cdk.Duration.hours(1),
                        }),
                        failed: new cloudwatch.Metric({
                            namespace: 'X402/PaymentVerifier',
                            metricName: 'PaymentFailed',
                            statistic: 'Sum',
                            period: cdk.Duration.hours(1),
                        }),
                    },
                    label: 'Success Rate %',
                    period: cdk.Duration.hours(1),
                }),
            ],
            width: 6,
            height: 4,
        }), new cloudwatch.SingleValueWidget({
            title: 'Avg Latency (ms)',
            metrics: [
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'Latency',
                    statistic: 'Average',
                    period: cdk.Duration.hours(1),
                }),
            ],
            width: 6,
            height: 4,
        }));
        // Payment Flow Section
        this.mainDashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '## Payment Flow Metrics',
            width: 24,
            height: 1,
        }));
        this.mainDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Payment Flow Funnel',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'RequestCount',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Total Requests',
                    color: '#2ca02c',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'PaymentRequired',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: '402 Responses',
                    color: '#ff7f0e',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'PaymentReceived',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Payments Received',
                    color: '#1f77b4',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'PaymentVerified',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Payments Verified',
                    color: '#9467bd',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'PaymentSettled',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Payments Settled',
                    color: '#17becf',
                }),
            ],
            width: 12,
            height: 8,
        }), new cloudwatch.GraphWidget({
            title: 'Errors & Failures',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'PaymentFailed',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Payment Failed',
                    color: '#d62728',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'ValidationError',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Validation Errors',
                    color: '#ff9896',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'FacilitatorError',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Facilitator Errors',
                    color: '#e377c2',
                }),
            ],
            width: 12,
            height: 8,
        }));
        // Latency Section
        this.mainDashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '## Latency Metrics',
            width: 24,
            height: 1,
        }));
        this.mainDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'End-to-End Latency',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'Latency',
                    statistic: 'Average',
                    period: cdk.Duration.minutes(1),
                    label: 'Average',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'Latency',
                    statistic: 'p50',
                    period: cdk.Duration.minutes(1),
                    label: 'p50',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'Latency',
                    statistic: 'p90',
                    period: cdk.Duration.minutes(1),
                    label: 'p90',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'Latency',
                    statistic: 'p99',
                    period: cdk.Duration.minutes(1),
                    label: 'p99',
                }),
            ],
            width: 8,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Verification Latency',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'VerificationLatency',
                    statistic: 'Average',
                    period: cdk.Duration.minutes(1),
                    label: 'Average',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'VerificationLatency',
                    statistic: 'p99',
                    period: cdk.Duration.minutes(1),
                    label: 'p99',
                }),
            ],
            width: 8,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Settlement Latency',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'SettlementLatency',
                    statistic: 'Average',
                    period: cdk.Duration.minutes(1),
                    label: 'Average',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'SettlementLatency',
                    statistic: 'p99',
                    period: cdk.Duration.minutes(1),
                    label: 'p99',
                }),
            ],
            width: 8,
            height: 6,
        }));
        // =========================================================================
        // Payer Agent Dashboard
        // =========================================================================
        this.payerDashboard = new cloudwatch.Dashboard(this, 'X402PayerDashboard', {
            dashboardName: 'x402-payer-agent',
        });
        this.payerDashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: `# x402 Payer Agent Dashboard
Monitor the AgentCore-based payer agent that handles payment signing and content requests.`,
            width: 24,
            height: 2,
        }));
        // AgentCore Gateway Metrics
        this.payerDashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '## AgentCore Gateway',
            width: 24,
            height: 1,
        }));
        this.payerDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Gateway Request Rate',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent/Gateway/RateLimiting',
                    metricName: 'TotalRequests',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(1),
                    label: 'Requests/min',
                }),
            ],
            width: 12,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Throttled Requests',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent/Gateway/RateLimiting',
                    metricName: 'ThrottledRequests',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(1),
                    label: 'Throttled',
                    color: '#d62728',
                }),
            ],
            width: 12,
            height: 6,
        }));
        // Gateway Logs
        this.payerDashboard.addWidgets(new cloudwatch.LogQueryWidget({
            title: 'Recent Gateway Activity',
            logGroupNames: [gatewayLogGroup],
            queryLines: [
                'fields @timestamp, @message',
                'filter @message like /InvokeAgent|payment|error/i',
                'sort @timestamp desc',
                'limit 50',
            ],
            width: 24,
            height: 8,
        }));
        // =========================================================================
        // Seller Infrastructure Dashboard
        // =========================================================================
        this.sellerDashboard = new cloudwatch.Dashboard(this, 'X402SellerDashboard', {
            dashboardName: 'x402-seller-infrastructure',
        });
        this.sellerDashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: `# x402 Seller Infrastructure Dashboard
Monitor the CloudFront distribution and the AWS WAF WebACL that performs native x402 monetization.`,
            width: 24,
            height: 2,
        }));
        // CloudFront Metrics
        this.sellerDashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '## CloudFront Distribution',
            width: 24,
            height: 1,
        }));
        this.sellerDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'CloudFront Requests',
            left: [
                new cloudwatch.Metric({
                    namespace: 'AWS/CloudFront',
                    metricName: 'Requests',
                    dimensionsMap: {
                        DistributionId: cloudfrontDistId,
                        Region: 'Global',
                    },
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Total Requests',
                }),
            ],
            width: 8,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'CloudFront Error Rate',
            left: [
                new cloudwatch.Metric({
                    namespace: 'AWS/CloudFront',
                    metricName: '4xxErrorRate',
                    dimensionsMap: {
                        DistributionId: cloudfrontDistId,
                        Region: 'Global',
                    },
                    statistic: 'Average',
                    period: cdk.Duration.minutes(5),
                    label: '4xx Error Rate',
                    color: '#ff7f0e',
                }),
                new cloudwatch.Metric({
                    namespace: 'AWS/CloudFront',
                    metricName: '5xxErrorRate',
                    dimensionsMap: {
                        DistributionId: cloudfrontDistId,
                        Region: 'Global',
                    },
                    statistic: 'Average',
                    period: cdk.Duration.minutes(5),
                    label: '5xx Error Rate',
                    color: '#d62728',
                }),
            ],
            width: 8,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Cache Hit Rate',
            left: [
                new cloudwatch.Metric({
                    namespace: 'AWS/CloudFront',
                    metricName: 'CacheHitRate',
                    dimensionsMap: {
                        DistributionId: cloudfrontDistId,
                        Region: 'Global',
                    },
                    statistic: 'Average',
                    period: cdk.Duration.minutes(5),
                    label: 'Cache Hit Rate',
                    color: '#2ca02c',
                }),
            ],
            width: 8,
            height: 6,
        }));
        // Payment Monetization (AWS WAF) Metrics
        //
        // The seller side is now gated by a CLOUDFRONT-scoped WAFv2 WebACL (no
        // Lambda@Edge), which emits metrics in the AWS/WAFV2 namespace per rule
        // (CountedRequests / AllowedRequests / BlockedRequests, dimensioned by
        // WebACL + Rule + Region=Global). The WebACL name carries a deploy-time
        // suffix, so the WebACL dimension is left as a placeholder for the operator
        // to fill in; the per-tier rule names are x402seller-monetize-<tier>.
        this.sellerDashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: `## Payment Monetization (AWS WAF)
Tracks the WAF WebACL that gates paid content. Replace the \`WebACL\` dimension below with your deployed WebACL name (\`x402-seller-acl-<suffix>\`). Per-rule metric names are prefixed \`x402seller-*\` (e.g. \`x402seller-monetize-article\`).`,
            width: 24,
            height: 2,
        }));
        this.sellerDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'WAF Request Disposition',
            left: [
                new cloudwatch.Metric({
                    namespace: 'AWS/WAFV2',
                    metricName: 'CountedRequests',
                    dimensionsMap: {
                        WebACL: 'x402-seller-acl',
                        Rule: 'AWSBotControl',
                        Region: 'Global',
                    },
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Bots Detected (Counted)',
                    color: '#ff7f0e',
                }),
                new cloudwatch.Metric({
                    namespace: 'AWS/WAFV2',
                    metricName: 'AllowedRequests',
                    dimensionsMap: {
                        WebACL: 'x402-seller-acl',
                        Rule: 'human-allow',
                        Region: 'Global',
                    },
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Humans Allowed',
                    color: '#1f77b4',
                }),
                new cloudwatch.Metric({
                    namespace: 'AWS/WAFV2',
                    metricName: 'AllowedRequests',
                    dimensionsMap: {
                        WebACL: 'x402-seller-acl',
                        Rule: 'allow-discovery',
                        Region: 'Global',
                    },
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Discovery Allowed',
                    color: '#2ca02c',
                }),
            ],
            width: 12,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Content Delivery',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'ContentGenerated',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Content Generated',
                    color: '#17becf',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'ContentCacheHit',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Cache Hits',
                    color: '#bcbd22',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'S3FetchSuccess',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'S3 Fetches',
                    color: '#9467bd',
                }),
            ],
            width: 12,
            height: 6,
        }));
        // Payment Verification by Network/Asset
        this.sellerDashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '## Payment Details by Network',
            width: 24,
            height: 1,
        }));
        this.sellerDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Payments by Network (Base Sepolia)',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'PaymentSettled',
                    dimensionsMap: {
                        Network: 'eip155:84532',
                    },
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Base Sepolia',
                }),
            ],
            width: 12,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Validation Errors by Type',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'ValidationError',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Validation Errors',
                    color: '#d62728',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'AuthorizationExpired',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Auth Expired',
                    color: '#ff7f0e',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'SignatureInvalid',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Invalid Signature',
                    color: '#9467bd',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'AmountInsufficient',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Insufficient Amount',
                    color: '#e377c2',
                }),
            ],
            width: 12,
            height: 6,
        }));
        // Custom Metrics Section - Payment Amounts and Content
        this.sellerDashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '## Custom Metrics - Payment Amounts & Content',
            width: 24,
            height: 1,
        }));
        this.sellerDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Payment Amounts (Wei)',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'PaymentAmountWei',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Total Wei',
                    color: '#2ca02c',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'PaymentAmountWei',
                    statistic: 'Average',
                    period: cdk.Duration.minutes(5),
                    label: 'Avg Wei per Payment',
                    color: '#1f77b4',
                }),
            ],
            width: 12,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Content Delivery',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'ContentBytesServed',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Total Bytes',
                    color: '#17becf',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402/PaymentVerifier',
                    metricName: 'ContentBytesServed',
                    statistic: 'Average',
                    period: cdk.Duration.minutes(5),
                    label: 'Avg Bytes per Request',
                    color: '#bcbd22',
                }),
            ],
            width: 12,
            height: 6,
        }));
        // =========================================================================
        // Payer Agent Custom Metrics Dashboard Section
        // =========================================================================
        this.payerDashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '## Payer Agent Custom Metrics',
            width: 24,
            height: 1,
        }));
        this.payerDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Payment Analysis Decisions',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'PaymentAnalysisCount',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Total Analyses',
                    color: '#1f77b4',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'PaymentApproved',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Approved',
                    color: '#2ca02c',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'PaymentRejected',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Rejected',
                    color: '#d62728',
                }),
            ],
            width: 12,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Payment Signing Operations',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'PaymentSigningCount',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Total Signings',
                    color: '#1f77b4',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'PaymentSigningSuccess',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Success',
                    color: '#2ca02c',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'PaymentSigningFailure',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Failure',
                    color: '#d62728',
                }),
            ],
            width: 12,
            height: 6,
        }));
        this.payerDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Content Request Outcomes',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'ContentRequestCount',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Total Requests',
                    color: '#1f77b4',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'ContentRequestSuccess',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Success (200)',
                    color: '#2ca02c',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'ContentRequest402',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Payment Required (402)',
                    color: '#ff7f0e',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'ContentRequestError',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Errors',
                    color: '#d62728',
                }),
            ],
            width: 12,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Wallet Operations',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'WalletBalanceCheck',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Balance Checks',
                    color: '#1f77b4',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'FaucetRequestSuccess',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Faucet Success',
                    color: '#2ca02c',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'FaucetRequestFailure',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Faucet Failure',
                    color: '#d62728',
                }),
            ],
            width: 12,
            height: 6,
        }));
        // Payer Agent Latency Metrics
        this.payerDashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '## Payer Agent Latency Metrics',
            width: 24,
            height: 1,
        }));
        this.payerDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Payment Analysis Latency',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'PaymentAnalysisLatency',
                    statistic: 'Average',
                    period: cdk.Duration.minutes(1),
                    label: 'Average',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'PaymentAnalysisLatency',
                    statistic: 'p99',
                    period: cdk.Duration.minutes(1),
                    label: 'p99',
                }),
            ],
            width: 8,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Payment Signing Latency',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'PaymentSigningLatency',
                    statistic: 'Average',
                    period: cdk.Duration.minutes(1),
                    label: 'Average',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'PaymentSigningLatency',
                    statistic: 'p99',
                    period: cdk.Duration.minutes(1),
                    label: 'p99',
                }),
            ],
            width: 8,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Content Request Latency',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'ContentRequestLatency',
                    statistic: 'Average',
                    period: cdk.Duration.minutes(1),
                    label: 'Average',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'ContentRequestLatency',
                    statistic: 'p99',
                    period: cdk.Duration.minutes(1),
                    label: 'p99',
                }),
            ],
            width: 8,
            height: 6,
        }));
        // Wallet Balance Tracking
        this.payerDashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '## Wallet Balance Tracking',
            width: 24,
            height: 1,
        }));
        this.payerDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Wallet Balance (ETH)',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'WalletBalanceETH',
                    statistic: 'Average',
                    period: cdk.Duration.minutes(5),
                    label: 'Balance',
                    color: '#2ca02c',
                }),
            ],
            width: 12,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Payment Amounts (ETH)',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'PaymentAmountETH',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(5),
                    label: 'Total Paid',
                    color: '#ff7f0e',
                }),
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent',
                    metricName: 'PaymentAmountETH',
                    statistic: 'Average',
                    period: cdk.Duration.minutes(5),
                    label: 'Avg per Payment',
                    color: '#1f77b4',
                }),
            ],
            width: 12,
            height: 6,
        }));
        // =========================================================================
        // Outputs
        // =========================================================================
        new cdk.CfnOutput(this, 'MainDashboardUrl', {
            value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=x402-enterprise-demo-overview`,
            description: 'Main Overview Dashboard URL',
            exportName: 'X402MainDashboardUrl',
        });
        new cdk.CfnOutput(this, 'PayerDashboardUrl', {
            value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=x402-payer-agent`,
            description: 'Payer Agent Dashboard URL',
            exportName: 'X402PayerDashboardUrl',
        });
        new cdk.CfnOutput(this, 'SellerDashboardUrl', {
            value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=x402-seller-infrastructure`,
            description: 'Seller Infrastructure Dashboard URL',
            exportName: 'X402SellerDashboardUrl',
        });
        // Alert topic output
        if (this.alertTopic) {
            new cdk.CfnOutput(this, 'AlertTopicArn', {
                value: this.alertTopic.topicArn,
                description: 'SNS Topic ARN for alerts',
                exportName: 'X402AlertTopicArn',
            });
        }
    }
    /**
     * Create CloudWatch alerting rules for the x402 demo.
     *
     * Alerts are organized into categories:
     * - Payment Flow Alerts: Payment failures, verification errors
     * - Performance Alerts: High latency, throttling
     * - Availability Alerts: Error rates, service health
     * - Wallet Alerts: Low balance warnings
     */
    createAlertingRules(cloudfrontDistId) {
        // =========================================================================
        // Payment Flow Alerts
        // =========================================================================
        // Alert: High Payment Failure Rate
        const paymentFailureAlarm = new cloudwatch.Alarm(this, 'PaymentFailureRateAlarm', {
            alarmName: 'x402-high-payment-failure-rate',
            alarmDescription: 'Payment failure rate exceeds 10% over 5 minutes',
            metric: new cloudwatch.MathExpression({
                expression: '100 * failed / (settled + failed + 0.001)',
                usingMetrics: {
                    settled: new cloudwatch.Metric({
                        namespace: 'X402/PaymentVerifier',
                        metricName: 'PaymentSettled',
                        statistic: 'Sum',
                        period: cdk.Duration.minutes(5),
                    }),
                    failed: new cloudwatch.Metric({
                        namespace: 'X402/PaymentVerifier',
                        metricName: 'PaymentFailed',
                        statistic: 'Sum',
                        period: cdk.Duration.minutes(5),
                    }),
                },
                label: 'Payment Failure Rate %',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 10,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.alarms.push(paymentFailureAlarm);
        // Alert: Payment Verification Errors
        const verificationErrorAlarm = new cloudwatch.Alarm(this, 'VerificationErrorAlarm', {
            alarmName: 'x402-payment-verification-errors',
            alarmDescription: 'More than 5 payment verification errors in 5 minutes',
            metric: new cloudwatch.Metric({
                namespace: 'X402/PaymentVerifier',
                metricName: 'ValidationError',
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 5,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.alarms.push(verificationErrorAlarm);
        // Alert: Facilitator Errors
        const facilitatorErrorAlarm = new cloudwatch.Alarm(this, 'FacilitatorErrorAlarm', {
            alarmName: 'x402-facilitator-errors',
            alarmDescription: 'Facilitator service errors detected',
            metric: new cloudwatch.Metric({
                namespace: 'X402/PaymentVerifier',
                metricName: 'FacilitatorError',
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 3,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.alarms.push(facilitatorErrorAlarm);
        // =========================================================================
        // Performance Alerts
        // =========================================================================
        // Alert: High End-to-End Latency
        const highLatencyAlarm = new cloudwatch.Alarm(this, 'HighLatencyAlarm', {
            alarmName: 'x402-high-latency',
            alarmDescription: 'P99 latency exceeds 5 seconds',
            metric: new cloudwatch.Metric({
                namespace: 'X402/PaymentVerifier',
                metricName: 'Latency',
                statistic: 'p99',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 5000, // 5 seconds in milliseconds
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.alarms.push(highLatencyAlarm);
        // Alert: Payment Signing Latency
        const signingLatencyAlarm = new cloudwatch.Alarm(this, 'SigningLatencyAlarm', {
            alarmName: 'x402-high-signing-latency',
            alarmDescription: 'Payment signing P99 latency exceeds 3 seconds',
            metric: new cloudwatch.Metric({
                namespace: 'X402PayerAgent',
                metricName: 'PaymentSigningLatency',
                statistic: 'p99',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 3000, // 3 seconds
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.alarms.push(signingLatencyAlarm);
        // Alert: Gateway Throttling
        const throttlingAlarm = new cloudwatch.Alarm(this, 'ThrottlingAlarm', {
            alarmName: 'x402-gateway-throttling',
            alarmDescription: 'Gateway is throttling requests',
            metric: new cloudwatch.Metric({
                namespace: 'X402PayerAgent/Gateway/RateLimiting',
                metricName: 'ThrottledRequests',
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 10,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.alarms.push(throttlingAlarm);
        // =========================================================================
        // Availability Alerts
        // =========================================================================
        // Alert: CloudFront 5xx Error Rate
        const cloudfront5xxAlarm = new cloudwatch.Alarm(this, 'CloudFront5xxAlarm', {
            alarmName: 'x402-cloudfront-5xx-errors',
            alarmDescription: 'CloudFront 5xx error rate exceeds 5%',
            metric: new cloudwatch.Metric({
                namespace: 'AWS/CloudFront',
                metricName: '5xxErrorRate',
                dimensionsMap: {
                    DistributionId: cloudfrontDistId,
                    Region: 'Global',
                },
                statistic: 'Average',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 5,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.alarms.push(cloudfront5xxAlarm);
        // Alert: Agent Errors
        const agentErrorAlarm = new cloudwatch.Alarm(this, 'AgentErrorAlarm', {
            alarmName: 'x402-agent-errors',
            alarmDescription: 'Payer agent errors detected',
            metric: new cloudwatch.Metric({
                namespace: 'X402PayerAgent',
                metricName: 'AgentErrorCount',
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 5,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.alarms.push(agentErrorAlarm);
        // Alert: Content Request Errors
        const contentErrorAlarm = new cloudwatch.Alarm(this, 'ContentErrorAlarm', {
            alarmName: 'x402-content-request-errors',
            alarmDescription: 'High rate of content request errors',
            metric: new cloudwatch.Metric({
                namespace: 'X402PayerAgent',
                metricName: 'ContentRequestError',
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 10,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.alarms.push(contentErrorAlarm);
        // =========================================================================
        // Wallet Alerts
        // =========================================================================
        // Alert: Low Wallet Balance
        const lowBalanceAlarm = new cloudwatch.Alarm(this, 'LowWalletBalanceAlarm', {
            alarmName: 'x402-low-wallet-balance',
            alarmDescription: 'Wallet balance is below 0.01 ETH',
            metric: new cloudwatch.Metric({
                namespace: 'X402PayerAgent',
                metricName: 'WalletBalanceETH',
                statistic: 'Average',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 0.01,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.alarms.push(lowBalanceAlarm);
        // Alert: Faucet Request Failures
        const faucetFailureAlarm = new cloudwatch.Alarm(this, 'FaucetFailureAlarm', {
            alarmName: 'x402-faucet-failures',
            alarmDescription: 'Faucet requests are failing',
            metric: new cloudwatch.Metric({
                namespace: 'X402PayerAgent',
                metricName: 'FaucetRequestFailure',
                statistic: 'Sum',
                period: cdk.Duration.minutes(15),
            }),
            threshold: 3,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.alarms.push(faucetFailureAlarm);
        // =========================================================================
        // Payment Signing Alerts
        // =========================================================================
        // Alert: Payment Signing Failures
        const signingFailureAlarm = new cloudwatch.Alarm(this, 'SigningFailureAlarm', {
            alarmName: 'x402-signing-failures',
            alarmDescription: 'Payment signing operations are failing',
            metric: new cloudwatch.Metric({
                namespace: 'X402PayerAgent',
                metricName: 'PaymentSigningFailure',
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 3,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.alarms.push(signingFailureAlarm);
        // =========================================================================
        // Composite Alarm: Overall System Health
        // =========================================================================
        const systemHealthAlarm = new cloudwatch.CompositeAlarm(this, 'SystemHealthAlarm', {
            compositeAlarmName: 'x402-system-health',
            alarmDescription: 'Overall system health - triggers when multiple issues detected',
            alarmRule: cloudwatch.AlarmRule.anyOf(cloudwatch.AlarmRule.fromAlarm(paymentFailureAlarm, cloudwatch.AlarmState.ALARM), cloudwatch.AlarmRule.fromAlarm(cloudfront5xxAlarm, cloudwatch.AlarmState.ALARM), cloudwatch.AlarmRule.fromAlarm(agentErrorAlarm, cloudwatch.AlarmState.ALARM)),
        });
        // =========================================================================
        // Add SNS Actions to All Alarms
        // =========================================================================
        if (this.alertTopic) {
            const snsAction = new cloudwatch_actions.SnsAction(this.alertTopic);
            for (const alarm of this.alarms) {
                alarm.addAlarmAction(snsAction);
                alarm.addOkAction(snsAction);
            }
            systemHealthAlarm.addAlarmAction(snsAction);
            systemHealthAlarm.addOkAction(snsAction);
        }
    }
}
exports.ObservabilityStack = ObservabilityStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2YWJpbGl0eS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm9ic2VydmFiaWxpdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHVFQUF5RDtBQUN6RCx1RkFBeUU7QUFDekUseURBQTJDO0FBdUIzQyxNQUFhLGtCQUFtQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBTy9DLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBK0I7UUFDdkUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFIVixXQUFNLEdBQXVCLEVBQUUsQ0FBQztRQUs5QyxNQUFNLGdCQUFnQixHQUFHLEtBQUssRUFBRSx3QkFBd0IsSUFBSSxpQkFBaUIsQ0FBQztRQUM5RSxNQUFNLGVBQWUsR0FBRyxLQUFLLEVBQUUsbUJBQW1CLElBQUksaURBQWlELENBQUM7UUFDeEcsTUFBTSxZQUFZLEdBQUcsS0FBSyxFQUFFLFlBQVksS0FBSyxLQUFLLENBQUM7UUFFbkQsNEVBQTRFO1FBQzVFLHVCQUF1QjtRQUN2Qiw0RUFBNEU7UUFDNUUsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUNqQixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7Z0JBQ3RELFNBQVMsRUFBRSw2QkFBNkI7Z0JBQ3hDLFdBQVcsRUFBRSw2QkFBNkI7YUFDM0MsQ0FBQyxDQUFDO1lBRUgscUNBQXFDO1lBQ3JDLElBQUksS0FBSyxFQUFFLFVBQVUsRUFBRSxDQUFDO2dCQUN0QixJQUFJLEdBQUcsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLHdCQUF3QixFQUFFO29CQUNuRCxLQUFLLEVBQUUsSUFBSSxDQUFDLFVBQVU7b0JBQ3RCLFFBQVEsRUFBRSxHQUFHLENBQUMsb0JBQW9CLENBQUMs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QyxVQUFVLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxtQkFBbUIsRUFBRSxVQUFVLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxFQUNoRixVQUFVLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxrQkFBa0IsRUFBRSxVQUFVLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxFQUMvRSxVQUFVLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxlQUFlLEVBQUUsVUFBVSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FDN0U7U0FDRixDQUFDLENBQUM7UUFFSCw0RUFBNEU7UUFDNUUsZ0NBQWdDO1FBQ2hDLDRFQUE0RTtRQUM1RSxJQUFJLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNwQixNQUFNLFNBQVMsR0FBRyxJQUFJLGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7WUFFcEUsS0FBSyxNQUFNLEtBQUssSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7Z0JBQ2hDLEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLENBQUM7Z0JBQ2hDLEtBQUssQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUM7WUFDL0IsQ0FBQztZQUVELGlCQUFpQixDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUM1QyxpQkFBaUIsQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDM0MsQ0FBQztJQUNILENBQUM7Q0FDRjtBQS92Q0QsZ0RBK3ZDQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoJztcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2hfYWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaC1hY3Rpb25zJztcbmltcG9ydCAqIGFzIHNucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG4vKipcbiAqIENsb3VkV2F0Y2ggT2JzZXJ2YWJpbGl0eSBTdGFjayBmb3IgeDQwMiBFbnRlcnByaXNlIERlbW9cbiAqIFxuICogVGhpcyBzdGFjayBjcmVhdGVzIGNvbXByZWhlbnNpdmUgZGFzaGJvYXJkcyBmb3IgbW9uaXRvcmluZzpcbiAqIC0gUGF5ZXIgQWdlbnQgKEFnZW50Q29yZSBHYXRld2F5KSBtZXRyaWNzXG4gKiAtIFNlbGxlciBJbmZyYXN0cnVjdHVyZSAoQ2xvdWRGcm9udCArIEFXUyBXQUYgbmF0aXZlIHg0MDIgbW9uZXRpemF0aW9uKSBtZXRyaWNzXG4gKiAtIEVuZC10by1lbmQgcGF5bWVudCBmbG93IG1ldHJpY3NcbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIE9ic2VydmFiaWxpdHlTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICAvKiogQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gSUQgZm9yIHNlbGxlciBpbmZyYXN0cnVjdHVyZSAqL1xuICBjbG91ZGZyb250RGlzdHJpYnV0aW9uSWQ/OiBzdHJpbmc7XG4gIC8qKiBHYXRld2F5IGxvZyBncm91cCBuYW1lICovXG4gIGdhdGV3YXlMb2dHcm91cE5hbWU/OiBzdHJpbmc7XG4gIC8qKiBFbWFpbCBhZGRyZXNzIGZvciBhbGVydCBub3RpZmljYXRpb25zIChvcHRpb25hbCkgKi9cbiAgYWxlcnRFbWFpbD86IHN0cmluZztcbiAgLyoqIEVuYWJsZSBhbGVydGluZyBydWxlcyAoZGVmYXVsdDogdHJ1ZSkgKi9cbiAgZW5hYmxlQWxlcnRzPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGNsYXNzIE9ic2VydmFiaWxpdHlTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBtYWluRGFzaGJvYXJkOiBjbG91ZHdhdGNoLkRhc2hib2FyZDtcbiAgcHVibGljIHJlYWRvbmx5IHBheWVyRGFzaGJvYXJkOiBjbG91ZHdhdGNoLkRhc2hib2FyZDtcbiAgcHVibGljIHJlYWRvbmx5IHNlbGxlckRhc2hib2FyZDogY2xvdWR3YXRjaC5EYXNoYm9hcmQ7XG4gIHB1YmxpYyByZWFkb25seSBhbGVydFRvcGljPzogc25zLlRvcGljO1xuICBwdWJsaWMgcmVhZG9ubHkgYWxhcm1zOiBjbG91ZHdhdGNoLkFsYXJtW10gPSBbXTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IE9ic2VydmFiaWxpdHlTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCBjbG91ZGZyb250RGlzdElkID0gcHJvcHM/LmNsb3VkZnJvbnREaXN0cmlidXRpb25JZCB8fCAnRElTVFJJQlVUSU9OX0lEJztcbiAgICBjb25zdCBnYXRld2F5TG9nR3JvdXAgPSBwcm9wcz8uZ2F0ZXdheUxvZ0dyb3VwTmFtZSB8fCAnL2F3cy9iZWRyb2NrLWFnZW50Y29yZS9nYXRld2F5L3g0MDItcGF5ZXItYWdlbnQnO1xuICAgIGNvbnN0IGVuYWJsZUFsZXJ0cyA9IHByb3BzPy5lbmFibGVBbGVydHMgIT09IGZhbHNlO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFNOUyBUb3BpYyBmb3IgQWxlcnRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGlmIChlbmFibGVBbGVydHMpIHtcbiAgICAgIHRoaXMuYWxlcnRUb3BpYyA9IG5ldyBzbnMuVG9waWModGhpcywgJ1g0MDJBbGVydFRvcGljJywge1xuICAgICAgICB0b3BpY05hbWU6ICd4NDAyLWVudGVycHJpc2UtZGVtby1hbGVydHMnLFxuICAgICAgICBkaXNwbGF5TmFtZTogJ3g0MDIgRW50ZXJwcmlzZSBEZW1vIEFsZXJ0cycsXG4gICAgICB9KTtcblxuICAgICAgLy8gQWRkIGVtYWlsIHN1YnNjcmlwdGlvbiBpZiBwcm92aWRlZFxuICAgICAgaWYgKHByb3BzPy5hbGVydEVtYWlsKSB7XG4gICAgICAgIG5ldyBzbnMuU3Vic2NyaXB0aW9uKHRoaXMsICdBbGVydEVtYWlsU3Vic2NyaXB0aW9uJywge1xuICAgICAgICAgIHRvcGljOiB0aGlzLmFsZXJ0VG9waWMsXG4gICAgICAgICAgcHJvdG9jb2w6IHNucy5TdWJzY3JpcHRpb25Qcm90b2NvbC5FTUFJTCxcbiAgICAgICAgICBlbmRwb2ludDogcHJvcHMuYWxlcnRFbWFpbCxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIENyZWF0ZSBhbGVydGluZyBydWxlc1xuICAgICAgdGhpcy5jcmVhdGVBbGVydGluZ1J1bGVzKGNsb3VkZnJvbnREaXN0SWQpO1xuICAgIH1cblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBNYWluIE92ZXJ2aWV3IERhc2hib2FyZCAtIEVuZC10by1FbmQgUGF5bWVudCBGbG93XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIHRoaXMubWFpbkRhc2hib2FyZCA9IG5ldyBjbG91ZHdhdGNoLkRhc2hib2FyZCh0aGlzLCAnWDQwMk1haW5EYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiAneDQwMi1lbnRlcnByaXNlLWRlbW8tb3ZlcnZpZXcnLFxuICAgIH0pO1xuXG4gICAgLy8gSGVhZGVyXG4gICAgdGhpcy5tYWluRGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246IGAjIHg0MDIgRW50ZXJwcmlzZSBEZW1vIC0gT3ZlcnZpZXcgRGFzaGJvYXJkXG5Nb25pdG9yIHRoZSBjb21wbGV0ZSBwYXltZW50IGZsb3cgZnJvbSBwYXllciBhZ2VudCB0byBzZWxsZXIgaW5mcmFzdHJ1Y3R1cmUuXG4gICAgICAgIFxuKipBcmNoaXRlY3R1cmU6KiogUGF5ZXIgQWdlbnQgKEFnZW50Q29yZSkg4oaSIENsb3VkRnJvbnQgKFNlbGxlcikg4oaSIEFXUyBXQUYgKG5hdGl2ZSB4NDAyIG1vbmV0aXphdGlvbilgLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyBLZXkgTWV0cmljcyBTdW1tYXJ5IFJvd1xuICAgIHRoaXMubWFpbkRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guU2luZ2xlVmFsdWVXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1RvdGFsIFJlcXVlc3RzICgyNGgpJyxcbiAgICAgICAgbWV0cmljczogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUmVxdWVzdENvdW50JyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygyNCksXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiA2LFxuICAgICAgICBoZWlnaHQ6IDQsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlNpbmdsZVZhbHVlV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdQYXltZW50cyBTZXR0bGVkICgyNGgpJyxcbiAgICAgICAgbWV0cmljczogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUGF5bWVudFNldHRsZWQnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDI0KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDYsXG4gICAgICAgIGhlaWdodDogNCxcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guU2luZ2xlVmFsdWVXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1BheW1lbnQgU3VjY2VzcyBSYXRlJyxcbiAgICAgICAgbWV0cmljczogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1hdGhFeHByZXNzaW9uKHtcbiAgICAgICAgICAgIGV4cHJlc3Npb246ICcxMDAgKiBzZXR0bGVkIC8gKHNldHRsZWQgKyBmYWlsZWQpJyxcbiAgICAgICAgICAgIHVzaW5nTWV0cmljczoge1xuICAgICAgICAgICAgICBzZXR0bGVkOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnUGF5bWVudFNldHRsZWQnLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBmYWlsZWQ6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMi9QYXltZW50VmVyaWZpZXInLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50RmFpbGVkJyxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsYWJlbDogJ1N1Y2Nlc3MgUmF0ZSAlJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogNixcbiAgICAgICAgaGVpZ2h0OiA0LFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5TaW5nbGVWYWx1ZVdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnQXZnIExhdGVuY3kgKG1zKScsXG4gICAgICAgIG1ldHJpY3M6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMi9QYXltZW50VmVyaWZpZXInLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0xhdGVuY3knLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDYsXG4gICAgICAgIGhlaWdodDogNCxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyBQYXltZW50IEZsb3cgU2VjdGlvblxuICAgIHRoaXMubWFpbkRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgIG1hcmtkb3duOiAnIyMgUGF5bWVudCBGbG93IE1ldHJpY3MnLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLm1haW5EYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdQYXltZW50IEZsb3cgRnVubmVsJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUmVxdWVzdENvdW50JyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdUb3RhbCBSZXF1ZXN0cycsXG4gICAgICAgICAgICBjb2xvcjogJyMyY2EwMmMnLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUGF5bWVudFJlcXVpcmVkJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICc0MDIgUmVzcG9uc2VzJyxcbiAgICAgICAgICAgIGNvbG9yOiAnI2ZmN2YwZScsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50UmVjZWl2ZWQnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ1BheW1lbnRzIFJlY2VpdmVkJyxcbiAgICAgICAgICAgIGNvbG9yOiAnIzFmNzdiNCcsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50VmVyaWZpZWQnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ1BheW1lbnRzIFZlcmlmaWVkJyxcbiAgICAgICAgICAgIGNvbG9yOiAnIzk0NjdiZCcsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50U2V0dGxlZCcsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnUGF5bWVudHMgU2V0dGxlZCcsXG4gICAgICAgICAgICBjb2xvcjogJyMxN2JlY2YnLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogOCxcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0Vycm9ycyAmIEZhaWx1cmVzJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUGF5bWVudEZhaWxlZCcsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnUGF5bWVudCBGYWlsZWQnLFxuICAgICAgICAgICAgY29sb3I6ICcjZDYyNzI4JyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMi9QYXltZW50VmVyaWZpZXInLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ1ZhbGlkYXRpb25FcnJvcicsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnVmFsaWRhdGlvbiBFcnJvcnMnLFxuICAgICAgICAgICAgY29sb3I6ICcjZmY5ODk2JyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMi9QYXltZW50VmVyaWZpZXInLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0ZhY2lsaXRhdG9yRXJyb3InLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ0ZhY2lsaXRhdG9yIEVycm9ycycsXG4gICAgICAgICAgICBjb2xvcjogJyNlMzc3YzInLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogOCxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyBMYXRlbmN5IFNlY3Rpb25cbiAgICB0aGlzLm1haW5EYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgICBtYXJrZG93bjogJyMjIExhdGVuY3kgTWV0cmljcycsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMubWFpbkRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0VuZC10by1FbmQgTGF0ZW5jeScsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMi9QYXltZW50VmVyaWZpZXInLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0xhdGVuY3knLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgICAgICAgbGFiZWw6ICdBdmVyYWdlJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMi9QYXltZW50VmVyaWZpZXInLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0xhdGVuY3knLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAncDUwJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICAgICAgICBsYWJlbDogJ3A1MCcsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdMYXRlbmN5JyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ3A5MCcsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgICAgICAgbGFiZWw6ICdwOTAnLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnTGF0ZW5jeScsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdwOTknLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgICAgICAgIGxhYmVsOiAncDk5JyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDgsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1ZlcmlmaWNhdGlvbiBMYXRlbmN5JyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnVmVyaWZpY2F0aW9uTGF0ZW5jeScsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICAgICAgICBsYWJlbDogJ0F2ZXJhZ2UnLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnVmVyaWZpY2F0aW9uTGF0ZW5jeScsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdwOTknLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgICAgICAgIGxhYmVsOiAncDk5JyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDgsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1NldHRsZW1lbnQgTGF0ZW5jeScsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMi9QYXltZW50VmVyaWZpZXInLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ1NldHRsZW1lbnRMYXRlbmN5JyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgICAgICAgIGxhYmVsOiAnQXZlcmFnZScsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdTZXR0bGVtZW50TGF0ZW5jeScsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdwOTknLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgICAgICAgIGxhYmVsOiAncDk5JyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDgsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gUGF5ZXIgQWdlbnQgRGFzaGJvYXJkXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIHRoaXMucGF5ZXJEYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5EYXNoYm9hcmQodGhpcywgJ1g0MDJQYXllckRhc2hib2FyZCcsIHtcbiAgICAgIGRhc2hib2FyZE5hbWU6ICd4NDAyLXBheWVyLWFnZW50JyxcbiAgICB9KTtcblxuICAgIHRoaXMucGF5ZXJEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgICBtYXJrZG93bjogYCMgeDQwMiBQYXllciBBZ2VudCBEYXNoYm9hcmRcbk1vbml0b3IgdGhlIEFnZW50Q29yZS1iYXNlZCBwYXllciBhZ2VudCB0aGF0IGhhbmRsZXMgcGF5bWVudCBzaWduaW5nIGFuZCBjb250ZW50IHJlcXVlc3RzLmAsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiAyLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIEFnZW50Q29yZSBHYXRld2F5IE1ldHJpY3NcbiAgICB0aGlzLnBheWVyRGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246ICcjIyBBZ2VudENvcmUgR2F0ZXdheScsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMucGF5ZXJEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdHYXRld2F5IFJlcXVlc3QgUmF0ZScsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMlBheWVyQWdlbnQvR2F0ZXdheS9SYXRlTGltaXRpbmcnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ1RvdGFsUmVxdWVzdHMnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICAgICAgICBsYWJlbDogJ1JlcXVlc3RzL21pbicsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnVGhyb3R0bGVkIFJlcXVlc3RzJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudC9HYXRld2F5L1JhdGVMaW1pdGluZycsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnVGhyb3R0bGVkUmVxdWVzdHMnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICAgICAgICBsYWJlbDogJ1Rocm90dGxlZCcsXG4gICAgICAgICAgICBjb2xvcjogJyNkNjI3MjgnLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyBHYXRld2F5IExvZ3NcbiAgICB0aGlzLnBheWVyRGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5Mb2dRdWVyeVdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnUmVjZW50IEdhdGV3YXkgQWN0aXZpdHknLFxuICAgICAgICBsb2dHcm91cE5hbWVzOiBbZ2F0ZXdheUxvZ0dyb3VwXSxcbiAgICAgICAgcXVlcnlMaW5lczogW1xuICAgICAgICAgICdmaWVsZHMgQHRpbWVzdGFtcCwgQG1lc3NhZ2UnLFxuICAgICAgICAgICdmaWx0ZXIgQG1lc3NhZ2UgbGlrZSAvSW52b2tlQWdlbnR8cGF5bWVudHxlcnJvci9pJyxcbiAgICAgICAgICAnc29ydCBAdGltZXN0YW1wIGRlc2MnLFxuICAgICAgICAgICdsaW1pdCA1MCcsXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiA4LFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTZWxsZXIgSW5mcmFzdHJ1Y3R1cmUgRGFzaGJvYXJkXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIHRoaXMuc2VsbGVyRGFzaGJvYXJkID0gbmV3IGNsb3Vkd2F0Y2guRGFzaGJvYXJkKHRoaXMsICdYNDAyU2VsbGVyRGFzaGJvYXJkJywge1xuICAgICAgZGFzaGJvYXJkTmFtZTogJ3g0MDItc2VsbGVyLWluZnJhc3RydWN0dXJlJyxcbiAgICB9KTtcblxuICAgIHRoaXMuc2VsbGVyRGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246IGAjIHg0MDIgU2VsbGVyIEluZnJhc3RydWN0dXJlIERhc2hib2FyZFxuTW9uaXRvciB0aGUgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gYW5kIHRoZSBBV1MgV0FGIFdlYkFDTCB0aGF0IHBlcmZvcm1zIG5hdGl2ZSB4NDAyIG1vbmV0aXphdGlvbi5gLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyBDbG91ZEZyb250IE1ldHJpY3NcbiAgICB0aGlzLnNlbGxlckRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgIG1hcmtkb3duOiAnIyMgQ2xvdWRGcm9udCBEaXN0cmlidXRpb24nLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLnNlbGxlckRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0Nsb3VkRnJvbnQgUmVxdWVzdHMnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9DbG91ZEZyb250JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdSZXF1ZXN0cycsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgICAgIERpc3RyaWJ1dGlvbklkOiBjbG91ZGZyb250RGlzdElkLFxuICAgICAgICAgICAgICBSZWdpb246ICdHbG9iYWwnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdUb3RhbCBSZXF1ZXN0cycsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiA4LFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdDbG91ZEZyb250IEVycm9yIFJhdGUnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9DbG91ZEZyb250JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICc0eHhFcnJvclJhdGUnLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICBEaXN0cmlidXRpb25JZDogY2xvdWRmcm9udERpc3RJZCxcbiAgICAgICAgICAgICAgUmVnaW9uOiAnR2xvYmFsJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJzR4eCBFcnJvciBSYXRlJyxcbiAgICAgICAgICAgIGNvbG9yOiAnI2ZmN2YwZScsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9DbG91ZEZyb250JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICc1eHhFcnJvclJhdGUnLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICBEaXN0cmlidXRpb25JZDogY2xvdWRmcm9udERpc3RJZCxcbiAgICAgICAgICAgICAgUmVnaW9uOiAnR2xvYmFsJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJzV4eCBFcnJvciBSYXRlJyxcbiAgICAgICAgICAgIGNvbG9yOiAnI2Q2MjcyOCcsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiA4LFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdDYWNoZSBIaXQgUmF0ZScsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0Nsb3VkRnJvbnQnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0NhY2hlSGl0UmF0ZScsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgICAgIERpc3RyaWJ1dGlvbklkOiBjbG91ZGZyb250RGlzdElkLFxuICAgICAgICAgICAgICBSZWdpb246ICdHbG9iYWwnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnQ2FjaGUgSGl0IFJhdGUnLFxuICAgICAgICAgICAgY29sb3I6ICcjMmNhMDJjJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDgsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyBQYXltZW50IE1vbmV0aXphdGlvbiAoQVdTIFdBRikgTWV0cmljc1xuICAgIC8vXG4gICAgLy8gVGhlIHNlbGxlciBzaWRlIGlzIG5vdyBnYXRlZCBieSBhIENMT1VERlJPTlQtc2NvcGVkIFdBRnYyIFdlYkFDTCAobm9cbiAgICAvLyBMYW1iZGFARWRnZSksIHdoaWNoIGVtaXRzIG1ldHJpY3MgaW4gdGhlIEFXUy9XQUZWMiBuYW1lc3BhY2UgcGVyIHJ1bGVcbiAgICAvLyAoQ291bnRlZFJlcXVlc3RzIC8gQWxsb3dlZFJlcXVlc3RzIC8gQmxvY2tlZFJlcXVlc3RzLCBkaW1lbnNpb25lZCBieVxuICAgIC8vIFdlYkFDTCArIFJ1bGUgKyBSZWdpb249R2xvYmFsKS4gVGhlIFdlYkFDTCBuYW1lIGNhcnJpZXMgYSBkZXBsb3ktdGltZVxuICAgIC8vIHN1ZmZpeCwgc28gdGhlIFdlYkFDTCBkaW1lbnNpb24gaXMgbGVmdCBhcyBhIHBsYWNlaG9sZGVyIGZvciB0aGUgb3BlcmF0b3JcbiAgICAvLyB0byBmaWxsIGluOyB0aGUgcGVyLXRpZXIgcnVsZSBuYW1lcyBhcmUgeDQwMnNlbGxlci1tb25ldGl6ZS08dGllcj4uXG4gICAgdGhpcy5zZWxsZXJEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgICBtYXJrZG93bjogYCMjIFBheW1lbnQgTW9uZXRpemF0aW9uIChBV1MgV0FGKVxuVHJhY2tzIHRoZSBXQUYgV2ViQUNMIHRoYXQgZ2F0ZXMgcGFpZCBjb250ZW50LiBSZXBsYWNlIHRoZSBcXGBXZWJBQ0xcXGAgZGltZW5zaW9uIGJlbG93IHdpdGggeW91ciBkZXBsb3llZCBXZWJBQ0wgbmFtZSAoXFxgeDQwMi1zZWxsZXItYWNsLTxzdWZmaXg+XFxgKS4gUGVyLXJ1bGUgbWV0cmljIG5hbWVzIGFyZSBwcmVmaXhlZCBcXGB4NDAyc2VsbGVyLSpcXGAgKGUuZy4gXFxgeDQwMnNlbGxlci1tb25ldGl6ZS1hcnRpY2xlXFxgKS5gLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLnNlbGxlckRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1dBRiBSZXF1ZXN0IERpc3Bvc2l0aW9uJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvV0FGVjInLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0NvdW50ZWRSZXF1ZXN0cycsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgICAgIFdlYkFDTDogJ3g0MDItc2VsbGVyLWFjbCcsXG4gICAgICAgICAgICAgIFJ1bGU6ICdBV1NCb3RDb250cm9sJyxcbiAgICAgICAgICAgICAgUmVnaW9uOiAnR2xvYmFsJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnQm90cyBEZXRlY3RlZCAoQ291bnRlZCknLFxuICAgICAgICAgICAgY29sb3I6ICcjZmY3ZjBlJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL1dBRlYyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdBbGxvd2VkUmVxdWVzdHMnLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICBXZWJBQ0w6ICd4NDAyLXNlbGxlci1hY2wnLFxuICAgICAgICAgICAgICBSdWxlOiAnaHVtYW4tYWxsb3cnLFxuICAgICAgICAgICAgICBSZWdpb246ICdHbG9iYWwnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdIdW1hbnMgQWxsb3dlZCcsXG4gICAgICAgICAgICBjb2xvcjogJyMxZjc3YjQnLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvV0FGVjInLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FsbG93ZWRSZXF1ZXN0cycsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgICAgIFdlYkFDTDogJ3g0MDItc2VsbGVyLWFjbCcsXG4gICAgICAgICAgICAgIFJ1bGU6ICdhbGxvdy1kaXNjb3ZlcnknLFxuICAgICAgICAgICAgICBSZWdpb246ICdHbG9iYWwnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdEaXNjb3ZlcnkgQWxsb3dlZCcsXG4gICAgICAgICAgICBjb2xvcjogJyMyY2EwMmMnLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0NvbnRlbnQgRGVsaXZlcnknLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdDb250ZW50R2VuZXJhdGVkJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdDb250ZW50IEdlbmVyYXRlZCcsXG4gICAgICAgICAgICBjb2xvcjogJyMxN2JlY2YnLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnQ29udGVudENhY2hlSGl0JyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdDYWNoZSBIaXRzJyxcbiAgICAgICAgICAgIGNvbG9yOiAnI2JjYmQyMicsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdTM0ZldGNoU3VjY2VzcycsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnUzMgRmV0Y2hlcycsXG4gICAgICAgICAgICBjb2xvcjogJyM5NDY3YmQnLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyBQYXltZW50IFZlcmlmaWNhdGlvbiBieSBOZXR3b3JrL0Fzc2V0XG4gICAgdGhpcy5zZWxsZXJEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgICBtYXJrZG93bjogJyMjIFBheW1lbnQgRGV0YWlscyBieSBOZXR3b3JrJyxcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgdGhpcy5zZWxsZXJEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdQYXltZW50cyBieSBOZXR3b3JrIChCYXNlIFNlcG9saWEpJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUGF5bWVudFNldHRsZWQnLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICBOZXR3b3JrOiAnZWlwMTU1Ojg0NTMyJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnQmFzZSBTZXBvbGlhJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdWYWxpZGF0aW9uIEVycm9ycyBieSBUeXBlJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnVmFsaWRhdGlvbkVycm9yJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdWYWxpZGF0aW9uIEVycm9ycycsXG4gICAgICAgICAgICBjb2xvcjogJyNkNjI3MjgnLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnQXV0aG9yaXphdGlvbkV4cGlyZWQnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ0F1dGggRXhwaXJlZCcsXG4gICAgICAgICAgICBjb2xvcjogJyNmZjdmMGUnLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnU2lnbmF0dXJlSW52YWxpZCcsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnSW52YWxpZCBTaWduYXR1cmUnLFxuICAgICAgICAgICAgY29sb3I6ICcjOTQ2N2JkJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMi9QYXltZW50VmVyaWZpZXInLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0Ftb3VudEluc3VmZmljaWVudCcsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnSW5zdWZmaWNpZW50IEFtb3VudCcsXG4gICAgICAgICAgICBjb2xvcjogJyNlMzc3YzInLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyBDdXN0b20gTWV0cmljcyBTZWN0aW9uIC0gUGF5bWVudCBBbW91bnRzIGFuZCBDb250ZW50XG4gICAgdGhpcy5zZWxsZXJEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgICBtYXJrZG93bjogJyMjIEN1c3RvbSBNZXRyaWNzIC0gUGF5bWVudCBBbW91bnRzICYgQ29udGVudCcsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMuc2VsbGVyRGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnUGF5bWVudCBBbW91bnRzIChXZWkpJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUGF5bWVudEFtb3VudFdlaScsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnVG90YWwgV2VpJyxcbiAgICAgICAgICAgIGNvbG9yOiAnIzJjYTAyYycsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50QW1vdW50V2VpJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnQXZnIFdlaSBwZXIgUGF5bWVudCcsXG4gICAgICAgICAgICBjb2xvcjogJyMxZjc3YjQnLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0NvbnRlbnQgRGVsaXZlcnknLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdDb250ZW50Qnl0ZXNTZXJ2ZWQnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ1RvdGFsIEJ5dGVzJyxcbiAgICAgICAgICAgIGNvbG9yOiAnIzE3YmVjZicsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdDb250ZW50Qnl0ZXNTZXJ2ZWQnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdBdmcgQnl0ZXMgcGVyIFJlcXVlc3QnLFxuICAgICAgICAgICAgY29sb3I6ICcjYmNiZDIyJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFBheWVyIEFnZW50IEN1c3RvbSBNZXRyaWNzIERhc2hib2FyZCBTZWN0aW9uXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIHRoaXMucGF5ZXJEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgICBtYXJrZG93bjogJyMjIFBheWVyIEFnZW50IEN1c3RvbSBNZXRyaWNzJyxcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgdGhpcy5wYXllckRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1BheW1lbnQgQW5hbHlzaXMgRGVjaXNpb25zJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudCcsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUGF5bWVudEFuYWx5c2lzQ291bnQnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ1RvdGFsIEFuYWx5c2VzJyxcbiAgICAgICAgICAgIGNvbG9yOiAnIzFmNzdiNCcsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50QXBwcm92ZWQnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ0FwcHJvdmVkJyxcbiAgICAgICAgICAgIGNvbG9yOiAnIzJjYTAyYycsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50UmVqZWN0ZWQnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ1JlamVjdGVkJyxcbiAgICAgICAgICAgIGNvbG9yOiAnI2Q2MjcyOCcsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnUGF5bWVudCBTaWduaW5nIE9wZXJhdGlvbnMnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50U2lnbmluZ0NvdW50JyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdUb3RhbCBTaWduaW5ncycsXG4gICAgICAgICAgICBjb2xvcjogJyMxZjc3YjQnLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudCcsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUGF5bWVudFNpZ25pbmdTdWNjZXNzJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdTdWNjZXNzJyxcbiAgICAgICAgICAgIGNvbG9yOiAnIzJjYTAyYycsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50U2lnbmluZ0ZhaWx1cmUnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ0ZhaWx1cmUnLFxuICAgICAgICAgICAgY29sb3I6ICcjZDYyNzI4JyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgdGhpcy5wYXllckRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0NvbnRlbnQgUmVxdWVzdCBPdXRjb21lcycsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMlBheWVyQWdlbnQnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0NvbnRlbnRSZXF1ZXN0Q291bnQnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ1RvdGFsIFJlcXVlc3RzJyxcbiAgICAgICAgICAgIGNvbG9yOiAnIzFmNzdiNCcsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdDb250ZW50UmVxdWVzdFN1Y2Nlc3MnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ1N1Y2Nlc3MgKDIwMCknLFxuICAgICAgICAgICAgY29sb3I6ICcjMmNhMDJjJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMlBheWVyQWdlbnQnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0NvbnRlbnRSZXF1ZXN0NDAyJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdQYXltZW50IFJlcXVpcmVkICg0MDIpJyxcbiAgICAgICAgICAgIGNvbG9yOiAnI2ZmN2YwZScsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdDb250ZW50UmVxdWVzdEVycm9yJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdFcnJvcnMnLFxuICAgICAgICAgICAgY29sb3I6ICcjZDYyNzI4JyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdXYWxsZXQgT3BlcmF0aW9ucycsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMlBheWVyQWdlbnQnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ1dhbGxldEJhbGFuY2VDaGVjaycsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnQmFsYW5jZSBDaGVja3MnLFxuICAgICAgICAgICAgY29sb3I6ICcjMWY3N2I0JyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMlBheWVyQWdlbnQnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0ZhdWNldFJlcXVlc3RTdWNjZXNzJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdGYXVjZXQgU3VjY2VzcycsXG4gICAgICAgICAgICBjb2xvcjogJyMyY2EwMmMnLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudCcsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnRmF1Y2V0UmVxdWVzdEZhaWx1cmUnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ0ZhdWNldCBGYWlsdXJlJyxcbiAgICAgICAgICAgIGNvbG9yOiAnI2Q2MjcyOCcsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIFBheWVyIEFnZW50IExhdGVuY3kgTWV0cmljc1xuICAgIHRoaXMucGF5ZXJEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgICBtYXJrZG93bjogJyMjIFBheWVyIEFnZW50IExhdGVuY3kgTWV0cmljcycsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMucGF5ZXJEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdQYXltZW50IEFuYWx5c2lzIExhdGVuY3knLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50QW5hbHlzaXNMYXRlbmN5JyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgICAgICAgIGxhYmVsOiAnQXZlcmFnZScsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50QW5hbHlzaXNMYXRlbmN5JyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ3A5OScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgICAgICAgbGFiZWw6ICdwOTknLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogOCxcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnUGF5bWVudCBTaWduaW5nIExhdGVuY3knLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50U2lnbmluZ0xhdGVuY3knLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgICAgICAgbGFiZWw6ICdBdmVyYWdlJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMlBheWVyQWdlbnQnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ1BheW1lbnRTaWduaW5nTGF0ZW5jeScsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdwOTknLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgICAgICAgIGxhYmVsOiAncDk5JyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDgsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0NvbnRlbnQgUmVxdWVzdCBMYXRlbmN5JyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudCcsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnQ29udGVudFJlcXVlc3RMYXRlbmN5JyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgICAgICAgIGxhYmVsOiAnQXZlcmFnZScsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdDb250ZW50UmVxdWVzdExhdGVuY3knLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAncDk5JyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICAgICAgICBsYWJlbDogJ3A5OScsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiA4LFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gV2FsbGV0IEJhbGFuY2UgVHJhY2tpbmdcbiAgICB0aGlzLnBheWVyRGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246ICcjIyBXYWxsZXQgQmFsYW5jZSBUcmFja2luZycsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMucGF5ZXJEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdXYWxsZXQgQmFsYW5jZSAoRVRIKScsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMlBheWVyQWdlbnQnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ1dhbGxldEJhbGFuY2VFVEgnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdCYWxhbmNlJyxcbiAgICAgICAgICAgIGNvbG9yOiAnIzJjYTAyYycsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnUGF5bWVudCBBbW91bnRzIChFVEgpJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudCcsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUGF5bWVudEFtb3VudEVUSCcsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnVG90YWwgUGFpZCcsXG4gICAgICAgICAgICBjb2xvcjogJyNmZjdmMGUnLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudCcsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUGF5bWVudEFtb3VudEVUSCcsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ0F2ZyBwZXIgUGF5bWVudCcsXG4gICAgICAgICAgICBjb2xvcjogJyMxZjc3YjQnLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gT3V0cHV0c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTWFpbkRhc2hib2FyZFVybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke3RoaXMucmVnaW9ufS5jb25zb2xlLmF3cy5hbWF6b24uY29tL2Nsb3Vkd2F0Y2gvaG9tZT9yZWdpb249JHt0aGlzLnJlZ2lvbn0jZGFzaGJvYXJkczpuYW1lPXg0MDItZW50ZXJwcmlzZS1kZW1vLW92ZXJ2aWV3YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTWFpbiBPdmVydmlldyBEYXNoYm9hcmQgVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyTWFpbkRhc2hib2FyZFVybCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUGF5ZXJEYXNoYm9hcmRVcmwnLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHt0aGlzLnJlZ2lvbn0uY29uc29sZS5hd3MuYW1hem9uLmNvbS9jbG91ZHdhdGNoL2hvbWU/cmVnaW9uPSR7dGhpcy5yZWdpb259I2Rhc2hib2FyZHM6bmFtZT14NDAyLXBheWVyLWFnZW50YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUGF5ZXIgQWdlbnQgRGFzaGJvYXJkIFVSTCcsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyRGFzaGJvYXJkVXJsJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTZWxsZXJEYXNoYm9hcmRVcmwnLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHt0aGlzLnJlZ2lvbn0uY29uc29sZS5hd3MuYW1hem9uLmNvbS9jbG91ZHdhdGNoL2hvbWU/cmVnaW9uPSR7dGhpcy5yZWdpb259I2Rhc2hib2FyZHM6bmFtZT14NDAyLXNlbGxlci1pbmZyYXN0cnVjdHVyZWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlbGxlciBJbmZyYXN0cnVjdHVyZSBEYXNoYm9hcmQgVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyU2VsbGVyRGFzaGJvYXJkVXJsJyxcbiAgICB9KTtcblxuICAgIC8vIEFsZXJ0IHRvcGljIG91dHB1dFxuICAgIGlmICh0aGlzLmFsZXJ0VG9waWMpIHtcbiAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBbGVydFRvcGljQXJuJywge1xuICAgICAgICB2YWx1ZTogdGhpcy5hbGVydFRvcGljLnRvcGljQXJuLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1NOUyBUb3BpYyBBUk4gZm9yIGFsZXJ0cycsXG4gICAgICAgIGV4cG9ydE5hbWU6ICdYNDAyQWxlcnRUb3BpY0FybicsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIENsb3VkV2F0Y2ggYWxlcnRpbmcgcnVsZXMgZm9yIHRoZSB4NDAyIGRlbW8uXG4gICAqIFxuICAgKiBBbGVydHMgYXJlIG9yZ2FuaXplZCBpbnRvIGNhdGVnb3JpZXM6XG4gICAqIC0gUGF5bWVudCBGbG93IEFsZXJ0czogUGF5bWVudCBmYWlsdXJlcywgdmVyaWZpY2F0aW9uIGVycm9yc1xuICAgKiAtIFBlcmZvcm1hbmNlIEFsZXJ0czogSGlnaCBsYXRlbmN5LCB0aHJvdHRsaW5nXG4gICAqIC0gQXZhaWxhYmlsaXR5IEFsZXJ0czogRXJyb3IgcmF0ZXMsIHNlcnZpY2UgaGVhbHRoXG4gICAqIC0gV2FsbGV0IEFsZXJ0czogTG93IGJhbGFuY2Ugd2FybmluZ3NcbiAgICovXG4gIHByaXZhdGUgY3JlYXRlQWxlcnRpbmdSdWxlcyhjbG91ZGZyb250RGlzdElkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gUGF5bWVudCBGbG93IEFsZXJ0c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIEFsZXJ0OiBIaWdoIFBheW1lbnQgRmFpbHVyZSBSYXRlXG4gICAgY29uc3QgcGF5bWVudEZhaWx1cmVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdQYXltZW50RmFpbHVyZVJhdGVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ3g0MDItaGlnaC1wYXltZW50LWZhaWx1cmUtcmF0ZScsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnUGF5bWVudCBmYWlsdXJlIHJhdGUgZXhjZWVkcyAxMCUgb3ZlciA1IG1pbnV0ZXMnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NYXRoRXhwcmVzc2lvbih7XG4gICAgICAgIGV4cHJlc3Npb246ICcxMDAgKiBmYWlsZWQgLyAoc2V0dGxlZCArIGZhaWxlZCArIDAuMDAxKScsXG4gICAgICAgIHVzaW5nTWV0cmljczoge1xuICAgICAgICAgIHNldHRsZWQ6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUGF5bWVudFNldHRsZWQnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgfSksXG4gICAgICAgICAgZmFpbGVkOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnWDQwMi9QYXltZW50VmVyaWZpZXInLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ1BheW1lbnRGYWlsZWQnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICAgIGxhYmVsOiAnUGF5bWVudCBGYWlsdXJlIFJhdGUgJScsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMTAsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuICAgIHRoaXMuYWxhcm1zLnB1c2gocGF5bWVudEZhaWx1cmVBbGFybSk7XG5cbiAgICAvLyBBbGVydDogUGF5bWVudCBWZXJpZmljYXRpb24gRXJyb3JzXG4gICAgY29uc3QgdmVyaWZpY2F0aW9uRXJyb3JBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdWZXJpZmljYXRpb25FcnJvckFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiAneDQwMi1wYXltZW50LXZlcmlmaWNhdGlvbi1lcnJvcnMnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ01vcmUgdGhhbiA1IHBheW1lbnQgdmVyaWZpY2F0aW9uIGVycm9ycyBpbiA1IG1pbnV0ZXMnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgIG1ldHJpY05hbWU6ICdWYWxpZGF0aW9uRXJyb3InLFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDUsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuICAgIHRoaXMuYWxhcm1zLnB1c2godmVyaWZpY2F0aW9uRXJyb3JBbGFybSk7XG5cbiAgICAvLyBBbGVydDogRmFjaWxpdGF0b3IgRXJyb3JzXG4gICAgY29uc3QgZmFjaWxpdGF0b3JFcnJvckFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0ZhY2lsaXRhdG9yRXJyb3JBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ3g0MDItZmFjaWxpdGF0b3ItZXJyb3JzJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdGYWNpbGl0YXRvciBzZXJ2aWNlIGVycm9ycyBkZXRlY3RlZCcsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ0ZhY2lsaXRhdG9yRXJyb3InLFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDMsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuICAgIHRoaXMuYWxhcm1zLnB1c2goZmFjaWxpdGF0b3JFcnJvckFsYXJtKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBQZXJmb3JtYW5jZSBBbGVydHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBBbGVydDogSGlnaCBFbmQtdG8tRW5kIExhdGVuY3lcbiAgICBjb25zdCBoaWdoTGF0ZW5jeUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0hpZ2hMYXRlbmN5QWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICd4NDAyLWhpZ2gtbGF0ZW5jeScsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnUDk5IGxhdGVuY3kgZXhjZWVkcyA1IHNlY29uZHMnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgIG1ldHJpY05hbWU6ICdMYXRlbmN5JyxcbiAgICAgICAgc3RhdGlzdGljOiAncDk5JyxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiA1MDAwLCAvLyA1IHNlY29uZHMgaW4gbWlsbGlzZWNvbmRzXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuICAgIHRoaXMuYWxhcm1zLnB1c2goaGlnaExhdGVuY3lBbGFybSk7XG5cbiAgICAvLyBBbGVydDogUGF5bWVudCBTaWduaW5nIExhdGVuY3lcbiAgICBjb25zdCBzaWduaW5nTGF0ZW5jeUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ1NpZ25pbmdMYXRlbmN5QWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICd4NDAyLWhpZ2gtc2lnbmluZy1sYXRlbmN5JyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdQYXltZW50IHNpZ25pbmcgUDk5IGxhdGVuY3kgZXhjZWVkcyAzIHNlY29uZHMnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudCcsXG4gICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50U2lnbmluZ0xhdGVuY3knLFxuICAgICAgICBzdGF0aXN0aWM6ICdwOTknLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDMwMDAsIC8vIDMgc2Vjb25kc1xuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICB9KTtcbiAgICB0aGlzLmFsYXJtcy5wdXNoKHNpZ25pbmdMYXRlbmN5QWxhcm0pO1xuXG4gICAgLy8gQWxlcnQ6IEdhdGV3YXkgVGhyb3R0bGluZ1xuICAgIGNvbnN0IHRocm90dGxpbmdBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdUaHJvdHRsaW5nQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICd4NDAyLWdhdGV3YXktdGhyb3R0bGluZycsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnR2F0ZXdheSBpcyB0aHJvdHRsaW5nIHJlcXVlc3RzJyxcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnWDQwMlBheWVyQWdlbnQvR2F0ZXdheS9SYXRlTGltaXRpbmcnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnVGhyb3R0bGVkUmVxdWVzdHMnLFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDEwLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICB9KTtcbiAgICB0aGlzLmFsYXJtcy5wdXNoKHRocm90dGxpbmdBbGFybSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQXZhaWxhYmlsaXR5IEFsZXJ0c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIEFsZXJ0OiBDbG91ZEZyb250IDV4eCBFcnJvciBSYXRlXG4gICAgY29uc3QgY2xvdWRmcm9udDV4eEFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0Nsb3VkRnJvbnQ1eHhBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ3g0MDItY2xvdWRmcm9udC01eHgtZXJyb3JzJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdDbG91ZEZyb250IDV4eCBlcnJvciByYXRlIGV4Y2VlZHMgNSUnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdBV1MvQ2xvdWRGcm9udCcsXG4gICAgICAgIG1ldHJpY05hbWU6ICc1eHhFcnJvclJhdGUnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgRGlzdHJpYnV0aW9uSWQ6IGNsb3VkZnJvbnREaXN0SWQsXG4gICAgICAgICAgUmVnaW9uOiAnR2xvYmFsJyxcbiAgICAgICAgfSxcbiAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogNSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgfSk7XG4gICAgdGhpcy5hbGFybXMucHVzaChjbG91ZGZyb250NXh4QWxhcm0pO1xuXG4gICAgLy8gQWxlcnQ6IEFnZW50IEVycm9yc1xuICAgIGNvbnN0IGFnZW50RXJyb3JBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdBZ2VudEVycm9yQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICd4NDAyLWFnZW50LWVycm9ycycsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnUGF5ZXIgYWdlbnQgZXJyb3JzIGRldGVjdGVkJyxcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnWDQwMlBheWVyQWdlbnQnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnQWdlbnRFcnJvckNvdW50JyxcbiAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiA1LFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICB9KTtcbiAgICB0aGlzLmFsYXJtcy5wdXNoKGFnZW50RXJyb3JBbGFybSk7XG5cbiAgICAvLyBBbGVydDogQ29udGVudCBSZXF1ZXN0IEVycm9yc1xuICAgIGNvbnN0IGNvbnRlbnRFcnJvckFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0NvbnRlbnRFcnJvckFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiAneDQwMi1jb250ZW50LXJlcXVlc3QtZXJyb3JzJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdIaWdoIHJhdGUgb2YgY29udGVudCByZXF1ZXN0IGVycm9ycycsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50JyxcbiAgICAgICAgbWV0cmljTmFtZTogJ0NvbnRlbnRSZXF1ZXN0RXJyb3InLFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDEwLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICB9KTtcbiAgICB0aGlzLmFsYXJtcy5wdXNoKGNvbnRlbnRFcnJvckFsYXJtKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBXYWxsZXQgQWxlcnRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQWxlcnQ6IExvdyBXYWxsZXQgQmFsYW5jZVxuICAgIGNvbnN0IGxvd0JhbGFuY2VBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdMb3dXYWxsZXRCYWxhbmNlQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICd4NDAyLWxvdy13YWxsZXQtYmFsYW5jZScsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnV2FsbGV0IGJhbGFuY2UgaXMgYmVsb3cgMC4wMSBFVEgnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudCcsXG4gICAgICAgIG1ldHJpY05hbWU6ICdXYWxsZXRCYWxhbmNlRVRIJyxcbiAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMC4wMSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5MRVNTX1RIQU5fVEhSRVNIT0xELFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgfSk7XG4gICAgdGhpcy5hbGFybXMucHVzaChsb3dCYWxhbmNlQWxhcm0pO1xuXG4gICAgLy8gQWxlcnQ6IEZhdWNldCBSZXF1ZXN0IEZhaWx1cmVzXG4gICAgY29uc3QgZmF1Y2V0RmFpbHVyZUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0ZhdWNldEZhaWx1cmVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ3g0MDItZmF1Y2V0LWZhaWx1cmVzJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdGYXVjZXQgcmVxdWVzdHMgYXJlIGZhaWxpbmcnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudCcsXG4gICAgICAgIG1ldHJpY05hbWU6ICdGYXVjZXRSZXF1ZXN0RmFpbHVyZScsXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDMsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuICAgIHRoaXMuYWxhcm1zLnB1c2goZmF1Y2V0RmFpbHVyZUFsYXJtKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBQYXltZW50IFNpZ25pbmcgQWxlcnRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQWxlcnQ6IFBheW1lbnQgU2lnbmluZyBGYWlsdXJlc1xuICAgIGNvbnN0IHNpZ25pbmdGYWlsdXJlQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnU2lnbmluZ0ZhaWx1cmVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ3g0MDItc2lnbmluZy1mYWlsdXJlcycsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnUGF5bWVudCBzaWduaW5nIG9wZXJhdGlvbnMgYXJlIGZhaWxpbmcnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudCcsXG4gICAgICAgIG1ldHJpY05hbWU6ICdQYXltZW50U2lnbmluZ0ZhaWx1cmUnLFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDMsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuICAgIHRoaXMuYWxhcm1zLnB1c2goc2lnbmluZ0ZhaWx1cmVBbGFybSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQ29tcG9zaXRlIEFsYXJtOiBPdmVyYWxsIFN5c3RlbSBIZWFsdGhcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3Qgc3lzdGVtSGVhbHRoQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5Db21wb3NpdGVBbGFybSh0aGlzLCAnU3lzdGVtSGVhbHRoQWxhcm0nLCB7XG4gICAgICBjb21wb3NpdGVBbGFybU5hbWU6ICd4NDAyLXN5c3RlbS1oZWFsdGgnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ092ZXJhbGwgc3lzdGVtIGhlYWx0aCAtIHRyaWdnZXJzIHdoZW4gbXVsdGlwbGUgaXNzdWVzIGRldGVjdGVkJyxcbiAgICAgIGFsYXJtUnVsZTogY2xvdWR3YXRjaC5BbGFybVJ1bGUuYW55T2YoXG4gICAgICAgIGNsb3Vkd2F0Y2guQWxhcm1SdWxlLmZyb21BbGFybShwYXltZW50RmFpbHVyZUFsYXJtLCBjbG91ZHdhdGNoLkFsYXJtU3RhdGUuQUxBUk0pLFxuICAgICAgICBjbG91ZHdhdGNoLkFsYXJtUnVsZS5mcm9tQWxhcm0oY2xvdWRmcm9udDV4eEFsYXJtLCBjbG91ZHdhdGNoLkFsYXJtU3RhdGUuQUxBUk0pLFxuICAgICAgICBjbG91ZHdhdGNoLkFsYXJtUnVsZS5mcm9tQWxhcm0oYWdlbnRFcnJvckFsYXJtLCBjbG91ZHdhdGNoLkFsYXJtU3RhdGUuQUxBUk0pLFxuICAgICAgKSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBBZGQgU05TIEFjdGlvbnMgdG8gQWxsIEFsYXJtc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBpZiAodGhpcy5hbGVydFRvcGljKSB7XG4gICAgICBjb25zdCBzbnNBY3Rpb24gPSBuZXcgY2xvdWR3YXRjaF9hY3Rpb25zLlNuc0FjdGlvbih0aGlzLmFsZXJ0VG9waWMpO1xuICAgICAgXG4gICAgICBmb3IgKGNvbnN0IGFsYXJtIG9mIHRoaXMuYWxhcm1zKSB7XG4gICAgICAgIGFsYXJtLmFkZEFsYXJtQWN0aW9uKHNuc0FjdGlvbik7XG4gICAgICAgIGFsYXJtLmFkZE9rQWN0aW9uKHNuc0FjdGlvbik7XG4gICAgICB9XG4gICAgICBcbiAgICAgIHN5c3RlbUhlYWx0aEFsYXJtLmFkZEFsYXJtQWN0aW9uKHNuc0FjdGlvbik7XG4gICAgICBzeXN0ZW1IZWFsdGhBbGFybS5hZGRPa0FjdGlvbihzbnNBY3Rpb24pO1xuICAgIH1cbiAgfVxufVxuIl19