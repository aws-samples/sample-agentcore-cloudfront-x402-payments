# x402 Demo Web UI

React frontend for the x402 payment-gated content demo.

## Features

- Wallet balance display
- Content selection with pricing
- Real-time payment flow visualization
- Agent reasoning display
- Transaction confirmation with block explorer links

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your endpoints
```

## Development

```bash
npm run dev
# Open http://localhost:5173
```

## Configuration

Edit `.env`:

```bash
# API endpoint (Lambda proxy to AgentCore)
VITE_API_ENDPOINT=https://<api-id>.execute-api.<region>.amazonaws.com/prod/

# AWS region
VITE_AWS_REGION=us-west-2

# Agent ID (from AgentCore deployment)
VITE_AGENT_ID=<your-agent-id>
```

## Build

```bash
npm run build
```

Output goes to `dist/` for deployment.

## Modes

- **Demo Mode**: Simulated responses (no AWS required)
- **Live Mode**: Real AgentCore invocation via API Gateway

## Stack

- React 18
- TypeScript
- Vite
- CSS Modules

## License

MIT-0
