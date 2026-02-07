import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

// Инициализируем переменные окружения
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID = parseInt(process.env.TELEGRAM_ADMIN_ID, 10);
const TELEGRAM_CHAT_ID = parseInt(process.env.TELEGRAM_CHAT_ID, 10);
const THREAD_ID = process.env.THREAD_ID
  ? parseInt(process.env.THREAD_ID, 10)
  : null;
const SERVER_IP = process.env.SERVER_IP || "localhost";
const SERVER_PORT = process.env.PORT || "3000";
const USE_HTTPS = process.env.USE_HTTPS === "true"; // Добавляем поддержку HTTPS
const PROTOCOL = USE_HTTPS ? "https" : "http";

// Определяем нужно ли добавлять порт к URL
// Порт не добавляется только если это стандартный порт (80 для HTTP, 443 для HTTPS)
const isStandardPort = (USE_HTTPS && SERVER_PORT === "443") || (!USE_HTTPS && SERVER_PORT === "80");
const portSuffix = isStandardPort ? "" : `:${SERVER_PORT}`;

// Для локальных запросов из бота ВСЕГДА используем localhost (бот на том же сервере)
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

// Для внешних ссылок (которые отправляются пользователям в кнопках)
const isLocalNetwork = SERVER_IP === "localhost" || SERVER_IP.startsWith("192.168.") || SERVER_IP.startsWith("127.0.");
const isDomain = SERVER_IP.includes(".") && !SERVER_IP.match(/^\d+\.\d+\.\d+\.\d+$/); // Проверяем, это домен или IP

// Для доменов всегда используем HTTPS (независимо от USE_HTTPS)
const PUBLIC_URL = isDomain
  ? `https://${SERVER_IP}` // Для доменов всегда HTTPS без порта
  : `${PROTOCOL}://${SERVER_IP}${portSuffix}`;

console.log(
  `📡 Конфигурация бота: SERVER_URL=${SERVER_URL}, PUBLIC_URL=${PUBLIC_URL}, isDomain=${isDomain}, USE_HTTPS=${USE_HTTPS}, PORT=${SERVER_PORT}, TELEGRAM_ADMIN_ID=${TELEGRAM_ADMIN_ID}, TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}, THREAD_ID=${THREAD_ID}`
);

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID || !TELEGRAM_CHAT_ID) {
  console.error(
    "❌ Ошибка: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_ID и TELEGRAM_CHAT_ID должны быть установлены в .env"
  );
  process.exit(1);
}

// Создаём экземпляр бота (будет инициализирован в startBot)
let bot = null;
let botStarted = false; // Флаг для предотвращения повторного запуска

// Хранилище счетчиков реакций для сообщений в группе
// Формат: Map<messageId, Map<emoji, Set<userId>>>
const groupReactions = new Map();

// Файл очереди для неотправленных уведомлений (JSONL)
const NOTIF_QUEUE_FILE = path.join(
  process.cwd(),
  "pending_notifications.jsonl"
);
let notifWorkerInterval = null;

// Читаем параметры retry из env (с запасными значениями)
const NOTIF_WORKER_INTERVAL_MS = parseInt(
  process.env.NOTIF_WORKER_INTERVAL_MS || "30000",
  10
);
const NOTIF_BACKOFF_BASE_MS = parseInt(
  process.env.NOTIF_BACKOFF_BASE_MS || "5000",
  10
);
const NOTIF_MAX_ATTEMPTS = parseInt(process.env.NOTIF_MAX_ATTEMPTS || "6", 10);

// ===== ФУНКЦИЯ РЕГИСТРАЦИИ TELEGRAM ПОЛЬЗОВАТЕЛЯ =====
async function registerTelegramUser(msg) {
  const telegramUsername = msg.from?.username;
  // ВАЖНО: используем msg.from.id (личный ID пользователя), а не msg.chat.id (может быть ID группы)
  const chatId = msg.from?.id;
  const firstName = msg.from?.first_name;

  if (!telegramUsername) return; // Если нет username - пропускаем

  try {
    const url = `${SERVER_URL}/api/telegram/register`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegram_username: telegramUsername,
        chat_id: chatId,
        first_name: firstName,
      }),
    });

    if (!response.ok) {
      console.warn(
        `⚠️ Ошибка регистрации telegram пользователя (HTTP ${response.status}): @${telegramUsername} (URL: ${url})`
      );
      return;
    }

    // После успешной регистрации пользователя, проверяем есть ли уведомления в очереди для него
    // Это нужно для отправки сообщений о привязке Telegram, которые добавились в очередь
    // когда пользователь привязывал свой ТГ через сайт, но ещё не писал боту
    processPendingNotificationsForUser(telegramUsername, chatId);
  } catch (error) {
    console.error(
      `❌ Ошибка регистрации telegram пользователя (@${telegramUsername}):`,
      error.code || error.message,
      `(URL: ${SERVER_URL}/api/telegram/register)`
    );
  }
}

// Обработка ожидающих уведомлений для только что зарегистрированного пользователя
async function processPendingNotificationsForUser(telegramUsername, chatId) {
  try {
    const cleanUsername = telegramUsername.toLowerCase();
    const records = readQueue();
    let found = false;

    for (const record of records) {
      // Ищем уведомления для этого пользователя
      if (
        record.type === "telegram_linked" &&
        record.telegram_username &&
        record.telegram_username.toLowerCase() === cleanUsername
      ) {
        try {
          // Отправляем уведомление о привязке
          await sendMessageWithThread(chatId, record.payload.message, {
            parse_mode: "HTML",
          });
          console.log(
            `✅ Уведомление о привязке отправлено @${telegramUsername} (${chatId})`
          );
          record._sent = true;
          found = true;
        } catch (err) {
          console.error(
            `❌ Ошибка отправки уведомления о привязке для @${telegramUsername}:`,
            err.message
          );
        }
      }
    }

    // Если нашли и отправили какие-то уведомления, обновляем очередь
    if (found) {
      const remaining = records.filter((r) => !r._sent);
      writeQueue(remaining);
    }
  } catch (error) {
    console.error(
      `❌ Ошибка обработки ожидающих уведомлений для @${telegramUsername}:`,
      error.message
    );
  }
}

// ===== ЭКСПОРТИРУЕМЫЕ ФУНКЦИИ (УТИЛИТЫ) =====

// Вспомогательная функция для отправки сообщения с поддержкой THREAD_ID
async function sendMessageWithThread(chatId, text, options = {}) {
  console.log(`📨 sendMessageWithThread: START`);

  if (!bot) {
    console.error("❌ Бот еще не инициализирован!");
    return;
  }
  console.log(`✅ Бот инициализирован`);

  // Убеждаемся что chatId - число для правильного сравнения
  const chatIdNum = typeof chatId === "string" ? parseInt(chatId, 10) : chatId;

  // DEBUG логирование
  console.log(
    `🔍 sendMessageWithThread: chatId=${chatId}, chatIdNum=${chatIdNum}, TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}, equals=${
      chatIdNum === TELEGRAM_CHAT_ID
    }`
  );

  console.log(`📨 Текст (первые 50 символов): ${text.substring(0, 50)}...`);

  // Извлекаем msg из опций если он там есть
  const msg = options.__msg || null;
  delete options.__msg; // Удаляем из опций перед отправкой

  // Добавляем кнопки реакций для личных чатов (если не отключено и это личный чат)
  if (!options.noReactionButtons && chatIdNum > 0 && chatIdNum !== TELEGRAM_CHAT_ID) {
    options.reply_markup = {
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
    console.log(`🔘 Добавлены кнопки реакций для личного чата ${chatIdNum}`);
  }
  
  // Добавляем кнопки реакций для группы (если не отключено и это группа)
  if (!options.noReactionButtons && chatIdNum === TELEGRAM_CHAT_ID) {
    options.reply_markup = {
      inline_keyboard: [
        [
          { text: "👍", callback_data: `group_reaction_thumbsup` },
          { text: "🔥", callback_data: `group_reaction_fire` },
          { text: "❤️", callback_data: `group_reaction_heart` },
          { text: "🫡", callback_data: `group_reaction_salute` },
          { text: "😂", callback_data: `group_reaction_laugh` }
        ],
        [
          { text: "👎", callback_data: `group_reaction_thumbsdown` },
          { text: "😐", callback_data: `group_reaction_neutral` },
          { text: "💩", callback_data: `group_reaction_poop` },
          { text: "🤡", callback_data: `group_reaction_clown` },
          { text: "🤮", callback_data: `group_reaction_vomit` }
        ]
      ]
    };
    console.log(`🔘 Добавлены кнопки реакций для группы ${chatIdNum}`);
  }

  const messageOptions = {
    parse_mode: "HTML",
    ...options, // Опции должны быть ПОСЛЕ parse_mode чтобы не перезаписались
  };

  // Всегда используем основной THREAD_ID если это основной чат, игнорируем старые потоки
  if (chatIdNum === TELEGRAM_CHAT_ID && THREAD_ID) {
    messageOptions.message_thread_id = THREAD_ID;
    console.log(
      `📨 Отправка сообщения в поток ${THREAD_ID} группы ${TELEGRAM_CHAT_ID}`
    );
  } else if (chatIdNum !== TELEGRAM_CHAT_ID) {
    console.log(`📨 Отправка сообщения в личный чат ${chatIdNum}`);
  }

  console.log(`📨 Вызываем bot.sendMessage с параметрами:`);
  console.log(`   chatIdNum: ${chatIdNum}`);
  console.log(`   messageOptions: ${JSON.stringify(messageOptions)}`);

  try {
    const result = await bot.sendMessage(chatIdNum, text, messageOptions);
    console.log(
      `✅ bot.sendMessage завершилась успешно, message_id: ${result.message_id}`
    );
    return result;
  } catch (err) {
    console.error(`❌ bot.sendMessage вызвала ошибка: ${err.message}`);
    throw err;
  }
}

// Специальная функция для ответа на сообщение в потоке (сохраняет поток)
export async function replyInThread(msg, text, options = {}) {
  try {
    if (!bot) {
      console.error("❌ Бот еще не инициализирован!");
      return;
    }

    const chatId = msg.chat.id;
    const messageOptions = {
      ...options,
      parse_mode: "HTML",
    };

    // Если сообщение было в потоке, отвечаем в тот же поток
    if (msg.message_thread_id) {
      messageOptions.message_thread_id = msg.message_thread_id;
      console.log(`📨 Ответ в поток ${msg.message_thread_id}`);
    }

    return await bot.sendMessage(chatId, text, messageOptions);
  } catch (error) {
    console.error("Ошибка при отправке ответа в потоке:", error.message);
  }
}

// Умная функция для отправки сообщения - если есть msg, отправляет в его поток, иначе обычным способом
async function smartSendMessage(chatIdOrMsg, text, options = {}) {
  // Если первый параметр это msg объект (имеет свойство message_thread_id или chat.id)
  if (
    chatIdOrMsg &&
    typeof chatIdOrMsg === "object" &&
    chatIdOrMsg.chat &&
    chatIdOrMsg.from
  ) {
    return await replyInThread(chatIdOrMsg, text, options);
  } else {
    // Иначе это просто chatId
    return await sendMessageWithThread(chatIdOrMsg, text, options);
  }
}

// Функция для логирования действий пользователя админу
async function logUserAction(msg, action) {
  try {
    const userId = msg.from?.id || "Unknown";

    // Не логируем действия админа
    if (userId == TELEGRAM_ADMIN_ID) {
      return;
    }

    const username = msg.from?.username || msg.from?.first_name || "Unknown";
    const chatId = msg.chat?.id || "Unknown";

    const logMessage =
      `ℹ️ <b>Действие пользователя:</b>\n` +
      `👤 <b>Пользователь:</b> @${username} (ID: ${userId})\n` +
      `📝 <b>Действие:</b> ${action}\n` +
      `🕐 <b>Время:</b> ${new Date().toLocaleString("ru-RU")}\n` +
      `🆔 <b>Chat ID:</b> ${chatId}`;

    await sendAdminNotification(logMessage);
  } catch (error) {
    console.error(
      "Ошибка при логировании действия пользователя:",
      error.message
    );
  }
}

// Функция для отправки уведомления только админу
export async function sendAdminNotification(message) {
  try {
    if (!bot) {
      console.error("❌ Бот еще не инициализирован!");
      return;
    }
    console.log(
      `📤 Отправляю сообщение админу (ID: ${TELEGRAM_ADMIN_ID}): ${message.substring(
        0,
        50
      )}...`
    );
    await sendMessageWithThread(TELEGRAM_ADMIN_ID, message, {
      parse_mode: "HTML",
    });
    console.log(new Date().toISOString(), "✅ Уведомление отправлено админу");
  } catch (error) {
    console.error(
      new Date().toISOString(),
      "❌ Ошибка при отправке уведомления админу:",
      error && error.message ? error.message : error
    );
    // Сохраняем уведомление в локальную очередь для повторной отправки
    try {
      enqueueNotification({
        to: TELEGRAM_ADMIN_ID,
        message,
        error: error && error.message,
      });
    } catch (e) {
      console.error("Не удалось записать уведомление в локальную очередь:", e);
    }
  }
}

// Добавляет уведомление в файл-очередь (JSONL). Каждая запись содержит время, payload и attempts.
function enqueueNotification(item) {
  const record = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    timestamp: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: Date.now(),
    payload: item,
  };
  fs.appendFileSync(NOTIF_QUEUE_FILE, JSON.stringify(record) + "\n", "utf8");
  console.log(
    new Date().toISOString(),
    "➕ Добавлено уведомление в очередь (id=",
    record.id,
    ")"
  );
}

