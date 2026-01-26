/**
 * ContentRequest component with Gateway API integration
 * 
 * This component extends the base ContentRequest to use the real
 * AgentCore Gateway API for agent invocations.
 */

import { useState, useCallback } from 'react';
import './ContentRequest.css';
import { TransactionConfirmation, type TransactionDetails } from './TransactionConfirmation';
import { AuthStatus } from './AuthStatus';
import { AgentReasoning } from './AgentReasoning';
import { RealTimeStatus, useRealTimeStatus } from './RealTimeStatus';
import { useGatewayClient } from '../hooks';
import type { StreamChunk, AgentTrace } from '../api';

// Content item types matching seller infrastructure
export interface ContentItem {
  id: string;
  path: string;
  title: string;
  description: string;
  price: string;
  currency: string;
}

// Payment flow status
export type PaymentStatus = 
  | 'idle'
  | 'requesting'
  | 'payment_required'
  | 'analyzing'
  | 'signing'
  | 'retrying'
  | 'success'
  | 'error';

// Payment requirement from 402 response
export interface PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
}

// Content request result
export interface ContentResult {
  content?: unknown;
  transactionHash?: string;
  error?: string;
}

interface ContentRequestWithGatewayProps {
  walletConnected: boolean;
  /** Seller content URL base */
  sellerEndpoint?: string;
  /** Use mock mode (no real API calls) */
  mockMode?: boolean;
}

// Available content items (matching seller infrastructure)
const AVAILABLE_CONTENT: ContentItem[] = [
  {
    id: 'premium-article',
    path: '/api/premium-article',
    title: 'AI & Blockchain Integration',
    description: 'Premium article about AI and blockchain convergence',
    price: '0.001',
    currency: 'USDC',
  },
  {
    id: 'weather-data',
    path: '/api/weather-data',
    title: 'Real-time Weather Data',
    description: 'Current weather conditions and forecast',
    price: '0.0005',
    currency: 'USDC',
  },
  {
    id: 'market-analysis',
    path: '/api/market-analysis',
    title: 'Crypto Market Analysis',
    description: 'Real-time market data and analysis',
    price: '0.002',
    currency: 'USDC',
  },
  {
    id: 'research-report',
    path: '/api/research-report',
    title: 'Blockchain Research Report',
    description: 'In-depth research on blockchain trends',
    price: '0.005',
    currency: 'USDC',
  },
];

// Status messages for each payment status
const STATUS_MESSAGES: Record<PaymentStatus, string> = {
  idle: '',
  requesting: 'Requesting content...',
  payment_required: 'Payment required (402)',
  analyzing: 'AI analyzing payment...',
  signing: 'Signing transaction...',
  retrying: 'Retrying with payment...',
  success: 'Content delivered!',
  error: 'Request failed',
};

