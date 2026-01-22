import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';

/**
 * Rate limiting configuration for the AgentCore Gateway.
 */
export interface RateLimitConfig {
  /** Requests per second per client (default: 10) */
  requestsPerSecond: number;
  /** Burst capacity for handling traffic spikes (default: 20) */
  burstCapacity: number;
  /** Rate limit by IAM principal or IP address */
  limitBy: 'IAM_PRINCIPAL' | 'IP_ADDRESS';
  /** Enable rate limit alarms */
  enableAlarms: boolean;
  /** Threshold percentage for rate limit warning alarm (default: 80) */
  warningThresholdPercent: number;
}

/**
 * CDK Stack for Bedrock AgentCore infrastructure.
 * 
 * Note: AgentCore CDK L2 constructs are under development (RFC #785).
 * This stack uses L1 constructs and IAM roles for AgentCore integration.
 * 
 * For production deployment, use the AgentCore CLI or console to create:
 * - AgentCore Runtime
 * - AgentCore Gateway
 * - AgentCore Memory (optional)
 * 
 * Gateway Configuration:
 * - IAM SigV4 authentication for secure API access
 * - Rate limiting to prevent abuse
 * - CORS support for web clients
 * - CloudWatch logging and metrics
 */

export interface AgentCoreStackProps extends cdk.StackProps {
  /** Rate limiting configuration */
  rateLimitConfig?: Partial<RateLimitConfig>;
}

export class AgentCoreStack extends cdk.Stack {
  public readonly gatewayRole: iam.Role;
  public readonly gatewayLogGroup: logs.LogGroup;
  public readonly rateLimitAlarmTopic: sns.Topic;
  public readonly rateLimitConfig: RateLimitConfig;

  constructor(scope: Construct, id: string, props?: AgentCoreStackProps) {
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
      throttledRequestsAlarm.addAlarmAction(
        new cloudwatch_actions.SnsAction(this.rateLimitAlarmTopic)
      );
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
      highRequestRateAlarm.addAlarmAction(
        new cloudwatch_actions.SnsAction(this.rateLimitAlarmTopic)
      );
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
    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '# x402 Payer Agent Gateway\nMonitoring dashboard for the AgentCore Gateway',
        width: 24,
        height: 1,
      }),
    );

    // Rate Limiting Section
    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '## Rate Limiting Metrics',
        width: 24,
        height: 1,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      }),
      new cloudwatch.GraphWidget({
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
      }),
    );

    // Rate Limiting Configuration Display
    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `### Rate Limit Configuration
| Setting | Value |
|---------|-------|
| Requests per Second | ${this.rateLimitConfig.requestsPerSecond} |
| Burst Capacity | ${this.rateLimitConfig.burstCapacity} |
| Limit By | ${this.rateLimitConfig.limitBy} |
| Warning Threshold | ${this.rateLimitConfig.warningThresholdPercent}% |`,
        width: 12,
        height: 4,
      }),
      new cloudwatch.AlarmStatusWidget({
        title: 'Rate Limiting Alarms',
        alarms: [throttledRequestsAlarm, highRequestRateAlarm],
        width: 12,
        height: 4,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.LogQueryWidget({
        title: 'Gateway Request Logs',
        logGroupNames: [this.gatewayLogGroup.logGroupName],
        queryLines: [
          'fields @timestamp, @message',
          'sort @timestamp desc',
          'limit 100',
        ],
        width: 24,
        height: 6,
      }),
    );

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
