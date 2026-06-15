# Seller Infrastructure (x402 Payment Gateway)

CloudFront distribution that acts as the **payment-gated content API** - the "seller" in the x402 protocol.

## What This Is

This is the **backend API** that the AI agent calls to fetch paid content.

```
┌─────────────┐         ┌─────────────────────────────┐
│  AI Agent   │ ──────▶ │  This CloudFront (Seller)   │
│  (Payer)    │   HTTP  │  - Returns 402 + price      │
│             │ ◀────── │  - Verifies payment         │
│             │         │  - Serves content           │
└─────────────┘         └─────────────────────────────┘
```

Endpoints like `/api/premium-article` return:
- **402 Payment Required** (no payment) with x402 headers
- **200 OK** (valid payment) with content

## Architecture

- **CloudFront** — Content delivery
- **AWS WAF (native x402 monetization)** — A `CLOUDFRONT`-scoped WAFv2 WebACL associated with the distribution charges per request at the edge
- **S3** — Content storage (optional)

## How It Works

The WebACL (`seller-infrastructure/lib/waf/monetization-config.ts`, applied in `lib/cloudfront-stack.ts`) gates content natively — there is no Lambda. Its rules run in priority order:

1. **`AWSBotControl`** (priority 0) — the AWS Managed Bot Control rule group, pinned to `Version_6.0` for agentic/AI-bot detections, in `Count`/detect mode. It stamps detected bots with `awswaf:managed:aws:bot-control:bot:*` labels.
2. **`human-allow`** (priority 1) — any request **not** carrying a bot label is allowed through unmonetized (terminating Allow).
3. **`allow-discovery`** (priority 2) — free discovery for `/mcp/*` and `/.well-known/*` (terminating Allow), so agents can fetch capability/discovery documents without paying.
4. **`Monetize-<tier>`** (priority 10+) — bots reaching these rules pay per request. Each tier matches a URI prefix (STARTS_WITH) and applies a `Monetize` action with a `PriceMultiplier`.

A WebACL-level **`MonetizationConfig`** sets the payee wallet, chain (`BASE_SEPOLIA`), base price (`0.0005` USDC), and test currency mode. The effective price for a tier is `BASE_AMOUNT × PriceMultiplier`.

> Note: the per-rule `Monetize` action and `MonetizationConfig` are an AWS WAF preview capability. They are injected onto the L1 `CfnWebACL` via `addPropertyOverride` so they pass through CloudFormation verbatim once support ships. Until then the WebACL deploys with Bot Control detection + allow rules only, and the monetization fields are inert overrides.

When a bot requests a paid path without payment it receives **402 Payment Required** with x402 payment requirements; with a valid payment the request is allowed to origin and the content is served.

## Content Types

| Path | Type | Description |
|------|------|-------------|
| `/api/premium-article` | Inline | Static article content |
| `/api/weather-data` | Dynamic | Generated weather data |
| `/api/market-analysis` | Dynamic | Generated market analysis |
| `/api/research-report` | S3 | Stored research report |
| `/api/dataset` | S3 | Premium dataset |
| `/api/tutorial` | S3 | Smart contract tutorial |

## Deploy

```bash
npm install
cdk bootstrap    # first time only
npm run build
npm run deploy
```

Note the CloudFront distribution URL from the output.

### Upload S3 Content

```bash
./scripts/upload-content.sh <bucket-name>
```

## Configuration

### Payment Settings

Set in `seller-infrastructure/.env`. `PAYMENT_RECIPIENT_ADDRESS` is read at synth time (`lib/cloudfront-stack.ts`) and becomes the **payee wallet in the WebACL `MonetizationConfig`** — it is no longer injected into any Lambda bundle. If unset, the stack falls back to a built-in default address.

| `.env` Variable | Description |
|-----------------|-------------|
| `PAYMENT_RECIPIENT_ADDRESS` | Wallet address that receives payments (WebACL `MonetizationConfig.CryptoConfig.PaymentNetworks[].WalletAddress`) |

The chain (`BASE_SEPOLIA`), base price (`0.0005` USDC), and currency mode (`TEST`) are defined in `lib/waf/monetization-config.ts`.

### Pricing & Tiers

Pricing lives in `lib/waf/monetization-config.ts`. The base unit price is `BASE_AMOUNT` (`0.0005` USDC) and each tier is a URI prefix with a `PriceMultiplier`:

| Tier | Prefix (STARTS_WITH) | Multiplier | Price (USDC) |
|------|----------------------|-----------:|-------------:|
| `weather` | `/api/weather-data` | 1 | 0.0005 |
| `article` | `/api/premium-article` | 2 | 0.001 |
| `market` | `/api/market-analysis` | 4 | 0.002 |
| `tutorial` / `api-tutorial` | `/tutorial`, `/api/tutorial` | 6 | 0.003 |
| `research` / `api-research` | `/research-report`, `/api/research-report` | 10 | 0.005 |
| `dataset` / `api-dataset` | `/dataset`, `/api/dataset` | 20 | 0.01 |

To add or reprice content, add a `Tier` to the `TIERS` array (it is ordered most-specific-first) and ensure the matching path is served from the S3 origin / a CloudFront behavior in `lib/cloudfront-stack.ts`.

## Testing

```bash
# Without payment (returns 402)
curl -i https://YOUR_DISTRIBUTION.cloudfront.net/api/premium-article

# With payment
curl -i -H "X-PAYMENT: <payment-header>" \
  https://YOUR_DISTRIBUTION.cloudfront.net/api/premium-article
```

## Monitoring

There are no Lambda logs to inspect. Observe the WebACL instead via AWS WAF metrics and sampled requests:

- **CloudWatch metrics** — each rule emits metrics in the `AWS/WAFV2` namespace (the WebACL and every rule set `CloudWatchMetricsEnabled: true` with metric names prefixed `x402seller-*`, e.g. `x402seller-bot-control`, `x402seller-human-allow`, `x402seller-allow-discovery`, `x402seller-monetize-<tier>`).
- **Sampled requests** — `SampledRequestsEnabled: true` on every rule, so you can inspect a sample of matched requests per rule in the WAF console (WebACL → Sampled requests) to see which tier/rule a request hit.

## Cleanup

```bash
cdk destroy
```

## Cost

Estimated < $5/month for development use.
