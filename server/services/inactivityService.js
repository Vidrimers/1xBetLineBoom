import { db } from '../database/db.js';

// Количество пропущенных туров до исключения из турнира
const INACTIVITY_ROUNDS_LIMIT = 5;
// После скольких пропущенных туров отправлять предупреждение
const WARNING_THRESHOLD = 4;

/**
 * Отправляет сообщение пользователю через Telegram по telegram_id.
 * @param {number} telegramId
 * @param {string} message
 */
async function sendTelegramMessage(telegramId, message) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TELEGRAM_BOT_TOKEN || !telegramId) return;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (error) {
    console.error(`❌ Ошибка отправки Telegram сообщения пользователю ${telegramId}:`, error.message);
  }
}

/**
 * Отправляет уведомление админу через Telegram.
 * @param {string} message
 */
async function sendAdminTelegramMessage(message) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) return;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_ADMIN_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (error) {
    console.error('❌ Ошибка отправки Telegram сообщения админу:', error.message);
  }
}

/**
 * Проверяет, завершён ли тур (все матчи тура имеют результат).
 * @param {number} eventId
 * @param {string} round
 * @returns {boolean}
 */
function isRoundCompleted(eventId, round) {
  const total = db.prepare(`
    SELECT COUNT(*) as cnt FROM matches
    WHERE event_id = ? AND round = ?
  `).get(eventId, round);

  const finished = db.prepare(`
    SELECT COUNT(*) as cnt FROM matches
    WHERE event_id = ? AND round = ? AND winner IS NOT NULL
  `).get(eventId, round);

  // Тур считается завершённым если все матчи имеют результат и их больше 0
  return total.cnt > 0 && total.cnt === finished.cnt;
}

/**
 * Проверяет, ставил ли пользователь хотя бы одну ставку в данном туре турнира.
 * @param {number} userId
 * @param {number} eventId
 * @param {string} round
 * @returns {boolean}
 */
function userHasBetInRound(userId, eventId, round) {
  const bet = db.prepare(`
    SELECT b.id FROM bets b
    JOIN matches m ON b.match_id = m.id
    WHERE b.user_id = ? AND m.event_id = ? AND m.round = ?
    LIMIT 1
  `).get(userId, eventId, round);

  return !!bet;
}

/**
 * Удаляет все ставки пользователя в конкретном турнире.
 * Пользователь с сайта НЕ удаляется.
 * @param {number} userId
 * @param {number} eventId
 */
function deleteUserBetsInTournament(userId, eventId) {
  const matchIds = db.prepare(`
    SELECT id FROM matches WHERE event_id = ?
  `).all(eventId).map(m => m.id);

  if (matchIds.length === 0) return;

  const placeholders = matchIds.map(() => '?').join(',');

  const deletedBets = db.prepare(`
    DELETE FROM bets WHERE user_id = ? AND match_id IN (${placeholders})
  `).run(userId, ...matchIds);

  db.prepare(`
    DELETE FROM score_predictions WHERE user_id = ? AND match_id IN (${placeholders})
  `).run(userId, ...matchIds);

  db.prepare(`
    DELETE FROM cards_predictions WHERE user_id = ? AND match_id IN (${placeholders})
  `).run(userId, ...matchIds);

  console.log(`🗑️ Инактивность: удалено ${deletedBets.changes} ставок пользователя ${userId} в турнире ${eventId}`);
}

/**
 * Основная функция: проверяет инактивность после завершения тура.
 * Вызывается при установке результата матча.
 * @param {number} eventId
 * @param {string} round
 */
