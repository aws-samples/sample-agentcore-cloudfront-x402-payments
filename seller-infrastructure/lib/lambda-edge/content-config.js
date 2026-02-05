"use strict";
/**
 * Dynamic Content Configuration Module
 *
 * This module provides dynamic content and pricing configuration for the x402 payment verifier.
 * Content can be loaded from:
 * 1. Static configuration (default)
 * 2. Environment variables (for pricing overrides)
 * 3. S3 bucket (for dynamic content)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.contentManager = exports.ContentManager = exports.DEFAULT_CONTENT_REGISTRY = void 0;
exports.createPaymentRequirements = createPaymentRequirements;
exports.clearS3Cache = clearS3Cache;
const client_s3_1 = require("@aws-sdk/client-s3");
// ============================================================================
// Default Configuration
// ============================================================================
/**
 * Default payment recipient address
 * Lambda@Edge doesn't support environment variables, so this is bundled
 * This is the seller's wallet that receives x402 payments
 */
const DEFAULT_PAY_TO = '0x24842F3136Fa2a3df835d36b4c3cb4972d405502';
/**
 * Default network (Base Sepolia testnet)
 * Use 'eip155:8453' for Base Mainnet in production
 */
const DEFAULT_NETWORK = 'eip155:84532';
/**
 * Default asset (USDC on Base Sepolia)
 */
const DEFAULT_ASSET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
/**
 * Default S3 bucket for content storage
 * This is the CDK-generated bucket name from the X402SellerStack deployment
 * Lambda@Edge doesn't support environment variables, so this must be hardcoded
 */
const DEFAULT_CONTENT_BUCKET = 'x402sellerstack-contentbucket52d4b12c-h81ogh04nmda';
/**
 * Creates default payment requirements with optional overrides
 */
function createPaymentRequirements(amount, overrides) {
    return {
        scheme: 'exact',
        network: DEFAULT_NETWORK,
        amount,
        asset: DEFAULT_ASSET,
        payTo: DEFAULT_PAY_TO,
        maxTimeoutSeconds: 60,
        extra: {
            name: 'USDC',
            version: '2',
            assetTransferMethod: 'eip3009',
        },
        ...overrides,
    };
}
// ============================================================================
// Default Content Registry
// ============================================================================
/**
 * Default content registry with static content
 */
exports.DEFAULT_CONTENT_REGISTRY = {
    version: '1.0.0',
    defaultPayTo: DEFAULT_PAY_TO,
    defaultNetwork: DEFAULT_NETWORK,
    defaultAsset: DEFAULT_ASSET,
    items: {
        // Root-level content paths (for direct access)
        '/research-report': {
            id: 'research-report',
            path: '/research-report',
            title: 'Blockchain Research Report',
            description: 'In-depth research report on blockchain technology trends',
            mimeType: 'application/json',
            pricing: createPaymentRequirements('5000'),
            source: {
                type: 's3',
                bucket: DEFAULT_CONTENT_BUCKET,
                key: 'research-report',
            },
        },
        '/dataset': {
            id: 'dataset',
            path: '/dataset',
            title: 'Premium Dataset',
            description: 'Curated dataset for machine learning and analytics',
            mimeType: 'application/json',
            pricing: createPaymentRequirements('10000'),
            source: {
                type: 's3',
                bucket: DEFAULT_CONTENT_BUCKET,
                key: 'dataset',
            },
        },
        '/tutorial': {
            id: 'tutorial',
            path: '/tutorial',
            title: 'Advanced Smart Contract Tutorial',
            description: 'Step-by-step guide to building advanced smart contracts',
            mimeType: 'application/json',
            pricing: createPaymentRequirements('3000'),
            source: {
                type: 's3',
                bucket: DEFAULT_CONTENT_BUCKET,
                key: 'tutorial',
            },
        },
        // API-prefixed paths (for backwards compatibility)
        '/api/premium-article': {
            id: 'premium-article',
            path: '/api/premium-article',
            title: 'The Future of AI and Blockchain Integration',
            description: 'Premium article about AI and blockchain convergence',
            mimeType: 'application/json',
            pricing: createPaymentRequirements('1000'),
            source: {
                type: 'inline',
                data: {
                    title: 'The Future of AI and Blockchain Integration',
                    author: 'Tech Insights',
                    date: new Date().toISOString().split('T')[0],
                    content: 'Artificial Intelligence and Blockchain are converging to create unprecedented opportunities...',
                    fullText: 'This is premium content that requires payment to access. The integration of AI and blockchain technology is revolutionizing how we think about decentralized systems, smart contracts, and autonomous agents. Key areas of innovation include: 1) Decentralized AI training, 2) Smart contract automation, 3) Tokenized AI services, 4) Privacy-preserving computation.',
                    tags: ['AI', 'blockchain', 'technology', 'innovation'],
                },
            },
        },
        '/api/weather-data': {
            id: 'weather-data',
            path: '/api/weather-data',
            title: 'Real-time Weather Data',
            description: 'Current weather conditions and forecast',
            mimeType: 'application/json',
            pricing: createPaymentRequirements('500'),
            source: {
                type: 'dynamic',
                generator: 'weather',
            },
        },
        '/api/market-analysis': {
            id: 'market-analysis',
            path: '/api/market-analysis',
            title: 'Cryptocurrency Market Analysis',
            description: 'Real-time market data and analysis',
            mimeType: 'application/json',
            pricing: createPaymentRequirements('2000'),
            source: {
                type: 'dynamic',
                generator: 'market',
            },
        },
        // S3-backed content items with /api/ prefix
        '/api/research-report': {
            id: 'api-research-report',
            path: '/api/research-report',
            title: 'Blockchain Research Report',
            description: 'In-depth research report on blockchain technology trends',
            mimeType: 'application/json',
            pricing: createPaymentRequirements('5000'),
            source: {
                type: 's3',
                bucket: DEFAULT_CONTENT_BUCKET,
                key: 'research-report',
            },
        },
        '/api/dataset': {
            id: 'api-dataset',
            path: '/api/dataset',
            title: 'Premium Dataset',
            description: 'Curated dataset for machine learning and analytics',
            mimeType: 'application/json',
            pricing: createPaymentRequirements('10000'),
            source: {
                type: 's3',
                bucket: DEFAULT_CONTENT_BUCKET,
                key: 'dataset',
            },
        },
        '/api/tutorial': {
            id: 'api-tutorial',
            path: '/api/tutorial',
            title: 'Advanced Smart Contract Tutorial',
            description: 'Step-by-step guide to building advanced smart contracts',
            mimeType: 'application/json',
            pricing: createPaymentRequirements('3000'),
            source: {
                type: 's3',
                bucket: DEFAULT_CONTENT_BUCKET,
                key: 'tutorial',
            },
        },
    },
};
// ============================================================================
// Dynamic Content Generators
// ============================================================================
/**
 * Generates dynamic weather data
 */
function generateWeatherData() {
    const conditions = ['Sunny', 'Partly Cloudy', 'Cloudy', 'Rain', 'Thunderstorm', 'Snow', 'Fog'];
    const cities = [
        { name: 'San Francisco, CA', tempRange: [50, 70] },
        { name: 'New York, NY', tempRange: [30, 85] },
        { name: 'Miami, FL', tempRange: [65, 95] },
        { name: 'Seattle, WA', tempRange: [40, 75] },
        { name: 'Denver, CO', tempRange: [25, 80] },
    ];
    const city = cities[Math.floor(Math.random() * cities.length)];
    const temp = Math.floor(Math.random() * (city.tempRange[1] - city.tempRange[0])) + city.tempRange[0];
    return {
        location: city.name,
        timestamp: new Date().toISOString(),
        current: {
            temperature: temp,
            temperatureUnit: 'F',
            conditions: conditions[Math.floor(Math.random() * conditions.length)],
            humidity: Math.floor(Math.random() * 60) + 30,
            windSpeed: Math.floor(Math.random() * 25) + 5,
            windUnit: 'mph',
            uvIndex: Math.floor(Math.random() * 11),
        },
        forecast: Array.from({ length: 5 }, (_, i) => ({
            day: new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { weekday: 'short' }),
            conditions: conditions[Math.floor(Math.random() * conditions.length)],
            high: temp + Math.floor(Math.random() * 10),
            low: temp - Math.floor(Math.random() * 15),
        })),
        source: 'x402-weather-service',
        premium: true,
    };
}
/**
 * Generates dynamic market analysis data
 */
