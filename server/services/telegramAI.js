/**
 * AI интеграция для Telegram бота
 * Поддерживает разные режимы работы с возможностью переключения админом
 */

import { sendToAI } from './aiChatService.js';
import { db } from '../database/db.js';
import { getTournamentParticipantsWithPoints } from '../utils/tournamentData.js';
import { buildFullAIContext } from '../utils/aiContext.js';
import fs from 'fs';
import path from 'path';

// Хранилище контекста диалогов для каждого пользователя
const userContexts = new Map();

// Максимальное количество сообщений в контексте (чтобы не превысить лимиты токенов)
const MAX_CONTEXT_MESSAGES = 10;

// Режимы работы AI
const AI_MODES = {
  ACTIVE: 'active',
  MENTION: 'mention',
  OFF: 'off'
};

// Файл для хранения режима
const AI_MODE_FILE = path.join(process.cwd(), '.ai_mode');

// Загружаем сохраненный режим или используем mention по умолчанию
function loadMode() {
  try {
    if (fs.existsSync(AI_MODE_FILE)) {
      const saved = fs.readFileSync(AI_MODE_FILE, 'utf8').trim();
      if (Object.values(AI_MODES).includes(saved)) return saved;
    }
  } catch (e) {}
  return AI_MODES.MENTION;
}

let currentMode = loadMode();

/**
 * Устанавливает режим работы AI
 */
export function setAIMode(mode) {
  if (Object.values(AI_MODES).includes(mode)) {
    currentMode = mode;
    // Сохраняем режим в файл
    try {
      fs.writeFileSync(AI_MODE_FILE, mode, 'utf8');
    } catch (e) {
      console.error('❌ Не удалось сохранить режим AI:', e.message);
    }
    console.log(`🤖 AI режим изменен на: ${mode}`);
    return true;
  }
  return false;
}

/**
 * Получает текущий режим работы AI
 */
export function getAIMode() {
  return currentMode;
}

/**
 * Проверяет, нужно ли AI отвечать на сообщение
 */
function shouldRespond(msg, botUsername) {
  // Игнорируем сообщения от ботов
  if (msg.from?.is_bot) return false;
  
  // Если AI выключен
  if (currentMode === AI_MODES.OFF) return false;
  
  // Игнорируем нажатия на кнопки клавиатуры (они начинаются с эмодзи)
  const text = msg.text || '';
  const keyboardButtons = [
    '📊 Статус',
    '📅 Турниры',
    '💰 Мои ставки',
    '⚽ Ближайший матч',
    '📈 Статистика',
    '👤 Профиль',
    '🏆 Мои награды',
    '📢 Новости',
    '🌐 Открыть сайт'
  ];
  
  if (keyboardButtons.includes(text)) {
    return false; // Не обрабатываем кнопки клавиатуры через AI
  }
  
  // Если пользователь отвечает на сообщение бота - всегда обрабатываем
  // НО игнорируем если это сообщение с inline-кнопками (там reply_markup)
  if (msg.reply_to_message?.from?.is_bot && msg.reply_to_message?.from?.username === botUsername) {
    // Проверяем что это не сообщение с inline-кнопками
    if (!msg.reply_to_message.reply_markup?.inline_keyboard) {
      return true;
    }
  }
  
  // Проверяем thread - если это группа с thread_id, проверяем что это нужный thread
  const TELEGRAM_CHAT_ID = parseInt(process.env.TELEGRAM_CHAT_ID, 10);
  const THREAD_ID = process.env.THREAD_ID ? parseInt(process.env.THREAD_ID, 10) : null;
  
  // Если это группа с настроенным THREAD_ID
  if (msg.chat.id === TELEGRAM_CHAT_ID && THREAD_ID) {
    // Проверяем что сообщение в нужном thread
    if (msg.message_thread_id !== THREAD_ID) {
      return false; // Игнорируем сообщения из других thread'ов
    }
  }
  
  const textLower = text.toLowerCase();
  
  // Команда /ask всегда работает
  if (textLower.startsWith('/ask')) return true;
  
  // Команда /clear всегда работает
  if (textLower.startsWith('/clear')) return true;
  
  // Упоминание бота
  const isMentioned = textLower.includes(`@${botUsername.toLowerCase()}`);
  
  // В режиме MENTION - только по упоминанию
  if (currentMode === AI_MODES.MENTION) {
    return isMentioned;
  }
  
  // В режиме ACTIVE - отвечаем на вопросы про ставки/турниры
  if (currentMode === AI_MODES.ACTIVE) {
    // Если упомянули - точно отвечаем
    if (isMentioned) return true;
    
    // В личке отвечаем на всё
    if (msg.chat.type === 'private') return true;
    
    // В основном thread группы - отвечаем на всё
    if (msg.chat.id === TELEGRAM_CHAT_ID && THREAD_ID && msg.message_thread_id === THREAD_ID) {
      return true;
    }
    
    // В других thread'ах и остальной группе - не отвечаем
    return false;
  }
  
  return false;
}

