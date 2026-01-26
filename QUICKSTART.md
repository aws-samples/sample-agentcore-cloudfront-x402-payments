# x402 AWS Enterprise Demo - Quick Start Guide

Get the x402 payment demo running in under 30 minutes.

## Prerequisites

Before you begin, ensure you have:

| Requirement | Version | Check Command |
|-------------|---------|---------------|
| Node.js | 18+ | `node --version` |
| Python | 3.10+ | `python3 --version` |
| AWS CLI | 2.x | `aws --version` |
| AWS CDK | 2.x | `cdk --version` (or install via npm) |

You'll also need:
- AWS account with Bedrock access enabled
- [Coinbase Developer Platform](https://portal.cdp.coinbase.com/) account and API keys

## Quick Demo (No AWS Required)

Want to see the UI without deploying anything? The Web UI has a demo mode:

```bash
# Clone the repository
git clone https://github.com/joshuamarksmith/x402-agentcore-demo.git
cd x402-agentcore-demo

# Run the Web UI
cd web-ui
npm install
npm run dev

# Open http://localhost:5173
```

This simulates the entire x402 payment flow with realistic delays and AI reasoning visualization.

## Full Setup

### Step 1: Clone and Setup (5 min)

```bash
# Clone the repository
git clone https://github.com/joshuamarksmith/x402-agentcore-demo.git
cd x402-agentcore-demo

# Clone required dependencies (gitignored)
git clone https://github.com/coinbase/x402.git
git clone https://github.com/coinbase/agentkit.git

# Run the setup script
./scripts/setup.sh
```

The setup script will:
- Verify prerequisites
- Create Python virtual environment
- Install all dependencies
- Build the Web UI
- Create `.env` files from examples

## Step 2: Configure Credentials (5 min)

### AWS Credentials

Ensure your AWS CLI is configured:

```bash
aws configure
# Or use SSO:
aws sso login --profile your-profile
```

Verify access:
```bash
aws sts get-caller-identity
```

### Coinbase Developer Platform (CDP) Credentials

1. Go to [CDP Portal](https://portal.cdp.coinbase.com/)
2. Create a new API key with wallet permissions
3. Edit `payer-agent/.env`:

```bash
# Required CDP credentials
CDP_API_KEY_ID=your_cdp_api_key_id
CDP_API_KEY_SECRET=your_cdp_api_key_secret
CDP_WALLET_SECRET=your_cdp_wallet_secret

# Network (testnet)
NETWORK_ID=base-sepolia
```

### Seller Configuration

Edit `seller-infrastructure/.env`:

```bash
AWS_ACCOUNT_ID=123456789012
AWS_REGION=us-east-1
PAYMENT_RECIPIENT_ADDRESS=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
```

## Step 3: Deploy Seller Infrastructure (10 min)

The seller infrastructure creates a CloudFront distribution with Lambda@Edge for payment verification.

```bash
cd seller-infrastructure

# Bootstrap CDK (first time only)
npx cdk bootstrap

# Deploy the stack
npx cdk deploy

# Note the CloudFront URL from the output:
# SellerInfrastructureStack.CloudFrontURL = https://d1234567890.cloudfront.net
```

Update `payer-agent/.env` with the CloudFront URL:
```bash
SELLER_API_URL=https://d1234567890.cloudfront.net
```

## Step 4: Test the Payer Agent Locally (5 min)

```bash
cd payer-agent

# Activate virtual environment
source .venv/bin/activate

# Run unit tests
pytest tests/ -v

# Test the agent interactively
python -m agent.main
```

Example interaction:
```
> Check my wallet balance
Agent: Your wallet balance is 0.05 ETH on Base Sepolia.

> Get the premium article at /api/premium-article
Agent: I received a 402 Payment Required response. The content costs 0.001 USDC.
       Analyzing payment... The amount is reasonable for premium content.
       Signing payment... Payment signed successfully.
       Retrying with payment... Content retrieved!
       
       [Article content here]
       
       Transaction hash: 0x123...
```

## Step 5: Run the Web UI (5 min)

The Web UI provides a visual interface for the x402 payment flow:

```bash
cd web-ui
npm run dev

# Open http://localhost:5173
```

Features:
- **Demo Mode** (default): Simulates the entire flow without backend
- **Live Mode**: Connects to deployed AgentCore Gateway

To enable live mode, configure `web-ui/.env`:
```bash
VITE_GATEWAY_ENDPOINT=https://your-gateway-url
VITE_AWS_REGION=us-west-2
VITE_AGENT_ID=your-agent-id
```

## Step 6: Deploy Payer Infrastructure (Optional)

For production deployment to AgentCore:

```bash
cd payer-infrastructure

# Bootstrap CDK (first time only)
npx cdk bootstrap

# Deploy
npx cdk deploy
```

Then deploy the agent to AgentCore Runtime:
```bash
cd payer-agent
python scripts/deploy_to_agentcore.py
```

## Quick Test Commands

```bash
# Run all tests
cd payer-agent && source .venv/bin/activate && pytest

# Test specific scenarios
pytest tests/test_402_response.py -v      # 402 handling
pytest tests/test_payment_analysis.py -v  # Payment decisions
pytest tests/test_payment_signing.py -v   # Wallet signing

# Test against deployed seller (requires SELLER_API_URL)
pytest -m integration
```

## Protected Endpoints

Once deployed, these endpoints require payment:

| Endpoint | Price | Description |
|----------|-------|-------------|
| `/api/premium-article` | 0.001 USDC | Premium article |
| `/api/weather-data` | 0.0005 USDC | Weather data |
| `/api/market-analysis` | 0.002 USDC | Market analysis |
| `/api/research-report` | 0.005 USDC | Research report |
| `/api/dataset` | 0.01 USDC | ML dataset |
| `/api/tutorial` | 0.003 USDC | Tutorial |

## Troubleshooting

### "No module named 'strands_agents'"
```bash
cd payer-agent
source .venv/bin/activate
pip install -e ".[dev]"
```

### "AWS credentials not found"
```bash
aws configure
# Or for SSO:
aws sso login
```

### "CDK bootstrap required"
```bash
cd seller-infrastructure  # or payer-infrastructure
npx cdk bootstrap aws://ACCOUNT_ID/REGION
```

### "402 Payment Required but no wallet balance"
Request testnet tokens:
```bash
cd payer-agent
source .venv/bin/activate
python -c "from agent.tools.payment import request_faucet_funds; print(request_faucet_funds())"
```

### Lambda@Edge deployment fails
Lambda@Edge must be deployed to `us-east-1`. Ensure your seller-infrastructure `.env` has:
```bash
AWS_REGION=us-east-1
CDK_DEFAULT_REGION=us-east-1
```

## Next Steps

- Read the full [README.md](README.md) for detailed architecture
- Check [payer-agent/README.md](payer-agent/README.md) for agent details
- Review [x402 Protocol Specs](https://github.com/coinbase/x402/tree/main/specs)

## Support

- [x402 GitHub Issues](https://github.com/coinbase/x402/issues)
- [AgentKit Documentation](https://docs.cdp.coinbase.com/agentkit/)
- [Strands Agents Docs](https://strandsagents.com/)
- [Bedrock AgentCore Docs](https://docs.aws.amazon.com/bedrock-agentcore/)
