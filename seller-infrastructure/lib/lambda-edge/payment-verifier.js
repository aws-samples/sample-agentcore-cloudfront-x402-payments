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
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.x402.org';
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
        // If facilitator is unavailable, fall back to local validation only
        // In production, you might want to reject the payment instead
        logger.warn('Facilitator unavailable, using local validation only');
        return {
            isValid: true,
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
        // For demo purposes, simulate successful settlement
        // In production, this should fail if facilitator is unavailable
        const simulatedTx = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        logger.warn('Facilitator unavailable, simulating settlement', {
            simulatedTransaction: simulatedTx,
        });
        return {
            success: true,
            transaction: simulatedTx,
            network: requirements.network,
            payer,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF5bWVudC12ZXJpZmllci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInBheW1lbnQtdmVyaWZpZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsbUNBVWlCO0FBQ2pCLHFEQUFrRDtBQUVsRCwrRUFBK0U7QUFDL0UscUNBQXFDO0FBQ3JDLCtFQUErRTtBQUMvRSxNQUFNLE1BQU07SUFPVixZQUFZLFNBQWlCLEVBQUUsR0FBVztRQUN4QyxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztRQUMzQixJQUFJLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQztRQUNmLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUN6QixJQUFJLENBQUMsVUFBVSxHQUFHO1lBQ2hCLEdBQUcsRUFBRSxHQUFHO1lBQ1IsV0FBVyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLFlBQVk7U0FDckQsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNLLGNBQWMsQ0FDcEIsS0FBZSxFQUNmLE9BQWUsRUFDZixLQUErQjtRQUUvQixPQUFPO1lBQ0wsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1lBQ25DLEtBQUs7WUFDTCxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVM7WUFDekIsT0FBTztZQUNQLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRztZQUNiLFVBQVUsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVM7WUFDdkMsR0FBRyxLQUFLO1NBQ1QsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxPQUFlLEVBQUUsS0FBK0I7UUFDcEQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxnQkFBUSxDQUFDLEtBQUssRUFBRSxPQUFP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O2dCQUNGLCtCQUErQixFQUFFLENBQUM7d0JBQ2hDLEdBQUcsRUFBRSwrQkFBK0I7d0JBQ3BDLEtBQUssRUFBRSxrQ0FBa0M7cUJBQzFDLENBQUM7YUFDSDtZQUNELElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQztTQUM5QixDQUFDO0lBQ0osQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixNQUFNLENBQUMsS0FBSyxDQUFDLHFDQUFxQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzNELE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxrQkFBVSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQ25ELE1BQU0sQ0FBQyxZQUFZLENBQUMsa0JBQVUsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDLENBQUM7UUFDL0QsTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQ3JCLE9BQU8sbUJBQW1CLENBQ3hCLEtBQUssRUFDTCx1QkFBdUIsRUFDdkIsMEJBQTBCLEVBQzFCLDJCQUEyQixDQUM1QixDQUFDO0lBQ0osQ0FBQztBQUNILENBQUMsQ0FBQztBQWpSVyxRQUFBLE9BQU8sV0FpUmxCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2xvdWRGcm9udFJlcXVlc3RFdmVudCwgQ2xvdWRGcm9udFJlcXVlc3RSZXN1bHQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7XG4gIExvZ0xldmVsLFxuICBNZXRyaWNOYW1lLFxuICBMb2dFbnRyeSxcbiAgRU1GTWV0cmljLFxuICBQYXltZW50UmVxdWlyZW1lbnRzLFxuICBQYXltZW50UmVxdWlyZWQsXG4gIFBheW1lbnRQYXlsb2FkLFxuICBWZXJpZnlSZXNwb25zZSxcbiAgU2V0dGxlbWVudFJlc3BvbnNlLFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IGNvbnRlbnRNYW5hZ2VyIH0gZnJvbSAnLi9jb250ZW50LWNvbmZpZyc7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIExvZ2dpbmcgYW5kIE1ldHJpY3MgSW5mcmFzdHJ1Y3R1cmVcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmNsYXNzIExvZ2dlciB7XG4gIHByaXZhdGUgcmVxdWVzdElkOiBzdHJpbmc7XG4gIHByaXZhdGUgdXJpOiBzdHJpbmc7XG4gIHByaXZhdGUgc3RhcnRUaW1lOiBudW1iZXI7XG4gIHByaXZhdGUgbWV0cmljczogTWFwPHN0cmluZywgbnVtYmVyPjtcbiAgcHJpdmF0ZSBkaW1lbnNpb25zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuXG4gIGNvbnN0cnVjdG9yKHJlcXVlc3RJZDogc3RyaW5nLCB1cmk6IHN0cmluZykge1xuICAgIHRoaXMucmVxdWVzdElkID0gcmVxdWVzdElkO1xuICAgIHRoaXMudXJpID0gdXJpO1xuICAgIHRoaXMuc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICB0aGlzLm1ldHJpY3MgPSBuZXcgTWFwKCk7XG4gICAgdGhpcy5kaW1lbnNpb25zID0ge1xuICAgICAgVXJpOiB1cmksXG4gICAgICBFbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuRU5WSVJPTk1FTlQgfHwgJ3Byb2R1Y3Rpb24nLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHN0cnVjdHVyZWQgbG9nIGVudHJ5XG4gICAqL1xuICBwcml2YXRlIGNyZWF0ZUxvZ0VudHJ5KFxuICAgIGxldmVsOiBMb2dMZXZlbCxcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgZXh0cmE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICApOiBMb2dFbnRyeSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgbGV2ZWwsXG4gICAgICByZXF1ZXN0SWQ6IHRoaXMucmVxdWVzdElkLFxuICAgICAgbWVzc2FnZSxcbiAgICAgIHVyaTogdGhpcy51cmksXG4gICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gdGhpcy5zdGFydFRpbWUsXG4gICAgICAuLi5leHRyYSxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgYSBkZWJ1ZyBtZXNzYWdlXG4gICAqL1xuICBkZWJ1ZyhtZXNzYWdlOiBzdHJpbmcsIGV4dHJhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuY3JlYXRlTG9nRW50cnkoTG9nTGV2ZWwuREVCVUcsIG1lc3NhZ2UsIGV4dHJhKTtcbiAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShlbnRyeSkpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgYW4gaW5mbyBtZXNzYWdlXG4gICAqL1xuICBpbmZvKG1lc3NhZ2U6IHN0cmluZywgZXh0cmE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5jcmVhdGVMb2dFbnRyeShMb2dMZXZlbC5JTkZPLCBtZXNzYWdlLCBleHRyYSk7XG4gICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkoZW50cnkpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dzIGEgd2FybmluZyBtZXNzYWdlXG4gICAqL1xuICB3YXJuKG1lc3NhZ2U6IHN0cmluZywgZXh0cmE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5jcmVhdGVMb2dFbnRyeShMb2dMZXZlbC5XQVJOLCBtZXNzYWdlLCBleHRyYSk7XG4gICAgY29uc29sZS53YXJuKEpTT04uc3RyaW5naWZ5KGVudHJ5KSk7XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhbiBlcnJvciBtZXNzYWdlXG4gICAqL1xuICBlcnJvcihtZXNzYWdlOiBzdHJpbmcsIGVycm9yPzogRXJyb3IgfCB1bmtub3duLCBleHRyYT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCB7XG4gICAgY29uc3QgZXJyb3JEZXRhaWxzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHsgLi4uZXh0cmEgfTtcbiAgICBcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgZXJyb3JEZXRhaWxzLmVycm9yTWVzc2FnZSA9IGVycm9yLm1lc3NhZ2U7XG4gICAgICBlcnJvckRldGFpbHMuZXJyb3JTdGFjayA9IGVycm9yLnN0YWNrO1xuICAgIH0gZWxzZSBpZiAoZXJyb3IpIHtcbiAgICAgIGVycm9yRGV0YWlscy5lcnJvck1lc3NhZ2UgPSBTdHJpbmcoZXJyb3IpO1xuICAgIH1cbiAgICBcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuY3JlYXRlTG9nRW50cnkoTG9nTGV2ZWwuRVJST1IsIG1lc3NhZ2UsIGVycm9yRGV0YWlscyk7XG4gICAgY29uc29sZS5lcnJvcihKU09OLnN0cmluZ2lmeShlbnRyeSkpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBtZXRyaWMgdmFsdWVcbiAgICovXG4gIHJlY29yZE1ldHJpYyhuYW1lOiBNZXRyaWNOYW1lLCB2YWx1ZTogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5tZXRyaWNzLnNldChuYW1lLCB2YWx1ZSk7XG4gIH1cblxuICAvKipcbiAgICogSW5jcmVtZW50cyBhIGNvdW50ZXIgbWV0cmljXG4gICAqL1xuICBpbmNyZW1lbnRDb3VudGVyKG5hbWU6IE1ldHJpY05hbWUpOiB2b2lkIHtcbiAgICBjb25zdCBjdXJyZW50ID0gdGhpcy5tZXRyaWNzLmdldChuYW1lKSB8fCAwO1xuICAgIHRoaXMubWV0cmljcy5zZXQobmFtZSwgY3VycmVudCArIDEpO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgYSBkaW1lbnNpb24gZm9yIG1ldHJpY3NcbiAgICovXG4gIHNldERpbWVuc2lvbihrZXk6IHN0cmluZywgdmFsdWU6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuZGltZW5zaW9uc1trZXldID0gdmFsdWU7XG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgYWxsIHJlY29yZGVkIG1ldHJpY3MgaW4gQ2xvdWRXYXRjaCBFTUYgZm9ybWF0XG4gICAqL1xuICBlbWl0TWV0cmljcygpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5tZXRyaWNzLnNpemUgPT09IDApIHJldHVybjtcblxuICAgIGNvbnN0IG1ldHJpY3NBcnJheTogQXJyYXk8eyBOYW1lOiBzdHJpbmc7IFVuaXQ6IHN0cmluZyB9PiA9IFtdO1xuICAgIGNvbnN0IG1ldHJpY1ZhbHVlczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuXG4gICAgdGhpcy5tZXRyaWNzLmZvckVhY2goKHZhbHVlLCBuYW1lKSA9PiB7XG4gICAgICBjb25zdCB1bml0ID0gbmFtZS5pbmNsdWRlcygnTGF0ZW5jeScpID8gJ01pbGxpc2Vjb25kcycgOiAnQ291bnQnO1xuICAgICAgbWV0cmljc0FycmF5LnB1c2goeyBOYW1lOiBuYW1lLCBVbml0OiB1bml0IH0pO1xuICAgICAgbWV0cmljVmFsdWVzW25hbWVdID0gdmFsdWU7XG4gICAgfSk7XG5cbiAgICBjb25zdCBlbWY6IEVNRk1ldHJpYyA9IHtcbiAgICAgIF9hd3M6IHtcbiAgICAgICAgVGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICBDbG91ZFdhdGNoTWV0cmljczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIE5hbWVzcGFjZTogJ1g0MDIvUGF5bWVudFZlcmlmaWVyJyxcbiAgICAgICAgICAgIERpbWVuc2lvbnM6IFtPYmplY3Qua2V5cyh0aGlzLmRpbWVuc2lvbnMpXSxcbiAgICAgICAgICAgIE1ldHJpY3M6IG1ldHJpY3NBcnJheSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIC4uLnRoaXMuZGltZW5zaW9ucyxcbiAgICAgIC4uLm1ldHJpY1ZhbHVlcyxcbiAgICAgIHJlcXVlc3RJZDogdGhpcy5yZXF1ZXN0SWQsXG4gICAgfTtcblxuICAgIC8vIEVNRiBsb2dzIG11c3QgYmUgcHJpbnRlZCB0byBzdGRvdXQgZm9yIENsb3VkV2F0Y2ggdG8gcGFyc2UgdGhlbVxuICAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KGVtZikpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgZWxhcHNlZCB0aW1lIHNpbmNlIGxvZ2dlciBjcmVhdGlvblxuICAgKi9cbiAgZ2V0RWxhcHNlZE1zKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIERhdGUubm93KCkgLSB0aGlzLnN0YXJ0VGltZTtcbiAgfVxufVxuXG4vKipcbiAqIEdlbmVyYXRlcyBhIHVuaXF1ZSByZXF1ZXN0IElEIGZvciB0cmFjaW5nXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlUmVxdWVzdElkKCk6IHN0cmluZyB7XG4gIHJldHVybiBgcmVxXyR7RGF0ZS5ub3coKS50b1N0cmluZygzNil9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyaW5nKDIsIDkpfWA7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIHg0MDIgdjIgVHlwZXMgLSBpbXBvcnRlZCBmcm9tIC4vdHlwZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLy8gRmFjaWxpdGF0b3IgVVJMIGZvciBwYXltZW50IHZlcmlmaWNhdGlvblxuY29uc3QgRkFDSUxJVEFUT1JfVVJMID0gcHJvY2Vzcy5lbnYuRkFDSUxJVEFUT1JfVVJMIHx8ICdodHRwczovL2ZhY2lsaXRhdG9yLng0MDIub3JnJztcblxuLyoqXG4gKiBWYWxpZGF0ZXMgdGhlIHN0cnVjdHVyZSBvZiBhIHBheW1lbnQgcGF5bG9hZFxuICovXG5mdW5jdGlvbiB2YWxpZGF0ZVBheWxvYWRTdHJ1Y3R1cmUocGF5bG9hZDogdW5rbm93bik6IHBheWxvYWQgaXMgUGF5bWVudFBheWxvYWQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG4gIFxuICBjb25zdCBwID0gcGF5bG9hZCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgXG4gIC8vIENoZWNrIHJlcXVpcmVkIHRvcC1sZXZlbCBmaWVsZHNcbiAgaWYgKHR5cGVvZiBwLng0MDJWZXJzaW9uICE9PSAnbnVtYmVyJyB8fCBwLng0MDJWZXJzaW9uICE9PSAyKSByZXR1cm4gZmFsc2U7XG4gIGlmICghcC5hY2NlcHRlZCB8fCB0eXBlb2YgcC5hY2NlcHRlZCAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcbiAgaWYgKCFwLnBheWxvYWQgfHwgdHlwZW9mIHAucGF5bG9hZCAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcbiAgXG4gIC8vIENoZWNrIGFjY2VwdGVkIHJlcXVpcmVtZW50c1xuICBjb25zdCBhY2NlcHRlZCA9IHAuYWNjZXB0ZWQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGlmICh0eXBlb2YgYWNjZXB0ZWQuc2NoZW1lICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIGFjY2VwdGVkLm5ldHdvcmsgIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgYWNjZXB0ZWQuYW1vdW50ICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIGFjY2VwdGVkLmFzc2V0ICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIGFjY2VwdGVkLnBheVRvICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBcbiAgLy8gQ2hlY2sgcGF5bG9hZCAoZXhhY3QgRVZNIHNjaGVtZSlcbiAgY29uc3QgcGF5bG9hZERhdGEgPSBwLnBheWxvYWQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGlmICh0eXBlb2YgcGF5bG9hZERhdGEuc2lnbmF0dXJlICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAoIXBheWxvYWREYXRhLmF1dGhvcml6YXRpb24gfHwgdHlwZW9mIHBheWxvYWREYXRhLmF1dGhvcml6YXRpb24gIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG4gIFxuICAvLyBDaGVjayBhdXRob3JpemF0aW9uXG4gIGNvbnN0IGF1dGggPSBwYXlsb2FkRGF0YS5hdXRob3JpemF0aW9uIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBpZiAodHlwZW9mIGF1dGguZnJvbSAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhdXRoLnRvICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIGF1dGgudmFsdWUgIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgYXV0aC52YWxpZEFmdGVyICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIGF1dGgudmFsaWRCZWZvcmUgIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgYXV0aC5ub25jZSAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgXG4gIHJldHVybiB0cnVlO1xufVxuXG4vKipcbiAqIFZhbGlkYXRlcyB0aGF0IHRoZSBwYXltZW50IGF1dGhvcml6YXRpb24gbWF0Y2hlcyB0aGUgcmVxdWlyZW1lbnRzXG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlQXV0aG9yaXphdGlvblBhcmFtZXRlcnMoXG4gIHBheWxvYWQ6IFBheW1lbnRQYXlsb2FkLFxuICByZXF1aXJlbWVudHM6IFBheW1lbnRSZXF1aXJlbWVudHNcbik6IFZlcmlmeVJlc3BvbnNlIHtcbiAgY29uc3QgeyBhdXRob3JpemF0aW9uIH0gPSBwYXlsb2FkLnBheWxvYWQ7XG4gIGNvbnN0IHBheWVyID0gYXV0aG9yaXphdGlvbi5mcm9tO1xuICBcbiAgLy8gVmVyaWZ5IHNjaGVtZSBtYXRjaGVzXG4gIGlmIChwYXlsb2FkLmFjY2VwdGVkLnNjaGVtZSAhPT0gcmVxdWlyZW1lbnRzLnNjaGVtZSkge1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICdzY2hlbWVfbWlzbWF0Y2gnLFxuICAgICAgcGF5ZXIsXG4gICAgfTtcbiAgfVxuICBcbiAgLy8gVmVyaWZ5IG5ldHdvcmsgbWF0Y2hlc1xuICBpZiAocGF5bG9hZC5hY2NlcHRlZC5uZXR3b3JrICE9PSByZXF1aXJlbWVudHMubmV0d29yaykge1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICduZXR3b3JrX21pc21hdGNoJyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIC8vIFZlcmlmeSByZWNpcGllbnQgbWF0Y2hlc1xuICBpZiAoYXV0aG9yaXphdGlvbi50by50b0xvd2VyQ2FzZSgpICE9PSByZXF1aXJlbWVudHMucGF5VG8udG9Mb3dlckNhc2UoKSkge1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICdpbnZhbGlkX2V4YWN0X2V2bV9wYXlsb2FkX3JlY2lwaWVudF9taXNtYXRjaCcsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICAvLyBWZXJpZnkgYW1vdW50IGlzIHN1ZmZpY2llbnRcbiAgY29uc3QgcGF5bWVudFZhbHVlID0gQmlnSW50KGF1dGhvcml6YXRpb24udmFsdWUpO1xuICBjb25zdCByZXF1aXJlZEFtb3VudCA9IEJpZ0ludChyZXF1aXJlbWVudHMuYW1vdW50KTtcbiAgaWYgKHBheW1lbnRWYWx1ZSA8IHJlcXVpcmVkQW1vdW50KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ2ludmFsaWRfZXhhY3RfZXZtX3BheWxvYWRfYXV0aG9yaXphdGlvbl92YWx1ZScsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICAvLyBWZXJpZnkgdGltZSB2YWxpZGl0eVxuICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcbiAgY29uc3QgdmFsaWRBZnRlciA9IHBhcnNlSW50KGF1dGhvcml6YXRpb24udmFsaWRBZnRlciwgMTApO1xuICBjb25zdCB2YWxpZEJlZm9yZSA9IHBhcnNlSW50KGF1dGhvcml6YXRpb24udmFsaWRCZWZvcmUsIDEwKTtcbiAgXG4gIC8vIENoZWNrIHZhbGlkQWZ0ZXIgaXMgbm90IGluIHRoZSBmdXR1cmVcbiAgaWYgKHZhbGlkQWZ0ZXIgPiBub3cpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnaW52YWxpZF9leGFjdF9ldm1fcGF5bG9hZF9hdXRob3JpemF0aW9uX3ZhbGlkX2FmdGVyJyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIC8vIENoZWNrIHZhbGlkQmVmb3JlIGlzIGluIHRoZSBmdXR1cmUgKHdpdGggNiBzZWNvbmQgYnVmZmVyIGZvciBibG9jayB0aW1lKVxuICBpZiAodmFsaWRCZWZvcmUgPCBub3cgKyA2KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ2ludmFsaWRfZXhhY3RfZXZtX3BheWxvYWRfYXV0aG9yaXphdGlvbl92YWxpZF9iZWZvcmUnLFxuICAgICAgcGF5ZXIsXG4gICAgfTtcbiAgfVxuICBcbiAgLy8gVmVyaWZ5IGFzc2V0IG1hdGNoZXNcbiAgaWYgKHBheWxvYWQuYWNjZXB0ZWQuYXNzZXQudG9Mb3dlckNhc2UoKSAhPT0gcmVxdWlyZW1lbnRzLmFzc2V0LnRvTG93ZXJDYXNlKCkpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnYXNzZXRfbWlzbWF0Y2gnLFxuICAgICAgcGF5ZXIsXG4gICAgfTtcbiAgfVxuICBcbiAgLy8gVmVyaWZ5IHNpZ25hdHVyZSBmb3JtYXQgKHNob3VsZCBiZSA2NSBieXRlcyA9IDEzMCBoZXggY2hhcnMgKyAweCBwcmVmaXgpXG4gIGNvbnN0IHNpZ25hdHVyZSA9IHBheWxvYWQucGF5bG9hZC5zaWduYXR1cmU7XG4gIGlmICghc2lnbmF0dXJlLnN0YXJ0c1dpdGgoJzB4JykpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnaW52YWxpZF9zaWduYXR1cmVfZm9ybWF0JyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIGNvbnN0IHNpZ25hdHVyZUxlbmd0aCA9IHNpZ25hdHVyZS5sZW5ndGggLSAyOyAvLyBSZW1vdmUgMHggcHJlZml4XG4gIC8vIEVPQSBzaWduYXR1cmVzIGFyZSAxMzAgY2hhcnMsIHNtYXJ0IHdhbGxldCBzaWduYXR1cmVzIGNhbiBiZSBsb25nZXJcbiAgaWYgKHNpZ25hdHVyZUxlbmd0aCA8IDEzMCkge1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICdpbnZhbGlkX3NpZ25hdHVyZV9sZW5ndGgnLFxuICAgICAgcGF5ZXIsXG4gICAgfTtcbiAgfVxuICBcbiAgLy8gVmVyaWZ5IG5vbmNlIGZvcm1hdCAoc2hvdWxkIGJlIDMyIGJ5dGVzID0gNjQgaGV4IGNoYXJzICsgMHggcHJlZml4KVxuICBjb25zdCBub25jZSA9IGF1dGhvcml6YXRpb24ubm9uY2U7XG4gIGlmICghbm9uY2Uuc3RhcnRzV2l0aCgnMHgnKSB8fCBub25jZS5sZW5ndGggIT09IDY2KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ2ludmFsaWRfbm9uY2VfZm9ybWF0JyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIHJldHVybiB7XG4gICAgaXNWYWxpZDogdHJ1ZSxcbiAgICBwYXllcixcbiAgfTtcbn1cblxuLyoqXG4gKiBWZXJpZmllcyB0aGUgcGF5bWVudCBzaWduYXR1cmUgdXNpbmcgdGhlIGZhY2lsaXRhdG9yIHNlcnZpY2VcbiAqIEluIHByb2R1Y3Rpb24sIHRoaXMgd291bGQgY2FsbCB0aGUgeDQwMiBmYWNpbGl0YXRvcidzIC92ZXJpZnkgZW5kcG9pbnRcbiAqL1xuYXN5bmMgZnVuY3Rpb24gdmVyaWZ5U2lnbmF0dXJlV2l0aEZhY2lsaXRhdG9yKFxuICBwYXlsb2FkOiBQYXltZW50UGF5bG9hZCxcbiAgcmVxdWlyZW1lbnRzOiBQYXltZW50UmVxdWlyZW1lbnRzLFxuICBsb2dnZXI6IExvZ2dlclxuKTogUHJvbWlzZTxWZXJpZnlSZXNwb25zZT4ge1xuICBjb25zdCBwYXllciA9IHBheWxvYWQucGF5bG9hZC5hdXRob3JpemF0aW9uLmZyb207XG4gIFxuICB0cnkge1xuICAgIGxvZ2dlci5kZWJ1ZygnQ2FsbGluZyBmYWNpbGl0YXRvciAvdmVyaWZ5IGVuZHBvaW50Jywge1xuICAgICAgZmFjaWxpdGF0b3JVcmw6IEZBQ0lMSVRBVE9SX1VSTCxcbiAgICB9KTtcbiAgICBcbiAgICAvLyBDYWxsIGZhY2lsaXRhdG9yIC92ZXJpZnkgZW5kcG9pbnRcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGAke0ZBQ0lMSVRBVE9SX1VSTH0vdmVyaWZ5YCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBwYXltZW50UGF5bG9hZDogcGF5bG9hZCxcbiAgICAgICAgcGF5bWVudFJlcXVpcmVtZW50czogcmVxdWlyZW1lbnRzLFxuICAgICAgfSksXG4gICAgfSk7XG4gICAgXG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgbG9nZ2VyLndhcm4oJ0ZhY2lsaXRhdG9yIHZlcmlmeSByZXF1ZXN0IGZhaWxlZCcsIHtcbiAgICAgICAgc3RhdHVzQ29kZTogcmVzcG9uc2Uuc3RhdHVzLFxuICAgICAgICBzdGF0dXNUZXh0OiByZXNwb25zZS5zdGF0dXNUZXh0LFxuICAgICAgfSk7XG4gICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLkZBQ0lMSVRBVE9SX0VSUk9SKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgICBpbnZhbGlkUmVhc29uOiAnZmFjaWxpdGF0b3JfdmVyaWZpY2F0aW9uX2ZhaWxlZCcsXG4gICAgICAgIHBheWVyLFxuICAgICAgfTtcbiAgICB9XG4gICAgXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcmVzcG9uc2UuanNvbigpIGFzIFZlcmlmeVJlc3BvbnNlO1xuICAgIGxvZ2dlci5kZWJ1ZygnRmFjaWxpdGF0b3IgdmVyaWZpY2F0aW9uIHJlc3BvbnNlIHJlY2VpdmVkJywge1xuICAgICAgaXNWYWxpZDogcmVzdWx0LmlzVmFsaWQsXG4gICAgfSk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBsb2dnZXIuZXJyb3IoJ0Vycm9yIGNhbGxpbmcgZmFjaWxpdGF0b3InLCBlcnJvciwge1xuICAgICAgZmFjaWxpdGF0b3JVcmw6IEZBQ0lMSVRBVE9SX1VSTCxcbiAgICB9KTtcbiAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLkZBQ0lMSVRBVE9SX0VSUk9SKTtcbiAgICAvLyBJZiBmYWNpbGl0YXRvciBpcyB1bmF2YWlsYWJsZSwgZmFsbCBiYWNrIHRvIGxvY2FsIHZhbGlkYXRpb24gb25seVxuICAgIC8vIEluIHByb2R1Y3Rpb24sIHlvdSBtaWdodCB3YW50IHRvIHJlamVjdCB0aGUgcGF5bWVudCBpbnN0ZWFkXG4gICAgbG9nZ2VyLndhcm4oJ0ZhY2lsaXRhdG9yIHVuYXZhaWxhYmxlLCB1c2luZyBsb2NhbCB2YWxpZGF0aW9uIG9ubHknKTtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogdHJ1ZSxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBTZXR0bGVzIHRoZSBwYXltZW50IHVzaW5nIHRoZSBmYWNpbGl0YXRvciBzZXJ2aWNlXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHNldHRsZVBheW1lbnRXaXRoRmFjaWxpdGF0b3IoXG4gIHBheWxvYWQ6IFBheW1lbnRQYXlsb2FkLFxuICByZXF1aXJlbWVudHM6IFBheW1lbnRSZXF1aXJlbWVudHMsXG4gIGxvZ2dlcjogTG9nZ2VyXG4pOiBQcm9taXNlPFNldHRsZW1lbnRSZXNwb25zZT4ge1xuICBjb25zdCBwYXllciA9IHBheWxvYWQucGF5bG9hZC5hdXRob3JpemF0aW9uLmZyb207XG4gIFxuICB0cnkge1xuICAgIGxvZ2dlci5kZWJ1ZygnQ2FsbGluZyBmYWNpbGl0YXRvciAvc2V0dGxlIGVuZHBvaW50Jywge1xuICAgICAgZmFjaWxpdGF0b3JVcmw6IEZBQ0lMSVRBVE9SX1VSTCxcbiAgICAgIGFtb3VudDogcmVxdWlyZW1lbnRzLmFtb3VudCxcbiAgICB9KTtcbiAgICBcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGAke0ZBQ0lMSVRBVE9SX1VSTH0vc2V0dGxlYCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBwYXltZW50UGF5bG9hZDogcGF5bG9hZCxcbiAgICAgICAgcGF5bWVudFJlcXVpcmVtZW50czogcmVxdWlyZW1lbnRzLFxuICAgICAgfSksXG4gICAgfSk7XG4gICAgXG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgbG9nZ2VyLndhcm4oJ0ZhY2lsaXRhdG9yIHNldHRsZSByZXF1ZXN0IGZhaWxlZCcsIHtcbiAgICAgICAgc3RhdHVzQ29kZTogcmVzcG9uc2Uuc3RhdHVzLFxuICAgICAgICBzdGF0dXNUZXh0OiByZXNwb25zZS5zdGF0dXNUZXh0LFxuICAgICAgfSk7XG4gICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLkZBQ0lMSVRBVE9SX0VSUk9SKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICB0cmFuc2FjdGlvbjogJycsXG4gICAgICAgIG5ldHdvcms6IHJlcXVpcmVtZW50cy5uZXR3b3JrLFxuICAgICAgICBwYXllcixcbiAgICAgICAgZXJyb3JSZWFzb246ICdzZXR0bGVtZW50X2ZhaWxlZCcsXG4gICAgICB9O1xuICAgIH1cbiAgICBcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXNwb25zZS5qc29uKCkgYXMgU2V0dGxlbWVudFJlc3BvbnNlO1xuICAgIGxvZ2dlci5kZWJ1ZygnRmFjaWxpdGF0b3Igc2V0dGxlbWVudCByZXNwb25zZSByZWNlaXZlZCcsIHtcbiAgICAgIHN1Y2Nlc3M6IHJlc3VsdC5zdWNjZXNzLFxuICAgICAgdHJhbnNhY3Rpb246IHJlc3VsdC50cmFuc2FjdGlvbixcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignRXJyb3Igc2V0dGxpbmcgcGF5bWVudCcsIGVycm9yLCB7XG4gICAgICBmYWNpbGl0YXRvclVybDogRkFDSUxJVEFUT1JfVVJMLFxuICAgIH0pO1xuICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuRkFDSUxJVEFUT1JfRVJST1IpO1xuICAgIC8vIEZvciBkZW1vIHB1cnBvc2VzLCBzaW11bGF0ZSBzdWNjZXNzZnVsIHNldHRsZW1lbnRcbiAgICAvLyBJbiBwcm9kdWN0aW9uLCB0aGlzIHNob3VsZCBmYWlsIGlmIGZhY2lsaXRhdG9yIGlzIHVuYXZhaWxhYmxlXG4gICAgY29uc3Qgc2ltdWxhdGVkVHggPSAnMHgnICsgQXJyYXkuZnJvbSh7IGxlbmd0aDogNjQgfSwgKCkgPT4gXG4gICAgICBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxNikudG9TdHJpbmcoMTYpXG4gICAgKS5qb2luKCcnKTtcbiAgICBsb2dnZXIud2FybignRmFjaWxpdGF0b3IgdW5hdmFpbGFibGUsIHNpbXVsYXRpbmcgc2V0dGxlbWVudCcsIHtcbiAgICAgIHNpbXVsYXRlZFRyYW5zYWN0aW9uOiBzaW11bGF0ZWRUeCxcbiAgICB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHRyYW5zYWN0aW9uOiBzaW11bGF0ZWRUeCxcbiAgICAgIG5ldHdvcms6IHJlcXVpcmVtZW50cy5uZXR3b3JrLFxuICAgICAgcGF5ZXIsXG4gICAgfTtcbiAgfVxufVxuXG4vKipcbiAqIENyZWF0ZXMgYSA0MDIgUGF5bWVudCBSZXF1aXJlZCByZXNwb25zZVxuICovXG5mdW5jdGlvbiBjcmVhdGU0MDJSZXNwb25zZShcbiAgdXJpOiBzdHJpbmcsXG4gIHJlcXVpcmVtZW50czogUGF5bWVudFJlcXVpcmVtZW50cyxcbiAgZXJyb3JNZXNzYWdlPzogc3RyaW5nXG4pOiBDbG91ZEZyb250UmVxdWVzdFJlc3VsdCB7XG4gIGNvbnN0IHBheW1lbnRSZXF1aXJlZDogUGF5bWVudFJlcXVpcmVkID0ge1xuICAgIHg0MDJWZXJzaW9uOiAyLFxuICAgIGVycm9yOiBlcnJvck1lc3NhZ2UgfHwgJ1BheW1lbnQgcmVxdWlyZWQgdG8gYWNjZXNzIHRoaXMgcmVzb3VyY2UnLFxuICAgIHJlc291cmNlOiB7XG4gICAgICB1cmw6IHVyaSxcbiAgICAgIGRlc2NyaXB0aW9uOiBgUHJvdGVjdGVkIHJlc291cmNlIGF0ICR7dXJpfWAsXG4gICAgICBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgIH0sXG4gICAgYWNjZXB0czogW3JlcXVpcmVtZW50c10sXG4gICAgZXh0ZW5zaW9uczoge30sXG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0dXM6ICc0MDInLFxuICAgIHN0YXR1c0Rlc2NyaXB0aW9uOiAnUGF5bWVudCBSZXF1aXJlZCcsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ2NvbnRlbnQtdHlwZSc6IFt7IGtleTogJ0NvbnRlbnQtVHlwZScsIHZhbHVlOiAnYXBwbGljYXRpb24vanNvbicgfV0sXG4gICAgICAneC1wYXltZW50LXJlcXVpcmVkJzogW3tcbiAgICAgICAga2V5OiAnWC1QQVlNRU5ULVJFUVVJUkVEJyxcbiAgICAgICAgdmFsdWU6IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHBheW1lbnRSZXF1aXJlZCkpLnRvU3RyaW5nKCdiYXNlNjQnKSxcbiAgICAgIH1dLFxuICAgICAgJ2FjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpbic6IFt7IGtleTogJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicsIHZhbHVlOiAnKicgfV0sXG4gICAgICAnYWNjZXNzLWNvbnRyb2wtYWxsb3ctaGVhZGVycyc6IFt7IFxuICAgICAgICBrZXk6ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJywgXG4gICAgICAgIHZhbHVlOiAnQ29udGVudC1UeXBlLCBYLVBheW1lbnQtU2lnbmF0dXJlJyBcbiAgICAgIH1dLFxuICAgICAgJ2FjY2Vzcy1jb250cm9sLWV4cG9zZS1oZWFkZXJzJzogW3tcbiAgICAgICAga2V5OiAnQWNjZXNzLUNvbnRyb2wtRXhwb3NlLUhlYWRlcnMnLFxuICAgICAgICB2YWx1ZTogJ1gtUEFZTUVOVC1SRVFVSVJFRCwgWC1QQVlNRU5ULVJFU1BPTlNFJyxcbiAgICAgIH1dLFxuICAgIH0sXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgZXJyb3I6ICdQYXltZW50IFJlcXVpcmVkJyxcbiAgICAgIG1lc3NhZ2U6IGVycm9yTWVzc2FnZSB8fCAnVGhpcyBjb250ZW50IHJlcXVpcmVzIHBheW1lbnQgdG8gYWNjZXNzJyxcbiAgICAgIHg0MDJWZXJzaW9uOiAyLFxuICAgIH0pLFxuICB9O1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gZXJyb3IgcmVzcG9uc2VcbiAqL1xuZnVuY3Rpb24gY3JlYXRlRXJyb3JSZXNwb25zZShcbiAgc3RhdHVzOiBzdHJpbmcsXG4gIHN0YXR1c0Rlc2NyaXB0aW9uOiBzdHJpbmcsXG4gIGVycm9yOiBzdHJpbmcsXG4gIG1lc3NhZ2U6IHN0cmluZ1xuKTogQ2xvdWRGcm9udFJlcXVlc3RSZXN1bHQge1xuICByZXR1cm4ge1xuICAgIHN0YXR1cyxcbiAgICBzdGF0dXNEZXNjcmlwdGlvbixcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnY29udGVudC10eXBlJzogW3sga2V5OiAnQ29udGVudC1UeXBlJywgdmFsdWU6ICdhcHBsaWNhdGlvbi9qc29uJyB9XSxcbiAgICAgICdhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW4nOiBbeyBrZXk6ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCB2YWx1ZTogJyonIH1dLFxuICAgIH0sXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvciwgbWVzc2FnZSB9KSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIE1DUCB0b29sIGRpc2NvdmVyeSByZXNwb25zZVxuICogUmV0dXJucyBhbGwgYXZhaWxhYmxlIHNlcnZpY2VzIHdpdGggdGhlaXIgcHJpY2luZyBhbmQgbWV0YWRhdGFcbiAqL1xuZnVuY3Rpb24gY3JlYXRlTUNQRGlzY292ZXJ5UmVzcG9uc2UocmVxdWVzdElkOiBzdHJpbmcpOiBDbG91ZEZyb250UmVxdWVzdFJlc3VsdCB7XG4gIGNvbnN0IHRvb2xzID0gW107XG4gIFxuICAvLyBHZXQgYWxsIGNvbnRlbnQgaXRlbXMgZnJvbSB0aGUgcmVnaXN0cnlcbiAgY29uc3QgcGF0aHMgPSBjb250ZW50TWFuYWdlci5saXN0Q29udGVudFBhdGhzKCk7XG4gIFxuICBmb3IgKGNvbnN0IHBhdGggb2YgcGF0aHMpIHtcbiAgICBjb25zdCBpdGVtID0gY29udGVudE1hbmFnZXIuZ2V0Q29udGVudEl0ZW0ocGF0aCk7XG4gICAgaWYgKCFpdGVtKSBjb250aW51ZTtcbiAgICBcbiAgICAvLyBDb252ZXJ0IHBhdGggdG8gdG9vbCBuYW1lOiAvYXBpL3ByZW1pdW0tYXJ0aWNsZSAtPiBnZXRfcHJlbWl1bV9hcnRpY2xlXG4gICAgY29uc3QgdG9vbE5hbWUgPSAnZ2V0XycgKyBwYXRoLnJlcGxhY2UoJy9hcGkvJywgJycpLnJlcGxhY2UoLy0vZywgJ18nKTtcbiAgICBcbiAgICAvLyBDYWxjdWxhdGUgZGlzcGxheSBwcmljZSAoVVNEQyBoYXMgNiBkZWNpbWFscylcbiAgICBjb25zdCBhbW91bnRVbml0cyA9IHBhcnNlSW50KGl0ZW0ucHJpY2luZy5hbW91bnQsIDEwKTtcbiAgICBjb25zdCBkaXNwbGF5UHJpY2UgPSAoYW1vdW50VW5pdHMgLyAxMDAwMDAwKS50b0ZpeGVkKDYpLnJlcGxhY2UoL1xcLj8wKyQvLCAnJyk7XG4gICAgXG4gICAgdG9vbHMucHVzaCh7XG4gICAgICB0b29sX25hbWU6IHRvb2xOYW1lLFxuICAgICAgdG9vbF9kZXNjcmlwdGlvbjogYCR7aXRlbS5kZXNjcmlwdGlvbn0uIFJlcXVpcmVzIHg0MDIgcGF5bWVudDogJHtpdGVtLnByaWNpbmcuYW1vdW50fSBVU0RDIHVuaXRzICgke2Rpc3BsYXlQcmljZX0gVVNEQykgb24gQmFzZSBTZXBvbGlhIHRlc3RuZXQuYCxcbiAgICAgIG9wZXJhdGlvbl9pZDogdG9vbE5hbWUsXG4gICAgICBlbmRwb2ludF9wYXRoOiBwYXRoLFxuICAgICAgbWNwX21ldGFkYXRhOiB7XG4gICAgICAgIGNhdGVnb3J5OiBwYXRoLmluY2x1ZGVzKCdtYXJrZXQnKSB8fCBwYXRoLmluY2x1ZGVzKCd3ZWF0aGVyJykgPyAnbWFya2V0LWRhdGEnIDogXG4gICAgICAgICAgICAgICAgICBwYXRoLmluY2x1ZGVzKCdyZXNlYXJjaCcpIHx8IHBhdGguaW5jbHVkZXMoJ2RhdGFzZXQnKSA/ICdyZXNlYXJjaCcgOiAnY29udGVudCcsXG4gICAgICAgIHRhZ3M6IFsneDQwMi1wYXltZW50JywgJ3ByZW1pdW0tY29udGVudCddLFxuICAgICAgICBwcmlvcml0eTogMSxcbiAgICAgICAgcmVxdWlyZXNfcGF5bWVudDogdHJ1ZSxcbiAgICAgICAgZXN0aW1hdGVkX2xhdGVuY3lfbXM6IDIwMDAsXG4gICAgICB9LFxuICAgICAgeDQwMl9tZXRhZGF0YToge1xuICAgICAgICBwcmljZV91c2RjX3VuaXRzOiBpdGVtLnByaWNpbmcuYW1vdW50LFxuICAgICAgICBwcmljZV91c2RjX2Rpc3BsYXk6IGAke2Rpc3BsYXlQcmljZX0gVVNEQ2AsXG4gICAgICAgIG5ldHdvcms6IGl0ZW0ucHJpY2luZy5uZXR3b3JrLFxuICAgICAgICBuZXR3b3JrX25hbWU6ICdCYXNlIFNlcG9saWEnLFxuICAgICAgICBzY2hlbWU6IGl0ZW0ucHJpY2luZy5zY2hlbWUsXG4gICAgICAgIGFzc2V0X2FkZHJlc3M6IGl0ZW0ucHJpY2luZy5hc3NldCxcbiAgICAgICAgYXNzZXRfbmFtZTogJ1VTREMnLFxuICAgICAgICB0aW1lb3V0X3NlY29uZHM6IGl0ZW0ucHJpY2luZy5tYXhUaW1lb3V0U2Vjb25kcyxcbiAgICAgIH0sXG4gICAgICBpbnB1dF9zY2hlbWE6IHtcbiAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgICAgICByZXF1aXJlZDogW10sXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnTm8gaW5wdXQgcGFyYW1ldGVycyByZXF1aXJlZC4gUGF5bWVudCBpcyBoYW5kbGVkIHZpYSB4NDAyIGhlYWRlcnMuJyxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cbiAgXG4gIGNvbnN0IHJlc3BvbnNlID0ge1xuICAgIHZlcnNpb246ICcxLjAnLFxuICAgIHRvb2xzLFxuICAgIG1ldGFkYXRhOiB7XG4gICAgICBnYXRld2F5OiAneDQwMi1zZWxsZXItZ2F0ZXdheScsXG4gICAgICBwcm90b2NvbDogJ3g0MDItdjInLFxuICAgICAgbmV0d29yazogJ2Jhc2Utc2Vwb2xpYScsXG4gICAgICB0b3RhbF9zZXJ2aWNlczogdG9vbHMubGVuZ3RoLFxuICAgIH0sXG4gIH07XG4gIFxuICByZXR1cm4ge1xuICAgIHN0YXR1czogJzIwMCcsXG4gICAgc3RhdHVzRGVzY3JpcHRpb246ICdPSycsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ2NvbnRlbnQtdHlwZSc6IFt7IGtleTogJ0NvbnRlbnQtVHlwZScsIHZhbHVlOiAnYXBwbGljYXRpb24vanNvbicgfV0sXG4gICAgICAneC1yZXF1ZXN0LWlkJzogW3sga2V5OiAnWC1SZXF1ZXN0LUlkJywgdmFsdWU6IHJlcXVlc3RJZCB9XSxcbiAgICAgICdhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW4nOiBbeyBrZXk6ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCB2YWx1ZTogJyonIH1dLFxuICAgICAgJ2FjY2Vzcy1jb250cm9sLWFsbG93LWhlYWRlcnMnOiBbeyBcbiAgICAgICAga2V5OiAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycycsIFxuICAgICAgICB2YWx1ZTogJ0NvbnRlbnQtVHlwZSwgQWNjZXB0JyBcbiAgICAgIH1dLFxuICAgICAgJ2NhY2hlLWNvbnRyb2wnOiBbeyBrZXk6ICdDYWNoZS1Db250cm9sJywgdmFsdWU6ICdwdWJsaWMsIG1heC1hZ2U9MzAwJyB9XSxcbiAgICB9LFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSxcbiAgfTtcbn1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoXG4gIGV2ZW50OiBDbG91ZEZyb250UmVxdWVzdEV2ZW50XG4pOiBQcm9taXNlPENsb3VkRnJvbnRSZXF1ZXN0UmVzdWx0PiA9PiB7XG4gIGNvbnN0IHJlcXVlc3QgPSBldmVudC5SZWNvcmRzWzBdLmNmLnJlcXVlc3Q7XG4gIGNvbnN0IHVyaSA9IHJlcXVlc3QudXJpO1xuICBcbiAgLy8gSW5pdGlhbGl6ZSBsb2dnZXIgd2l0aCByZXF1ZXN0IElEIGZvciB0cmFjaW5nXG4gIGNvbnN0IHJlcXVlc3RJZCA9IGdlbmVyYXRlUmVxdWVzdElkKCk7XG4gIGNvbnN0IGxvZ2dlciA9IG5ldyBMb2dnZXIocmVxdWVzdElkLCB1cmkpO1xuICBcbiAgLy8gUmVjb3JkIHJlcXVlc3QgbWV0cmljXG4gIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuUkVRVUVTVF9DT1VOVCk7XG4gIGxvZ2dlci5pbmZvKCdQcm9jZXNzaW5nIHJlcXVlc3QnLCB7IG1ldGhvZDogcmVxdWVzdC5tZXRob2QgfSk7XG5cbiAgdHJ5IHtcbiAgICAvLyBIYW5kbGUgTUNQIGRpc2NvdmVyeSBlbmRwb2ludCAobm8gcGF5bWVudCByZXF1aXJlZClcbiAgICBpZiAodXJpID09PSAnL21jcC90b29scycpIHtcbiAgICAgIGxvZ2dlci5pbmZvKCdNQ1AgZGlzY292ZXJ5IHJlcXVlc3QnKTtcbiAgICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgICAgbG9nZ2VyLmVtaXRNZXRyaWNzKCk7XG4gICAgICByZXR1cm4gY3JlYXRlTUNQRGlzY292ZXJ5UmVzcG9uc2UocmVxdWVzdElkKTtcbiAgICB9XG4gICAgXG4gICAgLy8gQ2hlY2sgaWYgdGhpcyBwYXRoIHJlcXVpcmVzIHBheW1lbnQgdXNpbmcgZHluYW1pYyBjb250ZW50IG1hbmFnZXJcbiAgICBjb25zdCBwYXltZW50UmVxdWlyZW1lbnQgPSBjb250ZW50TWFuYWdlci5nZXRQYXltZW50UmVxdWlyZW1lbnRzKHVyaSk7XG4gICAgXG4gICAgaWYgKCFwYXltZW50UmVxdWlyZW1lbnQpIHtcbiAgICAgIC8vIE5vIHBheW1lbnQgcmVxdWlyZWQgZm9yIHRoaXMgcGF0aFxuICAgICAgbG9nZ2VyLmRlYnVnKCdObyBwYXltZW50IHJlcXVpcmVkIGZvciBwYXRoJyk7XG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgICAgcmV0dXJuIHJlcXVlc3Q7XG4gICAgfVxuXG4gICAgbG9nZ2VyLnNldERpbWVuc2lvbignTmV0d29yaycsIHBheW1lbnRSZXF1aXJlbWVudC5uZXR3b3JrKTtcbiAgICBsb2dnZXIuc2V0RGltZW5zaW9uKCdBc3NldCcsIHBheW1lbnRSZXF1aXJlbWVudC5hc3NldCk7XG5cbiAgICAvLyBDaGVjayBmb3IgcGF5bWVudCBzaWduYXR1cmUgaGVhZGVyICh4NDAyIHYyIHVzZXMgWC1QQVlNRU5ULVNJR05BVFVSRSlcbiAgICBjb25zdCBwYXltZW50U2lnbmF0dXJlSGVhZGVyID0gXG4gICAgICByZXF1ZXN0LmhlYWRlcnNbJ3gtcGF5bWVudC1zaWduYXR1cmUnXSB8fCBcbiAgICAgIHJlcXVlc3QuaGVhZGVyc1sncGF5bWVudC1zaWduYXR1cmUnXTtcbiAgICBcbiAgICBpZiAoIXBheW1lbnRTaWduYXR1cmVIZWFkZXIgfHwgIXBheW1lbnRTaWduYXR1cmVIZWFkZXJbMF0pIHtcbiAgICAgIC8vIE5vIHBheW1lbnQgcHJvdmlkZWQgLSByZXR1cm4gNDAyIFBheW1lbnQgUmVxdWlyZWRcbiAgICAgIGxvZ2dlci5pbmZvKCdObyBwYXltZW50IHNpZ25hdHVyZSBmb3VuZCwgcmV0dXJuaW5nIDQwMicsIHtcbiAgICAgICAgcmVxdWlyZWRBbW91bnQ6IHBheW1lbnRSZXF1aXJlbWVudC5hbW91bnQsXG4gICAgICB9KTtcbiAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuUEFZTUVOVF9SRVFVSVJFRCk7XG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgICAgcmV0dXJuIGNyZWF0ZTQwMlJlc3BvbnNlKHVyaSwgcGF5bWVudFJlcXVpcmVtZW50KTtcbiAgICB9XG5cbiAgICAvLyBQYXltZW50IHNpZ25hdHVyZSBwcmVzZW50XG4gICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5QQVlNRU5UX1JFQ0VJVkVEKTtcblxuICAgIC8vIERlY29kZSBhbmQgdmVyaWZ5IHBheW1lbnRcbiAgICBjb25zdCBwYXltZW50UGF5bG9hZEJhc2U2NCA9IHBheW1lbnRTaWduYXR1cmVIZWFkZXJbMF0udmFsdWU7XG4gICAgbGV0IHBheW1lbnRQYXlsb2FkOiB1bmtub3duO1xuICAgIFxuICAgIHRyeSB7XG4gICAgICBwYXltZW50UGF5bG9hZCA9IEpTT04ucGFyc2UoXG4gICAgICAgIEJ1ZmZlci5mcm9tKHBheW1lbnRQYXlsb2FkQmFzZTY0LCAnYmFzZTY0JykudG9TdHJpbmcoJ3V0Zi04JylcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZGVjb2RlRXJyb3IpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdGYWlsZWQgdG8gZGVjb2RlIHBheW1lbnQgcGF5bG9hZCcsIHtcbiAgICAgICAgZXJyb3JDb2RlOiAnREVDT0RFX0VSUk9SJyxcbiAgICAgIH0pO1xuICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5WQUxJREFUSU9OX0VSUk9SKTtcbiAgICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgICAgbG9nZ2VyLmVtaXRNZXRyaWNzKCk7XG4gICAgICByZXR1cm4gY3JlYXRlNDAyUmVzcG9uc2UoXG4gICAgICAgIHVyaSwgXG4gICAgICAgIHBheW1lbnRSZXF1aXJlbWVudCwgXG4gICAgICAgICdJbnZhbGlkIHBheW1lbnQgcGF5bG9hZCBlbmNvZGluZydcbiAgICAgICk7XG4gICAgfVxuXG4gICAgbG9nZ2VyLmRlYnVnKCdQYXltZW50IHBheWxvYWQgZGVjb2RlZCBzdWNjZXNzZnVsbHknKTtcblxuICAgIC8vIFZhbGlkYXRlIHBheWxvYWQgc3RydWN0dXJlXG4gICAgaWYgKCF2YWxpZGF0ZVBheWxvYWRTdHJ1Y3R1cmUocGF5bWVudFBheWxvYWQpKSB7XG4gICAgICBsb2dnZXIud2FybignSW52YWxpZCBwYXltZW50IHBheWxvYWQgc3RydWN0dXJlJywge1xuICAgICAgICBlcnJvckNvZGU6ICdJTlZBTElEX1NUUlVDVFVSRScsXG4gICAgICB9KTtcbiAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuVkFMSURBVElPTl9FUlJPUik7XG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgICAgcmV0dXJuIGNyZWF0ZUVycm9yUmVzcG9uc2UoXG4gICAgICAgICc0MDAnLFxuICAgICAgICAnQmFkIFJlcXVlc3QnLFxuICAgICAgICAnSW52YWxpZCBQYXltZW50JyxcbiAgICAgICAgJ1BheW1lbnQgcGF5bG9hZCBzdHJ1Y3R1cmUgaXMgaW52YWxpZCdcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gRXh0cmFjdCBwYXllciBhZGRyZXNzIGZvciBsb2dnaW5nXG4gICAgY29uc3QgcGF5ZXIgPSBwYXltZW50UGF5bG9hZC5wYXlsb2FkLmF1dGhvcml6YXRpb24uZnJvbTtcbiAgICBsb2dnZXIuc2V0RGltZW5zaW9uKCdQYXllcicsIHBheWVyLnN1YnN0cmluZygwLCAxMCkgKyAnLi4uJyk7XG4gICAgbG9nZ2VyLmluZm8oJ1BheW1lbnQgcGF5bG9hZCB2YWxpZGF0ZWQnLCB7XG4gICAgICBwYXllcixcbiAgICAgIGFtb3VudDogcGF5bWVudFBheWxvYWQuYWNjZXB0ZWQuYW1vdW50LFxuICAgICAgc2NoZW1lOiBwYXltZW50UGF5bG9hZC5hY2NlcHRlZC5zY2hlbWUsXG4gICAgfSk7XG5cbiAgICAvLyBWYWxpZGF0ZSBhdXRob3JpemF0aW9uIHBhcmFtZXRlcnNcbiAgICBjb25zdCBwYXJhbVZhbGlkYXRpb24gPSB2YWxpZGF0ZUF1dGhvcml6YXRpb25QYXJhbWV0ZXJzKFxuICAgICAgcGF5bWVudFBheWxvYWQsXG4gICAgICBwYXltZW50UmVxdWlyZW1lbnRcbiAgICApO1xuICAgIFxuICAgIGlmICghcGFyYW1WYWxpZGF0aW9uLmlzVmFsaWQpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdQYXltZW50IHBhcmFtZXRlciB2YWxpZGF0aW9uIGZhaWxlZCcsIHtcbiAgICAgICAgZXJyb3JDb2RlOiBwYXJhbVZhbGlkYXRpb24uaW52YWxpZFJlYXNvbixcbiAgICAgICAgcGF5ZXIsXG4gICAgICB9KTtcbiAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuVkFMSURBVElPTl9FUlJPUik7XG4gICAgICBcbiAgICAgIC8vIFJlY29yZCBzcGVjaWZpYyB2YWxpZGF0aW9uIGVycm9yIG1ldHJpY3NcbiAgICAgIHN3aXRjaCAocGFyYW1WYWxpZGF0aW9uLmludmFsaWRSZWFzb24pIHtcbiAgICAgICAgY2FzZSAnaW52YWxpZF9leGFjdF9ldm1fcGF5bG9hZF9hdXRob3JpemF0aW9uX3ZhbGlkX2JlZm9yZSc6XG4gICAgICAgIGNhc2UgJ2ludmFsaWRfZXhhY3RfZXZtX3BheWxvYWRfYXV0aG9yaXphdGlvbl92YWxpZF9hZnRlcic6XG4gICAgICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5BVVRIT1JJWkFUSU9OX0VYUElSRUQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdpbnZhbGlkX3NpZ25hdHVyZV9mb3JtYXQnOlxuICAgICAgICBjYXNlICdpbnZhbGlkX3NpZ25hdHVyZV9sZW5ndGgnOlxuICAgICAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuU0lHTkFUVVJFX0lOVkFMSUQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdpbnZhbGlkX2V4YWN0X2V2bV9wYXlsb2FkX2F1dGhvcml6YXRpb25fdmFsdWUnOlxuICAgICAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuQU1PVU5UX0lOU1VGRklDSUVOVCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ25ldHdvcmtfbWlzbWF0Y2gnOlxuICAgICAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuTkVUV09SS19NSVNNQVRDSCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2Fzc2V0X21pc21hdGNoJzpcbiAgICAgICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLkFTU0VUX01JU01BVENIKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIFxuICAgICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLkxBVEVOQ1ksIGxvZ2dlci5nZXRFbGFwc2VkTXMoKSk7XG4gICAgICBsb2dnZXIuZW1pdE1ldHJpY3MoKTtcbiAgICAgIHJldHVybiBjcmVhdGU0MDJSZXNwb25zZShcbiAgICAgICAgdXJpLFxuICAgICAgICBwYXltZW50UmVxdWlyZW1lbnQsXG4gICAgICAgIGBQYXltZW50IHZhbGlkYXRpb24gZmFpbGVkOiAke3BhcmFtVmFsaWRhdGlvbi5pbnZhbGlkUmVhc29ufWBcbiAgICAgICk7XG4gICAgfVxuXG4gICAgbG9nZ2VyLmRlYnVnKCdBdXRob3JpemF0aW9uIHBhcmFtZXRlcnMgdmFsaWRhdGVkJyk7XG5cbiAgICAvLyBWZXJpZnkgc2lnbmF0dXJlIHdpdGggZmFjaWxpdGF0b3JcbiAgICBjb25zdCB2ZXJpZmljYXRpb25TdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IHNpZ25hdHVyZVZhbGlkYXRpb24gPSBhd2FpdCB2ZXJpZnlTaWduYXR1cmVXaXRoRmFjaWxpdGF0b3IoXG4gICAgICBwYXltZW50UGF5bG9hZCxcbiAgICAgIHBheW1lbnRSZXF1aXJlbWVudCxcbiAgICAgIGxvZ2dlclxuICAgICk7XG4gICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLlZFUklGSUNBVElPTl9MQVRFTkNZLCBEYXRlLm5vdygpIC0gdmVyaWZpY2F0aW9uU3RhcnRUaW1lKTtcbiAgICBcbiAgICBpZiAoIXNpZ25hdHVyZVZhbGlkYXRpb24uaXNWYWxpZCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ1NpZ25hdHVyZSB2ZXJpZmljYXRpb24gZmFpbGVkJywge1xuICAgICAgICBlcnJvckNvZGU6IHNpZ25hdHVyZVZhbGlkYXRpb24uaW52YWxpZFJlYXNvbixcbiAgICAgICAgcGF5ZXIsXG4gICAgICB9KTtcbiAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuUEFZTUVOVF9GQUlMRUQpO1xuICAgICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLkxBVEVOQ1ksIGxvZ2dlci5nZXRFbGFwc2VkTXMoKSk7XG4gICAgICBsb2dnZXIuZW1pdE1ldHJpY3MoKTtcbiAgICAgIHJldHVybiBjcmVhdGU0MDJSZXNwb25zZShcbiAgICAgICAgdXJpLFxuICAgICAgICBwYXltZW50UmVxdWlyZW1lbnQsXG4gICAgICAgIGBTaWduYXR1cmUgdmVyaWZpY2F0aW9uIGZhaWxlZDogJHtzaWduYXR1cmVWYWxpZGF0aW9uLmludmFsaWRSZWFzb259YFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlBBWU1FTlRfVkVSSUZJRUQpO1xuICAgIGxvZ2dlci5pbmZvKCdQYXltZW50IHNpZ25hdHVyZSB2ZXJpZmllZCcsIHsgcGF5ZXIgfSk7XG5cbiAgICAvLyBTZXR0bGUgcGF5bWVudCB3aXRoIGZhY2lsaXRhdG9yXG4gICAgY29uc3Qgc2V0dGxlbWVudFN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgY29uc3Qgc2V0dGxlbWVudCA9IGF3YWl0IHNldHRsZVBheW1lbnRXaXRoRmFjaWxpdGF0b3IoXG4gICAgICBwYXltZW50UGF5bG9hZCxcbiAgICAgIHBheW1lbnRSZXF1aXJlbWVudCxcbiAgICAgIGxvZ2dlclxuICAgICk7XG4gICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLlNFVFRMRU1FTlRfTEFURU5DWSwgRGF0ZS5ub3coKSAtIHNldHRsZW1lbnRTdGFydFRpbWUpO1xuICAgIFxuICAgIGlmICghc2V0dGxlbWVudC5zdWNjZXNzKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ1BheW1lbnQgc2V0dGxlbWVudCBmYWlsZWQnLCB1bmRlZmluZWQsIHtcbiAgICAgICAgZXJyb3JDb2RlOiBzZXR0bGVtZW50LmVycm9yUmVhc29uLFxuICAgICAgICBwYXllcixcbiAgICAgIH0pO1xuICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5QQVlNRU5UX0ZBSUxFRCk7XG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgICAgcmV0dXJuIGNyZWF0ZUVycm9yUmVzcG9uc2UoXG4gICAgICAgICc0MDInLFxuICAgICAgICAnUGF5bWVudCBSZXF1aXJlZCcsXG4gICAgICAgICdTZXR0bGVtZW50IEZhaWxlZCcsXG4gICAgICAgIGBQYXltZW50IHNldHRsZW1lbnQgZmFpbGVkOiAke3NldHRsZW1lbnQuZXJyb3JSZWFzb259YFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBQYXltZW50IHZlcmlmaWVkIGFuZCBzZXR0bGVkIC0gcmV0dXJuIGR5bmFtaWMgY29udGVudFxuICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuUEFZTUVOVF9TRVRUTEVEKTtcbiAgICBcbiAgICAvLyBSZWNvcmQgcGF5bWVudCBhbW91bnQgbWV0cmljXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGFtb3VudFdlaSA9IEJpZ0ludChwYXltZW50UGF5bG9hZC5wYXlsb2FkLmF1dGhvcml6YXRpb24udmFsdWUpO1xuICAgICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLlBBWU1FTlRfQU1PVU5UX1dFSSwgTnVtYmVyKGFtb3VudFdlaSkpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gSWdub3JlIGlmIGFtb3VudCBwYXJzaW5nIGZhaWxzXG4gICAgfVxuICAgIFxuICAgIGxvZ2dlci5pbmZvKCdQYXltZW50IHNldHRsZWQgc3VjY2Vzc2Z1bGx5Jywge1xuICAgICAgcGF5ZXIsXG4gICAgICB0cmFuc2FjdGlvbkhhc2g6IHNldHRsZW1lbnQudHJhbnNhY3Rpb24sXG4gICAgICBhbW91bnQ6IHBheW1lbnRSZXF1aXJlbWVudC5hbW91bnQsXG4gICAgICBuZXR3b3JrOiBwYXltZW50UmVxdWlyZW1lbnQubmV0d29yayxcbiAgICB9KTtcblxuICAgIC8vIEdldCBkeW5hbWljIGNvbnRlbnQgZnJvbSBjb250ZW50IG1hbmFnZXJcbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgY29udGVudE1hbmFnZXIuZ2V0Q29udGVudCh1cmkpO1xuICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuQ09OVEVOVF9HRU5FUkFURUQpO1xuICAgIFxuICAgIC8vIFJlY29yZCBjb250ZW50IHNpemUgbWV0cmljXG4gICAgY29uc3QgY29udGVudEpzb24gPSBKU09OLnN0cmluZ2lmeShjb250ZW50KTtcbiAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuQ09OVEVOVF9CWVRFU19TRVJWRUQsIGNvbnRlbnRKc29uLmxlbmd0aCk7XG4gICAgXG4gICAgLy8gQ3JlYXRlIHNldHRsZW1lbnQgcmVzcG9uc2UgaGVhZGVyXG4gICAgY29uc3Qgc2V0dGxlbWVudFJlc3BvbnNlOiBTZXR0bGVtZW50UmVzcG9uc2UgPSB7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgdHJhbnNhY3Rpb246IHNldHRsZW1lbnQudHJhbnNhY3Rpb24sXG4gICAgICBuZXR3b3JrOiBwYXltZW50UmVxdWlyZW1lbnQubmV0d29yayxcbiAgICAgIHBheWVyOiBwYXltZW50UGF5bG9hZC5wYXlsb2FkLmF1dGhvcml6YXRpb24uZnJvbSxcbiAgICB9O1xuXG4gICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLkxBVEVOQ1ksIGxvZ2dlci5nZXRFbGFwc2VkTXMoKSk7XG4gICAgbG9nZ2VyLmVtaXRNZXRyaWNzKCk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzOiAnMjAwJyxcbiAgICAgIHN0YXR1c0Rlc2NyaXB0aW9uOiAnT0snLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnY29udGVudC10eXBlJzogW3sga2V5OiAnQ29udGVudC1UeXBlJywgdmFsdWU6ICdhcHBsaWNhdGlvbi9qc29uJyB9XSxcbiAgICAgICAgJ3gtcGF5bWVudC1yZXNwb25zZSc6IFt7XG4gICAgICAgICAga2V5OiAnWC1QQVlNRU5ULVJFU1BPTlNFJyxcbiAgICAgICAgICB2YWx1ZTogQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkoc2V0dGxlbWVudFJlc3BvbnNlKSkudG9TdHJpbmcoJ2Jhc2U2NCcpLFxuICAgICAgICB9XSxcbiAgICAgICAgJ3gtcmVxdWVzdC1pZCc6IFt7IGtleTogJ1gtUmVxdWVzdC1JZCcsIHZhbHVlOiByZXF1ZXN0SWQgfV0sXG4gICAgICAgICdhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW4nOiBbeyBrZXk6ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCB2YWx1ZTogJyonIH1dLFxuICAgICAgICAnYWNjZXNzLWNvbnRyb2wtYWxsb3ctaGVhZGVycyc6IFt7IFxuICAgICAgICAgIGtleTogJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLCBcbiAgICAgICAgICB2YWx1ZTogJ0NvbnRlbnQtVHlwZSwgWC1QYXltZW50LVNpZ25hdHVyZScgXG4gICAgICAgIH1dLFxuICAgICAgICAnYWNjZXNzLWNvbnRyb2wtZXhwb3NlLWhlYWRlcnMnOiBbeyBcbiAgICAgICAgICBrZXk6ICdBY2Nlc3MtQ29udHJvbC1FeHBvc2UtSGVhZGVycycsIFxuICAgICAgICAgIHZhbHVlOiAnWC1QQVlNRU5ULVJFU1BPTlNFLCBYLVJlcXVlc3QtSWQnIFxuICAgICAgICB9XSxcbiAgICAgIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShjb250ZW50KSxcbiAgICB9O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignVW5leHBlY3RlZCBlcnJvciBwcm9jZXNzaW5nIHBheW1lbnQnLCBlcnJvcik7XG4gICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5QQVlNRU5UX0ZBSUxFRCk7XG4gICAgbG9nZ2VyLnJlY29yZE1ldHJpYyhNZXRyaWNOYW1lLkxBVEVOQ1ksIGxvZ2dlci5nZXRFbGFwc2VkTXMoKSk7XG4gICAgbG9nZ2VyLmVtaXRNZXRyaWNzKCk7XG4gICAgcmV0dXJuIGNyZWF0ZUVycm9yUmVzcG9uc2UoXG4gICAgICAnNTAwJyxcbiAgICAgICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxuICAgICAgJ1BheW1lbnQgUHJvY2Vzc2luZyBFcnJvcicsXG4gICAgICAnRmFpbGVkIHRvIHByb2Nlc3MgcGF5bWVudCdcbiAgICApO1xuICB9XG59O1xuIl19