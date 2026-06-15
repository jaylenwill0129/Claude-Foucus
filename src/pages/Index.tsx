import { useState, useCallback } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Zap, LayoutGrid, Bot, Target, Brain, Newspaper, Briefcase, LogOut, Bell, BellRing, Star, BookOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useWebullMarket, useWebullNews, useStockNews } from "@/hooks/useWebullData";
import { usePaperTrading } from "@/hooks/usePaperTrading";
import { useBacktest, RiskParams } from "@/hooks/useBacktest";
import { useAutoTrading, JournalLogger } from "@/hooks/useAutoTrading";
import { useTradeJournal } from "@/hooks/useTradeJournal";
import { useAlerts } from "@/hooks/useAlerts";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { useStockKlines } from "@/hooks/useStockKlines";
import { MarketTicker } from "@/components/MarketTicker";
import { OrderPanel } from "@/components/OrderPanel";
import { PortfolioPanel } from "@/components/PortfolioPanel";
import { ExactTradeSignal, TradeSignalExecution } from "@/components/ExactTradeSignal";
import { OrderPrefill } from "@/components/OrderPanel";
import { NewsFeed } from "@/components/NewsFeed";
import { StrategyPanel, StrategyResult } from "@/components/StrategyPanel";
import { BacktestResults } from "@/components/BacktestResults";
import { AutoTradePanel } from "@/components/AutoTradePanel";
import { TradingPlan } from "@/components/TradingPlan";
import { AlertsPanel } from "@/components/AlertsPanel";
import { PerformanceBar } from "@/components/PerformanceBar";
import { EquityCurve } from "@/components/EquityCurve";
import { WatchlistPanel } from "@/components/WatchlistPanel";
import { TradeAnalytics } from "@/components/TradeAnalytics";
import { QuickActions } from "@/components/QuickActions";
import { StockChart } from "@/components/StockChart";
import { FullScreenChart } from "@/components/FullScreenChart";
import AlpacaDashboard from "@/components/AlpacaDashboard";
import AlpacaPnlChart from "@/components/AlpacaPnlChart";
import RiskDashboard from "@/components/RiskDashboard";
import TradeJournal from "@/components/TradeJournal";
import { PreBoomAlerts } from "@/components/PreBoomAlerts";
import { CryptoIndicators } from "@/components/CryptoIndicators";
import { isCryptoSymbol } from "@/hooks/useWebullData";
import { usePreBoomScanner } from "@/hooks/usePreBoomScanner";
type Tab = "dashboard" | "strategy" | "autotrade" | "alpaca" | "journal" | "news";

const tabs: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { id: "strategy", label: "Strategy", icon: Target },
  { id: "autotrade", label: "Auto-Trade", icon: Bot },
  { id: "alpaca", label: "Alpaca", icon: Briefcase },
  { id: "journal", label: "Journal", icon: BookOpen },
  { id: "news", label: "News", icon: Newspaper },
];

const INITIAL_BALANCE = 100000;

const tabVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const Index = () => {
  const navigate = useNavigate();
  const { marketData, tickers, loading: marketLoading, lastUpdated, nextRefreshIn, refresh: refreshMarket, dataSource, sourcesUsed } = useWebullMarket();
  const { news, loading: newsLoading, refresh: refreshNews } = useWebullNews();
  const { stockNews, loading: stockNewsLoading, currentSymbol: stockNewsSymbol, fetchStockNews } = useStockNews();
  const { getHistory } = usePriceHistory(tickers);
  const symbols = Object.keys(tickers);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [showFullChart, setShowFullChart] = useState(false);
  const [alpacaMode, setAlpacaMode] = useState<"paper" | "live">("paper");
  const [orderPrefill, setOrderPrefill] = useState<OrderPrefill | null>(null);

  const handleExecuteSignal = useCallback((exec: TradeSignalExecution) => {
    setOrderPrefill({ ...exec });
    // Clear prefill after applying so it doesn't re-trigger
    setTimeout(() => setOrderPrefill(null), 100);
  }, []);

  const { signOut, user } = useAuth();
  const activeSymbol = selectedSymbol && tickers[selectedSymbol] ? selectedSymbol : symbols[0] || "";
  const activePrice = activeSymbol && tickers[activeSymbol] ? parseFloat(tickers[activeSymbol].price) || 0 : 0;
  const { klines: activeKlines } = useStockKlines(activeSymbol, activePrice);

  const {
    portfolio, settings: tradingSettings, setSettings: setTradingSettings,
    openPosition, closePosition, placePendingOrder, cancelPendingOrder,
    updatePositionLevels, checkPendingOrders, checkStopLevels,
    addFunds, withdrawFunds, resetBalance,
  } = usePaperTrading();
  const { result: backtestResult, running: backtestRunning, runBacktest, clearResult } = useBacktest();

  const portfolioPnlPct = portfolio.totalPnl !== 0 ? (portfolio.totalPnl / INITIAL_BALANCE) * 100 : 0;

  const {
    alerts, notifications, unreadCount, soundEnabled,
    setSoundEnabled,
    addPriceAlert, addPnlAlert, addSignalAlert,
    removeAlert, clearNotifications,
  } = useAlerts(tickers, portfolioPnlPct);

  // Wire loss limit notifications into the alerts system
  const handleLossLimitHit = useCallback((message: string, severity: "warning" | "error") => {
    if (severity === "error") {
      toast.error(message);
    } else {
      toast.warning(message);
    }
  }, []);

  const { entries: journalEntries, loading: journalLoading, stats: journalStats, logTrade, updateEntry: updateJournalEntry, deleteEntry: deleteJournalEntry, exportCSV: exportJournalCSV } = useTradeJournal();

  const journalLogger: JournalLogger = useCallback((entry) => {
    logTrade({ ...entry, notes: "", tags: [], rating: null, lessons_learned: "" } as any);
  }, [logTrade]);

  const { config: autoTradeConfig, setConfig: setAutoTradeConfig, logs: autoTradeLogs, isAnalyzing: autoTradeAnalyzing, stats: autoTradeStats, marketSession, killSwitch } = useAutoTrading(tickers, openPosition, closePosition, portfolio, handleLossLimitHit, journalLogger);

  // Sync Alpaca mode between tabs
  const handleAlpacaModeChange = useCallback((mode: "paper" | "live") => {
    setAlpacaMode(mode);
    setAutoTradeConfig({ ...autoTradeConfig, alpacaMode: mode });
  }, [autoTradeConfig, setAutoTradeConfig]);

  // Wrap auto-trade config changes to sync alpacaMode back to Alpaca tab
  const handleAutoTradeConfigChange = useCallback((newConfig: typeof autoTradeConfig) => {
    setAutoTradeConfig(newConfig);
    if (newConfig.alpacaMode !== alpacaMode) {
      setAlpacaMode(newConfig.alpacaMode);
    }
  }, [setAutoTradeConfig, alpacaMode]);

  const [riskParams, setRiskParams] = useState<RiskParams>({
    maxPositionPct: 10,
    stopLossPct: 2,
    takeProfitPct: 5,
    riskTolerance: "medium",
  });
  const [latestStrategy, setLatestStrategy] = useState<StrategyResult | null>(null);

  const currentTicker = tickers[activeSymbol];
  const currentPrice = currentTicker ? parseFloat(currentTicker.price) : 0;

  // Pre-boom scanner
  const { alerts: boomAlerts, dismissAlert: dismissBoomAlert, totalScanned } = usePreBoomScanner(tickers);
  const handleBoomSelect = useCallback((sym: string) => {
    setSelectedSymbol(sym);
  }, []);

  const handleStrategyResult = useCallback((result: StrategyResult) => {
    setLatestStrategy(result);
    clearResult();
  }, [clearResult]);

  const handleRunBacktest = useCallback(() => {
    if (!latestStrategy) return;
    const price = currentPrice || 100;
    const syntheticKlines = Array.from({ length: 50 }, (_, i) => {
      const variation = (Math.random() - 0.5) * price * 0.02;
      const close = price + variation * (i / 50);
      return {
        time: Date.now() - (50 - i) * 60000,
        open: close - variation * 0.3,
        high: close + Math.abs(variation) * 0.5,
        low: close - Math.abs(variation) * 0.5,
        close,
        volume: Math.random() * 1000000,
      };
    });
    runBacktest(syntheticKlines, latestStrategy.signals, riskParams);
  }, [latestStrategy, currentPrice, riskParams, runBacktest]);

  return (
    <div className="min-h-screen bg-background terminal-grid flex flex-col">
      {/* Header */}
      <header className="border-b border-border glass-strong px-3 py-1.5 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-primary" />
          </div>
          <h1 className="text-xs font-bold text-foreground tracking-tight">NeuralTrade</h1>
        </div>

        {/* Tab Navigation - scrollable on mobile */}
        <nav className="flex items-center overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-0.5 bg-secondary/50 rounded-lg p-0.5 min-w-max">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? "bg-card text-foreground shadow-sm border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <tab.icon className="w-3 h-3" />
                <span>{tab.label}</span>
                {tab.id === "autotrade" && autoTradeConfig.enabled && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-gain animate-pulse" />
                )}
              </button>
            ))}
          </div>
        </nav>

        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          {dataSource !== "live" && dataSource !== "alpaca" && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
              dataSource === "cached" ? "bg-warning/10 text-warning" : "bg-loss/10 text-loss"
            }`}>
              {dataSource === "cached" ? "CACHED" : "FALLBACK"}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${dataSource === "live" || dataSource === "alpaca" ? "bg-gain animate-pulse" : "bg-warning"}`} />
            <span>{dataSource === "alpaca" ? "ALPACA LIVE" : dataSource === "live" ? "LIVE" : "OFFLINE"}</span>
          </div>
          {unreadCount > 0 && (
            <button onClick={() => setActiveTab("autotrade")} className="relative p-1 rounded hover:bg-secondary transition-colors">
              <BellRing className="w-3.5 h-3.5 text-primary animate-pulse" />
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary text-[7px] text-primary-foreground flex items-center justify-center font-bold">{unreadCount}</span>
            </button>
          )}
          {user && (
            <span className="text-[9px] text-muted-foreground/60 hidden md:inline truncate max-w-[100px]">
              {user.email?.split("@")[0]}
            </span>
          )}
          <button
            onClick={() => navigate("/research")}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Research Notebook"
          >
            <BookOpen className="w-3 h-3" />
            <span className="hidden sm:inline">Research</span>
          </button>
          <button
            onClick={signOut}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Sign out"
          >
            <LogOut className="w-3 h-3" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      {/* Performance Bar */}
      <PerformanceBar
        portfolio={portfolio}
        tickers={tickers}
        autoTradeEnabled={autoTradeConfig.enabled}
        isAnalyzing={autoTradeAnalyzing}
      />

      {/* Market Ticker */}
      <MarketTicker
        tickers={tickers}
        indices={marketData.indices}
        selectedSymbol={activeSymbol}
        onSelect={setSelectedSymbol}
        loading={marketLoading}
        lastUpdated={lastUpdated}
        nextRefreshIn={nextRefreshIn}
        dataSource={dataSource}
        onRefresh={refreshMarket}
        sourcesUsed={sourcesUsed}
      />

      {/* Main Content */}
      <div className="flex-1 px-2 py-2 overflow-y-auto">
        <AnimatePresence mode="wait">
          {/* ===== DASHBOARD TAB ===== */}
          {activeTab === "dashboard" && (
            <motion.div
              key="dashboard"
              variants={tabVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.12 }}
              className="space-y-3"
            >
              {/* Stock Header */}
              {currentTicker && (
                <div className="bg-card rounded-lg border border-border px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold text-foreground">{activeSymbol}</h2>
                        <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-mono font-semibold ${
                          currentTicker.category === "gainer" ? "bg-gain/15 text-gain" :
                          currentTicker.category === "loser" ? "bg-loss/15 text-loss" :
                          "bg-accent/15 text-accent"
                        }`}>
                          {currentTicker.category === "gainer" ? "GAINER" : currentTicker.category === "loser" ? "LOSER" : "ACTIVE"}
                        </span>
                        {currentTicker.profitExpectancy >= 60 && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded-full font-mono font-bold bg-gain/15 text-gain">
                            PE:{currentTicker.profitExpectancy}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{currentTicker.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-mono font-bold text-foreground tabular-nums">
                      ${currentPrice > 0 ? currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--"}
                    </span>
                    <span className={`text-sm font-mono font-semibold ${parseFloat(currentTicker.priceChangePercent) >= 0 ? "text-gain" : "text-loss"}`}>
                      {parseFloat(currentTicker.priceChangePercent) >= 0 ? "▲" : "▼"} {currentTicker.priceChangePercent}%
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      Vol: {currentTicker.volume} · H: {currentTicker.high} · L: {currentTicker.low}
                    </span>
                  </div>
                </div>
              )}

              {/* Stock Chart */}
              {currentTicker && (
                <StockChart
                  symbol={activeSymbol}
                  ticker={currentTicker}
                  priceHistory={getHistory(activeSymbol)}
                  onExpand={() => setShowFullChart(true)}
                />
              )}

              {/* Quick Actions */}
              <QuickActions
                symbol={activeSymbol}
                currentPrice={currentPrice}
                balance={portfolio.balance}
                onOrder={openPosition}
              />

              {/* Pre-Boom Alerts */}
              <PreBoomAlerts
                alerts={boomAlerts}
                onDismiss={dismissBoomAlert}
                onSelect={handleBoomSelect}
                totalScanned={totalScanned}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {isCryptoSymbol(activeSymbol) && (
                  <CryptoIndicators symbol={activeSymbol} ticker={currentTicker} tickers={tickers} />
                )}
                <ExactTradeSignal tickers={tickers} selectedSymbol={activeSymbol} klines={activeKlines} currentPrice={currentPrice} onExecuteTrade={handleExecuteSignal} alpacaMode={alpacaMode} onAlpacaModeChange={setAlpacaMode} />
              <OrderPanel
                  symbol={activeSymbol}
                  currentPrice={currentPrice}
                  balance={portfolio.balance}
                  onOrder={openPosition}
                  onPendingOrder={placePendingOrder}
                  settings={tradingSettings}
                  tickerData={currentTicker ? { high: currentTicker.high, low: currentTicker.low, priceChangePercent: currentTicker.priceChangePercent, volume: currentTicker.volume, profitExpectancy: currentTicker.profitExpectancy } : undefined}
                  prefill={orderPrefill}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <PortfolioPanel
                    portfolio={portfolio}
                    tickers={tickers}
                    onClosePosition={closePosition}
                    onAddFunds={addFunds}
                    onWithdrawFunds={withdrawFunds}
                    onReset={resetBalance}
                    onCancelOrder={cancelPendingOrder}
                    onUpdateLevels={updatePositionLevels}
                    settings={tradingSettings}
                    onSettingsChange={setTradingSettings}
                  />
                </div>
                <div className="space-y-3">
                  <EquityCurve portfolio={portfolio} tickers={tickers} />
                  <WatchlistPanel tickers={tickers} selectedSymbol={activeSymbol} onSelect={setSelectedSymbol} />
                </div>
              </div>

              {/* Trade Analytics */}
              <TradeAnalytics trades={portfolio.trades} positions={portfolio.positions} tickers={tickers} />

            </motion.div>
          )}

          {/* ===== STRATEGY TAB ===== */}
          {activeTab === "strategy" && (
            <motion.div
              key="strategy"
              variants={tabVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.12 }}
              className="space-y-3"
            >
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
                <div className="lg:col-span-3">
                  {currentTicker && (
                    <StockChart
                      symbol={activeSymbol}
                      ticker={currentTicker}
                      priceHistory={getHistory(activeSymbol)}
                      onExpand={() => setShowFullChart(true)}
                    />
                  )}
                </div>
                <div className="lg:col-span-2">
                  <StrategyPanel
                    symbol={activeSymbol}
                    klines={activeKlines}
                    riskParams={riskParams}
                    onRiskParamsChange={setRiskParams}
                    onStrategyResult={handleStrategyResult}
                    onRunBacktest={handleRunBacktest}
                    backtestRunning={backtestRunning}
                    tickers={tickers}
                  />
                </div>
              </div>
              {backtestResult && (
                <BacktestResults result={backtestResult} symbol={activeSymbol} />
              )}
              <ExactTradeSignal tickers={tickers} selectedSymbol={activeSymbol} klines={activeKlines} currentPrice={currentPrice} onExecuteTrade={handleExecuteSignal} alpacaMode={alpacaMode} onAlpacaModeChange={setAlpacaMode} />
            </motion.div>
          )}

          {/* ===== AUTO-TRADE TAB ===== */}
          {activeTab === "autotrade" && (
            <motion.div
              key="autotrade"
              variants={tabVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.12 }}
              className="space-y-3"
            >
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
                <div className="lg:col-span-3 space-y-3">
                  {currentTicker && (
                    <StockChart
                      symbol={activeSymbol}
                      ticker={currentTicker}
                      priceHistory={getHistory(activeSymbol)}
                      onExpand={() => setShowFullChart(true)}
                    />
                  )}
                  <EquityCurve portfolio={portfolio} tickers={tickers} />
                </div>
                {/* Trading controls take 2/5 */}
                <div className="lg:col-span-2 space-y-3">
                  <AutoTradePanel
                    config={autoTradeConfig}
                    onConfigChange={handleAutoTradeConfigChange}
                    logs={autoTradeLogs}
                    isAnalyzing={autoTradeAnalyzing}
                    positionCount={portfolio.positions.length}
                    stats={autoTradeStats}
                    marketSession={marketSession}
                    killSwitch={killSwitch}
                  />
                  <TradingPlan stats={autoTradeStats} />
                  <AlertsPanel
                    alerts={alerts}
                    notifications={notifications}
                    unreadCount={unreadCount}
                    soundEnabled={soundEnabled}
                    onSoundToggle={setSoundEnabled}
                    onAddPriceAlert={addPriceAlert}
                    onAddPnlAlert={addPnlAlert}
                    onAddSignalAlert={addSignalAlert}
                    onRemoveAlert={removeAlert}
                    onClearNotifications={clearNotifications}
                    symbols={symbols}
                    tickers={tickers}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <PortfolioPanel
                  portfolio={portfolio}
                  tickers={tickers}
                  onClosePosition={closePosition}
                  onAddFunds={addFunds}
                  onWithdrawFunds={withdrawFunds}
                  onReset={resetBalance}
                />
                <TradeAnalytics trades={portfolio.trades} positions={portfolio.positions} tickers={tickers} />
              </div>
            </motion.div>
          )}

          {/* ===== ALPACA TAB ===== */}
          {activeTab === "alpaca" && (
            <motion.div
              key="alpaca"
              variants={tabVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.12 }}
              className="space-y-3"
            >
              {/* Paper / Live Toggle */}
              <div className="flex items-center justify-between bg-card rounded-xl border border-border px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-primary" />
                  <span className="text-sm font-bold text-foreground">Alpaca Brokerage</span>
                </div>
                <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-0.5">
                  {(["paper", "live"] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => handleAlpacaModeChange(m)}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                        alpacaMode === m
                          ? m === "live"
                            ? "bg-loss/15 text-loss border border-loss/30 shadow-sm"
                            : "bg-card text-foreground border border-border shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m === "paper" ? "📝 Paper" : "🔴 Live"}
                    </button>
                  ))}
                </div>
              </div>
              <AlpacaDashboard mode={alpacaMode} />
              {/* Auto-Trade Controls embedded in Alpaca tab */}
              <AutoTradePanel
                config={autoTradeConfig}
                onConfigChange={handleAutoTradeConfigChange}
                logs={autoTradeLogs}
                isAnalyzing={autoTradeAnalyzing}
                positionCount={portfolio.positions.length}
                stats={autoTradeStats}
                marketSession={marketSession}
                killSwitch={killSwitch}
              />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <AlpacaPnlChart mode={alpacaMode} />
                <RiskDashboard mode={alpacaMode} />
              </div>
            </motion.div>
          )}

          {/* ===== JOURNAL TAB ===== */}
          {activeTab === "journal" && (
            <motion.div
              key="journal"
              variants={tabVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.12 }}
            >
              <TradeJournal
                entries={journalEntries}
                stats={journalStats}
                loading={journalLoading}
                onUpdateEntry={updateJournalEntry}
                onDeleteEntry={deleteJournalEntry}
                onExportCSV={exportJournalCSV}
              />
            </motion.div>
          )}


          {activeTab === "news" && (
            <motion.div
              key="news"
              variants={tabVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.12 }}
              className="space-y-3"
            >
              <NewsFeed
                news={news}
                loading={newsLoading}
                onRefresh={refreshNews}
                stockNews={stockNews}
                stockNewsLoading={stockNewsLoading}
                stockNewsSymbol={stockNewsSymbol}
                onFetchStockNews={fetchStockNews}
                symbols={symbols}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Full-Screen Chart Modal */}
      {showFullChart && currentTicker && (
        <FullScreenChart
          symbol={activeSymbol}
          ticker={currentTicker}
          priceHistory={getHistory(activeSymbol)}
          onClose={() => setShowFullChart(false)}
        />
      )}
    </div>
  );
};

export default Index;
