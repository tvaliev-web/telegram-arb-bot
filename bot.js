import axios from "axios";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const LINK = "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39";
const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

const PROFIT_THRESHOLD = 1.5;
let lastProfit = 0;

async function send(msg) {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: msg
  });
}

async function getSushiPrice() {
  const r = await axios.get(
    `https://api.sushi.com/price/v1/chain/137/token/${LINK}`
  );
  return r.data.price;
}

async function getOdosQuote() {
  const r = await axios.post("https://api.odos.xyz/sor/quote/v2", {
    chainId: 137,
    inputTokens: [{ tokenAddress: LINK, amount: "1000000000000000000" }],
    outputTokens: [{ tokenAddress: USDC, proportion: 1 }],
    userAddr: "0x0000000000000000000000000000000000000000",
    slippageLimitPercent: 0.5
  });

  return Number(r.data.outAmounts[0]) / 1e6;
}

async function check() {
  try {
    const buy = await getSushiPrice();
    const sell = await getOdosQuote();

    const profit = ((sell - buy) / buy) * 100;

    if (profit >= PROFIT_THRESHOLD && profit > lastProfit + 0.1) {
      lastProfit = profit;
      await send(
        `LINK ARB\nBuy (Sushi): $${buy.toFixed(4)}\nSell (Odos): $${sell.toFixed(4)}\nProfit: ${profit.toFixed(2)}%`
      );
    }

    if (profit < PROFIT_THRESHOLD) {
      lastProfit = 0;
    }

  } catch (e) {
    console.log("Price check error:", e.message);
  }
}

setInterval(check, 60_000);
send("Bot started");
