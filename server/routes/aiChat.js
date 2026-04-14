import { Router } from 'express';
import { db } from '../database/db.js';
import { getTournamentParticipantsWithPoints, getUserStatsInTournament } from '../utils/tournamentData.js';
import { 
  sendToAI, 
  detectButtons, 
  detectQuestionType, 
  getEventsFromDB, 
  getRemainingMatches, 
  getTournamentBrackets 
} from '../services/aiChatService.js';

const router = Router();

router.post('/api/ai-chat', async (req, res) => {
  console.log('🤖 AI Chat - получен запрос:', req.body);
  
  try {
    const { messages, username, context } = req.body;

    if (!messages || !Array.isArray(messages)) {
      console.log('❌ Неверный формат запроса');
      return res.status(400).json({ error: 'Неверный формат запроса' });
    }

    console.log('🤖 AI Chat - обработка запроса от:', username);
    console.log('🤖 AI Chat - eventId из контекста:', context?.eventId);
    
    // Собираем контекст из БД
    const dbContext = {};

    // Активные турниры
    let events = [];
    try {
      events = getEventsFromDB(db);
      if (events.length > 0) {
        dbContext.events = events.map(e => `• ${e.name} (${e.status || 'активный'})`).join('\n');
      }
      console.log('🤖 AI Chat - турниры загружены:', events.length);
    } catch (e) { 
      console.error('❌ Ошибка получения турниров:', e);
    }

    // Получаем eventId из контекста
    let eventId = context?.eventId || context?.event?.id;
    
    // Если eventId не передан, пытаемся получить из доступных турниров
    if (!eventId && events.length > 0) {
      const activeEvent = events.find(e => e.status === 'active');
      eventId = activeEvent ? activeEvent.id : events[0].id;
      console.log('🤖 AI Chat - eventId не передан, используем турнир:', eventId);
    }
    
    console.log('🤖 AI Chat - используем eventId:', eventId);

    // Участники турнира
    if (eventId) {
      try {
        console.log('🤖 AI Chat - загружаем участников для турнира:', eventId);
        
        const participants = getTournamentParticipantsWithPoints(eventId);
        console.log('🤖 AI Chat - получено участников:', participants ? participants.length : 0);
        
        if (participants && participants.length > 0) {
          const currentTournament = events.find(e => e.id === eventId);
          const tournamentName = currentTournament ? currentTournament.name : `турнир ${eventId}`;
          
          dbContext.participants = `ТУРНИР: ${tournamentName}\n` + 
            participants
              .map((p, index) => `${index + 1}. ${p.username}: ${p.event_won || 0} очков`)
              .join('\n');
          console.log('🤖 AI Chat - участники загружены для AI');
        } else {
          const currentTournament = events.find(e => e.id === eventId);
          const tournamentName = currentTournament ? currentTournament.name : `турнир ${eventId}`;
          dbContext.participants = `В турнире "${tournamentName}" пока нет участников с завершенными ставками.`;
        }
      } catch (e) { 
        console.error('❌ Ошибка получения участников турнира:', e);
        dbContext.participants = `Ошибка загрузки данных турнира ${eventId}.`;
      }
    }

    // Добавляем контекст страницы для AI
    if (context) {
      dbContext.pageContext = `Секция: ${context.section || 'неизвестно'}
Турнир: ${context.event?.name || 'не выбран'}
Тур: ${context.round || 'не выбран'}
Модальное окно: ${context.modal || 'закрыто'}`;
    }

    console.log('🤖 AI Chat - отправляем в AI, контекст:', Object.keys(dbContext));

    // Отправляем в AI
    const result = await sendToAI(messages, dbContext);
    
    console.log('🤖 AI Chat - ответ от AI получен:', result.success, result.provider);

    if (!result.success) {
      return res.json({ error: result.text, text: result.text });
    }

    res.json({
      text: result.text,
      provider: result.provider,
    });

  } catch (error) {
    console.error('❌ Ошибка AI-чата:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера', text: 'Произошла ошибка. Попробуй позже.' });
  }
});

export default router;
