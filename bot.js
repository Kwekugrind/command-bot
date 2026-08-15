import fetch from "node-fetch";
import WebSocket from "ws";

const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT  = process.env.TG_CHAT_ID;
const GH_TOKEN = process.env.GH_TOKEN;
const GH_USER  = "Kwekugrind";

const REPOS = [
  { name: "Test-Bot",       label: "Test Bot (V10 Live)",   symbol: "V10",   derivSymbol: "R_10"    },
  { name: "Milk",           label: "Milk Machine (V100)",   symbol: "V100",  derivSymbol: "R_100"   },
  { name: "Lery-s-Alerts",  label: "Lery's Elite (V75)",    symbol: "V75",   derivSymbol: "R_75"    },
  { name: "coffee",         label: "Coffee Machine (V75S)", symbol: "V75S",  derivSymbol: "1HZ75V"  },
  { name: "OmniSight",      label: "OmniSight (V50)",       symbol: "V50",   derivSymbol: "R_50"    },
  { name: "ice-cream",      label: "Ice Cream (V100S)",     symbol: "V100S", derivSymbol: "1HZ100V" },
  { name: "Tea",            label: "Tea Machine (V25)",     symbol: "V25",   derivSymbol: "R_25"    },
];

const REPORT_USAGE = `📖 *Report Command Usage*

*By number of days:*
/report 7 — Last 7 days, all bots
/report 7 V10 — Last 7 days, Test Bot only
/report 7 V10 V50 — Last 7 days, Test Bot + OmniSight
/report 30 — Last 30 days, all bots
/report 30 V100 — Last 30 days, Milk only

*By single date:*
/report 2026-07-01 — That day, all bots
/report 2026-07-01 V75 — That day, Lery's only

*By date range:*
/report 2026-07-01 2026-07-31 — Full range, all bots
/report 2026-07-01 2026-07-31 V75 V100 — Full range, specific bots

*Symbol codes:*
V10 = Test Bot (R\\_10)
V25 = Tea (R\\_25)
V50 = OmniSight (R\\_50)
V75 = Lery's Alerts (R\\_75)
V75S = Coffee (1HZ75V)
V100 = Milk (R\\_100)
V100S = Ice Cream (1HZ100V)

💡 You can combine any number of symbols. Separate with spaces.`;

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
  let message = `📊 *BOT STATUS REPORT*\n🕒 ${new Date().toUTCString()}\n\n`;
  for (const repo of REPOS) {
    const trades = await fetchTradesJson(repo.name);
    const open = trades.find(t => t.result === null);
    const closed = trades.filter(t => t.result !== null && t.result !== "CANCELLED");
    const wins = closed.filter(t => t.result === "WIN").length;
    const losses = closed.filter(t => t.result === "LOSS").length;
    message += `*${repo.label}*\n`;
    if (open) {
      const nowMins = Math.round((Date.now() - new Date(open.openTime).getTime()) / 60000);
      message += `🟡 OPEN: ${open.direction} @ ${open.entry?.toFixed(4) || "N/A"}\n`;
      const currentPrice = await fetchCurrentPrice(repo.derivSymbol);
      if (currentPrice !== null) {
        const risk = open.direction === "BUY" ? open.entry - open.sl : open.sl - open.entry;
        const actualR = open.direction === "BUY" ? (currentPrice - open.entry) / risk : (open.entry - currentPrice) / risk;
        const pnlDollars = parseFloat((actualR * 5).toFixed(2));
        const pnlStr = pnlDollars >= 0 ? `+$${pnlDollars.toFixed(2)}` : `-$${Math.abs(pnlDollars).toFixed(2)}`;
        const pnlIcon = pnlDollars >= 0 ? "📈" : "📉";
        message += `${pnlIcon} ${pnlDollars >= 0 ? "Profit" : "Loss"}:  ${pnlStr}  (@ ${currentPrice.toFixed(4)})\n`;
      }
      message += `⏱ ${formatDuration(isNaN(nowMins) ? 0 : nowMins)}\n\n`;
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

function parseReportArgs(args) {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const symbolCodes = REPOS.map(r => r.symbol.toLowerCase());
  let fromDate = null, toDate = null;
  const dates = [], syms = [];
  for (const token of args) {
    if (dateRegex.test(token)) dates.push(token);
    else if (symbolCodes.includes(token.toLowerCase())) syms.push(token.toUpperCase());
    else if (/^\d+$/.test(token) && !fromDate) {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(token));
      fromDate = d.toISOString().slice(0, 10);
      toDate = new Date().toISOString().slice(0, 10);
    }
  }
  if (dates.length === 1) { fromDate = dates[0]; toDate = dates[0]; }
  else if (dates.length >= 2) { fromDate = dates[0]; toDate = dates[1]; }
  return { fromDate, toDate, symbols: syms };
}

async function handleReport(args) {
  if (args.length === 0) { await sendTelegram(REPORT_USAGE); return; }
  const { fromDate, toDate, symbols } = parseReportArgs(args);
  if (!fromDate) { await sendTelegram(`❓ Couldn't parse that.\n\n${REPORT_USAGE}`); return; }
  const from = new Date(fromDate + "T00:00:00Z");
  const to   = new Date(toDate   + "T23:59:59Z");
  const isSingleDay = fromDate === toDate;
  const filteredRepos = symbols.length > 0 ? REPOS.filter(r => symbols.includes(r.symbol)) : REPOS;
  const rangeLabel = isSingleDay ? fromDate : `${fromDate} → ${toDate}`;
  const symbolLabel = symbols.length > 0 ? ` | ${symbols.join(", ")}` : " | All Bots";
  let message = `📊 *Report: ${rangeLabel}${symbolLabel}*\n\n`;
  let grandWins = 0, grandLosses = 0, grandR = 0, grandTotal = 0;
  for (const repo of filteredRepos) {
    const trades = await fetchTradesJson(repo.name);
    const pt = trades.filter(t => {
      if (!t.result || t.result === "CANCELLED" || !t.closeTime) return false;
      const closeDate = new Date(t.closeTime);
      return closeDate >= from && closeDate <= to;
    });
    if (pt.length === 0) { message += `*${repo.label}*\nNo trades in this period.\n\n`; continue; }
    const wins = pt.filter(t => t.result === "WIN").length;
    const losses = pt.filter(t => t.result === "LOSS").length;
    const netR = pt.reduce((s, t) => s + (t.result === "WIN" ? (t.rr || 1.5) : -1), 0);
    const wr = ((wins / pt.length) * 100).toFixed(1);
    const netDollars = parseFloat((netR * 5).toFixed(2));
    const netStr = netDollars >= 0 ? `+$${netDollars.toFixed(2)}` : `-$${Math.abs(netDollars).toFixed(2)}`;
    message += `*${repo.label}*\nTrades: ${pt.length} | W: ${wins} | L: ${losses} | WR: ${wr}%\nNet: ${netR.toFixed(1)}R (${netStr})\n\n`;
    grandWins += wins; grandLosses += losses; grandR += netR; grandTotal += pt.length;
  }
  if (filteredRepos.length > 1 && grandTotal > 0) {
    const grandWR = ((grandWins / grandTotal) * 100).toFixed(1);
    const grandDollars = parseFloat((grandR * 5).toFixed(2));
    const grandStr = grandDollars >= 0 ? `+$${grandDollars.toFixed(2)}` : `-$${Math.abs(grandDollars).toFixed(2)}`;
    message += `━━━━━━━━━━━━━━━━━━━━\n*TOTAL — All Bots*\nTrades: ${grandTotal} | W: ${grandWins} | L: ${grandLosses} | WR: ${grandWR}%\nNet: ${grandR.toFixed(1)}R (${grandStr})`;
  }
  await sendTelegram(message);
}

const PHASE_LABELS = {
  PHASE_A: "Phase A — Fresh H1 Cross",
  PHASE_B: "Phase B — Stateful Pullback",
  PHASE_C: "Phase C — HTF Realignment",
  PHASE_D: "Phase D — Shallow Pullback",
};

function phaseStats(trades, phase) {
  const pt = phase === "UNKNOWN"
    ? trades.filter(t => !t.entryType || !PHASE_LABELS[t.entryType])
    : trades.filter(t => t.entryType === phase);
  if (pt.length === 0) return null;
  const wins   = pt.filter(t => t.result === "WIN").length;
  const losses = pt.filter(t => t.result === "LOSS").length;
  const netR   = pt.reduce((s, t) => s + (t.result === "WIN" ? (t.rr || 1.5) : -1), 0);
  const wr     = ((wins / pt.length) * 100).toFixed(1);
  const net$   = parseFloat((netR * 5).toFixed(2));
  return { count: pt.length, wins, losses, wr, netR, net$ };
}

async function handlePerformance(args) {
  // Optional arg: number of days (default = all-time)
  let cutoff = null;
  let cutoffLabel = "All-Time";
  if (args.length > 0 && /^\d+$/.test(args[0])) {
    const days = parseInt(args[0]);
    cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    cutoffLabel = `Last ${days} Days`;
  }

  // Phase accumulators across all bots
  const allPhases = ["PHASE_A", "PHASE_B", "PHASE_C", "PHASE_D", "UNKNOWN"];
  const grandStats = {};
  allPhases.forEach(p => { grandStats[p] = { count: 0, wins: 0, losses: 0, netR: 0 }; });

  let message = `🔬 *Phase Performance Report — ${cutoffLabel}*\n🕒 ${new Date().toUTCString()}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;

  for (const repo of REPOS) {
    const allTrades = await fetchTradesJson(repo.name);
    const closed = allTrades.filter(t => {
      if (!t.result || t.result === "CANCELLED" || !t.closeTime) return false;
      if (cutoff && new Date(t.closeTime) < cutoff) return false;
      return true;
    });
    if (closed.length === 0) continue;

    message += `\n*${repo.label}*\n`;
    let hasAny = false;
    for (const phase of allPhases) {
      const s = phaseStats(closed, phase);
      if (!s) continue;
      hasAny = true;
      const label = phase === "UNKNOWN" ? "🔘 Legacy / Unknown" : `${["🅰️","🅱️","🆑","🇩",""][allPhases.indexOf(phase)]} ${PHASE_LABELS[phase]}`;
      const netStr = s.net$ >= 0 ? `+$${s.net$.toFixed(2)}` : `-$${Math.abs(s.net$).toFixed(2)}`;
      const icon   = s.wr >= 60 ? "🟢" : s.wr >= 45 ? "🟡" : "🔴";
      message += `${icon} ${label}\n   ${s.count} trades | W:${s.wins} L:${s.losses} | WR:${s.wr}% | Net:${s.netR.toFixed(1)}R (${netStr})\n`;
      // Accumulate into grand totals
      grandStats[phase].count  += s.count;
      grandStats[phase].wins   += s.wins;
      grandStats[phase].losses += s.losses;
      grandStats[phase].netR   += s.netR;
    }
    if (!hasAny) message += `  No closed trades in period.\n`;
  }

  // Grand totals section across all bots
  message += `\n━━━━━━━━━━━━━━━━━━━━\n*📊 COMBINED — All Bots*\n`;
  let anyGrand = false;
  for (const phase of allPhases) {
    const g = grandStats[phase];
    if (g.count === 0) continue;
    anyGrand = true;
    const wr     = ((g.wins / g.count) * 100).toFixed(1);
    const net$   = parseFloat((g.netR * 5).toFixed(2));
    const netStr = net$ >= 0 ? `+$${net$.toFixed(2)}` : `-$${Math.abs(net$).toFixed(2)}`;
    const icon   = wr >= 60 ? "🟢" : wr >= 45 ? "🟡" : "🔴";
    const label  = phase === "UNKNOWN" ? "Legacy/Unknown" : PHASE_LABELS[phase];
    message += `${icon} ${label}: ${g.count} trades | WR:${wr}% | Net:${g.netR.toFixed(1)}R (${netStr})\n`;
  }
  if (!anyGrand) message += `No closed trades found.\n`;

  // Best & worst phase callout
  const ranked = allPhases
    .filter(p => grandStats[p].count > 0)
    .map(p => ({
      phase: p,
      wr: grandStats[p].count > 0 ? (grandStats[p].wins / grandStats[p].count) * 100 : 0,
      netR: grandStats[p].netR
    }))
    .sort((a, b) => b.netR - a.netR);

  if (ranked.length >= 2) {
    const best  = ranked[0];
    const worst = ranked[ranked.length - 1];
    message += `\n🏆 *Best:* ${PHASE_LABELS[best.phase] || "Legacy"} (WR:${best.wr.toFixed(1)}% | Net:${best.netR.toFixed(1)}R)\n`;
    message += `⚠️ *Worst:* ${PHASE_LABELS[worst.phase] || "Legacy"} (WR:${worst.wr.toFixed(1)}% | Net:${worst.netR.toFixed(1)}R)\n`;
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
        const raw = update.message?.text?.trim() || "";
        if (!raw) continue;
        const lower = raw.toLowerCase();
        console.log(`💬 Command: ${raw}`);
        if (lower === "/status")       await handleStatus();
        else if (lower === "/daily")   await handleSummary(1,  "Daily Summary");
        else if (lower === "/weekly")  await handleSummary(7,  "Weekly Summary");
        else if (lower === "/monthly") await handleSummary(30, "Monthly Summary");
        else if (lower.startsWith("/report")) {
          const args = raw.slice("/report".length).trim().split(/\s+/).filter(Boolean);
          await handleReport(args);
        } else if (lower.startsWith("/performance") || lower.startsWith("/perf")) {
          const cmd = lower.startsWith("/performance") ? "/performance" : "/perf";
          const args = raw.slice(cmd.length).trim().split(/\s+/).filter(Boolean);
          await handlePerformance(args);
        } else {
          await sendTelegram(`❓ Unknown command: ${raw}\n\nAvailable:\n/status — Live status, all bots\n/daily — Today's summary\n/weekly — Last 7 days\n/monthly — Last 30 days\n/report — Custom report (send /report for guide)\n/performance [days] — Phase A/B/C/D win rates across all bots\n/perf [days] — Alias for /performance`);
        }
      }
    } catch (err) { console.error("Poll error:", err.message); await new Promise(r => setTimeout(r, 5000)); }
  }
}

main();
