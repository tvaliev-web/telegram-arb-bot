import fs from "node:fs";
import { ethers } from "ethers";

const ABI_V2_PAIR = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const RPC_URL = process.env.RPC_URL;

if (!BOT_TOKEN || !CHAT_ID || !RPC_URL) {
  console.log("Missing env. Need BOT_TOKEN, CHAT_ID, RPC_URL");
  process.exit(0); // не валим workflow
}

// Polygon
const CHAIN_ID = 137;

// LINK / USDC addresses (Polygon)
const LINK = "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39";
const USDC = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";

// Sushi V2 LINK/USDC pair on Polygon (если у тебя другой — задай SUSHI_PAIR secret)
const DEFAULT_SUSHI_PAIR = "0x8bC8e9F621EE8bAbda8DCOE6Fc991aAf9BF8510b".replace("O","0"); // на всякий случай
const SUSHI_PAIR = (process.env.SUSHI_PAIR || DEFAULT_SUSHI_PAIR).trim();

// Настройки антиспама
const PROFIT_THRESHOLD = 1.0;          // 1%
const MIN_SIGNAL_INTERVAL_MS = 30 * 60 * 1000; // 30 минут между сигналами
const START_PING_INTERVAL_MS = 6 * 60 * 60 * 1000; // BOT STARTED раз в 6 часов

const STATE_PATH = "./state.json";

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { lastStartSentAt: 0, lastSignalSentAt: 0, lastSignalKey: "" };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function tgSend(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      disable_web_page_preview: true
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    console.log("Telegram send failed:", res.status, data);
  }
}

function fmt(n, d = 4) {
  if (!Number.isFinite(n)) return "NaN";
  return n.toFixed(d);
}

async function getSushiPriceUSDCPerLINK(provider) {
  const pair = new ethers.Contract(SUSHI_PAIR, ABI_V2_PAIR, provider);
  const [t0, t1, reserves] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);
  const token0 = t0.toLowerCase();
  const token1 = t1.toLowerCase();
  const r0 = reserves[0];
  const r1 = reserves[1];

  // price = USDC per 1 LINK
  // depending on token order
  if (token0 === USDC.toLowerCase() && token1 === LINK.toLowerCase()) {
    const usdc = Number(ethers.formatUnits(r0, 6));
    const link = Number(ethers.formatUnits(r1, 18));
    return usdc / link;
  }
  if (token0 === LINK.toLowerCase() && token1 === USDC.toLowerCase()) {
    const link = Number(ethers.formatUnits(r0, 18));
    const usdc = Number(ethers.formatUnits(r1, 6));
    return usdc / link;
  }

  throw new Error(`Pair token mismatch. token0=${token0}, token1=${token1}`);
}

async function getOdosPriceUSDCPerLINK() {
  // Пытаемся получить quote 1 LINK -> USDC через Odos API.
  // Если у тебя есть ODOS_API_KEY — добавь secret, иначе пробуем без.
  const ODOS_API_KEY = (process.env.ODOS_API_KEY || "").trim();

  const url = "https://api.odos.xyz/sor/quote/v2";
  const body = {
    chainId: CHAIN_ID,
    inputTokens: [{ tokenAddress: LINK, amount: ethers.parseUnits("1", 18).toString() }],
    outputTokens: [{ tokenAddress: USDC, proportion: 1 }],
    slippageLimitPercent: 0.3,
    userAddr: "0x0000000000000000000000000000000000000000"
  };

  const headers = { "content-type": "application/json" };
  if (ODOS_API_KEY) headers["x-api-key"] = ODOS_API_KEY;

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Odos quote failed ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }

  // В Odos ответах обычно есть outputTokens с amount (строкой)
  const out = data?.outAmounts?.[0] ?? data?.outputTokens?.[0]?.amount ?? data?.outputTokens?.[0]?.amountOut;
  if (!out) throw new Error(`Odos response missing out amount: ${JSON.stringify(data).slice(0, 200)}`);

  const usdcOut = Number(ethers.formatUnits(out.toString(), 6));
  return usdcOut; // per 1 LINK
}

function buildLinks() {
  const sushiLink = `https://www.sushi.com/swap?chainId=${CHAIN_ID}&token0=${USDC}&token1=${LINK}`;
  const odosLink = `https://app.odos.xyz/swap?chainId=${CHAIN_ID}&inputCurrency=${LINK}&outputCurrency=${USDC}`;
  return { sushiLink, odosLink };
}

async function main() {
  const state = loadState();
  const now = Date.now();

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // BOT STARTED — редко
  if (now - (state.lastStartSentAt || 0) > START_PING_INTERVAL_MS) {
    await tgSend("BOT STARTED ✅");
    state.lastStartSentAt = now;
    saveState(state);
  }

  // Цены
  let sushiPrice, odosPrice;
  try {
    [sushiPrice, odosPrice] = await Promise.all([
      getSushiPriceUSDCPerLINK(provider),
      getOdosPriceUSDCPerLINK()
    ]);
  } catch (e) {
    // НЕ шлём ошибки в телегу (чтобы не было спама)
    console.log("Price fetch error:", e?.message || e);
    return;
  }

  const { sushiLink, odosLink } = buildLinks();

  // Где дороже LINK в USDC — там выгоднее продавать LINK.
  // Если Odos > Sushi: BUY on Sushi, SELL on Odos.
  // Если Sushi > Odos: BUY on Odos, SELL on Sushi.
  let direction, buyOn, sellOn, buyPrice, sellPrice, profitPct;

  if (odosPrice > sushiPrice) {
    direction = "BUY Sushi → SELL Odos";
    buyOn = "Sushi";
    sellOn = "Odos";
    buyPrice = sushiPrice;
    sellPrice = odosPrice;
    profitPct = (sellPrice / buyPrice - 1) * 100;
  } else {
    direction = "BUY Odos → SELL Sushi";
    buyOn = "Odos";
    sellOn = "Sushi";
    buyPrice = odosPrice;
    sellPrice = sushiPrice;
    profitPct = (sellPrice / buyPrice - 1) * 100;
  }

  if (profitPct < PROFIT_THRESHOLD) return;

  // антиспам сигналов
  const signalKey = `${direction}|${Math.round(profitPct * 100)}`; // грубо фиксируем
  const tooSoon = now - (state.lastSignalSentAt || 0) < MIN_SIGNAL_INTERVAL_MS;
  const sameAsLast = state.lastSignalKey === signalKey;
  if (tooSoon && sameAsLast) return;

  const msg =
`🚨 ARBITRAGE (${fmt(profitPct, 2)}%)
${direction}

Sushi: $${fmt(sushiPrice, 4)}
Odos:  $${fmt(odosPrice, 4)}

Sushi link: ${sushiLink}
Odos link:  ${odosLink}`;

  await tgSend(msg);

  state.lastSignalSentAt = now;
  state.lastSignalKey = signalKey;
  saveState(state);
}

await main();
