import express from 'express';
import { db } from '../database/db.js';
import {
  sendToAI,
  detectButtons,
  detectQuestionType,
  getMatchesFromDB,
  getEventsFromDB,
  getTournamentParticipants,
  getUserTournamentStats,
  compareUsers,
  getRemainingMatches,
  getTournamentBrackets,
  getUserBets,
  getUserBracketPredictions,
  getUserStats,
  formatMatchButtons,
  getMatchDetails,
} from '../../ai-chat-service.js';

const router = express.Router();

router.post('/api/ai-chat', async (req, res) => {
  try {
    const { messages, username, context } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Неверный формат запроса' });
    }

    const lastMessage = messages[messages.length - 1]?.content || '';
    const questionType = detectQuestionType(lastMessage);

    // Собираем контекст из БД
    const dbContext = {};

    // Активные турниры
    try {
      const events = getEventsFromDB(db);
      if (events.length > 0) {
        dbContext.events = events.map(e => `• ${e.name} (${e.status || 'активный'})`).join('\n');
      }
    } catch (e) { /* игнорируем */ }

    // Контекст страницы из клиента
    if (context) {
      if (context.eventId) {
        // Участники турнира
        try {
          const participants = getTournamentParticipants(db, context.eventId);
          if (participants.length > 0) {
            dbContext.participants = participants
              .map((p, i) => `${i + 1}. ${p.username}: ${p.total_points || 0} очков`)
              .join('\n');
          }
        } catch (e) { /* игнорируем */ }

        // Оставшиеся матчи
        try {
          const remaining = getRemainingMatches(db, context.eventId);
          if (remaining.length > 0) {
            dbContext.remainingMatches = `Осталось матчей: ${remaining.length}`;
          }
        } catch (e) { /* игнорируем */ }

        // Сетки
        try {
          const brackets = getTournamentBrackets(db, context.eventId);
          if (brackets.length > 0) {
            dbContext.brackets = brackets.map(b => `• ${b.name}`).join('\n');
          }
        } catch (e) { /* игнорируем */ }
      }

      // Статистика пользователя
      if (username && context.eventId) {
        try {
          const userStats = getUserTournamentStats(db, context.eventId, username);
          if (userStats) {
            dbContext.userStats = `${username}: ${userStats.total_points || 0} очков, место ${userStats.rank || '?'}`;
          }
        } catch (e) { /* игнорируем */ }

        // Ставки пользователя
        if (questionType === 'bets') {
          try {
            const bets = getUserBets(db, context.eventId, username, username);
            if (bets && bets.length > 0) {
              dbContext.bets = bets.slice(0, 10)
                .map(b => `• ${b.team1} vs ${b.team2}: ${b.prediction}`)
                .join('\n');
            }
          } catch (e) { /* игнорируем */ }
        }
      }

      // Сравнение пользователей
      if (context.compareWith && username && context.eventId) {
        try {
          const comparison = compareUsers(db, context.eventId, username, context.compareWith);
          if (comparison) {
            dbContext.comparison = `${username} vs ${context.compareWith}`;
          }
        } catch (e) { /* игнорируем */ }
      }

      // Матчи
      if (questionType === 'matches' && context.eventId) {
        try {
          const matches = getMatchesFromDB(db, null);
          if (matches.length > 0) {
            dbContext.matches = matches.slice(0, 5)
              .map(m => `• ${m.team1} vs ${m.team2} (${m.round || 'тур ?'})`)
              .join('\n');
          }
        } catch (e) { /* игнорируем */ }
      }
    }

    // Отправляем в AI
    const result = await sendToAI(messages, dbContext);

    if (!result.success) {
      return res.json({ error: result.text, text: result.text });
    }

    // Определяем кнопки
    const buttonInfo = detectButtons(lastMessage);
    let buttons = null;
    let buttonType = null;

    if (buttonInfo) {
      buttonType = buttonInfo.type;
      if (buttonType === 'tournaments') {
        try {
          const events = getEventsFromDB(db);
          buttons = events.slice(0, 5).map(e => ({ label: e.name, value: e.id }));
        } catch (e) { /* игнорируем */ }
      } else if (buttonType === 'matches' && context?.eventId) {
        try {
          const matches = getMatchesFromDB(db, null);
          buttons = formatMatchButtons(matches.slice(0, 5));
        } catch (e) { /* игнорируем */ }
      }
    }

    res.json({
      text: result.text,
      provider: result.provider,
      buttons,
      buttonType,
    });

  } catch (error) {
    console.error('❌ Ошибка AI-чата:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера', text: 'Произошла ошибка. Попробуй позже.' });
  }
});

export default router;
