import {
  TIERS,
  BASE_AMOUNT,
  buildMonetizationConfig,
  buildWebAclRules,
} from '../lib/waf/monetization-config';

describe('native WAF monetization config', () => {
  it('exposes the repo pricing as base × multiplier', () => {
    // Base $0.0005; dataset is the most expensive at $0.01 → ×20.
    expect(BASE_AMOUNT).toBe('0.0005');
    const dataset = TIERS.find((t) => t.name === 'dataset');
    expect(dataset?.multiplier).toBe(20);
    const weather = TIERS.find((t) => t.name === 'weather');
    expect(weather?.multiplier).toBe(1);
  });

  it('builds a MonetizationConfig with the payee wallet on Base Sepolia USDC', () => {
    const cfg = buildMonetizationConfig('0xabc');
    expect(cfg).toEqual({
      CryptoConfig: {
        PaymentNetworks: [
          {
            Chain: 'BASE_SEPOLIA',
            WalletAddress: '0xabc',
            Prices: [{ Amount: '0.0005', Currency: 'USDC' }],
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
    expect((dataset as any).Action.Monetize.PriceMultiplier).toBe('20');
  });
});
