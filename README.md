# x402 AWS Enterprise Demo

Enterprise-grade demonstration of HTTP 402 payment challenges using AWS infrastructure with Bedrock AgentCore and Strands Agents.

## Overview

This project demonstrates a complete payment-gated content delivery system:
- **Payer Side**: AI agent (Strands Agents) running on Bedrock AgentCore Runtime
- **Seller Side**: CloudFront + Lambda@Edge for x402 payment verification

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

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Agent Logic | Strands Agents SDK (Python) | Amazon's recommended agent framework |
| Agent Runtime | Bedrock AgentCore Runtime | Enterprise serverless deployment |
| Agent API | AgentCore Gateway | IAM SigV4 authentication |
| Wallet | Coinbase AgentKit | Blockchain transaction signing |
| Content Delivery | CloudFront + Lambda@Edge | Global edge computing |
| Payment Protocol | x402 (HTTP 402) | Open standard for internet payments |

## Project Structure

```
x402-demo/
├── .kiro/specs/              # Design documentation
│   ├── requirements.md       # Functional requirements
│   ├── design.md             # Architecture design
│   └── tasks.md              # Implementation tasks
│
├── payer-agent/              # Strands Agent (Python)
│   ├── agent/                # Agent implementation
│   ├── tests/                # Unit tests
│   └── pyproject.toml
│
├── payer-infrastructure/     # AgentCore CDK
│   └── lib/
│
├── seller-infrastructure/    # CloudFront CDK
│   └── lib/
│
├── agentkit/                 # Coinbase AgentKit (cloned)
└── x402/                     # x402 Protocol (cloned)
```

## Status

See [.kiro/specs/tasks.md](.kiro/specs/tasks.md) for current progress.

| Phase | Status |
|-------|--------|
| Foundation Setup | 🟡 In Progress |
| Payer Agent | 🔴 Not Started |
| Seller Infrastructure | 🟡 Partial |
| Integration | 🔴 Not Started |

## Quick Start

*Coming soon - see tasks.md for implementation progress*

## Documentation

- [Requirements](.kiro/specs/requirements.md) - What we're building
- [Design](.kiro/specs/design.md) - How we're building it
- [Tasks](.kiro/specs/tasks.md) - Implementation progress

## References

- [Agentic AI Golden Path](https://docs.hub.amazon.dev/docs/golden-path/agentic-ai-system/)
- [Strands Agents](https://strandsagents.com/latest/documentation/docs/)
- [Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/)
- [x402 Protocol](https://github.com/coinbase/x402)
- [Coinbase AgentKit](https://docs.cdp.coinbase.com/agentkit/docs/welcome)

## License

Apache-2.0
