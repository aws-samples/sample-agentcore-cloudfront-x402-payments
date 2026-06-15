"use strict";
/**
 * Native AWS WAF x402 monetization config for the seller WebACL.
 *
 * NOTE: AWS WAF AI traffic monetization is GA, but its `MonetizationConfig` and the
 * per-rule `Monetize` action are not yet modeled in the released CloudFormation/CDK/SDK
 * (support is expected to follow shortly). These pure builders produce the declarative
 * shape; cloudfront-stack.ts applies them to the L1 `CfnWebACL` via `addPropertyOverride`
 * so they pass through CloudFormation verbatim. The typed CDK props don't model the
 * fields yet, so the override is the supported way to set them until they land.
 *
 * Pricing is derived from the repo's former lib/lambda-edge/content-config.ts and
 * conformed to the AWS WAF AI-traffic-monetization rules: the base price is the
 * service minimum of $0.001 USDC (decimal string, <= 3 dp), and per-tier
 * PriceMultiplier reproduces the original prices ($0.001 – $0.01) on Base Sepolia.
 * The original weather price ($0.0005) is below the $0.001 service minimum, so it
 * is floored to the base (×1).
 * See https://docs.aws.amazon.com/waf/latest/developerguide/waf-ai-traffic-monetization-pricing.html
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIERS = exports.BASE_AMOUNT = exports.BOT_CONTROL_VERSION = exports.BOT_NAMESPACE = void 0;
exports.buildMonetizationConfig = buildMonetizationConfig;
exports.buildWebAclRules = buildWebAclRules;
/** Bot Control stamps every detected bot with a label in this namespace. */
exports.BOT_NAMESPACE = 'awswaf:managed:aws:bot-control:bot:';
/** Pinned Bot Control managed-rule-group version (>= v6 for agentic/AI-bot detections). */
exports.BOT_CONTROL_VERSION = 'Version_6.0';
/**
 * Base unit price (USDC), as a decimal string with <= 3 decimal places. This is the
 * AWS WAF service minimum ($0.001 USDC per request); each tier multiplies it.
 */
exports.BASE_AMOUNT = '0.001';
/**
 * Tiers ordered most-specific-first. The original repo priced both bare and
 * /api-prefixed variants identically, so each tier lists its matched prefix; the
 * cheapest catch (weather) and the explicit content prefixes are distinct rules.
 *
 * Multipliers reproduce the original USDC prices off the $0.001 base:
 *   weather $0.0005 → floored to $0.001 (×1, the service minimum)
 *   article $0.001 (×1), market $0.002 (×2), tutorial $0.003 (×3),
 *   research $0.005 (×5), dataset $0.01 (×10).
 */
