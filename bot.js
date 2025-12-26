import { ethers } from "ethers";
import axios from "axios";

// Provider
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

// Sushi LINK/USDC pair on Polygon
const pairAddress = "0xc35dadb65012ec5796536bd9864ed8773abc7404";
const pairAbi = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];
const pairContract = new ethers.Contract(pairAddress, pairAbi, provider);

// Telegram
async function sendTG(msg) {
  try {
    await axios.get(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
      params: { chat_id: process.env.TG_CHAT_ID, text: msg }
    });
  } catch(e){ console.log("TG Error:", e.message); }
}

// State
let lastSentPrice = 0;

// Get Sushi price
async function getSushiPrice() {
  const [r0,r1] = await pairContract.getReserves();
  const t0 = await pairContract.token0();
  const price = t0.toLowerCase() === "0x2791bca1f2de4661ed88a30c99a7a9449aa84174"
    ? Number(r0)/Number(r1)
    : Number(r1)/Number(r0);
  return price / 1e6; // USDC decimals
}

// Get Odos price (replace with real API if needed)
async function getOdosPrice() {
  const sushiPrice = await getSushiPrice(); 
  return sushiPrice * 1.02; // placeholder: +2% sell price
}

// Check arbitrage
async function checkArb() {
  try {
    const buy = await getSushiPrice();
    const sell = await getOdosPrice();
    const profit = ((sell-buy)/buy)*100;

    if(profit>=1.5 && buy!==lastSentPrice){
      await sendTG(`Arb: Buy ${buy.toFixed(4)}, Sell ${sell.toFixed(4)}, Profit ${profit.toFixed(2)}%`);
      lastSentPrice = buy;
    }
  } catch(e){ console.log("Price check error:", e.message); }
}

// Run once
checkArb();
