# Quick Start

Get the x402 payment demo running in under 30 minutes.

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| Node.js | 18+ | `node --version` |
| Python | 3.10+ | `python3 --version` |
| AWS CLI | 2.x | `aws --version` |
| AWS CDK | 2.x | `cdk --version` |
| Docker | 20+ | `docker --version` |

Also required:
- AWS account with Bedrock AgentCore access
- [Coinbase Developer Platform](https://portal.cdp.coinbase.com/) API keys

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
CDP_API_KEY_ID=your_key_id
CDP_API_KEY_SECRET=your_key_secret
CDP_WALLET_SECRET=your_wallet_secret
NETWORK_ID=base-sepolia
```

**Seller:**

Edit `seller-infrastructure/.env` with your AWS account for CDK deployment:
```bash
AWS_ACCOUNT_ID=123456789012
AWS_REGION=us-east-1
```

Set your wallet address in `seller-infrastructure/lib/lambda-edge/content-config.ts` (Lambda@Edge cannot read environment variables at runtime, so this must be set in code):
```typescript
const DEFAULT_PAY_TO = '<YOUR_SELLER_WALLET_ADDRESS>';
```

To create a seller wallet, you can:
1. Use an existing Base Sepolia wallet address
2. Create one via [CDP Portal](https://portal.cdp.coinbase.com/) 
3. Use MetaMask or another wallet on Base Sepolia testnet

### Step 3: Deploy Seller (10 min)

```bash
cd seller-infrastructure
npx cdk bootstrap  # first time only
npx cdk deploy
```

Note the CloudFront URL from output:
```
X402SellerStack.DistributionUrl = https://dXXXXXXXXXXXXX.cloudfront.net
```

Update `payer-agent/.env` with the CloudFront URL:
```bash
SELLER_API_URL=https://dXXXXXXXXXXXXX.cloudfront.net
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

Note the `AgentRuntimeArn` from the output and set it in `payer-agent/.env`:

```bash
AGENT_RUNTIME_ARN=arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/your-runtime-id
```

> **Important**: Without `AGENT_RUNTIME_ARN`, web-ui-infrastructure has no runtime to proxy to.

### Step 6: Test

```bash
cd payer-agent
source .venv/bin/activate

# Test MCP tool discovery
python scripts/test_gateway_target.py

# Invoke agent
python scripts/invoke_gateway.py "Get me the premium article"

# Run tests
pytest tests/ -v
```

### Step 7: Web UI (Optional)

Configure `web-ui/.env.local`:
```bash
VITE_API_ENDPOINT=http://localhost:8080
VITE_AWS_REGION=us-east-1
VITE_SELLER_URL=https://your-seller-distribution.cloudfront.net
```

Start the backend API server and frontend in separate terminals:
```bash
# Terminal 1: Backend
cd payer-agent
source .venv/bin/activate
python -m agent.api_server

# Terminal 2: Frontend
cd web-ui
npm run dev
```

## MCP Tools

| Tool | Price (USDC) |
|------|--------------|
| `get_premium_article` | 0.001 |
| `get_weather_data` | 0.0005 |
| `get_market_analysis` | 0.002 |
| `get_research_report` | 0.005 |
| `get_dataset` | 0.01 |
| `get_tutorial` | 0.003 |

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
