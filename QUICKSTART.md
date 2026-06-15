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
- [Coinbase Developer Platform](https://portal.cdp.coinbase.com/) API keys (for AgentCore Payments credential provider setup)

## Full Deployment

### Step 1: Clone (2 min)

```bash
git clone https://github.com/aws-samples/sample-agentcore-cloudfront-x402-payments
cd sample-agentcore-cloudfront-x402-payments
./scripts/setup.sh
```

### Step 2: Configure Credentials (5 min)

**AWS:**
```bash
aws configure
aws sts get-caller-identity
```

**Seller:**

Edit `seller-infrastructure/.env` with your wallet address:
```bash
PAYMENT_RECIPIENT_ADDRESS=<YOUR_SELLER_WALLET_ADDRESS>
```

### Step 3: Deploy Seller (10 min)

```bash
cd seller-infrastructure
npm install
npx cdk bootstrap  # first time only
npx cdk deploy
```

### Step 4: Set Up AgentCore Payments (10 min)

Deploy the payer infrastructure first — it creates the required IAM roles:

```bash
cd payer-infrastructure
npm install
npx cdk bootstrap  # first time only
npx cdk deploy --all
```

Then create the AgentCore Payments resources using boto3 (AgentCore Payments is included in the standard AWS SDK):

```python
import boto3

cp_client = boto3.client("bedrock-agentcore-control", region_name="us-west-2")
dp_client = boto3.client("bedrock-agentcore", region_name="us-west-2")

# 1. Create credential provider (stores your Coinbase CDP keys in AgentCore Identity)
provider = cp_client.create_payment_credential_provider(
    name="MyPaymentsProvider",
    credentialProviderVendor="CoinbaseCDP",
    providerConfigurationInput={"coinbaseCdpConfiguration": {
        "apiKeyId": "<CDP_API_KEY_ID>",
        "apiKeySecret": "<CDP_API_KEY_SECRET>",
        "walletSecret": "<CDP_WALLET_SECRET>",
    }},
)

# 2. Create payment manager
manager = cp_client.create_payment_manager(
    name="MyPaymentsManager",
    authorizerType="AWS_IAM",
    roleArn="<ResourceRetrievalRoleArn>",   # from CDK output
)

# 3. Create connector
connector = cp_client.create_payment_connector(
    paymentManagerId=manager["paymentManagerId"],
    name="MyPaymentsConnector",
    type="CoinbaseCDP",
    credentialProviderConfigurations=[{
        "coinbaseCDP": {"credentialProviderArn": provider["credentialProviderArn"]}
    }],
)

# 4. Create instrument (wallet) — fund it with USDC at https://faucet.circle.com/
instrument = dp_client.create_payment_instrument(
    paymentManagerArn=manager["paymentManagerArn"],
    paymentConnectorId=connector["paymentConnectorId"],
    userId="test-user-12345",
    paymentInstrumentType="CRYPTO_WALLET",
    paymentInstrumentDetails={"cryptoWallet": {"network": "ETHEREUM"}},
)

# 5. Create session with spending limit
session = dp_client.create_payment_session(
    paymentManagerArn=manager["paymentManagerArn"],
    userId="test-user-12345",
    expiryDuration=480,
    limits={"maxSpendAmount": {"value": "1.0", "currency": "USD"}},
)

print("MANAGER_ARN =", manager["paymentManagerArn"])
print("PAYMENT_INSTRUMENT_ID =", instrument["paymentInstrument"]["paymentInstrumentId"])
print("PAYMENT_SESSION_ID =", session["paymentSession"]["paymentSessionId"])
```

See the [AgentCore Payments documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html) for full details.

### Step 5: Configure Payer Agent

```bash
cd payer-agent
cp .env.example .env
```

Fill in the `.env` file:
```bash
MANAGER_ARN=<from step 4>
PAYMENT_SESSION_ID=<from step 4>
PAYMENT_INSTRUMENT_ID=<from step 4>
PROCESS_PAYMENT_ROLE_ARN=<from CDK output: ProcessPaymentRoleArn>
USER_ID=test-user-12345
SELLER_API_URL=<CloudFront URL from step 3>
```

### Step 6: Deploy Agent

```bash
cd payer-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python scripts/deploy_to_agentcore.py
```

### Step 7: Test

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

### Step 8: Web UI (Optional)

Start the backend API server and frontend in separate terminals:
```bash
# Terminal 1: Backend
cd payer-agent
source .venv/bin/activate
python -m agent.api_server

# Terminal 2: Frontend
cd web-ui
npm install
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

**ProcessPayment fails with "Budget exceeded":**
Create a new session with a higher `maxSpendAmount` using the management role.

**ProcessPayment fails with "Insufficient funds":**
Fund the wallet with USDC at https://faucet.circle.com/ (select Base Sepolia network).

**WAF / region:**
The seller's `CLOUDFRONT`-scoped WAF WebACL (and the CloudFront distribution) must be in `us-east-1`. This is hardcoded in the CDK stack — no configuration needed.

## References

- [README.md](README.md) - Full architecture
- [AgentCore Payments documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html)
- [x402 Protocol](https://github.com/coinbase/x402/tree/main/specs)
