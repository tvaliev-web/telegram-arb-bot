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

// --- Адреса контрактов SushiSwap и Odos (пример) ---
const SUSHI_PAIR_ADDRESS = "0x..."; // замените на реальный адрес пары LINK/USDC на Polygon
const ODOS_ROUTER_ADDRESS = "0x..."; // замените на реальный адрес Odos Router

// --- ABIs для вызова getReserves или price ---
const SUSHI_PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
];
const ODOS_ROUTER_ABI = [
  "function getOutputAmount(uint256 amountIn, address tokenIn, address tokenOut) view returns (uint256)"
];

let lastProfitSent = 0;
const MIN_PROFIT_PERCENT = 1.5;
const FEES_SLIPPAGE = 0.003;

async function getSushiPrice() {
  const pair = new ethers.Contract(SUSHI_PAIR_ADDRESS, SUSHI_PAIR_ABI, provider);
  const reserves = await pair.getReserves();
  return Number(reserves[1]) / Number(reserves[0]); // пример расчета цены LINK/USDC
}

async function getOdosPrice() {
  const router = new ethers.Contract(ODOS_ROUTER_ADDRESS, ODOS_ROUTER_ABI, provider);
  const amountOut = await router.getOutputAmount(ethers.parseUnits("1", 18), "0xLINK", "0xUSDC");
  return Number(amountOut) / 1e6; // USDC 6 decimals
}

async function checkArb() {
  try {
    const sushiPrice = await getSushiPrice();
    const odosPrice = await getOdosPrice();

    const netProfitPercent = ((odosPrice / sushiPrice - 1) - FEES_SLIPPAGE) * 100;

    if (netProfitPercent >= MIN_PROFIT_PERCENT && netProfitPercent > lastProfitSent) {
      bot.sendMessage(
        CHAT_ID,
        `🚨 Arbitrage opportunity!\nBuy Sushi: ${sushiPrice}\nSell Odos: ${odosPrice}\nNet profit: ${netProfitPercent.toFixed(2)}%`
      );
      lastProfitSent = netProfitPercent;
    } else if (netProfitPercent < MIN_PROFIT_PERCENT) {
      lastProfitSent = 0;
    }

  } catch (err) {
    console.error("Price check error:", err.message);
  }
}

setInterval(checkArb, 60 * 1000);
