import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface StockData {
  symbol: string;
  name: string;
  price: string;
  change: string;
  volume: string;
  category: "gainer" | "loser" | "active";
  sources?: string[];
}

interface NewsItem {
  title: string;
  url: string;
  description: string;
  source: string;
  category: "earnings" | "movers" | "macro" | "analysis" | "general";
}

// ========= MULTI-SOURCE MARKET DATA =========

// Parse Webull markdown (existing logic)
function parseStocksFromMarkdown(markdown: string): {
  gainers: StockData[];
  losers: StockData[];
  active: StockData[];
  indices: { symbol: string; price: string; change: string }[];
} {
  const lines = markdown.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const indices: { symbol: string; price: string; change: string }[] = [];
  const gainers: StockData[] = [];
  const losers: StockData[] = [];
  const active: StockData[] = [];

  const indexSymbols = ["DIA", "SPY", "QQQ", "IWM"];
  for (let i = 0; i < lines.length && indices.length < 4; i++) {
    if (indexSymbols.includes(lines[i])) {
      let price = "";
      let change = "";
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const val = lines[j];
        if (val.startsWith("![")) continue;
        if (/^\d+[\d,.]*$/.test(val.replace(",", "")) && !price) {
          price = val;
        } else if (/^[+-]/.test(val) && val.includes("%")) {
          change = val;
          break;
        }
      }
      if (price) indices.push({ symbol: lines[i], price, change });
    }
  }

  let currentSection = "";
  let entryBuffer: string[] = [];
  let entryCount = 0;

  const parseEntry = (buffer: string[], category: "gainer" | "loser" | "active"): StockData | null => {
    if (buffer.length < 3) return null;
    let name = "", symbol = "", change = "", price = "", volume = "";
    for (const line of buffer) {
      if (/^\d+$/.test(line)) continue;
      if (/^[A-Z][A-Z0-9-]{0,6}$/.test(line) && !symbol) symbol = line;
      else if (/[+-][\d.]+%/.test(line)) change = line;
      else if (/^\d+[\d,.]*\.\d+$/.test(line.replace(",", "")) || line === "--") price = line;
      else if (/\d+\.\d+[MBK]/.test(line)) volume = line;
      else if (line.length > 3 && !line.startsWith("#") && !line.startsWith("!") && !name) name = line;
    }
    if (!symbol) return null;
    return { symbol, name: name || symbol, price: price || "--", change, volume, category, sources: ["Webull"] };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "## Top Gainers") {
      currentSection = "gainers"; entryBuffer = []; entryCount = 0; continue;
    } else if (line === "## Top Losers") {
      if (entryBuffer.length > 0 && currentSection === "gainers") {
        const entry = parseEntry(entryBuffer, "gainer"); if (entry) gainers.push(entry);
      }
      currentSection = "losers"; entryBuffer = []; entryCount = 0; continue;
    } else if (line === "## Most Active") {
      if (entryBuffer.length > 0 && currentSection === "losers") {
        const entry = parseEntry(entryBuffer, "loser"); if (entry) losers.push(entry);
      }
      currentSection = "active"; entryBuffer = []; entryCount = 0; continue;
    } else if (line.startsWith("## ") && currentSection === "active") {
      if (entryBuffer.length > 0) {
        const entry = parseEntry(entryBuffer, "active"); if (entry) active.push(entry);
      }
      currentSection = ""; continue;
    }
    if (!currentSection) continue;
    if (["More", "Pre-market", "After-hours", "1 Day", "No.", "Symbol/Name", "% Chg in 1D", "Last Price", "Volume", "RVol (10D)", "% Turnover"].includes(line)) continue;
    if (/^\d+$/.test(line) && parseInt(line) === entryCount + 1) {
      if (entryBuffer.length > 0) {
        const cat = currentSection === "gainers" ? "gainer" : currentSection === "losers" ? "loser" : "active";
        const entry = parseEntry(entryBuffer, cat as any);
        if (entry) {
          if (currentSection === "gainers") gainers.push(entry);
          else if (currentSection === "losers") losers.push(entry);
          else active.push(entry);
        }
      }
      entryBuffer = [line]; entryCount = parseInt(line);
    } else {
      entryBuffer.push(line);
    }
  }
  if (entryBuffer.length > 0 && currentSection) {
    const cat = currentSection === "gainers" ? "gainer" : currentSection === "losers" ? "loser" : "active";
    const entry = parseEntry(entryBuffer, cat as any);
    if (entry) {
      if (currentSection === "gainers") gainers.push(entry);
      else if (currentSection === "losers") losers.push(entry);
      else active.push(entry);
    }
  }
  return { gainers, losers, active, indices };
}

