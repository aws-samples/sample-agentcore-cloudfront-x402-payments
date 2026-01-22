# x402 Payer Agent

AI agent for x402 payment decisions using Strands Agents SDK and Bedrock AgentCore.

## Overview

This agent can:
- Request content from seller APIs
- Analyze payment requirements (HTTP 402 responses)
- Decide whether to approve payments using AI reasoning
- Sign blockchain transactions via Coinbase AgentKit
- Retry requests with signed payments

## Technology

- **Agent Framework**: Strands Agents SDK (Python)
- **LLM**: Amazon Bedrock (Claude 3 Sonnet)
- **Wallet**: Coinbase AgentKit (CDP)
- **Runtime**: Bedrock AgentCore (for production deployment)

## Setup

1. Install dependencies:
```bash
pip install -e ".[dev]"
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your credentials
```

3. Run locally:
```bash
python -m agent.main
```

## Project Structure

```
payer-agent/
├── agent/
│   ├── __init__.py
│   ├── main.py           # Agent definition
│   ├── config.py         # Configuration
│   └── tools/
│       ├── __init__.py
│       ├── payment.py    # Payment tools
│       └── content.py    # Content request tools
├── tests/
├── pyproject.toml
└── README.md
```

## Tools

### Payment Tools
- `analyze_payment` - Analyze payment requirements and decide to pay
- `sign_payment` - Sign a payment using AgentKit wallet
- `get_wallet_balance` - Check current wallet balance

### Content Tools
- `request_content` - Request content (may return 402)
- `request_content_with_payment` - Request with signed payment

## Example Usage

```python
from agent import create_payer_agent

agent = create_payer_agent()
response = await agent.run("Get me the premium article at /api/premium-article")
print(response)
```

## AgentCore Deployment

### Prerequisites

1. AWS CLI configured with appropriate permissions
2. CDK CLI installed (`npm install -g aws-cdk`)
3. CDP (Coinbase Developer Platform) API credentials

### Deployment Steps

#### 1. Deploy CDK Infrastructure

First, deploy the supporting infrastructure (IAM roles, secrets):

```bash
cd ../payer-infrastructure
npm install
cdk deploy
```

This creates:
- IAM role for AgentCore Runtime
- Secrets Manager secret for CDP credentials
- IAM role for AgentCore Gateway
- CloudWatch Log Group for Gateway logs
- CloudWatch Dashboard for monitoring
- IAM policy for Gateway invocation

#### 2. Configure CDP Credentials

Update the CDP credentials in Secrets Manager:

```bash
aws secretsmanager put-secret-value \
  --secret-id x402-payer-agent/cdp-credentials \
  --secret-string '{"CDP_API_KEY_NAME":"your-key","CDP_API_KEY_PRIVATE_KEY":"your-private-key"}'
```

#### 3. Package and Deploy Agent

Run the deployment script:

```bash
# Full deployment (includes CDK)
./scripts/deploy.sh

# Skip CDK if already deployed
./scripts/deploy.sh --skip-cdk

# Dry run to see what would happen
./scripts/deploy.sh --dry-run
```

The script will:
- Validate prerequisites
- Deploy CDK infrastructure (if not skipped)
- Package the agent code into a deployment zip
- Provide instructions for AgentCore Runtime deployment

#### 4. Deploy to AgentCore Runtime

Since AgentCore CDK L2 constructs are in preview, complete the deployment via:

**Option A: AWS Console**
1. Go to Amazon Bedrock > AgentCore > Runtimes
2. Click "Create Runtime"
3. Upload `dist/x402-payer-agent.zip`
4. Configure with settings from `agentcore_config.yaml`

**Option B: Strands CLI (when available)**
```bash
strands deploy --config agentcore_config.yaml
```

#### 5. Configure AgentCore Gateway

After deploying the Runtime, configure the Gateway for API access:

**Option A: AWS Console**
1. Go to Amazon Bedrock > AgentCore > Gateways
2. Click "Create Gateway"
3. Configure with settings from `gateway_config.yaml`
4. Note the Gateway endpoint URL

**Option B: Use the gateway_config.yaml**
The `gateway_config.yaml` file contains the complete Gateway configuration including:
- IAM SigV4 authentication
- Rate limiting (10 req/s per client)
- CORS configuration for web clients
- CloudWatch logging and monitoring

#### 6. Test Gateway Access

Use the provided script to test Gateway invocation:

```bash
# Single message
python scripts/invoke_gateway.py \
  --agent-id <AGENT_ID> \
  --message "Check my wallet balance"

# Interactive session
python scripts/invoke_gateway.py \
  --agent-id <AGENT_ID> \
  --interactive

# With trace output for debugging
python scripts/invoke_gateway.py \
  --agent-id <AGENT_ID> \
  --message "Get the premium article" \
  --trace
```

### Testing

#### Local Testing

```bash
# Single message
python scripts/test_agent_invocation.py --local --message "Check my wallet balance"

# Run test scenarios
python scripts/test_agent_invocation.py --local --run-scenarios
```

#### AgentCore Runtime Testing

```bash
# Test via AgentCore Runtime (when deployed)
python scripts/test_agent_invocation.py --runtime-arn <RUNTIME_ARN>
```

### Configuration

The agent configuration is defined in two files:

**agentcore_config.yaml** - Runtime configuration:
```yaml
runtime:
  name: x402-payer-agent-runtime
  handler: agent.main.create_payer_agent
  memory_size_mb: 1024
  timeout_seconds: 300
  environment:
    BEDROCK_MODEL_ID: "anthropic.claude-3-sonnet-20240229-v1:0"
    NETWORK_ID: "base-sepolia"
```

**gateway_config.yaml** - Gateway configuration:
```yaml
gateway:
  name: x402-payer-agent-gateway
  authentication:
    type: IAM_SIGV4
  rate_limiting:
    enabled: true
    requests_per_second: 10
    burst_capacity: 20
  cors:
    enabled: true
    allowed_origins:
      - "http://localhost:3000"
```

### Deployment Artifacts

After running the deployment script:

```
dist/
├── x402-payer-agent.zip      # Deployment package
└── deployment_info.json      # Deployment configuration
```

## License

Apache-2.0