function generateMarketData() {
    const cryptos = [
        { symbol: 'BTC', name: 'Bitcoin', basePrice: 98000 },
        { symbol: 'ETH', name: 'Ethereum', basePrice: 3800 },
        { symbol: 'SOL', name: 'Solana', basePrice: 145 },
        { symbol: 'AVAX', name: 'Avalanche', basePrice: 42 },
        { symbol: 'MATIC', name: 'Polygon', basePrice: 0.85 },
    ];
    const markets = {};
    for (const crypto of cryptos) {
        const changePercent = (Math.random() * 10 - 5).toFixed(2);
        const price = crypto.basePrice * (1 + parseFloat(changePercent) / 100);
        const volume = (Math.random() * 30 + 5).toFixed(1);
        markets[crypto.symbol] = {
            name: crypto.name,
            price: price.toFixed(2),
            change24h: `${parseFloat(changePercent) >= 0 ? '+' : ''}${changePercent}%`,
            volume24h: `$${volume}B`,
            marketCap: `$${(price * (crypto.symbol === 'BTC' ? 19.5 : crypto.symbol === 'ETH' ? 120 : 400)).toFixed(0)}M`,
        };
    }
    const sentiments = ['Bullish', 'Bearish', 'Neutral', 'Very Bullish', 'Cautiously Optimistic'];
    return {
        timestamp: new Date().toISOString(),
        date: new Date().toISOString().split('T')[0],
        markets,
        analysis: {
            overallSentiment: sentiments[Math.floor(Math.random() * sentiments.length)],
            summary: 'Market showing mixed signals with major cryptocurrencies experiencing varied momentum. Technical indicators suggest potential consolidation phase.',
            keyEvents: [
                'Federal Reserve meeting scheduled for next week',
                'Major protocol upgrade announced for Ethereum',
                'Institutional adoption continues to grow',
            ],
            riskLevel: ['Low', 'Medium', 'High'][Math.floor(Math.random() * 3)],
        },
        source: 'x402-market-service',
        premium: true,
    };
}
/**
 * Content generators registry
 */
const CONTENT_GENERATORS = {
    weather: generateWeatherData,
    market: generateMarketData,
};
// ============================================================================
// S3 Content Fetching
// ============================================================================
/**
 * S3 client for fetching content from S3 buckets
 * Lambda@Edge runs in us-east-1, so we use that region
 */
const s3Client = new client_s3_1.S3Client({ region: 'us-east-1' });
/**
 * Cache for S3 content to reduce latency on repeated requests
 * Note: Lambda@Edge instances may be reused, so this provides some caching benefit
 */
const s3ContentCache = new Map();
/**
 * Cache TTL in milliseconds (5 minutes)
 */
const S3_CACHE_TTL_MS = 5 * 60 * 1000;
/**
 * Fetches content from S3 bucket
 * @param bucket - S3 bucket name
 * @param key - S3 object key
 * @returns The content from S3 or an error object
 */
