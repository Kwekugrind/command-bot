import fetch from "node-fetch";
import WebSocket from "ws";

const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT  = process.env.TG_CHAT_ID;
const GH_TOKEN = process.env.GH_TOKEN;
const GH_USER  = "Kwekugrind";

const REPOS = [
  { name: "Test-Bot",      label: "Test Bot (V10 Live)",    symbol: "V10",   derivSymbol: "R_10"    },
  { name: "Milk",          label: "Milk Machine (V100)",    symbol: "V100",  derivSymbol: "R_100"   },
  { name: "Lery-s-Alerts", label: "Lery's Elite (V75)",    symbol: "V75",   derivSymbol: "R_75"    },
  { name: "coffee",        label: "Coffee Machine (Step)",  symbol: "V75S",  derivSymbol: "1HZ75V"  },
  { name: "OmniSight",     label: "OmniSight (V50)",        symbol: "V50",   derivSymbol: "R_50"    },
  { name: "ice-cream",     label: "Ice Cream (V100 1s)",    symbol: "V100S", derivSymbol: "1HZ100V" },
  { name: "Tea",           label: "Tea Machine (V25)",      symbol: "V25",   derivSymbol: "R_25"    },
];

async function sendTelegram(message) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text: message, parse_mode: "Markdown" })
    });
  } catch (err) { console.error("Telegram error:", err.message); }
}

async function fetchTradesJson(repoName) {
  const url = `https://raw.githubusercontent.com/${GH_USER}/${repoName}/main/trades.json`;
  try {
    const headers = GH_TOKEN ? { "Authorization": `Bearer ${GH_TOKEN}` } : {};
    const res = await fetch(url, { headers });
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

async function handleStatus() {
  let message = `📊 *BOT STATUS REPORT*\n`;
  message += `🕒 ${new Date().toUTCString()}\n\n`;

  for (const repo of REPOS) {
    const trades = await fetchTradesJson(repo.name);
    const open = trades.find(t => t.result === null);
    const closed = trades.filter(t => t.result !== null && t.result !== "CANCELLED");
    const wins = closed.filter(t => t.result === "WIN").length;
    const losses = closed.filter(t => t.result === "LOSS").length;

    message += `*${repo.label}*\n`;

    if (open) {
      const nowMins = Math.round((Date.now() - new Date(open.openTime).getTime()) / 60000);
      const durationMins = isNaN(nowMins) ? 0 : nowMins;
      message += `🟡 OPEN: ${open.direction} @ ${open.entry?.toFixed(4) || "N/A"}\n`;

      const currentPrice = await fetchCurrentPrice(repo.derivSymbol);
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
        message += `${pnlIcon} ${inProfit ? "Profit" : "Loss"}:  ${pnlStr}  (@ ${currentPrice.toFixed(4)})\n`;
      }
      message += `⏱ ${formatDuration(durationMins)}\n\n`;
    } else {
      message += `⚪ No open trade\n`;
      if (closed.length > 0) message += `W: ${wins} | L: ${losses} | Total: ${closed.length}\n`;
      message += `\n`;
    }
  }
  await sendTelegram(message);
}

async function handleSummary(daysBack, label) {
  let message = `📊 *${label} — ALL BOTS*\n🕒 ${new Date().toUTCString()}\n\n`;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  for (const repo of REPOS) {
    const trades = await fetchTradesJson(repo.name);
    const pt = trades.filter(t => t.result && t.result !== "CANCELLED" && new Date(t.closeTime) >= cutoff);
    if (pt.length === 0) { message += `*${repo.label}*\nNo trades in period.\n\n`; continue; }
    const wins = pt.filter(t => t.result === "WIN").length;
    const losses = pt.filter(t => t.result === "LOSS").length;
    const netR = pt.reduce((s, t) => s + (t.result === "WIN" ? t.rr : -1), 0);
    const wr = ((wins / pt.length) * 100).toFixed(1);
    message += `*${repo.label}*\nTrades: ${pt.length} | W: ${wins} | L: ${losses} | WR: ${wr}% | Net: ${netR.toFixed(1)}R\n\n`;
  }
  await sendTelegram(message);
}

async function getUpdates(offset) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${offset}&timeout=20`);
  const data = await res.json();
  return data.ok ? data.result : [];
}

async function main() {
  console.log("🤖 Command bot started...");
  let offset = 0;
  while (true) {
    try {
      const updates = await getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        const text = update.message?.text?.trim().toLowerCase();
        if (!text) continue;
        console.log(`💬 Command: ${text}`);
        if (text === "/status" || text === "/s")      await handleStatus();
        else if (text === "/daily"  || text === "/d") await handleSummary(1, "Daily Summary");
        else if (text === "/weekly" || text === "/w") await handleSummary(7, "Weekly Summary");
        else if (text === "/monthly"|| text === "/m") await handleSummary(30, "Monthly Summary");
        else await sendTelegram(`❓ Unknown command: ${text}\n\nAvailable:\n/status or /s\n/daily or /d\n/weekly or /w\n/monthly or /m`);
      }
    } catch (err) { console.error("Poll error:", err.message); await new Promise(r => setTimeout(r, 5000)); }
  }
}

main();
