import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ALPACA_API_KEY = Deno.env.get("ALPACA_API_KEY");
    const ALPACA_API_SECRET = Deno.env.get("ALPACA_API_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!ALPACA_API_KEY || !ALPACA_API_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Missing config" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Full symbol universe — same as the client enrichment list
    const SYMBOLS = [
      "AAPL","MSFT","GOOGL","AMZN","META","NVDA","TSLA","AVGO","ADBE","CRM",
      "ORCL","AMD","INTC","NFLX","CSCO","QCOM","INTU","AMAT","NOW","UBER",
      "SQ","SHOP","SNOW","PANW","CRWD","MRVL","MU","LRCX","JPM","V","MA",
      "BAC","WFC","GS","MS","AXP","BLK","SCHW","C","COIN","PYPL","JNJ",
      "UNH","LLY","MRK","PFE","ABT","TMO","ABBV","BMY","AMGN","ISRG",
      "GILD","NVO","WMT","PG","KO","PEP","COST","HD","MCD","NKE","SBUX",
      "TGT","LOW","DIS","CMCSA","XOM","CVX","COP","SLB","EOG","CAT","BA",
      "RTX","LMT","GE","HON","UPS","DE","T","VZ","NEE","PLTR","SOFI",
      "RIVN","LCID","ARM","SMCI","MSTR","RKLB","IONQ","HOOD","IBM","TXN",
      "KLAC","SNPS","CDNS","ADSK","WDAY","ZS","DDOG","NET","FTNT","TEAM",
      "DOCN","TTD","SPOT","ROKU","TWLO","OKTA","MDB","ABNB","DASH","PINS",
      "SNAP","U","PATH","BILL","HUBS","ZM","DELL","HPE","GDDY","USB",
      "PNC","TFC","CME","ICE","SPGI","MCO","MMC","AON","FIS","AFRM",
      "DHR","SYK","BSX","MDT","ELV","HUM","CI","ZTS","REGN","VRTX",
      "MRNA","DXCM","CL","EL","MNST","STZ","GIS","KHC","SYY","ROST",
      "TJX","LULU","YUM","CMG","DHI","LEN","OXY","PSX","VLO","MPC",
      "HAL","DVN","FANG","KMI","WMB","UNP","MMM","EMR","ITW","ROK",
      "ETN","PH","WM","GD","NOC","FDX","DAL","UAL","LUV","LIN","APD",
      "SHW","ECL","NUE","FCX","AA","AMT","PLD","CCI","EQIX","O",
      "CELH","DUOL","CAVA","APP","AXON","DECK","FICO","TOST","CVNA",
      "VST","CEG","GEV","TMC","MP","LAC","VALE","RIO","BHP","CLF",
      "X","SCCO","SOUN","RGTI","QUBT","BBAI","APLD","LUNR","ASTS",
      "DNA","JOBY","AEHR","KULR","GSAT","OPEN","WULF","BTBT","CLSK",
      "CIFR","TLRY","CGC","SNDL","FSLR","ENPH","SEDG","PLUG","CHPT",
      "QS","NIO","XPEV","LI","IRDM","RCAT","KTOS","ON","MPWR","SWKS",
      "MCHP","GFS","WOLF","CRUS","MTSI","VEEV","PAYC","PCOR","ESTC",
      "CFLT","S","GTLB","MNDY","AI","BIGC","BIIB","ALNY","EXAS",
       "NBIX","HALO","SRPT","PCVX","LEGN","ARGX","UTHR","UPST","NU","MQ",
       "FOUR","RELY","GLBE","ETSY","W","CHWY","DKNG","PENN","MGM",
      "WYNN","RCL","CCL","MAR","HLT","F","GM","STLA","TM","HMC",
      "RACE","WBD","PARA","RBLX","TTWO","EA","ATVI","MARA","RIOT",
      "HUT","BITF","IREN","DUK","SO","D","AEP","EXC","XEL","AES",
      "ADM","BG","TSN","HRL","MKC","PGR","TRV","ALL","MET","AFL",
      "ULTA","DG","DLTR","BBY","AZO","ORLY","GPS","NNE","OKLO","SMR",
      "LEU","CCJ","UEC","TWST","AMBA","VRT","ANET","BABA","PDD","JD",
      "BIDU","SE","GRAB","MELI","TSM","CYBR","VRNS","RPD","TENB",
      "SPY","QQQ","IWM","DIA","ARKK","XLF","XLE","XLK","SOXX","SMH",
      "MSOS","TAN","REMX","XLV","XLI","XLP","XLY","XLU","XLB","XLRE",
      "VTI","VOO","IBIT","GDX","SLV","GLD","URA",
      // Leveraged / Volatility ETFs
      "UVXY","TQQQ","SQQQ","VXX","SVXY","SPXU","SPXS","UVIX",
      "SOXL","SOXS","LABU","LABD","TNA","TZA","SPXL","UPRO",
      "SDOW","UDOW","FNGU","FNGD","VIXY","SVOL","NUGT","DUST",
      "JNUG","JDST","BOIL","KOLD","UCO","SCO",
    ];

    // Crypto symbols (Alpaca uses XXXUSD format for display, XXX/USD for API)
    const CRYPTO_SYMBOLS = [
      "BTC/USD","ETH/USD","SOL/USD","XRP/USD","ADA/USD","DOGE/USD",
      "AVAX/USD","DOT/USD","MATIC/USD","LINK/USD","UNI/USD","AAVE/USD",
      "LTC/USD","BCH/USD","SHIB/USD","PEPE/USD","ARB/USD","OP/USD",
      "NEAR/USD","SUI/USD","APT/USD","FIL/USD","ATOM/USD","ALGO/USD",
      "XLM/USD","HBAR/USD","ICP/USD","VET/USD","FTM/USD","SAND/USD",
      "MANA/USD","AXS/USD","RNDR/USD","GRT/USD","IMX/USD","INJ/USD",
      "TIA/USD","SEI/USD","JUP/USD","W/USD","BONK/USD","WIF/USD",
    ];

    console.log(`Refreshing prices for ${SYMBOLS.length} stocks + ${CRYPTO_SYMBOLS.length} crypto...`);

    let totalUpdated = 0;

    // === STOCK PRICES ===
    // Fetch in batches of 50 from Alpaca
    for (let i = 0; i < SYMBOLS.length; i += 50) {
      const batch = SYMBOLS.slice(i, i + 50);
      const symsParam = batch.join(",");

      try {
        const resp = await fetch(
          `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${symsParam}&feed=iex`,
          {
            headers: {
              "APCA-API-KEY-ID": ALPACA_API_KEY,
              "APCA-API-SECRET-KEY": ALPACA_API_SECRET,
            },
          }
        );

        if (!resp.ok) {
          console.error(`Alpaca batch ${i / 50} error: ${resp.status}`);
          continue;
        }

        const data = await resp.json();
        const rows: any[] = [];

        for (const [sym, snap] of Object.entries(data)) {
          const s = snap as any;
          const price = s?.latestTrade?.p || s?.dailyBar?.c || 0;
          if (price <= 0) continue;

          const open = s?.dailyBar?.o || price;
          const changePct = open > 0 ? ((price - open) / open) * 100 : 0;
          const volume = s?.dailyBar?.v || 0;
          const high = s?.dailyBar?.h || price;
          const low = s?.dailyBar?.l || price;

          // Format volume string
          let volStr = "0";
          if (volume >= 1e9) volStr = (volume / 1e9).toFixed(1) + "B";
          else if (volume >= 1e6) volStr = (volume / 1e6).toFixed(1) + "M";
          else if (volume >= 1e3) volStr = (volume / 1e3).toFixed(1) + "K";
          else volStr = String(volume);

          rows.push({
            symbol: sym,
            price: Math.round(price * 100) / 100,
            change_pct: Math.round(changePct * 100) / 100,
            volume: volStr,
            high: Math.round(high * 100) / 100,
            low: Math.round(low * 100) / 100,
            updated_at: new Date().toISOString(),
          });
        }

        if (rows.length > 0) {
          const { error } = await supabase
            .from("market_prices_cache")
            .upsert(rows, { onConflict: "symbol" });
          
          if (error) {
            console.error(`Upsert error batch ${i / 50}:`, error.message);
          } else {
            totalUpdated += rows.length;
          }
        }
      } catch (err) {
        console.error(`Batch ${i / 50} fetch error:`, err);
      }
    }

    // === CRYPTO PRICES ===
    for (let i = 0; i < CRYPTO_SYMBOLS.length; i += 50) {
      const batch = CRYPTO_SYMBOLS.slice(i, i + 50);
      const symsParam = batch.join(",");

      try {
        const resp = await fetch(
          `https://data.alpaca.markets/v1beta3/crypto/us/snapshots?symbols=${encodeURIComponent(symsParam)}`,
          {
            headers: {
              "APCA-API-KEY-ID": ALPACA_API_KEY,
              "APCA-API-SECRET-KEY": ALPACA_API_SECRET,
            },
          }
        );

        if (!resp.ok) {
          console.error(`Crypto batch ${i / 50} error: ${resp.status}`);
          continue;
        }

        const data = await resp.json();
        const snapshots = data.snapshots || data;
        const rows: any[] = [];

        for (const [sym, snap] of Object.entries(snapshots)) {
          const s = snap as any;
          const price = s?.latestTrade?.p || s?.dailyBar?.c || 0;
          if (price <= 0) continue;

          const open = s?.dailyBar?.o || price;
          const changePct = open > 0 ? ((price - open) / open) * 100 : 0;
          const volume = s?.dailyBar?.v || 0;
          const high = s?.dailyBar?.h || price;
          const low = s?.dailyBar?.l || price;

          // Convert BTC/USD → BTCUSD for display
          const displaySym = sym.replace("/", "");

          let volStr = "0";
          if (volume >= 1e9) volStr = (volume / 1e9).toFixed(1) + "B";
          else if (volume >= 1e6) volStr = (volume / 1e6).toFixed(1) + "M";
          else if (volume >= 1e3) volStr = (volume / 1e3).toFixed(1) + "K";
          else volStr = String(Math.round(volume * 100) / 100);

          rows.push({
            symbol: displaySym,
            price: Math.round(price * 100) / 100,
            change_pct: Math.round(changePct * 100) / 100,
            volume: volStr,
            high: Math.round(high * 100) / 100,
            low: Math.round(low * 100) / 100,
            updated_at: new Date().toISOString(),
          });
        }

        if (rows.length > 0) {
          const { error } = await supabase
            .from("market_prices_cache")
            .upsert(rows, { onConflict: "symbol" });

          if (error) {
            console.error(`Crypto upsert error:`, error.message);
          } else {
            totalUpdated += rows.length;
          }
        }
      } catch (err) {
        console.error(`Crypto batch fetch error:`, err);
      }
    }

    console.log(`Successfully updated ${totalUpdated} prices (stocks + crypto)`);

    return new Response(
      JSON.stringify({ success: true, updated: totalUpdated, total: SYMBOLS.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("refresh-prices error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
