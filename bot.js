import fetch from "node-fetch";
import WebSocket from "ws";

const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT  = process.env.TG_CHAT_ID;
const GH_TOKEN = process.env.GH_TOKEN;
const GH_USER  = "Kwekugrind";

// Multipliers and commissions matched to individual bot repositories
const REPOS = [
  { name: "Test-Bot",       label: "Test Bot (V10 Live)",   symbol: "V10",   derivSymbol: "R_10",    multiplier: 400, commission: 0.16 },
  { name: "Milk",           label: "Milk Machine (V100)",   symbol: "V100",  derivSymbol: "R_100",   multiplier: 40,  commission: 0.15 },
  { name: "Lery-s-Alerts",  label: "Lery's Elite (V75)",    symbol: "V75",   derivSymbol: "R_75",    multiplier: 50,  commission: 0.15 },
  { name: "coffee",         label: "Coffee Machine (V75S)", symbol: "V75S",  derivSymbol: "1HZ75V",  multiplier: 50,  commission: 0.15 },
  { name: "OmniSight",      label: "OmniSight (V50)",       symbol: "V50",   derivSymbol: "R_50",    multiplier: 80,  commission: 0.16 },
  { name: "ice-cream",      label: "Ice Cream (V100S)",     symbol: "V100S", derivSymbol: "1HZ100V", multiplier: 40,  commission: 0.15 },
  { name: "Tea",            label: "Tea Machine (V25)",     symbol: "V25",   derivSymbol: "R_25",    multiplier: 160, commission: 0.15 },
];

const PHASE_LABELS = {
  PHASE_A: "Phase A — Fresh H1 Cross",
  PHASE_B: "Phase B — Stateful Pullback",
  PHASE_B_NO_PRIOR_A: "Phase B — Window Expired Fallback",
  PHASE_C: "Phase C — HTF Realignment",
  PHASE_D: "Phase D — Shallow Pullback",
};

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
V10 = Test Bot (R_10)
V25 = Tea (R_25)
V50 = OmniSight (R_50)
V75 = Lery's Alerts (R_75)
V75S = Coffee (1HZ75V)
V100 = Milk (R_100)
V100S = Ice Cream (1HZ100V)

💡 You can combine any number of symbols. Separate with spaces.`;

// Helper to safely parse UTC date strings from trades.json ("YYYY-MM-DD HH:MM:SS")
function parseUtcDate(dateStr) {
  if (!dateStr) return null;
  const isoStr = dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T") + "Z";
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? new Date(dateStr) : d;
}

// Resilient Telegram Sender with Markdown Error Fallback
async function sendTelegram(message) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const send = async (text, parseMode) => {
    const body = { chat_id: TG_CHAT, text };
    if (parseMode) body.parse_mode = parseMode;
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
  } catch (err) {
    console.error("Telegram error:", err.message);
  }
}

// Fetch trades.json bypassing Cloudflare CDN cache
async function fetchTradesJson(repoName) {
  const url = `https://raw.githubusercontent.com/${GH_USER}/${repoName}/main/trades.json?t=${Date.now()}`;
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
        if (r.history && r.history.prices) { 
          clearTimeout(timeout); 
          resolve(parseFloat(r.history.prices[r.history.prices.length - 1])); 
          ws.close(); 
        }
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

