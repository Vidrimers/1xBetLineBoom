import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../database/db.js';
import { notifyAdmin, notifyModeratorAction } from '../services/notificationService.js';
import { sendUserMessage } from '../../OnexBetLineBoombot.js';
import { writeBetLog } from '../utils/logger.js';
import { SSTATS_API_KEY, SSTATS_API_BASE, SSTATS_LEAGUE_MAPPING, ICON_TO_COMPETITION, COMPETITION_DICTIONARY_MAPPING, ROOT_DIR } from '../config.js';
import { processedDates, saveProcessedDate, checkDateCompletion, updateMatchesFromAPI } from '../services/autoCountingService.js';
import { checkRoundInactivity } from '../services/inactivityService.js';
import { checkAndCreateTournamentCompletionNews } from '../services/tournamentCompletionService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// GET /api/events/:eventId/matches
router.get("/api/events/:eventId/matches", (req, res) => {
  try {
    const { eventId } = req.params;
    const { username } = req.query;
    
    // Если передан username, загружаем матчи с прогнозами пользователя
    if (username) {
      const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
      
      if (user) {
        const matches = db
          .prepare(
            `SELECT m.*, 
                    sp.score_team1 as predicted_score_team1, 
                    sp.score_team2 as predicted_score_team2,
                    cp.yellow_cards as predicted_yellow_cards,
                    cp.red_cards as predicted_red_cards
             FROM matches m
             LEFT JOIN score_predictions sp ON m.id = sp.match_id AND sp.user_id = ?
             LEFT JOIN cards_predictions cp ON m.id = cp.match_id AND cp.user_id = ?
             WHERE m.event_id = ? 
             ORDER BY m.created_at ASC`
          )
          .all(user.id, user.id, eventId);
        return res.json(matches);
      }
    }
    
    // Если username не передан, загружаем матчи без прогнозов
    const matches = db
      .prepare(
        "SELECT * FROM matches WHERE event_id = ? ORDER BY created_at ASC"
      )
      .all(eventId);
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/team-files
router.get("/api/team-files", (req, res) => {
  try {
    const namesDir = path.join(ROOT_DIR, 'names');
    
    // Проверяем существование папки
    if (!fs.existsSync(namesDir)) {
      return res.json([]);
    }
    
    // Читаем файлы из папки
    const files = fs.readdirSync(namesDir);
    
    // Фильтруем только нужные форматы
    const teamFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.json', '.txt', '.js'].includes(ext);
    }).map(file => ({
      name: file,
      path: `/names/${file}`
    }));
    
    res.json(teamFiles);
  } catch (error) {
    console.error("Ошибка получения списка файлов команд:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/counting-bets
router.get("/api/counting-bets", (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    if (!dateFrom || !dateTo) {
      return res
        .status(400)
        .json({ error: "Требуются даты dateFrom и dateTo" });
    }

    // Запрашиваем все ставки в статусе pending, которые были созданы в выбранный период
    const bets = db
      .prepare(
        `
      SELECT 
        b.*,
        u.username,
        m.team1_name,
        m.team2_name,
        m.winner,
        m.status as match_status,
        m.round,
        m.is_final,
        m.match_date,
        e.name as event_name,
        sp.score_team1,
        sp.score_team2
      FROM bets b
      JOIN users u ON b.user_id = u.id
      JOIN matches m ON b.match_id = m.id
      JOIN events e ON m.event_id = e.id
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      WHERE m.winner IS NULL
        AND DATE(m.match_date) >= DATE(?)
        AND DATE(m.match_date) <= DATE(?)
      ORDER BY e.name, u.username, m.match_date
    `
      )
      .all(dateFrom, dateTo);

    res.json(bets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/match-bet-stats/:matchId
router.get("/api/match-bet-stats/:matchId", (req, res) => {
  try {
    const { matchId } = req.params;

    // Получаем все ставки на этот матч (только обычные, не финальные)
    const bets = db
      .prepare(
        `SELECT prediction FROM bets 
         WHERE match_id = ? AND (is_final_bet = 0 OR is_final_bet IS NULL)`
      )
      .all(matchId);

    if (bets.length === 0) {
      return res.json({
        total: 0,
        team1: 0,
        draw: 0,
        team2: 0,
        team1Percent: 0,
        drawPercent: 0,
        team2Percent: 0,
      });
    }

    // Подсчитываем количество ставок на каждый исход
    const stats = {
      team1: 0,
      draw: 0,
      team2: 0,
    };

    bets.forEach((bet) => {
      if (bet.prediction === "team1") {
        stats.team1++;
      } else if (bet.prediction === "draw") {
        stats.draw++;
      } else if (bet.prediction === "team2") {
        stats.team2++;
      }
    });

    const total = bets.length;

    // Вычисляем проценты
    const team1Percent = Math.round((stats.team1 / total) * 100);
    const drawPercent = Math.round((stats.draw / total) * 100);
    const team2Percent = Math.round((stats.team2 / total) * 100);

    res.json({
      total,
      team1: stats.team1,
      draw: stats.draw,
      team2: stats.team2,
      team1Percent,
      drawPercent,
      team2Percent,
    });
  } catch (error) {
    console.error("Ошибка при получении статистики ставок:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/matches
router.post("/api/admin/matches", async (req, res) => {
  const {
    username,
    event_id,
    team1,
    team2,
    match_date,
    round,
    is_final,
    score_prediction_enabled,
    yellow_cards_prediction_enabled,
    red_cards_prediction_enabled,
    show_exact_score,
    show_yellow_cards,
    show_red_cards,
    show_corners,
    show_penalties_in_game,
    show_extra_time,
    show_penalties_at_end,
    show_goal_difference,
  } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;

  // Проверяем, является ли пользователь админом или модератором с правами
  const isAdminUser = username === ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("create_matches");
    }
    
    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  // Проверяем обязательные поля
  if (!event_id || !team1 || !team2) {
    return res
      .status(400)
      .json({ error: "Турнир, команда 1 и команда 2 обязательны" });
  }

  // Проверяем что дата валидная (если указана)
  if (match_date) {
    const dateObj = new Date(match_date);
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({
        error:
          "Неверный формат даты. Используйте ISO формат (YYYY-MM-DDTHH:mm:ss)",
      });
    }
  }

  try {
    const result = db
      .prepare(
        `
      INSERT INTO matches (
        event_id, team1_name, team2_name, match_date, round,
        is_final, score_prediction_enabled, yellow_cards_prediction_enabled, red_cards_prediction_enabled,
        show_exact_score, show_yellow_cards, show_red_cards,
        show_corners, show_penalties_in_game, show_extra_time, show_penalties_at_end,
        show_goal_difference
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        event_id,
        team1,
        team2,
        match_date || null,
        round || null,
        is_final ? 1 : 0,
        score_prediction_enabled ? 1 : 0,
        yellow_cards_prediction_enabled ? 1 : 0,
        red_cards_prediction_enabled ? 1 : 0,
        show_exact_score ? 1 : 0,
        show_yellow_cards ? 1 : 0,
        show_red_cards ? 1 : 0,
        show_corners ? 1 : 0,
        show_penalties_in_game ? 1 : 0,
        show_extra_time ? 1 : 0,
        show_penalties_at_end ? 1 : 0,
        show_goal_difference ? 1 : 0
      );

    // Отправляем уведомление админу если это модератор
    if (isModerator) {
      const event = db.prepare("SELECT name FROM events WHERE id = ?").get(event_id);
      const matchDateFormatted = match_date ? new Date(match_date).toLocaleString("ru-RU") : "не указана";
      
      const details = `⚽ Матч: ${team1} vs ${team2}
🏆 Турнир: ${event?.name || "Неизвестно"}
📅 Дата матча: ${matchDateFormatted}
🔢 Тур: ${round || "не указан"}${is_final ? "\n🏅 Финальный матч" : ""}`;

      await notifyModeratorAction(username, "Создание матча", details);
      
      // Запись в логи
      writeBetLog("match_created", {
        moderator: username,
        team1: team1,
        team2: team2,
        tournament: event?.name || "Неизвестно",
        round: round || "не указан",
        is_final: is_final
      });
    }

    res.json({
      id: result.lastInsertRowid,
      event_id,
      team1_name: team1,
      team2_name: team2,
      match_date: match_date || null,
      round: round || null,
      is_final: is_final ? 1 : 0,
      show_exact_score: show_exact_score ? 1 : 0,
      show_yellow_cards: show_yellow_cards ? 1 : 0,
      show_red_cards: show_red_cards ? 1 : 0,
      show_corners: show_corners ? 1 : 0,
      show_penalties_in_game: show_penalties_in_game ? 1 : 0,
      show_extra_time: show_extra_time ? 1 : 0,
      show_penalties_at_end: show_penalties_at_end ? 1 : 0,
      message: "Матч успешно создан",
    });
  } catch (error) {
    console.error("❌ Ошибка при создании матча:", error.message);
    if (error.message.includes("FOREIGN KEY constraint failed")) {
      return res.status(400).json({
        error:
          "❌ Ошибка: Указан несуществующий турнир. Сначала выберите турнир из списка.",
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// POST /api/matches/bulk-create
router.post("/api/matches/bulk-create", async (req, res) => {
  const { matches } = req.body;

  if (!Array.isArray(matches) || matches.length === 0) {
    return res.status(400).json({ message: "Укажите массив матчей" });
  }

  try {
    // Создаем обратный маппинг: Английское -> Русское
    let reverseMapping = {};
    
    // Пробуем определить турнир по первому матчу
    if (matches.length > 0 && matches[0].event_id) {
      const event = db.prepare("SELECT icon FROM events WHERE id = ?").get(matches[0].event_id);
      if (event && event.icon) {
        const competition = ICON_TO_COMPETITION[event.icon];
        const mappingFile = COMPETITION_DICTIONARY_MAPPING[competition];
        
        if (mappingFile) {
          try {
            const mappingData = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, mappingFile), 'utf-8'));
            const teamMapping = mappingData.teams || {};
            
            // Создаем обратный маппинг: Английское -> Русское
            // Если для одной английской команды есть несколько русских вариантов,
            // выбираем самое короткое название (приоритет коротким названиям)
            for (const [russian, english] of Object.entries(teamMapping)) {
              const englishLower = english.toLowerCase();
              if (!reverseMapping[englishLower] || russian.length < reverseMapping[englishLower].length) {
                reverseMapping[englishLower] = russian;
              }
            }
            
            console.log(`✅ Загружен маппинг для ${competition}: ${Object.keys(reverseMapping).length} команд`);
          } catch (err) {
            console.warn(`⚠️ Не удалось загрузить маппинг из ${mappingFile}`);
          }
        }
      }
    }
    
    const createdMatches = [];

    matches.forEach((match) => {
      const { 
        team1_name, 
        team2_name, 
        match_date, 
        round, 
        event_id,
        team1_score,
        team2_score,
        winner,
        score_prediction_enabled
      } = match;

      if (!team1_name || !team2_name || !event_id) {
        throw new Error(
          "Отсутствуют обязательные поля: team1_name, team2_name, event_id"
        );
      }

      // Переводим названия команд на русский если есть маппинг
      const team1_russian = reverseMapping[team1_name.toLowerCase()] || team1_name;
      const team2_russian = reverseMapping[team2_name.toLowerCase()] || team2_name;

      // Если есть результаты - создаем матч с результатами
      if (team1_score !== undefined && team2_score !== undefined && winner) {
        const result = db
          .prepare(
            `INSERT INTO matches (event_id, team1_name, team2_name, match_date, round, team1_score, team2_score, winner, score_prediction_enabled, yellow_cards_prediction_enabled, red_cards_prediction_enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            event_id,
            team1_russian,
            team2_russian,
            match_date || null,
            round || null,
            team1_score,
            team2_score,
            winner,
            score_prediction_enabled || 0,
            match.yellow_cards_prediction_enabled || 0,
            match.red_cards_prediction_enabled || 0
          );

        createdMatches.push({
          id: result.lastInsertRowid,
          event_id,
          team1_name: team1_russian,
          team2_name: team2_russian,
          match_date,
          round,
          team1_score,
          team2_score,
          winner,
          score_prediction_enabled: score_prediction_enabled || 0,
          yellow_cards_prediction_enabled: match.yellow_cards_prediction_enabled || 0,
          red_cards_prediction_enabled: match.red_cards_prediction_enabled || 0
        });
      } else {
        // Создаем матч без результатов
        const result = db
          .prepare(
            `INSERT INTO matches (event_id, team1_name, team2_name, match_date, round, score_prediction_enabled, yellow_cards_prediction_enabled, red_cards_prediction_enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            event_id,
            team1_russian,
            team2_russian,
            match_date || null,
            round || null,
            score_prediction_enabled || 0,
            match.yellow_cards_prediction_enabled || 0,
            match.red_cards_prediction_enabled || 0
          );

        createdMatches.push({
          id: result.lastInsertRowid,
          event_id,
          team1_name: team1_russian,
          team2_name: team2_russian,
          match_date,
          round,
          score_prediction_enabled: score_prediction_enabled || 0,
          yellow_cards_prediction_enabled: match.yellow_cards_prediction_enabled || 0,
          red_cards_prediction_enabled: match.red_cards_prediction_enabled || 0
        });
      }
    });

    res.json({
      message: `Успешно создано ${createdMatches.length} матчей`,
      matches: createdMatches,
    });
  } catch (error) {
    console.error("Ошибка при импорте матчей:", error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/matches/bulk-update-dates
router.post("/api/matches/bulk-update-dates", async (req, res) => {
  const { updates, username } = req.body;

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: "Укажите массив обновлений" });
  }

  // Проверка прав доступа
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("edit_matches");
    }
    
    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  try {
    let updatedCount = 0;

    updates.forEach(update => {
      const { match_id, match_date } = update;

      if (!match_id || !match_date) {
        throw new Error("Отсутствуют обязательные поля: match_id, match_date");
      }

      // Проверяем что дата валидная
      const dateObj = new Date(match_date);
      if (isNaN(dateObj.getTime())) {
        throw new Error(`Неверный формат даты для матча ${match_id}`);
      }

      // Обновляем дату матча
      const result = db
        .prepare("UPDATE matches SET match_date = ? WHERE id = ?")
        .run(match_date, match_id);

      if (result.changes > 0) {
        updatedCount++;
      }
    });

    res.json({
      success: true,
      message: `Успешно обновлено дат: ${updatedCount}`,
      updatedCount
    });
  } catch (error) {
    console.error("Ошибка при массовом обновлении дат:", error);
    res.status(500).json({ error: error.message });
  }
});
// PUT /api/admin/matches/:matchId
router.put("/api/admin/matches/:matchId", async (req, res) => {
  const { matchId } = req.params;
  const {
    username,
    status,
    result,
    team1_name,
    team2_name,
    match_date,
    round,
    is_final,
    score_prediction_enabled,
    yellow_cards_prediction_enabled,
    red_cards_prediction_enabled,
    show_exact_score,
    show_yellow_cards,
    show_red_cards,
    show_corners,
    show_penalties_in_game,
    show_extra_time,
    show_penalties_at_end,
  } = req.body;

  console.log("🔧 PUT /api/admin/matches/:matchId", { matchId, username, status, result });

  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  let hasPermission = false;
  
  if (!isAdminUser) {
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = true;
      console.log("   Права модератора:", permissions);
      const isEditingMatch = team1_name || team2_name || match_date !== undefined || 
                             round !== undefined || is_final !== undefined || 
                             score_prediction_enabled !== undefined;
      const isSettingResult = status !== undefined;
      console.log("   Действия: редактирование =", isEditingMatch, ", установка результата =", isSettingResult);
      if (isEditingMatch && permissions.includes("edit_matches")) {
        hasPermission = true;
        console.log("   ✓ Есть право edit_matches");
      }
      if (isSettingResult && (permissions.includes("manage_results") || permissions.includes("edit_matches") || permissions.includes("view_counting"))) {
        hasPermission = true;
        console.log("   ✓ Есть право manage_results, edit_matches или view_counting");
      }
    }
    if (!isModerator || !hasPermission) {
      console.log("❌ Пользователь не имеет прав:", username);
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  try {
    if (status) {
      const validStatuses = ["pending", "ongoing", "finished"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Неверный статус. Допустимые значения: pending, ongoing, finished" });
      }

      let winner = null;
      if (result) {
        const winnerMap = { team1_win: "team1", draw: "draw", team2_win: "team2" };
        winner = winnerMap[result] || null;
      }
      if (req.body.winner) {
        winner = req.body.winner;
      }

      console.log("✓ Обновляем матч:", { matchId, status, result: result || null, winner, score_team1: req.body.score_team1, score_team2: req.body.score_team2 });

      if (req.body.score_team1 !== undefined && req.body.score_team2 !== undefined) {
        try {
          db.prepare("INSERT OR REPLACE INTO match_scores (match_id, score_team1, score_team2) VALUES (?, ?, ?)").run(matchId, req.body.score_team1, req.body.score_team2);
        } catch (error) {
          console.error("Ошибка при сохранении счета:", error);
        }
      }

      db.prepare("UPDATE matches SET status = ?, result = ?, winner = ?, team1_score = ?, team2_score = ?, yellow_cards = ?, red_cards = ? WHERE id = ?").run(
        status, result || null, winner,
        req.body.score_team1 || null, req.body.score_team2 || null,
        req.body.yellow_cards !== undefined ? req.body.yellow_cards : null,
        req.body.red_cards !== undefined ? req.body.red_cards : null,
        matchId
      );

      if (isModerator && username) {
        const match = db.prepare("SELECT team1_name, team2_name FROM matches WHERE id = ?").get(matchId);
        const event = db.prepare("SELECT e.name FROM events e JOIN matches m ON m.event_id = e.id WHERE m.id = ?").get(matchId);
        const resultText = result === 'team1_win' ? match.team1_name : result === 'team2_win' ? match.team2_name : 'Ничья';
        let details = `⚽ Матч: ${match.team1_name} vs ${match.team2_name}\n🏆 Результат: ${resultText}`;
        if (req.body.score_team1 !== undefined) details += `\n⚽ Счет: ${req.body.score_team1}:${req.body.score_team2}`;
        if (req.body.yellow_cards !== undefined) details += `\n🟨 Желтые карточки: ${req.body.yellow_cards}`;
        if (req.body.red_cards !== undefined) details += `\n🟥 Красные карточки: ${req.body.red_cards}`;
        await notifyModeratorAction(username, "Установка результата матча", details);
        writeBetLog("match_result_set", {
          moderator: username,
          team1: match.team1_name,
          team2: match.team2_name,
          score: req.body.score_team1 !== undefined ? `${req.body.score_team1}:${req.body.score_team2}` : resultText,
          tournament: event?.name || "Неизвестно"
        });
      }
      
      try {
        const usersWithBets = db.prepare(`SELECT DISTINCT u.id, u.username FROM users u JOIN bets b ON b.user_id = u.id WHERE b.match_id = ?`).all(matchId);
        for (const user of usersWithBets) {
          const recentBets = db.prepare(`SELECT b.id, b.prediction, m.winner, m.match_date FROM bets b JOIN matches m ON m.id = b.match_id WHERE b.user_id = ? AND m.winner IS NOT NULL ORDER BY m.match_date DESC LIMIT 15`).all(user.id);
          let streak = 0;
          for (const bet of recentBets) {
            if (bet.prediction === bet.winner) { streak++; } else { break; }
          }
          if (streak >= 10) {
            const existingNews = db.prepare(`SELECT id FROM news WHERE type = 'achievement' AND message LIKE ? AND created_at > datetime('now', '-7 days')`).get(`%${user.username}%${streak}%подряд%`);
            if (!existingNews) {
              db.prepare(`INSERT INTO news (type, title, message) VALUES (?, ?, ?)`).run('achievement', `🏆 Рекорд: ${streak} точных прогнозов подряд!`, `Пользователь ${user.username} установил рекорд - ${streak} точных прогнозов подряд!\n\n🔥 Невероятная серия! Так держать!`);
              console.log(`✅ Автоматически создана новость о рекорде пользователя ${user.username}: ${streak} подряд`);
            }
          }
          if (streak === 3 || streak === 5) {
            const existingStreakNews = db.prepare(`SELECT id FROM news WHERE type = 'achievement' AND message LIKE ? AND created_at > datetime('now', '-7 days')`).get(`%${user.username}%${streak}%подряд%`);
            if (!existingStreakNews) {
              db.prepare(`INSERT INTO news (type, title, message) VALUES (?, ?, ?)`).run('achievement', `🎯 Серия: ${streak} точных прогнозов подряд!`, `Пользователь ${user.username} угадал ${streak} прогнозов подряд!\n\n🔥 Отличная серия! Продолжай в том же духе!`);
              console.log(`✅ Автоматически создана новость о серии пользователя ${user.username}: ${streak} подряд`);
            }
          }
          const exactScoreCount = db.prepare(`SELECT COUNT(*) as count FROM score_predictions sp JOIN matches m ON m.id = sp.match_id JOIN match_scores ms ON ms.match_id = m.id WHERE sp.user_id = ? AND sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 AND m.winner IS NOT NULL`).get(user.id).count;
          if (exactScoreCount >= 5 && exactScoreCount % 5 === 0) {
            const existingScoreNews = db.prepare(`SELECT id FROM news WHERE type = 'achievement' AND message LIKE ? AND created_at > datetime('now', '-7 days')`).get(`%${user.username}%${exactScoreCount}%точных счёт%`);
            if (!existingScoreNews) {
              db.prepare(`INSERT INTO news (type, title, message) VALUES (?, ?, ?)`).run('achievement', `⚽ Мастер счёта: ${exactScoreCount} точных прогнозов!`, `Пользователь ${user.username} угадал ${exactScoreCount} точных счётов!\n\n✅ Невероятная точность! Продолжай в том же духе!`);
              console.log(`✅ Автоматически создана новость о точных счётах пользователя ${user.username}: ${exactScoreCount}`);
            }
          }
          const cardsCount = db.prepare(`SELECT COUNT(*) as count FROM cards_predictions cp JOIN matches m ON m.id = cp.match_id WHERE cp.user_id = ? AND ((cp.yellow_cards = m.yellow_cards AND m.yellow_cards IS NOT NULL) OR (cp.red_cards = m.red_cards AND m.red_cards IS NOT NULL)) AND m.winner IS NOT NULL`).get(user.id).count;
          if (cardsCount >= 5 && cardsCount % 5 === 0) {
            const existingCardsNews = db.prepare(`SELECT id FROM news WHERE type = 'achievement' AND message LIKE ? AND created_at > datetime('now', '-7 days')`).get(`%${user.username}%${cardsCount}%карточ%`);
            if (!existingCardsNews) {
              db.prepare(`INSERT INTO news (type, title, message) VALUES (?, ?, ?)`).run('achievement', `✅✅ Мастер карточек: ${cardsCount} точных прогнозов!`, `Пользователь ${user.username} угадал ${cardsCount} прогнозов на карточки!\n\n✅ Отличное чутьё на дисциплину! Так держать!`);
              console.log(`✅ Автоматически создана новость о карточках пользователя ${user.username}: ${cardsCount}`);
            }
          }
        }
      } catch (error) {
        console.error("❌ Ошибка проверки рекордов:", error);
      }
      
      try {
        const currentRanking = db.prepare(`
          SELECT u.id, u.username,
            SUM(CASE WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
              CASE WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR (b.prediction = 'team2' AND m.winner = 'team2') OR (b.prediction = 'draw' AND m.winner = 'draw') OR (b.prediction = m.team1_name AND m.winner = 'team1') OR (b.prediction = m.team2_name AND m.winner = 'team2') THEN
                  CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
                  CASE WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 THEN 1 ELSE 0 END +
                  CASE WHEN m.is_final = 0 AND m.winner != 'draw' AND e.diff_goals_enabled = 1 AND sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND NOT (sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2) AND (sp.score_team1 - sp.score_team2) = (ms.score_team1 - ms.score_team2) THEN 1 ELSE 0 END +
                  CASE WHEN m.yellow_cards_prediction_enabled = 1 AND cp.yellow_cards IS NOT NULL AND m.yellow_cards IS NOT NULL AND cp.yellow_cards = m.yellow_cards THEN 1 ELSE 0 END +
                  CASE WHEN m.red_cards_prediction_enabled = 1 AND cp.red_cards IS NOT NULL AND m.red_cards IS NOT NULL AND cp.red_cards = m.red_cards THEN 1 ELSE 0 END
                ELSE 0 END
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 2
                     WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 2
                     WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 2
                     WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 2
                     WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 2
                     WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 2
                     WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 2
                     WHEN b.parameter_type = 'goal_difference' AND CAST(b.prediction AS INTEGER) = CAST(fpr.goal_difference AS INTEGER) THEN 1
                     ELSE 0 END
              ELSE 0 END ELSE 0 END) as total_points
          FROM users u
          LEFT JOIN bets b ON b.user_id = u.id
          LEFT JOIN matches m ON b.match_id = m.id
          LEFT JOIN events e ON m.event_id = e.id
          LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
          LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
          LEFT JOIN match_scores ms ON b.match_id = ms.match_id
          LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
          GROUP BY u.id, u.username HAVING total_points > 0 ORDER BY total_points DESC
        `).all();
        if (currentRanking.length > 0) {
          const currentLeader = currentRanking[0];
          db.exec(`CREATE TABLE IF NOT EXISTS leader_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, username TEXT NOT NULL, points INTEGER NOT NULL, changed_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
          const lastLeader = db.prepare(`SELECT user_id, username, points FROM leader_history ORDER BY changed_at DESC LIMIT 1`).get();
          if (!lastLeader || lastLeader.user_id !== currentLeader.id) {
            db.prepare(`INSERT INTO leader_history (user_id, username, points) VALUES (?, ?, ?)`).run(currentLeader.id, currentLeader.username, currentLeader.total_points);
            if (lastLeader) {
              db.prepare(`INSERT INTO news (type, title, message) VALUES (?, ?, ?)`).run('achievement', `✅ Новый лидер: ${currentLeader.username}!`, `Пользователь ${currentLeader.username} вышел на первое место в рейтинге!\n\n✅ Очков: ${currentLeader.total_points}\n\n✅ Поздравляем с лидерством!`);
              console.log(`✅ Автоматически создана новость о новом лидере: ${currentLeader.username}`);
            }
          }
        }
        db.exec(`CREATE TABLE IF NOT EXISTS ranking_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, username TEXT NOT NULL, position INTEGER NOT NULL, points INTEGER NOT NULL, checked_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        currentRanking.forEach((user, index) => {
          const currentPosition = index + 1;
          const lastPosition = db.prepare(`SELECT position FROM ranking_history WHERE user_id = ? ORDER BY checked_at DESC LIMIT 1`).get(user.id);
          db.prepare(`INSERT INTO ranking_history (user_id, username, position, points) VALUES (?, ?, ?, ?)`).run(user.id, user.username, currentPosition, user.total_points);
          if (lastPosition && lastPosition.position - currentPosition >= 3) {
            const positionsUp = lastPosition.position - currentPosition;
            const existingProgressNews = db.prepare(`SELECT id FROM news WHERE type = 'achievement' AND message LIKE ? AND created_at > datetime('now', '-1 days')`).get(`%${user.username}%поднялся%`);
            if (!existingProgressNews) {
              db.prepare(`INSERT INTO news (type, title, message) VALUES (?, ?, ?)`).run('achievement', `✅ Прогресс: +${positionsUp} позиций!`, `Пользователь ${user.username} поднялся на ${positionsUp} ${positionsUp === 3 ? 'позиции' : 'позиций'} в рейтинге!\n\n✅ Текущая позиция: ${currentPosition}\n✅ Очков: ${user.total_points}\n\n✅ Отличная динамика!`);
              console.log(`✅ Автоматически создана новость о прогрессе: ${user.username} (+${positionsUp} позиций)`);
            }
          }
        });
      } catch (error) {
        console.error("❌ Ошибка проверки лидера и прогресса:", error);
      }

      // После установки результата — проверяем инактивность по туру (только если winner установлен)
      if (winner) {
        try {
          const updatedMatch = db.prepare('SELECT event_id, round FROM matches WHERE id = ?').get(matchId);
          if (updatedMatch?.round) {
            setImmediate(() => {
              checkRoundInactivity(updatedMatch.event_id, updatedMatch.round)
                .catch(err => console.error('❌ Ошибка проверки инактивности:', err));
            });
          }
        } catch (inactivityError) {
          console.error('❌ Ошибка запуска проверки инактивности:', inactivityError);
        }

        // Проверяем завершение турнира (только для НЕ финальных матчей — для финальных проверка в POST /api/admin/final-parameters-results)
        const matchForCheck = db.prepare('SELECT is_final FROM matches WHERE id = ?').get(matchId);
        if (!matchForCheck || !matchForCheck.is_final) {
          try {
            checkAndCreateTournamentCompletionNews(parseInt(matchId));
          } catch (completionError) {
            console.error('❌ Ошибка проверки завершения турнира:', completionError);
          }
        }
      }

      return res.json({ message: "Статус матча успешно изменен", matchId, status, result: result || null });
    }

    if (
      team1_name || team2_name || match_date !== undefined || round !== undefined ||
      is_final !== undefined || score_prediction_enabled !== undefined ||
      yellow_cards_prediction_enabled !== undefined || red_cards_prediction_enabled !== undefined ||
      show_exact_score !== undefined || show_yellow_cards !== undefined || show_red_cards !== undefined ||
      show_corners !== undefined || show_penalties_in_game !== undefined ||
      show_extra_time !== undefined || show_penalties_at_end !== undefined ||
      show_goal_difference !== undefined
    ) {
      const currentMatch = db.prepare(`SELECT team1_name, team2_name, match_date, round, is_final, score_prediction_enabled, yellow_cards_prediction_enabled, red_cards_prediction_enabled, show_exact_score, show_yellow_cards, show_red_cards, show_corners, show_penalties_in_game, show_extra_time, show_penalties_at_end, show_goal_difference FROM matches WHERE id = ?`).get(matchId);
      if (!currentMatch) return res.status(404).json({ error: "Матч не найден" });

      const dateChanged = match_date !== undefined && match_date !== currentMatch.match_date;
      if (dateChanged) {
        console.log(`⏰ Дата матча изменена! Удаляем отправленные напоминания для матча ${matchId}`);
        db.prepare("DELETE FROM sent_reminders WHERE match_id = ?").run(matchId);
        console.log(`✅ Напоминания удалены. При новой дате напоминание отправится заново.`);
      }

      db.prepare(`UPDATE matches SET team1_name = ?, team2_name = ?, match_date = ?, round = ?, is_final = ?, score_prediction_enabled = ?, yellow_cards_prediction_enabled = ?, red_cards_prediction_enabled = ?, show_exact_score = ?, show_yellow_cards = ?, show_red_cards = ?, show_corners = ?, show_penalties_in_game = ?, show_extra_time = ?, show_penalties_at_end = ?, show_goal_difference = ? WHERE id = ?`).run(
        team1_name || currentMatch.team1_name,
        team2_name || currentMatch.team2_name,
        match_date !== undefined ? match_date : currentMatch.match_date,
        round !== undefined ? round : currentMatch.round,
        is_final !== undefined ? (is_final ? 1 : 0) : currentMatch.is_final,
        score_prediction_enabled !== undefined ? (score_prediction_enabled ? 1 : 0) : currentMatch.score_prediction_enabled,
        yellow_cards_prediction_enabled !== undefined ? (yellow_cards_prediction_enabled ? 1 : 0) : currentMatch.yellow_cards_prediction_enabled,
        red_cards_prediction_enabled !== undefined ? (red_cards_prediction_enabled ? 1 : 0) : currentMatch.red_cards_prediction_enabled,
        show_exact_score !== undefined ? (show_exact_score ? 1 : 0) : currentMatch.show_exact_score,
        show_yellow_cards !== undefined ? (show_yellow_cards ? 1 : 0) : currentMatch.show_yellow_cards,
        show_red_cards !== undefined ? (show_red_cards ? 1 : 0) : currentMatch.show_red_cards,
        show_corners !== undefined ? (show_corners ? 1 : 0) : currentMatch.show_corners,
        show_penalties_in_game !== undefined ? (show_penalties_in_game ? 1 : 0) : currentMatch.show_penalties_in_game,
        show_extra_time !== undefined ? (show_extra_time ? 1 : 0) : currentMatch.show_extra_time,
        show_penalties_at_end !== undefined ? (show_penalties_at_end ? 1 : 0) : currentMatch.show_penalties_at_end,
        show_goal_difference !== undefined ? (show_goal_difference ? 1 : 0) : currentMatch.show_goal_difference,
        matchId
      );

      if (score_prediction_enabled !== undefined && !score_prediction_enabled) {
        const deletedScores = db.prepare("DELETE FROM score_predictions WHERE match_id = ?").run(matchId);
        console.log(`🗑️ Удалено прогнозов на счет: ${deletedScores.changes}`);
      }
      if (yellow_cards_prediction_enabled !== undefined && !yellow_cards_prediction_enabled) {
        const deletedYellow = db.prepare("UPDATE cards_predictions SET yellow_cards = NULL WHERE match_id = ?").run(matchId);
        console.log(`🗑️ Удалено прогнозов на желтые карточки: ${deletedYellow.changes}`);
      }
      if (red_cards_prediction_enabled !== undefined && !red_cards_prediction_enabled) {
        const deletedRed = db.prepare("UPDATE cards_predictions SET red_cards = NULL WHERE match_id = ?").run(matchId);
        console.log(`🗑️ Удалено прогнозов на красные карточки: ${deletedRed.changes}`);
      }
      db.prepare("DELETE FROM cards_predictions WHERE match_id = ? AND yellow_cards IS NULL AND red_cards IS NULL").run(matchId);

      if (isModerator && username) {
        const event = db.prepare("SELECT e.name FROM events e JOIN matches m ON m.event_id = e.id WHERE m.id = ?").get(matchId);
        const details = `⚽ Матч: ${team1_name || currentMatch.team1_name} vs ${team2_name || currentMatch.team2_name}\n📅 Дата: ${match_date || currentMatch.match_date || 'не указана'}\n🏆 Тур: ${round || currentMatch.round || 'не указан'}`;
        await notifyModeratorAction(username, "Редактирование матча", details);
        writeBetLog("match_edited", {
          moderator: username,
          team1: team1_name || currentMatch.team1_name,
          team2: team2_name || currentMatch.team2_name,
          tournament: event?.name || "Неизвестно",
          round: round || currentMatch.round || 'не указан'
        });
      }

      return res.json({ success: true, message: "Матч успешно обновлен", matchId });
    }

    return res.status(400).json({ error: "Не указаны данные для обновления" });
  } catch (error) {
    console.error("❌ Ошибка при обновлении матча:", error.message);
    if (error.message.includes("FOREIGN KEY constraint failed")) {
      return res.status(400).json({ error: "❌ Ошибка: Указан несуществующий турнир. Выберите существующий турнир." });
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;
