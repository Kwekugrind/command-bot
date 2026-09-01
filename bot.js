import fetch from "node-fetch";
import WebSocket from "ws";
import fs from "fs";
import path from "path";
import "dotenv/config"; // <--- ADD THIS LINE

const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT  = process.env.TG_CHAT_ID;
const GATEWAY_URL = process.env.GATEWAY_URL || "http://138.2.169.72:3000";
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;

const REPOS = [
  { name: "Test-Bot",       altName: "test-bot", label: "Test Bot (V10 Live)",   symbol: "V10",   isLive: true,  is1s: false, derivSymbol: "R_10",    multiplier: 400, commission: 0.16 },
  { name: "OmniSight",      altName: "omnisight", label: "OmniSight (V50 Live)", symbol: "V50",   isLive: true,  is1s: false, derivSymbol: "R_50",    multiplier: 80,  commission: 0.16 },
  { name: "Lery-s-Alerts",  altName: "lery-s-alerts", label: "Lery's Elite (V75)",   symbol: "V75",   isLive: false, is1s: false, derivSymbol: "R_75",    multiplier: 50,  commission: 0.15 },
  { name: "coffee",         altName: "Coffee", label: "Coffee Machine (V75S)", symbol: "V75S", isLive: false, is1s: true,  derivSymbol: "1HZ75V",  multiplier: 50,  commission: 0.15 },
  { name: "milk",           altName: "Milk", label: "Milk Machine (V100)",   symbol: "V100",  isLive: false, is1s: false, derivSymbol: "R_100",   multiplier: 40,  commission: 0.15 },
  { name: "ice-cream",      altName: "Ice-Cream", label: "Ice Cream (V100S)", symbol: "V100S", isLive: false, is1s: true,  derivSymbol: "1HZ100V", multiplier: 40,  commission: 0.15 },
  { name: "tea",            altName: "Tea", label: "Tea Machine (V25)",     symbol: "V25",   isLive: false, is1s: false, derivSymbol: "R_25",    multiplier: 160, commission: 0.15 },
];

const PHASE_LABELS = {
  PHASE_A: "Phase A — Fresh H1 Cross",
  PHASE_B: "Phase B — Stateful Pullback",
  PHASE_B_NO_PRIOR_A: "Phase B — Window Expired Fallback",
  RECOVERED_LIVE: "Live Recovered / Adopted",
  PHASE_C: "Phase C — HTF Realignment",
  PHASE_D: "Phase D — Shallow Pullback",
};

const HELP_MANUAL = `🎛️ *COMMAND CENTER TERMINAL MANUAL*

*📱 Tap Controls:*
/menu — Launch the 1-Tap Touch Keyboard

*📊 System Overviews:*
/status — Live status across all bots (Direct Broker Feed)
/open — Only bots with active open positions
/exposure — Real-time capital risk & live margin
/ranking — Leaderboard ranked by net profit & win rate
/streaks — Current & all-time win/loss streaks
/stats — Quantitative metrics (Profit Factor, Avg W/L)
/best — Top 5 highest winning trades of all time
/worst — Top 5 biggest losing trades

*💼 Portfolio Filters:*
/live — Real-money bots (Test Bot V10 + OmniSight V50)
/demo — Demo practice portfolio (5 bots)
/fast — 1-Second tick indices (Coffee V75S + Ice Cream V100S)
/standard — Standard volatility indices (V10, V25, V50, V75, V100)

*🤖 Single Bot Dashboards:*
/v10, /v50, /v75, /v75s, /v100, /v100s, /v25

*📅 Time & Range Summaries:*
/today [sym] — Today's closed trades (00:00 UTC)
/yesterday [sym] — Yesterday's 24h performance
/weekly [sym] — Current Week summary (Sun - Now)
/biweekly [sym] — Last 14 days summary
/monthly [sym] — Last 30 days summary
/report 14 — Last 14 days report

*🔬 Strategy Analytics:*
/performance [days] [sym] — Win rate by Phase setup`;

function parseUtcDate(dateStr) {
  if (!dateStr) return null;
  const isoStr = dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T") + "Z";
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? null : d;
}

