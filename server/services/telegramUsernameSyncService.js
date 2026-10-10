import { db } from "../database/db.js";
import { getTelegramUser } from "./telegramService.js";
import { applyTelegramUsername } from "./telegramAccountService.js";
import { notifyAdmin } from "./notificationService.js";

// Смена ника в Telegram — редкое событие; 12 часов достаточно
const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadUsersWithTelegram() {
  return db
    .prepare(
      `SELECT id, username, telegram_id, telegram_username
       FROM users
       WHERE telegram_id IS NOT NULL`
    )
    .all();
}

async function syncTelegramUsernames() {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TELEGRAM_BOT_TOKEN) {
    console.log("🔄 Telegram username sync: TELEGRAM_BOT_TOKEN не задан, пропускаем");
    return;
  }

  const users = loadUsersWithTelegram();
  if (users.length === 0) return;

  console.log(`🔄 Telegram username sync: проверяем ${users.length} пользователей`);

  let updated = 0;
  for (const user of users) {
    const tgUser = await getTelegramUser(user.telegram_id);
    if (!tgUser) continue;

    const result = applyTelegramUsername({
      telegramId: user.telegram_id,
      newUsername: tgUser.username,
      firstName: tgUser.first_name,
      source: "cron-sync",
    });

    if (result?.changed) updated++;
  }

  console.log(`🔄 Telegram username sync: обновлено ${updated}`);
}

/**
 * Ручной прогон из админки: silent-обновление + одна сводка админу.
 * Per-user уведомления глушатся, чтобы не дублировать сводку.
 */
async function syncTelegramUsernamesManual(triggeredBy) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN не задан");
  }

  const users = loadUsersWithTelegram();
  const changes = [];
  let checked = 0;
  let failed = 0;

  for (const user of users) {
    const tgUser = await getTelegramUser(user.telegram_id);
    if (!tgUser) {
      failed++;
      continue;
    }

    checked++;
    const result = applyTelegramUsername({
      telegramId: user.telegram_id,
      newUsername: tgUser.username,
      firstName: tgUser.first_name,
      source: "admin-manual",
      silent: true,
    });

    if (result?.changed) {
      changes.push({
        userId: result.user.id,
        siteUsername: result.user.username,
        oldUsername: result.oldUsername,
        newUsername: result.newUsername,
      });
    }
  }

  const time = new Date().toLocaleString("ru-RU");
  const changesList = changes
    .map(
      (c) =>
        `• ${escapeHtml(c.siteUsername)}: ${c.oldUsername ? `@${escapeHtml(c.oldUsername)}` : "—"} → ${c.newUsername ? `@${escapeHtml(c.newUsername)}` : "—"}`
    )
    .join("\n");

  const message = `🔄 Обновление Telegram-ников

👤 Запустил: ${escapeHtml(triggeredBy || "—")}
✅ Проверено: ${checked}
🔁 Изменено: ${changes.length}
${failed ? `⚠️ Без ответа API: ${failed}\n` : ""}${changes.length ? `\n${changesList}\n` : "\nНик не изменилось.\n"}
🕐 Время: ${time}`;

  await notifyAdmin(message);

  console.log(
    `🔄 Telegram username sync (manual): проверено ${checked}, изменено ${changes.length}, failed ${failed}`
  );

  return { checked, changed: changes.length, failed, changes };
}

function startTelegramUsernameSync() {
  syncTelegramUsernames();
  setInterval(syncTelegramUsernames, SYNC_INTERVAL_MS);
  console.log(
    "🔄 Фоновая синхронизация Telegram username запущена (интервал: 12 часов)"
  );
}

export {
  startTelegramUsernameSync,
  syncTelegramUsernames,
  syncTelegramUsernamesManual,
};
