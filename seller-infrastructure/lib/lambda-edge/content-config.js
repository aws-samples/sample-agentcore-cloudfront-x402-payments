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
exports.setContentBucket = setContentBucket;
const client_s3_1 = require("@aws-sdk/client-s3");
// ============================================================================
// Default Configuration
// ============================================================================
/**
 * Default payment recipient address
 * Lambda@Edge doesn't support environment variables, so this is bundled
 * ⚠️  CHANGE THIS to your own Base Sepolia wallet address before deploying
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
 * Set at runtime from the CloudFront origin event via setContentBucket()
 * Lambda@Edge doesn't support environment variables, so this is resolved dynamically
 */
let DEFAULT_CONTENT_BUCKET = '';
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
/**
 * Sets the S3 bucket name for all S3-backed content items.
 * Called at runtime from the Lambda handler using the CloudFront origin domain.
 */
function setContentBucket(bucketName) {
    DEFAULT_CONTENT_BUCKET = bucketName;
    for (const item of Object.values(exports.contentManager['registry'].items)) {
        if (item.source.type === 's3') {
            item.source.bucket = bucketName;
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC1jb25maWcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb250ZW50LWNvbmZpZy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7O0dBUUc7OztBQXVGSCw4REFrQkM7QUFzVUQsb0NBRUM7QUFrSEQsNENBT0M7QUF2aUJELGtEQUFnRTtBQW9EaEUsK0VBQStFO0FBQy9FLHdCQUF3QjtBQUN4QiwrRUFBK0U7QUFFL0U7Ozs7R0FJRztBQUNILE1BQU0sY0FBYyxHQUFHLDRDQUE0QyxDQUFDO0FBRXBFOzs7R0FHRztBQUNILE1BQU0sZUFBZSxHQUFHLGNBQWMsQ0FBQztBQUV2Qzs7R0FFRztBQUNILE1BQU0sYUFBYSxHQUFHLDRDQUE0QyxDQUFDO0FBRW5FOzs7O0dBSUc7QUFDSCxJQUFJLHNCQUFzQixHQUFHLEVBQUUsQ0FBQztBQUVoQzs7R0FFRztBQUNILFNBQWdCLHlCQUF5QixDQUN2QyxNQUFjLEVBQ2QsU0FBd0M7SUFFeEMsT0FBTztRQUNMLE1BQU0sRUFBRSxPQUFPO1FBQ2YsT0FBTyxFQUFFLGVBQWU7UUFDeEIsTUFBTTtRQUNOLEtBQUssRUFBRSxhQUFhO1FBQ3BCLEtBQUssRUFBRSxjQUFjO1FBQ3JCLGlCQUFpQixFQUFFLEVBQUU7UUFDckIsS0FBSyxFQUFFO1lBQ0wsSUFBSSxFQUFFLE1BQU07WUFDWixPQUFPLEVBQUUsR0FBRztZQUNaLG1CQUFtQixFQUFFLFNBQVM7U0FDL0I7UUFDRCxHQUFHLFNBQVM7S0FDYixDQUFDO0FBQ0osQ0FBQztBQUVELCtFQUErRTtBQUMvRSwyQkFBMkI7QUFDM0IsK0VBQStFO0FBRS9FOztHQUVHO0FBQ1UsUUFBQSx3QkFBd0IsR0FBb0I7SUFDdkQsT0FBTyxFQUFFLE9BQU87SUFDaEIsWUFBWSxFQUFFLGNBQWM7SUFDNUIsY0FBYyxFQUFFLGVBQWU7SUFDL0IsWUFBWSxFQUFFLGFBQWE7SUFDM0IsS0FBSyxFQUFFO1FBQ0wsK0NBQStDO1FBQy9DLGtCQUFrQixFQUFF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RUFBK0U7QUFFL0U7O0dBRUc7QUFDVSxRQUFBLGNBQWMsR0FBRyxJQUFJLGNBQWMsRUFBRSxDQUFDO0FBRW5EOzs7R0FHRztBQUNILFNBQWdCLGdCQUFnQixDQUFDLFVBQWtCO0lBQ2pELHNCQUFzQixHQUFHLFVBQVUsQ0FBQztJQUNwQyxLQUFLLE1BQU0sSUFBSSxJQUFJLE1BQU0sQ0FBQyxNQUFNLENBQUMsc0JBQWMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ25FLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEtBQUssSUFBSSxFQUFFLENBQUM7WUFDOUIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEdBQUcsVUFBVSxDQUFDO1FBQ2xDLENBQUM7SUFDSCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRHluYW1pYyBDb250ZW50IENvbmZpZ3VyYXRpb24gTW9kdWxlXG4gKiBcbiAqIFRoaXMgbW9kdWxlIHByb3ZpZGVzIGR5bmFtaWMgY29udGVudCBhbmQgcHJpY2luZyBjb25maWd1cmF0aW9uIGZvciB0aGUgeDQwMiBwYXltZW50IHZlcmlmaWVyLlxuICogQ29udGVudCBjYW4gYmUgbG9hZGVkIGZyb206XG4gKiAxLiBTdGF0aWMgY29uZmlndXJhdGlvbiAoZGVmYXVsdClcbiAqIDIuIEVudmlyb25tZW50IHZhcmlhYmxlcyAoZm9yIHByaWNpbmcgb3ZlcnJpZGVzKVxuICogMy4gUzMgYnVja2V0IChmb3IgZHluYW1pYyBjb250ZW50KVxuICovXG5cbmltcG9ydCB7IFBheW1lbnRSZXF1aXJlbWVudHMgfSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IFMzQ2xpZW50LCBHZXRPYmplY3RDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXMzJztcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ29udGVudCBDb25maWd1cmF0aW9uIFR5cGVzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQ29udGVudCBpdGVtIHdpdGggbWV0YWRhdGEgYW5kIHByaWNpbmdcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb250ZW50SXRlbSB7XG4gIC8qKiBVbmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIGNvbnRlbnQgKi9cbiAgaWQ6IHN0cmluZztcbiAgLyoqIFVSTCBwYXRoIGZvciB0aGUgY29udGVudCAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSB0aXRsZSAqL1xuICB0aXRsZTogc3RyaW5nO1xuICAvKiogQ29udGVudCBkZXNjcmlwdGlvbiAqL1xuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICAvKiogTUlNRSB0eXBlIG9mIHRoZSBjb250ZW50ICovXG4gIG1pbWVUeXBlOiBzdHJpbmc7XG4gIC8qKiBQYXltZW50IHJlcXVpcmVtZW50cyBmb3IgdGhpcyBjb250ZW50ICovXG4gIHByaWNpbmc6IFBheW1lbnRSZXF1aXJlbWVudHM7XG4gIC8qKiBDb250ZW50IHNvdXJjZSAtIGlubGluZSBkYXRhIG9yIFMzIHJlZmVyZW5jZSAqL1xuICBzb3VyY2U6IENvbnRlbnRTb3VyY2U7XG4gIC8qKiBPcHRpb25hbCBtZXRhZGF0YSAqL1xuICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufVxuXG4vKipcbiAqIENvbnRlbnQgc291cmNlIC0gZWl0aGVyIGlubGluZSBkYXRhIG9yIFMzIHJlZmVyZW5jZVxuICovXG5leHBvcnQgdHlwZSBDb250ZW50U291cmNlID0gXG4gIHwgeyB0eXBlOiAnaW5saW5lJzsgZGF0YTogdW5rbm93biB9XG4gIHwgeyB0eXBlOiAnczMnOyBidWNrZXQ6IHN0cmluZzsga2V5OiBzdHJpbmcgfVxuICB8IHsgdHlwZTogJ2R5bmFtaWMnOyBnZW5lcmF0b3I6IHN0cmluZyB9O1xuXG4vKipcbiAqIENvbnRlbnQgcmVnaXN0cnkgZm9yIG1hbmFnaW5nIGFsbCBhdmFpbGFibGUgY29udGVudFxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbnRlbnRSZWdpc3RyeSB7XG4gIC8qKiBWZXJzaW9uIG9mIHRoZSBjb25maWd1cmF0aW9uICovXG4gIHZlcnNpb246IHN0cmluZztcbiAgLyoqIERlZmF1bHQgcGF5bWVudCByZWNpcGllbnQgYWRkcmVzcyAqL1xuICBkZWZhdWx0UGF5VG86IHN0cmluZztcbiAgLyoqIERlZmF1bHQgbmV0d29yayBmb3IgcGF5bWVudHMgKi9cbiAgZGVmYXVsdE5ldHdvcms6IHN0cmluZztcbiAgLyoqIERlZmF1bHQgYXNzZXQgZm9yIHBheW1lbnRzICovXG4gIGRlZmF1bHRBc3NldDogc3RyaW5nO1xuICAvKiogQ29udGVudCBpdGVtcyBpbmRleGVkIGJ5IHBhdGggKi9cbiAgaXRlbXM6IFJlY29yZDxzdHJpbmcsIENvbnRlbnRJdGVtPjtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRGVmYXVsdCBDb25maWd1cmF0aW9uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRGVmYXVsdCBwYXltZW50IHJlY2lwaWVudCBhZGRyZXNzXG4gKiBMYW1iZGFARWRnZSBkb2Vzbid0IHN1cHBvcnQgZW52aXJvbm1lbnQgdmFyaWFibGVzLCBzbyB0aGlzIGlzIGJ1bmRsZWRcbiAqIOKaoO+4jyAgQ0hBTkdFIFRISVMgdG8geW91ciBvd24gQmFzZSBTZXBvbGlhIHdhbGxldCBhZGRyZXNzIGJlZm9yZSBkZXBsb3lpbmdcbiAqL1xuY29uc3QgREVGQVVMVF9QQVlfVE8gPSAnMHgyNDg0MkYzMTM2RmEyYTNkZjgzNWQzNmI0YzNjYjQ5NzJkNDA1NTAyJztcblxuLyoqXG4gKiBEZWZhdWx0IG5ldHdvcmsgKEJhc2UgU2Vwb2xpYSB0ZXN0bmV0KVxuICogVXNlICdlaXAxNTU6ODQ1MycgZm9yIEJhc2UgTWFpbm5ldCBpbiBwcm9kdWN0aW9uXG4gKi9cbmNvbnN0IERFRkFVTFRfTkVUV09SSyA9ICdlaXAxNTU6ODQ1MzInO1xuXG4vKipcbiAqIERlZmF1bHQgYXNzZXQgKFVTREMgb24gQmFzZSBTZXBvbGlhKVxuICovXG5jb25zdCBERUZBVUxUX0FTU0VUID0gJzB4MDM2Q2JENTM4NDJjNTQyNjYzNGU3OTI5NTQxZUMyMzE4ZjNkQ0Y3ZSc7XG5cbi8qKlxuICogRGVmYXVsdCBTMyBidWNrZXQgZm9yIGNvbnRlbnQgc3RvcmFnZVxuICogU2V0IGF0IHJ1bnRpbWUgZnJvbSB0aGUgQ2xvdWRGcm9udCBvcmlnaW4gZXZlbnQgdmlhIHNldENvbnRlbnRCdWNrZXQoKVxuICogTGFtYmRhQEVkZ2UgZG9lc24ndCBzdXBwb3J0IGVudmlyb25tZW50IHZhcmlhYmxlcywgc28gdGhpcyBpcyByZXNvbHZlZCBkeW5hbWljYWxseVxuICovXG5sZXQgREVGQVVMVF9DT05URU5UX0JVQ0tFVCA9ICcnO1xuXG4vKipcbiAqIENyZWF0ZXMgZGVmYXVsdCBwYXltZW50IHJlcXVpcmVtZW50cyB3aXRoIG9wdGlvbmFsIG92ZXJyaWRlc1xuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUGF5bWVudFJlcXVpcmVtZW50cyhcbiAgYW1vdW50OiBzdHJpbmcsXG4gIG92ZXJyaWRlcz86IFBhcnRpYWw8UGF5bWVudFJlcXVpcmVtZW50cz5cbik6IFBheW1lbnRSZXF1aXJlbWVudHMge1xuICByZXR1cm4ge1xuICAgIHNjaGVtZTogJ2V4YWN0JyxcbiAgICBuZXR3b3JrOiBERUZBVUxUX05FVFdPUkssXG4gICAgYW1vdW50LFxuICAgIGFzc2V0OiBERUZBVUxUX0FTU0VULFxuICAgIHBheVRvOiBERUZBVUxUX1BBWV9UTyxcbiAgICBtYXhUaW1lb3V0U2Vjb25kczogNjAsXG4gICAgZXh0cmE6IHtcbiAgICAgIG5hbWU6ICdVU0RDJyxcbiAgICAgIHZlcnNpb246ICcyJyxcbiAgICAgIGFzc2V0VHJhbnNmZXJNZXRob2Q6ICdlaXAzMDA5JyxcbiAgICB9LFxuICAgIC4uLm92ZXJyaWRlcyxcbiAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRGVmYXVsdCBDb250ZW50IFJlZ2lzdHJ5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRGVmYXVsdCBjb250ZW50IHJlZ2lzdHJ5IHdpdGggc3RhdGljIGNvbnRlbnRcbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfQ09OVEVOVF9SRUdJU1RSWTogQ29udGVudFJlZ2lzdHJ5ID0ge1xuICB2ZXJzaW9uOiAnMS4wLjAnLFxuICBkZWZhdWx0UGF5VG86IERFRkFVTFRfUEFZX1RPLFxuICBkZWZhdWx0TmV0d29yazogREVGQVVMVF9ORVRXT1JLLFxuICBkZWZhdWx0QXNzZXQ6IERFRkFVTFRfQVNTRVQsXG4gIGl0ZW1zOiB7XG4gICAgLy8gUm9vdC1sZXZlbCBjb250ZW50IHBhdGhzIChmb3IgZGlyZWN0IGFjY2VzcylcbiAgICAnL3Jlc2VhcmNoLXJlcG9ydCc6IHtcbiAgICAgIGlkOiAncmVzZWFyY2gtcmVwb3J0JyxcbiAgICAgIHBhdGg6ICcvcmVzZWFyY2gtcmVwb3J0JyxcbiAgICAgIHRpdGxlOiAnQmxvY2tjaGFpbiBSZXNlYXJjaCBSZXBvcnQnLFxuICAgICAgZGVzY3JpcHRpb246ICdJbi1kZXB0aCByZXNlYXJjaCByZXBvcnQgb24gYmxvY2tjaGFpbiB0ZWNobm9sb2d5IHRyZW5kcycsXG4gICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgcHJpY2luZzogY3JlYXRlUGF5bWVudFJlcXVpcmVtZW50cygnNTAwMCcpLFxuICAgICAgc291cmNlOiB7XG4gICAgICAgIHR5cGU6ICdzMycsXG4gICAgICAgIGJ1Y2tldDogREVGQVVMVF9DT05URU5UX0JVQ0tFVCxcbiAgICAgICAga2V5OiAncmVzZWFyY2gtcmVwb3J0JyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAnL2RhdGFzZXQnOiB7XG4gICAgICBpZDogJ2RhdGFzZXQnLFxuICAgICAgcGF0aDogJy9kYXRhc2V0JyxcbiAgICAgIHRpdGxlOiAnUHJlbWl1bSBEYXRhc2V0JyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ3VyYXRlZCBkYXRhc2V0IGZvciBtYWNoaW5lIGxlYXJuaW5nIGFuZCBhbmFseXRpY3MnLFxuICAgICAgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIHByaWNpbmc6IGNyZWF0ZVBheW1lbnRSZXF1aXJlbWVudHMoJzEwMDAwJyksXG4gICAgICBzb3VyY2U6IHtcbiAgICAgICAgdHlwZTogJ3MzJyxcbiAgICAgICAgYnVja2V0OiBERUZBVUxUX0NPTlRFTlRfQlVDS0VULFxuICAgICAgICBrZXk6ICdkYXRhc2V0JyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAnL3R1dG9yaWFsJzoge1xuICAgICAgaWQ6ICd0dXRvcmlhbCcsXG4gICAgICBwYXRoOiAnL3R1dG9yaWFsJyxcbiAgICAgIHRpdGxlOiAnQWR2YW5jZWQgU21hcnQgQ29udHJhY3QgVHV0b3JpYWwnLFxuICAgICAgZGVzY3JpcHRpb246ICdTdGVwLWJ5LXN0ZXAgZ3VpZGUgdG8gYnVpbGRpbmcgYWR2YW5jZWQgc21hcnQgY29udHJhY3RzJyxcbiAgICAgIG1pbWVUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICBwcmljaW5nOiBjcmVhdGVQYXltZW50UmVxdWlyZW1lbnRzKCczMDAwJyksXG4gICAgICBzb3VyY2U6IHtcbiAgICAgICAgdHlwZTogJ3MzJyxcbiAgICAgICAgYnVja2V0OiBERUZBVUxUX0NPTlRFTlRfQlVDS0VULFxuICAgICAgICBrZXk6ICd0dXRvcmlhbCcsXG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gQVBJLXByZWZpeGVkIHBhdGhzIChmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHkpXG4gICAgJy9hcGkvcHJlbWl1bS1hcnRpY2xlJzoge1xuICAgICAgaWQ6ICdwcmVtaXVtLWFydGljbGUnLFxuICAgICAgcGF0aDogJy9hcGkvcHJlbWl1bS1hcnRpY2xlJyxcbiAgICAgIHRpdGxlOiAnVGhlIEZ1dHVyZSBvZiBBSSBhbmQgQmxvY2tjaGFpbiBJbnRlZ3JhdGlvbicsXG4gICAgICBkZXNjcmlwdGlvbjogJ1ByZW1pdW0gYXJ0aWNsZSBhYm91dCBBSSBhbmQgYmxvY2tjaGFpbiBjb252ZXJnZW5jZScsXG4gICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgcHJpY2luZzogY3JlYXRlUGF5bWVudFJlcXVpcmVtZW50cygnMTAwMCcpLFxuICAgICAgc291cmNlOiB7XG4gICAgICAgIHR5cGU6ICdpbmxpbmUnLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgdGl0bGU6ICdUaGUgRnV0dXJlIG9mIEFJIGFuZCBCbG9ja2NoYWluIEludGVncmF0aW9uJyxcbiAgICAgICAgICBhdXRob3I6ICdUZWNoIEluc2lnaHRzJyxcbiAgICAgICAgICBkYXRlOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXSxcbiAgICAgICAgICBjb250ZW50OiAnQXJ0aWZpY2lhbCBJbnRlbGxpZ2VuY2UgYW5kIEJsb2NrY2hhaW4gYXJlIGNvbnZlcmdpbmcgdG8gY3JlYXRlIHVucHJlY2VkZW50ZWQgb3Bwb3J0dW5pdGllcy4uLicsXG4gICAgICAgICAgZnVsbFRleHQ6ICdUaGlzIGlzIHByZW1pdW0gY29udGVudCB0aGF0IHJlcXVpcmVzIHBheW1lbnQgdG8gYWNjZXNzLiBUaGUgaW50ZWdyYXRpb24gb2YgQUkgYW5kIGJsb2NrY2hhaW4gdGVjaG5vbG9neSBpcyByZXZvbHV0aW9uaXppbmcgaG93IHdlIHRoaW5rIGFib3V0IGRlY2VudHJhbGl6ZWQgc3lzdGVtcywgc21hcnQgY29udHJhY3RzLCBhbmQgYXV0b25vbW91cyBhZ2VudHMuIEtleSBhcmVhcyBvZiBpbm5vdmF0aW9uIGluY2x1ZGU6IDEpIERlY2VudHJhbGl6ZWQgQUkgdHJhaW5pbmcsIDIpIFNtYXJ0IGNvbnRyYWN0IGF1dG9tYXRpb24sIDMpIFRva2VuaXplZCBBSSBzZXJ2aWNlcywgNCkgUHJpdmFjeS1wcmVzZXJ2aW5nIGNvbXB1dGF0aW9uLicsXG4gICAgICAgICAgdGFnczogWydBSScsICdibG9ja2NoYWluJywgJ3RlY2hub2xvZ3knLCAnaW5ub3ZhdGlvbiddLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICAgICcvYXBpL3dlYXRoZXItZGF0YSc6IHtcbiAgICAgIGlkOiAnd2VhdGhlci1kYXRhJyxcbiAgICAgIHBhdGg6ICcvYXBpL3dlYXRoZXItZGF0YScsXG4gICAgICB0aXRsZTogJ1JlYWwtdGltZSBXZWF0aGVyIERhdGEnLFxuICAgICAgZGVzY3JpcHRpb246ICdDdXJyZW50IHdlYXRoZXIgY29uZGl0aW9ucyBhbmQgZm9yZWNhc3QnLFxuICAgICAgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIHByaWNpbmc6IGNyZWF0ZVBheW1lbnRSZXF1aXJlbWVudHMoJzUwMCcpLFxuICAgICAgc291cmNlOiB7XG4gICAgICAgIHR5cGU6ICdkeW5hbWljJyxcbiAgICAgICAgZ2VuZXJhdG9yOiAnd2VhdGhlcicsXG4gICAgICB9LFxuICAgIH0sXG4gICAgJy9hcGkvbWFya2V0LWFuYWx5c2lzJzoge1xuICAgICAgaWQ6ICdtYXJrZXQtYW5hbHlzaXMnLFxuICAgICAgcGF0aDogJy9hcGkvbWFya2V0LWFuYWx5c2lzJyxcbiAgICAgIHRpdGxlOiAnQ3J5cHRvY3VycmVuY3kgTWFya2V0IEFuYWx5c2lzJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUmVhbC10aW1lIG1hcmtldCBkYXRhIGFuZCBhbmFseXNpcycsXG4gICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgcHJpY2luZzogY3JlYXRlUGF5bWVudFJlcXVpcmVtZW50cygnMjAwMCcpLFxuICAgICAgc291cmNlOiB7XG4gICAgICAgIHR5cGU6ICdkeW5hbWljJyxcbiAgICAgICAgZ2VuZXJhdG9yOiAnbWFya2V0JyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyBTMy1iYWNrZWQgY29udGVudCBpdGVtcyB3aXRoIC9hcGkvIHByZWZpeFxuICAgICcvYXBpL3Jlc2VhcmNoLXJlcG9ydCc6IHtcbiAgICAgIGlkOiAnYXBpLXJlc2VhcmNoLXJlcG9ydCcsXG4gICAgICBwYXRoOiAnL2FwaS9yZXNlYXJjaC1yZXBvcnQnLFxuICAgICAgdGl0bGU6ICdCbG9ja2NoYWluIFJlc2VhcmNoIFJlcG9ydCcsXG4gICAgICBkZXNjcmlwdGlvbjogJ0luLWRlcHRoIHJlc2VhcmNoIHJlcG9ydCBvbiBibG9ja2NoYWluIHRlY2hub2xvZ3kgdHJlbmRzJyxcbiAgICAgIG1pbWVUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICBwcmljaW5nOiBjcmVhdGVQYXltZW50UmVxdWlyZW1lbnRzKCc1MDAwJyksXG4gICAgICBzb3VyY2U6IHtcbiAgICAgICAgdHlwZTogJ3MzJyxcbiAgICAgICAgYnVja2V0OiBERUZBVUxUX0NPTlRFTlRfQlVDS0VULFxuICAgICAgICBrZXk6ICdyZXNlYXJjaC1yZXBvcnQnLFxuICAgICAgfSxcbiAgICB9LFxuICAgICcvYXBpL2RhdGFzZXQnOiB7XG4gICAgICBpZDogJ2FwaS1kYXRhc2V0JyxcbiAgICAgIHBhdGg6ICcvYXBpL2RhdGFzZXQnLFxuICAgICAgdGl0bGU6ICdQcmVtaXVtIERhdGFzZXQnLFxuICAgICAgZGVzY3JpcHRpb246ICdDdXJhdGVkIGRhdGFzZXQgZm9yIG1hY2hpbmUgbGVhcm5pbmcgYW5kIGFuYWx5dGljcycsXG4gICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgcHJpY2luZzogY3JlYXRlUGF5bWVudFJlcXVpcmVtZW50cygnMTAwMDAnKSxcbiAgICAgIHNvdXJjZToge1xuICAgICAgICB0eXBlOiAnczMnLFxuICAgICAgICBidWNrZXQ6IERFRkFVTFRfQ09OVEVOVF9CVUNLRVQsXG4gICAgICAgIGtleTogJ2RhdGFzZXQnLFxuICAgICAgfSxcbiAgICB9LFxuICAgICcvYXBpL3R1dG9yaWFsJzoge1xuICAgICAgaWQ6ICdhcGktdHV0b3JpYWwnLFxuICAgICAgcGF0aDogJy9hcGkvdHV0b3JpYWwnLFxuICAgICAgdGl0bGU6ICdBZHZhbmNlZCBTbWFydCBDb250cmFjdCBUdXRvcmlhbCcsXG4gICAgICBkZXNjcmlwdGlvbjogJ1N0ZXAtYnktc3RlcCBndWlkZSB0byBidWlsZGluZyBhZHZhbmNlZCBzbWFydCBjb250cmFjdHMnLFxuICAgICAgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIHByaWNpbmc6IGNyZWF0ZVBheW1lbnRSZXF1aXJlbWVudHMoJzMwMDAnKSxcbiAgICAgIHNvdXJjZToge1xuICAgICAgICB0eXBlOiAnczMnLFxuICAgICAgICBidWNrZXQ6IERFRkFVTFRfQ09OVEVOVF9CVUNLRVQsXG4gICAgICAgIGtleTogJ3R1dG9yaWFsJyxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIER5bmFtaWMgQ29udGVudCBHZW5lcmF0b3JzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogR2VuZXJhdGVzIGR5bmFtaWMgd2VhdGhlciBkYXRhXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlV2VhdGhlckRhdGEoKTogdW5rbm93biB7XG4gIGNvbnN0IGNvbmRpdGlvbnMgPSBbJ1N1bm55JywgJ1BhcnRseSBDbG91ZHknLCAnQ2xvdWR5JywgJ1JhaW4nLCAnVGh1bmRlcnN0b3JtJywgJ1Nub3cnLCAnRm9nJ107XG4gIGNvbnN0IGNpdGllcyA9IFtcbiAgICB7IG5hbWU6ICdTYW4gRnJhbmNpc2NvLCBDQScsIHRlbXBSYW5nZTogWzUwLCA3MF0gfSxcbiAgICB7IG5hbWU6ICdOZXcgWW9yaywgTlknLCB0ZW1wUmFuZ2U6IFszMCwgODVdIH0sXG4gICAgeyBuYW1lOiAnTWlhbWksIEZMJywgdGVtcFJhbmdlOiBbNjUsIDk1XSB9LFxuICAgIHsgbmFtZTogJ1NlYXR0bGUsIFdBJywgdGVtcFJhbmdlOiBbNDAsIDc1XSB9LFxuICAgIHsgbmFtZTogJ0RlbnZlciwgQ08nLCB0ZW1wUmFuZ2U6IFsyNSwgODBdIH0sXG4gIF07XG4gIFxuICBjb25zdCBjaXR5ID0gY2l0aWVzW01hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIGNpdGllcy5sZW5ndGgpXTtcbiAgY29uc3QgdGVtcCA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIChjaXR5LnRlbXBSYW5nZVsxXSAtIGNpdHkudGVtcFJhbmdlWzBdKSkgKyBjaXR5LnRlbXBSYW5nZVswXTtcbiAgXG4gIHJldHVybiB7XG4gICAgbG9jYXRpb246IGNpdHkubmFtZSxcbiAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICBjdXJyZW50OiB7XG4gICAgICB0ZW1wZXJhdHVyZTogdGVtcCxcbiAgICAgIHRlbXBlcmF0dXJlVW5pdDogJ0YnLFxuICAgICAgY29uZGl0aW9uczogY29uZGl0aW9uc1tNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBjb25kaXRpb25zLmxlbmd0aCldLFxuICAgICAgaHVtaWRpdHk6IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDYwKSArIDMwLFxuICAgICAgd2luZFNwZWVkOiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAyNSkgKyA1LFxuICAgICAgd2luZFVuaXQ6ICdtcGgnLFxuICAgICAgdXZJbmRleDogTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMTEpLFxuICAgIH0sXG4gICAgZm9yZWNhc3Q6IEFycmF5LmZyb20oeyBsZW5ndGg6IDUgfSwgKF8sIGkpID0+ICh7XG4gICAgICBkYXk6IG5ldyBEYXRlKERhdGUubm93KCkgKyAoaSArIDEpICogMjQgKiA2MCAqIDYwICogMTAwMCkudG9Mb2NhbGVEYXRlU3RyaW5nKCdlbi1VUycsIHsgd2Vla2RheTogJ3Nob3J0JyB9KSxcbiAgICAgIGNvbmRpdGlvbnM6IGNvbmRpdGlvbnNbTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogY29uZGl0aW9ucy5sZW5ndGgpXSxcbiAgICAgIGhpZ2g6IHRlbXAgKyBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxMCksXG4gICAgICBsb3c6IHRlbXAgLSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxNSksXG4gICAgfSkpLFxuICAgIHNvdXJjZTogJ3g0MDItd2VhdGhlci1zZXJ2aWNlJyxcbiAgICBwcmVtaXVtOiB0cnVlLFxuICB9O1xufVxuXG4vKipcbiAqIEdlbmVyYXRlcyBkeW5hbWljIG1hcmtldCBhbmFseXNpcyBkYXRhXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlTWFya2V0RGF0YSgpOiB1bmtub3duIHtcbiAgY29uc3QgY3J5cHRvcyA9IFtcbiAgICB7IHN5bWJvbDogJ0JUQycsIG5hbWU6ICdCaXRjb2luJywgYmFzZVByaWNlOiA5ODAwMCB9LFxuICAgIHsgc3ltYm9sOiAnRVRIJywgbmFtZTogJ0V0aGVyZXVtJywgYmFzZVByaWNlOiAzODAwIH0sXG4gICAgeyBzeW1ib2w6ICdTT0wnLCBuYW1lOiAnU29sYW5hJywgYmFzZVByaWNlOiAxNDUgfSxcbiAgICB7IHN5bWJvbDogJ0FWQVgnLCBuYW1lOiAnQXZhbGFuY2hlJywgYmFzZVByaWNlOiA0MiB9LFxuICAgIHsgc3ltYm9sOiAnTUFUSUMnLCBuYW1lOiAnUG9seWdvbicsIGJhc2VQcmljZTogMC44NSB9LFxuICBdO1xuICBcbiAgY29uc3QgbWFya2V0czogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgXG4gIGZvciAoY29uc3QgY3J5cHRvIG9mIGNyeXB0b3MpIHtcbiAgICBjb25zdCBjaGFuZ2VQZXJjZW50ID0gKE1hdGgucmFuZG9tKCkgKiAxMCAtIDUpLnRvRml4ZWQoMik7XG4gICAgY29uc3QgcHJpY2UgPSBjcnlwdG8uYmFzZVByaWNlICogKDEgKyBwYXJzZUZsb2F0KGNoYW5nZVBlcmNlbnQpIC8gMTAwKTtcbiAgICBjb25zdCB2b2x1bWUgPSAoTWF0aC5yYW5kb20oKSAqIDMwICsgNSkudG9GaXhlZCgxKTtcbiAgICBcbiAgICBtYXJrZXRzW2NyeXB0by5zeW1ib2xdID0ge1xuICAgICAgbmFtZTogY3J5cHRvLm5hbWUsXG4gICAgICBwcmljZTogcHJpY2UudG9GaXhlZCgyKSxcbiAgICAgIGNoYW5nZTI0aDogYCR7cGFyc2VGbG9hdChjaGFuZ2VQZXJjZW50KSA+PSAwID8gJysnIDogJyd9JHtjaGFuZ2VQZXJjZW50fSVgLFxuICAgICAgdm9sdW1lMjRoOiBgJCR7dm9sdW1lfUJgLFxuICAgICAgbWFya2V0Q2FwOiBgJCR7KHByaWNlICogKGNyeXB0by5zeW1ib2wgPT09ICdCVEMnID8gMTkuNSA6IGNyeXB0by5zeW1ib2wgPT09ICdFVEgnID8gMTIwIDogNDAwKSkudG9GaXhlZCgwKX1NYCxcbiAgICB9O1xuICB9XG4gIFxuICBjb25zdCBzZW50aW1lbnRzID0gWydCdWxsaXNoJywgJ0JlYXJpc2gnLCAnTmV1dHJhbCcsICdWZXJ5IEJ1bGxpc2gnLCAnQ2F1dGlvdXNseSBPcHRpbWlzdGljJ107XG4gIFxuICByZXR1cm4ge1xuICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIGRhdGU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdLFxuICAgIG1hcmtldHMsXG4gICAgYW5hbHlzaXM6IHtcbiAgICAgIG92ZXJhbGxTZW50aW1lbnQ6IHNlbnRpbWVudHNbTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogc2VudGltZW50cy5sZW5ndGgpXSxcbiAgICAgIHN1bW1hcnk6ICdNYXJrZXQgc2hvd2luZyBtaXhlZCBzaWduYWxzIHdpdGggbWFqb3IgY3J5cHRvY3VycmVuY2llcyBleHBlcmllbmNpbmcgdmFyaWVkIG1vbWVudHVtLiBUZWNobmljYWwgaW5kaWNhdG9ycyBzdWdnZXN0IHBvdGVudGlhbCBjb25zb2xpZGF0aW9uIHBoYXNlLicsXG4gICAgICBrZXlFdmVudHM6IFtcbiAgICAgICAgJ0ZlZGVyYWwgUmVzZXJ2ZSBtZWV0aW5nIHNjaGVkdWxlZCBmb3IgbmV4dCB3ZWVrJyxcbiAgICAgICAgJ01ham9yIHByb3RvY29sIHVwZ3JhZGUgYW5ub3VuY2VkIGZvciBFdGhlcmV1bScsXG4gICAgICAgICdJbnN0aXR1dGlvbmFsIGFkb3B0aW9uIGNvbnRpbnVlcyB0byBncm93JyxcbiAgICAgIF0sXG4gICAgICByaXNrTGV2ZWw6IFsnTG93JywgJ01lZGl1bScsICdIaWdoJ11bTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMyldLFxuICAgIH0sXG4gICAgc291cmNlOiAneDQwMi1tYXJrZXQtc2VydmljZScsXG4gICAgcHJlbWl1bTogdHJ1ZSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDb250ZW50IGdlbmVyYXRvcnMgcmVnaXN0cnlcbiAqL1xuY29uc3QgQ09OVEVOVF9HRU5FUkFUT1JTOiBSZWNvcmQ8c3RyaW5nLCAoKSA9PiB1bmtub3duPiA9IHtcbiAgd2VhdGhlcjogZ2VuZXJhdGVXZWF0aGVyRGF0YSxcbiAgbWFya2V0OiBnZW5lcmF0ZU1hcmtldERhdGEsXG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTMyBDb250ZW50IEZldGNoaW5nXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogUzMgY2xpZW50IGZvciBmZXRjaGluZyBjb250ZW50IGZyb20gUzMgYnVja2V0c1xuICogTGFtYmRhQEVkZ2UgcnVucyBpbiB1cy1lYXN0LTEsIHNvIHdlIHVzZSB0aGF0IHJlZ2lvblxuICovXG5jb25zdCBzM0NsaWVudCA9IG5ldyBTM0NsaWVudCh7IHJlZ2lvbjogJ3VzLWVhc3QtMScgfSk7XG5cbi8qKlxuICogQ2FjaGUgZm9yIFMzIGNvbnRlbnQgdG8gcmVkdWNlIGxhdGVuY3kgb24gcmVwZWF0ZWQgcmVxdWVzdHNcbiAqIE5vdGU6IExhbWJkYUBFZGdlIGluc3RhbmNlcyBtYXkgYmUgcmV1c2VkLCBzbyB0aGlzIHByb3ZpZGVzIHNvbWUgY2FjaGluZyBiZW5lZml0XG4gKi9cbmNvbnN0IHMzQ29udGVudENhY2hlID0gbmV3IE1hcDxzdHJpbmcsIHsgZGF0YTogdW5rbm93bjsgdGltZXN0YW1wOiBudW1iZXIgfT4oKTtcblxuLyoqXG4gKiBDYWNoZSBUVEwgaW4gbWlsbGlzZWNvbmRzICg1IG1pbnV0ZXMpXG4gKi9cbmNvbnN0IFMzX0NBQ0hFX1RUTF9NUyA9IDUgKiA2MCAqIDEwMDA7XG5cbi8qKlxuICogRmV0Y2hlcyBjb250ZW50IGZyb20gUzMgYnVja2V0XG4gKiBAcGFyYW0gYnVja2V0IC0gUzMgYnVja2V0IG5hbWVcbiAqIEBwYXJhbSBrZXkgLSBTMyBvYmplY3Qga2V5XG4gKiBAcmV0dXJucyBUaGUgY29udGVudCBmcm9tIFMzIG9yIGFuIGVycm9yIG9iamVjdFxuICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaFMzQ29udGVudChidWNrZXQ6IHN0cmluZywga2V5OiBzdHJpbmcpOiBQcm9taXNlPHVua25vd24+IHtcbiAgY29uc3QgY2FjaGVLZXkgPSBgJHtidWNrZXR9LyR7a2V5fWA7XG4gIFxuICAvLyBDaGVjayBjYWNoZSBmaXJzdFxuICBjb25zdCBjYWNoZWQgPSBzM0NvbnRlbnRDYWNoZS5nZXQoY2FjaGVLZXkpO1xuICBpZiAoY2FjaGVkICYmIERhdGUubm93KCkgLSBjYWNoZWQudGltZXN0YW1wIDwgUzNfQ0FDSEVfVFRMX01TKSB7XG4gICAgcmV0dXJuIGNhY2hlZC5kYXRhO1xuICB9XG4gIFxuICB0cnkge1xuICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICBCdWNrZXQ6IGJ1Y2tldCxcbiAgICAgIEtleToga2V5LFxuICAgIH0pO1xuICAgIFxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgczNDbGllbnQuc2VuZChjb21tYW5kKTtcbiAgICBcbiAgICBpZiAoIXJlc3BvbnNlLkJvZHkpIHtcbiAgICAgIHJldHVybiB7IGVycm9yOiAnRW1wdHkgcmVzcG9uc2UgZnJvbSBTMycsIGJ1Y2tldCwga2V5IH07XG4gICAgfVxuICAgIFxuICAgIC8vIFJlYWQgdGhlIHN0cmVhbSBhbmQgY29udmVydCB0byBzdHJpbmdcbiAgICBjb25zdCBib2R5Q29udGVudHMgPSBhd2FpdCByZXNwb25zZS5Cb2R5LnRyYW5zZm9ybVRvU3RyaW5nKCk7XG4gICAgXG4gICAgLy8gVHJ5IHRvIHBhcnNlIGFzIEpTT04sIG90aGVyd2lzZSByZXR1cm4gYXMgc3RyaW5nXG4gICAgbGV0IGNvbnRlbnQ6IHVua25vd247XG4gICAgdHJ5IHtcbiAgICAgIGNvbnRlbnQgPSBKU09OLnBhcnNlKGJvZHlDb250ZW50cyk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBOb3QgSlNPTiwgcmV0dXJuIGFzLWlzIHdyYXBwZWQgaW4gYW4gb2JqZWN0XG4gICAgICBjb250ZW50ID0ge1xuICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgIGNvbnRlbnQ6IGJvZHlDb250ZW50cyxcbiAgICAgICAgbWltZVR5cGU6IHJlc3BvbnNlLkNvbnRlbnRUeXBlIHx8ICd0ZXh0L3BsYWluJyxcbiAgICAgIH07XG4gICAgfVxuICAgIFxuICAgIC8vIENhY2hlIHRoZSByZXN1bHRcbiAgICBzM0NvbnRlbnRDYWNoZS5zZXQoY2FjaGVLZXksIHsgZGF0YTogY29udGVudCwgdGltZXN0YW1wOiBEYXRlLm5vdygpIH0pO1xuICAgIFxuICAgIHJldHVybiBjb250ZW50O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InO1xuICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBmZXRjaCBTMyBjb250ZW50OiAke2J1Y2tldH0vJHtrZXl9YCwgZXJyb3IpO1xuICAgIHJldHVybiB7XG4gICAgICBlcnJvcjogJ0ZhaWxlZCB0byBmZXRjaCBTMyBjb250ZW50JyxcbiAgICAgIGJ1Y2tldCxcbiAgICAgIGtleSxcbiAgICAgIG1lc3NhZ2U6IGVycm9yTWVzc2FnZSxcbiAgICB9O1xuICB9XG59XG5cbi8qKlxuICogQ2xlYXJzIHRoZSBTMyBjb250ZW50IGNhY2hlXG4gKiBVc2VmdWwgZm9yIHRlc3Rpbmcgb3Igd2hlbiBjb250ZW50IG5lZWRzIHRvIGJlIHJlZnJlc2hlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJTM0NhY2hlKCk6IHZvaWQge1xuICBzM0NvbnRlbnRDYWNoZS5jbGVhcigpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDb250ZW50IE1hbmFnZXJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBDb250ZW50IE1hbmFnZXIgY2xhc3MgZm9yIGhhbmRsaW5nIGR5bmFtaWMgY29udGVudFxuICovXG5leHBvcnQgY2xhc3MgQ29udGVudE1hbmFnZXIge1xuICBwcml2YXRlIHJlZ2lzdHJ5OiBDb250ZW50UmVnaXN0cnk7XG4gIFxuICBjb25zdHJ1Y3RvcihyZWdpc3RyeTogQ29udGVudFJlZ2lzdHJ5ID0gREVGQVVMVF9DT05URU5UX1JFR0lTVFJZKSB7XG4gICAgdGhpcy5yZWdpc3RyeSA9IHJlZ2lzdHJ5O1xuICB9XG4gIFxuICAvKipcbiAgICogR2V0cyBwYXltZW50IHJlcXVpcmVtZW50cyBmb3IgYSBnaXZlbiBwYXRoXG4gICAqL1xuICBnZXRQYXltZW50UmVxdWlyZW1lbnRzKHBhdGg6IHN0cmluZyk6IFBheW1lbnRSZXF1aXJlbWVudHMgfCBudWxsIHtcbiAgICBjb25zdCBpdGVtID0gdGhpcy5yZWdpc3RyeS5pdGVtc1twYXRoXTtcbiAgICByZXR1cm4gaXRlbT8ucHJpY2luZyB8fCBudWxsO1xuICB9XG4gIFxuICAvKipcbiAgICogR2V0cyBjb250ZW50IGZvciBhIGdpdmVuIHBhdGhcbiAgICovXG4gIGFzeW5jIGdldENvbnRlbnQocGF0aDogc3RyaW5nKTogUHJvbWlzZTx1bmtub3duPiB7XG4gICAgY29uc3QgaXRlbSA9IHRoaXMucmVnaXN0cnkuaXRlbXNbcGF0aF07XG4gICAgXG4gICAgaWYgKCFpdGVtKSB7XG4gICAgICByZXR1cm4geyBlcnJvcjogJ0NvbnRlbnQgbm90IGZvdW5kJywgcGF0aCB9O1xuICAgIH1cbiAgICBcbiAgICBzd2l0Y2ggKGl0ZW0uc291cmNlLnR5cGUpIHtcbiAgICAgIGNhc2UgJ2lubGluZSc6XG4gICAgICAgIHJldHVybiBpdGVtLnNvdXJjZS5kYXRhO1xuICAgICAgICBcbiAgICAgIGNhc2UgJ2R5bmFtaWMnOlxuICAgICAgICBjb25zdCBnZW5lcmF0b3IgPSBDT05URU5UX0dFTkVSQVRPUlNbaXRlbS5zb3VyY2UuZ2VuZXJhdG9yXTtcbiAgICAgICAgaWYgKGdlbmVyYXRvcikge1xuICAgICAgICAgIHJldHVybiBnZW5lcmF0b3IoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyBlcnJvcjogJ0dlbmVyYXRvciBub3QgZm91bmQnLCBnZW5lcmF0b3I6IGl0ZW0uc291cmNlLmdlbmVyYXRvciB9O1xuICAgICAgICBcbiAgICAgIGNhc2UgJ3MzJzpcbiAgICAgICAgLy8gRmV0Y2ggY29udGVudCBmcm9tIFMzIGJ1Y2tldFxuICAgICAgICByZXR1cm4gYXdhaXQgZmV0Y2hTM0NvbnRlbnQoaXRlbS5zb3VyY2UuYnVja2V0LCBpdGVtLnNvdXJjZS5rZXkpO1xuICAgICAgICBcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiB7IGVycm9yOiAnVW5rbm93biBjb250ZW50IHNvdXJjZSB0eXBlJyB9O1xuICAgIH1cbiAgfVxuICBcbiAgLyoqXG4gICAqIEdldHMgY29udGVudCBpdGVtIG1ldGFkYXRhXG4gICAqL1xuICBnZXRDb250ZW50SXRlbShwYXRoOiBzdHJpbmcpOiBDb250ZW50SXRlbSB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLnJlZ2lzdHJ5Lml0ZW1zW3BhdGhdIHx8IG51bGw7XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBMaXN0cyBhbGwgYXZhaWxhYmxlIGNvbnRlbnQgcGF0aHNcbiAgICovXG4gIGxpc3RDb250ZW50UGF0aHMoKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLnJlZ2lzdHJ5Lml0ZW1zKTtcbiAgfVxuICBcbiAgLyoqXG4gICAqIENoZWNrcyBpZiBhIHBhdGggcmVxdWlyZXMgcGF5bWVudFxuICAgKi9cbiAgcmVxdWlyZXNQYXltZW50KHBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBwYXRoIGluIHRoaXMucmVnaXN0cnkuaXRlbXM7XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjb250ZW50IHJlZ2lzdHJ5IHZlcnNpb25cbiAgICovXG4gIGdldFZlcnNpb24oKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RyeS52ZXJzaW9uO1xuICB9XG4gIFxuICAvKipcbiAgICogQWRkcyBvciB1cGRhdGVzIGEgY29udGVudCBpdGVtXG4gICAqL1xuICBzZXRDb250ZW50SXRlbShpdGVtOiBDb250ZW50SXRlbSk6IHZvaWQge1xuICAgIHRoaXMucmVnaXN0cnkuaXRlbXNbaXRlbS5wYXRoXSA9IGl0ZW07XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgY29udGVudCBpdGVtXG4gICAqL1xuICByZW1vdmVDb250ZW50SXRlbShwYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBpZiAocGF0aCBpbiB0aGlzLnJlZ2lzdHJ5Lml0ZW1zKSB7XG4gICAgICBkZWxldGUgdGhpcy5yZWdpc3RyeS5pdGVtc1twYXRoXTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU2luZ2xldG9uIEluc3RhbmNlXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRGVmYXVsdCBjb250ZW50IG1hbmFnZXIgaW5zdGFuY2VcbiAqL1xuZXhwb3J0IGNvbnN0IGNvbnRlbnRNYW5hZ2VyID0gbmV3IENvbnRlbnRNYW5hZ2VyKCk7XG5cbi8qKlxuICogU2V0cyB0aGUgUzMgYnVja2V0IG5hbWUgZm9yIGFsbCBTMy1iYWNrZWQgY29udGVudCBpdGVtcy5cbiAqIENhbGxlZCBhdCBydW50aW1lIGZyb20gdGhlIExhbWJkYSBoYW5kbGVyIHVzaW5nIHRoZSBDbG91ZEZyb250IG9yaWdpbiBkb21haW4uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRDb250ZW50QnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZyk6IHZvaWQge1xuICBERUZBVUxUX0NPTlRFTlRfQlVDS0VUID0gYnVja2V0TmFtZTtcbiAgZm9yIChjb25zdCBpdGVtIG9mIE9iamVjdC52YWx1ZXMoY29udGVudE1hbmFnZXJbJ3JlZ2lzdHJ5J10uaXRlbXMpKSB7XG4gICAgaWYgKGl0ZW0uc291cmNlLnR5cGUgPT09ICdzMycpIHtcbiAgICAgIGl0ZW0uc291cmNlLmJ1Y2tldCA9IGJ1Y2tldE5hbWU7XG4gICAgfVxuICB9XG59XG4iXX0=