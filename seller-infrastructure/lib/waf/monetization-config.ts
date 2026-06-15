/**
 * Native AWS WAF x402 monetization config for the seller WebACL.
 *
 * PARKING LOT: `MonetizationConfig` and the per-rule `Monetize` action are an AWS WAF
 * preview capability not yet present in released CloudFormation/CDK/SDK. These pure
 * builders produce the intended declarative shape; cloudfront-stack.ts applies them to
 * the L1 `CfnWebACL` via `addPropertyOverride` so they pass through CloudFormation
 * verbatim once support ships. Until then the WebACL synthesizes with detection +
 * allow rules only; the Monetize actions/MonetizationConfig are inert overrides.
 *
 * Pricing is derived from the repo's former lib/lambda-edge/content-config.ts:
 * base $0.0005 USDC on Base Sepolia, per-tier PriceMultiplier reproduces the six
 * original prices ($0.0005 – $0.01).
 */

/** Bot Control stamps every detected bot with a label in this namespace. */
export const BOT_NAMESPACE = 'awswaf:managed:aws:bot-control:bot:';

/** Pinned Bot Control managed-rule-group version (>= v6 for agentic/AI-bot detections). */
export const BOT_CONTROL_VERSION = 'Version_6.0';

/** Base unit price (USDC). Each tier multiplies this. */
export const BASE_AMOUNT = '0.0005';

export interface Tier {
  /** Short name (used in rule name + metric). */
  name: string;
  /** CloudFront-style URI prefix that selects this tier (STARTS_WITH match). */
  prefix: string;
  /** Price multiplier × BASE_AMOUNT. */
  multiplier: number;
}

/**
 * Tiers ordered most-specific-first. The original repo priced both bare and
 * /api-prefixed variants identically, so each tier lists its matched prefix; the
 * cheapest catch (weather) and the explicit content prefixes are distinct rules.
 */
export const TIERS: Tier[] = [
  { name: 'weather', prefix: '/api/weather-data', multiplier: 1 },
  { name: 'article', prefix: '/api/premium-article', multiplier: 2 },
  { name: 'market', prefix: '/api/market-analysis', multiplier: 4 },
  { name: 'tutorial', prefix: '/tutorial', multiplier: 6 },
  { name: 'api-tutorial', prefix: '/api/tutorial', multiplier: 6 },
  { name: 'research', prefix: '/research-report', multiplier: 10 },
  { name: 'api-research', prefix: '/api/research-report', multiplier: 10 },
  { name: 'dataset', prefix: '/dataset', multiplier: 20 },
  { name: 'api-dataset', prefix: '/api/dataset', multiplier: 20 },
];

interface VisibilityConfig {
  SampledRequestsEnabled: boolean;
  CloudWatchMetricsEnabled: boolean;
  MetricName: string;
}

export interface WebAclRule {
  Name: string;
  Priority: number;
  Statement: Record<string, unknown>;
  Action?: Record<string, unknown>;
  OverrideAction?: Record<string, unknown>;
  RuleLabels?: { Name: string }[];
  VisibilityConfig: VisibilityConfig;
}

function vis(metricName: string): VisibilityConfig {
  return { SampledRequestsEnabled: true, CloudWatchMetricsEnabled: true, MetricName: metricName };
}

/** STARTS_WITH UriPath match (SearchString base64-encoded per the WAF JSON contract). */
function pathMatch(prefix: string): Record<string, unknown> {
  return {
    ByteMatchStatement: {
      SearchString: Buffer.from(prefix).toString('base64'),
      FieldToMatch: { UriPath: {} },
      TextTransformations: [{ Priority: 0, Type: 'NONE' }],
      PositionalConstraint: 'STARTS_WITH',
    },
  };
}

function botNamespaceMatch(): Record<string, unknown> {
  return { LabelMatchStatement: { Scope: 'NAMESPACE', Key: BOT_NAMESPACE } };
}

/** WebACL-level MonetizationConfig: payee wallet, chain, base price, mode. */
export function buildMonetizationConfig(walletAddress: string): Record<string, unknown> {
  return {
    CryptoConfig: {
      PaymentNetworks: [
        {
          Chain: 'BASE_SEPOLIA',
          WalletAddress: walletAddress,
          Prices: [{ Amount: BASE_AMOUNT, Currency: 'USDC' }],
        },
      ],
    },
    CurrencyMode: 'TEST',
  };
}

/**
 * Full WebACL rule array:
 *   0  AWSBotControl       (managed, Count/detect)
 *   1  human-allow         (NOT bot → Allow, terminating)
 *   2  allow-discovery     (/mcp/ + /.well-known/ → Allow, terminating)
 *   10+ Monetize-<tier>    (bots reaching here pay base × multiplier)
 */
export function buildWebAclRules(metricPrefix: string): WebAclRule[] {
  const rules: WebAclRule[] = [
    {
      Name: 'AWSBotControl',
      Priority: 0,
      Statement: {
        ManagedRuleGroupStatement: {
          VendorName: 'AWS',
          Name: 'AWSManagedRulesBotControlRuleSet',
          Version: BOT_CONTROL_VERSION,
          ManagedRuleGroupConfigs: [
            { AWSManagedRulesBotControlRuleSet: { InspectionLevel: 'COMMON' } },
          ],
        },
      },
      OverrideAction: { Count: {} },
      VisibilityConfig: vis(`${metricPrefix}-bot-control`),
    },
    {
      Name: 'human-allow',
      Priority: 1,
      Statement: { NotStatement: { Statement: botNamespaceMatch() } },
      Action: { Allow: {} },
      VisibilityConfig: vis(`${metricPrefix}-human-allow`),
    },
    {
      Name: 'allow-discovery',
      Priority: 2,
      Statement: {
        OrStatement: {
          Statements: [pathMatch('/mcp/'), pathMatch('/.well-known/')],
        },
      },
      Action: { Allow: {} },
      VisibilityConfig: vis(`${metricPrefix}-allow-discovery`),
    },
  ];

  TIERS.forEach((tier, i) => {
    rules.push({
      Name: `Monetize-${tier.name}`,
      Priority: 10 + i,
      Statement: pathMatch(tier.prefix),
      Action: { Monetize: { PriceMultiplier: String(tier.multiplier) } },
      VisibilityConfig: vis(`${metricPrefix}-monetize-${tier.name}`),
    });
  });

  return rules;
}
