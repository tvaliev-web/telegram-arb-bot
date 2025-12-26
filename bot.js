import axios from "axios";

const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

async function sendMessage(text) {
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;

  const res = await axios.post(url, {
    chat_id: TG_CHAT_ID,
    text: text
  });

  console.log("Telegram OK:", res.data);
}

(async () => {
  await sendMessage("✅ BOT STARTED SUCCESSFULLY");
})();
