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
const FACILITATOR_URL = 'https://x402.org/facilitator';
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF5bWVudC12ZXJpZmllci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInBheW1lbnQtdmVyaWZpZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsbUNBVWlCO0FBQ2pCLHFEQUFrRDtBQUVsRCwrRUFBK0U7QUFDL0UscUNBQXFDO0FBQ3JDLCtFQUErRTtBQUMvRSxNQUFNLE1BQU07SUFPVixZQUFZLFNBQWlCLEVBQUUsR0FBVztRQUN4QyxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztRQUMzQixJQUFJLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQztRQUNmLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUN6QixJQUFJLENBQUMsVUFBVSxHQUFHO1lBQ2hCLEdBQUcsRUFBRSxHQUFHO1lBQ1IsV0FBVyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLFlBQVk7U0FDckQsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNLLGNBQWMsQ0FDcEIsS0FBZSxFQUNmLE9BQWUsRUFDZixLQUErQjtRQUUvQixPQUFPO1lBQ0wsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1lBQ25DLEtBQUs7WUFDTCxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVM7WUFDekIsT0FBTztZQUNQLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRztZQUNiLFVBQVUsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVM7WUFDdkMsR0FBRyxLQUFLO1NBQ1QsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxPQUFlLEVBQUUsS0FBK0I7UUFDcEQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxnQkFBUSxDQUFDLEtBQUssRUFBRSxPQUFP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LE1BQU0sQ0FBQyxLQUFLLENBQUMscUNBQXFDLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDM0QsTUFBTSxDQUFDLGdCQUFnQixDQUFDLGtCQUFVLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDbkQsTUFBTSxDQUFDLFlBQVksQ0FBQyxrQkFBVSxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUMsQ0FBQztRQUMvRCxNQUFNLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDckIsT0FBTyxtQkFBbUIsQ0FDeEIsS0FBSyxFQUNMLHVCQUF1QixFQUN2QiwwQkFBMEIsRUFDMUIsMkJBQTJCLENBQzVCLENBQUM7SUFDSixDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBalJXLFFBQUEsT0FBTyxXQWlSbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDbG91ZEZyb250UmVxdWVzdEV2ZW50LCBDbG91ZEZyb250UmVxdWVzdFJlc3VsdCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHtcbiAgTG9nTGV2ZWwsXG4gIE1ldHJpY05hbWUsXG4gIExvZ0VudHJ5LFxuICBFTUZNZXRyaWMsXG4gIFBheW1lbnRSZXF1aXJlbWVudHMsXG4gIFBheW1lbnRSZXF1aXJlZCxcbiAgUGF5bWVudFBheWxvYWQsXG4gIFZlcmlmeVJlc3BvbnNlLFxuICBTZXR0bGVtZW50UmVzcG9uc2UsXG59IGZyb20gJy4vdHlwZXMnO1xuaW1wb3J0IHsgY29udGVudE1hbmFnZXIgfSBmcm9tICcuL2NvbnRlbnQtY29uZmlnJztcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTG9nZ2luZyBhbmQgTWV0cmljcyBJbmZyYXN0cnVjdHVyZVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuY2xhc3MgTG9nZ2VyIHtcbiAgcHJpdmF0ZSByZXF1ZXN0SWQ6IHN0cmluZztcbiAgcHJpdmF0ZSB1cmk6IHN0cmluZztcbiAgcHJpdmF0ZSBzdGFydFRpbWU6IG51bWJlcjtcbiAgcHJpdmF0ZSBtZXRyaWNzOiBNYXA8c3RyaW5nLCBudW1iZXI+O1xuICBwcml2YXRlIGRpbWVuc2lvbnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG5cbiAgY29uc3RydWN0b3IocmVxdWVzdElkOiBzdHJpbmcsIHVyaTogc3RyaW5nKSB7XG4gICAgdGhpcy5yZXF1ZXN0SWQgPSByZXF1ZXN0SWQ7XG4gICAgdGhpcy51cmkgPSB1cmk7XG4gICAgdGhpcy5zdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIHRoaXMubWV0cmljcyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLmRpbWVuc2lvbnMgPSB7XG4gICAgICBVcmk6IHVyaSxcbiAgICAgIEVudmlyb25tZW50OiBwcm9jZXNzLmVudi5FTlZJUk9OTUVOVCB8fCAncHJvZHVjdGlvbicsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgc3RydWN0dXJlZCBsb2cgZW50cnlcbiAgICovXG4gIHByaXZhdGUgY3JlYXRlTG9nRW50cnkoXG4gICAgbGV2ZWw6IExvZ0xldmVsLFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICBleHRyYT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gICk6IExvZ0VudHJ5IHtcbiAgICByZXR1cm4ge1xuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBsZXZlbCxcbiAgICAgIHJlcXVlc3RJZDogdGhpcy5yZXF1ZXN0SWQsXG4gICAgICBtZXNzYWdlLFxuICAgICAgdXJpOiB0aGlzLnVyaSxcbiAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSB0aGlzLnN0YXJ0VGltZSxcbiAgICAgIC4uLmV4dHJhLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhIGRlYnVnIG1lc3NhZ2VcbiAgICovXG4gIGRlYnVnKG1lc3NhZ2U6IHN0cmluZywgZXh0cmE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5jcmVhdGVMb2dFbnRyeShMb2dMZXZlbC5ERUJVRywgbWVzc2FnZSwgZXh0cmEpO1xuICAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KGVudHJ5KSk7XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhbiBpbmZvIG1lc3NhZ2VcbiAgICovXG4gIGluZm8obWVzc2FnZTogc3RyaW5nLCBleHRyYT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmNyZWF0ZUxvZ0VudHJ5KExvZ0xldmVsLklORk8sIG1lc3NhZ2UsIGV4dHJhKTtcbiAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShlbnRyeSkpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgYSB3YXJuaW5nIG1lc3NhZ2VcbiAgICovXG4gIHdhcm4obWVzc2FnZTogc3RyaW5nLCBleHRyYT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmNyZWF0ZUxvZ0VudHJ5KExvZ0xldmVsLldBUk4sIG1lc3NhZ2UsIGV4dHJhKTtcbiAgICBjb25zb2xlLndhcm4oSlNPTi5zdHJpbmdpZnkoZW50cnkpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dzIGFuIGVycm9yIG1lc3NhZ2VcbiAgICovXG4gIGVycm9yKG1lc3NhZ2U6IHN0cmluZywgZXJyb3I/OiBFcnJvciB8IHVua25vd24sIGV4dHJhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkIHtcbiAgICBjb25zdCBlcnJvckRldGFpbHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0geyAuLi5leHRyYSB9O1xuICAgIFxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICBlcnJvckRldGFpbHMuZXJyb3JNZXNzYWdlID0gZXJyb3IubWVzc2FnZTtcbiAgICAgIGVycm9yRGV0YWlscy5lcnJvclN0YWNrID0gZXJyb3Iuc3RhY2s7XG4gICAgfSBlbHNlIGlmIChlcnJvcikge1xuICAgICAgZXJyb3JEZXRhaWxzLmVycm9yTWVzc2FnZSA9IFN0cmluZyhlcnJvcik7XG4gICAgfVxuICAgIFxuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5jcmVhdGVMb2dFbnRyeShMb2dMZXZlbC5FUlJPUiwgbWVzc2FnZSwgZXJyb3JEZXRhaWxzKTtcbiAgICBjb25zb2xlLmVycm9yKEpTT04uc3RyaW5naWZ5KGVudHJ5KSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIG1ldHJpYyB2YWx1ZVxuICAgKi9cbiAgcmVjb3JkTWV0cmljKG5hbWU6IE1ldHJpY05hbWUsIHZhbHVlOiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLm1ldHJpY3Muc2V0KG5hbWUsIHZhbHVlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbmNyZW1lbnRzIGEgY291bnRlciBtZXRyaWNcbiAgICovXG4gIGluY3JlbWVudENvdW50ZXIobmFtZTogTWV0cmljTmFtZSk6IHZvaWQge1xuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLm1ldHJpY3MuZ2V0KG5hbWUpIHx8IDA7XG4gICAgdGhpcy5tZXRyaWNzLnNldChuYW1lLCBjdXJyZW50ICsgMSk7XG4gIH1cblxuICAvKipcbiAgICogU2V0cyBhIGRpbWVuc2lvbiBmb3IgbWV0cmljc1xuICAgKi9cbiAgc2V0RGltZW5zaW9uKGtleTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy5kaW1lbnNpb25zW2tleV0gPSB2YWx1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBhbGwgcmVjb3JkZWQgbWV0cmljcyBpbiBDbG91ZFdhdGNoIEVNRiBmb3JtYXRcbiAgICovXG4gIGVtaXRNZXRyaWNzKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLm1ldHJpY3Muc2l6ZSA9PT0gMCkgcmV0dXJuO1xuXG4gICAgY29uc3QgbWV0cmljc0FycmF5OiBBcnJheTx7IE5hbWU6IHN0cmluZzsgVW5pdDogc3RyaW5nIH0+ID0gW107XG4gICAgY29uc3QgbWV0cmljVmFsdWVzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG5cbiAgICB0aGlzLm1ldHJpY3MuZm9yRWFjaCgodmFsdWUsIG5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHVuaXQgPSBuYW1lLmluY2x1ZGVzKCdMYXRlbmN5JykgPyAnTWlsbGlzZWNvbmRzJyA6ICdDb3VudCc7XG4gICAgICBtZXRyaWNzQXJyYXkucHVzaCh7IE5hbWU6IG5hbWUsIFVuaXQ6IHVuaXQgfSk7XG4gICAgICBtZXRyaWNWYWx1ZXNbbmFtZV0gPSB2YWx1ZTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGVtZjogRU1GTWV0cmljID0ge1xuICAgICAgX2F3czoge1xuICAgICAgICBUaW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIENsb3VkV2F0Y2hNZXRyaWNzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgTmFtZXNwYWNlOiAnWDQwMi9QYXltZW50VmVyaWZpZXInLFxuICAgICAgICAgICAgRGltZW5zaW9uczogW09iamVjdC5rZXlzKHRoaXMuZGltZW5zaW9ucyldLFxuICAgICAgICAgICAgTWV0cmljczogbWV0cmljc0FycmF5LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgLi4udGhpcy5kaW1lbnNpb25zLFxuICAgICAgLi4ubWV0cmljVmFsdWVzLFxuICAgICAgcmVxdWVzdElkOiB0aGlzLnJlcXVlc3RJZCxcbiAgICB9O1xuXG4gICAgLy8gRU1GIGxvZ3MgbXVzdCBiZSBwcmludGVkIHRvIHN0ZG91dCBmb3IgQ2xvdWRXYXRjaCB0byBwYXJzZSB0aGVtXG4gICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkoZW1mKSk7XG4gIH1cblxuICAvKipcbiAgICogR2V0cyBlbGFwc2VkIHRpbWUgc2luY2UgbG9nZ2VyIGNyZWF0aW9uXG4gICAqL1xuICBnZXRFbGFwc2VkTXMoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gRGF0ZS5ub3coKSAtIHRoaXMuc3RhcnRUaW1lO1xuICB9XG59XG5cbi8qKlxuICogR2VuZXJhdGVzIGEgdW5pcXVlIHJlcXVlc3QgSUQgZm9yIHRyYWNpbmdcbiAqL1xuZnVuY3Rpb24gZ2VuZXJhdGVSZXF1ZXN0SWQoKTogc3RyaW5nIHtcbiAgcmV0dXJuIGByZXFfJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHJpbmcoMiwgOSl9YDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8geDQwMiB2MiBUeXBlcyAtIGltcG9ydGVkIGZyb20gLi90eXBlc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBGYWNpbGl0YXRvciBVUkwgZm9yIHBheW1lbnQgdmVyaWZpY2F0aW9uXG4vLyBOb3RlOiBMYW1iZGFARWRnZSBkb2Vzbid0IHN1cHBvcnQgZW52aXJvbm1lbnQgdmFyaWFibGVzLCBzbyB0aGlzIGlzIGJ1bmRsZWRcbmNvbnN0IEZBQ0lMSVRBVE9SX1VSTCA9ICdodHRwczovL3g0MDIub3JnL2ZhY2lsaXRhdG9yJztcblxuLy8gU2VsbGVyIHdhbGxldCBhZGRyZXNzIHRvIHJlY2VpdmUgcGF5bWVudHNcbi8vIFRoaXMgd2FsbGV0IHJlY2VpdmVzIHg0MDIgcGF5bWVudHMgb24gQmFzZSBTZXBvbGlhXG5jb25zdCBTRUxMRVJfUEFZX1RPID0gJzB4MjQ4NDJGMzEzNkZhMmEzZGY4MzVkMzZiNGMzY2I0OTcyZDQwNTUwMic7XG5cbi8qKlxuICogVmFsaWRhdGVzIHRoZSBzdHJ1Y3R1cmUgb2YgYSBwYXltZW50IHBheWxvYWRcbiAqL1xuZnVuY3Rpb24gdmFsaWRhdGVQYXlsb2FkU3RydWN0dXJlKHBheWxvYWQ6IHVua25vd24pOiBwYXlsb2FkIGlzIFBheW1lbnRQYXlsb2FkIHtcbiAgaWYgKCFwYXlsb2FkIHx8IHR5cGVvZiBwYXlsb2FkICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuICBcbiAgY29uc3QgcCA9IHBheWxvYWQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIFxuICAvLyBDaGVjayByZXF1aXJlZCB0b3AtbGV2ZWwgZmllbGRzXG4gIGlmICh0eXBlb2YgcC54NDAyVmVyc2lvbiAhPT0gJ251bWJlcicgfHwgcC54NDAyVmVyc2lvbiAhPT0gMikgcmV0dXJuIGZhbHNlO1xuICBpZiAoIXAuYWNjZXB0ZWQgfHwgdHlwZW9mIHAuYWNjZXB0ZWQgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG4gIGlmICghcC5wYXlsb2FkIHx8IHR5cGVvZiBwLnBheWxvYWQgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG4gIFxuICAvLyBDaGVjayBhY2NlcHRlZCByZXF1aXJlbWVudHNcbiAgY29uc3QgYWNjZXB0ZWQgPSBwLmFjY2VwdGVkIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBpZiAodHlwZW9mIGFjY2VwdGVkLnNjaGVtZSAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhY2NlcHRlZC5uZXR3b3JrICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIGFjY2VwdGVkLmFtb3VudCAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhY2NlcHRlZC5hc3NldCAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhY2NlcHRlZC5wYXlUbyAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgXG4gIC8vIENoZWNrIHBheWxvYWQgKGV4YWN0IEVWTSBzY2hlbWUpXG4gIGNvbnN0IHBheWxvYWREYXRhID0gcC5wYXlsb2FkIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBpZiAodHlwZW9mIHBheWxvYWREYXRhLnNpZ25hdHVyZSAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKCFwYXlsb2FkRGF0YS5hdXRob3JpemF0aW9uIHx8IHR5cGVvZiBwYXlsb2FkRGF0YS5hdXRob3JpemF0aW9uICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuICBcbiAgLy8gQ2hlY2sgYXV0aG9yaXphdGlvblxuICBjb25zdCBhdXRoID0gcGF5bG9hZERhdGEuYXV0aG9yaXphdGlvbiBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgaWYgKHR5cGVvZiBhdXRoLmZyb20gIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgYXV0aC50byAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhdXRoLnZhbHVlICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIGF1dGgudmFsaWRBZnRlciAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhdXRoLnZhbGlkQmVmb3JlICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIGF1dGgubm9uY2UgIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIFxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgdGhhdCB0aGUgcGF5bWVudCBhdXRob3JpemF0aW9uIG1hdGNoZXMgdGhlIHJlcXVpcmVtZW50c1xuICovXG5mdW5jdGlvbiB2YWxpZGF0ZUF1dGhvcml6YXRpb25QYXJhbWV0ZXJzKFxuICBwYXlsb2FkOiBQYXltZW50UGF5bG9hZCxcbiAgcmVxdWlyZW1lbnRzOiBQYXltZW50UmVxdWlyZW1lbnRzXG4pOiBWZXJpZnlSZXNwb25zZSB7XG4gIGNvbnN0IHsgYXV0aG9yaXphdGlvbiB9ID0gcGF5bG9hZC5wYXlsb2FkO1xuICBjb25zdCBwYXllciA9IGF1dGhvcml6YXRpb24uZnJvbTtcbiAgXG4gIC8vIFZlcmlmeSBzY2hlbWUgbWF0Y2hlc1xuICBpZiAocGF5bG9hZC5hY2NlcHRlZC5zY2hlbWUgIT09IHJlcXVpcmVtZW50cy5zY2hlbWUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnc2NoZW1lX21pc21hdGNoJyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIC8vIFZlcmlmeSBuZXR3b3JrIG1hdGNoZXNcbiAgaWYgKHBheWxvYWQuYWNjZXB0ZWQubmV0d29yayAhPT0gcmVxdWlyZW1lbnRzLm5ldHdvcmspIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnbmV0d29ya19taXNtYXRjaCcsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICAvLyBWZXJpZnkgcmVjaXBpZW50IG1hdGNoZXNcbiAgaWYgKGF1dGhvcml6YXRpb24udG8udG9Mb3dlckNhc2UoKSAhPT0gcmVxdWlyZW1lbnRzLnBheVRvLnRvTG93ZXJDYXNlKCkpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnaW52YWxpZF9leGFjdF9ldm1fcGF5bG9hZF9yZWNpcGllbnRfbWlzbWF0Y2gnLFxuICAgICAgcGF5ZXIsXG4gICAgfTtcbiAgfVxuICBcbiAgLy8gVmVyaWZ5IGFtb3VudCBpcyBzdWZmaWNpZW50XG4gIGNvbnN0IHBheW1lbnRWYWx1ZSA9IEJpZ0ludChhdXRob3JpemF0aW9uLnZhbHVlKTtcbiAgY29uc3QgcmVxdWlyZWRBbW91bnQgPSBCaWdJbnQocmVxdWlyZW1lbnRzLmFtb3VudCk7XG4gIGlmIChwYXltZW50VmFsdWUgPCByZXF1aXJlZEFtb3VudCkge1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICdpbnZhbGlkX2V4YWN0X2V2bV9wYXlsb2FkX2F1dGhvcml6YXRpb25fdmFsdWUnLFxuICAgICAgcGF5ZXIsXG4gICAgfTtcbiAgfVxuICBcbiAgLy8gVmVyaWZ5IHRpbWUgdmFsaWRpdHlcbiAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XG4gIGNvbnN0IHZhbGlkQWZ0ZXIgPSBwYXJzZUludChhdXRob3JpemF0aW9uLnZhbGlkQWZ0ZXIsIDEwKTtcbiAgY29uc3QgdmFsaWRCZWZvcmUgPSBwYXJzZUludChhdXRob3JpemF0aW9uLnZhbGlkQmVmb3JlLCAxMCk7XG4gIFxuICAvLyBDaGVjayB2YWxpZEFmdGVyIGlzIG5vdCBpbiB0aGUgZnV0dXJlXG4gIGlmICh2YWxpZEFmdGVyID4gbm93KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ2ludmFsaWRfZXhhY3RfZXZtX3BheWxvYWRfYXV0aG9yaXphdGlvbl92YWxpZF9hZnRlcicsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICAvLyBDaGVjayB2YWxpZEJlZm9yZSBpcyBpbiB0aGUgZnV0dXJlICh3aXRoIDYgc2Vjb25kIGJ1ZmZlciBmb3IgYmxvY2sgdGltZSlcbiAgaWYgKHZhbGlkQmVmb3JlIDwgbm93ICsgNikge1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICdpbnZhbGlkX2V4YWN0X2V2bV9wYXlsb2FkX2F1dGhvcml6YXRpb25fdmFsaWRfYmVmb3JlJyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIC8vIFZlcmlmeSBhc3NldCBtYXRjaGVzXG4gIGlmIChwYXlsb2FkLmFjY2VwdGVkLmFzc2V0LnRvTG93ZXJDYXNlKCkgIT09IHJlcXVpcmVtZW50cy5hc3NldC50b0xvd2VyQ2FzZSgpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ2Fzc2V0X21pc21hdGNoJyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIC8vIFZlcmlmeSBzaWduYXR1cmUgZm9ybWF0IChzaG91bGQgYmUgNjUgYnl0ZXMgPSAxMzAgaGV4IGNoYXJzICsgMHggcHJlZml4KVxuICBjb25zdCBzaWduYXR1cmUgPSBwYXlsb2FkLnBheWxvYWQuc2lnbmF0dXJlO1xuICBpZiAoIXNpZ25hdHVyZS5zdGFydHNXaXRoKCcweCcpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ2ludmFsaWRfc2lnbmF0dXJlX2Zvcm1hdCcsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICBjb25zdCBzaWduYXR1cmVMZW5ndGggPSBzaWduYXR1cmUubGVuZ3RoIC0gMjsgLy8gUmVtb3ZlIDB4IHByZWZpeFxuICAvLyBFT0Egc2lnbmF0dXJlcyBhcmUgMTMwIGNoYXJzLCBzbWFydCB3YWxsZXQgc2lnbmF0dXJlcyBjYW4gYmUgbG9uZ2VyXG4gIGlmIChzaWduYXR1cmVMZW5ndGggPCAxMzApIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnaW52YWxpZF9zaWduYXR1cmVfbGVuZ3RoJyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIC8vIFZlcmlmeSBub25jZSBmb3JtYXQgKHNob3VsZCBiZSAzMiBieXRlcyA9IDY0IGhleCBjaGFycyArIDB4IHByZWZpeClcbiAgY29uc3Qgbm9uY2UgPSBhdXRob3JpemF0aW9uLm5vbmNlO1xuICBpZiAoIW5vbmNlLnN0YXJ0c1dpdGgoJzB4JykgfHwgbm9uY2UubGVuZ3RoICE9PSA2Nikge1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICdpbnZhbGlkX25vbmNlX2Zvcm1hdCcsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICByZXR1cm4ge1xuICAgIGlzVmFsaWQ6IHRydWUsXG4gICAgcGF5ZXIsXG4gIH07XG59XG5cbi8qKlxuICogVmVyaWZpZXMgdGhlIHBheW1lbnQgc2lnbmF0dXJlIHVzaW5nIHRoZSBmYWNpbGl0YXRvciBzZXJ2aWNlXG4gKiBJbiBwcm9kdWN0aW9uLCB0aGlzIHdvdWxkIGNhbGwgdGhlIHg0MDIgZmFjaWxpdGF0b3IncyAvdmVyaWZ5IGVuZHBvaW50XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHZlcmlmeVNpZ25hdHVyZVdpdGhGYWNpbGl0YXRvcihcbiAgcGF5bG9hZDogUGF5bWVudFBheWxvYWQsXG4gIHJlcXVpcmVtZW50czogUGF5bWVudFJlcXVpcmVtZW50cyxcbiAgbG9nZ2VyOiBMb2dnZXJcbik6IFByb21pc2U8VmVyaWZ5UmVzcG9uc2U+IHtcbiAgY29uc3QgcGF5ZXIgPSBwYXlsb2FkLnBheWxvYWQuYXV0aG9yaXphdGlvbi5mcm9tO1xuICBcbiAgdHJ5IHtcbiAgICBsb2dnZXIuZGVidWcoJ0NhbGxpbmcgZmFjaWxpdGF0b3IgL3ZlcmlmeSBlbmRwb2ludCcsIHtcbiAgICAgIGZhY2lsaXRhdG9yVXJsOiBGQUNJTElUQVRPUl9VUkwsXG4gICAgfSk7XG4gICAgXG4gICAgLy8gQ2FsbCBmYWNpbGl0YXRvciAvdmVyaWZ5IGVuZHBvaW50XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHtGQUNJTElUQVRPUl9VUkx9L3ZlcmlmeWAsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcGF5bWVudFBheWxvYWQ6IHBheWxvYWQsXG4gICAgICAgIHBheW1lbnRSZXF1aXJlbWVudHM6IHJlcXVpcmVtZW50cyxcbiAgICAgIH0pLFxuICAgIH0pO1xuICAgIFxuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIGxvZ2dlci53YXJuKCdGYWNpbGl0YXRvciB2ZXJpZnkgcmVxdWVzdCBmYWlsZWQnLCB7XG4gICAgICAgIHN0YXR1c0NvZGU6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgICAgc3RhdHVzVGV4dDogcmVzcG9uc2Uuc3RhdHVzVGV4dCxcbiAgICAgIH0pO1xuICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5GQUNJTElUQVRPUl9FUlJPUik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgICAgaW52YWxpZFJlYXNvbjogJ2ZhY2lsaXRhdG9yX3ZlcmlmaWNhdGlvbl9mYWlsZWQnLFxuICAgICAgICBwYXllcixcbiAgICAgIH07XG4gICAgfVxuICAgIFxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKSBhcyBWZXJpZnlSZXNwb25zZTtcbiAgICBsb2dnZXIuZGVidWcoJ0ZhY2lsaXRhdG9yIHZlcmlmaWNhdGlvbiByZXNwb25zZSByZWNlaXZlZCcsIHtcbiAgICAgIGlzVmFsaWQ6IHJlc3VsdC5pc1ZhbGlkLFxuICAgIH0pO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgbG9nZ2VyLmVycm9yKCdFcnJvciBjYWxsaW5nIGZhY2lsaXRhdG9yJywgZXJyb3IsIHtcbiAgICAgIGZhY2lsaXRhdG9yVXJsOiBGQUNJTElUQVRPUl9VUkwsXG4gICAgfSk7XG4gICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5GQUNJTElUQVRPUl9FUlJPUik7XG4gICAgLy8gRmFpbCBwcm9wZXJseSAtIGRvbid0IGFjY2VwdCBwYXltZW50cyBpZiBmYWNpbGl0YXRvciBpcyB1bmF2YWlsYWJsZVxuICAgIGxvZ2dlci5lcnJvcignRmFjaWxpdGF0b3IgdW5hdmFpbGFibGUgLSByZWplY3RpbmcgcGF5bWVudCBmb3Igc2FmZXR5Jyk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ2ZhY2lsaXRhdG9yX3VuYXZhaWxhYmxlJyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBTZXR0bGVzIHRoZSBwYXltZW50IHVzaW5nIHRoZSBmYWNpbGl0YXRvciBzZXJ2aWNlXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHNldHRsZVBheW1lbnRXaXRoRmFjaWxpdGF0b3IoXG4gIHBheWxvYWQ6IFBheW1lbnRQYXlsb2FkLFxuICByZXF1aXJlbWVudHM6IFBheW1lbnRSZXF1aXJlbWVudHMsXG4gIGxvZ2dlcjogTG9nZ2VyXG4pOiBQcm9taXNlPFNldHRsZW1lbnRSZXNwb25zZT4ge1xuICBjb25zdCBwYXllciA9IHBheWxvYWQucGF5bG9hZC5hdXRob3JpemF0aW9uLmZyb207XG4gIFxuICB0cnkge1xuICAgIGxvZ2dlci5kZWJ1ZygnQ2FsbGluZyBmYWNpbGl0YXRvciAvc2V0dGxlIGVuZHBvaW50Jywge1xuICAgICAgZmFjaWxpdGF0b3JVcmw6IEZBQ0lMSVRBVE9SX1VSTCxcbiAgICAgIGFtb3VudDogcmVxdWlyZW1lbnRzLmFtb3VudCxcbiAgICB9KTtcbiAgICBcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGAke0ZBQ0lMSVRBVE9SX1VSTH0vc2V0dGxlYCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBwYXltZW50UGF5bG9hZDogcGF5bG9hZCxcbiAgICAgICAgcGF5bWVudFJlcXVpcmVtZW50czogcmVxdWlyZW1lbnRzLFxuICAgICAgfSksXG4gICAgfSk7XG4gICAgXG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgbG9nZ2VyLndhcm4oJ0ZhY2lsaXRhdG9yIHNldHRsZSByZXF1ZXN0IGZhaWxlZCcsIHtcbiAgICAgICAgc3RhdHVzQ29kZTogcmVzcG9uc2Uuc3RhdHVzLFxuICAgICAgICBzdGF0dXNUZXh0OiByZXNwb25zZS5zdGF0dXNUZXh0LFxuICAgICAgfSk7XG4gICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLkZBQ0lMSVRBVE9SX0VSUk9SKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICB0cmFuc2FjdGlvbjogJycsXG4gICAgICAgIG5ldHdvcms6IHJlcXVpcmVtZW50cy5uZXR3b3JrLFxuICAgICAgICBwYXllcixcbiAgICAgICAgZXJyb3JSZWFzb246ICdzZXR0bGVtZW50X2ZhaWxlZCcsXG4gICAgICB9O1xuICAgIH1cbiAgICBcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXNwb25zZS5qc29uKCkgYXMgU2V0dGxlbWVudFJlc3BvbnNlO1xuICAgIGxvZ2dlci5kZWJ1ZygnRmFjaWxpdGF0b3Igc2V0dGxlbWVudCByZXNwb25zZSByZWNlaXZlZCcsIHtcbiAgICAgIHN1Y2Nlc3M6IHJlc3VsdC5zdWNjZXNzLFxuICAgICAgdHJhbnNhY3Rpb246IHJlc3VsdC50cmFuc2FjdGlvbixcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignRXJyb3Igc2V0dGxpbmcgcGF5bWVudCcsIGVycm9yLCB7XG4gICAgICBmYWNpbGl0YXRvclVybDogRkFDSUxJVEFUT1JfVVJMLFxuICAgIH0pO1xuICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuRkFDSUxJVEFUT1JfRVJST1IpO1xuICAgIC8vIEZhaWwgcHJvcGVybHkgLSBkb24ndCBmYWtlIHNldHRsZW1lbnRzXG4gICAgbG9nZ2VyLmVycm9yKCdGYWNpbGl0YXRvciB1bmF2YWlsYWJsZSAtIHNldHRsZW1lbnQgZmFpbGVkJyk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgdHJhbnNhY3Rpb246ICcnLFxuICAgICAgbmV0d29yazogcmVxdWlyZW1lbnRzLm5ldHdvcmssXG4gICAgICBwYXllcixcbiAgICAgIGVycm9yUmVhc29uOiAnZmFjaWxpdGF0b3JfdW5hdmFpbGFibGUnLFxuICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgNDAyIFBheW1lbnQgUmVxdWlyZWQgcmVzcG9uc2VcbiAqL1xuZnVuY3Rpb24gY3JlYXRlNDAyUmVzcG9uc2UoXG4gIHVyaTogc3RyaW5nLFxuICByZXF1aXJlbWVudHM6IFBheW1lbnRSZXF1aXJlbWVudHMsXG4gIGVycm9yTWVzc2FnZT86IHN0cmluZ1xuKTogQ2xvdWRGcm9udFJlcXVlc3RSZXN1bHQge1xuICBjb25zdCBwYXltZW50UmVxdWlyZWQ6IFBheW1lbnRSZXF1aXJlZCA9IHtcbiAgICB4NDAyVmVyc2lvbjogMixcbiAgICBlcnJvcjogZXJyb3JNZXNzYWdlIHx8ICdQYXltZW50IHJlcXVpcmVkIHRvIGFjY2VzcyB0aGlzIHJlc291cmNlJyxcbiAgICByZXNvdXJjZToge1xuICAgICAgdXJsOiB1cmksXG4gICAgICBkZXNjcmlwdGlvbjogYFByb3RlY3RlZCByZXNvdXJjZSBhdCAke3VyaX1gLFxuICAgICAgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICB9LFxuICAgIGFjY2VwdHM6IFtyZXF1aXJlbWVudHNdLFxuICAgIGV4dGVuc2lvbnM6IHt9LFxuICB9O1xuXG4gIHJldHVybiB7XG4gICAgc3RhdHVzOiAnNDAyJyxcbiAgICBzdGF0dXNEZXNjcmlwdGlvbjogJ1BheW1lbnQgUmVxdWlyZWQnLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdjb250ZW50LXR5cGUnOiBbeyBrZXk6ICdDb250ZW50LVR5cGUnLCB2YWx1ZTogJ2FwcGxpY2F0aW9uL2pzb24nIH1dLFxuICAgICAgJ3gtcGF5bWVudC1yZXF1aXJlZCc6IFt7XG4gICAgICAgIGtleTogJ1gtUEFZTUVOVC1SRVFVSVJFRCcsXG4gICAgICAgIHZhbHVlOiBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShwYXltZW50UmVxdWlyZWQpKS50b1N0cmluZygnYmFzZTY0JyksXG4gICAgICB9XSxcbiAgICAgICdhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW4nOiBbeyBrZXk6ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCB2YWx1ZTogJyonIH1dLFxuICAgICAgJ2FjY2Vzcy1jb250cm9sLWFsbG93LWhlYWRlcnMnOiBbeyBcbiAgICAgICAga2V5OiAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycycsIFxuICAgICAgICB2YWx1ZTogJ0NvbnRlbnQtVHlwZSwgWC1QYXltZW50LVNpZ25hdHVyZScgXG4gICAgICB9XSxcbiAgICAgICdhY2Nlc3MtY29udHJvbC1leHBvc2UtaGVhZGVycyc6IFt7XG4gICAgICAgIGtleTogJ0FjY2Vzcy1Db250cm9sLUV4cG9zZS1IZWFkZXJzJyxcbiAgICAgICAgdmFsdWU6ICdYLVBBWU1FTlQtUkVRVUlSRUQsIFgtUEFZTUVOVC1SRVNQT05TRScsXG4gICAgICB9XSxcbiAgICB9LFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIGVycm9yOiAnUGF5bWVudCBSZXF1aXJlZCcsXG4gICAgICBtZXNzYWdlOiBlcnJvck1lc3NhZ2UgfHwgJ1RoaXMgY29udGVudCByZXF1aXJlcyBwYXltZW50IHRvIGFjY2VzcycsXG4gICAgICB4NDAyVmVyc2lvbjogMixcbiAgICB9KSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIGVycm9yIHJlc3BvbnNlXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZUVycm9yUmVzcG9uc2UoXG4gIHN0YXR1czogc3RyaW5nLFxuICBzdGF0dXNEZXNjcmlwdGlvbjogc3RyaW5nLFxuICBlcnJvcjogc3RyaW5nLFxuICBtZXNzYWdlOiBzdHJpbmdcbik6IENsb3VkRnJvbnRSZXF1ZXN0UmVzdWx0IHtcbiAgcmV0dXJuIHtcbiAgICBzdGF0dXMsXG4gICAgc3RhdHVzRGVzY3JpcHRpb24sXG4gICAgaGVhZGVyczoge1xuICAgICAgJ2NvbnRlbnQtdHlwZSc6IFt7IGtleTogJ0NvbnRlbnQtVHlwZScsIHZhbHVlOiAnYXBwbGljYXRpb24vanNvbicgfV0sXG4gICAgICAnYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luJzogW3sga2V5OiAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgdmFsdWU6ICcqJyB9XSxcbiAgICB9LFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3IsIG1lc3NhZ2UgfSksXG4gIH07XG59XG5cbi8qKlxuICogQ3JlYXRlcyBNQ1AgdG9vbCBkaXNjb3ZlcnkgcmVzcG9uc2VcbiAqIFJldHVybnMgYWxsIGF2YWlsYWJsZSBzZXJ2aWNlcyB3aXRoIHRoZWlyIHByaWNpbmcgYW5kIG1ldGFkYXRhXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZU1DUERpc2NvdmVyeVJlc3BvbnNlKHJlcXVlc3RJZDogc3RyaW5nKTogQ2xvdWRGcm9udFJlcXVlc3RSZXN1bHQge1xuICBjb25zdCB0b29scyA9IFtdO1xuICBcbiAgLy8gR2V0IGFsbCBjb250ZW50IGl0ZW1zIGZyb20gdGhlIHJlZ2lzdHJ5XG4gIGNvbnN0IHBhdGhzID0gY29udGVudE1hbmFnZXIubGlzdENvbnRlbnRQYXRocygpO1xuICBcbiAgZm9yIChjb25zdCBwYXRoIG9mIHBhdGhzKSB7XG4gICAgY29uc3QgaXRlbSA9IGNvbnRlbnRNYW5hZ2VyLmdldENvbnRlbnRJdGVtKHBhdGgpO1xuICAgIGlmICghaXRlbSkgY29udGludWU7XG4gICAgXG4gICAgLy8gQ29udmVydCBwYXRoIHRvIHRvb2wgbmFtZTogL2FwaS9wcmVtaXVtLWFydGljbGUgLT4gZ2V0X3ByZW1pdW1fYXJ0aWNsZVxuICAgIGNvbnN0IHRvb2xOYW1lID0gJ2dldF8nICsgcGF0aC5yZXBsYWNlKCcvYXBpLycsICcnKS5yZXBsYWNlKC8tL2csICdfJyk7XG4gICAgXG4gICAgLy8gQ2FsY3VsYXRlIGRpc3BsYXkgcHJpY2UgKFVTREMgaGFzIDYgZGVjaW1hbHMpXG4gICAgY29uc3QgYW1vdW50VW5pdHMgPSBwYXJzZUludChpdGVtLnByaWNpbmcuYW1vdW50LCAxMCk7XG4gICAgY29uc3QgZGlzcGxheVByaWNlID0gKGFtb3VudFVuaXRzIC8gMTAwMDAwMCkudG9GaXhlZCg2KS5yZXBsYWNlKC9cXC4/MCskLywgJycpO1xuICAgIFxuICAgIHRvb2xzLnB1c2goe1xuICAgICAgdG9vbF9uYW1lOiB0b29sTmFtZSxcbiAgICAgIHRvb2xfZGVzY3JpcHRpb246IGAke2l0ZW0uZGVzY3JpcHRpb259LiBSZXF1aXJlcyB4NDAyIHBheW1lbnQ6ICR7aXRlbS5wcmljaW5nLmFtb3VudH0gVVNEQyB1bml0cyAoJHtkaXNwbGF5UHJpY2V9IFVTREMpIG9uIEJhc2UgU2Vwb2xpYSB0ZXN0bmV0LmAsXG4gICAgICBvcGVyYXRpb25faWQ6IHRvb2xOYW1lLFxuICAgICAgZW5kcG9pbnRfcGF0aDogcGF0aCxcbiAgICAgIG1jcF9tZXRhZGF0YToge1xuICAgICAgICBjYXRlZ29yeTogcGF0aC5pbmNsdWRlcygnbWFya2V0JykgfHwgcGF0aC5pbmNsdWRlcygnd2VhdGhlcicpID8gJ21hcmtldC1kYXRhJyA6IFxuICAgICAgICAgICAgICAgICAgcGF0aC5pbmNsdWRlcygncmVzZWFyY2gnKSB8fCBwYXRoLmluY2x1ZGVzKCdkYXRhc2V0JykgPyAncmVzZWFyY2gnIDogJ2NvbnRlbnQnLFxuICAgICAgICB0YWdzOiBbJ3g0MDItcGF5bWVudCcsICdwcmVtaXVtLWNvbnRlbnQnXSxcbiAgICAgICAgcHJpb3JpdHk6IDEsXG4gICAgICAgIHJlcXVpcmVzX3BheW1lbnQ6IHRydWUsXG4gICAgICAgIGVzdGltYXRlZF9sYXRlbmN5X21zOiAyMDAwLFxuICAgICAgfSxcbiAgICAgIHg0MDJfbWV0YWRhdGE6IHtcbiAgICAgICAgcHJpY2VfdXNkY191bml0czogaXRlbS5wcmljaW5nLmFtb3VudCxcbiAgICAgICAgcHJpY2VfdXNkY19kaXNwbGF5OiBgJHtkaXNwbGF5UHJpY2V9IFVTRENgLFxuICAgICAgICBuZXR3b3JrOiBpdGVtLnByaWNpbmcubmV0d29yayxcbiAgICAgICAgbmV0d29ya19uYW1lOiAnQmFzZSBTZXBvbGlhJyxcbiAgICAgICAgc2NoZW1lOiBpdGVtLnByaWNpbmcuc2NoZW1lLFxuICAgICAgICBhc3NldF9hZGRyZXNzOiBpdGVtLnByaWNpbmcuYXNzZXQsXG4gICAgICAgIGFzc2V0X25hbWU6ICdVU0RDJyxcbiAgICAgICAgdGltZW91dF9zZWNvbmRzOiBpdGVtLnByaWNpbmcubWF4VGltZW91dFNlY29uZHMsXG4gICAgICB9LFxuICAgICAgaW5wdXRfc2NoZW1hOiB7XG4gICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICAgICAgcmVxdWlyZWQ6IFtdLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ05vIGlucHV0IHBhcmFtZXRlcnMgcmVxdWlyZWQuIFBheW1lbnQgaXMgaGFuZGxlZCB2aWEgeDQwMiBoZWFkZXJzLicsXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG4gIFxuICBjb25zdCByZXNwb25zZSA9IHtcbiAgICB2ZXJzaW9uOiAnMS4wJyxcbiAgICB0b29scyxcbiAgICBtZXRhZGF0YToge1xuICAgICAgZ2F0ZXdheTogJ3g0MDItc2VsbGVyLWdhdGV3YXknLFxuICAgICAgcHJvdG9jb2w6ICd4NDAyLXYyJyxcbiAgICAgIG5ldHdvcms6ICdiYXNlLXNlcG9saWEnLFxuICAgICAgdG90YWxfc2VydmljZXM6IHRvb2xzLmxlbmd0aCxcbiAgICB9LFxuICB9O1xuICBcbiAgcmV0dXJuIHtcbiAgICBzdGF0dXM6ICcyMDAnLFxuICAgIHN0YXR1c0Rlc2NyaXB0aW9uOiAnT0snLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdjb250ZW50LXR5cGUnOiBbeyBrZXk6ICdDb250ZW50LVR5cGUnLCB2YWx1ZTogJ2FwcGxpY2F0aW9uL2pzb24nIH1dLFxuICAgICAgJ3gtcmVxdWVzdC1pZCc6IFt7IGtleTogJ1gtUmVxdWVzdC1JZCcsIHZhbHVlOiByZXF1ZXN0SWQgfV0sXG4gICAgICAnYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luJzogW3sga2V5OiAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgdmFsdWU6ICcqJyB9XSxcbiAgICAgICdhY2Nlc3MtY29udHJvbC1hbGxvdy1oZWFkZXJzJzogW3sgXG4gICAgICAgIGtleTogJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLCBcbiAgICAgICAgdmFsdWU6ICdDb250ZW50LVR5cGUsIEFjY2VwdCcgXG4gICAgICB9XSxcbiAgICAgICdjYWNoZS1jb250cm9sJzogW3sga2V5OiAnQ2FjaGUtQ29udHJvbCcsIHZhbHVlOiAncHVibGljLCBtYXgtYWdlPTMwMCcgfV0sXG4gICAgfSxcbiAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZSksXG4gIH07XG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKFxuICBldmVudDogQ2xvdWRGcm9udFJlcXVlc3RFdmVudFxuKTogUHJvbWlzZTxDbG91ZEZyb250UmVxdWVzdFJlc3VsdD4gPT4ge1xuICBjb25zdCByZXF1ZXN0ID0gZXZlbnQuUmVjb3Jkc1swXS5jZi5yZXF1ZXN0O1xuICBjb25zdCB1cmkgPSByZXF1ZXN0LnVyaTtcbiAgXG4gIC8vIEluaXRpYWxpemUgbG9nZ2VyIHdpdGggcmVxdWVzdCBJRCBmb3IgdHJhY2luZ1xuICBjb25zdCByZXF1ZXN0SWQgPSBnZW5lcmF0ZVJlcXVlc3RJZCgpO1xuICBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKHJlcXVlc3RJZCwgdXJpKTtcbiAgXG4gIC8vIFJlY29yZCByZXF1ZXN0IG1ldHJpY1xuICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlJFUVVFU1RfQ09VTlQpO1xuICBsb2dnZXIuaW5mbygnUHJvY2Vzc2luZyByZXF1ZXN0JywgeyBtZXRob2Q6IHJlcXVlc3QubWV0aG9kIH0pO1xuXG4gIHRyeSB7XG4gICAgLy8gSGFuZGxlIE1DUCBkaXNjb3ZlcnkgZW5kcG9pbnQgKG5vIHBheW1lbnQgcmVxdWlyZWQpXG4gICAgaWYgKHVyaSA9PT0gJy9tY3AvdG9vbHMnKSB7XG4gICAgICBsb2dnZXIuaW5mbygnTUNQIGRpc2NvdmVyeSByZXF1ZXN0Jyk7XG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgICAgcmV0dXJuIGNyZWF0ZU1DUERpc2NvdmVyeVJlc3BvbnNlKHJlcXVlc3RJZCk7XG4gICAgfVxuICAgIFxuICAgIC8vIENoZWNrIGlmIHRoaXMgcGF0aCByZXF1aXJlcyBwYXltZW50IHVzaW5nIGR5bmFtaWMgY29udGVudCBtYW5hZ2VyXG4gICAgY29uc3QgcGF5bWVudFJlcXVpcmVtZW50ID0gY29udGVudE1hbmFnZXIuZ2V0UGF5bWVudFJlcXVpcmVtZW50cyh1cmkpO1xuICAgIFxuICAgIGlmICghcGF5bWVudFJlcXVpcmVtZW50KSB7XG4gICAgICAvLyBObyBwYXltZW50IHJlcXVpcmVkIGZvciB0aGlzIHBhdGhcbiAgICAgIGxvZ2dlci5kZWJ1ZygnTm8gcGF5bWVudCByZXF1aXJlZCBmb3IgcGF0aCcpO1xuICAgICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLkxBVEVOQ1ksIGxvZ2dlci5nZXRFbGFwc2VkTXMoKSk7XG4gICAgICBsb2dnZXIuZW1pdE1ldHJpY3MoKTtcbiAgICAgIHJldHVybiByZXF1ZXN0O1xuICAgIH1cblxuICAgIGxvZ2dlci5zZXREaW1lbnNpb24oJ05ldHdvcmsnLCBwYXltZW50UmVxdWlyZW1lbnQubmV0d29yayk7XG4gICAgbG9nZ2VyLnNldERpbWVuc2lvbignQXNzZXQnLCBwYXltZW50UmVxdWlyZW1lbnQuYXNzZXQpO1xuXG4gICAgLy8gQ2hlY2sgZm9yIHBheW1lbnQgc2lnbmF0dXJlIGhlYWRlciAoeDQwMiB2MiB1c2VzIFgtUEFZTUVOVC1TSUdOQVRVUkUpXG4gICAgY29uc3QgcGF5bWVudFNpZ25hdHVyZUhlYWRlciA9IFxuICAgICAgcmVxdWVzdC5oZWFkZXJzWyd4LXBheW1lbnQtc2lnbmF0dXJlJ10gfHwgXG4gICAgICByZXF1ZXN0LmhlYWRlcnNbJ3BheW1lbnQtc2lnbmF0dXJlJ107XG4gICAgXG4gICAgaWYgKCFwYXltZW50U2lnbmF0dXJlSGVhZGVyIHx8ICFwYXltZW50U2lnbmF0dXJlSGVhZGVyWzBdKSB7XG4gICAgICAvLyBObyBwYXltZW50IHByb3ZpZGVkIC0gcmV0dXJuIDQwMiBQYXltZW50IFJlcXVpcmVkXG4gICAgICBsb2dnZXIuaW5mbygnTm8gcGF5bWVudCBzaWduYXR1cmUgZm91bmQsIHJldHVybmluZyA0MDInLCB7XG4gICAgICAgIHJlcXVpcmVkQW1vdW50OiBwYXltZW50UmVxdWlyZW1lbnQuYW1vdW50LFxuICAgICAgfSk7XG4gICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlBBWU1FTlRfUkVRVUlSRUQpO1xuICAgICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLkxBVEVOQ1ksIGxvZ2dlci5nZXRFbGFwc2VkTXMoKSk7XG4gICAgICBsb2dnZXIuZW1pdE1ldHJpY3MoKTtcbiAgICAgIHJldHVybiBjcmVhdGU0MDJSZXNwb25zZSh1cmksIHBheW1lbnRSZXF1aXJlbWVudCk7XG4gICAgfVxuXG4gICAgLy8gUGF5bWVudCBzaWduYXR1cmUgcHJlc2VudFxuICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuUEFZTUVOVF9SRUNFSVZFRCk7XG5cbiAgICAvLyBEZWNvZGUgYW5kIHZlcmlmeSBwYXltZW50XG4gICAgY29uc3QgcGF5bWVudFBheWxvYWRCYXNlNjQgPSBwYXltZW50U2lnbmF0dXJlSGVhZGVyWzBdLnZhbHVlO1xuICAgIGxldCBwYXltZW50UGF5bG9hZDogdW5rbm93bjtcbiAgICBcbiAgICB0cnkge1xuICAgICAgcGF5bWVudFBheWxvYWQgPSBKU09OLnBhcnNlKFxuICAgICAgICBCdWZmZXIuZnJvbShwYXltZW50UGF5bG9hZEJhc2U2NCwgJ2Jhc2U2NCcpLnRvU3RyaW5nKCd1dGYtOCcpXG4gICAgICApO1xuICAgIH0gY2F0Y2ggKGRlY29kZUVycm9yKSB7XG4gICAgICBsb2dnZXIud2FybignRmFpbGVkIHRvIGRlY29kZSBwYXltZW50IHBheWxvYWQnLCB7XG4gICAgICAgIGVycm9yQ29kZTogJ0RFQ09ERV9FUlJPUicsXG4gICAgICB9KTtcbiAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuVkFMSURBVElPTl9FUlJPUik7XG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgICAgcmV0dXJuIGNyZWF0ZTQwMlJlc3BvbnNlKFxuICAgICAgICB1cmksIFxuICAgICAgICBwYXltZW50UmVxdWlyZW1lbnQsIFxuICAgICAgICAnSW52YWxpZCBwYXltZW50IHBheWxvYWQgZW5jb2RpbmcnXG4gICAgICApO1xuICAgIH1cblxuICAgIGxvZ2dlci5kZWJ1ZygnUGF5bWVudCBwYXlsb2FkIGRlY29kZWQgc3VjY2Vzc2Z1bGx5Jyk7XG5cbiAgICAvLyBWYWxpZGF0ZSBwYXlsb2FkIHN0cnVjdHVyZVxuICAgIGlmICghdmFsaWRhdGVQYXlsb2FkU3RydWN0dXJlKHBheW1lbnRQYXlsb2FkKSkge1xuICAgICAgbG9nZ2VyLndhcm4oJ0ludmFsaWQgcGF5bWVudCBwYXlsb2FkIHN0cnVjdHVyZScsIHtcbiAgICAgICAgZXJyb3JDb2RlOiAnSU5WQUxJRF9TVFJVQ1RVUkUnLFxuICAgICAgfSk7XG4gICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlZBTElEQVRJT05fRVJST1IpO1xuICAgICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLkxBVEVOQ1ksIGxvZ2dlci5nZXRFbGFwc2VkTXMoKSk7XG4gICAgICBsb2dnZXIuZW1pdE1ldHJpY3MoKTtcbiAgICAgIHJldHVybiBjcmVhdGVFcnJvclJlc3BvbnNlKFxuICAgICAgICAnNDAwJyxcbiAgICAgICAgJ0JhZCBSZXF1ZXN0JyxcbiAgICAgICAgJ0ludmFsaWQgUGF5bWVudCcsXG4gICAgICAgICdQYXltZW50IHBheWxvYWQgc3RydWN0dXJlIGlzIGludmFsaWQnXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIEV4dHJhY3QgcGF5ZXIgYWRkcmVzcyBmb3IgbG9nZ2luZ1xuICAgIGNvbnN0IHBheWVyID0gcGF5bWVudFBheWxvYWQucGF5bG9hZC5hdXRob3JpemF0aW9uLmZyb207XG4gICAgbG9nZ2VyLnNldERpbWVuc2lvbignUGF5ZXInLCBwYXllci5zdWJzdHJpbmcoMCwgMTApICsgJy4uLicpO1xuICAgIGxvZ2dlci5pbmZvKCdQYXltZW50IHBheWxvYWQgdmFsaWRhdGVkJywge1xuICAgICAgcGF5ZXIsXG4gICAgICBhbW91bnQ6IHBheW1lbnRQYXlsb2FkLmFjY2VwdGVkLmFtb3VudCxcbiAgICAgIHNjaGVtZTogcGF5bWVudFBheWxvYWQuYWNjZXB0ZWQuc2NoZW1lLFxuICAgIH0pO1xuXG4gICAgLy8gVmFsaWRhdGUgYXV0aG9yaXphdGlvbiBwYXJhbWV0ZXJzXG4gICAgY29uc3QgcGFyYW1WYWxpZGF0aW9uID0gdmFsaWRhdGVBdXRob3JpemF0aW9uUGFyYW1ldGVycyhcbiAgICAgIHBheW1lbnRQYXlsb2FkLFxuICAgICAgcGF5bWVudFJlcXVpcmVtZW50XG4gICAgKTtcbiAgICBcbiAgICBpZiAoIXBhcmFtVmFsaWRhdGlvbi5pc1ZhbGlkKSB7XG4gICAgICBsb2dnZXIud2FybignUGF5bWVudCBwYXJhbWV0ZXIgdmFsaWRhdGlvbiBmYWlsZWQnLCB7XG4gICAgICAgIGVycm9yQ29kZTogcGFyYW1WYWxpZGF0aW9uLmludmFsaWRSZWFzb24sXG4gICAgICAgIHBheWVyLFxuICAgICAgfSk7XG4gICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlZBTElEQVRJT05fRVJST1IpO1xuICAgICAgXG4gICAgICAvLyBSZWNvcmQgc3BlY2lmaWMgdmFsaWRhdGlvbiBlcnJvciBtZXRyaWNzXG4gICAgICBzd2l0Y2ggKHBhcmFtVmFsaWRhdGlvbi5pbnZhbGlkUmVhc29uKSB7XG4gICAgICAgIGNhc2UgJ2ludmFsaWRfZXhhY3RfZXZtX3BheWxvYWRfYXV0aG9yaXphdGlvbl92YWxpZF9iZWZvcmUnOlxuICAgICAgICBjYXNlICdpbnZhbGlkX2V4YWN0X2V2bV9wYXlsb2FkX2F1dGhvcml6YXRpb25fdmFsaWRfYWZ0ZXInOlxuICAgICAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuQVVUSE9SSVpBVElPTl9FWFBJUkVEKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnaW52YWxpZF9zaWduYXR1cmVfZm9ybWF0JzpcbiAgICAgICAgY2FzZSAnaW52YWxpZF9zaWduYXR1cmVfbGVuZ3RoJzpcbiAgICAgICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlNJR05BVFVSRV9JTlZBTElEKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnaW52YWxpZF9leGFjdF9ldm1fcGF5bG9hZF9hdXRob3JpemF0aW9uX3ZhbHVlJzpcbiAgICAgICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLkFNT1VOVF9JTlNVRkZJQ0lFTlQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICduZXR3b3JrX21pc21hdGNoJzpcbiAgICAgICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLk5FVFdPUktfTUlTTUFUQ0gpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdhc3NldF9taXNtYXRjaCc6XG4gICAgICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5BU1NFVF9NSVNNQVRDSCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgICAgbG9nZ2VyLmVtaXRNZXRyaWNzKCk7XG4gICAgICByZXR1cm4gY3JlYXRlNDAyUmVzcG9uc2UoXG4gICAgICAgIHVyaSxcbiAgICAgICAgcGF5bWVudFJlcXVpcmVtZW50LFxuICAgICAgICBgUGF5bWVudCB2YWxpZGF0aW9uIGZhaWxlZDogJHtwYXJhbVZhbGlkYXRpb24uaW52YWxpZFJlYXNvbn1gXG4gICAgICApO1xuICAgIH1cblxuICAgIGxvZ2dlci5kZWJ1ZygnQXV0aG9yaXphdGlvbiBwYXJhbWV0ZXJzIHZhbGlkYXRlZCcpO1xuXG4gICAgLy8gVmVyaWZ5IHNpZ25hdHVyZSB3aXRoIGZhY2lsaXRhdG9yXG4gICAgY29uc3QgdmVyaWZpY2F0aW9uU3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCBzaWduYXR1cmVWYWxpZGF0aW9uID0gYXdhaXQgdmVyaWZ5U2lnbmF0dXJlV2l0aEZhY2lsaXRhdG9yKFxuICAgICAgcGF5bWVudFBheWxvYWQsXG4gICAgICBwYXltZW50UmVxdWlyZW1lbnQsXG4gICAgICBsb2dnZXJcbiAgICApO1xuICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5WRVJJRklDQVRJT05fTEFURU5DWSwgRGF0ZS5ub3coKSAtIHZlcmlmaWNhdGlvblN0YXJ0VGltZSk7XG4gICAgXG4gICAgaWYgKCFzaWduYXR1cmVWYWxpZGF0aW9uLmlzVmFsaWQpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdTaWduYXR1cmUgdmVyaWZpY2F0aW9uIGZhaWxlZCcsIHtcbiAgICAgICAgZXJyb3JDb2RlOiBzaWduYXR1cmVWYWxpZGF0aW9uLmludmFsaWRSZWFzb24sXG4gICAgICAgIHBheWVyLFxuICAgICAgfSk7XG4gICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlBBWU1FTlRfRkFJTEVEKTtcbiAgICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgICAgbG9nZ2VyLmVtaXRNZXRyaWNzKCk7XG4gICAgICByZXR1cm4gY3JlYXRlNDAyUmVzcG9uc2UoXG4gICAgICAgIHVyaSxcbiAgICAgICAgcGF5bWVudFJlcXVpcmVtZW50LFxuICAgICAgICBgU2lnbmF0dXJlIHZlcmlmaWNhdGlvbiBmYWlsZWQ6ICR7c2lnbmF0dXJlVmFsaWRhdGlvbi5pbnZhbGlkUmVhc29ufWBcbiAgICAgICk7XG4gICAgfVxuXG4gICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5QQVlNRU5UX1ZFUklGSUVEKTtcbiAgICBsb2dnZXIuaW5mbygnUGF5bWVudCBzaWduYXR1cmUgdmVyaWZpZWQnLCB7IHBheWVyIH0pO1xuXG4gICAgLy8gU2V0dGxlIHBheW1lbnQgd2l0aCBmYWNpbGl0YXRvclxuICAgIGNvbnN0IHNldHRsZW1lbnRTdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IHNldHRsZW1lbnQgPSBhd2FpdCBzZXR0bGVQYXltZW50V2l0aEZhY2lsaXRhdG9yKFxuICAgICAgcGF5bWVudFBheWxvYWQsXG4gICAgICBwYXltZW50UmVxdWlyZW1lbnQsXG4gICAgICBsb2dnZXJcbiAgICApO1xuICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5TRVRUTEVNRU5UX0xBVEVOQ1ksIERhdGUubm93KCkgLSBzZXR0bGVtZW50U3RhcnRUaW1lKTtcbiAgICBcbiAgICBpZiAoIXNldHRsZW1lbnQuc3VjY2Vzcykge1xuICAgICAgbG9nZ2VyLmVycm9yKCdQYXltZW50IHNldHRsZW1lbnQgZmFpbGVkJywgdW5kZWZpbmVkLCB7XG4gICAgICAgIGVycm9yQ29kZTogc2V0dGxlbWVudC5lcnJvclJlYXNvbixcbiAgICAgICAgcGF5ZXIsXG4gICAgICB9KTtcbiAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuUEFZTUVOVF9GQUlMRUQpO1xuICAgICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLkxBVEVOQ1ksIGxvZ2dlci5nZXRFbGFwc2VkTXMoKSk7XG4gICAgICBsb2dnZXIuZW1pdE1ldHJpY3MoKTtcbiAgICAgIHJldHVybiBjcmVhdGVFcnJvclJlc3BvbnNlKFxuICAgICAgICAnNDAyJyxcbiAgICAgICAgJ1BheW1lbnQgUmVxdWlyZWQnLFxuICAgICAgICAnU2V0dGxlbWVudCBGYWlsZWQnLFxuICAgICAgICBgUGF5bWVudCBzZXR0bGVtZW50IGZhaWxlZDogJHtzZXR0bGVtZW50LmVycm9yUmVhc29ufWBcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gUGF5bWVudCB2ZXJpZmllZCBhbmQgc2V0dGxlZCAtIHJldHVybiBkeW5hbWljIGNvbnRlbnRcbiAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlBBWU1FTlRfU0VUVExFRCk7XG4gICAgXG4gICAgLy8gUmVjb3JkIHBheW1lbnQgYW1vdW50IG1ldHJpY1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBhbW91bnRXZWkgPSBCaWdJbnQocGF5bWVudFBheWxvYWQucGF5bG9hZC5hdXRob3JpemF0aW9uLnZhbHVlKTtcbiAgICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5QQVlNRU5UX0FNT1VOVF9XRUksIE51bWJlcihhbW91bnRXZWkpKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIElnbm9yZSBpZiBhbW91bnQgcGFyc2luZyBmYWlsc1xuICAgIH1cbiAgICBcbiAgICBsb2dnZXIuaW5mbygnUGF5bWVudCBzZXR0bGVkIHN1Y2Nlc3NmdWxseScsIHtcbiAgICAgIHBheWVyLFxuICAgICAgdHJhbnNhY3Rpb25IYXNoOiBzZXR0bGVtZW50LnRyYW5zYWN0aW9uLFxuICAgICAgYW1vdW50OiBwYXltZW50UmVxdWlyZW1lbnQuYW1vdW50LFxuICAgICAgbmV0d29yazogcGF5bWVudFJlcXVpcmVtZW50Lm5ldHdvcmssXG4gICAgfSk7XG5cbiAgICAvLyBHZXQgZHluYW1pYyBjb250ZW50IGZyb20gY29udGVudCBtYW5hZ2VyXG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IGNvbnRlbnRNYW5hZ2VyLmdldENvbnRlbnQodXJpKTtcbiAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLkNPTlRFTlRfR0VORVJBVEVEKTtcbiAgICBcbiAgICAvLyBSZWNvcmQgY29udGVudCBzaXplIG1ldHJpY1xuICAgIGNvbnN0IGNvbnRlbnRKc29uID0gSlNPTi5zdHJpbmdpZnkoY29udGVudCk7XG4gICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLkNPTlRFTlRfQllURVNfU0VSVkVELCBjb250ZW50SnNvbi5sZW5ndGgpO1xuICAgIFxuICAgIC8vIENyZWF0ZSBzZXR0bGVtZW50IHJlc3BvbnNlIGhlYWRlclxuICAgIGNvbnN0IHNldHRsZW1lbnRSZXNwb25zZTogU2V0dGxlbWVudFJlc3BvbnNlID0ge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHRyYW5zYWN0aW9uOiBzZXR0bGVtZW50LnRyYW5zYWN0aW9uLFxuICAgICAgbmV0d29yazogcGF5bWVudFJlcXVpcmVtZW50Lm5ldHdvcmssXG4gICAgICBwYXllcjogcGF5bWVudFBheWxvYWQucGF5bG9hZC5hdXRob3JpemF0aW9uLmZyb20sXG4gICAgfTtcblxuICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJzIwMCcsXG4gICAgICBzdGF0dXNEZXNjcmlwdGlvbjogJ09LJyxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ2NvbnRlbnQtdHlwZSc6IFt7IGtleTogJ0NvbnRlbnQtVHlwZScsIHZhbHVlOiAnYXBwbGljYXRpb24vanNvbicgfV0sXG4gICAgICAgICd4LXBheW1lbnQtcmVzcG9uc2UnOiBbe1xuICAgICAgICAgIGtleTogJ1gtUEFZTUVOVC1SRVNQT05TRScsXG4gICAgICAgICAgdmFsdWU6IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHNldHRsZW1lbnRSZXNwb25zZSkpLnRvU3RyaW5nKCdiYXNlNjQnKSxcbiAgICAgICAgfV0sXG4gICAgICAgICd4LXJlcXVlc3QtaWQnOiBbeyBrZXk6ICdYLVJlcXVlc3QtSWQnLCB2YWx1ZTogcmVxdWVzdElkIH1dLFxuICAgICAgICAnYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luJzogW3sga2V5OiAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgdmFsdWU6ICcqJyB9XSxcbiAgICAgICAgJ2FjY2Vzcy1jb250cm9sLWFsbG93LWhlYWRlcnMnOiBbeyBcbiAgICAgICAgICBrZXk6ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJywgXG4gICAgICAgICAgdmFsdWU6ICdDb250ZW50LVR5cGUsIFgtUGF5bWVudC1TaWduYXR1cmUnIFxuICAgICAgICB9XSxcbiAgICAgICAgJ2FjY2Vzcy1jb250cm9sLWV4cG9zZS1oZWFkZXJzJzogW3sgXG4gICAgICAgICAga2V5OiAnQWNjZXNzLUNvbnRyb2wtRXhwb3NlLUhlYWRlcnMnLCBcbiAgICAgICAgICB2YWx1ZTogJ1gtUEFZTUVOVC1SRVNQT05TRSwgWC1SZXF1ZXN0LUlkJyBcbiAgICAgICAgfV0sXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoY29udGVudCksXG4gICAgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBsb2dnZXIuZXJyb3IoJ1VuZXhwZWN0ZWQgZXJyb3IgcHJvY2Vzc2luZyBwYXltZW50JywgZXJyb3IpO1xuICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuUEFZTUVOVF9GQUlMRUQpO1xuICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgIHJldHVybiBjcmVhdGVFcnJvclJlc3BvbnNlKFxuICAgICAgJzUwMCcsXG4gICAgICAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcbiAgICAgICdQYXltZW50IFByb2Nlc3NpbmcgRXJyb3InLFxuICAgICAgJ0ZhaWxlZCB0byBwcm9jZXNzIHBheW1lbnQnXG4gICAgKTtcbiAgfVxufTtcbiJdfQ==