export async function checkRoundInactivity(eventId, round) {
  try {
    // Проверяем что тур действительно завершён
    if (!isRoundCompleted(eventId, round)) {
      return;
    }

    const event = db.prepare('SELECT name FROM events WHERE id = ?').get(eventId);
    const eventName = event?.name || `Турнир #${eventId}`;

    console.log(`\n🔍 Инактивность: проверяю тур "${round}" турнира "${eventName}"`);

    // Получаем всех пользователей, которые когда-либо ставили в этом турнире
    const allUsersInTournament = db.prepare(`
      SELECT DISTINCT b.user_id
      FROM bets b
      JOIN matches m ON b.match_id = m.id
      WHERE m.event_id = ?
    `).all(eventId);

    // Также берём пользователей из таблицы инактивности
    const trackedUsers = db.prepare(`
      SELECT DISTINCT user_id FROM user_tournament_inactivity
      WHERE event_id = ?
    `).all(eventId);

    // Объединяем уникальных пользователей
    const userIds = new Set([
      ...allUsersInTournament.map(u => u.user_id),
      ...trackedUsers.map(u => u.user_id)
    ]);

    for (const userId of userIds) {
      const user = db.prepare(`
        SELECT id, username, telegram_id, telegram_notifications_enabled
        FROM users WHERE id = ?
      `).get(userId);

      if (!user) continue;

      // Получаем или создаём запись инактивности
      let record = db.prepare(`
        SELECT * FROM user_tournament_inactivity
        WHERE user_id = ? AND event_id = ?
      `).get(userId, eventId);

      if (!record) {
        db.prepare(`
          INSERT INTO user_tournament_inactivity (user_id, event_id, inactive_rounds_count, is_excluded)
          VALUES (?, ?, 0, 0)
        `).run(userId, eventId);

        record = db.prepare(`
          SELECT * FROM user_tournament_inactivity
          WHERE user_id = ? AND event_id = ?
        `).get(userId, eventId);
      }

      // Если пользователь уже исключён — пропускаем
      if (record.is_excluded) {
        continue;
      }

      const hasBet = userHasBetInRound(userId, eventId, round);

      if (hasBet) {
        // Пользователь ставил — сбрасываем счётчик
        db.prepare(`
          UPDATE user_tournament_inactivity
          SET inactive_rounds_count = 0, last_active_round = ?, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND event_id = ?
        `).run(round, userId, eventId);

        console.log(`✅ Инактивность: "${user.username}" ставил в туре "${round}" — счётчик сброшен`);
      } else {
        // Пользователь не ставил — увеличиваем счётчик
        const newCount = record.inactive_rounds_count + 1;

        db.prepare(`
          UPDATE user_tournament_inactivity
          SET inactive_rounds_count = ?, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND event_id = ?
        `).run(newCount, userId, eventId);

        console.log(`⚠️ Инактивность: "${user.username}" не ставил в туре "${round}" — счётчик: ${newCount}/${INACTIVITY_ROUNDS_LIMIT}`);

        // Предупреждение после 4 пропущенных туров
        if (newCount === WARNING_THRESHOLD) {
          console.log(`📢 Отправляю предупреждение пользователю "${user.username}"`);

          const warningMessage =
            `⚠️ <b>Предупреждение об исключении</b>\n\n` +
            `Привет, ${user.username}!\n\n` +
            `Ты не делал ставок в турнире <b>"${eventName}"</b> уже ${newCount} тура подряд.\n\n` +
            `Если ты не сделаешь хотя бы одну ставку в следующем туре — ты будешь автоматически исключён из этого турнира, а все твои ставки в нём будут удалены.\n\n` +
            `Не пропусти следующий тур! 🎯`;

          if (user.telegram_id && user.telegram_notifications_enabled !== 0) {
            await sendTelegramMessage(user.telegram_id, warningMessage);
          }
        }

        // Если достигли лимита — исключаем из турнира
        if (newCount >= INACTIVITY_ROUNDS_LIMIT) {
          deleteUserBetsInTournament(userId, eventId);

          db.prepare(`
            UPDATE user_tournament_inactivity
            SET is_excluded = 1, excluded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND event_id = ?
          `).run(userId, eventId);

          console.log(`🚫 Инактивность: "${user.username}" исключён из турнира "${eventName}"`);

          const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

          // Уведомление пользователю об исключении
          const userExcludedMessage =
            `🚫 <b>Ты исключён из турнира</b>\n\n` +
            `Привет, ${user.username}!\n\n` +
            `Ты был автоматически исключён из турнира <b>"${eventName}"</b>, так как не делал ставок ${INACTIVITY_ROUNDS_LIMIT} туров подряд.\n\n` +
            `Все твои ставки в этом турнире удалены.\n\n` +
            `Если хочешь вернуться — просто сделай ставку в любом матче этого турнира. Ты начнёшь с нуля очков. 🔄`;

          if (user.telegram_id && user.telegram_notifications_enabled !== 0) {
            await sendTelegramMessage(user.telegram_id, userExcludedMessage);
          }

          // Уведомление админу об исключении
          const adminMessage =
            `🚫 <b>ИСКЛЮЧЕНИЕ ИЗ ТУРНИРА</b>\n\n` +
            `👤 Пользователь: ${user.username}\n` +
            `🏆 Турнир: ${eventName}\n` +
            `📊 Пропущено туров: ${INACTIVITY_ROUNDS_LIMIT}\n` +
            `🕐 Время: ${time}`;

          await sendAdminTelegramMessage(adminMessage);
        }
      }
    }
  } catch (error) {
    console.error('❌ Ошибка проверки инактивности:', error);
  }
}

/**
 * Вызывается когда пользователь делает новую ставку.
 * Если он был исключён из турнира — сбрасываем статус исключения (начинает с нуля).
 * @param {number} userId
 * @param {number} eventId
 */
export function handleUserBetInTournament(userId, eventId) {
  try {
    const record = db.prepare(`
      SELECT * FROM user_tournament_inactivity
      WHERE user_id = ? AND event_id = ?
    `).get(userId, eventId);

    if (record && record.is_excluded) {
      db.prepare(`
        UPDATE user_tournament_inactivity
        SET is_excluded = 0, excluded_at = NULL, inactive_rounds_count = 0,
            last_active_round = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND event_id = ?
      `).run(userId, eventId);

      const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
      const event = db.prepare('SELECT name FROM events WHERE id = ?').get(eventId);
      console.log(`🔄 Инактивность: "${user?.username}" вернулся в турнир "${event?.name}" — начинает с нуля`);
    }
  } catch (error) {
    console.error('❌ Ошибка обработки возврата пользователя:', error);
  }
}

/**
 * Проверяет, исключён ли пользователь из конкретного турнира.
 * @param {number} userId
 * @param {number} eventId
 * @returns {boolean}
 */
export function isUserExcludedFromTournament(userId, eventId) {
  const record = db.prepare(`
    SELECT is_excluded FROM user_tournament_inactivity
    WHERE user_id = ? AND event_id = ?
  `).get(userId, eventId);

  return record?.is_excluded === 1;
}