// Parse Robinhood "most popular" / "top movers" from scraped markdown
function parseRobinhoodData(markdown: string): StockData[] {
  const stocks: StockData[] = [];
  const lines = markdown.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  
  for (let i = 0; i < lines.length; i++) {
    // Look for ticker-like patterns: SYMBOL followed by company name and price
    const tickerMatch = lines[i].match(/^([A-Z]{1,5})\s*$/);
    if (tickerMatch) {
      const symbol = tickerMatch[1];
      let name = "", price = "", change = "";
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const val = lines[j];
        if (/^\$[\d,.]+$/.test(val)) price = val.replace("$", "");
        else if (/[+-][\d.]+%/.test(val)) change = val;
        else if (val.length > 3 && !/^\d/.test(val) && !val.startsWith("$") && !name) name = val;
      }
      if (price || change) {
        stocks.push({ symbol, name: name || symbol, price: price || "--", change: change || "0%", volume: "", category: "active", sources: ["Robinhood"] });
      }
    }
    
    // Also match table-like rows: | AAPL | Apple Inc | $224.50 | +1.25% |
    const tableMatch = lines[i].match(/\|\s*([A-Z]{1,5})\s*\|\s*([^|]+)\|\s*\$?([\d,.]+)\s*\|\s*([+-][\d.]+%)\s*\|/);
    if (tableMatch) {
      stocks.push({
        symbol: tableMatch[1],
        name: tableMatch[2].trim(),
        price: tableMatch[3],
        change: tableMatch[4],
        volume: "",
        category: "active",
        sources: ["Robinhood"],
      });
    }
  }
  return stocks;
}

// Parse Fidelity market data from scraped markdown
function parseFidelityData(markdown: string): StockData[] {
  const stocks: StockData[] = [];
  const lines = markdown.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  
  for (let i = 0; i < lines.length; i++) {
    // Fidelity lists stocks with symbol, name, price, change
    const tickerMatch = lines[i].match(/^([A-Z]{1,5})$/);
    if (tickerMatch) {
      const symbol = tickerMatch[1];
      let name = "", price = "", change = "";
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const val = lines[j];
        if (/^\$?[\d,.]+\.\d{2}$/.test(val.replace("$", ""))) price = val.replace("$", "");
        else if (/[+-][\d.]+%/.test(val)) change = val;
        else if (val.length > 3 && !/^\d/.test(val) && !val.startsWith("$") && !name) name = val;
      }
      if (price || change) {
        stocks.push({ symbol, name: name || symbol, price: price || "--", change: change || "0%", volume: "", category: "active", sources: ["Fidelity"] });
      }
    }
    
    // Table format
    const tableMatch = lines[i].match(/\|\s*([A-Z]{1,5})\s*\|\s*([^|]+)\|\s*\$?([\d,.]+)\s*\|\s*([+-][\d.]+%)\s*\|/);
    if (tableMatch) {
      stocks.push({
        symbol: tableMatch[1],
        name: tableMatch[2].trim(),
        price: tableMatch[3],
        change: tableMatch[4],
        volume: "",
        category: "active",
        sources: ["Fidelity"],
      });
    }
  }
  return stocks;
}

