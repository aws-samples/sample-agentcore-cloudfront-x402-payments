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
exports.AgentCoreStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
const cloudwatch_actions = __importStar(require("aws-cdk-lib/aws-cloudwatch-actions"));
const s3_assets = __importStar(require("aws-cdk-lib/aws-s3-assets"));
const path = __importStar(require("path"));
class AgentCoreStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Get seller CloudFront URL from props or environment variable
        const sellerCloudFrontUrl = props?.sellerCloudFrontUrl
            || process.env.X402_SELLER_CLOUDFRONT_URL
            || 'https://REPLACE_WITH_CLOUDFRONT_URL.cloudfront.net';
        // Initialize rate limit configuration with defaults
        this.rateLimitConfig = {
            requestsPerSecond: props?.rateLimitConfig?.requestsPerSecond ?? 10,
            burstCapacity: props?.rateLimitConfig?.burstCapacity ?? 20,
            limitBy: props?.rateLimitConfig?.limitBy ?? 'IAM_PRINCIPAL',
            enableAlarms: props?.rateLimitConfig?.enableAlarms ?? true,
            warningThresholdPercent: props?.rateLimitConfig?.warningThresholdPercent ?? 80,
        };
        // ==========================================
        // OpenAPI Spec Asset for Gateway Target
        // ==========================================
        // Upload the OpenAPI spec to S3 for use by AgentCore Gateway
        this.openApiSpecAsset = new s3_assets.Asset(this, 'OpenApiSpecAsset', {
            path: path.join(__dirname, '../../payer-agent/openapi/content-tools.yaml'),
        });
        // Secret for CDP API credentials
        const cdpSecret = new secretsmanager.Secret(this, 'CdpApiSecret', {
            secretName: 'x402-payer-agent/cdp-credentials',
            description: 'Coinbase Developer Platform API credentials for x402 payer agent',
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    CDP_API_KEY_NAME: 'REPLACE_WITH_YOUR_KEY_NAME',
                }),
                generateStringKey: 'CDP_API_KEY_PRIVATE_KEY',
            },
        });
        // IAM Role for AgentCore Runtime
        const agentRuntimeRole = new iam.Role(this, 'AgentRuntimeRole', {
            roleName: 'x402-payer-agent-runtime-role',
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
            description: 'IAM role for x402 payer agent running on AgentCore Runtime',
        });
        // Bedrock model access
        agentRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
            ],
            resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-*`,
                `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-sonnet-*`,
            ],
        }));
        // Secrets Manager access
        agentRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'secretsmanager:GetSecretValue',
            ],
            resources: [cdpSecret.secretArn],
        }));
        // CloudWatch Logs access
        agentRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
            ],
            resources: [
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/*`,
            ],
        }));
        // IAM Role for AgentCore Gateway (for API access)
        this.gatewayRole = new iam.Role(this, 'GatewayRole', {
            roleName: 'x402-payer-agent-gateway-role',
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
            description: 'IAM role for x402 payer agent Gateway',
        });
        // Gateway permissions to invoke the Runtime
        this.gatewayRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeAgent',
                'bedrock:InvokeAgentWithResponseStream',
            ],
            resources: [
                `arn:aws:bedrock:${this.region}:${this.account}:agent/*`,
                `arn:aws:bedrock:${this.region}:${this.account}:agent-alias/*`,
            ],
        }));
        // Gateway CloudWatch Logs permissions
        this.gatewayRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'logs:CreateLogStream',
                'logs:PutLogEvents',
            ],
            resources: [
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/gateway/*`,
            ],
        }));
        // ==========================================
        // Gateway Target Role (for MCP Tool Server)
        // ==========================================
        // This role allows the Gateway to invoke external targets (CloudFront/API Gateway)
        // and access the OpenAPI specification for tool discovery.
        //
        // Trust Relationship:
        // - bedrock-agentcore.amazonaws.com: AgentCore Gateway service
        // - bedrock.amazonaws.com: Bedrock service (for agent invocations)
        //
        // Permissions:
        // - S3: Read OpenAPI spec for tool schema discovery
        // - API Gateway: Invoke private API targets (if configured)
        // - CloudWatch Logs: Write target invocation logs
        // - Lambda: Invoke Lambda targets (if configured)
        // - STS: Assume cross-account roles (for multi-account setups)
        //
        this.gatewayTargetRole = new iam.Role(this, 'GatewayTargetRole', {
            roleName: 'x402-payer-agent-gateway-target-role',
            assumedBy: new iam.CompositePrincipal(new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'), new iam.ServicePrincipal('bedrock.amazonaws.com')),
            description: 'IAM role for AgentCore Gateway to invoke external targets (MCP tool server)',
        });
        // ==========================================
        // S3 Permissions (OpenAPI Spec Access)
        // ==========================================
        // Gateway needs to read the OpenAPI spec to discover tool schemas
        // and generate MCP tool definitions for agent discovery.
        this.gatewayTargetRole.addToPolicy(new iam.PolicyStatement({
            sid: 'OpenApiSpecAccess',
            effect: iam.Effect.ALLOW,
            actions: [
                's3:GetObject',
                's3:GetObjectVersion',
                's3:GetObjectAttributes',
            ],
            resources: [
                this.openApiSpecAsset.bucket.arnForObjects('*'),
                // Also allow access to any OpenAPI specs in a dedicated bucket
                `arn:aws:s3:::${this.account}-agentcore-openapi-specs/*`,
            ],
        }));
        // S3 bucket listing for spec discovery
        this.gatewayTargetRole.addToPolicy(new iam.PolicyStatement({
            sid: 'OpenApiSpecBucketList',
            effect: iam.Effect.ALLOW,
            actions: [
                's3:ListBucket',
                's3:GetBucketLocation',
            ],
            resources: [
                this.openApiSpecAsset.bucket.bucketArn,
                `arn:aws:s3:::${this.account}-agentcore-openapi-specs`,
            ],
        }));
        // ==========================================
        // API Gateway Permissions (Private Targets)
        // ==========================================
        // For private API Gateway targets, the Gateway needs execute-api:Invoke
        // Note: CloudFront is public and doesn't require IAM permissions,
        // but we include API Gateway permissions for future private targets.
        this.gatewayTargetRole.addToPolicy(new iam.PolicyStatement({
            sid: 'ApiGatewayInvoke',
            effect: iam.Effect.ALLOW,
            actions: [
                'execute-api:Invoke',
                'execute-api:ManageConnections',
            ],
            resources: [
                // Allow invoking any API Gateway in this account
                `arn:aws:execute-api:${this.region}:${this.account}:*/*/*/*`,
                // Allow invoking API Gateways in us-east-1 (Lambda@Edge region)
                `arn:aws:execute-api:us-east-1:${this.account}:*/*/*/*`,
            ],
        }));
        // ==========================================
        // Lambda Permissions (Lambda Targets)
        // ==========================================
        // For Lambda function targets, the Gateway needs lambda:InvokeFunction
        // This enables direct Lambda invocation without going through API Gateway.
        this.gatewayTargetRole.addToPolicy(new iam.PolicyStatement({
            sid: 'LambdaInvoke',
            effect: iam.Effect.ALLOW,
            actions: [
                'lambda:InvokeFunction',
                'lambda:InvokeAsync',
            ],
            resources: [
                // Allow invoking Lambda functions with x402 prefix
                `arn:aws:lambda:${this.region}:${this.account}:function:x402-*`,
                // Allow invoking Lambda@Edge functions in us-east-1
                `arn:aws:lambda:us-east-1:${this.account}:function:x402-*`,
            ],
        }));
        // ==========================================
        // CloudWatch Logs Permissions
        // ==========================================
        // Gateway Target needs to write logs for debugging and monitoring
        this.gatewayTargetRole.addToPolicy(new iam.PolicyStatement({
            sid: 'CloudWatchLogsWrite',
            effect: iam.Effect.ALLOW,
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
                'logs:DescribeLogStreams',
            ],
            resources: [
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/gateway-target/*`,
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/gateway-target/*:*`,
            ],
        }));
        // ==========================================
        // CloudWatch Metrics Permissions
        // ==========================================
        // Gateway Target needs to publish custom metrics for monitoring
        this.gatewayTargetRole.addToPolicy(new iam.PolicyStatement({
            sid: 'CloudWatchMetricsPublish',
            effect: iam.Effect.ALLOW,
            actions: [
                'cloudwatch:PutMetricData',
            ],
            resources: ['*'],
            conditions: {
                StringEquals: {
                    'cloudwatch:namespace': [
                        'X402PayerAgent/ContentTools',
                        'X402PayerAgent/Gateway',
                        'AWS/Bedrock',
                    ],
                },
            },
        }));
        // ==========================================
        // STS Permissions (Cross-Account Access)
        // ==========================================
        // For multi-account setups where targets are in different accounts,
        // the Gateway needs to assume roles in those accounts.
        this.gatewayTargetRole.addToPolicy(new iam.PolicyStatement({
            sid: 'CrossAccountAssumeRole',
            effect: iam.Effect.ALLOW,
            actions: [
                'sts:AssumeRole',
            ],
            resources: [
                // Allow assuming roles with x402-gateway-target prefix in any account
                'arn:aws:iam::*:role/x402-gateway-target-*',
            ],
            conditions: {
                StringEquals: {
                    'sts:ExternalId': 'x402-gateway-target',
                },
            },
        }));
        // ==========================================
        // Secrets Manager Permissions (Target Credentials)
        // ==========================================
        // For targets that require authentication, the Gateway may need
        // to retrieve credentials from Secrets Manager.
        this.gatewayTargetRole.addToPolicy(new iam.PolicyStatement({
            sid: 'SecretsManagerRead',
            effect: iam.Effect.ALLOW,
            actions: [
                'secretsmanager:GetSecretValue',
                'secretsmanager:DescribeSecret',
            ],
            resources: [
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:x402-gateway-target/*`,
            ],
        }));
        // ==========================================
        // KMS Permissions (Encrypted Secrets)
        // ==========================================
        // For secrets encrypted with customer-managed KMS keys
        this.gatewayTargetRole.addToPolicy(new iam.PolicyStatement({
            sid: 'KmsDecrypt',
            effect: iam.Effect.ALLOW,
            actions: [
                'kms:Decrypt',
                'kms:GenerateDataKey',
            ],
            resources: [
                `arn:aws:kms:${this.region}:${this.account}:key/*`,
            ],
            conditions: {
                StringEquals: {
                    'kms:ViaService': `secretsmanager.${this.region}.amazonaws.com`,
                },
            },
        }));
        // ==========================================
        // X-Ray Tracing Permissions
        // ==========================================
        // For distributed tracing of target invocations
        this.gatewayTargetRole.addToPolicy(new iam.PolicyStatement({
            sid: 'XRayTracing',
            effect: iam.Effect.ALLOW,
            actions: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
                'xray:GetSamplingRules',
                'xray:GetSamplingTargets',
            ],
            resources: ['*'],
        }));
        // CloudWatch Log Group for Gateway Target
        const gatewayTargetLogGroup = new logs.LogGroup(this, 'GatewayTargetLogGroup', {
            logGroupName: '/aws/bedrock-agentcore/gateway-target/x402-content-tools',
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // CloudWatch Log Group for Gateway
        this.gatewayLogGroup = new logs.LogGroup(this, 'GatewayLogGroup', {
            logGroupName: '/aws/bedrock-agentcore/gateway/x402-payer-agent',
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // ==========================================
        // Rate Limiting Infrastructure
        // ==========================================
        // SNS Topic for rate limit alarms
        this.rateLimitAlarmTopic = new sns.Topic(this, 'RateLimitAlarmTopic', {
            topicName: 'x402-payer-agent-rate-limit-alarms',
            displayName: 'x402 Payer Agent Rate Limit Alarms',
        });
        // CloudWatch Metric Filter for throttled requests
        const throttledRequestsMetricFilter = new logs.MetricFilter(this, 'ThrottledRequestsMetricFilter', {
            logGroup: this.gatewayLogGroup,
            metricNamespace: 'X402PayerAgent/Gateway/RateLimiting',
            metricName: 'ThrottledRequests',
            filterPattern: logs.FilterPattern.literal('ThrottlingException'),
            metricValue: '1',
            defaultValue: 0,
        });
        // CloudWatch Metric Filter for total requests
        const totalRequestsMetricFilter = new logs.MetricFilter(this, 'TotalRequestsMetricFilter', {
            logGroup: this.gatewayLogGroup,
            metricNamespace: 'X402PayerAgent/Gateway/RateLimiting',
            metricName: 'TotalRequests',
            filterPattern: logs.FilterPattern.literal('InvokeAgent'),
            metricValue: '1',
            defaultValue: 0,
        });
        // Throttled Requests Alarm
        const throttledRequestsAlarm = new cloudwatch.Alarm(this, 'ThrottledRequestsAlarm', {
            alarmName: 'x402-payer-agent-throttled-requests',
            alarmDescription: 'Alarm when requests are being throttled due to rate limiting',
            metric: new cloudwatch.Metric({
                namespace: 'X402PayerAgent/Gateway/RateLimiting',
                metricName: 'ThrottledRequests',
                statistic: 'Sum',
                period: cdk.Duration.minutes(1),
            }),
            threshold: 5,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        // Add alarm action to notify via SNS
        if (this.rateLimitConfig.enableAlarms) {
            throttledRequestsAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.rateLimitAlarmTopic));
        }
        // High Request Rate Alarm (approaching rate limit)
        const highRequestRateAlarm = new cloudwatch.Alarm(this, 'HighRequestRateAlarm', {
            alarmName: 'x402-payer-agent-high-request-rate',
            alarmDescription: `Alarm when request rate exceeds ${this.rateLimitConfig.warningThresholdPercent}% of rate limit`,
            metric: new cloudwatch.Metric({
                namespace: 'X402PayerAgent/Gateway/RateLimiting',
                metricName: 'TotalRequests',
                statistic: 'Sum',
                period: cdk.Duration.seconds(60),
            }),
            // Threshold is 80% of requests per minute (requestsPerSecond * 60 * warningThresholdPercent/100)
            threshold: Math.floor(this.rateLimitConfig.requestsPerSecond * 60 * (this.rateLimitConfig.warningThresholdPercent / 100)),
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        if (this.rateLimitConfig.enableAlarms) {
            highRequestRateAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.rateLimitAlarmTopic));
        }
        // IAM Policy for clients to invoke the Gateway
        const gatewayInvokePolicy = new iam.ManagedPolicy(this, 'GatewayInvokePolicy', {
            managedPolicyName: 'x402-payer-agent-gateway-invoke',
            description: 'Policy allowing invocation of the x402 payer agent Gateway',
            statements: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        'bedrock:InvokeAgent',
                        'bedrock:InvokeAgentWithResponseStream',
                    ],
                    resources: [
                        `arn:aws:bedrock:${this.region}:${this.account}:agent/*`,
                        `arn:aws:bedrock:${this.region}:${this.account}:agent-alias/*`,
                    ],
                }),
            ],
        });
        // ==========================================
        // Gateway Target Managed Policy
        // ==========================================
        // This managed policy can be attached to other roles that need
        // to invoke Gateway targets (e.g., for testing or automation).
        const gatewayTargetPolicy = new iam.ManagedPolicy(this, 'GatewayTargetPolicy', {
            managedPolicyName: 'x402-payer-agent-gateway-target',
            description: 'Policy for invoking x402 Gateway targets (MCP tool server)',
            statements: [
                // S3 access for OpenAPI specs
                new iam.PolicyStatement({
                    sid: 'OpenApiSpecAccess',
                    effect: iam.Effect.ALLOW,
                    actions: [
                        's3:GetObject',
                        's3:GetObjectVersion',
                    ],
                    resources: [
                        this.openApiSpecAsset.bucket.arnForObjects('*'),
                    ],
                }),
                // API Gateway invocation
                new iam.PolicyStatement({
                    sid: 'ApiGatewayInvoke',
                    effect: iam.Effect.ALLOW,
                    actions: [
                        'execute-api:Invoke',
                    ],
                    resources: [
                        `arn:aws:execute-api:${this.region}:${this.account}:*/*/*/*`,
                    ],
                }),
                // CloudWatch Logs
                new iam.PolicyStatement({
                    sid: 'CloudWatchLogs',
                    effect: iam.Effect.ALLOW,
                    actions: [
                        'logs:CreateLogStream',
                        'logs:PutLogEvents',
                    ],
                    resources: [
                        `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/gateway-target/*:*`,
                    ],
                }),
            ],
        });
        // CloudWatch Dashboard for Gateway monitoring
        const dashboard = new cloudwatch.Dashboard(this, 'GatewayDashboard', {
            dashboardName: 'x402-payer-agent-gateway',
        });
        // Add widgets to dashboard
        dashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '# x402 Payer Agent Gateway\nMonitoring dashboard for the AgentCore Gateway',
            width: 24,
            height: 1,
        }));
        // Rate Limiting Section
        dashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '## Rate Limiting Metrics',
            width: 24,
            height: 1,
        }));
        dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Request Rate vs Limit',
            left: [
                new cloudwatch.Metric({
                    namespace: 'X402PayerAgent/Gateway/RateLimiting',
                    metricName: 'TotalRequests',
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(1),
                    label: 'Requests per Minute',
                }),
            ],
            leftAnnotations: [
                {
                    value: this.rateLimitConfig.requestsPerSecond * 60,
                    label: 'Rate Limit (per minute)',
                    color: '#ff0000',
                },
                {
                    value: Math.floor(this.rateLimitConfig.requestsPerSecond * 60 * (this.rateLimitConfig.warningThresholdPercent / 100)),
                    label: `Warning Threshold (${this.rateLimitConfig.warningThresholdPercent}%)`,
                    color: '#ff9900',
                },
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
                    label: 'Throttled Requests',
                    color: '#ff0000',
                }),
            ],
            width: 12,
            height: 6,
        }));
        // Rate Limiting Configuration Display
        dashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: `### Rate Limit Configuration
| Setting | Value |
|---------|-------|
| Requests per Second | ${this.rateLimitConfig.requestsPerSecond} |
| Burst Capacity | ${this.rateLimitConfig.burstCapacity} |
| Limit By | ${this.rateLimitConfig.limitBy} |
| Warning Threshold | ${this.rateLimitConfig.warningThresholdPercent}% |`,
            width: 12,
            height: 4,
        }), new cloudwatch.AlarmStatusWidget({
            title: 'Rate Limiting Alarms',
            alarms: [throttledRequestsAlarm, highRequestRateAlarm],
            width: 12,
            height: 4,
        }));
        dashboard.addWidgets(new cloudwatch.LogQueryWidget({
            title: 'Gateway Request Logs',
            logGroupNames: [this.gatewayLogGroup.logGroupName],
            queryLines: [
                'fields @timestamp, @message',
                'sort @timestamp desc',
                'limit 100',
            ],
            width: 24,
            height: 6,
        }));
        // Outputs
        new cdk.CfnOutput(this, 'CdpSecretArn', {
            value: cdpSecret.secretArn,
            description: 'ARN of the CDP credentials secret',
            exportName: 'X402PayerAgentCdpSecretArn',
        });
        new cdk.CfnOutput(this, 'AgentRuntimeRoleArn', {
            value: agentRuntimeRole.roleArn,
            description: 'ARN of the AgentCore Runtime IAM role',
            exportName: 'X402PayerAgentRuntimeRoleArn',
        });
        new cdk.CfnOutput(this, 'GatewayRoleArn', {
            value: this.gatewayRole.roleArn,
            description: 'ARN of the AgentCore Gateway IAM role',
            exportName: 'X402PayerAgentGatewayRoleArn',
        });
        new cdk.CfnOutput(this, 'GatewayLogGroupName', {
            value: this.gatewayLogGroup.logGroupName,
            description: 'CloudWatch Log Group for Gateway logs',
            exportName: 'X402PayerAgentGatewayLogGroup',
        });
        new cdk.CfnOutput(this, 'GatewayInvokePolicyArn', {
            value: gatewayInvokePolicy.managedPolicyArn,
            description: 'ARN of the policy for invoking the Gateway',
            exportName: 'X402PayerAgentGatewayInvokePolicyArn',
        });
        new cdk.CfnOutput(this, 'DashboardUrl', {
            value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=x402-payer-agent-gateway`,
            description: 'URL to the CloudWatch Dashboard',
            exportName: 'X402PayerAgentDashboardUrl',
        });
        // Rate Limiting Outputs
        new cdk.CfnOutput(this, 'RateLimitAlarmTopicArn', {
            value: this.rateLimitAlarmTopic.topicArn,
            description: 'SNS Topic ARN for rate limit alarms',
            exportName: 'X402PayerAgentRateLimitAlarmTopicArn',
        });
        new cdk.CfnOutput(this, 'RateLimitConfig', {
            value: JSON.stringify({
                requestsPerSecond: this.rateLimitConfig.requestsPerSecond,
                burstCapacity: this.rateLimitConfig.burstCapacity,
                limitBy: this.rateLimitConfig.limitBy,
                warningThresholdPercent: this.rateLimitConfig.warningThresholdPercent,
            }),
            description: 'Rate limiting configuration',
            exportName: 'X402PayerAgentRateLimitConfig',
        });
        // ==========================================
        // Gateway Target Outputs (MCP Tool Server)
        // ==========================================
        new cdk.CfnOutput(this, 'GatewayTargetRoleArn', {
            value: this.gatewayTargetRole.roleArn,
            description: 'ARN of the Gateway Target IAM role for MCP tool server',
            exportName: 'X402PayerAgentGatewayTargetRoleArn',
        });
        new cdk.CfnOutput(this, 'GatewayTargetPolicyArn', {
            value: gatewayTargetPolicy.managedPolicyArn,
            description: 'ARN of the Gateway Target managed policy',
            exportName: 'X402PayerAgentGatewayTargetPolicyArn',
        });
        new cdk.CfnOutput(this, 'OpenApiSpecS3Uri', {
            value: `s3://${this.openApiSpecAsset.s3BucketName}/${this.openApiSpecAsset.s3ObjectKey}`,
            description: 'S3 URI of the OpenAPI spec for Gateway target configuration',
            exportName: 'X402PayerAgentOpenApiSpecS3Uri',
        });
        new cdk.CfnOutput(this, 'OpenApiSpecS3Url', {
            value: this.openApiSpecAsset.s3ObjectUrl,
            description: 'S3 URL of the OpenAPI spec for Gateway target configuration',
            exportName: 'X402PayerAgentOpenApiSpecS3Url',
        });
        new cdk.CfnOutput(this, 'GatewayTargetLogGroupName', {
            value: gatewayTargetLogGroup.logGroupName,
            description: 'CloudWatch Log Group for Gateway Target logs',
            exportName: 'X402PayerAgentGatewayTargetLogGroup',
        });
        new cdk.CfnOutput(this, 'SellerCloudFrontUrl', {
            value: sellerCloudFrontUrl,
            description: 'CloudFront distribution URL for seller infrastructure (target URL)',
            exportName: 'X402PayerAgentSellerCloudFrontUrl',
        });
        new cdk.CfnOutput(this, 'McpToolEndpoint', {
            value: '/v1/mcp/tools',
            description: 'MCP tool discovery endpoint path (relative to Gateway URL)',
            exportName: 'X402PayerAgentMcpToolEndpoint',
        });
        new cdk.CfnOutput(this, 'McpInvokeEndpoint', {
            value: '/v1/mcp/invoke',
            description: 'MCP tool invocation endpoint path (relative to Gateway URL)',
            exportName: 'X402PayerAgentMcpInvokeEndpoint',
        });
        // ==========================================
        // Tool ARNs for MCP Tools
        // ==========================================
        // These ARN patterns are used by the agent to invoke specific tools
        // via the Gateway. The actual ARNs are constructed at runtime when
        // the Gateway and targets are created via AgentCore CLI/console.
        //
        // ARN Format: arn:aws:bedrock-agentcore:{region}:{account}:gateway-target/{gateway-id}/tool/{tool-name}
        //
        // Note: Gateway ID is assigned at creation time. These outputs provide
        // the ARN patterns that can be used with the actual Gateway ID.
        const toolNames = [
            'get_premium_article',
            'get_weather_data',
            'get_market_analysis',
            'get_research_report',
        ];
        // Output individual tool ARN patterns
        new cdk.CfnOutput(this, 'ToolArnPattern', {
            value: `arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway-target/\${GATEWAY_TARGET_ID}/tool/\${TOOL_NAME}`,
            description: 'ARN pattern for Gateway target tools. Replace ${GATEWAY_TARGET_ID} and ${TOOL_NAME} with actual values.',
            exportName: 'X402PayerAgentToolArnPattern',
        });
        new cdk.CfnOutput(this, 'ToolArns', {
            value: JSON.stringify({
                pattern: `arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway-target/\${GATEWAY_TARGET_ID}/tool/{tool_name}`,
                tools: toolNames.map(name => ({
                    name,
                    arnTemplate: `arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway-target/\${GATEWAY_TARGET_ID}/tool/${name}`,
                })),
                note: 'Replace ${GATEWAY_TARGET_ID} with the actual Gateway target ID after creation',
            }, null, 2),
            description: 'Tool ARN templates for all MCP tools',
            exportName: 'X402PayerAgentToolArns',
        });
        // Output MCP endpoint configuration with full URL pattern
        new cdk.CfnOutput(this, 'McpEndpointConfig', {
            value: JSON.stringify({
                baseUrlPattern: 'https://${GATEWAY_ID}.bedrock-agentcore.${REGION}.amazonaws.com',
                endpoints: {
                    discovery: {
                        path: '/v1/mcp/tools',
                        method: 'GET',
                        description: 'List all available MCP tools',
                    },
                    invoke: {
                        path: '/v1/mcp/invoke',
                        method: 'POST',
                        description: 'Invoke an MCP tool by name',
                    },
                    toolSchema: {
                        path: '/v1/mcp/tools/{tool_name}/schema',
                        method: 'GET',
                        description: 'Get schema for a specific tool',
                    },
                },
                authentication: 'IAM_SIGV4',
                region: this.region,
                note: 'Replace ${GATEWAY_ID} with the actual Gateway ID after creation',
            }, null, 2),
            description: 'MCP endpoint configuration for tool discovery and invocation',
            exportName: 'X402PayerAgentMcpEndpointConfig',
        });
        // Output Gateway target ARN pattern
        new cdk.CfnOutput(this, 'GatewayTargetArnPattern', {
            value: `arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway-target/\${GATEWAY_TARGET_ID}`,
            description: 'ARN pattern for the Gateway target. Replace ${GATEWAY_TARGET_ID} with actual ID after creation.',
            exportName: 'X402PayerAgentGatewayTargetArnPattern',
        });
        new cdk.CfnOutput(this, 'GatewayTargetConfig', {
            value: JSON.stringify({
                name: 'x402-content-tools',
                description: 'Premium content endpoints protected by x402 payment protocol',
                type: 'OPENAPI',
                targetUrl: sellerCloudFrontUrl,
                openApiSpecS3Uri: `s3://${this.openApiSpecAsset.s3BucketName}/${this.openApiSpecAsset.s3ObjectKey}`,
                tools: [
                    { name: 'get_premium_article', price: '0.001 USDC' },
                    { name: 'get_weather_data', price: '0.0005 USDC' },
                    { name: 'get_market_analysis', price: '0.002 USDC' },
                    { name: 'get_research_report', price: '0.005 USDC' },
                ],
            }, null, 2),
            description: 'Gateway target configuration for MCP tool server',
            exportName: 'X402PayerAgentGatewayTargetConfig',
        });
        // Instructions for manual AgentCore setup
        new cdk.CfnOutput(this, 'NextSteps', {
            value: `
After deploying this stack:

1. Update the CDP secret with your actual credentials:
   aws secretsmanager put-secret-value --secret-id ${cdpSecret.secretName} --secret-string '{"CDP_API_KEY_NAME":"your-key","CDP_API_KEY_PRIVATE_KEY":"your-private-key"}'

2. Deploy the seller infrastructure first (if not already deployed):
   cd seller-infrastructure && npm install && cdk deploy
   # Note the CloudFront URL from the output

3. Set the seller CloudFront URL environment variable:
   export X402_SELLER_CLOUDFRONT_URL=https://dXXXXXXXXXXXXX.cloudfront.net

4. Create AgentCore Runtime via CLI or console:
   - Use the agent code from payer-agent/
   - Assign the runtime role: ${agentRuntimeRole.roleArn}
   - See payer-agent/agentcore_config.yaml for configuration

5. Create AgentCore Gateway with MCP tool server:
   - Point to the Runtime endpoint
   - Assign the gateway role: ${this.gatewayRole.roleArn}
   - Configure IAM SigV4 authentication
   - Configure rate limiting:
     * Requests per second: ${this.rateLimitConfig.requestsPerSecond}
     * Burst capacity: ${this.rateLimitConfig.burstCapacity}
     * Limit by: ${this.rateLimitConfig.limitBy}
   - See payer-agent/gateway_config.yaml for full configuration

6. Configure Gateway Target for MCP tools:
   - Target name: x402-content-tools
   - Target type: OPENAPI
   - OpenAPI spec S3 URI: s3://${this.openApiSpecAsset.s3BucketName}/${this.openApiSpecAsset.s3ObjectKey}
   - Target URL: ${sellerCloudFrontUrl}
   - Assign target role: ${this.gatewayTargetRole.roleArn}
   - Configure x402 header passthrough (see gateway_config.yaml)
   - Note the Gateway Target ID for tool ARN construction

7. Subscribe to rate limit alarms (optional):
   aws sns subscribe --topic-arn ${this.rateLimitAlarmTopic.topicArn} --protocol email --notification-endpoint your-email@example.com

8. Grant Gateway access to clients:
   - Attach the invoke policy to IAM users/roles that need access
   - Policy ARN: ${gatewayInvokePolicy.managedPolicyArn}

9. Test MCP tool discovery:
   curl -X GET "https://<gateway-url>/v1/mcp/tools" -H "Authorization: AWS4-HMAC-SHA256 ..."

10. Monitor the Gateway:
    - View logs in CloudWatch: ${this.gatewayLogGroup.logGroupName}
    - View target logs: ${gatewayTargetLogGroup.logGroupName}
    - View dashboard: https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=x402-payer-agent-gateway
    - Rate limit alarms will notify via SNS topic

MCP Tool Endpoints:
- Discovery: GET /v1/mcp/tools
- Invocation: POST /v1/mcp/invoke
- Tool Schema: GET /v1/mcp/tools/{tool_name}/schema

Tool ARN Pattern:
  arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway-target/{GATEWAY_TARGET_ID}/tool/{TOOL_NAME}

Available MCP Tools (x402 payment required):
- get_premium_article (0.001 USDC)
- get_weather_data (0.0005 USDC)
- get_market_analysis (0.002 USDC)
- get_research_report (0.005 USDC)

See: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/
      `,
            description: 'Next steps for AgentCore setup',
        });
    }
}
exports.AgentCoreStack = AgentCoreStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWdlbnRjb3JlLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYWdlbnRjb3JlLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyx5REFBMkM7QUFDM0MsK0VBQWlFO0FBQ2pFLDJEQUE2QztBQUM3Qyx1RUFBeUQ7QUFDekQseURBQTJDO0FBQzNDLHVGQUF5RTtBQUN6RSxxRUFBdUQ7QUFDdkQsMkNBQTZCO0FBNEQ3QixNQUFhLGNBQWUsU0FBUSxHQUFHLENBQUMsS0FBSztJQVEzQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQTJCO1FBQ25FLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLCtEQUErRDtRQUMvRCxNQUFNLG1CQUFtQixHQUFHLEtBQUssRUFBRSxtQkFBbUI7ZUFDakQsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEI7ZUFDdEMsb0RBQW9ELENBQUM7UUFFMUQsb0RBQW9EO1FBQ3BELElBQUksQ0FBQyxlQUFlLEdBQUc7WUFDckIsaUJBQWlCLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSxpQkFBaUIsSUFBSSxFQUFFO1lBQ2xFLGFBQWEsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLGFBQWEsSUFBSSxFQUFFO1lBQzFELE9BQU8sRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLE9BQU8sSUFBSSxlQUFlO1lBQzNELFlBQVksRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLFlBQVksSUFBSSxJQUFJO1lBQzFELHVCQUF1QixFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUUsdUJBQXVCLElBQUksRUFBRTtTQUMvRSxDQUFDO1FBRUYsNkNBQTZDO1FBQzdDLHdDQUF3QztRQUN4Qyw2Q0FBNkM7UUFDN0MsNkRBQTZEO1FBQzdELElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLFNBQVMsQ0FB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WUFBWSxFQUFFO2lCQUNyRDthQUNGLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUNYLFdBQVcsRUFBRSxrREFBa0Q7WUFDL0QsVUFBVSxFQUFFLG1DQUFtQztTQUNoRCxDQUFDLENBQUM7UUFFSCwwQ0FBMEM7UUFDMUMsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUU7WUFDbkMsS0FBSyxFQUFFOzs7O3FEQUl3QyxTQUFTLENBQUMsVUFBVTs7Ozs7Ozs7Ozs7Z0NBV3pDLGdCQUFnQixDQUFDLE9BQU87Ozs7O2dDQUt4QixJQUFJLENBQUMsV0FBVyxDQUFDLE9BQU87Ozs4QkFHMUIsSUFBSSxDQUFDLGVBQWUsQ0FBQyxpQkFBaUI7eUJBQzNDLElBQUksQ0FBQyxlQUFlLENBQUMsYUFBYTttQkFDeEMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxPQUFPOzs7Ozs7aUNBTWQsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFlBQVksSUFBSSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsV0FBVzttQkFDckYsbUJBQW1COzJCQUNYLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPOzs7OzttQ0FLdEIsSUFBSSxDQUFDLG1CQUFtQixDQUFDLFFBQVE7Ozs7bUJBSWpELG1CQUFtQixDQUFDLGdCQUFnQjs7Ozs7O2lDQU10QixJQUFJLENBQUMsZUFBZSxDQUFDLFlBQVk7MEJBQ3hDLHFCQUFxQixDQUFDLFlBQVk7Z0NBQzVCLElBQUksQ0FBQyxNQUFNLGtEQUFrRCxJQUFJLENBQUMsTUFBTTs7Ozs7Ozs7OzhCQVMxRSxJQUFJLENBQUMsTUFBTSxJQUFJLElBQUksQ0FBQyxPQUFPOzs7Ozs7Ozs7T0FTbEQ7WUFDRCxXQUFXLEVBQUUsZ0NBQWdDO1NBQzlDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXIyQkQsd0NBcTJCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoJztcbmltcG9ydCAqIGFzIHNucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zJztcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2hfYWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaC1hY3Rpb25zJztcbmltcG9ydCAqIGFzIHMzX2Fzc2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMtYXNzZXRzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuLyoqXG4gKiBSYXRlIGxpbWl0aW5nIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBBZ2VudENvcmUgR2F0ZXdheS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSYXRlTGltaXRDb25maWcge1xuICAvKiogUmVxdWVzdHMgcGVyIHNlY29uZCBwZXIgY2xpZW50IChkZWZhdWx0OiAxMCkgKi9cbiAgcmVxdWVzdHNQZXJTZWNvbmQ6IG51bWJlcjtcbiAgLyoqIEJ1cnN0IGNhcGFjaXR5IGZvciBoYW5kbGluZyB0cmFmZmljIHNwaWtlcyAoZGVmYXVsdDogMjApICovXG4gIGJ1cnN0Q2FwYWNpdHk6IG51bWJlcjtcbiAgLyoqIFJhdGUgbGltaXQgYnkgSUFNIHByaW5jaXBhbCBvciBJUCBhZGRyZXNzICovXG4gIGxpbWl0Qnk6ICdJQU1fUFJJTkNJUEFMJyB8ICdJUF9BRERSRVNTJztcbiAgLyoqIEVuYWJsZSByYXRlIGxpbWl0IGFsYXJtcyAqL1xuICBlbmFibGVBbGFybXM6IGJvb2xlYW47XG4gIC8qKiBUaHJlc2hvbGQgcGVyY2VudGFnZSBmb3IgcmF0ZSBsaW1pdCB3YXJuaW5nIGFsYXJtIChkZWZhdWx0OiA4MCkgKi9cbiAgd2FybmluZ1RocmVzaG9sZFBlcmNlbnQ6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBHYXRld2F5IHRhcmdldCBjb25maWd1cmF0aW9uIGZvciBNQ1AgdG9vbCBzZXJ2ZXIuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2F0ZXdheVRhcmdldENvbmZpZyB7XG4gIC8qKiBOYW1lIG9mIHRoZSB0YXJnZXQgKi9cbiAgbmFtZTogc3RyaW5nO1xuICAvKiogRGVzY3JpcHRpb24gb2YgdGhlIHRhcmdldCAqL1xuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICAvKiogVGFyZ2V0IFVSTCAoQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gVVJMKSAqL1xuICB0YXJnZXRVcmw6IHN0cmluZztcbiAgLyoqIFBhdGggdG8gT3BlbkFQSSBzcGVjIGZpbGUgKHJlbGF0aXZlIHRvIHBheWVyLWFnZW50IGRpcmVjdG9yeSkgKi9cbiAgb3BlbkFwaVNwZWNQYXRoPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIENESyBTdGFjayBmb3IgQmVkcm9jayBBZ2VudENvcmUgaW5mcmFzdHJ1Y3R1cmUuXG4gKiBcbiAqIE5vdGU6IEFnZW50Q29yZSBDREsgTDIgY29uc3RydWN0cyBhcmUgdW5kZXIgZGV2ZWxvcG1lbnQgKFJGQyAjNzg1KS5cbiAqIFRoaXMgc3RhY2sgdXNlcyBMMSBjb25zdHJ1Y3RzIGFuZCBJQU0gcm9sZXMgZm9yIEFnZW50Q29yZSBpbnRlZ3JhdGlvbi5cbiAqIFxuICogRm9yIHByb2R1Y3Rpb24gZGVwbG95bWVudCwgdXNlIHRoZSBBZ2VudENvcmUgQ0xJIG9yIGNvbnNvbGUgdG8gY3JlYXRlOlxuICogLSBBZ2VudENvcmUgUnVudGltZVxuICogLSBBZ2VudENvcmUgR2F0ZXdheVxuICogLSBBZ2VudENvcmUgTWVtb3J5IChvcHRpb25hbClcbiAqIFxuICogR2F0ZXdheSBDb25maWd1cmF0aW9uOlxuICogLSBJQU0gU2lnVjQgYXV0aGVudGljYXRpb24gZm9yIHNlY3VyZSBBUEkgYWNjZXNzXG4gKiAtIFJhdGUgbGltaXRpbmcgdG8gcHJldmVudCBhYnVzZVxuICogLSBDT1JTIHN1cHBvcnQgZm9yIHdlYiBjbGllbnRzXG4gKiAtIENsb3VkV2F0Y2ggbG9nZ2luZyBhbmQgbWV0cmljc1xuICovXG5cbmV4cG9ydCBpbnRlcmZhY2UgQWdlbnRDb3JlU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqIFJhdGUgbGltaXRpbmcgY29uZmlndXJhdGlvbiAqL1xuICByYXRlTGltaXRDb25maWc/OiBQYXJ0aWFsPFJhdGVMaW1pdENvbmZpZz47XG4gIC8qKiBHYXRld2F5IHRhcmdldCBjb25maWd1cmF0aW9uIGZvciBNQ1AgdG9vbCBzZXJ2ZXIgKi9cbiAgZ2F0ZXdheVRhcmdldENvbmZpZz86IEdhdGV3YXlUYXJnZXRDb25maWc7XG4gIC8qKiBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBVUkwgZm9yIHNlbGxlciBpbmZyYXN0cnVjdHVyZSAqL1xuICBzZWxsZXJDbG91ZEZyb250VXJsPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQWdlbnRDb3JlU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgZ2F0ZXdheVJvbGU6IGlhbS5Sb2xlO1xuICBwdWJsaWMgcmVhZG9ubHkgZ2F0ZXdheUxvZ0dyb3VwOiBsb2dzLkxvZ0dyb3VwO1xuICBwdWJsaWMgcmVhZG9ubHkgcmF0ZUxpbWl0QWxhcm1Ub3BpYzogc25zLlRvcGljO1xuICBwdWJsaWMgcmVhZG9ubHkgcmF0ZUxpbWl0Q29uZmlnOiBSYXRlTGltaXRDb25maWc7XG4gIHB1YmxpYyByZWFkb25seSBvcGVuQXBpU3BlY0Fzc2V0OiBzM19hc3NldHMuQXNzZXQ7XG4gIHB1YmxpYyByZWFkb25seSBnYXRld2F5VGFyZ2V0Um9sZTogaWFtLlJvbGU7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBBZ2VudENvcmVTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBHZXQgc2VsbGVyIENsb3VkRnJvbnQgVVJMIGZyb20gcHJvcHMgb3IgZW52aXJvbm1lbnQgdmFyaWFibGVcbiAgICBjb25zdCBzZWxsZXJDbG91ZEZyb250VXJsID0gcHJvcHM/LnNlbGxlckNsb3VkRnJvbnRVcmwgXG4gICAgICB8fCBwcm9jZXNzLmVudi5YNDAyX1NFTExFUl9DTE9VREZST05UX1VSTCBcbiAgICAgIHx8ICdodHRwczovL1JFUExBQ0VfV0lUSF9DTE9VREZST05UX1VSTC5jbG91ZGZyb250Lm5ldCc7XG5cbiAgICAvLyBJbml0aWFsaXplIHJhdGUgbGltaXQgY29uZmlndXJhdGlvbiB3aXRoIGRlZmF1bHRzXG4gICAgdGhpcy5yYXRlTGltaXRDb25maWcgPSB7XG4gICAgICByZXF1ZXN0c1BlclNlY29uZDogcHJvcHM/LnJhdGVMaW1pdENvbmZpZz8ucmVxdWVzdHNQZXJTZWNvbmQgPz8gMTAsXG4gICAgICBidXJzdENhcGFjaXR5OiBwcm9wcz8ucmF0ZUxpbWl0Q29uZmlnPy5idXJzdENhcGFjaXR5ID8/IDIwLFxuICAgICAgbGltaXRCeTogcHJvcHM/LnJhdGVMaW1pdENvbmZpZz8ubGltaXRCeSA/PyAnSUFNX1BSSU5DSVBBTCcsXG4gICAgICBlbmFibGVBbGFybXM6IHByb3BzPy5yYXRlTGltaXRDb25maWc/LmVuYWJsZUFsYXJtcyA/PyB0cnVlLFxuICAgICAgd2FybmluZ1RocmVzaG9sZFBlcmNlbnQ6IHByb3BzPy5yYXRlTGltaXRDb25maWc/Lndhcm5pbmdUaHJlc2hvbGRQZXJjZW50ID8/IDgwLFxuICAgIH07XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPcGVuQVBJIFNwZWMgQXNzZXQgZm9yIEdhdGV3YXkgVGFyZ2V0XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gVXBsb2FkIHRoZSBPcGVuQVBJIHNwZWMgdG8gUzMgZm9yIHVzZSBieSBBZ2VudENvcmUgR2F0ZXdheVxuICAgIHRoaXMub3BlbkFwaVNwZWNBc3NldCA9IG5ldyBzM19hc3NldHMuQXNzZXQodGhpcywgJ09wZW5BcGlTcGVjQXNzZXQnLCB7XG4gICAgICBwYXRoOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vcGF5ZXItYWdlbnQvb3BlbmFwaS9jb250ZW50LXRvb2xzLnlhbWwnKSxcbiAgICB9KTtcblxuICAgIC8vIFNlY3JldCBmb3IgQ0RQIEFQSSBjcmVkZW50aWFsc1xuICAgIGNvbnN0IGNkcFNlY3JldCA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ0NkcEFwaVNlY3JldCcsIHtcbiAgICAgIHNlY3JldE5hbWU6ICd4NDAyLXBheWVyLWFnZW50L2NkcC1jcmVkZW50aWFscycsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvaW5iYXNlIERldmVsb3BlciBQbGF0Zm9ybSBBUEkgY3JlZGVudGlhbHMgZm9yIHg0MDIgcGF5ZXIgYWdlbnQnLFxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgc2VjcmV0U3RyaW5nVGVtcGxhdGU6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBDRFBfQVBJX0tFWV9OQU1FOiAnUkVQTEFDRV9XSVRIX1lPVVJfS0VZX05BTUUnLFxuICAgICAgICB9KSxcbiAgICAgICAgZ2VuZXJhdGVTdHJpbmdLZXk6ICdDRFBfQVBJX0tFWV9QUklWQVRFX0tFWScsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gSUFNIFJvbGUgZm9yIEFnZW50Q29yZSBSdW50aW1lXG4gICAgY29uc3QgYWdlbnRSdW50aW1lUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQWdlbnRSdW50aW1lUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiAneDQwMi1wYXllci1hZ2VudC1ydW50aW1lLXJvbGUnLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2JlZHJvY2stYWdlbnRjb3JlLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnSUFNIHJvbGUgZm9yIHg0MDIgcGF5ZXIgYWdlbnQgcnVubmluZyBvbiBBZ2VudENvcmUgUnVudGltZScsXG4gICAgfSk7XG5cbiAgICAvLyBCZWRyb2NrIG1vZGVsIGFjY2Vzc1xuICAgIGFnZW50UnVudGltZVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbCcsXG4gICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsV2l0aFJlc3BvbnNlU3RyZWFtJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufTo6Zm91bmRhdGlvbi1tb2RlbC9hbnRocm9waWMuY2xhdWRlLTMtc29ubmV0LSpgLFxuICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7dGhpcy5yZWdpb259Ojpmb3VuZGF0aW9uLW1vZGVsL2FudGhyb3BpYy5jbGF1ZGUtMy01LXNvbm5ldC0qYCxcbiAgICAgIF0sXG4gICAgfSkpO1xuXG4gICAgLy8gU2VjcmV0cyBNYW5hZ2VyIGFjY2Vzc1xuICAgIGFnZW50UnVudGltZVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnc2VjcmV0c21hbmFnZXI6R2V0U2VjcmV0VmFsdWUnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW2NkcFNlY3JldC5zZWNyZXRBcm5dLFxuICAgIH0pKTtcblxuICAgIC8vIENsb3VkV2F0Y2ggTG9ncyBhY2Nlc3NcbiAgICBhZ2VudFJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLFxuICAgICAgICAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLFxuICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9iZWRyb2NrLWFnZW50Y29yZS8qYCxcbiAgICAgIF0sXG4gICAgfSkpO1xuXG4gICAgLy8gSUFNIFJvbGUgZm9yIEFnZW50Q29yZSBHYXRld2F5IChmb3IgQVBJIGFjY2VzcylcbiAgICB0aGlzLmdhdGV3YXlSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdHYXRld2F5Um9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiAneDQwMi1wYXllci1hZ2VudC1nYXRld2F5LXJvbGUnLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2JlZHJvY2stYWdlbnRjb3JlLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnSUFNIHJvbGUgZm9yIHg0MDIgcGF5ZXIgYWdlbnQgR2F0ZXdheScsXG4gICAgfSk7XG5cbiAgICAvLyBHYXRld2F5IHBlcm1pc3Npb25zIHRvIGludm9rZSB0aGUgUnVudGltZVxuICAgIHRoaXMuZ2F0ZXdheVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnYmVkcm9jazpJbnZva2VBZ2VudCcsXG4gICAgICAgICdiZWRyb2NrOkludm9rZUFnZW50V2l0aFJlc3BvbnNlU3RyZWFtJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06YWdlbnQvKmAsXG4gICAgICAgIGBhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmFnZW50LWFsaWFzLypgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyBHYXRld2F5IENsb3VkV2F0Y2ggTG9ncyBwZXJtaXNzaW9uc1xuICAgIHRoaXMuZ2F0ZXdheVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLFxuICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9iZWRyb2NrLWFnZW50Y29yZS9nYXRld2F5LypgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBHYXRld2F5IFRhcmdldCBSb2xlIChmb3IgTUNQIFRvb2wgU2VydmVyKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFRoaXMgcm9sZSBhbGxvd3MgdGhlIEdhdGV3YXkgdG8gaW52b2tlIGV4dGVybmFsIHRhcmdldHMgKENsb3VkRnJvbnQvQVBJIEdhdGV3YXkpXG4gICAgLy8gYW5kIGFjY2VzcyB0aGUgT3BlbkFQSSBzcGVjaWZpY2F0aW9uIGZvciB0b29sIGRpc2NvdmVyeS5cbiAgICAvL1xuICAgIC8vIFRydXN0IFJlbGF0aW9uc2hpcDpcbiAgICAvLyAtIGJlZHJvY2stYWdlbnRjb3JlLmFtYXpvbmF3cy5jb206IEFnZW50Q29yZSBHYXRld2F5IHNlcnZpY2VcbiAgICAvLyAtIGJlZHJvY2suYW1hem9uYXdzLmNvbTogQmVkcm9jayBzZXJ2aWNlIChmb3IgYWdlbnQgaW52b2NhdGlvbnMpXG4gICAgLy9cbiAgICAvLyBQZXJtaXNzaW9uczpcbiAgICAvLyAtIFMzOiBSZWFkIE9wZW5BUEkgc3BlYyBmb3IgdG9vbCBzY2hlbWEgZGlzY292ZXJ5XG4gICAgLy8gLSBBUEkgR2F0ZXdheTogSW52b2tlIHByaXZhdGUgQVBJIHRhcmdldHMgKGlmIGNvbmZpZ3VyZWQpXG4gICAgLy8gLSBDbG91ZFdhdGNoIExvZ3M6IFdyaXRlIHRhcmdldCBpbnZvY2F0aW9uIGxvZ3NcbiAgICAvLyAtIExhbWJkYTogSW52b2tlIExhbWJkYSB0YXJnZXRzIChpZiBjb25maWd1cmVkKVxuICAgIC8vIC0gU1RTOiBBc3N1bWUgY3Jvc3MtYWNjb3VudCByb2xlcyAoZm9yIG11bHRpLWFjY291bnQgc2V0dXBzKVxuICAgIC8vXG4gICAgdGhpcy5nYXRld2F5VGFyZ2V0Um9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnR2F0ZXdheVRhcmdldFJvbGUnLCB7XG4gICAgICByb2xlTmFtZTogJ3g0MDItcGF5ZXItYWdlbnQtZ2F0ZXdheS10YXJnZXQtcm9sZScsXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQ29tcG9zaXRlUHJpbmNpcGFsKFxuICAgICAgICBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2JlZHJvY2stYWdlbnRjb3JlLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdiZWRyb2NrLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICksXG4gICAgICBkZXNjcmlwdGlvbjogJ0lBTSByb2xlIGZvciBBZ2VudENvcmUgR2F0ZXdheSB0byBpbnZva2UgZXh0ZXJuYWwgdGFyZ2V0cyAoTUNQIHRvb2wgc2VydmVyKScsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTMyBQZXJtaXNzaW9ucyAoT3BlbkFQSSBTcGVjIEFjY2VzcylcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBHYXRld2F5IG5lZWRzIHRvIHJlYWQgdGhlIE9wZW5BUEkgc3BlYyB0byBkaXNjb3ZlciB0b29sIHNjaGVtYXNcbiAgICAvLyBhbmQgZ2VuZXJhdGUgTUNQIHRvb2wgZGVmaW5pdGlvbnMgZm9yIGFnZW50IGRpc2NvdmVyeS5cbiAgICB0aGlzLmdhdGV3YXlUYXJnZXRSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIHNpZDogJ09wZW5BcGlTcGVjQWNjZXNzJyxcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ3MzOkdldE9iamVjdCcsXG4gICAgICAgICdzMzpHZXRPYmplY3RWZXJzaW9uJyxcbiAgICAgICAgJ3MzOkdldE9iamVjdEF0dHJpYnV0ZXMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICB0aGlzLm9wZW5BcGlTcGVjQXNzZXQuYnVja2V0LmFybkZvck9iamVjdHMoJyonKSxcbiAgICAgICAgLy8gQWxzbyBhbGxvdyBhY2Nlc3MgdG8gYW55IE9wZW5BUEkgc3BlY3MgaW4gYSBkZWRpY2F0ZWQgYnVja2V0XG4gICAgICAgIGBhcm46YXdzOnMzOjo6JHt0aGlzLmFjY291bnR9LWFnZW50Y29yZS1vcGVuYXBpLXNwZWNzLypgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyBTMyBidWNrZXQgbGlzdGluZyBmb3Igc3BlYyBkaXNjb3ZlcnlcbiAgICB0aGlzLmdhdGV3YXlUYXJnZXRSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIHNpZDogJ09wZW5BcGlTcGVjQnVja2V0TGlzdCcsXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdzMzpMaXN0QnVja2V0JyxcbiAgICAgICAgJ3MzOkdldEJ1Y2tldExvY2F0aW9uJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgdGhpcy5vcGVuQXBpU3BlY0Fzc2V0LmJ1Y2tldC5idWNrZXRBcm4sXG4gICAgICAgIGBhcm46YXdzOnMzOjo6JHt0aGlzLmFjY291bnR9LWFnZW50Y29yZS1vcGVuYXBpLXNwZWNzYCxcbiAgICAgIF0sXG4gICAgfSkpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQVBJIEdhdGV3YXkgUGVybWlzc2lvbnMgKFByaXZhdGUgVGFyZ2V0cylcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBGb3IgcHJpdmF0ZSBBUEkgR2F0ZXdheSB0YXJnZXRzLCB0aGUgR2F0ZXdheSBuZWVkcyBleGVjdXRlLWFwaTpJbnZva2VcbiAgICAvLyBOb3RlOiBDbG91ZEZyb250IGlzIHB1YmxpYyBhbmQgZG9lc24ndCByZXF1aXJlIElBTSBwZXJtaXNzaW9ucyxcbiAgICAvLyBidXQgd2UgaW5jbHVkZSBBUEkgR2F0ZXdheSBwZXJtaXNzaW9ucyBmb3IgZnV0dXJlIHByaXZhdGUgdGFyZ2V0cy5cbiAgICB0aGlzLmdhdGV3YXlUYXJnZXRSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIHNpZDogJ0FwaUdhdGV3YXlJbnZva2UnLFxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnZXhlY3V0ZS1hcGk6SW52b2tlJyxcbiAgICAgICAgJ2V4ZWN1dGUtYXBpOk1hbmFnZUNvbm5lY3Rpb25zJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgLy8gQWxsb3cgaW52b2tpbmcgYW55IEFQSSBHYXRld2F5IGluIHRoaXMgYWNjb3VudFxuICAgICAgICBgYXJuOmF3czpleGVjdXRlLWFwaToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06Ki8qLyovKmAsXG4gICAgICAgIC8vIEFsbG93IGludm9raW5nIEFQSSBHYXRld2F5cyBpbiB1cy1lYXN0LTEgKExhbWJkYUBFZGdlIHJlZ2lvbilcbiAgICAgICAgYGFybjphd3M6ZXhlY3V0ZS1hcGk6dXMtZWFzdC0xOiR7dGhpcy5hY2NvdW50fToqLyovKi8qYCxcbiAgICAgIF0sXG4gICAgfSkpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gTGFtYmRhIFBlcm1pc3Npb25zIChMYW1iZGEgVGFyZ2V0cylcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBGb3IgTGFtYmRhIGZ1bmN0aW9uIHRhcmdldHMsIHRoZSBHYXRld2F5IG5lZWRzIGxhbWJkYTpJbnZva2VGdW5jdGlvblxuICAgIC8vIFRoaXMgZW5hYmxlcyBkaXJlY3QgTGFtYmRhIGludm9jYXRpb24gd2l0aG91dCBnb2luZyB0aHJvdWdoIEFQSSBHYXRld2F5LlxuICAgIHRoaXMuZ2F0ZXdheVRhcmdldFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgc2lkOiAnTGFtYmRhSW52b2tlJyxcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2xhbWJkYTpJbnZva2VGdW5jdGlvbicsXG4gICAgICAgICdsYW1iZGE6SW52b2tlQXN5bmMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICAvLyBBbGxvdyBpbnZva2luZyBMYW1iZGEgZnVuY3Rpb25zIHdpdGggeDQwMiBwcmVmaXhcbiAgICAgICAgYGFybjphd3M6bGFtYmRhOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpmdW5jdGlvbjp4NDAyLSpgLFxuICAgICAgICAvLyBBbGxvdyBpbnZva2luZyBMYW1iZGFARWRnZSBmdW5jdGlvbnMgaW4gdXMtZWFzdC0xXG4gICAgICAgIGBhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6JHt0aGlzLmFjY291bnR9OmZ1bmN0aW9uOng0MDItKmAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENsb3VkV2F0Y2ggTG9ncyBQZXJtaXNzaW9uc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEdhdGV3YXkgVGFyZ2V0IG5lZWRzIHRvIHdyaXRlIGxvZ3MgZm9yIGRlYnVnZ2luZyBhbmQgbW9uaXRvcmluZ1xuICAgIHRoaXMuZ2F0ZXdheVRhcmdldFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgc2lkOiAnQ2xvdWRXYXRjaExvZ3NXcml0ZScsXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJyxcbiAgICAgICAgJ2xvZ3M6UHV0TG9nRXZlbnRzJyxcbiAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOi9hd3MvYmVkcm9jay1hZ2VudGNvcmUvZ2F0ZXdheS10YXJnZXQvKmAsXG4gICAgICAgIGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2JlZHJvY2stYWdlbnRjb3JlL2dhdGV3YXktdGFyZ2V0Lyo6KmAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENsb3VkV2F0Y2ggTWV0cmljcyBQZXJtaXNzaW9uc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEdhdGV3YXkgVGFyZ2V0IG5lZWRzIHRvIHB1Ymxpc2ggY3VzdG9tIG1ldHJpY3MgZm9yIG1vbml0b3JpbmdcbiAgICB0aGlzLmdhdGV3YXlUYXJnZXRSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIHNpZDogJ0Nsb3VkV2F0Y2hNZXRyaWNzUHVibGlzaCcsXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdjbG91ZHdhdGNoOlB1dE1ldHJpY0RhdGEnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICdjbG91ZHdhdGNoOm5hbWVzcGFjZSc6IFtcbiAgICAgICAgICAgICdYNDAyUGF5ZXJBZ2VudC9Db250ZW50VG9vbHMnLFxuICAgICAgICAgICAgJ1g0MDJQYXllckFnZW50L0dhdGV3YXknLFxuICAgICAgICAgICAgJ0FXUy9CZWRyb2NrJyxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTVFMgUGVybWlzc2lvbnMgKENyb3NzLUFjY291bnQgQWNjZXNzKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEZvciBtdWx0aS1hY2NvdW50IHNldHVwcyB3aGVyZSB0YXJnZXRzIGFyZSBpbiBkaWZmZXJlbnQgYWNjb3VudHMsXG4gICAgLy8gdGhlIEdhdGV3YXkgbmVlZHMgdG8gYXNzdW1lIHJvbGVzIGluIHRob3NlIGFjY291bnRzLlxuICAgIHRoaXMuZ2F0ZXdheVRhcmdldFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgc2lkOiAnQ3Jvc3NBY2NvdW50QXNzdW1lUm9sZScsXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdzdHM6QXNzdW1lUm9sZScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIC8vIEFsbG93IGFzc3VtaW5nIHJvbGVzIHdpdGggeDQwMi1nYXRld2F5LXRhcmdldCBwcmVmaXggaW4gYW55IGFjY291bnRcbiAgICAgICAgJ2Fybjphd3M6aWFtOjoqOnJvbGUveDQwMi1nYXRld2F5LXRhcmdldC0qJyxcbiAgICAgIF0sXG4gICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICdzdHM6RXh0ZXJuYWxJZCc6ICd4NDAyLWdhdGV3YXktdGFyZ2V0JyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSkpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU2VjcmV0cyBNYW5hZ2VyIFBlcm1pc3Npb25zIChUYXJnZXQgQ3JlZGVudGlhbHMpXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRm9yIHRhcmdldHMgdGhhdCByZXF1aXJlIGF1dGhlbnRpY2F0aW9uLCB0aGUgR2F0ZXdheSBtYXkgbmVlZFxuICAgIC8vIHRvIHJldHJpZXZlIGNyZWRlbnRpYWxzIGZyb20gU2VjcmV0cyBNYW5hZ2VyLlxuICAgIHRoaXMuZ2F0ZXdheVRhcmdldFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgc2lkOiAnU2VjcmV0c01hbmFnZXJSZWFkJyxcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOkdldFNlY3JldFZhbHVlJyxcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOkRlc2NyaWJlU2VjcmV0JyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6c2VjcmV0c21hbmFnZXI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnNlY3JldDp4NDAyLWdhdGV3YXktdGFyZ2V0LypgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBLTVMgUGVybWlzc2lvbnMgKEVuY3J5cHRlZCBTZWNyZXRzKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEZvciBzZWNyZXRzIGVuY3J5cHRlZCB3aXRoIGN1c3RvbWVyLW1hbmFnZWQgS01TIGtleXNcbiAgICB0aGlzLmdhdGV3YXlUYXJnZXRSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIHNpZDogJ0ttc0RlY3J5cHQnLFxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAna21zOkRlY3J5cHQnLFxuICAgICAgICAna21zOkdlbmVyYXRlRGF0YUtleScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIGBhcm46YXdzOmttczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06a2V5LypgLFxuICAgICAgXSxcbiAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgJ2ttczpWaWFTZXJ2aWNlJzogYHNlY3JldHNtYW5hZ2VyLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb21gLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBYLVJheSBUcmFjaW5nIFBlcm1pc3Npb25zXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRm9yIGRpc3RyaWJ1dGVkIHRyYWNpbmcgb2YgdGFyZ2V0IGludm9jYXRpb25zXG4gICAgdGhpcy5nYXRld2F5VGFyZ2V0Um9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBzaWQ6ICdYUmF5VHJhY2luZycsXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICd4cmF5OlB1dFRyYWNlU2VnbWVudHMnLFxuICAgICAgICAneHJheTpQdXRUZWxlbWV0cnlSZWNvcmRzJyxcbiAgICAgICAgJ3hyYXk6R2V0U2FtcGxpbmdSdWxlcycsXG4gICAgICAgICd4cmF5OkdldFNhbXBsaW5nVGFyZ2V0cycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBDbG91ZFdhdGNoIExvZyBHcm91cCBmb3IgR2F0ZXdheSBUYXJnZXRcbiAgICBjb25zdCBnYXRld2F5VGFyZ2V0TG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnR2F0ZXdheVRhcmdldExvZ0dyb3VwJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9iZWRyb2NrLWFnZW50Y29yZS9nYXRld2F5LXRhcmdldC94NDAyLWNvbnRlbnQtdG9vbHMnLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIENsb3VkV2F0Y2ggTG9nIEdyb3VwIGZvciBHYXRld2F5XG4gICAgdGhpcy5nYXRld2F5TG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnR2F0ZXdheUxvZ0dyb3VwJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9iZWRyb2NrLWFnZW50Y29yZS9nYXRld2F5L3g0MDItcGF5ZXItYWdlbnQnLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFJhdGUgTGltaXRpbmcgSW5mcmFzdHJ1Y3R1cmVcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIFNOUyBUb3BpYyBmb3IgcmF0ZSBsaW1pdCBhbGFybXNcbiAgICB0aGlzLnJhdGVMaW1pdEFsYXJtVG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdSYXRlTGltaXRBbGFybVRvcGljJywge1xuICAgICAgdG9waWNOYW1lOiAneDQwMi1wYXllci1hZ2VudC1yYXRlLWxpbWl0LWFsYXJtcycsXG4gICAgICBkaXNwbGF5TmFtZTogJ3g0MDIgUGF5ZXIgQWdlbnQgUmF0ZSBMaW1pdCBBbGFybXMnLFxuICAgIH0pO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBNZXRyaWMgRmlsdGVyIGZvciB0aHJvdHRsZWQgcmVxdWVzdHNcbiAgICBjb25zdCB0aHJvdHRsZWRSZXF1ZXN0c01ldHJpY0ZpbHRlciA9IG5ldyBsb2dzLk1ldHJpY0ZpbHRlcih0aGlzLCAnVGhyb3R0bGVkUmVxdWVzdHNNZXRyaWNGaWx0ZXInLCB7XG4gICAgICBsb2dHcm91cDogdGhpcy5nYXRld2F5TG9nR3JvdXAsXG4gICAgICBtZXRyaWNOYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudC9HYXRld2F5L1JhdGVMaW1pdGluZycsXG4gICAgICBtZXRyaWNOYW1lOiAnVGhyb3R0bGVkUmVxdWVzdHMnLFxuICAgICAgZmlsdGVyUGF0dGVybjogbG9ncy5GaWx0ZXJQYXR0ZXJuLmxpdGVyYWwoJ1Rocm90dGxpbmdFeGNlcHRpb24nKSxcbiAgICAgIG1ldHJpY1ZhbHVlOiAnMScsXG4gICAgICBkZWZhdWx0VmFsdWU6IDAsXG4gICAgfSk7XG5cbiAgICAvLyBDbG91ZFdhdGNoIE1ldHJpYyBGaWx0ZXIgZm9yIHRvdGFsIHJlcXVlc3RzXG4gICAgY29uc3QgdG90YWxSZXF1ZXN0c01ldHJpY0ZpbHRlciA9IG5ldyBsb2dzLk1ldHJpY0ZpbHRlcih0aGlzLCAnVG90YWxSZXF1ZXN0c01ldHJpY0ZpbHRlcicsIHtcbiAgICAgIGxvZ0dyb3VwOiB0aGlzLmdhdGV3YXlMb2dHcm91cCxcbiAgICAgIG1ldHJpY05hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50L0dhdGV3YXkvUmF0ZUxpbWl0aW5nJyxcbiAgICAgIG1ldHJpY05hbWU6ICdUb3RhbFJlcXVlc3RzJyxcbiAgICAgIGZpbHRlclBhdHRlcm46IGxvZ3MuRmlsdGVyUGF0dGVybi5saXRlcmFsKCdJbnZva2VBZ2VudCcpLFxuICAgICAgbWV0cmljVmFsdWU6ICcxJyxcbiAgICAgIGRlZmF1bHRWYWx1ZTogMCxcbiAgICB9KTtcblxuICAgIC8vIFRocm90dGxlZCBSZXF1ZXN0cyBBbGFybVxuICAgIGNvbnN0IHRocm90dGxlZFJlcXVlc3RzQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnVGhyb3R0bGVkUmVxdWVzdHNBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ3g0MDItcGF5ZXItYWdlbnQtdGhyb3R0bGVkLXJlcXVlc3RzJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGFybSB3aGVuIHJlcXVlc3RzIGFyZSBiZWluZyB0aHJvdHRsZWQgZHVlIHRvIHJhdGUgbGltaXRpbmcnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudC9HYXRld2F5L1JhdGVMaW1pdGluZycsXG4gICAgICAgIG1ldHJpY05hbWU6ICdUaHJvdHRsZWRSZXF1ZXN0cycsXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogNSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgYWxhcm0gYWN0aW9uIHRvIG5vdGlmeSB2aWEgU05TXG4gICAgaWYgKHRoaXMucmF0ZUxpbWl0Q29uZmlnLmVuYWJsZUFsYXJtcykge1xuICAgICAgdGhyb3R0bGVkUmVxdWVzdHNBbGFybS5hZGRBbGFybUFjdGlvbihcbiAgICAgICAgbmV3IGNsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24odGhpcy5yYXRlTGltaXRBbGFybVRvcGljKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBIaWdoIFJlcXVlc3QgUmF0ZSBBbGFybSAoYXBwcm9hY2hpbmcgcmF0ZSBsaW1pdClcbiAgICBjb25zdCBoaWdoUmVxdWVzdFJhdGVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdIaWdoUmVxdWVzdFJhdGVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ3g0MDItcGF5ZXItYWdlbnQtaGlnaC1yZXF1ZXN0LXJhdGUnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogYEFsYXJtIHdoZW4gcmVxdWVzdCByYXRlIGV4Y2VlZHMgJHt0aGlzLnJhdGVMaW1pdENvbmZpZy53YXJuaW5nVGhyZXNob2xkUGVyY2VudH0lIG9mIHJhdGUgbGltaXRgLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudC9HYXRld2F5L1JhdGVMaW1pdGluZycsXG4gICAgICAgIG1ldHJpY05hbWU6ICdUb3RhbFJlcXVlc3RzJyxcbiAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICB9KSxcbiAgICAgIC8vIFRocmVzaG9sZCBpcyA4MCUgb2YgcmVxdWVzdHMgcGVyIG1pbnV0ZSAocmVxdWVzdHNQZXJTZWNvbmQgKiA2MCAqIHdhcm5pbmdUaHJlc2hvbGRQZXJjZW50LzEwMClcbiAgICAgIHRocmVzaG9sZDogTWF0aC5mbG9vcih0aGlzLnJhdGVMaW1pdENvbmZpZy5yZXF1ZXN0c1BlclNlY29uZCAqIDYwICogKHRoaXMucmF0ZUxpbWl0Q29uZmlnLndhcm5pbmdUaHJlc2hvbGRQZXJjZW50IC8gMTAwKSksXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuXG4gICAgaWYgKHRoaXMucmF0ZUxpbWl0Q29uZmlnLmVuYWJsZUFsYXJtcykge1xuICAgICAgaGlnaFJlcXVlc3RSYXRlQWxhcm0uYWRkQWxhcm1BY3Rpb24oXG4gICAgICAgIG5ldyBjbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKHRoaXMucmF0ZUxpbWl0QWxhcm1Ub3BpYylcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gSUFNIFBvbGljeSBmb3IgY2xpZW50cyB0byBpbnZva2UgdGhlIEdhdGV3YXlcbiAgICBjb25zdCBnYXRld2F5SW52b2tlUG9saWN5ID0gbmV3IGlhbS5NYW5hZ2VkUG9saWN5KHRoaXMsICdHYXRld2F5SW52b2tlUG9saWN5Jywge1xuICAgICAgbWFuYWdlZFBvbGljeU5hbWU6ICd4NDAyLXBheWVyLWFnZW50LWdhdGV3YXktaW52b2tlJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUG9saWN5IGFsbG93aW5nIGludm9jYXRpb24gb2YgdGhlIHg0MDIgcGF5ZXIgYWdlbnQgR2F0ZXdheScsXG4gICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgJ2JlZHJvY2s6SW52b2tlQWdlbnQnLFxuICAgICAgICAgICAgJ2JlZHJvY2s6SW52b2tlQWdlbnRXaXRoUmVzcG9uc2VTdHJlYW0nLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTphZ2VudC8qYCxcbiAgICAgICAgICAgIGBhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmFnZW50LWFsaWFzLypgLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEdhdGV3YXkgVGFyZ2V0IE1hbmFnZWQgUG9saWN5XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gVGhpcyBtYW5hZ2VkIHBvbGljeSBjYW4gYmUgYXR0YWNoZWQgdG8gb3RoZXIgcm9sZXMgdGhhdCBuZWVkXG4gICAgLy8gdG8gaW52b2tlIEdhdGV3YXkgdGFyZ2V0cyAoZS5nLiwgZm9yIHRlc3Rpbmcgb3IgYXV0b21hdGlvbikuXG4gICAgY29uc3QgZ2F0ZXdheVRhcmdldFBvbGljeSA9IG5ldyBpYW0uTWFuYWdlZFBvbGljeSh0aGlzLCAnR2F0ZXdheVRhcmdldFBvbGljeScsIHtcbiAgICAgIG1hbmFnZWRQb2xpY3lOYW1lOiAneDQwMi1wYXllci1hZ2VudC1nYXRld2F5LXRhcmdldCcsXG4gICAgICBkZXNjcmlwdGlvbjogJ1BvbGljeSBmb3IgaW52b2tpbmcgeDQwMiBHYXRld2F5IHRhcmdldHMgKE1DUCB0b29sIHNlcnZlciknLFxuICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAvLyBTMyBhY2Nlc3MgZm9yIE9wZW5BUEkgc3BlY3NcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIHNpZDogJ09wZW5BcGlTcGVjQWNjZXNzJyxcbiAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgJ3MzOkdldE9iamVjdCcsXG4gICAgICAgICAgICAnczM6R2V0T2JqZWN0VmVyc2lvbicsXG4gICAgICAgICAgXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgIHRoaXMub3BlbkFwaVNwZWNBc3NldC5idWNrZXQuYXJuRm9yT2JqZWN0cygnKicpLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgICAvLyBBUEkgR2F0ZXdheSBpbnZvY2F0aW9uXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBzaWQ6ICdBcGlHYXRld2F5SW52b2tlJyxcbiAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgJ2V4ZWN1dGUtYXBpOkludm9rZScsXG4gICAgICAgICAgXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgIGBhcm46YXdzOmV4ZWN1dGUtYXBpOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fToqLyovKi8qYCxcbiAgICAgICAgICBdLFxuICAgICAgICB9KSxcbiAgICAgICAgLy8gQ2xvdWRXYXRjaCBMb2dzXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBzaWQ6ICdDbG91ZFdhdGNoTG9ncycsXG4gICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsXG4gICAgICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICBgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9iZWRyb2NrLWFnZW50Y29yZS9nYXRld2F5LXRhcmdldC8qOipgLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIENsb3VkV2F0Y2ggRGFzaGJvYXJkIGZvciBHYXRld2F5IG1vbml0b3JpbmdcbiAgICBjb25zdCBkYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5EYXNoYm9hcmQodGhpcywgJ0dhdGV3YXlEYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiAneDQwMi1wYXllci1hZ2VudC1nYXRld2F5JyxcbiAgICB9KTtcblxuICAgIC8vIEFkZCB3aWRnZXRzIHRvIGRhc2hib2FyZFxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgIG1hcmtkb3duOiAnIyB4NDAyIFBheWVyIEFnZW50IEdhdGV3YXlcXG5Nb25pdG9yaW5nIGRhc2hib2FyZCBmb3IgdGhlIEFnZW50Q29yZSBHYXRld2F5JyxcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gUmF0ZSBMaW1pdGluZyBTZWN0aW9uXG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246ICcjIyBSYXRlIExpbWl0aW5nIE1ldHJpY3MnLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdSZXF1ZXN0IFJhdGUgdnMgTGltaXQnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50L0dhdGV3YXkvUmF0ZUxpbWl0aW5nJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdUb3RhbFJlcXVlc3RzJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgICAgICAgbGFiZWw6ICdSZXF1ZXN0cyBwZXIgTWludXRlJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgbGVmdEFubm90YXRpb25zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgdmFsdWU6IHRoaXMucmF0ZUxpbWl0Q29uZmlnLnJlcXVlc3RzUGVyU2Vjb25kICogNjAsXG4gICAgICAgICAgICBsYWJlbDogJ1JhdGUgTGltaXQgKHBlciBtaW51dGUpJyxcbiAgICAgICAgICAgIGNvbG9yOiAnI2ZmMDAwMCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICB2YWx1ZTogTWF0aC5mbG9vcih0aGlzLnJhdGVMaW1pdENvbmZpZy5yZXF1ZXN0c1BlclNlY29uZCAqIDYwICogKHRoaXMucmF0ZUxpbWl0Q29uZmlnLndhcm5pbmdUaHJlc2hvbGRQZXJjZW50IC8gMTAwKSksXG4gICAgICAgICAgICBsYWJlbDogYFdhcm5pbmcgVGhyZXNob2xkICgke3RoaXMucmF0ZUxpbWl0Q29uZmlnLndhcm5pbmdUaHJlc2hvbGRQZXJjZW50fSUpYCxcbiAgICAgICAgICAgIGNvbG9yOiAnI2ZmOTkwMCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdUaHJvdHRsZWQgUmVxdWVzdHMnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50L0dhdGV3YXkvUmF0ZUxpbWl0aW5nJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdUaHJvdHRsZWRSZXF1ZXN0cycsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgICAgICAgIGxhYmVsOiAnVGhyb3R0bGVkIFJlcXVlc3RzJyxcbiAgICAgICAgICAgIGNvbG9yOiAnI2ZmMDAwMCcsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIFJhdGUgTGltaXRpbmcgQ29uZmlndXJhdGlvbiBEaXNwbGF5XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246IGAjIyMgUmF0ZSBMaW1pdCBDb25maWd1cmF0aW9uXG58IFNldHRpbmcgfCBWYWx1ZSB8XG58LS0tLS0tLS0tfC0tLS0tLS18XG58IFJlcXVlc3RzIHBlciBTZWNvbmQgfCAke3RoaXMucmF0ZUxpbWl0Q29uZmlnLnJlcXVlc3RzUGVyU2Vjb25kfSB8XG58IEJ1cnN0IENhcGFjaXR5IHwgJHt0aGlzLnJhdGVMaW1pdENvbmZpZy5idXJzdENhcGFjaXR5fSB8XG58IExpbWl0IEJ5IHwgJHt0aGlzLnJhdGVMaW1pdENvbmZpZy5saW1pdEJ5fSB8XG58IFdhcm5pbmcgVGhyZXNob2xkIHwgJHt0aGlzLnJhdGVMaW1pdENvbmZpZy53YXJuaW5nVGhyZXNob2xkUGVyY2VudH0lIHxgLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNCxcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm1TdGF0dXNXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1JhdGUgTGltaXRpbmcgQWxhcm1zJyxcbiAgICAgICAgYWxhcm1zOiBbdGhyb3R0bGVkUmVxdWVzdHNBbGFybSwgaGlnaFJlcXVlc3RSYXRlQWxhcm1dLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNCxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkxvZ1F1ZXJ5V2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdHYXRld2F5IFJlcXVlc3QgTG9ncycsXG4gICAgICAgIGxvZ0dyb3VwTmFtZXM6IFt0aGlzLmdhdGV3YXlMb2dHcm91cC5sb2dHcm91cE5hbWVdLFxuICAgICAgICBxdWVyeUxpbmVzOiBbXG4gICAgICAgICAgJ2ZpZWxkcyBAdGltZXN0YW1wLCBAbWVzc2FnZScsXG4gICAgICAgICAgJ3NvcnQgQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgICAnbGltaXQgMTAwJyxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDZHBTZWNyZXRBcm4nLCB7XG4gICAgICB2YWx1ZTogY2RwU2VjcmV0LnNlY3JldEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBDRFAgY3JlZGVudGlhbHMgc2VjcmV0JyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudENkcFNlY3JldEFybicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWdlbnRSdW50aW1lUm9sZUFybicsIHtcbiAgICAgIHZhbHVlOiBhZ2VudFJ1bnRpbWVSb2xlLnJvbGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FSTiBvZiB0aGUgQWdlbnRDb3JlIFJ1bnRpbWUgSUFNIHJvbGUnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50UnVudGltZVJvbGVBcm4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dhdGV3YXlSb2xlQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuZ2F0ZXdheVJvbGUucm9sZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBBZ2VudENvcmUgR2F0ZXdheSBJQU0gcm9sZScsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRHYXRld2F5Um9sZUFybicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR2F0ZXdheUxvZ0dyb3VwTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmdhdGV3YXlMb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkV2F0Y2ggTG9nIEdyb3VwIGZvciBHYXRld2F5IGxvZ3MnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50R2F0ZXdheUxvZ0dyb3VwJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHYXRld2F5SW52b2tlUG9saWN5QXJuJywge1xuICAgICAgdmFsdWU6IGdhdGV3YXlJbnZva2VQb2xpY3kubWFuYWdlZFBvbGljeUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBwb2xpY3kgZm9yIGludm9raW5nIHRoZSBHYXRld2F5JyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudEdhdGV3YXlJbnZva2VQb2xpY3lBcm4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Rhc2hib2FyZFVybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke3RoaXMucmVnaW9ufS5jb25zb2xlLmF3cy5hbWF6b24uY29tL2Nsb3Vkd2F0Y2gvaG9tZT9yZWdpb249JHt0aGlzLnJlZ2lvbn0jZGFzaGJvYXJkczpuYW1lPXg0MDItcGF5ZXItYWdlbnQtZ2F0ZXdheWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1VSTCB0byB0aGUgQ2xvdWRXYXRjaCBEYXNoYm9hcmQnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50RGFzaGJvYXJkVXJsJyxcbiAgICB9KTtcblxuICAgIC8vIFJhdGUgTGltaXRpbmcgT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSYXRlTGltaXRBbGFybVRvcGljQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMucmF0ZUxpbWl0QWxhcm1Ub3BpYy50b3BpY0FybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnU05TIFRvcGljIEFSTiBmb3IgcmF0ZSBsaW1pdCBhbGFybXMnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50UmF0ZUxpbWl0QWxhcm1Ub3BpY0FybicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmF0ZUxpbWl0Q29uZmlnJywge1xuICAgICAgdmFsdWU6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcmVxdWVzdHNQZXJTZWNvbmQ6IHRoaXMucmF0ZUxpbWl0Q29uZmlnLnJlcXVlc3RzUGVyU2Vjb25kLFxuICAgICAgICBidXJzdENhcGFjaXR5OiB0aGlzLnJhdGVMaW1pdENvbmZpZy5idXJzdENhcGFjaXR5LFxuICAgICAgICBsaW1pdEJ5OiB0aGlzLnJhdGVMaW1pdENvbmZpZy5saW1pdEJ5LFxuICAgICAgICB3YXJuaW5nVGhyZXNob2xkUGVyY2VudDogdGhpcy5yYXRlTGltaXRDb25maWcud2FybmluZ1RocmVzaG9sZFBlcmNlbnQsXG4gICAgICB9KSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUmF0ZSBsaW1pdGluZyBjb25maWd1cmF0aW9uJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudFJhdGVMaW1pdENvbmZpZycsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBHYXRld2F5IFRhcmdldCBPdXRwdXRzIChNQ1AgVG9vbCBTZXJ2ZXIpXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dhdGV3YXlUYXJnZXRSb2xlQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuZ2F0ZXdheVRhcmdldFJvbGUucm9sZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBHYXRld2F5IFRhcmdldCBJQU0gcm9sZSBmb3IgTUNQIHRvb2wgc2VydmVyJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudEdhdGV3YXlUYXJnZXRSb2xlQXJuJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHYXRld2F5VGFyZ2V0UG9saWN5QXJuJywge1xuICAgICAgdmFsdWU6IGdhdGV3YXlUYXJnZXRQb2xpY3kubWFuYWdlZFBvbGljeUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBHYXRld2F5IFRhcmdldCBtYW5hZ2VkIHBvbGljeScsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRHYXRld2F5VGFyZ2V0UG9saWN5QXJuJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdPcGVuQXBpU3BlY1MzVXJpJywge1xuICAgICAgdmFsdWU6IGBzMzovLyR7dGhpcy5vcGVuQXBpU3BlY0Fzc2V0LnMzQnVja2V0TmFtZX0vJHt0aGlzLm9wZW5BcGlTcGVjQXNzZXQuczNPYmplY3RLZXl9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgVVJJIG9mIHRoZSBPcGVuQVBJIHNwZWMgZm9yIEdhdGV3YXkgdGFyZ2V0IGNvbmZpZ3VyYXRpb24nLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50T3BlbkFwaVNwZWNTM1VyaScsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT3BlbkFwaVNwZWNTM1VybCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm9wZW5BcGlTcGVjQXNzZXQuczNPYmplY3RVcmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIFVSTCBvZiB0aGUgT3BlbkFQSSBzcGVjIGZvciBHYXRld2F5IHRhcmdldCBjb25maWd1cmF0aW9uJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudE9wZW5BcGlTcGVjUzNVcmwnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dhdGV3YXlUYXJnZXRMb2dHcm91cE5hbWUnLCB7XG4gICAgICB2YWx1ZTogZ2F0ZXdheVRhcmdldExvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRXYXRjaCBMb2cgR3JvdXAgZm9yIEdhdGV3YXkgVGFyZ2V0IGxvZ3MnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50R2F0ZXdheVRhcmdldExvZ0dyb3VwJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTZWxsZXJDbG91ZEZyb250VXJsJywge1xuICAgICAgdmFsdWU6IHNlbGxlckNsb3VkRnJvbnRVcmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIFVSTCBmb3Igc2VsbGVyIGluZnJhc3RydWN0dXJlICh0YXJnZXQgVVJMKScsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRTZWxsZXJDbG91ZEZyb250VXJsJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNY3BUb29sRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogJy92MS9tY3AvdG9vbHMnLFxuICAgICAgZGVzY3JpcHRpb246ICdNQ1AgdG9vbCBkaXNjb3ZlcnkgZW5kcG9pbnQgcGF0aCAocmVsYXRpdmUgdG8gR2F0ZXdheSBVUkwpJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudE1jcFRvb2xFbmRwb2ludCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTWNwSW52b2tlRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogJy92MS9tY3AvaW52b2tlJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTUNQIHRvb2wgaW52b2NhdGlvbiBlbmRwb2ludCBwYXRoIChyZWxhdGl2ZSB0byBHYXRld2F5IFVSTCknLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50TWNwSW52b2tlRW5kcG9pbnQnLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gVG9vbCBBUk5zIGZvciBNQ1AgVG9vbHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBUaGVzZSBBUk4gcGF0dGVybnMgYXJlIHVzZWQgYnkgdGhlIGFnZW50IHRvIGludm9rZSBzcGVjaWZpYyB0b29sc1xuICAgIC8vIHZpYSB0aGUgR2F0ZXdheS4gVGhlIGFjdHVhbCBBUk5zIGFyZSBjb25zdHJ1Y3RlZCBhdCBydW50aW1lIHdoZW5cbiAgICAvLyB0aGUgR2F0ZXdheSBhbmQgdGFyZ2V0cyBhcmUgY3JlYXRlZCB2aWEgQWdlbnRDb3JlIENMSS9jb25zb2xlLlxuICAgIC8vXG4gICAgLy8gQVJOIEZvcm1hdDogYXJuOmF3czpiZWRyb2NrLWFnZW50Y29yZTp7cmVnaW9ufTp7YWNjb3VudH06Z2F0ZXdheS10YXJnZXQve2dhdGV3YXktaWR9L3Rvb2wve3Rvb2wtbmFtZX1cbiAgICAvL1xuICAgIC8vIE5vdGU6IEdhdGV3YXkgSUQgaXMgYXNzaWduZWQgYXQgY3JlYXRpb24gdGltZS4gVGhlc2Ugb3V0cHV0cyBwcm92aWRlXG4gICAgLy8gdGhlIEFSTiBwYXR0ZXJucyB0aGF0IGNhbiBiZSB1c2VkIHdpdGggdGhlIGFjdHVhbCBHYXRld2F5IElELlxuXG4gICAgY29uc3QgdG9vbE5hbWVzID0gW1xuICAgICAgJ2dldF9wcmVtaXVtX2FydGljbGUnLFxuICAgICAgJ2dldF93ZWF0aGVyX2RhdGEnLFxuICAgICAgJ2dldF9tYXJrZXRfYW5hbHlzaXMnLFxuICAgICAgJ2dldF9yZXNlYXJjaF9yZXBvcnQnLFxuICAgIF07XG5cbiAgICAvLyBPdXRwdXQgaW5kaXZpZHVhbCB0b29sIEFSTiBwYXR0ZXJuc1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdUb29sQXJuUGF0dGVybicsIHtcbiAgICAgIHZhbHVlOiBgYXJuOmF3czpiZWRyb2NrLWFnZW50Y29yZToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06Z2F0ZXdheS10YXJnZXQvXFwke0dBVEVXQVlfVEFSR0VUX0lEfS90b29sL1xcJHtUT09MX05BTUV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIHBhdHRlcm4gZm9yIEdhdGV3YXkgdGFyZ2V0IHRvb2xzLiBSZXBsYWNlICR7R0FURVdBWV9UQVJHRVRfSUR9IGFuZCAke1RPT0xfTkFNRX0gd2l0aCBhY3R1YWwgdmFsdWVzLicsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRUb29sQXJuUGF0dGVybicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVG9vbEFybnMnLCB7XG4gICAgICB2YWx1ZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBwYXR0ZXJuOiBgYXJuOmF3czpiZWRyb2NrLWFnZW50Y29yZToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06Z2F0ZXdheS10YXJnZXQvXFwke0dBVEVXQVlfVEFSR0VUX0lEfS90b29sL3t0b29sX25hbWV9YCxcbiAgICAgICAgdG9vbHM6IHRvb2xOYW1lcy5tYXAobmFtZSA9PiAoe1xuICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgYXJuVGVtcGxhdGU6IGBhcm46YXdzOmJlZHJvY2stYWdlbnRjb3JlOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpnYXRld2F5LXRhcmdldC9cXCR7R0FURVdBWV9UQVJHRVRfSUR9L3Rvb2wvJHtuYW1lfWAsXG4gICAgICAgIH0pKSxcbiAgICAgICAgbm90ZTogJ1JlcGxhY2UgJHtHQVRFV0FZX1RBUkdFVF9JRH0gd2l0aCB0aGUgYWN0dWFsIEdhdGV3YXkgdGFyZ2V0IElEIGFmdGVyIGNyZWF0aW9uJyxcbiAgICAgIH0sIG51bGwsIDIpLFxuICAgICAgZGVzY3JpcHRpb246ICdUb29sIEFSTiB0ZW1wbGF0ZXMgZm9yIGFsbCBNQ1AgdG9vbHMnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50VG9vbEFybnMnLFxuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0IE1DUCBlbmRwb2ludCBjb25maWd1cmF0aW9uIHdpdGggZnVsbCBVUkwgcGF0dGVyblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNY3BFbmRwb2ludENvbmZpZycsIHtcbiAgICAgIHZhbHVlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGJhc2VVcmxQYXR0ZXJuOiAnaHR0cHM6Ly8ke0dBVEVXQVlfSUR9LmJlZHJvY2stYWdlbnRjb3JlLiR7UkVHSU9OfS5hbWF6b25hd3MuY29tJyxcbiAgICAgICAgZW5kcG9pbnRzOiB7XG4gICAgICAgICAgZGlzY292ZXJ5OiB7XG4gICAgICAgICAgICBwYXRoOiAnL3YxL21jcC90b29scycsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdMaXN0IGFsbCBhdmFpbGFibGUgTUNQIHRvb2xzJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGludm9rZToge1xuICAgICAgICAgICAgcGF0aDogJy92MS9tY3AvaW52b2tlJyxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdJbnZva2UgYW4gTUNQIHRvb2wgYnkgbmFtZScsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB0b29sU2NoZW1hOiB7XG4gICAgICAgICAgICBwYXRoOiAnL3YxL21jcC90b29scy97dG9vbF9uYW1lfS9zY2hlbWEnLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnR2V0IHNjaGVtYSBmb3IgYSBzcGVjaWZpYyB0b29sJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBhdXRoZW50aWNhdGlvbjogJ0lBTV9TSUdWNCcsXG4gICAgICAgIHJlZ2lvbjogdGhpcy5yZWdpb24sXG4gICAgICAgIG5vdGU6ICdSZXBsYWNlICR7R0FURVdBWV9JRH0gd2l0aCB0aGUgYWN0dWFsIEdhdGV3YXkgSUQgYWZ0ZXIgY3JlYXRpb24nLFxuICAgICAgfSwgbnVsbCwgMiksXG4gICAgICBkZXNjcmlwdGlvbjogJ01DUCBlbmRwb2ludCBjb25maWd1cmF0aW9uIGZvciB0b29sIGRpc2NvdmVyeSBhbmQgaW52b2NhdGlvbicsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRNY3BFbmRwb2ludENvbmZpZycsXG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXQgR2F0ZXdheSB0YXJnZXQgQVJOIHBhdHRlcm5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR2F0ZXdheVRhcmdldEFyblBhdHRlcm4nLCB7XG4gICAgICB2YWx1ZTogYGFybjphd3M6YmVkcm9jay1hZ2VudGNvcmU6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmdhdGV3YXktdGFyZ2V0L1xcJHtHQVRFV0FZX1RBUkdFVF9JRH1gLFxuICAgICAgZGVzY3JpcHRpb246ICdBUk4gcGF0dGVybiBmb3IgdGhlIEdhdGV3YXkgdGFyZ2V0LiBSZXBsYWNlICR7R0FURVdBWV9UQVJHRVRfSUR9IHdpdGggYWN0dWFsIElEIGFmdGVyIGNyZWF0aW9uLicsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRHYXRld2F5VGFyZ2V0QXJuUGF0dGVybicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR2F0ZXdheVRhcmdldENvbmZpZycsIHtcbiAgICAgIHZhbHVlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIG5hbWU6ICd4NDAyLWNvbnRlbnQtdG9vbHMnLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1ByZW1pdW0gY29udGVudCBlbmRwb2ludHMgcHJvdGVjdGVkIGJ5IHg0MDIgcGF5bWVudCBwcm90b2NvbCcsXG4gICAgICAgIHR5cGU6ICdPUEVOQVBJJyxcbiAgICAgICAgdGFyZ2V0VXJsOiBzZWxsZXJDbG91ZEZyb250VXJsLFxuICAgICAgICBvcGVuQXBpU3BlY1MzVXJpOiBgczM6Ly8ke3RoaXMub3BlbkFwaVNwZWNBc3NldC5zM0J1Y2tldE5hbWV9LyR7dGhpcy5vcGVuQXBpU3BlY0Fzc2V0LnMzT2JqZWN0S2V5fWAsXG4gICAgICAgIHRvb2xzOiBbXG4gICAgICAgICAgeyBuYW1lOiAnZ2V0X3ByZW1pdW1fYXJ0aWNsZScsIHByaWNlOiAnMC4wMDEgVVNEQycgfSxcbiAgICAgICAgICB7IG5hbWU6ICdnZXRfd2VhdGhlcl9kYXRhJywgcHJpY2U6ICcwLjAwMDUgVVNEQycgfSxcbiAgICAgICAgICB7IG5hbWU6ICdnZXRfbWFya2V0X2FuYWx5c2lzJywgcHJpY2U6ICcwLjAwMiBVU0RDJyB9LFxuICAgICAgICAgIHsgbmFtZTogJ2dldF9yZXNlYXJjaF9yZXBvcnQnLCBwcmljZTogJzAuMDA1IFVTREMnIH0sXG4gICAgICAgIF0sXG4gICAgICB9LCBudWxsLCAyKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnR2F0ZXdheSB0YXJnZXQgY29uZmlndXJhdGlvbiBmb3IgTUNQIHRvb2wgc2VydmVyJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudEdhdGV3YXlUYXJnZXRDb25maWcnLFxuICAgIH0pO1xuXG4gICAgLy8gSW5zdHJ1Y3Rpb25zIGZvciBtYW51YWwgQWdlbnRDb3JlIHNldHVwXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ05leHRTdGVwcycsIHtcbiAgICAgIHZhbHVlOiBgXG5BZnRlciBkZXBsb3lpbmcgdGhpcyBzdGFjazpcblxuMS4gVXBkYXRlIHRoZSBDRFAgc2VjcmV0IHdpdGggeW91ciBhY3R1YWwgY3JlZGVudGlhbHM6XG4gICBhd3Mgc2VjcmV0c21hbmFnZXIgcHV0LXNlY3JldC12YWx1ZSAtLXNlY3JldC1pZCAke2NkcFNlY3JldC5zZWNyZXROYW1lfSAtLXNlY3JldC1zdHJpbmcgJ3tcIkNEUF9BUElfS0VZX05BTUVcIjpcInlvdXIta2V5XCIsXCJDRFBfQVBJX0tFWV9QUklWQVRFX0tFWVwiOlwieW91ci1wcml2YXRlLWtleVwifSdcblxuMi4gRGVwbG95IHRoZSBzZWxsZXIgaW5mcmFzdHJ1Y3R1cmUgZmlyc3QgKGlmIG5vdCBhbHJlYWR5IGRlcGxveWVkKTpcbiAgIGNkIHNlbGxlci1pbmZyYXN0cnVjdHVyZSAmJiBucG0gaW5zdGFsbCAmJiBjZGsgZGVwbG95XG4gICAjIE5vdGUgdGhlIENsb3VkRnJvbnQgVVJMIGZyb20gdGhlIG91dHB1dFxuXG4zLiBTZXQgdGhlIHNlbGxlciBDbG91ZEZyb250IFVSTCBlbnZpcm9ubWVudCB2YXJpYWJsZTpcbiAgIGV4cG9ydCBYNDAyX1NFTExFUl9DTE9VREZST05UX1VSTD1odHRwczovL2RYWFhYWFhYWFhYWFhYLmNsb3VkZnJvbnQubmV0XG5cbjQuIENyZWF0ZSBBZ2VudENvcmUgUnVudGltZSB2aWEgQ0xJIG9yIGNvbnNvbGU6XG4gICAtIFVzZSB0aGUgYWdlbnQgY29kZSBmcm9tIHBheWVyLWFnZW50L1xuICAgLSBBc3NpZ24gdGhlIHJ1bnRpbWUgcm9sZTogJHthZ2VudFJ1bnRpbWVSb2xlLnJvbGVBcm59XG4gICAtIFNlZSBwYXllci1hZ2VudC9hZ2VudGNvcmVfY29uZmlnLnlhbWwgZm9yIGNvbmZpZ3VyYXRpb25cblxuNS4gQ3JlYXRlIEFnZW50Q29yZSBHYXRld2F5IHdpdGggTUNQIHRvb2wgc2VydmVyOlxuICAgLSBQb2ludCB0byB0aGUgUnVudGltZSBlbmRwb2ludFxuICAgLSBBc3NpZ24gdGhlIGdhdGV3YXkgcm9sZTogJHt0aGlzLmdhdGV3YXlSb2xlLnJvbGVBcm59XG4gICAtIENvbmZpZ3VyZSBJQU0gU2lnVjQgYXV0aGVudGljYXRpb25cbiAgIC0gQ29uZmlndXJlIHJhdGUgbGltaXRpbmc6XG4gICAgICogUmVxdWVzdHMgcGVyIHNlY29uZDogJHt0aGlzLnJhdGVMaW1pdENvbmZpZy5yZXF1ZXN0c1BlclNlY29uZH1cbiAgICAgKiBCdXJzdCBjYXBhY2l0eTogJHt0aGlzLnJhdGVMaW1pdENvbmZpZy5idXJzdENhcGFjaXR5fVxuICAgICAqIExpbWl0IGJ5OiAke3RoaXMucmF0ZUxpbWl0Q29uZmlnLmxpbWl0Qnl9XG4gICAtIFNlZSBwYXllci1hZ2VudC9nYXRld2F5X2NvbmZpZy55YW1sIGZvciBmdWxsIGNvbmZpZ3VyYXRpb25cblxuNi4gQ29uZmlndXJlIEdhdGV3YXkgVGFyZ2V0IGZvciBNQ1AgdG9vbHM6XG4gICAtIFRhcmdldCBuYW1lOiB4NDAyLWNvbnRlbnQtdG9vbHNcbiAgIC0gVGFyZ2V0IHR5cGU6IE9QRU5BUElcbiAgIC0gT3BlbkFQSSBzcGVjIFMzIFVSSTogczM6Ly8ke3RoaXMub3BlbkFwaVNwZWNBc3NldC5zM0J1Y2tldE5hbWV9LyR7dGhpcy5vcGVuQXBpU3BlY0Fzc2V0LnMzT2JqZWN0S2V5fVxuICAgLSBUYXJnZXQgVVJMOiAke3NlbGxlckNsb3VkRnJvbnRVcmx9XG4gICAtIEFzc2lnbiB0YXJnZXQgcm9sZTogJHt0aGlzLmdhdGV3YXlUYXJnZXRSb2xlLnJvbGVBcm59XG4gICAtIENvbmZpZ3VyZSB4NDAyIGhlYWRlciBwYXNzdGhyb3VnaCAoc2VlIGdhdGV3YXlfY29uZmlnLnlhbWwpXG4gICAtIE5vdGUgdGhlIEdhdGV3YXkgVGFyZ2V0IElEIGZvciB0b29sIEFSTiBjb25zdHJ1Y3Rpb25cblxuNy4gU3Vic2NyaWJlIHRvIHJhdGUgbGltaXQgYWxhcm1zIChvcHRpb25hbCk6XG4gICBhd3Mgc25zIHN1YnNjcmliZSAtLXRvcGljLWFybiAke3RoaXMucmF0ZUxpbWl0QWxhcm1Ub3BpYy50b3BpY0Fybn0gLS1wcm90b2NvbCBlbWFpbCAtLW5vdGlmaWNhdGlvbi1lbmRwb2ludCB5b3VyLWVtYWlsQGV4YW1wbGUuY29tXG5cbjguIEdyYW50IEdhdGV3YXkgYWNjZXNzIHRvIGNsaWVudHM6XG4gICAtIEF0dGFjaCB0aGUgaW52b2tlIHBvbGljeSB0byBJQU0gdXNlcnMvcm9sZXMgdGhhdCBuZWVkIGFjY2Vzc1xuICAgLSBQb2xpY3kgQVJOOiAke2dhdGV3YXlJbnZva2VQb2xpY3kubWFuYWdlZFBvbGljeUFybn1cblxuOS4gVGVzdCBNQ1AgdG9vbCBkaXNjb3Zlcnk6XG4gICBjdXJsIC1YIEdFVCBcImh0dHBzOi8vPGdhdGV3YXktdXJsPi92MS9tY3AvdG9vbHNcIiAtSCBcIkF1dGhvcml6YXRpb246IEFXUzQtSE1BQy1TSEEyNTYgLi4uXCJcblxuMTAuIE1vbml0b3IgdGhlIEdhdGV3YXk6XG4gICAgLSBWaWV3IGxvZ3MgaW4gQ2xvdWRXYXRjaDogJHt0aGlzLmdhdGV3YXlMb2dHcm91cC5sb2dHcm91cE5hbWV9XG4gICAgLSBWaWV3IHRhcmdldCBsb2dzOiAke2dhdGV3YXlUYXJnZXRMb2dHcm91cC5sb2dHcm91cE5hbWV9XG4gICAgLSBWaWV3IGRhc2hib2FyZDogaHR0cHM6Ly8ke3RoaXMucmVnaW9ufS5jb25zb2xlLmF3cy5hbWF6b24uY29tL2Nsb3Vkd2F0Y2gvaG9tZT9yZWdpb249JHt0aGlzLnJlZ2lvbn0jZGFzaGJvYXJkczpuYW1lPXg0MDItcGF5ZXItYWdlbnQtZ2F0ZXdheVxuICAgIC0gUmF0ZSBsaW1pdCBhbGFybXMgd2lsbCBub3RpZnkgdmlhIFNOUyB0b3BpY1xuXG5NQ1AgVG9vbCBFbmRwb2ludHM6XG4tIERpc2NvdmVyeTogR0VUIC92MS9tY3AvdG9vbHNcbi0gSW52b2NhdGlvbjogUE9TVCAvdjEvbWNwL2ludm9rZVxuLSBUb29sIFNjaGVtYTogR0VUIC92MS9tY3AvdG9vbHMve3Rvb2xfbmFtZX0vc2NoZW1hXG5cblRvb2wgQVJOIFBhdHRlcm46XG4gIGFybjphd3M6YmVkcm9jay1hZ2VudGNvcmU6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmdhdGV3YXktdGFyZ2V0L3tHQVRFV0FZX1RBUkdFVF9JRH0vdG9vbC97VE9PTF9OQU1FfVxuXG5BdmFpbGFibGUgTUNQIFRvb2xzICh4NDAyIHBheW1lbnQgcmVxdWlyZWQpOlxuLSBnZXRfcHJlbWl1bV9hcnRpY2xlICgwLjAwMSBVU0RDKVxuLSBnZXRfd2VhdGhlcl9kYXRhICgwLjAwMDUgVVNEQylcbi0gZ2V0X21hcmtldF9hbmFseXNpcyAoMC4wMDIgVVNEQylcbi0gZ2V0X3Jlc2VhcmNoX3JlcG9ydCAoMC4wMDUgVVNEQylcblxuU2VlOiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vYmVkcm9jay1hZ2VudGNvcmUvbGF0ZXN0L2Rldmd1aWRlL1xuICAgICAgYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTmV4dCBzdGVwcyBmb3IgQWdlbnRDb3JlIHNldHVwJyxcbiAgICB9KTtcbiAgfVxufVxuIl19