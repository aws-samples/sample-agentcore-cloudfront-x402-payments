# Migration: Lambda@Edge → Native CloudFront + WAF x402 Monetization

## Why

AWS now supports AI-traffic monetization natively in Amazon CloudFront and AWS WAF
(x402 today; MPP for machine-to-machine payments coming soon). The seller side no
longer needs a custom Lambda@Edge payment verifier — the WebACL charges per request.

## Before

`seller-infrastructure/` ran a `cloudfront.experimental.EdgeFunction` (Node.js 20,
us-east-1) on the default, `/mcp/*`, and `/api/*` behaviors. It parsed the x402 payment
header, verified/settled via an x402 facilitator, and returned 402 when unpaid. Pricing
lived in `lib/lambda-edge/content-config.ts`.

## After

- The Lambda@Edge function and its `lib/lambda-edge/` directory are removed.
- A WAFv2 WebACL (scope CLOUDFRONT) is attached to the distribution:
  - **AWS Managed Bot Control v6** (Count/detect) labels bots.
  - **human-allow** — requests with no bot label are served free.
  - **allow-discovery** — `/mcp/*` and `/.well-known/*` are free (agents must read
    discovery before they can pay).
  - **Monetize rules** — one per content tier, `PriceMultiplier` × a $0.001 base (the WAF service minimum),
    reproducing the original prices ($0.001–$0.01) on Base Sepolia USDC. The original $0.0005 weather price is floored to the $0.001 minimum.
- The payee wallet still comes from `PAYMENT_RECIPIENT_ADDRESS`; network and base price
  are now WebACL-level config.

## IaC support status

AWS WAF AI traffic monetization is **GA** (configurable via the WAF console and API
today). Its `MonetizationConfig` and the per-rule `Monetize` action are **not yet in the
released CloudFormation/CDK/SDK schema** — SDK/CFN support is expected to follow shortly.
They are injected on the L1 `CfnWebACL` via `addPropertyOverride`, so the stack
synthesizes the full WebACL (including the monetization fields) and passes them through
CloudFormation verbatim. The override is the supported way to set these fields until the
typed CDK/CFN properties land, at which point this can be simplified to native props.
