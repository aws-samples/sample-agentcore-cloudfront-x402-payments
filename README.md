# x402 AWS Enterprise Demo

HTTP 402 payment-gated content delivery using AWS Bedrock AgentCore and Coinbase AgentKit.

## Overview

This project demonstrates a payment-gated content delivery system using the [x402 protocol](https://github.com/coinbase/x402):

- **Payer**: AI agent on Bedrock AgentCore Runtime with Coinbase AgentKit wallet
- **Seller**: CloudFront + Lambda@Edge for x402 payment verification
- **Web UI**: React demo interface

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PAYER SIDE                                     │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    Bedrock AgentCore                                  │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │                    Gateway (MCP Tool Server)                    │  │  │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │  │  │
│  │  │  │  IAM Auth   │  │ MCP Protocol│  │   OpenAPI Targets       │  │  │  │
│  │  │  │  (SigV4)    │  │  Discovery  │  │   (Content Tools)       │  │  │  │
│  │  │  └─────────────┘  └──────┬──────┘  └────────────┬────────────┘  │  │  │
│  │  └──────────────────────────┼──────────────────────┼───────────────┘  │  │
│  │                             │                      │                  │  │
│  │  ┌─────────────┐  ┌─────────▼─────────┐   ┌────────▼────────┐         │  │
│  │  │   Runtime   │  │   Strands Agent   │   │    AgentKit     │         │  │
│  │  │  (Session)  │  │   (Python)        │   │    Wallet       │         │  │
│  │  │             │  │                   │   │    (CDP)        │         │  │
│  │  │             │  │  ┌─────────────┐  │   │                 │         │  │
│  │  │             │  │  │ MCP Client  │◄─┼───┤  Payment Sign   │         │  │
│  │  │             │  │  │ (Discovery) │  │   │  (EIP-3009)     │         │  │
│  │  │             │  │  └─────────────┘  │   │                 │         │  │
│  │  └─────────────┘  └───────────────────┘   └─────────────────┘         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    │ HTTPS (x402 v2)                        │
│                                    ▼                                        │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────────┐
│                              SELLER SIDE                                    │
│                                    │                                        │
│                          ┌─────────▼─────────┐                              │
│                          │    CloudFront     │                              │
│                          │   Distribution    │                              │
│                          └─────────┬─────────┘                              │
│                                    │                                        │
│                          ┌─────────▼─────────┐     ┌──────────────────┐     │
│                          │   Lambda@Edge     │────►│   x402           │     │
│                          │ Payment Verifier  │     │   Facilitator    │     │
│                          └─────────┬─────────┘     └──────────────────┘     │
│                                    │                                        │
│                    ┌───────────────┼───────────────┐                        │
│                    │               │               │                        │
│              ┌─────▼─────┐  ┌──────▼──────┐   ┌────▼────┐                   │
│              │  Return   │  │   Verify    │   │  Serve  │                   │
│              │   402     │  │   Payment   │   │ Content │                   │
│              └───────────┘  └─────────────┘   └─────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

AgentCore Gateway acts as an MCP tool server:
- Content endpoints exposed as discoverable MCP tools via OpenAPI spec
- Agent discovers tools at runtime via MCP protocol
- x402 payment headers pass through to CloudFront
- Agent handles 402 responses and payment signing

## Payment Flow

1. Client sends request to agent
2. Agent discovers content tools via MCP from Gateway
3. Agent invokes tool (routed to CloudFront)
4. Lambda@Edge returns `402 Payment Required` with x402 headers
5. Agent analyzes payment requirements
6. Agent signs payment with AgentKit wallet (EIP-3009)
7. Agent retries with `X-PAYMENT-SIGNATURE` header
8. Lambda@Edge verifies signature via x402 facilitator
9. Facilitator settles payment on-chain
10. Content returned with transaction hash

## Stack

| Component | Technology |
|-----------|------------|
| Agent Framework | [Strands Agents SDK](https://strandsagents.com/) (Python) |
| Agent Runtime | [Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/) |
| Tool Discovery | MCP Protocol via Gateway |
| LLM | Amazon Bedrock (Claude Sonnet) |
| Wallet | [Coinbase AgentKit](https://docs.cdp.coinbase.com/agentkit/) |
| Content Delivery | CloudFront + Lambda@Edge |
| Payment Protocol | [x402](https://github.com/coinbase/x402) |
| Network | Base Sepolia (testnet) |
| Web UI | React + Vite + TypeScript |

## Project Structure

```
x402-agentcore-demo/
├── payer-agent/              # AI Agent (Python)
│   ├── agent/                # Strands agent implementation
│   ├── openapi/              # OpenAPI specs for Gateway targets
│   ├── scripts/              # Deployment & test scripts
│   ├── tests/                # Test suite
│   ├── agentcore_config.yaml
│   └── gateway_config.yaml
│
├── payer-infrastructure/     # AgentCore CDK Stack
│   └── lib/
│       ├── agentcore-stack.ts
│       └── observability-stack.ts
│
├── seller-infrastructure/    # CloudFront CDK Stack
│   ├── lib/
│   │   ├── cloudfront-stack.ts
│   │   └── lambda-edge/
│   │       └── payment-verifier.ts
│   └── content/              # Sample content
│
├── web-ui/                   # React Demo Interface
│   └── src/
│       ├── api/
│       ├── components/
│       └── hooks/
│
├── docs/                     # Documentation
│   ├── AGENTCORE.md
│   ├── API.md
│   └── TROUBLESHOOTING.md
│
├── x402/                     # x402 protocol (cloned)
└── agentkit/                 # Coinbase AgentKit (cloned)
```

## Agent Tools

Built-in tools:

| Tool | Description |
|------|-------------|
| `get_wallet_balance` | Check wallet balance |
| `analyze_payment` | Analyze payment requirements |
| `sign_payment` | Sign payment (EIP-3009) |
| `request_faucet_funds` | Request testnet tokens |

MCP tools (discovered via Gateway):

| Tool | Price (USDC) |
|------|--------------|
| `get_premium_article` | 0.001 |
| `get_weather_data` | 0.0005 |
| `get_market_analysis` | 0.002 |
| `get_research_report` | 0.005 |

## Prerequisites

- AWS Account with Bedrock AgentCore access
- [Coinbase Developer Platform](https://portal.cdp.coinbase.com/) API keys
- Node.js 18+, Python 3.10+
- AWS CDK CLI

## Quick Start

### 1. Clone and setup

```bash
git clone https://github.com/joshuamarksmith/x402-agentcore-demo.git
cd x402-agentcore-demo

# Clone dependencies
git clone https://github.com/coinbase/x402.git
git clone https://github.com/coinbase/agentkit.git
```

### 2. Configure environment

```bash
# Payer agent
cp payer-agent/.env.example payer-agent/.env
# Set CDP_API_KEY_NAME, CDP_API_KEY_PRIVATE_KEY, CDP_WALLET_SECRET

# Seller infrastructure  
cp seller-infrastructure/.env.example seller-infrastructure/.env
# Set PAYMENT_RECIPIENT_ADDRESS

# Web UI
cp web-ui/.env.example web-ui/.env
# Set VITE_GATEWAY_ENDPOINT, VITE_AWS_REGION, VITE_AGENT_ID
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
python scripts/deploy_to_agentcore.py
```

### 5. Run Web UI

```bash
cd web-ui
npm install
npm run dev
```

### 6. Test

```bash
cd payer-agent
pytest

# Integration tests
SELLER_API_URL=https://your-cloudfront-url pytest -m integration

# Invoke agent
python scripts/invoke_gateway.py "Get me the premium article"
```

## Web UI

Features:
- Wallet display with balance
- Content selection
- Payment flow visualization
- Agent reasoning display
- Real-time event stream
- Transaction confirmation with block explorer links

Supports demo mode (simulated) and live mode (real Gateway).

## Tests

```bash
cd payer-agent
source .venv/bin/activate

pytest                                    # All tests
pytest tests/test_402_response.py -v      # 402 handling
pytest tests/test_payment_analysis.py -v  # Payment decisions
pytest tests/test_payment_signing.py -v   # Wallet signing
pytest tests/test_content_delivery.py -v  # Content retrieval
pytest tests/test_error_scenarios.py -v   # Error handling
```

## Observability

- CloudWatch Dashboards
- OpenTelemetry tracing
- Structured JSON logging
- EMF metrics from Lambda@Edge

## Security

- IAM SigV4 authentication via AgentCore Gateway
- Wallet keys in AWS Secrets Manager
- Cryptographic signature validation via x402 facilitator
- Session isolation in AgentCore Runtime

## References

- [x402 Protocol Specification](https://github.com/coinbase/x402/tree/main/specs)
- [Strands Agents Documentation](https://strandsagents.com/latest/documentation/docs/)
- [Bedrock AgentCore Documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/)
- [Coinbase AgentKit Documentation](https://docs.cdp.coinbase.com/agentkit/docs/welcome)
- [EIP-3009: Transfer With Authorization](https://eips.ethereum.org/EIPS/eip-3009)

## License

MIT-0
