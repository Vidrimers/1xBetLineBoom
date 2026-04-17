import { db } from '../database/db.js';

// Количество пропущенных туров до исключения из турнира
const INACTIVITY_ROUNDS_LIMIT = 5;

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
 * Возвращает список всех туров турнира, отсортированных по дате первого матча.
 * @param {number} eventId
 * @returns {string[]}
 */
function getEventRounds(eventId) {
  const rounds = db.prepare(`
    SELECT round, MIN(match_date) as first_match_date
    FROM matches
    WHERE event_id = ? AND round IS NOT NULL
    GROUP BY round
    ORDER BY first_match_date ASC
  `).all(eventId);

  return rounds.map(r => r.round);
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
  // Получаем все match_id в этом турнире
  const matchIds = db.prepare(`
    SELECT id FROM matches WHERE event_id = ?
  `).all(eventId).map(m => m.id);

  if (matchIds.length === 0) return;

  const placeholders = matchIds.map(() => '?').join(',');

  // Удаляем ставки
  const deletedBets = db.prepare(`
    DELETE FROM bets WHERE user_id = ? AND match_id IN (${placeholders})
  `).run(userId, ...matchIds);

  // Удаляем прогнозы на счёт
  db.prepare(`
    DELETE FROM score_predictions WHERE user_id = ? AND match_id IN (${placeholders})
  `).run(userId, ...matchIds);

  // Удаляем прогнозы на карточки
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
export function checkRoundInactivity(eventId, round) {
  try {
    // Проверяем что тур действительно завершён
    if (!isRoundCompleted(eventId, round)) {
      return; // Тур ещё не завершён — ничего не делаем
    }

    console.log(`\n🔍 Инактивность: проверяю тур "${round}" турнира ${eventId}`);

    // Получаем всех пользователей, которые когда-либо ставили в этом турнире
    // (включая тех, кто уже исключён — для них проверка не нужна)
    const allUsersInTournament = db.prepare(`
      SELECT DISTINCT b.user_id
      FROM bets b
      JOIN matches m ON b.match_id = m.id
      WHERE m.event_id = ?
    `).all(eventId);

    // Также берём пользователей из таблицы инактивности (могли быть исключены)
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

        console.log(`✅ Инактивность: пользователь ${userId} ставил в туре "${round}" — счётчик сброшен`);
      } else {
        // Пользователь не ставил — увеличиваем счётчик
        const newCount = record.inactive_rounds_count + 1;

        db.prepare(`
          UPDATE user_tournament_inactivity
          SET inactive_rounds_count = ?, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND event_id = ?
        `).run(newCount, userId, eventId);

        console.log(`⚠️ Инактивность: пользователь ${userId} не ставил в туре "${round}" — счётчик: ${newCount}/${INACTIVITY_ROUNDS_LIMIT}`);

        // Если достигли лимита — исключаем из турнира
        if (newCount >= INACTIVITY_ROUNDS_LIMIT) {
          deleteUserBetsInTournament(userId, eventId);

          db.prepare(`
            UPDATE user_tournament_inactivity
            SET is_excluded = 1, excluded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND event_id = ?
          `).run(userId, eventId);

          const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
          const event = db.prepare('SELECT name FROM events WHERE id = ?').get(eventId);
          console.log(`🚫 Инактивность: пользователь "${user?.username}" исключён из турнира "${event?.name}" (${INACTIVITY_ROUNDS_LIMIT} туров без ставок)`);
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
      // Пользователь был исключён и снова ставит — сбрасываем полностью
      db.prepare(`
        UPDATE user_tournament_inactivity
        SET is_excluded = 0, excluded_at = NULL, inactive_rounds_count = 0,
            last_active_round = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND event_id = ?
      `).run(userId, eventId);

      const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
      const event = db.prepare('SELECT name FROM events WHERE id = ?').get(eventId);
      console.log(`🔄 Инактивность: пользователь "${user?.username}" вернулся в турнир "${event?.name}" — начинает с нуля`);
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
