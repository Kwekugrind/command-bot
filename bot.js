import fetch from "node-fetch";
import WebSocket from "ws";
import fs from "fs";

const TG_TOKEN = process.env.TG_BOT_TOKEN;
const ALLOWED_CHAT_ID = process.env.TG_CHAT_ID;

const REPOS = [
  { name: "Test-Bot",      label: "Test Bot (V100 Live)", symbol: "V100L", derivSymbol: "R_100"  },
  { name: "Milk",          label: "Milk Machine (V50)",   symbol: "V50",   derivSymbol: "R_50"   },
  { name: "Lery-s-Alerts", label: "Lery's Elite (V75)",   symbol: "V75",   derivSymbol: "R_75"   },
  { name: "coffee",        label: "Coffee Machine (Step)", symbol: "V75S",  derivSymbol: "1HZ75V" },
  { name: "OmniSight",     label: "OmniSight (V100)",     symbol: "V100",  derivSymbol: "R_100"  },
  { name: "ice-cream",     label: "Ice Cream (V10)",      symbol: "V10",   derivSymbol: "R_10"   },
  { name: "Tea",           label: "Tea Machine (V25)",    symbol: "V25",   derivSymbol: "R_25"   },
];

const SYMBOL_MAP = {
  "V10":   "ice-cream",
  "V25":   "Tea",
  "V50":   "Milk",
  "V75":   "Lery-s-Alerts",
  "V75S":  "coffee",
  "V100":  "OmniSight",
  "V100L": "Test-Bot",
};

let state = { lastUpdateId: 0 };
try {
  if (fs.existsSync("state.json")) state = JSON.parse(fs.readFileSync("state.json"));
} catch (e) {}

async function sendTelegram(chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
    });
  } catch (err) { console.error("Telegram error:", err.message); }
}

async function fetchTrades(repoName) {
  const url = `https://raw.githubusercontent.com/Kwekugrind/${repoName}/main/trades.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function fetchCurrentPrice(derivSymbol) {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket("wss://ws.binaryws.com/websockets/v3?app_id=1089", { headers: { "Origin": "https://deriv.com" } });
      const timeout = setTimeout(() => { ws.terminate(); resolve(null); }, 10000);
      ws.on("open", () => ws.send(JSON.stringify({ ticks_history: derivSymbol, count: 1, end: "latest" })));
      ws.on("message", (data) => {
        const r = JSON.parse(data);
        if (r.history && r.history.prices) { clearTimeout(timeout); resolve(parseFloat(r.history.prices[0])); ws.close(); }
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

async function handleStatus(chatId) {
  let message = `📡 *SYSTEM STATUS*\n_All Bots — Open Trades_\n\n`;
  let anyOpen = false;

  for (const repo of REPOS) {
    const trades = await fetchTrades(repo.name);
    const open = trades.find(t => t.result === null);
    if (open) {
      anyOpen = true;
      const openedAt = new Date(open.openTime.replace(" ", "T") + "Z");
      const durationMins = Math.round((Date.now() - openedAt.getTime()) / 60000);
      const dir = open.direction === "BUY" ? "🟢 BUY" : "🔴 SELL";

      const currentPrice = await fetchCurrentPrice(repo.derivSymbol);
      let pnlLine = "";
      if (currentPrice !== null) {
        const risk = open.direction === "BUY" ? open.entry - open.sl : open.sl - open.entry;
        const SL_DOLLARS = 5;
        const actualR = open.direction === "BUY"
          ? (currentPrice - open.entry) / risk
          : (open.entry - currentPrice) / risk;
        const pnlDollars = parseFloat((actualR * SL_DOLLARS).toFixed(2));
        const inProfit = pnlDollars >= 0;
        const pnlStr = inProfit ? `+$${pnlDollars.toFixed(2)}` : `-$${Math.abs(pnlDollars).toFixed(2)}`;
        const pnlIcon = inProfit ? "📈" : "📉";
        pnlLine = `${pnlIcon} ${inProfit ? "Profit" : "Loss"}:  ${pnlStr}  (@ ${currentPrice.toFixed(4)})\n`;
      }

      message += `*${repo.label}*\n`;
      message += `${dir}  |  Entry: \`${open.entry.toFixed(4)}\`\n`;
      message += `SL: \`${open.sl.toFixed(4)}\`  TP1: \`${open.tp1.toFixed(4)}\`\n`;
      message += pnlLine;
      message += `⏱ ${formatDuration(durationMins)}\n\n`;
    }
  }

  if (!anyOpen) {
    message += `No open trades across any bot right now.\n\n🔍 All bots scanning for setups.`;
  }

  await sendTelegram(chatId, message);
}

