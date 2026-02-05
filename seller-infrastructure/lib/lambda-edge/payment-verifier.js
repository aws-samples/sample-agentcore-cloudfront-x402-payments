"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const types_1 = require("./types");
const content_config_1 = require("./content-config");
// ============================================================================
// Logging and Metrics Infrastructure
// ============================================================================
class Logger {
    constructor(requestId, uri) {
        this.requestId = requestId;
        this.uri = uri;
        this.startTime = Date.now();
        this.metrics = new Map();
        this.dimensions = {
            Uri: uri,
            Environment: process.env.ENVIRONMENT || 'production',
        };
    }
    /**
     * Creates a structured log entry
     */
    createLogEntry(level, message, extra) {
        return {
            timestamp: new Date().toISOString(),
            level,
            requestId: this.requestId,
            message,
            uri: this.uri,
            durationMs: Date.now() - this.startTime,
            ...extra,
        };
    }
    /**
     * Logs a debug message
     */
    debug(message, extra) {
        const entry = this.createLogEntry(types_1.LogLevel.DEBUG, message, extra);
        console.log(JSON.stringify(entry));
    }
    /**
     * Logs an info message
     */
    info(message, extra) {
        const entry = this.createLogEntry(types_1.LogLevel.INFO, message, extra);
        console.log(JSON.stringify(entry));
    }
    /**
     * Logs a warning message
     */
    warn(message, extra) {
        const entry = this.createLogEntry(types_1.LogLevel.WARN, message, extra);
        console.warn(JSON.stringify(entry));
    }
    /**
     * Logs an error message
     */
    error(message, error, extra) {
        const errorDetails = { ...extra };
        if (error instanceof Error) {
            errorDetails.errorMessage = error.message;
            errorDetails.errorStack = error.stack;
        }
        else if (error) {
            errorDetails.errorMessage = String(error);
        }
        const entry = this.createLogEntry(types_1.LogLevel.ERROR, message, errorDetails);
        console.error(JSON.stringify(entry));
    }
    /**
     * Records a metric value
     */
    recordMetric(name, value) {
        this.metrics.set(name, value);
    }
    /**
     * Increments a counter metric
     */
    incrementCounter(name) {
        const current = this.metrics.get(name) || 0;
        this.metrics.set(name, current + 1);
    }
    /**
     * Sets a dimension for metrics
     */
    setDimension(key, value) {
        this.dimensions[key] = value;
    }
    /**
     * Emits all recorded metrics in CloudWatch EMF format
     */
    emitMetrics() {
        if (this.metrics.size === 0)
            return;
        const metricsArray = [];
        const metricValues = {};
        this.metrics.forEach((value, name) => {
            const unit = name.includes('Latency') ? 'Milliseconds' : 'Count';
            metricsArray.push({ Name: name, Unit: unit });
            metricValues[name] = value;
        });
        const emf = {
            _aws: {
                Timestamp: Date.now(),
                CloudWatchMetrics: [
                    {
                        Namespace: 'X402/PaymentVerifier',
                        Dimensions: [Object.keys(this.dimensions)],
                        Metrics: metricsArray,
                    },
                ],
            },
            ...this.dimensions,
            ...metricValues,
            requestId: this.requestId,
        };
        // EMF logs must be printed to stdout for CloudWatch to parse them
        console.log(JSON.stringify(emf));
    }
    /**
     * Gets elapsed time since logger creation
     */
    getElapsedMs() {
        return Date.now() - this.startTime;
    }
}
/**
 * Generates a unique request ID for tracing
 */
function generateRequestId() {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}
// ============================================================================
// x402 v2 Types - imported from ./types
// ============================================================================
// Facilitator URL for payment verification
// Note: Lambda@Edge doesn't support environment variables, so this is bundled
// Using www subdomain to avoid 308 redirect (x402.org redirects to www.x402.org)
const FACILITATOR_URL = 'https://www.x402.org/facilitator';
// Seller wallet address to receive payments
// This wallet receives x402 payments on Base Sepolia
const SELLER_PAY_TO = '0x24842F3136Fa2a3df835d36b4c3cb4972d405502';
/**
 * Validates the structure of a payment payload
 */
function validatePayloadStructure(payload) {
    if (!payload || typeof payload !== 'object')
        return false;
    const p = payload;
    // Check required top-level fields
    if (typeof p.x402Version !== 'number' || p.x402Version !== 2)
        return false;
    if (!p.accepted || typeof p.accepted !== 'object')
        return false;
    if (!p.payload || typeof p.payload !== 'object')
        return false;
    // Check accepted requirements
    const accepted = p.accepted;
    if (typeof accepted.scheme !== 'string')
        return false;
    if (typeof accepted.network !== 'string')
        return false;
    if (typeof accepted.amount !== 'string')
        return false;
    if (typeof accepted.asset !== 'string')
        return false;
    if (typeof accepted.payTo !== 'string')
        return false;
    // Check payload (exact EVM scheme)
    const payloadData = p.payload;
    if (typeof payloadData.signature !== 'string')
        return false;
    if (!payloadData.authorization || typeof payloadData.authorization !== 'object')
        return false;
    // Check authorization
    const auth = payloadData.authorization;
    if (typeof auth.from !== 'string')
        return false;
    if (typeof auth.to !== 'string')
        return false;
    if (typeof auth.value !== 'string')
        return false;
    if (typeof auth.validAfter !== 'string')
        return false;
    if (typeof auth.validBefore !== 'string')
        return false;
    if (typeof auth.nonce !== 'string')
        return false;
    return true;
}
/**
 * Validates that the payment authorization matches the requirements
 */
function validateAuthorizationParameters(payload, requirements) {
    const { authorization } = payload.payload;
    const payer = authorization.from;
    // Verify scheme matches
    if (payload.accepted.scheme !== requirements.scheme) {
        return {
            isValid: false,
            invalidReason: 'scheme_mismatch',
            payer,
        };
    }
    // Verify network matches
    if (payload.accepted.network !== requirements.network) {
        return {
            isValid: false,
            invalidReason: 'network_mismatch',
            payer,
        };
    }
    // Verify recipient matches
    if (authorization.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
        return {
            isValid: false,
            invalidReason: 'invalid_exact_evm_payload_recipient_mismatch',
            payer,
        };
    }
    // Verify amount is sufficient
    const paymentValue = BigInt(authorization.value);
    const requiredAmount = BigInt(requirements.amount);
    if (paymentValue < requiredAmount) {
        return {
            isValid: false,
            invalidReason: 'invalid_exact_evm_payload_authorization_value',
            payer,
        };
    }
    // Verify time validity
    const now = Math.floor(Date.now() / 1000);
    const validAfter = parseInt(authorization.validAfter, 10);
    const validBefore = parseInt(authorization.validBefore, 10);
    // Check validAfter is not in the future
    if (validAfter > now) {
        return {
            isValid: false,
            invalidReason: 'invalid_exact_evm_payload_authorization_valid_after',
            payer,
        };
    }
    // Check validBefore is in the future (with 6 second buffer for block time)
    if (validBefore < now + 6) {
        return {
            isValid: false,
            invalidReason: 'invalid_exact_evm_payload_authorization_valid_before',
            payer,
        };
    }
    // Verify asset matches
    if (payload.accepted.asset.toLowerCase() !== requirements.asset.toLowerCase()) {
        return {
            isValid: false,
            invalidReason: 'asset_mismatch',
            payer,
        };
    }
    // Verify signature format (should be 65 bytes = 130 hex chars + 0x prefix)
    const signature = payload.payload.signature;
    if (!signature.startsWith('0x')) {
        return {
            isValid: false,
            invalidReason: 'invalid_signature_format',
            payer,
        };
    }
    const signatureLength = signature.length - 2; // Remove 0x prefix
    // EOA signatures are 130 chars, smart wallet signatures can be longer
    if (signatureLength < 130) {
        return {
            isValid: false,
            invalidReason: 'invalid_signature_length',
            payer,
        };
    }
    // Verify nonce format (should be 32 bytes = 64 hex chars + 0x prefix)
    const nonce = authorization.nonce;
    if (!nonce.startsWith('0x') || nonce.length !== 66) {
        return {
            isValid: false,
            invalidReason: 'invalid_nonce_format',
            payer,
        };
    }
    return {
        isValid: true,
        payer,
    };
}
/**
 * Verifies the payment signature using the facilitator service
 * In production, this would call the x402 facilitator's /verify endpoint
 */