// Resilient Telegram Sender with Interactive Keyboard Support
async function sendTelegram(message, customKeyboard = null) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const send = async (text, parseMode) => {
    const body = { chat_id: TG_CHAT, text };
    if (parseMode) body.parse_mode = parseMode;
    if (customKeyboard) body.reply_markup = customKeyboard;
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return await res.json();
  };

  try {
    const data = await send(message, "Markdown");
    if (!data.ok) {
      const plain = message.replace(/[*_`\[\]]/g, "");
      await send(plain, "");
    }
  } catch (err) {}
}

async function sendInteractiveMenu() {
  const keyboard = {
    keyboard: [
      [{ text: "/status" }, { text: "/open" }, { text: "/exposure" }],
      [{ text: "/live" }, { text: "/demo" }, { text: "/ranking" }],
      [{ text: "/today" }, { text: "/yesterday" }, { text: "/weekly" }],
      [{ text: "/monthly" }, { text: "/performance" }, { text: "/stats" }],
      [{ text: "/v10" }, { text: "/v50" }, { text: "/v75" }, { text: "/v75s" }],
      [{ text: "/v100" }, { text: "/v100s" }, { text: "/v25" }, { text: "/best" }]
    ],
    resize_keyboard: true,
    persistent: true
  };
  await sendTelegram(`🎛️ *Interactive Dashboard Keyboard Active*\n\nTap any button below for instant reports!`, keyboard);
}

// ── DIRECT GATEWAY BROKER PORTFOLIO & CONTRACT DETAILS ──
async function fetchLiveBrokerPortfolio() {
  if (!GATEWAY_URL || !GATEWAY_SECRET) return null;
  try {
    const res = await fetch(`${GATEWAY_URL}/portfolio`, {
      headers: { "x-gateway-secret": GATEWAY_SECRET }
    });
    if (res.ok) {
      const data = await res.json();
      return data.portfolio || [];
    }
  } catch (e) {}
  return null;
}

async function fetchContractDetails(contractId) {
  if (!GATEWAY_URL || !GATEWAY_SECRET || !contractId) return null;
  try {
    const res = await fetch(`${GATEWAY_URL}/proposal_open_contract`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-gateway-secret": GATEWAY_SECRET },
      body: JSON.stringify({ proposal_open_contract: 1, contract_id: contractId })
    });
    if (res.ok) {
      const data = await res.json();
      const poc = data.proposal_open_contract;
      if (poc) {
        return {
          entry: parseFloat(poc.entry_spot || poc.barrier || poc.entry_tick),
          profit: typeof poc.profit === 'number' ? poc.profit : parseFloat(poc.profit),
          currentSpot: parseFloat(poc.current_spot || poc.bid_price),
          dateStart: poc.date_start ? poc.date_start * 1000 : null
        };
      }
    }
  } catch (e) {}
  return null;
}

function deduplicateTrades(rawTrades) {
  const uniqueTrades = new Map();
  for (const t of rawTrades) {
    if (!t.contractId && t.result === "LOSS") continue;

    const key = t.contractId ? String(t.contractId) : (t.id ? String(t.id) : null);
    if (key) {
      const existing = uniqueTrades.get(key);
      if (!existing) {
        uniqueTrades.set(key, t);
      } else {
        if (!existing.result && t.result) uniqueTrades.set(key, t);
        else if (!existing.closeTime && t.closeTime) uniqueTrades.set(key, t);
      }
    }
  }
  return Array.from(uniqueTrades.values());
}

// ── DIRECT LOCAL + GATEWAY TRADES FETCHER (0ms Lag, No GitHub Dependency) ──
async function fetchTradesJson(repo) {
  // 1. Check Server 2 Local Hard Drive
  const homeDir = process.env.HOME || "/home/ubuntu";
  const possiblePaths = [
    path.join(homeDir, "trading-bots", repo.name, "trades.json"),
    path.join(homeDir, "trading-bots", repo.altName || "", "trades.json"),
    path.join(homeDir, "trading-bots", repo.name.toLowerCase(), "trades.json")
  ];

  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) {
      try {
        const fileContent = fs.readFileSync(p, "utf8");
        const parsed = JSON.parse(fileContent);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return deduplicateTrades(parsed);
        }
      } catch {}
    }
  }

  // 2. Fetch directly from Server 1 Gateway via HTTP
  if (GATEWAY_URL && GATEWAY_SECRET) {
    const namesToTry = [repo.name, repo.altName, repo.name.toLowerCase()].filter(Boolean);
    for (const n of namesToTry) {
      try {
        const res = await fetch(`${GATEWAY_URL}/trades/${n}`, {
          headers: { "x-gateway-secret": GATEWAY_SECRET }
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            return deduplicateTrades(data);
          }
        }
      } catch {}
    }
  }

  return [];
}

async function fetchCurrentPrice(derivSymbol) {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket("wss://ws.binaryws.com/websockets/v3?app_id=1089");
      const timeout = setTimeout(() => { ws.terminate(); resolve(null); }, 3500);
      ws.on("open", () => ws.send(JSON.stringify({ ticks_history: derivSymbol, count: 1, end: "latest" })));
      ws.on("message", (data) => {
        try {
          const r = JSON.parse(data);
          if (r.history && r.history.prices) {
            clearTimeout(timeout);
            resolve(parseFloat(r.history.prices[r.history.prices.length - 1]));
            ws.close();
          }
        } catch {}
      });
      ws.on("error", () => { clearTimeout(timeout); resolve(null); });
    } catch { resolve(null); }
  });
}

function formatDuration(mins) {
  if (mins < 60) return `~${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hStr = `${h} hour${h !== 1 ? 's' : ''}`;
  return m > 0 ? `~${hStr} ${m} min` : `~${hStr}`;
}

// ✅ FIX 1: Check t.profit (Deriv API field) before falling back to flat ±$3.60
function getTradeRealizedPnl(t, repo) {
  if (typeof t.serverPnl === 'number') return t.serverPnl;
  if (typeof t.profit === 'number') return t.profit;
  if (typeof t.pnl === 'number') return t.pnl;
  // Flat fallback only when no real PnL data was persisted in trades.json
  if (t.result === "WIN") return 3.60;
  if (t.result === "LOSS") return -3.60;
  return 0;
}

function filterReposByArgs(args) {
  if (!args || args.length === 0) return REPOS;
  const upperArgs = args.map(a => a.toUpperCase().replace(/^\//, "").replace(/^TODAY_/, "").replace(/^WEEKLY_/, "").replace(/^MONTHLY_/, "").replace(/^PERF_/, ""));
  const matches = REPOS.filter(r =>
    upperArgs.includes(r.symbol.toUpperCase()) ||
    upperArgs.includes(r.name.toUpperCase()) ||
    (r.altName && upperArgs.includes(r.altName.toUpperCase())) ||
    upperArgs.includes(r.derivSymbol.toUpperCase())
  );
  return matches.length > 0 ? matches : REPOS;
}

// ── STRICT UTC DATE GENERATORS (WEEK STARTS SUNDAY) ──
function getUtcRange(daysBack, isYesterday = false) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  let start, end;
  if (isYesterday) {
    start = new Date(Date.UTC(y, m, d - 1, 0, 0, 0, 0));
    end = new Date(Date.UTC(y, m, d - 1, 23, 59, 59, 999));
  } else if (daysBack === 1) {
    start = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
    end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
  } else {
    start = new Date(Date.UTC(y, m, d - daysBack + 1, 0, 0, 0, 0));
    end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
  }
  return { start, end };
}

function getThisWeekUtcRange() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  const start = new Date(Date.UTC(y, m, d - dayOfWeek, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
  return { start, end };
}

// ── 1. STATUS & GROUPED PORTFOLIO HANDLER (LIVE BROKER DATA) ──
async function handleStatus(targetRepos = REPOS, title = "BOT STATUS REPORT", onlyOpen = false) {
  let message = `📊 *${title}*\n🕒 ${new Date().toUTCString()}\n\n`;

  const liveContracts = await fetchLiveBrokerPortfolio();

  const allRepoData = await Promise.all(targetRepos.map(async (repo) => {
    const [trades, currentPrice] = await Promise.all([
      fetchTradesJson(repo),
      fetchCurrentPrice(repo.derivSymbol)
    ]);
    return { repo, trades, currentPrice };
  }));

  let totalActive = 0;

  for (const { repo, trades, currentPrice } of allRepoData) {
    let openPositions = [];

    if (Array.isArray(liveContracts)) {
      const brokerMatches = liveContracts.filter(c => {
        const sym = c.underlying_symbol || c.symbol || (c.shortcode ? c.shortcode.split("_")[1] : "");
        return sym === repo.derivSymbol;
      });

      openPositions = await Promise.all(brokerMatches.map(async (bc) => {
        const details = await fetchContractDetails(bc.contract_id);
        const localTrade = trades.find(t => String(t.contractId) === String(bc.contract_id));

        return {
          direction: bc.contract_type === "MULTUP" ? "BUY" : "SELL",
          entry: details?.entry || localTrade?.entry || null,
          currentSpot: details?.currentSpot || currentPrice,
          livePnl: (details && typeof details.profit === 'number') ? details.profit : null,
          openTime: localTrade?.openTime || (bc.date_start ? new Date(bc.date_start * 1000).toISOString() : null),
          contractId: bc.contract_id
        };
      }));
    }

    if (openPositions.length === 0) {
      openPositions = trades.filter(t => !t.result && !t.pending);
    }

    const closed = trades.filter(t => t.result && t.result !== "CANCELLED");

    if (onlyOpen && openPositions.length === 0) continue;

    message += `*${repo.label}* ${repo.isLive ? "🟢 (Live)" : "🔵 (Demo)"}\n`;

    if (openPositions.length > 0) {
      totalActive += openPositions.length;
      for (const open of openPositions) {
        const openDate = parseUtcDate(open.openTime);
        const nowMins = openDate ? Math.round((Date.now() - openDate.getTime()) / 60000) : 0;

        message += `🟡 OPEN: *${open.direction}* @ ${open.entry ? Number(open.entry).toFixed(4) : "Market Spot"}\n`;

        let pnlDollars = open.livePnl;
        if (pnlDollars === null && currentPrice !== null && open.entry) {
          const rawPnl = open.direction === "BUY"
            ? (currentPrice - open.entry) / open.entry * 5 * repo.multiplier
            : (open.entry - currentPrice) / open.entry * 5 * repo.multiplier;
          pnlDollars = parseFloat((rawPnl - repo.commission).toFixed(2));
        }

        if (pnlDollars !== null) {
          const pnlStr = pnlDollars >= 0 ? `+$${pnlDollars.toFixed(2)}` : `-$${Math.abs(pnlDollars).toFixed(2)}`;
          const pnlIcon = pnlDollars >= 0 ? "📈" : "📉";
          const spotText = open.currentSpot ? ` (@ ${open.currentSpot.toFixed(4)})` : "";
          message += `${pnlIcon} Live Floating P&L: *${pnlStr}*${spotText}\n`;
        }

        message += `⏱ Active: ${formatDuration(isNaN(nowMins) ? 0 : nowMins)}\n`;
        if (open.contractId) message += `🎫 Contract: \`${open.contractId}\`\n`;
      }
      message += `\n`;
    } else {
      message += `⚪ No open trade\n`;

      // Calculate today's closed trades
      const { start: todayStart, end: todayEnd } = getUtcRange(1, false);
      const todayTrades = closed.filter(t => {
        const cd = parseUtcDate(t.closeTime);
        return cd && cd >= todayStart && cd <= todayEnd;
      });

      if (todayTrades.length > 0) {
        const tw = todayTrades.filter(t => t.result === "WIN").length;
        const tl = todayTrades.filter(t => t.result === "LOSS").length;
        const tp = todayTrades.reduce((sum, t) => sum + getTradeRealizedPnl(t, repo), 0);
        const tpStr = tp >= 0 ? `+$${tp.toFixed(2)}` : `-$${Math.abs(tp).toFixed(2)}`;
        message += `📅 Today: ${todayTrades.length} trades | W:${tw} L:${tl} | Net: *${tpStr}*\n`;
      } else {
        message += `📅 Today: No closed trades\n`;
      }

      // Calculate This Week (Sunday Start)
      const { start: weekStart, end: weekEnd } = getThisWeekUtcRange();
      const weekTrades = closed.filter(t => {
        const cd = parseUtcDate(t.closeTime);
        return cd && cd >= weekStart && cd <= weekEnd;
      });

      if (weekTrades.length > 0) {
        const ww = weekTrades.filter(t => t.result === "WIN").length;
        const wl = weekTrades.filter(t => t.result === "LOSS").length;
        const wp = weekTrades.reduce((sum, t) => sum + getTradeRealizedPnl(t, repo), 0);
        const wpStr = wp >= 0 ? `+$${wp.toFixed(2)}` : `-$${Math.abs(wp).toFixed(2)}`;
        message += `📆 This Week: ${weekTrades.length} trades | W:${ww} L:${wl} | Net: *${wpStr}*\n`;
      } else {
        message += `📆 This Week: No closed trades\n`;
      }
      message += `\n`;
    }
  }

  if (onlyOpen && totalActive === 0) {
    message += `🌴 *No active positions open across any bot right now.*`;
  }

  await sendTelegram(message);
}

// ── 2. SINGLE BOT DEDICATED DASHBOARD ──
async function handleSingleBot(repo) {
  const liveContracts = await fetchLiveBrokerPortfolio();
  const [trades, currentPrice] = await Promise.all([
    fetchTradesJson(repo),
    fetchCurrentPrice(repo.derivSymbol)
  ]);

  let openTrades = [];
  if (Array.isArray(liveContracts)) {
    const matches = liveContracts.filter(c => {
      const sym = c.underlying_symbol || c.symbol || (c.shortcode ? c.shortcode.split("_")[1] : "");
      return sym === repo.derivSymbol;
    });

    openTrades = await Promise.all(matches.map(async (bc) => {
      const details = await fetchContractDetails(bc.contract_id);
      const localTrade = trades.find(t => String(t.contractId) === String(bc.contract_id));
      return {
        direction: bc.contract_type === "MULTUP" ? "BUY" : "SELL",
        entry: details?.entry || localTrade?.entry || null,
        currentSpot: details?.currentSpot || currentPrice,
        livePnl: (details && typeof details.profit === 'number') ? details.profit : null,
        openTime: localTrade?.openTime || (bc.date_start ? new Date(bc.date_start * 1000).toISOString() : null),
        contractId: bc.contract_id
      };
    }));
  }

  if (openTrades.length === 0) {
    openTrades = trades.filter(t => !t.result && !t.pending);
  }

  const closed = trades.filter(t => t.result && t.result !== "CANCELLED");

  const { start: todayStart, end: todayEnd } = getUtcRange(1, false);
  const todayTrades = closed.filter(t => {
    const cd = parseUtcDate(t.closeTime);
    return cd && cd >= todayStart && cd <= todayEnd;
  });

  const todayWins = todayTrades.filter(t => t.result === "WIN").length;
  const todayLosses = todayTrades.filter(t => t.result === "LOSS").length;
  const todayPnl = todayTrades.reduce((sum, t) => sum + getTradeRealizedPnl(t, repo), 0);
  const todayPnlStr = todayPnl >= 0 ? `+$${todayPnl.toFixed(2)}` : `-$${Math.abs(todayPnl).toFixed(2)}`;

  let msg = `🤖 *${repo.label} Dashboard*\n`;
  msg += `Symbol: \`${repo.derivSymbol}\` | Stake: $5.00 | Mult: ${repo.multiplier}x\n`;
  msg += `Account: ${repo.isLive ? "🟢 Real Live" : "🔵 Demo"}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  if (openTrades.length > 0) {
    msg += `📍 *Active Position (Direct Broker Feed):*\n`;
    for (const open of openTrades) {
      const openDate = parseUtcDate(open.openTime);
      const nowMins = openDate ? Math.round((Date.now() - openDate.getTime()) / 60000) : 0;

      msg += `• Direction: *${open.direction}* @ ${open.entry ? Number(open.entry).toFixed(4) : "Market Spot"}\n`;

      let pnlDollars = open.livePnl;
      if (pnlDollars === null && currentPrice !== null && open.entry) {
        const rawPnl = open.direction === "BUY"
          ? (currentPrice - open.entry) / open.entry * 5 * repo.multiplier
          : (open.entry - currentPrice) / open.entry * 5 * repo.multiplier;
        pnlDollars = parseFloat((rawPnl - repo.commission).toFixed(2));
      }

      if (pnlDollars !== null) {
        const pnlStr = pnlDollars >= 0 ? `+$${pnlDollars.toFixed(2)}` : `-$${Math.abs(pnlDollars).toFixed(2)}`;
        const spotText = open.currentSpot ? ` (@ ${open.currentSpot.toFixed(4)})` : "";
        msg += `• Live P&L: *${pnlStr}*${spotText}\n`;
      }

      msg += `• Duration: ${formatDuration(isNaN(nowMins) ? 0 : nowMins)}\n`;
      if (open.contractId) msg += `• Contract ID: \`${open.contractId}\`\n`;
    }
  } else {
    msg += `⚪ *Active Position:* None (Scanning market)\n`;
  }

  msg += `\n📅 *Today's Performance:*\n`;
  msg += `Trades: ${todayTrades.length} | W: ${todayWins} | L: ${todayLosses} | Net: *${todayPnlStr}*\n`;

  const { start: weekStart, end: weekEnd } = getThisWeekUtcRange();
  const weekTrades = closed.filter(t => {
    const cd = parseUtcDate(t.closeTime);
    return cd && cd >= weekStart && cd <= weekEnd;
  });

  const weekWins = weekTrades.filter(t => t.result === "WIN").length;
  const weekLosses = weekTrades.filter(t => t.result === "LOSS").length;
  const weekPnl = weekTrades.reduce((sum, t) => sum + getTradeRealizedPnl(t, repo), 0);
  const weekPnlStr = weekPnl >= 0 ? `+$${weekPnl.toFixed(2)}` : `-$${Math.abs(weekPnl).toFixed(2)}`;

  msg += `\n📆 *This Week's Performance (Sun-Now):*\n`;
  msg += `Trades: ${weekTrades.length} | W: ${weekWins} | L: ${weekLosses} | Net: *${weekPnlStr}*\n`;

  await sendTelegram(msg);
}

// ── 3. TIME SUMMARIES (/today, /yesterday, /weekly, /biweekly, /monthly) ──
async function handleSummary(daysBack, label, args = [], isYesterday = false) {
  const targetRepos = filterReposByArgs(args);
  const isAll = targetRepos.length === REPOS.length;
  const headerSuffix = isAll ? "ALL BOTS" : targetRepos.map(r => r.symbol).join(", ");
  let message = `📊 *${label} — ${headerSuffix}*\n🕒 ${new Date().toUTCString()}\n\n`;

  const { start: startCutoff, end: endCutoff } = daysBack === 7 ? getThisWeekUtcRange() : getUtcRange(daysBack, isYesterday);

  const allRepoData = await Promise.all(targetRepos.map(async (r) => ({ repo: r, trades: await fetchTradesJson(r) })));
  let grandWins = 0, grandLosses = 0, grandPnl = 0, grandTotal = 0;

  for (const { repo, trades } of allRepoData) {
    const pt = trades.filter(t => {
      if (!t.result || t.result === "CANCELLED" || !t.closeTime) return false;
      const closeDate = parseUtcDate(t.closeTime);
      return closeDate && closeDate >= startCutoff && closeDate <= endCutoff;
    });

    if (pt.length === 0) {
      message += `*${repo.label}*\nNo trades in period.\n\n`;
      continue;
    }

    const wins = pt.filter(t => t.result === "WIN").length;
    const losses = pt.filter(t => t.result === "LOSS").length;
    const netDollars = pt.reduce((s, t) => s + getTradeRealizedPnl(t, repo), 0);
    const wr = ((wins / pt.length) * 100).toFixed(1);
    const netStr = netDollars >= 0 ? `+$${netDollars.toFixed(2)}` : `-$${Math.abs(netDollars).toFixed(2)}`;

    message += `*${repo.label}*\nTrades: ${pt.length} | W: ${wins} | L: ${losses} | WR: ${wr}% | Net: *${netStr}*\n\n`;
    grandWins += wins; grandLosses += losses; grandPnl += netDollars; grandTotal += pt.length;
  }

  if (targetRepos.length > 1 && grandTotal > 0) {
    const grandWR = ((grandWins / grandTotal) * 100).toFixed(1);
    const grandStr = grandPnl >= 0 ? `+$${grandPnl.toFixed(2)}` : `-$${Math.abs(grandPnl).toFixed(2)}`;
    message += `━━━━━━━━━━━━━━━━━━━━\n*TOTAL COMBINED*\nTrades: ${grandTotal} | W: ${grandWins} | L: ${grandLosses} | WR: ${grandWR}%\nNet Realized P&L: *${grandStr}*`;
  }
  await sendTelegram(message);
}

// ── 4. LEADERBOARD & PROFITABILITY RANKING (/ranking) ──
async function handleRanking() {
  let message = `🏆 *PROFITABILITY RANKINGS — ALL BOTS*\n🕒 ${new Date().toUTCString()}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  const allRepoData = await Promise.all(REPOS.map(async (r) => ({ repo: r, trades: await fetchTradesJson(r) })));

  const rankedList = allRepoData.map(({ repo, trades }) => {
    const closed = trades.filter(t => t.result && t.result !== "CANCELLED");
    const wins = closed.filter(t => t.result === "WIN").length;
    const losses = closed.filter(t => t.result === "LOSS").length;
    const netPnl = closed.reduce((sum, t) => sum + getTradeRealizedPnl(t, repo), 0);
    const winRate = closed.length ? (wins / closed.length) * 100 : 0;
    return { repo, total: closed.length, wins, losses, netPnl, winRate };
  }).sort((a, b) => b.netPnl - a.netPnl);

  const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣"];

  rankedList.forEach((item, index) => {
    const pnlStr = item.netPnl >= 0 ? `+$${item.netPnl.toFixed(2)}` : `-$${Math.abs(item.netPnl).toFixed(2)}`;
    const tag = item.repo.isLive ? "🟢 Live" : "🔵 Demo";
    message += `${medals[index]} *${item.repo.symbol}* (${item.repo.label.split(" ")[0]} - ${tag})\n`;
    message += `   Net: *${pnlStr}* | WR: *${item.winRate.toFixed(1)}%* | ${item.total} trades (W:${item.wins} L:${item.losses})\n\n`;
  });

  const totalPortfolioPnl = rankedList.reduce((sum, i) => sum + i.netPnl, 0);
  const totalPnlStr = totalPortfolioPnl >= 0 ? `+$${totalPortfolioPnl.toFixed(2)}` : `-$${Math.abs(totalPortfolioPnl).toFixed(2)}`;
  message += `━━━━━━━━━━━━━━━━━━━━\n💼 *Total Portfolio Realized P&L:* *${totalPnlStr}*`;

  await sendTelegram(message);
}

// ── 5. STREAKS ANALYSIS (/streaks) ──
async function handleStreaks() {
  let message = `🔥 *WIN/LOSS STREAKS TRACKER*\n🕒 ${new Date().toUTCString()}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  const allRepoData = await Promise.all(REPOS.map(async (r) => ({ repo: r, trades: await fetchTradesJson(r) })));

  for (const { repo, trades } of allRepoData) {
    const closed = trades.filter(t => t.result && t.result !== "CANCELLED");
    if (closed.length === 0) {
      message += `*${repo.label}*: No closed trades yet.\n\n`;
      continue;
    }

    let currentStreakType = null;
    let currentStreakCount = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let tempWin = 0;
    let tempLoss = 0;

    closed.forEach(t => {
      if (t.result === "WIN") {
        tempWin++;
        tempLoss = 0;
        if (tempWin > maxWinStreak) maxWinStreak = tempWin;
      } else if (t.result === "LOSS") {
        tempLoss++;
        tempWin = 0;
        if (tempLoss > maxLossStreak) maxLossStreak = tempLoss;
      }
    });

    const lastResult = closed[closed.length - 1]?.result;
    if (lastResult) {
      currentStreakType = lastResult;
      for (let i = closed.length - 1; i >= 0; i--) {
        if (closed[i].result === lastResult) currentStreakCount++;
        else break;
      }
    }

    const streakIcon = currentStreakType === "WIN" ? "🔥" : "❄️";
    message += `*${repo.label}*\n`;
    message += `${streakIcon} Current Streak: *${currentStreakCount} ${currentStreakType}S*\n`;
    message += `🏆 Best Win Streak: *${maxWinStreak}W* | ⚠️ Max Loss Streak: *${maxLossStreak}L*\n\n`;
  }

  await sendTelegram(message);
}

// ── 6. QUANTITATIVE STATS & PROFIT FACTOR (/stats) ──
async function handleStats(args = []) {
  const targetRepos = filterReposByArgs(args);
  const isAll = targetRepos.length === REPOS.length;
  const headerSuffix = isAll ? "ALL BOTS" : targetRepos.map(r => r.symbol).join(", ");
  let message = `📐 *QUANTITATIVE PERFORMANCE METRICS — ${headerSuffix}*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  const allRepoData = await Promise.all(targetRepos.map(async (r) => ({ repo: r, trades: await fetchTradesJson(r) })));

  let totalWinsCount = 0;
  let totalLossCount = 0;
  let totalGrossProfit = 0;
  let totalGrossLoss = 0;

  for (const { repo, trades } of allRepoData) {
    const closed = trades.filter(t => t.result && t.result !== "CANCELLED");
    if (closed.length === 0) continue;

    let grossWin = 0;
    let grossLoss = 0;
    let wins = 0;
    let losses = 0;

    closed.forEach(t => {
      const pnl = getTradeRealizedPnl(t, repo);
      if (pnl >= 0) {
        grossWin += pnl;
        wins++;
      } else {
        grossLoss += Math.abs(pnl);
        losses++;
      }
    });

    const pf = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : grossWin > 0 ? "∞" : "0.00";
    const avgWin = wins > 0 ? (grossWin / wins).toFixed(2) : "0.00";
    const avgLoss = losses > 0 ? (grossLoss / losses).toFixed(2) : "0.00";

    totalWinsCount += wins;
    totalLossCount += losses;
    totalGrossProfit += grossWin;
    totalGrossLoss += grossLoss;

    message += `*${repo.label}*\n`;
    message += `• Profit Factor: *${pf}*\n`;
    message += `• Avg Win: *+$${avgWin}* | Avg Loss: *-$${avgLoss}*\n`;
    message += `• Gross Win: +$${grossWin.toFixed(2)} | Gross Loss: -$${grossLoss.toFixed(2)}\n\n`;
  }

  if (targetRepos.length > 1) {
    const grandPF = totalGrossLoss > 0 ? (totalGrossProfit / totalGrossLoss).toFixed(2) : "∞";
    const grandAvgWin = totalWinsCount > 0 ? (totalGrossProfit / totalWinsCount).toFixed(2) : "0.00";
    const grandAvgLoss = totalLossCount > 0 ? (totalGrossLoss / totalLossCount).toFixed(2) : "0.00";

    message += `━━━━━━━━━━━━━━━━━━━━\n*📊 COMBINED PORTFOLIO STATS*\n`;
    message += `• Combined Profit Factor: *${grandPF}*\n`;
    message += `• Portfolio Avg Win: *+$${grandAvgWin}*\n`;
    message += `• Portfolio Avg Loss: *-$${grandAvgLoss}*\n`;
    message += `• Total Realized Profit: *+$${totalGrossProfit.toFixed(2)}*\n`;
    message += `• Total Realized Loss: *-$${totalGrossLoss.toFixed(2)}*`;
  }

  await sendTelegram(message);
}

// ── 7. TOP BEST & WORST TRADES (/best, /worst) ──
async function handleExtremeTrades(isBest = true) {
  const label = isBest ? "TOP 5 BEST TRADES 🌟" : "TOP 5 BIGGEST LOSSES ⚠️";
  let message = `${label}\n━━━━━━━━━━━━━━━━━━━━\n\n`;

  const allRepoData = await Promise.all(REPOS.map(async (r) => ({ repo: r, trades: await fetchTradesJson(r) })));

  let allTrades = [];
  allRepoData.forEach(({ repo, trades }) => {
    trades.filter(t => t.result && t.result !== "CANCELLED").forEach(t => {
      allTrades.push({ ...t, repoLabel: repo.label, pnlVal: getTradeRealizedPnl(t, repo) });
    });
  });

  if (isBest) {
    allTrades = allTrades.filter(t => t.pnlVal > 0).sort((a, b) => b.pnlVal - a.pnlVal);
  } else {
    allTrades = allTrades.filter(t => t.pnlVal < 0).sort((a, b) => a.pnlVal - b.pnlVal);
  }

  const topTrades = allTrades.slice(0, 5);

  if (topTrades.length === 0) {
    message += `No matching trades recorded yet.`;
  } else {
    topTrades.forEach((t, idx) => {
      const phase = PHASE_LABELS[t.entryType] || t.entryType || "Standard";
      const icon = isBest ? "🚀" : "🛑";
      const pnlSign = t.pnlVal >= 0 ? `+$${t.pnlVal.toFixed(2)}` : `-$${Math.abs(t.pnlVal).toFixed(2)}`;
      message += `*#${idx + 1} — ${t.repoLabel}* ${icon}\n`;
      message += `💰 P&L: *${pnlSign}* | ${t.direction} @ ${t.entry ? Number(t.entry).toFixed(4) : "N/A"}\n`;
      message += `⚡ Setup: ${phase}\n`;
      message += `📅 Closed: \`${t.closeTime || t.openTime || "N/A"}\`\n\n`;
    });
  }

  await sendTelegram(message);
}

// ── 8. RISK & LIVE EXPOSURE METER (DIRECT BROKER FEED) ──
async function handleExposure() {
  let message = `🛡️ *PORTFOLIO RISK & LIVE EXPOSURE*\n🕒 ${new Date().toUTCString()}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  const liveContracts = await fetchLiveBrokerPortfolio();

  const allRepoData = await Promise.all(REPOS.map(async (repo) => {
    const [trades, currentPrice] = await Promise.all([
      fetchTradesJson(repo),
      fetchCurrentPrice(repo.derivSymbol)
    ]);
    return { repo, trades, currentPrice };
  }));

  let totalActiveContracts = 0;
  let totalStakeDeployed = 0;
  let totalUnrealizedPnl = 0;
  let totalMaxRisk = 0;

  for (const { repo, trades, currentPrice } of allRepoData) {
    if (!Array.isArray(liveContracts)) continue;

    const matches = liveContracts.filter(c => {
      const sym = c.underlying_symbol || c.symbol || (c.shortcode ? c.shortcode.split("_")[1] : "");
      return sym === repo.derivSymbol;
    });

    if (matches.length === 0) continue;

    for (const open of matches) {
      totalActiveContracts++;
      totalStakeDeployed += (open.buy_price || 5.00);
      totalMaxRisk += 5.00;

      const details = await fetchContractDetails(open.contract_id);
      const localTrade = trades.find(t => String(t.contractId) === String(open.contract_id));
      const entry = details?.entry || localTrade?.entry || null;
      const direction = open.contract_type === "MULTUP" ? "BUY" : "SELL";

      let pnlDollars = details?.profit ?? null;
      if (pnlDollars === null && currentPrice !== null && entry) {
        const rawPnl = direction === "BUY"
          ? (currentPrice - entry) / entry * 5 * repo.multiplier
          : (entry - currentPrice) / entry * 5 * repo.multiplier;
        pnlDollars = parseFloat((rawPnl - repo.commission).toFixed(2));
      }

      if (pnlDollars !== null) totalUnrealizedPnl += pnlDollars;
      const pnlStr = (pnlDollars !== null) ? (pnlDollars >= 0 ? `+$${pnlDollars.toFixed(2)}` : `-$${Math.abs(pnlDollars).toFixed(2)}`) : "N/A";

      message += `*${repo.label}*: ${direction} @ ${entry ? Number(entry).toFixed(4) : "Market Spot"}\n`;
      message += `• Floating P&L: *${pnlStr}* | Hard Stop: $5.00\n`;
      if (open.contract_id) message += `• Contract: \`${open.contract_id}\`\n\n`;
    }
  }

  const netPnlStr = totalUnrealizedPnl >= 0 ? `+$${totalUnrealizedPnl.toFixed(2)}` : `-$${Math.abs(totalUnrealizedPnl).toFixed(2)}`;

  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `• Active Positions: *${totalActiveContracts}*\n`;
  message += `• Margin Deployed: *$${totalStakeDeployed.toFixed(2)}*\n`;
  message += `• Max Downside Risk: *$${totalMaxRisk.toFixed(2)}*\n`;
  message += `• Total Floating P&L: *${netPnlStr}*`;

  await sendTelegram(message);
}

