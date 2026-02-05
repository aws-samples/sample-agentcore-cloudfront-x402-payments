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
 * This should match your deployed S3 bucket name
 */
const DEFAULT_CONTENT_BUCKET = 'x402-content-bucket';
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
        // S3-backed content items
        '/api/research-report': {
            id: 'research-report',
            path: '/api/research-report',
            title: 'Blockchain Research Report',
            description: 'In-depth research report on blockchain technology trends',
            mimeType: 'application/json',
            pricing: createPaymentRequirements('5000'),
            source: {
                type: 's3',
                bucket: DEFAULT_CONTENT_BUCKET,
                key: 'content/research-report.json',
            },
        },
        '/api/dataset': {
            id: 'dataset',
            path: '/api/dataset',
            title: 'Premium Dataset',
            description: 'Curated dataset for machine learning and analytics',
            mimeType: 'application/json',
            pricing: createPaymentRequirements('10000'),
            source: {
                type: 's3',
                bucket: DEFAULT_CONTENT_BUCKET,
                key: 'content/dataset.json',
            },
        },
        '/api/tutorial': {
            id: 'tutorial',
            path: '/api/tutorial',
            title: 'Advanced Smart Contract Tutorial',
            description: 'Step-by-step guide to building advanced smart contracts',
            mimeType: 'application/json',
            pricing: createPaymentRequirements('3000'),
            source: {
                type: 's3',
                bucket: DEFAULT_CONTENT_BUCKET,
                key: 'content/tutorial.json',
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC1jb25maWcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb250ZW50LWNvbmZpZy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7O0dBUUc7OztBQXNGSCw4REFrQkM7QUE2UkQsb0NBRUM7QUFwWUQsa0RBQWdFO0FBb0RoRSwrRUFBK0U7QUFDL0Usd0JBQXdCO0FBQ3hCLCtFQUErRTtBQUUvRTs7OztHQUlHO0FBQ0gsTUFBTSxjQUFjLEdBQUcsNENBQTRDLENBQUM7QUFFcEU7OztHQUdHO0FBQ0gsTUFBTSxlQUFlLEdBQUcsY0FBYyxDQUFDO0FBRXZDOztHQUVHO0FBQ0gsTUFBTSxhQUFhLEdBQUcsNENBQTRDLENBQUM7QUFFbkU7OztHQUdHO0FBQ0gsTUFBTSxzQkFBc0IsR0FBRyxxQkFBcUIsQ0FBQztBQUVyRDs7R0FFRztBQUNILFNBQWdCLHlCQUF5QixDQUN2QyxNQUFjLEVBQ2QsU0FBd0M7SUFFeEMsT0FBTztRQUNMLE1BQU0sRUFBRSxPQUFPO1FBQ2YsT0FBTyxFQUFFLGVBQWU7UUFDeEIsTUFBTTtRQUNOLEtBQUssRUFBRSxhQUFhO1FBQ3BCLEtBQUssRUFBRSxjQUFjO1FBQ3JCLGlCQUFpQixFQUFFLEVBQUU7UUFDckIsS0FBSyxFQUFFO1lBQ0wsSUFBSSxFQUFFLE1BQU07WUFDWixPQUFPLEVBQUUsR0FBRztZQUNaLG1CQUFtQixFQUFFLFNBQVM7U0FDL0I7UUFDRCxHQUFHLFNBQVM7S0FDYixDQUFDO0FBQ0osQ0FBQztBQUVELCtFQUErRTtBQUMvRSwyQkFBMkI7QUFDM0IsK0VBQStFO0FBRS9FOztHQUVHO0FBQ1UsUUFBQSx3QkFBd0IsR0FBb0I7SUFDdkQsT0FBTyxFQUFFLE9BQU87SUFDaEIsWUFBWSxFQUFFLGNBQWM7SUFDNUIsY0FBYyxFQUFFLGVBQWU7SUFDL0IsWUFBWSxFQUFFLGFBQWE7SUFDM0IsS0FBSyxFQUFFO1FBQ0wsc0JBQXNCLEVBQUU7WUFDdEIsRUFBRSxFQUFFLGlCQUFpQjtZ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ZUFBZSxFQUFFLEdBQUc7WUFDcEIsVUFBVSxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsR0FBRyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDckUsUUFBUSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxHQUFHLEVBQUU7WUFDN0MsU0FBUyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxHQUFHLENBQUM7WUFDN0MsUUFBUSxFQUFFLEtBQUs7WUFDZixPQUFPLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLEdBQUcsRUFBRSxDQUFDO1NBQ3hDO1FBQ0QsUUFBUSxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQzdDLEdBQUcsRUFBRSxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUMsa0JBQWtCLENBQUMsT0FBTyxFQUFFLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxDQUFDO1lBQzNHLFVBQVUsRUFBRSxVQUFVLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLEdBQUcsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ3JFLElBQUksRUFBRSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLEdBQUcsRUFBRSxDQUFDO1lBQzNDLEdBQUcsRUFBRSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFF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O1FBQ2QsQ0FBQztRQUNELE9BQU8sS0FBSyxDQUFDO0lBQ2YsQ0FBQztDQUNGO0FBMUZELHdDQTBGQztBQUVELCtFQUErRTtBQUMvRSxxQkFBcUI7QUFDckIsK0VBQStFO0FBRS9FOztHQUVHO0FBQ1UsUUFBQSxjQUFjLEdBQUcsSUFBSSxjQUFjLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRHluYW1pYyBDb250ZW50IENvbmZpZ3VyYXRpb24gTW9kdWxlXG4gKiBcbiAqIFRoaXMgbW9kdWxlIHByb3ZpZGVzIGR5bmFtaWMgY29udGVudCBhbmQgcHJpY2luZyBjb25maWd1cmF0aW9uIGZvciB0aGUgeDQwMiBwYXltZW50IHZlcmlmaWVyLlxuICogQ29udGVudCBjYW4gYmUgbG9hZGVkIGZyb206XG4gKiAxLiBTdGF0aWMgY29uZmlndXJhdGlvbiAoZGVmYXVsdClcbiAqIDIuIEVudmlyb25tZW50IHZhcmlhYmxlcyAoZm9yIHByaWNpbmcgb3ZlcnJpZGVzKVxuICogMy4gUzMgYnVja2V0IChmb3IgZHluYW1pYyBjb250ZW50KVxuICovXG5cbmltcG9ydCB7IFBheW1lbnRSZXF1aXJlbWVudHMgfSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IFMzQ2xpZW50LCBHZXRPYmplY3RDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXMzJztcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ29udGVudCBDb25maWd1cmF0aW9uIFR5cGVzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQ29udGVudCBpdGVtIHdpdGggbWV0YWRhdGEgYW5kIHByaWNpbmdcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb250ZW50SXRlbSB7XG4gIC8qKiBVbmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIGNvbnRlbnQgKi9cbiAgaWQ6IHN0cmluZztcbiAgLyoqIFVSTCBwYXRoIGZvciB0aGUgY29udGVudCAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSB0aXRsZSAqL1xuICB0aXRsZTogc3RyaW5nO1xuICAvKiogQ29udGVudCBkZXNjcmlwdGlvbiAqL1xuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICAvKiogTUlNRSB0eXBlIG9mIHRoZSBjb250ZW50ICovXG4gIG1pbWVUeXBlOiBzdHJpbmc7XG4gIC8qKiBQYXltZW50IHJlcXVpcmVtZW50cyBmb3IgdGhpcyBjb250ZW50ICovXG4gIHByaWNpbmc6IFBheW1lbnRSZXF1aXJlbWVudHM7XG4gIC8qKiBDb250ZW50IHNvdXJjZSAtIGlubGluZSBkYXRhIG9yIFMzIHJlZmVyZW5jZSAqL1xuICBzb3VyY2U6IENvbnRlbnRTb3VyY2U7XG4gIC8qKiBPcHRpb25hbCBtZXRhZGF0YSAqL1xuICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufVxuXG4vKipcbiAqIENvbnRlbnQgc291cmNlIC0gZWl0aGVyIGlubGluZSBkYXRhIG9yIFMzIHJlZmVyZW5jZVxuICovXG5leHBvcnQgdHlwZSBDb250ZW50U291cmNlID0gXG4gIHwgeyB0eXBlOiAnaW5saW5lJzsgZGF0YTogdW5rbm93biB9XG4gIHwgeyB0eXBlOiAnczMnOyBidWNrZXQ6IHN0cmluZzsga2V5OiBzdHJpbmcgfVxuICB8IHsgdHlwZTogJ2R5bmFtaWMnOyBnZW5lcmF0b3I6IHN0cmluZyB9O1xuXG4vKipcbiAqIENvbnRlbnQgcmVnaXN0cnkgZm9yIG1hbmFnaW5nIGFsbCBhdmFpbGFibGUgY29udGVudFxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbnRlbnRSZWdpc3RyeSB7XG4gIC8qKiBWZXJzaW9uIG9mIHRoZSBjb25maWd1cmF0aW9uICovXG4gIHZlcnNpb246IHN0cmluZztcbiAgLyoqIERlZmF1bHQgcGF5bWVudCByZWNpcGllbnQgYWRkcmVzcyAqL1xuICBkZWZhdWx0UGF5VG86IHN0cmluZztcbiAgLyoqIERlZmF1bHQgbmV0d29yayBmb3IgcGF5bWVudHMgKi9cbiAgZGVmYXVsdE5ldHdvcms6IHN0cmluZztcbiAgLyoqIERlZmF1bHQgYXNzZXQgZm9yIHBheW1lbnRzICovXG4gIGRlZmF1bHRBc3NldDogc3RyaW5nO1xuICAvKiogQ29udGVudCBpdGVtcyBpbmRleGVkIGJ5IHBhdGggKi9cbiAgaXRlbXM6IFJlY29yZDxzdHJpbmcsIENvbnRlbnRJdGVtPjtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRGVmYXVsdCBDb25maWd1cmF0aW9uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRGVmYXVsdCBwYXltZW50IHJlY2lwaWVudCBhZGRyZXNzXG4gKiBMYW1iZGFARWRnZSBkb2Vzbid0IHN1cHBvcnQgZW52aXJvbm1lbnQgdmFyaWFibGVzLCBzbyB0aGlzIGlzIGJ1bmRsZWRcbiAqIFRoaXMgaXMgdGhlIHNlbGxlcidzIHdhbGxldCB0aGF0IHJlY2VpdmVzIHg0MDIgcGF5bWVudHNcbiAqL1xuY29uc3QgREVGQVVMVF9QQVlfVE8gPSAnMHgyNDg0MkYzMTM2RmEyYTNkZjgzNWQzNmI0YzNjYjQ5NzJkNDA1NTAyJztcblxuLyoqXG4gKiBEZWZhdWx0IG5ldHdvcmsgKEJhc2UgU2Vwb2xpYSB0ZXN0bmV0KVxuICogVXNlICdlaXAxNTU6ODQ1MycgZm9yIEJhc2UgTWFpbm5ldCBpbiBwcm9kdWN0aW9uXG4gKi9cbmNvbnN0IERFRkFVTFRfTkVUV09SSyA9ICdlaXAxNTU6ODQ1MzInO1xuXG4vKipcbiAqIERlZmF1bHQgYXNzZXQgKFVTREMgb24gQmFzZSBTZXBvbGlhKVxuICovXG5jb25zdCBERUZBVUxUX0FTU0VUID0gJzB4MDM2Q2JENTM4NDJjNTQyNjYzNGU3OTI5NTQxZUMyMzE4ZjNkQ0Y3ZSc7XG5cbi8qKlxuICogRGVmYXVsdCBTMyBidWNrZXQgZm9yIGNvbnRlbnQgc3RvcmFnZVxuICogVGhpcyBzaG91bGQgbWF0Y2ggeW91ciBkZXBsb3llZCBTMyBidWNrZXQgbmFtZVxuICovXG5jb25zdCBERUZBVUxUX0NPTlRFTlRfQlVDS0VUID0gJ3g0MDItY29udGVudC1idWNrZXQnO1xuXG4vKipcbiAqIENyZWF0ZXMgZGVmYXVsdCBwYXltZW50IHJlcXVpcmVtZW50cyB3aXRoIG9wdGlvbmFsIG92ZXJyaWRlc1xuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUGF5bWVudFJlcXVpcmVtZW50cyhcbiAgYW1vdW50OiBzdHJpbmcsXG4gIG92ZXJyaWRlcz86IFBhcnRpYWw8UGF5bWVudFJlcXVpcmVtZW50cz5cbik6IFBheW1lbnRSZXF1aXJlbWVudHMge1xuICByZXR1cm4ge1xuICAgIHNjaGVtZTogJ2V4YWN0JyxcbiAgICBuZXR3b3JrOiBERUZBVUxUX05FVFdPUkssXG4gICAgYW1vdW50LFxuICAgIGFzc2V0OiBERUZBVUxUX0FTU0VULFxuICAgIHBheVRvOiBERUZBVUxUX1BBWV9UTyxcbiAgICBtYXhUaW1lb3V0U2Vjb25kczogNjAsXG4gICAgZXh0cmE6IHtcbiAgICAgIG5hbWU6ICdVU0RDJyxcbiAgICAgIHZlcnNpb246ICcyJyxcbiAgICAgIGFzc2V0VHJhbnNmZXJNZXRob2Q6ICdlaXAzMDA5JyxcbiAgICB9LFxuICAgIC4uLm92ZXJyaWRlcyxcbiAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRGVmYXVsdCBDb250ZW50IFJlZ2lzdHJ5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRGVmYXVsdCBjb250ZW50IHJlZ2lzdHJ5IHdpdGggc3RhdGljIGNvbnRlbnRcbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfQ09OVEVOVF9SRUdJU1RSWTogQ29udGVudFJlZ2lzdHJ5ID0ge1xuICB2ZXJzaW9uOiAnMS4wLjAnLFxuICBkZWZhdWx0UGF5VG86IERFRkFVTFRfUEFZX1RPLFxuICBkZWZhdWx0TmV0d29yazogREVGQVVMVF9ORVRXT1JLLFxuICBkZWZhdWx0QXNzZXQ6IERFRkFVTFRfQVNTRVQsXG4gIGl0ZW1zOiB7XG4gICAgJy9hcGkvcHJlbWl1bS1hcnRpY2xlJzoge1xuICAgICAgaWQ6ICdwcmVtaXVtLWFydGljbGUnLFxuICAgICAgcGF0aDogJy9hcGkvcHJlbWl1bS1hcnRpY2xlJyxcbiAgICAgIHRpdGxlOiAnVGhlIEZ1dHVyZSBvZiBBSSBhbmQgQmxvY2tjaGFpbiBJbnRlZ3JhdGlvbicsXG4gICAgICBkZXNjcmlwdGlvbjogJ1ByZW1pdW0gYXJ0aWNsZSBhYm91dCBBSSBhbmQgYmxvY2tjaGFpbiBjb252ZXJnZW5jZScsXG4gICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgcHJpY2luZzogY3JlYXRlUGF5bWVudFJlcXVpcmVtZW50cygnMTAwMCcpLFxuICAgICAgc291cmNlOiB7XG4gICAgICAgIHR5cGU6ICdpbmxpbmUnLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgdGl0bGU6ICdUaGUgRnV0dXJlIG9mIEFJIGFuZCBCbG9ja2NoYWluIEludGVncmF0aW9uJyxcbiAgICAgICAgICBhdXRob3I6ICdUZWNoIEluc2lnaHRzJyxcbiAgICAgICAgICBkYXRlOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXSxcbiAgICAgICAgICBjb250ZW50OiAnQXJ0aWZpY2lhbCBJbnRlbGxpZ2VuY2UgYW5kIEJsb2NrY2hhaW4gYXJlIGNvbnZlcmdpbmcgdG8gY3JlYXRlIHVucHJlY2VkZW50ZWQgb3Bwb3J0dW5pdGllcy4uLicsXG4gICAgICAgICAgZnVsbFRleHQ6ICdUaGlzIGlzIHByZW1pdW0gY29udGVudCB0aGF0IHJlcXVpcmVzIHBheW1lbnQgdG8gYWNjZXNzLiBUaGUgaW50ZWdyYXRpb24gb2YgQUkgYW5kIGJsb2NrY2hhaW4gdGVjaG5vbG9neSBpcyByZXZvbHV0aW9uaXppbmcgaG93IHdlIHRoaW5rIGFib3V0IGRlY2VudHJhbGl6ZWQgc3lzdGVtcywgc21hcnQgY29udHJhY3RzLCBhbmQgYXV0b25vbW91cyBhZ2VudHMuIEtleSBhcmVhcyBvZiBpbm5vdmF0aW9uIGluY2x1ZGU6IDEpIERlY2VudHJhbGl6ZWQgQUkgdHJhaW5pbmcsIDIpIFNtYXJ0IGNvbnRyYWN0IGF1dG9tYXRpb24sIDMpIFRva2VuaXplZCBBSSBzZXJ2aWNlcywgNCkgUHJpdmFjeS1wcmVzZXJ2aW5nIGNvbXB1dGF0aW9uLicsXG4gICAgICAgICAgdGFnczogWydBSScsICdibG9ja2NoYWluJywgJ3RlY2hub2xvZ3knLCAnaW5ub3ZhdGlvbiddLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICAgICcvYXBpL3dlYXRoZXItZGF0YSc6IHtcbiAgICAgIGlkOiAnd2VhdGhlci1kYXRhJyxcbiAgICAgIHBhdGg6ICcvYXBpL3dlYXRoZXItZGF0YScsXG4gICAgICB0aXRsZTogJ1JlYWwtdGltZSBXZWF0aGVyIERhdGEnLFxuICAgICAgZGVzY3JpcHRpb246ICdDdXJyZW50IHdlYXRoZXIgY29uZGl0aW9ucyBhbmQgZm9yZWNhc3QnLFxuICAgICAgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIHByaWNpbmc6IGNyZWF0ZVBheW1lbnRSZXF1aXJlbWVudHMoJzUwMCcpLFxuICAgICAgc291cmNlOiB7XG4gICAgICAgIHR5cGU6ICdkeW5hbWljJyxcbiAgICAgICAgZ2VuZXJhdG9yOiAnd2VhdGhlcicsXG4gICAgICB9LFxuICAgIH0sXG4gICAgJy9hcGkvbWFya2V0LWFuYWx5c2lzJzoge1xuICAgICAgaWQ6ICdtYXJrZXQtYW5hbHlzaXMnLFxuICAgICAgcGF0aDogJy9hcGkvbWFya2V0LWFuYWx5c2lzJyxcbiAgICAgIHRpdGxlOiAnQ3J5cHRvY3VycmVuY3kgTWFya2V0IEFuYWx5c2lzJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUmVhbC10aW1lIG1hcmtldCBkYXRhIGFuZCBhbmFseXNpcycsXG4gICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgcHJpY2luZzogY3JlYXRlUGF5bWVudFJlcXVpcmVtZW50cygnMjAwMCcpLFxuICAgICAgc291cmNlOiB7XG4gICAgICAgIHR5cGU6ICdkeW5hbWljJyxcbiAgICAgICAgZ2VuZXJhdG9yOiAnbWFya2V0JyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyBTMy1iYWNrZWQgY29udGVudCBpdGVtc1xuICAgICcvYXBpL3Jlc2VhcmNoLXJlcG9ydCc6IHtcbiAgICAgIGlkOiAncmVzZWFyY2gtcmVwb3J0JyxcbiAgICAgIHBhdGg6ICcvYXBpL3Jlc2VhcmNoLXJlcG9ydCcsXG4gICAgICB0aXRsZTogJ0Jsb2NrY2hhaW4gUmVzZWFyY2ggUmVwb3J0JyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnSW4tZGVwdGggcmVzZWFyY2ggcmVwb3J0IG9uIGJsb2NrY2hhaW4gdGVjaG5vbG9neSB0cmVuZHMnLFxuICAgICAgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIHByaWNpbmc6IGNyZWF0ZVBheW1lbnRSZXF1aXJlbWVudHMoJzUwMDAnKSxcbiAgICAgIHNvdXJjZToge1xuICAgICAgICB0eXBlOiAnczMnLFxuICAgICAgICBidWNrZXQ6IERFRkFVTFRfQ09OVEVOVF9CVUNLRVQsXG4gICAgICAgIGtleTogJ2NvbnRlbnQvcmVzZWFyY2gtcmVwb3J0Lmpzb24nLFxuICAgICAgfSxcbiAgICB9LFxuICAgICcvYXBpL2RhdGFzZXQnOiB7XG4gICAgICBpZDogJ2RhdGFzZXQnLFxuICAgICAgcGF0aDogJy9hcGkvZGF0YXNldCcsXG4gICAgICB0aXRsZTogJ1ByZW1pdW0gRGF0YXNldCcsXG4gICAgICBkZXNjcmlwdGlvbjogJ0N1cmF0ZWQgZGF0YXNldCBmb3IgbWFjaGluZSBsZWFybmluZyBhbmQgYW5hbHl0aWNzJyxcbiAgICAgIG1pbWVUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICBwcmljaW5nOiBjcmVhdGVQYXltZW50UmVxdWlyZW1lbnRzKCcxMDAwMCcpLFxuICAgICAgc291cmNlOiB7XG4gICAgICAgIHR5cGU6ICdzMycsXG4gICAgICAgIGJ1Y2tldDogREVGQVVMVF9DT05URU5UX0JVQ0tFVCxcbiAgICAgICAga2V5OiAnY29udGVudC9kYXRhc2V0Lmpzb24nLFxuICAgICAgfSxcbiAgICB9LFxuICAgICcvYXBpL3R1dG9yaWFsJzoge1xuICAgICAgaWQ6ICd0dXRvcmlhbCcsXG4gICAgICBwYXRoOiAnL2FwaS90dXRvcmlhbCcsXG4gICAgICB0aXRsZTogJ0FkdmFuY2VkIFNtYXJ0IENvbnRyYWN0IFR1dG9yaWFsJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3RlcC1ieS1zdGVwIGd1aWRlIHRvIGJ1aWxkaW5nIGFkdmFuY2VkIHNtYXJ0IGNvbnRyYWN0cycsXG4gICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgcHJpY2luZzogY3JlYXRlUGF5bWVudFJlcXVpcmVtZW50cygnMzAwMCcpLFxuICAgICAgc291cmNlOiB7XG4gICAgICAgIHR5cGU6ICdzMycsXG4gICAgICAgIGJ1Y2tldDogREVGQVVMVF9DT05URU5UX0JVQ0tFVCxcbiAgICAgICAga2V5OiAnY29udGVudC90dXRvcmlhbC5qc29uJyxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIER5bmFtaWMgQ29udGVudCBHZW5lcmF0b3JzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogR2VuZXJhdGVzIGR5bmFtaWMgd2VhdGhlciBkYXRhXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlV2VhdGhlckRhdGEoKTogdW5rbm93biB7XG4gIGNvbnN0IGNvbmRpdGlvbnMgPSBbJ1N1bm55JywgJ1BhcnRseSBDbG91ZHknLCAnQ2xvdWR5JywgJ1JhaW4nLCAnVGh1bmRlcnN0b3JtJywgJ1Nub3cnLCAnRm9nJ107XG4gIGNvbnN0IGNpdGllcyA9IFtcbiAgICB7IG5hbWU6ICdTYW4gRnJhbmNpc2NvLCBDQScsIHRlbXBSYW5nZTogWzUwLCA3MF0gfSxcbiAgICB7IG5hbWU6ICdOZXcgWW9yaywgTlknLCB0ZW1wUmFuZ2U6IFszMCwgODVdIH0sXG4gICAgeyBuYW1lOiAnTWlhbWksIEZMJywgdGVtcFJhbmdlOiBbNjUsIDk1XSB9LFxuICAgIHsgbmFtZTogJ1NlYXR0bGUsIFdBJywgdGVtcFJhbmdlOiBbNDAsIDc1XSB9LFxuICAgIHsgbmFtZTogJ0RlbnZlciwgQ08nLCB0ZW1wUmFuZ2U6IFsyNSwgODBdIH0sXG4gIF07XG4gIFxuICBjb25zdCBjaXR5ID0gY2l0aWVzW01hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIGNpdGllcy5sZW5ndGgpXTtcbiAgY29uc3QgdGVtcCA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIChjaXR5LnRlbXBSYW5nZVsxXSAtIGNpdHkudGVtcFJhbmdlWzBdKSkgKyBjaXR5LnRlbXBSYW5nZVswXTtcbiAgXG4gIHJldHVybiB7XG4gICAgbG9jYXRpb246IGNpdHkubmFtZSxcbiAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICBjdXJyZW50OiB7XG4gICAgICB0ZW1wZXJhdHVyZTogdGVtcCxcbiAgICAgIHRlbXBlcmF0dXJlVW5pdDogJ0YnLFxuICAgICAgY29uZGl0aW9uczogY29uZGl0aW9uc1tNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBjb25kaXRpb25zLmxlbmd0aCldLFxuICAgICAgaHVtaWRpdHk6IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDYwKSArIDMwLFxuICAgICAgd2luZFNwZWVkOiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAyNSkgKyA1LFxuICAgICAgd2luZFVuaXQ6ICdtcGgnLFxuICAgICAgdXZJbmRleDogTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMTEpLFxuICAgIH0sXG4gICAgZm9yZWNhc3Q6IEFycmF5LmZyb20oeyBsZW5ndGg6IDUgfSwgKF8sIGkpID0+ICh7XG4gICAgICBkYXk6IG5ldyBEYXRlKERhdGUubm93KCkgKyAoaSArIDEpICogMjQgKiA2MCAqIDYwICogMTAwMCkudG9Mb2NhbGVEYXRlU3RyaW5nKCdlbi1VUycsIHsgd2Vla2RheTogJ3Nob3J0JyB9KSxcbiAgICAgIGNvbmRpdGlvbnM6IGNvbmRpdGlvbnNbTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogY29uZGl0aW9ucy5sZW5ndGgpXSxcbiAgICAgIGhpZ2g6IHRlbXAgKyBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxMCksXG4gICAgICBsb3c6IHRlbXAgLSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxNSksXG4gICAgfSkpLFxuICAgIHNvdXJjZTogJ3g0MDItd2VhdGhlci1zZXJ2aWNlJyxcbiAgICBwcmVtaXVtOiB0cnVlLFxuICB9O1xufVxuXG4vKipcbiAqIEdlbmVyYXRlcyBkeW5hbWljIG1hcmtldCBhbmFseXNpcyBkYXRhXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlTWFya2V0RGF0YSgpOiB1bmtub3duIHtcbiAgY29uc3QgY3J5cHRvcyA9IFtcbiAgICB7IHN5bWJvbDogJ0JUQycsIG5hbWU6ICdCaXRjb2luJywgYmFzZVByaWNlOiA5ODAwMCB9LFxuICAgIHsgc3ltYm9sOiAnRVRIJywgbmFtZTogJ0V0aGVyZXVtJywgYmFzZVByaWNlOiAzODAwIH0sXG4gICAgeyBzeW1ib2w6ICdTT0wnLCBuYW1lOiAnU29sYW5hJywgYmFzZVByaWNlOiAxNDUgfSxcbiAgICB7IHN5bWJvbDogJ0FWQVgnLCBuYW1lOiAnQXZhbGFuY2hlJywgYmFzZVByaWNlOiA0MiB9LFxuICAgIHsgc3ltYm9sOiAnTUFUSUMnLCBuYW1lOiAnUG9seWdvbicsIGJhc2VQcmljZTogMC44NSB9LFxuICBdO1xuICBcbiAgY29uc3QgbWFya2V0czogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgXG4gIGZvciAoY29uc3QgY3J5cHRvIG9mIGNyeXB0b3MpIHtcbiAgICBjb25zdCBjaGFuZ2VQZXJjZW50ID0gKE1hdGgucmFuZG9tKCkgKiAxMCAtIDUpLnRvRml4ZWQoMik7XG4gICAgY29uc3QgcHJpY2UgPSBjcnlwdG8uYmFzZVByaWNlICogKDEgKyBwYXJzZUZsb2F0KGNoYW5nZVBlcmNlbnQpIC8gMTAwKTtcbiAgICBjb25zdCB2b2x1bWUgPSAoTWF0aC5yYW5kb20oKSAqIDMwICsgNSkudG9GaXhlZCgxKTtcbiAgICBcbiAgICBtYXJrZXRzW2NyeXB0by5zeW1ib2xdID0ge1xuICAgICAgbmFtZTogY3J5cHRvLm5hbWUsXG4gICAgICBwcmljZTogcHJpY2UudG9GaXhlZCgyKSxcbiAgICAgIGNoYW5nZTI0aDogYCR7cGFyc2VGbG9hdChjaGFuZ2VQZXJjZW50KSA+PSAwID8gJysnIDogJyd9JHtjaGFuZ2VQZXJjZW50fSVgLFxuICAgICAgdm9sdW1lMjRoOiBgJCR7dm9sdW1lfUJgLFxuICAgICAgbWFya2V0Q2FwOiBgJCR7KHByaWNlICogKGNyeXB0by5zeW1ib2wgPT09ICdCVEMnID8gMTkuNSA6IGNyeXB0by5zeW1ib2wgPT09ICdFVEgnID8gMTIwIDogNDAwKSkudG9GaXhlZCgwKX1NYCxcbiAgICB9O1xuICB9XG4gIFxuICBjb25zdCBzZW50aW1lbnRzID0gWydCdWxsaXNoJywgJ0JlYXJpc2gnLCAnTmV1dHJhbCcsICdWZXJ5IEJ1bGxpc2gnLCAnQ2F1dGlvdXNseSBPcHRpbWlzdGljJ107XG4gIFxuICByZXR1cm4ge1xuICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIGRhdGU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdLFxuICAgIG1hcmtldHMsXG4gICAgYW5hbHlzaXM6IHtcbiAgICAgIG92ZXJhbGxTZW50aW1lbnQ6IHNlbnRpbWVudHNbTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogc2VudGltZW50cy5sZW5ndGgpXSxcbiAgICAgIHN1bW1hcnk6ICdNYXJrZXQgc2hvd2luZyBtaXhlZCBzaWduYWxzIHdpdGggbWFqb3IgY3J5cHRvY3VycmVuY2llcyBleHBlcmllbmNpbmcgdmFyaWVkIG1vbWVudHVtLiBUZWNobmljYWwgaW5kaWNhdG9ycyBzdWdnZXN0IHBvdGVudGlhbCBjb25zb2xpZGF0aW9uIHBoYXNlLicsXG4gICAgICBrZXlFdmVudHM6IFtcbiAgICAgICAgJ0ZlZGVyYWwgUmVzZXJ2ZSBtZWV0aW5nIHNjaGVkdWxlZCBmb3IgbmV4dCB3ZWVrJyxcbiAgICAgICAgJ01ham9yIHByb3RvY29sIHVwZ3JhZGUgYW5ub3VuY2VkIGZvciBFdGhlcmV1bScsXG4gICAgICAgICdJbnN0aXR1dGlvbmFsIGFkb3B0aW9uIGNvbnRpbnVlcyB0byBncm93JyxcbiAgICAgIF0sXG4gICAgICByaXNrTGV2ZWw6IFsnTG93JywgJ01lZGl1bScsICdIaWdoJ11bTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMyldLFxuICAgIH0sXG4gICAgc291cmNlOiAneDQwMi1tYXJrZXQtc2VydmljZScsXG4gICAgcHJlbWl1bTogdHJ1ZSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDb250ZW50IGdlbmVyYXRvcnMgcmVnaXN0cnlcbiAqL1xuY29uc3QgQ09OVEVOVF9HRU5FUkFUT1JTOiBSZWNvcmQ8c3RyaW5nLCAoKSA9PiB1bmtub3duPiA9IHtcbiAgd2VhdGhlcjogZ2VuZXJhdGVXZWF0aGVyRGF0YSxcbiAgbWFya2V0OiBnZW5lcmF0ZU1hcmtldERhdGEsXG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTMyBDb250ZW50IEZldGNoaW5nXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogUzMgY2xpZW50IGZvciBmZXRjaGluZyBjb250ZW50IGZyb20gUzMgYnVja2V0c1xuICogTGFtYmRhQEVkZ2UgcnVucyBpbiB1cy1lYXN0LTEsIHNvIHdlIHVzZSB0aGF0IHJlZ2lvblxuICovXG5jb25zdCBzM0NsaWVudCA9IG5ldyBTM0NsaWVudCh7IHJlZ2lvbjogJ3VzLWVhc3QtMScgfSk7XG5cbi8qKlxuICogQ2FjaGUgZm9yIFMzIGNvbnRlbnQgdG8gcmVkdWNlIGxhdGVuY3kgb24gcmVwZWF0ZWQgcmVxdWVzdHNcbiAqIE5vdGU6IExhbWJkYUBFZGdlIGluc3RhbmNlcyBtYXkgYmUgcmV1c2VkLCBzbyB0aGlzIHByb3ZpZGVzIHNvbWUgY2FjaGluZyBiZW5lZml0XG4gKi9cbmNvbnN0IHMzQ29udGVudENhY2hlID0gbmV3IE1hcDxzdHJpbmcsIHsgZGF0YTogdW5rbm93bjsgdGltZXN0YW1wOiBudW1iZXIgfT4oKTtcblxuLyoqXG4gKiBDYWNoZSBUVEwgaW4gbWlsbGlzZWNvbmRzICg1IG1pbnV0ZXMpXG4gKi9cbmNvbnN0IFMzX0NBQ0hFX1RUTF9NUyA9IDUgKiA2MCAqIDEwMDA7XG5cbi8qKlxuICogRmV0Y2hlcyBjb250ZW50IGZyb20gUzMgYnVja2V0XG4gKiBAcGFyYW0gYnVja2V0IC0gUzMgYnVja2V0IG5hbWVcbiAqIEBwYXJhbSBrZXkgLSBTMyBvYmplY3Qga2V5XG4gKiBAcmV0dXJucyBUaGUgY29udGVudCBmcm9tIFMzIG9yIGFuIGVycm9yIG9iamVjdFxuICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaFMzQ29udGVudChidWNrZXQ6IHN0cmluZywga2V5OiBzdHJpbmcpOiBQcm9taXNlPHVua25vd24+IHtcbiAgY29uc3QgY2FjaGVLZXkgPSBgJHtidWNrZXR9LyR7a2V5fWA7XG4gIFxuICAvLyBDaGVjayBjYWNoZSBmaXJzdFxuICBjb25zdCBjYWNoZWQgPSBzM0NvbnRlbnRDYWNoZS5nZXQoY2FjaGVLZXkpO1xuICBpZiAoY2FjaGVkICYmIERhdGUubm93KCkgLSBjYWNoZWQudGltZXN0YW1wIDwgUzNfQ0FDSEVfVFRMX01TKSB7XG4gICAgcmV0dXJuIGNhY2hlZC5kYXRhO1xuICB9XG4gIFxuICB0cnkge1xuICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICBCdWNrZXQ6IGJ1Y2tldCxcbiAgICAgIEtleToga2V5LFxuICAgIH0pO1xuICAgIFxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgczNDbGllbnQuc2VuZChjb21tYW5kKTtcbiAgICBcbiAgICBpZiAoIXJlc3BvbnNlLkJvZHkpIHtcbiAgICAgIHJldHVybiB7IGVycm9yOiAnRW1wdHkgcmVzcG9uc2UgZnJvbSBTMycsIGJ1Y2tldCwga2V5IH07XG4gICAgfVxuICAgIFxuICAgIC8vIFJlYWQgdGhlIHN0cmVhbSBhbmQgY29udmVydCB0byBzdHJpbmdcbiAgICBjb25zdCBib2R5Q29udGVudHMgPSBhd2FpdCByZXNwb25zZS5Cb2R5LnRyYW5zZm9ybVRvU3RyaW5nKCk7XG4gICAgXG4gICAgLy8gVHJ5IHRvIHBhcnNlIGFzIEpTT04sIG90aGVyd2lzZSByZXR1cm4gYXMgc3RyaW5nXG4gICAgbGV0IGNvbnRlbnQ6IHVua25vd247XG4gICAgdHJ5IHtcbiAgICAgIGNvbnRlbnQgPSBKU09OLnBhcnNlKGJvZHlDb250ZW50cyk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBOb3QgSlNPTiwgcmV0dXJuIGFzLWlzIHdyYXBwZWQgaW4gYW4gb2JqZWN0XG4gICAgICBjb250ZW50ID0ge1xuICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgIGNvbnRlbnQ6IGJvZHlDb250ZW50cyxcbiAgICAgICAgbWltZVR5cGU6IHJlc3BvbnNlLkNvbnRlbnRUeXBlIHx8ICd0ZXh0L3BsYWluJyxcbiAgICAgIH07XG4gICAgfVxuICAgIFxuICAgIC8vIENhY2hlIHRoZSByZXN1bHRcbiAgICBzM0NvbnRlbnRDYWNoZS5zZXQoY2FjaGVLZXksIHsgZGF0YTogY29udGVudCwgdGltZXN0YW1wOiBEYXRlLm5vdygpIH0pO1xuICAgIFxuICAgIHJldHVybiBjb250ZW50O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InO1xuICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBmZXRjaCBTMyBjb250ZW50OiAke2J1Y2tldH0vJHtrZXl9YCwgZXJyb3IpO1xuICAgIHJldHVybiB7XG4gICAgICBlcnJvcjogJ0ZhaWxlZCB0byBmZXRjaCBTMyBjb250ZW50JyxcbiAgICAgIGJ1Y2tldCxcbiAgICAgIGtleSxcbiAgICAgIG1lc3NhZ2U6IGVycm9yTWVzc2FnZSxcbiAgICB9O1xuICB9XG59XG5cbi8qKlxuICogQ2xlYXJzIHRoZSBTMyBjb250ZW50IGNhY2hlXG4gKiBVc2VmdWwgZm9yIHRlc3Rpbmcgb3Igd2hlbiBjb250ZW50IG5lZWRzIHRvIGJlIHJlZnJlc2hlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJTM0NhY2hlKCk6IHZvaWQge1xuICBzM0NvbnRlbnRDYWNoZS5jbGVhcigpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDb250ZW50IE1hbmFnZXJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBDb250ZW50IE1hbmFnZXIgY2xhc3MgZm9yIGhhbmRsaW5nIGR5bmFtaWMgY29udGVudFxuICovXG5leHBvcnQgY2xhc3MgQ29udGVudE1hbmFnZXIge1xuICBwcml2YXRlIHJlZ2lzdHJ5OiBDb250ZW50UmVnaXN0cnk7XG4gIFxuICBjb25zdHJ1Y3RvcihyZWdpc3RyeTogQ29udGVudFJlZ2lzdHJ5ID0gREVGQVVMVF9DT05URU5UX1JFR0lTVFJZKSB7XG4gICAgdGhpcy5yZWdpc3RyeSA9IHJlZ2lzdHJ5O1xuICB9XG4gIFxuICAvKipcbiAgICogR2V0cyBwYXltZW50IHJlcXVpcmVtZW50cyBmb3IgYSBnaXZlbiBwYXRoXG4gICAqL1xuICBnZXRQYXltZW50UmVxdWlyZW1lbnRzKHBhdGg6IHN0cmluZyk6IFBheW1lbnRSZXF1aXJlbWVudHMgfCBudWxsIHtcbiAgICBjb25zdCBpdGVtID0gdGhpcy5yZWdpc3RyeS5pdGVtc1twYXRoXTtcbiAgICByZXR1cm4gaXRlbT8ucHJpY2luZyB8fCBudWxsO1xuICB9XG4gIFxuICAvKipcbiAgICogR2V0cyBjb250ZW50IGZvciBhIGdpdmVuIHBhdGhcbiAgICovXG4gIGFzeW5jIGdldENvbnRlbnQocGF0aDogc3RyaW5nKTogUHJvbWlzZTx1bmtub3duPiB7XG4gICAgY29uc3QgaXRlbSA9IHRoaXMucmVnaXN0cnkuaXRlbXNbcGF0aF07XG4gICAgXG4gICAgaWYgKCFpdGVtKSB7XG4gICAgICByZXR1cm4geyBlcnJvcjogJ0NvbnRlbnQgbm90IGZvdW5kJywgcGF0aCB9O1xuICAgIH1cbiAgICBcbiAgICBzd2l0Y2ggKGl0ZW0uc291cmNlLnR5cGUpIHtcbiAgICAgIGNhc2UgJ2lubGluZSc6XG4gICAgICAgIHJldHVybiBpdGVtLnNvdXJjZS5kYXRhO1xuICAgICAgICBcbiAgICAgIGNhc2UgJ2R5bmFtaWMnOlxuICAgICAgICBjb25zdCBnZW5lcmF0b3IgPSBDT05URU5UX0dFTkVSQVRPUlNbaXRlbS5zb3VyY2UuZ2VuZXJhdG9yXTtcbiAgICAgICAgaWYgKGdlbmVyYXRvcikge1xuICAgICAgICAgIHJldHVybiBnZW5lcmF0b3IoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyBlcnJvcjogJ0dlbmVyYXRvciBub3QgZm91bmQnLCBnZW5lcmF0b3I6IGl0ZW0uc291cmNlLmdlbmVyYXRvciB9O1xuICAgICAgICBcbiAgICAgIGNhc2UgJ3MzJzpcbiAgICAgICAgLy8gRmV0Y2ggY29udGVudCBmcm9tIFMzIGJ1Y2tldFxuICAgICAgICByZXR1cm4gYXdhaXQgZmV0Y2hTM0NvbnRlbnQoaXRlbS5zb3VyY2UuYnVja2V0LCBpdGVtLnNvdXJjZS5rZXkpO1xuICAgICAgICBcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiB7IGVycm9yOiAnVW5rbm93biBjb250ZW50IHNvdXJjZSB0eXBlJyB9O1xuICAgIH1cbiAgfVxuICBcbiAgLyoqXG4gICAqIEdldHMgY29udGVudCBpdGVtIG1ldGFkYXRhXG4gICAqL1xuICBnZXRDb250ZW50SXRlbShwYXRoOiBzdHJpbmcpOiBDb250ZW50SXRlbSB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLnJlZ2lzdHJ5Lml0ZW1zW3BhdGhdIHx8IG51bGw7XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBMaXN0cyBhbGwgYXZhaWxhYmxlIGNvbnRlbnQgcGF0aHNcbiAgICovXG4gIGxpc3RDb250ZW50UGF0aHMoKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLnJlZ2lzdHJ5Lml0ZW1zKTtcbiAgfVxuICBcbiAgLyoqXG4gICAqIENoZWNrcyBpZiBhIHBhdGggcmVxdWlyZXMgcGF5bWVudFxuICAgKi9cbiAgcmVxdWlyZXNQYXltZW50KHBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBwYXRoIGluIHRoaXMucmVnaXN0cnkuaXRlbXM7XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjb250ZW50IHJlZ2lzdHJ5IHZlcnNpb25cbiAgICovXG4gIGdldFZlcnNpb24oKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RyeS52ZXJzaW9uO1xuICB9XG4gIFxuICAvKipcbiAgICogQWRkcyBvciB1cGRhdGVzIGEgY29udGVudCBpdGVtXG4gICAqL1xuICBzZXRDb250ZW50SXRlbShpdGVtOiBDb250ZW50SXRlbSk6IHZvaWQge1xuICAgIHRoaXMucmVnaXN0cnkuaXRlbXNbaXRlbS5wYXRoXSA9IGl0ZW07XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgY29udGVudCBpdGVtXG4gICAqL1xuICByZW1vdmVDb250ZW50SXRlbShwYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBpZiAocGF0aCBpbiB0aGlzLnJlZ2lzdHJ5Lml0ZW1zKSB7XG4gICAgICBkZWxldGUgdGhpcy5yZWdpc3RyeS5pdGVtc1twYXRoXTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU2luZ2xldG9uIEluc3RhbmNlXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRGVmYXVsdCBjb250ZW50IG1hbmFnZXIgaW5zdGFuY2VcbiAqL1xuZXhwb3J0IGNvbnN0IGNvbnRlbnRNYW5hZ2VyID0gbmV3IENvbnRlbnRNYW5hZ2VyKCk7XG4iXX0=