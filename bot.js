import axios from "axios";

const TG_TOKEN = process.env.TG_TOKEN;       // telegram bot token
const TG_CHAT_ID = process.env.TG_CHAT_ID;   // your chat id

// -------- CONFIG --------
const CHECK_INTERVAL_MS = 15_000; // 15 sec
const MIN_PROFIT = 1.5; // %

let lastProfit = 0;

// -------- TELEGRAM --------
async function sendTG(text) {
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: TG_CHAT_ID,
    text,
    disable_web_page_preview: true,
  });
}

// -------- PRICE SOURCES (NO RPC, NO ONCHAIN, NO 429) --------
// Sushi price via DexScreener
async function getSushiPrice() {
  const res = await axios.get(
    "https://api.dexscreener.com/latest/dex/pairs/polygon/0xc35dadb65012ec5796536bd9864ed8773abc74c4"
  );
  return Number(res.data.pair.priceUsd);
}

// Odos quote (API, NOT contract)
async function getOdosPrice() {
  const res = await axios.get(
    "https://api.odos.xyz/pricing/token/0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39"
  );
  return Number(res.data.priceUsd);
}

// -------- MAIN LOOP --------
async function check() {
  try {
    const buy = await getSushiPrice();
    const sell = await getOdosPrice();

    const profit = ((sell - buy) / buy) * 100;

    console.log(
      `BUY: ${buy.toFixed(4)} | SELL: ${sell.toFixed(4)} | PROFIT: ${profit.toFixed(2)}%`
    );

    if (profit >= MIN_PROFIT && profit > lastProfit) {
      await sendTG(
        `🚨 ARB SIGNAL\n\nBuy (Sushi): $${buy}\nSell (Odos): $${sell}\nProfit: ${profit.toFixed(
          2
        )}%`
      );
      lastProfit = profit;
    }

    if (profit < 0) lastProfit = 0;
  } catch (e) {
    console.error("PRICE CHECK ERROR FULL:");
    console.error(e?.response?.status);
    console.error(e?.response?.data || e.message);
    process.exit(1);
  }
}

(async () => {
  await sendTG("✅ Bot started and running");
  setInterval(check, CHECK_INTERVAL_MS);
})();