// Parse Yahoo Finance screener data
function parseYahooFinanceData(markdown: string): StockData[] {
  const stocks: StockData[] = [];
  const lines = markdown.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  
  for (let i = 0; i < lines.length; i++) {
    // Yahoo Finance table rows
    const tableMatch = lines[i].match(/\|\s*\[?([A-Z]{1,5})\]?\s*\|\s*([^|]*)\|\s*\$?([\d,.]+(?:\.\d+)?)\s*\|\s*([+-]?[\d,.]+)\s*\|\s*([+-][\d.]+%)\s*\|/);
    if (tableMatch) {
      stocks.push({
        symbol: tableMatch[1],
        name: tableMatch[2].trim() || tableMatch[1],
        price: tableMatch[3].replace(",", ""),
        change: tableMatch[5],
        volume: "",
        category: "active",
        sources: ["Yahoo Finance"],
      });
    }
    
    // Simple ticker detection
    const tickerMatch = lines[i].match(/^([A-Z]{1,5})$/);
    if (tickerMatch) {
      const symbol = tickerMatch[1];
      let price = "", change = "", volume = "";
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const val = lines[j];
        if (/^[\d,.]+\.\d{2}$/.test(val.replace(",", "")) && !price) price = val.replace(",", "");
        else if (/[+-][\d.]+%/.test(val) && !change) change = val;
        else if (/\d+\.\d+[MBK]/.test(val) && !volume) volume = val;
      }
      if (price) {
        stocks.push({ symbol, name: symbol, price, change: change || "0%", volume, category: "active", sources: ["Yahoo Finance"] });
      }
    }
  }
  return stocks;
}

// Cross-validate and merge data from multiple sources
function mergeMultiSourceData(
  webullData: { gainers: StockData[]; losers: StockData[]; active: StockData[]; indices: any[] },
  robinhoodStocks: StockData[],
  fidelityStocks: StockData[],
  yahooStocks: StockData[]
): { gainers: StockData[]; losers: StockData[]; active: StockData[]; indices: any[] } {
  // Build a map of all stocks by symbol
  const stockMap = new Map<string, StockData>();
  
  // Webull data is primary
  for (const stock of [...webullData.gainers, ...webullData.losers, ...webullData.active]) {
    stockMap.set(stock.symbol, { ...stock, sources: ["Webull"] });
  }
  
  // Cross-validate with other sources
  const otherSources = [
    { stocks: robinhoodStocks, name: "Robinhood" },
    { stocks: fidelityStocks, name: "Fidelity" },
    { stocks: yahooStocks, name: "Yahoo Finance" },
  ];
  
  for (const { stocks, name } of otherSources) {
    for (const stock of stocks) {
      const existing = stockMap.get(stock.symbol);
      if (existing) {
        // Add source attribution
        existing.sources = existing.sources || [];
        if (!existing.sources.includes(name)) existing.sources.push(name);
        
        // If Webull price is missing/zero but other source has it, use other source
        const existingPrice = parseFloat(existing.price.replace(/,/g, "")) || 0;
        const newPrice = parseFloat(stock.price.replace(/,/g, "")) || 0;
        if (existingPrice === 0 && newPrice > 0) {
          existing.price = stock.price;
          existing.change = stock.change;
        }
        // If both have prices, average for cross-validation (prefer within 5% match)
        if (existingPrice > 0 && newPrice > 0) {
          const diff = Math.abs(existingPrice - newPrice) / existingPrice;
          if (diff < 0.05) {
            // Prices agree — use average for better accuracy
            const avgPrice = (existingPrice + newPrice) / 2;
            existing.price = avgPrice.toFixed(2);
          }
          // If > 5% difference, keep Webull price but flag
        }
        if (!existing.volume && stock.volume) existing.volume = stock.volume;
      } else {
        // New stock from this source
        stockMap.set(stock.symbol, { ...stock, sources: [name] });
      }
    }
  }
  
  // Rebuild categories
  const result = {
    gainers: [...webullData.gainers],
    losers: [...webullData.losers],
    active: [...webullData.active],
    indices: webullData.indices,
  };
  
  // Add new stocks from other sources to active
  for (const [symbol, stock] of stockMap) {
    const inWebull = [...webullData.gainers, ...webullData.losers, ...webullData.active].some(s => s.symbol === symbol);
    if (!inWebull) {
      result.active.push(stock);
    } else {
      // Update existing entries with cross-validated data
      for (const list of [result.gainers, result.losers, result.active]) {
        const idx = list.findIndex(s => s.symbol === symbol);
        if (idx >= 0) {
          list[idx] = { ...list[idx], price: stock.price, sources: stock.sources, volume: stock.volume || list[idx].volume };
        }
      }
    }
  }
  
  return result;
}

