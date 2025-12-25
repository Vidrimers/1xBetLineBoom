#!/usr/bin/env node

import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const threadId = process.env.THREAD_ID;

console.log("🔍 Проверка параметров:");
console.log(`  TELEGRAM_BOT_TOKEN: ${token ? "✅ Задан" : "❌ НЕ ЗАДАН"}`);
console.log(`  TELEGRAM_CHAT_ID: ${chatId} (${chatId ? "✅" : "❌"})`);
console.log(`  THREAD_ID: ${threadId} (${threadId ? "✅" : "❌"})\n`);

if (!token || !chatId) {
  console.log("❌ Отсутствуют обязательные параметры!");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });

console.log("📤 Попытка отправить сообщение в группу...\n");

const message = `🧪 TEST MESSAGE\n\nВремя: ${new Date().toISOString()}\n\nЕсли видишь это - БОТ РАБОТАЕТ! ✅`;

bot
  .sendMessage(chatId, message, {
    message_thread_id: parseInt(threadId),
    parse_mode: "HTML",
  })
  .then(() => {
    console.log("✅ СООБЩЕНИЕ ОТПРАВЛЕНО!");
    console.log(`   В чат: ${chatId}`);
    console.log(`   В тему: ${threadId}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ ОШИБКА ПРИ ОТПРАВКЕ:");
    console.error(`   ${err.message}`);
    if (err.response) {
      console.error(`   Статус: ${err.response.statusCode}`);
      console.error(`   Тело: ${JSON.stringify(err.response.body)}`);
    }
    process.exit(1);
  });