async function buildReport(repos, fromDate, toDate, title) {
  let message = `📊 *${title}*\n`;
  if (fromDate) {
    const from = fromDate.toISOString().slice(0, 10);
    const to = toDate.toISOString().slice(0, 10);
    message += from === to ? `_${from}_\n\n` : `_${from} → ${to}_\n\n`;
  }
  message += "\n";

  let totalTrades = 0, totalWins = 0, totalLosses = 0, totalNetR = 0;
  let hasAnyTrades = false;

  for (const repo of repos) {
    const trades = await fetchTrades(repo.name);
    const period = trades.filter(t => {
      if (!t.result || t.result === "CANCELLED") return false;
      if (!fromDate) return true;
      const closeTime = new Date(t.closeTime);
      return closeTime >= fromDate && closeTime <= toDate;
    });

    if (period.length === 0) {
      message += `*${repo.label}*: No trades\n`;
      continue;
    }

    hasAnyTrades = true;
    const wins = period.filter(t => t.result === "WIN").length;
    const losses = period.filter(t => t.result === "LOSS").length;
    const netR = period.reduce((s, t) => s + (t.result === "WIN" ? (t.rr || 1.5) : -1), 0);
    const wr = ((wins / period.length) * 100).toFixed(0);
    const netRStr = netR >= 0 ? `+${netR.toFixed(1)}R` : `${netR.toFixed(1)}R`;

    message += `*${repo.label}*\n`;
    message += `${wins}W / ${losses}L  |  WR: ${wr}%  |  ${netRStr}\n\n`;

    totalTrades += period.length;
    totalWins += wins;
    totalLosses += losses;
    totalNetR += netR;
  }

  if (hasAnyTrades && repos.length > 1) {
    const totalWR = ((totalWins / totalTrades) * 100).toFixed(1);
    const totalNetRStr = totalNetR >= 0 ? `+${totalNetR.toFixed(1)}R` : `${totalNetR.toFixed(1)}R`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `*COMBINED (${totalTrades} trades)*\n`;
    message += `${totalWins}W / ${totalLosses}L  |  WR: ${totalWR}%  |  ${totalNetRStr}`;
  } else if (!hasAnyTrades) {
    message += `No closed trades found in this period.`;
  }

  return message;
}

async function handleReport(chatId, daysBack, title) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  cutoff.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  const message = await buildReport(REPOS, cutoff, now, title);
  await sendTelegram(chatId, message);
}

function parseReportArgs(args) {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const numRegex = /^\d+$/;
  let fromDate = null, toDate = new Date(), selectedRepos = null, i = 0;
  toDate.setHours(23, 59, 59, 999);

  if (numRegex.test(args[0])) {
    const days = parseInt(args[0]);
    if (days < 1 || days > 365) return { error: "Duration must be between 1 and 365 days." };
    fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    fromDate.setHours(0, 0, 0, 0);
    i = 1;
  } else if (dateRegex.test(args[0])) {
    fromDate = new Date(args[0] + "T00:00:00Z");
    if (isNaN(fromDate)) return { error: `Invalid date: ${args[0]}. Use YYYY-MM-DD.` };
    i = 1;
    if (args[1] && dateRegex.test(args[1])) {
      toDate = new Date(args[1] + "T23:59:59Z");
      if (isNaN(toDate)) return { error: `Invalid end date: ${args[1]}. Use YYYY-MM-DD.` };
      if (toDate < fromDate) return { error: "End date must be after start date." };
      i = 2;
    } else {
      toDate = new Date(args[0] + "T23:59:59Z");
    }
  } else {
    return { error: `Invalid format. Send \`/report\` alone to see usage examples.` };
  }

  const symbolArgs = args.slice(i).map(s => s.toUpperCase());
  if (symbolArgs.length > 0) {
    const repoNames = [], unknown = [];
    for (const sym of symbolArgs) {
      if (SYMBOL_MAP[sym]) repoNames.push(SYMBOL_MAP[sym]);
      else unknown.push(sym);
    }
    if (unknown.length > 0) {
      return { error: `Unknown symbol(s): *${unknown.join(", ")}*\n\nValid: V10, V25, V50, V75, V75S, V100, V100L` };
    }
    selectedRepos = REPOS.filter(r => repoNames.includes(r.name));
  }

  return { fromDate, toDate, selectedRepos };
}

