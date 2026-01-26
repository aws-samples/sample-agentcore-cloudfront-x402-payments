# x402 AWS Enterprise Demo - Setup Scripts

This directory contains scripts to set up and verify the x402 demo environment.

## Quick Start

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Run full setup
./scripts/setup.sh
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `setup.sh` | Main setup script - sets up all components |
| `setup-payer-agent.sh` | Sets up Python environment for the payer agent |
| `setup-infrastructure.sh` | Sets up CDK infrastructure projects and Web UI |
| `verify-setup.sh` | Verifies that setup is complete and correct |

## Prerequisites

Before running setup, ensure you have:

- **Node.js 18+** - [Download](https://nodejs.org/)
- **Python 3.10+** - [Download](https://www.python.org/)
- **AWS CLI** - [Install Guide](https://aws.amazon.com/cli/)
- **AWS CDK** (optional, will use npx if not installed)

## What Each Script Does

### setup.sh

The main setup script that:
1. Checks all prerequisites
2. Verifies AWS credentials
3. Sets up the payer agent Python environment
4. Installs CDK dependencies for both infrastructure projects
5. Sets up the Web UI (React + Vite)
6. Creates `.env` files from examples
7. Prints next steps

### setup-payer-agent.sh

Sets up just the payer agent:
1. Creates Python virtual environment
2. Installs dependencies from `pyproject.toml`
3. Creates `.env` from `.env.example`

### setup-infrastructure.sh

Sets up the CDK infrastructure and Web UI:
1. Installs npm dependencies for seller-infrastructure
2. Installs npm dependencies for payer-infrastructure
3. Installs npm dependencies for web-ui
4. Builds TypeScript for infrastructure projects
5. Builds the Web UI

### verify-setup.sh

Verifies the setup is complete:
1. Checks virtual environment exists
2. Checks dependencies are installed
3. Checks `.env` files are configured
4. Checks TypeScript compiles
5. Checks Web UI builds
6. Checks AWS credentials
7. Reports errors and warnings

## Environment Variables

After running setup, configure these files:

### payer-agent/.env

```bash
AWS_REGION=us-west-2
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
CDP_API_KEY_NAME=your_key_name
CDP_API_KEY_PRIVATE_KEY=your_private_key
NETWORK_ID=base-sepolia
SELLER_API_URL=https://your-cloudfront.cloudfront.net
```

### seller-infrastructure/.env

```bash
AWS_ACCOUNT_ID=123456789012
AWS_REGION=us-east-1
PAYMENT_RECIPIENT_ADDRESS=0x...
```

### web-ui/.env (optional - for live mode)

```bash
VITE_GATEWAY_ENDPOINT=https://your-gateway-url
VITE_AWS_REGION=us-west-2
VITE_AGENT_ID=your-agent-id
VITE_AUTH_METHOD=proxy
```

> **Note**: The Web UI works in demo mode without any configuration.

## Running the Web UI

The Web UI can run in two modes:

### Demo Mode (default)
No backend required - simulates the entire x402 payment flow:
```bash
cd web-ui
npm run dev
# Open http://localhost:5173
```

### Live Mode
Requires deployed AgentCore Gateway:
```bash
# Configure web-ui/.env with your Gateway endpoint
cd web-ui
npm run dev
```

## Troubleshooting

### Python virtual environment issues

```bash
# Remove and recreate
rm -rf payer-agent/.venv
./scripts/setup-payer-agent.sh
```

### npm dependency issues

```bash
# Clear cache and reinstall
rm -rf seller-infrastructure/node_modules
rm -rf payer-infrastructure/node_modules
rm -rf web-ui/node_modules
./scripts/setup-infrastructure.sh
```

### AWS credential issues

```bash
# Configure AWS CLI
aws configure

# Verify credentials
aws sts get-caller-identity
```
