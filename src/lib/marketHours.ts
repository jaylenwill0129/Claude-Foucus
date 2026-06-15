// US Market hours utilities (NYSE/NASDAQ)
// Regular hours: 9:30 AM - 4:00 PM ET
// Pre-market: 4:00 AM - 9:30 AM ET  
// After-hours: 4:00 PM - 8:00 PM ET

export type MarketSession = "pre-market" | "regular" | "after-hours" | "closed";

function getETTime(): Date {
  // Convert current time to Eastern Time
  const now = new Date();
  const etString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(etString);
}

export function getMarketSession(): MarketSession {
  const et = getETTime();
  const day = et.getDay(); // 0=Sun, 6=Sat
  const hours = et.getHours();
  const minutes = et.getMinutes();
  const timeMinutes = hours * 60 + minutes;

  // Weekend
  if (day === 0 || day === 6) return "closed";

  // Pre-market: 4:00 AM - 9:29 AM ET
  if (timeMinutes >= 240 && timeMinutes < 570) return "pre-market";

  // Regular: 9:30 AM - 3:59 PM ET
  if (timeMinutes >= 570 && timeMinutes < 960) return "regular";

  // After-hours: 4:00 PM - 7:59 PM ET
  if (timeMinutes >= 960 && timeMinutes < 1200) return "after-hours";

  return "closed";
}

export function isMarketOpen(): boolean {
  return getMarketSession() === "regular";
}

export function isTradingAllowed(allowExtendedHours: boolean = false): boolean {
  const session = getMarketSession();
  if (session === "regular") return true;
  if (allowExtendedHours && (session === "pre-market" || session === "after-hours")) return true;
  return false;
}

export function getMarketStatusLabel(): { label: string; color: string } {
  const session = getMarketSession();
  switch (session) {
    case "regular": return { label: "Market Open", color: "text-gain" };
    case "pre-market": return { label: "Pre-Market", color: "text-warning" };
    case "after-hours": return { label: "After-Hours", color: "text-warning" };
    case "closed": return { label: "Market Closed", color: "text-muted-foreground" };
  }
}

// Market regime detection
export type MarketRegime = "trending" | "choppy" | "low_volume" | "high_volatility";

export function isLunchHour(): boolean {
  const et = getETTime();
  const hours = et.getHours();
  const minutes = et.getMinutes();
  const timeMinutes = hours * 60 + minutes;
  // 11:30 AM - 2:00 PM ET is typically low volume "lunch hour"
  return timeMinutes >= 690 && timeMinutes < 840;
}

export function isPowerHour(): boolean {
  const et = getETTime();
  const hours = et.getHours();
  const minutes = et.getMinutes();
  const timeMinutes = hours * 60 + minutes;
  // 3:00 PM - 4:00 PM ET is "power hour"
  return timeMinutes >= 900 && timeMinutes < 960;
}

export function isOpeningBell(): boolean {
  const et = getETTime();
  const hours = et.getHours();
  const minutes = et.getMinutes();
  const timeMinutes = hours * 60 + minutes;
  // 9:30 AM - 10:30 AM ET is opening volatility
  return timeMinutes >= 570 && timeMinutes < 630;
}

export function getTimeOfDayContext(): { period: string; volumeExpectation: "high" | "medium" | "low"; volatilityExpectation: "high" | "medium" | "low" } {
  if (isOpeningBell()) return { period: "Opening Bell", volumeExpectation: "high", volatilityExpectation: "high" };
  if (isLunchHour()) return { period: "Lunch Hour", volumeExpectation: "low", volatilityExpectation: "low" };
  if (isPowerHour()) return { period: "Power Hour", volumeExpectation: "high", volatilityExpectation: "medium" };
  const session = getMarketSession();
  if (session === "regular") return { period: "Mid-Day", volumeExpectation: "medium", volatilityExpectation: "medium" };
  if (session === "pre-market") return { period: "Pre-Market", volumeExpectation: "low", volatilityExpectation: "medium" };
  if (session === "after-hours") return { period: "After-Hours", volumeExpectation: "low", volatilityExpectation: "medium" };
  return { period: "Closed", volumeExpectation: "low", volatilityExpectation: "low" };
}

export function getNextMarketOpen(): string {
  const et = getETTime();
  const day = et.getDay();
  const hours = et.getHours();
  const minutes = et.getMinutes();
  const timeMinutes = hours * 60 + minutes;

  if (day >= 1 && day <= 5 && timeMinutes < 570) {
    // Today before market open
    const minsUntil = 570 - timeMinutes;
    const h = Math.floor(minsUntil / 60);
    const m = minsUntil % 60;
    return `${h}h ${m}m`;
  }

  // Calculate days until next Monday (or next weekday)
  let daysUntil = 0;
  if (day === 5 && timeMinutes >= 960) daysUntil = 3; // Friday after close → Monday
  else if (day === 6) daysUntil = 2; // Saturday → Monday
  else if (day === 0) daysUntil = 1; // Sunday → Monday
  else daysUntil = 1; // Weekday after close → next day

  return `${daysUntil}d`;
}