// ========= NEWS =========

const TRUSTED_DOMAINS = [
  "reuters.com", "cnbc.com", "bloomberg.com", "wsj.com",
  "marketwatch.com", "finance.yahoo.com", "barrons.com",
  "seekingalpha.com", "investing.com", "thestreet.com",
  "fool.com", "benzinga.com", "zacks.com",
];

function extractSource(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    const map: Record<string, string> = {
      "reuters.com": "Reuters", "cnbc.com": "CNBC", "bloomberg.com": "Bloomberg",
      "wsj.com": "WSJ", "marketwatch.com": "MarketWatch", "finance.yahoo.com": "Yahoo Finance",
      "ca.finance.yahoo.com": "Yahoo Finance", "barrons.com": "Barron's",
      "seekingalpha.com": "Seeking Alpha", "investing.com": "Investing.com",
      "thestreet.com": "TheStreet", "fool.com": "Motley Fool",
      "benzinga.com": "Benzinga", "zacks.com": "Zacks",
      "marketbeat.com": "MarketBeat", "barchart.com": "Barchart",
    };
    return map[hostname] || hostname;
  } catch { return "Unknown"; }
}

function categorizeNews(title: string): NewsItem["category"] {
  const lower = title.toLowerCase();
  if (/earnings|revenue|eps|quarterly|annual report|profit margin|guidance/.test(lower)) return "earnings";
  if (/fed|inflation|gdp|interest rate|cpi|jobs report|unemployment|fomc|treasury/.test(lower)) return "macro";
  if (/surge|plunge|rally|crash|gap|breakout|high|low|mover|volatile|halted/.test(lower)) return "movers";
  if (/analyst|upgrade|downgrade|price target|rating|buy|sell|hold|overweight/.test(lower)) return "analysis";
  return "general";
}

function parseNewsFromSearch(data: any): NewsItem[] {
  if (!data?.data) return [];
  return data.data
    .filter((item: any) => item.title && item.url)
    .map((item: any) => ({
      title: item.title || "",
      url: item.url || "",
      description: item.description || "",
      source: extractSource(item.url || ""),
      category: categorizeNews(item.title || ""),
    }));
}

// ========= FIRECRAWL HELPERS =========

async function scrapeUrl(apiKey: string, url: string, waitFor = 3000): Promise<string> {
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor }),
    });
    const data = await response.json();
    return data.data?.markdown || data.markdown || "";
  } catch (e) {
    console.error(`Failed to scrape ${url}:`, e);
    return "";
  }
}

async function searchFirecrawl(apiKey: string, query: string, limit: number, tbs = "qdr:d"): Promise<any> {
  try {
    const resp = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, limit, tbs }),
    });
    const text = await resp.text();
    return JSON.parse(text);
  } catch { return null; }
}