// Считывает очередь из файла (без удаления)
function readQueue() {
  if (!fs.existsSync(NOTIF_QUEUE_FILE)) return [];
  const data = fs.readFileSync(NOTIF_QUEUE_FILE, "utf8").trim();
  if (!data) return [];
  return data
    .split(/\n+/)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
}

// Перезаписывает очередь (полностью)
function writeQueue(records) {
  const content =
    records.map((r) => JSON.stringify(r)).join("\n") +
    (records.length ? "\n" : "");
  fs.writeFileSync(NOTIF_QUEUE_FILE, content, "utf8");
}

// Функция попытки отправки одного уведомления (использует bot если есть, иначе fetch)
async function trySendRecord(record) {
  try {
    // Пропускаем уведомления о привязке Telegram - они обрабатываются при регистрации пользователя
    if (record.type === "telegram_linked") {
      return false; // Оставляем в очереди на случай если пользователь переустановит бота
    }

    // Обработка обычных уведомлений (с payload.to и payload.message)
    const { payload } = record;
    if (!payload || !payload.to || !payload.message) {
      console.warn(
        `⚠️ Некорректная структура уведомления в очереди (id=${record.id})`
      );
      return false;
    }

    if (bot) {
      const options = { parse_mode: "HTML" };

      // Если отправляем в основной чат с потоком, добавляем message_thread_id
      if (payload.to == TELEGRAM_CHAT_ID && THREAD_ID) {
        options.message_thread_id = THREAD_ID;
      }

      await sendMessageWithThread(payload.to, payload.message, options);
    } else {
      const body = {
        chat_id: payload.to,
        text: payload.message,
        parse_mode: "HTML",
      };

      // Если отправляем в основной чат с потоком, добавляем message_thread_id
      if (payload.to == TELEGRAM_CHAT_ID && THREAD_ID) {
        body.message_thread_id = THREAD_ID;
      }

      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
    }
    console.log(
      new Date().toISOString(),
      "✅ Повторно отправлено уведомление (id=",
      record.id,
      ")"
    );
    return true;
  } catch (e) {
    console.warn(
      new Date().toISOString(),
      "⚠️ Попытка отправки уведомления не удалась (id=",
      record.id,
      "):",
      e && e.message ? e.message : e
    );
    return false;
  }
}

// Позволяет немедленно попытаться отправить все уведомления (используется внешним endpoint)
export async function flushQueueNow() {
  const records = readQueue();
  if (!records.length) return { sent: 0, total: 0 };
  let sent = 0;
  for (const rec of records) {
    const ok = await trySendRecord(rec);
    if (ok) sent++;
    rec.attempts = (rec.attempts || 0) + 1;
    rec.nextAttemptAt =
      Date.now() + NOTIF_BACKOFF_BASE_MS * Math.pow(2, rec.attempts - 1);
    if (ok) rec._sent = true;
  }
  const remaining = records.filter(
    (r) =>
      !r._sent &&
      (!r.maxAttempts || r.attempts < (r.maxAttempts || NOTIF_MAX_ATTEMPTS))
  );
  writeQueue(remaining);
  return { sent, total: records.length };
}

// Экспорт утилит управления очередью
export {
  readQueue as getNotificationQueue,
  writeQueue as writeNotificationQueue,
  enqueueNotification,
};

// Фоновая задача: пытается отправлять уведомления из файла по расписанию
function startNotifWorker() {
  if (notifWorkerInterval) return;
  notifWorkerInterval = setInterval(async () => {
    try {
      const records = readQueue();
      if (!records.length) return;
      const now = Date.now();
      let changed = false;
      for (const rec of records) {
        if (rec.nextAttemptAt && rec.nextAttemptAt > now) continue;
        // Пытаемся отправить
        const ok = await trySendRecord(rec);
        rec.attempts = (rec.attempts || 0) + 1;
        // экспоненциальный backoff: NOTIF_BACKOFF_BASE_MS * 2^(attempts-1)
        rec.nextAttemptAt =
          Date.now() + NOTIF_BACKOFF_BASE_MS * Math.pow(2, rec.attempts - 1);
        if (ok) {
          // пометим для удаления
          rec._sent = true;
        }
        changed = true;
      }
      if (changed) {
        // оставляем только неотправленные
        const remaining = records.filter(
          (r) =>
            !r._sent &&
            (!r.maxAttempts ||
              r.attempts < (r.maxAttempts || NOTIF_MAX_ATTEMPTS))
        );
        writeQueue(remaining);
      }
    } catch (e) {
      console.error(
        new Date().toISOString(),
        "Ошибка в задаче повторной отправки уведомлений:",
        e
      );
    }
  }, NOTIF_WORKER_INTERVAL_MS);
  console.log(
    new Date().toISOString(),
    `🔁 Фоновая задача повторной отправки уведомлений запущена (interval=${NOTIF_WORKER_INTERVAL_MS}ms, backoffBase=${NOTIF_BACKOFF_BASE_MS}ms, maxAttempts=${NOTIF_MAX_ATTEMPTS})`
  );
}

// Останавливает воркер (при завершении процесса)
function stopNotifWorker() {
  if (notifWorkerInterval) {
    clearInterval(notifWorkerInterval);
    notifWorkerInterval = null;
  }
}

// Функция для отправки сообщения в группы
export async function sendGroupNotification(message) {
  try {
    console.log(`🔔 sendGroupNotification: Начало отправки сообщения`);
    console.log(`   Длина сообщения: ${message.length} символов`);

    if (!bot) {
      console.error("❌ Бот еще не инициализирован!");
      return;
    }
    console.log(`✅ Бот инициализирован`);

    // Если TELEGRAM_CHAT_ID содержит несколько чатов, разделяем их
    const chatIds = process.env.TELEGRAM_CHAT_ID.includes(",")
      ? process.env.TELEGRAM_CHAT_ID.split(",").map((id) =>
          parseInt(id.trim(), 10)
        )
      : [TELEGRAM_CHAT_ID]; // Используем уже спарсённую переменную

    console.log(
      `🔔 sendGroupNotification: Чатов для отправки: ${chatIds.length}`
    );

    for (const chatId of chatIds) {
      try {
        console.log(`🔔 sendGroupNotification: Отправляем в чат ${chatId}...`);
        await sendMessageWithThread(chatId, message);
        console.log(`✅ Сообщение отправлено в группу ${chatId}`);
      } catch (err) {
        console.error(
          `❌ Ошибка при отправке в группу ${chatId}:`,
          err.message
        );
      }
    }
  } catch (error) {
    console.error("❌ Ошибка при отправке сообщения в группы:", error.message);
  }
}

// Функция для отправки сообщения пользователю
export async function sendUserMessage(userId, message, options = {}) {
  try {
    if (!bot) {
      console.error("❌ Бот еще не инициализирован!");
      return;
    }
    
    // Добавляем кнопки реакций для личных чатов (если не отключено)
    if (!options.noReactionButtons && userId > 0) { // userId > 0 означает личный чат
      const reactionButtons = {
        reply_markup: {
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
        }
      };
      
      // Объединяем с существующими опциями
      options = { ...options, ...reactionButtons };
      console.log(`🔘 Добавлены кнопки реакций для пользователя ${userId}`);
    }
    
    await sendMessageWithThread(userId, message, options);
    console.log(`✅ Сообщение отправлено пользователю ${userId}`);
  } catch (error) {
    console.error(
      "❌ Ошибка при отправке сообщения пользователю:",
      error.message
    );
  }
}

// Функция для отправки уведомления о новом турнире
export async function notifyNewTournament(tournament) {
  const message =
    `📅 <b>Новый турнир!</b>\n\n` +
    `<b>${tournament.name}</b>\n` +
    `<i>${tournament.description || "Описание отсутствует"}</i>\n\n` +
    `📅 Начало: ${tournament.start_date || "Дата не указана"}\n\n` +
    `🔗 <a href="${SERVER_URL}">Открыть сайт</a>`;

  await sendAdminNotification(message);
}

// Функция для отправки уведомления о новом матче
export async function notifyNewMatch(match, tournament) {
  const message =
    `⚽ <b>Новый матч!</b>\n\n` +
    `<b>${match.team1_name}</b> vs <b>${match.team2_name}</b>\n` +
    `📅 Турнир: ${tournament.name}\n` +
    `⏰ Дата: ${match.match_date || "Дата не указана"}\n\n` +
    `🔗 <a href="${SERVER_URL}">Открыть сайт</a>`;

  await sendAdminNotification(message);
}

// Функция для отправки уведомления админу о новой ставке
export async function notifyNewBet(
  username,
  team1,
  team2,
  prediction,
  eventName
) {
  const message =
    `💰 <b>НОВАЯ СТАВКА!</b>\n\n` +
    `👤 Пользователь: <b>${username}</b>\n` +
    `⚽ Матч: <b>${team1}</b> vs <b>${team2}</b>\n` +
    `🎯 Прогноз: <b>${prediction}</b>\n` +
    `🏆 Турнир: ${eventName || "Неизвестный"}\n` +
    `⏰ ${new Date().toLocaleString("ru-RU")}`;

  await sendAdminNotification(message);
}

// Функция для отправки уведомления админу о новом прогнозе на счет
export async function notifyNewScorePrediction(
  username,
  team1,
  team2,
  prediction,
  scoreTeam1,
  scoreTeam2,
  eventName
) {
  const message =
    `📊 <b>НОВЫЙ ПРОГНОЗ НА СЧЕТ!</b>\n\n` +
    `👤 Пользователь: <b>${username}</b>\n` +
    `⚽ Матч: <b>${team1}</b> vs <b>${team2}</b>\n` +
    `🎯 Прогноз: <b>${prediction}</b>\n` +
    `🎯 Прогноз счета: <b>${scoreTeam1}-${scoreTeam2}</b>\n` +
    `🏆 Турнир: ${eventName || "Неизвестный"}\n` +
    `⏰ ${new Date().toLocaleString("ru-RU")}`;

  await sendAdminNotification(message);
}

