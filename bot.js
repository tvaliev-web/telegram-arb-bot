import fs from "fs";
import axios from "axios";
import { ethers } from "ethers";

// ===== Polygon addresses =====
const LINK = "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39";
const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const SUSHI_PAIR = "0x8bC8e9F621EE8bAbda8DC0E6Fc991aAf9BF8510b";

const sushiSwapUrl = `https://www.sushi.com/swap?chainId=137&token0=${LINK}&token1=${USDC}`;
const odosSwapUrl  = `https://app.odos.xyz/?chain=polygon&from=${LINK}&to=${USDC}`;

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const RPC_URL = process.env.RPC_URL;

const PROFIT_THRESHOLD = Number(process.env.PROFIT_THRESHOLD ?? "1.0"); // 1%
const COOLDOWN_MINUTES = Number(process.env.COOLDOWN_MINUTES ?? "60");
const MIN_CHANGE_PCT = Number(process.env.MIN_CHANGE_PCT ?? "0.25");
const EVENT_NAME = process.env.EVENT_NAME; // workflow_dispatch / schedule

if (!BOT_TOKEN || !CHAT_ID || !RPC_URL) process.exit(1);

// ===== Telegram (не шлём ошибки в телегу) =====
async function tgSend(text) {
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text,
      disable_web_page_preview: true
    }, { timeout: 15000 });
  } catch (e) {
    console.log("Telegram send failed:", e?.response?.data ?? e.message);
  }
}

// ===== state.json =====
function loadState() {
  try {
    return JSON.parse(fs.readFileSync("state.json", "utf8"));
  } catch {
    return { lastAlertTs: 0, lastProfit: -999 };
  }
}
function saveState(st) {
  fs.writeFileSync("state.json", JSON.stringify(st, null, 2));
}

// ===== Sushi V2 =====
const PAIR_ABI = [
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];
const ERC20_ABI = ["function decimals() view returns (uint8)"];

async function getSushiPrice(provider) {
  const pair = new ethers.Contract(SUSHI_PAIR, PAIR_ABI, provider);
  const [r0, r1] = await pair.getReserves();
  const t0 = (await pair.token0()).toLowerCase();
  const t1 = (await pair.token1()).toLowerCase();

  const link = LINK.toLowerCase();
  const usdc = USDC.toLowerCase();
  if (!([t0, t1].includes(link) && [t0, t1].includes(usdc))) return null;

  const dec0 = await new ethers.Contract(t0, ERC20_ABI, provider).decimals();
  const dec1 = await new ethers.Contract(t1, ERC20_ABI, provider).decimals();

  const reserve0 = Number(ethers.formatUnits(r0, dec0));
  const reserve1 = Number(ethers.formatUnits(r1, dec1));

  let price;
  if (t0 === link && t1 === usdc) price = reserve1 / reserve0;
  else price = reserve0 / reserve1;

  return price; // USDC per 1 LINK
}

// ===== Odos quote (если 500 — молча пропуск) =====
async function getOdosPrice() {
  const url = "https://api.odos.xyz/sor/quote/v2";
  const body = {
    chainId: 137,
    inputTokens: [{ tokenAddress: LINK, amount: ethers.parseUnits("1", 18).toString() }],
    outputTokens: [{ tokenAddress: USDC, proportion: 1 }],
    userAddr: "0x0000000000000000000000000000000000000001",
    slippageLimitPercent: 0.3,
    disableRFQs: true
  };

  for (let i = 0; i < 3; i++) {
    try {
      const res = await axios.post(url, body, { timeout: 15000 });
      const out = res.data?.outAmounts?.[0];
      if (!out) return null;
      return Number(ethers.formatUnits(out, 6));
    } catch (e) {
      console.log("Odos failed:", e?.response?.status ?? e.message);
      await new Promise(r => setTimeout(r, 1200 * (i + 1)));
    }
  }
  return null;
}

(async () => {
  const st = loadState();
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // ✅ старт-сообщение ТОЛЬКО если ты сам нажал Run workflow
  if (EVENT_NAME === "workflow_dispatch") {
    await tgSend("BOT STARTED ✅");
  }

  const sushi = await getSushiPrice(provider);
  if (!sushi) return;

  const odos = await getOdosPrice();
  if (!odos) return;

  const diffPct = ((odos - sushi) / sushi) * 100;
  const profit = Math.abs(diffPct);

  const now = Date.now();
  const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;

  const cooldownPassed = (now - (st.lastAlertTs ?? 0)) >= cooldownMs;
  const changedEnough = Math.abs(profit - (st.lastProfit ?? -999)) >= MIN_CHANGE_PCT;

  if (profit >= PROFIT_THRESHOLD && cooldownPassed && changedEnough) {
    const dir = diffPct > 0 ? "Buy on Sushi → Sell on Odos" : "Buy on Odos → Sell on Sushi";

    const msg =
`🚨 ARBITRAGE
Profit: ${profit.toFixed(2)}%
Sushi: $${sushi.toFixed(4)}
Odos:  $${odos.toFixed(4)}
Dir: ${dir}

Sushi: ${sushiSwapUrl}
Odos:  ${odosSwapUrl}`;

    await tgSend(msg);

    // ✅ state.json обновляем ТОЛЬКО когда реально был сигнал
    st.lastAlertTs = now;
    st.lastProfit = profit;
    saveState(st);
  }
})();
