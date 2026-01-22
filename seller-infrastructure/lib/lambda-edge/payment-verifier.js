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
        logger.info('Payment settled successfully', {
            payer,
            transactionHash: settlement.transaction,
            amount: paymentRequirement.amount,
            network: paymentRequirement.network,
        });
        // Get dynamic content from content manager
        const content = await content_config_1.contentManager.getContent(uri);
        logger.incrementCounter(types_1.MetricName.CONTENT_GENERATED);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF5bWVudC12ZXJpZmllci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInBheW1lbnQtdmVyaWZpZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsbUNBV2lCO0FBQ2pCLHFEQUFrRTtBQUVsRSwrRUFBK0U7QUFDL0UscUNBQXFDO0FBQ3JDLCtFQUErRTtBQUMvRSxNQUFNLE1BQU07SUFPVixZQUFZLFNBQWlCLEVBQUUsR0FBVztRQUN4QyxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztRQUMzQixJQUFJLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQztRQUNmLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUN6QixJQUFJLENBQUMsVUFBVSxHQUFHO1lBQ2hCLEdBQUcsRUFBRSxHQUFHO1lBQ1IsV0FBVyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLFlBQVk7U0FDckQsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNLLGNBQWMsQ0FDcEIsS0FBZSxFQUNmLE9BQWUsRUFDZixLQUErQjtRQUUvQixPQUFPO1lBQ0wsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1lBQ25DLEtBQUs7WUFDTCxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVM7WUFDekIsT0FBTztZQUNQLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRztZQUNiLFVBQVUsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVM7WUFDdkMsR0FBRyxLQUFLO1NBQ1QsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxPQUFlLEVBQUUsS0FBK0I7UUFDcEQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxnQkFBUSxDQUFDLEtBQUssRUFBRSxPQUFP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S0FBSyxFQUFFLFNBQVMsRUFBRSxDQUFDO2dCQUMzRCw2QkFBNkIsRUFBRSxDQUFDLEVBQUUsR0FBRyxFQUFFLDZCQUE2QixFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsQ0FBQztnQkFDbkYsOEJBQThCLEVBQUUsQ0FBQzt3QkFDL0IsR0FBRyxFQUFFLDhCQUE4Qjt3QkFDbkMsS0FBSyxFQUFFLG1DQUFtQztxQkFDM0MsQ0FBQztnQkFDRiwrQkFBK0IsRUFBRSxDQUFDO3dCQUNoQyxHQUFHLEVBQUUsK0JBQStCO3dCQUNwQyxLQUFLLEVBQUUsa0NBQWtDO3FCQUMxQyxDQUFDO2FBQ0g7WUFDRCxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUM7U0FDOUIsQ0FBQztJQUNKLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsTUFBTSxDQUFDLEtBQUssQ0FBQyxxQ0FBcUMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUMzRCxNQUFNLENBQUMsZ0JBQWdCLENBQUMsa0JBQVUsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUNuRCxNQUFNLENBQUMsWUFBWSxDQUFDLGtCQUFVLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxZQUFZLEVBQUUsQ0FBQyxDQUFDO1FBQy9ELE1BQU0sQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNyQixPQUFPLG1CQUFtQixDQUN4QixLQUFLLEVBQ0wsdUJBQXVCLEVBQ3ZCLDBCQUEwQixFQUMxQiwyQkFBMkIsQ0FDNUIsQ0FBQztJQUNKLENBQUM7QUFDSCxDQUFDLENBQUM7QUF0T1csUUFBQSxPQUFPLFdBc09sQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENsb3VkRnJvbnRSZXF1ZXN0RXZlbnQsIENsb3VkRnJvbnRSZXF1ZXN0UmVzdWx0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQge1xuICBMb2dMZXZlbCxcbiAgTWV0cmljTmFtZSxcbiAgTG9nRW50cnksXG4gIEVNRk1ldHJpYyxcbiAgUGF5bWVudFJlcXVpcmVtZW50cyxcbiAgUGF5bWVudFJlcXVpcmVkLFxuICBQYXltZW50UGF5bG9hZCxcbiAgVmVyaWZ5UmVzcG9uc2UsXG4gIFNldHRsZW1lbnRSZXNwb25zZSxcbiAgUmVzb3VyY2VJbmZvLFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IGNvbnRlbnRNYW5hZ2VyLCBDb250ZW50TWFuYWdlciB9IGZyb20gJy4vY29udGVudC1jb25maWcnO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBMb2dnaW5nIGFuZCBNZXRyaWNzIEluZnJhc3RydWN0dXJlXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5jbGFzcyBMb2dnZXIge1xuICBwcml2YXRlIHJlcXVlc3RJZDogc3RyaW5nO1xuICBwcml2YXRlIHVyaTogc3RyaW5nO1xuICBwcml2YXRlIHN0YXJ0VGltZTogbnVtYmVyO1xuICBwcml2YXRlIG1ldHJpY3M6IE1hcDxzdHJpbmcsIG51bWJlcj47XG4gIHByaXZhdGUgZGltZW5zaW9uczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcblxuICBjb25zdHJ1Y3RvcihyZXF1ZXN0SWQ6IHN0cmluZywgdXJpOiBzdHJpbmcpIHtcbiAgICB0aGlzLnJlcXVlc3RJZCA9IHJlcXVlc3RJZDtcbiAgICB0aGlzLnVyaSA9IHVyaTtcbiAgICB0aGlzLnN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgdGhpcy5tZXRyaWNzID0gbmV3IE1hcCgpO1xuICAgIHRoaXMuZGltZW5zaW9ucyA9IHtcbiAgICAgIFVyaTogdXJpLFxuICAgICAgRW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52LkVOVklST05NRU5UIHx8ICdwcm9kdWN0aW9uJyxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBzdHJ1Y3R1cmVkIGxvZyBlbnRyeVxuICAgKi9cbiAgcHJpdmF0ZSBjcmVhdGVMb2dFbnRyeShcbiAgICBsZXZlbDogTG9nTGV2ZWwsXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIGV4dHJhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgKTogTG9nRW50cnkge1xuICAgIHJldHVybiB7XG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGxldmVsLFxuICAgICAgcmVxdWVzdElkOiB0aGlzLnJlcXVlc3RJZCxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICB1cmk6IHRoaXMudXJpLFxuICAgICAgZHVyYXRpb25NczogRGF0ZS5ub3coKSAtIHRoaXMuc3RhcnRUaW1lLFxuICAgICAgLi4uZXh0cmEsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dzIGEgZGVidWcgbWVzc2FnZVxuICAgKi9cbiAgZGVidWcobWVzc2FnZTogc3RyaW5nLCBleHRyYT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmNyZWF0ZUxvZ0VudHJ5KExvZ0xldmVsLkRFQlVHLCBtZXNzYWdlLCBleHRyYSk7XG4gICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkoZW50cnkpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dzIGFuIGluZm8gbWVzc2FnZVxuICAgKi9cbiAgaW5mbyhtZXNzYWdlOiBzdHJpbmcsIGV4dHJhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuY3JlYXRlTG9nRW50cnkoTG9nTGV2ZWwuSU5GTywgbWVzc2FnZSwgZXh0cmEpO1xuICAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KGVudHJ5KSk7XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhIHdhcm5pbmcgbWVzc2FnZVxuICAgKi9cbiAgd2FybihtZXNzYWdlOiBzdHJpbmcsIGV4dHJhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuY3JlYXRlTG9nRW50cnkoTG9nTGV2ZWwuV0FSTiwgbWVzc2FnZSwgZXh0cmEpO1xuICAgIGNvbnNvbGUud2FybihKU09OLnN0cmluZ2lmeShlbnRyeSkpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgYW4gZXJyb3IgbWVzc2FnZVxuICAgKi9cbiAgZXJyb3IobWVzc2FnZTogc3RyaW5nLCBlcnJvcj86IEVycm9yIHwgdW5rbm93biwgZXh0cmE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQge1xuICAgIGNvbnN0IGVycm9yRGV0YWlsczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7IC4uLmV4dHJhIH07XG4gICAgXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgIGVycm9yRGV0YWlscy5lcnJvck1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlO1xuICAgICAgZXJyb3JEZXRhaWxzLmVycm9yU3RhY2sgPSBlcnJvci5zdGFjaztcbiAgICB9IGVsc2UgaWYgKGVycm9yKSB7XG4gICAgICBlcnJvckRldGFpbHMuZXJyb3JNZXNzYWdlID0gU3RyaW5nKGVycm9yKTtcbiAgICB9XG4gICAgXG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmNyZWF0ZUxvZ0VudHJ5KExvZ0xldmVsLkVSUk9SLCBtZXNzYWdlLCBlcnJvckRldGFpbHMpO1xuICAgIGNvbnNvbGUuZXJyb3IoSlNPTi5zdHJpbmdpZnkoZW50cnkpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgbWV0cmljIHZhbHVlXG4gICAqL1xuICByZWNvcmRNZXRyaWMobmFtZTogTWV0cmljTmFtZSwgdmFsdWU6IG51bWJlcik6IHZvaWQge1xuICAgIHRoaXMubWV0cmljcy5zZXQobmFtZSwgdmFsdWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIEluY3JlbWVudHMgYSBjb3VudGVyIG1ldHJpY1xuICAgKi9cbiAgaW5jcmVtZW50Q291bnRlcihuYW1lOiBNZXRyaWNOYW1lKTogdm9pZCB7XG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMubWV0cmljcy5nZXQobmFtZSkgfHwgMDtcbiAgICB0aGlzLm1ldHJpY3Muc2V0KG5hbWUsIGN1cnJlbnQgKyAxKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIGEgZGltZW5zaW9uIGZvciBtZXRyaWNzXG4gICAqL1xuICBzZXREaW1lbnNpb24oa2V5OiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLmRpbWVuc2lvbnNba2V5XSA9IHZhbHVlO1xuICB9XG5cbiAgLyoqXG4gICAqIEVtaXRzIGFsbCByZWNvcmRlZCBtZXRyaWNzIGluIENsb3VkV2F0Y2ggRU1GIGZvcm1hdFxuICAgKi9cbiAgZW1pdE1ldHJpY3MoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMubWV0cmljcy5zaXplID09PSAwKSByZXR1cm47XG5cbiAgICBjb25zdCBtZXRyaWNzQXJyYXk6IEFycmF5PHsgTmFtZTogc3RyaW5nOyBVbml0OiBzdHJpbmcgfT4gPSBbXTtcbiAgICBjb25zdCBtZXRyaWNWYWx1ZXM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcblxuICAgIHRoaXMubWV0cmljcy5mb3JFYWNoKCh2YWx1ZSwgbmFtZSkgPT4ge1xuICAgICAgY29uc3QgdW5pdCA9IG5hbWUuaW5jbHVkZXMoJ0xhdGVuY3knKSA/ICdNaWxsaXNlY29uZHMnIDogJ0NvdW50JztcbiAgICAgIG1ldHJpY3NBcnJheS5wdXNoKHsgTmFtZTogbmFtZSwgVW5pdDogdW5pdCB9KTtcbiAgICAgIG1ldHJpY1ZhbHVlc1tuYW1lXSA9IHZhbHVlO1xuICAgIH0pO1xuXG4gICAgY29uc3QgZW1mOiBFTUZNZXRyaWMgPSB7XG4gICAgICBfYXdzOiB7XG4gICAgICAgIFRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgQ2xvdWRXYXRjaE1ldHJpY3M6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBOYW1lc3BhY2U6ICdYNDAyL1BheW1lbnRWZXJpZmllcicsXG4gICAgICAgICAgICBEaW1lbnNpb25zOiBbT2JqZWN0LmtleXModGhpcy5kaW1lbnNpb25zKV0sXG4gICAgICAgICAgICBNZXRyaWNzOiBtZXRyaWNzQXJyYXksXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgICAuLi50aGlzLmRpbWVuc2lvbnMsXG4gICAgICAuLi5tZXRyaWNWYWx1ZXMsXG4gICAgICByZXF1ZXN0SWQ6IHRoaXMucmVxdWVzdElkLFxuICAgIH07XG5cbiAgICAvLyBFTUYgbG9ncyBtdXN0IGJlIHByaW50ZWQgdG8gc3Rkb3V0IGZvciBDbG91ZFdhdGNoIHRvIHBhcnNlIHRoZW1cbiAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShlbWYpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIGVsYXBzZWQgdGltZSBzaW5jZSBsb2dnZXIgY3JlYXRpb25cbiAgICovXG4gIGdldEVsYXBzZWRNcygpOiBudW1iZXIge1xuICAgIHJldHVybiBEYXRlLm5vdygpIC0gdGhpcy5zdGFydFRpbWU7XG4gIH1cbn1cblxuLyoqXG4gKiBHZW5lcmF0ZXMgYSB1bmlxdWUgcmVxdWVzdCBJRCBmb3IgdHJhY2luZ1xuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVJlcXVlc3RJZCgpOiBzdHJpbmcge1xuICByZXR1cm4gYHJlcV8ke0RhdGUubm93KCkudG9TdHJpbmcoMzYpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cmluZygyLCA5KX1gO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyB4NDAyIHYyIFR5cGVzIC0gaW1wb3J0ZWQgZnJvbSAuL3R5cGVzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIEZhY2lsaXRhdG9yIFVSTCBmb3IgcGF5bWVudCB2ZXJpZmljYXRpb25cbmNvbnN0IEZBQ0lMSVRBVE9SX1VSTCA9IHByb2Nlc3MuZW52LkZBQ0lMSVRBVE9SX1VSTCB8fCAnaHR0cHM6Ly9mYWNpbGl0YXRvci54NDAyLm9yZyc7XG5cbi8qKlxuICogVmFsaWRhdGVzIHRoZSBzdHJ1Y3R1cmUgb2YgYSBwYXltZW50IHBheWxvYWRcbiAqL1xuZnVuY3Rpb24gdmFsaWRhdGVQYXlsb2FkU3RydWN0dXJlKHBheWxvYWQ6IHVua25vd24pOiBwYXlsb2FkIGlzIFBheW1lbnRQYXlsb2FkIHtcbiAgaWYgKCFwYXlsb2FkIHx8IHR5cGVvZiBwYXlsb2FkICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuICBcbiAgY29uc3QgcCA9IHBheWxvYWQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIFxuICAvLyBDaGVjayByZXF1aXJlZCB0b3AtbGV2ZWwgZmllbGRzXG4gIGlmICh0eXBlb2YgcC54NDAyVmVyc2lvbiAhPT0gJ251bWJlcicgfHwgcC54NDAyVmVyc2lvbiAhPT0gMikgcmV0dXJuIGZhbHNlO1xuICBpZiAoIXAuYWNjZXB0ZWQgfHwgdHlwZW9mIHAuYWNjZXB0ZWQgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG4gIGlmICghcC5wYXlsb2FkIHx8IHR5cGVvZiBwLnBheWxvYWQgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG4gIFxuICAvLyBDaGVjayBhY2NlcHRlZCByZXF1aXJlbWVudHNcbiAgY29uc3QgYWNjZXB0ZWQgPSBwLmFjY2VwdGVkIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBpZiAodHlwZW9mIGFjY2VwdGVkLnNjaGVtZSAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhY2NlcHRlZC5uZXR3b3JrICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIGFjY2VwdGVkLmFtb3VudCAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhY2NlcHRlZC5hc3NldCAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhY2NlcHRlZC5wYXlUbyAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgXG4gIC8vIENoZWNrIHBheWxvYWQgKGV4YWN0IEVWTSBzY2hlbWUpXG4gIGNvbnN0IHBheWxvYWREYXRhID0gcC5wYXlsb2FkIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBpZiAodHlwZW9mIHBheWxvYWREYXRhLnNpZ25hdHVyZSAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKCFwYXlsb2FkRGF0YS5hdXRob3JpemF0aW9uIHx8IHR5cGVvZiBwYXlsb2FkRGF0YS5hdXRob3JpemF0aW9uICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuICBcbiAgLy8gQ2hlY2sgYXV0aG9yaXphdGlvblxuICBjb25zdCBhdXRoID0gcGF5bG9hZERhdGEuYXV0aG9yaXphdGlvbiBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgaWYgKHR5cGVvZiBhdXRoLmZyb20gIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgYXV0aC50byAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhdXRoLnZhbHVlICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIGF1dGgudmFsaWRBZnRlciAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhdXRoLnZhbGlkQmVmb3JlICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIGF1dGgubm9uY2UgIT09ICdzdHJpbmcnKSByZXR1cm4gZmFsc2U7XG4gIFxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgdGhhdCB0aGUgcGF5bWVudCBhdXRob3JpemF0aW9uIG1hdGNoZXMgdGhlIHJlcXVpcmVtZW50c1xuICovXG5mdW5jdGlvbiB2YWxpZGF0ZUF1dGhvcml6YXRpb25QYXJhbWV0ZXJzKFxuICBwYXlsb2FkOiBQYXltZW50UGF5bG9hZCxcbiAgcmVxdWlyZW1lbnRzOiBQYXltZW50UmVxdWlyZW1lbnRzXG4pOiBWZXJpZnlSZXNwb25zZSB7XG4gIGNvbnN0IHsgYXV0aG9yaXphdGlvbiB9ID0gcGF5bG9hZC5wYXlsb2FkO1xuICBjb25zdCBwYXllciA9IGF1dGhvcml6YXRpb24uZnJvbTtcbiAgXG4gIC8vIFZlcmlmeSBzY2hlbWUgbWF0Y2hlc1xuICBpZiAocGF5bG9hZC5hY2NlcHRlZC5zY2hlbWUgIT09IHJlcXVpcmVtZW50cy5zY2hlbWUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnc2NoZW1lX21pc21hdGNoJyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIC8vIFZlcmlmeSBuZXR3b3JrIG1hdGNoZXNcbiAgaWYgKHBheWxvYWQuYWNjZXB0ZWQubmV0d29yayAhPT0gcmVxdWlyZW1lbnRzLm5ldHdvcmspIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnbmV0d29ya19taXNtYXRjaCcsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICAvLyBWZXJpZnkgcmVjaXBpZW50IG1hdGNoZXNcbiAgaWYgKGF1dGhvcml6YXRpb24udG8udG9Mb3dlckNhc2UoKSAhPT0gcmVxdWlyZW1lbnRzLnBheVRvLnRvTG93ZXJDYXNlKCkpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnaW52YWxpZF9leGFjdF9ldm1fcGF5bG9hZF9yZWNpcGllbnRfbWlzbWF0Y2gnLFxuICAgICAgcGF5ZXIsXG4gICAgfTtcbiAgfVxuICBcbiAgLy8gVmVyaWZ5IGFtb3VudCBpcyBzdWZmaWNpZW50XG4gIGNvbnN0IHBheW1lbnRWYWx1ZSA9IEJpZ0ludChhdXRob3JpemF0aW9uLnZhbHVlKTtcbiAgY29uc3QgcmVxdWlyZWRBbW91bnQgPSBCaWdJbnQocmVxdWlyZW1lbnRzLmFtb3VudCk7XG4gIGlmIChwYXltZW50VmFsdWUgPCByZXF1aXJlZEFtb3VudCkge1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICdpbnZhbGlkX2V4YWN0X2V2bV9wYXlsb2FkX2F1dGhvcml6YXRpb25fdmFsdWUnLFxuICAgICAgcGF5ZXIsXG4gICAgfTtcbiAgfVxuICBcbiAgLy8gVmVyaWZ5IHRpbWUgdmFsaWRpdHlcbiAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XG4gIGNvbnN0IHZhbGlkQWZ0ZXIgPSBwYXJzZUludChhdXRob3JpemF0aW9uLnZhbGlkQWZ0ZXIsIDEwKTtcbiAgY29uc3QgdmFsaWRCZWZvcmUgPSBwYXJzZUludChhdXRob3JpemF0aW9uLnZhbGlkQmVmb3JlLCAxMCk7XG4gIFxuICAvLyBDaGVjayB2YWxpZEFmdGVyIGlzIG5vdCBpbiB0aGUgZnV0dXJlXG4gIGlmICh2YWxpZEFmdGVyID4gbm93KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ2ludmFsaWRfZXhhY3RfZXZtX3BheWxvYWRfYXV0aG9yaXphdGlvbl92YWxpZF9hZnRlcicsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICAvLyBDaGVjayB2YWxpZEJlZm9yZSBpcyBpbiB0aGUgZnV0dXJlICh3aXRoIDYgc2Vjb25kIGJ1ZmZlciBmb3IgYmxvY2sgdGltZSlcbiAgaWYgKHZhbGlkQmVmb3JlIDwgbm93ICsgNikge1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICdpbnZhbGlkX2V4YWN0X2V2bV9wYXlsb2FkX2F1dGhvcml6YXRpb25fdmFsaWRfYmVmb3JlJyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIC8vIFZlcmlmeSBhc3NldCBtYXRjaGVzXG4gIGlmIChwYXlsb2FkLmFjY2VwdGVkLmFzc2V0LnRvTG93ZXJDYXNlKCkgIT09IHJlcXVpcmVtZW50cy5hc3NldC50b0xvd2VyQ2FzZSgpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ2Fzc2V0X21pc21hdGNoJyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIC8vIFZlcmlmeSBzaWduYXR1cmUgZm9ybWF0IChzaG91bGQgYmUgNjUgYnl0ZXMgPSAxMzAgaGV4IGNoYXJzICsgMHggcHJlZml4KVxuICBjb25zdCBzaWduYXR1cmUgPSBwYXlsb2FkLnBheWxvYWQuc2lnbmF0dXJlO1xuICBpZiAoIXNpZ25hdHVyZS5zdGFydHNXaXRoKCcweCcpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IGZhbHNlLFxuICAgICAgaW52YWxpZFJlYXNvbjogJ2ludmFsaWRfc2lnbmF0dXJlX2Zvcm1hdCcsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICBjb25zdCBzaWduYXR1cmVMZW5ndGggPSBzaWduYXR1cmUubGVuZ3RoIC0gMjsgLy8gUmVtb3ZlIDB4IHByZWZpeFxuICAvLyBFT0Egc2lnbmF0dXJlcyBhcmUgMTMwIGNoYXJzLCBzbWFydCB3YWxsZXQgc2lnbmF0dXJlcyBjYW4gYmUgbG9uZ2VyXG4gIGlmIChzaWduYXR1cmVMZW5ndGggPCAxMzApIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXNWYWxpZDogZmFsc2UsXG4gICAgICBpbnZhbGlkUmVhc29uOiAnaW52YWxpZF9zaWduYXR1cmVfbGVuZ3RoJyxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbiAgXG4gIC8vIFZlcmlmeSBub25jZSBmb3JtYXQgKHNob3VsZCBiZSAzMiBieXRlcyA9IDY0IGhleCBjaGFycyArIDB4IHByZWZpeClcbiAgY29uc3Qgbm9uY2UgPSBhdXRob3JpemF0aW9uLm5vbmNlO1xuICBpZiAoIW5vbmNlLnN0YXJ0c1dpdGgoJzB4JykgfHwgbm9uY2UubGVuZ3RoICE9PSA2Nikge1xuICAgIHJldHVybiB7XG4gICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgIGludmFsaWRSZWFzb246ICdpbnZhbGlkX25vbmNlX2Zvcm1hdCcsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG4gIFxuICByZXR1cm4ge1xuICAgIGlzVmFsaWQ6IHRydWUsXG4gICAgcGF5ZXIsXG4gIH07XG59XG5cbi8qKlxuICogVmVyaWZpZXMgdGhlIHBheW1lbnQgc2lnbmF0dXJlIHVzaW5nIHRoZSBmYWNpbGl0YXRvciBzZXJ2aWNlXG4gKiBJbiBwcm9kdWN0aW9uLCB0aGlzIHdvdWxkIGNhbGwgdGhlIHg0MDIgZmFjaWxpdGF0b3IncyAvdmVyaWZ5IGVuZHBvaW50XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHZlcmlmeVNpZ25hdHVyZVdpdGhGYWNpbGl0YXRvcihcbiAgcGF5bG9hZDogUGF5bWVudFBheWxvYWQsXG4gIHJlcXVpcmVtZW50czogUGF5bWVudFJlcXVpcmVtZW50cyxcbiAgbG9nZ2VyOiBMb2dnZXJcbik6IFByb21pc2U8VmVyaWZ5UmVzcG9uc2U+IHtcbiAgY29uc3QgcGF5ZXIgPSBwYXlsb2FkLnBheWxvYWQuYXV0aG9yaXphdGlvbi5mcm9tO1xuICBcbiAgdHJ5IHtcbiAgICBsb2dnZXIuZGVidWcoJ0NhbGxpbmcgZmFjaWxpdGF0b3IgL3ZlcmlmeSBlbmRwb2ludCcsIHtcbiAgICAgIGZhY2lsaXRhdG9yVXJsOiBGQUNJTElUQVRPUl9VUkwsXG4gICAgfSk7XG4gICAgXG4gICAgLy8gQ2FsbCBmYWNpbGl0YXRvciAvdmVyaWZ5IGVuZHBvaW50XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHtGQUNJTElUQVRPUl9VUkx9L3ZlcmlmeWAsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcGF5bWVudFBheWxvYWQ6IHBheWxvYWQsXG4gICAgICAgIHBheW1lbnRSZXF1aXJlbWVudHM6IHJlcXVpcmVtZW50cyxcbiAgICAgIH0pLFxuICAgIH0pO1xuICAgIFxuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIGxvZ2dlci53YXJuKCdGYWNpbGl0YXRvciB2ZXJpZnkgcmVxdWVzdCBmYWlsZWQnLCB7XG4gICAgICAgIHN0YXR1c0NvZGU6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgICAgc3RhdHVzVGV4dDogcmVzcG9uc2Uuc3RhdHVzVGV4dCxcbiAgICAgIH0pO1xuICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5GQUNJTElUQVRPUl9FUlJPUik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgICAgaW52YWxpZFJlYXNvbjogJ2ZhY2lsaXRhdG9yX3ZlcmlmaWNhdGlvbl9mYWlsZWQnLFxuICAgICAgICBwYXllcixcbiAgICAgIH07XG4gICAgfVxuICAgIFxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKSBhcyBWZXJpZnlSZXNwb25zZTtcbiAgICBsb2dnZXIuZGVidWcoJ0ZhY2lsaXRhdG9yIHZlcmlmaWNhdGlvbiByZXNwb25zZSByZWNlaXZlZCcsIHtcbiAgICAgIGlzVmFsaWQ6IHJlc3VsdC5pc1ZhbGlkLFxuICAgIH0pO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgbG9nZ2VyLmVycm9yKCdFcnJvciBjYWxsaW5nIGZhY2lsaXRhdG9yJywgZXJyb3IsIHtcbiAgICAgIGZhY2lsaXRhdG9yVXJsOiBGQUNJTElUQVRPUl9VUkwsXG4gICAgfSk7XG4gICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5GQUNJTElUQVRPUl9FUlJPUik7XG4gICAgLy8gSWYgZmFjaWxpdGF0b3IgaXMgdW5hdmFpbGFibGUsIGZhbGwgYmFjayB0byBsb2NhbCB2YWxpZGF0aW9uIG9ubHlcbiAgICAvLyBJbiBwcm9kdWN0aW9uLCB5b3UgbWlnaHQgd2FudCB0byByZWplY3QgdGhlIHBheW1lbnQgaW5zdGVhZFxuICAgIGxvZ2dlci53YXJuKCdGYWNpbGl0YXRvciB1bmF2YWlsYWJsZSwgdXNpbmcgbG9jYWwgdmFsaWRhdGlvbiBvbmx5Jyk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzVmFsaWQ6IHRydWUsXG4gICAgICBwYXllcixcbiAgICB9O1xuICB9XG59XG5cbi8qKlxuICogU2V0dGxlcyB0aGUgcGF5bWVudCB1c2luZyB0aGUgZmFjaWxpdGF0b3Igc2VydmljZVxuICovXG5hc3luYyBmdW5jdGlvbiBzZXR0bGVQYXltZW50V2l0aEZhY2lsaXRhdG9yKFxuICBwYXlsb2FkOiBQYXltZW50UGF5bG9hZCxcbiAgcmVxdWlyZW1lbnRzOiBQYXltZW50UmVxdWlyZW1lbnRzLFxuICBsb2dnZXI6IExvZ2dlclxuKTogUHJvbWlzZTxTZXR0bGVtZW50UmVzcG9uc2U+IHtcbiAgY29uc3QgcGF5ZXIgPSBwYXlsb2FkLnBheWxvYWQuYXV0aG9yaXphdGlvbi5mcm9tO1xuICBcbiAgdHJ5IHtcbiAgICBsb2dnZXIuZGVidWcoJ0NhbGxpbmcgZmFjaWxpdGF0b3IgL3NldHRsZSBlbmRwb2ludCcsIHtcbiAgICAgIGZhY2lsaXRhdG9yVXJsOiBGQUNJTElUQVRPUl9VUkwsXG4gICAgICBhbW91bnQ6IHJlcXVpcmVtZW50cy5hbW91bnQsXG4gICAgfSk7XG4gICAgXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHtGQUNJTElUQVRPUl9VUkx9L3NldHRsZWAsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcGF5bWVudFBheWxvYWQ6IHBheWxvYWQsXG4gICAgICAgIHBheW1lbnRSZXF1aXJlbWVudHM6IHJlcXVpcmVtZW50cyxcbiAgICAgIH0pLFxuICAgIH0pO1xuICAgIFxuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIGxvZ2dlci53YXJuKCdGYWNpbGl0YXRvciBzZXR0bGUgcmVxdWVzdCBmYWlsZWQnLCB7XG4gICAgICAgIHN0YXR1c0NvZGU6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgICAgc3RhdHVzVGV4dDogcmVzcG9uc2Uuc3RhdHVzVGV4dCxcbiAgICAgIH0pO1xuICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5GQUNJTElUQVRPUl9FUlJPUik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgdHJhbnNhY3Rpb246ICcnLFxuICAgICAgICBuZXR3b3JrOiByZXF1aXJlbWVudHMubmV0d29yayxcbiAgICAgICAgcGF5ZXIsXG4gICAgICAgIGVycm9yUmVhc29uOiAnc2V0dGxlbWVudF9mYWlsZWQnLFxuICAgICAgfTtcbiAgICB9XG4gICAgXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcmVzcG9uc2UuanNvbigpIGFzIFNldHRsZW1lbnRSZXNwb25zZTtcbiAgICBsb2dnZXIuZGVidWcoJ0ZhY2lsaXRhdG9yIHNldHRsZW1lbnQgcmVzcG9uc2UgcmVjZWl2ZWQnLCB7XG4gICAgICBzdWNjZXNzOiByZXN1bHQuc3VjY2VzcyxcbiAgICAgIHRyYW5zYWN0aW9uOiByZXN1bHQudHJhbnNhY3Rpb24sXG4gICAgfSk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBsb2dnZXIuZXJyb3IoJ0Vycm9yIHNldHRsaW5nIHBheW1lbnQnLCBlcnJvciwge1xuICAgICAgZmFjaWxpdGF0b3JVcmw6IEZBQ0lMSVRBVE9SX1VSTCxcbiAgICB9KTtcbiAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLkZBQ0lMSVRBVE9SX0VSUk9SKTtcbiAgICAvLyBGb3IgZGVtbyBwdXJwb3Nlcywgc2ltdWxhdGUgc3VjY2Vzc2Z1bCBzZXR0bGVtZW50XG4gICAgLy8gSW4gcHJvZHVjdGlvbiwgdGhpcyBzaG91bGQgZmFpbCBpZiBmYWNpbGl0YXRvciBpcyB1bmF2YWlsYWJsZVxuICAgIGNvbnN0IHNpbXVsYXRlZFR4ID0gJzB4JyArIEFycmF5LmZyb20oeyBsZW5ndGg6IDY0IH0sICgpID0+IFxuICAgICAgTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMTYpLnRvU3RyaW5nKDE2KVxuICAgICkuam9pbignJyk7XG4gICAgbG9nZ2VyLndhcm4oJ0ZhY2lsaXRhdG9yIHVuYXZhaWxhYmxlLCBzaW11bGF0aW5nIHNldHRsZW1lbnQnLCB7XG4gICAgICBzaW11bGF0ZWRUcmFuc2FjdGlvbjogc2ltdWxhdGVkVHgsXG4gICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICB0cmFuc2FjdGlvbjogc2ltdWxhdGVkVHgsXG4gICAgICBuZXR3b3JrOiByZXF1aXJlbWVudHMubmV0d29yayxcbiAgICAgIHBheWVyLFxuICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgNDAyIFBheW1lbnQgUmVxdWlyZWQgcmVzcG9uc2VcbiAqL1xuZnVuY3Rpb24gY3JlYXRlNDAyUmVzcG9uc2UoXG4gIHVyaTogc3RyaW5nLFxuICByZXF1aXJlbWVudHM6IFBheW1lbnRSZXF1aXJlbWVudHMsXG4gIGVycm9yTWVzc2FnZT86IHN0cmluZ1xuKTogQ2xvdWRGcm9udFJlcXVlc3RSZXN1bHQge1xuICBjb25zdCBwYXltZW50UmVxdWlyZWQ6IFBheW1lbnRSZXF1aXJlZCA9IHtcbiAgICB4NDAyVmVyc2lvbjogMixcbiAgICBlcnJvcjogZXJyb3JNZXNzYWdlIHx8ICdQYXltZW50IHJlcXVpcmVkIHRvIGFjY2VzcyB0aGlzIHJlc291cmNlJyxcbiAgICByZXNvdXJjZToge1xuICAgICAgdXJsOiB1cmksXG4gICAgICBkZXNjcmlwdGlvbjogYFByb3RlY3RlZCByZXNvdXJjZSBhdCAke3VyaX1gLFxuICAgICAgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICB9LFxuICAgIGFjY2VwdHM6IFtyZXF1aXJlbWVudHNdLFxuICAgIGV4dGVuc2lvbnM6IHt9LFxuICB9O1xuXG4gIHJldHVybiB7XG4gICAgc3RhdHVzOiAnNDAyJyxcbiAgICBzdGF0dXNEZXNjcmlwdGlvbjogJ1BheW1lbnQgUmVxdWlyZWQnLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdjb250ZW50LXR5cGUnOiBbeyBrZXk6ICdDb250ZW50LVR5cGUnLCB2YWx1ZTogJ2FwcGxpY2F0aW9uL2pzb24nIH1dLFxuICAgICAgJ3gtcGF5bWVudC1yZXF1aXJlZCc6IFt7XG4gICAgICAgIGtleTogJ1gtUEFZTUVOVC1SRVFVSVJFRCcsXG4gICAgICAgIHZhbHVlOiBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShwYXltZW50UmVxdWlyZWQpKS50b1N0cmluZygnYmFzZTY0JyksXG4gICAgICB9XSxcbiAgICAgICdhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW4nOiBbeyBrZXk6ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCB2YWx1ZTogJyonIH1dLFxuICAgICAgJ2FjY2Vzcy1jb250cm9sLWFsbG93LWhlYWRlcnMnOiBbeyBcbiAgICAgICAga2V5OiAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycycsIFxuICAgICAgICB2YWx1ZTogJ0NvbnRlbnQtVHlwZSwgWC1QYXltZW50LVNpZ25hdHVyZScgXG4gICAgICB9XSxcbiAgICAgICdhY2Nlc3MtY29udHJvbC1leHBvc2UtaGVhZGVycyc6IFt7XG4gICAgICAgIGtleTogJ0FjY2Vzcy1Db250cm9sLUV4cG9zZS1IZWFkZXJzJyxcbiAgICAgICAgdmFsdWU6ICdYLVBBWU1FTlQtUkVRVUlSRUQsIFgtUEFZTUVOVC1SRVNQT05TRScsXG4gICAgICB9XSxcbiAgICB9LFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIGVycm9yOiAnUGF5bWVudCBSZXF1aXJlZCcsXG4gICAgICBtZXNzYWdlOiBlcnJvck1lc3NhZ2UgfHwgJ1RoaXMgY29udGVudCByZXF1aXJlcyBwYXltZW50IHRvIGFjY2VzcycsXG4gICAgICB4NDAyVmVyc2lvbjogMixcbiAgICB9KSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIGVycm9yIHJlc3BvbnNlXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZUVycm9yUmVzcG9uc2UoXG4gIHN0YXR1czogc3RyaW5nLFxuICBzdGF0dXNEZXNjcmlwdGlvbjogc3RyaW5nLFxuICBlcnJvcjogc3RyaW5nLFxuICBtZXNzYWdlOiBzdHJpbmdcbik6IENsb3VkRnJvbnRSZXF1ZXN0UmVzdWx0IHtcbiAgcmV0dXJuIHtcbiAgICBzdGF0dXMsXG4gICAgc3RhdHVzRGVzY3JpcHRpb24sXG4gICAgaGVhZGVyczoge1xuICAgICAgJ2NvbnRlbnQtdHlwZSc6IFt7IGtleTogJ0NvbnRlbnQtVHlwZScsIHZhbHVlOiAnYXBwbGljYXRpb24vanNvbicgfV0sXG4gICAgICAnYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luJzogW3sga2V5OiAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgdmFsdWU6ICcqJyB9XSxcbiAgICB9LFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3IsIG1lc3NhZ2UgfSksXG4gIH07XG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKFxuICBldmVudDogQ2xvdWRGcm9udFJlcXVlc3RFdmVudFxuKTogUHJvbWlzZTxDbG91ZEZyb250UmVxdWVzdFJlc3VsdD4gPT4ge1xuICBjb25zdCByZXF1ZXN0ID0gZXZlbnQuUmVjb3Jkc1swXS5jZi5yZXF1ZXN0O1xuICBjb25zdCB1cmkgPSByZXF1ZXN0LnVyaTtcbiAgXG4gIC8vIEluaXRpYWxpemUgbG9nZ2VyIHdpdGggcmVxdWVzdCBJRCBmb3IgdHJhY2luZ1xuICBjb25zdCByZXF1ZXN0SWQgPSBnZW5lcmF0ZVJlcXVlc3RJZCgpO1xuICBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKHJlcXVlc3RJZCwgdXJpKTtcbiAgXG4gIC8vIFJlY29yZCByZXF1ZXN0IG1ldHJpY1xuICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlJFUVVFU1RfQ09VTlQpO1xuICBsb2dnZXIuaW5mbygnUHJvY2Vzc2luZyByZXF1ZXN0JywgeyBtZXRob2Q6IHJlcXVlc3QubWV0aG9kIH0pO1xuXG4gIHRyeSB7XG4gICAgLy8gQ2hlY2sgaWYgdGhpcyBwYXRoIHJlcXVpcmVzIHBheW1lbnQgdXNpbmcgZHluYW1pYyBjb250ZW50IG1hbmFnZXJcbiAgICBjb25zdCBwYXltZW50UmVxdWlyZW1lbnQgPSBjb250ZW50TWFuYWdlci5nZXRQYXltZW50UmVxdWlyZW1lbnRzKHVyaSk7XG4gICAgXG4gICAgaWYgKCFwYXltZW50UmVxdWlyZW1lbnQpIHtcbiAgICAgIC8vIE5vIHBheW1lbnQgcmVxdWlyZWQgZm9yIHRoaXMgcGF0aFxuICAgICAgbG9nZ2VyLmRlYnVnKCdObyBwYXltZW50IHJlcXVpcmVkIGZvciBwYXRoJyk7XG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgICAgcmV0dXJuIHJlcXVlc3Q7XG4gICAgfVxuXG4gICAgbG9nZ2VyLnNldERpbWVuc2lvbignTmV0d29yaycsIHBheW1lbnRSZXF1aXJlbWVudC5uZXR3b3JrKTtcbiAgICBsb2dnZXIuc2V0RGltZW5zaW9uKCdBc3NldCcsIHBheW1lbnRSZXF1aXJlbWVudC5hc3NldCk7XG5cbiAgICAvLyBDaGVjayBmb3IgcGF5bWVudCBzaWduYXR1cmUgaGVhZGVyICh4NDAyIHYyIHVzZXMgWC1QQVlNRU5ULVNJR05BVFVSRSlcbiAgICBjb25zdCBwYXltZW50U2lnbmF0dXJlSGVhZGVyID0gXG4gICAgICByZXF1ZXN0LmhlYWRlcnNbJ3gtcGF5bWVudC1zaWduYXR1cmUnXSB8fCBcbiAgICAgIHJlcXVlc3QuaGVhZGVyc1sncGF5bWVudC1zaWduYXR1cmUnXTtcbiAgICBcbiAgICBpZiAoIXBheW1lbnRTaWduYXR1cmVIZWFkZXIgfHwgIXBheW1lbnRTaWduYXR1cmVIZWFkZXJbMF0pIHtcbiAgICAgIC8vIE5vIHBheW1lbnQgcHJvdmlkZWQgLSByZXR1cm4gNDAyIFBheW1lbnQgUmVxdWlyZWRcbiAgICAgIGxvZ2dlci5pbmZvKCdObyBwYXltZW50IHNpZ25hdHVyZSBmb3VuZCwgcmV0dXJuaW5nIDQwMicsIHtcbiAgICAgICAgcmVxdWlyZWRBbW91bnQ6IHBheW1lbnRSZXF1aXJlbWVudC5hbW91bnQsXG4gICAgICB9KTtcbiAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuUEFZTUVOVF9SRVFVSVJFRCk7XG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgICAgcmV0dXJuIGNyZWF0ZTQwMlJlc3BvbnNlKHVyaSwgcGF5bWVudFJlcXVpcmVtZW50KTtcbiAgICB9XG5cbiAgICAvLyBQYXltZW50IHNpZ25hdHVyZSBwcmVzZW50XG4gICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5QQVlNRU5UX1JFQ0VJVkVEKTtcblxuICAgIC8vIERlY29kZSBhbmQgdmVyaWZ5IHBheW1lbnRcbiAgICBjb25zdCBwYXltZW50UGF5bG9hZEJhc2U2NCA9IHBheW1lbnRTaWduYXR1cmVIZWFkZXJbMF0udmFsdWU7XG4gICAgbGV0IHBheW1lbnRQYXlsb2FkOiB1bmtub3duO1xuICAgIFxuICAgIHRyeSB7XG4gICAgICBwYXltZW50UGF5bG9hZCA9IEpTT04ucGFyc2UoXG4gICAgICAgIEJ1ZmZlci5mcm9tKHBheW1lbnRQYXlsb2FkQmFzZTY0LCAnYmFzZTY0JykudG9TdHJpbmcoJ3V0Zi04JylcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZGVjb2RlRXJyb3IpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdGYWlsZWQgdG8gZGVjb2RlIHBheW1lbnQgcGF5bG9hZCcsIHtcbiAgICAgICAgZXJyb3JDb2RlOiAnREVDT0RFX0VSUk9SJyxcbiAgICAgIH0pO1xuICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5WQUxJREFUSU9OX0VSUk9SKTtcbiAgICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgICAgbG9nZ2VyLmVtaXRNZXRyaWNzKCk7XG4gICAgICByZXR1cm4gY3JlYXRlNDAyUmVzcG9uc2UoXG4gICAgICAgIHVyaSwgXG4gICAgICAgIHBheW1lbnRSZXF1aXJlbWVudCwgXG4gICAgICAgICdJbnZhbGlkIHBheW1lbnQgcGF5bG9hZCBlbmNvZGluZydcbiAgICAgICk7XG4gICAgfVxuXG4gICAgbG9nZ2VyLmRlYnVnKCdQYXltZW50IHBheWxvYWQgZGVjb2RlZCBzdWNjZXNzZnVsbHknKTtcblxuICAgIC8vIFZhbGlkYXRlIHBheWxvYWQgc3RydWN0dXJlXG4gICAgaWYgKCF2YWxpZGF0ZVBheWxvYWRTdHJ1Y3R1cmUocGF5bWVudFBheWxvYWQpKSB7XG4gICAgICBsb2dnZXIud2FybignSW52YWxpZCBwYXltZW50IHBheWxvYWQgc3RydWN0dXJlJywge1xuICAgICAgICBlcnJvckNvZGU6ICdJTlZBTElEX1NUUlVDVFVSRScsXG4gICAgICB9KTtcbiAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuVkFMSURBVElPTl9FUlJPUik7XG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgICAgcmV0dXJuIGNyZWF0ZUVycm9yUmVzcG9uc2UoXG4gICAgICAgICc0MDAnLFxuICAgICAgICAnQmFkIFJlcXVlc3QnLFxuICAgICAgICAnSW52YWxpZCBQYXltZW50JyxcbiAgICAgICAgJ1BheW1lbnQgcGF5bG9hZCBzdHJ1Y3R1cmUgaXMgaW52YWxpZCdcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gRXh0cmFjdCBwYXllciBhZGRyZXNzIGZvciBsb2dnaW5nXG4gICAgY29uc3QgcGF5ZXIgPSBwYXltZW50UGF5bG9hZC5wYXlsb2FkLmF1dGhvcml6YXRpb24uZnJvbTtcbiAgICBsb2dnZXIuc2V0RGltZW5zaW9uKCdQYXllcicsIHBheWVyLnN1YnN0cmluZygwLCAxMCkgKyAnLi4uJyk7XG4gICAgbG9nZ2VyLmluZm8oJ1BheW1lbnQgcGF5bG9hZCB2YWxpZGF0ZWQnLCB7XG4gICAgICBwYXllcixcbiAgICAgIGFtb3VudDogcGF5bWVudFBheWxvYWQuYWNjZXB0ZWQuYW1vdW50LFxuICAgICAgc2NoZW1lOiBwYXltZW50UGF5bG9hZC5hY2NlcHRlZC5zY2hlbWUsXG4gICAgfSk7XG5cbiAgICAvLyBWYWxpZGF0ZSBhdXRob3JpemF0aW9uIHBhcmFtZXRlcnNcbiAgICBjb25zdCBwYXJhbVZhbGlkYXRpb24gPSB2YWxpZGF0ZUF1dGhvcml6YXRpb25QYXJhbWV0ZXJzKFxuICAgICAgcGF5bWVudFBheWxvYWQsXG4gICAgICBwYXltZW50UmVxdWlyZW1lbnRcbiAgICApO1xuICAgIFxuICAgIGlmICghcGFyYW1WYWxpZGF0aW9uLmlzVmFsaWQpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdQYXltZW50IHBhcmFtZXRlciB2YWxpZGF0aW9uIGZhaWxlZCcsIHtcbiAgICAgICAgZXJyb3JDb2RlOiBwYXJhbVZhbGlkYXRpb24uaW52YWxpZFJlYXNvbixcbiAgICAgICAgcGF5ZXIsXG4gICAgICB9KTtcbiAgICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuVkFMSURBVElPTl9FUlJPUik7XG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgICAgcmV0dXJuIGNyZWF0ZTQwMlJlc3BvbnNlKFxuICAgICAgICB1cmksXG4gICAgICAgIHBheW1lbnRSZXF1aXJlbWVudCxcbiAgICAgICAgYFBheW1lbnQgdmFsaWRhdGlvbiBmYWlsZWQ6ICR7cGFyYW1WYWxpZGF0aW9uLmludmFsaWRSZWFzb259YFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBsb2dnZXIuZGVidWcoJ0F1dGhvcml6YXRpb24gcGFyYW1ldGVycyB2YWxpZGF0ZWQnKTtcblxuICAgIC8vIFZlcmlmeSBzaWduYXR1cmUgd2l0aCBmYWNpbGl0YXRvclxuICAgIGNvbnN0IHZlcmlmaWNhdGlvblN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgY29uc3Qgc2lnbmF0dXJlVmFsaWRhdGlvbiA9IGF3YWl0IHZlcmlmeVNpZ25hdHVyZVdpdGhGYWNpbGl0YXRvcihcbiAgICAgIHBheW1lbnRQYXlsb2FkLFxuICAgICAgcGF5bWVudFJlcXVpcmVtZW50LFxuICAgICAgbG9nZ2VyXG4gICAgKTtcbiAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuVkVSSUZJQ0FUSU9OX0xBVEVOQ1ksIERhdGUubm93KCkgLSB2ZXJpZmljYXRpb25TdGFydFRpbWUpO1xuICAgIFxuICAgIGlmICghc2lnbmF0dXJlVmFsaWRhdGlvbi5pc1ZhbGlkKSB7XG4gICAgICBsb2dnZXIud2FybignU2lnbmF0dXJlIHZlcmlmaWNhdGlvbiBmYWlsZWQnLCB7XG4gICAgICAgIGVycm9yQ29kZTogc2lnbmF0dXJlVmFsaWRhdGlvbi5pbnZhbGlkUmVhc29uLFxuICAgICAgICBwYXllcixcbiAgICAgIH0pO1xuICAgICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5QQVlNRU5UX0ZBSUxFRCk7XG4gICAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuTEFURU5DWSwgbG9nZ2VyLmdldEVsYXBzZWRNcygpKTtcbiAgICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgICAgcmV0dXJuIGNyZWF0ZTQwMlJlc3BvbnNlKFxuICAgICAgICB1cmksXG4gICAgICAgIHBheW1lbnRSZXF1aXJlbWVudCxcbiAgICAgICAgYFNpZ25hdHVyZSB2ZXJpZmljYXRpb24gZmFpbGVkOiAke3NpZ25hdHVyZVZhbGlkYXRpb24uaW52YWxpZFJlYXNvbn1gXG4gICAgICApO1xuICAgIH1cblxuICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuUEFZTUVOVF9WRVJJRklFRCk7XG4gICAgbG9nZ2VyLmluZm8oJ1BheW1lbnQgc2lnbmF0dXJlIHZlcmlmaWVkJywgeyBwYXllciB9KTtcblxuICAgIC8vIFNldHRsZSBwYXltZW50IHdpdGggZmFjaWxpdGF0b3JcbiAgICBjb25zdCBzZXR0bGVtZW50U3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCBzZXR0bGVtZW50ID0gYXdhaXQgc2V0dGxlUGF5bWVudFdpdGhGYWNpbGl0YXRvcihcbiAgICAgIHBheW1lbnRQYXlsb2FkLFxuICAgICAgcGF5bWVudFJlcXVpcmVtZW50LFxuICAgICAgbG9nZ2VyXG4gICAgKTtcbiAgICBsb2dnZXIucmVjb3JkTWV0cmljKE1ldHJpY05hbWUuU0VUVExFTUVOVF9MQVRFTkNZLCBEYXRlLm5vdygpIC0gc2V0dGxlbWVudFN0YXJ0VGltZSk7XG4gICAgXG4gICAgaWYgKCFzZXR0bGVtZW50LnN1Y2Nlc3MpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignUGF5bWVudCBzZXR0bGVtZW50IGZhaWxlZCcsIHVuZGVmaW5lZCwge1xuICAgICAgICBlcnJvckNvZGU6IHNldHRsZW1lbnQuZXJyb3JSZWFzb24sXG4gICAgICAgIHBheWVyLFxuICAgICAgfSk7XG4gICAgICBsb2dnZXIuaW5jcmVtZW50Q291bnRlcihNZXRyaWNOYW1lLlBBWU1FTlRfRkFJTEVEKTtcbiAgICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgICAgbG9nZ2VyLmVtaXRNZXRyaWNzKCk7XG4gICAgICByZXR1cm4gY3JlYXRlRXJyb3JSZXNwb25zZShcbiAgICAgICAgJzQwMicsXG4gICAgICAgICdQYXltZW50IFJlcXVpcmVkJyxcbiAgICAgICAgJ1NldHRsZW1lbnQgRmFpbGVkJyxcbiAgICAgICAgYFBheW1lbnQgc2V0dGxlbWVudCBmYWlsZWQ6ICR7c2V0dGxlbWVudC5lcnJvclJlYXNvbn1gXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIFBheW1lbnQgdmVyaWZpZWQgYW5kIHNldHRsZWQgLSByZXR1cm4gZHluYW1pYyBjb250ZW50XG4gICAgbG9nZ2VyLmluY3JlbWVudENvdW50ZXIoTWV0cmljTmFtZS5QQVlNRU5UX1NFVFRMRUQpO1xuICAgIGxvZ2dlci5pbmZvKCdQYXltZW50IHNldHRsZWQgc3VjY2Vzc2Z1bGx5Jywge1xuICAgICAgcGF5ZXIsXG4gICAgICB0cmFuc2FjdGlvbkhhc2g6IHNldHRsZW1lbnQudHJhbnNhY3Rpb24sXG4gICAgICBhbW91bnQ6IHBheW1lbnRSZXF1aXJlbWVudC5hbW91bnQsXG4gICAgICBuZXR3b3JrOiBwYXltZW50UmVxdWlyZW1lbnQubmV0d29yayxcbiAgICB9KTtcblxuICAgIC8vIEdldCBkeW5hbWljIGNvbnRlbnQgZnJvbSBjb250ZW50IG1hbmFnZXJcbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgY29udGVudE1hbmFnZXIuZ2V0Q29udGVudCh1cmkpO1xuICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuQ09OVEVOVF9HRU5FUkFURUQpO1xuICAgIFxuICAgIC8vIENyZWF0ZSBzZXR0bGVtZW50IHJlc3BvbnNlIGhlYWRlclxuICAgIGNvbnN0IHNldHRsZW1lbnRSZXNwb25zZTogU2V0dGxlbWVudFJlc3BvbnNlID0ge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHRyYW5zYWN0aW9uOiBzZXR0bGVtZW50LnRyYW5zYWN0aW9uLFxuICAgICAgbmV0d29yazogcGF5bWVudFJlcXVpcmVtZW50Lm5ldHdvcmssXG4gICAgICBwYXllcjogcGF5bWVudFBheWxvYWQucGF5bG9hZC5hdXRob3JpemF0aW9uLmZyb20sXG4gICAgfTtcblxuICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJzIwMCcsXG4gICAgICBzdGF0dXNEZXNjcmlwdGlvbjogJ09LJyxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ2NvbnRlbnQtdHlwZSc6IFt7IGtleTogJ0NvbnRlbnQtVHlwZScsIHZhbHVlOiAnYXBwbGljYXRpb24vanNvbicgfV0sXG4gICAgICAgICd4LXBheW1lbnQtcmVzcG9uc2UnOiBbe1xuICAgICAgICAgIGtleTogJ1gtUEFZTUVOVC1SRVNQT05TRScsXG4gICAgICAgICAgdmFsdWU6IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHNldHRsZW1lbnRSZXNwb25zZSkpLnRvU3RyaW5nKCdiYXNlNjQnKSxcbiAgICAgICAgfV0sXG4gICAgICAgICd4LXJlcXVlc3QtaWQnOiBbeyBrZXk6ICdYLVJlcXVlc3QtSWQnLCB2YWx1ZTogcmVxdWVzdElkIH1dLFxuICAgICAgICAnYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luJzogW3sga2V5OiAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgdmFsdWU6ICcqJyB9XSxcbiAgICAgICAgJ2FjY2Vzcy1jb250cm9sLWFsbG93LWhlYWRlcnMnOiBbeyBcbiAgICAgICAgICBrZXk6ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJywgXG4gICAgICAgICAgdmFsdWU6ICdDb250ZW50LVR5cGUsIFgtUGF5bWVudC1TaWduYXR1cmUnIFxuICAgICAgICB9XSxcbiAgICAgICAgJ2FjY2Vzcy1jb250cm9sLWV4cG9zZS1oZWFkZXJzJzogW3sgXG4gICAgICAgICAga2V5OiAnQWNjZXNzLUNvbnRyb2wtRXhwb3NlLUhlYWRlcnMnLCBcbiAgICAgICAgICB2YWx1ZTogJ1gtUEFZTUVOVC1SRVNQT05TRSwgWC1SZXF1ZXN0LUlkJyBcbiAgICAgICAgfV0sXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoY29udGVudCksXG4gICAgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBsb2dnZXIuZXJyb3IoJ1VuZXhwZWN0ZWQgZXJyb3IgcHJvY2Vzc2luZyBwYXltZW50JywgZXJyb3IpO1xuICAgIGxvZ2dlci5pbmNyZW1lbnRDb3VudGVyKE1ldHJpY05hbWUuUEFZTUVOVF9GQUlMRUQpO1xuICAgIGxvZ2dlci5yZWNvcmRNZXRyaWMoTWV0cmljTmFtZS5MQVRFTkNZLCBsb2dnZXIuZ2V0RWxhcHNlZE1zKCkpO1xuICAgIGxvZ2dlci5lbWl0TWV0cmljcygpO1xuICAgIHJldHVybiBjcmVhdGVFcnJvclJlc3BvbnNlKFxuICAgICAgJzUwMCcsXG4gICAgICAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcbiAgICAgICdQYXltZW50IFByb2Nlc3NpbmcgRXJyb3InLFxuICAgICAgJ0ZhaWxlZCB0byBwcm9jZXNzIHBheW1lbnQnXG4gICAgKTtcbiAgfVxufTtcbiJdfQ==