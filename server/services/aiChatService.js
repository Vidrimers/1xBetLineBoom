/**
 * Сервис для работы с AI чатом
 * Обрабатывает запросы к AI и предоставляет контекст из БД
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { HfInference } from '@huggingface/inference';
import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { CohereClient } from 'cohere-ai';
import Replicate from 'replicate';
// import Anthropic from '@anthropic-ai/sdk'; // УБРАН - платный после $5
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

// Cerebras - 1M токенов/день бесплатно
const cerebras = process.env.CEREBRAS_API_KEY
  ? new OpenAI({ apiKey: process.env.CEREBRAS_API_KEY, baseURL: 'https://api.cerebras.ai/v1' })
  : null;

// OpenRouter - 50 запросов/день бесплатно
const openrouter = process.env.OPENROUTER_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' })
  : null;

// Cohere - 1000 запросов/месяц бесплатно
const cohere = process.env.COHERE_API_KEY
  ? new CohereClient({ token: process.env.COHERE_API_KEY })
  : null;

// Together AI - УБРАН (требует минимум $5 покупку кредитов)
// const together = process.env.TOGETHER_API_KEY
//   ? new OpenAI({ apiKey: process.env.TOGETHER_API_KEY, baseURL: 'https://api.together.xyz/v1' })
//   : null;

// Replicate - $5 бесплатных кредитов на 14 дней
const replicate = process.env.REPLICATE_API_TOKEN
  ? new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  : null;

// Cloudflare Workers AI - 10,000 нейронов/день бесплатно
const cloudflare = (process.env.CLOUDFLARE_API_KEY && process.env.CLOUDFLARE_ACCOUNT_ID)
  ? new OpenAI({ 
      apiKey: process.env.CLOUDFLARE_API_KEY, 
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1` 
    })
  : null;

// Anthropic Claude - УБРАН (платный после $5 кредитов)
// const anthropic = process.env.ANTHROPIC_API_KEY
//   ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
//   : null;

// Perplexity - УБРАН (требует добавить карту)
// const perplexity = process.env.PERPLEXITY_API_KEY
//   ? new OpenAI({ apiKey: process.env.PERPLEXITY_API_KEY, baseURL: 'https://api.perplexity.ai' })
//   : null;

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
    
    // Пробуем Groq (основной провайдер - мощные модели)
    if (groq) {
      // Актуальные рабочие модели Groq 2026
      const groqModels = [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
      ];

      for (const model of groqModels) {
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
            model,
            temperature: 0.7,
            max_tokens: 1000,
          });

          const responseText = completion.choices[0]?.message?.content;
          if (responseText && responseText.trim()) {
            return {
              success: true,
              text: responseText.trim(),
              provider: `Groq (${model})`,
            };
          }
        } catch (groqError) {
          // Если лимит - пробуем следующую модель
          if (groqError.message?.includes('rate_limit') || groqError.status === 429) {
            console.error(`❌ Groq лимит (${model}), пробуем следующую модель...`);
            continue;
          }
          console.error(`❌ Ошибка Groq (${model}):`, groqError.message);
          continue; // Пробуем следующую модель
        }
      }
    }

    // Пробуем Gemini (второй провайдер)
    if (genAI) {
      // Пробуем новые модели Gemini 2.5 (2026)
      const geminiModels = [
        'gemini-2.5-flash',      // Новая быстрая модель
        'gemini-2.5-pro',        // Новая мощная модель  
        'gemini-2.5-flash-lite', // Новая легкая модель
        'gemini-1.5-pro',        // Старые модели как fallback
        'gemini-pro',
        'gemini-1.5-flash',
      ];
      
      for (const modelName of geminiModels) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          
          // Если есть история сообщений, используем chat API
          if (messages.length > 1) {
            // Формируем историю с системным промптом в начале
            const history = [
              { role: 'user', parts: [{ text: systemPrompt }] },
              { role: 'model', parts: [{ text: 'Понял! Я буду отвечать согласно этим инструкциям.' }] },
              ...messages.slice(0, -1).map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
              }))
            ];
            
            const chat = model.startChat({
              history,
              generationConfig: {
                maxOutputTokens: 1000,
                temperature: 0.7,
              },
            });
            
            const result = await chat.sendMessage(messages[messages.length - 1].content);
            const response = await result.response;
            const text = response.text();
            
            if (text && text.trim()) {
              return {
                success: true,
                text: text.trim(),
                provider: `Gemini (${modelName})`,
              };
            }
          } else {
            // Для первого сообщения используем обычный generateContent
            const fullPrompt = systemPrompt + '\n\nВопрос пользователя: ' + messages[0].content;
            const result = await model.generateContent(fullPrompt);
            const response = await result.response;
            const text = response.text();
            
            if (text && text.trim()) {
              return {
                success: true,
                text: text.trim(),
                provider: `Gemini (${modelName})`,
              };
            }
          }
        } catch (geminiError) {
          console.error(`❌ Ошибка Gemini (${modelName}):`, geminiError.message);
          continue; // Пробуем следующую модель
        }
      }
    }

    // Пробуем Cohere (1000 запросов/месяц бесплатно)
    if (cohere) {
      try {
        const response = await cohere.chat({
          model: 'command-r-08-2024',  // Актуальная модель 2026
          message: messages[messages.length - 1].content,
          preamble: systemPrompt,
          chatHistory: messages.slice(0, -1).map(msg => ({
            role: msg.role === 'user' ? 'USER' : 'CHATBOT',
            message: msg.content
          })),
          maxTokens: 1000,
          temperature: 0.7,
        });

        return {
          success: true,
          text: response.text,
          provider: 'Cohere',
        };
      } catch (cohereError) {
        console.error('❌ Ошибка Cohere:', cohereError.message);
      }
    }

    // Together AI - УБРАН (требует минимум $5 покупку кредитов)
    // Anthropic Claude - УБРАН (платный после $5 кредитов)
    // Perplexity - УБРАН (требует добавить карту)

    // Пробуем Hugging Face (новый Router API)
    if (hf) {
      const hfModels = [
        'meta-llama/Llama-3.1-8B-Instruct',        // Текущая рабочая модель (8B) - ОСНОВНАЯ
        'Qwen/Qwen2.5-7B-Instruct',                // Qwen 7B - быстрая и качественная
        'Qwen/Qwen2.5-Coder-7B-Instruct',         // Qwen Coder - для технических вопросов
        'meta-llama/Meta-Llama-3-8B-Instruct',    // Llama 3 8B - стабильная модель
        'Qwen/Qwen2.5-Coder-3B-Instruct',         // Qwen Coder 3B - легкая модель для кода
        'Qwen/Qwen3-8B',                           // Qwen3 8B - новая модель
      ];

      for (const model of hfModels) {
        try {
          // Используем новый Router API Hugging Face
          const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                ...messages
              ],
              max_tokens: 1000,
              temperature: 0.7,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            return {
              success: true,
              text: data.choices[0].message.content,
              provider: `Hugging Face (${model.split('/')[1]})`,
            };
          }
        } catch (hfError) {
          console.error(`❌ Ошибка Hugging Face (${model}):`, hfError.message);
          continue; // Пробуем следующую модель
        }
      }
    }

    // Пробуем Cerebras (1M токенов/день бесплатно)
    if (cerebras) {
      try {
        const completion = await cerebras.chat.completions.create({
          model: 'llama3.1-8b', // Рабочая модель
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages
          ],
          max_tokens: 1000,
          temperature: 0.7,
        });
        return {
          success: true,
          text: completion.choices[0]?.message?.content || 'Нет ответа',
          provider: 'Cerebras',
        };
      } catch (e) {
        console.error('❌ Ошибка Cerebras:', e.message);
      }
    }

    // Пробуем OpenRouter (бесплатные модели)
    if (openrouter) {
      const orModels = [
        'google/gemma-3n-e4b-it:free',      // Рабочая бесплатная модель
        'meta-llama/llama-3.3-70b-instruct:free',
        'google/gemma-3-4b-it:free',
        'meta-llama/llama-3.2-3b-instruct:free',
      ];
      for (const model of orModels) {
        try {
          const completion = await openrouter.chat.completions.create({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages
            ],
            max_tokens: 1000,
            temperature: 0.7,
          });
          return {
            success: true,
            text: completion.choices[0]?.message?.content || 'Нет ответа',
            provider: `OpenRouter (${model.split('/')[1]})`,
          };
        } catch (e) {
          console.error(`❌ Ошибка OpenRouter (${model}):`, e.message);
          continue;
        }
      }
    }

    // Пробуем Cloudflare Workers AI (последний fallback - самая слабая модель)
    if (cloudflare) {
      try {
        const completion = await cloudflare.chat.completions.create({
          model: '@cf/meta/llama-3.2-3b-instruct', // Единственная рабочая модель
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages
          ],
          max_tokens: 1000,
          temperature: 0.7,
        });
        
        const responseText = completion.choices?.[0]?.message?.content;
        if (responseText && responseText.trim()) {
          return {
            success: true,
            text: responseText.trim(),
            provider: 'Cloudflare AI',
          };
        }
      } catch (e) {
        console.error('❌ Ошибка Cloudflare AI:', e.message);
      }
    }

    // Если все провайдеры недоступны - возвращаем базовый ответ
    return {
      success: true,
      text: '<b>AI временно недоступен</b> 🤖\n\nВсе AI провайдеры исчерпали лимиты или недоступны. Попробуйте позже.\n\n<i>Вы можете продолжить пользоваться сайтом - делать ставки, смотреть турниры и участвовать в соревнованиях!</i> ⚽️',
      provider: 'fallback',
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
Форматируй ответы используя HTML теги Telegram:
- <b>жирный текст</b> для имён и важных данных
- <i>курсив</i> для пояснений
- Эмодзи для визуального разделения

ВАЖНО ПРО ОБРАЩЕНИЕ К ПОЛЬЗОВАТЕЛЮ:
- Когда пользователь спрашивает про себя ("моё место", "мои ставки", "я"), обращайся к нему на "ты" (твоё место, твои ставки)
- НЕ используй "@username" в ответах - говори "твоё", "ты", "у тебя"
- Если пользователь спрашивает про другого игрока по имени, тогда используй его имя
- ВНИМАТЕЛЬНО читай данные участников - ищи пользователя по имени и показывай его ТОЧНУЮ позицию и очки

ВАЖНО: Никогда не переводи и не изменяй имена пользователей (username). Используй их точно как в данных.
АББРЕВИАТУРЫ ТУРНИРОВ (используй их для поиска в данных):
- лч, лига чемпионов, champions league, cl = "Лига чемпионов 2025-2026" (ОСНОВНОЙ ТУРНИР)
- лe, лига европы, europa league, el = "Лига Европы 2025-2026"
- лк, лига конференций, conference league = "Лига конференций 2025-2026"
- рпл = "Российская Премьер Лига 2025-2026"
- апл, премьер-лига = Английская Премьер-Лига
- лм, ла лига = Ла Лига
- бл, бундеслига = Бундеслига
- са, серия а = Серия А
- л1, лига 1 = Лига 1

ВАЖНО: Когда пользователь спрашивает "лч" или "лига чемпионов" - ищи данные в "📊 Лига чемпионов 2025-2026"!
ВНИМАНИЕ: Пользователь отмечен звездочкой ⭐ - найди его в нужном турнире и скажи его ТОЧНУЮ позицию!

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

  if (dbContext.currentUser) {
    prompt += `ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ: ${dbContext.currentUser}\n`;
    prompt += `ВАЖНО: Когда этот пользователь спрашивает "моё место", "мои очки", "я" - отвечай "твоё место", "у тебя", "ты".\n`;
    prompt += `В таблице участников текущий пользователь отмечен звездочкой ⭐.\n`;
    prompt += `КОНТЕКСТ: Если пользователь упоминает "Milan", "David", "Давид" - это он сам спрашивает про себя, отвечай на "ты".\n\n`;
  }

  if (dbContext.userPositions) {
    prompt += `ТОЧНЫЕ ПОЗИЦИИ ПОЛЬЗОВАТЕЛЯ В ТУРНИРАХ (используй ТОЛЬКО эти данные для ответов про место):\n${dbContext.userPositions}\n`;
    prompt += `КРИТИЧЕСКИ ВАЖНО: Не считай позицию самостоятельно по таблице! Используй только цифры выше.\n\n`;
  }

  if (dbContext.userProfile) {
    prompt += `ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ:\n${dbContext.userProfile}\n\n`;
  }

  if (dbContext.userBets) {
    prompt += `СТАВКИ ПОЛЬЗОВАТЕЛЯ:\n${dbContext.userBets}\n\n`;
  }

  if (dbContext.matches) {
    prompt += `МАТЧИ:\n${dbContext.matches}\n\n`;
  }

  if (dbContext.news) {
    prompt += `${dbContext.news}\n\n`;
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
