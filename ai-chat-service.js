// AI Chat Service - обработка запросов к AI
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Инициализация AI клиентов
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Счётчики для отслеживания лимитов
let geminiRequestCount = 0;
let geminiLastReset = Date.now();
const GEMINI_LIMIT_PER_MINUTE = 15;

/**
 * Сброс счётчика Gemini каждую минуту
 */
function resetGeminiCounter() {
  const now = Date.now();
  if (now - geminiLastReset >= 60000) {
    geminiRequestCount = 0;
    geminiLastReset = now;
  }
}

/**
 * Отправка запроса в Gemini API
 */
async function callGemini(messages, systemPrompt) {
  resetGeminiCounter();
  
  if (geminiRequestCount >= GEMINI_LIMIT_PER_MINUTE) {
    throw new Error('GEMINI_LIMIT_EXCEEDED');
  }

  try {
    const model = gemini.getGenerativeModel({ model: 'gemini-pro' });
    
    // Формируем полный промпт
    const fullPrompt = `${systemPrompt}\n\nИстория диалога:\n${messages.map(m => 
      `${m.role === 'user' ? 'Пользователь' : 'AI'}: ${m.content}`
    ).join('\n')}\n\nОтветь на последний вопрос пользователя:`;
    
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();
    
    geminiRequestCount++;
    return { success: true, text, provider: 'gemini' };
  } catch (error) {
    console.error('❌ Ошибка Gemini:', error.message);
    throw error;
  }
}

/**
 * Отправка запроса в Groq API (fallback)
 */
async function callGroq(messages, systemPrompt) {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      model: 'llama-3.3-70b-versatile', // Быстрая и качественная модель
      temperature: 0.7,
      max_tokens: 1024,
    });

    const text = chatCompletion.choices[0]?.message?.content || '';
    return { success: true, text, provider: 'groq' };
  } catch (error) {
    console.error('❌ Ошибка Groq:', error.message);
    throw error;
  }
}

/**
 * Главная функция для отправки запроса в AI
 * Пробует Gemini, при ошибке переключается на Groq
 */
export async function sendToAI(messages, context = {}) {
  // Системный промпт для AI
  const systemPrompt = `Ты - помощник на сайте прогнозов на футбол "1xBetLineBoom".

Твоя задача:
- Помогать пользователям с турнирами и прогнозами на сайте
- Отвечать на вопросы о турнирах, участниках и их результатах
- Помогать сравнивать участников и оценивать шансы догнать лидеров
- Объяснять правила и механику сайта (включая сетки плей-офф)
- Помогать анализировать матчи
- Отвечать на вопросы о футболе
- УВАЖАТЬ приватность пользователей - если ставки скрыты, сообщи об этом
- Использовать контекст текущей страницы для более точных ответов

Правила:
- Отвечай кратко и по делу (максимум 3-4 предложения)
- Используй эмодзи для наглядности (⚽ 📊 💰 ⚠️ 🏆 🔒)
- Всегда на русском языке
- Если не знаешь точного ответа - честно скажи об этом
- Это сайт ПРОГНОЗОВ, а не ставок на деньги
- При сравнении пользователей учитывай количество оставшихся матчей
- Если ставки пользователя скрыты (🔒) - НЕ показывай их и объясни что они приватные
- Если пользователь спрашивает "кто лидирует" или "какие матчи" - используй контекст текущего турнира

${context.pageContext ? `\n📍 КОНТЕКСТ СТРАНИЦЫ:\n${context.pageContext}\n` : ''}
${context.events ? `\nАктивные турниры на сайте:\n${context.events}` : ''}
${context.participants ? `\nТаблица лидеров:\n${context.participants}` : ''}
${context.userStats ? `\n${context.userStats}` : ''}
${context.comparison ? `\n${context.comparison}` : ''}
${context.bets ? `\n${context.bets}` : ''}
${context.brackets ? `\n${context.brackets}` : ''}
${context.remainingMatches ? `\n${context.remainingMatches}` : ''}
${context.matches ? `\nПредстоящие матчи:\n${context.matches}` : ''}
${context.stats ? `\nСтатистика:\n${context.stats}` : ''}`;

  try {
    // Пробуем Gemini
    return await callGemini(messages, systemPrompt);
  } catch (error) {
    console.log('⚠️ Gemini недоступен, переключаюсь на Groq...');
    
    // Если Gemini не сработал, пробуем Groq
    try {
      return await callGroq(messages, systemPrompt);
    } catch (groqError) {
      console.error('❌ Оба AI провайдера недоступны');
      return {
        success: false,
        text: 'Извини, AI временно недоступен. Попробуй позже.',
        provider: 'none'
      };
    }
  }
}

