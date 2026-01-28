# Quick Start

Get the x402 payment demo running in under 30 minutes.

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| Node.js | 18+ | `node --version` |
| Python | 3.10+ | `python3 --version` |
| AWS CLI | 2.x | `aws --version` |
| AWS CDK | 2.x | `cdk --version` |

Also required:
- AWS account with Bedrock AgentCore access
- [Coinbase Developer Platform](https://portal.cdp.coinbase.com/) API keys

## Demo Mode (No AWS)

Run the Web UI in demo mode without deploying anything:

```bash
git clone https://github.com/joshuamarksmith/x402-agentcore-demo.git
cd x402-agentcore-demo/web-ui
npm install
npm run dev
# Open http://localhost:5173
```

## Full Deployment

### Step 1: Clone (2 min)

```bash
git clone https://github.com/joshuamarksmith/x402-agentcore-demo.git
cd x402-agentcore-demo

git clone https://github.com/coinbase/x402.git
git clone https://github.com/coinbase/agentkit.git

./scripts/setup.sh
```

### Step 2: Configure Credentials (5 min)

**AWS:**
```bash
aws configure
aws sts get-caller-identity
```

**CDP (Coinbase):**

Get API keys from [CDP Portal](https://portal.cdp.coinbase.com/), then edit `payer-agent/.env`:

```bash
CDP_API_KEY_NAME=your_key_name
CDP_API_KEY_PRIVATE_KEY=your_private_key
CDP_WALLET_SECRET=your_wallet_secret
NETWORK_ID=base-sepolia
```

**Seller:**

Edit `seller-infrastructure/.env`:
```bash
AWS_ACCOUNT_ID=123456789012
AWS_REGION=us-east-1
PAYMENT_RECIPIENT_ADDRESS=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
```

### Step 3: Deploy Seller (10 min)

```bash
cd seller-infrastructure
npx cdk bootstrap  # first time only
npx cdk deploy
```

Note the CloudFront URL from output:
```
X402SellerStack.X402DistributionUrl = https://dXXXXXXXXXXXXX.cloudfront.net
```

### Step 4: Deploy Payer (10 min)

```bash
cd payer-infrastructure
export X402_SELLER_CLOUDFRONT_URL=https://dXXXXXXXXXXXXX.cloudfront.net
npx cdk bootstrap  # first time only
npx cdk deploy
```

### Step 5: Deploy Agent

```bash
cd payer-agent
source .venv/bin/activate
python scripts/deploy_to_agentcore.py
```

### Step 6: Test

```bash
cd payer-agent
source .venv/bin/activate

# Test MCP tool discovery
python scripts/test_gateway_api.py

# Invoke agent
python scripts/invoke_gateway.py "Get me the premium article"

# Run tests
pytest tests/ -v
```

### Step 7: Web UI (Optional)

```bash
cd web-ui
npm run dev
```

For live mode, configure `web-ui/.env`:
```bash
VITE_GATEWAY_ENDPOINT=https://your-gateway-url
VITE_AWS_REGION=us-west-2
VITE_AGENT_ID=your-agent-id
```

## MCP Tools

| Tool | Price (USDC) |
|------|--------------|
| `get_premium_article` | 0.001 |
| `get_weather_data` | 0.0005 |
| `get_market_analysis` | 0.002 |
| `get_research_report` | 0.005 |

## Troubleshooting

**Module not found:**
```bash
cd payer-agent && source .venv/bin/activate && pip install -e ".[dev]"
```

**AWS credentials:**
```bash
aws configure
```

**CDK bootstrap:**
```bash
npx cdk bootstrap aws://ACCOUNT_ID/REGION
```

**No wallet balance:**
```bash
python -c "from agent.tools.payment import request_faucet_funds; print(request_faucet_funds())"
```

**Lambda@Edge region:**
Lambda@Edge requires `us-east-1`. Set in `seller-infrastructure/.env`:
```bash
AWS_REGION=us-east-1
```

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for more.

## References

- [README.md](README.md) - Full architecture
- [docs/API.md](docs/API.md) - API reference
- [x402 Protocol](https://github.com/coinbase/x402/tree/main/specs)