async function verifySignatureWithFacilitator(payload, requirements, logger) {
    const payer = payload.payload.authorization.from;
    try {
        logger.debug('Calling facilitator /verify endpoint', {
            facilitatorUrl: FACILITATOR_URL,
        });
        // Call facilitator /verify endpoint
        const response = await fetch(`${FACILITATOR_URL}/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                paymentPayload: payload,
                paymentRequirements: requirements,
            }),
        });
        if (!response.ok) {
            logger.warn('Facilitator verify request failed', {
                statusCode: response.status,
                statusText: response.statusText,
            });
            logger.incrementCounter(types_1.MetricName.FACILITATOR_ERROR);
            return {
                isValid: false,
                invalidReason: 'facilitator_verification_failed',
                payer,
            };
        }
        const result = await response.json();
        logger.debug('Facilitator verification response received', {
            isValid: result.isValid,
        });
        return result;
    }
    catch (error) {
        logger.error('Error calling facilitator', error, {
            facilitatorUrl: FACILITATOR_URL,
        });
        logger.incrementCounter(types_1.MetricName.FACILITATOR_ERROR);
        // Fail properly - don't accept payments if facilitator is unavailable
        logger.error('Facilitator unavailable - rejecting payment for safety');
        return {
            isValid: false,
            invalidReason: 'facilitator_unavailable',
            payer,
        };
    }
}
/**
 * Settles the payment using the facilitator service
 */
async function settlePaymentWithFacilitator(payload, requirements, logger) {
    const payer = payload.payload.authorization.from;
    try {
        logger.debug('Calling facilitator /settle endpoint', {
            facilitatorUrl: FACILITATOR_URL,
            amount: requirements.amount,
        });
        const response = await fetch(`${FACILITATOR_URL}/settle`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                paymentPayload: payload,
                paymentRequirements: requirements,
            }),
        });
        if (!response.ok) {
            logger.warn('Facilitator settle request failed', {
                statusCode: response.status,
                statusText: response.statusText,
            });
            logger.incrementCounter(types_1.MetricName.FACILITATOR_ERROR);
            return {
                success: false,
                transaction: '',
                network: requirements.network,
                payer,
                errorReason: 'settlement_failed',
            };
        }
        const result = await response.json();
        logger.debug('Facilitator settlement response received', {
            success: result.success,
            transaction: result.transaction,
        });
        return result;
    }
    catch (error) {
        logger.error('Error settling payment', error, {
            facilitatorUrl: FACILITATOR_URL,
        });
        logger.incrementCounter(types_1.MetricName.FACILITATOR_ERROR);
        // Fail properly - don't fake settlements
        logger.error('Facilitator unavailable - settlement failed');
        return {
            success: false,
            transaction: '',
            network: requirements.network,
            payer,
            errorReason: 'facilitator_unavailable',
        };
    }
}
/**
 * Creates a 402 Payment Required response
 */
function create402Response(uri, requirements, errorMessage) {
    const paymentRequired = {
        x402Version: 2,
        error: errorMessage || 'Payment required to access this resource',
        resource: {
            url: uri,
            description: `Protected resource at ${uri}`,
            mimeType: 'application/json',
        },
        accepts: [requirements],
        extensions: {},
    };
    return {
        status: '402',
        statusDescription: 'Payment Required',
        headers: {
            'content-type': [{ key: 'Content-Type', value: 'application/json' }],
            'x-payment-required': [{
                    key: 'X-PAYMENT-REQUIRED',
                    value: Buffer.from(JSON.stringify(paymentRequired)).toString('base64'),
                }],
            'access-control-allow-origin': [{ key: 'Access-Control-Allow-Origin', value: '*' }],
            'access-control-allow-headers': [{
                    key: 'Access-Control-Allow-Headers',
                    value: 'Content-Type, X-Payment-Signature'
                }],
            'access-control-expose-headers': [{
                    key: 'Access-Control-Expose-Headers',
                    value: 'X-PAYMENT-REQUIRED, X-PAYMENT-RESPONSE',
                }],
        },
        body: JSON.stringify({
            error: 'Payment Required',
            message: errorMessage || 'This content requires payment to access',
            x402Version: 2,
        }),
    };
}
/**
 * Creates an error response
 */
function createErrorResponse(status, statusDescription, error, message) {
    return {
        status,
        statusDescription,
        headers: {
            'content-type': [{ key: 'Content-Type', value: 'application/json' }],
            'access-control-allow-origin': [{ key: 'Access-Control-Allow-Origin', value: '*' }],
        },
        body: JSON.stringify({ error, message }),
    };
}
/**
 * Creates MCP tool discovery response
 * Returns all available services with their pricing and metadata
 */
function createMCPDiscoveryResponse(requestId) {
    const tools = [];
    // Get all content items from the registry
    const paths = content_config_1.contentManager.listContentPaths();
    for (const path of paths) {
        const item = content_config_1.contentManager.getContentItem(path);
        if (!item)
            continue;
        // Convert path to tool name: /api/premium-article -> get_premium_article
        const toolName = 'get_' + path.replace('/api/', '').replace(/-/g, '_');
        // Calculate display price (USDC has 6 decimals)
        const amountUnits = parseInt(item.pricing.amount, 10);
        const displayPrice = (amountUnits / 1000000).toFixed(6).replace(/\.?0+$/, '');
        tools.push({
            tool_name: toolName,
            tool_description: `${item.description}. Requires x402 payment: ${item.pricing.amount} USDC units (${displayPrice} USDC) on Base Sepolia testnet.`,
            operation_id: toolName,
            endpoint_path: path,
            mcp_metadata: {
                category: path.includes('market') || path.includes('weather') ? 'market-data' :
                    path.includes('research') || path.includes('dataset') ? 'research' : 'content',
                tags: ['x402-payment', 'premium-content'],
                priority: 1,
                requires_payment: true,
                estimated_latency_ms: 2000,
            },
            x402_metadata: {
                price_usdc_units: item.pricing.amount,
                price_usdc_display: `${displayPrice} USDC`,
                network: item.pricing.network,
                network_name: 'Base Sepolia',
                scheme: item.pricing.scheme,
                asset_address: item.pricing.asset,
                asset_name: 'USDC',
                timeout_seconds: item.pricing.maxTimeoutSeconds,
            },
            input_schema: {
                type: 'object',
                properties: {},
                required: [],
                description: 'No input parameters required. Payment is handled via x402 headers.',
            },
        });
    }
    const response = {
        version: '1.0',
        tools,
        metadata: {
            gateway: 'x402-seller-gateway',
            protocol: 'x402-v2',
            network: 'base-sepolia',
            total_services: tools.length,
        },
    };
    return {
        status: '200',
        statusDescription: 'OK',
        headers: {
            'content-type': [{ key: 'Content-Type', value: 'application/json' }],
            'x-request-id': [{ key: 'X-Request-Id', value: requestId }],
            'access-control-allow-origin': [{ key: 'Access-Control-Allow-Origin', value: '*' }],
            'access-control-allow-headers': [{
                    key: 'Access-Control-Allow-Headers',
                    value: 'Content-Type, Accept'
                }],
            'cache-control': [{ key: 'Cache-Control', value: 'public, max-age=300' }],
        },
        body: JSON.stringify(response),
    };
}
const handler = async (event) => {
    const request = event.Records[0].cf.request;
    const uri = request.uri;
    // Initialize logger with request ID for tracing
    const requestId = generateRequestId();
    const logger = new Logger(requestId, uri);
    // Record request metric
    logger.incrementCounter(types_1.MetricName.REQUEST_COUNT);
    logger.info('Processing request', { method: request.method });
    try {
        // Handle MCP discovery endpoint (no payment required)
        if (uri === '/mcp/tools') {
            logger.info('MCP discovery request');
            logger.recordMetric(types_1.MetricName.LATENCY, logger.getElapsedMs());
            logger.emitMetrics();
            return createMCPDiscoveryResponse(requestId);
        }
        // Check if this path requires payment using dynamic content manager
        const paymentRequirement = content_config_1.contentManager.getPaymentRequirements(uri);
        if (!paymentRequirement) {
            // No payment required for this path
            logger.debug('No payment required for path');
            logger.recordMetric(types_1.MetricName.LATENCY, logger.getElapsedMs());
            logger.emitMetrics();
            return request;
        }
        logger.setDimension('Network', paymentRequirement.network);
        logger.setDimension('Asset', paymentRequirement.asset);
        // Check for payment signature header (x402 v2 uses X-PAYMENT-SIGNATURE)
        const paymentSignatureHeader = request.headers['x-payment-signature'] ||
            request.headers['payment-signature'];
        if (!paymentSignatureHeader || !paymentSignatureHeader[0]) {
            // No payment provided - return 402 Payment Required
            logger.info('No payment signature found, returning 402', {
                requiredAmount: paymentRequirement.amount,
            });
            logger.incrementCounter(types_1.MetricName.PAYMENT_REQUIRED);
            logger.recordMetric(types_1.MetricName.LATENCY, logger.getElapsedMs());
            logger.emitMetrics();
            return create402Response(uri, paymentRequirement);
        }
        // Payment signature present
        logger.incrementCounter(types_1.MetricName.PAYMENT_RECEIVED);
        // Decode and verify payment
        const paymentPayloadBase64 = paymentSignatureHeader[0].value;
        let paymentPayload;
        try {
            paymentPayload = JSON.parse(Buffer.from(paymentPayloadBase64, 'base64').toString('utf-8'));
        }
        catch (decodeError) {
            logger.warn('Failed to decode payment payload', {
                errorCode: 'DECODE_ERROR',
            });
            logger.incrementCounter(types_1.MetricName.VALIDATION_ERROR);
            logger.recordMetric(types_1.MetricName.LATENCY, logger.getElapsedMs());
            logger.emitMetrics();
            return create402Response(uri, paymentRequirement, 'Invalid payment payload encoding');
        }
        logger.debug('Payment payload decoded successfully');
        // Validate payload structure
        if (!validatePayloadStructure(paymentPayload)) {
            logger.warn('Invalid payment payload structure', {
                errorCode: 'INVALID_STRUCTURE',
            });
            logger.incrementCounter(types_1.MetricName.VALIDATION_ERROR);
            logger.recordMetric(types_1.MetricName.LATENCY, logger.getElapsedMs());
            logger.emitMetrics();
            return createErrorResponse('400', 'Bad Request', 'Invalid Payment', 'Payment payload structure is invalid');
        }
        // Extract payer address for logging
        const payer = paymentPayload.payload.authorization.from;
        logger.setDimension('Payer', payer.substring(0, 10) + '...');
        logger.info('Payment payload validated', {
            payer,
            amount: paymentPayload.accepted.amount,
            scheme: paymentPayload.accepted.scheme,
        });
        // Validate authorization parameters
        const paramValidation = validateAuthorizationParameters(paymentPayload, paymentRequirement);
        if (!paramValidation.isValid) {
            logger.warn('Payment parameter validation failed', {
                errorCode: paramValidation.invalidReason,
                payer,
            });
            logger.incrementCounter(types_1.MetricName.VALIDATION_ERROR);
            // Record specific validation error metrics
            switch (paramValidation.invalidReason) {
                case 'invalid_exact_evm_payload_authorization_valid_before':
                case 'invalid_exact_evm_payload_authorization_valid_after':
                    logger.incrementCounter(types_1.MetricName.AUTHORIZATION_EXPIRED);
                    break;
                case 'invalid_signature_format':
                case 'invalid_signature_length':
                    logger.incrementCounter(types_1.MetricName.SIGNATURE_INVALID);
                    break;
                case 'invalid_exact_evm_payload_authorization_value':
                    logger.incrementCounter(types_1.MetricName.AMOUNT_INSUFFICIENT);
                    break;
                case 'network_mismatch':
                    logger.incrementCounter(types_1.MetricName.NETWORK_MISMATCH);
                    break;
                case 'asset_mismatch':
                    logger.incrementCounter(types_1.MetricName.ASSET_MISMATCH);
                    break;
            }
            logger.recordMetric(types_1.MetricName.LATENCY, logger.getElapsedMs());
            logger.emitMetrics();
            return create402Response(uri, paymentRequirement, `Payment validation failed: ${paramValidation.invalidReason}`);
        }
        logger.debug('Authorization parameters validated');
        // Verify signature with facilitator
        const verificationStartTime = Date.now();
        const signatureValidation = await verifySignatureWithFacilitator(paymentPayload, paymentRequirement, logger);
        logger.recordMetric(types_1.MetricName.VERIFICATION_LATENCY, Date.now() - verificationStartTime);
        if (!signatureValidation.isValid) {
            logger.warn('Signature verification failed', {
                errorCode: signatureValidation.invalidReason,
                payer,
            });
            logger.incrementCounter(types_1.MetricName.PAYMENT_FAILED);
            logger.recordMetric(types_1.MetricName.LATENCY, logger.getElapsedMs());
            logger.emitMetrics();
            return create402Response(uri, paymentRequirement, `Signature verification failed: ${signatureValidation.invalidReason}`);
        }
        logger.incrementCounter(types_1.MetricName.PAYMENT_VERIFIED);
        logger.info('Payment signature verified', { payer });
        // Settle payment with facilitator
        const settlementStartTime = Date.now();
        const settlement = await settlePaymentWithFacilitator(paymentPayload, paymentRequirement, logger);
        logger.recordMetric(types_1.MetricName.SETTLEMENT_LATENCY, Date.now() - settlementStartTime);
        if (!settlement.success) {
            logger.error('Payment settlement failed', undefined, {
                errorCode: settlement.errorReason,
                payer,
            });
            logger.incrementCounter(types_1.MetricName.PAYMENT_FAILED);
            logger.recordMetric(types_1.MetricName.LATENCY, logger.getElapsedMs());
            logger.emitMetrics();
            return createErrorResponse('402', 'Payment Required', 'Settlement Failed', `Payment settlement failed: ${settlement.errorReason}`);
        }
        // Payment verified and settled - return dynamic content
        logger.incrementCounter(types_1.MetricName.PAYMENT_SETTLED);
        // Record payment amount metric
        try {
            const amountWei = BigInt(paymentPayload.payload.authorization.value);
            logger.recordMetric(types_1.MetricName.PAYMENT_AMOUNT_WEI, Number(amountWei));
        }
        catch {
            // Ignore if amount parsing fails
        }
        logger.info('Payment settled successfully', {
            payer,
            transactionHash: settlement.transaction,
            amount: paymentRequirement.amount,
            network: paymentRequirement.network,
        });
        // Get dynamic content from content manager
        const content = await content_config_1.contentManager.getContent(uri);
        logger.incrementCounter(types_1.MetricName.CONTENT_GENERATED);
        // Record content size metric
        const contentJson = JSON.stringify(content);
        logger.recordMetric(types_1.MetricName.CONTENT_BYTES_SERVED, contentJson.length);
        // Create settlement response header
        const settlementResponse = {
            success: true,
            transaction: settlement.transaction,
            network: paymentRequirement.network,
            payer: paymentPayload.payload.authorization.from,
        };
        logger.recordMetric(types_1.MetricName.LATENCY, logger.getElapsedMs());
        logger.emitMetrics();
        return {
            status: '200',
            statusDescription: 'OK',
            headers: {
                'content-type': [{ key: 'Content-Type', value: 'application/json' }],
                'x-payment-response': [{
                        key: 'X-PAYMENT-RESPONSE',
                        value: Buffer.from(JSON.stringify(settlementResponse)).toString('base64'),
                    }],
                'x-request-id': [{ key: 'X-Request-Id', value: requestId }],
                'access-control-allow-origin': [{ key: 'Access-Control-Allow-Origin', value: '*' }],
                'access-control-allow-headers': [{
                        key: 'Access-Control-Allow-Headers',
                        value: 'Content-Type, X-Payment-Signature'
                    }],
                'access-control-expose-headers': [{
                        key: 'Access-Control-Expose-Headers',
                        value: 'X-PAYMENT-RESPONSE, X-Request-Id'
                    }],
            },
            body: JSON.stringify(content),
        };
    }
    catch (error) {
        logger.error('Unexpected error processing payment', error);
        logger.incrementCounter(types_1.MetricName.PAYMENT_FAILED);
        logger.recordMetric(types_1.MetricName.LATENCY, logger.getElapsedMs());
        logger.emitMetrics();
        return createErrorResponse('500', 'Internal Server Error', 'Payment Processing Error', 'Failed to process payment');
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF5bWVudC12ZXJpZmllci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInBheW1lbnQtdmVyaWZpZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsbUNBVWlCO0FBQ2pCLHFEQUFrRDtBQUVsRCwrRUFBK0U7QUFDL0UscUNBQXFDO0FBQ3JDLCtFQUErRTtBQUMvRSxNQUFNLE1BQU07SUFPVixZQUFZLFNBQWlCLEVBQUUsR0FBVztRQUN4QyxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztRQUMzQixJQUFJLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQztRQUNmLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUN6QixJQUFJLENBQUMsVUFBVSxHQUFHO1lBQ2hCLEdBQUcsRUFBRSxHQUFHO1lBQ1IsV0FBVyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLFlBQVk7U0FDckQsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNLLGNBQWMsQ0FDcEIsS0FBZSxFQUNmLE9BQWUsRUFDZixLQUErQjtRQUUvQixPQUFPO1lBQ0wsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1lBQ25DLEtBQUs7WUFDTCxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVM7WUFDekIsT0FBTztZQUNQLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRztZQUNiLFVBQVUsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVM7WUFDdkMsR0FBRyxLQUFLO1NBQ1QsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxPQUFlLEVBQUUsS0FBK0I7UUFDcEQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxnQkFBUSxDQUFDLEtBQUssRUFBRSxPQUFP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QUFFLENBQUM7UUFDZixNQUFNLENBQUMsS0FBSyxDQUFDLHFDQUFxQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzNELE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxrQkFBVSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQ25ELE1BQU0sQ0FBQyxZQUFZLENBQUMsa0JBQVUsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDLENBQUM7UUFDL0QsTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQ3JCLE9BQU8sbUJBQW1CLENBQ3hCLEtBQUssRUFDTCx1QkFBdUIsRUFDdkIsMEJBQTBCLEVBQzFCLDJCQUEyQixDQUM1QixDQUFDO0lBQ0osQ0FBQztBQUNILENBQUMsQ0FBQztBQWpSVyxRQUFBLE9BQU8sV0FpUmxCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2xvdWRGcm9udFJlcXVlc3RFdmVudCwgQ2xvdWRGcm9udFJlcXVlc3RSZXN1bHQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7XG4gIExvZ0xldmVsLFxuICBNZXRyaWNOYW1lLFxuICBMb2dFbnRyeSxcbiAgRU1GTWV0cmljLFxuICBQYXltZW50UmVxdWlyZW1lbnRzLFxuICBQYXltZW50UmVxdWlyZWQsXG4gIFBheW1lbnRQYXlsb2FkLFxuICBWZXJpZnlSZXNwb25zZSxcbiAgU2V0dGxlbWVudFJlc3BvbnNlLFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IGNvbnRlbnRNYW5hZ2VyIH0gZnJvbSAnLi9jb250ZW50LWNvbmZpZyc7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIExvZ2dpbmcgYW5kIE1ldHJpY3MgSW5mcmFzdHJ1Y3R1cmVcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmNsYXNzIExvZ2dlciB7XG4gIHByaXZhdGUgcmVxdWVzdElkOiBzdHJpbmc7XG4gIHByaXZhdGUgdXJpOiBzdHJpbmc7XG4gIHByaXZhdGUgc3RhcnRUaW1lOiBudW1iZXI7XG4gIHByaXZhdGUgbWV0cmljczogTWFwPHN0cmluZywgbnVtYmVyPjtcbiAgcHJpdmF0ZSBkaW1lbnNpb25zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuXG4gIGNvbnN0cnVjdG9yKHJlcXVlc3RJZDogc3RyaW5nLCB1cmk6IHN0cmluZykge1xuICAgIHRoaXMucmVxdWVzdElkID0gcmVxdWVzdElkO1xuICAgIHRoaXMudXJpID0gdXJpO1xuICAgIHRoaXMuc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICB0aGlzLm1ldHJpY3MgPSBuZXcgTWFwKCk7XG4gICAgdGhpcy5kaW1lbnNpb25zID0ge1xuICAgICAgVXJpOiB1cmksXG4gICAgICBFbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuRU5WSVJPTk1FTlQgfHwgJ3Byb2R1Y3Rpb24nLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHN0cnVjdHVyZWQgbG9nIGVudHJ5XG4gICAqL1xuICBwcml2YXRlIGNyZWF0ZUxvZ0VudHJ5KFxuICAgIGxldmVsOiBMb2dMZXZlbCxcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgZXh0cmE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICApOiBMb2dFbnRyeSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgbGV2ZWwsXG4gICAgICByZXF1ZXN0SWQ6IHRoaXMucmVxdWVzdElkLFxuICAgICAgbWVzc2FnZSxcbiAgICAgIHVyaTogdGhpcy51cmksXG4gICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gdGhpcy5zdGFydFRpbWUsXG4gICAgICAuLi5leHRyYSxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgYSBkZWJ1ZyBtZXNzYWdlXG4gICAqL1xuICBkZWJ1ZyhtZXNzYWdlOiBzdHJpbmcsIGV4dHJhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuY3JlYXRlTG9nRW50cnkoTG9nTGV2ZWwuREVCVUcsIG1lc3NhZ2UsIGV4dHJhKTtcbiAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShlbnRyeSkpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgYW4gaW5mbyBtZXNzYWdlXG4gICAqL1xuICBpbmZvKG1lc3NhZ2U6IHN0cmluZywgZXh0cmE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5jcmVhdGVMb2dFbnRyeShMb2dMZXZlbC5JTkZPLCBtZXNzYWdlLCBleHRyYSk7XG4gICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkoZW50cnkpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dzIGEgd2FybmluZyBtZXNzYWdlXG4gICAqL1xuICB3YXJuKG1lc3NhZ2U6IHN0cmluZywgZXh0cmE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5jcmVhdGVMb2dFbnRyeShMb2dMZXZlbC5XQVJOLCBtZXNzYWdlLCBleHRyYSk7XG4gICAgY29uc29sZS53YXJuKEpTT04uc3RyaW5naWZ5KGVudHJ5KSk7XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhbiBlcnJvciBtZXNzYWdlXG4gICAqL1xuICBlcnJvcihtZXNzYWdlOiBzdHJpbmcsIGVycm9yPzogRXJyb3IgfCB1bmtub3duLCBleHRyYT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCB7XG4gICAgY29uc3QgZXJyb3JEZXRhaWxzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHsgLi4uZXh0cmEgfTtcbiAgICBcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgZXJyb3JEZXRhaWxzLmVycm9yTWVzc2FnZSA9IGVycm9yLm1lc3NhZ2U7XG4gICAgICBlcnJvckRldGFpbHMuZXJyb3JTdGFjayA9IGVycm9yLnN0YWNrO1xuICAgIH0gZWxzZSBpZiAoZXJyb3IpIHtcbiAgICAgIGVycm9yRGV0YWlscy5lcnJvck1lc3NhZ2UgPSBTdHJpbmcoZXJyb3IpO1xuICAgIH1cbiAgICBcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuY3JlYXRlTG9nRW50cnkoTG9nTGV2ZWwuRVJST1IsIG1lc3NhZ2UsIGVycm9yRGV0YWlscyk7XG4gICAgY29uc29sZS5lcnJvcihKU09OLnN0cmluZ2lmeShlbnRyeSkpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBtZXRyaWMgdmFsdWVcbiAgICovXG4gIHJlY29yZE1ldHJpYyhuYW1lOiBNZXRyaWNOYW1lLCB2YWx1ZTogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5tZXRyaWNzLnNldChuYW1lLCB2YWx1ZSk7XG4gIH1cblxuICAvKipcbiAgICogSW5jcmVtZW50cyBhIGNvdW50ZXIgbWV0cmljXG4gICAqL1xuICBpbmNyZW1lbnRDb3VudGVyKG5hbWU6IE1ldHJpY05hbWUpOiB2b2lkIHtcbiAgICBjb25zdCBjdXJyZW50ID0gdGhpcy5tZXRyaWNzLmdldChuYW1lKSB8fCAwO1xuICAgIHRoaXMubWV0cmljcy5zZXQobmFtZSwgY3VycmVudCArIDEpO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgYSBkaW1lbnNpb24gZm9yIG1ldHJpY3NcbiAgICovXG4gIHNldERpbWVuc2lvbihrZXk6IHN0cmluZywgdmFsdWU6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuZGltZW5zaW9uc1trZXldID0gdmFsdWU7XG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgYWxsIHJlY29yZGVkIG1ldHJpY3MgaW4gQ2xvdWRXYXRjaCBFTUYgZm9ybWF0XG4gICAqL1xuICBlbWl0TWV0cmljcygpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5tZXRyaWNzLnNpemUgPT09IDApIHJldHVybjtcblxuICAgIGNvbnN0IG1ldHJpY3NBcnJheTogQXJyYXk8eyBOYW1lOiBzdHJpbmc7IFVuaXQ6IHN0cmluZyB9PiA9IFtdO1xuICAgIGNvbnN0IG1ldHJpY1ZhbHVlczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuXG4gICAgdGhpcy5tZXRyaWNzLmZvckVhY2goKHZhbHVlLCBuYW1lKSA9PiB7XG4gICAgICBjb25zdCB1bml0ID0gbmFtZS5pbmNsdWRlcygnTGF0ZW5jeScpID8gJ01pbGxpc2Vjb25kcycgOiAnQ291bnQnO1xuICAgICAgbWV0cmljc0FycmF5LnB1c2goeyBOYW1lOiBuYW1lLCBVbml0OiB1bml0IH0pO1xuICAgICAgbWV0cmljVmFsdWVzW25hbWVdID0gdmFsdWU7XG4gICAgfSk7XG5cbiAgICBjb25zdCBlbWY6IEVNRk1ldHJpYyA9IHtcbiAgICAgIF9hd3M6IHtcbiAgICAgICAgVGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICBDbG91ZFdhdGNoTWV0cmljczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIE5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgICAgIERpbWVuc2lvbnM6IFtPYmplY3Qua2V5cyh0aGlzLmRpbWVuc2lvbnMpXSxcbiAgICAgICAgICAgIE1ldHJpY3M6IG1ldHJpY3NBcnJheSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIC4uLnRoaXMuZGltZW5zaW9ucyxcbiAgICAgIC4uLm1ldHJpY1ZhbHVlcyxcbiAgICAgIHJlcXVlc3RJZDogdGhpcy5yZXF1ZXN0SWQsXG4gICAgfTtcblxuICAgIC8vIEVNRiBsb2dzIG11c3QgYmUgcHJpbnRlZCB0byBzdGRvdXQgZm9yIENsb3VkV2F0Y2ggdG8gcGFyc2UgdGhlbVxuICAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KGVtZikpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgZWxhcHNlZCB0aW1lIHNpbmNlIGxvZ2dlciBjcmVhdGlvblxuICAgKi9cbiAgZ2V0RWxhcHNlZE1zKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIERhdGUubm93KCkgLSB0aGlzLnN0YXJ0VGltZTtcbiAgfVxufVxuXG4vKipcbiAqIEdlbmVyYXRlcyBhIHVuaXF1ZSByZXF1ZXN0IElEIGZvciB0cmFjaW5nXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlUmVxdWVzdElkKCk6IHN0cmluZyB7XG4gIHJldHVybiBgcmVxXyR7RGF0ZS5ub3coKS50b1N0cmluZygzNil9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyaW5nKDIsIDkpfWA7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIHg0MDIgdjIgVHlwZXMgLSBpbXBvcnRlZCBmcm9tIC4vdHlwZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLy8gRmFjaWxpdGF0b3IgVVJMIGZvciBwYXltZW50IHZlcmlmaWNhdGlvblxuLy8gTm90ZTogTGFtYmRhQEVkZ2UgZG9lc24ndCBzdXBwb3J0IGVudmlyb25tZW50IHZhcmlhYmxlcywgc28gdGhpcyBpcyBidW5kbGVkXG4vLyBVc2luZyB3d3cgc3ViZG9tYWluIHRvIGF2b2lkIDMwOCByZWRpcmVjdCAoeDQwMi5vcmcgcmVkaXJlY3RzIHRvIHd3dy54NDAyLm9yZylcbmNvbnN0IEZBQ0lMSVRBVE9SX1VSTCA9ICdodHRwczovL3d3dy54NDAyLm9yZy9mYWNpbGl0YXRvcic7XG5cbi8vIFNlbGxlciB3YWxsZXQgYWRkcmVzcyB0byByZWNlaXZlIHBheW1lbnRzXG4vLyBUaGlzIHdhbGxldCByZWNlaXZlcyB4NDAyIHBheW1lbnRzIG9uIEJhc2UgU2Vwb2xpYVxuY29uc3QgU0VMTEVSX1BBWV9UTyA9ICcweDI0ODQyRjMxMzZGYTJhM2RmODM1ZDM2YjRjM2NiNDk3MmQ0MDU1MDInO1xuXG4vKipcbiAqIFZhbGlkYXRlcyB0aGUgc3RydWN0dXJlIG9mIGEgcGF5bWVudCBwYXlsb2FkXG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlUGF5bG9hZFN0cnVjdHVyZShwYXlsb2FkOiB1bmtub3duKTogcGF5bG9hZCBpcyBQYXltZW50UGF5bG9hZCB7XG4gIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcbiAgXG4gIGNvbnN0IHAgPSBwYXlsb2FkIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBcbiAgLy8gQ2hlY2sgcmVxdWlyZWQgdG9wLWxldmVsIGZpZWxkc1xuICBpZiAodHlwZW9mIHAueDQwMlZlcnNpb24gIT09ICdudW1iZXInIHx8IHAueDQwMlZlcnNpb24gIT09IDIpIHJldHVybiBmYWxzZTtcbiAgaWYgKCFwLmFjY2VwdGVkIHx8IHR5cGVvZiBwLmFjY2VwdGVkICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuICBpZiAoIXAucGF5bG9hZCB8fCB0eXBlb2YgcC5wYXlsb2FkICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuICBcbiAgLy8gQ2hlY2sgYWNjZXB0ZWQgcmVxdWlyZW1lbnRzXG4gIGNvbnN0IGFjY2VwdGVkID0gcC5hY2NlcHRlZCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgaWYgKHR5cGVvZiBhY2NlcHRlZC5zY2hlbWUgIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgYWNjZXB0ZWQubmV0d29yayAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhY2NlcHRlZC5hbW91bnQgIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgYWNjZXB0ZWQuYXNzZXQgIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgYWNjZXB0ZWQucGF5VG8gIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIFxuICAvLyBDaGVjayBwYXlsb2FkIChleGFjdCBFVk0gc2NoZW1lKVxuICBjb25zdCBwYXlsb2FkRGF0YSA9IHAucGF5bG9hZCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgaWYgKHR5cGVvZiBwYXlsb2FkRGF0YS5zaWduYXR1cmUgIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIGlmICghcGF5bG9hZERhdGEuYXV0aG9yaXphdGlvbiB8fCB0eXBlb2YgcGF5bG9hZERhdGEuYXV0aG9yaXphdGlvbiAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcbiAgXG4gIC8vIENoZWNrIGF1dGhvcml6YXRpb25cbiAgY29uc3QgYXV0aCA9IHBheWxvYWREYXRhLmF1dGhvcml6YXRpb24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGlmICh0eXBlb2YgYXV0aC5mcm9tICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIGF1dGgudG8gIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgYXV0aC52YWx1ZSAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhdXRoLnZhbGlkQWZ0ZXIgIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgYXV0aC52YWxpZEJlZm9yZSAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhdXRoLm5vbmNlICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKlxuICogVmFsaWRhdGVzIHRoYXQgdGhlIHBheW1lbnQgYXV0aG9yaXphdGlvbiBtYXRjaGVzIHRoZSByZXF1aXJlbWVudHNcbiAqL1xuZnVuY3Rpb24gdmFsaWRhdGVBdXRob3JpemF0aW9uUGFyYW1ldGVycyhcbiAgcGF5bG9hZDogUGF5bWVudFBheWxvYWQsXG4gIHJlcXVpcmVtZW50czogUGF5bWVudFJlcXVpcmVtZW50c1xuKTogVmVyaWZ5UmVzcG9uc2Uge1xuICBjb25zdCB7IGF1dGhvcml6YXRpb24gfSA9IHBheWxvYWQucGF5bG9hZDtcbiAgY29uc3QgcGF5ZXIgPSBhdXRob3JpemF0aW9uLmZyb207XG4gIFxuICAvLyBWZXJpZnkgc2NoZW1lIG1hdGNoZXNcbiAgaWYgKHBheWxvYWQuYWNjZXB0ZWQuc2NoZW1lICE9PSByZXF1aXJlbWVudHMuc2NoZW1lKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ3NjaGVtZV9taXNtYXRjaCcsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICAvLyBWZXJpZnkgbmV0d29yayBtYXRjaGVzXG4gIGlmIChwYXlsb2FkLmFjY2VwdGVkLm5ldHdvcmsgIT09IHJlcXVpcmVtZW50cy5uZXR3b3JrKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ25ldHdvcmtfbWlzbWF0Y2gnLFxuICAgICAgcGF5ZXIsXG4gICAgfTtcbiAgfVxuICBcbiAgLy8gVmVyaWZ5IHJlY2lwaWVudCBtYXRjaGVzXG4gIGlmIChhdXRob3JpemF0aW9uLnRvLnRvTG93ZXJDYXNlKCkgIT09IHJlcXVpcmVtZW50cy5wYXlUby50b0xvd2VyQ2FzZSgpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ2ludmFsaWRfZXhhY3RfZXZtX3BheWxvYWRfcmVjaXBpZW50X21pc21hdGNoJyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIC8vIFZlcmlmeSBhbW91bnQgaXMgc3VmZmljaWVudFxuICBjb25zdCBwYXltZW50VmFsdWUgPSBCaWdJbnQoYXV0aG9yaXphdGlvbi52YWx1ZSk7XG4gIGNvbnN0IHJlcXVpcmVkQW1vdW50ID0gQmlnSW50KHJlcXVpcmVtZW50cy5hbW91bnQpO1xuICBpZiAocGF5bWVudFZhbHVlIDwgcmVxdWlyZWRBbW91bnQpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnaW52YWxpZF9leGFjdF9ldm1fcGF5bG9hZF9hdXRob3JpemF0aW9uX3ZhbHVlJyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIC8vIFZlcmlmeSB0aW1lIHZhbGlkaXR5XG4gIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xuICBjb25zdCB2YWxpZEFmdGVyID0gcGFyc2VJbnQoYXV0aG9yaXphdGlvbi52YWxpZEFmdGVyLCAxMCk7XG4gIGNvbnN0IHZhbGlkQmVmb3JlID0gcGFyc2VJbnQoYXV0aG9yaXphdGlvbi52YWxpZEJlZm9yZSwgMTApO1xuICBcbiAgLy8gQ2hlY2sgdmFsaWRBZnRlciBpcyBub3QgaW4gdGhlIGZ1dHVyZVxuICBpZiAodmFsaWRBZnRlciA+IG5vdykge1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICdpbnZhbGlkX2V4YWN0X2V2bV9wYXlsb2FkX2F1dGhvcml6YXRpb25fdmFsaWRfYWZ0ZXInLFxuICAgICAgcGF5ZXIsXG4gICAgfTtcbiAgfVxuICBcbiAgLy8gQ2hlY2sgdmFsaWRCZWZvcmUgaXMgaW4gdGhlIGZ1dHVyZSAod2l0aCA2IHNlY29uZCBidWZmZXIgZm9yIGJsb2NrIHRpbWUpXG4gIGlmICh2YWxpZEJlZm9yZSA8IG5vdyArIDYpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnaW52YWxpZF9leGFjdF9ldm1fcGF5bG9hZF9hdXRob3JpemF0aW9uX3ZhbGlkX2JlZm9yZScsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICAvLyBWZXJpZnkgYXNzZXQgbWF0Y2hlc1xuICBpZiAocGF5bG9hZC5hY2NlcHRlZC5hc3NldC50b0xvd2VyQ2FzZSgpICE9PSByZXF1aXJlbWVudHMuYXNzZXQudG9Mb3dlckNhc2UoKSkge1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICdhc3NldF9taXNtYXRjaCcsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICAvLyBWZXJpZnkgc2lnbmF0dXJlIGZvcm1hdCAoc2hvdWxkIGJlIDY1IGJ5dGVzID0gMTMwIGhleCBjaGFycyArIDB4IHByZWZpeClcbiAgY29uc3Qgc2lnbmF0dXJlID0gcGF5bG9hZC5wYXlsb2FkLnNpZ25hdHVyZTtcbiAgaWYgKCFzaWduYXR1cmUuc3RhcnRzV2l0aCgnMHgnKSkge1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICdpbnZhbGlkX3NpZ25hdHVyZV9mb3JtYXQnLFxuICAgICAgcGF5ZXIsXG4gICAgfTtcbiAgfVxuICBcbiAgY29uc3Qgc2lnbmF0dXJlTGVuZ3RoID0gc2lnbmF0dXJlLmxlbmd0aCAtIDI7IC8vIFJlbW92ZSAweCBwcmVmaXhcbiAgLy8gRU9BIHNpZ25hdHVyZXMgYXJlIDEzMCBjaGFycywgc21hcnQgd2FsbGV0IHNpZ25hdHVyZXMgY2FuIGJlIGxvbmdlclxuICBpZiAoc2lnbmF0dXJlTGVuZ3RoIDwgMTMwKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ2ludmFsaWRfc2lnbmF0dXJlX2xlbmd0aCcsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICAvLyBWZXJpZnkgbm9uY2UgZm9ybWF0IChzaG91bGQgYmUgMzIgYnl0ZXMgPSA2NCBoZXggY2hhcnMgKyAweCBwcmVmaXgpXG4gIGNvbnN0IG5vbmNlID0gYXV0aG9yaXphdGlvbi5ub25jZTtcbiAgaWYgKCFub25jZS5zdGFydHNXaXRoKCcweCcpIHx8IG5vbmNlLmxlbmd0aCAhPT0gNjYpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnaW52YWxpZF9ub25jZV9mb3JtYXQnLFxuICAgICAgcGF5ZXIsXG4gICAgfTtcbiAgfVxuICBcbiAgcmV0dXJuIHtcbiAgICBpc1ZhbGlkOiB0cnVlLFxuICAgIHBheWVyLFxuICB9O1xufVxuXG4vKipcbiAqIFZlcmlmaWVzIHRoZSBwYXltZW50IHNpZ25hdHVyZSB1c2luZyB0aGUgZmFjaWxpdGF0b3Igc2VydmljZVxuICogSW4gcHJvZHVjdGlvbiwgdGhpcyB3b3VsZCBjYWxsIHRoZSB4NDAyIGZhY2lsaXRhdG9yJ3MgL3ZlcmlmeSBlbmRwb2ludFxuICovXG5hc3luYyBmdW5jdGlvbiB2ZXJpZnlTaWduYXR1cmVXaXRoRmFjaWxpdGF0b3IoXG4gIHBheWxvYWQ6IFBheW1lbnRQYXlsb2FkLFxuICByZXF1aXJlbWVudHM6IFBheW1lbnRSZXF1aXJlbWVudHMsXG4gIGxvZ2dlcjogTG9nZ2VyXG4pOiBQcm9taXNlPFZlcmlmeVJlc3BvbnNlPiB7XG4gIGNvbnN0IHBheWVyID0gcGF5bG9hZC5wYXlsb2FkLmF1dGhvcml6YXRpb24uZnJvbTtcbiAgXG4gIHRyeSB7XG4gICAgbG9nZ2VyLmRlYnVnKCdDYWxsaW5nIGZhY2lsaXRhdG9yIC92ZXJpZnkgZW5kcG9pbnQnLCB7XG4gICAgICBmYWNpbGl0YXRvclVybDogRkFDSUxJVEFUT1JfVVJMLFxuICAgIH0pO1xuICAgIFxuICAgIC8vIENhbGwgZmFjaWxpdGF0b3IgL3ZlcmlmeSBlbmRwb2ludFxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goYCR7RkFDSUxJVEFUT1JfVVJMfS92ZXJpZnlgLCB7XG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHBheW1lbnRQYXlsb2FkOiBwYXlsb2FkLFxuICAgICAgICBwYXltZW50UmVxdWlyZW1lbnRzOiByZXF1aXJlbWVudHMsXG4gICAgICB9KSxcbiAgICB9KTtcbiAgICBcbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICBsb2dnZXIud2FybignRmFjaWxpdGF0b3IgdmVyaWZ5IHJlcXVlc3QgZmFpbGVkJywge1xuICAgICAgICBzdGF0dXNDb2RlOiByZXNwb25zZS5zdGF0dXMsXG4gICAgICAgIHN0YXR1c1RleHQ6IHJlc3BvbnNlLnN0YXR1c1RleHQsXG4gICAgICB9KTtcbiAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuRkFDSUxJVEFUT1JfRVJST1IpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICAgIGludmFsaWRSZWFzb246ICdmYWNpbGl0YXRvcl92ZXJpZmljYXRpb25fZmFpbGVkJyxcbiAgICAgICAgcGF5ZXIsXG4gICAgICB9O1xuICAgIH1cbiAgICBcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXNwb25zZS5qc29uKCkgYXMgVmVyaWZ5UmVzcG9uc2U7XG4gICAgbG9nZ2VyLmRlYnVnKCdGYWNpbGl0YXRvciB2ZXJpZmljYXRpb24gcmVzcG9uc2UgcmVjZWl2ZWQnLCB7XG4gICAgICBpc1ZhbGlkOiByZXN1bHQuaXNWYWxpZCxcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignRXJyb3IgY2FsbGluZyBmYWNpbGl0YXRvcicsIGVycm9yLCB7XG4gICAgICBmYWNpbGl0YXRvclVybDogRkFDSUxJVEFUT1JfVVJMLFxuICAgIH0pO1xuICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuRkFDSUxJVEFUT1JfRVJST1IpO1xuICAgIC8vIEZhaWwgcHJvcGVybHkgLSBkb24ndCBhY2NlcHQgcGF5bWVudHMgaWYgZmFjaWxpdGF0b3IgaXMgdW5hdmFpbGFibGVcbiAgICBsb2dnZXIuZXJyb3IoJ0ZhY2lsaXRhdG9yIHVuYXZhaWxhYmxlIC0gcmVqZWN0aW5nIHBheW1lbnQgZm9yIHNhZmV0eScpO1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICdmYWNpbGl0YXRvcl91bmF2YWlsYWJsZScsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG59XG5cbi8qKlxuICogU2V0dGxlcyB0aGUgcGF5bWVudCB1c2luZyB0aGUgZmFjaWxpdGF0b3Igc2VydmljZVxuICovXG5hc3luYyBmdW5jdGlvbiBzZXR0bGVQYXltZW50V2l0aEZhY2lsaXRhdG9yKFxuICBwYXlsb2FkOiBQYXltZW50UGF5bG9hZCxcbiAgcmVxdWlyZW1lbnRzOiBQYXltZW50UmVxdWlyZW1lbnRzLFxuICBsb2dnZXI6IExvZ2dlclxuKTogUHJvbWlzZTxTZXR0bGVtZW50UmVzcG9uc2U+IHtcbiAgY29uc3QgcGF5ZXIgPSBwYXlsb2FkLnBheWxvYWQuYXV0aG9yaXphdGlvbi5mcm9tO1xuICBcbiAgdHJ5IHtcbiAgICBsb2dnZXIuZGVidWcoJ0NhbGxpbmcgZmFjaWxpdGF0b3IgL3NldHRsZSBlbmRwb2ludCcsIHtcbiAgICAgIGZhY2lsaXRhdG9yVXJsOiBGQUNJTElUQVRPUl9VUkwsXG4gICAgICBhbW91bnQ6IHJlcXVpcmVtZW50cy5hbW91bnQsXG4gICAgfSk7XG4gICAgXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHtGQUNJTElUQVRPUl9VUkx9L3NldHRsZWAsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcGF5bWVudFBheWxvYWQ6IHBheWxvYWQsXG4gICAgICAgIHBheW1lbnRSZXF1aXJlbWVudHM6IHJlcXVpcmVtZW50cyxcbiAgICAgIH0pLFxuICAgIH0pO1xuICAgIFxuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIGxvZ2dlci53YXJuKCdGYWNpbGl0YXRvciBzZXR0bGUgcmVxdWVzdCBmYWlsZWQnLCB7XG4gICAgICAgIHN0YXR1c0NvZGU6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgICAgc3RhdHVzVGV4dDogcmVzcG9uc2Uuc3RhdHVzVGV4dCxcbiAgICAgIH0pO1xuICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5GQUNJTElUQVRPUl9FUlJPUik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgdHJhbnNhY3Rpb246ICcnLFxuICAgICAgICBuZXR3b3JrOiByZXF1aXJlbWVudHMubmV0d29yayxcbiAgICAgICAgcGF5ZXIsXG4gICAgICAgIGVycm9yUmVhc29uOiAnc2V0dGxlbWVudF9mYWlsZWQnLFxuICAgICAgfTtcbiAgICB9XG4gICAgXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcmVzcG9uc2UuanNvbigpIGFzIFNldHRsZW1lbnRSZXNwb25zZTtcbiAgICBsb2dnZXIuZGVidWcoJ0ZhY2lsaXRhdG9yIHNldHRsZW1lbnQgcmVzcG9uc2UgcmVjZWl2ZWQnLCB7XG4gICAgICBzdWNjZXNzOiByZXN1bHQuc3VjY2VzcyxcbiAgICAgIHRyYW5zYWN0aW9uOiByZXN1bHQudHJhbnNhY3Rpb24sXG4gICAgfSk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBsb2dnZXIuZXJyb3IoJ0Vycm9yIHNldHRsaW5nIHBheW1lbnQnLCBlcnJvciwge1xuICAgICAgZmFjaWxpdGF0b3JVcmw6IEZBQ0lMSVRBVE9SX1VSTCxcbiAgICB9KTtcbiAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLkZBQ0lMSVRBVE9SX0VSUk9SKTtcbiAgICAvLyBGYWlsIHByb3Blcmx5IC0gZG9uJ3QgZmFrZSBzZXR0bGVtZW50c1xuICAgIGxvZ2dlci5lcnJvcignRmFjaWxpdGF0b3IgdW5hdmFpbGFibGUgLSBzZXR0bGVtZW50IGZhaWxlZCcpO1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIHRyYW5zYWN0aW9uOiAnJyxcbiAgICAgIG5ldHdvcms6IHJlcXVpcmVtZW50cy5uZXR3b3JrLFxuICAgICAgcGF5ZXIsXG4gICAgICBlcnJvclJlYXNvbjogJ2ZhY2lsaXRhdG9yX3VuYXZhaWxhYmxlJyxcbiAgICB9O1xuICB9XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIDQwMiBQYXltZW50IFJlcXVpcmVkIHJlc3BvbnNlXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZTQwMlJlc3BvbnNlKFxuICB1cmk6IHN0cmluZyxcbiAgcmVxdWlyZW1lbnRzOiBQYXltZW50UmVxdWlyZW1lbnRzLFxuICBlcnJvck1lc3NhZ2U/OiBzdHJpbmdcbik6IENsb3VkRnJvbnRSZXF1ZXN0UmVzdWx0IHtcbiAgY29uc3QgcGF5bWVudFJlcXVpcmVkOiBQYXltZW50UmVxdWlyZWQgPSB7XG4gICAgeDQwMlZlcnNpb246IDIsXG4gICAgZXJyb3I6IGVycm9yTWVzc2FnZSB8fCAnUGF5bWVudCByZXF1aXJlZCB0byBhY2Nlc3MgdGhpcyByZXNvdXJjZScsXG4gICAgcmVzb3VyY2U6IHtcbiAgICAgIHVybDogdXJpLFxuICAgICAgZGVzY3JpcHRpb246IGBQcm90ZWN0ZWQgcmVzb3VyY2UgYXQgJHt1cml9YCxcbiAgICAgIG1pbWVUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgfSxcbiAgICBhY2NlcHRzOiBbcmVxdWlyZW1lbnRzXSxcbiAgICBleHRlbnNpb25zOiB7fSxcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIHN0YXR1czogJzQwMicsXG4gICAgc3RhdHVzRGVzY3JpcHRpb246ICdQYXltZW50IFJlcXVpcmVkJyxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnY29udGVudC10eXBlJzogW3sga2V5OiAnQ29udGVudC1UeXBlJywgdmFsdWU6ICdhcHBsaWNhdGlvbi9qc29uJyB9XSxcbiAgICAgICd4LXBheW1lbnQtcmVxdWlyZWQnOiBbe1xuICAgICAgICBrZXk6ICdYLVBBWU1FTlQtUkVRVUlSRUQnLFxuICAgICAgICB2YWx1ZTogQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkocGF5bWVudFJlcXVpcmVkKSkudG9TdHJpbmcoJ2Jhc2U2NCcpLFxuICAgICAgfV0sXG4gICAgICAnYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luJzogW3sga2V5OiAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgdmFsdWU6ICcqJyB9XSxcbiAgICAgICdhY2Nlc3MtY29udHJvbC1hbGxvdy1oZWFkZXJzJzogW3sgXG4gICAgICAgIGtleTogJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLCBcbiAgICAgICAgdmFsdWU6ICdDb250ZW50LVR5cGUsIFgtUGF5bWVudC1TaWduYXR1cmUnIFxuICAgICAgfV0sXG4gICAgICAnYWNjZXNzLWNvbnRyb2wtZXhwb3NlLWhlYWRlcnMnOiBbe1xuICAgICAgICBrZXk6ICdBY2Nlc3MtQ29udHJvbC1FeHBvc2UtSGVhZGVycycsXG4gICAgICAgIHZhbHVlOiAnWC1QQVlNRU5ULVJFUVVJUkVELCBYLVBBWU1FTlQtUkVTUE9OU0UnLFxuICAgICAgfV0sXG4gICAgfSxcbiAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICBlcnJvcjogJ1BheW1lbnQgUmVxdWlyZWQnLFxuICAgICAgbWVzc2FnZTogZXJyb3JNZXNzYWdlIHx8ICdUaGlzIGNvbnRlbnQgcmVxdWlyZXMgcGF5bWVudCB0byBhY2Nlc3MnLFxuICAgICAgeDQwMlZlcnNpb246IDIsXG4gICAgfSksXG4gIH07XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBlcnJvciByZXNwb25zZVxuICovXG5mdW5jdGlvbiBjcmVhdGVFcnJvclJlc3BvbnNlKFxuICBzdGF0dXM6IHN0cmluZyxcbiAgc3RhdHVzRGVzY3JpcHRpb246IHN0cmluZyxcbiAgZXJyb3I6IHN0cmluZyxcbiAgbWVzc2FnZTogc3RyaW5nXG4pOiBDbG91ZEZyb250UmVxdWVzdFJlc3VsdCB7XG4gIHJldHVybiB7XG4gICAgc3RhdHVzLFxuICAgIHN0YXR1c0Rlc2NyaXB0aW9uLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdjb250ZW50LXR5cGUnOiBbeyBrZXk6ICdDb250ZW50LVR5cGUnLCB2YWx1ZTogJ2FwcGxpY2F0aW9uL2pzb24nIH1dLFxuICAgICAgJ2FjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpbic6IFt7IGtleTogJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicsIHZhbHVlOiAnKicgfV0sXG4gICAgfSxcbiAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yLCBtZXNzYWdlIH0pLFxuICB9O1xufVxuXG4vKipcbiAqIENyZWF0ZXMgTUNQIHRvb2wgZGlzY292ZXJ5IHJlc3BvbnNlXG4gKiBSZXR1cm5zIGFsbCBhdmFpbGFibGUgc2VydmljZXMgd2l0aCB0aGVpciBwcmljaW5nIGFuZCBtZXRhZGF0YVxuICovXG5mdW5jdGlvbiBjcmVhdGVNQ1BEaXNjb3ZlcnlSZXNwb25zZShyZXF1ZXN0SWQ6IHN0cmluZyk6IENsb3VkRnJvbnRSZXF1ZXN0UmVzdWx0IHtcbiAgY29uc3QgdG9vbHMgPSBbXTtcbiAgXG4gIC8vIEdldCBhbGwgY29udGVudCBpdGVtcyBmcm9tIHRoZSByZWdpc3RyeVxuICBjb25zdCBwYXRocyA9IGNvbnRlbnRNYW5hZ2VyLmxpc3RDb250ZW50UGF0aHMoKTtcbiAgXG4gIGZvciAoY29uc3QgcGF0aCBvZiBwYXRocykge1xuICAgIGNvbnN0IGl0ZW0gPSBjb250ZW50TWFuYWdlci5nZXRDb250ZW50SXRlbShwYXRoKTtcbiAgICBpZiAoIWl0ZW0pIGNvbnRpbnVlO1xuICAgIFxuICAgIC8vIENvbnZlcnQgcGF0aCB0byB0b29sIG5hbWU6IC9hcGkvcHJlbWl1bS1hcnRpY2xlIC0+IGdldF9wcmVtaXVtX2FydGljbGVcbiAgICBjb25zdCB0b29sTmFtZSA9ICdnZXRfJyArIHBhdGgucmVwbGFjZSgnL2FwaS8nLCAnJykucmVwbGFjZSgvLS9nLCAnXycpO1xuICAgIFxuICAgIC8vIENhbGN1bGF0ZSBkaXNwbGF5IHByaWNlIChVU0RDIGhhcyA2IGRlY2ltYWxzKVxuICAgIGNvbnN0IGFtb3VudFVuaXRzID0gcGFyc2VJbnQoaXRlbS5wcmljaW5nLmFtb3VudCwgMTApO1xuICAgIGNvbnN0IGRpc3BsYXlQcmljZSA9IChhbW91bnRVbml0cyAvIDEwMDAwMDApLnRvRml4ZWQoNikucmVwbGFjZSgvXFwuPzArJC8sICcnKTtcbiAgICBcbiAgICB0b29scy5wdXNoKHtcbiAgICAgIHRvb2xfbmFtZTogdG9vbE5hbWUsXG4gICAgICB0b29sX2Rlc2NyaXB0aW9uOiBgJHtpdGVtLmRlc2NyaXB0aW9ufS4gUmVxdWlyZXMgeDQwMiBwYXltZW50OiAke2l0ZW0ucHJpY2luZy5hbW91bnR9IFVTREMgdW5pdHMgKCR7ZGlzcGxheVByaWNlfSBVU0RDKSBvbiBCYXNlIFNlcG9saWEgdGVzdG5ldC5gLFxuICAgICAgb3BlcmF0aW9uX2lkOiB0b29sTmFtZSxcbiAgICAgIGVuZHBvaW50X3BhdGg6IHBhdGgsXG4gICAgICBtY3BfbWV0YWRhdGE6IHtcbiAgICAgICAgY2F0ZWdvcnk6IHBhdGguaW5jbHVkZXMoJ21hcmtldCcpIHx8IHBhdGguaW5jbHVkZXMoJ3dlYXRoZXInKSA/ICdtYXJrZXQtZGF0YScgOiBcbiAgICAgICAgICAgICAgICAgIHBhdGguaW5jbHVkZXMoJ3Jlc2VhcmNoJykgfHwgcGF0aC5pbmNsdWRlcygnZGF0YXNldCcpID8gJ3Jlc2VhcmNoJyA6ICdjb250ZW50JyxcbiAgICAgICAgdGFnczogWyd4NDAyLXBheW1lbnQnLCAncHJlbWl1bS1jb250ZW50J10sXG4gICAgICAgIHByaW9yaXR5OiAxLFxuICAgICAgICByZXF1aXJlc19wYXltZW50OiB0cnVlLFxuICAgICAgICBlc3RpbWF0ZWRfbGF0ZW5jeV9tczogMjAwMCxcbiAgICAgIH0sXG4gICAgICB4NDAyX21ldGFkYXRhOiB7XG4gICAgICAgIHByaWNlX3VzZGNfdW5pdHM6IGl0ZW0ucHJpY2luZy5hbW91bnQsXG4gICAgICAgIHByaWNlX3VzZGNfZGlzcGxheTogYCR7ZGlzcGxheVByaWNlfSBVU0RDYCxcbiAgICAgICAgbmV0d29yazogaXRlbS5wcmljaW5nLm5ldHdvcmssXG4gICAgICAgIG5ldHdvcmtfbmFtZTogJ0Jhc2UgU2Vwb2xpYScsXG4gICAgICAgIHNjaGVtZTogaXRlbS5wcmljaW5nLnNjaGVtZSxcbiAgICAgICAgYXNzZXRfYWRkcmVzczogaXRlbS5wcmljaW5nLmFzc2V0LFxuICAgICAgICBhc3NldF9uYW1lOiAnVVNEQycsXG4gICAgICAgIHRpbWVvdXRfc2Vjb25kczogaXRlbS5wcmljaW5nLm1heFRpbWVvdXRTZWNvbmRzLFxuICAgICAgfSxcbiAgICAgIGlucHV0X3NjaGVtYToge1xuICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgcHJvcGVydGllczoge30sXG4gICAgICAgIHJlcXVpcmVkOiBbXSxcbiAgICAgICAgZGVzY3JpcHRpb246ICdObyBpbnB1dCBwYXJhbWV0ZXJzIHJlcXVpcmVkLiBQYXltZW50IGlzIGhhbmRsZWQgdmlhIHg0MDIgaGVhZGVycy4nLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuICBcbiAgY29uc3QgcmVzcG9uc2UgPSB7XG4gICAgdmVyc2lvbjogJzEuMCcsXG4gICAgdG9vbHMsXG4gICAgbWV0YWRhdGE6IHtcbiAgICAgIGdhdGV3YXk6ICd4NDAyLXNlbGxlci1nYXRld2F5JyxcbiAgICAgIHByb3RvY29sOiAneDQwMi12MicsXG4gICAgICBuZXR3b3JrOiAnYmFzZS1zZXBvbGlhJyxcbiAgICAgIHRvdGFsX3NlcnZpY2VzOiB0b29scy5sZW5ndGgsXG4gICAgfSxcbiAgfTtcbiAgXG4gIHJldHVybiB7XG4gICAgc3RhdHVzOiAnMjAwJyxcbiAgICBzdGF0dXNEZXNjcmlwdGlvbjogJ09LJyxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnY29udGVudC10eXBlJzogW3sga2V5OiAnQ29udGVudC1UeXBlJywgdmFsdWU6ICdhcHBsaWNhdGlvbi9qc29uJyB9XSxcbiAgICAgICd4LXJlcXVlc3QtaWQnOiBbeyBrZXk6ICdYLVJlcXVlc3QtSWQnLCB2YWx1ZTogcmVxdWVzdElkIH1dLFxuICAgICAgJ2FjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpbic6IFt7IGtleTogJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicsIHZhbHVlOiAnKicgfV0sXG4gICAgICAnYWNjZXNzLWNvbnRyb2wtYWxsb3ctaGVhZGVycyc6IFt7IFxuICAgICAgICBrZXk6ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJywgXG4gICAgICAgIHZhbHVlOiAnQ29udGVudC1UeXBlLCBBY2NlcHQnIFxuICAgICAgfV0sXG4gICAgICAnY2FjaGUtY29udHJvbCc6IFt7IGtleTogJ0NhY2hlLUNvbnRyb2wnLCB2YWx1ZTogJ3B1YmxpYywgbWF4LWFnZT0zMDAnIH1dLFxuICAgIH0sXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxuICB9O1xufVxuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChcbiAgZXZlbnQ6IENsb3VkRnJvbnRSZXF1ZXN0RXZlbnRcbik6IFByb21pc2U8Q2xvdWRGcm9udFJlcXVlc3RSZXN1bHQ+ID0+IHtcbiAgY29uc3QgcmVxdWVzdCA9IGV2ZW50LlJlY29yZHNbMF0uY2YucmVxdWVzdDtcbiAgY29uc3QgdXJpID0gcmVxdWVzdC51cmk7XG4gIFxuICAvLyBJbml0aWFsaXplIGxvZ2dlciB3aXRoIHJlcXVlc3QgSUQgZm9yIHRyYWNpbmdcbiAgY29uc3QgcmVxdWVzdElkID0gZ2VuZXJhdGVSZXF1ZXN0SWQoKTtcbiAgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcihyZXF1ZXN0SWQsIHVyaSk7XG4gIFxuICAvLyBSZWNvcmQgcmVxdWVzdCBtZXRyaWNcbiAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5SRVFVRVNUX0NPVU5UKTtcbiAgbG9nZ2VyLmluZm8oJ1Byb2Nlc3NpbmcgcmVxdWVzdCcsIHsgbWV0aG9kOiByZXF1ZXN0Lm1ldGhvZCB9KTtcblxuICB0cnkge1xuICAgIC8vIEhhbmRsZSBNQ1AgZGlzY292ZXJ5IGVuZHBvaW50IChubyBwYXltZW50IHJlcXVpcmVkKVxuICAgIGlmICh1cmkgPT09ICcvbWNwL3Rvb2xzJykge1xuICAgICAgbG9nZ2VyLmluZm8oJ01DUCBkaXNjb3ZlcnkgcmVxdWVzdCcpO1xuICAgICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLkxBVEVOQ1ksIGxvZ2dlci5nZXRFbGFwc2VkTXMoKSk7XG4gICAgICBsb2dnZXIuZW1pdE1ldHJpY3MoKTtcbiAgICAgIHJldHVybiBjcmVhdGVNQ1BEaXNjb3ZlcnlSZXNwb25zZShyZXF1ZXN0SWQpO1xuICAgIH1cbiAgICBcbiAgICAvLyBDaGVjayBpZiB0aGlzIHBhdGggcmVxdWlyZXMgcGF5bWVudCB1c2luZyBkeW5hbWljIGNvbnRlbnQgbWFuYWdlclxuICAgIGNvbnN0IHBheW1lbnRSZXF1aXJlbWVudCA9IGNvbnRlbnRNYW5hZ2VyLmdldFBheW1lbnRSZXF1aXJlbWVudHModXJpKTtcbiAgICBcbiAgICBpZiAoIXBheW1lbnRSZXF1aXJlbWVudCkge1xuICAgICAgLy8gTm8gcGF5bWVudCByZXF1aXJlZCBmb3IgdGhpcyBwYXRoXG4gICAgICBsb2dnZXIuZGVidWcoJ05vIHBheW1lbnQgcmVxdWlyZWQgZm9yIHBhdGgnKTtcbiAgICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgICAgbG9nZ2VyLmVtaXRNZXRyaWNzKCk7XG4gICAgICByZXR1cm4gcmVxdWVzdDtcbiAgICB9XG5cbiAgICBsb2dnZXIuc2V0RGltZW5zaW9uKCdOZXR3b3JrJywgcGF5bWVudFJlcXVpcmVtZW50Lm5ldHdvcmspO1xuICAgIGxvZ2dlci5zZXREaW1lbnNpb24oJ0Fzc2V0JywgcGF5bWVudFJlcXVpcmVtZW50LmFzc2V0KTtcblxuICAgIC8vIENoZWNrIGZvciBwYXltZW50IHNpZ25hdHVyZSBoZWFkZXIgKHg0MDIgdjIgdXNlcyBYLVBBWU1FTlQtU0lHTkFUVVJFKVxuICAgIGNvbnN0IHBheW1lbnRTaWduYXR1cmVIZWFkZXIgPSBcbiAgICAgIHJlcXVlc3QuaGVhZGVyc1sneC1wYXltZW50LXNpZ25hdHVyZSddIHx8IFxuICAgICAgcmVxdWVzdC5oZWFkZXJzWydwYXltZW50LXNpZ25hdHVyZSddO1xuICAgIFxuICAgIGlmICghcGF5bWVudFNpZ25hdHVyZUhlYWRlciB8fCAhcGF5bWVudFNpZ25hdHVyZUhlYWRlclswXSkge1xuICAgICAgLy8gTm8gcGF5bWVudCBwcm92aWRlZCAtIHJldHVybiA0MDIgUGF5bWVudCBSZXF1aXJlZFxuICAgICAgbG9nZ2VyLmluZm8oJ05vIHBheW1lbnQgc2lnbmF0dXJlIGZvdW5kLCByZXR1cm5pbmcgNDAyJywge1xuICAgICAgICByZXF1aXJlZEFtb3VudDogcGF5bWVudFJlcXVpcmVtZW50LmFtb3VudCxcbiAgICAgIH0pO1xuICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5QQVlNRU5UX1JFUVVJUkVEKTtcbiAgICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgICAgbG9nZ2VyLmVtaXRNZXRyaWNzKCk7XG4gICAgICByZXR1cm4gY3JlYXRlNDAyUmVzcG9uc2UodXJpLCBwYXltZW50UmVxdWlyZW1lbnQpO1xuICAgIH1cblxuICAgIC8vIFBheW1lbnQgc2lnbmF0dXJlIHByZXNlbnRcbiAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlBBWU1FTlRfUkVDRUlWRUQpO1xuXG4gICAgLy8gRGVjb2RlIGFuZCB2ZXJpZnkgcGF5bWVudFxuICAgIGNvbnN0IHBheW1lbnRQYXlsb2FkQmFzZTY0ID0gcGF5bWVudFNpZ25hdHVyZUhlYWRlclswXS52YWx1ZTtcbiAgICBsZXQgcGF5bWVudFBheWxvYWQ6IHVua25vd247XG4gICAgXG4gICAgdHJ5IHtcbiAgICAgIHBheW1lbnRQYXlsb2FkID0gSlNPTi5wYXJzZShcbiAgICAgICAgQnVmZmVyLmZyb20ocGF5bWVudFBheWxvYWRCYXNlNjQsICdiYXNlNjQnKS50b1N0cmluZygndXRmLTgnKVxuICAgICAgKTtcbiAgICB9IGNhdGNoIChkZWNvZGVFcnJvcikge1xuICAgICAgbG9nZ2VyLndhcm4oJ0ZhaWxlZCB0byBkZWNvZGUgcGF5bWVudCBwYXlsb2FkJywge1xuICAgICAgICBlcnJvckNvZGU6ICdERUNPREVfRVJST1InLFxuICAgICAgfSk7XG4gICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlZBTElEQVRJT05fRVJST1IpO1xuICAgICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLkxBVEVOQ1ksIGxvZ2dlci5nZXRFbGFwc2VkTXMoKSk7XG4gICAgICBsb2dnZXIuZW1pdE1ldHJpY3MoKTtcbiAgICAgIHJldHVybiBjcmVhdGU0MDJSZXNwb25zZShcbiAgICAgICAgdXJpLCBcbiAgICAgICAgcGF5bWVudFJlcXVpcmVtZW50LCBcbiAgICAgICAgJ0ludmFsaWQgcGF5bWVudCBwYXlsb2FkIGVuY29kaW5nJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICBsb2dnZXIuZGVidWcoJ1BheW1lbnQgcGF5bG9hZCBkZWNvZGVkIHN1Y2Nlc3NmdWxseScpO1xuXG4gICAgLy8gVmFsaWRhdGUgcGF5bG9hZCBzdHJ1Y3R1cmVcbiAgICBpZiAoIXZhbGlkYXRlUGF5bG9hZFN0cnVjdHVyZShwYXltZW50UGF5bG9hZCkpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdJbnZhbGlkIHBheW1lbnQgcGF5bG9hZCBzdHJ1Y3R1cmUnLCB7XG4gICAgICAgIGVycm9yQ29kZTogJ0lOVkFMSURfU1RSVUNUVVJFJyxcbiAgICAgIH0pO1xuICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5WQUxJREFUSU9OX0VSUk9SKTtcbiAgICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgICAgbG9nZ2VyLmVtaXRNZXRyaWNzKCk7XG4gICAgICByZXR1cm4gY3JlYXRlRXJyb3JSZXNwb25zZShcbiAgICAgICAgJzQwMCcsXG4gICAgICAgICdCYWQgUmVxdWVzdCcsXG4gICAgICAgICdJbnZhbGlkIFBheW1lbnQnLFxuICAgICAgICAnUGF5bWVudCBwYXlsb2FkIHN0cnVjdHVyZSBpcyBpbnZhbGlkJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBFeHRyYWN0IHBheWVyIGFkZHJlc3MgZm9yIGxvZ2dpbmdcbiAgICBjb25zdCBwYXllciA9IHBheW1lbnRQYXlsb2FkLnBheWxvYWQuYXV0aG9yaXphdGlvbi5mcm9tO1xuICAgIGxvZ2dlci5zZXREaW1lbnNpb24oJ1BheWVyJywgcGF5ZXIuc3Vic3RyaW5nKDAsIDEwKSArICcuLi4nKTtcbiAgICBsb2dnZXIuaW5mbygnUGF5bWVudCBwYXlsb2FkIHZhbGlkYXRlZCcsIHtcbiAgICAgIHBheWVyLFxuICAgICAgYW1vdW50OiBwYXltZW50UGF5bG9hZC5hY2NlcHRlZC5hbW91bnQsXG4gICAgICBzY2hlbWU6IHBheW1lbnRQYXlsb2FkLmFjY2VwdGVkLnNjaGVtZSxcbiAgICB9KTtcblxuICAgIC8vIFZhbGlkYXRlIGF1dGhvcml6YXRpb24gcGFyYW1ldGVyc1xuICAgIGNvbnN0IHBhcmFtVmFsaWRhdGlvbiA9IHZhbGlkYXRlQXV0aG9yaXphdGlvblBhcmFtZXRlcnMoXG4gICAgICBwYXltZW50UGF5bG9hZCxcbiAgICAgIHBheW1lbnRSZXF1aXJlbWVudFxuICAgICk7XG4gICAgXG4gICAgaWYgKCFwYXJhbVZhbGlkYXRpb24uaXNWYWxpZCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ1BheW1lbnQgcGFyYW1ldGVyIHZhbGlkYXRpb24gZmFpbGVkJywge1xuICAgICAgICBlcnJvckNvZGU6IHBhcmFtVmFsaWRhdGlvbi5pbnZhbGlkUmVhc29uLFxuICAgICAgICBwYXllcixcbiAgICAgIH0pO1xuICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5WQUxJREFUSU9OX0VSUk9SKTtcbiAgICAgIFxuICAgICAgLy8gUmVjb3JkIHNwZWNpZmljIHZhbGlkYXRpb24gZXJyb3IgbWV0cmljc1xuICAgICAgc3dpdGNoIChwYXJhbVZhbGlkYXRpb24uaW52YWxpZFJlYXNvbikge1xuICAgICAgICBjYXNlICdpbnZhbGlkX2V4YWN0X2V2bV9wYXlsb2FkX2F1dGhvcml6YXRpb25fdmFsaWRfYmVmb3JlJzpcbiAgICAgICAgY2FzZSAnaW52YWxpZF9leGFjdF9ldm1fcGF5bG9hZF9hdXRob3JpemF0aW9uX3ZhbGlkX2FmdGVyJzpcbiAgICAgICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLkFVVEhPUklaQVRJT05fRVhQSVJFRCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2ludmFsaWRfc2lnbmF0dXJlX2Zvcm1hdCc6XG4gICAgICAgIGNhc2UgJ2ludmFsaWRfc2lnbmF0dXJlX2xlbmd0aCc6XG4gICAgICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5TSUdOQVRVUkVfSU5WQUxJRCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2ludmFsaWRfZXhhY3RfZXZtX3BheWxvYWRfYXV0aG9yaXphdGlvbl92YWx1ZSc6XG4gICAgICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5BTU9VTlRfSU5TVUZGSUNJRU5UKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnbmV0d29ya19taXNtYXRjaCc6XG4gICAgICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5ORVRXT1JLX01JU01BVENIKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnYXNzZXRfbWlzbWF0Y2gnOlxuICAgICAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuQVNTRVRfTUlTTUFUQ0gpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgXG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgICAgcmV0dXJuIGNyZWF0ZTQwMlJlc3BvbnNlKFxuICAgICAgICB1cmksXG4gICAgICAgIHBheW1lbnRSZXF1aXJlbWVudCxcbiAgICAgICAgYFBheW1lbnQgdmFsaWRhdGlvbiBmYWlsZWQ6ICR7cGFyYW1WYWxpZGF0aW9uLmludmFsaWRSZWFzb259YFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBsb2dnZXIuZGVidWcoJ0F1dGhvcml6YXRpb24gcGFyYW1ldGVycyB2YWxpZGF0ZWQnKTtcblxuICAgIC8vIFZlcmlmeSBzaWduYXR1cmUgd2l0aCBmYWNpbGl0YXRvclxuICAgIGNvbnN0IHZlcmlmaWNhdGlvblN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgY29uc3Qgc2lnbmF0dXJlVmFsaWRhdGlvbiA9IGF3YWl0IHZlcmlmeVNpZ25hdHVyZVdpdGhGYWNpbGl0YXRvcihcbiAgICAgIHBheW1lbnRQYXlsb2FkLFxuICAgICAgcGF5bWVudFJlcXVpcmVtZW50LFxuICAgICAgbG9nZ2VyXG4gICAgKTtcbiAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuVkVSSUZJQ0FUSU9OX0xBVEVOQ1ksIERhdGUubm93KCkgLSB2ZXJpZmljYXRpb25TdGFydFRpbWUpO1xuICAgIFxuICAgIGlmICghc2lnbmF0dXJlVmFsaWRhdGlvbi5pc1ZhbGlkKSB7XG4gICAgICBsb2dnZXIud2FybignU2lnbmF0dXJlIHZlcmlmaWNhdGlvbiBmYWlsZWQnLCB7XG4gICAgICAgIGVycm9yQ29kZTogc2lnbmF0dXJlVmFsaWRhdGlvbi5pbnZhbGlkUmVhc29uLFxuICAgICAgICBwYXllcixcbiAgICAgIH0pO1xuICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5QQVlNRU5UX0ZBSUxFRCk7XG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgICAgcmV0dXJuIGNyZWF0ZTQwMlJlc3BvbnNlKFxuICAgICAgICB1cmksXG4gICAgICAgIHBheW1lbnRSZXF1aXJlbWVudCxcbiAgICAgICAgYFNpZ25hdHVyZSB2ZXJpZmljYXRpb24gZmFpbGVkOiAke3NpZ25hdHVyZVZhbGlkYXRpb24uaW52YWxpZFJlYXNvbn1gXG4gICAgICApO1xuICAgIH1cblxuICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuUEFZTUVOVF9WRVJJRklFRCk7XG4gICAgbG9nZ2VyLmluZm8oJ1BheW1lbnQgc2lnbmF0dXJlIHZlcmlmaWVkJywgeyBwYXllciB9KTtcblxuICAgIC8vIFNldHRsZSBwYXltZW50IHdpdGggZmFjaWxpdGF0b3JcbiAgICBjb25zdCBzZXR0bGVtZW50U3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCBzZXR0bGVtZW50ID0gYXdhaXQgc2V0dGxlUGF5bWVudFdpdGhGYWNpbGl0YXRvcihcbiAgICAgIHBheW1lbnRQYXlsb2FkLFxuICAgICAgcGF5bWVudFJlcXVpcmVtZW50LFxuICAgICAgbG9nZ2VyXG4gICAgKTtcbiAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuU0VUVExFTUVOVF9MQVRFTkNZLCBEYXRlLm5vdygpIC0gc2V0dGxlbWVudFN0YXJ0VGltZSk7XG4gICAgXG4gICAgaWYgKCFzZXR0bGVtZW50LnN1Y2Nlc3MpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignUGF5bWVudCBzZXR0bGVtZW50IGZhaWxlZCcsIHVuZGVmaW5lZCwge1xuICAgICAgICBlcnJvckNvZGU6IHNldHRsZW1lbnQuZXJyb3JSZWFzb24sXG4gICAgICAgIHBheWVyLFxuICAgICAgfSk7XG4gICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlBBWU1FTlRfRkFJTEVEKTtcbiAgICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgICAgbG9nZ2VyLmVtaXRNZXRyaWNzKCk7XG4gICAgICByZXR1cm4gY3JlYXRlRXJyb3JSZXNwb25zZShcbiAgICAgICAgJzQwMicsXG4gICAgICAgICdQYXltZW50IFJlcXVpcmVkJyxcbiAgICAgICAgJ1NldHRsZW1lbnQgRmFpbGVkJyxcbiAgICAgICAgYFBheW1lbnQgc2V0dGxlbWVudCBmYWlsZWQ6ICR7c2V0dGxlbWVudC5lcnJvclJlYXNvbn1gXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIFBheW1lbnQgdmVyaWZpZWQgYW5kIHNldHRsZWQgLSByZXR1cm4gZHluYW1pYyBjb250ZW50XG4gICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5QQVlNRU5UX1NFVFRMRUQpO1xuICAgIFxuICAgIC8vIFJlY29yZCBwYXltZW50IGFtb3VudCBtZXRyaWNcbiAgICB0cnkge1xuICAgICAgY29uc3QgYW1vdW50V2VpID0gQmlnSW50KHBheW1lbnRQYXlsb2FkLnBheWxvYWQuYXV0aG9yaXphdGlvbi52YWx1ZSk7XG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuUEFZTUVOVF9BTU9VTlRfV0VJLCBOdW1iZXIoYW1vdW50V2VpKSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBJZ25vcmUgaWYgYW1vdW50IHBhcnNpbmcgZmFpbHNcbiAgICB9XG4gICAgXG4gICAgbG9nZ2VyLmluZm8oJ1BheW1lbnQgc2V0dGxlZCBzdWNjZXNzZnVsbHknLCB7XG4gICAgICBwYXllcixcbiAgICAgIHRyYW5zYWN0aW9uSGFzaDogc2V0dGxlbWVudC50cmFuc2FjdGlvbixcbiAgICAgIGFtb3VudDogcGF5bWVudFJlcXVpcmVtZW50LmFtb3VudCxcbiAgICAgIG5ldHdvcms6IHBheW1lbnRSZXF1aXJlbWVudC5uZXR3b3JrLFxuICAgIH0pO1xuXG4gICAgLy8gR2V0IGR5bmFtaWMgY29udGVudCBmcm9tIGNvbnRlbnQgbWFuYWdlclxuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBjb250ZW50TWFuYWdlci5nZXRDb250ZW50KHVyaSk7XG4gICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5DT05URU5UX0dFTkVSQVRFRCk7XG4gICAgXG4gICAgLy8gUmVjb3JkIGNvbnRlbnQgc2l6ZSBtZXRyaWNcbiAgICBjb25zdCBjb250ZW50SnNvbiA9IEpTT04uc3RyaW5naWZ5KGNvbnRlbnQpO1xuICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5DT05URU5UX0JZVEVTX1NFUlZFRCwgY29udGVudEpzb24ubGVuZ3RoKTtcbiAgICBcbiAgICAvLyBDcmVhdGUgc2V0dGxlbWVudCByZXNwb25zZSBoZWFkZXJcbiAgICBjb25zdCBzZXR0bGVtZW50UmVzcG9uc2U6IFNldHRsZW1lbnRSZXNwb25zZSA9IHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICB0cmFuc2FjdGlvbjogc2V0dGxlbWVudC50cmFuc2FjdGlvbixcbiAgICAgIG5ldHdvcms6IHBheW1lbnRSZXF1aXJlbWVudC5uZXR3b3JrLFxuICAgICAgcGF5ZXI6IHBheW1lbnRQYXlsb2FkLnBheWxvYWQuYXV0aG9yaXphdGlvbi5mcm9tLFxuICAgIH07XG5cbiAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICBsb2dnZXIuZW1pdE1ldHJpY3MoKTtcblxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXM6ICcyMDAnLFxuICAgICAgc3RhdHVzRGVzY3JpcHRpb246ICdPSycsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdjb250ZW50LXR5cGUnOiBbeyBrZXk6ICdDb250ZW50LVR5cGUnLCB2YWx1ZTogJ2FwcGxpY2F0aW9uL2pzb24nIH1dLFxuICAgICAgICAneC1wYXltZW50LXJlc3BvbnNlJzogW3tcbiAgICAgICAgICBrZXk6ICdYLVBBWU1FTlQtUkVTUE9OU0UnLFxuICAgICAgICAgIHZhbHVlOiBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShzZXR0bGVtZW50UmVzcG9uc2UpKS50b1N0cmluZygnYmFzZTY0JyksXG4gICAgICAgIH1dLFxuICAgICAgICAneC1yZXF1ZXN0LWlkJzogW3sga2V5OiAnWC1SZXF1ZXN0LUlkJywgdmFsdWU6IHJlcXVlc3RJZCB9XSxcbiAgICAgICAgJ2FjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpbic6IFt7IGtleTogJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicsIHZhbHVlOiAnKicgfV0sXG4gICAgICAgICdhY2Nlc3MtY29udHJvbC1hbGxvdy1oZWFkZXJzJzogW3sgXG4gICAgICAgICAga2V5OiAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycycsIFxuICAgICAgICAgIHZhbHVlOiAnQ29udGVudC1UeXBlLCBYLVBheW1lbnQtU2lnbmF0dXJlJyBcbiAgICAgICAgfV0sXG4gICAgICAgICdhY2Nlc3MtY29udHJvbC1leHBvc2UtaGVhZGVycyc6IFt7IFxuICAgICAgICAgIGtleTogJ0FjY2Vzcy1Db250cm9sLUV4cG9zZS1IZWFkZXJzJywgXG4gICAgICAgICAgdmFsdWU6ICdYLVBBWU1FTlQtUkVTUE9OU0UsIFgtUmVxdWVzdC1JZCcgXG4gICAgICAgIH1dLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGNvbnRlbnQpLFxuICAgIH07XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgbG9nZ2VyLmVycm9yKCdVbmV4cGVjdGVkIGVycm9yIHByb2Nlc3NpbmcgcGF5bWVudCcsIGVycm9yKTtcbiAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlBBWU1FTlRfRkFJTEVEKTtcbiAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICBsb2dnZXIuZW1pdE1ldHJpY3MoKTtcbiAgICByZXR1cm4gY3JlYXRlRXJyb3JSZXNwb25zZShcbiAgICAgICc1MDAnLFxuICAgICAgJ0ludGVybmFsIFNlcnZlciBFcnJvcicsXG4gICAgICAnUGF5bWVudCBQcm9jZXNzaW5nIEVycm9yJyxcbiAgICAgICdGYWlsZWQgdG8gcHJvY2VzcyBwYXltZW50J1xuICAgICk7XG4gIH1cbn07XG4iXX0=