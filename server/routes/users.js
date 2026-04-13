import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../database/db.js';
import { notifyAdmin } from '../services/notificationService.js';
import { writeBetLog } from '../utils/logger.js';
import { sendUserMessage, sendAdminNotification, notifyReminderEnabled, notifyReminderDeleted } from '../../OnexBetLineBoombot.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

router.get("/api/users", (req, res) => {
  try {
    const users = db
      .prepare("SELECT id, username, telegram_username, telegram_notifications_enabled FROM users ORDER BY username ASC")
      .all();
    res.json(users);
  } catch (error) {
    console.error("Ошибка при получении пользователей:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.1.1 Получить детали пользователя (для админа)
router.get("/api/admin/user-details/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = db
      .prepare("SELECT id, username, telegram_username, telegram_notifications_enabled FROM users WHERE id = ?")
      .get(userId);
    
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    
    // Получаем информацию из telegram_users
    let telegramUser = null;
    if (user.telegram_username) {
      telegramUser = db
        .prepare("SELECT chat_id, first_name FROM telegram_users WHERE telegram_username = ?")
        .get(user.telegram_username);
    }
    
    res.json({
      user,
      telegramUser
    });
  } catch (error) {
    console.error("Ошибка при получении деталей пользователя:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.1.2 Получить глобальную статистику пользователя (за все турниры)
router.get("/api/users/:userId/global-stats", (req, res) => {
  try {
    const { userId } = req.params;
    
    // Получаем информацию о пользователе
    const user = db.prepare("SELECT id, username, avatar, created_at FROM users WHERE id = ?").get(userId);
    
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    
    // Получаем полную статистику ставок (как в профиле)
    const bets = db.prepare(`
      SELECT 
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 1
          ELSE 0
        END) as total_bets,
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN
                       -- Базовое очко за угаданный результат (3 за финал, 1 за обычный матч)
                       CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
                       -- Дополнительное очко за угаданный счет
                       CASE 
                         WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                              ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                              sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
                         THEN 1 
                         ELSE 0 
                       END
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_bets,
        -- Количество угаданных ставок (для процента побед)
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_count,
        SUM(CASE 
          WHEN (m.winner IS NOT NULL OR fpr.id IS NOT NULL) THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN NOT ((b.prediction = 'team1' AND m.winner = 'team1') OR
                            (b.prediction = 'team2' AND m.winner = 'team2') OR
                            (b.prediction = 'draw' AND m.winner = 'draw') OR
                            (b.prediction = m.team1_name AND m.winner = 'team1') OR
                            (b.prediction = m.team2_name AND m.winner = 'team2')) THEN 1 
                  ELSE 0 
                END
              -- Финальные параметры
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) != fpr.yellow_cards THEN 2
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) != fpr.red_cards THEN 2
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) != fpr.corners THEN 2
                  WHEN b.parameter_type = 'exact_score' AND b.prediction != fpr.exact_score THEN 2
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction != fpr.penalties_in_game THEN 2
                  WHEN b.parameter_type = 'extra_time' AND b.prediction != fpr.extra_time THEN 2
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction != fpr.penalties_at_end THEN 2
                  ELSE 0
                END
              ELSE 0 
            END 
          ELSE 0 
        END) as lost_bets,
        SUM(CASE 
          WHEN (b.is_final_bet = 0 AND m.winner IS NULL) OR 
               (b.is_final_bet = 1 AND fpr.id IS NULL) THEN 1 
          ELSE 0 
        END) as pending_bets,
        COUNT(DISTINCT m.event_id) as tournaments_count
      FROM bets b
      LEFT JOIN matches m ON b.match_id = m.id
      LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN match_scores ms ON b.match_id = ms.match_id
      LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
      WHERE b.user_id = ?
    `).get(userId);
    
    // Подсчитываем количество побед в турнирах (1-е места)
    const tournamentWins = db.prepare(`
      SELECT COUNT(*) as count
      FROM tournament_awards
      WHERE user_id = ?
    `).get(userId);
    
    // Получаем награды
    const awards = db.prepare(`
      SELECT ta.id, ta.event_name, ta.won_bets, ta.awarded_at, e.icon as event_icon
      FROM tournament_awards ta
      LEFT JOIN events e ON ta.event_id = e.id
      WHERE ta.user_id = ?
      ORDER BY ta.awarded_at DESC
    `).all(userId);
    
    // Подсчитываем статистику по сетке плей-офф
    const bracketStats = db.prepare(`
      SELECT 
        COUNT(*) as total_bracket_predictions,
        SUM(CASE WHEN bp.predicted_winner = br.actual_winner THEN 1 ELSE 0 END) as correct_bracket_predictions,
        SUM(CASE WHEN bp.predicted_winner != br.actual_winner THEN 1 ELSE 0 END) as incorrect_bracket_predictions
      FROM bracket_predictions bp
      LEFT JOIN bracket_results br ON bp.bracket_id = br.bracket_id 
        AND bp.stage = br.stage 
        AND bp.match_index = br.match_index
      WHERE bp.user_id = ? AND br.actual_winner IS NOT NULL
    `).get(userId);
    
    const stats = {
      total_bets: bets.total_bets || 0,
      won_bets: bets.won_bets || 0,
      won_count: bets.won_count || 0,
      lost_bets: bets.lost_bets || 0,
      pending_bets: bets.pending_bets || 0,
      tournaments_count: bets.tournaments_count || 0,
      tournament_wins: tournamentWins?.count || 0,
      win_accuracy: bets.total_bets > 0 ? Math.round((bets.won_count / bets.total_bets) * 100) : 0,
      bracket_correct: bracketStats?.correct_bracket_predictions || 0,
      bracket_incorrect: bracketStats?.incorrect_bracket_predictions || 0
    };
    
    res.json({
      user,
      stats,
      awards: awards || []
    });
  } catch (error) {
    console.error("Ошибка при получении глобальной статистики:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.2 Получить всех модераторов
router.get("/api/user/:userId/custom-awards", (req, res) => {
  try {
    const { userId } = req.params;

    const awards = db
      .prepare(
        `
      SELECT ua.id, ua.user_id, ua.event_id, e.name as event_name, 
             ua.award_type, ua.description, ua.created_at
      FROM user_awards ua
      LEFT JOIN events e ON ua.event_id = e.id
      WHERE ua.user_id = ?
      ORDER BY ua.created_at DESC
    `
      )
      .all(userId);

    res.json(awards);
  } catch (error) {
    console.error("Ошибка при получении наград пользователя:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.7 Получить все награды (для админ-панели)
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

// 8. Получить всех участников с количеством ставок
router.get("/api/participants", (req, res) => {
  try {
    const participants = db
      .prepare(
        `
      SELECT 
        u.id,
        u.username,
        u.telegram_username,
        u.avatar,
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 1
          ELSE 0
        END) as total_bets,
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN
                       -- Базовое очко за угаданный результат (3 за финал, 1 за обычный матч)
                       CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
                       -- Дополнительное очко за угаданный счет
                       CASE 
                         WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                              ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                              sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
                         THEN 1 
                         ELSE 0 
                       END
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_bets,
        -- Количество угаданных ставок (для процента побед)
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_count,
        SUM(CASE 
          WHEN (m.winner IS NOT NULL OR fpr.id IS NOT NULL) THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN NOT ((b.prediction = 'team1' AND m.winner = 'team1') OR
                            (b.prediction = 'team2' AND m.winner = 'team2') OR
                            (b.prediction = 'draw' AND m.winner = 'draw') OR
                            (b.prediction = m.team1_name AND m.winner = 'team1') OR
                            (b.prediction = m.team2_name AND m.winner = 'team2')) THEN 1 
                  ELSE 0 
                END
              -- Финальные параметры
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) != fpr.yellow_cards THEN 2
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) != fpr.red_cards THEN 2
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) != fpr.corners THEN 2
                  WHEN b.parameter_type = 'exact_score' AND b.prediction != fpr.exact_score THEN 2
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction != fpr.penalties_in_game THEN 2
                  WHEN b.parameter_type = 'extra_time' AND b.prediction != fpr.extra_time THEN 2
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction != fpr.penalties_at_end THEN 2
                  ELSE 0
                END
              ELSE 0 
            END 
          ELSE 0 
        END) as lost_bets,
        SUM(CASE 
          WHEN (b.is_final_bet = 0 AND m.winner IS NULL) OR 
               (b.is_final_bet = 1 AND fpr.id IS NULL) THEN 1 
          ELSE 0 
        END) as pending_bets
      FROM users u
      LEFT JOIN bets b ON u.id = b.user_id
      LEFT JOIN matches m ON b.match_id = m.id
      LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN match_scores ms ON b.match_id = ms.match_id
      GROUP BY u.id, u.username, u.avatar
      ORDER BY COUNT(b.id) DESC
    `
      )
      .all();

    // Для каждого участника подсчитываем победы в турнирах (заблокированных событиях)
    const result = participants.map((participant) => {
      // Получаем все завершенные турниры (с locked_reason)
      const tournaments = db
        .prepare(
          `
        SELECT DISTINCT e.id, e.name, e.icon
        FROM events e
        WHERE e.locked_reason IS NOT NULL
      `
        )
        .all();

      let tournament_wins = 0;
      let won_icons = [];

      // Для каждого завершенного турнира проверяем, выиграл ли участник
      tournaments.forEach((tournament) => {
        // Подсчитываем выигрыши участника в этом турнире
        const userWinsInTournament =
          db
            .prepare(
              `
          SELECT COUNT(*) as wins
          FROM bets b
          JOIN matches m ON b.match_id = m.id
          WHERE b.user_id = ?
          AND m.event_id = ?
          AND m.winner IS NOT NULL
          AND (
            (b.prediction = 'team1' AND m.winner = 'team1') OR
            (b.prediction = 'team2' AND m.winner = 'team2') OR
            (b.prediction = 'draw' AND m.winner = 'draw') OR
            (b.prediction = m.team1_name AND m.winner = 'team1') OR
            (b.prediction = m.team2_name AND m.winner = 'team2')
          )
        `
            )
            .get(participant.id, tournament.id)?.wins || 0;

        // Подсчитываем максимальные выигрыши в этом турнире (кто первый)
        const maxWinsInTournament =
          db
            .prepare(
              `
          SELECT MAX(wins) as max_wins
          FROM (
            SELECT 
              b.user_id,
              COUNT(*) as wins
            FROM bets b
            JOIN matches m ON b.match_id = m.id
            WHERE m.event_id = ?
            AND m.winner IS NOT NULL
            AND (
              (b.prediction = 'team1' AND m.winner = 'team1') OR
              (b.prediction = 'team2' AND m.winner = 'team2') OR
              (b.prediction = 'draw' AND m.winner = 'draw') OR
              (b.prediction = m.team1_name AND m.winner = 'team1') OR
              (b.prediction = m.team2_name AND m.winner = 'team2')
            )
            GROUP BY b.user_id
          )
        `
            )
            .get(tournament.id)?.max_wins || 0;

        // Если участник имеет максимальные выигрыши в турнире — он победитель
        if (
          userWinsInTournament > 0 &&
          userWinsInTournament === maxWinsInTournament
        ) {
          tournament_wins++;
          won_icons.push(tournament.icon);
        }
      });

      return {
        ...participant,
        tournament_wins,
        won_icons,
      };
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Получить профиль пользователя
router.get("/api/user/:userId/profile", async (req, res) => {
  try {
    const { userId } = req.params;
    const viewerUsername = req.query.viewerUsername; // Кто смотрит профиль

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    
    // Отправляем уведомление админу если кто-то смотрит чужой профиль
    if (viewerUsername && viewerUsername !== user.username) {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
      
      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const message = `👁️ ПРОСМОТР ПРОФИЛЯ

👤 Кто смотрит: ${viewerUsername}
🎯 Чей профиль: ${user.username}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

        try {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: message,
            }),
          });
        } catch (error) {
          console.error("⚠️ Не удалось отправить уведомление о просмотре профиля:", error);
        }
      }
    }

    const bets = db
      .prepare(
        `
      SELECT 
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 1
          ELSE 0
        END) as total_bets,
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN
                       -- Базовое очко за угаданный результат (3 за финал, 1 за обычный матч)
                       CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
                       -- Дополнительное очко за угаданный счет
                       CASE 
                         WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                              ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                              sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
                         THEN 1 
                         ELSE 0 
                       END
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_bets,
        -- Количество угаданных ставок (для процента побед)
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_count,
        SUM(CASE 
          WHEN (m.winner IS NOT NULL OR fpr.id IS NOT NULL) THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN NOT ((b.prediction = 'team1' AND m.winner = 'team1') OR
                            (b.prediction = 'team2' AND m.winner = 'team2') OR
                            (b.prediction = 'draw' AND m.winner = 'draw') OR
                            (b.prediction = m.team1_name AND m.winner = 'team1') OR
                            (b.prediction = m.team2_name AND m.winner = 'team2')) THEN 1 
                  ELSE 0 
                END
              -- Финальные параметры
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) != fpr.yellow_cards THEN 2
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) != fpr.red_cards THEN 2
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) != fpr.corners THEN 2
                  WHEN b.parameter_type = 'exact_score' AND b.prediction != fpr.exact_score THEN 2
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction != fpr.penalties_in_game THEN 2
                  WHEN b.parameter_type = 'extra_time' AND b.prediction != fpr.extra_time THEN 2
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction != fpr.penalties_at_end THEN 2
                  ELSE 0
                END
              ELSE 0 
            END 
          ELSE 0 
        END) as lost_bets,
        SUM(CASE 
          WHEN (b.is_final_bet = 0 AND m.winner IS NULL) OR 
               (b.is_final_bet = 1 AND fpr.id IS NULL) THEN 1 
          ELSE 0 
        END) as pending_bets
      FROM bets b
      LEFT JOIN matches m ON b.match_id = m.id
      LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN match_scores ms ON b.match_id = ms.match_id
      WHERE b.user_id = ?
    `
      )
      .get(userId);

    const profile = {
      id: user.id,
      username: user.username,
      email: user.email,
      created_at: user.created_at,
      avatar: user.avatar || null,
      total_bets: bets.total_bets || 0,
      won_bets: bets.won_bets || 0,
      won_count: bets.won_count || 0,
      lost_bets: bets.lost_bets || 0,
      pending_bets: bets.pending_bets || 0,
    };

    // Подсчитываем количество побед в турнирах
    const tournamentWins = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM tournament_awards
        WHERE user_id = ?
      `
      )
      .get(userId);

    profile.tournament_wins = tournamentWins?.count || 0;

    // Рассчитываем максимальную серию угаданных ставок подряд
    const allBets = db
      .prepare(
        `
        SELECT 
          b.id,
          b.created_at,
          m.event_id,
          e.name as event_name,
          CASE 
            -- Обычные ставки
            WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
              CASE 
                WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                     (b.prediction = 'team2' AND m.winner = 'team2') OR
                     (b.prediction = 'draw' AND m.winner = 'draw') OR
                     (b.prediction = m.team1_name AND m.winner = 'team1') OR
                     (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
                ELSE 0
              END
            -- Финальные параметры
            WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
              CASE 
                WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                ELSE 0
              END
            ELSE NULL
          END as is_won
        FROM bets b
        LEFT JOIN matches m ON b.match_id = m.id
        LEFT JOIN events e ON m.event_id = e.id
        LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
        WHERE b.user_id = ? AND (m.winner IS NOT NULL OR fpr.id IS NOT NULL)
        ORDER BY b.created_at ASC
      `
      )
      .all(userId);

    let maxStreak = 0;
    let currentStreak = 0;
    let maxStreakEventId = null;
    let maxStreakEventName = null;
    let currentStreakEventId = null;

    allBets.forEach(bet => {
      if (bet.is_won === 1) {
        currentStreak++;
        if (currentStreak === 1) {
          currentStreakEventId = bet.event_id;
        }
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
          maxStreakEventId = currentStreakEventId;
          maxStreakEventName = bet.event_name;
        }
      } else {
        currentStreak = 0;
        currentStreakEventId = null;
      }
    });

    profile.max_win_streak = maxStreak;
    profile.max_win_streak_event = maxStreakEventName;

    // Подсчитываем статистику по сетке плей-офф
    const bracketStats = db.prepare(`
      SELECT 
        COUNT(*) as total_bracket_predictions,
        SUM(CASE WHEN bp.predicted_winner = br.actual_winner THEN 1 ELSE 0 END) as correct_bracket_predictions,
        SUM(CASE WHEN bp.predicted_winner != br.actual_winner THEN 1 ELSE 0 END) as incorrect_bracket_predictions
      FROM bracket_predictions bp
      LEFT JOIN bracket_results br ON bp.bracket_id = br.bracket_id 
        AND bp.stage = br.stage 
        AND bp.match_index = br.match_index
      WHERE bp.user_id = ? AND br.actual_winner IS NOT NULL
    `).get(userId);

    profile.bracket_correct = bracketStats?.correct_bracket_predictions || 0;
    profile.bracket_incorrect = bracketStats?.incorrect_bracket_predictions || 0;

    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Получить награды пользователя
router.get("/api/user/:userId/awards", (req, res) => {
  try {
    const { userId } = req.params;

    const awards = db
      .prepare(
        `
      SELECT ta.id, ta.event_name, ta.won_bets, ta.awarded_at, e.icon as event_icon
      FROM tournament_awards ta
      LEFT JOIN events e ON ta.event_id = e.id
      WHERE ta.user_id = ?
      ORDER BY ta.awarded_at DESC
    `
      )
      .all(userId);

    console.log(`📦 Получены награды для пользователя ${userId}:`, awards);

    res.json(awards || []);
  } catch (error) {
    console.error("Ошибка при получении наград:", error);
    res.status(500).json({ error: error.message });
  }
});

// 11. Уведомление админу о сравнении участников
router.post("/api/notify-comparison", async (req, res) => {
  try {
    const { viewerUsername, user1Username, user2Username, eventName } = req.body;

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      const message = `⚖️ СРАВНЕНИЕ УЧАСТНИКОВ

👤 Кто сравнивает: ${viewerUsername}
🆚 Сравнивает: ${user1Username} vs ${user2Username}
${eventName ? `🏆 Турнир: ${eventName}` : '🌐 Глобальное сравнение'}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

      try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_ADMIN_ID,
            text: message,
          }),
        });
        console.log("✅ Уведомление о сравнении отправлено админу");
      } catch (error) {
        console.error("⚠️ Не удалось отправить уведомление о сравнении:", error);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Ошибка при отправке уведомления о сравнении:", error);
    res.status(500).json({ error: error.message });
  }
});

// 12. Уведомление админу об открытии информации о турнире
router.post("/api/notify-tournament-info", async (req, res) => {
  try {
    const { username, eventName } = req.body;

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      const message = `ℹ️ ПРОСМОТР ИНФОРМАЦИИ О ТУРНИРЕ

👤 Пользователь: ${username}
${eventName ? `🏆 Турнир: ${eventName}` : ''}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

      try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_ADMIN_ID,
            text: message,
          }),
        });
        console.log("✅ Уведомление о просмотре информации отправлено админу");
      } catch (error) {
        console.error("⚠️ Не удалось отправить уведомление о просмотре информации:", error);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Ошибка при отправке уведомления о просмотре информации:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/avatar - Сохранить аватар пользователя
router.post("/api/user/:userId/avatar", (req, res) => {
  try {
    const { userId } = req.params;
    const { avatarData, fileType } = req.body;

    if (!avatarData) {
      return res.status(400).json({ error: "Данные аватара не предоставлены" });
    }

    // Определяем расширение файла на основе MIME type
    let extension = "png"; // По умолчанию PNG
    if (fileType === "image/jpeg" || fileType === "image/jpg") {
      extension = "jpg";
    }

    // Удаляем старый аватар если существует
    const user = db
      .prepare("SELECT avatar FROM users WHERE id = ?")
      .get(userId);
    if (user && user.avatar && user.avatar.startsWith("/img/avatar/")) {
      const oldFilename = user.avatar.split("/").pop();
      const oldFilepath = path.join(__dirname, "../../img", "avatar", oldFilename);
      try {
        if (fs.existsSync(oldFilepath)) {
          fs.unlinkSync(oldFilepath);
          console.log(`🗑️ Старый файл аватара удален: ${oldFilepath}`);
        }
      } catch (fileErr) {
        console.warn(`⚠️ Не удалось удалить старый файл: ${fileErr.message}`);
      }
    }

    // Конвертируем base64 в буфер
    const base64Data = avatarData.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Сохраняем файл в папку img/avatar/
    const filename = `user_${userId}_avatar.${extension}`;
    const filepath = path.join(__dirname, "../../img", "avatar", filename);

    fs.writeFileSync(filepath, buffer);

    // Сохраняем путь к файлу в БД
    const avatarPath = `/img/avatar/${filename}`;
    db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(
      avatarPath,
      userId
    );

    const finalSize = fs.statSync(filepath).size;
    res.json({
      success: true,
      message: "Аватар сохранен",
      avatarPath: avatarPath,
      fileSize: finalSize,
    });
  } catch (error) {
    console.error("Ошибка при сохранении аватара:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/user/:userId/avatar - Удалить аватар пользователя
router.delete("/api/user/:userId/avatar", (req, res) => {
  try {
    const { userId } = req.params;

    // Получаем текущий путь аватара
    const user = db
      .prepare("SELECT avatar FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Если есть аватар - удаляем файл
    if (user.avatar && user.avatar.startsWith("/img/avatar/")) {
      const filename = user.avatar.split("/").pop();
      const filepath = path.join(__dirname, "../../img", "avatar", filename);

      try {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
          console.log(`🗑️ Файл аватара удален: ${filepath}`);
        }
      } catch (fileErr) {
        console.warn(`⚠️ Не удалось удалить файл: ${fileErr.message}`);
      }
    }

    // Очищаем поле avatar в БД (устанавливаем NULL)
    db.prepare("UPDATE users SET avatar = NULL WHERE id = ?").run(userId);

    res.json({ success: true, message: "Аватар удален" });
  } catch (error) {
    console.error("Ошибка при удалении аватара:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/:userId/username - Изменить username пользователя
router.put("/api/user/:userId/username", async (req, res) => {
  try {
    const { userId } = req.params;
    const { username } = req.body;

    // Валидация
    if (!username || username.trim().length === 0) {
      return res.status(400).json({ error: "Имя не может быть пустым" });
    }
    if (username.length > 30) {
      return res
        .status(400)
        .json({ error: "Имя слишком длинное (макс 30 символов)" });
    }

    // Проверяем есть ли пользователь
    const user = db
      .prepare("SELECT id, username, telegram_id FROM users WHERE id = ?")
      .get(userId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Автоматически делаем первую букву заглавной
    const capitalizedUsername = username.charAt(0).toUpperCase() + username.slice(1);

    // Проверяем не используется ли это имя другим пользователем
    const existingUser = db
      .prepare("SELECT id FROM users WHERE username = ? AND id != ?")
      .get(capitalizedUsername, userId);

    if (existingUser) {
      return res.status(400).json({ error: "Это имя уже используется" });
    }

    // Проверка на запрещенные имена
    const forbiddenBase = capitalizedUsername.toLowerCase().replace(/[\s\d\.\-]/g, ''); // Убираем пробелы, цифры, точки, дефисы
    if (forbiddenBase === 'мемослав' || forbiddenBase === 'memoslav' || forbiddenBase === 'memoslave') {
      return res.status(400).json({ error: "Are you, ohuel tam?" });
    }

    // Обновляем имя
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(
      capitalizedUsername,
      userId
    );

    // Удаляем все сессии пользователя (разлогиниваем со всех устройств)
    const deletedSessions = db
      .prepare("DELETE FROM sessions WHERE user_id = ?")
      .run(userId);

    // Логируем
    console.log(
      `✅ Username изменён для пользователя ${userId}: "${user.username}" → "${capitalizedUsername}"`
    );
    console.log(`🔓 Удалено сессий: ${deletedSessions.changes}`);

    // Отправляем уведомление пользователю в Telegram если он привязал аккаунт
    if (user.telegram_id) {
      const userMessage = `👤 ИЗМЕНЕНИЕ ИМЕНИ

Ваше имя было успешно изменено:
• Старое имя: ${user.username}
• Новое имя: ${capitalizedUsername}

🔓 Вы были разлогинены со всех устройств (${deletedSessions.changes} сессий).
Войдите заново с новым именем.

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        if (TELEGRAM_BOT_TOKEN) {
          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: user.telegram_id,
                text: userMessage,
              }),
            }
          );
          console.log(`✅ Уведомление о смене имени отправлено пользователю ${capitalizedUsername}`);
        }
      } catch (error) {
        console.error("⚠️ Не удалось отправить уведомление пользователю:", error);
      }
    }

    // Отправляем уведомление админу в Telegram (не блокируем ответ)
    const notificationMessage = `👤 ПЕРЕИМЕНОВАНИЕ ПОЛЬЗОВАТЕЛЯ

📝 Пользователь самостоятельно изменил имя:
• Старое имя: ${user.username}
• Новое имя: ${capitalizedUsername}
• ID пользователя: ${userId}
• Удалено сессий: ${deletedSessions.changes}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

    // Отправляем уведомление асинхронно, не дожидаясь результата
    notifyAdmin(notificationMessage).catch(err => {
      console.error("⚠️ Не удалось отправить уведомление админу:", err);
    });

    res.json({ 
      success: true, 
      username: capitalizedUsername, 
      message: "Имя успешно изменено. Войдите заново с новым именем",
      deletedSessions: deletedSessions.changes
    });
  } catch (error) {
    console.error("Ошибка при изменении username:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/telegram - Получить Telegram username пользователя
router.get("/api/user/:userId/show-bets", (req, res) => {
  try {
    const { userId } = req.params;
    
    let user;
    
    // Пытаемся получить пользователя
    try {
      user = db
        .prepare("SELECT show_bets FROM users WHERE id = ?")
        .get(userId);
    } catch (error) {
      // Если колонка не существует, добавляем её
      if (error.message.includes("no such column: show_bets")) {
        console.log("⚠️ Колонка show_bets отсутствует, добавляем...");
        db.exec(`ALTER TABLE users ADD COLUMN show_bets TEXT DEFAULT 'always'`);
        console.log("✅ Колонка show_bets добавлена в таблицу users");
        
        // Повторно получаем пользователя
        user = db
          .prepare("SELECT show_bets FROM users WHERE id = ?")
          .get(userId);
      } else {
        throw error;
      }
    }

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const showBets = user.show_bets || 'always';

    res.json({
      show_bets: showBets,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении настройки show_bets:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/:userId/show-bets - Сохранить настройку показа ставок
router.put("/api/user/:userId/show-bets", async (req, res) => {
  try {
    const { userId } = req.params;
    const { show_bets } = req.body;

    if (!show_bets || !['always', 'after_start'].includes(show_bets)) {
      return res.status(400).json({ error: "Неверное значение show_bets" });
    }

    const user = db
      .prepare("SELECT username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем существование колонки и добавляем если нужно
    try {
      db.prepare("UPDATE users SET show_bets = ? WHERE id = ?").run(show_bets, userId);
    } catch (error) {
      // Если колонка не существует, добавляем её
      if (error.message.includes("no such column: show_bets")) {
        console.log("⚠️ Колонка show_bets отсутствует, добавляем...");
        db.exec(`ALTER TABLE users ADD COLUMN show_bets TEXT DEFAULT 'always'`);
        console.log("✅ Колонка show_bets добавлена в таблицу users");
        
        // Повторяем UPDATE
        db.prepare("UPDATE users SET show_bets = ? WHERE id = ?").run(show_bets, userId);
      } else {
        throw error;
      }
    }

    // Записываем в логи
    const showBetsNames = {
      'always': 'Да (всегда показывать)',
      'after_start': 'Только после начала матча'
    };
    
    writeBetLog("settings", {
      username: user.username,
      setting: "Показывать ставки другим",
      newValue: showBetsNames[show_bets] || show_bets
    });

    // Отправляем уведомление админу
    try {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const time = new Date().toLocaleString("ru-RU", {
          timeZone: "Europe/Moscow",
        });

        const showBetsNames = {
          'always': 'Да (всегда показывать)',
          'after_start': 'Только после начала матча'
        };

        const adminMessage = `👁️ ИЗМЕНЕНИЕ НАСТРОЙКИ ПОКАЗА СТАВОК

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Новая настройка: ${showBetsNames[show_bets] || show_bets}
🕐 Время: ${time}`;

        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: adminMessage,
            }),
          }
        );
      }
    } catch (err) {
      console.error(
        "⚠️ Ошибка отправки уведомления админу об изменении настройки показа ставок:",
        err.message
      );
    }

    res.json({ success: true, show_bets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/show-lucky-button - Получить настройку показа кнопки "Мне повезет"
router.get("/api/user/:userId/show-lucky-button", (req, res) => {
  try {
    const { userId } = req.params;
    
    let user;
    
    // Пытаемся получить пользователя
    try {
      user = db
        .prepare("SELECT show_lucky_button FROM users WHERE id = ?")
        .get(userId);
    } catch (error) {
      // Если колонка не существует, добавляем её
      if (error.message.includes("no such column: show_lucky_button")) {
        console.log("⚠️ Колонка show_lucky_button отсутствует, добавляем...");
        db.exec(`ALTER TABLE users ADD COLUMN show_lucky_button INTEGER DEFAULT 1`);
        console.log("✅ Колонка show_lucky_button добавлена в таблицу users");
        
        // Повторно получаем пользователя
        user = db
          .prepare("SELECT show_lucky_button FROM users WHERE id = ?")
          .get(userId);
      } else {
        throw error;
      }
    }

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const showLuckyButton = user.show_lucky_button !== undefined ? user.show_lucky_button : 1;

    res.json({
      show_lucky_button: showLuckyButton,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении настройки show_lucky_button:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/:userId/show-lucky-button - Сохранить настройку показа кнопки "Мне повезет"
router.put("/api/user/:userId/show-lucky-button", async (req, res) => {
  try {
    const { userId } = req.params;
    const { show_lucky_button } = req.body;

    if (show_lucky_button === undefined || ![0, 1].includes(show_lucky_button)) {
      return res.status(400).json({ error: "Неверное значение show_lucky_button" });
    }

    const user = db
      .prepare("SELECT username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем существование колонки и добавляем если нужно
    try {
      db.prepare("UPDATE users SET show_lucky_button = ? WHERE id = ?").run(show_lucky_button, userId);
    } catch (error) {
      // Если колонка не существует, добавляем её
      if (error.message.includes("no such column: show_lucky_button")) {
        console.log("⚠️ Колонка show_lucky_button отсутствует, добавляем...");
        db.exec(`ALTER TABLE users ADD COLUMN show_lucky_button INTEGER DEFAULT 1`);
        console.log("✅ Колонка show_lucky_button добавлена в таблицу users");
        
        // Повторяем UPDATE
        db.prepare("UPDATE users SET show_lucky_button = ? WHERE id = ?").run(show_lucky_button, userId);
      } else {
        throw error;
      }
    }

    // Записываем в логи
    const showLuckyButtonNames = {
      1: 'Показывать',
      0: 'Скрыть'
    };
    
    writeBetLog("settings", {
      username: user.username,
      setting: "'Мне повезет'",
      newValue: showLuckyButtonNames[show_lucky_button]
    });

    // Отправляем уведомление админу
    try {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const time = new Date().toLocaleString("ru-RU", {
          timeZone: "Europe/Moscow",
        });

        const showLuckyButtonNames = {
          1: 'Показывать',
          0: 'Скрыть'
        };

        const adminMessage = `🎲 ИЗМЕНЕНИЕ НАСТРОЙКИ КНОПКИ "МНЕ ПОВЕЗЕТ"

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Новая настройка: ${showLuckyButtonNames[show_lucky_button] || show_lucky_button}
🕐 Время: ${time}`;

        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: adminMessage,
            }),
          }
        );
      }
    } catch (err) {
      console.error(
        "⚠️ Ошибка отправки уведомления админу об изменении настройки кнопки Мне повезет:",
        err.message
      );
    }

    res.json({ success: true, show_lucky_button });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/show-xg-button - Получить настройку показа кнопки xG
router.get("/api/user/:userId/show-xg-button", (req, res) => {
  try {
    const { userId } = req.params;
    
    let user;
    
    // Пытаемся получить пользователя
    try {
      user = db
        .prepare("SELECT show_xg_button FROM users WHERE id = ?")
        .get(userId);
    } catch (error) {
      // Если колонка не существует, добавляем её
      if (error.message.includes("no such column: show_xg_button")) {
        console.log("⚠️ Колонка show_xg_button отсутствует, добавляем...");
        db.exec(`ALTER TABLE users ADD COLUMN show_xg_button INTEGER DEFAULT 1`);
        console.log("✅ Колонка show_xg_button добавлена в таблицу users");
        
        // Повторно получаем пользователя
        user = db
          .prepare("SELECT show_xg_button FROM users WHERE id = ?")
          .get(userId);
      } else {
        throw error;
      }
    }

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const showXgButton = user.show_xg_button !== undefined ? user.show_xg_button : 1;

    res.json({
      show_xg_button: showXgButton,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении настройки show_xg_button:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/:userId/show-xg-button - Сохранить настройку показа кнопки xG
router.put("/api/user/:userId/show-xg-button", async (req, res) => {
  try {
    const { userId } = req.params;
    const { show_xg_button } = req.body;

    if (show_xg_button === undefined || ![0, 1].includes(show_xg_button)) {
      return res.status(400).json({ error: "Неверное значение show_xg_button" });
    }

    const user = db
      .prepare("SELECT username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем существование колонки и добавляем если нужно
    try {
      db.prepare("UPDATE users SET show_xg_button = ? WHERE id = ?").run(show_xg_button, userId);
    } catch (error) {
      // Если колонка не существует, добавляем её
      if (error.message.includes("no such column: show_xg_button")) {
        console.log("⚠️ Колонка show_xg_button отсутствует, добавляем...");
        db.exec(`ALTER TABLE users ADD COLUMN show_xg_button INTEGER DEFAULT 1`);
        console.log("✅ Колонка show_xg_button добавлена в таблицу users");
        
        // Повторяем UPDATE
        db.prepare("UPDATE users SET show_xg_button = ? WHERE id = ?").run(show_xg_button, userId);
      } else {
        throw error;
      }
    }

    // Записываем в логи
    const showXgButtonNames = {
      1: 'Показывать',
      0: 'Скрыть'
    };
    
    writeBetLog("settings", {
      username: user.username,
      setting: "'Кнопка xG'",
      newValue: showXgButtonNames[show_xg_button]
    });

    // Отправляем уведомление админу
    try {
      await notifyAdmin(
        `🎯 <b>ИЗМЕНЕНИЕ НАСТРОЙКИ КНОПКИ XG</b>\n\n` +
        `👤 Пользователь: <b>${user.username}</b>\n` +
        `${user.telegram_username ? `📱 Telegram: @${user.telegram_username}\n` : ""}` +
        `✏️ Новая настройка: <b>${showXgButtonNames[show_xg_button] || show_xg_button}</b>\n` +
        `🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`
      );
    } catch (err) {
      console.error(
        "⚠️ Ошибка отправки уведомления админу об изменении настройки кнопки xG:",
        err.message
      );
    }

    res.json({ success: true, show_xg_button });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/notify-on-view - Получить настройку уведомлений о просмотре
router.get("/api/user/:userId/notify-on-view", (req, res) => {
  try {
    const { userId } = req.params;
    const user = db
      .prepare("SELECT notify_on_view FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({
      notify_on_view: user.notify_on_view !== undefined ? user.notify_on_view : 1,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/:userId/notify-on-view - Сохранить настройку уведомлений о просмотре
router.put("/api/user/:userId/notify-on-view", async (req, res) => {
  try {
    const { userId } = req.params;
    const { notify_on_view } = req.body;

    if (notify_on_view === undefined || ![0, 1].includes(notify_on_view)) {
      return res.status(400).json({ error: "Неверное значение notify_on_view" });
    }

    const user = db
      .prepare("SELECT username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    db.prepare("UPDATE users SET notify_on_view = ? WHERE id = ?").run(notify_on_view, userId);

    // Записываем в логи
    const notifyNames = {
      1: 'Включено',
      0: 'Отключено'
    };
    
    writeBetLog("settings", {
      username: user.username,
      setting: "'Уведомления о просмотре'",
      newValue: notifyNames[notify_on_view]
    });

    // Отправляем уведомление админу
    const time = new Date().toLocaleString("ru-RU", {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const message = 
      `⚙️ <b>ИЗМЕНЕНИЕ НАСТРОЕК</b>\n\n` +
      `👤 Пользователь: ${user.username}\n` +
      `${user.telegram_username ? `📱 Telegram: @${user.telegram_username}\n` : ""}` +
      `✏️ Настройка: 👀 Уведомления о просмотре\n` +
      `📊 Новое значение: ${notifyNames[notify_on_view]}\n` +
      `🕐 Время: ${time}`;

    try {
      await sendAdminNotification(message);
    } catch (error) {
      console.error("Ошибка отправки уведомления админу:", error);
    }

    res.json({ success: true, notify_on_view });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notify-view-bets - Уведомить пользователя о просмотре его ставок
router.post("/api/notify-view-bets", async (req, res) => {
  try {
    const { viewedUserId, eventId } = req.body;

    if (!viewedUserId || !eventId) {
      return res.status(400).json({ error: "Не указаны viewedUserId или eventId" });
    }

    // Получаем информацию о пользователе чьи ставки смотрят
    const user = db.prepare("SELECT username, telegram_username, notify_on_view FROM users WHERE id = ?").get(viewedUserId);
    
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем включены ли уведомления
    if (user.notify_on_view === 0) {
      return res.json({ success: true, notified: false, reason: "notifications_disabled" });
    }

    // Получаем информацию о турнире
    const event = db.prepare("SELECT name FROM events WHERE id = ?").get(eventId);
    
    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }

    // Отправляем уведомление пользователю
    if (user.telegram_username) {
      try {
        const cleanUsername = user.telegram_username.toLowerCase();
        const tgUser = db
          .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
          .get(cleanUsername);

        if (tgUser?.chat_id) {
          const time = new Date().toLocaleString("ru-RU", { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
          });

          const message = 
            `📊 <b>ПРОСМОТР СТАВОК</b>\n\n` +
            `👤 Твои ставки кто-то посмотрел, будь бдительнее, малютка ${user.username} ;-)\n\n` +
            `🏆 Турнир: ${event.name}\n` +
            `🕐 Время: ${time}`;

          await sendUserMessage(tgUser.chat_id, message);
          
          return res.json({ success: true, notified: true });
        }
      } catch (err) {
        console.error("⚠️ Ошибка отправки уведомления о просмотре ставок:", err.message);
        return res.status(500).json({ error: "Ошибка отправки уведомления" });
      }
    }

    res.json({ success: true, notified: false, reason: "no_telegram" });
  } catch (error) {
    console.error("❌ Ошибка в /api/notify-view-bets:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notify-view-bracket - Уведомить пользователя о просмотре его сетки
router.post("/api/notify-view-bracket", async (req, res) => {
  try {
    const { viewedUserId, eventId } = req.body;

    if (!viewedUserId || !eventId) {
      return res.status(400).json({ error: "Не указаны viewedUserId или eventId" });
    }

    // Получаем информацию о пользователе чью сетку смотрят
    const user = db.prepare("SELECT username, telegram_username, notify_on_view FROM users WHERE id = ?").get(viewedUserId);
    
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем включены ли уведомления
    if (user.notify_on_view === 0) {
      return res.json({ success: true, notified: false, reason: "notifications_disabled" });
    }

    // Получаем информацию о турнире
    const event = db.prepare("SELECT name FROM events WHERE id = ?").get(eventId);
    
    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }

    // Отправляем уведомление пользователю
    if (user.telegram_username) {
      try {
        const cleanUsername = user.telegram_username.toLowerCase();
        const tgUser = db
          .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
          .get(cleanUsername);

        if (tgUser?.chat_id) {
          const time = new Date().toLocaleString("ru-RU", { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
          });

          const message = 
            `🎯 <b>ПРОСМОТР СЕТКИ</b>\n\n` +
            `👤 Твою сетку кто-то посмотрел, будь бдительнее, малютка ${user.username} ;-)\n\n` +
            `🏆 Турнир: ${event.name}\n` +
            `🕐 Время: ${time}`;

          await sendUserMessage(tgUser.chat_id, message);
          
          return res.json({ success: true, notified: true });
        }
      } catch (err) {
        console.error("⚠️ Ошибка отправки уведомления о просмотре сетки:", err.message);
        return res.status(500).json({ error: "Ошибка отправки уведомления" });
      }
    }

    res.json({ success: true, notified: false, reason: "no_telegram" });
  } catch (error) {
    console.error("❌ Ошибка в /api/notify-view-bracket:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/event/:eventId/reminders - Получить настройки напоминаний для турнира
router.post("/api/notify-counting-results", async (req, res) => {
  try {
    const { dateFrom, dateTo, results } = req.body;

    if (!dateFrom || !dateTo || !results) {
      return res
        .status(400)
        .json({ error: "Не указаны обязательные параметры" });
    }

    // Группируем результаты по пользователям и считаем очки
    const userStats = {};

    results.forEach((result) => {
      const username = result.username;
      if (!userStats[username]) {
        userStats[username] = {
          points: 0,
          correctResults: 0,
          correctScores: 0
        };
      }
      
      if (result.isWon) {
        // Базовое очко за результат
        userStats[username].points++;
        userStats[username].correctResults++;
        
        // Проверяем угаданный счет
        if (result.scoreIsWon) {
          userStats[username].points++;
          userStats[username].correctScores++;
        }
      }
    });

    // Находим победителя (максимальное количество очков)
    let maxPoints = 0;
    let winner = null;
    Object.entries(userStats).forEach(([username, stats]) => {
      if (stats.points > maxPoints) {
        maxPoints = stats.points;
        winner = username;
      }
    });

    // Форматируем даты в дд.мм.гггг
    const formatDate = (dateStr) => {
      const date = new Date(dateStr);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}.${month}.${year}`;
    };

    // Формируем сообщение
    const dateStr = new Date().toLocaleDateString("ru-RU");
    let message = `📊 <b>Результаты подсчета ставок</b>\n\n`;
    message += `📅 Дата: ${dateStr}\n`;
    message += `📆 Период: ${formatDate(dateFrom)} - ${formatDate(dateTo)}\n\n`;

    if (winner) {
      const winnerStats = userStats[winner];
      message += `🏆 Победитель дня: <b>${winner}</b> (${winnerStats.points} ${winnerStats.points === 1 ? 'очко' : winnerStats.points < 5 ? 'очка' : 'очков'})\n\n`;
    }

    message += `📈 Статистика участников:\n`;
    Object.entries(userStats)
      .sort(([, a], [, b]) => b.points - a.points)
      .forEach(([username, stats]) => {
        const statsText = [];
        if (stats.correctResults > 0) {
          statsText.push(`✅ ${stats.correctResults}`);
        }
        if (stats.correctScores > 0) {
          statsText.push(`🎯 ${stats.correctScores}`);
        }
        const statsStr = statsText.length > 0 ? ` (${statsText.join(', ')})` : '';
        message += `• ${username}: ${stats.points} ${stats.points === 1 ? 'очко' : stats.points < 5 ? 'очка' : 'очков'}${statsStr}\n`;
      });

    // Отправляем сообщение только админу в Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
      console.error("❌ Telegram токен или admin ID не настроены");
      return res.status(500).json({ error: "Telegram не настроен" });
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_id: TELEGRAM_ADMIN_ID,
            text: message,
            parse_mode: "HTML",
          }),
        }
      );

      if (!response.ok) {
        console.error(
          `❌ Ошибка отправки админу ${TELEGRAM_ADMIN_ID}:`,
          response.statusText
        );
      } else {
        console.log(`✅ Уведомление отправлено админу ${TELEGRAM_ADMIN_ID}`);
      }
    } catch (error) {
      console.error(`❌ Ошибка отправки уведомления админу:`, error);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Ошибка при отправке уведомления:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
