import { Router } from 'express';
import { db } from '../database/db.js';
import { requireOwnership } from '../middleware/auth.js';
import { notifyAdmin } from '../services/notificationService.js';
import { writeBetLog } from '../utils/logger.js';
import { sendTournamentAnnouncementToUsers, notifyTournamentToGroup } from '../services/notificationService.js';

const router = Router();

// GET /api/config
router.get("/api/config", (req, res) => {
  const ADMIN_LOGIN = process.env.ADMIN_LOGIN;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  res.json({
    ADMIN_LOGIN: ADMIN_LOGIN || null,
    ADMIN_DB_NAME: ADMIN_DB_NAME || null,
  });
});

// GET /api/rounds-order/:eventId
router.get("/api/rounds-order/:eventId", (req, res) => {
  try {
    const { eventId } = req.params;
    const key = `rounds_order_${eventId}`;

    const setting = db
      .prepare("SELECT value FROM site_settings WHERE key = ?")
      .get(key);

    if (setting && setting.value) {
      res.json(JSON.parse(setting.value));
    } else {
      res.json([]);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/rounds-order
router.put("/api/admin/rounds-order", (req, res) => {
  try {
    const { rounds, event_id } = req.body;

    if (!Array.isArray(rounds)) {
      return res.status(400).json({ error: "rounds должен быть массивом" });
    }

    if (!event_id) {
      return res.status(400).json({ error: "event_id обязателен" });
    }

    const key = `rounds_order_${event_id}`;
    const value = JSON.stringify(rounds);

    db.prepare(
      `
      INSERT INTO site_settings (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `
    ).run(key, value, value);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/settings/show-tournament-winner
router.get("/api/settings/show-tournament-winner", (req, res) => {
  try {
    const setting = db
      .prepare(
        "SELECT value FROM site_settings WHERE key = 'show_tournament_winner'"
      )
      .get();

    const showWinner = setting
      ? setting.value === "1" || setting.value === "true"
      : true;
    res.json({ show_tournament_winner: showWinner });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/settings/show-tournament-winner
router.post("/api/settings/show-tournament-winner", async (req, res) => {
  try {
    const {
      show_tournament_winner,
      username = "Unknown",
      telegram_username = "Not set",
    } = req.body;

    if (typeof show_tournament_winner !== "boolean") {
      return res
        .status(400)
        .json({ error: "show_tournament_winner должен быть boolean" });
    }

    const value = show_tournament_winner ? "1" : "0";

    db.prepare(
      `
      INSERT INTO site_settings (key, value, updated_at) 
      VALUES ('show_tournament_winner', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `
    ).run(value, value);

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      try {
        const status = show_tournament_winner ? "✅ ВКЛЮЧЕН" : "❌ ВЫКЛЮЧЕН";
        const emoji = show_tournament_winner ? "🎯" : "🔒";
        const telegramDisplay =
          telegram_username && telegram_username !== "Not set"
            ? `@${telegram_username}`
            : telegram_username;
        const message = `${emoji} <b>Изменена настройка показа победителя</b>\n\n👤 Пользователь: ${username}\n📱 Telegram: ${telegramDisplay}\n\nПоказ победителя на завершённых турнирах: ${status}\n\n🕐 Время: ${new Date().toLocaleString(
          "ru-RU"
        )}`;

        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: message,
              parse_mode: "HTML",
            }),
          }
        );
        console.log(
          `📢 Уведомление админу отправлено: показ победителя ${status} (пользователь: ${username})`
        );
      } catch (err) {
        console.error("❌ Ошибка при отправке уведомления админу:", err);
      }
    }

    res.json({ success: true, show_tournament_winner });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/events
router.get("/api/events", (req, res) => {
  try {
    const events = db
      .prepare(
        `SELECT e.*, COUNT(m.id) as match_count 
         FROM events e 
         LEFT JOIN matches m ON e.id = m.event_id 
         GROUP BY e.id
         ORDER BY 
           CASE WHEN e.status = 'active' THEN 0 ELSE 1 END,
           e.start_date DESC, 
           e.created_at DESC`
      )
      .all();
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/events/:eventId
router.get("/api/events/:eventId", (req, res) => {
  try {
    const { eventId } = req.params;
    const event = db
      .prepare("SELECT * FROM events WHERE id = ?")
      .get(eventId);

    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }

    res.json(event);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/events/:eventId/tournament-participants
router.get("/api/events/:eventId/tournament-participants", (req, res) => {
  try {
    const { eventId } = req.params;

    const participants = db
      .prepare(
        `
      SELECT 
        u.id,
        u.username,
        u.avatar,
        u.show_bets,
        COUNT(DISTINCT b.id) as event_bets,
        (SUM(CASE 
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
                       END +
                       -- Очко за угаданную разницу голов (обычный матч, не ничья, не угадан точный счёт)
                       CASE
                         WHEN m.is_final = 0 AND m.winner != 'draw' AND
                              e.diff_goals_enabled = 1 AND
                              sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                              ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                              NOT (sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2) AND
                              (sp.score_team1 - sp.score_team2) = (ms.score_team1 - ms.score_team2)
                         THEN 1
                         ELSE 0
                       END +
                       -- Дополнительное очко за угаданные желтые карточки
                       CASE 
                         WHEN m.yellow_cards_prediction_enabled = 1 AND
                              cp.yellow_cards IS NOT NULL AND m.yellow_cards IS NOT NULL AND
                              cp.yellow_cards = m.yellow_cards
                         THEN 1
                         ELSE 0
                       END +
                       -- Дополнительное очко за угаданные красные карточки
                       CASE 
                         WHEN m.red_cards_prediction_enabled = 1 AND
                              cp.red_cards IS NOT NULL AND m.red_cards IS NOT NULL AND
                              cp.red_cards = m.red_cards
                         THEN 1
                         ELSE 0
                       END
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 2
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 2
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 2
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 2
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 2
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 2
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 2
                  WHEN b.parameter_type = 'goal_difference' AND CAST(b.prediction AS INTEGER) = CAST(fpr.goal_difference AS INTEGER) THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) + COALESCE((
          SELECT SUM(CASE WHEN bp.stage = 'final' THEN 3 ELSE 1 END)
          FROM bracket_predictions bp
          INNER JOIN bracket_results br ON bp.bracket_id = br.bracket_id 
            AND bp.stage = br.stage 
            AND bp.match_index = br.match_index
          INNER JOIN brackets bk ON bp.bracket_id = bk.id
          WHERE bp.user_id = u.id 
            AND bk.event_id = ?
            AND bp.predicted_winner = br.actual_winner
        ), 0)) as event_won,
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
                  WHEN b.parameter_type = 'goal_difference' AND CAST(b.prediction AS INTEGER) = CAST(fpr.goal_difference AS INTEGER) THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as event_won_count,
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
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) != fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) != fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) != fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction != fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction != fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction != fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction != fpr.penalties_at_end THEN 1
                  WHEN b.parameter_type = 'goal_difference' AND CAST(b.prediction AS INTEGER) != CAST(fpr.goal_difference AS INTEGER) THEN 1
                  ELSE 0
                END
              ELSE 0 
            END 
          ELSE 0 
        END) as event_lost,
        SUM(CASE 
          WHEN m.winner IS NULL AND fpr.id IS NULL 
            AND m.status NOT IN ('cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover') 
          THEN 1 
          ELSE 0 
        END) as event_pending
      FROM users u
      INNER JOIN bets b ON u.id = b.user_id
      INNER JOIN matches m ON b.match_id = m.id
      INNER JOIN events e ON m.event_id = e.id
      LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN match_scores ms ON b.match_id = ms.match_id
      LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
      WHERE m.event_id = ?
      GROUP BY u.id, u.username, u.avatar, u.show_bets
      HAVING COUNT(DISTINCT b.id) > 0
      ORDER BY event_won DESC, event_bets DESC, event_lost ASC
    `
      )
      .all(eventId, eventId);

    res.json(participants);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/events/:eventId/user-bets/:userId
router.get("/api/events/:eventId/user-bets/:userId", (req, res) => {
  try {
    const { eventId, userId } = req.params;

    const user = db.prepare("SELECT id, username, avatar FROM users WHERE id = ?").get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const bets = db.prepare(`
      SELECT 
        b.*,
        m.team1_name,
        m.team2_name,
        m.winner,
        m.match_date,
        m.round,
        CASE 
          WHEN m.winner IS NOT NULL THEN
            CASE 
              WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                   (b.prediction = 'team2' AND m.winner = 'team2') OR
                   (b.prediction = 'draw' AND m.winner = 'draw') OR
                   (b.prediction = m.team1_name AND m.winner = 'team1') OR
                   (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
              ELSE 0
            END
          ELSE NULL
        END as is_won,
        CASE 
          WHEN m.winner IS NOT NULL THEN
            CASE 
              WHEN NOT ((b.prediction = 'team1' AND m.winner = 'team1') OR
                        (b.prediction = 'team2' AND m.winner = 'team2') OR
                        (b.prediction = 'draw' AND m.winner = 'draw') OR
                        (b.prediction = m.team1_name AND m.winner = 'team1') OR
                        (b.prediction = m.team2_name AND m.winner = 'team2')) THEN 1
              ELSE 0
            END
          ELSE NULL
        END as is_lost
      FROM bets b
      INNER JOIN matches m ON b.match_id = m.id
      WHERE b.user_id = ? AND m.event_id = ?
      ORDER BY m.match_date ASC
    `).all(userId, eventId);

    const stats = db.prepare(`
      SELECT 
        COUNT(DISTINCT b.id) as event_bets,
        SUM(CASE 
          WHEN m.winner IS NOT NULL THEN
            CASE 
              WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                   (b.prediction = 'team2' AND m.winner = 'team2') OR
                   (b.prediction = 'draw' AND m.winner = 'draw') OR
                   (b.prediction = m.team1_name AND m.winner = 'team1') OR
                   (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
              ELSE 0
            END
          ELSE 0
        END) as event_won,
        SUM(CASE 
          WHEN m.winner IS NOT NULL THEN
            CASE 
              WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                   (b.prediction = 'team2' AND m.winner = 'team2') OR
                   (b.prediction = 'draw' AND m.winner = 'draw') OR
                   (b.prediction = m.team1_name AND m.winner = 'team1') OR
                   (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
              ELSE 0
            END
          ELSE 0
        END) as event_won_count,
        SUM(CASE 
          WHEN m.winner IS NOT NULL THEN
            CASE 
              WHEN NOT ((b.prediction = 'team1' AND m.winner = 'team1') OR
                        (b.prediction = 'team2' AND m.winner = 'team2') OR
                        (b.prediction = 'draw' AND m.winner = 'draw') OR
                        (b.prediction = m.team1_name AND m.winner = 'team1') OR
                        (b.prediction = m.team2_name AND m.winner = 'team2')) THEN 1
              ELSE 0
            END
          ELSE 0
        END) as event_lost,
        SUM(CASE 
          WHEN m.winner IS NULL 
            AND m.status NOT IN ('cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover') 
          THEN 1 
          ELSE 0 
        END) as event_pending
      FROM bets b
      INNER JOIN matches m ON b.match_id = m.id
      WHERE b.user_id = ? AND m.event_id = ?
    `).get(userId, eventId);

    const formattedBets = bets.map(bet => ({
      ...bet,
      round: bet.round,
      match: {
        team1_name: bet.team1_name,
        team2_name: bet.team2_name,
        winner: bet.winner,
        match_date: bet.match_date
      }
    }));

    res.json({
      user,
      bets: formattedBets,
      stats: stats || { event_bets: 0, event_won: 0, event_won_count: 0, event_lost: 0, event_pending: 0 }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/events/:eventId/tournament-winner
router.get("/api/events/:eventId/tournament-winner", (req, res) => {
  try {
    const { eventId } = req.params;

    const event = db
      .prepare("SELECT id, name, icon FROM events WHERE id = ?")
      .get(eventId);

    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }

    // Ищем победителя через tournament_awards
    const tournamentAward = db
      .prepare(
        `
        SELECT ta.id, ta.user_id, ta.event_id, ta.event_name, ta.won_bets, ta.awarded_at as created_at, 
               u.username, u.avatar_path, u.avatar
        FROM tournament_awards ta
        JOIN users u ON ta.user_id = u.id
        WHERE ta.event_id = ?
        ORDER BY ta.won_bets DESC, ta.awarded_at ASC
        LIMIT 1
      `
      )
      .get(eventId);

    let winnerId = null;

    if (tournamentAward) {
      winnerId = tournamentAward.user_id;
    } else {
      // Ищем через awards
      const award = db
        .prepare(`SELECT user_id FROM awards WHERE event_id = ? ORDER BY created_at ASC LIMIT 1`)
        .get(eventId);
      if (award) winnerId = award.user_id;
    }

    if (!winnerId) {
      return res.json({
        tournament: event,
        winner: null,
        message: "Победитель отсутствует",
      });
    }

    // Получаем данные пользователя
    const user = db.prepare("SELECT id, username, avatar_path, avatar FROM users WHERE id = ?").get(winnerId);
    if (!user) {
      return res.json({ tournament: event, winner: null, message: "Пользователь не найден" });
    }

    // Считаем полную статистику победителя в этом турнире
    const stats = db.prepare(`
      SELECT 
        COUNT(DISTINCT b.id) as total_bets,
        (SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN
                       CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
                       CASE 
                         WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                              ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                              sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
                         THEN 1 ELSE 0 
                       END +
                       CASE
                         WHEN m.is_final = 0 AND m.winner != 'draw' AND
                              e.diff_goals_enabled = 1 AND
                              sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                              ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                              NOT (sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2) AND
                              (sp.score_team1 - sp.score_team2) = (ms.score_team1 - ms.score_team2)
                         THEN 1 ELSE 0
                       END +
                       CASE 
                         WHEN m.yellow_cards_prediction_enabled = 1 AND
                              cp.yellow_cards IS NOT NULL AND m.yellow_cards IS NOT NULL AND
                              cp.yellow_cards = m.yellow_cards
                         THEN 1 ELSE 0
                       END +
                       CASE 
                         WHEN m.red_cards_prediction_enabled = 1 AND
                              cp.red_cards IS NOT NULL AND m.red_cards IS NOT NULL AND
                              cp.red_cards = m.red_cards
                         THEN 1 ELSE 0
                       END
                  ELSE 0 
                END
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 2
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 2
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 2
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 2
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 2
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 2
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 2
                  WHEN b.parameter_type = 'goal_difference' AND CAST(b.prediction AS INTEGER) = CAST(fpr.goal_difference AS INTEGER) THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) + COALESCE((
          SELECT SUM(CASE WHEN bp.stage = 'final' THEN 3 ELSE 1 END)
          FROM bracket_predictions bp
          INNER JOIN bracket_results br ON bp.bracket_id = br.bracket_id 
            AND bp.stage = br.stage 
            AND bp.match_index = br.match_index
          INNER JOIN brackets bk ON bp.bracket_id = bk.id
          WHERE bp.user_id = ?
            AND bk.event_id = ?
            AND bp.predicted_winner = br.actual_winner
        ), 0)) as total_points,
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
                  ELSE 0 
                END
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  WHEN b.parameter_type = 'goal_difference' AND CAST(b.prediction AS INTEGER) = CAST(fpr.goal_difference AS INTEGER) THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_count,
        SUM(CASE 
          WHEN (m.winner IS NOT NULL OR fpr.id IS NOT NULL) THEN 
            CASE 
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN NOT ((b.prediction = 'team1' AND m.winner = 'team1') OR
                            (b.prediction = 'team2' AND m.winner = 'team2') OR
                            (b.prediction = 'draw' AND m.winner = 'draw') OR
                            (b.prediction = m.team1_name AND m.winner = 'team1') OR
                            (b.prediction = m.team2_name AND m.winner = 'team2')) THEN 1 
                  ELSE 0 
                End
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) != fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) != fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) != fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction != fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction != fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction != fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction != fpr.penalties_at_end THEN 1
                  WHEN b.parameter_type = 'goal_difference' AND CAST(b.prediction AS INTEGER) != CAST(fpr.goal_difference AS INTEGER) THEN 1
                  ELSE 0
                END
              ELSE 0 
            END 
          ELSE 0 
        END) as lost_count
      FROM bets b
      INNER JOIN matches m ON b.match_id = m.id
      INNER JOIN events e ON m.event_id = e.id
      LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN match_scores ms ON b.match_id = ms.match_id
      LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
      WHERE b.user_id = ? AND m.event_id = ?
    `).get(winnerId, eventId, winnerId, eventId);

    const totalBets = stats?.total_bets || 0;
    const totalPoints = stats?.total_points || 0;
    const wonCount = stats?.won_count || 0;
    const lostCount = stats?.lost_count || 0;
    const accuracy = totalBets > 0 ? Math.round((wonCount / totalBets) * 100) : 0;

    res.json({
      tournament: event,
      winner: {
        user_id: user.id,
        username: user.username,
        avatar_path: user.avatar_path,
        avatar: user.avatar,
        totalBets,
        totalPoints,
        wonCount,
        lostCount,
        accuracy
      },
    });
  } catch (error) {
    console.error("❌ Ошибка в endpoint tournament-winner:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/events/:eventId/award
router.post("/api/events/:eventId/award", (req, res) => {
  try {
    const { eventId } = req.params;
    const { user_id, description, won_bets_count } = req.body;

    if (!user_id || !description) {
      return res.status(400).json({
        error: "Требуются: user_id, description",
      });
    }

    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(user_id);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const event = db.prepare("SELECT id FROM events WHERE id = ?").get(eventId);

    if (!event) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    const stmt = db.prepare(
      `INSERT INTO awards (user_id, event_id, description, won_bets_count, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    );

    const result = stmt.run(user_id, eventId, description, won_bets_count || 0);

    writeBetLog("settings", {
      username: "Admin",
      setting: "Tournament Award",
      oldValue: null,
      newValue: `${description} для пользователя ${user_id}`,
    });

    res.json({
      success: true,
      message: "Награда добавлена",
      awardId: result.lastInsertRowid,
    });
  } catch (error) {
    console.error("❌ Ошибка при добавлении награды:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/event/:eventId/participant/:userId/bets
router.get("/api/event/:eventId/participant/:userId/bets", async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const userId = parseInt(req.params.userId);
    const viewerUserId = req.query.viewerId ? parseInt(req.query.viewerId) : null;
    const viewerUsername = req.query.viewerUsername || null;

    const event = db
      .prepare("SELECT name FROM events WHERE id = ?")
      .get(eventId);

    const userSettings = db
      .prepare("SELECT show_bets, username FROM users WHERE id = ?")
      .get(userId);

    const showBets = userSettings?.show_bets || 'always';
    const isOwner = viewerUserId === userId;

    if (!isOwner && viewerUserId && viewerUsername && userSettings) {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const message = `📊 ПРОСМОТР СТАВОК

👤 Кто смотрит: ${viewerUsername}
🎯 Чьи ставки: ${userSettings.username}
🏆 Турнир: ${event?.name || 'Неизвестно'}

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
          console.error("⚠️ Не удалось отправить уведомление о просмотре ставок:", error);
        }
      }
    }

    const rounds = db
      .prepare(
        `
        SELECT DISTINCT m.round
        FROM matches m
        WHERE m.event_id = ? AND m.round IS NOT NULL
      `
      )
      .all(eventId)
      .map((r) => r.round)
      .filter((r) => r);

    // Сортируем по сохранённому порядку туров
    const roundsOrderKey = `rounds_order_${eventId}`;
    const roundsOrderSetting = db.prepare("SELECT value FROM site_settings WHERE key = ?").get(roundsOrderKey);
    const savedOrder = roundsOrderSetting ? JSON.parse(roundsOrderSetting.value) : [];

    rounds.sort((a, b) => {
      const indexA = savedOrder.indexOf(a);
      const indexB = savedOrder.indexOf(b);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return 0;
    });

    const completedRounds = db
      .prepare(
        `
        SELECT DISTINCT m.round
        FROM matches m
        WHERE m.event_id = ? 
          AND m.round IS NOT NULL
          AND m.round IN (
            SELECT round 
            FROM matches 
            WHERE event_id = ? 
              AND round IS NOT NULL
            GROUP BY round
            HAVING COUNT(*) = SUM(
              CASE 
                WHEN winner IS NOT NULL THEN 1
                WHEN status IN ('cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover') THEN 1
                ELSE 0 
              END
            )
          )
      `
      )
      .all(eventId, eventId)
      .map((r) => r.round);

    const bets = db
      .prepare(
        `
        SELECT 
          b.id,
          b.prediction,
          m.team1_name as team1,
          m.team2_name as team2,
          m.winner,
          m.status as match_status,
          m.round as round,
          m.match_date,
          0 as is_final_bet,
          e.diff_goals_enabled,
          CASE WHEN m.score_prediction_enabled = 1 THEN sp.score_team1 ELSE NULL END as score_team1,
          CASE WHEN m.score_prediction_enabled = 1 THEN sp.score_team2 ELSE NULL END as score_team2,
          ms.score_team1 as actual_score_team1,
          ms.score_team2 as actual_score_team2,
          CASE WHEN m.yellow_cards_prediction_enabled = 1 THEN cp.yellow_cards ELSE NULL END as yellow_cards,
          CASE WHEN m.red_cards_prediction_enabled = 1 THEN cp.red_cards ELSE NULL END as red_cards,
          m.yellow_cards as actual_yellow_cards,
          m.red_cards as actual_red_cards,
          CASE 
            WHEN b.prediction = 'team1' THEN m.team1_name
            WHEN b.prediction = 'team2' THEN m.team2_name
            WHEN b.prediction = 'draw' THEN 'Ничья'
            ELSE b.prediction
          END as prediction_display,
          CASE 
            WHEN m.winner IS NULL THEN 'pending'
            WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                 (b.prediction = 'team2' AND m.winner = 'team2') OR
                 (b.prediction = 'draw' AND m.winner = 'draw') OR
                 (b.prediction = m.team1_name AND m.winner = 'team1') OR
                 (b.prediction = m.team2_name AND m.winner = 'team2') THEN 'won'
            ELSE 'lost'
          END as result,
          CASE 
            WHEN m.winner = 'team1' THEN m.team1_name
            WHEN m.winner = 'team2' THEN m.team2_name
            WHEN m.winner = 'draw' THEN 'Ничья'
            ELSE NULL
          END as actual_result
        FROM bets b
        JOIN matches m ON b.match_id = m.id
        JOIN events e ON m.event_id = e.id
        LEFT JOIN score_predictions sp ON sp.user_id = b.user_id AND sp.match_id = b.match_id
        LEFT JOIN match_scores ms ON ms.match_id = b.match_id
        LEFT JOIN cards_predictions cp ON cp.user_id = b.user_id AND cp.match_id = b.match_id
        WHERE m.event_id = ? AND b.user_id = ? AND b.is_final_bet = 0
        ORDER BY m.id ASC
      `
      )
      .all(eventId, userId);

    const finalBets = db
      .prepare(
        `
        SELECT 
          b.id,
          b.prediction,
          m.team1_name as team1,
          m.team2_name as team2,
          m.winner,
          m.status as match_status,
          m.round as round,
          m.match_date,
          1 as is_final_bet,
          b.parameter_type,
          CASE 
            WHEN b.parameter_type = 'yellow_cards' THEN 'Жёлтые карточки: ' || b.prediction
            WHEN b.parameter_type = 'red_cards' THEN 'Красные карточки: ' || b.prediction
            WHEN b.parameter_type = 'corners' THEN 'Угловые: ' || b.prediction
            WHEN b.parameter_type = 'exact_score' THEN 'Точный счёт: ' || b.prediction
            WHEN b.parameter_type = 'penalties_in_game' THEN 'Пенальти в матче: ' || b.prediction
            WHEN b.parameter_type = 'extra_time' THEN 'Доп. время: ' || b.prediction
            WHEN b.parameter_type = 'penalties_at_end' THEN 'Пенальти в конце: ' || b.prediction
            ELSE b.prediction
          END as prediction_display,
          CASE 
            WHEN fpr.id IS NULL THEN 'pending'
            WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 'won'
            WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 'won'
            WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 'won'
            WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 'won'
            WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 'won'
            WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 'won'
            WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 'won'
            WHEN b.parameter_type = 'goal_difference' AND CAST(b.prediction AS INTEGER) = CAST(fpr.goal_difference AS INTEGER) THEN 'won'
            ELSE 'lost'
          END as result,
          CASE 
            WHEN b.parameter_type = 'yellow_cards' THEN 'Жёлтых: ' || COALESCE(fpr.yellow_cards, '?')
            WHEN b.parameter_type = 'red_cards' THEN 'Красных: ' || COALESCE(fpr.red_cards, '?')
            WHEN b.parameter_type = 'corners' THEN 'Угловых: ' || COALESCE(fpr.corners, '?')
            WHEN b.parameter_type = 'exact_score' THEN 'Счёт: ' || COALESCE(fpr.exact_score, '?')
            WHEN b.parameter_type = 'penalties_in_game' THEN COALESCE(fpr.penalties_in_game, '?')
            WHEN b.parameter_type = 'extra_time' THEN COALESCE(fpr.extra_time, '?')
            WHEN b.parameter_type = 'penalties_at_end' THEN COALESCE(fpr.penalties_at_end, '?')
            WHEN b.parameter_type = 'goal_difference' THEN COALESCE(fpr.goal_difference, '?')
            ELSE NULL
          END as actual_result
        FROM bets b
        JOIN matches m ON b.match_id = m.id
        LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id
        WHERE m.event_id = ? AND b.user_id = ? AND b.is_final_bet = 1
        ORDER BY m.id ASC
      `
      )
      .all(eventId, userId);

    let allBets = [...bets, ...finalBets];

    if (showBets === 'after_start' && !isOwner) {
      const now = new Date();
      allBets = allBets.map(bet => {
        if (!bet.match_date) {
          return { ...bet, is_hidden: true };
        }
        const matchDate = new Date(bet.match_date);
        if (matchDate > now) {
          return { ...bet, is_hidden: true };
        }
        return { ...bet, is_hidden: false };
      });
    } else {
      allBets = allBets.map(bet => ({ ...bet, is_hidden: false }));
    }

    res.json({
      rounds: rounds.length > 0 ? rounds : [],
      bets: allBets,
      show_bets: showBets,
      event_name: event?.name || 'Турнир',
      completed_rounds: completedRounds,
    });
  } catch (error) {
    console.error(
      "Ошибка в /api/event/:eventId/participant/:userId/bets:",
      error
    );
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/all-events
router.get("/api/admin/all-events", (req, res) => {
  try {
    const events = db
      .prepare(
        `SELECT e.*, COUNT(m.id) as match_count 
         FROM events e 
         LEFT JOIN matches m ON e.id = m.event_id 
         GROUP BY e.id
         ORDER BY e.status DESC, e.start_date DESC`
      )
      .all();
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/:userId/settings
router.put("/api/user/:userId/settings", requireOwnership, async (req, res) => {
  try {
    const { userId } = req.params;
    const { telegram_notifications_enabled, telegram_group_reminders_enabled, theme, require_login_2fa, live_sound } =
      req.body;

    const user = db
      .prepare("SELECT id, username, telegram_username, theme FROM users WHERE id = ?")
      .get(userId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    if (require_login_2fa !== undefined) {
      const login2faEnabled = require_login_2fa ? 1 : 0;

      const oldValue = db.prepare("SELECT require_login_2fa FROM users WHERE id = ?").get(userId);

      db.prepare(
        "UPDATE users SET require_login_2fa = ? WHERE id = ?"
      ).run(login2faEnabled, userId);

      writeBetLog("settings", {
        username: user.username,
        setting: "Login 2FA",
        oldValue: oldValue?.require_login_2fa ? "Включено" : "Отключено",
        newValue: login2faEnabled ? "Включено" : "Отключено",
      });

      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
          const time = new Date().toLocaleString("ru-RU");
          const statusIcon = login2faEnabled ? '🔐' : '🔓';
          const statusText = login2faEnabled ? 'Включено' : 'Отключено';

          const adminMessage = `${statusIcon} ИЗМЕНЕНИЕ НАСТРОЙКИ 2FA

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Подтверждение логина через бота: ${statusText}
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
          "⚠️ Ошибка отправки уведомления админу об изменении 2FA:",
          err.message
        );
      }
    }

    if (theme !== undefined) {
      const oldTheme = user.theme || 'theme-default';
      db.prepare(
        "UPDATE users SET theme = ? WHERE id = ?"
      ).run(theme, userId);

      writeBetLog("settings", {
        username: user.username,
        setting: "Theme",
        oldValue: oldTheme,
        newValue: theme,
      });

      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
          const time = new Date().toLocaleString("ru-RU");
          const themeNames = {
            'theme-default': 'Дефолтная',
            'theme-hacker-green': '💻 Hacker Green',
            'theme-solarized': '🌅 Solarized',
            'theme-matrix': '🟢 Matrix',
            'theme-cyberpunk': '🌃 Cyberpunk',
            'theme-leagueChampions': '🏆 League Champions',
            'theme-leagueEurope': '⭐ League Europe',
            'theme-cream-material': '☀️ Cream Material'
          };

          const adminMessage = `🎨 ИЗМЕНЕНИЕ ТЕМЫ

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Новая тема: ${themeNames[theme] || theme}
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
          "⚠️ Ошибка отправки уведомления админу об изменении темы:",
          err.message
        );
      }
    }

    if (telegram_notifications_enabled !== undefined) {
      const notificationEnabled = telegram_notifications_enabled ? 1 : 0;
      db.prepare(
        "UPDATE users SET telegram_notifications_enabled = ? WHERE id = ?"
      ).run(notificationEnabled, userId);

      if (user.telegram_username) {
        try {
          const cleanUsername = user.telegram_username.toLowerCase();
          const tgUser = db
            .prepare(
              "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?"
            )
            .get(cleanUsername);

          if (tgUser?.chat_id) {
            let notificationMessage;

            if (notificationEnabled === 0) {
              notificationMessage =
                `🔕 <b>УВЕДОМЛЕНИЯ ОТКЛЮЧЕНЫ</b>\n\n` +
                `Личные уведомления о ставках и результатах отключены.\n\n` +
                `Вы можете включить их снова в настройках профиля.\n\n` +
                `⏰ ${new Date().toLocaleString("ru-RU")}`;
            } else {
              notificationMessage =
                `🔔 <b>УВЕДОМЛЕНИЯ ВКЛЮЧЕНЫ</b>\n\n` +
                `Личные уведомления о ставках и результатах включены!\n\n` +
                `Теперь ты будешь получать сообщения при создании и удалении ставок.\n\n` +
                `⏰ ${new Date().toLocaleString("ru-RU")}`;
            }

            await sendUserMessage(tgUser.chat_id, notificationMessage);
          }
        } catch (err) {
          console.error(
            "⚠️ Ошибка отправки сообщения об изменении уведомлений:",
            err.message
          );
        }
      }

      writeBetLog("settings", {
        username: user.username,
        setting: "Telegram Notifications",
        oldValue: null,
        newValue: notificationEnabled ? "Включены" : "Отключены",
      });

      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
          const time = new Date().toLocaleString("ru-RU");
          const action = notificationEnabled ? "ВКЛЮЧИЛ" : "ОТКЛЮЧИЛ";
          const emoji = notificationEnabled ? "🔔" : "🔕";

          const adminMessage = `${emoji} ИЗМЕНЕНИЕ УВЕДОМЛЕНИЙ

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Действие: ${action} уведомления
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
          "⚠️ Ошибка отправки уведомления админу об уведомлениях:",
          err.message
        );
      }
    }

    if (telegram_group_reminders_enabled !== undefined) {
      const groupRemindersEnabled = telegram_group_reminders_enabled ? 1 : 0;
      db.prepare(
        "UPDATE users SET telegram_group_reminders_enabled = ? WHERE id = ?"
      ).run(groupRemindersEnabled, userId);

      writeBetLog("settings", {
        username: user.username,
        setting: "Telegram Group Reminders",
        oldValue: null,
        newValue: groupRemindersEnabled ? "Включены" : "Отключены",
      });

      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
          const time = new Date().toLocaleString("ru-RU");
          const action = groupRemindersEnabled ? "ВКЛЮЧИЛ" : "ОТКЛЮЧИЛ";
          const emoji = groupRemindersEnabled ? "👥" : "🔇";

          const adminMessage = `${emoji} ИЗМЕНЕНИЕ НАПОМИНАНИЙ В ГРУППЕ

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Действие: ${action} напоминания в группе
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
          "⚠️ Ошибка отправки уведомления админу о напоминаниях в группе:",
          err.message
        );
      }
    }

    if (live_sound !== undefined) {
      const liveSoundEnabled = live_sound ? 1 : 0;

      const oldValue = db.prepare("SELECT live_sound FROM users WHERE id = ?").get(userId);

      db.prepare(
        "UPDATE users SET live_sound = ? WHERE id = ?"
      ).run(liveSoundEnabled, userId);

      writeBetLog("settings", {
        username: user.username,
        setting: "Live Sound",
        oldValue: oldValue?.live_sound ? "Включен" : "Отключен",
        newValue: liveSoundEnabled ? "Включен" : "Отключен",
      });

      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
          const time = new Date().toLocaleString("ru-RU");
          const statusIcon = liveSoundEnabled ? '🔊' : '🔇';
          const statusText = liveSoundEnabled ? 'Включен' : 'Отключен';

          const adminMessage = `${statusIcon} ИЗМЕНЕНИЕ НАСТРОЙКИ ЗВУКА LIVE

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Звук в LIVE матчах: ${statusText}
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
          "⚠️ Ошибка отправки уведомления админу об изменении звука LIVE:",
          err.message
        );
      }
    }

    res.json({
      success: true,
      message: "Настройки сохранены",
      telegram_notifications_enabled: telegram_notifications_enabled,
      telegram_group_reminders_enabled: telegram_group_reminders_enabled,
      theme: theme,
      live_sound: live_sound,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/notifications
router.get("/api/user/:userId/notifications", (req, res) => {
  try {
    const { userId } = req.params;
    const user = db
      .prepare(
        "SELECT telegram_notifications_enabled, telegram_group_reminders_enabled, theme, live_sound FROM users WHERE id = ?"
      )
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({
      telegram_notifications_enabled: user.telegram_notifications_enabled === 1,
      telegram_group_reminders_enabled:
        user.telegram_group_reminders_enabled === 1,
      theme: user.theme || 'theme-default',
      live_sound: user.live_sound === 1,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/events
router.post("/api/admin/events", async (req, res) => {
  const {
    username,
    name,
    description,
    start_date,
    end_date,
    icon,
    background_color,
    team_file,
    sendToUsers,
    sendToGroup,
    weight_category_id,
    diff_goals_enabled,
  } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;

  const isAdminUser = req.authenticatedUsername === ADMIN_DB_NAME;
  let isModerator = false;

  if (!isAdminUser) {
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);

    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("create_tournaments");
    }

    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  if (!name) {
    return res.status(400).json({ error: "Название турнира обязательно" });
  }

  try {
    const result = db
      .prepare(
        `
      INSERT INTO events (name, description, start_date, end_date, icon, background_color, team_file, weight_category_id, diff_goals_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        name,
        description || null,
        start_date || null,
        end_date || null,
        icon || null,
        background_color || null,
        team_file || null,
        weight_category_id || null,
        diff_goals_enabled != null ? diff_goals_enabled : 1
      );

    if (isModerator && username) {
      const details = `🏆 Турнир: ${name}
📝 Описание: ${description || 'не указано'}
📅 Даты: ${start_date || 'не указана'} - ${end_date || 'не указана'}`;

      await notifyModeratorAction(username, "Создание турнира", details);

      writeBetLog("tournament_created", {
        moderator: username,
        name: name,
        dates: start_date && end_date ? `${start_date} - ${end_date}` : null
      });
    }

    if (sendToUsers) {
      try {
        await sendTournamentAnnouncementToUsers(result.lastInsertRowid, name, description, start_date, end_date);
      } catch (error) {
        console.error("❌ Ошибка отправки объявления пользователям:", error);
      }
    }

    if (sendToGroup) {
      try {
        await notifyTournamentToGroup(result.lastInsertRowid, name, description, start_date, end_date);
      } catch (error) {
        console.error("❌ Ошибка отправки объявления в группу:", error);
      }
    }

    try {
      const newsTitle = `Новый турнир: ${name}`;
      let newsMessage = `Создан новый турнир "${name}"!`;
      if (description) {
        newsMessage += `\n\n${description}`;
      }
      if (start_date && end_date) {
        newsMessage += `\n\n📅 Даты проведения: ${start_date} - ${end_date}`;
      }
      newsMessage += `\n\n🎯 Делайте свои прогнозы и соревнуйтесь с другими игроками!`;

      db.prepare(`
        INSERT INTO news (type, title, message)
        VALUES (?, ?, ?)
      `).run('announcement', newsTitle, newsMessage);

      console.log(`✅ Автоматически создана новость о турнире: ${name}`);
    } catch (error) {
      console.error("❌ Ошибка создания новости о турнире:", error);
    }

    res.json({
      id: result.lastInsertRowid,
      name,
      description,
      start_date,
      end_date,
      icon,
      background_color,
      team_file,
      message: "Событие успешно создано",
    });
  } catch (error) {
    if (error.message.includes("UNIQUE constraint failed")) {
      res
        .status(400)
        .json({ error: "Событие с таким названием уже существует" });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// POST /api/admin/send-tournament-announcement
router.post("/api/admin/send-tournament-announcement", async (req, res) => {
  try {
    const { username, name, description, startDate, endDate, message } = req.body;

    if (!username || !name || !message) {
      return res.status(400).json({ error: "Недостаточно данных" });
    }

    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;

    const isAdmin = req.authenticatedUsername === ADMIN_DB_NAME;
    let hasPermission = isAdmin;

    if (!isAdmin) {
      const moderator = db.prepare(`
        SELECT permissions FROM moderators 
        WHERE user_id = (SELECT id FROM users WHERE username = ?)
      `).get(username);

      if (moderator) {
        const permissions = JSON.parse(moderator.permissions || "[]");
        hasPermission = permissions.includes("create_tournaments");
      }
    }

    if (!hasPermission) {
      console.log(`❌ Пользователь ${username} попытался отправить объявление без прав`);
      return res.status(403).json({ error: "Недостаточно прав для отправки объявлений" });
    }

    const result = db.prepare(`
      INSERT INTO pending_announcements (name, description, start_date, end_date, message, username)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, description || null, startDate || null, endDate || null, message, username);

    const announcementId = result.lastInsertRowid;

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const ADMIN_TELEGRAM_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && ADMIN_TELEGRAM_ID) {
      // Очищаем SVG-теги и unsupported HTML перед отправкой в Telegram
      const cleanMessage = message
        .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(?!b>|b |i>|i |u>|u |s>|s |code>|code |pre>|pre |a>|a |em>|strong>)[a-z][^>]*>/gi, '')
        .trim();

      const adminMessage = `📢 <b>ЗАПРОС НА ПУБЛИКАЦИЮ ТУРНИРА</b>\n\n` +
        `👤 От ${isAdmin ? 'админа' : 'модератора'}: <b>${username}</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `${cleanMessage}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Нажмите кнопку ниже чтобы опубликовать объявление всем пользователям.`;

      try {
        const response = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: ADMIN_TELEGRAM_ID,
              text: adminMessage,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "✅ Опубликовать всем",
                      callback_data: `publish_${announcementId}`
                    }
                  ],
                  [
                    {
                      text: "❌ Отклонить",
                      callback_data: `reject_${announcementId}`
                    }
                  ]
                ]
              }
            }),
          }
        );

        if (!response.ok) {
          const error = await response.json();
          console.error("❌ Ошибка Telegram API:", error);
          return res.status(500).json({ error: "Не удалось отправить сообщение админу" });
        }

        console.log(`✅ Объявление о турнире "${name}" (ID: ${announcementId}) отправлено админу от ${username}`);
      } catch (error) {
        console.error("❌ Ошибка отправки объявления админу:", error);
        return res.status(500).json({ error: "Не удалось отправить сообщение админу" });
      }
    } else {
      console.warn("⚠️ TELEGRAM_BOT_TOKEN или TELEGRAM_ADMIN_ID не настроены");
      return res.status(500).json({ error: "Telegram бот не настроен" });
    }

    res.json({ success: true, message: "Объявление отправлено админу" });
  } catch (error) {
    console.error("❌ Ошибка при отправке объявления:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/send-feature-announcement
router.post("/api/admin/send-feature-announcement", async (req, res) => {
  try {
    const { username, title, text, testMode } = req.body;

    if (!username || !title || !text) {
      return res.status(400).json({ error: "Недостаточно данных" });
    }

    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;

    if (req.authenticatedUsername !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

    if (!TELEGRAM_BOT_TOKEN) {
      return res.status(500).json({ error: "Telegram бот не настроен" });
    }

    let formattedText = text;

    // Экранируем HTML-спецсимволы (кроме наших маркеров форматирования)
    // Порядок важен: сначала многосимвольные маркеры, потом одиночные

    // Подчёркнутый __текст__
    formattedText = formattedText.replace(/__([^_\n]+)__/g, '<u>$1</u>');
    // Жирный *текст*
    formattedText = formattedText.replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
    // Зачёркнутый ~текст~
    formattedText = formattedText.replace(/~([^~\n]+)~/g, '<s>$1</s>');
    // Курсив _текст_
    formattedText = formattedText.replace(/_([^_\n]+)_/g, '<i>$1</i>');
    // Спойлер ||текст||
    formattedText = formattedText.replace(/\|\|([^|]+)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');
    // Код `текст`
    formattedText = formattedText.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // Ссылка [текст](url)
    formattedText = formattedText.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
    // Цитата >текст (каждая строка начинающаяся с >)
    formattedText = formattedText.replace(/^>(.+)$/gm, '<blockquote>$1</blockquote>');
    // Разделитель
    formattedText = formattedText.replace(/^——————————$/gm, '━━━━━━━━━━');
    // Маркированный список
    formattedText = formattedText.replace(/^• (.+)$/gm, '  ▪️ $1');
    // Нумерованный список
    formattedText = formattedText.replace(/^(\d+)\. (.+)$/gm, '  <b>$1.</b> $2');

    const message = `🎉 <b>${title}</b>\n\n${formattedText}\n\n━━━━━━━━━━━━━━━━━━━━\n\n💬 Победных ставок! 🎯`;

    if (testMode) {
      const ADMIN_TELEGRAM_ID = process.env.TELEGRAM_ADMIN_ID;

      if (!ADMIN_TELEGRAM_ID) {
        return res.status(500).json({ error: "TELEGRAM_ADMIN_ID не настроен" });
      }

      try {
        const replyMarkup = {
          inline_keyboard: [
            [
              { text: "👍", callback_data: `reaction_positive_thumbsup_${Date.now()}` },
              { text: "🔥", callback_data: `reaction_positive_fire_${Date.now() + 1}` },
              { text: "❤️", callback_data: `reaction_positive_heart_${Date.now() + 2}` },
              { text: "🫡", callback_data: `reaction_positive_salute_${Date.now() + 3}` },
              { text: "😂", callback_data: `reaction_positive_laugh_${Date.now() + 4}` }
            ],
            [
              { text: "👎", callback_data: `reaction_negative_thumbsdown_${Date.now()}` },
              { text: "😐", callback_data: `reaction_negative_neutral_${Date.now() + 1}` },
              { text: "💩", callback_data: `reaction_negative_poop_${Date.now() + 2}` },
              { text: "🤡", callback_data: `reaction_negative_clown_${Date.now() + 3}` },
              { text: "🤮", callback_data: `reaction_negative_vomit_${Date.now() + 4}` }
            ]
          ]
        };

        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: ADMIN_TELEGRAM_ID,
              text: `📝 <b>ТЕСТОВОЕ СООБЩЕНИЕ</b>\n\n${message}`,
              parse_mode: "HTML",
              reply_markup: replyMarkup
            }),
          }
        );

        console.log(`✅ Тестовое объявление отправлено админу`);
        return res.json({ success: true, message: "Тестовое сообщение отправлено" });
      } catch (error) {
        console.error("❌ Ошибка отправки тестового сообщения:", error);
        return res.status(500).json({ error: "Не удалось отправить тестовое сообщение" });
      }
    }

    const users = db.prepare(
      `SELECT id, username, telegram_id 
       FROM users 
       WHERE telegram_id IS NOT NULL 
       AND telegram_notifications_enabled = 1`
    ).all();

    console.log(`📢 Отправка объявления "${title}" ${users.length} пользователям...`);

    let successCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        const replyMarkup = {
          inline_keyboard: [
            [
              { text: "👍", callback_data: `reaction_positive_thumbsup_${Date.now()}` },
              { text: "🔥", callback_data: `reaction_positive_fire_${Date.now() + 1}` },
              { text: "❤️", callback_data: `reaction_positive_heart_${Date.now() + 2}` },
              { text: "🫡", callback_data: `reaction_positive_salute_${Date.now() + 3}` },
              { text: "😂", callback_data: `reaction_positive_laugh_${Date.now() + 4}` }
            ],
            [
              { text: "👎", callback_data: `reaction_negative_thumbsdown_${Date.now()}` },
              { text: "😐", callback_data: `reaction_negative_neutral_${Date.now() + 1}` },
              { text: "💩", callback_data: `reaction_negative_poop_${Date.now() + 2}` },
              { text: "🤡", callback_data: `reaction_negative_clown_${Date.now() + 3}` },
              { text: "🤮", callback_data: `reaction_negative_vomit_${Date.now() + 4}` }
            ]
          ]
        };

        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: user.telegram_id,
              text: message,
              parse_mode: "HTML",
              reply_markup: replyMarkup
            }),
          }
        );
        successCount++;

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`⚠️ Не удалось отправить объявление пользователю ${user.username}:`, error.message);
        errorCount++;
      }
    }

    console.log(`✅ Объявление "${title}" отправлено: ${successCount} успешно, ${errorCount} ошибок`);

    res.json({
      success: true,
      successCount,
      errorCount,
      message: `Объявление отправлено: ${successCount} успешно, ${errorCount} ошибок`
    });
  } catch (error) {
    console.error("❌ Ошибка при отправке объявления:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/events/:eventId — первый PUT (редактирование базовых полей, только для админа)
router.put("/api/admin/events/:eventId", (req, res) => {
  const { eventId } = req.params;
  const {
    username,
    name,
    description,
    start_date,
    end_date,
    icon,
    background_color,
    team_file,
    weight_category_id,
    diff_goals_enabled,
  } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;

  if (req.authenticatedUsername !== ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  if (!name) {
    return res.status(400).json({ error: "Название турнира обязательно" });
  }

  try {
    const result = db
      .prepare(
        `
      UPDATE events
      SET name = ?, description = ?, start_date = ?, end_date = ?, icon = ?, background_color = ?, team_file = ?, weight_category_id = ?, diff_goals_enabled = ?
      WHERE id = ?
    `
      )
      .run(
        name,
        description || null,
        start_date || null,
        end_date || null,
        icon || null,
        background_color || null,
        team_file || null,
        weight_category_id || null,
        diff_goals_enabled != null ? diff_goals_enabled : 1,
        eventId
      );

    if (result.changes === 0) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    res.json({
      id: eventId,
      name,
      description,
      start_date,
      end_date,
      icon,
      background_color,
      team_file,
      weight_category_id,
      message: "Событие успешно обновлено",
    });
  } catch (error) {
    if (error.message.includes("UNIQUE constraint failed")) {
      res
        .status(400)
        .json({ error: "Событие с таким названием уже существует" });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// GET /api/admin/events/:eventId/rounds
router.get("/api/admin/events/:eventId/rounds", (req, res) => {
  const { eventId } = req.params;

  try {
    const rounds = db
      .prepare(
        `
        SELECT DISTINCT round FROM matches
        WHERE event_id = ? AND round IS NOT NULL
        ORDER BY round
      `
      )
      .all(eventId);

    res.json(rounds.map((r) => r.round));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/events/:eventId
router.delete("/api/admin/events/:eventId", async (req, res) => {
  const { eventId } = req.params;
  const username = req.body.username;

  const isAdminUser = req.authenticatedUsername === process.env.ADMIN_DB_NAME;
  let isModerator = false;

  if (!isAdminUser) {
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);

    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("delete_tournaments");
    }

    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  try {
    const event = db.prepare("SELECT name FROM events WHERE id = ?").get(eventId);
    const eventName = event ? event.name : `ID: ${eventId}`;

    const matchIds = db
      .prepare("SELECT id FROM matches WHERE event_id = ?")
      .all(eventId);

    db.prepare(
      "DELETE FROM bets WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)"
    ).run(eventId);

    try {
      db.prepare(
        "DELETE FROM final_bets WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)"
      ).run(eventId);
    } catch (e) {
      // Таблица final_bets не существует, это нормально
    }

    matchIds.forEach((match) => {
      try {
        db.prepare(
          "DELETE FROM final_parameters_results WHERE match_id = ?"
        ).run(match.id);
      } catch (e) {
        console.warn(`⚠️ Не удалось удалить параметры финала: ${e.message}`);
      }
    });

    try {
      db.prepare(
        "DELETE FROM sent_reminders WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)"
      ).run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить напоминания: ${e.message}`);
    }

    try {
      db.prepare(
        "DELETE FROM sent_3hour_reminders WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)"
      ).run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить 3-часовые напоминания: ${e.message}`);
    }

    try {
      db.prepare(
        "DELETE FROM sent_personal_reminders WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)"
      ).run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить персональные напоминания: ${e.message}`);
    }

    try {
      db.prepare("DELETE FROM event_reminders WHERE event_id = ?").run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить настройки напоминаний: ${e.message}`);
    }

    try {
      db.prepare("DELETE FROM awards WHERE event_id = ?").run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить автоматические награды: ${e.message}`);
    }

    try {
      db.prepare(
        "DELETE FROM bracket_predictions WHERE bracket_id IN (SELECT id FROM brackets WHERE event_id = ?)"
      ).run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить прогнозы на сетки: ${e.message}`);
    }

    try {
      db.prepare(
        "DELETE FROM bracket_results WHERE bracket_id IN (SELECT id FROM brackets WHERE event_id = ?)"
      ).run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить результаты сеток: ${e.message}`);
    }

    try {
      db.prepare("DELETE FROM brackets WHERE event_id = ?").run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить сетки плей-офф: ${e.message}`);
    }

    db.prepare("DELETE FROM matches WHERE event_id = ?").run(eventId);

    try {
      db.prepare("DELETE FROM tournament_awards WHERE event_id = ?").run(
        eventId
      );
    } catch (error) {
      console.error("Ошибка при удалении наград:", error);
    }

    const result = db.prepare("DELETE FROM events WHERE id = ?").run(eventId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    writeBetLog("tournament_deleted", {
      user: username,
      name: eventName,
      event_id: eventId,
      is_moderator: isModerator
    });

    if (isModerator) {
      const detailsText = `Турнир: ${eventName}\nID: ${eventId}`;
      await notifyModeratorAction(username, "Удаление турнира", detailsText);
    } else {
      const message =
        `🗑️ <b>Турнир удалён</b>\n\n` +
        `👤 Администратор: ${username}\n` +
        `🏆 Турнир: ${eventName}\n` +
        `🔢 ID: ${eventId}`;
      await sendAdminNotification(message);
    }

    res.json({ message: "Событие успешно удалено" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/events/:eventId/lock
router.put("/api/admin/events/:eventId/lock", async (req, res) => {
  const { eventId } = req.params;
  const { username, reason } = req.body;

  if (req.authenticatedUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  if (!reason || reason.trim() === "") {
    return res.status(400).json({ error: "Причина блокировки обязательна" });
  }

  try {
    const event = db
      .prepare("SELECT id, name FROM events WHERE id = ?")
      .get(eventId);

    if (!event) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    const result = db
      .prepare("UPDATE events SET locked_reason = ? WHERE id = ?")
      .run(reason.trim(), eventId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    const winner = db
      .prepare(
        `
        SELECT 
          u.id, u.username,
          (SUM(CASE 
            WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
              CASE 
                WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                  CASE 
                    WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                         (b.prediction = 'team2' AND m.winner = 'team2') OR
                         (b.prediction = 'draw' AND m.winner = 'draw') OR
                         (b.prediction = m.team1_name AND m.winner = 'team1') OR
                         (b.prediction = m.team2_name AND m.winner = 'team2') THEN
                         CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
                         CASE 
                           WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                                ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                                sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
                           THEN 1 ELSE 0 
                         END +
                         CASE
                           WHEN m.is_final = 0 AND m.winner != 'draw' AND
                                e.diff_goals_enabled = 1 AND
                              e.diff_goals_enabled = 1 AND
                                sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                                ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                                NOT (sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2) AND
                                (sp.score_team1 - sp.score_team2) = (ms.score_team1 - ms.score_team2)
                           THEN 1 ELSE 0
                         END +
                         CASE 
                           WHEN m.yellow_cards_prediction_enabled = 1 AND
                                cp.yellow_cards IS NOT NULL AND m.yellow_cards IS NOT NULL AND
                                cp.yellow_cards = m.yellow_cards
                           THEN 1 ELSE 0
                         END +
                         CASE 
                           WHEN m.red_cards_prediction_enabled = 1 AND
                                cp.red_cards IS NOT NULL AND m.red_cards IS NOT NULL AND
                                cp.red_cards = m.red_cards
                           THEN 1 ELSE 0
                         END
                    ELSE 0 
                  END
                WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                  CASE 
                    WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 2
                    WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 2
                    WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 2
                    WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 2
                    WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 2
                    WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 2
                    WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 2
                   WHEN b.parameter_type = 'goal_difference' AND CAST(b.prediction AS INTEGER) = CAST(fpr.goal_difference AS INTEGER) THEN 1
                    ELSE 0
                  END
                ELSE 0
              END 
            ELSE 0 
          END) + COALESCE((
            SELECT SUM(CASE WHEN bp.stage = 'final' THEN 3 ELSE 1 END)
            FROM bracket_predictions bp
            INNER JOIN bracket_results br ON bp.bracket_id = br.bracket_id 
              AND bp.stage = br.stage 
              AND bp.match_index = br.match_index
            INNER JOIN brackets bk ON bp.bracket_id = bk.id
            WHERE bp.user_id = u.id 
              AND bk.event_id = ?
              AND bp.predicted_winner = br.actual_winner
          ), 0)) as wins
        FROM users u
        INNER JOIN bets b ON u.id = b.user_id
        INNER JOIN matches m ON b.match_id = m.id
        INNER JOIN events e ON m.event_id = e.id
        LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
        LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
        LEFT JOIN match_scores ms ON b.match_id = ms.match_id
        LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
        WHERE m.event_id = ?
        GROUP BY u.id, u.username
        HAVING wins > 0
        ORDER BY wins DESC
        LIMIT 1
      `
      )
      .get(eventId, eventId);

    if (winner) {
      try {
        db.prepare(
          `
          INSERT INTO tournament_awards (user_id, event_id, event_name, won_bets)
          VALUES (?, ?, ?, ?)
        `
        ).run(winner.id, eventId, event.name, winner.wins);
        console.log(
          `🏆 Награда выдана! user_id: ${winner.id}, event: "${event.name}", wins: ${winner.wins}`
        );
      } catch (error) {
        console.error("Ошибка при выдаче награды:", error);
      }

      // Проверяем: причина содержит "завершен"/"завершён" И нет финального матча?
      const reasonLower = reason.trim().toLowerCase();
      const isCompleted = reasonLower.includes('завершен') || reasonLower.includes('завершён');
      const hasFinalMatch = db.prepare(`SELECT COUNT(*) as count FROM matches WHERE event_id = ? AND is_final = 1`).get(eventId).count > 0;

      if (isCompleted && !hasFinalMatch) {
        // Создаём красивую карточку завершения турнира (без финала)
        try {
          const { checkAndCreateTournamentCompletionNewsOnLock } = await import('../services/tournamentCompletionService.js');
          checkAndCreateTournamentCompletionNewsOnLock(parseInt(eventId));
        } catch (error) {
          console.error("❌ Ошибка создания карточки завершения турнира:", error);
        }
      } else {
        // Обычная новость о победителе
        try {
          const newsTitle = `🏆 Победитель турнира: ${event.name}`;
          const newsMessage = `Поздравляем победителя турнира "${event.name}"!\n\n👑 Победитель: ${winner.username}\n🎯 Угаданных прогнозов: ${winner.wins}\n\n🎉 Отличная игра! Так держать!`;

          db.prepare(`
            INSERT INTO news (type, title, message)
            VALUES (?, ?, ?)
          `).run('achievement', newsTitle, newsMessage);

          console.log(`✅ Автоматически создана новость о победителе турнира: ${event.name}`);
        } catch (error) {
          console.error("❌ Ошибка создания новости о победителе:", error);
        }
      }
    } else {
      // Нет победителя, но причина "завершен" и нет финала — всё равно создаём карточку
      const reasonLower = reason.trim().toLowerCase();
      const isCompleted = reasonLower.includes('завершен') || reasonLower.includes('завершён');
      const hasFinalMatch = db.prepare(`SELECT COUNT(*) as count FROM matches WHERE event_id = ? AND is_final = 1`).get(eventId).count > 0;

      if (isCompleted && !hasFinalMatch) {
        try {
          const { checkAndCreateTournamentCompletionNewsOnLock } = await import('../services/tournamentCompletionService.js');
          checkAndCreateTournamentCompletionNewsOnLock(parseInt(eventId));
        } catch (error) {
          console.error("❌ Ошибка создания карточки завершения турнира:", error);
        }
      }
    }

    res.json({
      message: "Турнир заблокирован",
      eventId,
      reason: reason.trim(),
      winner: winner ? { username: winner.username, wins: winner.wins } : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/events/:eventId/unlock
router.put("/api/admin/events/:eventId/unlock", (req, res) => {
  const { eventId } = req.params;
  const { username } = req.body;

  if (req.authenticatedUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    const result = db
      .prepare("UPDATE events SET locked_reason = NULL WHERE id = ?")
      .run(eventId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    try {
      db.prepare("DELETE FROM tournament_awards WHERE event_id = ?").run(
        eventId
      );
    } catch (error) {
      console.error("Ошибка при удалении награды:", error);
    }

    res.json({
      message: "Турнир разблокирован",
      eventId,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/events/:eventId — второй PUT (обновление статуса/других полей, для админа и модераторов)
router.put("/api/admin/events/:eventId", async (req, res) => {
  const { eventId } = req.params;
  const { username, name, description, start_date, end_date } = req.body;

  const isAdminUser = req.authenticatedUsername === process.env.ADMIN_DB_NAME;
  let isModerator = false;

  if (!isAdminUser) {
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);

    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("edit_tournaments");
    }

    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Название турнира обязательно" });
  }

  try {
    const result = db
      .prepare(
        "UPDATE events SET name = ?, description = ?, start_date = ?, end_date = ? WHERE id = ?"
      )
      .run(
        name,
        description || null,
        start_date || null,
        end_date || null,
        eventId
      );

    if (result.changes === 0) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    if (isModerator) {
      const detailsText = `Турнир: ${name}\nID: ${eventId}`;
      await notifyModeratorAction(username, "Редактирование турнира", detailsText);

      writeBetLog("tournament_edited", {
        moderator: username,
        name: name
      });
    }

    res.json({
      message: "Турнир успешно отредактирован",
      eventId,
      name,
      description,
      start_date,
      end_date,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