/**
 * Получает или создает контекст диалога для пользователя
 */
function getUserContext(userId) {
  if (!userContexts.has(userId)) {
    userContexts.set(userId, []);
  }
  return userContexts.get(userId);
}

/**
 * Добавляет сообщение в контекст пользователя
 */
function addToUserContext(userId, role, content) {
  const context = getUserContext(userId);
  
  // Добавляем новое сообщение
  context.push({ role, content });
  
  // Ограничиваем размер контекста (оставляем последние MAX_CONTEXT_MESSAGES сообщений)
  if (context.length > MAX_CONTEXT_MESSAGES) {
    context.splice(0, context.length - MAX_CONTEXT_MESSAGES);
  }
  
  return context;
}

/**
 * Очищает контекст пользователя
 */
function clearUserContext(userId) {
  userContexts.delete(userId);
}

/**
 * Получает контекст из БД для AI
 */
function getDBContext(telegramUsername = null) {
  const context = {};
  
  try {
    // Ищем username на сайте по telegram_username
    if (telegramUsername) {
      const siteUser = db.prepare(`
        SELECT username FROM users 
        WHERE LOWER(telegram_username) = LOWER(?)
      `).get(telegramUsername);
      
      if (siteUser) {
        context.currentUser = `Пользователь который пишет: ${siteUser.username} (Telegram: @${telegramUsername})`;
      } else {
        context.currentUser = `Пользователь который пишет: @${telegramUsername} (не привязан к аккаунту на сайте)`;
      }
    }
    
    // Все активные турниры
    const events = db.prepare(`
      SELECT id, name, status, start_date, end_date
      FROM events
      ORDER BY start_date DESC
      LIMIT 10
    `).all();
    
    if (events.length > 0) {
      const now = new Date();

      // Разделяем турниры на начавшиеся и предстоящие (как на сайте — по start_date)
      const startedEvents = events.filter(e => e.start_date && new Date(e.start_date) <= now);
      const upcomingEvents = events.filter(e => !e.start_date || new Date(e.start_date) > now);

      const eventLines = [
        ...startedEvents.map(e => `• ${e.name} (активный)`),
        ...upcomingEvents.map(e => `• ${e.name} (предстоящий, старт: ${e.start_date})`),
      ];
      context.events = eventLines.join('\n');

      if (upcomingEvents.length > 0) {
        context.events += `\n\nВАЖНО: Турниры помеченные как "предстоящий" ещё не начались. Очки там у всех нулевые — это норма, не показатель активности игроков.`;
      }

      // Загружаем таблицу очков ТОЛЬКО для начавшихся турниров
      const allParticipants = [];
      for (const event of startedEvents) {
        try {
          const participants = getTournamentParticipantsWithPoints(event.id);
          if (participants && participants.length > 0) {
            allParticipants.push(
              `📊 ${event.name}:\n` +
              participants
                .map((p, index) => `  ${index + 1}. ${p.username}: ${p.event_won || 0} очков`)
                .join('\n')
            );
          }
        } catch (e) {
          // Пропускаем турнир если ошибка
        }
      }

      if (allParticipants.length > 0) {
        context.participants = allParticipants.join('\n\n');
      }
    }
  } catch (error) {
    console.error('❌ Ошибка получения контекста для AI:', error);
  }
  
  return context;
}

/**
 * Обрабатывает сообщение и отправляет в AI если нужно
 */
