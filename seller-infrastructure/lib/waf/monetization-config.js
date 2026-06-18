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
/**
 * STARTS_WITH UriPath match. In the CloudFormation/L1 (`CfnWebACL`) representation,
 * `SearchString` is the PLAIN string — CloudFormation base64-encodes it for the WAF
 * API itself. (Encoding it here too would double-encode: WAF would search for the
 * literal base64 text and never match. Verified against a live deploy.)
 */
function pathMatch(prefix) {
    return {
        ByteMatchStatement: {
            SearchString: prefix,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9uZXRpemF0aW9uLWNvbmZpZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1vbmV0aXphdGlvbi1jb25maWcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRzs7O0FBdUZILDBEQWFDO0FBU0QsNENBaURDO0FBNUpELDRFQUE0RTtBQUMvRCxRQUFBLGFBQWEsR0FBRyxxQ0FBcUMsQ0FBQztBQUVuRSwyRkFBMkY7QUFDOUUsUUFBQSxtQkFBbUIsR0FBRyxhQUFhLENBQUM7QUFFakQ7OztHQUdHO0FBQ1UsUUFBQSxXQUFXLEdBQUcsT0FBTyxDQUFDO0FBV25DOzs7Ozs7Ozs7R0FTRztBQUNVLFFBQUEsS0FBSyxHQUFXO0lBQzNCLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsbUJBQW1CLEVBQUUsVUFBVSxFQUFFLENBQUMsRUFBRTtJQUMvRCxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLHNCQUFzQixFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUU7SUFDbEUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEVBQUUsQ0FBQyxFQUFFO0lBQ2pFLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUU7SUFDeEQsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLENBQUMsRUFBRTtJQUNoRSxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLGtCQUFrQixFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUU7SUFDL0QsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEVBQUUsQ0FBQyxFQUFFO0lBQ3ZFLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsVUFB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LENBQUMsSUFBSSxDQUFDO1lBQ1QsSUFBSSxFQUFFLFlBQVksSUFBSSxDQUFDLElBQUksRUFBRTtZQUM3QixRQUFRLEVBQUUsRUFBRSxHQUFHLENBQUM7WUFDaEIsU0FBUyxFQUFFLFNBQVMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDO1lBQ2pDLE1BQU0sRUFBRSxFQUFFLFFBQVEsRUFBRSxFQUFFLGVBQWUsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxFQUFFLEVBQUU7WUFDbEUsZ0JBQWdCLEVBQUUsR0FBRyxDQUFDLEdBQUcsWUFBWSxhQUFhLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztTQUMvRCxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTmF0aXZlIEFXUyBXQUYgeDQwMiBtb25ldGl6YXRpb24gY29uZmlnIGZvciB0aGUgc2VsbGVyIFdlYkFDTC5cbiAqXG4gKiBOT1RFOiBBV1MgV0FGIEFJIHRyYWZmaWMgbW9uZXRpemF0aW9uIGlzIEdBLCBidXQgaXRzIGBNb25ldGl6YXRpb25Db25maWdgIGFuZCB0aGVcbiAqIHBlci1ydWxlIGBNb25ldGl6ZWAgYWN0aW9uIGFyZSBub3QgeWV0IG1vZGVsZWQgaW4gdGhlIHJlbGVhc2VkIENsb3VkRm9ybWF0aW9uL0NESy9TREtcbiAqIChzdXBwb3J0IGlzIGV4cGVjdGVkIHRvIGZvbGxvdyBzaG9ydGx5KS4gVGhlc2UgcHVyZSBidWlsZGVycyBwcm9kdWNlIHRoZSBkZWNsYXJhdGl2ZVxuICogc2hhcGU7IGNsb3VkZnJvbnQtc3RhY2sudHMgYXBwbGllcyB0aGVtIHRvIHRoZSBMMSBgQ2ZuV2ViQUNMYCB2aWEgYGFkZFByb3BlcnR5T3ZlcnJpZGVgXG4gKiBzbyB0aGV5IHBhc3MgdGhyb3VnaCBDbG91ZEZvcm1hdGlvbiB2ZXJiYXRpbS4gVGhlIHR5cGVkIENESyBwcm9wcyBkb24ndCBtb2RlbCB0aGVcbiAqIGZpZWxkcyB5ZXQsIHNvIHRoZSBvdmVycmlkZSBpcyB0aGUgc3VwcG9ydGVkIHdheSB0byBzZXQgdGhlbSB1bnRpbCB0aGV5IGxhbmQuXG4gKlxuICogUHJpY2luZyBpcyBkZXJpdmVkIGZyb20gdGhlIHJlcG8ncyBmb3JtZXIgbGliL2xhbWJkYS1lZGdlL2NvbnRlbnQtY29uZmlnLnRzIGFuZFxuICogY29uZm9ybWVkIHRvIHRoZSBBV1MgV0FGIEFJLXRyYWZmaWMtbW9uZXRpemF0aW9uIHJ1bGVzOiB0aGUgYmFzZSBwcmljZSBpcyB0aGVcbiAqIHNlcnZpY2UgbWluaW11bSBvZiAkMC4wMDEgVVNEQyAoZGVjaW1hbCBzdHJpbmcsIDw9IDMgZHApLCBhbmQgcGVyLXRpZXJcbiAqIFByaWNlTXVsdGlwbGllciByZXByb2R1Y2VzIHRoZSBvcmlnaW5hbCBwcmljZXMgKCQwLjAwMSDigJMgJDAuMDEpIG9uIEJhc2UgU2Vwb2xpYS5cbiAqIFRoZSBvcmlnaW5hbCB3ZWF0aGVyIHByaWNlICgkMC4wMDA1KSBpcyBiZWxvdyB0aGUgJDAuMDAxIHNlcnZpY2UgbWluaW11bSwgc28gaXRcbiAqIGlzIGZsb29yZWQgdG8gdGhlIGJhc2UgKMOXMSkuXG4gKiBTZWUgaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL3dhZi9sYXRlc3QvZGV2ZWxvcGVyZ3VpZGUvd2FmLWFpLXRyYWZmaWMtbW9uZXRpemF0aW9uLXByaWNpbmcuaHRtbFxuICovXG5cbi8qKiBCb3QgQ29udHJvbCBzdGFtcHMgZXZlcnkgZGV0ZWN0ZWQgYm90IHdpdGggYSBsYWJlbCBpbiB0aGlzIG5hbWVzcGFjZS4gKi9cbmV4cG9ydCBjb25zdCBCT1RfTkFNRVNQQUNFID0gJ2F3c3dhZjptYW5hZ2VkOmF3czpib3QtY29udHJvbDpib3Q6JztcblxuLyoqIFBpbm5lZCBCb3QgQ29udHJvbCBtYW5hZ2VkLXJ1bGUtZ3JvdXAgdmVyc2lvbiAoPj0gdjYgZm9yIGFnZW50aWMvQUktYm90IGRldGVjdGlvbnMpLiAqL1xuZXhwb3J0IGNvbnN0IEJPVF9DT05UUk9MX1ZFUlNJT04gPSAnVmVyc2lvbl82LjAnO1xuXG4vKipcbiAqIEJhc2UgdW5pdCBwcmljZSAoVVNEQyksIGFzIGEgZGVjaW1hbCBzdHJpbmcgd2l0aCA8PSAzIGRlY2ltYWwgcGxhY2VzLiBUaGlzIGlzIHRoZVxuICogQVdTIFdBRiBzZXJ2aWNlIG1pbmltdW0gKCQwLjAwMSBVU0RDIHBlciByZXF1ZXN0KTsgZWFjaCB0aWVyIG11bHRpcGxpZXMgaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBCQVNFX0FNT1VOVCA9ICcwLjAwMSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVGllciB7XG4gIC8qKiBTaG9ydCBuYW1lICh1c2VkIGluIHJ1bGUgbmFtZSArIG1ldHJpYykuICovXG4gIG5hbWU6IHN0cmluZztcbiAgLyoqIENsb3VkRnJvbnQtc3R5bGUgVVJJIHByZWZpeCB0aGF0IHNlbGVjdHMgdGhpcyB0aWVyIChTVEFSVFNfV0lUSCBtYXRjaCkuICovXG4gIHByZWZpeDogc3RyaW5nO1xuICAvKiogUHJpY2UgbXVsdGlwbGllciDDlyBCQVNFX0FNT1VOVC4gKi9cbiAgbXVsdGlwbGllcjogbnVtYmVyO1xufVxuXG4vKipcbiAqIFRpZXJzIG9yZGVyZWQgbW9zdC1zcGVjaWZpYy1maXJzdC4gVGhlIG9yaWdpbmFsIHJlcG8gcHJpY2VkIGJvdGggYmFyZSBhbmRcbiAqIC9hcGktcHJlZml4ZWQgdmFyaWFudHMgaWRlbnRpY2FsbHksIHNvIGVhY2ggdGllciBsaXN0cyBpdHMgbWF0Y2hlZCBwcmVmaXg7IHRoZVxuICogY2hlYXBlc3QgY2F0Y2ggKHdlYXRoZXIpIGFuZCB0aGUgZXhwbGljaXQgY29udGVudCBwcmVmaXhlcyBhcmUgZGlzdGluY3QgcnVsZXMuXG4gKlxuICogTXVsdGlwbGllcnMgcmVwcm9kdWNlIHRoZSBvcmlnaW5hbCBVU0RDIHByaWNlcyBvZmYgdGhlICQwLjAwMSBiYXNlOlxuICogICB3ZWF0aGVyICQwLjAwMDUg4oaSIGZsb29yZWQgdG8gJDAuMDAxICjDlzEsIHRoZSBzZXJ2aWNlIG1pbmltdW0pXG4gKiAgIGFydGljbGUgJDAuMDAxICjDlzEpLCBtYXJrZXQgJDAuMDAyICjDlzIpLCB0dXRvcmlhbCAkMC4wMDMgKMOXMyksXG4gKiAgIHJlc2VhcmNoICQwLjAwNSAow5c1KSwgZGF0YXNldCAkMC4wMSAow5cxMCkuXG4gKi9cbmV4cG9ydCBjb25zdCBUSUVSUzogVGllcltdID0gW1xuICB7IG5hbWU6ICd3ZWF0aGVyJywgcHJlZml4OiAnL2FwaS93ZWF0aGVyLWRhdGEnLCBtdWx0aXBsaWVyOiAxIH0sXG4gIHsgbmFtZTogJ2FydGljbGUnLCBwcmVmaXg6ICcvYXBpL3ByZW1pdW0tYXJ0aWNsZScsIG11bHRpcGxpZXI6IDEgfSxcbiAgeyBuYW1lOiAnbWFya2V0JywgcHJlZml4OiAnL2FwaS9tYXJrZXQtYW5hbHlzaXMnLCBtdWx0aXBsaWVyOiAyIH0sXG4gIHsgbmFtZTogJ3R1dG9yaWFsJywgcHJlZml4OiAnL3R1dG9yaWFsJywgbXVsdGlwbGllcjogMyB9LFxuICB7IG5hbWU6ICdhcGktdHV0b3JpYWwnLCBwcmVmaXg6ICcvYXBpL3R1dG9yaWFsJywgbXVsdGlwbGllcjogMyB9LFxuICB7IG5hbWU6ICdyZXNlYXJjaCcsIHByZWZpeDogJy9yZXNlYXJjaC1yZXBvcnQnLCBtdWx0aXBsaWVyOiA1IH0sXG4gIHsgbmFtZTogJ2FwaS1yZXNlYXJjaCcsIHByZWZpeDogJy9hcGkvcmVzZWFyY2gtcmVwb3J0JywgbXVsdGlwbGllcjogNSB9LFxuICB7IG5hbWU6ICdkYXRhc2V0JywgcHJlZml4OiAnL2RhdGFzZXQnLCBtdWx0aXBsaWVyOiAxMCB9LFxuICB7IG5hbWU6ICdhcGktZGF0YXNldCcsIHByZWZpeDogJy9hcGkvZGF0YXNldCcsIG11bHRpcGxpZXI6IDEwIH0sXG5dO1xuXG5pbnRlcmZhY2UgVmlzaWJpbGl0eUNvbmZpZyB7XG4gIFNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IGJvb2xlYW47XG4gIENsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogYm9vbGVhbjtcbiAgTWV0cmljTmFtZTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFdlYkFjbFJ1bGUge1xuICBOYW1lOiBzdHJpbmc7XG4gIFByaW9yaXR5OiBudW1iZXI7XG4gIFN0YXRlbWVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIEFjdGlvbj86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBPdmVycmlkZUFjdGlvbj86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBSdWxlTGFiZWxzPzogeyBOYW1lOiBzdHJpbmcgfVtdO1xuICBWaXNpYmlsaXR5Q29uZmlnOiBWaXNpYmlsaXR5Q29uZmlnO1xufVxuXG5mdW5jdGlvbiB2aXMobWV0cmljTmFtZTogc3RyaW5nKTogVmlzaWJpbGl0eUNvbmZpZyB7XG4gIHJldHVybiB7IFNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsIENsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSwgTWV0cmljTmFtZTogbWV0cmljTmFtZSB9O1xufVxuXG4vKipcbiAqIFNUQVJUU19XSVRIIFVyaVBhdGggbWF0Y2guIEluIHRoZSBDbG91ZEZvcm1hdGlvbi9MMSAoYENmbldlYkFDTGApIHJlcHJlc2VudGF0aW9uLFxuICogYFNlYXJjaFN0cmluZ2AgaXMgdGhlIFBMQUlOIHN0cmluZyDigJQgQ2xvdWRGb3JtYXRpb24gYmFzZTY0LWVuY29kZXMgaXQgZm9yIHRoZSBXQUZcbiAqIEFQSSBpdHNlbGYuIChFbmNvZGluZyBpdCBoZXJlIHRvbyB3b3VsZCBkb3VibGUtZW5jb2RlOiBXQUYgd291bGQgc2VhcmNoIGZvciB0aGVcbiAqIGxpdGVyYWwgYmFzZTY0IHRleHQgYW5kIG5ldmVyIG1hdGNoLiBWZXJpZmllZCBhZ2FpbnN0IGEgbGl2ZSBkZXBsb3kuKVxuICovXG5mdW5jdGlvbiBwYXRoTWF0Y2gocHJlZml4OiBzdHJpbmcpOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB7XG4gICAgQnl0ZU1hdGNoU3RhdGVtZW50OiB7XG4gICAgICBTZWFyY2hTdHJpbmc6IHByZWZpeCxcbiAgICAgIEZpZWxkVG9NYXRjaDogeyBVcmlQYXRoOiB7fSB9LFxuICAgICAgVGV4dFRyYW5zZm9ybWF0aW9uczogW3sgUHJpb3JpdHk6IDAsIFR5cGU6ICdOT05FJyB9XSxcbiAgICAgIFBvc2l0aW9uYWxDb25zdHJhaW50OiAnU1RBUlRTX1dJVEgnLFxuICAgIH0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIGJvdE5hbWVzcGFjZU1hdGNoKCk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHsgTGFiZWxNYXRjaFN0YXRlbWVudDogeyBTY29wZTogJ05BTUVTUEFDRScsIEtleTogQk9UX05BTUVTUEFDRSB9IH07XG59XG5cbi8qKiBXZWJBQ0wtbGV2ZWwgTW9uZXRpemF0aW9uQ29uZmlnOiBwYXllZSB3YWxsZXQsIGNoYWluLCBiYXNlIHByaWNlLCBtb2RlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkTW9uZXRpemF0aW9uQ29uZmlnKHdhbGxldEFkZHJlc3M6IHN0cmluZyk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHtcbiAgICBDcnlwdG9Db25maWc6IHtcbiAgICAgIFBheW1lbnROZXR3b3JrczogW1xuICAgICAgICB7XG4gICAgICAgICAgQ2hhaW46ICdCQVNFX1NFUE9MSUEnLFxuICAgICAgICAgIFdhbGxldEFkZHJlc3M6IHdhbGxldEFkZHJlc3MsXG4gICAgICAgICAgUHJpY2VzOiBbeyBBbW91bnQ6IEJBU0VfQU1PVU5ULCBDdXJyZW5jeTogJ1VTREMnIH1dLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9LFxuICAgIEN1cnJlbmN5TW9kZTogJ1RFU1QnLFxuICB9O1xufVxuXG4vKipcbiAqIEZ1bGwgV2ViQUNMIHJ1bGUgYXJyYXk6XG4gKiAgIDAgIEFXU0JvdENvbnRyb2wgICAgICAgKG1hbmFnZWQsIENvdW50L2RldGVjdClcbiAqICAgMSAgaHVtYW4tYWxsb3cgICAgICAgICAoTk9UIGJvdCDihpIgQWxsb3csIHRlcm1pbmF0aW5nKVxuICogICAyICBhbGxvdy1kaXNjb3ZlcnkgICAgICgvbWNwLyArIC8ud2VsbC1rbm93bi8g4oaSIEFsbG93LCB0ZXJtaW5hdGluZylcbiAqICAgMTArIE1vbmV0aXplLTx0aWVyPiAgICAoYm90cyByZWFjaGluZyBoZXJlIHBheSBiYXNlIMOXIG11bHRpcGxpZXIpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFdlYkFjbFJ1bGVzKG1ldHJpY1ByZWZpeDogc3RyaW5nKTogV2ViQWNsUnVsZVtdIHtcbiAgY29uc3QgcnVsZXM6IFdlYkFjbFJ1bGVbXSA9IFtcbiAgICB7XG4gICAgICBOYW1lOiAnQVdTQm90Q29udHJvbCcsXG4gICAgICBQcmlvcml0eTogMCxcbiAgICAgIFN0YXRlbWVudDoge1xuICAgICAgICBNYW5hZ2VkUnVsZUdyb3VwU3RhdGVtZW50OiB7XG4gICAgICAgICAgVmVuZG9yTmFtZTogJ0FXUycsXG4gICAgICAgICAgTmFtZTogJ0FXU01hbmFnZWRSdWxlc0JvdENvbnRyb2xSdWxlU2V0JyxcbiAgICAgICAgICBWZXJzaW9uOiBCT1RfQ09OVFJPTF9WRVJTSU9OLFxuICAgICAgICAgIE1hbmFnZWRSdWxlR3JvdXBDb25maWdzOiBbXG4gICAgICAgICAgICB7IEFXU01hbmFnZWRSdWxlc0JvdENvbnRyb2xSdWxlU2V0OiB7IEluc3BlY3Rpb25MZXZlbDogJ0NPTU1PTicgfSB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgT3ZlcnJpZGVBY3Rpb246IHsgQ291bnQ6IHt9IH0sXG4gICAgICBWaXNpYmlsaXR5Q29uZmlnOiB2aXMoYCR7bWV0cmljUHJlZml4fS1ib3QtY29udHJvbGApLFxuICAgIH0sXG4gICAge1xuICAgICAgTmFtZTogJ2h1bWFuLWFsbG93JyxcbiAgICAgIFByaW9yaXR5OiAxLFxuICAgICAgU3RhdGVtZW50OiB7IE5vdFN0YXRlbWVudDogeyBTdGF0ZW1lbnQ6IGJvdE5hbWVzcGFjZU1hdGNoKCkgfSB9LFxuICAgICAgQWN0aW9uOiB7IEFsbG93OiB7fSB9LFxuICAgICAgVmlzaWJpbGl0eUNvbmZpZzogdmlzKGAke21ldHJpY1ByZWZpeH0taHVtYW4tYWxsb3dgKSxcbiAgICB9LFxuICAgIHtcbiAgICAgIE5hbWU6ICdhbGxvdy1kaXNjb3ZlcnknLFxuICAgICAgUHJpb3JpdHk6IDIsXG4gICAgICBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgT3JTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICBTdGF0ZW1lbnRzOiBbcGF0aE1hdGNoKCcvbWNwLycpLCBwYXRoTWF0Y2goJy8ud2VsbC1rbm93bi8nKV0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgQWN0aW9uOiB7IEFsbG93OiB7fSB9LFxuICAgICAgVmlzaWJpbGl0eUNvbmZpZzogdmlzKGAke21ldHJpY1ByZWZpeH0tYWxsb3ctZGlzY292ZXJ5YCksXG4gICAgfSxcbiAgXTtcblxuICBUSUVSUy5mb3JFYWNoKCh0aWVyLCBpKSA9PiB7XG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBOYW1lOiBgTW9uZXRpemUtJHt0aWVyLm5hbWV9YCxcbiAgICAgIFByaW9yaXR5OiAxMCArIGksXG4gICAgICBTdGF0ZW1lbnQ6IHBhdGhNYXRjaCh0aWVyLnByZWZpeCksXG4gICAgICBBY3Rpb246IHsgTW9uZXRpemU6IHsgUHJpY2VNdWx0aXBsaWVyOiBTdHJpbmcodGllci5tdWx0aXBsaWVyKSB9IH0sXG4gICAgICBWaXNpYmlsaXR5Q29uZmlnOiB2aXMoYCR7bWV0cmljUHJlZml4fS1tb25ldGl6ZS0ke3RpZXIubmFtZX1gKSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJ1bGVzO1xufVxuIl19