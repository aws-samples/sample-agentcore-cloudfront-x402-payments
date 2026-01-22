# x402 Seller Infrastructure

AWS CDK infrastructure for the seller side of the x402 payment demo.

## Architecture

- **CloudFront**: Content delivery network for serving protected content
- **Lambda@Edge**: Payment verification at the edge
- **S3**: Storage for static content (optional)

## Components

### Lambda@Edge Function
The `payment-verifier` function runs at CloudFront edge locations and:
1. Intercepts all requests to protected content
2. Checks for payment signature in request headers
3. Returns 402 Payment Required if no valid payment
4. Verifies payment details match requirements
5. Returns content if payment is valid

### Dynamic Content Support
The seller infrastructure supports dynamic content through the `ContentManager` class:

1. **Inline Content**: Static content defined in configuration
2. **Dynamic Generators**: Real-time generated content (weather, market data)
3. **S3 Content**: Content stored in S3 buckets with automatic fetching and caching

#### Content Types
- `/api/premium-article` - Static premium article content (inline)
- `/api/weather-data` - Dynamically generated weather data
- `/api/market-analysis` - Dynamically generated market analysis
- `/api/research-report` - Research report stored in S3
- `/api/dataset` - Premium dataset stored in S3
- `/api/tutorial` - Smart contract tutorial stored in S3

#### S3 Content
Content can be stored in S3 and automatically fetched by the Lambda@Edge function:

1. **Deploy the stack** to create the S3 bucket:
```bash
npm run deploy
```

2. **Upload content** using the provided script:
```bash
# Get the bucket name from CDK output
./scripts/upload-content.sh <bucket-name>
```

3. **Configure S3 content** in `content-config.ts`:
```typescript
contentManager.setContentItem({
  id: 's3-content',
  path: '/api/s3-content',
  title: 'S3 Stored Content',
  description: 'Content fetched from S3',
  mimeType: 'application/json',
  pricing: createPaymentRequirements('5000'),
  source: {
    type: 's3',
    bucket: 'your-bucket-name',
    key: 'content/your-file.json',
  },
});
```

**S3 Content Features:**
- Automatic caching (5-minute TTL) to reduce S3 requests
- JSON content is automatically parsed
- Non-JSON content is returned as text with MIME type
- Error handling for missing or inaccessible content

#### Adding New Content
To add new payment-protected content, update `content-config.ts`:

```typescript
import { contentManager, createPaymentRequirements } from './content-config';

// Add inline content
contentManager.setContentItem({
  id: 'my-content',
  path: '/api/my-content',
  title: 'My Premium Content',
  description: 'Description of the content',
  mimeType: 'application/json',
  pricing: createPaymentRequirements('1500'), // 0.0015 USDC
  source: {
    type: 'inline',
    data: { /* your content */ },
  },
});

// Add dynamic content with a generator
contentManager.setContentItem({
  id: 'dynamic-content',
  path: '/api/dynamic',
  title: 'Dynamic Content',
  description: 'Dynamically generated content',
  mimeType: 'application/json',
  pricing: createPaymentRequirements('500'),
  source: {
    type: 'dynamic',
    generator: 'myGenerator', // Must be registered in CONTENT_GENERATORS
  },
});
```

#### Environment Variables
Configure pricing and payment settings via environment variables:

- `PAYMENT_RECIPIENT` - Wallet address to receive payments
- `PAYMENT_NETWORK` - Network identifier (default: `eip155:84532` for Base Sepolia)
- `PAYMENT_ASSET` - Asset contract address (default: USDC on Base Sepolia)
- `CONTENT_BUCKET` - S3 bucket name for content storage (set at build time for Lambda@Edge)
- `FACILITATOR_URL` - x402 facilitator service URL

### Payment Flow
1. Client requests content without payment → 402 response with payment requirements
2. Client requests content with payment signature → Content delivered with settlement confirmation

## Deployment

### Prerequisites
- AWS CLI configured with appropriate credentials
- Node.js 18+ installed
- AWS CDK CLI installed (`npm install -g aws-cdk`)

### Steps

1. Install dependencies:
```bash
npm install
```

2. Bootstrap CDK (first time only):
```bash
cdk bootstrap
```

3. Build the Lambda function:
```bash
npm run build
```

4. Deploy the stack:
```bash
npm run deploy
```

5. Note the CloudFront distribution URL from the output

### Configuration

Update the payment recipient address in `lib/lambda-edge/payment-verifier.ts`:
```typescript
recipient: 'YOUR_WALLET_ADDRESS'
```

Update content prices in the same file:
```typescript
const CONTENT_PRICES: Record<string, PaymentRequirement> = {
  '/api/premium-article': {
    amount: '0.001',
    currency: 'ETH',
    // ...
  },
};
```

## Testing

After deployment, test the payment flow:

```bash
# Request without payment (should return 402)
curl -i https://YOUR_DISTRIBUTION.cloudfront.net/api/premium-article

# Request with payment signature
curl -i -H "PAYMENT-SIGNATURE: BASE64_ENCODED_PAYMENT" \
  https://YOUR_DISTRIBUTION.cloudfront.net/api/premium-article
```

## Monitoring

View Lambda@Edge logs in CloudWatch Logs:
- Logs are created in the region where the function executes (edge location)
- Log group: `/aws/lambda/us-east-1.PaymentVerifier`

## Cost Considerations

- CloudFront: Pay per request and data transfer
- Lambda@Edge: Pay per request and execution time
- S3: Pay for storage and data transfer

Estimated cost for development: < $5/month with low traffic

## Cleanup

To remove all resources:
```bash
cdk destroy
```

## Security Notes

This is a demo implementation. For production:
1. Implement proper cryptographic signature verification
2. Add rate limiting and DDoS protection
3. Use AWS WAF for additional security
4. Implement proper payment settlement with blockchain
5. Add monitoring and alerting
6. Use AWS Secrets Manager for sensitive data