// ── 9. CUSTOM REPORT PARSER & HANDLER (/report) ──
function parseReportArgs(args) {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const symbolCodes = REPOS.map(r => r.symbol.toLowerCase());
  let fromDate = null, toDate = null;
  const dates = [], syms = [];

  for (const token of args) {
    if (dateRegex.test(token)) dates.push(token);
    else if (symbolCodes.includes(token.toLowerCase())) syms.push(token.toUpperCase());
    // ✅ FIX 2: Use UTC date math to avoid off-by-one errors near midnight
    else if (/^\d+$/.test(token) && !fromDate) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - parseInt(token));
      fromDate = d.toISOString().slice(0, 10);
      toDate = new Date().toISOString().slice(0, 10);
    }
  }
  if (dates.length === 1) { fromDate = dates[0]; toDate = dates[0]; }
  else if (dates.length >= 2) { fromDate = dates[0]; toDate = dates[1]; }
  return { fromDate, toDate, symbols: syms };
}

async function handleReport(args) {
  if (args.length === 0) { await sendTelegram(HELP_MANUAL); return; }
  const { fromDate, toDate, symbols } = parseReportArgs(args);
  if (!fromDate) { await sendTelegram(`❓ Couldn't parse report arguments.\n\n${HELP_MANUAL}`); return; }

  const from = new Date(fromDate + "T00:00:00Z");
  const to   = new Date(toDate   + "T23:59:59Z");
  const isSingleDay = fromDate === toDate;
  const filteredRepos = symbols.length > 0 ? REPOS.filter(r => symbols.includes(r.symbol)) : REPOS;
  const rangeLabel = isSingleDay ? fromDate : `${fromDate} → ${toDate}`;
  const symbolLabel = symbols.length > 0 ? ` | ${symbols.join(", ")}` : " | All Bots";

  let message = `📊 *Report: ${rangeLabel}${symbolLabel}*\n\n`;
  let grandWins = 0, grandLosses = 0, grandPnl = 0, grandTotal = 0;

  const allRepoData = await Promise.all(filteredRepos.map(async (r) => ({ repo: r, trades: await fetchTradesJson(r) })));

  for (const { repo, trades } of allRepoData) {
    const pt = trades.filter(t => {
      if (!t.result || t.result === "CANCELLED" || !t.closeTime) return false;
      const closeDate = parseUtcDate(t.closeTime);
      return closeDate && closeDate >= from && closeDate <= to;
    });

    if (pt.length === 0) { message += `*${repo.label}*\nNo trades in this period.\n\n`; continue; }

    const wins = pt.filter(t => t.result === "WIN").length;
    const losses = pt.filter(t => t.result === "LOSS").length;
    const netDollars = pt.reduce((s, t) => s + getTradeRealizedPnl(t, repo), 0);
    const wr = ((wins / pt.length) * 100).toFixed(1);
    const netStr = netDollars >= 0 ? `+$${netDollars.toFixed(2)}` : `-$${Math.abs(netDollars).toFixed(2)}`;

    message += `*${repo.label}*\nTrades: ${pt.length} | W: ${wins} | L: ${losses} | WR: ${wr}% | Net: *${netStr}*\n\n`;
    grandWins += wins; grandLosses += losses; grandPnl += netDollars; grandTotal += pt.length;
  }

  if (filteredRepos.length > 1 && grandTotal > 0) {
    const grandWR = ((grandWins / grandTotal) * 100).toFixed(1);
    const grandStr = grandPnl >= 0 ? `+$${grandPnl.toFixed(2)}` : `-$${Math.abs(grandPnl).toFixed(2)}`;
    message += `━━━━━━━━━━━━━━━━━━━━\n*TOTAL COMBINED*\nTrades: ${grandTotal} | W: ${grandWins} | L: ${grandLosses} | WR: ${grandWR}%\nNet Realized P&L: *${grandStr}*`;
  }
  await sendTelegram(message);
}

