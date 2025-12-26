const { ethers } = require("ethers");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");

// --- GitHub Secrets ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const RPC_URL = process.env.RPC_URL;

// --- Telegram бот ---
const bot = new TelegramBot(BOT_TOKEN, { polling: false });
bot.sendMessage(CHAT_ID, "🚀 Arbitrage bot started");

// --- Polygon provider ---
const provider = new ethers.JsonRpcProvider(RPC_URL);

let lastProfitSent = 0; // Последний процент прибыли, по которому отправляли сигнал

// --- Настройки ---
const MIN_PROFIT_PERCENT = 1.5; // минимум 1.5%
const FEES_SLIPPAGE = 0.003;     // 0.3% комиссии/проскальзывание

async function checkArb() {
  try {
    const sushi = await axios.get("https://api.sushi.com/v1/pair/chainlink_polygon");
    const odos = await axios.get("https://api.odos.xyz/v1/price/chainlink_polygon");

    const sushiPrice = parseFloat(sushi.data.price);
    const odosPrice = parseFloat(odos.data.price);

    const netProfitPercent = ((odosPrice / sushiPrice - 1) - FEES_SLIPPAGE) * 100;

    // Отправляем сообщение только если прибыль ≥ MIN_PROFIT_PERCENT и увеличилась с последнего сигнала
    if (netProfitPercent >= MIN_PROFIT_PERCENT && netProfitPercent > lastProfitSent) {
      bot.sendMessage(
        CHAT_ID,
        `🚨 Arbitrage opportunity!\nBuy Sushi: ${sushiPrice}\nSell Odos: ${odosPrice}\nNet profit: ${netProfitPercent.toFixed(2)}%`
      );
      lastProfitSent = netProfitPercent;
    } else if (netProfitPercent < MIN_PROFIT_PERCENT) {
      lastProfitSent = 0; // сброс, чтобы снова отправить сигнал при следующей возможности
    }

  } catch (err) {
    console.error("Price check error:", err.message);
  }
}

// Проверка каждую минуту
setInterval(checkArb, 60 * 1000);
