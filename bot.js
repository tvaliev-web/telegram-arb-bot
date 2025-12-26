import { Token, Fetcher, Route, ChainId } from '@sushiswap/sdk';
import { ethers } from 'ethers';
import axios from 'axios';
import TelegramBot from 'node-telegram-bot-api';

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const RPC_URL = process.env.RPC_URL;

const bot = new TelegramBot(BOT_TOKEN, { polling: false });
bot.sendMessage(CHAT_ID, '🚀 Arbitrage bot started');

const provider = new ethers.JsonRpcProvider(RPC_URL);

let lastProfitSent = 0;
const MIN_PROFIT_PERCENT = 1.5;
const FEES_SLIPPAGE = 0.003;

// SushiSwap LINK/USDC on Polygon
const LINK = new Token(ChainId.POLYGON, '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 18);
const USDC = new Token(ChainId.POLYGON, '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 6);

async function getSushiPrice() {
  const pair = await Fetcher.fetchPairData(LINK, USDC, provider);
  const route = new Route([pair], USDC);
  return parseFloat(route.midPrice.toSignificant(6));
}

async function getOdosPrice() {
  const res = await axios.get(
    'https://api.odos.xyz/v1/price?from=LINK&to=USDC&amount=1&chain=polygon'
  );
  return parseFloat(res.data.amountOut);
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
    console.error('Price check error:', err.message);
  }
}

// Проверка каждую минуту
setInterval(checkArb, 60 * 1000);
