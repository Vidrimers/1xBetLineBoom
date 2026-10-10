import { db } from "../database/db.js";
import { getTelegramUser } from "./telegramService.js";

// Смена ника в Telegram — редкое событие; 12 часов достаточно
const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

function normalizeUsername(username) {
  return username ? username.replace("@", "").toLowerCase() : null;
}

function applyUsernameUpdate(userId, telegramId, newUsername, firstName) {
  const clean = normalizeUsername(newUsername);

  db.prepare("UPDATE users SET telegram_username = ? WHERE id = ?").run(clean, userId);

  if (!clean) {
    db.prepare("DELETE FROM telegram_users WHERE chat_id = ?").run(telegramId);
    return;
  }

  // telegram_users уникален по username: актуальная строка + убираем устаревшие для этого chat_id
  db.prepare(
    `INSERT INTO telegram_users (telegram_username, chat_id, first_name)
     VALUES (?, ?, ?)
     ON CONFLICT(telegram_username) DO UPDATE SET
       chat_id = excluded.chat_id,
       first_name = excluded.first_name`
  ).run(clean, telegramId, firstName || null);

  db.prepare(
    "DELETE FROM telegram_users WHERE chat_id = ? AND LOWER(telegram_username) != ?"
  ).run(telegramId, clean);
}

async function syncTelegramUsernames() {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TELEGRAM_BOT_TOKEN) {
    console.log("🔄 Telegram username sync: TELEGRAM_BOT_TOKEN не задан, пропускаем");
    return;
  }

  const users = db
    .prepare(
      `SELECT id, telegram_id, telegram_username
       FROM users
       WHERE telegram_id IS NOT NULL`
    )
    .all();

  if (users.length === 0) return;

  console.log(`🔄 Telegram username sync: проверяем ${users.length} пользователей`);

  let updated = 0;
  for (const user of users) {
    const tgUser = await getTelegramUser(user.telegram_id);
    if (!tgUser) continue;

    // username из Telegram актуален даже если стал null (юзер убрал @ник)
    const fresh = normalizeUsername(tgUser.username);
    const current = normalizeUsername(user.telegram_username);

    const staleTgRow = fresh
      ? db
          .prepare(
            "SELECT 1 FROM telegram_users WHERE chat_id = ? AND LOWER(telegram_username) != ? LIMIT 1"
          )
          .get(user.telegram_id, fresh)
      : db
          .prepare("SELECT 1 FROM telegram_users WHERE chat_id = ? LIMIT 1")
          .get(user.telegram_id);

    if (fresh === current && !staleTgRow) continue;

    applyUsernameUpdate(user.id, user.telegram_id, tgUser.username, tgUser.first_name);
    updated++;
    console.log(
      `🔄 Telegram username sync: user_id=${user.id} @${current || "—"} → @${fresh || "—"}`
    );
  }

  console.log(`🔄 Telegram username sync: обновлено ${updated}`);
}

function startTelegramUsernameSync() {
  syncTelegramUsernames();
  setInterval(syncTelegramUsernames, SYNC_INTERVAL_MS);
  console.log(
    "🔄 Фоновая синхронизация Telegram username запущена (интервал: 12 часов)"
  );
}

export { startTelegramUsernameSync, syncTelegramUsernames };
