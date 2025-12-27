// bot.js (CommonJS)
// Sends Telegram alerts when Odos vs Sushi profit >= 1%
// Re-sends only if profit grows enough (profit step), using state.json to avoid spam.

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { ethers } = require("ethers");

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TG_TOKEN || process.env.tg_token;
const CHAT_ID = process.env.CHAT_ID || process.env.TG_CHAT_ID || process.env.tg_chat_id;
const RPC_URL = process.env.RPC_URL;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");
if (!CHAT_ID) throw new Error("CHAT_ID missing");
if (!RPC_URL) throw new Error("RPC_URL missing");

// ---- CONFIG (Polygon defaults for LINK/USDC) ----
const CHAIN_ID = Number(process.env.CHAIN_ID || 137);

// Sushi LINK/USDC V2 pair (Polygon) — from your screenshot
const SUSHI_PAIR_ADDRESS =
  (process.env.SUSHI_PAIR_ADDRESS || "0x8bC8e9F621EE8bAbda8DCOE6Fc991aAf9BF8510b").toLowerCase();

// Tokens (Polygon)
const USDC = (process.env.USDC || "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174").toLowerCase();
const LINK = (process.env.LINK || "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39").toLowerCase();

const MIN_PROFIT_PCT = Number(process.env.MIN_PROFIT_PCT || 1.0);       // send if >= 1%
const PROFIT_STEP_PCT = Number(process.env.PROFIT_STEP_PCT || 0.25);    // send again only if profit grew by +0.25%
const COOLDOWN_SEC = Number(process.env.COOLDOWN_SEC || 10 * 60);       // don’t send more often than every 10 minutes
const BIG_JUMP_BYPASS = Number(process.env.BIG_JUMP_BYPASS || 1.0);     // if profit jumps by +1% send even during cooldown

const STATE_PATH = path.join(__dirname, "state.json");
const STATE_KEY = `polygon:${SUSHI_PAIR_ADDRESS}:LINK/USDC`;

const pairAbi = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { pairs: {}, meta: {} };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function tgSend(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: CHAT_ID,
    text,
    disable_web_page_preview: true,
  }, { timeout: 15000 });
}

function fmt(n, d = 4) {
  if (!Number.isFinite(n)) return "n/a";
  return n.toFixed(d);
}

function sushiLink(tokenA, tokenB) {
  return `https://www.sushi.com/swap?chainId=${CHAIN_ID}&token0=${tokenA}&token1=${tokenB}`;
}

function odosLink(tokenIn, tokenOut) {
  // Odos UI link (works fine as a “go swap” link)
  return `https://app.odos.xyz/?chain=${CHAIN_ID}&tokenIn=${tokenIn}&tokenOut=${tokenOut}`;
}

async function getSushiPriceLinkInUsdc(provider) {
  const pair = new ethers.Contract(SUSHI_PAIR_ADDRESS, pairAbi, provider);

  const [r0, r1] = await pair.getReserves();
  const t0 = (await pair.token0()).toLowerCase();
  const t1 = (await pair.token1()).toLowerCase();

  // We want: LINK price in USDC
  // USDC has 6 decimals, LINK has 18
  const r0Num = Number(r0.toString());
  const r1Num = Number(r1.toString());

  if (t0 === USDC && t1 === LINK) {
    const usdc = r0Num / 1e6;
    const link = r1Num / 1e18;
    return usdc / link;
  }

  if (t0 === LINK && t1 === USDC) {
    const link = r0Num / 1e18;
    const usdc = r1Num / 1e6;
    return usdc / link;
  }

  // If you ever change pair address and tokens don’t match:
  throw new Error(`Pair tokens mismatch. token0=${t0}, token1=${t1}`);
}

