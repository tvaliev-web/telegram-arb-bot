import axios from "axios";
import { ethers } from "ethers";

const TG_TOKEN = (process.env.TG_TOKEN || "").trim();
const TG_CHAT_ID = (process.env.TG_CHAT_ID || "").trim();
const RPC_URL = (process.env.RPC_URL || "").trim();

function must(v, name) {
  if (!v) throw new Error(`${name} is missing`);
  return v;
}

async function tgSend(text) {
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  const res = await axios.post(url, { chat_id: TG_CHAT_ID, text });
  if (!res?.data?.ok) throw new Error(`Telegram error: ${JSON.stringify(res.data)}`);
  return res.data;
}

// Sushi LINK/USDC pair on Polygon
const PAIR = "0xc35dadb65012ec5796536bd9864ed8773abc7404";
const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174".toLowerCase();
const ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

async function getSushiLinkUsd() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const pair = new ethers.Contract(PAIR, ABI, provider);

  const [r0, r1] = await pair.getReserves();
  const t0 = (await pair.token0()).toLowerCase();
  const t1 = (await pair.token1()).toLowerCase();

  // reserves are raw integers; convert to float carefully:
  // USDC has 6 decimals, LINK has 18 decimals.
  // price = USDC per 1 LINK
  let usdcRaw, linkRaw;
  if (t0 === USDC) {
    usdcRaw = r0;
    linkRaw = r1;
  } else if (t1 === USDC) {
    usdcRaw = r1;
    linkRaw = r0;
  } else {
    throw new Error("Pair is not USDC/LINK");
  }

  const usdc = Number(usdcRaw) / 1e6;
  const link = Number(linkRaw) / 1e18;
  if (!usdc || !link) throw new Error("Zero reserves");
  return usdc / link;
}

(async () => {
  try {
    must(TG_TOKEN, "TG_TOKEN");
    must(TG_CHAT_ID, "TG_CHAT_ID");
    must(RPC_URL, "RPC_URL");

    await tgSend("BOT STARTED ✅");

    const price = await getSushiLinkUsd();
    await tgSend(`Sushi LINK price (Polygon): $${price.toFixed(4)}`);

    console.log("OK");
  } catch (e) {
    console.error(e?.message || e);
    process.exit(1);
  }
})();
