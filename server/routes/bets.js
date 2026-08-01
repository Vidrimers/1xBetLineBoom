import { Router } from 'express';
import { db } from '../database/db.js';
import { requireOwnership } from '../middleware/auth.js';
import { notifyAdmin, notifyUser } from '../services/notificationService.js';
import { writeBetLog } from '../utils/logger.js';
import { notifyNewBet, notifyBetDeleted, notifyNewScorePrediction, notifyIllegalBet, sendUserMessage, sendAdminNotification } from '../../OnexBetLineBoombot.js';
import { LOG_FILE_PATH, MAX_LOG_SIZE } from '../config.js';
import fs from 'fs';
import { handleUserBetInTournament } from '../services/inactivityService.js';

const router = Router();

// POST /api/bets - Создать ставку
router.post("/api/bets", requireOwnership, async (req, res) => {
  try {
    const {
      user_id,
      match_id,
      prediction,
      amount,
      is_final_bet,
      parameter_type,
    } = req.body;

    // Получаем информацию о пользователе и матче
    const user = db
      .prepare(
        "SELECT username, telegram_username, telegram_notifications_enabled FROM users WHERE id = ?"
      )
      .get(user_id);

    // Проверяем матч и его дату
    const match = db
      .prepare(
        "SELECT m.status, m.match_date, m.winner, m.team1_name, m.team2_name, m.event_id, m.is_final, m.round, e.name as event_name FROM matches m LEFT JOIN events e ON m.event_id = e.id WHERE m.id = ?"
      )
      .get(match_id);

    if (!match) {
      return res.status(404).json({ error: "Матч не найден" });
    }

    // Определяем эффективный статус на основе даты
    const now = new Date();
    const matchDate = match.match_date ? new Date(match.match_date) : null;

    // Если матч в прошлом (началась дата) - ставка невозможна
    if (matchDate && matchDate <= now && !match.winner) {
      // Матч начался, но нет результата - это ongoing
      // Отправляем уведомление админу
      await notifyIllegalBet(
        user?.username || "неизвестный",
        match.team1_name,
        match.team2_name,
        prediction,
        "ongoing"
      );
      return res
        .status(400)
        .json({ error: "Ну, куда ты, малютка, матч уже начался" });
    }

    // Если есть результат - матч завершён
    if (match.winner) {
      // Отправляем уведомление админу
      await notifyIllegalBet(
        user?.username || "неизвестный",
        match.team1_name,
        match.team2_name,
        prediction,
        "finished"
      );
      return res
        .status(400)
        .json({ error: "Ну, куда ты, малютка, матч уже начался" });
    }

    // Дополнительная проверка статуса из БД (если админ установил вручную)
    if (match.status && match.status !== "pending") {
      // Проверяем специальные статусы (отменённые/перенесённые)
      if (['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(match.status)) {
        const statusNames = {
          'cancelled': 'отменён',
          'postponed': 'перенесён',
          'abandoned': 'прерван',
          'technical_loss': 'техническое поражение',
          'walkover': 'неявка'
        };
        return res
          .status(400)
          .json({ error: `Матч ${statusNames[match.status] || 'недоступен для ставок'}` });
      }
      
      // Отправляем уведомление админу для других статусов
      let statusText = match.status;
      await notifyIllegalBet(
        user?.username || "неизвестный",
        match.team1_name,
        match.team2_name,
        prediction,
        statusText
      );
      return res
        .status(400)
        .json({ error: "Ну, куда ты, малютка, матч уже начался" });
    }

    const result = db
      .prepare(
        `
      INSERT INTO bets (user_id, match_id, prediction, amount, is_final_bet, parameter_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        user_id,
        match_id,
        prediction,
        amount,
        is_final_bet ? 1 : 0,
        parameter_type || null
      );

    // Проверяем возврат пользователя в турнир (если был исключён за инактивность)
    if (!is_final_bet) {
      try {
        handleUserBetInTournament(user_id, match.event_id);
      } catch (inactivityError) {
        console.error('❌ Ошибка обработки возврата пользователя в турнир:', inactivityError);
      }
    }

    // Получаем прогноз на счет если есть
    let scorePrediction = null;
    if (!is_final_bet) {
      scorePrediction = db
        .prepare("SELECT score_team1, score_team2 FROM score_predictions WHERE user_id = ? AND match_id = ?")
        .get(user_id, match_id);
    }

    // Записываем лог ставки
    writeBetLog("placed", {
      username: user?.username || "неизвестный",
      prediction: prediction,
      team1: match.team1_name,
      team2: match.team2_name,
      eventName: match.event_name,
      is_final_bet: is_final_bet,
      parameter_type: parameter_type,
      is_final_match: match.is_final,
      round: match.round,
      score_team1: scorePrediction?.score_team1,
      score_team2: scorePrediction?.score_team2,
    });

    // Отправляем уведомление админу о новой ставке
    try {
      let predictionText = prediction === "draw" ? "Ничья" : prediction;
      
      // Если прогноз содержит название команды, используем его как есть
      // Если это "team1" или "team2", преобразуем в названия команд
      if (prediction === "team1" || prediction === match.team1_name) {
        predictionText = match.team1_name;
      } else if (prediction === "team2" || prediction === match.team2_name) {
        predictionText = match.team2_name;
      }

      // Для финальных параметров добавляем тип
      if (is_final_bet && parameter_type) {
        const paramNames = {
          exact_score: "Точный счёт",
          yellow_cards: "Жёлтые карточки",
          red_cards: "Красные карточки",
          corners: "Угловые",
          penalties_in_game: "Пенальти в игре",
          extra_time: "Доп. время",
          penalties_at_end: "Пенальти в конце",
        };
        predictionText = `${paramNames[parameter_type] || parameter_type}: ${prediction}`;
      }
      
      await notifyNewBet(
        user?.username || "неизвестный",
        match.team1_name,
        match.team2_name,
        predictionText,
        match.event_name
      );
    } catch (err) {
      console.error("⚠️ Ошибка отправки уведомления админу:", err.message);
      // Не прерываем процесс создания ставки если ошибка в отправке уведомления
    }

    // Отправляем личное сообщение пользователю в Telegram если он привязал аккаунт и не отключил уведомления
    if (user?.telegram_username && user?.telegram_notifications_enabled !== 0) {
      try {
        const cleanUsername = user.telegram_username.toLowerCase();
        const tgUser = db
          .prepare(
            "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?"
          )
          .get(cleanUsername);

        if (tgUser?.chat_id) {
          let predictionText = prediction === "draw" ? "Ничья" : prediction;

          // Если прогноз содержит название команды, используем его как есть
          // Если это "team1" или "team2", преобразуем в названия команд
          if (prediction === "team1" || prediction === match.team1_name) {
            predictionText = match.team1_name;
          } else if (
            prediction === "team2" ||
            prediction === match.team2_name
          ) {
            predictionText = match.team2_name;
          }

          // Для финальных параметров добавляем тип
          if (is_final_bet && parameter_type) {
            const paramNames = {
              exact_score: "Точный счёт",
              yellow_cards: "Жёлтые карточки",
              red_cards: "Красные карточки",
              corners: "Угловые",
              penalties_in_game: "Пенальти в игре",
              extra_time: "Доп. время",
              penalties_at_end: "Пенальти в конце",
            };
            predictionText = `${paramNames[parameter_type] || parameter_type}: ${prediction}`;
          }

          const betMessage =
            `💰 <b>НОВАЯ СТАВКА!</b>\n\n` +
            `⚽ <b>${match.team1_name}</b> vs <b>${match.team2_name}</b>\n` +
            `🎯 Прогноз: <b>${predictionText}</b>\n` +
            `🏆 Турнир: ${match.event_name || "Неизвестный"}\n` +
            `⏰ ${new Date().toLocaleString("ru-RU")}`;

          await sendUserMessage(tgUser.chat_id, betMessage);
        }
      } catch (err) {
        console.error(
          "⚠️ Ошибка отправки уведомления пользователю в Telegram:",
          err.message
        );
        // Не прерываем процесс создания ставки если ошибка в отправке уведомления
      }
    }

    // Проверяем milestone достижения по количеству ставок
    try {
      const totalBets = db.prepare("SELECT COUNT(*) as count FROM bets").get().count;
      
      // Расширенный список milestones: 200, 500, 800, 1000, затем каждые 500
      const milestones = [200, 500, 800, 1000];
      if (totalBets > 1000 && totalBets % 500 === 0) {
        milestones.push(totalBets);
      }
      
      // Проверяем достигнут ли новый milestone
      if (milestones.includes(totalBets)) {
        const newsTitle = `🎉 Достижение: ${totalBets} ставок!`;
        const newsMessage = `Платформа достигла ${totalBets} ставок!\n\nСпасибо всем игрокам за активное участие! 🎯\n\nПродолжайте делать прогнозы и соревнуйтесь за первые места! 🏆`;
        
        db.prepare(`
          INSERT INTO news (type, title, message)
          VALUES (?, ?, ?)
        `).run('achievement', newsTitle, newsMessage);
        
        console.log(`✅ Автоматически создана новость о достижении: ${totalBets} ставок`);
      }
    } catch (error) {
      console.error("❌ Ошибка проверки milestone:", error);
    }
    
    // 🎂 Юбилей пользователя - 10, 50, 100 ставок
    try {
      const userBetsCount = db.prepare("SELECT COUNT(*) as count FROM bets WHERE user_id = ?").get(user_id).count;
      const userMilestones = [10, 50, 100];
      
      if (userMilestones.includes(userBetsCount)) {
        // Проверяем не создавали ли уже новость об этом юбилее
        const existingNews = db.prepare(`
          SELECT id FROM news 
          WHERE type = 'achievement' 
          AND message LIKE ?
          AND created_at > datetime('now', '-7 days')
        `).get(`%${user.username}%${userBetsCount}%ставок%`);
        
        if (!existingNews) {
          const newsTitle = `🎂 Юбилей: ${userBetsCount} ставок!`;
          const newsMessage = `Пользователь ${user.username} сделал ${userBetsCount} ставок!\n\n🎉 Отличная активность! Так держать!`;
          
          db.prepare(`
            INSERT INTO news (type, title, message)
            VALUES (?, ?, ?)
          `).run('achievement', newsTitle, newsMessage);
          
          console.log(`✅ Автоматически создана новость о юбилее пользователя ${user.username}: ${userBetsCount} ставок`);
        }
      }
    } catch (error) {
      console.error("❌ Ошибка проверки юбилея пользователя:", error);
    }

    res.json({
      id: result.lastInsertRowid,
      user_id,
      match_id,
      prediction,
      amount,
      status: "pending",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/bets - Получить ставки пользователя
router.get("/api/user/:userId/bets", async (req, res) => {
  try {
    const { userId } = req.params;
    const viewerUsername = req.query.viewerUsername; // Кто смотрит ставки
    
    // Получаем информацию о пользователе, чьи ставки смотрят
    const targetUser = db.prepare("SELECT username FROM users WHERE id = ?").get(userId);
    
    // Отправляем уведомление админу если кто-то смотрит чужие ставки
    if (viewerUsername && targetUser && viewerUsername !== targetUser.username) {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
      
      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const message = `📊 ПРОСМОТР СТАВОК

👤 Кто смотрит: ${viewerUsername}
🎯 Чьи ставки: ${targetUser.username}

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
    
    const bets = db
      .prepare(
        `
      SELECT b.*, 
             m.team1_name, m.team2_name, m.winner, 
             m.status as match_status, m.round, m.is_final, m.match_date,
             m.event_id,
             m.yellow_cards as actual_yellow_cards,
             m.red_cards as actual_red_cards,
             e.name as event_name, 
             e.status as event_status,
             e.start_date as event_start_date,
             e.locked_reason as event_locked_reason,
             CASE WHEN m.score_prediction_enabled = 1 THEN sp.score_team1 ELSE NULL END as score_team1,
             CASE WHEN m.score_prediction_enabled = 1 THEN sp.score_team2 ELSE NULL END as score_team2,
             ms.score_team1 as actual_score_team1,
             ms.score_team2 as actual_score_team2,
             CASE WHEN m.yellow_cards_prediction_enabled = 1 THEN cp.yellow_cards ELSE NULL END as yellow_cards,
             CASE WHEN m.red_cards_prediction_enabled = 1 THEN cp.red_cards ELSE NULL END as red_cards
      FROM bets b
      JOIN matches m ON b.match_id = m.id
      JOIN events e ON m.event_id = e.id
      LEFT JOIN score_predictions sp ON sp.user_id = b.user_id AND sp.match_id = b.match_id
      LEFT JOIN match_scores ms ON ms.match_id = b.match_id
      LEFT JOIN cards_predictions cp ON cp.user_id = b.user_id AND cp.match_id = b.match_id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
    `
      )
      .all(userId);
    res.json(bets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/counting-bets - Получить ставки для подсчёта
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

// DELETE /api/bets/:betId - Удалить ставку пользователя
router.delete("/api/bets/:betId", async (req, res) => {
  try {
    const { betId } = req.params;
    const { username } = req.body;
    const authenticatedUserId = req.authenticatedUserId;

    // Проверяем, является ли пользователь админом
    const isAdmin = username === process.env.ADMIN_DB_NAME;

    // Проверяем, что ставка существует
    const bet = db.prepare("SELECT * FROM bets WHERE id = ?").get(betId);

    if (!bet) {
      return res.status(404).json({ error: "Ставка не найдена" });
    }

    // Получаем информацию о матче и пользователе для лога
    const match = db
      .prepare(
        "SELECT m.team1_name, m.team2_name, m.status, m.is_final, m.round, e.name as event_name FROM matches m LEFT JOIN events e ON m.event_id = e.id WHERE m.id = ?"
      )
      .get(bet.match_id);
    const betUser = db
      .prepare(
        "SELECT username, telegram_username, telegram_notifications_enabled FROM users WHERE id = ?"
      )
      .get(bet.user_id);

    // Если не админ - проверяем принадлежность ставки
    if (!isAdmin && bet.user_id !== authenticatedUserId) {
      return res.status(403).json({ error: "Эта ставка не принадлежит вам" });
    }

    // Проверяем статус матча - нельзя удалять ставки на начавшиеся/завершённые/отменённые матчи (кроме админа)
    if (!isAdmin) {
      if (
        match &&
        (match.status === "ongoing" || match.status === "finished" || 
         ['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(match.status))
      ) {
        return res.status(403).json({
          error: "Нельзя удалить ставку — матч уже начался, завершён или отменён",
        });
      }
    }

    db.prepare("DELETE FROM bets WHERE id = ?").run(betId);

    // Удаляем связанные прогнозы на счёт и карточки для этого матча и пользователя
    try {
      const deletedScorePredictions = db.prepare(
        "DELETE FROM score_predictions WHERE user_id = ? AND match_id = ?"
      ).run(bet.user_id, bet.match_id);
      
      if (deletedScorePredictions.changes > 0) {
        console.log(`🗑️ Удалён прогноз на счёт для матча ${bet.match_id}`);
      }

      const deletedCardsPredictions = db.prepare(
        "DELETE FROM cards_predictions WHERE user_id = ? AND match_id = ?"
      ).run(bet.user_id, bet.match_id);
      
      if (deletedCardsPredictions.changes > 0) {
        console.log(`🗑️ Удалён прогноз на карточки для матча ${bet.match_id}`);
      }
    } catch (e) {
      console.warn(`⚠️ Ошибка при удалении связанных прогнозов: ${e.message}`);
    }

    // Если это была финальная ставка - проверяем есть ли еще ставки на этот матч
    if (bet.is_final_bet) {
      const remainingBets = db
        .prepare(
          "SELECT COUNT(*) as cnt FROM bets WHERE match_id = ? AND is_final_bet = 1"
        )
        .get(bet.match_id);

      // Если нет больше финальных ставок на этот матч - удаляем параметры финала
      if (remainingBets.cnt === 0) {
        try {
          db.prepare(
            "DELETE FROM final_parameters_results WHERE match_id = ?"
          ).run(bet.match_id);
          console.log(`🗑️ Удалены параметры финала для матча ${bet.match_id}`);
        } catch (e) {
          console.warn(`⚠️ Не удалось удалить параметры финала: ${e.message}`);
        }
      }
    }

    // Получаем прогноз на счет если есть (до удаления ставки)
    let scorePrediction = null;
    if (!bet.is_final_bet) {
      scorePrediction = db
        .prepare("SELECT score_team1, score_team2 FROM score_predictions WHERE user_id = ? AND match_id = ?")
        .get(bet.user_id, bet.match_id);
    }

    // Записываем лог удаления ставки
    writeBetLog("deleted", {
      username: betUser?.username || "неизвестный",
      prediction: bet.prediction,
      team1: match?.team1_name || "?",
      team2: match?.team2_name || "?",
      eventName: match?.event_name,
      is_final_bet: bet.is_final_bet,
      parameter_type: bet.parameter_type,
      is_final_match: match?.is_final,
      round: match?.round,
      score_team1: scorePrediction?.score_team1,
      score_team2: scorePrediction?.score_team2,
    });

    // Отправляем уведомление админу об удалении ставки
    try {
      let predictionText = bet.prediction === "draw" ? "Ничья" : bet.prediction;
      
      // Если прогноз содержит название команды, используем его как есть
      // Если это "team1" или "team2", преобразуем в названия команд
      if (bet.prediction === "team1" || bet.prediction === match?.team1_name) {
        predictionText = match?.team1_name || "?";
      } else if (bet.prediction === "team2" || bet.prediction === match?.team2_name) {
        predictionText = match?.team2_name || "?";
      }

      // Для финальных параметров — админу показываем только тип (без значения)
      if (bet.is_final_bet && bet.parameter_type) {
        const paramNames = {
          exact_score: "Точный счёт",
          yellow_cards: "Жёлтые карточки",
          red_cards: "Красные карточки",
          corners: "Угловые",
          penalties_in_game: "Пенальти в игре",
          extra_time: "Доп. время",
          penalties_at_end: "Пенальти в конце",
        };
        predictionText = paramNames[bet.parameter_type] || bet.parameter_type;
      }
      
      await notifyBetDeleted(
        betUser?.username || "неизвестный",
        match?.team1_name || "?",
        match?.team2_name || "?",
        predictionText,
        match?.event_name
      );
    } catch (err) {
      console.error("⚠️ Ошибка отправки уведомления админу об удалении ставки:", err.message);
      // Не прерываем процесс удаления ставки если ошибка в отправке уведомления
    }

    // Отправляем личное сообщение пользователю в Telegram об удалении ставки если он не отключил уведомления
    if (
      betUser?.telegram_username &&
      betUser?.telegram_notifications_enabled !== 0
    ) {
      try {
        const cleanUsername = betUser.telegram_username.toLowerCase();
        const tgUser = db
          .prepare(
            "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?"
          )
          .get(cleanUsername);

        if (tgUser?.chat_id) {
          let predictionText =
            bet.prediction === "draw" ? "Ничья" : bet.prediction;

          // Если прогноз содержит название команды, используем его как есть
          // Если это "team1" или "team2", преобразуем в названия команд
          if (
            bet.prediction === "team1" ||
            bet.prediction === match?.team1_name
          ) {
            predictionText = match?.team1_name || "?";
          } else if (
            bet.prediction === "team2" ||
            bet.prediction === match?.team2_name
          ) {
            predictionText = match?.team2_name || "?";
          }

          // Для финальных параметров — пользователю показываем тип + значение
          if (bet.is_final_bet && bet.parameter_type) {
            const paramNames = {
              exact_score: "Точный счёт",
              yellow_cards: "Жёлтые карточки",
              red_cards: "Красные карточки",
              corners: "Угловые",
              penalties_in_game: "Пенальти в игре",
              extra_time: "Доп. время",
              penalties_at_end: "Пенальти в конце",
            };
            predictionText = `${paramNames[bet.parameter_type] || bet.parameter_type}: ${bet.prediction}`;
          }

          const deleteMessage =
            `❌ <b>СТАВКА УДАЛЕНА!</b>\n\n` +
            `⚽ <b>${match?.team1_name || "?"}</b> vs <b>${
              match?.team2_name || "?"
            }</b>\n` +
            `🎯 Прогноз: <b>${predictionText}</b>\n` +
            `🏆 Турнир: ${match?.event_name || "Неизвестный"}\n\n` +
            `⏰ ${new Date().toLocaleString("ru-RU")}`;

          await sendUserMessage(tgUser.chat_id, deleteMessage);
        }
      } catch (err) {
        console.error(
          "⚠️ Ошибка отправки уведомления об удалении ставки в Telegram:",
          err.message
        );
        // Не прерываем процесс удаления ставки если ошибка в отправке уведомления
      }
    }

    res.json({ message: "Ставка удалена" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== ПРОГНОЗЫ НА СЧЕТ =====

// POST /api/score-predictions - Создать/обновить прогноз на счет
router.post("/api/score-predictions", requireOwnership, async (req, res) => {
  try {
    const { user_id, match_id, score_team1, score_team2 } = req.body;

    // Получаем информацию о пользователе
    const user = db
      .prepare("SELECT username, telegram_username, telegram_notifications_enabled FROM users WHERE id = ?")
      .get(user_id);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем матч
    const match = db
      .prepare(
        `SELECT m.status, m.match_date, m.winner, m.team1_name, m.team2_name, m.score_prediction_enabled, e.name as event_name 
         FROM matches m 
         LEFT JOIN events e ON m.event_id = e.id 
         WHERE m.id = ?`
      )
      .get(match_id);

    if (!match) {
      return res.status(404).json({ error: "Матч не найден" });
    }

    if (!match.score_prediction_enabled) {
      return res.status(400).json({ error: "Прогноз на счет не включен для этого матча" });
    }

    // Проверяем статус матча
    const now = new Date();
    const matchDate = match.match_date ? new Date(match.match_date) : null;

    if (matchDate && matchDate <= now) {
      return res.status(400).json({ error: "Матч уже начался" });
    }

    if (match.winner) {
      return res.status(400).json({ error: "Матч уже завершен" });
    }

    // Проверяем корректность счета
    if (score_team1 < 0 || score_team2 < 0) {
      return res.status(400).json({ error: "Счет не может быть отрицательным" });
    }

    // Получаем ставку пользователя на этот матч
    const userBet = db
      .prepare("SELECT prediction FROM bets WHERE user_id = ? AND match_id = ? AND is_final_bet = 0")
      .get(user_id, match_id);

    // Проверяем существует ли уже прогноз
    const existingPrediction = db
      .prepare("SELECT id FROM score_predictions WHERE user_id = ? AND match_id = ?")
      .get(user_id, match_id);

    const isNewPrediction = !existingPrediction;

    if (existingPrediction) {
      // Обновляем существующий прогноз
      db.prepare(
        "UPDATE score_predictions SET score_team1 = ?, score_team2 = ? WHERE user_id = ? AND match_id = ?"
      ).run(score_team1, score_team2, user_id, match_id);
    } else {
      // Создаем новый прогноз
      db.prepare(
        "INSERT INTO score_predictions (user_id, match_id, score_team1, score_team2) VALUES (?, ?, ?, ?)"
      ).run(user_id, match_id, score_team1, score_team2);
    }

    // Отправляем уведомление в Telegram только для новых прогнозов
    if (isNewPrediction && userBet) {
      try {
        // Определяем текст прогноза на результат
        let predictionText = userBet.prediction === "draw" ? "Ничья" : userBet.prediction;
        
        if (userBet.prediction === "team1" || userBet.prediction === match.team1_name) {
          predictionText = match.team1_name;
        } else if (userBet.prediction === "team2" || userBet.prediction === match.team2_name) {
          predictionText = match.team2_name;
        }

        // Отправляем уведомление пользователю (если у него включены уведомления)
        if (user.telegram_notifications_enabled && user.telegram_username) {
          const cleanUsername = user.telegram_username.toLowerCase();
          const tgUser = db
            .prepare(
              "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?"
            )
            .get(cleanUsername);

          if (tgUser?.chat_id) {
            const scoreMessage =
              `📊 <b>НОВЫЙ ПРОГНОЗ НА СЧЕТ!</b>\n\n` +
              `⚽ <b>${match.team1_name}</b> vs <b>${match.team2_name}</b>\n` +
              `🎯 Прогноз: <b>${predictionText}</b>\n` +
              `🎯 Прогноз счета: <b>${score_team1}-${score_team2}</b>\n` +
              `🏆 Турнир: ${match.event_name || "Неизвестный"}\n` +
              `⏰ ${new Date().toLocaleString("ru-RU")}`;

            await sendUserMessage(tgUser.chat_id, scoreMessage);
          }
        }
        
        // Отправляем уведомление админу ВСЕГДА
        await notifyNewScorePrediction(
          user.username,
          match.team1_name,
          match.team2_name,
          predictionText,
          score_team1,
          score_team2,
          match.event_name
        );
      } catch (err) {
        console.error(
          "⚠️ Ошибка отправки уведомления о прогнозе на счет в Telegram:",
          err.message
        );
        // Не прерываем процесс сохранения прогноза если ошибка в отправке уведомления
      }
    }

    // Записываем лог прогноза на счет только для новых прогнозов
    if (isNewPrediction && userBet) {
      // Определяем текст прогноза на результат
      let predictionText = userBet.prediction === "draw" ? "Ничья" : userBet.prediction;
      
      if (userBet.prediction === "team1" || userBet.prediction === match.team1_name) {
        predictionText = match.team1_name;
      } else if (userBet.prediction === "team2" || userBet.prediction === match.team2_name) {
        predictionText = match.team2_name;
      }

      // Получаем полную информацию о матче включая тур
      const fullMatch = db
        .prepare("SELECT round FROM matches WHERE id = ?")
        .get(match_id);

      writeBetLog("placed", {
        username: user.username,
        prediction: predictionText,
        team1: match.team1_name,
        team2: match.team2_name,
        eventName: match.event_name,
        is_final_bet: false,
        parameter_type: null,
        is_final_match: false,
        round: fullMatch?.round,
        score_team1: score_team1,
        score_team2: score_team2,
      });
    }

    res.json({ message: "Прогноз на счет сохранен" });
  } catch (error) {
    console.error("Ошибка при сохранении прогноза на счет:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cards-predictions - Создать/обновить прогноз на карточки
router.post("/api/cards-predictions", requireOwnership, async (req, res) => {
  try {
    const { user_id, match_id, yellow_cards, red_cards } = req.body;

    // Получаем информацию о пользователе
    const user = db
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(user_id);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем матч
    const match = db
      .prepare(
        `SELECT m.status, m.match_date, m.winner, m.yellow_cards_prediction_enabled, m.red_cards_prediction_enabled
         FROM matches m 
         WHERE m.id = ?`
      )
      .get(match_id);

    if (!match) {
      return res.status(404).json({ error: "Матч не найден" });
    }

    if (!match.yellow_cards_prediction_enabled && !match.red_cards_prediction_enabled) {
      return res.status(400).json({ error: "Прогноз на карточки не включен для этого матча" });
    }

    // Проверяем статус матча
    const now = new Date();
    const matchDate = match.match_date ? new Date(match.match_date) : null;

    if (matchDate && matchDate <= now) {
      return res.status(400).json({ error: "Матч уже начался" });
    }

    if (match.winner) {
      return res.status(400).json({ error: "Матч уже завершен" });
    }

    // Проверяем корректность данных
    if (yellow_cards !== null && (yellow_cards < 0 || yellow_cards > 20)) {
      return res.status(400).json({ error: "Количество желтых карточек должно быть от 0 до 20" });
    }

    if (red_cards !== null && (red_cards < 0 || red_cards > 10)) {
      return res.status(400).json({ error: "Количество красных карточек должно быть от 0 до 10" });
    }

    // Проверяем существует ли уже прогноз
    const existingPrediction = db
      .prepare("SELECT id FROM cards_predictions WHERE user_id = ? AND match_id = ?")
      .get(user_id, match_id);

    if (existingPrediction) {
      // Обновляем существующий прогноз
      db.prepare(
        "UPDATE cards_predictions SET yellow_cards = ?, red_cards = ? WHERE user_id = ? AND match_id = ?"
      ).run(yellow_cards, red_cards, user_id, match_id);
    } else {
      // Создаем новый прогноз
      db.prepare(
        "INSERT INTO cards_predictions (user_id, match_id, yellow_cards, red_cards) VALUES (?, ?, ?, ?)"
      ).run(user_id, match_id, yellow_cards, red_cards);
    }

    // Получаем информацию о матче для уведомления
    const matchInfo = db.prepare(`
      SELECT m.team1_name, m.team2_name, m.match_date, e.name as event_name
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.id = ?
    `).get(match_id);

    // Формируем текст прогноза
    let predictionText = [];
    if (yellow_cards !== null && match.yellow_cards_prediction_enabled) {
      predictionText.push(`🟨 Жёлтые карточки: ${yellow_cards}`);
    }
    if (red_cards !== null && match.red_cards_prediction_enabled) {
      predictionText.push(`🟥 Красные карточки: ${red_cards}`);
    }

    // Отправляем уведомление пользователю
    const userMessage = 
      `✅ <b>Прогноз на карточки сохранён!</b>\n\n` +
      `⚽ <b>Матч:</b> ${matchInfo.team1_name} vs ${matchInfo.team2_name}\n` +
      `🏆 <b>Турнир:</b> ${matchInfo.event_name}\n` +
      `📅 <b>Дата:</b> ${new Date(matchInfo.match_date).toLocaleString('ru-RU')}\n\n` +
      `${predictionText.join('\n')}`;

    await notifyUser(user_id, userMessage);

    // Отправляем уведомление админу
    const adminMessage = 
      `📊 <b>Новый прогноз на карточки</b>\n\n` +
      `👤 <b>Пользователь:</b> ${user.username}\n` +
      `⚽ <b>Матч:</b> ${matchInfo.team1_name} vs ${matchInfo.team2_name}\n` +
      `🏆 <b>Турнир:</b> ${matchInfo.event_name}\n` +
      `📅 <b>Дата:</b> ${new Date(matchInfo.match_date).toLocaleString('ru-RU')}\n\n` +
      `Система прогноза на карточки работает`;

    await notifyAdmin(adminMessage);

    res.json({ message: "Прогноз на карточки сохранен" });
  } catch (error) {
    console.error("Ошибка при сохранении прогноза на карточки:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/score-predictions/:matchId - Удалить прогноз на счет
router.delete("/api/score-predictions/:matchId", async (req, res) => {
  try {
    const { matchId } = req.params;
    const user_id = req.authenticatedUserId;

    // Проверяем существует ли прогноз
    const prediction = db
      .prepare("SELECT id FROM score_predictions WHERE user_id = ? AND match_id = ?")
      .get(user_id, matchId);

    if (!prediction) {
      return res.status(404).json({ error: "Прогноз не найден" });
    }

    db.prepare("DELETE FROM score_predictions WHERE user_id = ? AND match_id = ?")
      .run(user_id, matchId);

    res.json({ message: "Прогноз на счет удален" });
  } catch (error) {
    console.error("Ошибка при удалении прогноза на счет:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/cards-predictions/:matchId - Удалить прогноз на карточки
router.delete("/api/cards-predictions/:matchId", async (req, res) => {
  try {
    const { matchId } = req.params;
    const user_id = req.authenticatedUserId;

    // Проверяем существует ли прогноз
    const prediction = db
      .prepare("SELECT id FROM cards_predictions WHERE user_id = ? AND match_id = ?")
      .get(user_id, matchId);

    if (!prediction) {
      return res.status(404).json({ error: "Прогноз не найден" });
    }

    db.prepare("DELETE FROM cards_predictions WHERE user_id = ? AND match_id = ?")
      .run(user_id, matchId);

    res.json({ message: "Прогноз на карточки удален" });
  } catch (error) {
    console.error("Ошибка при удалении прогноза на карточки:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/match-bet-stats/:matchId - Получить статистику ставок по матчу
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

// POST /api/admin/final-parameters-results - Установить результаты финальных параметров
router.post("/api/admin/final-parameters-results", async (req, res) => {
  const {
    matchId,
    exact_score,
    yellow_cards,
    red_cards,
    corners,
    penalties_in_game,
    extra_time,
    penalties_at_end,
    username,
  } = req.body;

  // Проверяем, является ли пользователь админом или модератором с правами
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  if (!isAdminUser) {
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    const permissions = JSON.parse(moderator.permissions || "[]");
    if (!permissions.includes("manage_results") && !permissions.includes("edit_matches") && !permissions.includes("view_counting")) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  try {
    // Создаём таблицу если её ещё нет
    db.exec(`
      CREATE TABLE IF NOT EXISTS final_parameters_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL UNIQUE,
        exact_score TEXT,
        yellow_cards INTEGER,
        red_cards INTEGER,
        corners INTEGER,
        penalties_in_game TEXT,
        extra_time TEXT,
        penalties_at_end TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (match_id) REFERENCES matches(id)
      )
    `);

    // Вставляем или обновляем результаты
    db.prepare(
      `
      INSERT INTO final_parameters_results 
      (match_id, exact_score, yellow_cards, red_cards, corners, penalties_in_game, extra_time, penalties_at_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(match_id) DO UPDATE SET
        exact_score = excluded.exact_score,
        yellow_cards = excluded.yellow_cards,
        red_cards = excluded.red_cards,
        corners = excluded.corners,
        penalties_in_game = excluded.penalties_in_game,
        extra_time = excluded.extra_time,
        penalties_at_end = excluded.penalties_at_end
    `
    ).run(
      matchId,
      exact_score || null,
      yellow_cards !== undefined ? yellow_cards : null,
      red_cards !== undefined ? red_cards : null,
      corners !== undefined ? corners : null,
      penalties_in_game || null,
      extra_time || null,
      penalties_at_end || null
    );

    console.log(
      `✓ Результаты финальных параметров установлены для матча ${matchId}`
    );
    
    // 🎲 Везунчик - угадал сложную ставку (финал с параметрами)
    // 💯 Рекорд очков за матч - новый рекорд по очкам за один матч
    try {
      // Получаем всех пользователей с финальными ставками на этот матч
      const usersWithFinalBets = db.prepare(`
        SELECT DISTINCT u.id, u.username
        FROM users u
        JOIN bets b ON b.user_id = u.id
        WHERE b.match_id = ? AND b.is_final_bet = 1
      `).all(matchId);
      
      const match = db.prepare("SELECT team1_name, team2_name, winner FROM matches WHERE id = ?").get(matchId);
      
      for (const user of usersWithFinalBets) {
        // Подсчитываем очки за этот матч
        let matchPoints = 0;
        let correctParams = 0;
        
        // Проверяем основной результат
        const mainBet = db.prepare(`
          SELECT prediction FROM bets 
          WHERE user_id = ? AND match_id = ? AND is_final_bet = 0
        `).get(user.id, matchId);
        
        if (mainBet && match.winner) {
          const isCorrect = mainBet.prediction === match.winner;
          if (isCorrect) {
            matchPoints += 3; // За финальный матч 3 очка
          }
        }
        
        // Проверяем финальные параметры
        const finalBets = db.prepare(`
          SELECT parameter_type, prediction FROM bets 
          WHERE user_id = ? AND match_id = ? AND is_final_bet = 1
        `).all(user.id, matchId);
        
        for (const bet of finalBets) {
          let isCorrect = false;
          
          if (bet.parameter_type === 'yellow_cards' && yellow_cards !== undefined) {
            isCorrect = parseInt(bet.prediction) === yellow_cards;
          } else if (bet.parameter_type === 'red_cards' && red_cards !== undefined) {
            isCorrect = parseInt(bet.prediction) === red_cards;
          } else if (bet.parameter_type === 'corners' && corners !== undefined) {
            isCorrect = parseInt(bet.prediction) === corners;
          } else if (bet.parameter_type === 'exact_score' && exact_score) {
            isCorrect = bet.prediction === exact_score;
          } else if (bet.parameter_type === 'penalties_in_game' && penalties_in_game) {
            isCorrect = bet.prediction === penalties_in_game;
          } else if (bet.parameter_type === 'extra_time' && extra_time) {
            isCorrect = bet.prediction === extra_time;
          } else if (bet.parameter_type === 'penalties_at_end' && penalties_at_end) {
            isCorrect = bet.prediction === penalties_at_end;
          }
          
          if (isCorrect) {
            matchPoints += 2;
            correctParams++;
          }
        }
        
        // 🎲 Везунчик - угадал 3+ финальных параметра
        if (correctParams >= 3) {
          const existingLuckyNews = db.prepare(`
            SELECT id FROM news 
            WHERE type = 'achievement' 
            AND message LIKE ?
            AND created_at > datetime('now', '-7 days')
          `).get(`%${user.username}%${match.team1_name}%${match.team2_name}%`);
          
          if (!existingLuckyNews) {
            const newsTitle = `🎲 Везунчик: ${correctParams} параметров!`;
            const newsMessage = `Пользователь ${user.username} угадал ${correctParams} финальных параметра в матче ${match.team1_name} vs ${match.team2_name}!\n\n🔥 Невероятная удача и интуиция!`;
            
            db.prepare(`
              INSERT INTO news (type, title, message)
              VALUES (?, ?, ?)
            `).run('achievement', newsTitle, newsMessage);
            
            console.log(`✅ Автоматически создана новость о везунчике: ${user.username} (${correctParams} параметров)`);
          }
        }
        
        // 💯 Рекорд очков за матч - если набрал 10+ очков за один матч
        if (matchPoints >= 10) {
          // Проверяем это ли максимум для этого пользователя
          const maxPoints = db.prepare(`
            SELECT MAX(points) as max FROM (
              SELECT 
                m.id as match_id,
                SUM(CASE 
                  WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                    CASE WHEN b.prediction = m.winner THEN 3 ELSE 0 END
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
                END) as points
              FROM bets b
              JOIN matches m ON b.match_id = m.id
              LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id
              WHERE b.user_id = ? AND m.id != ?
              GROUP BY m.id
            )
          `).get(user.id, matchId);
          
          if (!maxPoints.max || matchPoints > maxPoints.max) {
            const existingRecordNews = db.prepare(`
              SELECT id FROM news 
              WHERE type = 'achievement' 
              AND message LIKE ?
              AND created_at > datetime('now', '-7 days')
            `).get(`%${user.username}%${matchPoints}%очков за матч%`);
            
            if (!existingRecordNews) {
              const newsTitle = `💯 Рекорд: ${matchPoints} очков за матч!`;
              const newsMessage = `Пользователь ${user.username} установил личный рекорд - ${matchPoints} очков за один матч!\n\n🏆 Матч: ${match.team1_name} vs ${match.team2_name}\n\n🎯 Невероятный результат!`;
              
              db.prepare(`
                INSERT INTO news (type, title, message)
                VALUES (?, ?, ?)
              `).run('achievement', newsTitle, newsMessage);
              
              console.log(`✅ Автоматически создана новость о рекорде очков: ${user.username} (${matchPoints} очков)`);
            }
          }
        }
      }
    } catch (error) {
      console.error("❌ Ошибка проверки везунчика и рекорда очков:", error);
    }

    // Проверяем завершение турнира (для финальных матчей)
    try {
      const matchForCompletion = db.prepare('SELECT is_final FROM matches WHERE id = ?').get(matchId);
      if (matchForCompletion && matchForCompletion.is_final) {
        const { checkAndCreateTournamentCompletionNews } = await import('../services/tournamentCompletionService.js');
        checkAndCreateTournamentCompletionNews(parseInt(matchId));
      }
    } catch (completionError) {
      console.error('❌ Ошибка проверки завершения турнира:', completionError);
    }

    res.json({
      message: "Результаты финальных параметров успешно установлены",
      matchId,
    });
  } catch (error) {
    console.error("Ошибка при установке результатов параметров:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/final-parameters-results - Получить результаты финальных параметров
router.get("/api/final-parameters-results", (req, res) => {
  console.log("🔵 GET /api/final-parameters-results был вызван");
  try {
    const results = db.prepare("SELECT * FROM final_parameters_results").all();

    console.log("✓ Найдено параметров:", results.length);

    // Преобразуем в объект с ключом match_id для удобства
    const resultsMap = {};
    results.forEach((result) => {
      resultsMap[result.match_id] = result;
    });

    console.log("✓ Отправляю результат");
    res.json(resultsMap);
  } catch (error) {
    console.error("❌ Ошибка при получении результатов параметров:", error);
    // Если таблица не существует, возвращаем пустой объект
    res.json({});
  }
});

// GET /api/bet-logs-info - Информация о файле логов ставок
router.get("/api/bet-logs-info", (req, res) => {
  try {
    if (fs.existsSync(LOG_FILE_PATH)) {
      const stats = fs.statSync(LOG_FILE_PATH);
      const sizeInMB = (stats.size / 1024 / 1024).toFixed(2);
      const maxSizeInMB = (MAX_LOG_SIZE / 1024 / 1024).toFixed(0);
      const percentUsed = ((stats.size / MAX_LOG_SIZE) * 100).toFixed(1);
      
      res.json({
        success: true,
        size: stats.size,
        sizeFormatted: `${sizeInMB} MB`,
        maxSize: MAX_LOG_SIZE,
        maxSizeFormatted: `${maxSizeInMB} MB`,
        percentUsed: percentUsed
      });
    } else {
      res.json({
        success: true,
        size: 0,
        sizeFormatted: "0 MB",
        maxSize: MAX_LOG_SIZE,
        maxSizeFormatted: "10 MB",
        percentUsed: "0"
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/user/:userId/show-bets - Получить настройку показа ставок
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

        const adminMessage = `✅️ ИЗМЕНЕНИЕ НАСТРОЙКИ ПОКАЗА СТАВОК

👤 Пользователь: ${user.username}
${user.telegram_username ? `✅ Telegram: @${user.telegram_username}` : ""}
✏️ Новая настройка: ${showBetsNames[show_bets] || show_bets}
✅ Время: ${time}`;

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

export default router;