// Функция для отправки уведомления админу об удалении ставки
export async function notifyBetDeleted(
  username,
  team1,
  team2,
  prediction,
  eventName
) {
  const message =
    `❌ <b>СТАВКА УДАЛЕНА!</b>\n\n` +
    `👤 Пользователь: <b>${username}</b>\n` +
    `⚽ Матч: <b>${team1}</b> vs <b>${team2}</b>\n` +
    `🎯 Прогноз: <b>${prediction}</b>\n` +
    `🏆 Турнир: ${eventName || "Неизвестный"}\n` +
    `⏰ ${new Date().toLocaleString("ru-RU")}`;

  await sendAdminNotification(message);
}

// Функция для отправки уведомления о завершённом матче
export async function notifyMatchFinished(match, winner) {
  const message =
    `✅ <b>Матч завершён!</b>\n\n` +
    `⚽ ${match.team1_name} vs ${match.team2_name}\n` +
    `🏆 Результат: <b>${winner}</b>\n\n` +
    `🔗 <a href="${SERVER_URL}">Открыть сайт</a>`;

  await sendAdminNotification(message);
}

// Функция для отправки уведомления о запретной ставке
export async function notifyIllegalBet(
  username,
  team1,
  team2,
  prediction,
  matchStatus
) {
  let statusText = "неизвестен";
  if (matchStatus === "ongoing") statusText = "идёт в данный момент ⚽";
  if (matchStatus === "finished") statusText = "уже завершился ✅";

  const message =
    `⚠️ <b>Попытка запретной ставки!</b>\n\n` +
    `👤 Пользователь: <b>${username}</b>\n` +
    `⚽ Матч: <b>${team1}</b> vs <b>${team2}</b>\n` +
    `🎯 Пытался ставить на: <b>${prediction}</b>\n` +
    `📊 Статус матча: ${statusText}`;

  await sendAdminNotification(message);
}

// Функция для отправки уведомления о привязке Telegram к профилю
export function notifyTelegramLinked(
  username,
  telegramUsername,
  chatId = null
) {
  const personalMessage =
    `🎉 <b>Добро пожаловать в 1xBetLineBoom!</b>\n\n` +
    `✅ Твой Telegram успешно привязан к аккаунту <b>${username}</b>\n\n` +
    `📊 Теперь ты будешь получать:\n` +
    `• Уведомления о результатах матчей\n` +
    `• Напоминания о предстоящих играх\n` +
    `• Результаты твоих ставок\n\n` +
    `Удачных ставок, малютка! 🍀`;

  const groupMessage =
    `🎉 <b>Новый участник!</b>\n\n` +
    `✅ <b>${username}</b> (@${telegramUsername}) успешно привязал Telegram!\n\n` +
    `Добро пожаловать в 1xBetLineBoom! 🍀`;

  const adminMessage =
    `🔗 <b>Пользователь связал Telegram:</b>\n\n` +
    `👤 <b>Имя на сайте:</b> ${username}\n` +
    `🆔 <b>Telegram username:</b> @${telegramUsername}\n` +
    `🕐 <b>Время:</b> ${new Date().toLocaleString("ru-RU")}\n\n` +
    `✅ Telegram успешно привязан к аккаунту!`;

  try {
    // Отправляем личное сообщение пользователю
    if (chatId && bot) {
      sendMessageWithThread(chatId, personalMessage, {
        parse_mode: "HTML",
      }).catch((err) => {
        console.error(
          `❌ Ошибка отправки личного сообщения для @${telegramUsername} (${chatId}):`,
          err.message
        );
      });
      console.log(
        `📱 Личное сообщение о привязке отправлено @${telegramUsername} (${chatId})`
      );
    }

    // Отправляем сообщение в группу
    sendAdminNotification(groupMessage).catch((err) => {
      console.error(
        `❌ Ошибка отправки группового сообщения о регистрации @${telegramUsername}:`,
        err.message
      );
    });
    console.log(
      `📢 Сообщение о регистрации отправлено в группу для @${telegramUsername}`
    );

    // Отправляем личное сообщение админу о связывании профиля
    sendAdminNotification(adminMessage).catch((err) => {
      console.error(
        `❌ Ошибка отправки личного сообщения админу о привязке @${telegramUsername}:`,
        err.message
      );
    });
    console.log(
      `📧 Личное сообщение админу отправлено о привязке @${telegramUsername}`
    );
    console.log(
      `� Сообщение о регистрации отправлено в группу для @${telegramUsername}`
    );
  } catch (error) {
    console.error(
      "❌ Ошибка при отправке уведомления о привязке Telegram:",
      error.message
    );
  }
}

// Функция для отправки уведомления о включении напоминаний
// Функция для отправки уведомления о включении напоминаний
export async function notifyReminderEnabled(username, telegramUsername, eventName, hoursBefore) {
  try {
    if (!bot) {
      console.error("❌ Бот еще не инициализирован!");
      return;
    }

    const Database = (await import("better-sqlite3")).default;
    const db = new Database("1xBetLineBoom.db");
    
    // Получаем chat_id пользователя
    const telegramUser = db.prepare(`
      SELECT chat_id FROM telegram_users 
      WHERE LOWER(telegram_username) = LOWER(?)
    `).get(telegramUsername);
    
    db.close();
    
    if (!telegramUser || !telegramUser.chat_id) {
      console.warn(`⚠️ Chat ID не найден для @${telegramUsername}`);
      return;
    }

    const hoursText = hoursBefore === 1 ? 'час' : 
                      hoursBefore < 5 ? 'часа' : 'часов';

    // Сообщение пользователю
    const userMessage = 
      `✅ <b>Напоминания включены!</b>\n\n` +
      `🏆 Турнир: <b>${eventName}</b>\n` +
      `⏰ Время: за ${hoursBefore} ${hoursText} до матча\n\n` +
      `Теперь ты будешь получать уведомления перед началом матчей этого турнира! 🔔`;

    await sendMessageWithThread(telegramUser.chat_id, userMessage, {
      parse_mode: "HTML",
    });
    
    console.log(`✅ Уведомление о включении напоминаний отправлено @${telegramUsername}`);
    
    // Уведомление админу
    const adminMessage = 
      `🔔 <b>НАПОМИНАНИЯ ВКЛЮЧЕНЫ</b>\n\n` +
      `👤 Пользователь: <b>${username}</b> (@${telegramUsername})\n` +
      `🏆 Турнир: <b>${eventName}</b>\n` +
      `⏰ За ${hoursBefore} ${hoursText} до матча\n` +
      `🕐 ${new Date().toLocaleString("ru-RU")}`;
    
    await sendAdminNotification(adminMessage);
  } catch (error) {
    console.error(
      "❌ Ошибка при отправке уведомления о включении напоминаний:",
      error.message
    );
  }
}

// Функция для отправки уведомления об удалении напоминаний
export async function notifyReminderDeleted(username, telegramUsername, eventName) {
  try {
    if (!bot) {
      console.error("❌ Бот еще не инициализирован!");
      return;
    }

    const Database = (await import("better-sqlite3")).default;
    const db = new Database("1xBetLineBoom.db");
    
    // Получаем chat_id пользователя
    const telegramUser = db.prepare(`
      SELECT chat_id FROM telegram_users 
      WHERE LOWER(telegram_username) = LOWER(?)
    `).get(telegramUsername);
    
    db.close();
    
    if (!telegramUser || !telegramUser.chat_id) {
      console.warn(`⚠️ Chat ID не найден для @${telegramUsername}`);
      return;
    }

    // Сообщение пользователю
    const userMessage = 
      `🔕 <b>Напоминания отключены</b>\n\n` +
      `🏆 Турнир: <b>${eventName}</b>\n\n` +
      `Ты больше не будешь получать напоминания о матчах этого турнира.`;

    await sendMessageWithThread(telegramUser.chat_id, userMessage, {
      parse_mode: "HTML",
    });
    
    console.log(`✅ Уведомление об удалении напоминаний отправлено @${telegramUsername}`);
    
    // Уведомление админу
    const adminMessage = 
      `🔕 <b>НАПОМИНАНИЯ ОТКЛЮЧЕНЫ</b>\n\n` +
      `👤 Пользователь: <b>${username}</b> (@${telegramUsername})\n` +
      `🏆 Турнир: <b>${eventName}</b>\n` +
      `🕐 ${new Date().toLocaleString("ru-RU")}`;
    
    await sendAdminNotification(adminMessage);
  } catch (error) {
    console.error(
      "❌ Ошибка при отправке уведомления об удалении напоминаний:",
      error.message
    );
  }
}

// ===== ИНИЦИАЛИЗАЦИЯ И ЗАПУСК БОТА =====