export async function handleAIMessage(msg, bot) {
  try {
    const botInfo = await bot.getMe();
    const botUsername = botInfo.username;
    
    // Проверяем нужно ли отвечать
    if (!shouldRespond(msg, botUsername)) {
      return false; // Не обработано AI
    }
    
    const chatId = msg.chat.id;
    let text = msg.text || '';
    
    // Убираем команду /ask и упоминание бота из текста
    text = text
      .replace(/^\/ask\s*/i, '')
      .replace(new RegExp(`@${botUsername}`, 'gi'), '')
      .trim();
    
    // Если это команда /clear - обрабатываем отдельно
    if (msg.text?.toLowerCase().startsWith('/clear')) {
      return await handleClearContextCommand(msg, bot);
    }
    
    if (!text) {
      await bot.sendMessage(chatId, '🤖 Задай мне вопрос про турнир или ставки!');
      return true;
    }
    
    // Показываем что бот печатает
    await bot.sendChatAction(chatId, 'typing');
    
    // Проверяем, отвечает ли пользователь на сообщение
    let replyContext = '';
    let periodContext = ''; // Отдельная переменная для контекста периода
    
    if (msg.reply_to_message) {
      const replyMsg = msg.reply_to_message;
      
      // Игнорируем сообщения с inline-кнопками (типа "Открыть сайт")
      if (replyMsg.reply_markup?.inline_keyboard) {
        // Не добавляем контекст для сообщений с inline-кнопками
      } else {
        const replyText = replyMsg.text || replyMsg.caption || '';
        
        console.log('🔍 Проверяем reply на период. Текст:', replyText.substring(0, 200));
        
        // Проверяем, это ли сообщение с результатами за период
        const periodMatch = replyText.match(/📊.*Результаты за период.*?📅\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/s);
        const tournamentMatch = replyText.match(/🏆\s*(.+?)(?:\n|$)/);
        
        console.log('🔍 periodMatch:', periodMatch ? 'найдено' : 'не найдено');
        console.log('🔍 tournamentMatch:', tournamentMatch ? tournamentMatch[1] : 'не найдено');
        
        if (periodMatch && tournamentMatch) {
          // Извлекаем период и турнир
          const dateFrom = periodMatch[1];
          const dateTo = periodMatch[2];
          const tournamentName = tournamentMatch[1].trim();
          
          console.log('📅 Период:', dateFrom, '-', dateTo);
          console.log('🏆 Турнир:', tournamentName);
          console.log('❓ Вопрос:', text);
          
          // Проверяем, упоминается ли в вопросе конкретный пользователь
          let targetUser = null;
          const allUsers = db.prepare('SELECT id, username FROM users').all();
          
          // Ищем упоминание пользователя в тексте вопроса
          for (const u of allUsers) {
            if (text.toLowerCase().includes(u.username.toLowerCase())) {
              targetUser = u;
              console.log('👤 Найден упомянутый пользователь:', u.username);
              break;
            }
          }
          
          // Если пользователь не упомянут, проверяем того кто спрашивает
          if (!targetUser && telegramId) {
            targetUser = db.prepare('SELECT id, username FROM users WHERE telegram_id = ?').get(telegramId);
            if (targetUser) {
              console.log('👤 Используем пользователя который спрашивает:', targetUser.username);
            }
          }
          
          if (!targetUser) {
            console.log('❌ Пользователь не найден');
          }
          
          // Получаем ставки пользователя за этот период
          if (targetUser) {
            try {
              const event = db.prepare('SELECT id FROM events WHERE name = ?').get(tournamentName);
              
              if (!event) {
                console.log('❌ Турнир не найден в БД:', tournamentName);
              } else {
                console.log('✅ Турнир найден, id:', event.id);
              }
              
              if (event) {
                // Конвертируем даты в формат YYYY-MM-DD
                const [dayFrom, monthFrom, yearFrom] = dateFrom.split('.');
                const [dayTo, monthTo, yearTo] = dateTo.split('.');
                const dateFromSQL = `${yearFrom}-${monthFrom}-${dayFrom}`;
                const dateToSQL = `${yearTo}-${monthTo}-${dayTo}`;
                
                // Получаем ставки пользователя за период
                const bets = db.prepare(`
                  SELECT 
                    m.team1_name, m.team2_name, m.winner, m.match_date,
                    b.prediction,
                    CASE 
                      WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                           (b.prediction = 'team2' AND m.winner = 'team2') OR
                           (b.prediction = 'draw' AND m.winner = 'draw') THEN 1
                      ELSE 0
                    END as is_correct
                  FROM bets b
                  JOIN matches m ON b.match_id = m.id
                  WHERE b.user_id = ? 
                    AND m.event_id = ?
                    AND DATE(m.match_date) BETWEEN ? AND ?
                    AND m.winner IS NOT NULL
                `).all(targetUser.id, event.id, dateFromSQL, dateToSQL);
                
                if (bets.length > 0) {
                  const correct = bets.filter(b => b.is_correct).length;
                  periodContext = `[Пользователь отвечает на результаты за период ${dateFrom}-${dateTo}, турнир "${tournamentName}". У пользователя ${targetUser.username} в этом периоде: ${bets.length} ставок, из них ${correct} правильных]`;
                  console.log('✅ Контекст периода:', periodContext);
                } else {
                  periodContext = `[Пользователь отвечает на результаты за период ${dateFrom}-${dateTo}, турнир "${tournamentName}". У пользователя ${targetUser.username} НЕТ ставок в этом периоде - он не делал ставки на матчи этой даты]`;
                  console.log('✅ Контекст периода:', periodContext);
                }
              }
            } catch (e) {
              console.error('Ошибка получения ставок за период:', e);
            }
          }
        }
        
        // Обычный контекст ответа (для истории диалога)
        if (!periodContext) {
          // Если это ответ на сообщение бота
          if (replyMsg.from?.is_bot && replyMsg.from?.username === botUsername) {
            replyContext = `\n\n[Пользователь отвечает на сообщение бота: "${replyText.substring(0, 500)}"]`;
          } 
          // Если это ответ на сообщение другого пользователя
          else {
            const replyUsername = replyMsg.from?.username || replyMsg.from?.first_name || 'Неизвестный';
            replyContext = `\n\n[Пользователь отвечает на сообщение @${replyUsername}: "${replyText.substring(0, 500)}"]`;
          }
        }
      }
    }
    
    // Получаем полный контекст из БД
    const telegramUsername = msg.from?.username;
    const telegramId = msg.from?.id;
    
    let dbContext;
    
    // Если есть контекст периода - используем ТОЛЬКО его, без общей информации
    if (periodContext) {
      console.log('📊 Используем ТОЛЬКО контекст периода:', periodContext);
      dbContext = {
        periodContext: periodContext,
        currentUser: telegramUsername ? `Пользователь: @${telegramUsername}` : null
      };
    } else {
      // Обычный контекст со всей информацией
      dbContext = buildFullAIContext(telegramUsername, null, telegramId, text);
    }
    
    console.log('🔍 Финальный dbContext:', JSON.stringify(dbContext, null, 2));
    
    if (telegramUsername && !dbContext.currentUser) {
      dbContext.currentUser = `Пользователь: @${telegramUsername} (не привязан к аккаунту на сайте)`;
    }
    
    // Получаем историю диалога пользователя
    const userId = msg.from.id;
    const userMessages = getUserContext(userId);
    
    // Добавляем новое сообщение пользователя в контекст (с обычным replyContext если есть)
    addToUserContext(userId, 'user', text + replyContext);
    
    // Формируем полную историю сообщений для AI (включая предыдущие)
    const messages = [...userMessages];
    
    // Отправляем в AI
    const result = await sendToAI(messages, dbContext);
    
    if (result.success) {
      const providerEmoji = result.provider.includes('Groq') ? '⚡' : 
                           result.provider.includes('Gemini') ? '🔮' : 
                           result.provider.includes('Cloudflare') ? '☁️' : '🤖';
      
      // Добавляем ответ AI в контекст пользователя
      addToUserContext(userId, 'assistant', result.text);
      
      // Hugging Face не рендерит HTML - очищаем теги
      let text = result.text;
      if (result.provider.includes('Hugging Face')) {
        text = text.replace(/<b>(.*?)<\/b>/g, '$1')
                   .replace(/<i>(.*?)<\/i>/g, '$1')
                   .replace(/<[^>]+>/g, '');
      }
      
      // Пробуем с HTML, если ошибка - отправляем без форматирования
      try {
        await bot.sendMessage(chatId, `${providerEmoji} ${text}`, {
          reply_to_message_id: msg.message_id,
          parse_mode: result.provider.includes('Hugging Face') ? undefined : 'HTML'
        });
      } catch (e) {
        await bot.sendMessage(chatId, `${providerEmoji} ${text}`, {
          reply_to_message_id: msg.message_id
        });
      }
    } else {
      await bot.sendMessage(chatId, '😔 Извини, AI временно недоступен. Попробуй позже!');
    }
    
    return true; // Обработано AI
  } catch (error) {
    console.error('❌ Ошибка обработки AI сообщения:', error);
    return false;
  }
}

