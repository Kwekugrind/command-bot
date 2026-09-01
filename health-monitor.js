#!/usr/bin/env node
const { execSync } = require("child_process");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");

const hostname = os.hostname();
const SERVER_NAME = hostname.includes("tradingbot") ? "Server 1 (Alert Bots)" : "Server 2 (Command Center)";

function loadEnv(envPath) {
  try {
    fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
      const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    });
  } catch {}
}

const home = process.env.HOME || "/home/ubuntu";
loadEnv(path.join(home, "trading-bots/command-bot/.env"));
loadEnv(path.join(home, "trading-bots/lery-v75/.env"));
loadEnv(path.join(home, "trading-bots/coffee/.env"));
loadEnv(path.join(home, "trading-bots/tea/.env"));

const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT  = process.env.TG_CHAT_ID;
const EXPECTED_STOPPED = ["trade-sync", "pull-trades", "ice-cream-100-1s"];

function sendTelegram(text) {
  return new Promise((resolve) => {
    if (!TG_TOKEN || !TG_CHAT) return resolve();
    const body = JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "Markdown" });
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${TG_TOKEN}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, resolve);
    req.on("error", resolve);
    req.write(body);
    req.end();
  });
}

(async () => {
  let processes;
  try {
    const output = execSync("pm2 jlist", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    processes = JSON.parse(output);
  } catch (e) {
    await sendTelegram(`🔴 *Health Monitor Error — ${SERVER_NAME}*\n\nCould not read PM2 process list.\n\`${e.message}\``);
    return;
  }

  const downed = processes.filter(p =>
    p.pm2_env.status !== "online" && !EXPECTED_STOPPED.includes(p.name)
  );

  if (downed.length === 0) return;

  const names = downed.map(p => p.name);

  await sendTelegram(
    `⚠️ *Bot Down Alert — ${SERVER_NAME}*\n\n` +
    `${names.length} process${names.length > 1 ? "es" : ""} offline:\n` +
    names.map(n => `• \`${n}\``).join("\n") +
    `\n\n🔄 Auto-restarting now...`
  );

  const restarted = [], failed = [];
  for (const name of names) {
    try {
      execSync(`pm2 start ${JSON.stringify(name)}`, { stdio: "pipe" });
      restarted.push(name);
    } catch {
      failed.push(name);
    }
  }

  execSync("pm2 save", { stdio: "pipe" });

  let report = `🤖 *Auto-Restart Report — ${SERVER_NAME}*\n\n`;
  if (restarted.length) report += `✅ Restarted: ${restarted.map(n => `\`${n}\``).join(", ")}\n`;
  if (failed.length) {
    report += `❌ Failed to restart: ${failed.map(n => `\`${n}\``).join(", ")}\n`;
    report += `⚠️ Manual intervention required on ${SERVER_NAME}.`;
  } else {
    report += `\nAll bots are back online. Monitoring continues.`;
  }

  await sendTelegram(report);
})();
