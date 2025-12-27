import axios from "axios";
import crypto from "crypto";
import { ethers } from "ethers";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const RPC_URL = process.env.RPC_URL;
const ODOS_API_KEY = process.env.ODOS_API_KEY || "";

const THRESHOLD_PCT = Number(process.env.THRESHOLD_PCT || "1.0");     // алерт если profit >=
const MIN_ALERT_GAP_MIN = Number(process.env.MIN_ALERT_GAP_MIN || "30"); // минимум минут между одинаковыми алертами
const RUN_MODE = process.env.RUN_MODE || "cron"; // cron | manual

// Polygon
const CHAIN_ID = 137;

// Tokens on Polygon
const LINK = "0x53E0bca35eC356bDdDdfebbd1Fc0Fd03FaBad39";
const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

// SushiSwap V2 (cpAMM) factory (Polygon)
const SUSHI_V2_FACTORY = "0xC35DADB65012eC5796536bD9864eD8773aBc74C4";

const ERC20_ABI = ["function decimals() view returns (uint8)"];
const FACTORY_ABI = ["function getPair(address tokenA, address tokenB) view returns (address)"];
const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)"
];

function mustEnv() {
  const miss = [];
  if (!BOT_TOKEN) miss.push("BOT_TOKEN");
  if (!CHAT_ID) miss.push("CHAT_ID");
  if (!RPC_URL) miss.push("RPC_URL");
  if (miss.length) throw new Error(`Missing env: ${miss.join(", ")}`);
}

async function tgSend(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  // мягкие ретраи, чтобы не ловить временные 500
  for (let i = 0; i < 3; i++) {
    try {
      await axios.post(url, {
        chat_id: CHAT_ID,
        text,
        disable_web_page_preview: true
      }, { timeout: 15000 });
      return;
    } catch (e) {
      const status = e?.response?.status;
      if (i === 2) throw new Error(`Telegram send failed: ${status || ""} ${e.message}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function fmt(n, d = 4) {
  if (!Number.isFinite(n)) return "NaN";
  return n.toFixed(d);
}

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync("state.json", "utf8"));
  } catch {
    return { lastAlertAt: 0, lastAlertTextHash: "" };
  }
}

function saveState(st) {
  fs.writeFileSync("state.json", JSON.stringify(st, null, 2));
}

function links() {
  return {
    sushi: `https://www.sushi.com/swap?chainId=${CHAIN_ID}&token0=${LINK}&token1=${USDC}`,
    odos: `https://app.odos.xyz/swap?chain=polygon&inputCurrency=${LINK}&outputCurrency=${USDC}`
  };
}

async function getSushiPrice(provider) {
  const factory = new ethers.Contract(SUSHI_V2_FACTORY, FACTORY_ABI, provider);
  const pairAddr = await factory.getPair(LINK, USDC);
  if (pairAddr === ethers.ZeroAddress) throw new Error("Sushi pair LINK/USDC not found");

  const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
  const [t0, t1] = await Promise.all([pair.token0(), pair.token1()]);
  const [d0, d1] = await Promise.all([
    new ethers.Contract(t0, ERC20_ABI, provider).decimals(),
    new ethers.Contract(t1, ERC20_ABI, provider).decimals()
  ]);

  const { reserve0, reserve1 } = await pair.getReserves();

  const t0L = t0.toLowerCase();
  const t1L = t1.toLowerCase();
  const linkL = LINK.toLowerCase();
  const usdcL = USDC.toLowerCase();

  let rLINK, rUSDC, dLINK, dUSDC;

  if (t0L === linkL && t1L === usdcL) {
    rLINK = reserve0; dLINK = d0;
    rUSDC = reserve1; dUSDC = d1;
  } else if (t0L === usdcL && t1L === linkL) {
    rUSDC = reserve0; dUSDC = d0;
    rLINK = reserve1; dLINK = d1;
  } else {
    throw new Error(`Pair token mismatch. token0=${t0} token1=${t1}`);
  }

  const link = Number(ethers.formatUnits(rLINK, dLINK));
  const usdc = Number(ethers.formatUnits(rUSDC, dUSDC));
  const price = usdc / link;

  return price;
}

async function getOdosPrice() {
  // 1 LINK -> USDC quote
  const amountIn = ethers.parseUnits("1", 18).toString();

  const body = {
    chainId: CHAIN_ID,
    inputTokens: [{ tokenAddress: LINK, amount: amountIn }],
    outputTokens: [{ tokenAddress: USDC, proportion: 1 }],
    userAddr: ethers.ZeroAddress,
    slippageLimitPercent: 0.3
  };

  const headers = ODOS_API_KEY ? { "x-api-key": ODOS_API_KEY } : undefined;

  // Odos иногда отваливается => ретраи
  for (let i = 0; i < 3; i++) {
    try {
      const r = await axios.post("https://api.odos.xyz/sor/quote/v3", body, { headers, timeout: 20000 });
      const out = r.data?.outAmounts?.[0] ?? r.data?.outputTokens?.[0]?.amount;
      if (!out) throw new Error("Odos: no out amount in response");
      const usdcOut = Number(ethers.formatUnits(BigInt(out), 6));
      return usdcOut;
    } catch (e) {
      if (i === 2) throw new Error(`Odos failed: ${e?.response?.status || ""} ${e.message}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function main() {
  mustEnv();

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // старт-уведомление — ТОЛЬКО на manual запуск
  if (RUN_MODE === "manual") {
    await tgSend("BOT STARTED ✅");
  }

  const [sushi, odos] = await Promise.all([
    getSushiPrice(provider),
    getOdosPrice()
  ]);

  const profitPct = ((odos - sushi) / sushi) * 100;

  // формируем нормальный алерт-текст
  const L = links();
  const alertText =
`🚨 ARBITRAGE
Profit: ${fmt(profitPct, 2)}%

Sushi: $${fmt(sushi, 4)}
Odos:  $${fmt(odos, 4)}

Sushi: ${L.sushi}
Odos:  ${L.odos}`;

  // анти-спам: одинаковый алерт не чаще чем раз в MIN_ALERT_GAP_MIN
  const st = loadState();
  const now = Date.now();
  const gapOk = (now - (st.lastAlertAt || 0)) >= MIN_ALERT_GAP_MIN * 60 * 1000;
  const hash = sha1(alertText);
  const isNew = hash !== (st.lastAlertTextHash || "");

  if (profitPct >= THRESHOLD_PCT && (gapOk || isNew)) {
    await tgSend(alertText);
    st.lastAlertAt = now;
    st.lastAlertTextHash = hash;
    saveState(st);
  }
}

main().catch((e) => {
  // ошибки НЕ летят в телегу, только в логи Actions
  console.error("BOT ERROR:", e?.message || e);
  process.exit(1);
});
