import { useState } from 'react';
import './ContentRequest.css';
import { TransactionConfirmation, type TransactionDetails } from './TransactionConfirmation';

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

interface ContentRequestProps {
  walletConnected: boolean;
  onRequestContent?: (item: ContentItem) => Promise<ContentResult>;
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

export function ContentRequest({ walletConnected, onRequestContent }: ContentRequestProps) {
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [paymentRequirement, setPaymentRequirement] = useState<PaymentRequirement | null>(null);
  const [result, setResult] = useState<ContentResult | null>(null);
  const [transactionDetails, setTransactionDetails] = useState<TransactionDetails | null>(null);
  const [agentReasoning, setAgentReasoning] = useState<string>('');
  const [stepTimings, setStepTimings] = useState<Record<string, number>>({});
  const [flowStartTime, setFlowStartTime] = useState<number | null>(null);
  const [totalElapsed, setTotalElapsed] = useState<number>(0);

  const handleSelectContent = (item: ContentItem) => {
    setSelectedItem(item);
    setStatus('idle');
    setPaymentRequirement(null);
    setResult(null);
    setTransactionDetails(null);
    setAgentReasoning('');
    setStepTimings({});
    setFlowStartTime(null);
    setTotalElapsed(0);
  };

  const recordStepTiming = (stepStatus: PaymentStatus, startTime: number) => {
    const duration = Date.now() - startTime;
    setStepTimings(prev => ({ ...prev, [stepStatus]: duration }));
    setTotalElapsed(Date.now() - (flowStartTime || Date.now()));
  };

  const handleRequestContent = async () => {
    if (!selectedItem || !walletConnected) return;

    // Reset state
    setResult(null);
    setAgentReasoning('');
    setStepTimings({});
    const startTime = Date.now();
    setFlowStartTime(startTime);

    // Simulate the x402 payment flow
    try {
      // Step 1: Initial request
      let stepStart = Date.now();
      setStatus('requesting');
      await simulateDelay(800);
      recordStepTiming('requesting', stepStart);

      // Step 2: Receive 402 Payment Required
      stepStart = Date.now();
      setStatus('payment_required');
      setPaymentRequirement({
        scheme: 'exact',
        network: 'base-sepolia',
        amount: selectedItem.price,
        asset: 'USDC',
        payTo: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      });
      await simulateDelay(1000);
      recordStepTiming('payment_required', stepStart);

      // Step 3: AI analyzes payment
      stepStart = Date.now();
      setStatus('analyzing');
      setAgentReasoning('Analyzing payment request... Amount is within acceptable range. Recipient address verified. Proceeding with payment.');
      await simulateDelay(1500);
      recordStepTiming('analyzing', stepStart);

      // Step 4: Sign transaction
      stepStart = Date.now();
      setStatus('signing');
      setAgentReasoning(prev => prev + '\n\nSigning transaction with AgentKit wallet...');
      await simulateDelay(1200);
      recordStepTiming('signing', stepStart);

      // Step 5: Retry with payment
      stepStart = Date.now();
      setStatus('retrying');
      await simulateDelay(800);
      recordStepTiming('retrying', stepStart);

      // Step 6: Success
      stepStart = Date.now();
      setStatus('success');
      setTotalElapsed(Date.now() - startTime);
      
      // If callback provided, use it; otherwise use mock data
      if (onRequestContent) {
        const contentResult = await onRequestContent(selectedItem);
        setResult(contentResult);
        
        // Create transaction details from result
        if (contentResult.transactionHash && paymentRequirement) {
          setTransactionDetails({
            hash: contentResult.transactionHash,
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
      } else {
        // Mock successful response
        const mockHash = `0x${generateMockHash()}`;
        const mockPaymentReq = {
          scheme: 'exact',
          network: 'base-sepolia',
          amount: selectedItem.price,
          asset: 'USDC',
          payTo: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        };
        
        setResult({
          content: getMockContent(selectedItem.id),
          transactionHash: mockHash,
        });
        
        // Set transaction details for the confirmation display
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
      }
      recordStepTiming('success', stepStart);
    } catch (error) {
      setStatus('error');
      setResult({
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  };

  const handleReset = () => {
    setSelectedItem(null);
    setStatus('idle');
    setPaymentRequirement(null);
    setResult(null);
    setTransactionDetails(null);
    setAgentReasoning('');
    setStepTimings({});
    setFlowStartTime(null);
    setTotalElapsed(0);
  };

  return (
    <div className="content-request">
      <div className="content-header">
        <h3>Premium Content</h3>
        <p>Select content to purchase with x402 payment</p>
      </div>

      {/* Content Selection */}
      <div className="content-grid">
        {AVAILABLE_CONTENT.map((item) => (
          <button
            key={item.id}
            className={`content-card ${selectedItem?.id === item.id ? 'selected' : ''}`}
            onClick={() => handleSelectContent(item)}
            disabled={status !== 'idle' && status !== 'success' && status !== 'error'}
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
              disabled={!walletConnected}
            >
              {walletConnected ? 'Request Content' : 'Connect Wallet First'}
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

          {/* Agent Reasoning */}
          {agentReasoning && (
            <div className="agent-reasoning">
              <h5>🤖 Agent Reasoning</h5>
              <pre>{agentReasoning}</pre>
            </div>
          )}

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
                  {/* Transaction Confirmation Display */}
                  {transactionDetails && (
                    <TransactionConfirmation 
                      transaction={transactionDetails}
                      showDetails={true}
                    />
                  )}
                  
                  {/* Content Preview */}
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

// Flow step component with enhanced visualization
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

// Step configuration with icons and descriptions
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

export default ContentRequest;