/**
 * Определяет нужно ли показать интерактивные кнопки
 */
export function detectButtons(userMessage) {
  const lowerMsg = userMessage.toLowerCase();
  
  // Если спрашивает про матч
  if (lowerMsg.includes('матч') || lowerMsg.includes('игра') || lowerMsg.includes('игр')) {
    return {
      type: 'tournaments',
      buttons: [
        { id: 'rpl', label: '⚽ РПЛ' },
        { id: 'cl', label: '🏆 Лига Чемпионов' },
        { id: 'el', label: '🌍 Лига Европы' },
        { id: 'ecl', label: '🏅 Конференц-лига' },
        { id: 'other', label: '📋 Другие' }
      ]
    };
  }
  
  return null;
}

/**
 * Определяет тип вопроса для добавления контекста
 */
export function detectQuestionType(userMessage) {
  const lowerMsg = userMessage.toLowerCase();
  
  if (lowerMsg.includes('турнир') || lowerMsg.includes('соревнован')) {
    return 'tournaments';
  }
  
  if (lowerMsg.includes('участник') || lowerMsg.includes('игрок') || lowerMsg.includes('лидер') || lowerMsg.includes('таблиц')) {
    return 'participants';
  }
  
  if (lowerMsg.includes('правил') || lowerMsg.includes('как работа') || lowerMsg.includes('как играть')) {
    return 'rules';
  }
  
  if (lowerMsg.includes('статистик') || lowerMsg.includes('результат')) {
    return 'stats';
  }
  
  return 'general';
}

/**
 * Получает список матчей из базы данных
 */
export function getMatchesFromDB(db, tournamentCode = null) {
  try {
    let query = `
      SELECT 
        m.id,
        m.homeTeam,
        m.awayTeam,
        m.utcDate,
        m.competition,
        m.status
      FROM matches m
      WHERE m.status = 'SCHEDULED'
        AND datetime(m.utcDate) >= datetime('now')
      ${tournamentCode ? `AND m.competition = ?` : ''}
      ORDER BY m.utcDate ASC
      LIMIT 10
    `;
    
    const matches = tournamentCode 
      ? db.prepare(query).all(tournamentCode)
      : db.prepare(query).all();
    
    return matches;
  } catch (error) {
    console.error('❌ Ошибка получения матчей:', error);
    return [];
  }
}

/**
 * Форматирует матчи для отображения в кнопках
 */
export function formatMatchButtons(matches) {
  return matches.map(m => {
    const date = new Date(m.utcDate);
    const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return {
      id: `match_${m.id}`,
      label: `${m.homeTeam} - ${m.awayTeam} (${time})`
    };
  });
}

/**
 * Получает детальную информацию о матче
 */
export function getMatchDetails(db, matchId) {
  try {
    const match = db.prepare(`
      SELECT 
        m.*,
        GROUP_CONCAT(DISTINCT p.username) as predictors
      FROM matches m
      LEFT JOIN predictions p ON p.matchId = m.id
      WHERE m.id = ?
      GROUP BY m.id
    `).get(matchId);
    
    return match;
  } catch (error) {
    console.error('❌ Ошибка получения деталей матча:', error);
    return null;
  }
}

/**
 * Получает список турниров из базы данных
 */
export function getEventsFromDB(db) {
  try {
    const events = db.prepare(`
      SELECT 
        id,
        name,
        competition,
        start_date,
        end_date,
        is_active
      FROM events
      WHERE is_active = 1
      ORDER BY start_date DESC
      LIMIT 20
    `).all();
    
    return events;
  } catch (error) {
    console.error('❌ Ошибка получения турниров:', error);
    return [];
  }
}

/**
 * Получает участников турнира с детальной статистикой
 */
