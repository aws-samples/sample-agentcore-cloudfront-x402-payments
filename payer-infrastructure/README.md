# x402 Payer Infrastructure

AWS CDK infrastructure for the payer agent side of the x402 payment demo.

## Overview

This stack deploys the supporting AWS infrastructure for the Bedrock AgentCore-based payer agent:

- **IAM Roles**: Execution roles for AgentCore Runtime and Gateway
- **Secrets Manager**: Secure storage for CDP (Coinbase Developer Platform) credentials
- **CloudWatch**: Logging and monitoring dashboards

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Payer Infrastructure                     │
│                                                             │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │ Secrets Manager │    │         IAM Roles               │ │
│  │ ┌─────────────┐ │    │  ┌───────────┐  ┌───────────┐   │ │
│  │ │ CDP Creds   │ │    │  │  Runtime  │  │  Gateway  │   │ │
│  │ └─────────────┘ │    │  │   Role    │  │   Role    │   │ │
│  └─────────────────┘    │  └───────────┘  └───────────┘   │ │
│                         └─────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │                    CloudWatch                           │ │
│ │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │ │
│ │  │  Log Group  │  │  Dashboard  │  │  Alarms (opt)   │  │ │
│ │  └─────────────┘  └─────────────┘  └─────────────────┘  │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Resources Created

| Resource | Name | Purpose |
|----------|------|---------|
| IAM Role | `x402-payer-agent-runtime-role` | AgentCore Runtime execution |
| IAM Role | `x402-payer-agent-gateway-role` | AgentCore Gateway execution |
| IAM Policy | `x402-gateway-invoke-policy` | Allow Gateway invocation |
| Secret | `x402-payer-agent/cdp-credentials` | CDP API keys storage |
| Log Group | `/aws/agentcore/x402-payer-gateway` | Gateway access logs |
| Dashboard | `x402-payer-agent-dashboard` | Monitoring dashboard |

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 18+ installed
- AWS CDK CLI (`npm install -g aws-cdk`)

## Deployment

### 1. Install dependencies

```bash
npm install
```

### 2. Bootstrap CDK (first time only)

```bash
cdk bootstrap
```

### 3. Deploy the stack

```bash
cdk deploy
```

### 4. Configure CDP credentials

After deployment, store your CDP credentials in Secrets Manager:

```bash
aws secretsmanager put-secret-value \
  --secret-id x402-payer-agent/cdp-credentials \
  --secret-string '{
    "CDP_API_KEY_NAME": "your-api-key-name",
    "CDP_API_KEY_PRIVATE_KEY": "your-private-key",
    "CDP_WALLET_SECRET": "optional-wallet-secret"
  }'
```

## Stack Outputs

After deployment, the stack outputs:

| Output | Description |
|--------|-------------|
| `RuntimeRoleArn` | ARN of the Runtime execution role |
| `GatewayRoleArn` | ARN of the Gateway execution role |
| `CdpSecretArn` | ARN of the CDP credentials secret |
| `LogGroupName` | Name of the CloudWatch log group |
| `DashboardUrl` | URL to the CloudWatch dashboard |

## IAM Permissions

### Runtime Role Permissions

The Runtime role has permissions to:
- Invoke Bedrock models (Claude 3 Sonnet)
- Read CDP credentials from Secrets Manager
- Write logs to CloudWatch

### Gateway Role Permissions

The Gateway role has permissions to:
- Invoke the AgentCore Runtime
- Write access logs to CloudWatch

## Monitoring & Observability

### CloudWatch Dashboards

The infrastructure includes comprehensive CloudWatch dashboards for monitoring the x402 payment flow:

#### 1. Main Overview Dashboard (`x402-enterprise-demo-overview`)
End-to-end visibility across the entire payment flow:
- **Key Metrics Summary**: Total requests, payments settled, success rate, average latency
- **Payment Flow Funnel**: Visualizes requests → 402 responses → payments received → verified → settled
- **Error Tracking**: Payment failures, validation errors, facilitator errors
- **Latency Metrics**: End-to-end, verification, and settlement latency (avg, p50, p90, p99)

#### 2. Payer Agent Dashboard (`x402-payer-agent`)
AgentCore Gateway monitoring:
- Gateway request rate and throttling
- Rate limit status and alarms
- Recent gateway activity logs

#### 3. Seller Infrastructure Dashboard (`x402-seller-infrastructure`)
CloudFront and Lambda@Edge metrics:
- CloudFront requests, error rates, cache hit rate
- Payment processing funnel (402 sent → received → settled)
- Content delivery metrics (generated, cache hits, S3 fetches)
- Payment details by network

### Deploying Dashboards

Deploy the observability stack:

