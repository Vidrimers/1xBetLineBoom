import {
  sendUserMessage,
} from "../../OnexBetLineBoombot.js";
import { db } from "../database/db.js";

// Отправить сообщение пользователю по chat_id
async function sendTelegramMessage(chatId, message) {
  try {
    await sendUserMessage(chatId, message);
    return true;
  } catch (error) {
    console.error(`❌ Ошибка отправки Telegram сообщения:`, error);
    return false;
  }
}

// Отправить сообщение пользователю по telegram_username
async function sendTelegramMessageByUsername(telegram_username, message) {
  const cleanUsername = telegram_username.toLowerCase();
  const telegramUser = db
    .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
    .get(cleanUsername);

  if (!telegramUser || !telegramUser.chat_id) {
    throw new Error(`Пользователь @${telegram_username} не найден в Telegram или не писал боту`);
  }

  await sendUserMessage(telegramUser.chat_id, message);
}

// Проверяет, является ли пользователь участником группы TELEGRAM_CHAT_ID
async function isUserInGroup(telegramId) {
  try {
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !telegramId) return false;

    const chatId = TELEGRAM_CHAT_ID.split(',')[0].trim(); // берём первый chat_id
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${chatId}&user_id=${telegramId}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.ok) return false;
    const status = data.result?.status;
    return ['member', 'administrator', 'creator', 'restricted'].includes(status);
  } catch (e) {
    console.warn(`⚠️ Не удалось проверить членство в группе для ${telegramId}:`, e.message);
    return true; // при ошибке не исключаем пользователя
  }
}

export { sendTelegramMessage, sendTelegramMessageByUsername, isUserInGroup };
