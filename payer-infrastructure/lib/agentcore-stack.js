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
class AgentCoreStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Initialize rate limit configuration with defaults
        this.rateLimitConfig = {
            requestsPerSecond: props?.rateLimitConfig?.requestsPerSecond ?? 10,
            burstCapacity: props?.rateLimitConfig?.burstCapacity ?? 20,
            limitBy: props?.rateLimitConfig?.limitBy ?? 'IAM_PRINCIPAL',
            enableAlarms: props?.rateLimitConfig?.enableAlarms ?? true,
            warningThresholdPercent: props?.rateLimitConfig?.warningThresholdPercent ?? 80,
        };
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
        // Instructions for manual AgentCore setup
        new cdk.CfnOutput(this, 'NextSteps', {
            value: `
After deploying this stack:

1. Update the CDP secret with your actual credentials:
   aws secretsmanager put-secret-value --secret-id ${cdpSecret.secretName} --secret-string '{"CDP_API_KEY_NAME":"your-key","CDP_API_KEY_PRIVATE_KEY":"your-private-key"}'

2. Create AgentCore Runtime via CLI or console:
   - Use the agent code from payer-agent/
   - Assign the runtime role: ${agentRuntimeRole.roleArn}
   - See payer-agent/agentcore_config.yaml for configuration

3. Create AgentCore Gateway with rate limiting:
   - Point to the Runtime endpoint
   - Assign the gateway role: ${this.gatewayRole.roleArn}
   - Configure IAM SigV4 authentication
   - Configure rate limiting:
     * Requests per second: ${this.rateLimitConfig.requestsPerSecond}
     * Burst capacity: ${this.rateLimitConfig.burstCapacity}
     * Limit by: ${this.rateLimitConfig.limitBy}
   - See payer-agent/gateway_config.yaml for full configuration

4. Subscribe to rate limit alarms (optional):
   aws sns subscribe --topic-arn ${this.rateLimitAlarmTopic.topicArn} --protocol email --notification-endpoint your-email@example.com

5. Grant Gateway access to clients:
   - Attach the invoke policy to IAM users/roles that need access
   - Policy ARN: ${gatewayInvokePolicy.managedPolicyArn}

6. Monitor the Gateway:
   - View logs in CloudWatch: ${this.gatewayLogGroup.logGroupName}
   - View dashboard: https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=x402-payer-agent-gateway
   - Rate limit alarms will notify via SNS topic

See: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/
      `,
            description: 'Next steps for AgentCore setup',
        });
    }
}
exports.AgentCoreStack = AgentCoreStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWdlbnRjb3JlLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYWdlbnRjb3JlLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyx5REFBMkM7QUFDM0MsK0VBQWlFO0FBQ2pFLDJEQUE2QztBQUM3Qyx1RUFBeUQ7QUFDekQseURBQTJDO0FBQzNDLHVGQUF5RTtBQTBDekUsTUFBYSxjQUFlLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFNM0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUEyQjtRQUNuRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixvREFBb0Q7UUFDcEQsSUFBSSxDQUFDLGVBQWUsR0FBRztZQUNyQixpQkFBaUIsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLGlCQUFpQixJQUFJLEVBQUU7WUFDbEUsYUFBYSxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUUsYUFBYSxJQUFJLEVBQUU7WUFDMUQsT0FBTyxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUUsT0FBTyxJQUFJLGVBQWU7WUFDM0QsWUFBWSxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUUsWUFBWSxJQUFJLElBQUk7WUFDMUQsdUJBQXVCLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSx1QkFBdUIsSUFBSSxFQUFFO1NBQy9FLENBQUM7UUFFRixpQ0FBaUM7UUFDakMsTUFBTSxTQUFTLEdBQUcsSUFBSSxjQUFjLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDaEUsVUFBVSxFQUFFLGtDQUFrQztZQUM5QyxXQUFXLEVBQUUsa0VBQWtFO1lBQy9FLG9CQUFvQixFQUFFO2dCQUNwQixvQkFBb0IsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNuQyxnQkFBZ0IsRUFBRSw0QkFBNEI7aUJBQy9DLENBQUM7Z0JB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QUFTLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRTtZQUNuQyxLQUFLLEVBQUU7Ozs7cURBSXdDLFNBQVMsQ0FBQyxVQUFVOzs7O2dDQUl6QyxnQkFBZ0IsQ0FBQyxPQUFPOzs7OztnQ0FLeEIsSUFBSSxDQUFDLFdBQVcsQ0FBQyxPQUFPOzs7OEJBRzFCLElBQUksQ0FBQyxlQUFlLENBQUMsaUJBQWlCO3lCQUMzQyxJQUFJLENBQUMsZUFBZSxDQUFDLGFBQWE7bUJBQ3hDLElBQUksQ0FBQyxlQUFlLENBQUMsT0FBTzs7OzttQ0FJWixJQUFJLENBQUMsbUJBQW1CLENBQUMsUUFBUTs7OzttQkFJakQsbUJBQW1CLENBQUMsZ0JBQWdCOzs7Z0NBR3ZCLElBQUksQ0FBQyxlQUFlLENBQUMsWUFBWTsrQkFDbEMsSUFBSSxDQUFDLE1BQU0sa0RBQWtELElBQUksQ0FBQyxNQUFNOzs7O09BSWhHO1lBQ0QsV0FBVyxFQUFFLGdDQUFnQztTQUM5QyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFuWkQsd0NBbVpDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2ggZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnO1xuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaF9hY3Rpb25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoLWFjdGlvbnMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbi8qKlxuICogUmF0ZSBsaW1pdGluZyBjb25maWd1cmF0aW9uIGZvciB0aGUgQWdlbnRDb3JlIEdhdGV3YXkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmF0ZUxpbWl0Q29uZmlnIHtcbiAgLyoqIFJlcXVlc3RzIHBlciBzZWNvbmQgcGVyIGNsaWVudCAoZGVmYXVsdDogMTApICovXG4gIHJlcXVlc3RzUGVyU2Vjb25kOiBudW1iZXI7XG4gIC8qKiBCdXJzdCBjYXBhY2l0eSBmb3IgaGFuZGxpbmcgdHJhZmZpYyBzcGlrZXMgKGRlZmF1bHQ6IDIwKSAqL1xuICBidXJzdENhcGFjaXR5OiBudW1iZXI7XG4gIC8qKiBSYXRlIGxpbWl0IGJ5IElBTSBwcmluY2lwYWwgb3IgSVAgYWRkcmVzcyAqL1xuICBsaW1pdEJ5OiAnSUFNX1BSSU5DSVBBTCcgfCAnSVBfQUREUkVTUyc7XG4gIC8qKiBFbmFibGUgcmF0ZSBsaW1pdCBhbGFybXMgKi9cbiAgZW5hYmxlQWxhcm1zOiBib29sZWFuO1xuICAvKiogVGhyZXNob2xkIHBlcmNlbnRhZ2UgZm9yIHJhdGUgbGltaXQgd2FybmluZyBhbGFybSAoZGVmYXVsdDogODApICovXG4gIHdhcm5pbmdUaHJlc2hvbGRQZXJjZW50OiBudW1iZXI7XG59XG5cbi8qKlxuICogQ0RLIFN0YWNrIGZvciBCZWRyb2NrIEFnZW50Q29yZSBpbmZyYXN0cnVjdHVyZS5cbiAqIFxuICogTm90ZTogQWdlbnRDb3JlIENESyBMMiBjb25zdHJ1Y3RzIGFyZSB1bmRlciBkZXZlbG9wbWVudCAoUkZDICM3ODUpLlxuICogVGhpcyBzdGFjayB1c2VzIEwxIGNvbnN0cnVjdHMgYW5kIElBTSByb2xlcyBmb3IgQWdlbnRDb3JlIGludGVncmF0aW9uLlxuICogXG4gKiBGb3IgcHJvZHVjdGlvbiBkZXBsb3ltZW50LCB1c2UgdGhlIEFnZW50Q29yZSBDTEkgb3IgY29uc29sZSB0byBjcmVhdGU6XG4gKiAtIEFnZW50Q29yZSBSdW50aW1lXG4gKiAtIEFnZW50Q29yZSBHYXRld2F5XG4gKiAtIEFnZW50Q29yZSBNZW1vcnkgKG9wdGlvbmFsKVxuICogXG4gKiBHYXRld2F5IENvbmZpZ3VyYXRpb246XG4gKiAtIElBTSBTaWdWNCBhdXRoZW50aWNhdGlvbiBmb3Igc2VjdXJlIEFQSSBhY2Nlc3NcbiAqIC0gUmF0ZSBsaW1pdGluZyB0byBwcmV2ZW50IGFidXNlXG4gKiAtIENPUlMgc3VwcG9ydCBmb3Igd2ViIGNsaWVudHNcbiAqIC0gQ2xvdWRXYXRjaCBsb2dnaW5nIGFuZCBtZXRyaWNzXG4gKi9cblxuZXhwb3J0IGludGVyZmFjZSBBZ2VudENvcmVTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICAvKiogUmF0ZSBsaW1pdGluZyBjb25maWd1cmF0aW9uICovXG4gIHJhdGVMaW1pdENvbmZpZz86IFBhcnRpYWw8UmF0ZUxpbWl0Q29uZmlnPjtcbn1cblxuZXhwb3J0IGNsYXNzIEFnZW50Q29yZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGdhdGV3YXlSb2xlOiBpYW0uUm9sZTtcbiAgcHVibGljIHJlYWRvbmx5IGdhdGV3YXlMb2dHcm91cDogbG9ncy5Mb2dHcm91cDtcbiAgcHVibGljIHJlYWRvbmx5IHJhdGVMaW1pdEFsYXJtVG9waWM6IHNucy5Ub3BpYztcbiAgcHVibGljIHJlYWRvbmx5IHJhdGVMaW1pdENvbmZpZzogUmF0ZUxpbWl0Q29uZmlnO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogQWdlbnRDb3JlU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSByYXRlIGxpbWl0IGNvbmZpZ3VyYXRpb24gd2l0aCBkZWZhdWx0c1xuICAgIHRoaXMucmF0ZUxpbWl0Q29uZmlnID0ge1xuICAgICAgcmVxdWVzdHNQZXJTZWNvbmQ6IHByb3BzPy5yYXRlTGltaXRDb25maWc/LnJlcXVlc3RzUGVyU2Vjb25kID8/IDEwLFxuICAgICAgYnVyc3RDYXBhY2l0eTogcHJvcHM/LnJhdGVMaW1pdENvbmZpZz8uYnVyc3RDYXBhY2l0eSA/PyAyMCxcbiAgICAgIGxpbWl0Qnk6IHByb3BzPy5yYXRlTGltaXRDb25maWc/LmxpbWl0QnkgPz8gJ0lBTV9QUklOQ0lQQUwnLFxuICAgICAgZW5hYmxlQWxhcm1zOiBwcm9wcz8ucmF0ZUxpbWl0Q29uZmlnPy5lbmFibGVBbGFybXMgPz8gdHJ1ZSxcbiAgICAgIHdhcm5pbmdUaHJlc2hvbGRQZXJjZW50OiBwcm9wcz8ucmF0ZUxpbWl0Q29uZmlnPy53YXJuaW5nVGhyZXNob2xkUGVyY2VudCA/PyA4MCxcbiAgICB9O1xuXG4gICAgLy8gU2VjcmV0IGZvciBDRFAgQVBJIGNyZWRlbnRpYWxzXG4gICAgY29uc3QgY2RwU2VjcmV0ID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnQ2RwQXBpU2VjcmV0Jywge1xuICAgICAgc2VjcmV0TmFtZTogJ3g0MDItcGF5ZXItYWdlbnQvY2RwLWNyZWRlbnRpYWxzJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29pbmJhc2UgRGV2ZWxvcGVyIFBsYXRmb3JtIEFQSSBjcmVkZW50aWFscyBmb3IgeDQwMiBwYXllciBhZ2VudCcsXG4gICAgICBnZW5lcmF0ZVNlY3JldFN0cmluZzoge1xuICAgICAgICBzZWNyZXRTdHJpbmdUZW1wbGF0ZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIENEUF9BUElfS0VZX05BTUU6ICdSRVBMQUNFX1dJVEhfWU9VUl9LRVlfTkFNRScsXG4gICAgICAgIH0pLFxuICAgICAgICBnZW5lcmF0ZVN0cmluZ0tleTogJ0NEUF9BUElfS0VZX1BSSVZBVEVfS0VZJyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBJQU0gUm9sZSBmb3IgQWdlbnRDb3JlIFJ1bnRpbWVcbiAgICBjb25zdCBhZ2VudFJ1bnRpbWVSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdBZ2VudFJ1bnRpbWVSb2xlJywge1xuICAgICAgcm9sZU5hbWU6ICd4NDAyLXBheWVyLWFnZW50LXJ1bnRpbWUtcm9sZScsXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246ICdJQU0gcm9sZSBmb3IgeDQwMiBwYXllciBhZ2VudCBydW5uaW5nIG9uIEFnZW50Q29yZSBSdW50aW1lJyxcbiAgICB9KTtcblxuICAgIC8vIEJlZHJvY2sgbW9kZWwgYWNjZXNzXG4gICAgYWdlbnRSdW50aW1lUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsJyxcbiAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWxXaXRoUmVzcG9uc2VTdHJlYW0nLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7dGhpcy5yZWdpb259Ojpmb3VuZGF0aW9uLW1vZGVsL2FudGhyb3BpYy5jbGF1ZGUtMy1zb25uZXQtKmAsXG4gICAgICAgIGBhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06OmZvdW5kYXRpb24tbW9kZWwvYW50aHJvcGljLmNsYXVkZS0zLTUtc29ubmV0LSpgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyBTZWNyZXRzIE1hbmFnZXIgYWNjZXNzXG4gICAgYWdlbnRSdW50aW1lUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbY2RwU2VjcmV0LnNlY3JldEFybl0sXG4gICAgfSkpO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBMb2dzIGFjY2Vzc1xuICAgIGFnZW50UnVudGltZVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnbG9nczpDcmVhdGVMb2dHcm91cCcsXG4gICAgICAgICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsXG4gICAgICAgICdsb2dzOlB1dExvZ0V2ZW50cycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2JlZHJvY2stYWdlbnRjb3JlLypgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyBJQU0gUm9sZSBmb3IgQWdlbnRDb3JlIEdhdGV3YXkgKGZvciBBUEkgYWNjZXNzKVxuICAgIHRoaXMuZ2F0ZXdheVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0dhdGV3YXlSb2xlJywge1xuICAgICAgcm9sZU5hbWU6ICd4NDAyLXBheWVyLWFnZW50LWdhdGV3YXktcm9sZScsXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246ICdJQU0gcm9sZSBmb3IgeDQwMiBwYXllciBhZ2VudCBHYXRld2F5JyxcbiAgICB9KTtcblxuICAgIC8vIEdhdGV3YXkgcGVybWlzc2lvbnMgdG8gaW52b2tlIHRoZSBSdW50aW1lXG4gICAgdGhpcy5nYXRld2F5Um9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdiZWRyb2NrOkludm9rZUFnZW50JyxcbiAgICAgICAgJ2JlZHJvY2s6SW52b2tlQWdlbnRXaXRoUmVzcG9uc2VTdHJlYW0nLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTphZ2VudC8qYCxcbiAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06YWdlbnQtYWxpYXMvKmAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vIEdhdGV3YXkgQ2xvdWRXYXRjaCBMb2dzIHBlcm1pc3Npb25zXG4gICAgdGhpcy5nYXRld2F5Um9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsXG4gICAgICAgICdsb2dzOlB1dExvZ0V2ZW50cycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2JlZHJvY2stYWdlbnRjb3JlL2dhdGV3YXkvKmAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vIENsb3VkV2F0Y2ggTG9nIEdyb3VwIGZvciBHYXRld2F5XG4gICAgdGhpcy5nYXRld2F5TG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnR2F0ZXdheUxvZ0dyb3VwJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9iZWRyb2NrLWFnZW50Y29yZS9nYXRld2F5L3g0MDItcGF5ZXItYWdlbnQnLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFJhdGUgTGltaXRpbmcgSW5mcmFzdHJ1Y3R1cmVcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIFNOUyBUb3BpYyBmb3IgcmF0ZSBsaW1pdCBhbGFybXNcbiAgICB0aGlzLnJhdGVMaW1pdEFsYXJtVG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdSYXRlTGltaXRBbGFybVRvcGljJywge1xuICAgICAgdG9waWNOYW1lOiAneDQwMi1wYXllci1hZ2VudC1yYXRlLWxpbWl0LWFsYXJtcycsXG4gICAgICBkaXNwbGF5TmFtZTogJ3g0MDIgUGF5ZXIgQWdlbnQgUmF0ZSBMaW1pdCBBbGFybXMnLFxuICAgIH0pO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBNZXRyaWMgRmlsdGVyIGZvciB0aHJvdHRsZWQgcmVxdWVzdHNcbiAgICBjb25zdCB0aHJvdHRsZWRSZXF1ZXN0c01ldHJpY0ZpbHRlciA9IG5ldyBsb2dzLk1ldHJpY0ZpbHRlcih0aGlzLCAnVGhyb3R0bGVkUmVxdWVzdHNNZXRyaWNGaWx0ZXInLCB7XG4gICAgICBsb2dHcm91cDogdGhpcy5nYXRld2F5TG9nR3JvdXAsXG4gICAgICBtZXRyaWNOYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudC9HYXRld2F5L1JhdGVMaW1pdGluZycsXG4gICAgICBtZXRyaWNOYW1lOiAnVGhyb3R0bGVkUmVxdWVzdHMnLFxuICAgICAgZmlsdGVyUGF0dGVybjogbG9ncy5GaWx0ZXJQYXR0ZXJuLmxpdGVyYWwoJ1Rocm90dGxpbmdFeGNlcHRpb24nKSxcbiAgICAgIG1ldHJpY1ZhbHVlOiAnMScsXG4gICAgICBkZWZhdWx0VmFsdWU6IDAsXG4gICAgfSk7XG5cbiAgICAvLyBDbG91ZFdhdGNoIE1ldHJpYyBGaWx0ZXIgZm9yIHRvdGFsIHJlcXVlc3RzXG4gICAgY29uc3QgdG90YWxSZXF1ZXN0c01ldHJpY0ZpbHRlciA9IG5ldyBsb2dzLk1ldHJpY0ZpbHRlcih0aGlzLCAnVG90YWxSZXF1ZXN0c01ldHJpY0ZpbHRlcicsIHtcbiAgICAgIGxvZ0dyb3VwOiB0aGlzLmdhdGV3YXlMb2dHcm91cCxcbiAgICAgIG1ldHJpY05hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50L0dhdGV3YXkvUmF0ZUxpbWl0aW5nJyxcbiAgICAgIG1ldHJpY05hbWU6ICdUb3RhbFJlcXVlc3RzJyxcbiAgICAgIGZpbHRlclBhdHRlcm46IGxvZ3MuRmlsdGVyUGF0dGVybi5saXRlcmFsKCdJbnZva2VBZ2VudCcpLFxuICAgICAgbWV0cmljVmFsdWU6ICcxJyxcbiAgICAgIGRlZmF1bHRWYWx1ZTogMCxcbiAgICB9KTtcblxuICAgIC8vIFRocm90dGxlZCBSZXF1ZXN0cyBBbGFybVxuICAgIGNvbnN0IHRocm90dGxlZFJlcXVlc3RzQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnVGhyb3R0bGVkUmVxdWVzdHNBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ3g0MDItcGF5ZXItYWdlbnQtdGhyb3R0bGVkLXJlcXVlc3RzJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGFybSB3aGVuIHJlcXVlc3RzIGFyZSBiZWluZyB0aHJvdHRsZWQgZHVlIHRvIHJhdGUgbGltaXRpbmcnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudC9HYXRld2F5L1JhdGVMaW1pdGluZycsXG4gICAgICAgIG1ldHJpY05hbWU6ICdUaHJvdHRsZWRSZXF1ZXN0cycsXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogNSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgYWxhcm0gYWN0aW9uIHRvIG5vdGlmeSB2aWEgU05TXG4gICAgaWYgKHRoaXMucmF0ZUxpbWl0Q29uZmlnLmVuYWJsZUFsYXJtcykge1xuICAgICAgdGhyb3R0bGVkUmVxdWVzdHNBbGFybS5hZGRBbGFybUFjdGlvbihcbiAgICAgICAgbmV3IGNsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24odGhpcy5yYXRlTGltaXRBbGFybVRvcGljKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBIaWdoIFJlcXVlc3QgUmF0ZSBBbGFybSAoYXBwcm9hY2hpbmcgcmF0ZSBsaW1pdClcbiAgICBjb25zdCBoaWdoUmVxdWVzdFJhdGVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdIaWdoUmVxdWVzdFJhdGVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ3g0MDItcGF5ZXItYWdlbnQtaGlnaC1yZXF1ZXN0LXJhdGUnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogYEFsYXJtIHdoZW4gcmVxdWVzdCByYXRlIGV4Y2VlZHMgJHt0aGlzLnJhdGVMaW1pdENvbmZpZy53YXJuaW5nVGhyZXNob2xkUGVyY2VudH0lIG9mIHJhdGUgbGltaXRgLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdYNDAyUGF5ZXJBZ2VudC9HYXRld2F5L1JhdGVMaW1pdGluZycsXG4gICAgICAgIG1ldHJpY05hbWU6ICdUb3RhbFJlcXVlc3RzJyxcbiAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICB9KSxcbiAgICAgIC8vIFRocmVzaG9sZCBpcyA4MCUgb2YgcmVxdWVzdHMgcGVyIG1pbnV0ZSAocmVxdWVzdHNQZXJTZWNvbmQgKiA2MCAqIHdhcm5pbmdUaHJlc2hvbGRQZXJjZW50LzEwMClcbiAgICAgIHRocmVzaG9sZDogTWF0aC5mbG9vcih0aGlzLnJhdGVMaW1pdENvbmZpZy5yZXF1ZXN0c1BlclNlY29uZCAqIDYwICogKHRoaXMucmF0ZUxpbWl0Q29uZmlnLndhcm5pbmdUaHJlc2hvbGRQZXJjZW50IC8gMTAwKSksXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuXG4gICAgaWYgKHRoaXMucmF0ZUxpbWl0Q29uZmlnLmVuYWJsZUFsYXJtcykge1xuICAgICAgaGlnaFJlcXVlc3RSYXRlQWxhcm0uYWRkQWxhcm1BY3Rpb24oXG4gICAgICAgIG5ldyBjbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKHRoaXMucmF0ZUxpbWl0QWxhcm1Ub3BpYylcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gSUFNIFBvbGljeSBmb3IgY2xpZW50cyB0byBpbnZva2UgdGhlIEdhdGV3YXlcbiAgICBjb25zdCBnYXRld2F5SW52b2tlUG9saWN5ID0gbmV3IGlhbS5NYW5hZ2VkUG9saWN5KHRoaXMsICdHYXRld2F5SW52b2tlUG9saWN5Jywge1xuICAgICAgbWFuYWdlZFBvbGljeU5hbWU6ICd4NDAyLXBheWVyLWFnZW50LWdhdGV3YXktaW52b2tlJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUG9saWN5IGFsbG93aW5nIGludm9jYXRpb24gb2YgdGhlIHg0MDIgcGF5ZXIgYWdlbnQgR2F0ZXdheScsXG4gICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgJ2JlZHJvY2s6SW52b2tlQWdlbnQnLFxuICAgICAgICAgICAgJ2JlZHJvY2s6SW52b2tlQWdlbnRXaXRoUmVzcG9uc2VTdHJlYW0nLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTphZ2VudC8qYCxcbiAgICAgICAgICAgIGBhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmFnZW50LWFsaWFzLypgLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIENsb3VkV2F0Y2ggRGFzaGJvYXJkIGZvciBHYXRld2F5IG1vbml0b3JpbmdcbiAgICBjb25zdCBkYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5EYXNoYm9hcmQodGhpcywgJ0dhdGV3YXlEYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiAneDQwMi1wYXllci1hZ2VudC1nYXRld2F5JyxcbiAgICB9KTtcblxuICAgIC8vIEFkZCB3aWRnZXRzIHRvIGRhc2hib2FyZFxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgIG1hcmtkb3duOiAnIyB4NDAyIFBheWVyIEFnZW50IEdhdGV3YXlcXG5Nb25pdG9yaW5nIGRhc2hib2FyZCBmb3IgdGhlIEFnZW50Q29yZSBHYXRld2F5JyxcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gUmF0ZSBMaW1pdGluZyBTZWN0aW9uXG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246ICcjIyBSYXRlIExpbWl0aW5nIE1ldHJpY3MnLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdSZXF1ZXN0IFJhdGUgdnMgTGltaXQnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50L0dhdGV3YXkvUmF0ZUxpbWl0aW5nJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdUb3RhbFJlcXVlc3RzJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgICAgICAgbGFiZWw6ICdSZXF1ZXN0cyBwZXIgTWludXRlJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgbGVmdEFubm90YXRpb25zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgdmFsdWU6IHRoaXMucmF0ZUxpbWl0Q29uZmlnLnJlcXVlc3RzUGVyU2Vjb25kICogNjAsXG4gICAgICAgICAgICBsYWJlbDogJ1JhdGUgTGltaXQgKHBlciBtaW51dGUpJyxcbiAgICAgICAgICAgIGNvbG9yOiAnI2ZmMDAwMCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICB2YWx1ZTogTWF0aC5mbG9vcih0aGlzLnJhdGVMaW1pdENvbmZpZy5yZXF1ZXN0c1BlclNlY29uZCAqIDYwICogKHRoaXMucmF0ZUxpbWl0Q29uZmlnLndhcm5pbmdUaHJlc2hvbGRQZXJjZW50IC8gMTAwKSksXG4gICAgICAgICAgICBsYWJlbDogYFdhcm5pbmcgVGhyZXNob2xkICgke3RoaXMucmF0ZUxpbWl0Q29uZmlnLndhcm5pbmdUaHJlc2hvbGRQZXJjZW50fSUpYCxcbiAgICAgICAgICAgIGNvbG9yOiAnI2ZmOTkwMCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdUaHJvdHRsZWQgUmVxdWVzdHMnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1g0MDJQYXllckFnZW50L0dhdGV3YXkvUmF0ZUxpbWl0aW5nJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdUaHJvdHRsZWRSZXF1ZXN0cycsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgICAgICAgIGxhYmVsOiAnVGhyb3R0bGVkIFJlcXVlc3RzJyxcbiAgICAgICAgICAgIGNvbG9yOiAnI2ZmMDAwMCcsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIFJhdGUgTGltaXRpbmcgQ29uZmlndXJhdGlvbiBEaXNwbGF5XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246IGAjIyMgUmF0ZSBMaW1pdCBDb25maWd1cmF0aW9uXG58IFNldHRpbmcgfCBWYWx1ZSB8XG58LS0tLS0tLS0tfC0tLS0tLS18XG58IFJlcXVlc3RzIHBlciBTZWNvbmQgfCAke3RoaXMucmF0ZUxpbWl0Q29uZmlnLnJlcXVlc3RzUGVyU2Vjb25kfSB8XG58IEJ1cnN0IENhcGFjaXR5IHwgJHt0aGlzLnJhdGVMaW1pdENvbmZpZy5idXJzdENhcGFjaXR5fSB8XG58IExpbWl0IEJ5IHwgJHt0aGlzLnJhdGVMaW1pdENvbmZpZy5saW1pdEJ5fSB8XG58IFdhcm5pbmcgVGhyZXNob2xkIHwgJHt0aGlzLnJhdGVMaW1pdENvbmZpZy53YXJuaW5nVGhyZXNob2xkUGVyY2VudH0lIHxgLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNCxcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm1TdGF0dXNXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1JhdGUgTGltaXRpbmcgQWxhcm1zJyxcbiAgICAgICAgYWxhcm1zOiBbdGhyb3R0bGVkUmVxdWVzdHNBbGFybSwgaGlnaFJlcXVlc3RSYXRlQWxhcm1dLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNCxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkxvZ1F1ZXJ5V2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdHYXRld2F5IFJlcXVlc3QgTG9ncycsXG4gICAgICAgIGxvZ0dyb3VwTmFtZXM6IFt0aGlzLmdhdGV3YXlMb2dHcm91cC5sb2dHcm91cE5hbWVdLFxuICAgICAgICBxdWVyeUxpbmVzOiBbXG4gICAgICAgICAgJ2ZpZWxkcyBAdGltZXN0YW1wLCBAbWVzc2FnZScsXG4gICAgICAgICAgJ3NvcnQgQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgICAnbGltaXQgMTAwJyxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDZHBTZWNyZXRBcm4nLCB7XG4gICAgICB2YWx1ZTogY2RwU2VjcmV0LnNlY3JldEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBDRFAgY3JlZGVudGlhbHMgc2VjcmV0JyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudENkcFNlY3JldEFybicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWdlbnRSdW50aW1lUm9sZUFybicsIHtcbiAgICAgIHZhbHVlOiBhZ2VudFJ1bnRpbWVSb2xlLnJvbGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FSTiBvZiB0aGUgQWdlbnRDb3JlIFJ1bnRpbWUgSUFNIHJvbGUnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50UnVudGltZVJvbGVBcm4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dhdGV3YXlSb2xlQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuZ2F0ZXdheVJvbGUucm9sZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBBZ2VudENvcmUgR2F0ZXdheSBJQU0gcm9sZScsXG4gICAgICBleHBvcnROYW1lOiAnWDQwMlBheWVyQWdlbnRHYXRld2F5Um9sZUFybicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR2F0ZXdheUxvZ0dyb3VwTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmdhdGV3YXlMb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkV2F0Y2ggTG9nIEdyb3VwIGZvciBHYXRld2F5IGxvZ3MnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50R2F0ZXdheUxvZ0dyb3VwJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHYXRld2F5SW52b2tlUG9saWN5QXJuJywge1xuICAgICAgdmFsdWU6IGdhdGV3YXlJbnZva2VQb2xpY3kubWFuYWdlZFBvbGljeUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBwb2xpY3kgZm9yIGludm9raW5nIHRoZSBHYXRld2F5JyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudEdhdGV3YXlJbnZva2VQb2xpY3lBcm4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Rhc2hib2FyZFVybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke3RoaXMucmVnaW9ufS5jb25zb2xlLmF3cy5hbWF6b24uY29tL2Nsb3Vkd2F0Y2gvaG9tZT9yZWdpb249JHt0aGlzLnJlZ2lvbn0jZGFzaGJvYXJkczpuYW1lPXg0MDItcGF5ZXItYWdlbnQtZ2F0ZXdheWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1VSTCB0byB0aGUgQ2xvdWRXYXRjaCBEYXNoYm9hcmQnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50RGFzaGJvYXJkVXJsJyxcbiAgICB9KTtcblxuICAgIC8vIFJhdGUgTGltaXRpbmcgT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSYXRlTGltaXRBbGFybVRvcGljQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMucmF0ZUxpbWl0QWxhcm1Ub3BpYy50b3BpY0FybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnU05TIFRvcGljIEFSTiBmb3IgcmF0ZSBsaW1pdCBhbGFybXMnLFxuICAgICAgZXhwb3J0TmFtZTogJ1g0MDJQYXllckFnZW50UmF0ZUxpbWl0QWxhcm1Ub3BpY0FybicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmF0ZUxpbWl0Q29uZmlnJywge1xuICAgICAgdmFsdWU6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcmVxdWVzdHNQZXJTZWNvbmQ6IHRoaXMucmF0ZUxpbWl0Q29uZmlnLnJlcXVlc3RzUGVyU2Vjb25kLFxuICAgICAgICBidXJzdENhcGFjaXR5OiB0aGlzLnJhdGVMaW1pdENvbmZpZy5idXJzdENhcGFjaXR5LFxuICAgICAgICBsaW1pdEJ5OiB0aGlzLnJhdGVMaW1pdENvbmZpZy5saW1pdEJ5LFxuICAgICAgICB3YXJuaW5nVGhyZXNob2xkUGVyY2VudDogdGhpcy5yYXRlTGltaXRDb25maWcud2FybmluZ1RocmVzaG9sZFBlcmNlbnQsXG4gICAgICB9KSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUmF0ZSBsaW1pdGluZyBjb25maWd1cmF0aW9uJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdYNDAyUGF5ZXJBZ2VudFJhdGVMaW1pdENvbmZpZycsXG4gICAgfSk7XG5cbiAgICAvLyBJbnN0cnVjdGlvbnMgZm9yIG1hbnVhbCBBZ2VudENvcmUgc2V0dXBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTmV4dFN0ZXBzJywge1xuICAgICAgdmFsdWU6IGBcbkFmdGVyIGRlcGxveWluZyB0aGlzIHN0YWNrOlxuXG4xLiBVcGRhdGUgdGhlIENEUCBzZWNyZXQgd2l0aCB5b3VyIGFjdHVhbCBjcmVkZW50aWFsczpcbiAgIGF3cyBzZWNyZXRzbWFuYWdlciBwdXQtc2VjcmV0LXZhbHVlIC0tc2VjcmV0LWlkICR7Y2RwU2VjcmV0LnNlY3JldE5hbWV9IC0tc2VjcmV0LXN0cmluZyAne1wiQ0RQX0FQSV9LRVlfTkFNRVwiOlwieW91ci1rZXlcIixcIkNEUF9BUElfS0VZX1BSSVZBVEVfS0VZXCI6XCJ5b3VyLXByaXZhdGUta2V5XCJ9J1xuXG4yLiBDcmVhdGUgQWdlbnRDb3JlIFJ1bnRpbWUgdmlhIENMSSBvciBjb25zb2xlOlxuICAgLSBVc2UgdGhlIGFnZW50IGNvZGUgZnJvbSBwYXllci1hZ2VudC9cbiAgIC0gQXNzaWduIHRoZSBydW50aW1lIHJvbGU6ICR7YWdlbnRSdW50aW1lUm9sZS5yb2xlQXJufVxuICAgLSBTZWUgcGF5ZXItYWdlbnQvYWdlbnRjb3JlX2NvbmZpZy55YW1sIGZvciBjb25maWd1cmF0aW9uXG5cbjMuIENyZWF0ZSBBZ2VudENvcmUgR2F0ZXdheSB3aXRoIHJhdGUgbGltaXRpbmc6XG4gICAtIFBvaW50IHRvIHRoZSBSdW50aW1lIGVuZHBvaW50XG4gICAtIEFzc2lnbiB0aGUgZ2F0ZXdheSByb2xlOiAke3RoaXMuZ2F0ZXdheVJvbGUucm9sZUFybn1cbiAgIC0gQ29uZmlndXJlIElBTSBTaWdWNCBhdXRoZW50aWNhdGlvblxuICAgLSBDb25maWd1cmUgcmF0ZSBsaW1pdGluZzpcbiAgICAgKiBSZXF1ZXN0cyBwZXIgc2Vjb25kOiAke3RoaXMucmF0ZUxpbWl0Q29uZmlnLnJlcXVlc3RzUGVyU2Vjb25kfVxuICAgICAqIEJ1cnN0IGNhcGFjaXR5OiAke3RoaXMucmF0ZUxpbWl0Q29uZmlnLmJ1cnN0Q2FwYWNpdHl9XG4gICAgICogTGltaXQgYnk6ICR7dGhpcy5yYXRlTGltaXRDb25maWcubGltaXRCeX1cbiAgIC0gU2VlIHBheWVyLWFnZW50L2dhdGV3YXlfY29uZmlnLnlhbWwgZm9yIGZ1bGwgY29uZmlndXJhdGlvblxuXG40LiBTdWJzY3JpYmUgdG8gcmF0ZSBsaW1pdCBhbGFybXMgKG9wdGlvbmFsKTpcbiAgIGF3cyBzbnMgc3Vic2NyaWJlIC0tdG9waWMtYXJuICR7dGhpcy5yYXRlTGltaXRBbGFybVRvcGljLnRvcGljQXJufSAtLXByb3RvY29sIGVtYWlsIC0tbm90aWZpY2F0aW9uLWVuZHBvaW50IHlvdXItZW1haWxAZXhhbXBsZS5jb21cblxuNS4gR3JhbnQgR2F0ZXdheSBhY2Nlc3MgdG8gY2xpZW50czpcbiAgIC0gQXR0YWNoIHRoZSBpbnZva2UgcG9saWN5IHRvIElBTSB1c2Vycy9yb2xlcyB0aGF0IG5lZWQgYWNjZXNzXG4gICAtIFBvbGljeSBBUk46ICR7Z2F0ZXdheUludm9rZVBvbGljeS5tYW5hZ2VkUG9saWN5QXJufVxuXG42LiBNb25pdG9yIHRoZSBHYXRld2F5OlxuICAgLSBWaWV3IGxvZ3MgaW4gQ2xvdWRXYXRjaDogJHt0aGlzLmdhdGV3YXlMb2dHcm91cC5sb2dHcm91cE5hbWV9XG4gICAtIFZpZXcgZGFzaGJvYXJkOiBodHRwczovLyR7dGhpcy5yZWdpb259LmNvbnNvbGUuYXdzLmFtYXpvbi5jb20vY2xvdWR3YXRjaC9ob21lP3JlZ2lvbj0ke3RoaXMucmVnaW9ufSNkYXNoYm9hcmRzOm5hbWU9eDQwMi1wYXllci1hZ2VudC1nYXRld2F5XG4gICAtIFJhdGUgbGltaXQgYWxhcm1zIHdpbGwgbm90aWZ5IHZpYSBTTlMgdG9waWNcblxuU2VlOiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vYmVkcm9jay1hZ2VudGNvcmUvbGF0ZXN0L2Rldmd1aWRlL1xuICAgICAgYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTmV4dCBzdGVwcyBmb3IgQWdlbnRDb3JlIHNldHVwJyxcbiAgICB9KTtcbiAgfVxufVxuIl19