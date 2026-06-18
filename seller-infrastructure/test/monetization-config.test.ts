import {
  TIERS,
  BASE_AMOUNT,
  buildMonetizationConfig,
  buildWebAclRules,
} from '../lib/waf/monetization-config';

describe('native WAF monetization config', () => {
  it('exposes the repo pricing as base × multiplier', () => {
    // Base is the WAF service minimum $0.001 (<= 3 dp); dataset is the most
    // expensive at $0.01 → ×10. Weather ($0.0005) is below the minimum → floored ×1.
    expect(BASE_AMOUNT).toBe('0.001');
    const dataset = TIERS.find((t) => t.name === 'dataset');
    expect(dataset?.multiplier).toBe(10);
    const weather = TIERS.find((t) => t.name === 'weather');
    expect(weather?.multiplier).toBe(1);
  });

  it('uses a base price >= the $0.001 service minimum with <= 3 decimal places', () => {
    expect(Number(BASE_AMOUNT)).toBeGreaterThanOrEqual(0.001);
    const decimals = (BASE_AMOUNT.split('.')[1] ?? '').length;
    expect(decimals).toBeLessThanOrEqual(3);
  });

  it('builds a MonetizationConfig with the payee wallet on Base Sepolia USDC', () => {
    const cfg = buildMonetizationConfig('0xabc');
    expect(cfg).toEqual({
      CryptoConfig: {
        PaymentNetworks: [
          {
            Chain: 'BASE_SEPOLIA',
            WalletAddress: '0xabc',
            Prices: [{ Amount: '0.001', Currency: 'USDC' }],
          },
        ],
      },
      CurrencyMode: 'TEST',
    });
  });

  it('builds rules: bot-control first, then human-allow, then free discovery, then one Monetize per tier', () => {
    const rules = buildWebAclRules('x402seller');
    const names = rules.map((r) => r.Name);
    expect(names[0]).toBe('AWSBotControl');
    expect(names).toContain('human-allow');
    expect(names).toContain('allow-discovery');
    // One Monetize rule per tier.
    const monetizeNames = names.filter((n) => n.startsWith('Monetize-'));
    expect(monetizeNames).toHaveLength(TIERS.length);
    // Priorities are strictly increasing.
    const prios = rules.map((r) => r.Priority);
    expect([...prios].sort((a, b) => a - b)).toEqual(prios);
  });

  it('every Monetize rule carries a PriceMultiplier matching its tier', () => {
    const rules = buildWebAclRules('x402seller');
    const dataset = rules.find((r) => r.Name === 'Monetize-dataset');
    expect((dataset as any).Action.Monetize.PriceMultiplier).toBe('10');
  });

  it('ByteMatch SearchString is the PLAIN URI prefix, NOT base64 (CFN encodes it itself)', () => {
    // Regression: encoding here too double-encodes — WAF then searches for the literal
    // base64 text and never matches, so every request falls through to the default
    // Allow and no 402 ever fires. Verified against a live deploy.
    const rules = buildWebAclRules('x402seller');
    const dataset = rules.find((r) => r.Name === 'Monetize-dataset') as any;
    expect(dataset.Statement.ByteMatchStatement.SearchString).toBe('/dataset');
    const discovery = rules.find((r) => r.Name === 'allow-discovery') as any;
    const searchStrings = discovery.Statement.OrStatement.Statements.map(
      (s: any) => s.ByteMatchStatement.SearchString,
    );
    expect(searchStrings).toEqual(['/mcp/', '/.well-known/']);
  });
});