/**
 * Команда для очистки контекста диалога
 */
export async function handleClearContextCommand(msg, bot) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Очищаем контекст пользователя
  clearUserContext(userId);
  
  await bot.sendMessage(chatId, '🧹 <b>Контекст диалога очищен!</b>\n\n<i>AI забыл предыдущие сообщения и начнет диалог заново.</i>', {
    parse_mode: 'HTML',
    reply_to_message_id: msg.message_id
  });
}

/**
 * Команда для админа для переключения режима AI
 */
export async function handleAIModeCommand(msg, bot, adminId) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Проверка прав админа
  if (userId !== adminId) {
    await bot.sendMessage(chatId, '❌ Эта команда доступна только администратору');
    return;
  }
  
  const args = msg.text.split(' ');
  const newMode = args[1]?.toLowerCase();
  
  // Если указан режим в команде - переключаем
  if (newMode && Object.values(AI_MODES).includes(newMode)) {
    setAIMode(newMode);
    // После переключения показываем меню
    await showAIModeMenu(chatId, bot);
    return;
  }
  
  // Показываем меню с кнопками
  await showAIModeMenu(chatId, bot);
}

/**
 * Показывает меню управления режимом AI с инлайн кнопками
 */
async function showAIModeMenu(chatId, bot) {
  const modeEmoji = {
    [AI_MODES.ACTIVE]: '🟢',
    [AI_MODES.MENTION]: '🟡',
    [AI_MODES.OFF]: '🔴'
  };
  
  const modeText = {
    [AI_MODES.ACTIVE]: 'Активный',
    [AI_MODES.MENTION]: 'По упоминанию',
    [AI_MODES.OFF]: 'Выключен'
  };
  
  const modeDescription = {
    [AI_MODES.ACTIVE]: 'отвечает на вопросы автоматически',
    [AI_MODES.MENTION]: 'только @bot или /ask',
    [AI_MODES.OFF]: 'AI не работает'
  };
  
  // Создаем кнопки с галочкой для текущего режима
  const keyboard = [
    [
      {
        text: currentMode === AI_MODES.ACTIVE ? '✅ 🟢 Активный' : '🟢 Активный',
        callback_data: 'ai_mode_active'
      }
    ],
    [
      {
        text: currentMode === AI_MODES.MENTION ? '✅ 🟡 По упоминанию' : '🟡 По упоминанию',
        callback_data: 'ai_mode_mention'
      }
    ],
    [
      {
        text: currentMode === AI_MODES.OFF ? '✅ 🔴 Выключен' : '🔴 Выключен',
        callback_data: 'ai_mode_off'
      }
    ]
  ];
  
  const message = 
    `🤖 <b>Управление AI ботом</b>\n\n` +
    `Текущий режим: ${modeEmoji[currentMode]} <b>${modeText[currentMode]}</b>\n` +
    `<i>${modeDescription[currentMode]}</i>\n\n` +
    `<b>Описание режимов:</b>\n\n` +
    `🟢 <b>Активный</b>\n` +
    `AI автоматически отвечает на вопросы про турниры, ставки, очки и статистику в группе и личке.\n\n` +
    `🟡 <b>По упоминанию</b>\n` +
    `AI отвечает только когда его упоминают @bot или используют команду /ask.\n\n` +
    `🔴 <b>Выключен</b>\n` +
    `AI не работает. Команда /ask тоже не работает.\n\n` +
    `Выберите режим:`;
  
  await bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

/**
 * Обработчик нажатий на инлайн кнопки режима AI
 */
export async function handleAIModeCallback(query, bot, adminId) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  
  // Проверка прав админа
  if (userId !== adminId) {
    await bot.answerCallbackQuery(query.id, {
      text: '❌ Только для администратора',
      show_alert: true
    });
    return;
  }
  
  // Определяем новый режим из callback_data
  let newMode = null;
  if (data === 'ai_mode_active') newMode = AI_MODES.ACTIVE;
  else if (data === 'ai_mode_mention') newMode = AI_MODES.MENTION;
  else if (data === 'ai_mode_off') newMode = AI_MODES.OFF;
  
  if (!newMode) return;
  
  // Если режим не изменился
  if (newMode === currentMode) {
    await bot.answerCallbackQuery(query.id, {
      text: '✅ Этот режим уже активен'
    });
    return;
  }
  
  // Меняем режим
  setAIMode(newMode);
  
  const modeEmoji = {
    [AI_MODES.ACTIVE]: '🟢',
    [AI_MODES.MENTION]: '🟡',
    [AI_MODES.OFF]: '🔴'
  };
  
  const modeText = {
    [AI_MODES.ACTIVE]: 'Активный',
    [AI_MODES.MENTION]: 'По упоминанию',
    [AI_MODES.OFF]: 'Выключен'
  };
  
  // Уведомляем админа
  await bot.answerCallbackQuery(query.id, {
    text: `${modeEmoji[newMode]} Режим изменен: ${modeText[newMode]}`
  });
  
  // Обновляем сообщение с новыми кнопками
  await bot.editMessageReplyMarkup(
    {
      inline_keyboard: [
        [
          {
            text: newMode === AI_MODES.ACTIVE ? '✅ 🟢 Активный' : '🟢 Активный',
            callback_data: 'ai_mode_active'
          }
        ],
        [
          {
            text: newMode === AI_MODES.MENTION ? '✅ 🟡 По упоминанию' : '🟡 По упоминанию',
            callback_data: 'ai_mode_mention'
          }
        ],
        [
          {
            text: newMode === AI_MODES.OFF ? '✅ 🔴 Выключен' : '🔴 Выключен',
            callback_data: 'ai_mode_off'
          }
        ]
      ]
    },
    {
      chat_id: chatId,
      message_id: query.message.message_id
    }
  );
  
  // Обновляем текст сообщения
  const modeDescription = {
    [AI_MODES.ACTIVE]: 'отвечает на вопросы автоматически',
    [AI_MODES.MENTION]: 'только @bot или /ask',
    [AI_MODES.OFF]: 'AI не работает'
  };
  
  const message = 
    `🤖 <b>Управление AI ботом</b>\n\n` +
    `Текущий режим: ${modeEmoji[newMode]} <b>${modeText[newMode]}</b>\n` +
    `<i>${modeDescription[newMode]}</i>\n\n` +
    `<b>Описание режимов:</b>\n\n` +
    `🟢 <b>Активный</b>\n` +
    `AI автоматически отвечает на вопросы про турниры, ставки, очки и статистику в группе и личке.\n\n` +
    `🟡 <b>По упоминанию</b>\n` +
    `AI отвечает только когда его упоминают @bot или используют команду /ask.\n\n` +
    `🔴 <b>Выключен</b>\n` +
    `AI не работает. Команда /ask тоже не работает.\n\n` +
    `Выберите режим:`;
  
  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: newMode === AI_MODES.ACTIVE ? '✅ 🟢 Активный' : '🟢 Активный',
            callback_data: 'ai_mode_active'
          }
        ],
        [
          {
            text: newMode === AI_MODES.MENTION ? '✅ 🟡 По упоминанию' : '🟡 По упоминанию',
            callback_data: 'ai_mode_mention'
          }
        ],
        [
          {
            text: newMode === AI_MODES.OFF ? '✅ 🔴 Выключен' : '🔴 Выключен',
            callback_data: 'ai_mode_off'
          }
        ]
      ]
    }
  });
}
