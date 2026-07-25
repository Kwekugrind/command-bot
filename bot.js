import fetch from "node-fetch";
import fs from "fs";

const TG_TOKEN = process.env.TG_BOT_TOKEN;
const ALLOWED_CHAT_ID = process.env.TG_CHAT_ID;

const REPOS = [
  { name: "Test-Bot",       label: "Test Bot (V100 Live)"   },
  { name: "Milk",           label: "Milk Machine (V50)"     },
  { name: "Lery-s-Alerts",  label: "Lery's Elite (V75)"     },
  { name: "coffee",         label: "Coffee Machine (Step)"  },
  { name: "OmniSight",      label: "OmniSight (V100)"       },
  { name: "ice-cream",      label: "Ice Cream (V10)"        },
  { name: "Tea",            label: "Tea Machine (V25)"      },
];

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
      message += `*${repo.label}*\n`;
      message += `${dir}  |  Entry: \`${open.entry.toFixed(4)}\`\n`;
      message += `SL: \`${open.sl.toFixed(4)}\`  TP1: \`${open.tp1.toFixed(4)}\`\n`;
      message += `⏱ Open ~${durationMins} min\n\n`;
    }
  }

  if (!anyOpen) {
    message += `No open trades across any bot right now.\n\n🔍 All bots scanning for setups.`;
  }

  await sendTelegram(chatId, message);
}

async function handleReport(chatId, daysBack, title) {
  let message = `📊 *${title}*\n_All Bots Combined_\n\n`;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  let totalTrades = 0, totalWins = 0, totalLosses = 0, totalNetR = 0;
  let hasAnyTrades = false;

  for (const repo of REPOS) {
    const trades = await fetchTrades(repo.name);
    const period = trades.filter(t =>
      t.result && t.result !== "CANCELLED" &&
      new Date(t.closeTime) >= cutoff
    );

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

  if (hasAnyTrades) {
    const totalWR = ((totalWins / totalTrades) * 100).toFixed(1);
    const totalNetRStr = totalNetR >= 0 ? `+${totalNetR.toFixed(1)}R` : `${totalNetR.toFixed(1)}R`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `*COMBINED (${totalTrades} trades)*\n`;
    message += `${totalWins}W / ${totalLosses}L  |  WR: ${totalWR}%  |  ${totalNetRStr}`;
  } else {
    message += `No closed trades found in this period.`;
  }

  await sendTelegram(chatId, message);
}

async function handleHelp(chatId) {
  await sendTelegram(chatId,
    `🤖 *Command Bot — Available Commands*\n\n` +
    `/status — All currently open trades\n` +
    `/report — Weekly summary (all bots)\n` +
    `/report daily — Today's summary\n` +
    `/report weekly — This week's summary\n` +
    `/report monthly — This month's summary\n` +
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
    const text = msg.text.trim().toLowerCase();

    // Only respond to the authorised chat
    if (chatId !== String(ALLOWED_CHAT_ID)) {
      state.lastUpdateId = update.update_id;
      continue;
    }

    console.log(`Command received: ${text}`);

    if (text === "/status") {
      await handleStatus(chatId);
    } else if (text === "/report" || text === "/report weekly") {
      await handleReport(chatId, 7, "Weekly Report");
    } else if (text === "/report daily") {
      await handleReport(chatId, 1, "Daily Report");
    } else if (text === "/report monthly") {
      await handleReport(chatId, 30, "Monthly Report");
    } else if (text === "/help") {
      await handleHelp(chatId);
    }

    state.lastUpdateId = update.update_id;
  }

  fs.writeFileSync("state.json", JSON.stringify(state, null, 2));
})();
