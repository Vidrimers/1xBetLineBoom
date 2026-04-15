/**
 * Сервис для работы с AI чатом
 * Обрабатывает запросы к AI и предоставляет контекст из БД
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { HfInference } from '@huggingface/inference';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Инициализация AI провайдеров
const genAI = process.env.GEMINI_API_KEY 
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const hf = process.env.HUGGINGFACE_API_KEY
  ? new HfInference(process.env.HUGGINGFACE_API_KEY)
  : null;

const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;

/**
 * Отправляет сообщения в AI и получает ответ
 * @param {Array} messages - Массив сообщений чата
 * @param {Object} dbContext - Контекст из базы данных
 * @returns {Promise<Object>} Результат с текстом ответа и провайдером
 */
export async function sendToAI(messages, dbContext = {}) {
  try {
    // Формируем системный промпт с контекстом
    const systemPrompt = buildSystemPrompt(dbContext);
    
    // Пробуем Gemini (старый SDK, но стабильный)
    if (genAI) {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
        
        const chat = model.startChat({
          history: messages.slice(0, -1).map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }],
          })),
        });

        const lastMessage = messages[messages.length - 1];
        const result = await chat.sendMessage(systemPrompt + '\n\n' + lastMessage.content);
        const response = await result.response;
        
        return {
          success: true,
          text: response.text(),
          provider: 'Gemini Pro',
        };
      } catch (geminiError) {
        console.error('❌ Ошибка Gemini:', geminiError.message);
      }
    }

    // Пробуем Hugging Face (бесплатный fallback)
    if (hf) {
      try {
        // Формируем промпт из всех сообщений
        const fullPrompt = systemPrompt + '\n\n' + messages.map(msg => 
          `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
        ).join('\n\n');

        const response = await hf.textGeneration({
          model: 'mistralai/Mistral-7B-Instruct-v0.2',
          inputs: fullPrompt,
          parameters: {
            max_new_tokens: 1000,
            temperature: 0.7,
            return_full_text: false,
          }
        });

        return {
          success: true,
          text: response.generated_text,
          provider: 'Hugging Face',
        };
      } catch (hfError) {
        console.error('❌ Ошибка Hugging Face:', hfError.message);
      }
    }

    // Пробуем Groq
    if (groq) {
      try {
        const chatMessages = [
          { role: 'system', content: systemPrompt },
          ...messages.map(msg => ({
            role: msg.role,
            content: msg.content,
          })),
        ];

        const completion = await groq.chat.completions.create({
          messages: chatMessages,
          model: 'llama-3.3-70b-versatile',
          temperature: 0.7,
          max_tokens: 1000,
        });

        return {
          success: true,
          text: completion.choices[0]?.message?.content || 'Нет ответа',
          provider: 'Groq',
        };
      } catch (groqError) {
        console.error('❌ Ошибка Groq:', groqError.message);
      }
    }

    // Если оба провайдера недоступны
    return {
      success: false,
      text: 'AI сервисы временно недоступны. Проверьте API ключи в .env файле.',
      provider: 'none',
    };

  } catch (error) {
    console.error('❌ Ошибка sendToAI:', error);
    return {
      success: false,
      text: 'Произошла ошибка при обращении к AI.',
      provider: 'error',
    };
  }
}

/**
 * Формирует системный промпт с контекстом из БД
 * @param {Object} dbContext - Контекст из базы данных
 * @returns {string} Системный промпт
 */
function buildSystemPrompt(dbContext) {
  let prompt = `Ты - помощник для сайта ставок на футбол 1xBetLineBoom. 
Отвечай кратко и по делу. Используй эмодзи для наглядности.

СИСТЕМА ПОДСЧЕТА ОЧКОВ:
• За угаданный результат обычного матча: 1 очко
• За угаданный результат финального матча: 3 очка
• За угаданный точный счет: +1 дополнительное очко
• За угаданные желтые карточки: +1 дополнительное очко
• За угаданные красные карточки: +1 дополнительное очко
• За финальные параметры турнира (общее кол-во карточек, угловых и т.д.): 2 очка за каждый
• За угаданного победителя в турнирной сетке: 1 очко (3 очка за финал)

ВАЖНО: Максимум за один обычный матч можно получить 4 очка (результат + счет + желтые + красные).
За финальный матч максимум 6 очков (3 за результат + счет + желтые + красные).

`;

  if (dbContext.events) {
    prompt += `АКТИВНЫЕ ТУРНИРЫ:\n${dbContext.events}\n\n`;
  }

  if (dbContext.participants) {
    prompt += `УЧАСТНИКИ И ОЧКИ:\n${dbContext.participants}\n\n`;
  }

  if (dbContext.pageContext) {
    prompt += `КОНТЕКСТ СТРАНИЦЫ:\n${dbContext.pageContext}\n\n`;
  }

  return prompt;
}

/**
 * Определяет тип вопроса пользователя
 * @param {string} question - Вопрос пользователя
 * @returns {string} Тип вопроса
 */
export function detectQuestionType(question) {
  const lowerQuestion = question.toLowerCase();
  
  if (lowerQuestion.includes('турнир') || lowerQuestion.includes('событие')) {
    return 'tournament';
  }
  
  if (lowerQuestion.includes('участник') || lowerQuestion.includes('игрок') || lowerQuestion.includes('очки')) {
    return 'participants';
  }
  
  if (lowerQuestion.includes('матч') || lowerQuestion.includes('игра')) {
    return 'matches';
  }
  
  if (lowerQuestion.includes('ставка') || lowerQuestion.includes('прогноз')) {
    return 'bets';
  }
  
  return 'general';
}

/**
 * Определяет, нужны ли кнопки в ответе
 * @param {string} text - Текст ответа AI
 * @returns {Array|null} Массив кнопок или null
 */
export function detectButtons(text) {
  // Пока не реализовано, можно добавить логику определения кнопок
  return null;
}

/**
 * Получает список событий из БД
 * @param {Object} db - Экземпляр базы данных
 * @returns {Array} Массив событий
 */
export function getEventsFromDB(db) {
  try {
    const events = db.prepare(`
      SELECT id, name, status, start_date, end_date
      FROM events
      ORDER BY start_date DESC
      LIMIT 10
    `).all();
    
    return events;
  } catch (error) {
    console.error('❌ Ошибка получения событий:', error);
    return [];
  }
}

/**
 * Получает оставшиеся матчи для события
 * @param {Object} db - Экземпляр базы данных
 * @param {number} eventId - ID события
 * @returns {Array} Массив матчей
 */
export function getRemainingMatches(db, eventId) {
  try {
    const matches = db.prepare(`
      SELECT id, home_team, away_team, match_time, round
      FROM matches
      WHERE event_id = ? AND status = 'scheduled'
      ORDER BY match_time ASC
    `).all(eventId);
    
    return matches;
  } catch (error) {
    console.error('❌ Ошибка получения матчей:', error);
    return [];
  }
}

/**
 * Получает данные турнирной сетки
 * @param {Object} db - Экземпляр базы данных
 * @param {number} eventId - ID события
 * @returns {Object} Данные турнирной сетки
 */
export function getTournamentBrackets(db, eventId) {
  try {
    const brackets = db.prepare(`
      SELECT *
      FROM bracket_predictions
      WHERE event_id = ?
    `).all(eventId);
    
    return brackets;
  } catch (error) {
    console.error('❌ Ошибка получения турнирной сетки:', error);
    return [];
  }
}
