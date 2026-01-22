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
│                    Payer Infrastructure                      │
│                                                             │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │  Secrets Manager │    │         IAM Roles               │ │
│  │  ┌─────────────┐ │    │  ┌───────────┐  ┌───────────┐  │ │
│  │  │ CDP Creds   │ │    │  │  Runtime  │  │  Gateway  │  │ │
│  │  └─────────────┘ │    │  │   Role    │  │   Role    │  │ │
│  └─────────────────┘    │  └───────────┘  └───────────┘  │ │
│                          └─────────────────────────────────┘ │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    CloudWatch                           │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │ │
│  │  │  Log Group  │  │  Dashboard  │  │  Alarms (opt)   │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │ │
│  └─────────────────────────────────────────────────────────┘ │
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

## Monitoring

The CloudWatch dashboard includes:
- Gateway invocation count
- Gateway latency (p50, p90, p99)
- Runtime execution time
- Error rates

Access the dashboard via the AWS Console or the URL in stack outputs.

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
