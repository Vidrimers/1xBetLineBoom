import { db } from "../database/db.js";
import { notifyAdmin } from "./notificationService.js";

function normalizeTgUsername(username) {
  return username ? String(username).replace("@", "").toLowerCase() : null;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Одно уведомление админу на событие смены ника (только привязанные к сайту)
async function notifyTelegramUsernameChange({
  user,
  oldUsername,
  newUsername,
  source,
  firstName,
}) {
  if (!user?.id) return;
  if ((oldUsername || null) === (newUsername || null)) return;

  const time = new Date().toLocaleString("ru-RU");
  const action = oldUsername ? "сменил" : "добавил";

  const message = `📱 TELEGRAM USERNAME

👤 Пользователь: ${escapeHtml(user.username)} (id=${user.id})
✏️ Действие: ${action}
Было: ${oldUsername ? `@${escapeHtml(oldUsername)}` : "—"}
Стало: ${newUsername ? `@${escapeHtml(newUsername)}` : "—"}
🔑 TG ID: ${user.telegram_id ?? "—"}
${firstName ? `👤 Имя в TG: ${escapeHtml(firstName)}\n` : ""}📍 Источник: ${source}
🕐 Время: ${time}`;

  try {
    await notifyAdmin(message);
  } catch (err) {
    console.error("⚠️ Не удалось отправить уведомление о смене TG username:", err);
  }
}

function upsertTelegramUserRow(telegramId, cleanUsername, firstName) {
  if (!telegramId) return;

  if (!cleanUsername) {
    db.prepare("DELETE FROM telegram_users WHERE chat_id = ?").run(telegramId);
    return;
  }

  db.prepare(
    `INSERT INTO telegram_users (telegram_username, chat_id, first_name)
     VALUES (?, ?, ?)
     ON CONFLICT(telegram_username) DO UPDATE SET
       chat_id = excluded.chat_id,
       first_name = excluded.first_name`
  ).run(cleanUsername, telegramId, firstName || null);

  db.prepare(
    "DELETE FROM telegram_users WHERE chat_id = ? AND LOWER(telegram_username) != ?"
  ).run(telegramId, cleanUsername);
}

/**
 * Обновляет telegram_username у привязанного пользователя.
 * Уведомление админу — только при реальном изменении (не дублируется ботом и cron).
 * silent: true — обновить БД без per-user уведомления (для пакетного прогона).
 * Возвращает { changed, oldUsername, newUsername, user } или null, если не привязан к сайту.
 */
function applyTelegramUsername({ telegramId, newUsername, firstName, source, silent = false }) {
  if (!telegramId) return null;

  const clean = normalizeTgUsername(newUsername);

  const user = db
    .prepare(
      "SELECT id, username, telegram_id, telegram_username FROM users WHERE telegram_id = ?"
    )
    .get(telegramId);

  if (!user) {
    // Вариант 1: без привязки к сайту не считаем событием
    upsertTelegramUserRow(telegramId, clean, firstName);
    return null;
  }

  const oldUsername = normalizeTgUsername(user.telegram_username);
  const changed = oldUsername !== clean;

  if (changed) {
    db.prepare("UPDATE users SET telegram_username = ? WHERE id = ?").run(clean, user.id);
  }

  upsertTelegramUserRow(telegramId, clean, firstName);

  if (changed && !silent) {
    notifyTelegramUsernameChange({
      user: { ...user, telegram_username: clean },
      oldUsername,
      newUsername: clean,
      source,
      firstName,
    }).catch(() => {});
  }

  return {
    changed,
    oldUsername,
    newUsername: clean,
    user: { ...user, telegram_username: clean },
  };
}

/**
 * Находит пользователя по telegram_id, затем по telegram_username (merge site ↔ TG).
 * Если не найден — создаёт «Малютка{N}». Затем синхронизирует ник.
 */
function findOrCreateUserByTelegram({ telegram_id, username, first_name, source = "tg-auth" }) {
  const clean = normalizeTgUsername(username);

  // 1. Точное совпадение по telegram_id
  let user = db
    .prepare("SELECT id, username, telegram_id, telegram_username FROM users WHERE telegram_id = ?")
    .get(telegram_id);

  // 2. Merge: сайт уже знает этот @ник (настроил привязку), но telegram_id ещё не проставлен
  //    или устарел
  if (!user && clean) {
    const byUsername = db
      .prepare(
        "SELECT id, username, telegram_id, telegram_username FROM users WHERE LOWER(telegram_username) = ?"
      )
      .get(clean);

    if (byUsername) {
      if (byUsername.telegram_id && String(byUsername.telegram_id) !== String(telegram_id)) {
        console.warn(
          `⚠️ Merge TG: у ${byUsername.username} telegram_id=${byUsername.telegram_id}, пришёл ${telegram_id} — не сливаем`
        );
      } else {
        db.prepare("UPDATE users SET telegram_id = ? WHERE id = ?").run(telegram_id, byUsername.id);
        user = { ...byUsername, telegram_id };
        console.log(`🔗 Merge TG-auth: ${user.username} (id=${user.id}) ← @${clean} (${telegram_id})`);
      }
    }
  }

  const isNewUser = !user;

  if (!user) {
    let usernameSite;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      const randomNum = Math.floor(Math.random() * 10000);
      usernameSite = `Малютка${randomNum}`;
      const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(usernameSite);
      if (!existing) break;
      attempts++;
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      throw new Error("Не удалось сгенерировать уникальное имя");
    }

    const result = db
      .prepare("INSERT INTO users (username, telegram_id, telegram_username) VALUES (?, ?, ?)")
      .run(usernameSite, telegram_id, clean);

    user = {
      id: result.lastInsertRowid,
      username: usernameSite,
      telegram_id,
      telegram_username: clean,
    };

    upsertTelegramUserRow(telegram_id, clean, first_name);
    console.log(`👤 Новый пользователь через TG: ${usernameSite} (id=${user.id})`);
  } else {
    applyTelegramUsername({
      telegramId: telegram_id,
      newUsername: clean,
      firstName: first_name,
      source,
    });
    user = db
      .prepare("SELECT id, username, telegram_id, telegram_username FROM users WHERE id = ?")
      .get(user.id);
  }

  return { user, isNewUser };
}

export {
  normalizeTgUsername,
  notifyTelegramUsernameChange,
  applyTelegramUsername,
  findOrCreateUserByTelegram,
  upsertTelegramUserRow,
};