exports.TIERS = [
    { name: 'weather', prefix: '/api/weather-data', multiplier: 1 },
    { name: 'article', prefix: '/api/premium-article', multiplier: 1 },
    { name: 'market', prefix: '/api/market-analysis', multiplier: 2 },
    { name: 'tutorial', prefix: '/tutorial', multiplier: 3 },
    { name: 'api-tutorial', prefix: '/api/tutorial', multiplier: 3 },
    { name: 'research', prefix: '/research-report', multiplier: 5 },
    { name: 'api-research', prefix: '/api/research-report', multiplier: 5 },
    { name: 'dataset', prefix: '/dataset', multiplier: 10 },
    { name: 'api-dataset', prefix: '/api/dataset', multiplier: 10 },
];
function vis(metricName) {
    return { SampledRequestsEnabled: true, CloudWatchMetricsEnabled: true, MetricName: metricName };
}
/** STARTS_WITH UriPath match (SearchString base64-encoded per the WAF JSON contract). */
function pathMatch(prefix) {
    return {
        ByteMatchStatement: {
            SearchString: Buffer.from(prefix).toString('base64'),
            FieldToMatch: { UriPath: {} },
            TextTransformations: [{ Priority: 0, Type: 'NONE' }],
            PositionalConstraint: 'STARTS_WITH',
        },
    };
}
function botNamespaceMatch() {
    return { LabelMatchStatement: { Scope: 'NAMESPACE', Key: exports.BOT_NAMESPACE } };
}
/** WebACL-level MonetizationConfig: payee wallet, chain, base price, mode. */
function buildMonetizationConfig(walletAddress) {
    return {
        CryptoConfig: {
            PaymentNetworks: [
                {
                    Chain: 'BASE_SEPOLIA',
                    WalletAddress: walletAddress,
                    Prices: [{ Amount: exports.BASE_AMOUNT, Currency: 'USDC' }],
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
function buildWebAclRules(metricPrefix) {
    const rules = [
        {
            Name: 'AWSBotControl',
            Priority: 0,
            Statement: {
                ManagedRuleGroupStatement: {
                    VendorName: 'AWS',
                    Name: 'AWSManagedRulesBotControlRuleSet',
                    Version: exports.BOT_CONTROL_VERSION,
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
    exports.TIERS.forEach((tier, i) => {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9uZXRpemF0aW9uLWNvbmZpZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1vbmV0aXphdGlvbi1jb25maWcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRzs7O0FBa0ZILDBEQWFDO0FBU0QsNENBaURDO0FBdkpELDRFQUE0RTtBQUMvRCxRQUFBLGFBQWEsR0FBRyxxQ0FBcUMsQ0FBQztBQUVuRSwyRkFBMkY7QUFDOUUsUUFBQSxtQkFBbUIsR0FBRyxhQUFhLENBQUM7QUFFakQ7OztHQUdHO0FBQ1UsUUFBQSxXQUFXLEdBQUcsT0FBTyxDQUFDO0FBV25DOzs7Ozs7Ozs7R0FTRztBQUNVLFFBQUEsS0FBSyxHQUFXO0lBQzNCLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsbUJBQW1CLEVBQUUsVUFBVSxFQUFFLENBQUMsRUFBRTtJQUMvRCxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLHNCQUFzQixFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUU7SUFDbEUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEVBQUUsQ0FBQyxFQUFFO0lBQ2pFLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUU7SUFDeEQsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLENBQUMsRUFBRTtJQUNoRSxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLGtCQUFrQixFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUU7SUFDL0QsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEVBQUUsQ0FBQyxFQUFFO0lBQ3ZFLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsVUFB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QUFPLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUU7UUFDeEIsS0FBSyxDQUFDLElBQUksQ0FBQztZQUNULElBQUksRUFBRSxZQUFZLElBQUksQ0FBQyxJQUFJLEVBQUU7WUFDN0IsUUFBUSxFQUFFLEVBQUUsR0FBRyxDQUFDO1lBQ2hCLFNBQVMsRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQztZQUNqQyxNQUFNLEVBQUUsRUFBRSxRQUFRLEVBQUUsRUFBRSxlQUFlLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsRUFBRSxFQUFFO1lBQ2xFLGdCQUFnQixFQUFFLEdBQUcsQ0FBQyxHQUFHLFlBQVksYUFBYSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7U0FDL0QsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxPQUFPLEtBQUssQ0FBQztBQUNmLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE5hdGl2ZSBBV1MgV0FGIHg0MDIgbW9uZXRpemF0aW9uIGNvbmZpZyBmb3IgdGhlIHNlbGxlciBXZWJBQ0wuXG4gKlxuICogTk9URTogQVdTIFdBRiBBSSB0cmFmZmljIG1vbmV0aXphdGlvbiBpcyBHQSwgYnV0IGl0cyBgTW9uZXRpemF0aW9uQ29uZmlnYCBhbmQgdGhlXG4gKiBwZXItcnVsZSBgTW9uZXRpemVgIGFjdGlvbiBhcmUgbm90IHlldCBtb2RlbGVkIGluIHRoZSByZWxlYXNlZCBDbG91ZEZvcm1hdGlvbi9DREsvU0RLXG4gKiAoc3VwcG9ydCBpcyBleHBlY3RlZCB0byBmb2xsb3cgc2hvcnRseSkuIFRoZXNlIHB1cmUgYnVpbGRlcnMgcHJvZHVjZSB0aGUgZGVjbGFyYXRpdmVcbiAqIHNoYXBlOyBjbG91ZGZyb250LXN0YWNrLnRzIGFwcGxpZXMgdGhlbSB0byB0aGUgTDEgYENmbldlYkFDTGAgdmlhIGBhZGRQcm9wZXJ0eU92ZXJyaWRlYFxuICogc28gdGhleSBwYXNzIHRocm91Z2ggQ2xvdWRGb3JtYXRpb24gdmVyYmF0aW0uIFRoZSB0eXBlZCBDREsgcHJvcHMgZG9uJ3QgbW9kZWwgdGhlXG4gKiBmaWVsZHMgeWV0LCBzbyB0aGUgb3ZlcnJpZGUgaXMgdGhlIHN1cHBvcnRlZCB3YXkgdG8gc2V0IHRoZW0gdW50aWwgdGhleSBsYW5kLlxuICpcbiAqIFByaWNpbmcgaXMgZGVyaXZlZCBmcm9tIHRoZSByZXBvJ3MgZm9ybWVyIGxpYi9sYW1iZGEtZWRnZS9jb250ZW50LWNvbmZpZy50cyBhbmRcbiAqIGNvbmZvcm1lZCB0byB0aGUgQVdTIFdBRiBBSS10cmFmZmljLW1vbmV0aXphdGlvbiBydWxlczogdGhlIGJhc2UgcHJpY2UgaXMgdGhlXG4gKiBzZXJ2aWNlIG1pbmltdW0gb2YgJDAuMDAxIFVTREMgKGRlY2ltYWwgc3RyaW5nLCA8PSAzIGRwKSwgYW5kIHBlci10aWVyXG4gKiBQcmljZU11bHRpcGxpZXIgcmVwcm9kdWNlcyB0aGUgb3JpZ2luYWwgcHJpY2VzICgkMC4wMDEg4oCTICQwLjAxKSBvbiBCYXNlIFNlcG9saWEuXG4gKiBUaGUgb3JpZ2luYWwgd2VhdGhlciBwcmljZSAoJDAuMDAwNSkgaXMgYmVsb3cgdGhlICQwLjAwMSBzZXJ2aWNlIG1pbmltdW0sIHNvIGl0XG4gKiBpcyBmbG9vcmVkIHRvIHRoZSBiYXNlICjDlzEpLlxuICogU2VlIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS93YWYvbGF0ZXN0L2RldmVsb3Blcmd1aWRlL3dhZi1haS10cmFmZmljLW1vbmV0aXphdGlvbi1wcmljaW5nLmh0bWxcbiAqL1xuXG4vKiogQm90IENvbnRyb2wgc3RhbXBzIGV2ZXJ5IGRldGVjdGVkIGJvdCB3aXRoIGEgbGFiZWwgaW4gdGhpcyBuYW1lc3BhY2UuICovXG5leHBvcnQgY29uc3QgQk9UX05BTUVTUEFDRSA9ICdhd3N3YWY6bWFuYWdlZDphd3M6Ym90LWNvbnRyb2w6Ym90Oic7XG5cbi8qKiBQaW5uZWQgQm90IENvbnRyb2wgbWFuYWdlZC1ydWxlLWdyb3VwIHZlcnNpb24gKD49IHY2IGZvciBhZ2VudGljL0FJLWJvdCBkZXRlY3Rpb25zKS4gKi9cbmV4cG9ydCBjb25zdCBCT1RfQ09OVFJPTF9WRVJTSU9OID0gJ1ZlcnNpb25fNi4wJztcblxuLyoqXG4gKiBCYXNlIHVuaXQgcHJpY2UgKFVTREMpLCBhcyBhIGRlY2ltYWwgc3RyaW5nIHdpdGggPD0gMyBkZWNpbWFsIHBsYWNlcy4gVGhpcyBpcyB0aGVcbiAqIEFXUyBXQUYgc2VydmljZSBtaW5pbXVtICgkMC4wMDEgVVNEQyBwZXIgcmVxdWVzdCk7IGVhY2ggdGllciBtdWx0aXBsaWVzIGl0LlxuICovXG5leHBvcnQgY29uc3QgQkFTRV9BTU9VTlQgPSAnMC4wMDEnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFRpZXIge1xuICAvKiogU2hvcnQgbmFtZSAodXNlZCBpbiBydWxlIG5hbWUgKyBtZXRyaWMpLiAqL1xuICBuYW1lOiBzdHJpbmc7XG4gIC8qKiBDbG91ZEZyb250LXN0eWxlIFVSSSBwcmVmaXggdGhhdCBzZWxlY3RzIHRoaXMgdGllciAoU1RBUlRTX1dJVEggbWF0Y2gpLiAqL1xuICBwcmVmaXg6IHN0cmluZztcbiAgLyoqIFByaWNlIG11bHRpcGxpZXIgw5cgQkFTRV9BTU9VTlQuICovXG4gIG11bHRpcGxpZXI6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBUaWVycyBvcmRlcmVkIG1vc3Qtc3BlY2lmaWMtZmlyc3QuIFRoZSBvcmlnaW5hbCByZXBvIHByaWNlZCBib3RoIGJhcmUgYW5kXG4gKiAvYXBpLXByZWZpeGVkIHZhcmlhbnRzIGlkZW50aWNhbGx5LCBzbyBlYWNoIHRpZXIgbGlzdHMgaXRzIG1hdGNoZWQgcHJlZml4OyB0aGVcbiAqIGNoZWFwZXN0IGNhdGNoICh3ZWF0aGVyKSBhbmQgdGhlIGV4cGxpY2l0IGNvbnRlbnQgcHJlZml4ZXMgYXJlIGRpc3RpbmN0IHJ1bGVzLlxuICpcbiAqIE11bHRpcGxpZXJzIHJlcHJvZHVjZSB0aGUgb3JpZ2luYWwgVVNEQyBwcmljZXMgb2ZmIHRoZSAkMC4wMDEgYmFzZTpcbiAqICAgd2VhdGhlciAkMC4wMDA1IOKGkiBmbG9vcmVkIHRvICQwLjAwMSAow5cxLCB0aGUgc2VydmljZSBtaW5pbXVtKVxuICogICBhcnRpY2xlICQwLjAwMSAow5cxKSwgbWFya2V0ICQwLjAwMiAow5cyKSwgdHV0b3JpYWwgJDAuMDAzICjDlzMpLFxuICogICByZXNlYXJjaCAkMC4wMDUgKMOXNSksIGRhdGFzZXQgJDAuMDEgKMOXMTApLlxuICovXG5leHBvcnQgY29uc3QgVElFUlM6IFRpZXJbXSA9IFtcbiAgeyBuYW1lOiAnd2VhdGhlcicsIHByZWZpeDogJy9hcGkvd2VhdGhlci1kYXRhJywgbXVsdGlwbGllcjogMSB9LFxuICB7IG5hbWU6ICdhcnRpY2xlJywgcHJlZml4OiAnL2FwaS9wcmVtaXVtLWFydGljbGUnLCBtdWx0aXBsaWVyOiAxIH0sXG4gIHsgbmFtZTogJ21hcmtldCcsIHByZWZpeDogJy9hcGkvbWFya2V0LWFuYWx5c2lzJywgbXVsdGlwbGllcjogMiB9LFxuICB7IG5hbWU6ICd0dXRvcmlhbCcsIHByZWZpeDogJy90dXRvcmlhbCcsIG11bHRpcGxpZXI6IDMgfSxcbiAgeyBuYW1lOiAnYXBpLXR1dG9yaWFsJywgcHJlZml4OiAnL2FwaS90dXRvcmlhbCcsIG11bHRpcGxpZXI6IDMgfSxcbiAgeyBuYW1lOiAncmVzZWFyY2gnLCBwcmVmaXg6ICcvcmVzZWFyY2gtcmVwb3J0JywgbXVsdGlwbGllcjogNSB9LFxuICB7IG5hbWU6ICdhcGktcmVzZWFyY2gnLCBwcmVmaXg6ICcvYXBpL3Jlc2VhcmNoLXJlcG9ydCcsIG11bHRpcGxpZXI6IDUgfSxcbiAgeyBuYW1lOiAnZGF0YXNldCcsIHByZWZpeDogJy9kYXRhc2V0JywgbXVsdGlwbGllcjogMTAgfSxcbiAgeyBuYW1lOiAnYXBpLWRhdGFzZXQnLCBwcmVmaXg6ICcvYXBpL2RhdGFzZXQnLCBtdWx0aXBsaWVyOiAxMCB9LFxuXTtcblxuaW50ZXJmYWNlIFZpc2liaWxpdHlDb25maWcge1xuICBTYW1wbGVkUmVxdWVzdHNFbmFibGVkOiBib29sZWFuO1xuICBDbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IGJvb2xlYW47XG4gIE1ldHJpY05hbWU6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBXZWJBY2xSdWxlIHtcbiAgTmFtZTogc3RyaW5nO1xuICBQcmlvcml0eTogbnVtYmVyO1xuICBTdGF0ZW1lbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBBY3Rpb24/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgT3ZlcnJpZGVBY3Rpb24/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgUnVsZUxhYmVscz86IHsgTmFtZTogc3RyaW5nIH1bXTtcbiAgVmlzaWJpbGl0eUNvbmZpZzogVmlzaWJpbGl0eUNvbmZpZztcbn1cblxuZnVuY3Rpb24gdmlzKG1ldHJpY05hbWU6IHN0cmluZyk6IFZpc2liaWxpdHlDb25maWcge1xuICByZXR1cm4geyBTYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLCBDbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsIE1ldHJpY05hbWU6IG1ldHJpY05hbWUgfTtcbn1cblxuLyoqIFNUQVJUU19XSVRIIFVyaVBhdGggbWF0Y2ggKFNlYXJjaFN0cmluZyBiYXNlNjQtZW5jb2RlZCBwZXIgdGhlIFdBRiBKU09OIGNvbnRyYWN0KS4gKi9cbmZ1bmN0aW9uIHBhdGhNYXRjaChwcmVmaXg6IHN0cmluZyk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHtcbiAgICBCeXRlTWF0Y2hTdGF0ZW1lbnQ6IHtcbiAgICAgIFNlYXJjaFN0cmluZzogQnVmZmVyLmZyb20ocHJlZml4KS50b1N0cmluZygnYmFzZTY0JyksXG4gICAgICBGaWVsZFRvTWF0Y2g6IHsgVXJpUGF0aDoge30gfSxcbiAgICAgIFRleHRUcmFuc2Zvcm1hdGlvbnM6IFt7IFByaW9yaXR5OiAwLCBUeXBlOiAnTk9ORScgfV0sXG4gICAgICBQb3NpdGlvbmFsQ29uc3RyYWludDogJ1NUQVJUU19XSVRIJyxcbiAgICB9LFxuICB9O1xufVxuXG5mdW5jdGlvbiBib3ROYW1lc3BhY2VNYXRjaCgpOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB7IExhYmVsTWF0Y2hTdGF0ZW1lbnQ6IHsgU2NvcGU6ICdOQU1FU1BBQ0UnLCBLZXk6IEJPVF9OQU1FU1BBQ0UgfSB9O1xufVxuXG4vKiogV2ViQUNMLWxldmVsIE1vbmV0aXphdGlvbkNvbmZpZzogcGF5ZWUgd2FsbGV0LCBjaGFpbiwgYmFzZSBwcmljZSwgbW9kZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZE1vbmV0aXphdGlvbkNvbmZpZyh3YWxsZXRBZGRyZXNzOiBzdHJpbmcpOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB7XG4gICAgQ3J5cHRvQ29uZmlnOiB7XG4gICAgICBQYXltZW50TmV0d29ya3M6IFtcbiAgICAgICAge1xuICAgICAgICAgIENoYWluOiAnQkFTRV9TRVBPTElBJyxcbiAgICAgICAgICBXYWxsZXRBZGRyZXNzOiB3YWxsZXRBZGRyZXNzLFxuICAgICAgICAgIFByaWNlczogW3sgQW1vdW50OiBCQVNFX0FNT1VOVCwgQ3VycmVuY3k6ICdVU0RDJyB9XSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSxcbiAgICBDdXJyZW5jeU1vZGU6ICdURVNUJyxcbiAgfTtcbn1cblxuLyoqXG4gKiBGdWxsIFdlYkFDTCBydWxlIGFycmF5OlxuICogICAwICBBV1NCb3RDb250cm9sICAgICAgIChtYW5hZ2VkLCBDb3VudC9kZXRlY3QpXG4gKiAgIDEgIGh1bWFuLWFsbG93ICAgICAgICAgKE5PVCBib3Qg4oaSIEFsbG93LCB0ZXJtaW5hdGluZylcbiAqICAgMiAgYWxsb3ctZGlzY292ZXJ5ICAgICAoL21jcC8gKyAvLndlbGwta25vd24vIOKGkiBBbGxvdywgdGVybWluYXRpbmcpXG4gKiAgIDEwKyBNb25ldGl6ZS08dGllcj4gICAgKGJvdHMgcmVhY2hpbmcgaGVyZSBwYXkgYmFzZSDDlyBtdWx0aXBsaWVyKVxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRXZWJBY2xSdWxlcyhtZXRyaWNQcmVmaXg6IHN0cmluZyk6IFdlYkFjbFJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBXZWJBY2xSdWxlW10gPSBbXG4gICAge1xuICAgICAgTmFtZTogJ0FXU0JvdENvbnRyb2wnLFxuICAgICAgUHJpb3JpdHk6IDAsXG4gICAgICBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgTWFuYWdlZFJ1bGVHcm91cFN0YXRlbWVudDoge1xuICAgICAgICAgIFZlbmRvck5hbWU6ICdBV1MnLFxuICAgICAgICAgIE5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNCb3RDb250cm9sUnVsZVNldCcsXG4gICAgICAgICAgVmVyc2lvbjogQk9UX0NPTlRST0xfVkVSU0lPTixcbiAgICAgICAgICBNYW5hZ2VkUnVsZUdyb3VwQ29uZmlnczogW1xuICAgICAgICAgICAgeyBBV1NNYW5hZ2VkUnVsZXNCb3RDb250cm9sUnVsZVNldDogeyBJbnNwZWN0aW9uTGV2ZWw6ICdDT01NT04nIH0gfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIE92ZXJyaWRlQWN0aW9uOiB7IENvdW50OiB7fSB9LFxuICAgICAgVmlzaWJpbGl0eUNvbmZpZzogdmlzKGAke21ldHJpY1ByZWZpeH0tYm90LWNvbnRyb2xgKSxcbiAgICB9LFxuICAgIHtcbiAgICAgIE5hbWU6ICdodW1hbi1hbGxvdycsXG4gICAgICBQcmlvcml0eTogMSxcbiAgICAgIFN0YXRlbWVudDogeyBOb3RTdGF0ZW1lbnQ6IHsgU3RhdGVtZW50OiBib3ROYW1lc3BhY2VNYXRjaCgpIH0gfSxcbiAgICAgIEFjdGlvbjogeyBBbGxvdzoge30gfSxcbiAgICAgIFZpc2liaWxpdHlDb25maWc6IHZpcyhgJHttZXRyaWNQcmVmaXh9LWh1bWFuLWFsbG93YCksXG4gICAgfSxcbiAgICB7XG4gICAgICBOYW1lOiAnYWxsb3ctZGlzY292ZXJ5JyxcbiAgICAgIFByaW9yaXR5OiAyLFxuICAgICAgU3RhdGVtZW50OiB7XG4gICAgICAgIE9yU3RhdGVtZW50OiB7XG4gICAgICAgICAgU3RhdGVtZW50czogW3BhdGhNYXRjaCgnL21jcC8nKSwgcGF0aE1hdGNoKCcvLndlbGwta25vd24vJyldLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIEFjdGlvbjogeyBBbGxvdzoge30gfSxcbiAgICAgIFZpc2liaWxpdHlDb25maWc6IHZpcyhgJHttZXRyaWNQcmVmaXh9LWFsbG93LWRpc2NvdmVyeWApLFxuICAgIH0sXG4gIF07XG5cbiAgVElFUlMuZm9yRWFjaCgodGllciwgaSkgPT4ge1xuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgTmFtZTogYE1vbmV0aXplLSR7dGllci5uYW1lfWAsXG4gICAgICBQcmlvcml0eTogMTAgKyBpLFxuICAgICAgU3RhdGVtZW50OiBwYXRoTWF0Y2godGllci5wcmVmaXgpLFxuICAgICAgQWN0aW9uOiB7IE1vbmV0aXplOiB7IFByaWNlTXVsdGlwbGllcjogU3RyaW5nKHRpZXIubXVsdGlwbGllcikgfSB9LFxuICAgICAgVmlzaWJpbGl0eUNvbmZpZzogdmlzKGAke21ldHJpY1ByZWZpeH0tbW9uZXRpemUtJHt0aWVyLm5hbWV9YCksXG4gICAgfSk7XG4gIH0pO1xuXG4gIHJldHVybiBydWxlcztcbn1cbiJdfQ==