export function getTournamentParticipants(db, eventId) {
  try {
    const participants = db.prepare(`
      SELECT 
        u.id,
        u.username,
        COUNT(DISTINCT b.id) as total_bets,
        SUM(CASE WHEN b.points > 0 THEN b.points ELSE 0 END) as total_points,
        COUNT(CASE WHEN b.points = 3 THEN 1 END) as exact_predictions,
        COUNT(CASE WHEN b.points = 1 THEN 1 END) as outcome_predictions,
        COUNT(CASE WHEN b.points = 0 THEN 1 END) as wrong_predictions
      FROM users u
      LEFT JOIN bets b ON b.user_id = u.id AND b.event_id = ?
      WHERE u.id IN (
        SELECT DISTINCT user_id FROM bets WHERE event_id = ?
      )
      GROUP BY u.id
      ORDER BY total_points DESC
    `).all(eventId, eventId);
    
    return participants;
  } catch (error) {
    console.error('❌ Ошибка получения участников:', error);
    return [];
  }
}

/**
 * Получает детальную информацию о конкретном участнике турнира
 */
export function getUserTournamentStats(db, eventId, username) {
  try {
    const user = db.prepare(`
      SELECT id FROM users WHERE username = ? COLLATE NOCASE
    `).get(username);
    
    if (!user) return null;
    
    const stats = db.prepare(`
      SELECT 
        u.username,
        COUNT(DISTINCT b.id) as total_bets,
        SUM(CASE WHEN b.points > 0 THEN b.points ELSE 0 END) as total_points,
        COUNT(CASE WHEN b.points = 3 THEN 1 END) as exact_predictions,
        COUNT(CASE WHEN b.points = 1 THEN 1 END) as outcome_predictions,
        COUNT(CASE WHEN b.points = 0 THEN 1 END) as wrong_predictions,
        (SELECT COUNT(*) FROM bets WHERE event_id = ? AND user_id = u.id AND points IS NULL) as pending_bets
      FROM users u
      LEFT JOIN bets b ON b.user_id = u.id AND b.event_id = ?
      WHERE u.id = ?
      GROUP BY u.id
    `).get(eventId, eventId, user.id);
    
    // Получаем позицию в турнире
    const position = db.prepare(`
      SELECT COUNT(*) + 1 as position
      FROM (
        SELECT user_id, SUM(CASE WHEN points > 0 THEN points ELSE 0 END) as pts
        FROM bets
        WHERE event_id = ?
        GROUP BY user_id
        HAVING pts > (
          SELECT SUM(CASE WHEN points > 0 THEN points ELSE 0 END)
          FROM bets
          WHERE event_id = ? AND user_id = ?
        )
      )
    `).get(eventId, eventId, user.id);
    
    if (stats) {
      stats.position = position.position;
    }
    
    return stats;
  } catch (error) {
    console.error('❌ Ошибка получения статистики пользователя:', error);
    return null;
  }
}

/**
 * Сравнивает двух пользователей в турнире
 */
export function compareUsers(db, eventId, username1, username2) {
  try {
    const user1Stats = getUserTournamentStats(db, eventId, username1);
    const user2Stats = getUserTournamentStats(db, eventId, username2);
    
    if (!user1Stats || !user2Stats) return null;
    
    const difference = user2Stats.total_points - user1Stats.total_points;
    const maxPointsPerBet = 3;
    const betsNeeded = Math.ceil(Math.abs(difference) / maxPointsPerBet);
    
    return {
      user1: user1Stats,
      user2: user2Stats,
      difference: difference,
      betsNeeded: betsNeeded,
      canCatchUp: user1Stats.pending_bets >= betsNeeded
    };
  } catch (error) {
    console.error('❌ Ошибка сравнения пользователей:', error);
    return null;
  }
}

/**
 * Получает оставшиеся матчи в турнире
 */
export function getRemainingMatches(db, eventId) {
  try {
    const matches = db.prepare(`
      SELECT COUNT(*) as count
      FROM matches m
      WHERE m.event_id = ?
        AND m.status IN ('SCHEDULED', 'TIMED', 'IN_PLAY')
    `).get(eventId);
    
    return matches ? matches.count : 0;
  } catch (error) {
    console.error('❌ Ошибка получения оставшихся матчей:', error);
    return 0;
  }
}

/**
 * Получает информацию о сетках турнира
 */
export function getTournamentBrackets(db, eventId) {
  try {
    const brackets = db.prepare(`
      SELECT 
        id,
        name,
        start_date,
        start_stage,
        lock_dates
      FROM brackets
      WHERE event_id = ?
      ORDER BY start_date DESC
    `).all(eventId);
    
    return brackets;
  } catch (error) {
    console.error('❌ Ошибка получения сеток:', error);
    return [];
  }
}

