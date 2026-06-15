"use strict";
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9uZXRpemF0aW9uLWNvbmZpZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1vbmV0aXphdGlvbi1jb25maWcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRzs7O0FBa0ZILDBEQWFDO0FBU0QsNENBaURDO0FBdkpELDRFQUE0RTtBQUMvRCxRQUFBLGFBQWEsR0FBRyxxQ0FBcUMsQ0FBQztBQUVuRSwyRkFBMkY7QUFDOUUsUUFBQSxtQkFBbUIsR0FBRyxhQUFhLENBQUM7QUFFakQ7OztHQUdHO0FBQ1UsUUFBQSxXQUFXLEdBQUcsT0FBTyxDQUFDO0FBV25DOzs7Ozs7Ozs7R0FTRztBQUNVLFFBQUEsS0FBSyxHQUFXO0lBQzNCLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsbUJBQW1CLEVBQUUsVUFBVSxFQUFFLENBQUMsRUFBRTtJQUMvRCxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLHNCQUFzQixFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUU7SUFDbEUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEVBQUUsQ0FBQyxFQUFFO0lBQ2pFLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUU7SUFDeEQsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLENBQUMsRUFBRTtJQUNoRSxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLGtCQUFrQixFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUU7SUFDL0QsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEVBQUUsQ0FBQyxFQUFFO0lBQ3ZFLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsVUFB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QUFPLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUU7UUFDeEIsS0FBSyxDQUFDLElBQUksQ0FBQztZQUNULElBQUksRUFBRSxZQUFZLElBQUksQ0FBQyxJQUFJLEVBQUU7WUFDN0IsUUFBUSxFQUFFLEVBQUUsR0FBRyxDQUFDO1lBQ2hCLFNBQVMsRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQztZQUNqQyxNQUFNLEVBQUUsRUFBRSxRQUFRLEVBQUUsRUFBRSxlQUFlLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsRUFBRSxFQUFFO1lBQ2xFLGdCQUFnQixFQUFFLEdBQUcsQ0FBQyxHQUFHLFlBQVksYUFBYSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7U0FDL0QsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxPQUFPLEtBQUssQ0FBQztBQUNmLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE5hdGl2ZSBBV1MgV0FGIHg0MDIgbW9uZXRpemF0aW9uIGNvbmZpZyBmb3IgdGhlIHNlbGxlciBXZWJBQ0wuXG4gKlxuICogUEFSS0lORyBMT1Q6IGBNb25ldGl6YXRpb25Db25maWdgIGFuZCB0aGUgcGVyLXJ1bGUgYE1vbmV0aXplYCBhY3Rpb24gYXJlIGFuIEFXUyBXQUZcbiAqIHByZXZpZXcgY2FwYWJpbGl0eSBub3QgeWV0IHByZXNlbnQgaW4gcmVsZWFzZWQgQ2xvdWRGb3JtYXRpb24vQ0RLL1NESy4gVGhlc2UgcHVyZVxuICogYnVpbGRlcnMgcHJvZHVjZSB0aGUgaW50ZW5kZWQgZGVjbGFyYXRpdmUgc2hhcGU7IGNsb3VkZnJvbnQtc3RhY2sudHMgYXBwbGllcyB0aGVtIHRvXG4gKiB0aGUgTDEgYENmbldlYkFDTGAgdmlhIGBhZGRQcm9wZXJ0eU92ZXJyaWRlYCBzbyB0aGV5IHBhc3MgdGhyb3VnaCBDbG91ZEZvcm1hdGlvblxuICogdmVyYmF0aW0gb25jZSBzdXBwb3J0IHNoaXBzLiBVbnRpbCB0aGVuIHRoZSBXZWJBQ0wgc3ludGhlc2l6ZXMgd2l0aCBkZXRlY3Rpb24gK1xuICogYWxsb3cgcnVsZXMgb25seTsgdGhlIE1vbmV0aXplIGFjdGlvbnMvTW9uZXRpemF0aW9uQ29uZmlnIGFyZSBpbmVydCBvdmVycmlkZXMuXG4gKlxuICogUHJpY2luZyBpcyBkZXJpdmVkIGZyb20gdGhlIHJlcG8ncyBmb3JtZXIgbGliL2xhbWJkYS1lZGdlL2NvbnRlbnQtY29uZmlnLnRzIGFuZFxuICogY29uZm9ybWVkIHRvIHRoZSBBV1MgV0FGIEFJLXRyYWZmaWMtbW9uZXRpemF0aW9uIHJ1bGVzOiB0aGUgYmFzZSBwcmljZSBpcyB0aGVcbiAqIHNlcnZpY2UgbWluaW11bSBvZiAkMC4wMDEgVVNEQyAoZGVjaW1hbCBzdHJpbmcsIDw9IDMgZHApLCBhbmQgcGVyLXRpZXJcbiAqIFByaWNlTXVsdGlwbGllciByZXByb2R1Y2VzIHRoZSBvcmlnaW5hbCBwcmljZXMgKCQwLjAwMSDigJMgJDAuMDEpIG9uIEJhc2UgU2Vwb2xpYS5cbiAqIFRoZSBvcmlnaW5hbCB3ZWF0aGVyIHByaWNlICgkMC4wMDA1KSBpcyBiZWxvdyB0aGUgJDAuMDAxIHNlcnZpY2UgbWluaW11bSwgc28gaXRcbiAqIGlzIGZsb29yZWQgdG8gdGhlIGJhc2UgKMOXMSkuXG4gKiBTZWUgaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL3dhZi9sYXRlc3QvZGV2ZWxvcGVyZ3VpZGUvd2FmLWFpLXRyYWZmaWMtbW9uZXRpemF0aW9uLXByaWNpbmcuaHRtbFxuICovXG5cbi8qKiBCb3QgQ29udHJvbCBzdGFtcHMgZXZlcnkgZGV0ZWN0ZWQgYm90IHdpdGggYSBsYWJlbCBpbiB0aGlzIG5hbWVzcGFjZS4gKi9cbmV4cG9ydCBjb25zdCBCT1RfTkFNRVNQQUNFID0gJ2F3c3dhZjptYW5hZ2VkOmF3czpib3QtY29udHJvbDpib3Q6JztcblxuLyoqIFBpbm5lZCBCb3QgQ29udHJvbCBtYW5hZ2VkLXJ1bGUtZ3JvdXAgdmVyc2lvbiAoPj0gdjYgZm9yIGFnZW50aWMvQUktYm90IGRldGVjdGlvbnMpLiAqL1xuZXhwb3J0IGNvbnN0IEJPVF9DT05UUk9MX1ZFUlNJT04gPSAnVmVyc2lvbl82LjAnO1xuXG4vKipcbiAqIEJhc2UgdW5pdCBwcmljZSAoVVNEQyksIGFzIGEgZGVjaW1hbCBzdHJpbmcgd2l0aCA8PSAzIGRlY2ltYWwgcGxhY2VzLiBUaGlzIGlzIHRoZVxuICogQVdTIFdBRiBzZXJ2aWNlIG1pbmltdW0gKCQwLjAwMSBVU0RDIHBlciByZXF1ZXN0KTsgZWFjaCB0aWVyIG11bHRpcGxpZXMgaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBCQVNFX0FNT1VOVCA9ICcwLjAwMSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVGllciB7XG4gIC8qKiBTaG9ydCBuYW1lICh1c2VkIGluIHJ1bGUgbmFtZSArIG1ldHJpYykuICovXG4gIG5hbWU6IHN0cmluZztcbiAgLyoqIENsb3VkRnJvbnQtc3R5bGUgVVJJIHByZWZpeCB0aGF0IHNlbGVjdHMgdGhpcyB0aWVyIChTVEFSVFNfV0lUSCBtYXRjaCkuICovXG4gIHByZWZpeDogc3RyaW5nO1xuICAvKiogUHJpY2UgbXVsdGlwbGllciDDlyBCQVNFX0FNT1VOVC4gKi9cbiAgbXVsdGlwbGllcjogbnVtYmVyO1xufVxuXG4vKipcbiAqIFRpZXJzIG9yZGVyZWQgbW9zdC1zcGVjaWZpYy1maXJzdC4gVGhlIG9yaWdpbmFsIHJlcG8gcHJpY2VkIGJvdGggYmFyZSBhbmRcbiAqIC9hcGktcHJlZml4ZWQgdmFyaWFudHMgaWRlbnRpY2FsbHksIHNvIGVhY2ggdGllciBsaXN0cyBpdHMgbWF0Y2hlZCBwcmVmaXg7IHRoZVxuICogY2hlYXBlc3QgY2F0Y2ggKHdlYXRoZXIpIGFuZCB0aGUgZXhwbGljaXQgY29udGVudCBwcmVmaXhlcyBhcmUgZGlzdGluY3QgcnVsZXMuXG4gKlxuICogTXVsdGlwbGllcnMgcmVwcm9kdWNlIHRoZSBvcmlnaW5hbCBVU0RDIHByaWNlcyBvZmYgdGhlICQwLjAwMSBiYXNlOlxuICogICB3ZWF0aGVyICQwLjAwMDUg4oaSIGZsb29yZWQgdG8gJDAuMDAxICjDlzEsIHRoZSBzZXJ2aWNlIG1pbmltdW0pXG4gKiAgIGFydGljbGUgJDAuMDAxICjDlzEpLCBtYXJrZXQgJDAuMDAyICjDlzIpLCB0dXRvcmlhbCAkMC4wMDMgKMOXMyksXG4gKiAgIHJlc2VhcmNoICQwLjAwNSAow5c1KSwgZGF0YXNldCAkMC4wMSAow5cxMCkuXG4gKi9cbmV4cG9ydCBjb25zdCBUSUVSUzogVGllcltdID0gW1xuICB7IG5hbWU6ICd3ZWF0aGVyJywgcHJlZml4OiAnL2FwaS93ZWF0aGVyLWRhdGEnLCBtdWx0aXBsaWVyOiAxIH0sXG4gIHsgbmFtZTogJ2FydGljbGUnLCBwcmVmaXg6ICcvYXBpL3ByZW1pdW0tYXJ0aWNsZScsIG11bHRpcGxpZXI6IDEgfSxcbiAgeyBuYW1lOiAnbWFya2V0JywgcHJlZml4OiAnL2FwaS9tYXJrZXQtYW5hbHlzaXMnLCBtdWx0aXBsaWVyOiAyIH0sXG4gIHsgbmFtZTogJ3R1dG9yaWFsJywgcHJlZml4OiAnL3R1dG9yaWFsJywgbXVsdGlwbGllcjogMyB9LFxuICB7IG5hbWU6ICdhcGktdHV0b3JpYWwnLCBwcmVmaXg6ICcvYXBpL3R1dG9yaWFsJywgbXVsdGlwbGllcjogMyB9LFxuICB7IG5hbWU6ICdyZXNlYXJjaCcsIHByZWZpeDogJy9yZXNlYXJjaC1yZXBvcnQnLCBtdWx0aXBsaWVyOiA1IH0sXG4gIHsgbmFtZTogJ2FwaS1yZXNlYXJjaCcsIHByZWZpeDogJy9hcGkvcmVzZWFyY2gtcmVwb3J0JywgbXVsdGlwbGllcjogNSB9LFxuICB7IG5hbWU6ICdkYXRhc2V0JywgcHJlZml4OiAnL2RhdGFzZXQnLCBtdWx0aXBsaWVyOiAxMCB9LFxuICB7IG5hbWU6ICdhcGktZGF0YXNldCcsIHByZWZpeDogJy9hcGkvZGF0YXNldCcsIG11bHRpcGxpZXI6IDEwIH0sXG5dO1xuXG5pbnRlcmZhY2UgVmlzaWJpbGl0eUNvbmZpZyB7XG4gIFNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IGJvb2xlYW47XG4gIENsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogYm9vbGVhbjtcbiAgTWV0cmljTmFtZTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFdlYkFjbFJ1bGUge1xuICBOYW1lOiBzdHJpbmc7XG4gIFByaW9yaXR5OiBudW1iZXI7XG4gIFN0YXRlbWVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIEFjdGlvbj86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBPdmVycmlkZUFjdGlvbj86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBSdWxlTGFiZWxzPzogeyBOYW1lOiBzdHJpbmcgfVtdO1xuICBWaXNpYmlsaXR5Q29uZmlnOiBWaXNpYmlsaXR5Q29uZmlnO1xufVxuXG5mdW5jdGlvbiB2aXMobWV0cmljTmFtZTogc3RyaW5nKTogVmlzaWJpbGl0eUNvbmZpZyB7XG4gIHJldHVybiB7IFNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsIENsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSwgTWV0cmljTmFtZTogbWV0cmljTmFtZSB9O1xufVxuXG4vKiogU1RBUlRTX1dJVEggVXJpUGF0aCBtYXRjaCAoU2VhcmNoU3RyaW5nIGJhc2U2NC1lbmNvZGVkIHBlciB0aGUgV0FGIEpTT04gY29udHJhY3QpLiAqL1xuZnVuY3Rpb24gcGF0aE1hdGNoKHByZWZpeDogc3RyaW5nKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4ge1xuICAgIEJ5dGVNYXRjaFN0YXRlbWVudDoge1xuICAgICAgU2VhcmNoU3RyaW5nOiBCdWZmZXIuZnJvbShwcmVmaXgpLnRvU3RyaW5nKCdiYXNlNjQnKSxcbiAgICAgIEZpZWxkVG9NYXRjaDogeyBVcmlQYXRoOiB7fSB9LFxuICAgICAgVGV4dFRyYW5zZm9ybWF0aW9uczogW3sgUHJpb3JpdHk6IDAsIFR5cGU6ICdOT05FJyB9XSxcbiAgICAgIFBvc2l0aW9uYWxDb25zdHJhaW50OiAnU1RBUlRTX1dJVEgnLFxuICAgIH0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIGJvdE5hbWVzcGFjZU1hdGNoKCk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHsgTGFiZWxNYXRjaFN0YXRlbWVudDogeyBTY29wZTogJ05BTUVTUEFDRScsIEtleTogQk9UX05BTUVTUEFDRSB9IH07XG59XG5cbi8qKiBXZWJBQ0wtbGV2ZWwgTW9uZXRpemF0aW9uQ29uZmlnOiBwYXllZSB3YWxsZXQsIGNoYWluLCBiYXNlIHByaWNlLCBtb2RlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkTW9uZXRpemF0aW9uQ29uZmlnKHdhbGxldEFkZHJlc3M6IHN0cmluZyk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHtcbiAgICBDcnlwdG9Db25maWc6IHtcbiAgICAgIFBheW1lbnROZXR3b3JrczogW1xuICAgICAgICB7XG4gICAgICAgICAgQ2hhaW46ICdCQVNFX1NFUE9MSUEnLFxuICAgICAgICAgIFdhbGxldEFkZHJlc3M6IHdhbGxldEFkZHJlc3MsXG4gICAgICAgICAgUHJpY2VzOiBbeyBBbW91bnQ6IEJBU0VfQU1PVU5ULCBDdXJyZW5jeTogJ1VTREMnIH1dLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9LFxuICAgIEN1cnJlbmN5TW9kZTogJ1RFU1QnLFxuICB9O1xufVxuXG4vKipcbiAqIEZ1bGwgV2ViQUNMIHJ1bGUgYXJyYXk6XG4gKiAgIDAgIEFXU0JvdENvbnRyb2wgICAgICAgKG1hbmFnZWQsIENvdW50L2RldGVjdClcbiAqICAgMSAgaHVtYW4tYWxsb3cgICAgICAgICAoTk9UIGJvdCDihpIgQWxsb3csIHRlcm1pbmF0aW5nKVxuICogICAyICBhbGxvdy1kaXNjb3ZlcnkgICAgICgvbWNwLyArIC8ud2VsbC1rbm93bi8g4oaSIEFsbG93LCB0ZXJtaW5hdGluZylcbiAqICAgMTArIE1vbmV0aXplLTx0aWVyPiAgICAoYm90cyByZWFjaGluZyBoZXJlIHBheSBiYXNlIMOXIG11bHRpcGxpZXIpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFdlYkFjbFJ1bGVzKG1ldHJpY1ByZWZpeDogc3RyaW5nKTogV2ViQWNsUnVsZVtdIHtcbiAgY29uc3QgcnVsZXM6IFdlYkFjbFJ1bGVbXSA9IFtcbiAgICB7XG4gICAgICBOYW1lOiAnQVdTQm90Q29udHJvbCcsXG4gICAgICBQcmlvcml0eTogMCxcbiAgICAgIFN0YXRlbWVudDoge1xuICAgICAgICBNYW5hZ2VkUnVsZUdyb3VwU3RhdGVtZW50OiB7XG4gICAgICAgICAgVmVuZG9yTmFtZTogJ0FXUycsXG4gICAgICAgICAgTmFtZTogJ0FXU01hbmFnZWRSdWxlc0JvdENvbnRyb2xSdWxlU2V0JyxcbiAgICAgICAgICBWZXJzaW9uOiBCT1RfQ09OVFJPTF9WRVJTSU9OLFxuICAgICAgICAgIE1hbmFnZWRSdWxlR3JvdXBDb25maWdzOiBbXG4gICAgICAgICAgICB7IEFXU01hbmFnZWRSdWxlc0JvdENvbnRyb2xSdWxlU2V0OiB7IEluc3BlY3Rpb25MZXZlbDogJ0NPTU1PTicgfSB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgT3ZlcnJpZGVBY3Rpb246IHsgQ291bnQ6IHt9IH0sXG4gICAgICBWaXNpYmlsaXR5Q29uZmlnOiB2aXMoYCR7bWV0cmljUHJlZml4fS1ib3QtY29udHJvbGApLFxuICAgIH0sXG4gICAge1xuICAgICAgTmFtZTogJ2h1bWFuLWFsbG93JyxcbiAgICAgIFByaW9yaXR5OiAxLFxuICAgICAgU3RhdGVtZW50OiB7IE5vdFN0YXRlbWVudDogeyBTdGF0ZW1lbnQ6IGJvdE5hbWVzcGFjZU1hdGNoKCkgfSB9LFxuICAgICAgQWN0aW9uOiB7IEFsbG93OiB7fSB9LFxuICAgICAgVmlzaWJpbGl0eUNvbmZpZzogdmlzKGAke21ldHJpY1ByZWZpeH0taHVtYW4tYWxsb3dgKSxcbiAgICB9LFxuICAgIHtcbiAgICAgIE5hbWU6ICdhbGxvdy1kaXNjb3ZlcnknLFxuICAgICAgUHJpb3JpdHk6IDIsXG4gICAgICBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgT3JTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICBTdGF0ZW1lbnRzOiBbcGF0aE1hdGNoKCcvbWNwLycpLCBwYXRoTWF0Y2goJy8ud2VsbC1rbm93bi8nKV0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgQWN0aW9uOiB7IEFsbG93OiB7fSB9LFxuICAgICAgVmlzaWJpbGl0eUNvbmZpZzogdmlzKGAke21ldHJpY1ByZWZpeH0tYWxsb3ctZGlzY292ZXJ5YCksXG4gICAgfSxcbiAgXTtcblxuICBUSUVSUy5mb3JFYWNoKCh0aWVyLCBpKSA9PiB7XG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBOYW1lOiBgTW9uZXRpemUtJHt0aWVyLm5hbWV9YCxcbiAgICAgIFByaW9yaXR5OiAxMCArIGksXG4gICAgICBTdGF0ZW1lbnQ6IHBhdGhNYXRjaCh0aWVyLnByZWZpeCksXG4gICAgICBBY3Rpb246IHsgTW9uZXRpemU6IHsgUHJpY2VNdWx0aXBsaWVyOiBTdHJpbmcodGllci5tdWx0aXBsaWVyKSB9IH0sXG4gICAgICBWaXNpYmlsaXR5Q29uZmlnOiB2aXMoYCR7bWV0cmljUHJlZml4fS1tb25ldGl6ZS0ke3RpZXIubmFtZX1gKSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJ1bGVzO1xufVxuIl19