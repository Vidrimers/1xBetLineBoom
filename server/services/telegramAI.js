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
  
  const text = msg.text?.toLowerCase() || '';
  
  // Команда /ask всегда работает
  if (text.startsWith('/ask')) return true;
  
  // Команда /clear всегда работает
  if (text.startsWith('/clear')) return true;
  
  // Упоминание бота
  const isMentioned = text.includes(`@${botUsername.toLowerCase()}`);
  
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
    
    // Получаем полный контекст из БД
    const telegramUsername = msg.from?.username;
    const telegramId = msg.from?.id;
    const dbContext = buildFullAIContext(telegramUsername, null, telegramId, text);
    
    if (telegramUsername && !dbContext.currentUser) {
      dbContext.currentUser = `Пользователь: @${telegramUsername} (не привязан к аккаунту на сайте)`;
    }
    
    // Получаем историю диалога пользователя
    const userId = msg.from.id;
    const userMessages = getUserContext(userId);
    
    // Добавляем новое сообщение пользователя в контекст
    addToUserContext(userId, 'user', text);
    
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
