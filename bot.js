import axios from "axios";

await axios.post(
  `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`,
  {
    chat_id: process.env.TG_CHAT_ID,
    text: "BOT STARTED OK"
  }
);

console.log("DONE");
