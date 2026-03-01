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
  const systemPrompt = `Ты - помощник на сайте ставок на футбол.

Твоя задача:
- Помогать пользователям анализировать матчи
- Находить выгодные ставки
- Объяснять статистику команд
- Отвечать на вопросы о футболе и ставках

Правила:
- Отвечай кратко и по делу (максимум 3-4 предложения)
- Используй эмодзи для наглядности (⚽ 📊 💰 ⚠️)
- Всегда на русском языке
- Если не знаешь точного ответа - честно скажи об этом
- Не давай финансовых советов, только анализ

${context.matches ? `\nДоступные матчи:\n${context.matches}` : ''}
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