export async function startBot() {
  if (botStarted) {
    console.log("ℹ️ Бот уже запущен, пропускаем повторную инициализацию");
    return;
  }

  // Проверяем режим работы бота
  const botMode = process.env.TELEGRAM_BOT_MODE || "polling"; // polling или webhook
  const enablePolling = botMode === "polling";

  if (enablePolling) {
    // Режим polling
    try {
      bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { 
        polling: {
          allowed_updates: ["message", "callback_query", "message_reaction"]
        }
      });
      botStarted = true;
      console.log("✅ Telegram бот запущен в режиме POLLING (включены реакции)");
    } catch (error) {
      console.error("❌ Ошибка при запуске бота с polling:", error.message);
      console.log("🔄 Запускаем бота без polling...");
      bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
      botStarted = true;
      console.log(
        "✅ Telegram бот запущен без polling (только отправка сообщений)"
      );
    }
  } else {
    // Режим webhook
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
    botStarted = true;
    
    // Настраиваем webhook
    const webhookUrl = `${PUBLIC_URL}/telegram-webhook`;
    try {
      await bot.setWebHook(webhookUrl, {
        allowed_updates: ["message", "callback_query", "message_reaction"]
      });
      console.log(`✅ Telegram бот запущен в режиме WEBHOOK: ${webhookUrl}`);
      console.log("📡 Реакции включены через webhook");
    } catch (error) {
      console.error("❌ Ошибка установки webhook:", error.message);
      console.log("⚠️ Бот работает без webhook (только отправка сообщений)");
    }
  }

  // Запускаем background worker для повторной отправки уведомлений
  startNotifWorker();

  // При завершении процесса корректно останавливаем воркер
  process.on("exit", () => {
    stopNotifWorker();
  });
  process.on("SIGINT", () => {
    stopNotifWorker();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stopNotifWorker();
    process.exit(0);
  });

  // ===== ГЛАВНОЕ МЕНЮ (КНОПКИ) =====
  const mainMenuKeyboard = {
    reply_markup: {
      keyboard: [
        ["📊 Статус", "📅 Турниры"],
        ["💰 Мои ставки", "👤 Профиль"],
        ["🏆 Мои награды", "📈 Статистика"],
        ["⚽ Ближайший матч", "🌐 Открыть сайт"],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };

  // ===== ОБРАБОТЧИКИ КОМАНД =====

  // Команда /start
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || "пользователь";
    const startParam = match[1].trim(); // Получаем параметр после /start

    // Логируем действие
    logUserAction(msg, "Нажата команда /start" + (startParam ? ` с параметром: ${startParam}` : ""));

    // Проверяем, есть ли параметр auth_{token} для авторизации на сайте
    if (startParam && startParam.startsWith('auth_')) {
      const authToken = startParam.replace('auth_', '');
      
      console.log(`🔐 Попытка авторизации через Telegram с токеном: ${authToken}`);
      
      try {
        const telegram_id = msg.from.id.toString();
        const first_name = msg.from.first_name;
        const username = msg.from.username;

        // Отправляем запрос на сервер для завершения авторизации
        const response = await fetch(`${SERVER_URL}/api/telegram-auth/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auth_token: authToken,
            telegram_id,
            first_name,
            username
          })
        });

        const result = await response.json();

        if (response.ok) {
          console.log(`✅ Авторизация успешна для telegram_id: ${telegram_id}`);
          
          const welcomeMessage = result.isNewUser 
            ? `🎉 Добро пожаловать!\n\n✅ Вы успешно авторизовались на сайте!\n👤 Ваше имя: ${result.user.username}\n\n💡 Имя можно изменить в профиле на сайте.`
            : `✅ Вы успешно авторизовались на сайте!\n👤 Ваше имя: ${result.user.username}`;
          
          replyInThread(msg, welcomeMessage, mainMenuKeyboard);
        } else {
          console.log(`❌ Ошибка авторизации: ${result.error}`);
          replyInThread(
            msg,
            `❌ Ошибка авторизации: ${result.error || 'Неизвестная ошибка'}\n\nПопробуйте снова.`,
            mainMenuKeyboard
          );
        }
      } catch (error) {
        console.error('❌ Ошибка при авторизации:', error);
        replyInThread(
          msg,
          `❌ Произошла ошибка при авторизации. Попробуйте позже.`,
          mainMenuKeyboard
        );
      }
      return;
    }

    // Проверяем, есть ли параметр link_{userId}
    if (startParam && startParam.startsWith('link_')) {
      const userId = startParam.replace('link_', '');
      
      console.log(`🔗 Попытка автоматической привязки для userId: ${userId}`);
      
      try {
        // Получаем username пользователя из Telegram
        const telegramUsername = msg.from.username;
        
        console.log(`📱 Telegram username: ${telegramUsername}`);
        
        if (!telegramUsername) {
          console.log(`❌ У пользователя нет username в Telegram`);
          replyInThread(
            msg,
            `❌ У вас не установлен username в Telegram!\n\n` +
            `Чтобы привязать аккаунт, сначала установите username в настройках Telegram.`,
            mainMenuKeyboard
          );
          return;
        }

        const url = `${SERVER_URL}/api/user/${userId}/telegram`;
        console.log(`🌐 Отправка запроса на: ${url}`);
        
        // Отправляем запрос на сервер для привязки
        const response = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telegram_username: telegramUsername })
        });

        console.log(`📡 Ответ сервера: ${response.status} ${response.statusText}`);
        
        const result = await response.json();
        console.log(`📦 Данные ответа:`, result);

        if (response.ok) {
          console.log(`✅ Telegram успешно привязан для userId: ${userId}`);
          replyInThread(
            msg,
            `✅ Telegram успешно привязан!\n\n` +
            `👤 Ваш username: @${telegramUsername}\n` +
            `🔗 Аккаунт привязан к профилю\n\n` +
            `Теперь вы будете получать уведомления о матчах!`,
            mainMenuKeyboard
          );
        } else {
          console.log(`❌ Ошибка при привязке: ${result.error}`);
          replyInThread(
            msg,
            `❌ Ошибка при привязке: ${result.error || 'Неизвестная ошибка'}\n\n` +
            `Попробуйте привязать другой.`,
            mainMenuKeyboard
          );
        }
      } catch (error) {
        console.error('❌ Ошибка при автоматической привязке Telegram:', error);
        console.error('Детали ошибки:', error.message, error.stack);
        replyInThread(
          msg,
          `❌ Произошла ошибка при привязке: ${error.message}\n\n` +
          `Попробуйте привязать позже.`,
          mainMenuKeyboard
        );
      }
      return;
    }

    // Обычное приветствие если нет параметра
    replyInThread(
      msg,
      `👋 Привет, ${firstName}!\n\n` +
        `🎯 Я бот для 1xBetLineBoom - сайта для ставок на матчи.\n\n` +
        `Используй кнопки ниже или команды:\n` +
        `/help - показать справку`,
      mainMenuKeyboard
    );
  });

  // Команда /help
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;

    // Логируем действие
    logUserAction(msg, "Нажата команда /help");

    replyInThread(
      msg,
      `<b>📖 Справка по командам:</b>\n\n` +
        `<b>/start</b> - начало работы\n` +
        `<b>/help</b> - эта справка\n` +
        `<b>/status</b> - проверить статус сервера\n` +
        `<b>/tournaments</b> - показать все турниры\n` +
        `<b>/my_bets</b> - показать мои ставки\n` +
        `<b>/next_match</b> - ближайший матч\n` +
        `<b>/stats</b> - моя статистика\n` +
        `<b>/profile</b> - показать профиль\n`,
      mainMenuKeyboard
    );
  });

  // Команда /status и кнопка 📊 Статус
  const handleStatus = (msgOrChatId, legacyMsg = null) => {
    // Поддерживаем оба способа вызова для совместимости
    const msg =
      msgOrChatId && typeof msgOrChatId === "object" && msgOrChatId.chat
        ? msgOrChatId
        : null;
    const chatId = msg ? msg.chat.id : msgOrChatId;

    if (msg) logUserAction(msg, "Нажата кнопка/команда: Статус");

    const opts = msg
      ? { parse_mode: "HTML", __msg: msg }
      : { parse_mode: "HTML" };

    sendMessageWithThread(
      chatId,
      `✅ <b>Статус:</b> Сайт работает\n\n` +
        `🌍 Сервер онлайн\n` +
        `📊 Все турниры доступны\n` +
        `⚡ Система ставок активна`,
      opts
    );
  };

  bot.onText(/\/status/, (msg) => handleStatus(msg));

  // Команда /tournaments и кнопка 📅 Турниры
  const handleTournaments = async (chatIdOrMsg, legacyMsg = null) => {
    // Поддерживаем оба способа вызова для совместимости
    const msg =
      chatIdOrMsg && typeof chatIdOrMsg === "object" && chatIdOrMsg.chat
        ? chatIdOrMsg
        : legacyMsg;
    const chatId = msg ? msg.chat.id : chatIdOrMsg;

    if (msg) logUserAction(msg, "Нажата кнопка/команда: Турниры");

    // Если есть msg, добавляем его во все опции для sendMessageWithThread
    const opts = (text, baseOpts = {}) =>
      msg ? { ...baseOpts, __msg: msg } : baseOpts;

    try {
      const response = await fetch(`${SERVER_URL}/api/events`);

      if (!response.ok) {
        console.error(
          `Ошибка при загрузке турниров (HTTP ${response.status}): ${SERVER_URL}/api/events`
        );
        await sendMessageWithThread(
          chatId,
          `📅 <b>Турниры:</b>\n\n` +
            `<i>⚠️ Ошибка при загрузке данных с сервера</i>`,
          opts("error", {
            parse_mode: "HTML",
          })
        );
        return;
      }

      const events = await response.json();

      if (!events || events.length === 0) {
        await sendMessageWithThread(
          chatId,
          `📅 <b>Турниры:</b>\n\n` + `<i>Турниров не найдено</i>`,
          opts("empty", {
            parse_mode: "HTML",
          })
        );
        return;
      }

      // Фильтруем только активные турниры (без locked_reason)
      const activeTournaments = events.filter((e) => !e.locked_reason);

      if (activeTournaments.length === 0) {
        await sendMessageWithThread(
          chatId,
          `📅 <b>Турниры:</b>\n\n` + `<i>Активных турниров нет</i>`,
          opts("noActive", {
            parse_mode: "HTML",
          })
        );
        return;
      }

      // Формируем сообщение со списком активных турниров
      let messageText = `📅 <b>Активные турниры:</b>\n\n`;

      activeTournaments.forEach((tournament, index) => {
        messageText += `<b>${index + 1}. 🏆 ${tournament.name}</b>\n\n`;
        if (tournament.description) {
          messageText += `<i>${tournament.description}</i>\n\n`;
        }
        if (tournament.start_date) {
          const startDateStr = new Date(
            tournament.start_date
          ).toLocaleDateString("ru-RU");
          messageText += `📅 <b>Дата начала:</b> ${startDateStr}\n\n`;
        }
        if (tournament.end_date) {
          const endDateStr = new Date(tournament.end_date).toLocaleDateString(
            "ru-RU"
          );
          messageText += `📅 <b>Дата окончания:</b> ${endDateStr}\n\n`;
        }
        messageText += `\n\n`;
      });

      messageText += `💡 <a href="${SERVER_URL}">Открыть сайт для просмотра всех деталей</a>`;

      await sendMessageWithThread(
        chatId,
        messageText,
        opts("list", {
          parse_mode: "HTML",
        })
      );
    } catch (error) {
      console.error(
        "Ошибка при загрузке турниров:",
        error && error.message ? error.message : error
      );
      await sendMessageWithThread(
        chatId,
        `📅 <b>Турниры:</b>\n\n` + `<i>⚠️ Ошибка при загрузке данных</i>`,
        opts("catch", {
          parse_mode: "HTML",
        })
      );
    }
  };

  bot.onText(/\/tournaments/, (msg) => handleTournaments(msg.chat.id, msg));

  // Команда /my_bets и кнопка 💰 Мои ставки
  const handleMyBets = async (chatIdOrMsg, legacyMsg = null) => {
    // Поддерживаем оба способа вызова для совместимости
    const msg =
      chatIdOrMsg && typeof chatIdOrMsg === "object" && chatIdOrMsg.chat
        ? chatIdOrMsg
        : legacyMsg;
    const chatId = msg ? msg.chat.id : chatIdOrMsg;

    if (msg) logUserAction(msg, "Нажата кнопка/команда: Мои ставки");

    // Если есть msg, добавляем его во все опции для sendMessageWithThread
    const opts = (text, baseOpts = {}) =>
      msg ? { ...baseOpts, __msg: msg } : baseOpts;

    try {
      const telegramUsername = msg?.from?.username || "";
      const firstName = msg?.from?.first_name || "пользователь";

      // Получаем данные пользователя с сайта
      const response = await fetch(`${SERVER_URL}/api/participants`);
      if (!response.ok) {
        throw new Error("Failed to fetch participants");
      }
      const participants = await response.json();

      // Ищем пользователя по telegram_username
      const user = participants.find(
        (p) =>
          (p.telegram_username &&
            p.telegram_username.toLowerCase() ===
              telegramUsername.toLowerCase()) ||
          (msg?.from?.first_name &&
            p.username &&
            p.username.toLowerCase() === msg.from.first_name.toLowerCase())
      );

      if (!user) {
        await sendMessageWithThread(
          chatId,
          `💰 <b>Мои ставки:</b>\n\n` +
            `Профиль не привязан. Привяжите его на сайте в разделе "⚙️ Настройки".`,
          opts("noProfile", {
            parse_mode: "HTML",
          })
        );
        return;
      }

      // Получаем события (турниры) для сопоставления event_id
      const eventsResponse = await fetch(`${SERVER_URL}/api/events`);
      if (!eventsResponse.ok) {
        throw new Error("Failed to fetch events");
      }
      const events = await eventsResponse.json();

      // Создаем map для быстрого поиска названия турнира по event_id
      const eventMap = {};
      events.forEach((event) => {
        eventMap[event.id] = event.name;
      });

      // Получаем ставки конкретного пользователя
      const betsResponse = await fetch(
        `${SERVER_URL}/api/user/${user.id}/bets`
      );
      if (!betsResponse.ok) {
        throw new Error("Failed to fetch bets");
      }
      const userBets = await betsResponse.json();

      // Фильтруем только ставки в ожидании (winner === null)
      const userPendingBets = userBets.filter((bet) => !bet.winner);

      if (userPendingBets.length === 0) {
        await sendMessageWithThread(
          chatId,
          `💰 <b>Мои ставки:</b>\n\n` +
            `<i>Активных ставок нет</i>\n\n` +
            `💡 Сделайте ставку на сайте.`,
          opts("noBets", {
            parse_mode: "HTML",
          })
        );
        return;
      }

      // Формируем сообщение со ставками
      let messageText = `💰 <b>Мои активные ставки:</b>\n\n`;

      userPendingBets.slice(0, 10).forEach((bet, index) => {
        // Форматируем дату и время из match_date
        let matchDate = "—";
        let matchTime = "";

        if (bet.match_date) {
          const matchDateTime = new Date(bet.match_date);
          if (!isNaN(matchDateTime.getTime())) {
            matchDate = matchDateTime.toLocaleDateString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            });
            matchTime = matchDateTime.toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            });
          }
        }

        // Получаем название турнира по event_id
        const tournamentName =
          bet.event_id && eventMap[bet.event_id]
            ? eventMap[bet.event_id]
            : "Турнир не найден";

        // Форматируем прогноз (преобразуем team1/team2/draw в названия команд или Ничья)
        let predictionText = bet.prediction;
        if (bet.prediction === "team1") {
          predictionText = bet.team1_name;
        } else if (bet.prediction === "team2") {
          predictionText = bet.team2_name;
        } else if (bet.prediction === "draw") {
          predictionText = "Ничья";
        }

        messageText +=
          `<b>${index + 1}. ${bet.team1_name} vs ${bet.team2_name}</b>\n` +
          `🎯 Прогноз: <b>${predictionText}</b>\n\n`;
      });

      if (userPendingBets.length > 10) {
        messageText += `📌 Показано 10 из ${userPendingBets.length} ставок\n\n`;
      }

      messageText += `💡 Полный список на сайте.`;

      await sendMessageWithThread(
        chatId,
        messageText,
        opts("list", {
          parse_mode: "HTML",
        })
      );
    } catch (error) {
      console.error("Error in handleMyBets:", error);
      await sendMessageWithThread(
        chatId,
        `💰 <b>Мои ставки:</b>\n\n` +
          `<i>⚠️ Ошибка при загрузке ставок</i>\n\n` +
          `💡 Используйте сайт для управления ставками.`,
        opts("error", {
          parse_mode: "HTML",
        })
      );
    }
  };

  bot.onText(/\/my_bets/, (msg) => handleMyBets(msg.chat.id, msg));

  // Команда /profile и кнопка 👤 Профиль
  const handleProfile = async (msg) => {
    const chatId = msg.chat.id;
    const telegramUsername = msg.from.username || "нет";
    const firstName = msg.from.first_name || "—";

    logUserAction(msg, "Нажата кнопка/команда: Профиль");

    // Если есть msg, добавляем его во все опции для sendMessageWithThread
    const opts = (text, baseOpts = {}) =>
      msg ? { ...baseOpts, __msg: msg } : baseOpts;

    try {
      // Получаем данные пользователя с сайта
      const response = await fetch(`${SERVER_URL}/api/participants`);
      if (!response.ok) {
        throw new Error("Failed to fetch participants");
      }
      const participants = await response.json();

      // Ищем пользователя по telegram_username
      const user = participants.find(
        (p) =>
          (p.telegram_username &&
            p.telegram_username.toLowerCase() ===
              telegramUsername.toLowerCase()) ||
          (msg.from.first_name &&
            p.username &&
            p.username.toLowerCase() === msg.from.first_name.toLowerCase())
      );

      const siteUsername = user ? user.username : "не привязан";

      // Загружаем настройку уведомлений если пользователь найден
      let notificationStatus = "—";
      if (user && user.id) {
        try {
          const notifResponse = await fetch(
            `${SERVER_URL}/api/user/${user.id}/notifications`
          );
          if (notifResponse.ok) {
            const notifData = await notifResponse.json();
            notificationStatus = notifData.telegram_notifications_enabled
              ? "🔔 Включены"
              : "🔕 Отключены";
          }
        } catch (err) {
          console.warn("Ошибка при загрузке статуса уведомлений:", err.message);
          notificationStatus = "—";
        }
      }

      await sendMessageWithThread(
        chatId,
        `👤 <b>Профиль:</b>\n\n` +
          `<b>Имя в тг:</b> ${firstName}\n` +
          `<b>Юзернейм в тг:</b> <code>@${telegramUsername}</code>\n` +
          `<b>Имя на сайте:</b> ${siteUsername}\n` +
          `<b>ID:</b> ${msg.from.id}\n` +
          `<b>Личные уведомления:</b> ${notificationStatus}\n\n` +
          `💡 Для просмотра полного профиля используйте сайт.`,
        opts("success", {
          parse_mode: "HTML",
        })
      );
    } catch (error) {
      console.error("Error in handleProfile:", error);
      await sendMessageWithThread(
        chatId,
        `👤 <b>Профиль:</b>\n\n` +
          `<b>Имя в тг:</b> ${firstName}\n` +
          `<b>Username в тг:</b> @${telegramUsername}\n` +
          `<b>ID:</b> ${msg.from.id}\n` +
          `<b>Личные уведомления:</b> —\n\n` +
          `💡 Для просмотра полного профиля используйте сайт.`,
        opts("error", {
          parse_mode: "HTML",
        })
      );
    }
  };

  bot.onText(/\/profile/, (msg) => handleProfile(msg));

  // Команда /next_match и кнопка ⚽ Ближайший матч
  const handleNextMatch = async (chatIdOrMsg, legacyMsg = null) => {
    // Поддерживаем оба способа вызова для совместимости
    const msg =
      chatIdOrMsg && typeof chatIdOrMsg === "object" && chatIdOrMsg.chat
        ? chatIdOrMsg
        : legacyMsg;
    const chatId = msg ? msg.chat.id : chatIdOrMsg;

    if (msg) logUserAction(msg, "Нажата кнопка/команда: Ближайший матч");

    // Если есть msg, добавляем его во все опции для sendMessageWithThread
    const opts = (text, baseOpts = {}) =>
      msg ? { ...baseOpts, __msg: msg } : baseOpts;

    // Определяем временные границы для загрузки матчей
    const now = new Date();

    try {
      // Загружаем все турниры с их матчами
      const response = await fetch(`${SERVER_URL}/api/events`);

      if (!response.ok) {
        console.error(
          `Ошибка при загрузке турниров (HTTP ${response.status}): ${SERVER_URL}/api/events`
        );
        await sendMessageWithThread(
          chatId,
          `⚽ <b>Ближайший матч:</b>\n\n` +
            `<i>⚠️ Ошибка при загрузке данных с сервера</i>\n\n` +
            `💡 Используйте сайт для просмотра расписания всех матчей.`,
          opts("error", {
            parse_mode: "HTML",
          })
        );
        return;
      }

      const events = await response.json();

      if (!events || events.length === 0) {
        await sendMessageWithThread(
          chatId,
          `⚽ <b>Ближайший матч:</b>\n\n` +
            `<i>Турниров не найдено</i>\n\n` +
            `💡 Используйте сайт для просмотра расписания всех матчей.`,
          opts("noEvents", {
            parse_mode: "HTML",
          })
        );
        return;
      }

      // Собираем все матчи из всех турниров
      const allMatches = [];
      for (const event of events) {
        try {
          const matchesResponse = await fetch(
            `${SERVER_URL}/api/events/${event.id}/matches`
          );
          if (matchesResponse.ok) {
            const matches = await matchesResponse.json();
            if (matches && matches.length > 0) {
              matches.forEach((match) => {
                const matchDate = new Date(match.match_date);

                // Не показываем матчи которые не имеют даты
                if (!match.match_date) {
                  return;
                }

                // Показываем только матчи БЕЗ результата (future/ongoing)
                if (match.winner) {
                  return;
                }

                // Не показываем очень старые матчи (больше 30 дней в прошлом)
                const thirtyDaysAgo = new Date(
                  now.getTime() - 30 * 24 * 60 * 60 * 1000
                );
                if (matchDate < thirtyDaysAgo) {
                  return;
                }

                allMatches.push({
                  ...match,
                  event_name: event.name,
                });
              });
            }
          }
        } catch (e) {
          console.warn(
            `Ошибка при загрузке матчей для турнира ${event.id}:`,
            e.message
          );
        }
      }

      // Разделяем матчи на идущие и будущие
      // Показываем только матчи БЕЗ результата И С датой (ongoing и future)
      const ongoingMatches = [];
      const futureMatches = [];

      allMatches.forEach((match) => {
        // Пропускаем матчи которые не имеют даты
        if (!match.match_date) {
          return;
        }

        // Пропускаем матчи с результатом (завершенные)
        if (match.winner) {
          return;
        }

        const matchDate = new Date(match.match_date);

        // Пропускаем если дата невалидна (это происходит когда match_date = null)
        if (isNaN(matchDate.getTime())) {
          return;
        }

        // Матчи которые в прошлом - это "идущие" матчи (ongoing)
        // Матчи которые в будущем - это "будущие" матчи (future)
        if (matchDate <= now) {
          ongoingMatches.push(match);
        } else {
          futureMatches.push(match);
        }
      });

      // Сортируем оба массива по дате
      ongoingMatches.sort(
        (a, b) => new Date(b.match_date) - new Date(a.match_date)
      );
      futureMatches.sort(
        (a, b) => new Date(a.match_date) - new Date(b.match_date)
      );

      // Если есть идущие матчи, показываем их
      if (ongoingMatches.length > 0) {
        const ongoingDate = new Date(
          ongoingMatches[0].match_date
        ).toDateString();
        const matchesOnSameDay = ongoingMatches.filter(
          (match) => new Date(match.match_date).toDateString() === ongoingDate
        );

        let messageText = `⚽ <b>Матч идёт прямо сейчас:</b>\n\n`;

        matchesOnSameDay.forEach((match, index) => {
          const matchDate = new Date(match.match_date);
          const timeStr = matchDate.toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          });
          const dateStr = matchDate.toLocaleDateString("ru-RU");

          messageText +=
            `<b>${index + 1}. ${match.team1_name} vs ${
              match.team2_name
            }</b>\n` + `⏱️ <b>Начался:</b> ${dateStr} ${timeStr}\n`;

          if (match.round) {
            messageText += `📍 <b>Тур:</b> ${match.round}\n`;
          }

          messageText += `🏆 <b>Турнир:</b> ${match.event_name || "—"}\n\n`;
        });

        messageText += `💡 <a href="${SERVER_URL}">Открыть сайт для ставок</a>`;

        await sendMessageWithThread(
          chatId,
          messageText,
          opts("list", {
            parse_mode: "HTML",
          })
        );
        return;
      }

      // Если нет идущих матчей, показываем будущие
      if (futureMatches.length === 0) {
        await sendMessageWithThread(
          chatId,
          `⚽ <b>Ближайший матч:</b>\n\n` +
            `<i>Предстоящих матчей не найдено</i>\n\n` +
            `💡 Используйте сайт для просмотра расписания всех матчей.`,
          opts("noFuture", {
            parse_mode: "HTML",
          })
        );
        return;
      }

      // Получаем дату ближайшего будущего матча
      const nearestDate = new Date(futureMatches[0].match_date).toDateString();

      // Фильтруем матчи на ту же дату
      const matchesOnSameDay = futureMatches.filter(
        (match) => new Date(match.match_date).toDateString() === nearestDate
      );

      // Форматируем сообщение с матчами
      let messageText = `⚽ <b>Ближайшие матчи:</b>\n\n`;

      matchesOnSameDay.forEach((match, index) => {
        const matchDate = new Date(match.match_date);
        const timeStr = matchDate.toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const dateStr = matchDate.toLocaleDateString("ru-RU");

        messageText +=
          `<b>${index + 1}. ${match.team1_name} vs ${match.team2_name}</b>\n` +
          `📅 <b>Дата:</b> ${dateStr} ${timeStr}\n`;

        if (match.round) {
          messageText += `📍 <b>Тур:</b> ${match.round}\n`;
        }

        messageText += `🏆 <b>Турнир:</b> ${match.event_name || "—"}\n\n`;
      });

      messageText += `💡 <a href="${SERVER_URL}">Открыть сайт для ставок</a>`;

      await sendMessageWithThread(
        chatId,
        messageText,
        opts("future", {
          parse_mode: "HTML",
        })
      );
    } catch (error) {
      console.error(
        "Ошибка при загрузке ближайших матчей:",
        error && error.message ? error.message : error
      );
      await sendMessageWithThread(
        chatId,
        `⚽ <b>Ближайший матч:</b>\n\n` +
          `<i>⚠️ Ошибка при загрузке данных</i>\n\n` +
          `💡 Используйте сайт для просмотра расписания всех матчей.`,
        opts("error", {
          parse_mode: "HTML",
        })
      );
    }
  };

  bot.onText(/\/next_match/, (msg) => handleNextMatch(msg.chat.id, msg));

  // Команда /stats и кнопка 📈 Статистика
  const handleStats = async (msg) => {
    const chatId = msg.chat.id;

    logUserAction(msg, "Нажата кнопка/команда: Статистика");

    // Если есть msg, добавляем его во все опции для sendMessageWithThread
    const opts = (text, baseOpts = {}) =>
      msg ? { ...baseOpts, __msg: msg } : baseOpts;

    const firstName = msg.from.first_name || "пользователь";
    const telegramUsername = msg.from.username || "";

    try {
      // Получаем данные всех участников
      const response = await fetch(`${SERVER_URL}/api/participants`);
      if (!response.ok) {
        throw new Error("Failed to fetch participants");
      }
      const participants = await response.json();

      console.log(
        `[STATS] Searching for user. Telegram username: ${telegramUsername}, First name: ${firstName}`
      );
      console.log(
        `[STATS] Available participants (username -> telegram_username): ${participants
          .map((p) => `${p.username}(${p.telegram_username || "—"})`)
          .join(", ")}`
      );

      // Ищем текущего пользователя по привязке telegram_username в профиле на сайте
      // Это более надежный способ, чем искать по telegram username из API
      const user = participants.find(
        (p) =>
          // Основной поиск: по telegram_username сохраненному в профиле на сайте
          (p.telegram_username &&
            p.telegram_username.toLowerCase() ===
              telegramUsername.toLowerCase()) ||
          // Fallback: если telegram_username не привязан, ищем по первому имени
          (msg.from.first_name &&
            p.username &&
            p.username.toLowerCase() === msg.from.first_name.toLowerCase())
      );

      if (!user) {
        console.log(
          `[STATS] User not found. Looking for telegram_username: ${telegramUsername}`
        );
        await sendMessageWithThread(
          chatId,
          `📊 <b>${firstName}:</b>\n\n` +
            `Ваш профиль не привязан к Telegram аккаунту. Привяжите его на сайте в разделе "⚙️ Настройки" и попробуйте снова.`,
          opts("noProfile", {
            parse_mode: "HTML",
          })
        );
        return;
      }

      console.log(
        `[STATS] User found: ${user.username} (telegram: ${user.telegram_username})`
      );

      // Используем имя с сайта (display_name = username)
      const displayName = user.username || firstName;

      // Рассчитываем процент побед
      // Используем ту же логику, что и на сайте: won_count / total_bets (только завершенные ставки)
      const winPercentage =
        (user.total_bets || 0) > 0
          ? Math.round(((user.won_count || 0) / (user.total_bets || 0)) * 100)
          : 0;

      await sendMessageWithThread(
        chatId,
        `📊 <b>${displayName}:</b>\n\n` +
          `<b>Ставок за всё время:</b> <i>${user.total_bets || 0}</i>\n` +
          `<b>✅ Угаданных ставок за всё время:</b> <i>${
            user.won_count || 0
          }</i>\n` +
          `<b>❌ Неугаданных ставок за всё время:</b> <i>${
            (user.total_bets || 0) - (user.won_count || 0)
          }</i>\n` +
          `<b>⏳ В ожидании:</b> <i>${user.pending_bets || 0}</i>\n\n` +
          `<b>🏆 Победы в турнирах:</b> <i>${
            user.tournament_wins || 0
          }</i>\n\n` +
          `<b>Процент побед:</b> <i>${winPercentage}%</i>\n\n` +
          `💡 Детальная статистика доступна на сайте.`,
        opts("stats", {
          parse_mode: "HTML",
        })
      );
    } catch (error) {
      console.error("Error in handleStats:", error);
      await sendMessageWithThread(
        chatId,
        `📊 <b>${firstName}:</b>\n\n` +
          `Ошибка при загрузке статистики. Пожалуйста, попробуйте позже.`,
        opts("error", {
          parse_mode: "HTML",
        })
      );
    }
  };

  bot.onText(/\/stats/, (msg) => handleStats(msg));

  // Команда /my_awards и кнопка 🏆 Мои награды
  const handleMyAwards = async (chatIdOrMsg, legacyMsg = null) => {
    // Поддерживаем оба способа вызова для совместимости
    const msg =
      chatIdOrMsg && typeof chatIdOrMsg === "object" && chatIdOrMsg.chat
        ? chatIdOrMsg
        : legacyMsg;
    const chatId = msg ? msg.chat.id : chatIdOrMsg;

    if (msg) logUserAction(msg, "Нажата кнопка/команда: Мои награды");

    // Если есть msg, добавляем его во все опции для sendMessageWithThread
    const opts = (text, baseOpts = {}) =>
      msg ? { ...baseOpts, __msg: msg } : baseOpts;

    try {
      const telegramUsername = msg?.from?.username || "";
      const firstName = msg?.from?.first_name || "пользователь";

      // Получаем данные пользователя с сайта
      const response = await fetch(`${SERVER_URL}/api/participants`);
      if (!response.ok) {
        throw new Error("Failed to fetch participants");
      }
      const participants = await response.json();

      // Ищем пользователя по telegram_username
      const user = participants.find(
        (p) =>
          (p.telegram_username &&
            p.telegram_username.toLowerCase() ===
              telegramUsername.toLowerCase()) ||
          (msg?.from?.first_name &&
            p.username &&
            p.username.toLowerCase() === msg.from.first_name.toLowerCase())
      );

      if (!user) {
        await sendMessageWithThread(
          chatId,
          `🏆 <b>Мои награды:</b>\n\n` +
            `Профиль не привязан. Привяжите его на сайте в разделе "⚙️ Настройки".`,
          opts("noProfile", {
            parse_mode: "HTML",
          })
        );
        return;
      }

      // Получаем награды пользователя (tournament_awards)
      const awardsResponse = await fetch(
        `${SERVER_URL}/api/user/${user.id}/awards`
      );
      if (!awardsResponse.ok) {
        throw new Error("Failed to fetch awards");
      }
      const awards = await awardsResponse.json();

      if (!awards || awards.length === 0) {
        await sendMessageWithThread(
          chatId,
          `🏆 <b>Мои награды:</b>\n\n` +
            `<i>Наград пока нет</i>\n\n` +
            `💡 Побеждайте в турнирах, чтобы получить награды!`,
          opts("noAwards", {
            parse_mode: "HTML",
          })
        );
        return;
      }

      // Формируем сообщение с наградами
      let messageText = `🏆 <b>Мои награды:</b>\n\n`;

      awards.slice(0, 10).forEach((award, index) => {
        // Форматируем дату получения награды
        let awardDate = "—";
        if (award.awarded_at) {
          const awardDateTime = new Date(award.awarded_at);
          if (!isNaN(awardDateTime.getTime())) {
            awardDate = awardDateTime.toLocaleDateString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            });
          }
        }

        messageText +=
          `<b>${index + 1}. ${award.event_name}</b>\n` +
          `🎯 Победных ставок: <b>${award.won_bets}</b>\n` +
          `📅 Дата: <i>${awardDate}</i>\n\n`;
      });

      if (awards.length > 10) {
        messageText += `📌 Показано 10 из ${awards.length} наград\n\n`;
      }

      messageText += `💡 Полный список на сайте.`;

      await sendMessageWithThread(
        chatId,
        messageText,
        opts("awards", {
          parse_mode: "HTML",
        })
      );
    } catch (error) {
      console.error("Error in handleMyAwards:", error);
      await sendMessageWithThread(
        chatId,
        `🏆 <b>Мои награды:</b>\n\n` +
          `<i>⚠️ Ошибка при загрузке наград</i>\n\n` +
          `💡 Используйте сайт для просмотра наград.`,
        opts("error", {
          parse_mode: "HTML",
        })
      );
    }
  };

  bot.onText(/\/my_awards/, (msg) => handleMyAwards(msg.chat.id, msg));

  // ===== ОБРАБОТКА КНОПОК =====
  bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Регистрируем telegram пользователя (сохраняем связку username → chat_id)
    registerTelegramUser(msg);

    // Игнорируем команды (начинаются с /)
    if (text && text.startsWith("/")) return;

    switch (text) {
      case "📊 Статус":
        handleStatus(msg);
        break;
      case "📅 Турниры":
        handleTournaments(msg.chat.id, msg).catch((err) => {
          console.error("Ошибка в handleTournaments:", err);
          sendMessageWithThread(
            msg.chat.id,
            "⚠️ Ошибка при загрузке турниров",
            {
              __msg: msg,
              parse_mode: "HTML",
            }
          );
        });
        break;
      case "💰 Мои ставки":
        handleMyBets(msg.chat.id, msg).catch((err) => {
          console.error("Ошибка в handleMyBets:", err);
          sendMessageWithThread(msg.chat.id, "⚠️ Ошибка при загрузке ставок", {
            __msg: msg,
            parse_mode: "HTML",
          });
        });
        break;
      case "👤 Профиль":
        handleProfile(msg).catch((err) => {
          console.error("Ошибка в handleProfile:", err);
          sendMessageWithThread(msg.chat.id, "⚠️ Ошибка при загрузке профиля", {
            __msg: msg,
            parse_mode: "HTML",
          });
        });
        break;
      case "🏆 Мои награды":
        handleMyAwards(msg.chat.id, msg).catch((err) => {
          console.error("Ошибка в handleMyAwards:", err);
          sendMessageWithThread(msg.chat.id, "⚠️ Ошибка при загрузке наград", {
            __msg: msg,
            parse_mode: "HTML",
          });
        });
        break;
      case "📈 Статистика":
        handleStats(msg).catch((err) => {
          console.error("Ошибка в handleStats:", err);
          sendMessageWithThread(
            msg.chat.id,
            "⚠️ Ошибка при загрузке статистики",
            {
              __msg: msg,
              parse_mode: "HTML",
            }
          );
        });
        break;
      case "⚽ Ближайший матч":
        handleNextMatch(msg.chat.id, msg).catch((err) => {
          console.error("Ошибка в handleNextMatch:", err);
          sendMessageWithThread(msg.chat.id, "⚠️ Ошибка при загрузке матчей", {
            __msg: msg,
            parse_mode: "HTML",
          });
        });
        break;
      case "🌐 Открыть сайт":
        logUserAction(msg, "Нажата кнопка: Открыть сайт");
        // Проверяем что PUBLIC_URL не localhost перед отправкой кнопки
        if (PUBLIC_URL.includes('localhost') || PUBLIC_URL.includes('127.0.0.1') || PUBLIC_URL.includes('192.168.')) {
          sendMessageWithThread(chatId, `🌐 <b>Сайт:</b> 1xbetlineboom.xyz\n\n⚠️ Локальный сервер недоступен извне`, {
            parse_mode: "HTML",
            __msg: msg,
          });
        } else {
          sendMessageWithThread(chatId, `1xbetlineboom.xyz`, {
            parse_mode: "HTML",
            __msg: msg,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Жмакни чтобы перейти",
                    url: PUBLIC_URL,
                  },
                ],
              ],
            },
          });
        }
        break;
    }
  });

  // ===== ОБРАБОТЧИК РЕАКЦИЙ НА СООБЩЕНИЯ (ТОЛЬКО ДЛЯ POLLING) =====
  // В режиме webhook реакции обрабатываются через handleWebhookUpdate
  if (process.env.TELEGRAM_BOT_MODE === "polling") {
    bot.on("update", async (update) => {
      // Логируем ВСЕ updates для отладки (кроме обычных сообщений и callback)
      const updateTypes = Object.keys(update).filter(key => key !== 'update_id');
      console.log("📦 Получен update с типами:", updateTypes);
      
      // Проверяем есть ли message_reaction в update
      if (update.message_reaction) {
        await handleMessageReaction(update.message_reaction);
      }
    });
  }

  // ===== ОБРАБОТЧИК CALLBACK QUERY (ИНЛАЙН-КНОПКИ) =====
  bot.on("callback_query", async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id;
    const username = callbackQuery.from.username || callbackQuery.from.first_name || "Неизвестный";
    
    console.log(`📲 Получен callback: ${data}`);
    
    try {
      // ===== ОБРАБОТКА КНОПОК РЕАКЦИЙ =====
      if (data.startsWith("reaction_")) {
        const reactionType = data.includes("positive") ? "positive" : "negative";
        
        // Извлекаем конкретную эмоджи из callback_data
        const emojiMap = {
          "thumbsup": "👍",
          "fire": "🔥",
          "heart": "❤️",
          "salute": "🫡",
          "laugh": "😂",
          "thumbsdown": "👎",
          "neutral": "😐",
          "poop": "💩",
          "clown": "🤡",
          "vomit": "🤮"
        };
        
        // Ищем ключ эмоджи в callback_data
        let emoji = reactionType === "positive" ? "👍" : "👎"; // fallback
        for (const [key, value] of Object.entries(emojiMap)) {
          if (data.includes(key)) {
            emoji = value;
            break;
          }
        }
        
        console.log(`👍 Реакция от @${username}: ${emoji} (через кнопку)`);
        
        // Удаляем кнопки после нажатия
        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] }, // Пустая клавиатура = удаление кнопок
            {
              chat_id: chatId,
              message_id: msg.message_id
            }
          );
          console.log("🗑️ Кнопки удалены после нажатия");
        } catch (error) {
          console.error("Ошибка удаления кнопок:", error.message);
        }
        
        // Отправляем уведомление админу с конкретной эмоджи
        try {
          await bot.sendMessage(
            TELEGRAM_ADMIN_ID,
            `👤 Пользователь @${username} нажал кнопку ${emoji} на сообщение бота`,
            { parse_mode: "HTML" }
          );
          console.log("✅ Уведомление админу отправлено");
        } catch (error) {
          console.error("Ошибка отправки уведомления админу:", error);
        }
        
        // Загружаем фразы из файлов
        let phrases = [];
        try {
          const fileName = reactionType === "positive" ? "js/positive-reactions.json" : "js/negative-reactions.json";
          const fileContent = fs.readFileSync(fileName, "utf8");
          phrases = JSON.parse(fileContent);
          console.log(`📄 Загружено ${phrases.length} фраз из ${fileName}`);
        } catch (error) {
          console.error("Ошибка загрузки фраз:", error);
          phrases = reactionType === "positive" ? ["Спасибо! 😊"] : ["Ну и ладно! 😤"];
        }
        
        // Выбираем случайную фразу
        const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
        console.log(`💬 Отправляем фразу: ${randomPhrase}`);
        
        // Отвечаем через answerCallbackQuery (всплывающее уведомление)
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: randomPhrase,
          show_alert: false
        });
        
        // Также отправляем сообщение в чат
        try {
          await bot.sendMessage(chatId, randomPhrase, { noReactionButtons: true }); // Без кнопок на ответе
          console.log("✅ Ответ пользователю отправлен");
        } catch (error) {
          console.error("Ошибка отправки ответа:", error);
        }
        
        return; // Выходим, чтобы не обрабатывать дальше
      }
      
      // ===== ОБРАБОТКА ГРУППОВЫХ РЕАКЦИЙ =====
      if (data.startsWith("group_reaction_")) {
        const emojiKey = data.replace("group_reaction_", "");
        const emojiMap = {
          "thumbsup": "👍",
          "fire": "🔥",
          "heart": "❤️",
          "salute": "🫡",
          "laugh": "😂",
          "thumbsdown": "👎",
          "neutral": "😐",
          "poop": "💩",
          "clown": "🤡",
          "vomit": "🤮"
        };
        
        const emoji = emojiMap[emojiKey] || "👍";
        const messageId = msg.message_id;
        
        console.log(`📊 Групповая реакция от @${username}: ${emoji} на сообщение ${messageId}`);
        
        // Инициализируем хранилище для этого сообщения если его нет
        if (!groupReactions.has(messageId)) {
          groupReactions.set(messageId, new Map());
        }
        
        const messageReactions = groupReactions.get(messageId);
        
        // Проверяем, есть ли у пользователя уже какая-то реакция на это сообщение
        let userHasAnyReaction = false;
        for (const [e, users] of messageReactions.entries()) {
          if (users.has(userId)) {
            userHasAnyReaction = true;
            break;
          }
        }
        
        // Если пользователь уже поставил реакцию - блокируем повторные попытки
        if (userHasAnyReaction) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "Вы уже поставили реакцию на это сообщение",
            show_alert: true
          });
          console.log(`🚫 Пользователь @${username} уже поставил реакцию, повторная попытка заблокирована`);
          return;
        }
        
        // Добавляем новую реакцию (первую и единственную для этого пользователя)
        if (!messageReactions.has(emoji)) {
          messageReactions.set(emoji, new Set());
        }
        messageReactions.get(emoji).add(userId);
        console.log(`➕ Добавлена реакция ${emoji} от @${username} (окончательная)`);
        
        // Формируем обновленные кнопки с счетчиками
        const allEmojis = ["👍", "🔥", "❤️", "🫡", "😂", "👎", "😐", "💩", "🤡", "🤮"];
        const emojiToKey = {
          "👍": "thumbsup",
          "🔥": "fire",
          "❤️": "heart",
          "🫡": "salute",
          "😂": "laugh",
          "👎": "thumbsdown",
          "😐": "neutral",
          "💩": "poop",
          "🤡": "clown",
          "🤮": "vomit"
        };
        
        const row1 = [];
        const row2 = [];
        
        allEmojis.forEach((e, index) => {
          const count = messageReactions.get(e)?.size || 0;
          const buttonText = count > 0 ? `${e} ${count}` : e;
          const button = {
            text: buttonText,
            callback_data: `group_reaction_${emojiToKey[e]}`
          };
          
          if (index < 5) {
            row1.push(button);
          } else {
            row2.push(button);
          }
        });
        
        // Обновляем кнопки
        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [row1, row2] },
            {
              chat_id: chatId,
              message_id: messageId
            }
          );
          console.log("✅ Кнопки обновлены со счетчиками");
        } catch (error) {
          console.error("Ошибка обновления кнопок:", error.message);
        }
        
        // Определяем тип реакции для выбора фразы
        const positiveEmojis = ["👍", "🔥", "❤️", "🫡", "😂"];
        const reactionType = positiveEmojis.includes(emoji) ? "positive" : "negative";
        
        // Загружаем фразы из файлов и отправляем ответ
        let phrases = [];
        try {
          const fileName = reactionType === "positive" ? "js/positive-reactions.json" : "js/negative-reactions.json";
          const fileContent = fs.readFileSync(fileName, "utf8");
          phrases = JSON.parse(fileContent);
          console.log(`📄 Загружено ${phrases.length} фраз из ${fileName}`);
        } catch (error) {
          console.error("Ошибка загрузки фраз:", error);
          phrases = reactionType === "positive" ? ["Спасибо! 😊"] : ["Ну и ладно! 😤"];
        }
        
        const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
        console.log(`💬 Отправляем фразу в группу: ${randomPhrase}`);
        
        try {
          await sendMessageWithThread(chatId, randomPhrase, { 
            noReactionButtons: true,
            __msg: msg 
          });
          console.log("✅ Ответ в группу отправлен");
        } catch (error) {
          console.error("Ошибка отправки ответа в группу:", error);
        }
        
        // Отвечаем пользователю через answerCallbackQuery
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: `Вы поставили ${emoji}`,
          show_alert: false
        });
        
        return; // Выходим
      }
      
      // ===== ОСТАЛЬНЫЕ ОБРАБОТЧИКИ CALLBACK =====
      // Обработка публикации объявления о турнире
      if (data.startsWith("publish_")) {
        const announcementId = data.replace("publish_", "");
        
        console.log(`📢 Публикация объявления ID: ${announcementId}`);
        
        // Загружаем данные объявления из БД
        const Database = (await import("better-sqlite3")).default;
        const db = new Database("1xBetLineBoom.db");
        
        const announcement = db.prepare(
          `SELECT * FROM pending_announcements WHERE id = ?`
        ).get(announcementId);
        
        if (!announcement) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ Объявление не найдено"
          });
          db.close();
          return;
        }
        
        // Получаем всех пользователей
        const users = db.prepare(
          `SELECT id, username, telegram_id FROM users WHERE telegram_id IS NOT NULL`
        ).all();
        
        db.close();
        
        console.log(`📢 Найдено ${users.length} пользователей для рассылки`);
        
        // Форматируем даты
        let dateText = '';
        if (announcement.start_date && announcement.end_date) {
          const start = new Date(announcement.start_date).toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
          const end = new Date(announcement.end_date).toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
          dateText = `📅 Даты: ${start} - ${end}`;
        } else if (announcement.start_date) {
          const start = new Date(announcement.start_date).toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
          dateText = `📅 Начало: ${start}`;
        }
        
        // Формируем сообщение
        let message = `🏆 <b>НОВЫЙ ТУРНИР!</b>\n\n`;
        message += `<b>${announcement.name}</b>\n\n`;
        
        if (announcement.description) {
          message += `📝 ${announcement.description}\n\n`;
        }
        
        if (dateText) {
          message += `${dateText}\n\n`;
        }
        
        message += `Приготовьтесь делать прогнозы! 🎯\n\n`;
        message += `🔗 <a href="${PUBLIC_URL}">Открыть сайт</a>`;
        
        // Отправляем каждому пользователю
        let successCount = 0;
        let errorCount = 0;
        
        for (const user of users) {
          try {
            await bot.sendMessage(user.telegram_id, message, {
              parse_mode: "HTML"
            });
            successCount++;
            
            // Небольшая задержка между отправками
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            console.error(`⚠️ Не удалось отправить объявление пользователю ${user.username}:`, error.message);
            errorCount++;
          }
        }
        
        // Удаляем объявление из БД после публикации
        const db2 = new Database("1xBetLineBoom.db");
        db2.prepare(`DELETE FROM pending_announcements WHERE id = ?`).run(announcementId);
        db2.close();
        
        // Отвечаем админу
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: `✅ Объявление опубликовано: ${successCount} успешно, ${errorCount} ошибок`
        });
        
        // Обновляем сообщение админа
        await bot.editMessageText(
          `${msg.text}\n\n✅ <b>ОПУБЛИКОВАНО</b>\n📊 Отправлено: ${successCount} пользователям\n❌ Ошибок: ${errorCount}`,
          {
            chat_id: chatId,
            message_id: msg.message_id,
            parse_mode: "HTML"
          }
        );
        
        console.log(`✅ Объявление о турнире "${announcement.name}" опубликовано: ${successCount} успешно, ${errorCount} ошибок`);
      }
      
      // Обработка отклонения объявления
      else if (data.startsWith("reject_")) {
        const announcementId = data.replace("reject_", "");
        
        // Удаляем объявление из БД
        const Database = (await import("better-sqlite3")).default;
        const db = new Database("1xBetLineBoom.db");
        db.prepare(`DELETE FROM pending_announcements WHERE id = ?`).run(announcementId);
        db.close();
        
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ Объявление отклонено"
        });
        
        // Обновляем сообщение админа
        await bot.editMessageText(
          `${msg.text}\n\n❌ <b>ОТКЛОНЕНО</b>`,
          {
            chat_id: chatId,
            message_id: msg.message_id,
            parse_mode: "HTML"
          }
        );
        
        console.log(`❌ Объявление ID ${announcementId} отклонено админом`);
      }
    } catch (error) {
      console.error("❌ Ошибка обработки callback:", error);
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "❌ Ошибка обработки"
      });
    }
  });

  // Обработчик ошибок polling — логируем подробно и при EFATAL пытаемся восстановить соединение
  // перед окончательным выходом. Это помогает отличать временные разрывы (socket hang up)
  // от постоянных проблем (например, DNS или отсутствие интернета).
  bot.on("polling_error", async (error) => {
    try {
      console.error(
        "❌ Ошибка polling:",
        error && error.code ? error.code : error && error.message ? error.message : "Unknown error"
      );

      // Если 409 Conflict - другой бот уже получает обновления
      if (error && error.response && error.response.statusCode === 409) {
        console.log(
          "⚠️ Конфликт polling (409): другой экземпляр бота уже работает"
        );
        console.log("🔄 Отключаем polling для этого экземпляра");
        if (bot) {
          bot.stopPolling();
        }
        return; // Не пытаемся восстановить polling
      }

      // Если EFATAL — это фатальная ошибка polling, часто связана с сетевыми разрывами
      if (error && error.code === "EFATAL") {
        // Вспомогательные функции
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

        async function testTelegramConnectivity() {
          try {
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`;
            const resp = await fetch(url, { method: "GET", timeout: 5000 });
            // Если ответ пришёл — считаем соединение рабочим
            return resp && resp.ok;
          } catch (e) {
            // Логируем причину неудачи (например ENOTFOUND)
            console.warn(
              "Проверка доступности api.telegram.org не удалась:",
              e && e.message ? e.message : e
            );
            return false;
          }
        }

        // Попробуем несколько раз с экспоненциальной задержкой — чтобы пережить временные разрывы
        const maxAttempts = 3;
        let attempt = 0;
        let healthy = false;
        while (attempt < maxAttempts) {
          attempt++;
          console.log(
            `Проверка доступности Telegram API (попытка ${attempt}/${maxAttempts})...`
          );
          healthy = await testTelegramConnectivity();
          if (healthy) break;
          // экспоненциальный backoff: 3s, 6s, 12s
          const backoff = 3000 * Math.pow(2, attempt - 1);
          console.log(
            `Соединение не восстановлено, ждём ${backoff}ms перед повтором...`
          );
          // eslint-disable-next-line no-await-in-loop
          await sleep(backoff);
        }

        if (healthy) {
          console.log(
            "Соединение с Telegram API восстановлено — продолжаем работу."
          );
          return; // не выходим, позволяем polling продолжиться
        }

        // Если не удалось восстановить соединение — пробуем уведомить админа и затем выходим
        const errMsg = `❌ <b>Фатальная ошибка polling (EFATAL)</b>\n\n<pre>${
          (error && error.message) || JSON.stringify(error)
        }</pre>`;
        try {
          if (bot) {
            await sendMessageWithThread(TELEGRAM_ADMIN_ID, errMsg, {
              parse_mode: "HTML",
            });
          } else {
            await fetch(
              `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: TELEGRAM_ADMIN_ID,
                  text: errMsg,
                  parse_mode: "HTML",
                }),
              }
            );
          }
        } catch (sendErr) {
          console.error("Не удалось уведомить админа о EFATAL:", sendErr);
        }

        console.error(
          "EFATAL не ушёл после повторных попыток — выходим, чтобы менеджер процессов перезапустил бота."
        );
        process.exit(1);
      }
    } catch (e) {
      console.error("Ошибка в обработчике polling_error:", e);
    }
  });

  console.log("✅ Все обработчики бота зарегистрированы");
}

export function stopBot() {
  if (bot) {
    console.log("🛑 Останавливаем Telegram бота...");
    bot.stopPolling();
    bot = null;
    botStarted = false;
  }
}


// Функция для отправки напоминаний о предстоящих матчах
async function sendMatchReminders() {
  try {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database("1xBetLineBoom.db");
    
    // Получаем все настройки напоминаний
    const reminders = db.prepare(`
      SELECT 
        er.user_id,
        er.event_id,
        er.hours_before,
        u.telegram_username,
        e.name as event_name,
        COALESCE(uns.only_active_tournaments, 0) as only_active_tournaments
      FROM event_reminders er
      JOIN users u ON er.user_id = u.id
      JOIN events e ON er.event_id = e.id
      LEFT JOIN user_notification_settings uns ON er.user_id = uns.user_id
      WHERE u.telegram_notifications_enabled = 1
        AND u.telegram_username IS NOT NULL
        AND COALESCE(uns.match_reminders, 1) = 1
    `).all();
    
    if (reminders.length === 0) {
      return;
    }
    
    const now = new Date();
    
    // Для каждой настройки напоминания
    for (const reminder of reminders) {
      // Если включена настройка "только по активным турнирам", проверяем наличие ставок
      if (reminder.only_active_tournaments === 1) {
        const hasBets = db.prepare(`
          SELECT COUNT(*) as count
          FROM predictions p
          JOIN matches m ON p.match_id = m.id
          WHERE p.user_id = ? AND m.event_id = ?
        `).get(reminder.user_id, reminder.event_id);
        
        // Если нет ставок в этом турнире, пропускаем
        if (!hasBets || hasBets.count === 0) {
          continue;
        }
      }
      
      // Получаем матчи турнира которые начнутся через N часов
      const matches = db.prepare(`
        SELECT id, team1, team2, match_date
        FROM matches
        WHERE event_id = ?
          AND status != 'finished'
          AND match_date IS NOT NULL
      `).all(reminder.event_id);
      
      for (const match of matches) {
        const matchDate = new Date(match.match_date + 'Z'); // UTC время
        const timeDiff = (matchDate - now) / (1000 * 60 * 60); // разница в часах
        
        // Если матч начнется через указанное количество часов (±15 минут)
        if (timeDiff >= reminder.hours_before - 0.25 && timeDiff <= reminder.hours_before + 0.25) {
          // Проверяем не отправляли ли уже напоминание
          const sent = db.prepare(`
            SELECT id FROM sent_reminders 
            WHERE match_id = ? AND user_id = ?
          `).get(match.id, reminder.user_id);
          
          if (!sent) {
            // Получаем chat_id пользователя
            const telegramUser = db.prepare(`
              SELECT chat_id FROM telegram_users 
              WHERE LOWER(telegram_username) = LOWER(?)
            `).get(reminder.telegram_username);
            
            if (telegramUser && telegramUser.chat_id) {
              const hoursText = reminder.hours_before === 1 ? 'час' : 
                                reminder.hours_before < 5 ? 'часа' : 'часов';
              
              const message = `🔔 Напоминание о матче!\n\n` +
                `🏆 Турнир: ${reminder.event_name}\n` +
                `⚽ Матч: ${match.team1} vs ${match.team2}\n` +
                `🕐 Начало через ${reminder.hours_before} ${hoursText}\n\n` +
                `Не забудь сделать ставку! 🎯`;
              
              try {
                await bot.sendMessage(telegramUser.chat_id, message);
                
                // Сохраняем что напоминание отправлено
                db.prepare(`
                  INSERT INTO sent_reminders (match_id, user_id, sent_at)
                  VALUES (?, ?, CURRENT_TIMESTAMP)
                `).run(match.id, reminder.user_id);
                
                console.log(`✅ Напоминание отправлено: ${reminder.telegram_username} о матче ${match.id}`);
              } catch (error) {
                console.error(`❌ Ошибка отправки напоминания ${reminder.telegram_username}:`, error);
              }
            }
          }
        }
      }
    }
    
    db.close();
  } catch (error) {
    console.error('❌ Ошибка в sendMatchReminders:', error);
  }
}

// Запускаем проверку напоминаний каждые 15 минут
setInterval(sendMatchReminders, 15 * 60 * 1000);
console.log('✅ Система напоминаний о матчах запущена (проверка каждые 15 минут)');

// ===== ОБРАБОТКА WEBHOOK UPDATES =====
export async function handleWebhookUpdate(update) {
  try {
    console.log("📦 Обработка webhook update, типы:", Object.keys(update).filter(k => k !== 'update_id'));
    
    // Обрабатываем message_reaction
    if (update.message_reaction) {
      await handleMessageReaction(update.message_reaction);
    }
    
    // Обрабатываем обычные сообщения
    if (update.message) {
      const text = update.message.text;
      
      // Вручную обрабатываем команды для webhook (bot.onText не работает через emit)
      if (text && text.startsWith('/')) {
        console.log(`🔧 Webhook: обнаружена команда ${text}`);
        
        // Проверяем каждую команду и вызываем соответствующий обработчик
        if (text.startsWith('/start')) {
          const match = text.match(/\/start(.*)/);
          // Находим обработчик /start и вызываем его
          const handlers = bot._textRegexpCallbacks || [];
          for (const handler of handlers) {
            if (handler.regexp.test(text)) {
              await handler.callback(update.message, match);
              break;
            }
          }
        }
      }
      
      // Эмулируем событие message для остальных обработчиков
      bot.emit('message', update.message);
    }
    
    // Обрабатываем callback_query
    if (update.callback_query) {
      bot.emit('callback_query', update.callback_query);
    }
    
  } catch (error) {
    console.error("❌ Ошибка обработки webhook update:", error);
  }
}

// Функция обработки реакций (вынесена отдельно для переиспользования)
async function handleMessageReaction(reaction) {
  try {
    console.log("🔔 Получено событие message_reaction:", JSON.stringify(reaction, null, 2));
    
    const chatId = reaction.chat.id;
    const userId = reaction.user.id;
    const messageId = reaction.message_id;
    
    // Получаем информацию о пользователе
    let username = "Неизвестный";
    try {
      const user = await bot.getChat(userId);
      username = user.username || user.first_name || "Неизвестный";
    } catch (error) {
      console.error("Ошибка получения информации о пользователе:", error);
    }
    
    // Получаем новые реакции
    const newReactions = reaction.new_reaction || [];
    console.log("📊 Новые реакции:", newReactions);
    
    if (newReactions.length === 0) {
      console.log("⚠️ Нет новых реакций, выходим");
      return;
    }
    
    // Берем первую реакцию (обычно одна)
    const reactionData = newReactions[0];
    const reactionEmoji = reactionData.emoji || reactionData.type;
    
    console.log(`👍 Реакция от @${username}: ${reactionEmoji}`);
    
    // Отправляем уведомление админу
    try {
      await bot.sendMessage(
        TELEGRAM_ADMIN_ID,
        `👤 Пользователь @${username} поставил реакцию ${reactionEmoji} на сообщение бота`,
        { parse_mode: "HTML" }
      );
      console.log("✅ Уведомление админу отправлено");
    } catch (error) {
      console.error("Ошибка отправки уведомления админу:", error);
    }
    
    // Определяем тип реакции
    const positiveEmojis = ["👍", "❤️", "🔥", "🥰", "😍", "🤩", "💯", "⭐", "✨", "🎉", "👏", "🙏", "💪", "🤝"];
    const negativeEmojis = ["👎", "💩", "🤡", "🤮", "😡", "😠", "🖕", "💀"];
    
    const isPositive = positiveEmojis.includes(reactionEmoji);
    const isNegative = negativeEmojis.includes(reactionEmoji);
    
    console.log(`🎯 Тип реакции: ${isPositive ? 'положительная' : isNegative ? 'отрицательная' : 'нейтральная'}`);
    
    if (!isPositive && !isNegative) {
      console.log("⚠️ Нейтральная реакция, не отвечаем");
      return;
    }
    
    // Загружаем фразы из файлов
    let phrases = [];
    try {
      const fileName = isPositive ? "js/positive-reactions.json" : "js/negative-reactions.json";
      const fileContent = fs.readFileSync(fileName, "utf8");
      phrases = JSON.parse(fileContent);
      console.log(`📄 Загружено ${phrases.length} фраз из ${fileName}`);
    } catch (error) {
      console.error("Ошибка загрузки фраз:", error);
      phrases = isPositive ? ["Спасибо! 😊"] : ["Ну и ладно! 😤"];
    }
    
    // Выбираем случайную фразу
    const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
    console.log(`💬 Отправляем фразу: ${randomPhrase}`);
    
    // Отправляем ответ пользователю
    try {
      await bot.sendMessage(chatId, randomPhrase);
      console.log("✅ Ответ пользователю отправлен");
    } catch (error) {
      console.error("Ошибка отправки ответа на реакцию:", error);
    }
    
  } catch (error) {
    console.error("❌ Ошибка обработки реакции:", error);
  }
}
