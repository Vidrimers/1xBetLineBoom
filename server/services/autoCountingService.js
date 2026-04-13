import { sendAdminNotification } from "../../OnexBetLineBoombot.js";
import { db } from "../database/db.js";
import {
  PORT,
  SSTATS_API_KEY,
  SSTATS_API_BASE,
  SSTATS_LEAGUE_MAPPING,
  ICON_TO_COMPETITION,
} from "../config.js";
import {
  normalizeTeamNameForAPI,
  translateTeamNameToEnglish,
} from "../utils/helpers.js";

// Хранилище обработанных дат (чтобы не обрабатывать повторно)
const processedDates = new Set();

// Создаем таблицу для хранения обработанных дат автоподсчета
db.exec(`
  CREATE TABLE IF NOT EXISTS auto_counting_processed (
    date_key TEXT PRIMARY KEY,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Загружаем обработанные даты из БД при старте
const loadProcessedDates = () => {
  try {
    const dates = db.prepare('SELECT date_key FROM auto_counting_processed').all();
    dates.forEach(row => processedDates.add(row.date_key));
    console.log(`📋 Загружено ${dates.length} обработанных дат из БД`);
  } catch (error) {
    console.error('❌ Ошибка загрузки обработанных дат:', error);
  }
};

// Сохранить обработанную дату в БД
const saveProcessedDate = (dateKey) => {
  try {
    db.prepare('INSERT OR IGNORE INTO auto_counting_processed (date_key) VALUES (?)').run(dateKey);
  } catch (error) {
    console.error('❌ Ошибка сохранения обработанной даты:', error);
  }
};

// Загружаем при старте
loadProcessedDates();

// Получить статус автоподсчета из БД
function getAutoCountingEnabled() {
  const setting = db.prepare("SELECT value FROM system_settings WHERE key = 'auto_counting_enabled'").get();
  return setting ? setting.value === 'true' : true;
}

// Установить статус автоподсчета в БД
function setAutoCountingEnabled(enabled) {
  db.prepare("UPDATE system_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'auto_counting_enabled'")
    .run(enabled ? 'true' : 'false');
}

/**
 * Получить активные даты с незавершенными матчами или недавно завершенными
 */
function getActiveDates() {
  try {
    const dates = db.prepare(`
      SELECT DISTINCT 
        m.event_id,
        e.icon,
        m.round,
        DATE(m.match_date) as date
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.match_date IS NOT NULL
        AND DATE(m.match_date) >= DATE('now', '-2 days')
        AND DATE(m.match_date) <= DATE('now', '+1 days')
      GROUP BY m.event_id, e.icon, m.round, DATE(m.match_date)
      ORDER BY m.match_date
    `).all();

    return dates.map(date => ({
      ...date,
      competition_code: ICON_TO_COMPETITION[date.icon] || null
    }));
  } catch (error) {
    console.error('❌ Ошибка получения активных дат:', error);
    return [];
  }
}

/**
 * Проверить завершение всех матчей для конкретной даты
 */
async function checkDateCompletion(dateGroup, forceUpdate = false) {
  try {
    const { event_id, competition_code, round, date } = dateGroup;

    if (!competition_code) {
      console.log(`⚠️ Не удалось определить турнир для event_id=${event_id} (иконка не в маппинге)`);
      return { allFinished: false, matches: [] };
    }

    const allDbMatches = db.prepare(`
      SELECT * FROM matches
      WHERE event_id = ?
        AND round = ?
        AND DATE(match_date) = ?
    `).all(event_id, round, date);

    if (allDbMatches.length === 0) {
      console.log(`⚠️ Нет матчей для даты ${date}`);
      return { allFinished: false, matches: [] };
    }

    const finishedCount = allDbMatches.filter(m => m.status === 'finished').length;
    const cancelledCount = allDbMatches.filter(m => ['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(m.status)).length;
    console.log(`📊 Матчей для ${date}: ${allDbMatches.length}, завершено: ${finishedCount}, отменено/перенесено: ${cancelledCount}`);

    const processedCount = finishedCount + cancelledCount;
    if (processedCount === allDbMatches.length && !forceUpdate) {
      console.log(`✅ Все матчи уже обработаны в БД для ${date}`);
      return {
        allFinished: true,
        matches: allDbMatches.map(dbMatch => ({ dbMatch, apiMatch: null }))
      };
    }

    const dbMatches = forceUpdate ? allDbMatches : allDbMatches.filter(m =>
      !['finished', 'cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(m.status)
    );

    const leagueId = SSTATS_LEAGUE_MAPPING[competition_code];
    if (!leagueId) {
      console.log(`⚠️ Неизвестный турнир: ${competition_code}`);
      return { allFinished: false, matches: [] };
    }

    const dateObj = new Date(date);
    let year = dateObj.getFullYear();

    const cupTournaments = ['WC', 'EC'];
    if (!cupTournaments.includes(competition_code) && dateObj.getMonth() < 7) {
      year = year - 1;
    }

    const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&Year=${year}`;

    console.log(`🔍 Запрос к API: ${url}`);
    console.log(`📅 Ищем матчи для даты: ${date}`);

    const response = await fetch(url, {
      headers: { "X-API-Key": SSTATS_API_KEY }
    });

    if (!response.ok) {
      console.error(`❌ SStats API ошибка: ${response.status}`);
      return { allFinished: false, matches: [] };
    }

    const sstatsData = await response.json();

    if (sstatsData.status !== "OK") {
      console.error(`❌ SStats API статус не OK`);
      return { allFinished: false, matches: [] };
    }

    console.log(`📊 API вернул ${sstatsData.data?.length || 0} матчей всего`);

    const apiMatches = (sstatsData.data || []).filter(game => {
      const gameDate = game.date.split('T')[0];
      return gameDate === date;
    });

    console.log(`📊 Матчей для даты ${date}: ${apiMatches.length}`);

    if (apiMatches.length > 0) {
      console.log(`📋 Статусы матчей из API:`);
      apiMatches.forEach(game => {
        console.log(`  - ${game.homeTeam.name} vs ${game.awayTeam.name}: status=${game.status} (${game.statusName})`);
      });
    }

    const matchedMatches = [];

    console.log(`🔄 Сопоставление ${dbMatches.length} матчей из БД с API...`);

    for (const dbMatch of dbMatches) {
      const dbTeam1English = translateTeamNameToEnglish(dbMatch.team1_name, competition_code);
      const dbTeam2English = translateTeamNameToEnglish(dbMatch.team2_name, competition_code);

      const apiMatch = apiMatches.find(api => {
        const apiHome = normalizeTeamNameForAPI(api.homeTeam.name);
        const apiAway = normalizeTeamNameForAPI(api.awayTeam.name);
        const dbHome = normalizeTeamNameForAPI(dbTeam1English);
        const dbAway = normalizeTeamNameForAPI(dbTeam2English);

        return (apiHome === dbHome && apiAway === dbAway) ||
               (apiHome === dbAway && apiAway === dbHome);
      });

      if (apiMatch) {
        matchedMatches.push({ dbMatch, apiMatch });
        console.log(`  ✅ Сопоставлен: ${dbMatch.team1_name} - ${dbMatch.team2_name} (API status: ${apiMatch.status})`);
      } else {
        console.log(`  ❌ НЕ найден в API: ${dbMatch.team1_name} (${dbTeam1English}) - ${dbMatch.team2_name} (${dbTeam2English})`);
      }
    }

    console.log(`📊 Сопоставлено матчей: ${matchedMatches.length} из ${dbMatches.length}`);

    const finishedStatuses = [8, 9, 10];
    const specialStatuses = [13, 14, 15, 17, 18];

    const allFinished = matchedMatches.length > 0 &&
                       matchedMatches.every(({ apiMatch }) =>
                         finishedStatuses.includes(apiMatch.status) || specialStatuses.includes(apiMatch.status)
                       );

    console.log(`✅ Все матчи завершены или отменены: ${allFinished}`);

    if (!allFinished && matchedMatches.length > 0) {
      const notFinished = matchedMatches.filter(({ apiMatch }) =>
        !finishedStatuses.includes(apiMatch.status) && !specialStatuses.includes(apiMatch.status)
      );
      console.log(`⏸️ Незавершенные матчи (${notFinished.length}):`);
      notFinished.forEach(({ dbMatch, apiMatch }) => {
        console.log(`  - ${dbMatch.team1_name} - ${dbMatch.team2_name}: status=${apiMatch.status} (${apiMatch.statusName})`);
      });
    }

    const specialMatches = matchedMatches.filter(({ apiMatch }) => specialStatuses.includes(apiMatch.status));
    if (specialMatches.length > 0) {
      console.log(`⚠️ Отменённые/перенесённые матчи (${specialMatches.length}):`);
      specialMatches.forEach(({ dbMatch, apiMatch }) => {
        const statusNames = { 11: 'Перенесён', 12: 'Отменён', 13: 'Прерван', 14: 'Техническое поражение', 15: 'Неявка' };
        console.log(`  - ${dbMatch.team1_name} - ${dbMatch.team2_name}: ${statusNames[apiMatch.status] || apiMatch.statusName}`);
      });
    }

    return { allFinished, matches: matchedMatches };

  } catch (error) {
    console.error('❌ Ошибка проверки завершения даты:', error);
    return { allFinished: false, matches: [] };
  }
}

