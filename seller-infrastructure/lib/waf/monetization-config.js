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
 * Pricing is derived from the repo's former lib/lambda-edge/content-config.ts:
 * base $0.0005 USDC on Base Sepolia, per-tier PriceMultiplier reproduces the six
 * original prices ($0.0005 – $0.01).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIERS = exports.BASE_AMOUNT = exports.BOT_CONTROL_VERSION = exports.BOT_NAMESPACE = void 0;
exports.buildMonetizationConfig = buildMonetizationConfig;
exports.buildWebAclRules = buildWebAclRules;
/** Bot Control stamps every detected bot with a label in this namespace. */
exports.BOT_NAMESPACE = 'awswaf:managed:aws:bot-control:bot:';
/** Pinned Bot Control managed-rule-group version (>= v6 for agentic/AI-bot detections). */
exports.BOT_CONTROL_VERSION = 'Version_6.0';
/** Base unit price (USDC). Each tier multiplies this. */
exports.BASE_AMOUNT = '0.0005';
/**
 * Tiers ordered most-specific-first. The original repo priced both bare and
 * /api-prefixed variants identically, so each tier lists its matched prefix; the
 * cheapest catch (weather) and the explicit content prefixes are distinct rules.
 */
exports.TIERS = [
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9uZXRpemF0aW9uLWNvbmZpZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1vbmV0aXphdGlvbi1jb25maWcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7O0dBYUc7OztBQTBFSCwwREFhQztBQVNELDRDQWlEQztBQS9JRCw0RUFBNEU7QUFDL0QsUUFBQSxhQUFhLEdBQUcscUNBQXFDLENBQUM7QUFFbkUsMkZBQTJGO0FBQzlFLFFBQUEsbUJBQW1CLEdBQUcsYUFBYSxDQUFDO0FBRWpELHlEQUF5RDtBQUM1QyxRQUFBLFdBQVcsR0FBRyxRQUFRLENBQUM7QUFXcEM7Ozs7R0FJRztBQUNVLFFBQUEsS0FBSyxHQUFXO0lBQzNCLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsbUJBQW1CLEVBQUUsVUFBVSxFQUFFLENBQUMsRUFBRTtJQUMvRCxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLHNCQUFzQixFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUU7SUFDbEUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEVBQUUsQ0FBQyxFQUFFO0lBQ2pFLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUU7SUFDeEQsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLENBQUMsRUFBRTtJQUNoRSxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLGtCQUFrQixFQUFFLFVBQVUsRUFBRSxFQUFFLEVBQUU7SUFDaEUsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEVBQUUsRUFBRSxFQUFFO0lBQ3hFLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsVUFBVSxFQUFFLFVB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Q0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUU7UUFDeEIsS0FBSyxDQUFDLElBQUksQ0FBQztZQUNULElBQUksRUFBRSxZQUFZLElBQUksQ0FBQyxJQUFJLEVBQUU7WUFDN0IsUUFBUSxFQUFFLEVBQUUsR0FBRyxDQUFDO1lBQ2hCLFNBQVMsRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQztZQUNqQyxNQUFNLEVBQUUsRUFBRSxRQUFRLEVBQUUsRUFBRSxlQUFlLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsRUFBRSxFQUFFO1lBQ2xFLGdCQUFnQixFQUFFLEdBQUcsQ0FBQyxHQUFHLFlBQVksYUFBYSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7U0FDL0QsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxPQUFPLEtBQUssQ0FBQztBQUNmLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE5hdGl2ZSBBV1MgV0FGIHg0MDIgbW9uZXRpemF0aW9uIGNvbmZpZyBmb3IgdGhlIHNlbGxlciBXZWJBQ0wuXG4gKlxuICogUEFSS0lORyBMT1Q6IGBNb25ldGl6YXRpb25Db25maWdgIGFuZCB0aGUgcGVyLXJ1bGUgYE1vbmV0aXplYCBhY3Rpb24gYXJlIGFuIEFXUyBXQUZcbiAqIHByZXZpZXcgY2FwYWJpbGl0eSBub3QgeWV0IHByZXNlbnQgaW4gcmVsZWFzZWQgQ2xvdWRGb3JtYXRpb24vQ0RLL1NESy4gVGhlc2UgcHVyZVxuICogYnVpbGRlcnMgcHJvZHVjZSB0aGUgaW50ZW5kZWQgZGVjbGFyYXRpdmUgc2hhcGU7IGNsb3VkZnJvbnQtc3RhY2sudHMgYXBwbGllcyB0aGVtIHRvXG4gKiB0aGUgTDEgYENmbldlYkFDTGAgdmlhIGBhZGRQcm9wZXJ0eU92ZXJyaWRlYCBzbyB0aGV5IHBhc3MgdGhyb3VnaCBDbG91ZEZvcm1hdGlvblxuICogdmVyYmF0aW0gb25jZSBzdXBwb3J0IHNoaXBzLiBVbnRpbCB0aGVuIHRoZSBXZWJBQ0wgc3ludGhlc2l6ZXMgd2l0aCBkZXRlY3Rpb24gK1xuICogYWxsb3cgcnVsZXMgb25seTsgdGhlIE1vbmV0aXplIGFjdGlvbnMvTW9uZXRpemF0aW9uQ29uZmlnIGFyZSBpbmVydCBvdmVycmlkZXMuXG4gKlxuICogUHJpY2luZyBpcyBkZXJpdmVkIGZyb20gdGhlIHJlcG8ncyBmb3JtZXIgbGliL2xhbWJkYS1lZGdlL2NvbnRlbnQtY29uZmlnLnRzOlxuICogYmFzZSAkMC4wMDA1IFVTREMgb24gQmFzZSBTZXBvbGlhLCBwZXItdGllciBQcmljZU11bHRpcGxpZXIgcmVwcm9kdWNlcyB0aGUgc2l4XG4gKiBvcmlnaW5hbCBwcmljZXMgKCQwLjAwMDUg4oCTICQwLjAxKS5cbiAqL1xuXG4vKiogQm90IENvbnRyb2wgc3RhbXBzIGV2ZXJ5IGRldGVjdGVkIGJvdCB3aXRoIGEgbGFiZWwgaW4gdGhpcyBuYW1lc3BhY2UuICovXG5leHBvcnQgY29uc3QgQk9UX05BTUVTUEFDRSA9ICdhd3N3YWY6bWFuYWdlZDphd3M6Ym90LWNvbnRyb2w6Ym90Oic7XG5cbi8qKiBQaW5uZWQgQm90IENvbnRyb2wgbWFuYWdlZC1ydWxlLWdyb3VwIHZlcnNpb24gKD49IHY2IGZvciBhZ2VudGljL0FJLWJvdCBkZXRlY3Rpb25zKS4gKi9cbmV4cG9ydCBjb25zdCBCT1RfQ09OVFJPTF9WRVJTSU9OID0gJ1ZlcnNpb25fNi4wJztcblxuLyoqIEJhc2UgdW5pdCBwcmljZSAoVVNEQykuIEVhY2ggdGllciBtdWx0aXBsaWVzIHRoaXMuICovXG5leHBvcnQgY29uc3QgQkFTRV9BTU9VTlQgPSAnMC4wMDA1JztcblxuZXhwb3J0IGludGVyZmFjZSBUaWVyIHtcbiAgLyoqIFNob3J0IG5hbWUgKHVzZWQgaW4gcnVsZSBuYW1lICsgbWV0cmljKS4gKi9cbiAgbmFtZTogc3RyaW5nO1xuICAvKiogQ2xvdWRGcm9udC1zdHlsZSBVUkkgcHJlZml4IHRoYXQgc2VsZWN0cyB0aGlzIHRpZXIgKFNUQVJUU19XSVRIIG1hdGNoKS4gKi9cbiAgcHJlZml4OiBzdHJpbmc7XG4gIC8qKiBQcmljZSBtdWx0aXBsaWVyIMOXIEJBU0VfQU1PVU5ULiAqL1xuICBtdWx0aXBsaWVyOiBudW1iZXI7XG59XG5cbi8qKlxuICogVGllcnMgb3JkZXJlZCBtb3N0LXNwZWNpZmljLWZpcnN0LiBUaGUgb3JpZ2luYWwgcmVwbyBwcmljZWQgYm90aCBiYXJlIGFuZFxuICogL2FwaS1wcmVmaXhlZCB2YXJpYW50cyBpZGVudGljYWxseSwgc28gZWFjaCB0aWVyIGxpc3RzIGl0cyBtYXRjaGVkIHByZWZpeDsgdGhlXG4gKiBjaGVhcGVzdCBjYXRjaCAod2VhdGhlcikgYW5kIHRoZSBleHBsaWNpdCBjb250ZW50IHByZWZpeGVzIGFyZSBkaXN0aW5jdCBydWxlcy5cbiAqL1xuZXhwb3J0IGNvbnN0IFRJRVJTOiBUaWVyW10gPSBbXG4gIHsgbmFtZTogJ3dlYXRoZXInLCBwcmVmaXg6ICcvYXBpL3dlYXRoZXItZGF0YScsIG11bHRpcGxpZXI6IDEgfSxcbiAgeyBuYW1lOiAnYXJ0aWNsZScsIHByZWZpeDogJy9hcGkvcHJlbWl1bS1hcnRpY2xlJywgbXVsdGlwbGllcjogMiB9LFxuICB7IG5hbWU6ICdtYXJrZXQnLCBwcmVmaXg6ICcvYXBpL21hcmtldC1hbmFseXNpcycsIG11bHRpcGxpZXI6IDQgfSxcbiAgeyBuYW1lOiAndHV0b3JpYWwnLCBwcmVmaXg6ICcvdHV0b3JpYWwnLCBtdWx0aXBsaWVyOiA2IH0sXG4gIHsgbmFtZTogJ2FwaS10dXRvcmlhbCcsIHByZWZpeDogJy9hcGkvdHV0b3JpYWwnLCBtdWx0aXBsaWVyOiA2IH0sXG4gIHsgbmFtZTogJ3Jlc2VhcmNoJywgcHJlZml4OiAnL3Jlc2VhcmNoLXJlcG9ydCcsIG11bHRpcGxpZXI6IDEwIH0sXG4gIHsgbmFtZTogJ2FwaS1yZXNlYXJjaCcsIHByZWZpeDogJy9hcGkvcmVzZWFyY2gtcmVwb3J0JywgbXVsdGlwbGllcjogMTAgfSxcbiAgeyBuYW1lOiAnZGF0YXNldCcsIHByZWZpeDogJy9kYXRhc2V0JywgbXVsdGlwbGllcjogMjAgfSxcbiAgeyBuYW1lOiAnYXBpLWRhdGFzZXQnLCBwcmVmaXg6ICcvYXBpL2RhdGFzZXQnLCBtdWx0aXBsaWVyOiAyMCB9LFxuXTtcblxuaW50ZXJmYWNlIFZpc2liaWxpdHlDb25maWcge1xuICBTYW1wbGVkUmVxdWVzdHNFbmFibGVkOiBib29sZWFuO1xuICBDbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IGJvb2xlYW47XG4gIE1ldHJpY05hbWU6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBXZWJBY2xSdWxlIHtcbiAgTmFtZTogc3RyaW5nO1xuICBQcmlvcml0eTogbnVtYmVyO1xuICBTdGF0ZW1lbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBBY3Rpb24/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgT3ZlcnJpZGVBY3Rpb24/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgUnVsZUxhYmVscz86IHsgTmFtZTogc3RyaW5nIH1bXTtcbiAgVmlzaWJpbGl0eUNvbmZpZzogVmlzaWJpbGl0eUNvbmZpZztcbn1cblxuZnVuY3Rpb24gdmlzKG1ldHJpY05hbWU6IHN0cmluZyk6IFZpc2liaWxpdHlDb25maWcge1xuICByZXR1cm4geyBTYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLCBDbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsIE1ldHJpY05hbWU6IG1ldHJpY05hbWUgfTtcbn1cblxuLyoqIFNUQVJUU19XSVRIIFVyaVBhdGggbWF0Y2ggKFNlYXJjaFN0cmluZyBiYXNlNjQtZW5jb2RlZCBwZXIgdGhlIFdBRiBKU09OIGNvbnRyYWN0KS4gKi9cbmZ1bmN0aW9uIHBhdGhNYXRjaChwcmVmaXg6IHN0cmluZyk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHtcbiAgICBCeXRlTWF0Y2hTdGF0ZW1lbnQ6IHtcbiAgICAgIFNlYXJjaFN0cmluZzogQnVmZmVyLmZyb20ocHJlZml4KS50b1N0cmluZygnYmFzZTY0JyksXG4gICAgICBGaWVsZFRvTWF0Y2g6IHsgVXJpUGF0aDoge30gfSxcbiAgICAgIFRleHRUcmFuc2Zvcm1hdGlvbnM6IFt7IFByaW9yaXR5OiAwLCBUeXBlOiAnTk9ORScgfV0sXG4gICAgICBQb3NpdGlvbmFsQ29uc3RyYWludDogJ1NUQVJUU19XSVRIJyxcbiAgICB9LFxuICB9O1xufVxuXG5mdW5jdGlvbiBib3ROYW1lc3BhY2VNYXRjaCgpOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB7IExhYmVsTWF0Y2hTdGF0ZW1lbnQ6IHsgU2NvcGU6ICdOQU1FU1BBQ0UnLCBLZXk6IEJPVF9OQU1FU1BBQ0UgfSB9O1xufVxuXG4vKiogV2ViQUNMLWxldmVsIE1vbmV0aXphdGlvbkNvbmZpZzogcGF5ZWUgd2FsbGV0LCBjaGFpbiwgYmFzZSBwcmljZSwgbW9kZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZE1vbmV0aXphdGlvbkNvbmZpZyh3YWxsZXRBZGRyZXNzOiBzdHJpbmcpOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB7XG4gICAgQ3J5cHRvQ29uZmlnOiB7XG4gICAgICBQYXltZW50TmV0d29ya3M6IFtcbiAgICAgICAge1xuICAgICAgICAgIENoYWluOiAnQkFTRV9TRVBPTElBJyxcbiAgICAgICAgICBXYWxsZXRBZGRyZXNzOiB3YWxsZXRBZGRyZXNzLFxuICAgICAgICAgIFByaWNlczogW3sgQW1vdW50OiBCQVNFX0FNT1VOVCwgQ3VycmVuY3k6ICdVU0RDJyB9XSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSxcbiAgICBDdXJyZW5jeU1vZGU6ICdURVNUJyxcbiAgfTtcbn1cblxuLyoqXG4gKiBGdWxsIFdlYkFDTCBydWxlIGFycmF5OlxuICogICAwICBBV1NCb3RDb250cm9sICAgICAgIChtYW5hZ2VkLCBDb3VudC9kZXRlY3QpXG4gKiAgIDEgIGh1bWFuLWFsbG93ICAgICAgICAgKE5PVCBib3Qg4oaSIEFsbG93LCB0ZXJtaW5hdGluZylcbiAqICAgMiAgYWxsb3ctZGlzY292ZXJ5ICAgICAoL21jcC8gKyAvLndlbGwta25vd24vIOKGkiBBbGxvdywgdGVybWluYXRpbmcpXG4gKiAgIDEwKyBNb25ldGl6ZS08dGllcj4gICAgKGJvdHMgcmVhY2hpbmcgaGVyZSBwYXkgYmFzZSDDlyBtdWx0aXBsaWVyKVxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRXZWJBY2xSdWxlcyhtZXRyaWNQcmVmaXg6IHN0cmluZyk6IFdlYkFjbFJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBXZWJBY2xSdWxlW10gPSBbXG4gICAge1xuICAgICAgTmFtZTogJ0FXU0JvdENvbnRyb2wnLFxuICAgICAgUHJpb3JpdHk6IDAsXG4gICAgICBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgTWFuYWdlZFJ1bGVHcm91cFN0YXRlbWVudDoge1xuICAgICAgICAgIFZlbmRvck5hbWU6ICdBV1MnLFxuICAgICAgICAgIE5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNCb3RDb250cm9sUnVsZVNldCcsXG4gICAgICAgICAgVmVyc2lvbjogQk9UX0NPTlRST0xfVkVSU0lPTixcbiAgICAgICAgICBNYW5hZ2VkUnVsZUdyb3VwQ29uZmlnczogW1xuICAgICAgICAgICAgeyBBV1NNYW5hZ2VkUnVsZXNCb3RDb250cm9sUnVsZVNldDogeyBJbnNwZWN0aW9uTGV2ZWw6ICdDT01NT04nIH0gfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIE92ZXJyaWRlQWN0aW9uOiB7IENvdW50OiB7fSB9LFxuICAgICAgVmlzaWJpbGl0eUNvbmZpZzogdmlzKGAke21ldHJpY1ByZWZpeH0tYm90LWNvbnRyb2xgKSxcbiAgICB9LFxuICAgIHtcbiAgICAgIE5hbWU6ICdodW1hbi1hbGxvdycsXG4gICAgICBQcmlvcml0eTogMSxcbiAgICAgIFN0YXRlbWVudDogeyBOb3RTdGF0ZW1lbnQ6IHsgU3RhdGVtZW50OiBib3ROYW1lc3BhY2VNYXRjaCgpIH0gfSxcbiAgICAgIEFjdGlvbjogeyBBbGxvdzoge30gfSxcbiAgICAgIFZpc2liaWxpdHlDb25maWc6IHZpcyhgJHttZXRyaWNQcmVmaXh9LWh1bWFuLWFsbG93YCksXG4gICAgfSxcbiAgICB7XG4gICAgICBOYW1lOiAnYWxsb3ctZGlzY292ZXJ5JyxcbiAgICAgIFByaW9yaXR5OiAyLFxuICAgICAgU3RhdGVtZW50OiB7XG4gICAgICAgIE9yU3RhdGVtZW50OiB7XG4gICAgICAgICAgU3RhdGVtZW50czogW3BhdGhNYXRjaCgnL21jcC8nKSwgcGF0aE1hdGNoKCcvLndlbGwta25vd24vJyldLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIEFjdGlvbjogeyBBbGxvdzoge30gfSxcbiAgICAgIFZpc2liaWxpdHlDb25maWc6IHZpcyhgJHttZXRyaWNQcmVmaXh9LWFsbG93LWRpc2NvdmVyeWApLFxuICAgIH0sXG4gIF07XG5cbiAgVElFUlMuZm9yRWFjaCgodGllciwgaSkgPT4ge1xuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgTmFtZTogYE1vbmV0aXplLSR7dGllci5uYW1lfWAsXG4gICAgICBQcmlvcml0eTogMTAgKyBpLFxuICAgICAgU3RhdGVtZW50OiBwYXRoTWF0Y2godGllci5wcmVmaXgpLFxuICAgICAgQWN0aW9uOiB7IE1vbmV0aXplOiB7IFByaWNlTXVsdGlwbGllcjogU3RyaW5nKHRpZXIubXVsdGlwbGllcikgfSB9LFxuICAgICAgVmlzaWJpbGl0eUNvbmZpZzogdmlzKGAke21ldHJpY1ByZWZpeH0tbW9uZXRpemUtJHt0aWVyLm5hbWV9YCksXG4gICAgfSk7XG4gIH0pO1xuXG4gIHJldHVybiBydWxlcztcbn1cbiJdfQ==