// ── 10. PHASE PERFORMANCE HANDLER (/performance, /perf) ──
function phaseStats(trades, phase, repo) {
  const pt = phase === "UNKNOWN"
    ? trades.filter(t => !t.entryType || !PHASE_LABELS[t.entryType])
    : trades.filter(t => t.entryType === phase);
  if (pt.length === 0) return null;
  const wins   = pt.filter(t => t.result === "WIN").length;
  const losses = pt.filter(t => t.result === "LOSS").length;
  const net$   = pt.reduce((s, t) => s + getTradeRealizedPnl(t, repo), 0);
  const wr     = ((wins / pt.length) * 100).toFixed(1);
  return { count: pt.length, wins, losses, wr, net$ };
}

async function handlePerformance(args) {
  let cutoff = null;
  let cutoffLabel = "All-Time";
  const numArg = args.find(a => /^\d+$/.test(a));
  const symArgs = args.filter(a => !/^\d+$/.test(a));
  const targetRepos = filterReposByArgs(symArgs);

  if (numArg) {
    const days = parseInt(numArg);
    const now = new Date();
    cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1, 0, 0, 0, 0));
    cutoffLabel = `Last ${days} Days`;
  }

  const allPhases = ["PHASE_A", "PHASE_B", "PHASE_B_NO_PRIOR_A", "RECOVERED_LIVE", "PHASE_C", "PHASE_D", "UNKNOWN"];
  const grandStats = {};
  allPhases.forEach(p => { grandStats[p] = { count: 0, wins: 0, losses: 0, net$: 0 }; });

  const targetSuffix = targetRepos.length === REPOS.length ? "All Bots" : targetRepos.map(r => r.symbol).join(", ");
  let message = `🔬 *Phase Performance — ${cutoffLabel} (${targetSuffix})*\n🕒 ${new Date().toUTCString()}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;

  const allRepoData = await Promise.all(targetRepos.map(async (r) => ({ repo: r, trades: await fetchTradesJson(r) })));

  for (const { repo, trades } of allRepoData) {
    const closed = trades.filter(t => {
      if (!t.result || t.result === "CANCELLED" || !t.closeTime) return false;
      const closeDate = parseUtcDate(t.closeTime);
      return !cutoff || (closeDate && closeDate >= cutoff);
    });
    if (closed.length === 0) continue;

    message += `\n*${repo.label}*\n`;
    let hasAny = false;
    for (const phase of allPhases) {
      const s = phaseStats(closed, phase, repo);
      if (!s) continue;
      hasAny = true;
      const label = phase === "UNKNOWN"
        ? "🔘 Legacy / Unknown"
        : `${PHASE_LABELS[phase] || phase}`;
      const netStr = s.net$ >= 0 ? `+$${s.net$.toFixed(2)}` : `-$${Math.abs(s.net$).toFixed(2)}`;
      const icon   = s.wr >= 60 ? "🟢" : s.wr >= 45 ? "🟡" : "🔴";
      message += `${icon} ${label}\n   ${s.count} trades | W:${s.wins} L:${s.losses} | WR:${s.wr}% | Net: *${netStr}*\n`;

      grandStats[phase].count += s.count;
      grandStats[phase].wins  += s.wins;
      grandStats[phase].losses += s.losses;
      grandStats[phase].net$  += s.net$;
    }
    if (!hasAny) message += `  No closed trades in period.\n`;
  }

  if (targetRepos.length > 1) {
    message += `\n━━━━━━━━━━━━━━━━━━━━\n*📊 COMBINED TOTALS*\n`;
    let anyGrand = false;
    for (const phase of allPhases) {
      const g = grandStats[phase];
      if (g.count === 0) continue;
      anyGrand = true;
      const wr     = ((g.wins / g.count) * 100).toFixed(1);
      const netStr = g.net$ >= 0 ? `+$${g.net$.toFixed(2)}` : `-$${Math.abs(g.net$).toFixed(2)}`;
      const icon   = wr >= 60 ? "🟢" : wr >= 45 ? "🟡" : "🔴";
      const label  = PHASE_LABELS[phase] || (phase === "UNKNOWN" ? "Legacy / Unknown" : phase);
      message += `${icon} ${label}: ${g.count} trades | WR:${wr}% | Net: *${netStr}*\n`;
    }
    if (!anyGrand) message += `No closed trades found.\n`;
  }

  await sendTelegram(message);
}

// ── 11. AUTOMATED PERIODIC REPORT SCHEDULER ──
let lastReportSent = { daily: null, weekly: null, monthly: null };

function checkScheduledReports() {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMins = now.getUTCMinutes();
  const utcDay = now.getUTCDay();
  const utcDate = now.getUTCDate();
  const dateKey = now.toISOString().slice(0, 10);

  if (utcHours === 0 && utcMins === 0 && lastReportSent.daily !== dateKey) {
    lastReportSent.daily = dateKey;
    handleSummary(1, "📅 Automated Daily Performance Summary", [], true);
  }

  if (utcDay === 0 && utcHours === 0 && utcMins === 5 && lastReportSent.weekly !== dateKey) {
    lastReportSent.weekly = dateKey;
    handleSummary(7, "📊 Automated Weekly Portfolio Summary", [], false);
  }

  if (utcDate === 1 && utcHours === 0 && utcMins === 10 && lastReportSent.monthly !== dateKey) {
    lastReportSent.monthly = dateKey;
    handleSummary(30, "🏆 Automated Monthly Portfolio Summary", [], false);
  }
}

// ── 12. MAIN DISPATCH LOOP ──
async function getUpdates(offset) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${offset}&timeout=20`);
    const data = await res.json();
    return data.ok ? data.result : [];
  } catch { return []; }
}