/**
 * Обновить матчи в БД из API
 */
async function updateMatchesFromAPI(matches) {
  try {
    const updateFinishedStmt = db.prepare(`
      UPDATE matches
      SET status = 'finished',
          winner = ?,
          team1_score = ?,
          team2_score = ?,
          yellow_cards = ?,
          red_cards = ?
      WHERE id = ?
    `);

    const updateSpecialStmt = db.prepare(`
      UPDATE matches
      SET status = ?
      WHERE id = ?
    `);

    const insertScoreStmt = db.prepare(`
      INSERT OR REPLACE INTO match_scores (match_id, score_team1, score_team2)
      VALUES (?, ?, ?)
    `);

    const specialStatusMap = {
      13: 'abandoned',
      14: 'postponed',
      15: 'cancelled',
      17: 'technical_loss',
      18: 'walkover'
    };

    const specialStatusNames = {
      13: 'Прерван',
      14: 'Перенесён',
      15: 'Отменён',
      17: 'Техническое поражение',
      18: 'Победа без игры'
    };

    for (const { dbMatch, apiMatch } of matches) {
      if (specialStatusMap[apiMatch.status]) {
        const dbStatus = specialStatusMap[apiMatch.status];
        const statusName = specialStatusNames[apiMatch.status];
        updateSpecialStmt.run(dbStatus, dbMatch.id);
        console.log(`⚠️ Матч отмечен как "${statusName}": ${dbMatch.team1_name} - ${dbMatch.team2_name}`);
        continue;
      }

      if (![8, 9, 10].includes(apiMatch.status)) {
        console.log(`⏭️ Пропускаем матч (статус ${apiMatch.status}): ${dbMatch.team1_name} - ${dbMatch.team2_name}`);
        continue;
      }

      const homeScore = ([9, 10].includes(apiMatch.status) && apiMatch.homeFTResult != null)
        ? apiMatch.homeFTResult
        : apiMatch.homeResult;
      const awayScore = ([9, 10].includes(apiMatch.status) && apiMatch.awayFTResult != null)
        ? apiMatch.awayFTResult
        : apiMatch.awayResult;

      const event = db.prepare("SELECT icon FROM events WHERE id = ?").get(dbMatch.event_id);
      const competition_code = event ? ICON_TO_COMPETITION[event.icon] : null;

      const apiHome = normalizeTeamNameForAPI(apiMatch.homeTeam.name);
      const dbTeam1English = translateTeamNameToEnglish(dbMatch.team1_name, competition_code);
      const dbHome = normalizeTeamNameForAPI(dbTeam1English);
      const isReversed = apiHome !== dbHome;

      let winner;
      if (homeScore > awayScore) {
        winner = isReversed ? 'team2' : 'team1';
      } else if (homeScore < awayScore) {
        winner = isReversed ? 'team1' : 'team2';
      } else {
        winner = 'draw';
      }

      const score1 = isReversed ? awayScore : homeScore;
      const score2 = isReversed ? homeScore : awayScore;

      let yellowCards = null;
      let redCards = null;

      if (apiMatch.id) {
        try {
          const detailsUrl = `${SSTATS_API_BASE}/Games/${apiMatch.id}`;
          console.log(`  🔍 Запрос карточек для матча ${dbMatch.team1_name} - ${dbMatch.team2_name}: ${detailsUrl}`);

          const detailsResponse = await fetch(detailsUrl, {
            headers: { "X-API-Key": SSTATS_API_KEY }
          });

          if (detailsResponse.ok) {
            const detailsData = await detailsResponse.json();
            const eventsArray = detailsData.data?.events || detailsData.events;

            if (eventsArray && Array.isArray(eventsArray)) {
              yellowCards = eventsArray.filter(e => e.name === 'Yellow Card').length;
              redCards = eventsArray.filter(e => e.name === 'Red Card').length;
              console.log(`  ✅ Карточки получены из events: 🟨${yellowCards} 🟥${redCards}`);
            } else {
              console.log(`  ⚠️ Массив events не найден в ответе API`);
            }
          } else {
            console.warn(`  ⚠️ Ошибка запроса карточек для матча ${dbMatch.id}: HTTP ${detailsResponse.status}`);
          }
        } catch (error) {
          console.warn(`  ⚠️ Не удалось получить карточки для матча ${dbMatch.id}:`, error.message);
        }
      }

      updateFinishedStmt.run(winner, score1, score2, yellowCards, redCards, dbMatch.id);
      insertScoreStmt.run(dbMatch.id, score1, score2);

      console.log(`✅ Обновлен матч: ${dbMatch.team1_name} ${score1}-${score2} ${dbMatch.team2_name} (${winner})${yellowCards !== null ? ` | 🟨${yellowCards}` : ''}${redCards !== null ? ` | 🟥${redCards}` : ''}`);
    }

    return true;
  } catch (error) {
    console.error('❌ Ошибка обновления матчей:', error);
    return false;
  }
}

