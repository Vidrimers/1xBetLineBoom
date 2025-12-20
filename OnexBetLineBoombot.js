import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

// Инициализируем переменные окружения
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SERVER_IP = process.env.SERVER_IP || "localhost";
const SERVER_PORT = process.env.PORT || "3000";
const SERVER_URL = `http://${SERVER_IP}:${SERVER_PORT}`;

console.log(
  `📡 Конфигурация бота: SERVER_URL=${SERVER_URL}, TELEGRAM_ADMIN_ID=${TELEGRAM_ADMIN_ID}`
);

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID || !TELEGRAM_CHAT_ID) {
  console.error(
    "❌ Ошибка: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_ID и TELEGRAM_CHAT_ID должны быть установлены в .env"
  );
  process.exit(1);
}

// Создаём экземпляр бота (будет инициализирован в startBot)
let bot = null;

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
  const chatId = msg.chat.id;
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
    }
  } catch (error) {
    console.error(
      `❌ Ошибка регистрации telegram пользователя (@${telegramUsername}):`,
      error.code || error.message,
      `(URL: ${SERVER_URL}/api/telegram/register)`
    );
  }
}

// ===== ЭКСПОРТИРУЕМЫЕ ФУНКЦИИ (УТИЛИТЫ) =====

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
    await bot.sendMessage(TELEGRAM_ADMIN_ID, message, { parse_mode: "HTML" });
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
  const { payload } = record;
  try {
    if (bot) {
      await bot.sendMessage(payload.to, payload.message, {
        parse_mode: "HTML",
      });
    } else {
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: payload.to,
            text: payload.message,
            parse_mode: "HTML",
          }),
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
    if (!bot) {
      console.error("❌ Бот еще не инициализирован!");
      return;
    }
    const chatIds = TELEGRAM_CHAT_ID.split(",").map((id) => id.trim());
    for (const chatId of chatIds) {
      try {
        await bot.sendMessage(chatId, message, {
          parse_mode: "HTML",
        });
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
export async function sendUserMessage(userId, message) {
  try {
    if (!bot) {
      console.error("❌ Бот еще не инициализирован!");
      return;
    }
    await bot.sendMessage(userId, message, {
      parse_mode: "HTML",
    });
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

// Функция для отправки уведомления о ставке
export async function notifyNewBet(user, match, prediction, amount) {
  const message =
    `💰 <b>Новая ставка!</b>\n\n` +
    `👤 Пользователь: ${user.username}\n` +
    `⚽ Матч: ${match.team1_name} vs ${match.team2_name}\n` +
    `🎯 Прогноз: ${prediction}\n` +
    `💵 Сумма: ${amount}`;

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

// ===== ИНИЦИАЛИЗАЦИЯ И ЗАПУСК БОТА =====

export function startBot() {
  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

  console.log("✅ Telegram бот запущен");

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
        ["📈 Статистика", "⚽ Ближайший матч"],
        ["🌐 Открыть сайт"],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };

  // ===== ОБРАБОТЧИКИ КОМАНД =====

  // Команда /start
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || "пользователь";

    // Логируем действие
    logUserAction(msg, "Нажата команда /start");

    bot.sendMessage(
      chatId,
      `👋 Привет, ${firstName}!\n\n` +
        `🎯 Я бот для 1xBetLineBoom - сайта для ставок на матчи.\n\n` +
        `Используй кнопки ниже или команды:\n` +
        `/help - показать справку`,
      {
        parse_mode: "HTML",
        ...mainMenuKeyboard,
      }
    );
  });

  // Команда /help
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;

    // Логируем действие
    logUserAction(msg, "Нажата команда /help");

    bot.sendMessage(
      chatId,
      `<b>📖 Справка по командам:</b>\n\n` +
        `<b>/start</b> - начало работы\n` +
        `<b>/help</b> - эта справка\n` +
        `<b>/status</b> - проверить статус сервера\n` +
        `<b>/tournaments</b> - показать все турниры\n` +
        `<b>/my_bets</b> - показать мои ставки\n` +
        `<b>/next_match</b> - ближайший матч\n` +
        `<b>/stats</b> - моя статистика\n` +
        `<b>/profile</b> - показать профиль\n`,
      {
        parse_mode: "HTML",
        ...mainMenuKeyboard,
      }
    );
  });

  // Команда /status и кнопка 📊 Статус
  const handleStatus = (chatId, msg = null) => {
    if (msg) logUserAction(msg, "Нажата кнопка/команда: Статус");

    bot.sendMessage(
      chatId,
      `✅ <b>Статус:</b> Сайт работает\n\n` +
        `🌍 Сервер онлайн\n` +
        `📊 Все турниры доступны\n` +
        `⚡ Система ставок активна`,
      {
        parse_mode: "HTML",
      }
    );
  };

  bot.onText(/\/status/, (msg) => handleStatus(msg.chat.id, msg));

  // Команда /tournaments и кнопка 📅 Турниры
  const handleTournaments = async (chatId, msg = null) => {
    if (msg) logUserAction(msg, "Нажата кнопка/команда: Турниры");

    try {
      const response = await fetch(`${SERVER_URL}/api/events`);

      if (!response.ok) {
        console.error(
          `Ошибка при загрузке турниров (HTTP ${response.status}): ${SERVER_URL}/api/events`
        );
        bot.sendMessage(
          chatId,
          `📅 <b>Турниры:</b>\n\n` +
            `<i>⚠️ Ошибка при загрузке данных с сервера</i>`,
          {
            parse_mode: "HTML",
          }
        );
        return;
      }

      const events = await response.json();

      if (!events || events.length === 0) {
        bot.sendMessage(
          chatId,
          `📅 <b>Турниры:</b>\n\n` + `<i>Турниров не найдено</i>`,
          {
            parse_mode: "HTML",
          }
        );
        return;
      }

      // Фильтруем только активные турниры (без locked_reason)
      const activeTournaments = events.filter((e) => !e.locked_reason);

      if (activeTournaments.length === 0) {
        bot.sendMessage(
          chatId,
          `📅 <b>Турниры:</b>\n\n` + `<i>Активных турниров нет</i>`,
          {
            parse_mode: "HTML",
          }
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

      bot.sendMessage(chatId, messageText, {
        parse_mode: "HTML",
      });
    } catch (error) {
      console.error(
        "Ошибка при загрузке турниров:",
        error && error.message ? error.message : error
      );
      bot.sendMessage(
        chatId,
        `📅 <b>Турниры:</b>\n\n` + `<i>⚠️ Ошибка при загрузке данных</i>`,
        {
          parse_mode: "HTML",
        }
      );
    }
  };

  bot.onText(/\/tournaments/, (msg) => handleTournaments(msg.chat.id, msg));

  // Команда /my_bets и кнопка 💰 Мои ставки
  const handleMyBets = (chatId, msg = null) => {
    if (msg) logUserAction(msg, "Нажата кнопка/команда: Мои ставки");

    bot.sendMessage(
      chatId,
      `💰 <b>Мои ставки:</b>\n\n` +
        `<i>Загрузка ставок...</i>\n\n` +
        `💡 Используйте сайт для управления ставками.`,
      {
        parse_mode: "HTML",
      }
    );
  };

  bot.onText(/\/my_bets/, (msg) => handleMyBets(msg.chat.id, msg));

  // Команда /profile и кнопка 👤 Профиль
  const handleProfile = (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || "нет";

    logUserAction(msg, "Нажата кнопка/команда: Профиль");

    bot.sendMessage(
      chatId,
      `👤 <b>Профиль:</b>\n\n` +
        `<b>Имя:</b> ${msg.from.first_name || "—"}\n` +
        `<b>Username:</b> @${username}\n` +
        `<b>ID:</b> ${msg.from.id}\n\n` +
        `💡 Для просмотра полного профиля используйте сайт.`,
      {
        parse_mode: "HTML",
      }
    );
  };

  bot.onText(/\/profile/, (msg) => handleProfile(msg));

  // Команда /next_match и кнопка ⚽ Ближайший матч
  const handleNextMatch = async (chatId, msg = null) => {
    if (msg) logUserAction(msg, "Нажата кнопка/команда: Ближайший матч");

    try {
      // Загружаем все турниры с их матчами
      const response = await fetch(`${SERVER_URL}/api/events`);

      if (!response.ok) {
        console.error(
          `Ошибка при загрузке турниров (HTTP ${response.status}): ${SERVER_URL}/api/events`
        );
        bot.sendMessage(
          chatId,
          `⚽ <b>Ближайший матч:</b>\n\n` +
            `<i>⚠️ Ошибка при загрузке данных с сервера</i>\n\n` +
            `💡 Используйте сайт для просмотра расписания всех матчей.`,
          {
            parse_mode: "HTML",
          }
        );
        return;
      }

      const events = await response.json();

      if (!events || events.length === 0) {
        bot.sendMessage(
          chatId,
          `⚽ <b>Ближайший матч:</b>\n\n` +
            `<i>Турниров не найдено</i>\n\n` +
            `💡 Используйте сайт для просмотра расписания всех матчей.`,
          {
            parse_mode: "HTML",
          }
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

      // Разделяем матчи на идущие (без результата и прошедшая дата) и будущие (без результата и будущая дата)
      const now = new Date();
      const ongoingMatches = [];
      const futureMatches = [];

      allMatches.forEach((match) => {
        const matchDate = new Date(match.match_date);
        if (!match.winner) {
          if (matchDate <= now) {
            ongoingMatches.push(match);
          } else {
            futureMatches.push(match);
          }
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

        bot.sendMessage(chatId, messageText, {
          parse_mode: "HTML",
        });
        return;
      }

      // Если нет идущих матчей, показываем будущие
      if (futureMatches.length === 0) {
        bot.sendMessage(
          chatId,
          `⚽ <b>Ближайший матч:</b>\n\n` +
            `<i>Предстоящих матчей не найдено</i>\n\n` +
            `💡 Используйте сайт для просмотра расписания всех матчей.`,
          {
            parse_mode: "HTML",
          }
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

      bot.sendMessage(chatId, messageText, {
        parse_mode: "HTML",
      });
    } catch (error) {
      console.error(
        "Ошибка при загрузке ближайших матчей:",
        error && error.message ? error.message : error
      );
      bot.sendMessage(
        chatId,
        `⚽ <b>Ближайший матч:</b>\n\n` +
          `<i>⚠️ Ошибка при загрузке данных</i>\n\n` +
          `💡 Используйте сайт для просмотра расписания всех матчей.`,
        {
          parse_mode: "HTML",
        }
      );
    }
  };

  bot.onText(/\/next_match/, (msg) => handleNextMatch(msg.chat.id, msg));

  // Команда /stats и кнопка 📈 Статистика
  const handleStats = async (msg) => {
    const chatId = msg.chat.id;

    logUserAction(msg, "Нажата кнопка/команда: Статистика");
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
        bot.sendMessage(
          chatId,
          `📊 <b>${firstName}:</b>\n\n` +
            `Ваш профиль не привязан к Telegram аккаунту. Привяжите его на сайте в разделе "👤 Профиль" и попробуйте снова.`,
          {
            parse_mode: "HTML",
          }
        );
        return;
      }

      console.log(
        `[STATS] User found: ${user.username} (telegram: ${user.telegram_username})`
      );

      // Используем имя с сайта (display_name = username)
      const displayName = user.username || firstName;

      // Рассчитываем процент побед
      // Общее количество ставок = выигранные + проигранные + в ожидании
      const totalBets =
        (user.won_bets || 0) + (user.lost_bets || 0) + (user.pending_bets || 0);
      const winPercentage =
        totalBets > 0
          ? Math.round(((user.won_bets || 0) / totalBets) * 100)
          : 0;

      bot.sendMessage(
        chatId,
        `📊 <b>${displayName}:</b>\n\n` +
          `<b>Ставок за всё время:</b> <i>${totalBets}</i>\n` +
          `<b>✅ Угаданных ставок за всё время:</b> <i>${
            user.won_bets || 0
          }</i>\n` +
          `<b>❌ Неугаданных ставок за всё время:</b> <i>${
            user.lost_bets || 0
          }</i>\n` +
          `<b>⏳ В ожидании:</b> <i>${user.pending_bets || 0}</i>\n\n` +
          `<b>🏆 Победы в турнирах:</b> <i>${
            user.tournament_wins || 0
          }</i>\n\n` +
          `<b>Процент побед:</b> <i>${winPercentage}%</i>\n\n` +
          `💡 Детальная статистика доступна на сайте.`,
        {
          parse_mode: "HTML",
        }
      );
    } catch (error) {
      console.error("Error in handleStats:", error);
      bot.sendMessage(
        chatId,
        `📊 <b>${firstName}:</b>\n\n` +
          `Ошибка при загрузке статистики. Пожалуйста, попробуйте позже.`,
        {
          parse_mode: "HTML",
        }
      );
    }
  };

  bot.onText(/\/stats/, (msg) => handleStats(msg));

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
        handleStatus(chatId, msg);
        break;
      case "📅 Турниры":
        handleTournaments(chatId, msg);
        break;
      case "💰 Мои ставки":
        handleMyBets(chatId, msg);
        break;
      case "👤 Профиль":
        handleProfile(msg);
        break;
      case "📈 Статистика":
        handleStats(msg);
        break;
      case "⚽ Ближайший матч":
        handleNextMatch(chatId, msg);
        break;
      case "🌐 Открыть сайт":
        logUserAction(msg, "Нажата кнопка: Открыть сайт");
        bot.sendMessage(
          chatId,
          `🌐 <b>Открыть сайт:</b>\n\n` +
            `<a href="${SERVER_URL}">Нажмите здесь чтобы открыть</a>`,
          {
            parse_mode: "HTML",
          }
        );
        break;
    }
  });

  // Обработчик ошибок polling — логируем подробно и при EFATAL пытаемся восстановить соединение
  // перед окончательным выходом. Это помогает отличать временные разрывы (socket hang up)
  // от постоянных проблем (например, DNS или отсутствие интернета).
  bot.on("polling_error", async (error) => {
    try {
      console.error(
        "❌ Ошибка polling:",
        error && error.code ? error.code : error
      );
      console.error("Full polling error:", error);

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
            await bot.sendMessage(TELEGRAM_ADMIN_ID, errMsg, {
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