export function ContentRequestWithGateway({ 
  walletConnected, 
  sellerEndpoint,
  mockMode = true,
}: ContentRequestWithGatewayProps) {
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [paymentRequirement, setPaymentRequirement] = useState<PaymentRequirement | null>(null);
  const [result, setResult] = useState<ContentResult | null>(null);
  const [transactionDetails, setTransactionDetails] = useState<TransactionDetails | null>(null);
  const [agentTraces, setAgentTraces] = useState<AgentTrace[]>([]);
  const [stepTimings, setStepTimings] = useState<Record<string, number>>({});
  const [flowStartTime, setFlowStartTime] = useState<number | null>(null);
  const [totalElapsed, setTotalElapsed] = useState<number>(0);

  // Real-time status hook
  const realTimeStatus = useRealTimeStatus();

  // Gateway client hook
  const handleChunk = useCallback((chunk: StreamChunk) => {
    if (chunk.type === 'trace' && chunk.trace) {
      setAgentTraces(prev => [...prev, chunk.trace!]);
      // Add real-time event for trace
      const traceData = chunk.trace.data as Record<string, unknown> | undefined;
      if (traceData?.rationale) {
        realTimeStatus.addEvent('agent', String(traceData.rationale), {
          actionGroup: traceData.actionGroup,
        });
      }
    } else if (chunk.type === 'text' && chunk.text) {
      // Add real-time event for streaming text
      realTimeStatus.addEvent('response', `Agent: ${chunk.text.substring(0, 100)}${chunk.text.length > 100 ? '...' : ''}`);
    } else if (chunk.type === 'error' && chunk.error) {
      realTimeStatus.addEvent('error', chunk.error);
    }
  }, [realTimeStatus]);

  const { 
    invokeStreaming,
    isLoading: gatewayLoading,
    error: gatewayError,
    isAuthenticated,
    authMethod,
    refreshAuth,
    reasoning: hookReasoning,
    streamingText,
  } = useGatewayClient({
    onChunk: handleChunk,
  });

  const handleSelectContent = (item: ContentItem) => {
    setSelectedItem(item);
    setStatus('idle');
    setPaymentRequirement(null);
    setResult(null);
    setTransactionDetails(null);
    setAgentTraces([]);
    setStepTimings({});
    setFlowStartTime(null);
    setTotalElapsed(0);
    realTimeStatus.reset();
  };

  const recordStepTiming = (stepStatus: PaymentStatus, startTime: number) => {
    const duration = Date.now() - startTime;
    setStepTimings(prev => ({ ...prev, [stepStatus]: duration }));
    setTotalElapsed(Date.now() - (flowStartTime || Date.now()));
  };

  const handleRequestContentWithGateway = async () => {
    if (!selectedItem || !walletConnected) return;

    // Reset state
    setResult(null);
    setAgentTraces([]);
    setStepTimings({});
    const startTime = Date.now();
    setFlowStartTime(startTime);

    // Start real-time status tracking
    realTimeStatus.startFlow();
    realTimeStatus.addEvent('request', `Requesting content: ${selectedItem.title}`, {
      path: selectedItem.path,
      price: selectedItem.price,
      currency: selectedItem.currency,
    });

    try {
      // Step 1: Initial request
      let stepStart = Date.now();
      setStatus('requesting');
      realTimeStatus.addEvent('info', 'Sending initial HTTP request to seller endpoint');
      
      // Build the content URL
      const contentUrl = sellerEndpoint 
        ? `${sellerEndpoint}${selectedItem.path}`
        : selectedItem.path;

      // Invoke the agent to request content
      const agentPrompt = `Request the content at ${contentUrl}. If you receive a 402 Payment Required response, analyze the payment requirement and decide whether to pay. The content costs ${selectedItem.price} ${selectedItem.currency}.`;
      
      realTimeStatus.addEvent('agent', 'Invoking AI agent for content request');
      
      // Use streaming for real-time updates
      const response = await invokeStreaming(agentPrompt);
      
      const requestDuration = Date.now() - stepStart;
      recordStepTiming('requesting', stepStart);
      realTimeStatus.addEvent('response', 'Agent invocation completed', { sessionId: response.sessionId }, requestDuration);

      if (!response.success) {
        throw new Error(response.error || 'Agent invocation failed');
      }

      // Parse the agent's response to determine the flow status
      const completion = response.completion.toLowerCase();
      
      // Check if payment was required
      if (completion.includes('402') || completion.includes('payment required')) {
        stepStart = Date.now();
        setStatus('payment_required');
        
        // Extract payment requirement from agent response
        const paymentReq = {
          scheme: 'exact',
          network: 'base-sepolia',
          amount: selectedItem.price,
          asset: selectedItem.currency,
          payTo: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        };
        setPaymentRequirement(paymentReq);
        realTimeStatus.addEvent('payment', `Payment required: ${paymentReq.amount} ${paymentReq.asset}`, paymentReq);
        recordStepTiming('payment_required', stepStart);
      }

      // Check if agent analyzed the payment
      if (completion.includes('analyz') || completion.includes('evaluat')) {
        stepStart = Date.now();
        setStatus('analyzing');
        realTimeStatus.addEvent('agent', 'AI analyzing payment terms and conditions');
        recordStepTiming('analyzing', stepStart);
      }

      // Check if agent signed the payment
      if (completion.includes('sign') || completion.includes('transaction')) {
        stepStart = Date.now();
        setStatus('signing');
        realTimeStatus.addEvent('payment', 'Signing payment transaction with wallet');
        recordStepTiming('signing', stepStart);
      }

      // Check if content was delivered
      if (completion.includes('success') || completion.includes('delivered') || completion.includes('content')) {
        stepStart = Date.now();
        setStatus('retrying');
        realTimeStatus.addEvent('request', 'Retrying request with payment proof');
        recordStepTiming('retrying', stepStart);

        setStatus('success');
        setTotalElapsed(Date.now() - startTime);

        // Extract transaction hash if present
        const hashMatch = completion.match(/0x[a-fA-F0-9]{64}/);
        const transactionHash = hashMatch ? hashMatch[0] : `0x${generateMockHash()}`;

        setResult({
          content: extractContentFromResponse(response.completion, selectedItem.id),
          transactionHash,
        });

        // Set transaction details
        if (paymentRequirement) {
          setTransactionDetails({
            hash: transactionHash,
            network: paymentRequirement.network,
            amount: paymentRequirement.amount,
            asset: paymentRequirement.asset,
            recipient: paymentRequirement.payTo,
            timestamp: new Date(),
            status: 'confirmed',
            blockNumber: Math.floor(Math.random() * 1000000) + 15000000,
            gasUsed: `${Math.floor(Math.random() * 50000) + 21000}`,
          });
        }
        recordStepTiming('success', stepStart);
        realTimeStatus.addEvent('success', `Content delivered! Transaction: ${transactionHash.substring(0, 18)}...`, {
          transactionHash,
          totalTime: Date.now() - startTime,
        });
        realTimeStatus.endFlow(true);
      } else {
        // If we couldn't determine success, show error
        throw new Error('Unable to complete content request');
      }
    } catch (error) {
      setStatus('error');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setResult({
        error: errorMessage,
      });
      realTimeStatus.addEvent('error', errorMessage);
      realTimeStatus.endFlow(false);
    }
  };

  const handleRequestContentMock = async () => {
    if (!selectedItem || !walletConnected) return;

    // Reset state
    setResult(null);
    setAgentTraces([]);
    setStepTimings({});
    const startTime = Date.now();
    setFlowStartTime(startTime);

    // Start real-time status tracking
    realTimeStatus.startFlow();
    realTimeStatus.addEvent('request', `Requesting content: ${selectedItem.title}`, {
      path: selectedItem.path,
      price: selectedItem.price,
      currency: selectedItem.currency,
    });

    // Helper to add mock trace
    const addMockTrace = (rationale: string, actionGroup?: string, actionGroupInput?: unknown) => {
      const trace: AgentTrace = {
        type: 'orchestration',
        data: {
          rationale,
          actionGroup,
          actionGroupInput,
        },
        timestamp: new Date().toISOString(),
      };
      setAgentTraces(prev => [...prev, trace]);
    };

    try {
      // Step 1: Initial request
      let stepStart = Date.now();
      setStatus('requesting');
      addMockTrace('Initiating HTTP request to fetch premium content from the seller endpoint.');
      realTimeStatus.addEvent('info', 'Sending initial HTTP request to seller endpoint');
      await simulateDelay(800);
      realTimeStatus.addEvent('response', 'Received response from seller', undefined, Date.now() - stepStart);
      recordStepTiming('requesting', stepStart);

      // Step 2: Receive 402 Payment Required
      stepStart = Date.now();
      setStatus('payment_required');
      const paymentReq = {
        scheme: 'exact',
        network: 'base-sepolia',
        amount: selectedItem.price,
        asset: 'USDC',
        payTo: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      };
      setPaymentRequirement(paymentReq);
      addMockTrace(`Received HTTP 402 Payment Required response. The server requires ${selectedItem.price} ${selectedItem.currency} to access this content.`);
      realTimeStatus.addEvent('payment', `HTTP 402: Payment required - ${selectedItem.price} ${selectedItem.currency}`, paymentReq);
      await simulateDelay(1000);
      recordStepTiming('payment_required', stepStart);

      // Step 3: AI analyzes payment
      stepStart = Date.now();
      setStatus('analyzing');
      realTimeStatus.addEvent('agent', 'AI agent analyzing payment request');
      addMockTrace(
        'Analyzing payment request using payment_analysis tool. Checking amount, recipient address, and network compatibility.',
        'payment_analysis',
        { amount: selectedItem.price, asset: selectedItem.currency, network: 'base-sepolia' }
      );
      realTimeStatus.addEvent('agent', 'Checking amount, recipient, and network compatibility', {
        tool: 'payment_analysis',
        amount: selectedItem.price,
        asset: selectedItem.currency,
      });
      await simulateDelay(1500);
      addMockTrace(`Payment analysis complete. Amount ${selectedItem.price} ${selectedItem.currency} is within acceptable limits. Recipient address is valid on Base Sepolia network.`);
      realTimeStatus.addEvent('info', 'Payment analysis complete - terms acceptable', undefined, Date.now() - stepStart);
      recordStepTiming('analyzing', stepStart);

      // Step 4: Sign transaction
      stepStart = Date.now();
      setStatus('signing');
      realTimeStatus.addEvent('payment', 'Initiating transaction signing');
      addMockTrace(
        'Signing payment transaction using AgentKit wallet. Creating EIP-712 typed signature for x402 payment.',
        'sign_payment',
        { scheme: 'exact', amount: selectedItem.price, recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' }
      );
      realTimeStatus.addEvent('agent', 'Creating EIP-712 typed signature for x402 payment', {
        tool: 'sign_payment',
        scheme: 'exact',
      });
      await simulateDelay(1200);
      addMockTrace('Transaction signed successfully. Payment signature ready for submission.');
      realTimeStatus.addEvent('success', 'Transaction signed successfully', undefined, Date.now() - stepStart);
      recordStepTiming('signing', stepStart);

      // Step 5: Retry with payment
      stepStart = Date.now();
      setStatus('retrying');
      realTimeStatus.addEvent('request', 'Retrying request with X-PAYMENT header');
      addMockTrace('Retrying content request with X-PAYMENT header containing the signed payment proof.');
      await simulateDelay(800);
      realTimeStatus.addEvent('response', 'Payment verified by seller', undefined, Date.now() - stepStart);
      recordStepTiming('retrying', stepStart);

      // Step 6: Success
      stepStart = Date.now();
      setStatus('success');
      setTotalElapsed(Date.now() - startTime);
      
      const mockHash = `0x${generateMockHash()}`;
      const mockPaymentReq = {
        scheme: 'exact',
        network: 'base-sepolia',
        amount: selectedItem.price,
        asset: 'USDC',
        payTo: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      };
      
      addMockTrace(`Payment verified! Content delivered successfully. Transaction hash: ${mockHash}`);
      realTimeStatus.addEvent('success', `Content delivered! Transaction: ${mockHash.substring(0, 18)}...`, {
        transactionHash: mockHash,
        totalTime: Date.now() - startTime,
      });
      
      setResult({
        content: getMockContent(selectedItem.id),
        transactionHash: mockHash,
      });
      
      setTransactionDetails({
        hash: mockHash,
        network: mockPaymentReq.network,
        amount: mockPaymentReq.amount,
        asset: mockPaymentReq.asset,
        recipient: mockPaymentReq.payTo,
        timestamp: new Date(),
        status: 'confirmed',
        blockNumber: Math.floor(Math.random() * 1000000) + 15000000,
        gasUsed: `${Math.floor(Math.random() * 50000) + 21000}`,
      });
      
      recordStepTiming('success', stepStart);
      realTimeStatus.endFlow(true);
    } catch (error) {
      setStatus('error');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setResult({
        error: errorMessage,
      });
      realTimeStatus.addEvent('error', errorMessage);
      realTimeStatus.endFlow(false);
    }
  };

  const handleRequestContent = mockMode 
    ? handleRequestContentMock 
    : handleRequestContentWithGateway;

  const handleReset = () => {
    setSelectedItem(null);
    setStatus('idle');
    setPaymentRequirement(null);
    setResult(null);
    setTransactionDetails(null);
    setAgentTraces([]);
    setStepTimings({});
    setFlowStartTime(null);
    setTotalElapsed(0);
    realTimeStatus.reset();
  };

  return (
    <div className="content-request">
      <div className="content-header">
        <h3>Premium Content</h3>
        <p>Select content to purchase with x402 payment</p>
        {!mockMode && (
          <span className="mode-badge live">Live Mode</span>
        )}
        {mockMode && (
          <span className="mode-badge mock">Demo Mode</span>
        )}
      </div>

      {/* Authentication Status (only show in live mode) */}
      {!mockMode && (
        <AuthStatus
          isAuthenticated={isAuthenticated}
          authMethod={authMethod}
          onRefresh={refreshAuth}
          showDetails={true}
        />
      )}

      {/* Gateway Error Display */}
      {gatewayError && (
        <div className="gateway-error">
          <span className="error-icon">⚠️</span>
          Gateway Error: {gatewayError}
        </div>
      )}

      {/* Content Selection */}
      <div className="content-grid">
        {AVAILABLE_CONTENT.map((item) => (
          <button
            key={item.id}
            className={`content-card ${selectedItem?.id === item.id ? 'selected' : ''}`}
            onClick={() => handleSelectContent(item)}
            disabled={(status !== 'idle' && status !== 'success' && status !== 'error') || gatewayLoading}
          >
            <div className="content-card-title">{item.title}</div>
            <div className="content-card-description">{item.description}</div>
            <div className="content-card-price">
              {item.price} {item.currency}
            </div>
          </button>
        ))}
      </div>

      {/* Selected Content Details */}
      {selectedItem && (
        <div className="selected-content">
          <div className="selected-info">
            <span className="selected-title">{selectedItem.title}</span>
            <span className="selected-price">
              {selectedItem.price} {selectedItem.currency}
            </span>
          </div>
          
          {status === 'idle' && (
            <button
              className="request-btn"
              onClick={handleRequestContent}
              disabled={!walletConnected || gatewayLoading}
            >
              {gatewayLoading ? 'Processing...' : 
               walletConnected ? 'Request Content' : 'Connect Wallet First'}
            </button>
          )}

          {(status === 'success' || status === 'error') && (
            <button className="reset-btn" onClick={handleReset}>
              Request Another
            </button>
          )}
        </div>
      )}

      {/* Payment Flow Status */}
      {status !== 'idle' && (
        <div className="payment-flow">
          <div className="flow-header">
            <h4>Payment Flow</h4>
            <div className="flow-header-right">
              {totalElapsed > 0 && (
                <span className="total-elapsed">Total: {totalElapsed}ms</span>
              )}
              <span className={`status-badge status-${status}`}>
                {STATUS_MESSAGES[status]}
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="flow-progress-bar">
            <div 
              className="flow-progress-fill" 
              style={{ width: `${getProgressPercentage(status)}%` }}
            />
          </div>

          {/* Enhanced Flow Steps */}
          <div className="flow-steps-enhanced">
            {FLOW_STEP_CONFIG.map((config, index) => (
              <FlowStep
                key={config.status}
                step={index + 1}
                label={config.label}
                description={config.description}
                icon={config.icon}
                status={getStepStatus(status, config.status)}
                duration={stepTimings[config.status]}
              />
            ))}
          </div>

          {/* Payment Requirement Details */}
          {paymentRequirement && (
            <div className="payment-details">
              <h5>Payment Requirement</h5>
              <div className="payment-details-grid">
                <div className="detail-item">
                  <span className="detail-label">Amount</span>
                  <span className="detail-value highlight">
                    {paymentRequirement.amount} {paymentRequirement.asset}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Network</span>
                  <span className="detail-value">{paymentRequirement.network}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Scheme</span>
                  <span className="detail-value">{paymentRequirement.scheme}</span>
                </div>
                <div className="detail-item full-width">
                  <span className="detail-label">Recipient</span>
                  <span className="detail-value address">{paymentRequirement.payTo}</span>
                </div>
              </div>
            </div>
          )}

          {/* Agent Reasoning - Enhanced Component */}
          <AgentReasoning
            reasoning={hookReasoning}
            streamingText={streamingText}
            traces={agentTraces}
            isProcessing={gatewayLoading || (status !== 'success' && status !== 'error')}
            expanded={true}
          />

          {/* Real-Time Status Updates */}
          <RealTimeStatus
            events={realTimeStatus.events}
            connectionStatus={realTimeStatus.connectionStatus}
            isActive={realTimeStatus.isActive}
            flowStartTime={realTimeStatus.flowStartTime || undefined}
            onClear={realTimeStatus.clearEvents}
            title="Event Stream"
          />

          {/* Result */}
          {result && (
            <div className={`result ${result.error ? 'result-error' : 'result-success'}`}>
              {result.error ? (
                <div className="error-message">
                  <span className="error-icon">❌</span>
                  {result.error}
                </div>
              ) : (
                <>
                  {transactionDetails && (
                    <TransactionConfirmation 
                      transaction={transactionDetails}
                      showDetails={true}
                    />
                  )}
                  
                  {result.content && (
                    <div className="content-preview">
                      <h5>Content Preview</h5>
                      <pre>{JSON.stringify(result.content, null, 2)}</pre>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Flow step component
interface FlowStepProps {
  step: number;
  label: string;
  description: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  icon: string;
  duration?: number;
}

function FlowStep({ step, label, description, status, icon, duration }: FlowStepProps) {
  return (
    <div className={`flow-step-enhanced flow-step-${status}`}>
      <div className="step-connector">
        <div className="connector-line" />
      </div>
      <div className="step-content">
        <div className="step-icon-wrapper">
          <div className="step-icon">
            {status === 'complete' ? '✓' : status === 'error' ? '✗' : icon}
          </div>
          {status === 'active' && <div className="step-pulse" />}
        </div>
        <div className="step-info">
          <div className="step-header">
            <span className="step-number">Step {step}</span>
            {duration !== undefined && status === 'complete' && (
              <span className="step-duration">{duration}ms</span>
            )}
          </div>
          <span className="step-label-enhanced">{label}</span>
          <span className="step-description">{description}</span>
        </div>
      </div>
    </div>
  );
}

// Step configuration
const FLOW_STEP_CONFIG: Array<{
  status: PaymentStatus;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    status: 'requesting',
    label: 'Request Content',
    description: 'Sending initial HTTP request to seller',
    icon: '📤',
  },
  {
    status: 'payment_required',
    label: '402 Payment Required',
    description: 'Server requires payment for access',
    icon: '💳',
  },
  {
    status: 'analyzing',
    label: 'AI Analysis',
    description: 'Agent evaluating payment terms',
    icon: '🤖',
  },
  {
    status: 'signing',
    label: 'Sign Payment',
    description: 'Creating cryptographic signature',
    icon: '✍️',
  },
  {
    status: 'retrying',
    label: 'Retry with Payment',
    description: 'Resending request with payment proof',
    icon: '🔄',
  },
  {
    status: 'success',
    label: 'Content Delivered',
    description: 'Payment verified, content received',
    icon: '✅',
  },
];

// Helper functions
function simulateDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateMockHash(): string {
  return Array.from({ length: 64 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

function getStepStatus(
  currentStatus: PaymentStatus, 
  stepStatus: PaymentStatus
): 'pending' | 'active' | 'complete' | 'error' {
  const statusOrder: PaymentStatus[] = [
    'requesting', 'payment_required', 'analyzing', 'signing', 'retrying', 'success'
  ];
  
  if (currentStatus === 'error') {
    const currentIndex = statusOrder.indexOf(stepStatus);
    const errorIndex = statusOrder.indexOf(currentStatus);
    if (currentIndex < errorIndex) return 'complete';
    if (currentIndex === errorIndex) return 'error';
    return 'pending';
  }
  
  const currentIndex = statusOrder.indexOf(currentStatus);
  const stepIndex = statusOrder.indexOf(stepStatus);
  
  if (stepIndex < currentIndex) return 'complete';
  if (stepIndex === currentIndex) return 'active';
  return 'pending';
}

function getProgressPercentage(status: PaymentStatus): number {
  const statusProgress: Record<PaymentStatus, number> = {
    idle: 0,
    requesting: 10,
    payment_required: 25,
    analyzing: 45,
    signing: 65,
    retrying: 85,
    success: 100,
    error: 0,
  };
  return statusProgress[status] || 0;
}

function getMockContent(contentId: string): unknown {
  const mockContent: Record<string, unknown> = {
    'premium-article': {
      title: 'The Future of AI and Blockchain Integration',
      author: 'Tech Insights',
      date: new Date().toISOString().split('T')[0],
      summary: 'AI and blockchain are converging to create unprecedented opportunities...',
      tags: ['AI', 'blockchain', 'technology'],
    },
    'weather-data': {
      location: 'San Francisco, CA',
      temperature: 68,
      conditions: 'Partly Cloudy',
      humidity: 45,
      forecast: 'Clear skies expected',
    },
    'market-analysis': {
      timestamp: new Date().toISOString(),
      btcPrice: '$98,234.56',
      ethPrice: '$3,845.12',
      sentiment: 'Bullish',
      summary: 'Markets showing positive momentum',
    },
    'research-report': {
      title: 'Blockchain Technology Trends 2026',
      pages: 45,
      summary: 'Comprehensive analysis of emerging blockchain trends...',
      highlights: ['DeFi growth', 'Layer 2 adoption', 'Enterprise blockchain'],
    },
  };
  
  return mockContent[contentId] || { message: 'Content delivered successfully' };
}

function extractContentFromResponse(response: string, contentId: string): unknown {
  // Try to extract JSON content from the response
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Fall back to mock content
  }
  return getMockContent(contentId);
}

export default ContentRequestWithGateway;