async function handleCustomReport(chatId, args) {
  const parsed = parseReportArgs(args);
  if (parsed.error) {
    await sendTelegram(chatId, `❌ ${parsed.error}`);
    return;
  }

  const { fromDate, toDate, selectedRepos } = parsed;
  const repos = selectedRepos || REPOS;

  const from = fromDate.toISOString().slice(0, 10);
  const to = toDate.toISOString().slice(0, 10);
  const symbolLabel = selectedRepos ? selectedRepos.map(r => r.symbol).join(", ") : "All Bots";
  const title = `Custom Report — ${symbolLabel}`;

  const message = await buildReport(repos, fromDate, toDate, title);
  await sendTelegram(chatId, message);
}

async function handleReportUsage(chatId) {
  await sendTelegram(chatId,
    `📊 *Custom Report — Usage*\n\n` +
    `*By duration (days):*\n` +
    `\`/report 7\` — Last 7 days, all bots\n` +
    `\`/report 30 V50\` — Last 30 days, Milk only\n` +
    `\`/report 14 V75 V100\` — Last 14 days, two bots\n\n` +
    `*By date range:*\n` +
    `\`/report 2026-07-01\` — Single day\n` +
    `\`/report 2026-07-01 2026-07-31\` — Full range\n` +
    `\`/report 2026-07-01 2026-07-31 V75 V100\` — Range + filter\n\n` +
    `*Valid symbols:*\n` +
    `V10, V25, V50, V75, V75S, V100, V100L\n\n` +
    `Omit symbol to include all bots.`
  );
}

async function handleHelp(chatId) {
  await sendTelegram(chatId,
    `🤖 *Command Bot — Available Commands*\n\n` +
    `/status — All currently open trades\n` +
    `/reportdaily — Today's summary\n` +
    `/reportweekly — Last 7 days summary\n` +
    `/reportmonthly — Last 30 days summary\n` +
    `/report — Custom report (duration, date range, symbols)\n` +
    `/help — Show this message`
  );
}

async function getUpdates() {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${state.lastUpdateId + 1}&timeout=5`
    );
    const data = await res.json();
    return data.result || [];
  } catch { return []; }
}

(async () => {
  const updates = await getUpdates();

  for (const update of updates) {
    const msg = update.message;
    if (!msg || !msg.text) { state.lastUpdateId = update.update_id; continue; }

    const chatId = String(msg.chat.id);
    const rawText = msg.text.trim();
    const text = rawText.toLowerCase();

    if (chatId !== String(ALLOWED_CHAT_ID)) {
      state.lastUpdateId = update.update_id;
      continue;
    }

    console.log(`Command received: ${rawText}`);

    if (text === "/status") {
      await handleStatus(chatId);
    } else if (text === "/reportdaily") {
      await handleReport(chatId, 1, "Daily Report");
    } else if (text === "/reportweekly") {
      await handleReport(chatId, 7, "Weekly Report");
    } else if (text === "/reportmonthly") {
      await handleReport(chatId, 30, "Monthly Report");
    } else if (text === "/report") {
      await handleReportUsage(chatId);
    } else if (text.startsWith("/report ")) {
      const args = rawText.slice(8).trim().split(/\s+/);
      await handleCustomReport(chatId, args);
    } else if (text === "/help") {
      await handleHelp(chatId);
    }

    state.lastUpdateId = update.update_id;
  }

  fs.writeFileSync("state.json", JSON.stringify(state, null, 2));
})();