// ── 1. STATUS HANDLER ──
async function handleStatus() {
  let message = `📊 *BOT STATUS REPORT*\n🕒 ${new Date().toUTCString()}\n\n`;
  for (const repo of REPOS) {
    const trades = await fetchTradesJson(repo.name);
    const open = trades.find(t => t.result === null && !t.pending);
    const closed = trades.filter(t => t.result !== null && t.result !== "CANCELLED");
    const wins = closed.filter(t => t.result === "WIN").length;
    const losses = closed.filter(t => t.result === "LOSS").length;
    
    message += `*${repo.label}*\n`;
    if (open) {
      const openDate = parseUtcDate(open.openTime);
      const nowMins = openDate ? Math.round((Date.now() - openDate.getTime()) / 60000) : 0;
      message += `🟡 OPEN: ${open.direction} @ ${open.entry?.toFixed(4) || "N/A"}\n`;
      
      const currentPrice = await fetchCurrentPrice(repo.derivSymbol);
      if (currentPrice !== null && open.entry) {
        // True Deriv Multiplier P&L calculation ($5 stake)
        const rawPnl = open.direction === "BUY"
          ? (currentPrice - open.entry) / open.entry * 5 * repo.multiplier
          : (open.entry - currentPrice) / open.entry * 5 * repo.multiplier;
        const pnlDollars = parseFloat((rawPnl - repo.commission).toFixed(2));
        const pnlStr = pnlDollars >= 0 ? `+$${pnlDollars.toFixed(2)}` : `-$${Math.abs(pnlDollars).toFixed(2)}`;
        const pnlIcon = pnlDollars >= 0 ? "📈" : "📉";
        message += `${pnlIcon} P&L: ${pnlStr} (@ ${currentPrice.toFixed(4)})\n`;
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

// ── 2. SUMMARY HANDLER (/daily, /weekly, /monthly) ──
async function handleSummary(daysBack, label) {
  let message = `📊 *${label} — ALL BOTS*\n🕒 ${new Date().toUTCString()}\n\n`;
  const cutoff = new Date();
  if (daysBack === 1) {
    // For Daily: Set cutoff to 00:00:00 UTC today
    cutoff.setUTCHours(0, 0, 0, 0);
  } else {
    cutoff.setDate(cutoff.getDate() - daysBack);
  }

  for (const repo of REPOS) {
    const trades = await fetchTradesJson(repo.name);
    const pt = trades.filter(t => {
      if (!t.result || t.result === "CANCELLED" || !t.closeTime) return false;
      const closeDate = parseUtcDate(t.closeTime);
      return closeDate && closeDate >= cutoff;
    });

    if (pt.length === 0) { 
      message += `*${repo.label}*\nNo trades in period.\n\n`; 
      continue; 
    }

    const wins = pt.filter(t => t.result === "WIN").length;
    const losses = pt.filter(t => t.result === "LOSS").length;
    const netR = pt.reduce((s, t) => s + (t.result === "WIN" ? (t.rr || 1.5) : -1), 0);
    const wr = ((wins / pt.length) * 100).toFixed(1);
    const netDollars = parseFloat((netR * 5).toFixed(2));
    const netStr = netDollars >= 0 ? `+$${netDollars.toFixed(2)}` : `-$${Math.abs(netDollars).toFixed(2)}`;

    message += `*${repo.label}*\nTrades: ${pt.length} | W: ${wins} | L: ${losses} | WR: ${wr}% | Net: ${netR.toFixed(1)}R (${netStr})\n\n`;
  }
  await sendTelegram(message);
}

// ── 3. REPORT PARSER & HANDLER ──
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
      const closeDate = parseUtcDate(t.closeTime);
      return closeDate && closeDate >= from && closeDate <= to;
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

// ── 4. PHASE PERFORMANCE HANDLER (/performance, /perf) ──
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
  let cutoff = null;
  let cutoffLabel = "All-Time";
  if (args.length > 0 && /^\d+$/.test(args[0])) {
    const days = parseInt(args[0]);
    cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    cutoffLabel = `Last ${days} Days`;
  }

  const allPhases = ["PHASE_A", "PHASE_B", "PHASE_B_NO_PRIOR_A", "PHASE_C", "PHASE_D", "UNKNOWN"];
  const grandStats = {};
  allPhases.forEach(p => { grandStats[p] = { count: 0, wins: 0, losses: 0, netR: 0 }; });

  let message = `🔬 *Phase Performance Report — ${cutoffLabel}*\n🕒 ${new Date().toUTCString()}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;

  for (const repo of REPOS) {
    const allTrades = await fetchTradesJson(repo.name);
    const closed = allTrades.filter(t => {
      if (!t.result || t.result === "CANCELLED" || !t.closeTime) return false;
      const closeDate = parseUtcDate(t.closeTime);
      return !cutoff || (closeDate && closeDate >= cutoff);
    });
    if (closed.length === 0) continue;

    message += `\n*${repo.label}*\n`;
    let hasAny = false;
    for (const phase of allPhases) {
      const s = phaseStats(closed, phase);
      if (!s) continue;
      hasAny = true;
      const label = phase === "UNKNOWN" 
        ? "🔘 Legacy / Unknown" 
        : `${["🅰️","🅱️","🔄","🆑","🇩",""][allPhases.indexOf(phase)]} ${PHASE_LABELS[phase]}`;
      const netStr = s.net$ >= 0 ? `+$${s.net$.toFixed(2)}` : `-$${Math.abs(s.net$).toFixed(2)}`;
      const icon   = s.wr >= 60 ? "🟢" : s.wr >= 45 ? "🟡" : "🔴";
      message += `${icon} ${label}\n   ${s.count} trades | W:${s.wins} L:${s.losses} | WR:${s.wr}% | Net:${s.netR.toFixed(1)}R (${netStr})\n`;
      
      grandStats[phase].count  += s.count;
      grandStats[phase].wins   += s.wins;
      grandStats[phase].losses += s.losses;
      grandStats[phase].netR   += s.netR;
    }
    if (!hasAny) message += `  No closed trades in period.\n`;
  }

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

// ── 5. POLLING & MAIN LOOP ──
async function getUpdates(offset) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${offset}&timeout=20`);
    const data = await res.json();
    return data.ok ? data.result : [];
  } catch { return []; }
}

async function main() {
  console.log("🤖 Command Center bot started...");
  let offset = 0;
  while (true) {
    try {
      const updates = await getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        const raw = update.message?.text?.trim() || "";
        if (!raw) continue;
        const lower = raw.toLowerCase();
        console.log(`💬 Command received: ${raw}`);

        if (lower === "/status")       await handleStatus();
        else if (lower === "/daily")   await handleSummary(1,  "Daily Summary (Today)");
        else if (lower === "/weekly")  await handleSummary(7,  "Weekly Summary (Last 7 Days)");
        else if (lower === "/monthly") await handleSummary(30, "Monthly Summary (Last 30 Days)");
        else if (lower.startsWith("/report")) {
          const args = raw.slice("/report".length).trim().split(/\s+/).filter(Boolean);
          await handleReport(args);
        } else if (lower.startsWith("/performance") || lower.startsWith("/perf")) {
          const cmd = lower.startsWith("/performance") ? "/performance" : "/perf";
          const args = raw.slice(cmd.length).trim().split(/\s+/).filter(Boolean);
          await handlePerformance(args);
        } else {
          await sendTelegram(`❓ Unknown command: ${raw}\n\nAvailable Commands:\n/status — Live status across all bots\n/daily — Today's closed trades\n/weekly — Last 7 days summary\n/monthly — Last 30 days summary\n/report — Custom date/symbol report\n/performance [days] — Win rates by Phase (A, B, Fallback)`);
        }
      }
    } catch (err) { 
      console.error("Poll error:", err.message); 
      await new Promise(r => setTimeout(r, 5000)); 
    }
  }
}

main();