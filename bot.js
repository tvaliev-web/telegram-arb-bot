import axios from "axios";
import { ethers } from "ethers";

const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const CHAT_ID = (process.env.CHAT_ID || "").trim();
const RPC_URL = (process.env.RPC_URL || "").trim();

const PROFIT_MIN_PCT = 1.5;   // notify only if >= 1.5%
const BUFFER_PCT = 0.30;      // slippage/fees cushion
const USDC_IN = 1000;

// Polygon
const LINK = "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39";
const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

// SushiSwap V2 factory (Polygon)
const SUSHI_FACTORY = "0xc35DADB65012eC5796536bD9864eD8773aBc74C4";
const FACTORY_ABI = ["function getPair(address,address) view returns (address)"];
const PAIR_ABI = [
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

const FEE_NUM = 997n;
const FEE_DEN = 1000n;

function amountOut(amountIn, reserveIn, reserveOut) {
  const amountInWithFee = amountIn * FEE_NUM;
  const num = amountInWithFee * reserveOut;
  const den = reserveIn * FEE_DEN + amountInWithFee;
  return num / den;
}

async function tgSend(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  // retries for Telegram hiccups
  for (let i = 0; i < 3; i++) {
    try {
      const r = await axios.post(
        url,
        { chat_id: CHAT_ID, text, disable_web_page_preview: true },
        { timeout: 15000 }
      );
      if (!r?.data?.ok) throw new Error(`TG bad response: ${JSON.stringify(r.data)}`);
      return;
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
}

async function odosQuoteLinkToUsdc(linkWei) {
  const url = "https://api.odos.xyz/sor/quote/v3";
  const body = {
    chainId: 137,
    inputTokens: [{ tokenAddress: LINK, amount: linkWei.toString() }],
    outputTokens: [{ tokenAddress: USDC, proportion: 1 }],
    slippageLimitPercent: 0.3,
    compact: true,
  };
  const r = await axios.post(url, body, { timeout: 20000 });
  const out = r.data?.outAmounts?.[0];
  if (!out) throw new Error("Odos: no outAmounts in response");
  return BigInt(out);
}

async function main() {
  if (!BOT_TOKEN || !CHAT_ID || !RPC_URL) {
    throw new Error("Missing BOT_TOKEN / CHAT_ID / RPC_URL");
  }

  // ✅ ALWAYS notify start
  await tgSend("BOT STARTED ✅");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const factory = new ethers.Contract(SUSHI_FACTORY, FACTORY_ABI, provider);

  const pairAddr = await factory.getPair(LINK, USDC);
  if (!pairAddr || pairAddr === ethers.ZeroAddress) throw new Error("Sushi pair not found");

  const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
  const [t0, t1, res] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);

  const r0 = BigInt(res[0]);
  const r1 = BigInt(res[1]);

  let reserveUsdc, reserveLink;
  if (t0.toLowerCase() === USDC.toLowerCase() && t1.toLowerCase() === LINK.toLowerCase()) {
    reserveUsdc = r0;
    reserveLink = r1;
  } else if (t1.toLowerCase() === USDC.toLowerCase() && t0.toLowerCase() === LINK.toLowerCase()) {
    reserveUsdc = r1;
    reserveLink = r0;
  } else {
    throw new Error("Pair token mismatch");
  }

  // Sushi buy
  const usdcInWei = ethers.parseUnits(String(USDC_IN), 6);
  const linkOutWei = amountOut(BigInt(usdcInWei), reserveUsdc, reserveLink);
  const linkOut = Number(ethers.formatUnits(linkOutWei, 18));
  const sushiBuy = USDC_IN / linkOut;

  // Odos sell (quote)
  const usdcOutWei = await odosQuoteLinkToUsdc(linkOutWei);
  const usdcOut = Number(ethers.formatUnits(usdcOutWei, 6));
  const odosSell = usdcOut / linkOut;

  let profitPct = ((usdcOut - USDC_IN) / USDC_IN) * 100;
  profitPct -= BUFFER_PCT;

  if (profitPct >= PROFIT_MIN_PCT) {
    const sushiUrl = `https://www.sushi.com/polygon/swap?token0=${USDC}&token1=${LINK}`;
    const odosUrl = `https://app.odos.xyz/`;
    await tgSend(
      `🚨 LINK Arb (Polygon)\n` +
        `USDC in: ${USDC_IN}\n` +
        `Sushi BUY: $${sushiBuy.toFixed(4)}\n` +
        `Odos SELL: $${odosSell.toFixed(4)}\n` +
        `Profit: ${profitPct.toFixed(2)}%\n\n` +
        `Sushi: ${sushiUrl}\nOdos: ${odosUrl}`
    );
  }

  console.log("DONE");
}

main().catch(async (e) => {
  console.error(e?.message || e);
  try {
    if (BOT_TOKEN && CHAT_ID) await tgSend(`❌ ERROR: ${e?.message || e}`);
  } catch {}
  process.exit(1);
});
