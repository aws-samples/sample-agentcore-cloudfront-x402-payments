# x402 AWS Enterprise Demo

Enterprise-grade demonstration of HTTP 402 payment challenges using AWS infrastructure with Bedrock AgentCore and Coinbase AgentKit.

## Overview

This project demonstrates a complete payment-gated content delivery system using the [x402 protocol](https://github.com/coinbase/x402):

- **Payer Side**: AI agent using Strands Agents SDK running on AWS Bedrock AgentCore Runtime, with Coinbase AgentKit for blockchain wallet operations
- **Seller Side**: CloudFront distribution with Lambda@Edge for x402 payment verification

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                         PAYER SIDE                             │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              Bedrock AgentCore                            │ │
│  │  ┌─────────┐  ┌─────────┐  ┌────────┐  ┌──────────────┐   │ │
│  │  │ Gateway │  │ Runtime │  │ Memory │  │ Observability│   │ │
│  │  └────┬────┘  └────┬────┘  └────┬───┘  └──────────────┘   │ │
│  │       └────────────┼───────────┘                          │ │
│  │                    │                                      │ │
│  │              ┌─────▼─────┐                                │ │
│  │              │  Strands  │──────► AgentKit (Wallet)       │ │
│  │              │   Agent   │                                │ │
│  │              └───────────┘                                │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────┬──────────────────────────────────┘
                              │ HTTPS (x402)
┌─────────────────────────────▼──────────────────────────────────┐
│                         SELLER SIDE                            │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │   CloudFront    │───►│  Lambda@Edge    │                    │
│  │   Distribution  │    │ Payment Verifier│                    │
│  └─────────────────┘    └─────────────────┘                    │
└────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Agent Logic | [Strands Agents SDK](https://strandsagents.com/) (Python) | AI agent framework |
| Agent Runtime | [Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/) | Serverless agent deployment |
| Agent API | AgentCore Gateway | IAM SigV4 authentication |
| Wallet | [Coinbase AgentKit](https://docs.cdp.coinbase.com/agentkit/) | Blockchain transaction signing |
| Content Delivery | CloudFront + Lambda@Edge | Global edge payment verification |
| Payment Protocol | [x402](https://github.com/coinbase/x402) | HTTP 402 payment standard |
| Network | Base Sepolia (testnet) | EVM-compatible blockchain |

## Project Structure

```
x402-agentcore-demo/
├── payer-agent/              # AI Agent (Python)
│   ├── agent/                # Strands agent implementation
│   │   ├── tools/            # Payment & content tools
│   │   ├── auth/             # SigV4 authentication
│   │   └── gateway_client.py # AgentCore Gateway client
│   └── tests/                # Unit & integration tests
│
├── payer-infrastructure/     # AgentCore CDK Stack
│   └── lib/
│       └── agentcore-stack.ts
│
├── seller-infrastructure/    # CloudFront CDK Stack
│   ├── lib/
│   │   ├── cloudfront-stack.ts
│   │   └── lambda-edge/
│   │       ├── payment-verifier.ts  # x402 verification
│   │       ├── content-config.ts    # Dynamic content
│   │       └── types.ts             # x402 v2 types
│   └── content/              # Sample paywall content
│
└── scripts/                  # Setup & deployment scripts
```

## Prerequisites

- AWS Account with Bedrock AgentCore access
- [Coinbase Developer Platform](https://portal.cdp.coinbase.com/) API keys
- Node.js 18+ and Python 3.10+
- AWS CDK CLI

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
# Edit with your CDP API keys

# Seller infrastructure  
cp seller-infrastructure/.env.example seller-infrastructure/.env
# Edit with your payment recipient address
```

### 3. Deploy seller infrastructure

```bash
cd seller-infrastructure
npm install
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

### 5. Test the flow

```bash
# Run unit tests
pytest tests/

# Test against deployed infrastructure
SELLER_API_URL=https://your-cloudfront-url pytest -m integration
```

## Payment Flow

1. **Initial Request**: Client requests protected content (`GET /api/premium-article`)
2. **402 Response**: Lambda@Edge returns `402 Payment Required` with x402 headers
3. **Agent Analysis**: AI agent analyzes payment requirements and decides to pay
4. **Payment Signing**: AgentKit signs EIP-3009 authorization
5. **Retry with Payment**: Request retried with `X-PAYMENT-SIGNATURE` header
6. **Verification**: Lambda@Edge verifies signature via facilitator
7. **Content Delivery**: Protected content returned with settlement confirmation

## Protected Endpoints

| Endpoint | Price (USDC) | Description |
|----------|--------------|-------------|
| `/api/premium-article` | 0.001 | Premium article content |
| `/api/weather-data` | 0.0005 | Real-time weather data |
| `/api/market-analysis` | 0.002 | Crypto market analysis |
| `/api/research-report` | 0.005 | Research report (S3) |
| `/api/dataset` | 0.01 | ML dataset (S3) |
| `/api/tutorial` | 0.003 | Smart contract tutorial |

## Running Tests

```bash
cd payer-agent
source .venv/bin/activate

# All tests
pytest

# Specific test file
pytest tests/test_402_response.py -v

# Integration tests (requires deployed infrastructure)
SELLER_API_URL=https://xxx.cloudfront.net pytest -m integration
```

## References

- [x402 Protocol Specification](https://github.com/coinbase/x402/tree/main/specs)
- [Strands Agents Documentation](https://strandsagents.com/latest/documentation/docs/)
- [Bedrock AgentCore Documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/)
- [Coinbase AgentKit Documentation](https://docs.cdp.coinbase.com/agentkit/docs/welcome)
- [EIP-3009: Transfer With Authorization](https://eips.ethereum.org/EIPS/eip-3009)

## License

Apache-2.0
