# x402 Payer Agent

AI agent for x402 payment decisions using Strands Agents SDK, Bedrock AgentCore, and AgentCore Payments.

## Overview

- Request content from seller APIs
- Detect HTTP 402 payment requirements (x402 v1 and v2)
- Execute payments via AgentCore Payments ProcessPayment API
- Retry requests with payment proof headers (exponential backoff)

## Stack

- **Agent Framework**: Strands Agents SDK (Python)
- **LLM**: Amazon Bedrock (Claude Sonnet)
- **Payments**: Amazon Bedrock AgentCore Payments (ProcessPayment API)
- **Runtime**: Bedrock AgentCore
- **Oracle**: [headless-oracle-strands](https://pypi.org/project/headless-oracle-strands/) — pre-trade market state verification

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────────┐
│   Web UI    │────▶│   API Server    │────▶│  AgentCore Runtime   │
│  (React)    │     │   (FastAPI)     │     │  invoke_agent_runtime│
└─────────────┘     └─────────────────┘     └──────────────────────┘
                           │                          │
                           │ SigV4                    │
                           ▼                          ▼
                    ┌─────────────────┐     ┌──────────────────────┐
                    │  bedrock-       │     │   Strands Agent      │
                    │  agentcore      │     │   + ProcessPayment   │
                    └─────────────────┘     └──────────────────────┘
                                                      │
                                                      ▼
                                            ┌──────────────────────┐
                                            │  AgentCore Payments  │
                                            │  (server-side sign)  │
                                            └──────────────────────┘
```

## Setup

```bash
pip install -e ".[dev]"
cp .env.example .env
# Edit .env with AgentCore Payments config (see .env.example)
```

Run API server:
```bash
uvicorn agent.api_server:app --host 0.0.0.0 --port 8080
```

Run locally:
```bash
python -m agent.main
```

## Structure

```
payer-agent/
├── agent/
│   ├── main.py           # Agent definition + system prompt
│   ├── config.py         # Configuration (AgentCore Payments)
│   ├── api_server.py     # FastAPI backend
│   ├── runtime_client.py # AgentCore client
│   └── tools/
│       ├── payment.py    # process_payment (ProcessPayment API)
│       ├── content.py    # request_content, request_content_with_payment
│       └── discovery.py  # discover_services, request_service
├── tests/
└── pyproject.toml
```

## Tools

| Tool | Description |
|------|-------------|
| `process_payment` | Execute x402 payment via AgentCore Payments ProcessPayment API |
| `request_content` | Request content (returns x402_payload on 402) |
| `request_content_with_payment` | Retry with payment proof (auto-backoff) |
| `discover_services` | Find available paid services from Gateway |
| `request_service` | Request any discovered service by name |
| `list_approved_services` | List pre-approved services |
| `check_service_approval` | Check if a purchase is pre-approved |

## Payment Flow

```
request_content("/api/article")  →  HTTP 402 + x402_payload
         ↓
process_payment(x402_payload)    →  PROOF_GENERATED
         ↓
request_content_with_payment("/api/article")  →  HTTP 200 + content
```

The agent passes the merchant's `x402_payload` (accepts[0]) directly to ProcessPayment — no field parsing needed. The proof is stored internally and automatically attached on retry.

## Usage

```python
from agent import create_payer_agent

agent = create_payer_agent()
response = agent("Get me the premium article at /api/premium-article")
```

## Deployment

### Prerequisites

- AWS CLI configured
- CDK CLI (`npm install -g aws-cdk`)
- [Coinbase Developer Platform](https://portal.cdp.coinbase.com/) API keys (for AgentCore Payments credential provider setup)

### Deploy Infrastructure

```bash
cd ../payer-infrastructure
npm install
cdk deploy
```

Creates:
- IAM roles for AgentCore Runtime and Gateway
- AgentCore Payments IAM roles (ProcessPayment, Management, ResourceRetrieval)
- CloudWatch Dashboard

### Deploy Agent

```bash
python scripts/deploy_to_agentcore.py
```

### Test Invocation

```bash
python scripts/invoke_gateway.py "What services are available?"
```

## Configuration

Environment variables (see `.env.example`):

| Variable | Description |
|----------|-------------|
| `MANAGER_ARN` | PaymentManager ARN from quickstart |
| `PAYMENT_SESSION_ID` | Pre-created session ID |
| `PAYMENT_INSTRUMENT_ID` | Pre-created instrument ID |
| `PROCESS_PAYMENT_ROLE_ARN` | IAM role for ProcessPayment |
| `USER_ID` | End-user identifier |
| `SELLER_API_URL` | CloudFront distribution URL |

## Oracle Attestation

The payer agent uses [headless-oracle-strands](https://pypi.org/project/headless-oracle-strands/)
for pre-trade market state verification. The `attestation_ref` helpers embed a
cryptographically signed oracle receipt into each x402 payment event, creating
an auditable chain from market-open confirmation through to payment execution.

`agent/tools/oracle_attestation.py` is the **reference implementation** — readable
source showing the internals. The test suite imports from the published package
(`headless_oracle_strands.attestation`), not the local copy.

## License

MIT-0