async function fetchS3Content(bucket, key) {
    const cacheKey = `${bucket}/${key}`;
    // Check cache first
    const cached = s3ContentCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < S3_CACHE_TTL_MS) {
        return cached.data;
    }
    try {
        const command = new client_s3_1.GetObjectCommand({
            Bucket: bucket,
            Key: key,
        });
        const response = await s3Client.send(command);
        if (!response.Body) {
            return { error: 'Empty response from S3', bucket, key };
        }
        // Read the stream and convert to string
        const bodyContents = await response.Body.transformToString();
        // Try to parse as JSON, otherwise return as string
        let content;
        try {
            content = JSON.parse(bodyContents);
        }
        catch {
            // Not JSON, return as-is wrapped in an object
            content = {
                type: 'text',
                content: bodyContents,
                mimeType: response.ContentType || 'text/plain',
            };
        }
        // Cache the result
        s3ContentCache.set(cacheKey, { data: content, timestamp: Date.now() });
        return content;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Failed to fetch S3 content: ${bucket}/${key}`, error);
        return {
            error: 'Failed to fetch S3 content',
            bucket,
            key,
            message: errorMessage,
        };
    }
}
/**
 * Clears the S3 content cache
 * Useful for testing or when content needs to be refreshed
 */
function clearS3Cache() {
    s3ContentCache.clear();
}
// ============================================================================
// Content Manager
// ============================================================================
/**
 * Content Manager class for handling dynamic content
 */
class ContentManager {
    constructor(registry = exports.DEFAULT_CONTENT_REGISTRY) {
        this.registry = registry;
    }
    /**
     * Gets payment requirements for a given path
     */
    getPaymentRequirements(path) {
        const item = this.registry.items[path];
        return item?.pricing || null;
    }
    /**
     * Gets content for a given path
     */
    async getContent(path) {
        const item = this.registry.items[path];
        if (!item) {
            return { error: 'Content not found', path };
        }
        switch (item.source.type) {
            case 'inline':
                return item.source.data;
            case 'dynamic':
                const generator = CONTENT_GENERATORS[item.source.generator];
                if (generator) {
                    return generator();
                }
                return { error: 'Generator not found', generator: item.source.generator };
            case 's3':
                // Fetch content from S3 bucket
                return await fetchS3Content(item.source.bucket, item.source.key);
            default:
                return { error: 'Unknown content source type' };
        }
    }
    /**
     * Gets content item metadata
     */
    getContentItem(path) {
        return this.registry.items[path] || null;
    }
    /**
     * Lists all available content paths
     */
    listContentPaths() {
        return Object.keys(this.registry.items);
    }
    /**
     * Checks if a path requires payment
     */
    requiresPayment(path) {
        return path in this.registry.items;
    }
    /**
     * Gets the content registry version
     */
    getVersion() {
        return this.registry.version;
    }
    /**
     * Adds or updates a content item
     */
    setContentItem(item) {
        this.registry.items[item.path] = item;
    }
    /**
     * Removes a content item
     */
    removeContentItem(path) {
        if (path in this.registry.items) {
            delete this.registry.items[path];
            return true;
        }
        return false;
    }
}
exports.ContentManager = ContentManager;
// ============================================================================
// Singleton Instance
// ============================================================================
/**
 * Default content manager instance
 */
exports.contentManager = new ContentManager();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC1jb25maWcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb250ZW50LWNvbmZpZy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7O0dBUUc7OztBQXVGSCw4REFrQkM7QUFzVUQsb0NBRUM7QUE5YUQsa0RBQWdFO0FBb0RoRSwrRUFBK0U7QUFDL0Usd0JBQXdCO0FBQ3hCLCtFQUErRTtBQUUvRTs7OztHQUlHO0FBQ0gsTUFBTSxjQUFjLEdBQUcsNENBQTRDLENBQUM7QUFFcEU7OztHQUdHO0FBQ0gsTUFBTSxlQUFlLEdBQUcsY0FBYyxDQUFDO0FBRXZDOztHQUVHO0FBQ0gsTUFBTSxhQUFhLEdBQUcsNENBQTRDLENBQUM7QUFFbkU7Ozs7R0FJRztBQUNILE1BQU0sc0JBQXNCLEdBQUcsb0RBQW9ELENBQUM7QUFFcEY7O0dBRUc7QUFDSCxTQUFnQix5QkFBeUIsQ0FDdkMsTUFBYyxFQUNkLFNBQXdDO0lBRXhDLE9BQU87UUFDTCxNQUFNLEVBQUUsT0FBTztRQUNmLE9BQU8sRUFBRSxlQUFlO1FBQ3hCLE1BQU07UUFDTixLQUFLLEVBQUUsYUFBYTtRQUNwQixLQUFLLEVBQUUsY0FBYztRQUNyQixpQkFBaUIsRUFBRSxFQUFFO1FBQ3JCLEtBQUssRUFBRTtZQUNMLElBQUksRUFBRSxNQUFNO1lBQ1osT0FBTyxFQUFFLEdBQUc7WUFDWixtQkFBbUIsRUFBRSxTQUFTO1NBQy9CO1FBQ0QsR0FBRyxTQUFTO0tBQ2IsQ0FBQztBQUNKLENBQUM7QUFFRCwrRUFBK0U7QUFDL0UsMkJBQTJCO0FBQzNCLCtFQUErRTtBQUUvRTs7R0FFRztBQUNVLFFBQUEsd0JBQXdCLEdBQW9CO0lBQ3ZELE9BQU8sRUFBRSxPQUFPO0lBQ2hCLFlBQVksRUFBRSxjQUFjO0lBQzVCLGNBQWMsRUFBRSxlQUFlO0lBQy9CLFlBQVksRUFBRSxhQUFhO0lBQzNCLEtBQUssRUFBRTtRQUNMLCtDQUErQztRQUMvQyxrQkFBa0IsRUFBRTtZQUNsQixFQUFF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OztHQUVHO0FBQ1UsUUFBQSxjQUFjLEdBQUcsSUFBSSxjQUFjLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRHluYW1pYyBDb250ZW50IENvbmZpZ3VyYXRpb24gTW9kdWxlXG4gKiBcbiAqIFRoaXMgbW9kdWxlIHByb3ZpZGVzIGR5bmFtaWMgY29udGVudCBhbmQgcHJpY2luZyBjb25maWd1cmF0aW9uIGZvciB0aGUgeDQwMiBwYXltZW50IHZlcmlmaWVyLlxuICogQ29udGVudCBjYW4gYmUgbG9hZGVkIGZyb206XG4gKiAxLiBTdGF0aWMgY29uZmlndXJhdGlvbiAoZGVmYXVsdClcbiAqIDIuIEVudmlyb25tZW50IHZhcmlhYmxlcyAoZm9yIHByaWNpbmcgb3ZlcnJpZGVzKVxuICogMy4gUzMgYnVja2V0IChmb3IgZHluYW1pYyBjb250ZW50KVxuICovXG5cbmltcG9ydCB7IFBheW1lbnRSZXF1aXJlbWVudHMgfSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IFMzQ2xpZW50LCBHZXRPYmplY3RDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXMzJztcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ29udGVudCBDb25maWd1cmF0aW9uIFR5cGVzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQ29udGVudCBpdGVtIHdpdGggbWV0YWRhdGEgYW5kIHByaWNpbmdcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb250ZW50SXRlbSB7XG4gIC8qKiBVbmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIGNvbnRlbnQgKi9cbiAgaWQ6IHN0cmluZztcbiAgLyoqIFVSTCBwYXRoIGZvciB0aGUgY29udGVudCAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSB0aXRsZSAqL1xuICB0aXRsZTogc3RyaW5nO1xuICAvKiogQ29udGVudCBkZXNjcmlwdGlvbiAqL1xuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICAvKiogTUlNRSB0eXBlIG9mIHRoZSBjb250ZW50ICovXG4gIG1pbWVUeXBlOiBzdHJpbmc7XG4gIC8qKiBQYXltZW50IHJlcXVpcmVtZW50cyBmb3IgdGhpcyBjb250ZW50ICovXG4gIHByaWNpbmc6IFBheW1lbnRSZXF1aXJlbWVudHM7XG4gIC8qKiBDb250ZW50IHNvdXJjZSAtIGlubGluZSBkYXRhIG9yIFMzIHJlZmVyZW5jZSAqL1xuICBzb3VyY2U6IENvbnRlbnRTb3VyY2U7XG4gIC8qKiBPcHRpb25hbCBtZXRhZGF0YSAqL1xuICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufVxuXG4vKipcbiAqIENvbnRlbnQgc291cmNlIC0gZWl0aGVyIGlubGluZSBkYXRhIG9yIFMzIHJlZmVyZW5jZVxuICovXG5leHBvcnQgdHlwZSBDb250ZW50U291cmNlID0gXG4gIHwgeyB0eXBlOiAnaW5saW5lJzsgZGF0YTogdW5rbm93biB9XG4gIHwgeyB0eXBlOiAnczMnOyBidWNrZXQ6IHN0cmluZzsga2V5OiBzdHJpbmcgfVxuICB8IHsgdHlwZTogJ2R5bmFtaWMnOyBnZW5lcmF0b3I6IHN0cmluZyB9O1xuXG4vKipcbiAqIENvbnRlbnQgcmVnaXN0cnkgZm9yIG1hbmFnaW5nIGFsbCBhdmFpbGFibGUgY29udGVudFxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbnRlbnRSZWdpc3RyeSB7XG4gIC8qKiBWZXJzaW9uIG9mIHRoZSBjb25maWd1cmF0aW9uICovXG4gIHZlcnNpb246IHN0cmluZztcbiAgLyoqIERlZmF1bHQgcGF5bWVudCByZWNpcGllbnQgYWRkcmVzcyAqL1xuICBkZWZhdWx0UGF5VG86IHN0cmluZztcbiAgLyoqIERlZmF1bHQgbmV0d29yayBmb3IgcGF5bWVudHMgKi9cbiAgZGVmYXVsdE5ldHdvcms6IHN0cmluZztcbiAgLyoqIERlZmF1bHQgYXNzZXQgZm9yIHBheW1lbnRzICovXG4gIGRlZmF1bHRBc3NldDogc3RyaW5nO1xuICAvKiogQ29udGVudCBpdGVtcyBpbmRleGVkIGJ5IHBhdGggKi9cbiAgaXRlbXM6IFJlY29yZDxzdHJpbmcsIENvbnRlbnRJdGVtPjtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRGVmYXVsdCBDb25maWd1cmF0aW9uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRGVmYXVsdCBwYXltZW50IHJlY2lwaWVudCBhZGRyZXNzXG4gKiBMYW1iZGFARWRnZSBkb2Vzbid0IHN1cHBvcnQgZW52aXJvbm1lbnQgdmFyaWFibGVzLCBzbyB0aGlzIGlzIGJ1bmRsZWRcbiAqIFRoaXMgaXMgdGhlIHNlbGxlcidzIHdhbGxldCB0aGF0IHJlY2VpdmVzIHg0MDIgcGF5bWVudHNcbiAqL1xuY29uc3QgREVGQVVMVF9QQVlfVE8gPSAnMHgyNDg0MkYzMTM2RmEyYTNkZjgzNWQzNmI0YzNjYjQ5NzJkNDA1NTAyJztcblxuLyoqXG4gKiBEZWZhdWx0IG5ldHdvcmsgKEJhc2UgU2Vwb2xpYSB0ZXN0bmV0KVxuICogVXNlICdlaXAxNTU6ODQ1MycgZm9yIEJhc2UgTWFpbm5ldCBpbiBwcm9kdWN0aW9uXG4gKi9cbmNvbnN0IERFRkFVTFRfTkVUV09SSyA9ICdlaXAxNTU6ODQ1MzInO1xuXG4vKipcbiAqIERlZmF1bHQgYXNzZXQgKFVTREMgb24gQmFzZSBTZXBvbGlhKVxuICovXG5jb25zdCBERUZBVUxUX0FTU0VUID0gJzB4MDM2Q2JENTM4NDJjNTQyNjYzNGU3OTI5NTQxZUMyMzE4ZjNkQ0Y3ZSc7XG5cbi8qKlxuICogRGVmYXVsdCBTMyBidWNrZXQgZm9yIGNvbnRlbnQgc3RvcmFnZVxuICogVGhpcyBpcyB0aGUgQ0RLLWdlbmVyYXRlZCBidWNrZXQgbmFtZSBmcm9tIHRoZSBYNDAyU2VsbGVyU3RhY2sgZGVwbG95bWVudFxuICogTGFtYmRhQEVkZ2UgZG9lc24ndCBzdXBwb3J0IGVudmlyb25tZW50IHZhcmlhYmxlcywgc28gdGhpcyBtdXN0IGJlIGhhcmRjb2RlZFxuICovXG5jb25zdCBERUZBVUxUX0NPTlRFTlRfQlVDS0VUID0gJ3g0MDJzZWxsZXJzdGFjay1jb250ZW50YnVja2V0NTJkNGIxMmMtaDgxb2doMDRubWRhJztcblxuLyoqXG4gKiBDcmVhdGVzIGRlZmF1bHQgcGF5bWVudCByZXF1aXJlbWVudHMgd2l0aCBvcHRpb25hbCBvdmVycmlkZXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVBheW1lbnRSZXF1aXJlbWVudHMoXG4gIGFtb3VudDogc3RyaW5nLFxuICBvdmVycmlkZXM/OiBQYXJ0aWFsPFBheW1lbnRSZXF1aXJlbWVudHM+XG4pOiBQYXltZW50UmVxdWlyZW1lbnRzIHtcbiAgcmV0dXJuIHtcbiAgICBzY2hlbWU6ICdleGFjdCcsXG4gICAgbmV0d29yazogREVGQVVMVF9ORVRXT1JLLFxuICAgIGFtb3VudCxcbiAgICBhc3NldDogREVGQVVMVF9BU1NFVCxcbiAgICBwYXlUbzogREVGQVVMVF9QQVlfVE8sXG4gICAgbWF4VGltZW91dFNlY29uZHM6IDYwLFxuICAgIGV4dHJhOiB7XG4gICAgICBuYW1lOiAnVVNEQycsXG4gICAgICB2ZXJzaW9uOiAnMicsXG4gICAgICBhc3NldFRyYW5zZmVyTWV0aG9kOiAnZWlwMzAwOScsXG4gICAgfSxcbiAgICAuLi5vdmVycmlkZXMsXG4gIH07XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIERlZmF1bHQgQ29udGVudCBSZWdpc3RyeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIERlZmF1bHQgY29udGVudCByZWdpc3RyeSB3aXRoIHN0YXRpYyBjb250ZW50XG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX0NPTlRFTlRfUkVHSVNUUlk6IENvbnRlbnRSZWdpc3RyeSA9IHtcbiAgdmVyc2lvbjogJzEuMC4wJyxcbiAgZGVmYXVsdFBheVRvOiBERUZBVUxUX1BBWV9UTyxcbiAgZGVmYXVsdE5ldHdvcms6IERFRkFVTFRfTkVUV09SSyxcbiAgZGVmYXVsdEFzc2V0OiBERUZBVUxUX0FTU0VULFxuICBpdGVtczoge1xuICAgIC8vIFJvb3QtbGV2ZWwgY29udGVudCBwYXRocyAoZm9yIGRpcmVjdCBhY2Nlc3MpXG4gICAgJy9yZXNlYXJjaC1yZXBvcnQnOiB7XG4gICAgICBpZDogJ3Jlc2VhcmNoLXJlcG9ydCcsXG4gICAgICBwYXRoOiAnL3Jlc2VhcmNoLXJlcG9ydCcsXG4gICAgICB0aXRsZTogJ0Jsb2NrY2hhaW4gUmVzZWFyY2ggUmVwb3J0JyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnSW4tZGVwdGggcmVzZWFyY2ggcmVwb3J0IG9uIGJsb2NrY2hhaW4gdGVjaG5vbG9neSB0cmVuZHMnLFxuICAgICAgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIHByaWNpbmc6IGNyZWF0ZVBheW1lbnRSZXF1aXJlbWVudHMoJzUwMDAnKSxcbiAgICAgIHNvdXJjZToge1xuICAgICAgICB0eXBlOiAnczMnLFxuICAgICAgICBidWNrZXQ6IERFRkFVTFRfQ09OVEVOVF9CVUNLRVQsXG4gICAgICAgIGtleTogJ3Jlc2VhcmNoLXJlcG9ydCcsXG4gICAgICB9LFxuICAgIH0sXG4gICAgJy9kYXRhc2V0Jzoge1xuICAgICAgaWQ6ICdkYXRhc2V0JyxcbiAgICAgIHBhdGg6ICcvZGF0YXNldCcsXG4gICAgICB0aXRsZTogJ1ByZW1pdW0gRGF0YXNldCcsXG4gICAgICBkZXNjcmlwdGlvbjogJ0N1cmF0ZWQgZGF0YXNldCBmb3IgbWFjaGluZSBsZWFybmluZyBhbmQgYW5hbHl0aWNzJyxcbiAgICAgIG1pbWVUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICBwcmljaW5nOiBjcmVhdGVQYXltZW50UmVxdWlyZW1lbnRzKCcxMDAwMCcpLFxuICAgICAgc291cmNlOiB7XG4gICAgICAgIHR5cGU6ICdzMycsXG4gICAgICAgIGJ1Y2tldDogREVGQVVMVF9DT05URU5UX0JVQ0tFVCxcbiAgICAgICAga2V5OiAnZGF0YXNldCcsXG4gICAgICB9LFxuICAgIH0sXG4gICAgJy90dXRvcmlhbCc6IHtcbiAgICAgIGlkOiAndHV0b3JpYWwnLFxuICAgICAgcGF0aDogJy90dXRvcmlhbCcsXG4gICAgICB0aXRsZTogJ0FkdmFuY2VkIFNtYXJ0IENvbnRyYWN0IFR1dG9yaWFsJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3RlcC1ieS1zdGVwIGd1aWRlIHRvIGJ1aWxkaW5nIGFkdmFuY2VkIHNtYXJ0IGNvbnRyYWN0cycsXG4gICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgcHJpY2luZzogY3JlYXRlUGF5bWVudFJlcXVpcmVtZW50cygnMzAwMCcpLFxuICAgICAgc291cmNlOiB7XG4gICAgICAgIHR5cGU6ICdzMycsXG4gICAgICAgIGJ1Y2tldDogREVGQVVMVF9DT05URU5UX0JVQ0tFVCxcbiAgICAgICAga2V5OiAndHV0b3JpYWwnLFxuICAgICAgfSxcbiAgICB9LFxuICAgIC8vIEFQSS1wcmVmaXhlZCBwYXRocyAoZm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5KVxuICAgICcvYXBpL3ByZW1pdW0tYXJ0aWNsZSc6IHtcbiAgICAgIGlkOiAncHJlbWl1bS1hcnRpY2xlJyxcbiAgICAgIHBhdGg6ICcvYXBpL3ByZW1pdW0tYXJ0aWNsZScsXG4gICAgICB0aXRsZTogJ1RoZSBGdXR1cmUgb2YgQUkgYW5kIEJsb2NrY2hhaW4gSW50ZWdyYXRpb24nLFxuICAgICAgZGVzY3JpcHRpb246ICdQcmVtaXVtIGFydGljbGUgYWJvdXQgQUkgYW5kIGJsb2NrY2hhaW4gY29udmVyZ2VuY2UnLFxuICAgICAgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIHByaWNpbmc6IGNyZWF0ZVBheW1lbnRSZXF1aXJlbWVudHMoJzEwMDAnKSxcbiAgICAgIHNvdXJjZToge1xuICAgICAgICB0eXBlOiAnaW5saW5lJyxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIHRpdGxlOiAnVGhlIEZ1dHVyZSBvZiBBSSBhbmQgQmxvY2tjaGFpbiBJbnRlZ3JhdGlvbicsXG4gICAgICAgICAgYXV0aG9yOiAnVGVjaCBJbnNpZ2h0cycsXG4gICAgICAgICAgZGF0ZTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF0sXG4gICAgICAgICAgY29udGVudDogJ0FydGlmaWNpYWwgSW50ZWxsaWdlbmNlIGFuZCBCbG9ja2NoYWluIGFyZSBjb252ZXJnaW5nIHRvIGNyZWF0ZSB1bnByZWNlZGVudGVkIG9wcG9ydHVuaXRpZXMuLi4nLFxuICAgICAgICAgIGZ1bGxUZXh0OiAnVGhpcyBpcyBwcmVtaXVtIGNvbnRlbnQgdGhhdCByZXF1aXJlcyBwYXltZW50IHRvIGFjY2Vzcy4gVGhlIGludGVncmF0aW9uIG9mIEFJIGFuZCBibG9ja2NoYWluIHRlY2hub2xvZ3kgaXMgcmV2b2x1dGlvbml6aW5nIGhvdyB3ZSB0aGluayBhYm91dCBkZWNlbnRyYWxpemVkIHN5c3RlbXMsIHNtYXJ0IGNvbnRyYWN0cywgYW5kIGF1dG9ub21vdXMgYWdlbnRzLiBLZXkgYXJlYXMgb2YgaW5ub3ZhdGlvbiBpbmNsdWRlOiAxKSBEZWNlbnRyYWxpemVkIEFJIHRyYWluaW5nLCAyKSBTbWFydCBjb250cmFjdCBhdXRvbWF0aW9uLCAzKSBUb2tlbml6ZWQgQUkgc2VydmljZXMsIDQpIFByaXZhY3ktcHJlc2VydmluZyBjb21wdXRhdGlvbi4nLFxuICAgICAgICAgIHRhZ3M6IFsnQUknLCAnYmxvY2tjaGFpbicsICd0ZWNobm9sb2d5JywgJ2lubm92YXRpb24nXSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAnL2FwaS93ZWF0aGVyLWRhdGEnOiB7XG4gICAgICBpZDogJ3dlYXRoZXItZGF0YScsXG4gICAgICBwYXRoOiAnL2FwaS93ZWF0aGVyLWRhdGEnLFxuICAgICAgdGl0bGU6ICdSZWFsLXRpbWUgV2VhdGhlciBEYXRhJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ3VycmVudCB3ZWF0aGVyIGNvbmRpdGlvbnMgYW5kIGZvcmVjYXN0JyxcbiAgICAgIG1pbWVUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICBwcmljaW5nOiBjcmVhdGVQYXltZW50UmVxdWlyZW1lbnRzKCc1MDAnKSxcbiAgICAgIHNvdXJjZToge1xuICAgICAgICB0eXBlOiAnZHluYW1pYycsXG4gICAgICAgIGdlbmVyYXRvcjogJ3dlYXRoZXInLFxuICAgICAgfSxcbiAgICB9LFxuICAgICcvYXBpL21hcmtldC1hbmFseXNpcyc6IHtcbiAgICAgIGlkOiAnbWFya2V0LWFuYWx5c2lzJyxcbiAgICAgIHBhdGg6ICcvYXBpL21hcmtldC1hbmFseXNpcycsXG4gICAgICB0aXRsZTogJ0NyeXB0b2N1cnJlbmN5IE1hcmtldCBBbmFseXNpcycsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JlYWwtdGltZSBtYXJrZXQgZGF0YSBhbmQgYW5hbHlzaXMnLFxuICAgICAgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIHByaWNpbmc6IGNyZWF0ZVBheW1lbnRSZXF1aXJlbWVudHMoJzIwMDAnKSxcbiAgICAgIHNvdXJjZToge1xuICAgICAgICB0eXBlOiAnZHluYW1pYycsXG4gICAgICAgIGdlbmVyYXRvcjogJ21hcmtldCcsXG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gUzMtYmFja2VkIGNvbnRlbnQgaXRlbXMgd2l0aCAvYXBpLyBwcmVmaXhcbiAgICAnL2FwaS9yZXNlYXJjaC1yZXBvcnQnOiB7XG4gICAgICBpZDogJ2FwaS1yZXNlYXJjaC1yZXBvcnQnLFxuICAgICAgcGF0aDogJy9hcGkvcmVzZWFyY2gtcmVwb3J0JyxcbiAgICAgIHRpdGxlOiAnQmxvY2tjaGFpbiBSZXNlYXJjaCBSZXBvcnQnLFxuICAgICAgZGVzY3JpcHRpb246ICdJbi1kZXB0aCByZXNlYXJjaCByZXBvcnQgb24gYmxvY2tjaGFpbiB0ZWNobm9sb2d5IHRyZW5kcycsXG4gICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgcHJpY2luZzogY3JlYXRlUGF5bWVudFJlcXVpcmVtZW50cygnNTAwMCcpLFxuICAgICAgc291cmNlOiB7XG4gICAgICAgIHR5cGU6ICdzMycsXG4gICAgICAgIGJ1Y2tldDogREVGQVVMVF9DT05URU5UX0JVQ0tFVCxcbiAgICAgICAga2V5OiAncmVzZWFyY2gtcmVwb3J0JyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAnL2FwaS9kYXRhc2V0Jzoge1xuICAgICAgaWQ6ICdhcGktZGF0YXNldCcsXG4gICAgICBwYXRoOiAnL2FwaS9kYXRhc2V0JyxcbiAgICAgIHRpdGxlOiAnUHJlbWl1bSBEYXRhc2V0JyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ3VyYXRlZCBkYXRhc2V0IGZvciBtYWNoaW5lIGxlYXJuaW5nIGFuZCBhbmFseXRpY3MnLFxuICAgICAgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIHByaWNpbmc6IGNyZWF0ZVBheW1lbnRSZXF1aXJlbWVudHMoJzEwMDAwJyksXG4gICAgICBzb3VyY2U6IHtcbiAgICAgICAgdHlwZTogJ3MzJyxcbiAgICAgICAgYnVja2V0OiBERUZBVUxUX0NPTlRFTlRfQlVDS0VULFxuICAgICAgICBrZXk6ICdkYXRhc2V0JyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAnL2FwaS90dXRvcmlhbCc6IHtcbiAgICAgIGlkOiAnYXBpLXR1dG9yaWFsJyxcbiAgICAgIHBhdGg6ICcvYXBpL3R1dG9yaWFsJyxcbiAgICAgIHRpdGxlOiAnQWR2YW5jZWQgU21hcnQgQ29udHJhY3QgVHV0b3JpYWwnLFxuICAgICAgZGVzY3JpcHRpb246ICdTdGVwLWJ5LXN0ZXAgZ3VpZGUgdG8gYnVpbGRpbmcgYWR2YW5jZWQgc21hcnQgY29udHJhY3RzJyxcbiAgICAgIG1pbWVUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICBwcmljaW5nOiBjcmVhdGVQYXltZW50UmVxdWlyZW1lbnRzKCczMDAwJyksXG4gICAgICBzb3VyY2U6IHtcbiAgICAgICAgdHlwZTogJ3MzJyxcbiAgICAgICAgYnVja2V0OiBERUZBVUxUX0NPTlRFTlRfQlVDS0VULFxuICAgICAgICBrZXk6ICd0dXRvcmlhbCcsXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBEeW5hbWljIENvbnRlbnQgR2VuZXJhdG9yc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEdlbmVyYXRlcyBkeW5hbWljIHdlYXRoZXIgZGF0YVxuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVdlYXRoZXJEYXRhKCk6IHVua25vd24ge1xuICBjb25zdCBjb25kaXRpb25zID0gWydTdW5ueScsICdQYXJ0bHkgQ2xvdWR5JywgJ0Nsb3VkeScsICdSYWluJywgJ1RodW5kZXJzdG9ybScsICdTbm93JywgJ0ZvZyddO1xuICBjb25zdCBjaXRpZXMgPSBbXG4gICAgeyBuYW1lOiAnU2FuIEZyYW5jaXNjbywgQ0EnLCB0ZW1wUmFuZ2U6IFs1MCwgNzBdIH0sXG4gICAgeyBuYW1lOiAnTmV3IFlvcmssIE5ZJywgdGVtcFJhbmdlOiBbMzAsIDg1XSB9LFxuICAgIHsgbmFtZTogJ01pYW1pLCBGTCcsIHRlbXBSYW5nZTogWzY1LCA5NV0gfSxcbiAgICB7IG5hbWU6ICdTZWF0dGxlLCBXQScsIHRlbXBSYW5nZTogWzQwLCA3NV0gfSxcbiAgICB7IG5hbWU6ICdEZW52ZXIsIENPJywgdGVtcFJhbmdlOiBbMjUsIDgwXSB9LFxuICBdO1xuICBcbiAgY29uc3QgY2l0eSA9IGNpdGllc1tNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBjaXRpZXMubGVuZ3RoKV07XG4gIGNvbnN0IHRlbXAgPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAoY2l0eS50ZW1wUmFuZ2VbMV0gLSBjaXR5LnRlbXBSYW5nZVswXSkpICsgY2l0eS50ZW1wUmFuZ2VbMF07XG4gIFxuICByZXR1cm4ge1xuICAgIGxvY2F0aW9uOiBjaXR5Lm5hbWUsXG4gICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgY3VycmVudDoge1xuICAgICAgdGVtcGVyYXR1cmU6IHRlbXAsXG4gICAgICB0ZW1wZXJhdHVyZVVuaXQ6ICdGJyxcbiAgICAgIGNvbmRpdGlvbnM6IGNvbmRpdGlvbnNbTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogY29uZGl0aW9ucy5sZW5ndGgpXSxcbiAgICAgIGh1bWlkaXR5OiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiA2MCkgKyAzMCxcbiAgICAgIHdpbmRTcGVlZDogTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMjUpICsgNSxcbiAgICAgIHdpbmRVbml0OiAnbXBoJyxcbiAgICAgIHV2SW5kZXg6IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDExKSxcbiAgICB9LFxuICAgIGZvcmVjYXN0OiBBcnJheS5mcm9tKHsgbGVuZ3RoOiA1IH0sIChfLCBpKSA9PiAoe1xuICAgICAgZGF5OiBuZXcgRGF0ZShEYXRlLm5vdygpICsgKGkgKyAxKSAqIDI0ICogNjAgKiA2MCAqIDEwMDApLnRvTG9jYWxlRGF0ZVN0cmluZygnZW4tVVMnLCB7IHdlZWtkYXk6ICdzaG9ydCcgfSksXG4gICAgICBjb25kaXRpb25zOiBjb25kaXRpb25zW01hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIGNvbmRpdGlvbnMubGVuZ3RoKV0sXG4gICAgICBoaWdoOiB0ZW1wICsgTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMTApLFxuICAgICAgbG93OiB0ZW1wIC0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMTUpLFxuICAgIH0pKSxcbiAgICBzb3VyY2U6ICd4NDAyLXdlYXRoZXItc2VydmljZScsXG4gICAgcHJlbWl1bTogdHJ1ZSxcbiAgfTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZXMgZHluYW1pYyBtYXJrZXQgYW5hbHlzaXMgZGF0YVxuICovXG5mdW5jdGlvbiBnZW5lcmF0ZU1hcmtldERhdGEoKTogdW5rbm93biB7XG4gIGNvbnN0IGNyeXB0b3MgPSBbXG4gICAgeyBzeW1ib2w6ICdCVEMnLCBuYW1lOiAnQml0Y29pbicsIGJhc2VQcmljZTogOTgwMDAgfSxcbiAgICB7IHN5bWJvbDogJ0VUSCcsIG5hbWU6ICdFdGhlcmV1bScsIGJhc2VQcmljZTogMzgwMCB9LFxuICAgIHsgc3ltYm9sOiAnU09MJywgbmFtZTogJ1NvbGFuYScsIGJhc2VQcmljZTogMTQ1IH0sXG4gICAgeyBzeW1ib2w6ICdBVkFYJywgbmFtZTogJ0F2YWxhbmNoZScsIGJhc2VQcmljZTogNDIgfSxcbiAgICB7IHN5bWJvbDogJ01BVElDJywgbmFtZTogJ1BvbHlnb24nLCBiYXNlUHJpY2U6IDAuODUgfSxcbiAgXTtcbiAgXG4gIGNvbnN0IG1hcmtldHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gIFxuICBmb3IgKGNvbnN0IGNyeXB0byBvZiBjcnlwdG9zKSB7XG4gICAgY29uc3QgY2hhbmdlUGVyY2VudCA9IChNYXRoLnJhbmRvbSgpICogMTAgLSA1KS50b0ZpeGVkKDIpO1xuICAgIGNvbnN0IHByaWNlID0gY3J5cHRvLmJhc2VQcmljZSAqICgxICsgcGFyc2VGbG9hdChjaGFuZ2VQZXJjZW50KSAvIDEwMCk7XG4gICAgY29uc3Qgdm9sdW1lID0gKE1hdGgucmFuZG9tKCkgKiAzMCArIDUpLnRvRml4ZWQoMSk7XG4gICAgXG4gICAgbWFya2V0c1tjcnlwdG8uc3ltYm9sXSA9IHtcbiAgICAgIG5hbWU6IGNyeXB0by5uYW1lLFxuICAgICAgcHJpY2U6IHByaWNlLnRvRml4ZWQoMiksXG4gICAgICBjaGFuZ2UyNGg6IGAke3BhcnNlRmxvYXQoY2hhbmdlUGVyY2VudCkgPj0gMCA/ICcrJyA6ICcnfSR7Y2hhbmdlUGVyY2VudH0lYCxcbiAgICAgIHZvbHVtZTI0aDogYCQke3ZvbHVtZX1CYCxcbiAgICAgIG1hcmtldENhcDogYCQkeyhwcmljZSAqIChjcnlwdG8uc3ltYm9sID09PSAnQlRDJyA/IDE5LjUgOiBjcnlwdG8uc3ltYm9sID09PSAnRVRIJyA/IDEyMCA6IDQwMCkpLnRvRml4ZWQoMCl9TWAsXG4gICAgfTtcbiAgfVxuICBcbiAgY29uc3Qgc2VudGltZW50cyA9IFsnQnVsbGlzaCcsICdCZWFyaXNoJywgJ05ldXRyYWwnLCAnVmVyeSBCdWxsaXNoJywgJ0NhdXRpb3VzbHkgT3B0aW1pc3RpYyddO1xuICBcbiAgcmV0dXJuIHtcbiAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICBkYXRlOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXSxcbiAgICBtYXJrZXRzLFxuICAgIGFuYWx5c2lzOiB7XG4gICAgICBvdmVyYWxsU2VudGltZW50OiBzZW50aW1lbnRzW01hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIHNlbnRpbWVudHMubGVuZ3RoKV0sXG4gICAgICBzdW1tYXJ5OiAnTWFya2V0IHNob3dpbmcgbWl4ZWQgc2lnbmFscyB3aXRoIG1ham9yIGNyeXB0b2N1cnJlbmNpZXMgZXhwZXJpZW5jaW5nIHZhcmllZCBtb21lbnR1bS4gVGVjaG5pY2FsIGluZGljYXRvcnMgc3VnZ2VzdCBwb3RlbnRpYWwgY29uc29saWRhdGlvbiBwaGFzZS4nLFxuICAgICAga2V5RXZlbnRzOiBbXG4gICAgICAgICdGZWRlcmFsIFJlc2VydmUgbWVldGluZyBzY2hlZHVsZWQgZm9yIG5leHQgd2VlaycsXG4gICAgICAgICdNYWpvciBwcm90b2NvbCB1cGdyYWRlIGFubm91bmNlZCBmb3IgRXRoZXJldW0nLFxuICAgICAgICAnSW5zdGl0dXRpb25hbCBhZG9wdGlvbiBjb250aW51ZXMgdG8gZ3JvdycsXG4gICAgICBdLFxuICAgICAgcmlza0xldmVsOiBbJ0xvdycsICdNZWRpdW0nLCAnSGlnaCddW01hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDMpXSxcbiAgICB9LFxuICAgIHNvdXJjZTogJ3g0MDItbWFya2V0LXNlcnZpY2UnLFxuICAgIHByZW1pdW06IHRydWUsXG4gIH07XG59XG5cbi8qKlxuICogQ29udGVudCBnZW5lcmF0b3JzIHJlZ2lzdHJ5XG4gKi9cbmNvbnN0IENPTlRFTlRfR0VORVJBVE9SUzogUmVjb3JkPHN0cmluZywgKCkgPT4gdW5rbm93bj4gPSB7XG4gIHdlYXRoZXI6IGdlbmVyYXRlV2VhdGhlckRhdGEsXG4gIG1hcmtldDogZ2VuZXJhdGVNYXJrZXREYXRhLFxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUzMgQ29udGVudCBGZXRjaGluZ1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFMzIGNsaWVudCBmb3IgZmV0Y2hpbmcgY29udGVudCBmcm9tIFMzIGJ1Y2tldHNcbiAqIExhbWJkYUBFZGdlIHJ1bnMgaW4gdXMtZWFzdC0xLCBzbyB3ZSB1c2UgdGhhdCByZWdpb25cbiAqL1xuY29uc3QgczNDbGllbnQgPSBuZXcgUzNDbGllbnQoeyByZWdpb246ICd1cy1lYXN0LTEnIH0pO1xuXG4vKipcbiAqIENhY2hlIGZvciBTMyBjb250ZW50IHRvIHJlZHVjZSBsYXRlbmN5IG9uIHJlcGVhdGVkIHJlcXVlc3RzXG4gKiBOb3RlOiBMYW1iZGFARWRnZSBpbnN0YW5jZXMgbWF5IGJlIHJldXNlZCwgc28gdGhpcyBwcm92aWRlcyBzb21lIGNhY2hpbmcgYmVuZWZpdFxuICovXG5jb25zdCBzM0NvbnRlbnRDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCB7IGRhdGE6IHVua25vd247IHRpbWVzdGFtcDogbnVtYmVyIH0+KCk7XG5cbi8qKlxuICogQ2FjaGUgVFRMIGluIG1pbGxpc2Vjb25kcyAoNSBtaW51dGVzKVxuICovXG5jb25zdCBTM19DQUNIRV9UVExfTVMgPSA1ICogNjAgKiAxMDAwO1xuXG4vKipcbiAqIEZldGNoZXMgY29udGVudCBmcm9tIFMzIGJ1Y2tldFxuICogQHBhcmFtIGJ1Y2tldCAtIFMzIGJ1Y2tldCBuYW1lXG4gKiBAcGFyYW0ga2V5IC0gUzMgb2JqZWN0IGtleVxuICogQHJldHVybnMgVGhlIGNvbnRlbnQgZnJvbSBTMyBvciBhbiBlcnJvciBvYmplY3RcbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmV0Y2hTM0NvbnRlbnQoYnVja2V0OiBzdHJpbmcsIGtleTogc3RyaW5nKTogUHJvbWlzZTx1bmtub3duPiB7XG4gIGNvbnN0IGNhY2hlS2V5ID0gYCR7YnVja2V0fS8ke2tleX1gO1xuICBcbiAgLy8gQ2hlY2sgY2FjaGUgZmlyc3RcbiAgY29uc3QgY2FjaGVkID0gczNDb250ZW50Q2FjaGUuZ2V0KGNhY2hlS2V5KTtcbiAgaWYgKGNhY2hlZCAmJiBEYXRlLm5vdygpIC0gY2FjaGVkLnRpbWVzdGFtcCA8IFMzX0NBQ0hFX1RUTF9NUykge1xuICAgIHJldHVybiBjYWNoZWQuZGF0YTtcbiAgfVxuICBcbiAgdHJ5IHtcbiAgICBjb25zdCBjb21tYW5kID0gbmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgQnVja2V0OiBidWNrZXQsXG4gICAgICBLZXk6IGtleSxcbiAgICB9KTtcbiAgICBcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHMzQ2xpZW50LnNlbmQoY29tbWFuZCk7XG4gICAgXG4gICAgaWYgKCFyZXNwb25zZS5Cb2R5KSB7XG4gICAgICByZXR1cm4geyBlcnJvcjogJ0VtcHR5IHJlc3BvbnNlIGZyb20gUzMnLCBidWNrZXQsIGtleSB9O1xuICAgIH1cbiAgICBcbiAgICAvLyBSZWFkIHRoZSBzdHJlYW0gYW5kIGNvbnZlcnQgdG8gc3RyaW5nXG4gICAgY29uc3QgYm9keUNvbnRlbnRzID0gYXdhaXQgcmVzcG9uc2UuQm9keS50cmFuc2Zvcm1Ub1N0cmluZygpO1xuICAgIFxuICAgIC8vIFRyeSB0byBwYXJzZSBhcyBKU09OLCBvdGhlcndpc2UgcmV0dXJuIGFzIHN0cmluZ1xuICAgIGxldCBjb250ZW50OiB1bmtub3duO1xuICAgIHRyeSB7XG4gICAgICBjb250ZW50ID0gSlNPTi5wYXJzZShib2R5Q29udGVudHMpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gTm90IEpTT04sIHJldHVybiBhcy1pcyB3cmFwcGVkIGluIGFuIG9iamVjdFxuICAgICAgY29udGVudCA9IHtcbiAgICAgICAgdHlwZTogJ3RleHQnLFxuICAgICAgICBjb250ZW50OiBib2R5Q29udGVudHMsXG4gICAgICAgIG1pbWVUeXBlOiByZXNwb25zZS5Db250ZW50VHlwZSB8fCAndGV4dC9wbGFpbicsXG4gICAgICB9O1xuICAgIH1cbiAgICBcbiAgICAvLyBDYWNoZSB0aGUgcmVzdWx0XG4gICAgczNDb250ZW50Q2FjaGUuc2V0KGNhY2hlS2V5LCB7IGRhdGE6IGNvbnRlbnQsIHRpbWVzdGFtcDogRGF0ZS5ub3coKSB9KTtcbiAgICBcbiAgICByZXR1cm4gY29udGVudDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJztcbiAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gZmV0Y2ggUzMgY29udGVudDogJHtidWNrZXR9LyR7a2V5fWAsIGVycm9yKTtcbiAgICByZXR1cm4ge1xuICAgICAgZXJyb3I6ICdGYWlsZWQgdG8gZmV0Y2ggUzMgY29udGVudCcsXG4gICAgICBidWNrZXQsXG4gICAgICBrZXksXG4gICAgICBtZXNzYWdlOiBlcnJvck1lc3NhZ2UsXG4gICAgfTtcbiAgfVxufVxuXG4vKipcbiAqIENsZWFycyB0aGUgUzMgY29udGVudCBjYWNoZVxuICogVXNlZnVsIGZvciB0ZXN0aW5nIG9yIHdoZW4gY29udGVudCBuZWVkcyB0byBiZSByZWZyZXNoZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyUzNDYWNoZSgpOiB2b2lkIHtcbiAgczNDb250ZW50Q2FjaGUuY2xlYXIoKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ29udGVudCBNYW5hZ2VyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQ29udGVudCBNYW5hZ2VyIGNsYXNzIGZvciBoYW5kbGluZyBkeW5hbWljIGNvbnRlbnRcbiAqL1xuZXhwb3J0IGNsYXNzIENvbnRlbnRNYW5hZ2VyIHtcbiAgcHJpdmF0ZSByZWdpc3RyeTogQ29udGVudFJlZ2lzdHJ5O1xuICBcbiAgY29uc3RydWN0b3IocmVnaXN0cnk6IENvbnRlbnRSZWdpc3RyeSA9IERFRkFVTFRfQ09OVEVOVF9SRUdJU1RSWSkge1xuICAgIHRoaXMucmVnaXN0cnkgPSByZWdpc3RyeTtcbiAgfVxuICBcbiAgLyoqXG4gICAqIEdldHMgcGF5bWVudCByZXF1aXJlbWVudHMgZm9yIGEgZ2l2ZW4gcGF0aFxuICAgKi9cbiAgZ2V0UGF5bWVudFJlcXVpcmVtZW50cyhwYXRoOiBzdHJpbmcpOiBQYXltZW50UmVxdWlyZW1lbnRzIHwgbnVsbCB7XG4gICAgY29uc3QgaXRlbSA9IHRoaXMucmVnaXN0cnkuaXRlbXNbcGF0aF07XG4gICAgcmV0dXJuIGl0ZW0/LnByaWNpbmcgfHwgbnVsbDtcbiAgfVxuICBcbiAgLyoqXG4gICAqIEdldHMgY29udGVudCBmb3IgYSBnaXZlbiBwYXRoXG4gICAqL1xuICBhc3luYyBnZXRDb250ZW50KHBhdGg6IHN0cmluZyk6IFByb21pc2U8dW5rbm93bj4ge1xuICAgIGNvbnN0IGl0ZW0gPSB0aGlzLnJlZ2lzdHJ5Lml0ZW1zW3BhdGhdO1xuICAgIFxuICAgIGlmICghaXRlbSkge1xuICAgICAgcmV0dXJuIHsgZXJyb3I6ICdDb250ZW50IG5vdCBmb3VuZCcsIHBhdGggfTtcbiAgICB9XG4gICAgXG4gICAgc3dpdGNoIChpdGVtLnNvdXJjZS50eXBlKSB7XG4gICAgICBjYXNlICdpbmxpbmUnOlxuICAgICAgICByZXR1cm4gaXRlbS5zb3VyY2UuZGF0YTtcbiAgICAgICAgXG4gICAgICBjYXNlICdkeW5hbWljJzpcbiAgICAgICAgY29uc3QgZ2VuZXJhdG9yID0gQ09OVEVOVF9HRU5FUkFUT1JTW2l0ZW0uc291cmNlLmdlbmVyYXRvcl07XG4gICAgICAgIGlmIChnZW5lcmF0b3IpIHtcbiAgICAgICAgICByZXR1cm4gZ2VuZXJhdG9yKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHsgZXJyb3I6ICdHZW5lcmF0b3Igbm90IGZvdW5kJywgZ2VuZXJhdG9yOiBpdGVtLnNvdXJjZS5nZW5lcmF0b3IgfTtcbiAgICAgICAgXG4gICAgICBjYXNlICdzMyc6XG4gICAgICAgIC8vIEZldGNoIGNvbnRlbnQgZnJvbSBTMyBidWNrZXRcbiAgICAgICAgcmV0dXJuIGF3YWl0IGZldGNoUzNDb250ZW50KGl0ZW0uc291cmNlLmJ1Y2tldCwgaXRlbS5zb3VyY2Uua2V5KTtcbiAgICAgICAgXG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4geyBlcnJvcjogJ1Vua25vd24gY29udGVudCBzb3VyY2UgdHlwZScgfTtcbiAgICB9XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBHZXRzIGNvbnRlbnQgaXRlbSBtZXRhZGF0YVxuICAgKi9cbiAgZ2V0Q29udGVudEl0ZW0ocGF0aDogc3RyaW5nKTogQ29udGVudEl0ZW0gfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RyeS5pdGVtc1twYXRoXSB8fCBudWxsO1xuICB9XG4gIFxuICAvKipcbiAgICogTGlzdHMgYWxsIGF2YWlsYWJsZSBjb250ZW50IHBhdGhzXG4gICAqL1xuICBsaXN0Q29udGVudFBhdGhzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5yZWdpc3RyeS5pdGVtcyk7XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgYSBwYXRoIHJlcXVpcmVzIHBheW1lbnRcbiAgICovXG4gIHJlcXVpcmVzUGF5bWVudChwYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gcGF0aCBpbiB0aGlzLnJlZ2lzdHJ5Lml0ZW1zO1xuICB9XG4gIFxuICAvKipcbiAgICogR2V0cyB0aGUgY29udGVudCByZWdpc3RyeSB2ZXJzaW9uXG4gICAqL1xuICBnZXRWZXJzaW9uKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0cnkudmVyc2lvbjtcbiAgfVxuICBcbiAgLyoqXG4gICAqIEFkZHMgb3IgdXBkYXRlcyBhIGNvbnRlbnQgaXRlbVxuICAgKi9cbiAgc2V0Q29udGVudEl0ZW0oaXRlbTogQ29udGVudEl0ZW0pOiB2b2lkIHtcbiAgICB0aGlzLnJlZ2lzdHJ5Lml0ZW1zW2l0ZW0ucGF0aF0gPSBpdGVtO1xuICB9XG4gIFxuICAvKipcbiAgICogUmVtb3ZlcyBhIGNvbnRlbnQgaXRlbVxuICAgKi9cbiAgcmVtb3ZlQ29udGVudEl0ZW0ocGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgaWYgKHBhdGggaW4gdGhpcy5yZWdpc3RyeS5pdGVtcykge1xuICAgICAgZGVsZXRlIHRoaXMucmVnaXN0cnkuaXRlbXNbcGF0aF07XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNpbmdsZXRvbiBJbnN0YW5jZVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIERlZmF1bHQgY29udGVudCBtYW5hZ2VyIGluc3RhbmNlXG4gKi9cbmV4cG9ydCBjb25zdCBjb250ZW50TWFuYWdlciA9IG5ldyBDb250ZW50TWFuYWdlcigpO1xuIl19