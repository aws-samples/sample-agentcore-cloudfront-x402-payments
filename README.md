# x402 AWS Enterprise Demo

Enterprise-grade demonstration of HTTP 402 payment challenges using AWS infrastructure with Bedrock AgentCore and Coinbase AgentKit.

## Overview

This project demonstrates a complete payment-gated content delivery system using the [x402 protocol](https://github.com/coinbase/x402):

- **Payer Side**: AI agent using Strands Agents SDK running on AWS Bedrock AgentCore Runtime, with Coinbase AgentKit for blockchain wallet operations
- **Seller Side**: CloudFront distribution with Lambda@Edge for x402 v2 payment verification
- **Web UI**: React-based demo interface with real-time status updates

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              PAYER SIDE                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Bedrock AgentCore                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐   │   │
│  │  │   Gateway   │  │   Runtime   │  │   Memory    │  │ Identity  │   │   │
│  │  │  (IAM Auth) │  │  (Agent)    │  │  (Context)  │  │  (Auth)   │   │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘   │   │
│  │         │                │                │               │         │   │
│  │         └────────────────┼────────────────┼───────────────┘         │   │
│  │                          │                │                         │   │
│  │                    ┌─────▼─────┐    ┌─────▼─────┐                   │   │
│  │                    │  Strands  │    │ AgentKit  │                   │   │
│  │                    │  Agent    │◄──►│  Wallet   │                   │   │
│  │                    │ (Python)  │    │  (CDP)    │                   │   │
│  │                    └───────────┘    └───────────┘                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                       │
│                                    │ HTTPS (x402 v2)                       │
│                                    ▼                                       │
└────────────────────────────────────┼───────────────────────────────────────┘
                                     │
┌────────────────────────────────────┼───────────────────────────────────────┐
│                              SELLER SIDE                                   │
│                                    │                                       │
│                          ┌─────────▼─────────┐                             │
│                          │    CloudFront     │                             │
│                          │   Distribution    │                             │
│                          └─────────┬─────────┘                             │
│                                    │                                       │
│                          ┌─────────▼─────────┐     ┌──────────────────┐    │
│                          │   Lambda@Edge     │────►│   x402           │    │
│                          │ Payment Verifier  │     │   Facilitator    │    │
│                          └─────────┬─────────┘     └──────────────────┘    │
│                                    │                                       │
│                    ┌───────────────┼───────────────┐                       │
│                    │               │               │                       │
│              ┌─────▼─────┐  ┌──────▼──────┐  ┌────▼────┐                   │
│              │  Return   │  │   Verify    │  │  Serve  │                   │
│              │   402     │  │   Payment   │  │ Content │                   │
│              └───────────┘  └─────────────┘  └─────────┘                   │
└────────────────────────────────────────────────────────────────────────────┘
```

## Payment Flow

1. Client requests content from the agent
2. Agent makes initial request to seller API
3. Lambda@Edge returns `402 Payment Required` with x402 headers
4. Agent analyzes payment requirements using Bedrock LLM
5. Agent signs payment using AgentKit wallet (EIP-3009)
6. Agent retries request with `X-PAYMENT-SIGNATURE` header
7. Lambda@Edge verifies signature via x402 facilitator
8. Facilitator settles payment on-chain
9. Content is returned with transaction hash

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Agent Logic | [Strands Agents SDK](https://strandsagents.com/) (Python) | AI agent framework with tool calling |
| Agent Runtime | [Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/) | Serverless agent deployment |
| Agent API | Amazon Bedrock AgentCore Gateway | IAM SigV4 authentication |
| LLM | Amazon Bedrock (Claude Sonnet) | Payment decision reasoning |
| Wallet | [Coinbase AgentKit](https://docs.cdp.coinbase.com/agentkit/) | Blockchain transaction signing |
| Content Delivery | CloudFront + Lambda@Edge | Global edge payment verification |
| Payment Protocol | [x402](https://github.com/coinbase/x402) | HTTP 402 payment standard |
| Network | Base Sepolia (testnet) | EVM-compatible blockchain |
| Web UI | React + Vite + TypeScript | Demo interface |
| Observability | CloudWatch + OpenTelemetry | Metrics, tracing, and logging |

## Project Structure

```
x402-agentcore-demo/
├── payer-agent/                  # AI Agent (Python)
│   ├── agent/                    # Strands agent implementation
│   │   ├── main.py               # Agent definition & system prompt
│   │   ├── config.py             # Configuration management
│   │   ├── tools/                # Agent tools
│   │   │   ├── payment.py        # Payment analysis & signing
│   │   │   └── content.py        # Content request handling
│   │   ├── auth/                 # Authentication
│   │   │   └── sigv4.py          # AWS SigV4 signing
│   │   ├── gateway_client.py     # AgentCore Gateway client
│   │   ├── tracing.py            # OpenTelemetry integration
│   │   ├── metrics.py            # CloudWatch metrics
│   │   └── rate_limiter.py       # Request rate limiting
│   ├── scripts/                  # Deployment & testing scripts
│   │   ├── deploy_to_agentcore.py
│   │   ├── invoke_gateway.py
│   │   └── test_gateway_api.py
│   ├── tests/                    # Comprehensive test suite
│   ├── agentcore_config.yaml     # AgentCore Runtime config
│   ├── gateway_config.yaml       # AgentCore Gateway config
│   └── pyproject.toml
│
├── payer-infrastructure/         # AgentCore CDK Stack
│   └── lib/
│       ├── agentcore-stack.ts    # Runtime & Gateway resources
│       └── observability-stack.ts # CloudWatch dashboards
│
├── seller-infrastructure/        # CloudFront CDK Stack
│   ├── lib/
│   │   ├── cloudfront-stack.ts   # Distribution & Lambda@Edge
│   │   └── lambda-edge/
│   │       ├── payment-verifier.ts   # x402 v2 verification
│   │       ├── content-config.ts     # Dynamic content & pricing
│   │       └── types.ts              # x402 v2 type definitions
│   ├── content/                  # Sample paywall content
│   │   ├── dataset.json
│   │   ├── research-report.json
│   │   └── tutorial.json
│   └── scripts/
│       └── upload-content.sh
│
├── web-ui/                       # React Demo Interface
│   ├── src/
│   │   ├── api/                  # Gateway API client
│   │   │   ├── gateway-client.ts # AgentCore Gateway integration
│   │   │   ├── auth.ts           # Authentication (Cognito/SigV4)
│   │   │   └── crypto-utils.ts   # Cryptographic utilities
│   │   ├── components/           # React components
│   │   │   ├── ContentRequest*.tsx   # Content request flow
│   │   │   ├── WalletDisplay.tsx     # Wallet info display
│   │   │   ├── AgentReasoning.tsx    # AI reasoning visualization
│   │   │   ├── RealTimeStatus.tsx    # Live event stream
│   │   │   ├── TransactionConfirmation.tsx
│   │   │   └── AuthStatus.tsx
│   │   └── hooks/                # React hooks
│   │       └── useGatewayClient.ts
│   ├── package.json
│   └── vite.config.ts
│
├── docs/                         # Documentation
│   ├── AGENTCORE.md              # AgentCore setup guide
│   ├── API.md                    # API reference
│   └── TROUBLESHOOTING.md        # Common issues & solutions
│
├── scripts/                      # Setup & deployment scripts
│   ├── setup.sh                  # Full setup script
│   ├── setup-payer-agent.sh      # Agent setup only
│   ├── setup-infrastructure.sh   # Infrastructure setup only
│   └── verify-setup.sh           # Verify installation
│
├── x402/                         # x402 protocol (cloned)
├── agentkit/                     # Coinbase AgentKit (cloned)
├── QUICKSTART.md                 # Quick start guide
└── README.md
```

> **Note**: This project requires cloning [coinbase/x402](https://github.com/coinbase/x402) and [coinbase/agentkit](https://github.com/coinbase/agentkit) as local dependencies (see Quick Start). These are not included in this repo.

## Agent Tools

The payer agent has the following capabilities:

| Tool | Description |
|------|-------------|
| `get_wallet_balance` | Check current wallet balance (ETH) |
| `analyze_payment` | Analyze payment requirements and decide whether to pay |
| `sign_payment` | Sign a payment using AgentKit wallet (EIP-3009) |
| `request_content` | Request content from seller API |
| `request_content_with_payment` | Retry request with signed payment |
| `request_faucet_funds` | Request testnet tokens from CDP faucet |
| `check_faucet_eligibility` | Check if wallet is eligible for faucet |

## Protected Endpoints

| Endpoint | Price (USDC) | Description |
|----------|--------------|-------------|
| `/api/premium-article` | 0.001 | Premium article content |
| `/api/weather-data` | 0.0005 | Real-time weather data |
| `/api/market-analysis` | 0.002 | Crypto market analysis |
| `/api/research-report` | 0.005 | Research report (S3) |
| `/api/dataset` | 0.01 | ML dataset (S3) |
| `/api/tutorial` | 0.003 | Smart contract tutorial |

## Prerequisites

- AWS Account with Bedrock AgentCore access
- [Coinbase Developer Platform](https://portal.cdp.coinbase.com/) API keys
- Node.js 18+ and Python 3.10+
- AWS CDK CLI (`npm install -g aws-cdk`)

## Quick Start

### 1. Clone and setup

```bash
git clone https://github.com/joshuamarksmith/x402-agentcore-demo.git
cd x402-agentcore-demo

# Clone required dependencies
git clone https://github.com/coinbase/x402.git
git clone https://github.com/coinbase/agentkit.git
```

### 2. Configure environment

```bash
# Payer agent
cp payer-agent/.env.example payer-agent/.env
# Edit with your CDP API keys:
# - CDP_API_KEY_NAME
# - CDP_API_KEY_PRIVATE_KEY
# - CDP_WALLET_SECRET

# Seller infrastructure  
cp seller-infrastructure/.env.example seller-infrastructure/.env
# Edit with your payment recipient address:
# - PAYMENT_RECIPIENT_ADDRESS

# Web UI (optional)
cp web-ui/.env.example web-ui/.env
# Edit with your Gateway endpoint:
# - VITE_GATEWAY_ENDPOINT
# - VITE_AWS_REGION
# - VITE_AGENT_ID
```

### 3. Deploy seller infrastructure

```bash
cd seller-infrastructure
npm install
npx cdk bootstrap  # First time only
npx cdk deploy
```

### 4. Deploy payer agent

```bash
cd payer-agent
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Deploy to AgentCore (requires AWS credentials)
python scripts/deploy_to_agentcore.py
```

### 5. Run the Web UI (optional)

```bash
cd web-ui
npm install
npm run dev
```

The UI will be available at `http://localhost:5173`.

### 6. Test the flow

```bash
# Run unit tests
cd payer-agent
pytest

# Test against deployed infrastructure
SELLER_API_URL=https://your-cloudfront-url pytest -m integration

# Invoke agent via Gateway
python scripts/invoke_gateway.py "Get me the premium article"
```

## Web UI Features

The demo web interface provides:

- **Wallet Display**: Shows connected wallet address and balance
- **Content Selection**: Browse and select premium content items
- **Payment Flow Visualization**: Step-by-step progress through the x402 flow
- **Agent Reasoning**: Real-time display of AI agent's decision process
- **Real-Time Status**: Live event stream with timestamps and durations
- **Transaction Confirmation**: Detailed transaction information with block explorer links

The UI supports both demo mode (simulated flow) and live mode (real AgentCore Gateway integration).

## Running Tests

```bash
cd payer-agent
source .venv/bin/activate

# All tests
pytest

# Specific test categories
pytest tests/test_402_response.py -v      # 402 response handling
pytest tests/test_payment_analysis.py -v  # Payment decision logic
pytest tests/test_payment_signing.py -v   # Wallet signing
pytest tests/test_content_delivery.py -v  # Content retrieval
pytest tests/test_error_scenarios.py -v   # Error handling

# Integration tests (requires deployed infrastructure)
SELLER_API_URL=https://xxx.cloudfront.net pytest -m integration
```

## Observability

The system includes comprehensive observability:

- **CloudWatch Dashboards**: Payment metrics, latency, error rates
- **OpenTelemetry Tracing**: End-to-end request tracing
- **Structured Logging**: JSON logs with request correlation
- **EMF Metrics**: Lambda@Edge metrics in CloudWatch

Key metrics tracked:
- Payment verification latency
- Settlement success/failure rates
- Agent decision timing
- Token usage per request

## Security

- **Agent Invocation**: IAM SigV4 via AgentCore Gateway
- **Wallet Keys**: AWS Secrets Manager
- **Payment Verification**: Cryptographic signature validation via x402 facilitator
- **Session Isolation**: AgentCore Runtime feature
- **CORS**: Properly configured for API access

## References

- [x402 Protocol Specification v2](https://github.com/coinbase/x402/tree/main/specs)
- [Strands Agents Documentation](https://strandsagents.com/latest/documentation/docs/)
- [Bedrock AgentCore Documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/)
- [Coinbase AgentKit Documentation](https://docs.cdp.coinbase.com/agentkit/docs/welcome)
- [EIP-3009: Transfer With Authorization](https://eips.ethereum.org/EIPS/eip-3009)

## License

MIT-0
