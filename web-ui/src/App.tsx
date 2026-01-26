import { useState } from 'react';
import { WalletDisplay, ContentRequest } from './components';
import type { WalletInfo } from './components';
import './App.css';

// Demo wallet data for Base Sepolia testnet
const DEMO_WALLET: WalletInfo = {
  address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE21',
  balance: '0.015432',
  network: 'Base Sepolia',
  currency: 'ETH',
};

function App() {
  const [wallet, setWallet] = useState<WalletInfo | undefined>(DEMO_WALLET);
  const [isLoading, setIsLoading] = useState(false);

  const handleRefresh = () => {
    setIsLoading(true);
    // Simulate wallet refresh
    setTimeout(() => {
      setWallet({
        ...DEMO_WALLET,
        balance: (Math.random() * 0.1).toFixed(6),
      });
      setIsLoading(false);
    }, 1000);
  };

  const toggleWallet = () => {
    setWallet(wallet ? undefined : DEMO_WALLET);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>x402 Payment Demo</h1>
        <p>AI-powered content payments on AWS</p>
      </header>

      <main className="app-main">
        <section className="wallet-section">
          <h2>Wallet</h2>
          <WalletDisplay 
            wallet={wallet} 
            isLoading={isLoading}
            onRefresh={handleRefresh}
          />
          <button className="toggle-btn" onClick={toggleWallet}>
            {wallet ? 'Disconnect Wallet' : 'Connect Wallet'}
          </button>
        </section>

        <section className="content-section">
          <h2>Content</h2>
          <ContentRequest walletConnected={!!wallet} />
        </section>
      </main>
    </div>
  );
}

export default App;
