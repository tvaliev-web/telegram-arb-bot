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

// --- Real contract addresses on Polygon ---
const SUSHI_PAIR_ADDRESS = "0x2e6f6e6b0d8821fa2b9d11f69b4371a0b31ec15d"; // LINK/USDC SushiSwap pair
const LINK_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

// --- ABI for SushiSwap pair ---
const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
];

async function getSushiPrice() {
  const pair = new ethers.Contract(SUSHI_PAIR_ADDRESS, PAIR_ABI, provider);
  const reserves = await pair.getReserves();
  return Number(reserves[1]) / Number(reserves[0]); // LINK/USDC
}

async function checkArb() {
  try {
    const sushiPrice = await getSushiPrice();

    // Без Odos внешнего API, считаем профит как примерный спред ±0.5%
    const odosPrice = sushiPrice * 1.005; // примерная цена продажи на Odos

    const netProfitPercent = ((odosPrice / sushiPrice - 1) - FEES_SLIPPAGE) * 100;

    if (netProfitPercent >= MIN_PROFIT_PERCENT && netProfitPercent > lastProfitSent) {
      bot.sendMessage(
        CHAT_ID,
        `🚨 Arbitrage opportunity!\nBuy Sushi: ${sushiPrice}\nSell Odos: ${odosPrice.toFixed(6)}\nNet profit: ${netProfitPercent.toFixed(2)}%`
      );
      lastProfitSent = netProfitPercent;
    } else if (netProfitPercent < MIN_PROFIT_PERCENT) {
      lastProfitSent = 0;
    }
  } catch (err) {
    console.error("Price check error:", err.message);
  }
}

// Проверка каждую минуту
setInterval(checkArb, 60 * 1000);
