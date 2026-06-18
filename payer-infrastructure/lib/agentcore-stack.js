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
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
const cloudwatch_actions = __importStar(require("aws-cdk-lib/aws-cloudwatch-actions"));
const s3_assets = __importStar(require("aws-cdk-lib/aws-s3-assets"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const cdk_nag_1 = require("cdk-nag");
class AgentCoreStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Get seller CloudFront URL from props, environment, or payer-agent/.env
        let sellerCloudFrontUrl = props?.sellerCloudFrontUrl
            || process.env.X402_SELLER_CLOUDFRONT_URL;
        if (!sellerCloudFrontUrl) {
            const envPath = path.join(__dirname, '../../payer-agent/.env');
            if (fs.existsSync(envPath)) {
                const match = fs.readFileSync(envPath, 'utf-8').match(/^SELLER_API_URL=(.+)$/m);
                if (match)
                    sellerCloudFrontUrl = match[1].trim();
            }
        }
        sellerCloudFrontUrl = sellerCloudFrontUrl || 'https://REPLACE_WITH_CLOUDFRONT_URL.cloudfront.net';
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
        // ==========================================
        // AgentCore Payments IAM Roles
        // ==========================================
        // ProcessPaymentRole — the agent assumes this role to call ProcessPayment.
        // It can ONLY call ProcessPayment — no session/instrument creation.
        const processPaymentRole = new iam.Role(this, 'ProcessPaymentRole', {
            roleName: 'AgentCorePaymentsProcessPaymentRole',
            assumedBy: new iam.AccountRootPrincipal(),
            description: 'IAM role for the agent to call ProcessPayment only',
        });
        processPaymentRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['bedrock-agentcore:ProcessPayment'],
            resources: ['*'],
        }));
        // ManagementRole — the app backend uses this to create instruments and sessions.
        // Explicitly denies ProcessPayment so the backend cannot spend.
        const managementRole = new iam.Role(this, 'PaymentsManagementRole', {
            roleName: 'AgentCorePaymentsManagementRole',
            assumedBy: new iam.AccountRootPrincipal(),
            description: 'IAM role for app backend to manage instruments and sessions (cannot spend)',
        });
        managementRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock-agentcore:CreatePaymentInstrument',
                'bedrock-agentcore:GetPaymentInstrument',
                'bedrock-agentcore:ListPaymentInstruments',
                'bedrock-agentcore:CreatePaymentSession',
                'bedrock-agentcore:GetPaymentSession',
                'bedrock-agentcore:ListPaymentSessions',
                'bedrock-agentcore:UpdatePaymentSession',
            ],
            resources: ['*'],
        }));
        managementRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.DENY,
            actions: ['bedrock-agentcore:ProcessPayment'],
            resources: ['*'],
        }));
        // ResourceRetrievalRole — assumed by AgentCore Payments service at runtime.
        // Trust: bedrock-agentcore.amazonaws.com
        const resourceRetrievalRole = new iam.Role(this, 'PaymentsResourceRetrievalRole', {
            roleName: 'AgentCorePaymentsResourceRetrievalRole',
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
            description: 'Service role for AgentCore Payments to access credentials at runtime',
        });
        resourceRetrievalRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock-agentcore:RetrieveToken',
                'bedrock-agentcore:GetIdentity',
                'secretsmanager:GetSecretValue',
                'sts:SetContext',
            ],
            resources: ['*'],
        }));
        // IAM Role for AgentCore Runtime
        const agentRuntimeRole = new iam.Role(this, 'AgentRuntimeRole', {
            roleName: 'x402-payer-agent-runtime-role',
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
            description: 'IAM role for x402 payer agent running on AgentCore Runtime',
        });
        // Bedrock model access
        // Note: Cross-region inference profiles (us.anthropic.claude-*) route to different regions,
        // so we need to allow all regions for foundation models.
        agentRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
            ],
            resources: [
                // Foundation models in all regions (for cross-region inference)
                'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
                // Cross-region inference profiles
                'arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-*',
            ],
        }));
        // Allow the agent runtime to assume ProcessPaymentRole
        agentRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['sts:AssumeRole'],
            resources: [processPaymentRole.roleArn],
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
        // ECR access for container-based deployment
        agentRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ecr:GetAuthorizationToken',
            ],
            resources: ['*'],
        }));
        agentRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ecr:BatchGetImage',
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchCheckLayerAvailability',
            ],
            resources: [
                `arn:aws:ecr:${this.region}:${this.account}:repository/x402-payer-agent`,
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
                // Allow invoking API Gateways in us-east-1 (seller CloudFront + WAF region)
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
                // Allow invoking x402 Lambda functions in us-east-1 (seller region)
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
                // Scoped to this account — add additional account IDs here for multi-account setups
                `arn:aws:iam::${this.account}:role/x402-gateway-target-*`,
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
        new cdk.CfnOutput(this, 'ProcessPaymentRoleArn', {
            value: processPaymentRole.roleArn,
            description: 'ARN of the ProcessPayment IAM role (agent assumes this)',
            exportName: 'X402PayerAgentProcessPaymentRoleArn',
        });
        new cdk.CfnOutput(this, 'ManagementRoleArn', {
            value: managementRole.roleArn,
            description: 'ARN of the Payments Management IAM role (app backend uses this)',
            exportName: 'X402PayerAgentManagementRoleArn',
        });
        new cdk.CfnOutput(this, 'ResourceRetrievalRoleArn', {
            value: resourceRetrievalRole.roleArn,
            description: 'ARN of the Resource Retrieval service role (AgentCore Payments assumes this)',
            exportName: 'X402PayerAgentResourceRetrievalRoleArn',
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

1. Set up AgentCore Payments resources (one-time) using boto3:
   See: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html

   a. Create a PaymentCredentialProvider with your Coinbase CDP keys
   b. Create a PaymentManager (use ResourceRetrievalRoleArn from this stack output)
   c. Create a PaymentConnector linking the manager to the credential provider
   d. Create a PaymentInstrument (wallet) and fund it with USDC
   e. Create a PaymentSession with a maxSpendAmount budget

2. Deploy the seller infrastructure first (if not already deployed):
   cd seller-infrastructure && npm install && cdk deploy
   # Note the CloudFront URL from the output

3. Configure the payer agent environment:
   cd payer-agent && cp .env.example .env
   # Fill in: MANAGER_ARN, PAYMENT_SESSION_ID, PAYMENT_INSTRUMENT_ID,
   #          PROCESS_PAYMENT_ROLE_ARN (see ProcessPaymentRoleArn output below),
   #          USER_ID, SELLER_API_URL

4. Create AgentCore Runtime via CLI or console:
   - Use the agent code from payer-agent/
   - Assign the runtime role: ${agentRuntimeRole.roleArn}
   - See payer-agent/agentcore_config.yaml for configuration

5. Create AgentCore Gateway with MCP tool server:
   - Point to the Runtime endpoint
   - Assign the gateway role: ${this.gatewayRole.roleArn}
   - Configure IAM SigV4 authentication

6. Configure Gateway Target for MCP tools:
   - Target name: x402-content-tools
   - Target type: OPENAPI
   - OpenAPI spec S3 URI: s3://${this.openApiSpecAsset.s3BucketName}/${this.openApiSpecAsset.s3ObjectKey}
   - Target URL: ${sellerCloudFrontUrl}
   - Assign target role: ${this.gatewayTargetRole.roleArn}

AgentCore Payments Roles (from this stack):
- ProcessPaymentRoleArn: ${processPaymentRole.roleArn}
- ManagementRoleArn: ${managementRole.roleArn}
- ResourceRetrievalRoleArn: ${resourceRetrievalRole.roleArn}

See: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html
      `,
            description: 'Next steps for AgentCore setup',
        });
        // ==========================================
        // CDK Nag Suppressions
        // ==========================================
        cdk_nag_1.NagSuppressions.addResourceSuppressions(agentRuntimeRole, [
            { id: 'AwsSolutions-IAM5', reason: 'Wildcards required: cross-region inference profiles (bedrock:*), CloudWatch log groups (/aws/bedrock-agentcore/*), and ecr:GetAuthorizationToken requires resource *' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(processPaymentRole, [
            { id: 'AwsSolutions-IAM5', reason: 'ProcessPayment needs resource * because payment manager ARNs are dynamic' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(managementRole, [
            { id: 'AwsSolutions-IAM5', reason: 'Management role needs resource * for instrument/session CRUD across payment managers' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(resourceRetrievalRole, [
            { id: 'AwsSolutions-IAM5', reason: 'Service role needs broad access to retrieve credentials from AgentCore Identity' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.gatewayRole, [
            { id: 'AwsSolutions-IAM5', reason: 'Gateway must invoke any agent/alias in the account — IDs are assigned at runtime by AgentCore' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.gatewayTargetRole, [
            { id: 'AwsSolutions-IAM5', reason: 'Gateway target needs broad access: S3 for OpenAPI specs, execute-api for private targets, CloudWatch logs, Lambda functions, KMS for encrypted secrets, and X-Ray tracing — all scoped to account/prefix where possible' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.rateLimitAlarmTopic, [
            { id: 'AwsSolutions-SNS3', reason: 'Demo project — SNS SSL enforcement not required for internal alarm notifications' },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(gatewayInvokePolicy, [
            { id: 'AwsSolutions-IAM5', reason: 'Client invoke policy must allow any agent/alias — IDs assigned at runtime by AgentCore' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(gatewayTargetPolicy, [
            { id: 'AwsSolutions-IAM5', reason: 'Target policy needs S3 wildcard for OpenAPI specs, execute-api for API Gateway targets, and CloudWatch log streams' },
        ], true);
    }
}
exports.AgentCoreStack = AgentCoreStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWdlbnRjb3JlLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYWdlbnRjb3JlLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyx5REFBMkM7QUFDM0MsMkRBQTZDO0FBQzdDLHVFQUF5RDtBQUN6RCx5REFBMkM7QUFDM0MsdUZBQXlFO0FBQ3pFLHFFQUF1RDtBQUN2RCwyQ0FBNkI7QUFDN0IsdUNBQXlCO0FBRXpCLHFDQUEwQztBQTJEMUMsTUFBYSxjQUFlLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFRM0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUEyQjtRQUNuRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qix5RUFBeUU7UUFDekUsSUFBSSxtQkFBbUIsR0FBRyxLQUFLLEVBQUUsbUJBQW1CO2VBQy9DLE9BQU8sQ0FBQyxHQUFHLENBQUMsMEJBQTBCLENBQUM7UUFDNUMsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUM7WUFDekIsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsd0JBQXdCLENBQUMsQ0FBQztZQUMvRCxJQUFJLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztnQkFDM0IsTUFBTSxLQUFLLEdBQUcsRUFBRSxDQUFDLFlBQVksQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUMsS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUM7Z0JBQ2hGLElBQUksS0FBSztvQkFBRSxtQkFBbUIsR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDbkQsQ0FBQztRQUNILENBQUM7UUFDRCxtQkFBbUIsR0FBRyxtQkFBbUIsSUFBSSxvREFBb0QsQ0FBQztRQUVsRyxvREFBb0Q7UUFDcEQsSUFB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LG1CQUFtQixFQUFFLE1BQU0sRUFBRSx5TkFBeU4sRUFBRTtTQUMvUCxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRVQseUJBQWUsQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLEVBQUU7WUFDaEUsRUFBRSxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLGtGQUFrRixFQUFFO1NBQ3hILENBQUMsQ0FBQztRQUVILHlCQUFlLENBQUMsdUJBQXVCLENBQUMsbUJBQW1CLEVBQUU7WUFDM0QsRUFBRSxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLHdGQUF3RixFQUFFO1NBQzlILEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFVCx5QkFBZSxDQUFDLHVCQUF1QixDQUFDLG1CQUFtQixFQUFFO1lBQzNELEVBQUUsRUFBRSxFQUFFLG1CQUFtQixFQUFFLE1BQU0sRUFBRSxvSEFBb0gsRUFBRTtTQUMxSixFQUFFLElBQUksQ0FBQyxDQUFDO0lBQ1gsQ0FBQztDQUNGO0FBaDlCRCx3Q0FnOUJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCc7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoX2FjdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gtYWN0aW9ucyc7XG5pbXBvcnQgKiBhcyBzM19hc3NldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWFzc2V0cyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJztcblxuLyoqXG4gKiBSYXRlIGxpbWl0aW5nIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBBZ2VudENvcmUgR2F0ZXdheS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSYXRlTGltaXRDb25maWcge1xuICAvKiogUmVxdWVzdHMgcGVyIHNlY29uZCBwZXIgY2xpZW50IChkZWZhdWx0OiAxMCkgKi9cbiAgcmVxdWVzdHNQZXJTZWNvbmQ6IG51bWJlcjtcbiAgLyoqIEJ1cnN0IGNhcGFjaXR5IGZvciBoYW5kbGluZyB0cmFmZmljIHNwaWtlcyAoZGVmYXVsdDogMjApICovXG4gIGJ1cnN0Q2FwYWNpdHk6IG51bWJlcjtcbiAgLyoqIFJhdGUgbGltaXQgYnkgSUFNIHByaW5jaXBhbCBvciBJUCBhZGRyZXNzICovXG4gIGxpbWl0Qnk6ICdJQU1fUFJJTkNJUEFMJyB8ICdJUF9BRERSRVNTJztcbiAgLyoqIEVuYWJsZSByYXRlIGxpbWl0IGFsYXJtcyAqL1xuICBlbmFibGVBbGFybXM6IGJvb2xlYW47XG4gIC8qKiBUaHJlc2hvbGQgcGVyY2VudGFnZSBmb3IgcmF0ZSBsaW1pdCB3YXJuaW5nIGFsYXJtIChkZWZhdWx0OiA4MCkgKi9cbiAgd2FybmluZ1RocmVzaG9sZFBlcmNlbnQ6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBHYXRld2F5IHRhcmdldCBjb25maWd1cmF0aW9uIGZvciBNQ1AgdG9vbCBzZXJ2ZXIuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2F0ZXdheVRhcmdldENvbmZpZyB7XG4gIC8qKiBOYW1lIG9mIHRoZSB0YXJnZXQgKi9cbiAgbmFtZTogc3RyaW5nO1xuICAvKiogRGVzY3JpcHRpb24gb2YgdGhlIHRhcmdldCAqL1xuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICAvKiogVGFyZ2V0IFVSTCAoQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gVVJMKSAqL1xuICB0YXJnZXRVcmw6IHN0cmluZztcbiAgLyoqIFBhdGggdG8gT3BlbkFQSSBzcGVjIGZpbGUgKHJlbGF0aXZlIHRvIHBheWVyLWFnZW50IGRpcmVjdG9yeSkgKi9cbiAgb3BlbkFwaVNwZWNQYXRoPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIENESyBTdGFjayBmb3IgQmVkcm9jayBBZ2VudENvcmUgaW5mcmFzdHJ1Y3R1cmUuXG4gKiBcbiAqIE5vdGU6IEFnZW50Q29yZSBDREsgTDIgY29uc3RydWN0cyBhcmUgdW5kZXIgZGV2ZWxvcG1lbnQgKFJGQyAjNzg1KS5cbiAqIFRoaXMgc3RhY2sgdXNlcyBMMSBjb25zdHJ1Y3RzIGFuZCBJQU0gcm9sZXMgZm9yIEFnZW50Q29yZSBpbnRlZ3JhdGlvbi5cbiAqIFxuICogRm9yIHByb2R1Y3Rpb24gZGVwbG95bWVudCwgdXNlIHRoZSBBZ2VudENvcmUgQ0xJIG9yIGNvbnNvbGUgdG8gY3JlYXRlOlxuICogLSBBZ2VudENvcmUgUnVudGltZVxuICogLSBBZ2VudENvcmUgR2F0ZXdheVxuICogLSBBZ2VudENvcmUgTWVtb3J5IChvcHRpb25hbClcbiAqIFxuICogR2F0ZXdheSBDb25maWd1cmF0aW9uOlxuICogLSBJQU0gU2lnVjQgYXV0aGVudGljYXRpb24gZm9yIHNlY3VyZSBBUEkgYWNjZXNzXG4gKiAtIFJhdGUgbGltaXRpbmcgdG8gcHJldmVudCBhYnVzZVxuICogLSBDT1JTIHN1cHBvcnQgZm9yIHdlYiBjbGllbnRzXG4gKiAtIENsb3VkV2F0Y2ggbG9nZ2luZyBhbmQgbWV0cmljc1xuICovXG5cbmV4cG9ydCBpbnRlcmZhY2UgQWdlbnRDb3JlU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqIFJhdGUgbGltaXRpbmcgY29uZmlndXJhdGlvbiAqL1xuICByYXRlTGltaXRDb25maWc/OiBQYXJ0aWFsPFJhdGVMaW1pdENvbmZpZz47XG4gIC8qKiBHYXRld2F5IHRhcmdldCBjb25maWd1cmF0aW9uIGZvciBNQ1AgdG9vbCBzZXJ2ZXIgKi9cbiAgZ2F0ZXdheVRhcmdldENvbmZpZz86IEdhdGV3YXlUYXJnZXRDb25maWc7XG4gIC8qKiBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBVUkwgZm9yIHNlbGxlciBpbmZyYXN0cnVjdHVyZSAqL1xuICBzZWxsZXJDbG91ZEZyb250VXJsPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQWdlbnRDb3JlU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgZ2F0ZXdheVJvbGU6IGlhbS5Sb2xlO1xuICBwdWJsaWMgcmVhZG9ubHkgZ2F0ZXdheUxvZ0dyb3VwOiBsb2dzLkxvZ0dyb3VwO1xuICBwdWJsaWMgcmVhZG9ubHkgcmF0ZUxpbWl0QWxhcm1Ub3BpYzogc25zLlRvcGljO1xuICBwdWJsaWMgcmVhZG9ubHkgcmF0ZUxpbWl0Q29uZmlnOiBSYXRlTGltaXRDb25maWc7XG4gIHB1YmxpYyByZWFkb25seSBvcGVuQXBpU3BlY0Fzc2V0OiBzM19hc3NldHMuQXNzZXQ7XG4gIHB1YmxpYyByZWFkb25seSBnYXRld2F5VGFyZ2V0Um9sZTogaWFtLlJvbGU7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBBZ2VudENvcmVTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBHZXQgc2VsbGVyIENsb3VkRnJvbnQgVVJMIGZyb20gcHJvcHMsIGVudmlyb25tZW50LCBvciBwYXllci1hZ2VudC8uZW52XG4gICAgbGV0IHNlbGxlckNsb3VkRnJvbnRVcmwgPSBwcm9wcz8uc2VsbGVyQ2xvdWRGcm9udFVybFxuICAgICAgfHwgcHJvY2Vzcy5lbnYuWDQwMl9TRUxMRVJfQ0xPVURGUk9OVF9VUkw7XG4gICAgaWYgKCFzZWxsZXJDbG91ZEZyb250VXJsKSB7XG4gICAgICBjb25zdCBlbnZQYXRoID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL3BheWVyLWFnZW50Ly5lbnYnKTtcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKGVudlBhdGgpKSB7XG4gICAgICAgIGNvbnN0IG1hdGNoID0gZnMucmVhZEZpbGVTeW5jKGVudlBhdGgsICd1dGYtOCcpLm1hdGNoKC9eU0VMTEVSX0FQSV9VUkw9KC4rKSQvbSk7XG4gICAgICAgIGlmIChtYXRjaCkgc2VsbGVyQ2xvdWRGcm9udFVybCA9IG1hdGNoWzFdLnRyaW0oKTtcbiAgICAgIH1cbiAgICB9XG4gICAgc2VsbGVyQ2xvdWRGcm9udFVybCA9IHNlbGxlckNsb3VkRnJvbnRVcmwgfHwgJ2h0dHBzOi8vUkVQTEFDRV9XSVRIX0NMT1VERlJPTlRfVVJMLmNsb3VkZnJvbnQubmV0JztcblxuICAgIC8vIEluaXRpYWxpemUgcmF0ZSBsaW1pdCBjb25maWd1cmF0aW9uIHdpdGggZGVmYXVsdHNcbiAgICB0aGlzLnJhdGVMaW1pdENvbmZpZyA9IHtcbiAgICAgIHJlcXVlc3RzUGVyU2Vjb25kOiBwcm9wcz8ucmF0ZUxpbWl0Q29uZmlnPy5yZXF1ZXN0c1BlclNlY29uZCA/PyAxMCxcbiAgICAgIGJ1cnN0Q2FwYWNpdHk6IHByb3BzPy5yYXRlTGltaXRDb25maWc/LmJ1cnN0Q2FwYWNpdHkgPz8gMjAsXG4gICAgICBsaW1pdEJ5OiBwcm9wcz8ucmF0ZUxpbWl0Q29uZmlnPy5saW1pdEJ5ID8/ICdJQU1fUFJJTkNJUEFMJyxcbiAgICAgIGVuYWJsZUFsYXJtczogcHJvcHM/LnJhdGVMaW1pdENvbmZpZz8uZW5hYmxlQWxhcm1zID8/IHRydWUsXG4gICAgICB3YXJuaW5nVGhyZXNob2xkUGVyY2VudDogcHJvcHM/LnJhdGVMaW1pdENvbmZpZz8ud2FybmluZ1RocmVzaG9sZFBlcmNlbnQgPz8gODAsXG4gICAgfTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE9wZW5BUEkgU3BlYyBBc3NldCBmb3IgR2F0ZXdheSBUYXJnZXRcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBVcGxvYWQgdGhlIE9wZW5BUEkgc3BlYyB0byBTMyBmb3IgdXNlIGJ5IEFnZW50Q29yZSBHYXRld2F5XG4gICAgdGhpcy5vcGVuQXBpU3BlY0Fzc2V0ID0gbmV3IHMzX2Fzc2V0cy5Bc3NldCh0aGlzLCAnT3BlbkFwaVNwZWNBc3NldCcsIHtcbiAgICAgIHBhdGg6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9wYXllci1hZ2VudC9vcGVuYXBpL2NvbnRlbnQtdG9vbHMueWFtbCcpLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQWdlbnRDb3JlIFBheW1lbnRzIElBTSBSb2xlc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gUHJvY2Vzc1BheW1lbnRSb2xlIOKAlCB0aGUgYWdlbnQgYXNzdW1lcyB0aGlzIHJvbGUgdG8gY2FsbCBQcm9jZXNzUGF5bWVudC5cbiAgICAvLyBJdCBjYW4gT05MWSBjYWxsIFByb2Nlc3NQYXltZW50IOKAlCBubyBzZXNzaW9uL2luc3RydW1lbnQgY3JlYXRpb24uXG4gICAgY29uc3QgcHJvY2Vzc1BheW1lbnRSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdQcm9jZXNzUGF5bWVudFJvbGUnLCB7XG4gICAgICByb2xlTmFtZTogJ0FnZW50Q29yZVBheW1lbnRzUHJvY2Vzc1BheW1lbnRSb2xlJyxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5BY2NvdW50Um9vdFByaW5jaXBhbCgpLFxuICAgICAgZGVzY3JpcHRpb246ICdJQU0gcm9sZSBmb3IgdGhlIGFnZW50IHRvIGNhbGwgUHJvY2Vzc1BheW1lbnQgb25seScsXG4gICAgfSk7XG4gICAgcHJvY2Vzc1BheW1lbnRSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFsnYmVkcm9jay1hZ2VudGNvcmU6UHJvY2Vzc1BheW1lbnQnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8gTWFuYWdlbWVudFJvbGUg4oCUIHRoZSBhcHAgYmFja2VuZCB1c2VzIHRoaXMgdG8gY3JlYXRlIGluc3RydW1lbnRzIGFuZCBzZXNzaW9ucy5cbiAgICAvLyBFeHBsaWNpdGx5IGRlbmllcyBQcm9jZXNzUGF5bWVudCBzbyB0aGUgYmFja2VuZCBjYW5ub3Qgc3BlbmQuXG4gICAgY29uc3QgbWFuYWdlbWVudFJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1BheW1lbnRzTWFuYWdlbWVudFJvbGUnLCB7XG4gICAgICByb2xlTmFtZTogJ0FnZW50Q29yZVBheW1lbnRzTWFuYWdlbWVudFJvbGUnLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkFjY291bnRSb290UHJpbmNpcGFsKCksXG4gICAgICBkZXNjcmlwdGlvbjogJ0lBTSByb2xlIGZvciBhcHAgYmFja2VuZCB0byBtYW5hZ2UgaW5zdHJ1bWVudHMgYW5kIHNlc3Npb25zIChjYW5ub3Qgc3BlbmQpJyxcbiAgICB9KTtcbiAgICBtYW5hZ2VtZW50Um9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpDcmVhdGVQYXltZW50SW5zdHJ1bWVudCcsXG4gICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpHZXRQYXltZW50SW5zdHJ1bWVudCcsXG4gICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpMaXN0UGF5bWVudEluc3RydW1lbnRzJyxcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkNyZWF0ZVBheW1lbnRTZXNzaW9uJyxcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkdldFBheW1lbnRTZXNzaW9uJyxcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkxpc3RQYXltZW50U2Vzc2lvbnMnLFxuICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6VXBkYXRlUGF5bWVudFNlc3Npb24nLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuICAgIG1hbmFnZW1lbnRSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5ERU5ZLFxuICAgICAgYWN0aW9uczogWydiZWRyb2NrLWFnZW50Y29yZTpQcm9jZXNzUGF5bWVudCddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBSZXNvdXJjZVJldHJpZXZhbFJvbGUg4oCUIGFzc3VtZWQgYnkgQWdlbnRDb3JlIFBheW1lbnRzIHNlcnZpY2UgYXQgcnVudGltZS5cbiAgICAvLyBUcnVzdDogYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbVxuICAgIGNvbnN0IHJlc291cmNlUmV0cmlldmFsUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnUGF5bWVudHNSZXNvdXJjZVJldHJpZXZhbFJvbGUnLCB7XG4gICAgICByb2xlTmFtZTogJ0FnZW50Q29yZVBheW1lbnRzUmVzb3VyY2VSZXRyaWV2YWxSb2xlJyxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdiZWRyb2NrLWFnZW50Y29yZS5hbWF6b25hd3MuY29tJyksXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlcnZpY2Ugcm9sZSBmb3IgQWdlbnRDb3JlIFBheW1lbnRzIHRvIGFjY2VzcyBjcmVkZW50aWFscyBhdCBydW50aW1lJyxcbiAgICB9KTtcbiAgICByZXNvdXJjZVJldHJpZXZhbFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6UmV0cmlldmVUb2tlbicsXG4gICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpHZXRJZGVudGl0eScsXG4gICAgICAgICdzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZScsXG4gICAgICAgICdzdHM6U2V0Q29udGV4dCcsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBJQU0gUm9sZSBmb3IgQWdlbnRDb3JlIFJ1bnRpbWVcbiAgICBjb25zdCBhZ2VudFJ1bnRpbWVSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdBZ2VudFJ1bnRpbWVSb2xlJywge1xuICAgICAgcm9sZU5hbWU6ICd4NDAyLXBheWVyLWFnZW50LXJ1bnRpbWUtcm9sZScsXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246ICdJQU0gcm9sZSBmb3IgeDQwMiBwYXllciBhZ2VudCBydW5uaW5nIG9uIEFnZW50Q29yZSBSdW50aW1lJyxcbiAgICB9KTtcblxuICAgIC8vIEJlZHJvY2sgbW9kZWwgYWNjZXNzXG4gICAgLy8gTm90ZTogQ3Jvc3MtcmVnaW9uIGluZmVyZW5jZSBwcm9maWxlcyAodXMuYW50aHJvcGljLmNsYXVkZS0qKSByb3V0ZSB0byBkaWZmZXJlbnQgcmVnaW9ucyxcbiAgICAvLyBzbyB3ZSBuZWVkIHRvIGFsbG93IGFsbCByZWdpb25zIGZvciBmb3VuZGF0aW9uIG1vZGVscy5cbiAgICBhZ2VudFJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWwnLFxuICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbFdpdGhSZXNwb25zZVN0cmVhbScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIC8vIEZvdW5kYXRpb24gbW9kZWxzIGluIGFsbCByZWdpb25zIChmb3IgY3Jvc3MtcmVnaW9uIGluZmVyZW5jZSlcbiAgICAgICAgJ2Fybjphd3M6YmVkcm9jazoqOjpmb3VuZGF0aW9uLW1vZGVsL2FudGhyb3BpYy5jbGF1ZGUtKicsXG4gICAgICAgIC8vIENyb3NzLXJlZ2lvbiBpbmZlcmVuY2UgcHJvZmlsZXNcbiAgICAgICAgJ2Fybjphd3M6YmVkcm9jazoqOio6aW5mZXJlbmNlLXByb2ZpbGUvdXMuYW50aHJvcGljLmNsYXVkZS0qJyxcbiAgICAgIF0sXG4gICAgfSkpO1xuXG4gICAgLy8gQWxsb3cgdGhlIGFnZW50IHJ1bnRpbWUgdG8gYXNzdW1lIFByb2Nlc3NQYXltZW50Um9sZVxuICAgIGFnZW50UnVudGltZVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLFxuICAgICAgcmVzb3VyY2VzOiBbcHJvY2Vzc1BheW1lbnRSb2xlLnJvbGVBcm5dLFxuICAgIH0pKTtcblxuICAgIC8vIENsb3VkV2F0Y2ggTG9ncyBhY2Nlc3NcbiAgICBhZ2VudFJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLFxuICAgICAgICAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLFxuICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9iZWRyb2NrLWFnZW50Y29yZS8qYCxcbiAgICAgIF0sXG4gICAgfSkpO1xuXG4gICAgLy8gRUNSIGFjY2VzcyBmb3IgY29udGFpbmVyLWJhc2VkIGRlcGxveW1lbnRcbiAgICBhZ2VudFJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2VjcjpHZXRBdXRob3JpemF0aW9uVG9rZW4nLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgYWdlbnRSdW50aW1lUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdlY3I6QmF0Y2hHZXRJbWFnZScsXG4gICAgICAgICdlY3I6R2V0RG93bmxvYWRVcmxGb3JMYXllcicsXG4gICAgICAgICdlY3I6QmF0Y2hDaGVja0xheWVyQXZhaWxhYmlsaXR5JyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6ZWNyOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpyZXBvc2l0b3J5L3g0MDItcGF5ZXItYWdlbnRgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyBJQU0gUm9sZSBmb3IgQWdlbnRDb3JlIEdhdGV3YXkgKGZvciBBUEkgYWNjZXNzKVxuICAgIHRoaXMuZ2F0ZXdheVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0dhdGV3YXlSb2xlJywge1xuICAgICAgcm9sZU5hbWU6ICd4NDAyLXBheWVyLWFnZW50LWdhdGV3YXktcm9sZScsXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246ICdJQU0gcm9sZSBmb3IgeDQwMiBwYXllciBhZ2VudCBHYXRld2F5JyxcbiAgICB9KTtcblxuICAgIC8vIEdhdGV3YXkgcGVybWlzc2lvbnMgdG8gaW52b2tlIHRoZSBSdW50aW1lXG4gICAgdGhpcy5nYXRld2F5Um9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdiZWRyb2NrOkludm9rZUFnZW50JyxcbiAgICAgICAgJ2JlZHJvY2s6SW52b2tlQWdlbnRXaXRoUmVzcG9uc2VTdHJlYW0nLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTphZ2VudC8qYCxcbiAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06YWdlbnQtYWxpYXMvKmAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vIEdhdGV3YXkgQ2xvdWRXYXRjaCBMb2dzIHBlcm1pc3Npb25zXG4gICAgdGhpcy5nYXRld2F5Um9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsXG4gICAgICAgICdsb2dzOlB1dExvZ0V2ZW50cycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2JlZHJvY2stYWdlbnRjb3JlL2dhdGV3YXkvKmAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEdhdGV3YXkgVGFyZ2V0IFJvbGUgKGZvciBNQ1AgVG9vbCBTZXJ2ZXIpXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gVGhpcyByb2xlIGFsbG93cyB0aGUgR2F0ZXdheSB0byBpbnZva2UgZXh0ZXJuYWwgdGFyZ2V0cyAoQ2xvdWRGcm9udC9BUEkgR2F0ZXdheSlcbiAgICAvLyBhbmQgYWNjZXNzIHRoZSBPcGVuQVBJIHNwZWNpZmljYXRpb24gZm9yIHRvb2wgZGlzY292ZXJ5LlxuICAgIC8vXG4gICAgLy8gVHJ1c3QgUmVsYXRpb25zaGlwOlxuICAgIC8vIC0gYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbTogQWdlbnRDb3JlIEdhdGV3YXkgc2VydmljZVxuICAgIC8vIC0gYmVkcm9jay5hbWF6b25hd3MuY29tOiBCZWRyb2NrIHNlcnZpY2UgKGZvciBhZ2VudCBpbnZvY2F0aW9ucylcbiAgICAvL1xuICAgIC8vIFBlcm1pc3Npb25zOlxuICAgIC8vIC0gUzM6IFJlYWQgT3BlbkFQSSBzcGVjIGZvciB0b29sIHNjaGVtYSBkaXNjb3ZlcnlcbiAgICAvLyAtIEFQSSBHYXRld2F5OiBJbnZva2UgcHJpdmF0ZSBBUEkgdGFyZ2V0cyAoaWYgY29uZmlndXJlZClcbiAgICAvLyAtIENsb3VkV2F0Y2ggTG9nczogV3JpdGUgdGFyZ2V0IGludm9jYXRpb24gbG9nc1xuICAgIC8vIC0gTGFtYmRhOiBJbnZva2UgTGFtYmRhIHRhcmdldHMgKGlmIGNvbmZpZ3VyZWQpXG4gICAgLy8gLSBTVFM6IEFzc3VtZSBjcm9zcy1hY2NvdW50IHJvbGVzIChmb3IgbXVsdGktYWNjb3VudCBzZXR1cHMpXG4gICAgLy9cbiAgICB0aGlzLmdhdGV3YXlUYXJnZXRSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdHYXRld2F5VGFyZ2V0Um9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiAneDQwMi1wYXllci1hZ2VudC1nYXRld2F5LXRhcmdldC1yb2xlJyxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5Db21wb3NpdGVQcmluY2lwYWwoXG4gICAgICAgIG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2JlZHJvY2suYW1hem9uYXdzLmNvbScpLFxuICAgICAgKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnSUFNIHJvbGUgZm9yIEFnZW50Q29yZSBHYXRld2F5IHRvIGludm9rZSBleHRlcm5hbCB0YXJnZXRzIChNQ1AgdG9vbCBzZXJ2ZXIpJyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFMzIFBlcm1pc3Npb25zIChPcGVuQVBJIFNwZWMgQWNjZXNzKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEdhdGV3YXkgbmVlZHMgdG8gcmVhZCB0aGUgT3BlbkFQSSBzcGVjIHRvIGRpc2NvdmVyIHRvb2wgc2NoZW1hc1xuICAgIC8vIGFuZCBnZW5lcmF0ZSBNQ1AgdG9vbCBkZWZpbml0aW9ucyBmb3IgYWdlbnQgZGlzY292ZXJ5LlxuICAgIHRoaXMuZ2F0ZXdheVRhcmdldFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgc2lkOiAnT3BlbkFwaVNwZWNBY2Nlc3MnLFxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnczM6R2V0T2JqZWN0JyxcbiAgICAgICAgJ3MzOkdldE9iamVjdFZlcnNpb24nLFxuICAgICAgICAnczM6R2V0T2JqZWN0QXR0cmlidXRlcycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIHRoaXMub3BlbkFwaVNwZWNBc3NldC5idWNrZXQuYXJuRm9yT2JqZWN0cygnKicpLFxuICAgICAgICAvLyBBbHNvIGFsbG93IGFjY2VzcyB0byBhbnkgT3BlbkFQSSBzcGVjcyBpbiBhIGRlZGljYXRlZCBidWNrZXRcbiAgICAgICAgYGFybjphd3M6czM6Ojoke3RoaXMuYWNjb3VudH0tYWdlbnRjb3JlLW9wZW5hcGktc3BlY3MvKmAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vIFMzIGJ1Y2tldCBsaXN0aW5nIGZvciBzcGVjIGRpc2NvdmVyeVxuICAgIHRoaXMuZ2F0ZXdheVRhcmdldFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgc2lkOiAnT3BlbkFwaVNwZWNCdWNrZXRMaXN0JyxcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ3MzOkxpc3RCdWNrZXQnLFxuICAgICAgICAnczM6R2V0QnVja2V0TG9jYXRpb24nLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICB0aGlzLm9wZW5BcGlTcGVjQXNzZXQuYnVja2V0LmJ1Y2tldEFybixcbiAgICAgICAgYGFybjphd3M6czM6Ojoke3RoaXMuYWNjb3VudH0tYWdlbnRjb3JlLW9wZW5hcGktc3BlY3NgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBBUEkgR2F0ZXdheSBQZXJtaXNzaW9ucyAoUHJpdmF0ZSBUYXJnZXRzKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEZvciBwcml2YXRlIEFQSSBHYXRld2F5IHRhcmdldHMsIHRoZSBHYXRld2F5IG5lZWRzIGV4ZWN1dGUtYXBpOkludm9rZVxuICAgIC8vIE5vdGU6IENsb3VkRnJvbnQgaXMgcHVibGljIGFuZCBkb2Vzbid0IHJlcXVpcmUgSUFNIHBlcm1pc3Npb25zLFxuICAgIC8vIGJ1dCB3ZSBpbmNsdWRlIEFQSSBHYXRld2F5IHBlcm1pc3Npb25zIGZvciBmdXR1cmUgcHJpdmF0ZSB0YXJnZXRzLlxuICAgIHRoaXMuZ2F0ZXdheVRhcmdldFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgc2lkOiAnQXBpR2F0ZXdheUludm9rZScsXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdleGVjdXRlLWFwaTpJbnZva2UnLFxuICAgICAgICAnZXhlY3V0ZS1hcGk6TWFuYWdlQ29ubmVjdGlvbnMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICAvLyBBbGxvdyBpbnZva2luZyBhbnkgQVBJIEdhdGV3YXkgaW4gdGhpcyBhY2NvdW50XG4gICAgICAgIGBhcm46YXdzOmV4ZWN1dGUtYXBpOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fToqLyovKi8qYCxcbiAgICAgICAgLy8gQWxsb3cgaW52b2tpbmcgQVBJIEdhdGV3YXlzIGluIHVzLWVhc3QtMSAoc2VsbGVyIENsb3VkRnJvbnQgKyBXQUYgcmVnaW9uKVxuICAgICAgICBgYXJuOmF3czpleGVjdXRlLWFwaTp1cy1lYXN0LTE6JHt0aGlzLmFjY291bnR9OiovKi8qLypgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBMYW1iZGEgUGVybWlzc2lvbnMgKExhbWJkYSBUYXJnZXRzKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEZvciBMYW1iZGEgZnVuY3Rpb24gdGFyZ2V0cywgdGhlIEdhdGV3YXkgbmVlZHMgbGFtYmRhOkludm9rZUZ1bmN0aW9uXG4gICAgLy8gVGhpcyBlbmFibGVzIGRpcmVjdCBMYW1iZGEgaW52b2NhdGlvbiB3aXRob3V0IGdvaW5nIHRocm91Z2ggQVBJIEdhdGV3YXkuXG4gICAgdGhpcy5nYXRld2F5VGFyZ2V0Um9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBzaWQ6ICdMYW1iZGFJbnZva2UnLFxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnbGFtYmRhOkludm9rZUZ1bmN0aW9uJyxcbiAgICAgICAgJ2xhbWJkYTpJbnZva2VBc3luYycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIC8vIEFsbG93IGludm9raW5nIExhbWJkYSBmdW5jdGlvbnMgd2l0aCB4NDAyIHByZWZpeFxuICAgICAgICBgYXJuOmF3czpsYW1iZGE6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmZ1bmN0aW9uOng0MDItKmAsXG4gICAgICAgIC8vIEFsbG93IGludm9raW5nIHg0MDIgTGFtYmRhIGZ1bmN0aW9ucyBpbiB1cy1lYXN0LTEgKHNlbGxlciByZWdpb24pXG4gICAgICAgIGBhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6JHt0aGlzLmFjY291bnR9OmZ1bmN0aW9uOng0MDItKmAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENsb3VkV2F0Y2ggTG9ncyBQZXJtaXNzaW9uc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEdhdGV3YXkgVGFyZ2V0IG5lZWRzIHRvIHdyaXRlIGxvZ3MgZm9yIGRlYnVnZ2luZyBhbmQgbW9uaXRvcmluZ1xuICAgIHRoaXMuZ2F0ZXdheVRhcmdldFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgc2lkOiAnQ2xvdWRXYXRjaExvZ3NXcml0ZScsXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJyxcbiAgICAgICAgJ2xvZ3M6UHV0TG9nRXZlbnRzJyxcbiAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOi9hd3MvYmVkcm9jay1hZ2VudGNvcmUvZ2F0ZXdheS10YXJnZXQvKmAsXG4gICAgICAgIGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2JlZHJvY2stYWdlbnRjb3JlL2dhdGV3YXktdGFyZ2V0Lyo6KmAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENsb3VkV2F0Y2ggTWV0cmljcyBQZXJtaXNzaW9uc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEdhdGV3YXkgVGFyZ2V0IG5lZWRzIHRvIHB1Ymxpc2ggY3VzdG9tIG1ldHJpY3MgZm9yIG1vbml0b3JpbmdcbiAgICB0aGlzLmdhdGV3YXlUYXJnZXRSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIHNpZDogJ0Nsb3VkV2F0Y2hNZXRyaWNzUHVibGlzaCcsXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdjbG91ZHdhdGNoOlB1dE1ldHJpY0RhdGEnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICdjbG91ZHdhdGNoOm5hbWVzcGFjZSc6IFtcbiAgICAgICAgICAgICdYNDAyUGF5ZXJBZ2VudC9Db250ZW50VG9vbHMnLFxuICAgICAgICAgICAgJ1g0MDJQYXllckFnZW50L0dhdGV3YXknLFxuICAgICAgICAgICAgJ0FXUy9CZWRyb2NrJyxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTVFMgUGVybWlzc2lvbnMgKENyb3NzLUFjY291bnQgQWNjZXNzKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEZvciBtdWx0aS1hY2NvdW50IHNldHVwcyB3aGVyZSB0YXJnZXRzIGFyZSBpbiBkaWZmZXJlbnQgYWNjb3VudHMsXG4gICAgLy8gdGhlIEdhdGV3YXkgbmVlZHMgdG8gYXNzdW1lIHJvbGVzIGluIHRob3NlIGFjY291bnRzLlxuICAgIHRoaXMuZ2F0ZXdheVRhcmdldFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgc2lkOiAnQ3Jvc3NBY2NvdW50QXNzdW1lUm9sZScsXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdzdHM6QXNzdW1lUm9sZScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIC8vIFNjb3BlZCB0byB0aGlzIGFjY291bnQg4oCUIGFkZCBhZGRpdGlvbmFsIGFjY291bnQgSURzIGhlcmUgZm9yIG11bHRpLWFjY291bnQgc2V0dXBzXG4gICAgICAgIGBhcm46YXdzOmlhbTo6JHt0aGlzLmFjY291bnR9OnJvbGUveDQwMi1nYXRld2F5LXRhcmdldC0qYCxcbiAgICAgIF0sXG4gICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICdzdHM6RXh0ZXJuYWxJZCc6ICd4NDAyLWdhdGV3YXktdGFyZ2V0JyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSkpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU2VjcmV0cyBNYW5hZ2VyIFBlcm1pc3Npb25zIChUYXJnZXQgQ3JlZGVudGlhbHMpXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRm9yIHRhcmdldHMgdGhhdCByZXF1aXJlIGF1dGhlbnRpY2F0aW9uLCB0aGUgR2F0ZXdheSBtYXkgbmVlZFxuICAgIC8vIHRvIHJldHJpZXZlIGNyZWRlbnRpYWxzIGZyb20gU2VjcmV0cyBNYW5hZ2VyLlxuICAgIHRoaXMuZ2F0ZXdheVRhcmdldFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgc2lkOiAnU2VjcmV0c01hbmFnZXJSZWFkJyxcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOkdldFNlY3JldFZhbHVlJyxcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOkRlc2NyaWJlU2VjcmV0JyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6c2VjcmV0c21hbmFnZXI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnNlY3JldDp4NDAyLWdhdGV3YXktdGFyZ2V0LypgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBLTVMgUGVybWlzc2lvbnMgKEVuY3J5cHRlZCBTZWNyZXRzKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEZvciBzZWNyZXRzIGVuY3J5cHRlZCB3aXRoIGN1c3RvbWVyLW1hbmFnZWQgS01TIGtleXNcbiAgICB0aGlzLmdhdGV3YXlUYXJnZXRSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIHNpZDogJ0ttc0RlY3J5cHQnLFxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAna21zOkRlY3J5cHQnLFxuICAgICAgICAna21zOkdlbmVyYXRlRGF0YUtleScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIGBhcm46YXdzOmttczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06a2V5LypgLFxuICAgICAgXSxcbiAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgJ2ttczpWaWFTZXJ2aWNlJzogYHNlY3JldHNtYW5hZ2VyLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb21gLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBYLVJheSBUcmFjaW5nIFBlcm1pc3Npb25zXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRm9yIGRpc3RyaWJ1dGVkIHRyYWNpbmcgb2YgdGFyZ2V0IGludm9jYXRpb25zXG4gICAgdGhpcy5nYXRld2F5VGFyZ2V0Um9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBzaWQ6ICdYUmF5VHJhY2luZycsXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICd4cmF5OlB1dFRyYWNlU2VnbWVudHMnLFxuICAgICAgICAneHJheTpQdXRUZWxlbWV0cnlSZWNvcmRzJyxcbiAgICAgICAgJ3hyYXk6R2V0U2FtcGxpbmdSdWxlcycsXG4gICAgICAgICd4cmF5OkdldFNhbXBsaW5nVGFyZ2V0cycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBDbG91ZFdhdGNoIExvZyBHcm91cCBmb3IgR2F0ZXdheSBUYXJnZXRcbiAgICBjb25zdCBnYXRld2F5VGFyZ2V0TG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnR2F0ZXdheVRhcmdldExvZ0dyb3VwJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9iZWRyb2NrLWFnZW50Y29yZS9nYXRld2F5LXRhcmdldC94NDAyLWNvbnRlbnQtdG9vbHMnLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIENsb3VkV2F0Y2ggTG9nIEdyb3VwIGZvciBHYXRld2F5XG4gICAgdGhpcy5nYXRld2F5TG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnR2F0ZXdheUxvZ0dyb3VwJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9iZWRyb2NrLWFnZW50Y29yZS9nYXRld2F5L3g0MDItcGF5ZXItYWdlbnQnLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFJhdGUgTGltaXRpbmcgSW5mcmFzdHJ1Y3R1cmVcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIFNOUyBUb3BpYyBmb3IgcmF0ZSBsaW1pdCBhbGFybXNcbiAgICB0aGlzLnJhdGVMaW1pdEFsYXJtVG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdSYXRlTGltaXRBbGFybVRvcGljJywge1xuICAgICAgdG9waWNOYW1lOiAneDQwMi1wYXllci1hZ2VudC1yYXRlLWxpbWl0LWFsYXJtcycsXG4gICAgICBkaXNwbGF5TmFtZTogJ3g0MDIgUGF5ZXIgQWdlbnQgUmF0ZSBMaW1pdCBBbGFybXMnLFxuICAgIH0pO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBNZXRyaWMgRmlsdGVyIGZvciB0aHJvdHRsZWQgcmVxdWVzdHNcbiAgICBjb25zdCB0aHJvdHRsZWRSZXF1ZXN0c01ldHJpY0ZpbHRlciA9IG5ldyBsb2dzLk1ldHJpY0ZpbHRlcih0aGlzLCAnVGhyb3R0bGVkUmVxdWVzdHNNZXRyaWNGaWx0ZXInLCB7XG4gICAgICBsb2dHcm91cDogdGhpcy5nYXRld2F5TG9nR3JvdXAsXG4gICAgICBtZXRyaWNOYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudC9HYXRld2F5L1JhdGVMaW1pdGluZycsXG4gICAgICBtZXRyaWNOYW1lOiAnVGhyb3R0bGVkUmVxdWVzdHMnLFxuICAgICAgZmlsdGVyUGF0dGVybjogbG9ncy5GaWx0ZXJQYXR0ZXJuLmxpdGVyYWwoJ1Rocm90dGxpbmdFeGNlcHRpb24nKSxcbiAgICAgIG1ldHJpY1ZhbHVlOiAnMScsXG4gICAgICBkZWZhdWx0VmFsdWU6IDAsXG4gICAgfSk7XG5cbiAgICAvLyBDbG91ZFdhdGNoIE1ldHJpYyBGaWx0ZXIgZm9yIHRvdGFsIHJlcXVlc3RzXG4gICAgY29uc3QgdG90YWxSZXF1ZXN0c01ldHJpY0ZpbHRlciA9IG5ldyBsb2dzLk1ldHJpY0ZpbHRlcih0aGlzLCAnVG90YWxSZXF1ZXN0c01ldHJpY0ZpbHRlcicsIHtcbiAgICAgIGxvZ0dyb3VwOiB0aGlzLmdhdGV3YXlMb2dHcm91cCxcbiAgICAgIG1ldHJpY05hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50L0dhdGV3YXkvUmF0ZUxpbWl0aW5nJyxcbiAgICAgIG1ldHJpY05hbWU6ICdUb3RhbFJlcXVlc3RzJyxcbiAgICAgIGZpbHRlclBhdHRlcm46IGxvZ3MuRmlsdGVyUGF0dGVybi5saXRlcmFsKCdJbnZva2VBZ2VudCcpLFxuICAgICAgbWV0cmljVmFsdWU6ICcxJyxcbiAgICAgIGRlZmF1bHRWYWx1ZTogMCxcbiAgICB9KTtcblxuICAgIC8vIFRocm90dGxlZCBSZXF1ZXN0cyBBbGFybVxuICAgIGNvbnN0IHRocm90dGxlZFJlcXVlc3RzQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnVGhyb3R0bGVkUmVxdWVzdHNBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ3g0MDItcGF5ZXItYWdlbnQtdGhyb3R0bGVkLXJlcXVlc3RzJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGFybSB3aGVuIHJlcXVlc3RzIGFyZSBiZWluZyB0aHJvdHRsZWQgZHVlIHRvIHJhdGUgbGltaXRpbmcnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudC9HYXRld2F5L1JhdGVMaW1pdGluZycsXG4gICAgICAgIG1ldHJpY05hbWU6ICdUaHJvdHRsZWRSZXF1ZXN0cycsXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogNSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgYWxhcm0gYWN0aW9uIHRvIG5vdGlmeSB2aWEgU05TXG4gICAgaWYgKHRoaXMucmF0ZUxpbWl0Q29uZmlnLmVuYWJsZUFsYXJtcykge1xuICAgICAgdGhyb3R0bGVkUmVxdWVzdHNBbGFybS5hZGRBbGFybUFjdGlvbihcbiAgICAgICAgbmV3IGNsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24odGhpcy5yYXRlTGltaXRBbGFybVRvcGljKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBIaWdoIFJlcXVlc3QgUmF0ZSBBbGFybSAoYXBwcm9hY2hpbmcgcmF0ZSBsaW1pdClcbiAgICBjb25zdCBoaWdoUmVxdWVzdFJhdGVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdIaWdoUmVxdWVzdFJhdGVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ3g0MDItcGF5ZXItYWdlbnQtaGlnaC1yZXF1ZXN0LXJhdGUnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogYEFsYXJtIHdoZW4gcmVxdWVzdCByYXRlIGV4Y2VlZHMgJHt0aGlzLnJhdGVMaW1pdENvbmZpZy53YXJuaW5nVGhyZXNob2xkUGVyY2VudH0lIG9mIHJhdGUgbGltaXRgLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudC9HYXRld2F5L1JhdGVMaW1pdGluZycsXG4gICAgICAgIG1ldHJpY05hbWU6ICdUb3RhbFJlcXVlc3RzJyxcbiAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICB9KSxcbiAgICAgIC8vIFRocmVzaG9sZCBpcyA4MCUgb2YgcmVxdWVzdHMgcGVyIG1pbnV0ZSAocmVxdWVzdHNQZXJTZWNvbmQgKiA2MCAqIHdhcm5pbmdUaHJlc2hvbGRQZXJjZW50LzEwMClcbiAgICAgIHRocmVzaG9sZDogTWF0aC5mbG9vcih0aGlzLnJhdGVMaW1pdENvbmZpZy5yZXF1ZXN0c1BlclNlY29uZCAqIDYwICogKHRoaXMucmF0ZUxpbWl0Q29uZmlnLndhcm5pbmdUaHJlc2hvbGRQZXJjZW50IC8gMTAwKSksXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuXG4gICAgaWYgKHRoaXMucmF0ZUxpbWl0Q29uZmlnLmVuYWJsZUFsYXJtcykge1xuICAgICAgaGlnaFJlcXVlc3RSYXRlQWxhcm0uYWRkQWxhcm1BY3Rpb24oXG4gICAgICAgIG5ldyBjbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKHRoaXMucmF0ZUxpbWl0QWxhcm1Ub3BpYylcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gSUFNIFBvbGljeSBmb3IgY2xpZW50cyB0byBpbnZva2UgdGhlIEdhdGV3YXlcbiAgICBjb25zdCBnYXRld2F5SW52b2tlUG9saWN5ID0gbmV3IGlhbS5NYW5hZ2VkUG9saWN5KHRoaXMsICdHYXRld2F5SW52b2tlUG9saWN5Jywge1xuICAgICAgbWFuYWdlZFBvbGljeU5hbWU6ICd4NDAyLXBheWVyLWFnZW50LWdhdGV3YXktaW52b2tlJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUG9saWN5IGFsbG93aW5nIGludm9jYXRpb24gb2YgdGhlIHg0MDIgcGF5ZXIgYWdlbnQgR2F0ZXdheScsXG4gICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgJ2JlZHJvY2s6SW52b2tlQWdlbnQnLFxuICAgICAgICAgICAgJ2JlZHJvY2s6SW52b2tlQWdlbnRXaXRoUmVzcG9uc2VTdHJlYW0nLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTphZ2VudC8qYCxcbiAgICAgICAgICAgIGBhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmFnZW50LWFsaWFzLypgLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEdhdGV3YXkgVGFyZ2V0IE1hbmFnZWQgUG9saWN5XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gVGhpcyBtYW5hZ2VkIHBvbGljeSBjYW4gYmUgYXR0YWNoZWQgdG8gb3RoZXIgcm9sZXMgdGhhdCBuZWVkXG4gICAgLy8gdG8gaW52b2tlIEdhdGV3YXkgdGFyZ2V0cyAoZS5nLiwgZm9yIHRlc3Rpbmcgb3IgYXV0b21hdGlvbikuXG4gICAgY29uc3QgZ2F0ZXdheVRhcmdldFBvbGljeSA9IG5ldyBpYW0uTWFuYWdlZFBvbGljeSh0aGlzLCAnR2F0ZXdheVRhcmdldFBvbGljeScsIHtcbiAgICAgIG1hbmFnZWRQb2xpY3lOYW1lOiAneDQwMi1wYXllci1hZ2VudC1nYXRld2F5LXRhcmdldCcsXG4gICAgICBkZXNjcmlwdGlvbjogJ1BvbGljeSBmb3IgaW52b2tpbmcgeDQwMiBHYXRld2F5IHRhcmdldHMgKE1DUCB0b29sIHNlcnZlciknLFxuICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAvLyBTMyBhY2Nlc3MgZm9yIE9wZW5BUEkgc3BlY3NcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIHNpZDogJ09wZW5BcGlTcGVjQWNjZXNzJyxcbiAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgJ3MzOkdldE9iamVjdCcsXG4gICAgICAgICAgICAnczM6R2V0T2JqZWN0VmVyc2lvbicsXG4gICAgICAgICAgXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgIHRoaXMub3BlbkFwaVNwZWNBc3NldC5idWNrZXQuYXJuRm9yT2JqZWN0cygnKicpLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgICAvLyBBUEkgR2F0ZXdheSBpbnZvY2F0aW9uXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBzaWQ6ICdBcGlHYXRld2F5SW52b2tlJyxcbiAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgJ2V4ZWN1dGUtYXBpOkludm9rZScsXG4gICAgICAgICAgXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgIGBhcm46YXdzOmV4ZWN1dGUtYXBpOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fToqLyovKi8qYCxcbiAgICAgICAgICBdLFxuICAgICAgICB9KSxcbiAgICAgICAgLy8gQ2xvdWRXYXRjaCBMb2dzXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBzaWQ6ICdDbG91ZFdhdGNoTG9ncycsXG4gICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsXG4gICAgICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICBgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9iZWRyb2NrLWFnZW50Y29yZS9nYXRld2F5LXRhcmdldC8qOipgLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIENsb3VkV2F0Y2ggRGFzaGJvYXJkIGZvciBHYXRld2F5IG1vbml0b3JpbmdcbiAgICBjb25zdCBkYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5EYXNoYm9hcmQodGhpcywgJ0dhdGV3YXlEYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiAneDQwMi1wYXllci1hZ2VudC1nYXRld2F5JyxcbiAgICB9KTtcblxuICAgIC8vIEFkZCB3aWRnZXRzIHRvIGRhc2hib2FyZFxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgIG1hcmtkb3duOiAnIyB4NDAyIFBheWVyIEFnZW50IEdhdGV3YXlcXG5Nb25pdG9yaW5nIGRhc2hib2FyZCBmb3IgdGhlIEFnZW50Q29yZSBHYXRld2F5JyxcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gUmF0ZSBMaW1pdGluZyBTZWN0aW9uXG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246ICcjIyBSYXRlIExpbWl0aW5nIE1ldHJpY3MnLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdSZXF1ZXN0IFJhdGUgdnMgTGltaXQnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50L0dhdGV3YXkvUmF0ZUxpbWl0aW5nJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdUb3RhbFJlcXVlc3RzJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgICAgICAgbGFiZWw6ICdSZXF1ZXN0cyBwZXIgTWludXRlJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgbGVmdEFubm90YXRpb25zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgdmFsdWU6IHRoaXMucmF0ZUxpbWl0Q29uZmlnLnJlcXVlc3RzUGVyU2Vjb25kICogNjAsXG4gICAgICAgICAgICBsYWJlbDogJ1JhdGUgTGltaXQgKHBlciBtaW51dGUpJyxcbiAgICAgICAgICAgIGNvbG9yOiAnI2ZmMDAwMCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICB2YWx1ZTogTWF0aC5mbG9vcih0aGlzLnJhdGVMaW1pdENvbmZpZy5yZXF1ZXN0c1BlclNlY29uZCAqIDYwICogKHRoaXMucmF0ZUxpbWl0Q29uZmlnLndhcm5pbmdUaHJlc2hvbGRQZXJjZW50IC8gMTAwKSksXG4gICAgICAgICAgICBsYWJlbDogYFdhcm5pbmcgVGhyZXNob2xkICgke3RoaXMucmF0ZUxpbWl0Q29uZmlnLndhcm5pbmdUaHJlc2hvbGRQZXJjZW50fSUpYCxcbiAgICAgICAgICAgIGNvbG9yOiAnI2ZmOTkwMCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdUaHJvdHRsZWQgUmVxdWVzdHMnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50L0dhdGV3YXkvUmF0ZUxpbWl0aW5nJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdUaHJvdHRsZWRSZXF1ZXN0cycsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgICAgICAgIGxhYmVsOiAnVGhyb3R0bGVkIFJlcXVlc3RzJyxcbiAgICAgICAgICAgIGNvbG9yOiAnI2ZmMDAwMCcsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIFJhdGUgTGltaXRpbmcgQ29uZmlndXJhdGlvbiBEaXNwbGF5XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246IGAjIyMgUmF0ZSBMaW1pdCBDb25maWd1cmF0aW9uXG58IFNldHRpbmcgfCBWYWx1ZSB8XG58LS0tLS0tLS0tfC0tLS0tLS18XG58IFJlcXVlc3RzIHBlciBTZWNvbmQgfCAke3RoaXMucmF0ZUxpbWl0Q29uZmlnLnJlcXVlc3RzUGVyU2Vjb25kfSB8XG58IEJ1cnN0IENhcGFjaXR5IHwgJHt0aGlzLnJhdGVMaW1pdENvbmZpZy5idXJzdENhcGFjaXR5fSB8XG58IExpbWl0IEJ5IHwgJHt0aGlzLnJhdGVMaW1pdENvbmZpZy5saW1pdEJ5fSB8XG58IFdhcm5pbmcgVGhyZXNob2xkIHwgJHt0aGlzLnJhdGVMaW1pdENvbmZpZy53YXJuaW5nVGhyZXNob2xkUGVyY2VudH0lIHxgLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNCxcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm1TdGF0dXNXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1JhdGUgTGltaXRpbmcgQWxhcm1zJyxcbiAgICAgICAgYWxhcm1zOiBbdGhyb3R0bGVkUmVxdWVzdHNBbGFybSwgaGlnaFJlcXVlc3RSYXRlQWxhcm1dLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNCxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkxvZ1F1ZXJ5V2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdHYXRld2F5IFJlcXVlc3QgTG9ncycsXG4gICAgICAgIGxvZ0dyb3VwTmFtZXM6IFt0aGlzLmdhdGV3YXlMb2dHcm91cC5sb2dHcm91cE5hbWVdLFxuICAgICAgICBxdWVyeUxpbmVzOiBbXG4gICAgICAgICAgJ2ZpZWxkcyBAdGltZXN0YW1wLCBAbWVzc2FnZScsXG4gICAgICAgICAgJ3NvcnQgQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgICAnbGltaXQgMTAwJyxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQcm9jZXNzUGF5bWVudFJvbGVBcm4nLCB7XG4gICAgICB2YWx1ZTogcHJvY2Vzc1BheW1lbnRSb2xlLnJvbGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FSTiBvZiB0aGUgUHJvY2Vzc1BheW1lbnQgSUFNIHJvbGUgKGFnZW50IGFzc3VtZXMgdGhpcyknLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50UHJvY2Vzc1BheW1lbnRSb2xlQXJuJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNYW5hZ2VtZW50Um9sZUFybicsIHtcbiAgICAgIHZhbHVlOiBtYW5hZ2VtZW50Um9sZS5yb2xlQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdBUk4gb2YgdGhlIFBheW1lbnRzIE1hbmFnZW1lbnQgSUFNIHJvbGUgKGFwcCBiYWNrZW5kIHVzZXMgdGhpcyknLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50TWFuYWdlbWVudFJvbGVBcm4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1Jlc291cmNlUmV0cmlldmFsUm9sZUFybicsIHtcbiAgICAgIHZhbHVlOiByZXNvdXJjZVJldHJpZXZhbFJvbGUucm9sZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBSZXNvdXJjZSBSZXRyaWV2YWwgc2VydmljZSByb2xlIChBZ2VudENvcmUgUGF5bWVudHMgYXNzdW1lcyB0aGlzKScsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRSZXNvdXJjZVJldHJpZXZhbFJvbGVBcm4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FnZW50UnVudGltZVJvbGVBcm4nLCB7XG4gICAgICB2YWx1ZTogYWdlbnRSdW50aW1lUm9sZS5yb2xlQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdBUk4gb2YgdGhlIEFnZW50Q29yZSBSdW50aW1lIElBTSByb2xlJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudFJ1bnRpbWVSb2xlQXJuJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHYXRld2F5Um9sZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmdhdGV3YXlSb2xlLnJvbGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FSTiBvZiB0aGUgQWdlbnRDb3JlIEdhdGV3YXkgSUFNIHJvbGUnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50R2F0ZXdheVJvbGVBcm4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dhdGV3YXlMb2dHcm91cE5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5nYXRld2F5TG9nR3JvdXAubG9nR3JvdXBOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZFdhdGNoIExvZyBHcm91cCBmb3IgR2F0ZXdheSBsb2dzJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudEdhdGV3YXlMb2dHcm91cCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR2F0ZXdheUludm9rZVBvbGljeUFybicsIHtcbiAgICAgIHZhbHVlOiBnYXRld2F5SW52b2tlUG9saWN5Lm1hbmFnZWRQb2xpY3lBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FSTiBvZiB0aGUgcG9saWN5IGZvciBpbnZva2luZyB0aGUgR2F0ZXdheScsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRHYXRld2F5SW52b2tlUG9saWN5QXJuJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXNoYm9hcmRVcmwnLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHt0aGlzLnJlZ2lvbn0uY29uc29sZS5hd3MuYW1hem9uLmNvbS9jbG91ZHdhdGNoL2hvbWU/cmVnaW9uPSR7dGhpcy5yZWdpb259I2Rhc2hib2FyZHM6bmFtZT14NDAyLXBheWVyLWFnZW50LWdhdGV3YXlgLFxuICAgICAgZGVzY3JpcHRpb246ICdVUkwgdG8gdGhlIENsb3VkV2F0Y2ggRGFzaGJvYXJkJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudERhc2hib2FyZFVybCcsXG4gICAgfSk7XG5cbiAgICAvLyBSYXRlIExpbWl0aW5nIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmF0ZUxpbWl0QWxhcm1Ub3BpY0FybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnJhdGVMaW1pdEFsYXJtVG9waWMudG9waWNBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1NOUyBUb3BpYyBBUk4gZm9yIHJhdGUgbGltaXQgYWxhcm1zJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudFJhdGVMaW1pdEFsYXJtVG9waWNBcm4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1JhdGVMaW1pdENvbmZpZycsIHtcbiAgICAgIHZhbHVlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHJlcXVlc3RzUGVyU2Vjb25kOiB0aGlzLnJhdGVMaW1pdENvbmZpZy5yZXF1ZXN0c1BlclNlY29uZCxcbiAgICAgICAgYnVyc3RDYXBhY2l0eTogdGhpcy5yYXRlTGltaXRDb25maWcuYnVyc3RDYXBhY2l0eSxcbiAgICAgICAgbGltaXRCeTogdGhpcy5yYXRlTGltaXRDb25maWcubGltaXRCeSxcbiAgICAgICAgd2FybmluZ1RocmVzaG9sZFBlcmNlbnQ6IHRoaXMucmF0ZUxpbWl0Q29uZmlnLndhcm5pbmdUaHJlc2hvbGRQZXJjZW50LFxuICAgICAgfSksXG4gICAgICBkZXNjcmlwdGlvbjogJ1JhdGUgbGltaXRpbmcgY29uZmlndXJhdGlvbicsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRSYXRlTGltaXRDb25maWcnLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gR2F0ZXdheSBUYXJnZXQgT3V0cHV0cyAoTUNQIFRvb2wgU2VydmVyKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHYXRld2F5VGFyZ2V0Um9sZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmdhdGV3YXlUYXJnZXRSb2xlLnJvbGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FSTiBvZiB0aGUgR2F0ZXdheSBUYXJnZXQgSUFNIHJvbGUgZm9yIE1DUCB0b29sIHNlcnZlcicsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRHYXRld2F5VGFyZ2V0Um9sZUFybicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR2F0ZXdheVRhcmdldFBvbGljeUFybicsIHtcbiAgICAgIHZhbHVlOiBnYXRld2F5VGFyZ2V0UG9saWN5Lm1hbmFnZWRQb2xpY3lBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FSTiBvZiB0aGUgR2F0ZXdheSBUYXJnZXQgbWFuYWdlZCBwb2xpY3knLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50R2F0ZXdheVRhcmdldFBvbGljeUFybicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT3BlbkFwaVNwZWNTM1VyaScsIHtcbiAgICAgIHZhbHVlOiBgczM6Ly8ke3RoaXMub3BlbkFwaVNwZWNBc3NldC5zM0J1Y2tldE5hbWV9LyR7dGhpcy5vcGVuQXBpU3BlY0Fzc2V0LnMzT2JqZWN0S2V5fWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIFVSSSBvZiB0aGUgT3BlbkFQSSBzcGVjIGZvciBHYXRld2F5IHRhcmdldCBjb25maWd1cmF0aW9uJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudE9wZW5BcGlTcGVjUzNVcmknLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ09wZW5BcGlTcGVjUzNVcmwnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5vcGVuQXBpU3BlY0Fzc2V0LnMzT2JqZWN0VXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdTMyBVUkwgb2YgdGhlIE9wZW5BUEkgc3BlYyBmb3IgR2F0ZXdheSB0YXJnZXQgY29uZmlndXJhdGlvbicsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRPcGVuQXBpU3BlY1MzVXJsJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHYXRld2F5VGFyZ2V0TG9nR3JvdXBOYW1lJywge1xuICAgICAgdmFsdWU6IGdhdGV3YXlUYXJnZXRMb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkV2F0Y2ggTG9nIEdyb3VwIGZvciBHYXRld2F5IFRhcmdldCBsb2dzJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudEdhdGV3YXlUYXJnZXRMb2dHcm91cCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU2VsbGVyQ2xvdWRGcm9udFVybCcsIHtcbiAgICAgIHZhbHVlOiBzZWxsZXJDbG91ZEZyb250VXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBVUkwgZm9yIHNlbGxlciBpbmZyYXN0cnVjdHVyZSAodGFyZ2V0IFVSTCknLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50U2VsbGVyQ2xvdWRGcm9udFVybCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTWNwVG9vbEVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6ICcvdjEvbWNwL3Rvb2xzJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTUNQIHRvb2wgZGlzY292ZXJ5IGVuZHBvaW50IHBhdGggKHJlbGF0aXZlIHRvIEdhdGV3YXkgVVJMKScsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRNY3BUb29sRW5kcG9pbnQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ01jcEludm9rZUVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6ICcvdjEvbWNwL2ludm9rZScsXG4gICAgICBkZXNjcmlwdGlvbjogJ01DUCB0b29sIGludm9jYXRpb24gZW5kcG9pbnQgcGF0aCAocmVsYXRpdmUgdG8gR2F0ZXdheSBVUkwpJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudE1jcEludm9rZUVuZHBvaW50JyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFRvb2wgQVJOcyBmb3IgTUNQIFRvb2xzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gVGhlc2UgQVJOIHBhdHRlcm5zIGFyZSB1c2VkIGJ5IHRoZSBhZ2VudCB0byBpbnZva2Ugc3BlY2lmaWMgdG9vbHNcbiAgICAvLyB2aWEgdGhlIEdhdGV3YXkuIFRoZSBhY3R1YWwgQVJOcyBhcmUgY29uc3RydWN0ZWQgYXQgcnVudGltZSB3aGVuXG4gICAgLy8gdGhlIEdhdGV3YXkgYW5kIHRhcmdldHMgYXJlIGNyZWF0ZWQgdmlhIEFnZW50Q29yZSBDTEkvY29uc29sZS5cbiAgICAvL1xuICAgIC8vIEFSTiBGb3JtYXQ6IGFybjphd3M6YmVkcm9jay1hZ2VudGNvcmU6e3JlZ2lvbn06e2FjY291bnR9OmdhdGV3YXktdGFyZ2V0L3tnYXRld2F5LWlkfS90b29sL3t0b29sLW5hbWV9XG4gICAgLy9cbiAgICAvLyBOb3RlOiBHYXRld2F5IElEIGlzIGFzc2lnbmVkIGF0IGNyZWF0aW9uIHRpbWUuIFRoZXNlIG91dHB1dHMgcHJvdmlkZVxuICAgIC8vIHRoZSBBUk4gcGF0dGVybnMgdGhhdCBjYW4gYmUgdXNlZCB3aXRoIHRoZSBhY3R1YWwgR2F0ZXdheSBJRC5cblxuICAgIGNvbnN0IHRvb2xOYW1lcyA9IFtcbiAgICAgICdnZXRfcHJlbWl1bV9hcnRpY2xlJyxcbiAgICAgICdnZXRfd2VhdGhlcl9kYXRhJyxcbiAgICAgICdnZXRfbWFya2V0X2FuYWx5c2lzJyxcbiAgICAgICdnZXRfcmVzZWFyY2hfcmVwb3J0JyxcbiAgICBdO1xuXG4gICAgLy8gT3V0cHV0IGluZGl2aWR1YWwgdG9vbCBBUk4gcGF0dGVybnNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVG9vbEFyblBhdHRlcm4nLCB7XG4gICAgICB2YWx1ZTogYGFybjphd3M6YmVkcm9jay1hZ2VudGNvcmU6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmdhdGV3YXktdGFyZ2V0L1xcJHtHQVRFV0FZX1RBUkdFVF9JRH0vdG9vbC9cXCR7VE9PTF9OQU1FfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FSTiBwYXR0ZXJuIGZvciBHYXRld2F5IHRhcmdldCB0b29scy4gUmVwbGFjZSAke0dBVEVXQVlfVEFSR0VUX0lEfSBhbmQgJHtUT09MX05BTUV9IHdpdGggYWN0dWFsIHZhbHVlcy4nLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50VG9vbEFyblBhdHRlcm4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1Rvb2xBcm5zJywge1xuICAgICAgdmFsdWU6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcGF0dGVybjogYGFybjphd3M6YmVkcm9jay1hZ2VudGNvcmU6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmdhdGV3YXktdGFyZ2V0L1xcJHtHQVRFV0FZX1RBUkdFVF9JRH0vdG9vbC97dG9vbF9uYW1lfWAsXG4gICAgICAgIHRvb2xzOiB0b29sTmFtZXMubWFwKG5hbWUgPT4gKHtcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIGFyblRlbXBsYXRlOiBgYXJuOmF3czpiZWRyb2NrLWFnZW50Y29yZToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06Z2F0ZXdheS10YXJnZXQvXFwke0dBVEVXQVlfVEFSR0VUX0lEfS90b29sLyR7bmFtZX1gLFxuICAgICAgICB9KSksXG4gICAgICAgIG5vdGU6ICdSZXBsYWNlICR7R0FURVdBWV9UQVJHRVRfSUR9IHdpdGggdGhlIGFjdHVhbCBHYXRld2F5IHRhcmdldCBJRCBhZnRlciBjcmVhdGlvbicsXG4gICAgICB9LCBudWxsLCAyKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVG9vbCBBUk4gdGVtcGxhdGVzIGZvciBhbGwgTUNQIHRvb2xzJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudFRvb2xBcm5zJyxcbiAgICB9KTtcblxuICAgIC8vIE91dHB1dCBNQ1AgZW5kcG9pbnQgY29uZmlndXJhdGlvbiB3aXRoIGZ1bGwgVVJMIHBhdHRlcm5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTWNwRW5kcG9pbnRDb25maWcnLCB7XG4gICAgICB2YWx1ZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBiYXNlVXJsUGF0dGVybjogJ2h0dHBzOi8vJHtHQVRFV0FZX0lEfS5iZWRyb2NrLWFnZW50Y29yZS4ke1JFR0lPTn0uYW1hem9uYXdzLmNvbScsXG4gICAgICAgIGVuZHBvaW50czoge1xuICAgICAgICAgIGRpc2NvdmVyeToge1xuICAgICAgICAgICAgcGF0aDogJy92MS9tY3AvdG9vbHMnLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnTGlzdCBhbGwgYXZhaWxhYmxlIE1DUCB0b29scycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBpbnZva2U6IHtcbiAgICAgICAgICAgIHBhdGg6ICcvdjEvbWNwL2ludm9rZScsXG4gICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnSW52b2tlIGFuIE1DUCB0b29sIGJ5IG5hbWUnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgdG9vbFNjaGVtYToge1xuICAgICAgICAgICAgcGF0aDogJy92MS9tY3AvdG9vbHMve3Rvb2xfbmFtZX0vc2NoZW1hJyxcbiAgICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0dldCBzY2hlbWEgZm9yIGEgc3BlY2lmaWMgdG9vbCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgYXV0aGVudGljYXRpb246ICdJQU1fU0lHVjQnLFxuICAgICAgICByZWdpb246IHRoaXMucmVnaW9uLFxuICAgICAgICBub3RlOiAnUmVwbGFjZSAke0dBVEVXQVlfSUR9IHdpdGggdGhlIGFjdHVhbCBHYXRld2F5IElEIGFmdGVyIGNyZWF0aW9uJyxcbiAgICAgIH0sIG51bGwsIDIpLFxuICAgICAgZGVzY3JpcHRpb246ICdNQ1AgZW5kcG9pbnQgY29uZmlndXJhdGlvbiBmb3IgdG9vbCBkaXNjb3ZlcnkgYW5kIGludm9jYXRpb24nLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50TWNwRW5kcG9pbnRDb25maWcnLFxuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0IEdhdGV3YXkgdGFyZ2V0IEFSTiBwYXR0ZXJuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dhdGV3YXlUYXJnZXRBcm5QYXR0ZXJuJywge1xuICAgICAgdmFsdWU6IGBhcm46YXdzOmJlZHJvY2stYWdlbnRjb3JlOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpnYXRld2F5LXRhcmdldC9cXCR7R0FURVdBWV9UQVJHRVRfSUR9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIHBhdHRlcm4gZm9yIHRoZSBHYXRld2F5IHRhcmdldC4gUmVwbGFjZSAke0dBVEVXQVlfVEFSR0VUX0lEfSB3aXRoIGFjdHVhbCBJRCBhZnRlciBjcmVhdGlvbi4nLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50R2F0ZXdheVRhcmdldEFyblBhdHRlcm4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dhdGV3YXlUYXJnZXRDb25maWcnLCB7XG4gICAgICB2YWx1ZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBuYW1lOiAneDQwMi1jb250ZW50LXRvb2xzJyxcbiAgICAgICAgZGVzY3JpcHRpb246ICdQcmVtaXVtIGNvbnRlbnQgZW5kcG9pbnRzIHByb3RlY3RlZCBieSB4NDAyIHBheW1lbnQgcHJvdG9jb2wnLFxuICAgICAgICB0eXBlOiAnT1BFTkFQSScsXG4gICAgICAgIHRhcmdldFVybDogc2VsbGVyQ2xvdWRGcm9udFVybCxcbiAgICAgICAgb3BlbkFwaVNwZWNTM1VyaTogYHMzOi8vJHt0aGlzLm9wZW5BcGlTcGVjQXNzZXQuczNCdWNrZXROYW1lfS8ke3RoaXMub3BlbkFwaVNwZWNBc3NldC5zM09iamVjdEtleX1gLFxuICAgICAgICB0b29sczogW1xuICAgICAgICAgIHsgbmFtZTogJ2dldF9wcmVtaXVtX2FydGljbGUnLCBwcmljZTogJzAuMDAxIFVTREMnIH0sXG4gICAgICAgICAgeyBuYW1lOiAnZ2V0X3dlYXRoZXJfZGF0YScsIHByaWNlOiAnMC4wMDA1IFVTREMnIH0sXG4gICAgICAgICAgeyBuYW1lOiAnZ2V0X21hcmtldF9hbmFseXNpcycsIHByaWNlOiAnMC4wMDIgVVNEQycgfSxcbiAgICAgICAgICB7IG5hbWU6ICdnZXRfcmVzZWFyY2hfcmVwb3J0JywgcHJpY2U6ICcwLjAwNSBVU0RDJyB9LFxuICAgICAgICBdLFxuICAgICAgfSwgbnVsbCwgMiksXG4gICAgICBkZXNjcmlwdGlvbjogJ0dhdGV3YXkgdGFyZ2V0IGNvbmZpZ3VyYXRpb24gZm9yIE1DUCB0b29sIHNlcnZlcicsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRHYXRld2F5VGFyZ2V0Q29uZmlnJyxcbiAgICB9KTtcblxuICAgIC8vIEluc3RydWN0aW9ucyBmb3IgbWFudWFsIEFnZW50Q29yZSBzZXR1cFxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdOZXh0U3RlcHMnLCB7XG4gICAgICB2YWx1ZTogYFxuQWZ0ZXIgZGVwbG95aW5nIHRoaXMgc3RhY2s6XG5cbjEuIFNldCB1cCBBZ2VudENvcmUgUGF5bWVudHMgcmVzb3VyY2VzIChvbmUtdGltZSkgdXNpbmcgYm90bzM6XG4gICBTZWU6IGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9iZWRyb2NrLWFnZW50Y29yZS9sYXRlc3QvZGV2Z3VpZGUvcGF5bWVudHMuaHRtbFxuXG4gICBhLiBDcmVhdGUgYSBQYXltZW50Q3JlZGVudGlhbFByb3ZpZGVyIHdpdGggeW91ciBDb2luYmFzZSBDRFAga2V5c1xuICAgYi4gQ3JlYXRlIGEgUGF5bWVudE1hbmFnZXIgKHVzZSBSZXNvdXJjZVJldHJpZXZhbFJvbGVBcm4gZnJvbSB0aGlzIHN0YWNrIG91dHB1dClcbiAgIGMuIENyZWF0ZSBhIFBheW1lbnRDb25uZWN0b3IgbGlua2luZyB0aGUgbWFuYWdlciB0byB0aGUgY3JlZGVudGlhbCBwcm92aWRlclxuICAgZC4gQ3JlYXRlIGEgUGF5bWVudEluc3RydW1lbnQgKHdhbGxldCkgYW5kIGZ1bmQgaXQgd2l0aCBVU0RDXG4gICBlLiBDcmVhdGUgYSBQYXltZW50U2Vzc2lvbiB3aXRoIGEgbWF4U3BlbmRBbW91bnQgYnVkZ2V0XG5cbjIuIERlcGxveSB0aGUgc2VsbGVyIGluZnJhc3RydWN0dXJlIGZpcnN0IChpZiBub3QgYWxyZWFkeSBkZXBsb3llZCk6XG4gICBjZCBzZWxsZXItaW5mcmFzdHJ1Y3R1cmUgJiYgbnBtIGluc3RhbGwgJiYgY2RrIGRlcGxveVxuICAgIyBOb3RlIHRoZSBDbG91ZEZyb250IFVSTCBmcm9tIHRoZSBvdXRwdXRcblxuMy4gQ29uZmlndXJlIHRoZSBwYXllciBhZ2VudCBlbnZpcm9ubWVudDpcbiAgIGNkIHBheWVyLWFnZW50ICYmIGNwIC5lbnYuZXhhbXBsZSAuZW52XG4gICAjIEZpbGwgaW46IE1BTkFHRVJfQVJOLCBQQVlNRU5UX1NFU1NJT05fSUQsIFBBWU1FTlRfSU5TVFJVTUVOVF9JRCxcbiAgICMgICAgICAgICAgUFJPQ0VTU19QQVlNRU5UX1JPTEVfQVJOIChzZWUgUHJvY2Vzc1BheW1lbnRSb2xlQXJuIG91dHB1dCBiZWxvdyksXG4gICAjICAgICAgICAgIFVTRVJfSUQsIFNFTExFUl9BUElfVVJMXG5cbjQuIENyZWF0ZSBBZ2VudENvcmUgUnVudGltZSB2aWEgQ0xJIG9yIGNvbnNvbGU6XG4gICAtIFVzZSB0aGUgYWdlbnQgY29kZSBmcm9tIHBheWVyLWFnZW50L1xuICAgLSBBc3NpZ24gdGhlIHJ1bnRpbWUgcm9sZTogJHthZ2VudFJ1bnRpbWVSb2xlLnJvbGVBcm59XG4gICAtIFNlZSBwYXllci1hZ2VudC9hZ2VudGNvcmVfY29uZmlnLnlhbWwgZm9yIGNvbmZpZ3VyYXRpb25cblxuNS4gQ3JlYXRlIEFnZW50Q29yZSBHYXRld2F5IHdpdGggTUNQIHRvb2wgc2VydmVyOlxuICAgLSBQb2ludCB0byB0aGUgUnVudGltZSBlbmRwb2ludFxuICAgLSBBc3NpZ24gdGhlIGdhdGV3YXkgcm9sZTogJHt0aGlzLmdhdGV3YXlSb2xlLnJvbGVBcm59XG4gICAtIENvbmZpZ3VyZSBJQU0gU2lnVjQgYXV0aGVudGljYXRpb25cblxuNi4gQ29uZmlndXJlIEdhdGV3YXkgVGFyZ2V0IGZvciBNQ1AgdG9vbHM6XG4gICAtIFRhcmdldCBuYW1lOiB4NDAyLWNvbnRlbnQtdG9vbHNcbiAgIC0gVGFyZ2V0IHR5cGU6IE9QRU5BUElcbiAgIC0gT3BlbkFQSSBzcGVjIFMzIFVSSTogczM6Ly8ke3RoaXMub3BlbkFwaVNwZWNBc3NldC5zM0J1Y2tldE5hbWV9LyR7dGhpcy5vcGVuQXBpU3BlY0Fzc2V0LnMzT2JqZWN0S2V5fVxuICAgLSBUYXJnZXQgVVJMOiAke3NlbGxlckNsb3VkRnJvbnRVcmx9XG4gICAtIEFzc2lnbiB0YXJnZXQgcm9sZTogJHt0aGlzLmdhdGV3YXlUYXJnZXRSb2xlLnJvbGVBcm59XG5cbkFnZW50Q29yZSBQYXltZW50cyBSb2xlcyAoZnJvbSB0aGlzIHN0YWNrKTpcbi0gUHJvY2Vzc1BheW1lbnRSb2xlQXJuOiAke3Byb2Nlc3NQYXltZW50Um9sZS5yb2xlQXJufVxuLSBNYW5hZ2VtZW50Um9sZUFybjogJHttYW5hZ2VtZW50Um9sZS5yb2xlQXJufVxuLSBSZXNvdXJjZVJldHJpZXZhbFJvbGVBcm46ICR7cmVzb3VyY2VSZXRyaWV2YWxSb2xlLnJvbGVBcm59XG5cblNlZTogaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL2JlZHJvY2stYWdlbnRjb3JlL2xhdGVzdC9kZXZndWlkZS9wYXltZW50cy5odG1sXG4gICAgICBgLFxuICAgICAgZGVzY3JpcHRpb246ICdOZXh0IHN0ZXBzIGZvciBBZ2VudENvcmUgc2V0dXAnLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQ0RLIE5hZyBTdXBwcmVzc2lvbnNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoYWdlbnRSdW50aW1lUm9sZSwgW1xuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JywgcmVhc29uOiAnV2lsZGNhcmRzIHJlcXVpcmVkOiBjcm9zcy1yZWdpb24gaW5mZXJlbmNlIHByb2ZpbGVzIChiZWRyb2NrOiopLCBDbG91ZFdhdGNoIGxvZyBncm91cHMgKC9hd3MvYmVkcm9jay1hZ2VudGNvcmUvKiksIGFuZCBlY3I6R2V0QXV0aG9yaXphdGlvblRva2VuIHJlcXVpcmVzIHJlc291cmNlIConIH0sXG4gICAgXSwgdHJ1ZSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMocHJvY2Vzc1BheW1lbnRSb2xlLCBbXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLCByZWFzb246ICdQcm9jZXNzUGF5bWVudCBuZWVkcyByZXNvdXJjZSAqIGJlY2F1c2UgcGF5bWVudCBtYW5hZ2VyIEFSTnMgYXJlIGR5bmFtaWMnIH0sXG4gICAgXSwgdHJ1ZSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMobWFuYWdlbWVudFJvbGUsIFtcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsIHJlYXNvbjogJ01hbmFnZW1lbnQgcm9sZSBuZWVkcyByZXNvdXJjZSAqIGZvciBpbnN0cnVtZW50L3Nlc3Npb24gQ1JVRCBhY3Jvc3MgcGF5bWVudCBtYW5hZ2VycycgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhyZXNvdXJjZVJldHJpZXZhbFJvbGUsIFtcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsIHJlYXNvbjogJ1NlcnZpY2Ugcm9sZSBuZWVkcyBicm9hZCBhY2Nlc3MgdG8gcmV0cmlldmUgY3JlZGVudGlhbHMgZnJvbSBBZ2VudENvcmUgSWRlbnRpdHknIH0sXG4gICAgXSwgdHJ1ZSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnModGhpcy5nYXRld2F5Um9sZSwgW1xuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JywgcmVhc29uOiAnR2F0ZXdheSBtdXN0IGludm9rZSBhbnkgYWdlbnQvYWxpYXMgaW4gdGhlIGFjY291bnQg4oCUIElEcyBhcmUgYXNzaWduZWQgYXQgcnVudGltZSBieSBBZ2VudENvcmUnIH0sXG4gICAgXSwgdHJ1ZSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnModGhpcy5nYXRld2F5VGFyZ2V0Um9sZSwgW1xuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JywgcmVhc29uOiAnR2F0ZXdheSB0YXJnZXQgbmVlZHMgYnJvYWQgYWNjZXNzOiBTMyBmb3IgT3BlbkFQSSBzcGVjcywgZXhlY3V0ZS1hcGkgZm9yIHByaXZhdGUgdGFyZ2V0cywgQ2xvdWRXYXRjaCBsb2dzLCBMYW1iZGEgZnVuY3Rpb25zLCBLTVMgZm9yIGVuY3J5cHRlZCBzZWNyZXRzLCBhbmQgWC1SYXkgdHJhY2luZyDigJQgYWxsIHNjb3BlZCB0byBhY2NvdW50L3ByZWZpeCB3aGVyZSBwb3NzaWJsZScgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyh0aGlzLnJhdGVMaW1pdEFsYXJtVG9waWMsIFtcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtU05TMycsIHJlYXNvbjogJ0RlbW8gcHJvamVjdCDigJQgU05TIFNTTCBlbmZvcmNlbWVudCBub3QgcmVxdWlyZWQgZm9yIGludGVybmFsIGFsYXJtIG5vdGlmaWNhdGlvbnMnIH0sXG4gICAgXSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoZ2F0ZXdheUludm9rZVBvbGljeSwgW1xuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JywgcmVhc29uOiAnQ2xpZW50IGludm9rZSBwb2xpY3kgbXVzdCBhbGxvdyBhbnkgYWdlbnQvYWxpYXMg4oCUIElEcyBhc3NpZ25lZCBhdCBydW50aW1lIGJ5IEFnZW50Q29yZScgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhnYXRld2F5VGFyZ2V0UG9saWN5LCBbXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLCByZWFzb246ICdUYXJnZXQgcG9saWN5IG5lZWRzIFMzIHdpbGRjYXJkIGZvciBPcGVuQVBJIHNwZWNzLCBleGVjdXRlLWFwaSBmb3IgQVBJIEdhdGV3YXkgdGFyZ2V0cywgYW5kIENsb3VkV2F0Y2ggbG9nIHN0cmVhbXMnIH0sXG4gICAgXSwgdHJ1ZSk7XG4gIH1cbn1cbiJdfQ==