async function main() {
  console.log("🤖 Direct Machine-to-Machine Command Center started...");
  setInterval(checkScheduledReports, 30000);

  let offset = 0;
  while (true) {
    try {
      const updates = await getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        const raw = update.message?.text?.trim() || "";
        if (!raw) continue;
        const parts = raw.split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);
        console.log(`💬 Command received: ${raw}`);

        if (command === "/menu" || command === "/start") {
          await sendInteractiveMenu();
        } else if (command === "/status") {
          await handleStatus(filterReposByArgs(args), "BOT STATUS REPORT (DIRECT BROKER FEED)", false);
        } else if (command === "/open") {
          await handleStatus(REPOS, "ACTIVE OPEN TRADES (DIRECT BROKER FEED)", true);
        } else if (command === "/exposure" || command === "/risk" || command === "/summary") {
          await handleExposure();
        } else if (command === "/ranking" || command === "/leaderboard") {
          await handleRanking();
        } else if (command === "/streaks") {
          await handleStreaks();
        } else if (command === "/stats") {
          await handleStats(args);
        } else if (command === "/best") {
          await handleExtremeTrades(true);
        } else if (command === "/worst") {
          await handleExtremeTrades(false);
        } else if (command === "/live") {
          await handleStatus(REPOS.filter(r => r.isLive), "LIVE ACCOUNTS PORTFOLIO (V10 + V50)", false);
        } else if (command === "/demo") {
          await handleStatus(REPOS.filter(r => !r.isLive), "DEMO ACCOUNTS PORTFOLIO (5 BOTS)", false);
        } else if (command === "/fast" || command === "/1s") {
          await handleStatus(REPOS.filter(r => r.is1s), "1-SECOND HIGH-FREQUENCY INDICES (V75S + V100S)", false);
        } else if (command === "/standard") {
          await handleStatus(REPOS.filter(r => !r.is1s), "STANDARD VOLATILITY INDICES", false);
        } else if (["/v10", "/v50", "/v75", "/v75s", "/v100", "/v100s", "/v25"].includes(command)) {
          const sym = command.replace("/", "").toUpperCase();
          const target = REPOS.find(r => r.symbol.toUpperCase() === sym);
          if (target) await handleSingleBot(target);
        } else if (command === "/today" || command === "/daily" || command.startsWith("/today_") || command.startsWith("/daily_")) {
          const inlineSym = command.includes("_") ? [command.split("_")[1]] : args;
          await handleSummary(1, "Daily Summary (Today)", inlineSym, false);
        } else if (command === "/yesterday" || command.startsWith("/yesterday_")) {
          const inlineSym = command.includes("_") ? [command.split("_")[1]] : args;
          await handleSummary(1, "Yesterday's Performance", inlineSym, true);
        } else if (command === "/weekly" || command.startsWith("/weekly_")) {
          const inlineSym = command.includes("_") ? [command.split("_")[1]] : args;
          await handleSummary(7, "Weekly Summary (This Week: Sun-Now)", inlineSym, false);
        } else if (command === "/biweekly") {
          await handleSummary(14, "Bi-Weekly Summary (Last 14 Days)", args, false);
        } else if (command === "/monthly" || command.startsWith("/monthly_")) {
          const inlineSym = command.includes("_") ? [command.split("_")[1]] : args;
          await handleSummary(30, "Monthly Summary (Last 30 Days)", inlineSym, false);
        } else if (command.startsWith("/report")) {
          await handleReport(args);
        } else if (command === "/perf_today") {
          await handlePerformance(["1"]);
        } else if (command === "/perf_7d") {
          await handlePerformance(["7"]);
        } else if (command === "/perf_30d") {
          await handlePerformance(["30"]);
        } else if (command.startsWith("/perf_") || command.startsWith("/performance_")) {
          const sym = command.split("_")[1];
          await handlePerformance([sym]);
        } else if (command.startsWith("/performance") || command.startsWith("/perf")) {
          await handlePerformance(args);
        } else {
          await sendTelegram(HELP_MANUAL);
        }
      }
    } catch (err) {
      console.error("Poll error:", err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

main();