```bash
# Deploy with default settings
cdk deploy X402ObservabilityStack

# Deploy with specific CloudFront distribution ID
cdk deploy X402ObservabilityStack \
  -c cloudfrontDistributionId=E1234567890ABC \
  -c gatewayLogGroupName=/aws/bedrock-agentcore/gateway/x402-payer-agent
```

### Dashboard URLs

After deployment, access dashboards via:
- **Main Overview**: `https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#dashboards:name=x402-enterprise-demo-overview`
- **Payer Agent**: `https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#dashboards:name=x402-payer-agent`
- **Seller Infrastructure**: `https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#dashboards:name=x402-seller-infrastructure`

### Custom Metrics

The Lambda@Edge payment verifier emits metrics to the `X402/PaymentVerifier` namespace:

| Metric | Description |
|--------|-------------|
| `RequestCount` | Total requests processed |
| `PaymentRequired` | 402 responses sent |
| `PaymentReceived` | Payments received from clients |
| `PaymentVerified` | Payments successfully verified |
| `PaymentSettled` | Payments successfully settled |
| `PaymentFailed` | Failed payment attempts |
| `ValidationError` | Payment validation errors |
| `FacilitatorError` | Facilitator service errors |
| `Latency` | End-to-end processing time (ms) |
| `VerificationLatency` | Signature verification time (ms) |
| `SettlementLatency` | Payment settlement time (ms) |
| `ContentGenerated` | Dynamic content generated |
| `ContentCacheHit` | Content served from cache |

### Alarms

The AgentCore stack includes rate limiting alarms:
- **Throttled Requests**: Triggers when requests are being throttled
- **High Request Rate**: Triggers when approaching rate limit threshold

Subscribe to alarm notifications:
```bash
aws sns subscribe \
  --topic-arn <RateLimitAlarmTopicArn> \
  --protocol email \
  --notification-endpoint your-email@example.com
```

## OpenTelemetry Tracing

The payer agent includes OpenTelemetry instrumentation for distributed tracing, with support for AWS X-Ray integration.

### Features

- **Automatic HTTP tracing**: All outbound HTTP requests via httpx are automatically traced
- **Payment operation spans**: Custom spans for payment analysis, signing, and verification
- **AWS X-Ray integration**: Uses X-Ray ID generator and propagator for seamless AWS integration
- **Configurable export**: Support for OTLP export to collectors or console output for debugging

### Configuration

Set the following environment variables in your payer agent:

```bash
# OTLP endpoint for trace export (e.g., AWS X-Ray OTLP endpoint or local collector)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317

# Set to "true" to also export traces to console (useful for debugging)
OTEL_CONSOLE_EXPORT=false

# Environment name for trace metadata
ENVIRONMENT=development
```

### Traced Operations

The following operations are automatically traced:

| Span Name | Description |
|-----------|-------------|
| `payment.analyze` | Payment analysis and decision making |
| `payment.sign` | Wallet signature generation |
| `wallet.get_balance` | Wallet balance retrieval |
| `content.request` | Initial content request (may return 402) |
| `content.request_with_payment` | Content request with payment header |
| `agent.run` | Full agent execution |

### Span Attributes

Payment spans include these attributes:

| Attribute | Description |
|-----------|-------------|
| `payment.amount` | Payment amount |
| `payment.currency` | Payment currency (e.g., ETH) |
| `payment.network` | Blockchain network |
| `payment.recipient` | Recipient wallet address |
| `payment.decision` | approved/rejected |
| `payment.risk_level` | low/medium/high |
| `wallet.address` | Wallet address |
| `wallet.balance_eth` | Wallet balance in ETH |

### AWS X-Ray Integration

To send traces to AWS X-Ray:

1. Deploy an OTLP collector with X-Ray exporter, or use the AWS Distro for OpenTelemetry (ADOT)
2. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to your collector endpoint
3. Traces will appear in the X-Ray console with proper trace ID format

Example with ADOT collector:
```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

### Local Development

For local debugging, enable console export:
```bash
OTEL_CONSOLE_EXPORT=true
```

This will print trace spans to stdout, useful for verifying instrumentation.

## Cleanup

To remove all resources:

```bash
cdk destroy
```

**Note**: The Secrets Manager secret has a 7-day recovery window by default. To immediately delete:

```bash
aws secretsmanager delete-secret \
  --secret-id x402-payer-agent/cdp-credentials \
  --force-delete-without-recovery
```

## Security Notes

- CDP credentials are stored encrypted in Secrets Manager
- IAM roles follow least-privilege principle
- All API calls are logged to CloudWatch
- Consider enabling AWS CloudTrail for audit logging

## Cost Estimate

Estimated monthly cost (low traffic):
- Secrets Manager: ~$0.40/month
- CloudWatch Logs: ~$0.50/GB ingested
- CloudWatch Dashboard: Free (up to 3 dashboards)

Total: < $5/month for development use

## License

Apache-2.0