async function getOdosPriceLinkInUsdc() {
  // Quote 1 LINK -> USDC via Odos (no API key)
  const amountIn = "1000000000000000000"; // 1 LINK (18 decimals)

  const url = "https://api.odos.xyz/sor/quote/v2";
  const body = {
    chainId: CHAIN_ID,
    inputTokens: [{ tokenAddress: LINK, amount: amountIn }],
    outputTokens: [{ tokenAddress: USDC, proportion: 1 }],
    userAddr: "0x0000000000000000000000000000000000000001",
    slippageLimitPercent: 0.3,
    referralCode: 0,
    disableRFQs: true,
    compact: true
  };

  const res = await axios.post(url, body, { timeout: 20000 });
  // Odos returns outAmounts as strings
  const out = res.data?.outAmounts?.[0];
  if (!out) throw new Error("Odos quote missing outAmounts");

  const usdcOut = Number(out) / 1e6; // USDC 6 decimals
  return usdcOut; // price of 1 LINK in USDC
}

function shouldSend(statePair, profitPct) {
  const now = Math.floor(Date.now() / 1000);

  const lastSentAt = statePair?.lastSentAt || 0;
  const lastSentProfit = statePair?.lastSentProfit ?? -999;

  if (profitPct < MIN_PROFIT_PCT) return { ok: false, reason: "below_min" };

  const since = now - lastSentAt;
  const growth = profitPct - lastSentProfit;

  // If profit jumped a lot — allow immediate send
  if (growth >= BIG_JUMP_BYPASS) return { ok: true, reason: "big_jump" };

  // Normal rule: cooldown AND profit step
  if (since < COOLDOWN_SEC) return { ok: false, reason: "cooldown" };
  if (growth < PROFIT_STEP_PCT) return { ok: false, reason: "no_growth" };

  return { ok: true, reason: "growth" };
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const state = readState();
  state.pairs = state.pairs || {};
  state.meta = state.meta || {};
  state.pairs[STATE_KEY] = state.pairs[STATE_KEY] || {};

  // Send “started” ONLY when manual run (workflow_dispatch), not every schedule tick.
  const eventName = process.env.GITHUB_EVENT_NAME || "";
  if (eventName === "workflow_dispatch") {
    await tgSend("✅ BOT STARTED");
  }

  let sushiPrice, odosPrice;

  try {
    sushiPrice = await getSushiPriceLinkInUsdc(provider);
    odosPrice = await getOdosPriceLinkInUsdc();
  } catch (e) {
    // IMPORTANT: no Telegram spam on errors
    console.error("FETCH ERROR:", e?.message || e);
    return; // exit 0
  }

  const profitPct = ((odosPrice - sushiPrice) / sushiPrice) * 100;

  const decision = shouldSend(state.pairs[STATE_KEY], profitPct);
  if (!decision.ok) {
    console.log(`No send: ${decision.reason}. profit=${profitPct}`);
    return; // exit 0
  }

  const msg =
`🔥 ARBITRAGE SIGNAL (LINK/USDC)

Sushi: $${fmt(sushiPrice, 4)}
Odos:  $${fmt(odosPrice, 4)}
Profit: +${fmt(profitPct, 2)}%

Sushi link: ${sushiLink(USDC, LINK)}
Odos link:  ${odosLink(LINK, USDC)}
`;

  try {
    await tgSend(msg);

    // update state ONLY when we successfully sent
    const now = Math.floor(Date.now() / 1000);
    state.pairs[STATE_KEY].lastSentAt = now;
    state.pairs[STATE_KEY].lastSentProfit = profitPct;
    state.pairs[STATE_KEY].lastSushi = sushiPrice;
    state.pairs[STATE_KEY].lastOdos = odosPrice;

    writeState(state);
    console.log("Sent. Reason:", decision.reason);
  } catch (e) {
    console.error("TELEGRAM ERROR:", e?.response?.data || e?.message || e);
    // don’t crash workflow
  }
}

main().catch((e) => {
  console.error("FATAL:", e?.message || e);
  // don’t fail Actions (no red X spam)
  process.exit(0);
});
