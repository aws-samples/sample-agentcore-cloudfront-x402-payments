# x402 AWS Enterprise Demo - API Documentation

This document provides comprehensive API documentation for the x402 payment-gated content delivery system.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Seller API (CloudFront + Lambda@Edge)](#seller-api-cloudfront--lambdaedge)
  - [Protected Content Endpoints](#protected-content-endpoints)
  - [Request/Response Flow](#requestresponse-flow)
  - [x402 Protocol Headers](#x402-protocol-headers)
  - [Error Responses](#error-responses)
- [Payer Agent API (AgentCore Gateway)](#payer-agent-api-agentcore-gateway)
  - [Agent Invocation](#agent-invocation)
  - [Agent Tools](#agent-tools)
- [Data Types](#data-types)

---

## Overview

The x402 AWS Enterprise Demo consists of two main API surfaces:

1. **Seller API**: CloudFront distribution with Lambda@Edge that serves payment-gated content using the x402 v2 protocol
2. **Payer Agent API**: AgentCore Gateway that provides access to the AI agent for automated payment decisions

### Base URLs

| Component | URL Pattern | Description |
|-----------|-------------|-------------|
| Seller API | `https://{distribution-id}.cloudfront.net` | CloudFront distribution URL |
| AgentCore Gateway | `https://bedrock-agent-runtime.{region}.amazonaws.com` | AWS Bedrock Agent Runtime |

---

## Authentication

### Seller API

The Seller API uses the **x402 v2 payment protocol** for authentication:

- **Initial Request**: No authentication required (returns 402 if payment needed)
- **Paid Request**: Include `X-PAYMENT-SIGNATURE` header with base64-encoded payment payload

### AgentCore Gateway

The AgentCore Gateway uses **AWS IAM SigV4** authentication:

```bash
# Example using AWS CLI credentials
aws bedrock-agent-runtime invoke-agent \
  --agent-id <AGENT_ID> \
  --agent-alias-id TSTALIASID \
  --session-id <SESSION_ID> \
  --input-text "Check my wallet balance"
```

---

## Seller API (CloudFront + Lambda@Edge)

### Protected Content Endpoints

All endpoints return JSON content and require x402 payment for access.

#### GET /api/premium-article

Premium article content about AI and blockchain integration.

| Property | Value |
|----------|-------|
| Price | 0.001 USDC (1000 atomic units) |
| Content Type | `application/json` |
| Source | Inline (static) |

**Response (200 OK with valid payment):**
```json
{
  "title": "The Future of AI and Blockchain Integration",
  "author": "Tech Insights",
  "date": "2026-01-22",
  "content": "Artificial Intelligence and Blockchain are converging...",
  "fullText": "This is premium content that requires payment to access...",
  "tags": ["AI", "blockchain", "technology", "innovation"]
}
```

---

#### GET /api/weather-data

Real-time weather data with current conditions and 5-day forecast.

| Property | Value |
|----------|-------|
| Price | 0.0005 USDC (500 atomic units) |
| Content Type | `application/json` |
| Source | Dynamic (generated per request) |

**Response (200 OK with valid payment):**
```json
{
  "location": "San Francisco, CA",
  "timestamp": "2026-01-22T15:30:00.000Z",
  "current": {
    "temperature": 62,
    "temperatureUnit": "F",
    "conditions": "Partly Cloudy",
    "humidity": 55,
    "windSpeed": 12,
    "windUnit": "mph",
    "uvIndex": 4
  },
  "forecast": [
    {
      "day": "Fri",
      "conditions": "Sunny",
      "high": 68,
      "low": 52
    }
  ],
  "source": "x402-weather-service",
  "premium": true
}
```

---

#### GET /api/market-analysis

Cryptocurrency market analysis with real-time data.

| Property | Value |
|----------|-------|
| Price | 0.002 USDC (2000 atomic units) |
| Content Type | `application/json` |
| Source | Dynamic (generated per request) |

**Response (200 OK with valid payment):**
```json
{
  "timestamp": "2026-01-22T15:30:00.000Z",
  "date": "2026-01-22",
  "markets": {
    "BTC": {
      "name": "Bitcoin",
      "price": "98500.00",
      "change24h": "+2.35%",
      "volume24h": "25.5B",
      "marketCap": "1920750M"
    },
    "ETH": {
      "name": "Ethereum",
      "price": "3850.00",
      "change24h": "+1.82%",
      "volume24h": "18.2B",
      "marketCap": "462000M"
    }
  },
  "analysis": {
    "overallSentiment": "Bullish",
    "summary": "Market showing mixed signals...",
    "keyEvents": [
      "Federal Reserve meeting scheduled for next week",
      "Major protocol upgrade announced for Ethereum"
    ],
    "riskLevel": "Medium"
  },
  "source": "x402-market-service",
  "premium": true
}
```

---

#### GET /api/research-report

In-depth blockchain research report (stored in S3).

| Property | Value |
|----------|-------|
| Price | 0.005 USDC (5000 atomic units) |
| Content Type | `application/json` |
| Source | S3 bucket |

**Response (200 OK with valid payment):**
```json
{
  "title": "Blockchain Technology Trends 2026",
  "author": "Research Team",
  "publishDate": "2026-01-15",
  "sections": [
    {
      "title": "Executive Summary",
      "content": "..."
    }
  ],
  "premium": true
}
```

---

#### GET /api/dataset

Premium machine learning dataset.

| Property | Value |
|----------|-------|
| Price | 0.01 USDC (10000 atomic units) |
| Content Type | `application/json` |
| Source | S3 bucket |

**Response (200 OK with valid payment):**
```json
{
  "name": "Blockchain Transaction Dataset",
  "version": "1.0",
  "records": 10000,
  "features": ["timestamp", "from", "to", "value", "gas"],
  "data": [...]
}
```

---

#### GET /api/tutorial

Advanced smart contract development tutorial.

| Property | Value |
|----------|-------|
| Price | 0.003 USDC (3000 atomic units) |
| Content Type | `application/json` |
| Source | S3 bucket |

**Response (200 OK with valid payment):**
```json
{
  "title": "Advanced Smart Contract Development",
  "difficulty": "Advanced",
  "estimatedTime": "2 hours",
  "chapters": [
    {
      "title": "Introduction to EIP-3009",
      "content": "..."
    }
  ]
}
```

---

### Request/Response Flow

#### 1. Initial Request (No Payment)

```http
GET /api/premium-article HTTP/1.1
Host: d1234567890.cloudfront.net
Accept: application/json
```

**Response:**
```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
X-PAYMENT-REQUIRED: <base64-encoded-payment-requirements>
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: X-PAYMENT-REQUIRED, X-PAYMENT-RESPONSE

{
  "error": "Payment Required",
  "message": "This content requires payment to access",
  "x402Version": 2
}
```

#### 2. Request with Payment

```http
GET /api/premium-article HTTP/1.1
Host: d1234567890.cloudfront.net
Accept: application/json
X-PAYMENT-SIGNATURE: <base64-encoded-payment-payload>
```

**Response (Success):**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-PAYMENT-RESPONSE: <base64-encoded-settlement-response>
X-Request-Id: req_abc123_xyz789
Access-Control-Allow-Origin: *

{
  "title": "The Future of AI and Blockchain Integration",
  ...
}
```

---

### x402 Protocol Headers

#### X-PAYMENT-REQUIRED (Response Header)

Base64-encoded JSON containing payment requirements:

```json
{
  "x402Version": 2,
  "error": "Payment required to access this resource",
  "resource": {
    "url": "/api/premium-article",
    "description": "Protected resource at /api/premium-article",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "amount": "1000",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
      "maxTimeoutSeconds": 60,
      "extra": {
        "name": "USDC",
        "version": "2",
        "assetTransferMethod": "eip3009"
      }
    }
  ],
  "extensions": {}
}
```

#### X-PAYMENT-SIGNATURE (Request Header)

Base64-encoded JSON containing the signed payment:

```json
{
  "x402Version": 2,
  "accepted": {
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "1000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "maxTimeoutSeconds": 60
  },
  "payload": {
    "signature": "0x...",
    "authorization": {
      "from": "0x...",
      "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
      "value": "1000",
      "validAfter": "0",
      "validBefore": "1737561600",
      "nonce": "0x..."
    }
  }
}
```

#### X-PAYMENT-RESPONSE (Response Header)

Base64-encoded JSON containing settlement confirmation:

```json
{
  "success": true,
  "transaction": "0x1234567890abcdef...",
  "network": "eip155:84532",
  "payer": "0x..."
}
```

---

### Error Responses

#### 400 Bad Request

Invalid payment payload structure:

```json
{
  "error": "Invalid Payment",
  "message": "Payment payload structure is invalid"
}
```

#### 402 Payment Required

Payment validation failed:

```json
{
  "error": "Payment Required",
  "message": "This content requires payment to access",
  "x402Version": 2
}
```

Common validation errors in the `X-PAYMENT-REQUIRED` header:
- `scheme_mismatch` - Payment scheme doesn't match requirements
- `network_mismatch` - Wrong blockchain network
- `invalid_exact_evm_payload_recipient_mismatch` - Wrong recipient address
- `invalid_exact_evm_payload_authorization_value` - Insufficient payment amount
- `invalid_exact_evm_payload_authorization_valid_before` - Payment expired
- `invalid_signature_format` - Invalid signature format
- `asset_mismatch` - Wrong payment asset

#### 500 Internal Server Error

```json
{
  "error": "Payment Processing Error",
  "message": "Failed to process payment"
}
```

---

## Payer Agent API (AgentCore Gateway)

### Agent Invocation

The payer agent is invoked through AWS Bedrock AgentCore Gateway.

#### Endpoint

```
POST https://bedrock-agent-runtime.{region}.amazonaws.com/agents/{agentId}/agentAliases/{agentAliasId}/sessions/{sessionId}/text
```

#### Request

```json
{
  "inputText": "Get me the premium article at /api/premium-article"
}
```

#### Response (Streaming)

The response is streamed as chunks:

```json
{
  "completion": [
    {
      "chunk": {
        "bytes": "I'll help you get the premium article..."
      }
    }
  ]
}
```

### Agent Tools

The payer agent exposes the following tools:

#### get_wallet_balance

Check the current wallet balance.

**Returns:**
```json
{
  "success": true,
  "address": "0x...",
  "network": "base-sepolia",
  "balance": "0.05",
  "balance_wei": "50000000000000000",
  "currency": "ETH"
}
```

---

#### analyze_payment

Analyze a payment request and decide whether to approve it.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| amount | string | Payment amount (e.g., "0.001") |
| currency | string | Currency (e.g., "ETH", "USDC") |
| recipient | string | Recipient wallet address |
| description | string | Description of purchase |
| wallet_balance | string | Current wallet balance |

**Returns:**
```json
{
  "should_pay": true,
  "reasoning": "Payment of 0.001 USDC for 'premium article' is reasonable and within budget",
  "risk_level": "low"
}
```

---

#### sign_payment

Sign a payment using the AgentKit wallet (EIP-3009).

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| scheme | string | Payment scheme (e.g., "exact") |
| network | string | Blockchain network (e.g., "base-sepolia") |
| amount | string | Payment amount |
| recipient | string | Recipient wallet address |

**Returns:**
```json
{
  "success": true,
  "payload": {
    "scheme": "exact",
    "network": "base-sepolia",
    "signature": "0x...",
    "from": "0x...",
    "to": "0x...",
    "amount": "1000",
    "timestamp": 1737561600000
  }
}
```

---

#### request_content

Request content from the seller API (may return 402).

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| url | string | Content URL path (e.g., "/api/premium-article") |

**Returns (200):**
```json
{
  "status": 200,
  "content": { ... }
}
```

**Returns (402):**
```json
{
  "status": 402,
  "payment_required": {
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "1000",
    "currency": "USDC",
    "recipient": "0x...",
    "description": "Premium article content"
  }
}
```

---

#### request_content_with_payment

Request content with a signed payment.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| url | string | Content URL path |
| payment_payload | object | Signed payment from sign_payment |

**Returns:**
```json
{
  "status": 200,
  "content": { ... },
  "settlement": {
    "success": true,
    "transaction": "0x...",
    "network": "eip155:84532"
  }
}
```

---

#### request_faucet_funds

Request test tokens from the testnet faucet.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| asset_id | string | "eth" | Asset to request: "eth", "usdc", "eurc", "cbbtc" |

**Returns:**
```json
{
  "success": true,
  "message": "Successfully requested ETH from faucet",
  "transaction_hash": "0x...",
  "address": "0x...",
  "network": "base-sepolia",
  "asset": "ETH"
}
```

---

#### check_faucet_eligibility

Check if the wallet is eligible for faucet funds.

**Returns:**
```json
{
  "success": true,
  "eligible": true,
  "address": "0x...",
  "network": "base-sepolia",
  "supported_assets": ["eth", "usdc", "eurc", "cbbtc"],
  "message": "Wallet is eligible for faucet on base-sepolia..."
}
```

---

## Data Types

### PaymentRequirements

```typescript
interface PaymentRequirements {
  scheme: string;           // Payment scheme (e.g., "exact")
  network: string;          // CAIP-2 network ID (e.g., "eip155:84532")
  amount: string;           // Amount in atomic units
  asset: string;            // Asset contract address
  payTo: string;            // Recipient wallet address
  maxTimeoutSeconds: number; // Maximum payment validity
  extra?: {
    name?: string;          // Asset name (e.g., "USDC")
    version?: string;       // Protocol version
    assetTransferMethod?: string; // Transfer method (e.g., "eip3009")
  };
}
```

### PaymentPayload

```typescript
interface PaymentPayload {
  x402Version: number;      // Protocol version (2)
  accepted: PaymentRequirements;
  payload: {
    signature: string;      // EIP-712 signature
    authorization: {
      from: string;         // Payer address
      to: string;           // Recipient address
      value: string;        // Amount in atomic units
      validAfter: string;   // Unix timestamp
      validBefore: string;  // Unix timestamp
      nonce: string;        // 32-byte hex nonce
    };
  };
}
```

### SettlementResponse

```typescript
interface SettlementResponse {
  success: boolean;
  transaction: string;      // Transaction hash
  network: string;          // Network ID
  payer?: string;           // Payer address
  errorReason?: string;     // Error reason if failed
}
```

---

## Rate Limiting

### Seller API

No explicit rate limiting at the application level. CloudFront and Lambda@Edge have built-in limits.

### AgentCore Gateway

| Setting | Value |
|---------|-------|
| Requests per second | 10 |
| Burst capacity | 20 |
| Authentication | IAM SigV4 |

Client-side rate limiting is implemented in the Gateway client to prevent throttling.

---

## Network Configuration

### Supported Networks

| Network | Chain ID | CAIP-2 ID | Environment |
|---------|----------|-----------|-------------|
| Base Sepolia | 84532 | eip155:84532 | Testnet |

### Asset Addresses (Base Sepolia)

| Asset | Contract Address |
|-------|------------------|
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

---

## Facilitator Service

The x402 facilitator service handles payment verification and settlement.

| Endpoint | URL |
|----------|-----|
| Production | `https://facilitator.x402.org` |

### POST /verify

Verify a payment signature.

**Request:**
```json
{
  "paymentPayload": { ... },
  "paymentRequirements": { ... }
}
```

**Response:**
```json
{
  "isValid": true,
  "payer": "0x..."
}
```

### POST /settle

Settle a verified payment on-chain.

**Request:**
```json
{
  "paymentPayload": { ... },
  "paymentRequirements": { ... }
}
```

**Response:**
```json
{
  "success": true,
  "transaction": "0x...",
  "network": "eip155:84532",
  "payer": "0x..."
}
```
