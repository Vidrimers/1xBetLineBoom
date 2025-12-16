import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

// Инициализируем переменные окружения
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID || !TELEGRAM_CHAT_ID) {
  console.error(
    "❌ Ошибка: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_ID и TELEGRAM_CHAT_ID должны быть установлены в .env"
  );
  process.exit(1);
}

// Создаём экземпляр бота (будет инициализирован в startBot)
let bot = null;

// ===== ЭКСПОРТИРУЕМЫЕ ФУНКЦИИ (УТИЛИТЫ) =====

// Функция для отправки уведомления только админу
export async function sendAdminNotification(message) {
  try {
    if (!bot) {
      console.error("❌ Бот еще не инициализирован!");
      return;
    }
    await bot.sendMessage(TELEGRAM_ADMIN_ID, message, {
      parse_mode: "HTML",
    });
    console.log("✅ Уведомление отправлено админу");
  } catch (error) {
    console.error("❌ Ошибка при отправке уведомления админу:", error.message);
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
    `🔗 <a href="http://144.124.237.222:3000">Открыть сайт</a>`;

  await sendAdminNotification(message);
}

// Функция для отправки уведомления о новом матче
export async function notifyNewMatch(match, tournament) {
  const message =
    `⚽ <b>Новый матч!</b>\n\n` +
    `<b>${match.team1_name}</b> vs <b>${match.team2_name}</b>\n` +
    `📅 Турнир: ${tournament.name}\n` +
    `⏰ Дата: ${match.match_date || "Дата не указана"}\n\n` +
    `🔗 <a href="http://144.124.237.222:3000">Открыть сайт</a>`;

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
    `🔗 <a href="http://144.124.237.222:3000">Открыть сайт</a>`;

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

    bot.sendMessage(
      chatId,
      `👋 Привет, ${firstName}!\n\n` +
        `🎯 Я бот для 1xBetLineBoom - приложения для ставок на матчи.\n\n` +
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
  const handleStatus = (chatId) => {
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

  bot.onText(/\/status/, (msg) => handleStatus(msg.chat.id));

  // Команда /tournaments и кнопка 📅 Турниры
  const handleTournaments = (chatId) => {
    bot.sendMessage(
      chatId,
      `📅 <b>Турниры:</b>\n\n` +
        `<i>Загрузка турниров...</i>\n\n` +
        `💡 Используйте сайт для просмотра полного списка турниров и матчей.`,
      {
        parse_mode: "HTML",
      }
    );
  };

  bot.onText(/\/tournaments/, (msg) => handleTournaments(msg.chat.id));

  // Команда /my_bets и кнопка 💰 Мои ставки
  const handleMyBets = (chatId) => {
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

  bot.onText(/\/my_bets/, (msg) => handleMyBets(msg.chat.id));

  // Команда /profile и кнопка 👤 Профиль
  const handleProfile = (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || "нет";

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
  const handleNextMatch = (chatId) => {
    bot.sendMessage(
      chatId,
      `⚽ <b>Ближайший матч:</b>\n\n` +
        `<i>Загрузка информации о матче...</i>\n\n` +
        `<b>Матч:</b> <i>Поиск в прогрессе</i>\n` +
        `<b>Турнир:</b> <i>—</i>\n` +
        `<b>Дата:</b> <i>—</i>\n\n` +
        `💡 Используйте сайт для просмотра расписания всех матчей.`,
      {
        parse_mode: "HTML",
      }
    );
  };

  bot.onText(/\/next_match/, (msg) => handleNextMatch(msg.chat.id));

  // Команда /stats и кнопка 📈 Статистика
  const handleStats = (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || "пользователь";

    bot.sendMessage(
      chatId,
      `📊 <b>Моя статистика, ${firstName}:</b>\n\n` +
        `<b>Всего ставок:</b> <i>загрузка...</i>\n` +
        `<b>✅ Выигрышей:</b> <i>загрузка...</i>\n` +
        `<b>❌ Проигрышей:</b> <i>загрузка...</i>\n` +
        `<b>⏳ В ожидании:</b> <i>загрузка...</i>\n\n` +
        `<b>Процент побед:</b> <i>загрузка...</i>\n\n` +
        `💡 Детальная статистика доступна на сайте.`,
      {
        parse_mode: "HTML",
      }
    );
  };

  bot.onText(/\/stats/, (msg) => handleStats(msg));

  // ===== ОБРАБОТКА КНОПОК =====
  bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Игнорируем команды (начинаются с /)
    if (text && text.startsWith("/")) return;

    switch (text) {
      case "📊 Статус":
        handleStatus(chatId);
        break;
      case "📅 Турниры":
        handleTournaments(chatId);
        break;
      case "💰 Мои ставки":
        handleMyBets(chatId);
        break;
      case "👤 Профиль":
        handleProfile(msg);
        break;
      case "📈 Статистика":
        handleStats(msg);
        break;
      case "⚽ Ближайший матч":
        handleNextMatch(chatId);
        break;
      case "🌐 Открыть сайт":
        bot.sendMessage(
          chatId,
          `🌐 <b>Открыть сайт:</b>\n\n` +
            `<a href="http://144.124.237.222:3000">Нажмите здесь чтобы открыть</a>`,
          {
            parse_mode: "HTML",
          }
        );
        break;
    }
  });

  // Обработчик ошибок
  bot.on("polling_error", (error) => {
    console.error("❌ Ошибка polling:", error.code);
  });

  console.log("✅ Все обработчики бота зарегистрированы");
}
