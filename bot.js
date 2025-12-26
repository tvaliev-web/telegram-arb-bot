import axios from "axios";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const PROFIT_MIN = 1.5; // %
let lastProfit = 0;

// === helpers ===
async function send(text) {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text
  });
}

// === BUY price (LINK) ===
// CoinGecko – стабильно, без лимитов, без 404
async function getBuyPrice() {
  const r = await axios.get(
    "https://api.coingecko.com/api/v3/simple/price",
    {
      params: {
        ids: "chainlink",
        vs_currencies: "usd"
      }
    }
  );

  return r.data.chainlink.usd;
}

// === SELL price (Odos) ===
async function getSellPrice() {
  const r = await axios.post("https://api.odos.xyz/sor/quote/v2", {
    chainId: 137,
    inputTokens: [
      {
        tokenAddress: "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39", // LINK
        amount: "1000000000000000000" // 1 LINK
      }
    ],
    outputTokens: [
      {
        tokenAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC
        proportion: 1
      }
    ],
    slippageLimitPercent: 0.5,
    userAddr: "0x0000000000000000000000000000000000000000"
  });

  return Number(r.data.outAmounts[0]) / 1e6;
}

// === MAIN ===
async function check() {
  try {
    const buy = await getBuyPrice();
    const sell = await getSellPrice();

    const profit = ((sell - buy) / buy) * 100;

    if (profit >= PROFIT_MIN && profit > lastProfit + 0.1) {
      lastProfit = profit;

      await send(
        `LINK ARB\nBuy: $${buy.toFixed(4)}\nSell: $${sell.toFixed(4)}\nProfit: ${profit.toFixed(2)}%`
      );
    }

    if (profit < PROFIT_MIN) lastProfit = 0;

  } catch (e) {
    console.log("Price check error:", e.message);
  }
}

setInterval(check, 60_000);
send("Bot started");