/**
 * Запустить автоподсчет для конкретной даты
 */
async function triggerAutoCountingForDate(dateGroup) {
  try {
    const { date, round, competition_code } = dateGroup;
    const dateKey = `${date}_${round}_${competition_code}`;

    if (processedDates.has(dateKey)) {
      return;
    }

    console.log(`\n🤖 ========================================`);
    console.log(`🤖 АВТОПОДСЧЕТ для ${date} | ${round}`);
    console.log(`🤖 ========================================\n`);

    const { allFinished, matches } = await checkDateCompletion(dateGroup);

    if (!allFinished) {
      console.log(`⏸️ Не все матчи завершены для ${date}`);
      return;
    }

    console.log(`✅ Все матчи завершены для ${date}!`);

    const matchesWithApi = matches.filter(m => m.apiMatch !== null);
    if (matchesWithApi.length > 0) {
      const updated = await updateMatchesFromAPI(matchesWithApi);
      if (!updated) {
        console.error(`❌ Не удалось обновить матчи для ${date}`);
        return;
      }
    } else {
      console.log(`ℹ️ Все матчи уже обновлены в БД`);
    }

    processedDates.add(dateKey);
    saveProcessedDate(dateKey);
    console.log(`✅ Дата ${dateKey} помечена как обработанная`);

    const bets = db.prepare(`
      SELECT 
        b.*,
        u.username,
        m.team1_name,
        m.team2_name,
        m.winner,
        m.team1_score as actual_score_team1,
        m.team2_score as actual_score_team2,
        m.yellow_cards as actual_yellow_cards,
        m.red_cards as actual_red_cards,
        m.score_prediction_enabled,
        m.yellow_cards_prediction_enabled,
        m.red_cards_prediction_enabled,
        cp.yellow_cards as predicted_yellow_cards,
        cp.red_cards as predicted_red_cards
      FROM bets b
      JOIN users u ON b.user_id = u.id
      JOIN matches m ON b.match_id = m.id
      LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
      WHERE DATE(m.match_date) = ?
        AND m.status = 'finished'
        AND b.is_final_bet = 0
    `).all(date);

    if (bets.length === 0) {
      console.log(`⚠️ Нет ставок для ${date}`);
      return;
    }

    const userStats = {};

    bets.forEach(bet => {
      const username = bet.username;
      if (!userStats[username]) {
        userStats[username] = { points: 0, correctResults: 0, correctScores: 0, correctYellowCards: 0, correctRedCards: 0 };
      }

      let isWon = false;
      if (bet.prediction === 'draw' && bet.winner === 'draw') isWon = true;
      else if (bet.prediction === 'team1' && bet.winner === 'team1') isWon = true;
      else if (bet.prediction === 'team2' && bet.winner === 'team2') isWon = true;
      else if (bet.prediction === bet.team1_name && bet.winner === 'team1') isWon = true;
      else if (bet.prediction === bet.team2_name && bet.winner === 'team2') isWon = true;

      if (isWon) {
        userStats[username].points++;
        userStats[username].correctResults++;

        if (bet.score_prediction_enabled === 1 &&
            bet.score_team1 != null && bet.score_team2 != null &&
            bet.score_team1 === bet.actual_score_team1 &&
            bet.score_team2 === bet.actual_score_team2) {
          userStats[username].points++;
          userStats[username].correctScores++;
        }

        if (bet.yellow_cards_prediction_enabled === 1 &&
            bet.predicted_yellow_cards != null &&
            bet.actual_yellow_cards != null &&
            bet.predicted_yellow_cards === bet.actual_yellow_cards) {
          userStats[username].points++;
          userStats[username].correctYellowCards++;
        }

        if (bet.red_cards_prediction_enabled === 1 &&
            bet.predicted_red_cards != null &&
            bet.actual_red_cards != null &&
            bet.predicted_red_cards === bet.actual_red_cards) {
          userStats[username].points++;
          userStats[username].correctRedCards++;
        }
      }
    });

    const formatDate = (dateStr) => {
      const d = new Date(dateStr);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}.${month}.${year}`;
    };

    let message = `🤖 <b>Автоподсчет завершен</b>\n\n`;
    message += `📅 Дата: ${formatDate(date)}\n`;
    message += `🏆 Тур: ${round}\n\n`;
    message += `📈 Статистика:\n`;

    Object.entries(userStats)
      .sort(([, a], [, b]) => b.points - a.points)
      .forEach(([username, stats]) => {
        const statsText = [];
        if (stats.correctResults > 0) statsText.push(`✅ ${stats.correctResults}`);
        if (stats.correctScores > 0) statsText.push(`🎯 ${stats.correctScores}`);
        if (stats.correctYellowCards > 0) statsText.push(`🟨 ${stats.correctYellowCards}`);
        if (stats.correctRedCards > 0) statsText.push(`🟥 ${stats.correctRedCards}`);
        const statsStr = statsText.length > 0 ? ` (${statsText.join(', ')})` : '';
        message += `• ${username}: ${stats.points} ${stats.points === 1 ? 'очко' : stats.points < 5 ? 'очка' : 'очков'}${statsStr}\n`;
      });

    await sendAdminNotification(message);
    console.log(`✅ Уведомление отправлено админу`);

    setTimeout(async () => {
      try {
        console.log(`📤 Отправка результатов в группу и пользователям...`);

        const response = await fetch(`http://localhost:${PORT}/api/admin/send-counting-results`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dateFrom: date, dateTo: date })
        });

        if (response.ok) {
          console.log(`✅ Результаты отправлены в группу и пользователям`);
        } else {
          console.error(`❌ Ошибка отправки результатов: ${response.status}`);
        }
      } catch (error) {
        console.error(`❌ Ошибка отправки результатов:`, error);
      }
    }, 5000);

  } catch (error) {
    console.error('❌ Ошибка автоподсчета:', error);
  }
}

/**
 * Основная функция проверки и автоподсчета
 */
async function checkAndAutoCount() {
  try {
    const autoCountingEnabled = getAutoCountingEnabled();

    if (!autoCountingEnabled) {
      console.log(`⏸️ Автоподсчет отключен`);
      return;
    }

    console.log(`\n🔍 Проверка завершенных матчей... ${new Date().toLocaleString('ru-RU')}`);

    const activeDates = getActiveDates();

    if (activeDates.length === 0) {
      console.log(`✓ Нет активных дат для проверки`);
      return;
    }

    console.log(`📊 Найдено активных дат: ${activeDates.length}`);

    for (const dateGroup of activeDates) {
      await triggerAutoCountingForDate(dateGroup);
    }

  } catch (error) {
    console.error('❌ Ошибка в checkAndAutoCount:', error);
  }
}

export {
  processedDates,
  loadProcessedDates,
  saveProcessedDate,
  getAutoCountingEnabled,
  setAutoCountingEnabled,
  getActiveDates,
  checkDateCompletion,
  updateMatchesFromAPI,
  triggerAutoCountingForDate,
  checkAndAutoCount,
};