// ========= MAIN HANDLER =========

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const reqBody = await req.json();
    const { type, symbol } = reqBody;

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "Firecrawl connector not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== STOCK NEWS =====
    if (type === "stock_news" && symbol) {
      const queries = [
        { q: `${symbol} stock news site:cnbc.com OR site:reuters.com OR site:bloomberg.com OR site:finance.yahoo.com`, limit: 5 },
        { q: `${symbol} stock price analysis site:seekingalpha.com OR site:benzinga.com OR site:marketwatch.com`, limit: 5 },
      ];
      const allNews: NewsItem[] = [];
      const seenUrls = new Set<string>();
      const results = await Promise.allSettled(
        queries.map(({ q, limit }) => searchFirecrawl(FIRECRAWL_API_KEY, q, limit, "qdr:w"))
      );
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          for (const item of parseNewsFromSearch(result.value)) {
            if (!seenUrls.has(item.url)) { seenUrls.add(item.url); allNews.push(item); }
          }
        }
      }
      return new Response(JSON.stringify({ news: allNews.slice(0, 10) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== GENERAL NEWS =====
    if (type === "news") {
      const queries = [
        { q: "stock market movers today site:cnbc.com OR site:reuters.com OR site:bloomberg.com", limit: 5 },
        { q: "earnings report stock price site:marketwatch.com OR site:wsj.com OR site:barrons.com", limit: 5 },
        { q: "stock analyst upgrade downgrade price target site:seekingalpha.com OR site:benzinga.com OR site:zacks.com", limit: 5 },
        { q: "fed interest rate inflation gdp economic data site:cnbc.com OR site:reuters.com OR site:finance.yahoo.com", limit: 3 },
      ];
      const allNews: NewsItem[] = [];
      const seenUrls = new Set<string>();
      const results = await Promise.allSettled(
        queries.map(({ q, limit }) => searchFirecrawl(FIRECRAWL_API_KEY, q, limit))
      );
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          for (const item of parseNewsFromSearch(result.value)) {
            if (!seenUrls.has(item.url)) { seenUrls.add(item.url); allNews.push(item); }
          }
        }
      }
      const catPriority: Record<string, number> = { movers: 0, earnings: 1, macro: 2, analysis: 3, general: 4 };
      const trustedSet = new Set(TRUSTED_DOMAINS);
      allNews.sort((a, b) => {
        const aT = trustedSet.has(new URL(a.url).hostname.replace("www.", "")) ? 0 : 1;
        const bT = trustedSet.has(new URL(b.url).hostname.replace("www.", "")) ? 0 : 1;
        if (aT !== bT) return aT - bT;
        return (catPriority[a.category] ?? 5) - (catPriority[b.category] ?? 5);
      });
      return new Response(JSON.stringify({ news: allNews.slice(0, 15) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== MARKET DATA — MULTI-SOURCE =====
    console.log("Fetching multi-source market data: Webull + Robinhood + Fidelity + Yahoo Finance");

    // Scrape all sources in parallel
    const [webullMd, robinhoodMd, fidelityMd, yahooMd] = await Promise.all([
      scrapeUrl(FIRECRAWL_API_KEY, "https://www.webull.com/quote/us/most-active", 3000),
      scrapeUrl(FIRECRAWL_API_KEY, "https://robinhood.com/collections/most-popular", 4000),
      scrapeUrl(FIRECRAWL_API_KEY, "https://screener.fidelity.com/ftgw/etf/goto/snapshot/snapshot.jhtml?symbols=SPY", 3000),
      scrapeUrl(FIRECRAWL_API_KEY, "https://finance.yahoo.com/markets/stocks/most-active/", 3000),
    ]);

    const sourcesUsed: string[] = [];

    // Parse Webull (primary)
    const webullData = parseStocksFromMarkdown(webullMd);
    if (webullData.gainers.length > 0 || webullData.active.length > 0) sourcesUsed.push("Webull");

    // Parse Robinhood
    const robinhoodStocks = parseRobinhoodData(robinhoodMd);
    if (robinhoodStocks.length > 0) sourcesUsed.push("Robinhood");
    console.log(`Robinhood: parsed ${robinhoodStocks.length} stocks`);

    // Parse Fidelity
    const fidelityStocks = parseFidelityData(fidelityMd);
    if (fidelityStocks.length > 0) sourcesUsed.push("Fidelity");
    console.log(`Fidelity: parsed ${fidelityStocks.length} stocks`);

    // Parse Yahoo Finance
    const yahooStocks = parseYahooFinanceData(yahooMd);
    if (yahooStocks.length > 0) sourcesUsed.push("Yahoo Finance");
    console.log(`Yahoo Finance: parsed ${yahooStocks.length} stocks`);

    // Merge and cross-validate
    const merged = mergeMultiSourceData(webullData, robinhoodStocks, fidelityStocks, yahooStocks);
    console.log(`Sources used: ${sourcesUsed.join(", ") || "Webull only"}`);
    console.log(`Total stocks: G=${merged.gainers.length} L=${merged.losers.length} A=${merged.active.length}`);

    return new Response(JSON.stringify({ ...merged, sourcesUsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("webull-scraper error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
