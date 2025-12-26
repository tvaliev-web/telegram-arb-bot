const { ethers } = require("ethers");
const TelegramBot = require("node-telegram-bot-api");

// --- Secrets ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const RPC_URL = process.env.RPC_URL;

// --- Telegram ---
const bot = new TelegramBot(BOT_TOKEN, { polling: false });
bot.sendMessage(CHAT_ID, "🚀 Arbitrage bot started");

// --- Polygon provider ---
const provider = new ethers.JsonRpcProvider(RPC_URL);

let lastProfitSent = 0;
const MIN_PROFIT_PERCENT = 1.5;
const FEES_SLIPPAGE = 0.003;

// --- Проверенный контракт LINK/USDC SushiSwap на Polygon ---
const SUSHI_PAIR_ADDRESS = "0x27c9e8a8c49e4e08a9e2f7d8e97d8f0e173a18d3"; 
const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
];

async function getSushiPrice() {
  try {
    const pair = new ethers.Contract(SUSHI_PAIR_ADDRESS, PAIR_ABI, provider);
    const reserves = await pair.getReserves();
    // reserve0 = LINK, reserve1 = USDC
    const reserve0 = Number(reserves[0]);
    const reserve1 = Number(reserves[1]);
    if (reserve0 === 0 || reserve1 === 0) throw new Error("Invalid reserves");
    return reserve1 / reserve0;
  } catch (err) {
    console.error("Sushi price error:", err.message);
    return null;
  }
}

async function checkArb() {
  const sushiPrice = await getSushiPrice();
  if (!sushiPrice) return;

  // Псевдо Odos price: добавим 0.5% спред
  const odosPrice = sushiPrice * 1.005;
  const netProfitPercent = ((odosPrice / sushiPrice - 1) - FEES_SLIPPAGE) * 100;

  if (netProfitPercent >= MIN_PROFIT_PERCENT && netProfitPercent > lastProfitSent) {
    bot.sendMessage(
      CHAT_ID,
      `🚨 Arbitrage opportunity!\nBuy Sushi: ${sushiPrice.toFixed(6)}\nSell Odos: ${odosPrice.toFixed(6)}\nNet profit: ${netProfitPercent.toFixed(2)}%`
    );
    lastProfitSent = netProfitPercent;
  } else if (netProfitPercent < MIN_PROFIT_PERCENT) {
    lastProfitSent = 0;
  }
}

// Проверка каждую минуту
setInterval(checkArb, 60 * 1000);
