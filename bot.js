import axios from "axios";
import { ethers } from "ethers";

const TG_TOKEN = (process.env.TG_TOKEN || "").trim();
const TG_CHAT_ID = (process.env.TG_CHAT_ID || "").trim();
const RPC_URL = (process.env.RPC_URL || "").trim();

async function tgSend(text) {
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  const res = await axios.post(url, { chat_id: TG_CHAT_ID, text });
  if (!res?.data?.ok) throw new Error(`Telegram: ${JSON.stringify(res.data)}`);
}

const PAIR = "0xc35dadb65012ec5796536bd9864ed8773abc7404"; // Sushi LINK/USDC on Polygon
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

  let usdcRaw, linkRaw;
  if (t0 === USDC) { usdcRaw = r0; linkRaw = r1; }
  else if (t1 === USDC) { usdcRaw = r1; linkRaw = r0; }
  else throw new Error("Not USDC/LINK pair");

  const usdc = Number(usdcRaw) / 1e6;
  const link = Number(linkRaw) / 1e18;
  if (usdc === 0 || link === 0) throw new Error("Zero reserves");

  return usdc / link;
}

(async () => {
  try {
    if (!TG_TOKEN) throw new Error("TG_TOKEN missing");
    if (!TG_CHAT_ID) throw new Error("TG_CHAT_ID missing");
    if (!RPC_URL) throw new Error("RPC_URL missing");

    await tgSend("BOT STARTED ✅");

    const price = await getSushiLinkUsd();
    await tgSend(`Sushi LINK (Polygon): $${price.toFixed(4)}`);

    console.log("OK");
  } catch (e) {
    console.error(e?.message || e);
    process.exit(1);
  }
})();
