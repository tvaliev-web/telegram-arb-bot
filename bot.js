import { ethers } from "ethers";
import fs from "fs";

// ===== ENV =====
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const RPC_URL = process.env.RPC_URL;

// ===== SETTINGS =====
const PROFIT_THRESHOLD = 1; // %
const COOLDOWN_MIN = 60;
const START_COOLDOWN_HOURS = 6;

// ===== ADDRESSES =====
const LINK = "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39";
const USDC = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
const PAIR = "0x8bc8e9f621ee8babda8dc0e6fc991aaf9bf8510b";

// ===== FILE STATE =====
const STATE_FILE = "state.json";

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE));
  } catch {
    return { lastStart: 0, lastAlert: 0 };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ===== TELEGRAM =====
async function sendTG(text) {
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHAT_ID,
      text,
      disable_web_page_preview: true
    })
  });
}

// ===== PRICE =====
const ABI = [
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

async function getSushiPrice(provider) {
  const pair = new ethers.Contract(PAIR, ABI, provider);
  const [r0, r1] = await pair.getReserves();
  const t0 = (await pair.token0()).toLowerCase();
  const t1 = (await pair.token1()).toLowerCase();

  let link, usdc;
  if (t0 === LINK) {
    link = r0;
    usdc = r1;
  } else {
    link = r1;
    usdc = r0;
  }

  return Number(ethers.formatUnits(usdc, 6)) / Number(ethers.formatUnits(link, 18));
}

async function getOdosPrice() {
  const res = await fetch("https://api.odos.xyz/sor/quote/v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chainId: 137,
      inputTokens: [{ tokenAddress: LINK, amount: ethers.parseUnits("1", 18).toString() }],
      outputTokens: [{ tokenAddress: USDC, proportion: 1 }],
      userAddr: "0x0000000000000000000000000000000000000000",
      slippageLimitPercent: 0.5,
      disableRFQs: true
    })
  });

  const data = await res.json();
  if (!data?.outAmounts?.[0]) return null;
  return Number(ethers.formatUnits(data.outAmounts[0], 6));
}

// ===== MAIN =====
(async () => {
  const state = loadState();
  const now = Date.now();

  if (now - state.lastStart > START_COOLDOWN_HOURS * 3600000) {
    await sendTG("✅ BOT STARTED");
    state.lastStart = now;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const sushi = await getSushiPrice(provider);
  const odos = await getOdosPrice();
  if (!odos) return;

  const profit = ((odos - sushi) / sushi) * 100;

  if (
    profit >= PROFIT_THRESHOLD &&
    now - state.lastAlert > COOLDOWN_MIN * 60000
  ) {
    await sendTG(
      `🚨 ARBITRAGE ${profit.toFixed(2)}%\n\nSushi: $${sushi.toFixed(4)}\nOdos: $${odos.toFixed(4)}`
    );

    state.lastAlert = now;
  }

  saveState(state);
})();
