import {
  sendUserMessage,
} from "../../OnexBetLineBoombot.js";
import { db } from "../database/db.js";

// Отправка сообщения пользователю по chat_id
async function sendTelegramMessage(chatId, message) {
  try {
    await sendUserMessage(chatId, message);
    return true;
  } catch (error) {
    console.error(`❌ Ошибка отправки Telegram сообщения:`, error);
    return false;
  }
}

// Отправка сообщения пользователю по telegram_username
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

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function callTelegramApi(method, params) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TELEGRAM_BOT_TOKEN) return null;

  const query = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    )
  ).toString();

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}?${query}`);
    const data = await res.json();
    return data.ok ? data.result : null;
  } catch (e) {
    console.warn(`⚠️ Telegram API ${method} failed:`, e.message);
    return null;
  }
}

// Актуальные username / first_name из Telegram (getChat → fallback getChatMember)
async function getTelegramUser(telegramId) {
  if (!telegramId) return null;

  const chat = await callTelegramApi("getChat", { chat_id: telegramId });
  if (chat && (chat.username || chat.first_name)) {
    return {
      id: chat.id,
      username: chat.username || null,
      first_name: chat.first_name || null,
    };
  }

  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TELEGRAM_CHAT_ID) return null;

  const chatId = TELEGRAM_CHAT_ID.split(",")[0].trim();
  const member = await callTelegramApi("getChatMember", {
    chat_id: chatId,
    user_id: telegramId,
  });
  if (member?.user) {
    return {
      id: member.user.id,
      username: member.user.username || null,
      first_name: member.user.first_name || null,
    };
  }

  return null;
}

// Членство в группе + актуальные данные пользователя одним запросом
async function getGroupMembership(telegramId) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !telegramId) {
    return { inGroup: false, user: null };
  }

  const chatId = TELEGRAM_CHAT_ID.split(",")[0].trim();
  const member = await callTelegramApi("getChatMember", {
    chat_id: chatId,
    user_id: telegramId,
  });

  if (!member) {
    // При ошибке API не исключаем пользователя (как раньше)
    return { inGroup: true, user: null };
  }

  const inGroup = ["member", "administrator", "creator", "restricted"].includes(member.status);
  return {
    inGroup,
    user: member.user
      ? {
          id: member.user.id,
          username: member.user.username || null,
          first_name: member.user.first_name || null,
        }
      : null,
  };
}

// Проверяет, является ли пользователь участником группы TELEGRAM_CHAT_ID
async function isUserInGroup(telegramId) {
  const { inGroup } = await getGroupMembership(telegramId);
  return inGroup;
}

// HTML-упоминание с пингом по user_id и актуальным label
function buildUserMention(telegramId, user, fallbackName) {
  const label = user?.username
    ? `@${user.username}`
    : (user?.first_name || fallbackName || String(telegramId));
  return `<a href="tg://user?id=${telegramId}">${escapeHtml(label)}</a>`;
}

export {
  sendTelegramMessage,
  sendTelegramMessageByUsername,
  isUserInGroup,
  getGroupMembership,
  getTelegramUser,
  buildUserMention,
};