/**
 * Проверяет настройки приватности пользователя
 */
export function checkUserPrivacy(db, username) {
  try {
    const user = db.prepare(`
      SELECT show_bets FROM users WHERE username = ? COLLATE NOCASE
    `).get(username);
    
    if (!user) return { exists: false, showBets: false };
    
    // show_bets может быть: 'always', 'after_match', 'never'
    return {
      exists: true,
      showBets: user.show_bets || 'always',
      canShowNow: user.show_bets === 'always'
    };
  } catch (error) {
    console.error('❌ Ошибка проверки приватности:', error);
    return { exists: false, showBets: false };
  }
}

/**
 * Получает ставки пользователя (с учётом приватности)
 */
export function getUserBets(db, eventId, username, requestingUser) {
  try {
    // Проверяем приватность
    const privacy = checkUserPrivacy(db, username);
    
    if (!privacy.exists) {
      return { error: 'USER_NOT_FOUND', message: 'Пользователь не найден' };
    }
    
    // Если это сам пользователь запрашивает свои ставки - показываем
    if (requestingUser && requestingUser.toLowerCase() === username.toLowerCase()) {
      privacy.canShowNow = true;
    }
    
    if (!privacy.canShowNow) {
      return { 
        error: 'PRIVACY_RESTRICTED', 
        message: `${username} скрыл свои ставки от других пользователей 🔒`,
        showBets: privacy.showBets
      };
    }
    
    const user = db.prepare(`
      SELECT id FROM users WHERE username = ? COLLATE NOCASE
    `).get(username);
    
    const bets = db.prepare(`
      SELECT 
        b.*,
        m.homeTeam,
        m.awayTeam,
        m.utcDate,
        m.status as matchStatus
      FROM bets b
      JOIN matches m ON m.id = b.match_id
      WHERE b.user_id = ? AND b.event_id = ?
      ORDER BY m.utcDate DESC
      LIMIT 20
    `).all(user.id, eventId);
    
    return { success: true, bets: bets };
  } catch (error) {
    console.error('❌ Ошибка получения ставок:', error);
    return { error: 'DATABASE_ERROR', message: 'Ошибка получения данных' };
  }
}

/**
 * Получает прогнозы пользователя в сетке (с учётом приватности)
 */
export function getUserBracketPredictions(db, bracketId, username, requestingUser) {
  try {
    // Проверяем приватность
    const privacy = checkUserPrivacy(db, username);
    
    if (!privacy.exists) {
      return { error: 'USER_NOT_FOUND', message: 'Пользователь не найден' };
    }
    
    // Если это сам пользователь - показываем
    if (requestingUser && requestingUser.toLowerCase() === username.toLowerCase()) {
      privacy.canShowNow = true;
    }
    
    if (!privacy.canShowNow) {
      return { 
        error: 'PRIVACY_RESTRICTED', 
        message: `${username} скрыл свои прогнозы от других пользователей 🔒`
      };
    }
    
    const user = db.prepare(`
      SELECT id FROM users WHERE username = ? COLLATE NOCASE
    `).get(username);
    
    const predictions = db.prepare(`
      SELECT 
        bp.*,
        COUNT(*) as total_predictions,
        SUM(CASE WHEN bp.points > 0 THEN bp.points ELSE 0 END) as total_points
      FROM bracket_predictions bp
      WHERE bp.bracket_id = ? AND bp.user_id = ?
      GROUP BY bp.user_id
    `).get(bracketId, user.id);
    
    return { success: true, predictions: predictions };
  } catch (error) {
    console.error('❌ Ошибка получения прогнозов сетки:', error);
    return { error: 'DATABASE_ERROR', message: 'Ошибка получения данных' };
  }
}

/**
 * Получает статистику пользователя
 */
export function getUserStats(db, username) {
  try {
    const user = db.prepare(`
      SELECT id FROM users WHERE username = ?
    `).get(username);
    
    if (!user) return null;
    
    const stats = db.prepare(`
      SELECT 
        COUNT(DISTINCT b.event_id) as tournaments_played,
        COUNT(b.id) as total_bets,
        SUM(CASE WHEN b.points > 0 THEN b.points ELSE 0 END) as total_points,
        AVG(CASE WHEN b.points > 0 THEN b.points ELSE 0 END) as avg_points
      FROM bets b
      WHERE b.user_id = ?
    `).get(user.id);
    
    return stats;
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    return null;
  }
}
