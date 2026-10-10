import { db } from "../database/db.js";
import { getTelegramUser } from "./telegramService.js";
import { applyTelegramUsername } from "./telegramAccountService.js";

// Смена ника в Telegram — редкое событие; 12 часов достаточно
const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

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

function startTelegramUsernameSync() {
  syncTelegramUsernames();
  setInterval(syncTelegramUsernames, SYNC_INTERVAL_MS);
  console.log(
    "🔄 Фоновая синхронизация Telegram username запущена (интервал: 12 часов)"
  );
}

export { startTelegramUsernameSync, syncTelegramUsernames };
