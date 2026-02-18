import express from "express";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { execSync, spawnSync } from "child_process";
import Parser from "rss-parser";
import {
  startBot,
  notifyIllegalBet,
  notifyNewBet,
  notifyNewScorePrediction,
  notifyBetDeleted,
  getNotificationQueue,
  flushQueueNow,
  writeNotificationQueue,
  sendUserMessage,
  sendGroupNotification,
  sendAdminNotification,
  notifyTelegramLinked,
  notifyReminderEnabled,
  notifyReminderDeleted,
  stopBot,
} from "./OnexBetLineBoombot.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Инициализация RSS парсера
const rssParser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});

// Кэш для RSS новостей (обновляется раз в 30 минут)
let rssNewsCache = {
  data: null,
  timestamp: 0,
  ttl: 30 * 60 * 1000 // 30 минут
};

const app = express();
const PORT = process.env.PORT || 1984;
const SERVER_IP = process.env.SERVER_IP || "localhost";
const SSTATS_API_KEY = process.env.SSTATS_API_KEY;
const SSTATS_API_BASE = "https://api.sstats.net";

// Функция для отправки сообщения в Telegram
async function sendTelegramMessage(chatId, message) {
  try {
    await sendUserMessage(chatId, message);
    return true;
  } catch (error) {
    console.error(`❌ Ошибка отправки Telegram сообщения:`, error);
    return false;
  }
}

// Маппинг кодов турниров на SStats League IDs
const SSTATS_LEAGUE_MAPPING = {
  'CL': 2,    // UEFA Champions League ✅
  'EL': 3,    // UEFA Europa League ✅
  'PL': 39,   // Premier League ✅
  'BL1': 78,  // Bundesliga ✅
  'PD': 140,  // La Liga ✅
  'SA': 135,  // Serie A ✅
  'FL1': 61,  // Ligue 1 ✅
  'DED': 88,  // Eredivisie ✅
  'RPL': 235, // Russian Premier League ✅
  'WC': 1,    // World Cup ✅
  'EC': 4     // Euro Championship ✅
};

// Маппинг кодов турниров на файлы словарей команд
const COMPETITION_DICTIONARY_MAPPING = {
  'CL': 'names/LeagueOfChampionsTeams.json',
  'EL': 'names/EuropaLeague.json',
  'PL': 'names/PremierLeague.json',
  'BL1': 'names/Bundesliga.json',
  'PD': 'names/LaLiga.json',
  'SA': 'names/SerieA.json',
  'FL1': 'names/Ligue1.json',
  'DED': 'names/Eredivisie.json',
  'RPL': 'names/RussianPremierLeague.json',
  'WC': 'names/Countries.json',  // World Cup
  'EC': 'names/Countries.json'   // Euro Championship
};

// Маппинг кодов турниров на файлы словарей игроков
const PLAYERS_DICTIONARY_MAPPING = {
  'CL': 'names/LeagueOfChampionsPlayers.json',
  'EL': 'names/EuropaLeaguePlayers.json',
  'PL': 'names/PremierLeaguePlayers.json',
  'BL1': 'names/BundesligaPlayers.json',
  'PD': 'names/LaLigaPlayers.json',
  'SA': 'names/SerieAPlayers.json',
  'FL1': 'names/Ligue1Players.json',
  'DED': 'names/EredivisiePlayers.json',
  'RPL': 'names/RussianPremierLeaguePlayers.json',
  'WC': 'names/PlayerNames.json',  // World Cup - общий словарь
  'EC': 'names/PlayerNames.json'   // Euro Championship - общий словарь
};

const AWARD_IMAGE_UPLOAD_DIR = path.join(__dirname, "uploads", "award-images");

if (!fs.existsSync(AWARD_IMAGE_UPLOAD_DIR)) {
  fs.mkdirSync(AWARD_IMAGE_UPLOAD_DIR, { recursive: true });
}

const awardImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, AWARD_IMAGE_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}${extension}`;
    cb(null, name);
  },
});

const awardImageUpload = multer({
  storage: awardImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Только изображения разрешены"));
    }
  },
});

// Путь к файлу логов
const LOG_FILE_PATH = path.join(__dirname, "log.html");
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

// Путь к файлу логов терминала
const TERMINAL_LOGS_PATH = path.join(__dirname, "terminal-logs.txt");
const MAX_TERMINAL_LOGS_SIZE = 5 * 1024 * 1024; // 5 MB
let terminalLogs = [];

// Функция для добавления логов в массив терминала
function addTerminalLog(message) {
  const timestamp = new Date().toLocaleString("ru-RU");
  const logEntry = `[${timestamp}] ${message}`;

  terminalLogs.push(logEntry);

  // Ограничиваем размер массива (максимум 10000 строк)
  if (terminalLogs.length > 10000) {
    terminalLogs = terminalLogs.slice(-5000);
  }

  // Также пишем в файл для персистентности
  try {
    fs.appendFileSync(TERMINAL_LOGS_PATH, logEntry + "\n", "utf-8");

    // Проверяем размер файла и очищаем если нужно
    const stats = fs.statSync(TERMINAL_LOGS_PATH);
    if (stats.size > MAX_TERMINAL_LOGS_SIZE) {
      const lines = fs.readFileSync(TERMINAL_LOGS_PATH, "utf-8").split("\n");
      const lastLines = lines.slice(-2500).join("\n");
      fs.writeFileSync(TERMINAL_LOGS_PATH, lastLines, "utf-8");
    }
  } catch (err) {
    // Игнорируем ошибки записи файла
  }
}

// Функция для отправки уведомления админу о действиях модератора
async function notifyModeratorAction(moderatorUsername, action, details) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
    return;
  }

  const time = new Date().toLocaleString("ru-RU");
  const message = `🛡️ ДЕЙСТВИЕ МОДЕРАТОРА

👤 Модератор: ${moderatorUsername}
🎬 Действие: ${action}

${details}

🕐 Время: ${time}`;

  try {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_ADMIN_ID,
          text: message,
        }),
      }
    );
    console.log(`✅ Уведомление о действии модератора отправлено админу`);
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления админу:", error);
  }
}

// Функция для отправки уведомления админу (общая)
async function notifyAdmin(message) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
    console.log("⚠️ Telegram не настроен, уведомление не отправлено");
    return;
  }

  try {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_ADMIN_ID,
          text: message,
          parse_mode: 'HTML'
        }),
      }
    );
    console.log(`✅ Уведомление отправлено админу`);
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления админу:", error);
  }
}

// Функция для отправки уведомления пользователю
async function notifyUser(user_id, message) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  if (!TELEGRAM_BOT_TOKEN) {
    console.log("⚠️ Telegram не настроен, уведомление не отправлено");
    return;
  }

  try {
    // Получаем информацию о пользователе
    const user = db.prepare("SELECT telegram_username, telegram_notifications_enabled FROM users WHERE id = ?").get(user_id);
    
    if (!user || !user.telegram_username || user.telegram_notifications_enabled === 0) {
      console.log(`⚠️ Пользователь ${user_id} не привязал Telegram или отключил уведомления`);
      return;
    }

    // Получаем chat_id пользователя
    const cleanUsername = user.telegram_username.toLowerCase();
    const tgUser = db.prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?").get(cleanUsername);

    if (!tgUser || !tgUser.chat_id) {
      console.log(`⚠️ Chat ID не найден для пользователя ${user.telegram_username}`);
      return;
    }

    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tgUser.chat_id,
          text: message,
          parse_mode: 'HTML'
        }),
      }
    );
    console.log(`✅ Уведомление отправлено пользователю ${user.telegram_username}`);
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления пользователю:", error);
  }
}

// Переопределяем console.log для логирования
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = function (...args) {
  originalLog.apply(console, args);
  const message = args
    .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
    .join(" ");
  addTerminalLog(message);
};

console.error = function (...args) {
  originalError.apply(console, args);
  const message = args
    .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
    .join(" ");
  addTerminalLog(`❌ ERROR: ${message}`);
};

console.warn = function (...args) {
  originalWarn.apply(console, args);
  const message = args
    .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
    .join(" ");
  addTerminalLog(`⚠️ WARN: ${message}`);
};

// Загружаем логи из файла при запуске
try {
  if (fs.existsSync(TERMINAL_LOGS_PATH)) {
    const fileContent = fs.readFileSync(TERMINAL_LOGS_PATH, "utf-8");
    terminalLogs = fileContent
      .split("\n")
      .filter((line) => line.trim().length > 0);
    // Ограничиваем при загрузке
    if (terminalLogs.length > 5000) {
      terminalLogs = terminalLogs.slice(-5000);
    }
  }
} catch (err) {
  console.error("Ошибка при загрузке логов терминала:", err);
}

// Путь к папке с бэкапами
const BACKUPS_DIR = path.join(__dirname, "backups");

// Создаем папку backups если её нет
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  console.log("📁 Папка backups создана");
}

// Функция отправки уведомления о завершении турнира в группу
async function sendTournamentWinnerNotification(
  tournamentName,
  winnerUsername
) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return;
  }

  try {
    // Получаем topsy-3 участников по количеству побед в этом турнире
    const eventId = db
      .prepare("SELECT id FROM events WHERE name = ?")
      .get(tournamentName)?.id;

    let topParticipants = [];
    if (eventId) {
      topParticipants = db
        .prepare(
          `
          SELECT u.username, COUNT(b.id) as wins
          FROM users u
          LEFT JOIN bets b ON u.id = b.user_id
          LEFT JOIN matches m ON b.match_id = m.id
          WHERE m.event_id = ?
          AND m.winner IS NOT NULL
          AND (
            (b.prediction = 'team1' AND m.winner = 'team1') OR
            (b.prediction = 'team2' AND m.winner = 'team2') OR
            (b.prediction = 'draw' AND m.winner = 'draw') OR
            (b.prediction = m.team1_name AND m.winner = 'team1') OR
            (b.prediction = m.team2_name AND m.winner = 'team2')
          )
          GROUP BY u.id, u.username
          ORDER BY wins DESC
          LIMIT 3
        `
        )
        .all(eventId);
    }

    // Сначала ищем пользователя по его display_name (username) в таблице users
    const user = db
      .prepare(
        "SELECT id, username, telegram_username FROM users WHERE username = ?"
      )
      .get(winnerUsername);

    let telegramUser = null;
    let searchedUsername = winnerUsername;

    if (user && user.telegram_username) {
      // Если нашли в таблице users, ищем его telegram данные
      searchedUsername = user.telegram_username;
      telegramUser = db
        .prepare(
          "SELECT chat_id FROM telegram_users WHERE telegram_username = ?"
        )
        .get(searchedUsername);

      console.log(
        `🔍 Поиск telegram пользователя для @${searchedUsername}, результат:`,
        telegramUser
      );
    } else {
      // Если не нашли, ищем напрямую в telegram_users (может быть передано telegram имя)
      const cleanUsername = winnerUsername.replace("@", "").toLowerCase();
      telegramUser = db
        .prepare(
          "SELECT chat_id FROM telegram_users WHERE telegram_username = ?"
        )
        .get(cleanUsername);

      console.log(
        `🔍 Прямой поиск telegram пользователя: ${cleanUsername}, результат:`,
        telegramUser
      );
    }

    let messageText = `🎉 <b>Турнир закончен!</b>\n\n`;
    messageText += `🏆 <b>${tournamentName}</b>\n\n`;
    messageText += `👑 <b>Первое место:</b> ${winnerUsername}`;

    // Если пользователь зарегистрирован в боте, упоминаем его
    if (telegramUser && telegramUser.chat_id) {
      console.log(
        `✅ Найден telegram пользователь: @${searchedUsername} (chat_id: ${telegramUser.chat_id})`
      );
      messageText += `\n<a href="tg://user?id=${telegramUser.chat_id}">@${searchedUsername}</a>`;
    } else {
      console.warn(`⚠️ Telegram пользователь для ${winnerUsername} не найден`);
    }

    // Добавляем информацию о побед первого места
    if (topParticipants.length > 0) {
      messageText += `\n📊 <b>Очков набрано:</b> ${topParticipants[0].wins}\n`;
    }

    // Добавляем второе место
    if (topParticipants.length > 1) {
      messageText += `\n\n🥈 <b>Второе место:</b> ${topParticipants[1].username}`;
      messageText += `\n📊 <b>Очков набрано:</b> ${topParticipants[1].wins}\n`;
    }

    // Добавляем третье место
    if (topParticipants.length > 2) {
      messageText += `\n\n🥉 <b>Третье место:</b> ${topParticipants[2].username}`;
      messageText += `\n📊 <b>Очков набрано:</b> ${topParticipants[2].wins}\n`;
    }

    // Добавляем мотивирующее сообщение
    messageText += `\n\nНу, какие молодцы.`;

    // Получаем участника с последним местом (наименьшим количеством побед, но участвовал)
    const lastPlace = db
      .prepare(
        `
        SELECT u.username, COUNT(b.id) as wins
        FROM users u
        LEFT JOIN bets b ON u.id = b.user_id
        LEFT JOIN matches m ON b.match_id = m.id
        WHERE m.event_id = ?
        AND m.winner IS NOT NULL
        AND (
          (b.prediction = 'team1' AND m.winner = 'team1') OR
          (b.prediction = 'team2' AND m.winner = 'team2') OR
          (b.prediction = 'draw' AND m.winner = 'draw') OR
          (b.prediction = m.team1_name AND m.winner = 'team1') OR
          (b.prediction = m.team2_name AND m.winner = 'team2')
        )
        GROUP BY u.id, u.username
        ORDER BY wins ASC
        LIMIT 1
      `
      )
      .get(eventId);

    // Добавляем информацию о последнем месте
    messageText += `\n\n\n\n\n👥 <b>Участвовал</b>\n🏁 <b>Последнее место:</b> ${
      lastPlace ? lastPlace.username : "—"
    }`;
    if (lastPlace) {
      messageText += `\n📊 <b>Очков набрано:</b> ${lastPlace.wins}`;
    }

    const chatIds = TELEGRAM_CHAT_ID.split(",").map((id) => id.trim());

    for (const chatId of chatIds) {
      try {
        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: messageText,
              parse_mode: "HTML",
            }),
          }
        );
        console.log(
          `✅ Уведомление о завершении турнира отправлено в группу ${chatId}`
        );
      } catch (err) {
        console.error(
          `❌ Ошибка при отправке уведомления о турнире в группу ${chatId}:`,
          err.message
        );
      }
    }
  } catch (error) {
    console.error(
      "❌ Ошибка отправки уведомления о завершении турнира:",
      error
    );
  }
}

// Функция записи лога в HTML файл
function writeBetLog(action, data) {
  try {
    // Проверяем размер файла
    if (fs.existsSync(LOG_FILE_PATH)) {
      const stats = fs.statSync(LOG_FILE_PATH);
      if (stats.size >= MAX_LOG_SIZE) {
        // Очищаем файл, оставляя только шаблон
        resetLogFile();
      }
    } else {
      // Создаем файл если не существует
      resetLogFile();
    }

    const time = new Date().toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    // Функция преобразования параметра в читаемый вид
    function formatParameterType(paramType) {
      const paramMap = {
        exact_score: "Точный счет",
        yellow_cards: "Желтые карточки",
        red_cards: "Красные карточки",
        corners: "Угловые",
        penalties_in_game: "Пенальти в игре",
        extra_time: "Доп. время",
        penalties_at_end: "Пенальти в конце",
      };
      return paramMap[paramType] || paramType;
    }

    let logEntry = "";
    if (action === "placed") {
      // Преобразуем prediction в читаемый вид
      let predictionText = data.prediction;

      // Если это team1 или team2 - заменяем на названия команд
      if (predictionText === "team1") {
        predictionText = data.team1;
      } else if (predictionText === "team2") {
        predictionText = data.team2;
      } else if (predictionText === "draw") {
        predictionText = "Ничья";
      }

      // Если это финальная ставка или матч финальный
      let finalBadge = "";
      let isFinalbet = data.is_final_bet || data.is_final_match;
      let roundSpan = "";

      if (isFinalbet) {
        finalBadge = `<span class="final-badge"><div class="log-label">Тур</div>🏆 ФИНАЛ</span>`;

        // Если есть параметр - переформатируем предсказание
        if (data.parameter_type) {
          predictionText = `${formatParameterType(data.parameter_type)}: ${
            data.prediction
          }`;
        }
      } else {
        // Для обычных ставок - показываем тур
        roundSpan = `<span class="round"><div class="log-label">Тур</div>📅 ${
          data.round || "??"
        }</span>`;
      }

      // Добавляем прогноз на счет если есть
      let scoreSpan = "";
      if (data.score_team1 != null && data.score_team2 != null) {
        scoreSpan = `<span class="score-prediction"><div class="log-label">Прогноз счета</div>📊 ${data.score_team1}-${data.score_team2}</span>`;
      }

      logEntry = `
    <div class="log-entry bet-placed">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action placed">✅ СТАВКА СДЕЛАНА</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Пользователь</div>👤 ${
          data.username
        }</span>
        <span class="prediction"><div class="log-label">Ставка</div>🎯 ${predictionText}</span>
        ${scoreSpan}
        <span class="match"><div class="log-label">Матч</div>⚽ ${
          data.team1
        } vs ${data.team2}</span>
        ${roundSpan}
        ${finalBadge}
        <span class="event"><div class="log-label">Турнир</div>🏆 ${
          data.eventName || "Неизвестный турнир"
        }</span>
      </div>
    </div>`;
    } else if (action === "deleted") {
      // Преобразуем prediction в читаемый вид
      let predictionText = data.prediction;

      // Если это team1 или team2 - заменяем на названия команд
      if (predictionText === "team1") {
        predictionText = data.team1;
      } else if (predictionText === "team2") {
        predictionText = data.team2;
      } else if (predictionText === "draw") {
        predictionText = "Ничья";
      }

      // Если это финальная ставка или матч финальный
      let finalBadge = "";
      let isFinalbet = data.is_final_bet || data.is_final_match;
      let roundSpan = "";

      if (isFinalbet) {
        finalBadge = `<span class="final-badge"><div class="log-label">Тур</div>🏆 ФИНАЛ</span>`;

        // Если есть параметр - переформатируем предсказание
        if (data.parameter_type) {
          predictionText = `${formatParameterType(data.parameter_type)}: ${
            data.prediction
          }`;
        }
      } else {
        // Для обычных ставок - показываем тур
        roundSpan = `<span class="round"><div class="log-label">Тур</div>📅 ${
          data.round || "??"
        }</span>`;
      }

      // Добавляем прогноз на счет если есть
      let scoreSpan = "";
      if (data.score_team1 != null && data.score_team2 != null) {
        scoreSpan = `<span class="score-prediction"><div class="log-label">Прогноз счета</div>📊 ${data.score_team1}-${data.score_team2}</span>`;
      }

      logEntry = `
    <div class="log-entry bet-deleted">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action deleted">❌ СТАВКА УДАЛЕНА</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Пользователь</div>👤 ${
          data.username
        }</span>
        <span class="prediction"><div class="log-label">Ставка</div>🎯 ${predictionText}</span>
        ${scoreSpan}
        <span class="match"><div class="log-label">Матч</div>⚽ ${
          data.team1
        } vs ${data.team2}</span>
        ${roundSpan}
        ${finalBadge}
        <span class="event"><div class="log-label">Турнир</div>🏆 ${
          data.eventName || "Неизвестный турнир"
        }</span>
      </div>
    </div>`;
    } else if (action === "settings") {
      logEntry = `
    <div class="log-entry settings-changed">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action settings">⚙️ НАСТРОЙКИ ИЗМЕНЕНЫ</div>
      <div class="log-details">
        <span class="user">👤 ${data.username}</span>
        <span class="setting">📝 ${data.setting}: ${
        data.oldValue ? `${data.oldValue} → ` : ""
      }${data.newValue || "удалено"}</span>
      </div>
    </div>`;
    } else if (action === "moderator_assigned") {
      logEntry = `
    <div class="log-entry moderator-assigned">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action moderator">🛡️ МОДЕРАТОР НАЗНАЧЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Пользователь</div>👤 ${data.username}</span>
        <span class="permissions"><div class="log-label">Выданные права</div>📋 ${data.permissions.replace(/\n/g, '<br>')}</span>
      </div>
    </div>`;
    } else if (action === "moderator_removed") {
      logEntry = `
    <div class="log-entry moderator-removed">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action moderator-removed">🗑️ МОДЕРАТОР УДАЛЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Пользователь</div>👤 ${data.username}</span>
      </div>
    </div>`;
    } else if (action === "moderator_permissions_changed") {
      let changesHtml = '';
      
      // Форматируем добавленные права с зеленым цветом
      if (data.added) {
        const addedLines = data.added.split('\n').map(line => 
          `<div style="color: #81c784; margin: 2px 0;">➕ ${line}</div>`
        ).join('');
        changesHtml += addedLines;
      }
      
      // Форматируем удаленные права с красным цветом
      if (data.removed) {
        const removedLines = data.removed.split('\n').map(line => 
          `<div style="color: #ef5350; margin: 2px 0;">➖ ${line}</div>`
        ).join('');
        changesHtml += removedLines;
      }
      
      logEntry = `
    <div class="log-entry moderator-permissions-changed">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action moderator-changed">🔄 ПРАВА МОДЕРАТОРА ИЗМЕНЕНЫ</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Пользователь</div>👤 ${data.username}</span>
        <div class="permissions-changes"><div class="log-label">Изменения</div>${changesHtml}</div>
      </div>
    </div>`;
    } else if (action === "match_created") {
      logEntry = `
    <div class="log-entry match-created">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action match-created">⚽ МАТЧ СОЗДАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="teams"><div class="log-label">Команды</div>⚽ ${data.team1} vs ${data.team2}</span>
        <span class="tournament"><div class="log-label">Турнир</div>🏆 ${data.tournament}</span>
        <span class="round"><div class="log-label">Тур</div>📅 ${data.round}</span>
        ${data.is_final ? '<span class="round"><div class="log-label">Тип</div>🏅 Финальный матч</span>' : ''}
      </div>
    </div>`;
    } else if (action === "match_edited") {
      logEntry = `
    <div class="log-entry match-edited">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action match-edited">✏️ МАТЧ ОТРЕДАКТИРОВАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="teams"><div class="log-label">Команды</div>⚽ ${data.team1} vs ${data.team2}</span>
        <span class="tournament"><div class="log-label">Турнир</div>🏆 ${data.tournament}</span>
        <span class="round"><div class="log-label">Тур</div>📅 ${data.round}</span>
      </div>
    </div>`;
    } else if (action === "match_deleted") {
      logEntry = `
    <div class="log-entry match-deleted">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action match-deleted">🗑️ МАТЧ УДАЛЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="teams"><div class="log-label">Команды</div>⚽ ${data.team1} vs ${data.team2}</span>
        <span class="tournament"><div class="log-label">Турнир</div>🏆 ${data.tournament}</span>
        <span class="round"><div class="log-label">Тур</div>📅 ${data.round}</span>
      </div>
    </div>`;
    } else if (action === "match_result_set") {
      logEntry = `
    <div class="log-entry match-result-set">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action match-result">📊 РЕЗУЛЬТАТ МАТЧА УСТАНОВЛЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="teams"><div class="log-label">Команды</div>⚽ ${data.team1} vs ${data.team2}</span>
        <span class="score"><div class="log-label">Счет</div>⚽ ${data.score}</span>
        <span class="tournament"><div class="log-label">Турнир</div>🏆 ${data.tournament}</span>
      </div>
    </div>`;
    } else if (action === "tournament_created") {
      logEntry = `
    <div class="log-entry tournament-created">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action tournament-created">🏆 ТУРНИР СОЗДАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="tournament"><div class="log-label">Название</div>🏆 ${data.name}</span>
        ${data.dates ? `<span class="details"><div class="log-label">Даты</div>📅 ${data.dates}</span>` : ''}
      </div>
    </div>`;
    } else if (action === "tournament_edited") {
      logEntry = `
    <div class="log-entry tournament-edited">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action tournament-edited">✏️ ТУРНИР ОТРЕДАКТИРОВАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="tournament"><div class="log-label">Название</div>🏆 ${data.name}</span>
      </div>
    </div>`;
    } else if (action === "tournament_deleted") {
      const userLabel = data.is_moderator ? "Модератор" : "Администратор";
      logEntry = `
    <div class="log-entry tournament-deleted">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action tournament-deleted">🗑️ ТУРНИР УДАЛЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">${userLabel}</div>👤 ${data.user}</span>
        <span class="tournament"><div class="log-label">Название</div>🏆 ${data.name}</span>
        <span class="tournament"><div class="log-label">ID</div>🔢 ${data.event_id}</span>
      </div>
    </div>`;
    } else if (action === "backup_created") {
      logEntry = `
    <div class="log-entry backup-created">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action backup-created">💾 БЭКАП СОЗДАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="backup"><div class="log-label">Файл</div>📦 ${data.filename}</span>
        <span class="backup"><div class="log-label">Размер</div>📊 ${data.size}</span>
      </div>
    </div>`;
    } else if (action === "backup_restored") {
      logEntry = `
    <div class="log-entry backup-restored">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action backup-restored">📥 БАЗА ДАННЫХ ВОССТАНОВЛЕНА</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="backup"><div class="log-label">Из файла</div>📦 ${data.filename}</span>
        ${data.currentBackup ? `<span class="backup"><div class="log-label">Создан бэкап</div>💾 ${data.currentBackup}</span>` : ''}
      </div>
    </div>`;
    } else if (action === "backup_deleted") {
      logEntry = `
    <div class="log-entry backup-deleted">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action backup-deleted">🗑️ БЭКАП УДАЛЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="backup"><div class="log-label">Файл</div>📦 ${data.filename}</span>
      </div>
    </div>`;
    } else if (action === "backup_downloaded") {
      logEntry = `
    <div class="log-entry backup-downloaded">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action backup-downloaded">💾 БЭКАП СКАЧАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="backup"><div class="log-label">Файл</div>📦 ${data.filename}</span>
        <span class="backup"><div class="log-label">Размер</div>📊 ${data.size}</span>
      </div>
    </div>`;
    } else if (action === "telegram_synced") {
      logEntry = `
    <div class="log-entry telegram-synced">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action telegram-synced">🔄 СИНХРОНИЗАЦИЯ TELEGRAM ID</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="details"><div class="log-label">Результат</div>✅ Обновлено: ${data.updated} | ❌ Не найдено: ${data.notFound}</span>
      </div>
    </div>`;
    } else if (action === "orphaned_cleaned") {
      logEntry = `
    <div class="log-entry orphaned-cleaned">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action orphaned-cleaned">🗑️ ОЧИСТКА ORPHANED ДАННЫХ</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="details"><div class="log-label">Удалено</div>${data.details}</span>
      </div>
    </div>`;
    } else if (action === "user_renamed") {
      logEntry = `
    <div class="log-entry user-renamed">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action user-renamed">✏️ ПОЛЬЗОВАТЕЛЬ ПЕРЕИМЕНОВАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="details"><div class="log-label">Изменение</div>👤 ${data.oldName} → ${data.newName}</span>
      </div>
    </div>`;
    } else if (action === "user_deleted") {
      logEntry = `
    <div class="log-entry user-deleted">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action user-deleted">🗑️ ПОЛЬЗОВАТЕЛЬ УДАЛЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="details"><div class="log-label">Пользователь</div>👤 ${data.username}</span>
        ${data.betsDeleted ? `<span class="details"><div class="log-label">Удалено ставок</div>📊 ${data.betsDeleted}</span>` : ''}
      </div>
    </div>`;
    }

    // Читаем файл и вставляем новый лог после <!-- LOGS_START -->
    let content = fs.readFileSync(LOG_FILE_PATH, "utf-8");
    content = content.replace(
      "<!-- LOGS_START -->",
      `<!-- LOGS_START -->${logEntry}`
    );
    fs.writeFileSync(LOG_FILE_PATH, content, "utf-8");

    console.log(`📝 Лог записан: ${action} - ${data.username}`);
  } catch (error) {
    console.error("❌ Ошибка записи лога:", error);
  }
}

// Функция для проверки и отправки напоминаний непроголосовавших пользователей за 3 часа до матча
async function checkAndRemindNonVoters() {
  console.log(
    `\n========== ⏰ checkAndRemindNonVoters ВЫЗВАНА В ${new Date().toISOString()} ==========`
  );
  try {
    const now = new Date();
    const threeHoursLater = new Date(now.getTime() + 3 * 60 * 60 * 1000);

    console.log(
      `⏰ checkAndRemindNonVoters: Ищем матчи от ${now.toISOString()} (${now.getTime()}) до ${threeHoursLater.toISOString()} (${threeHoursLater.getTime()})`
    );

    // Получаем только матчи БЕЗ победителя И С датой для проверки
    const allMatches = db
      .prepare(
        `
      SELECT m.id, m.team1_name, m.team2_name, m.match_date, e.name as event_name, e.id as event_id
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.winner IS NULL AND m.match_date IS NOT NULL
      ORDER BY m.match_date ASC
      LIMIT 50
    `
      )
      .all();

    console.log(`⏰ Матчей без победителя и с датой: ${allMatches.length}`);

    // Логируем структуру матчей для отладки
    allMatches.forEach((match) => {
      const matchTime = new Date(match.match_date);
      const diffMs = matchTime.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      console.log(
        `⏰ Матч: ${match.team1_name} vs ${match.team2_name}, дата: ${
          match.match_date
        }, через ${diffHours.toFixed(2)} часов`
      );
    });

    // Получаем матчи, которые начнутся в течение 3 часов
    const upcomingMatches = allMatches.filter((match) => {
      const matchTime = new Date(match.match_date);
      const inWindow = matchTime > now && matchTime <= threeHoursLater;
      if (!inWindow) {
        const diffMs = matchTime.getTime() - now.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);
        console.log(
          `⏰   ${match.team1_name} vs ${match.team2_name}: дата ${
            match.match_date
          }, через ${diffHours.toFixed(2)} часов - ИСКЛЮЧЕН`
        );
      }
      return inWindow;
    });

    console.log(
      `⏰ Найдено ${upcomingMatches.length} матчей в течение 3 часов`
    );

    if (upcomingMatches.length === 0) {
      console.log(`⏰ Нет матчей для проверки напоминаний`);
      return;
    }

    // Группируем матчи по времени начала и турниру
    const matchGroups = {};
    upcomingMatches.forEach((match) => {
      const key = `${match.match_date}_${match.event_id}`;
      if (!matchGroups[key]) {
        matchGroups[key] = {
          match_date: match.match_date,
          event_name: match.event_name,
          event_id: match.event_id,
          matches: []
        };
      }
      matchGroups[key].matches.push(match);
    });

    console.log(`⏰ Сгруппировано в ${Object.keys(matchGroups).length} групп(ы) по времени и турниру`);

    // Обрабатываем каждую группу матчей
    for (const groupKey in matchGroups) {
      const group = matchGroups[groupKey];
      const matches = group.matches;
      
      console.log(`⏰ Обрабатываем группу: ${matches.length} матчей в ${group.match_date}, турнир: ${group.event_name}`);

      // Проверяем, было ли уже отправлено напоминание для этой группы
      const matchIds = matches.map(m => m.id);
      const existingReminders = db
        .prepare(`SELECT match_id FROM sent_reminders WHERE match_id IN (${matchIds.join(',')})`)
        .all();

      if (existingReminders.length > 0) {
        console.log(`⏰ Напоминание уже было отправлено для группы матчей`);
        continue;
      }

      // Получаем пользователей, у которых включены напоминания в группе
      const allUsers = db
        .prepare(
          "SELECT id, username, telegram_username FROM users WHERE telegram_group_reminders_enabled = 1"
        )
        .all();

      console.log(
        `⏰ Всего пользователей с включёнными напоминаниями: ${allUsers.length}`
      );

      if (allUsers.length === 0) {
        console.log(`⏰ ⚠️ НЕТ ПОЛЬЗОВАТЕЛЕЙ С ВКЛЮЧЕННЫМИ НАПОМИНАНИЯМИ!`);
        continue;
      }

      // Получаем пользователей, которые сделали ставки на ВСЕ матчи группы
      const usersWithAllBets = allUsers.filter(user => {
        const userBets = db
          .prepare(`SELECT DISTINCT match_id FROM bets WHERE user_id = ? AND match_id IN (${matchIds.join(',')})`)
          .all(user.id)
          .map(row => row.match_id);
        
        // Пользователь проголосовал только если сделал ставки на ВСЕ матчи
        return userBets.length === matches.length;
      });

      // Находим пользователей, которые НЕ сделали ставки на все матчи
      const nonVoters = allUsers.filter(
        (user) => !usersWithAllBets.some(u => u.id === user.id)
      );

      if (nonVoters.length > 0) {
        console.log(
          `⏰ Найдено ${nonVoters.length} непроголосовавших пользователей для группы матчей`
        );

        // Форматируем дату и время матча
        const matchDateTime = new Date(group.match_date);
        const matchDate = matchDateTime.toLocaleDateString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });
        const matchTime = matchDateTime.toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        });

        // Создаём список упоминаний пользователей
        const mentions = nonVoters
          .map((user) =>
            user.telegram_username
              ? `@${user.telegram_username}`
              : user.username
          )
          .join(", ");

        // Формируем список матчей
        const matchesList = matches.map((m, index) => 
          `${index + 1}. ⚽ <b>${m.team1_name}</b> vs <b>${m.team2_name}</b>`
        ).join('\n');

        const matchWord = matches.length === 1 ? 'Матч начнётся' : 'Матчи начнутся';

        // Составляем сообщение
        const message = `⏰ <b>Напоминание о голосовании!</b>

${matchWord} через 3 часа!

🕐 Время начала: <b>${matchDate} ${matchTime}</b>
🏆 Турнир: ${group.event_name}

${matchesList}

👥 <b>Не проголосовали:</b>
${mentions}

💬 Не забудьте сделать прогноз, малютки!

🔗 <a href="http://${SERVER_IP}:${PORT}">Открыть сайт</a>`;

        console.log(`⏰ Отправляем напоминание в группу для ${matches.length} матчей`);
        console.log(`📝 Сообщение: ${message.substring(0, 150)}...`);

        try {
          await sendGroupNotification(message);
          console.log(`✅ sendGroupNotification выполнена успешно`);
        } catch (err) {
          console.error(
            `❌ ОШИБКА при отправке sendGroupNotification: ${err.message}`
          );
          console.error(`   ${err.stack}`);
        }

        // Записываем в БД, что напоминание было отправлено для всех матчей группы
        try {
          const stmt = db.prepare("INSERT INTO sent_reminders (match_id) VALUES (?)");
          matches.forEach(match => {
            stmt.run(match.id);
          });
          console.log(
            `📢 Записи в БД добавлены для ${matches.length} матчей`
          );
        } catch (err) {
          console.error(`❌ ОШИБКА при добавлении в БД: ${err.message}`);
        }
      } else {
        console.log(
          `⏰ Нет непроголосовавших пользователей для группы матчей (все сделали ставки)`
        );
      }
    }
  } catch (error) {
    console.error(
      "❌ Ошибка при проверке непроголосовавших пользователей:",
      error
    );
  }
}

// Функция для отправки личных уведомлений пользователям за 3 часа до матча
async function checkAndNotifyUpcomingMatches() {
  try {
    const now = new Date();
    // Проверяем матчи, которые начнутся через 3 часа (с погрешностью ±5 минут)
    const threeHoursLater = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const threeHoursLaterMinus5 = new Date(threeHoursLater.getTime() - 5 * 60 * 1000);
    const threeHoursLaterPlus5 = new Date(threeHoursLater.getTime() + 5 * 60 * 1000);

    console.log(
      `🔔 checkAndNotifyUpcomingMatches: Ищем матчи от ${threeHoursLaterMinus5.toISOString()} до ${threeHoursLaterPlus5.toISOString()}`
    );

    // Получаем матчи, которые начнутся через ~3 часа
    const upcomingMatches = db
      .prepare(
        `
      SELECT DISTINCT m.id, m.team1_name, m.team2_name, m.match_date, e.name as event_name, e.id as event_id
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.match_date >= ? AND m.match_date <= ? AND m.winner IS NULL AND m.match_date IS NOT NULL
      ORDER BY m.match_date ASC
    `
      )
      .all(threeHoursLaterMinus5.toISOString(), threeHoursLaterPlus5.toISOString());

    console.log(
      `🔔 Найдено ${upcomingMatches.length} матчей которые начнутся через ~3 часа`
    );

    if (upcomingMatches.length === 0) {
      return;
    }

    // Получаем пользователей с включенными личными уведомлениями и привязанным Telegram
    const usersWithNotifications = db
      .prepare(
        `
      SELECT u.id, u.username, u.telegram_id, u.telegram_username,
             COALESCE(uns.three_hour_reminders, 1) as three_hour_reminders,
             COALESCE(uns.only_active_tournaments, 0) as only_active_tournaments
      FROM users u
      LEFT JOIN user_notification_settings uns ON u.id = uns.user_id
      WHERE u.telegram_notifications_enabled = 1 
        AND u.telegram_id IS NOT NULL
        AND COALESCE(uns.three_hour_reminders, 1) = 1
    `
      )
      .all();

    console.log(
      `🔔 Найдено ${usersWithNotifications.length} пользователей с включенными уведомлениями за 3 часа`
    );

    if (usersWithNotifications.length === 0) {
      return;
    }

    // Группируем матчи по времени начала и турниру
    const matchGroups = {};
    upcomingMatches.forEach((match) => {
      const key = `${match.match_date}_${match.event_id}`;
      if (!matchGroups[key]) {
        matchGroups[key] = {
          match_date: match.match_date,
          event_name: match.event_name,
          event_id: match.event_id,
          matches: []
        };
      }
      matchGroups[key].matches.push(match);
    });

    console.log(`🔔 Сгруппировано в ${Object.keys(matchGroups).length} групп(ы) по времени и турниру`);

    // Обрабатываем каждую группу матчей
    for (const groupKey in matchGroups) {
      const group = matchGroups[groupKey];
      const matches = group.matches;
      
      console.log(`🔔 Обрабатываем группу: ${matches.length} матчей в ${group.match_date}, турнир: ${group.event_name}`);

      // Проверяем, было ли уже отправлено уведомление за 3 часа для этой группы
      const matchIds = matches.map(m => m.id);
      const existingNotifications = db
        .prepare(`SELECT match_id FROM sent_3hour_reminders WHERE match_id IN (${matchIds.join(',')})`)
        .all();

      if (existingNotifications.length > 0) {
        console.log(`🔔 Уведомление за 3 часа для группы матчей уже было отправлено`);
        continue;
      }

      // Форматируем дату и время матча
      const matchDateTime = new Date(group.match_date);
      const matchDate = matchDateTime.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const matchTime = matchDateTime.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      });

      // Формируем список матчей
      const matchesList = matches.map((m, index) => 
        `${index + 1}. ⚽ <b>${m.team1_name}</b> vs <b>${m.team2_name}</b>`
      ).join('\n');

      const matchWord = matches.length === 1 ? 'НАПОМИНАНИЕ О МАТЧЕ' : 'НАПОМИНАНИЕ О МАТЧАХ';
      const startWord = matches.length === 1 ? 'Матч начнется' : 'Матчи начнутся';

      // Отправляем уведомление каждому пользователю
      for (const user of usersWithNotifications) {
        // Если включена настройка "только по активным турнирам", проверяем наличие ставок
        if (user.only_active_tournaments === 1) {
          const hasBets = db.prepare(`
            SELECT COUNT(*) as count
            FROM predictions p
            JOIN matches m ON p.match_id = m.id
            WHERE p.user_id = ? AND m.event_id = ?
          `).get(user.id, group.event_id);
          
          // Если нет ставок в этом турнире, пропускаем
          if (!hasBets || hasBets.count === 0) {
            console.log(`⏭️ Пропускаем пользователя ${user.username} - нет ставок в турнире ${group.event_name}`);
            continue;
          }
        }
        
        const message = `⏰ <b>${matchWord}</b>

${startWord} через 3 часа!

🕐 Время начала: <b>${matchDate} ${matchTime}</b>
📅 Турнир: ${group.event_name}

${matchesList}

⏳ Успейте сделать ставку!

🔗 <a href="http://${SERVER_IP}:${PORT}">Открыть сайт</a>`;

        try {
          const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
          if (TELEGRAM_BOT_TOKEN) {
            await fetch(
              `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: user.telegram_id,
                  text: message,
                  parse_mode: "HTML",
                }),
              }
            );
            console.log(`✅ Уведомление за 3 часа отправлено пользователю ${user.username} (${user.telegram_id})`);
          }
        } catch (error) {
          console.error(`⚠️ Не удалось отправить уведомление пользователю ${user.username}:`, error);
        }

        // Небольшая задержка между отправками чтобы не перегружать API
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Записываем в БД, что уведомление за 3 часа было отправлено для всех матчей группы
      const stmt = db.prepare("INSERT INTO sent_3hour_reminders (match_id) VALUES (?)");
      matches.forEach(match => {
        stmt.run(match.id);
      });

      console.log(
        `✅ Уведомления за 3 часа для ${matches.length} матчей отправлены всем пользователям`
      );
    }
  } catch (error) {
    console.error("❌ Ошибка при проверке предстоящих матчей:", error);
  }
}

// Функция для отправки персональных напоминаний из модального окна (event_reminders)
async function checkAndSendPersonalReminders() {
  try {
    const now = new Date();

    console.log(
      `🔔 checkAndSendPersonalReminders: Проверка персональных напоминаний в ${now.toISOString()}`
    );

    // Получаем все активные напоминания пользователей
    const reminders = db
      .prepare(
        `
      SELECT 
        er.id as reminder_id,
        er.user_id,
        er.event_id,
        er.hours_before,
        u.username,
        u.telegram_id,
        u.telegram_username,
        e.name as event_name
      FROM event_reminders er
      JOIN users u ON er.user_id = u.id
      JOIN events e ON er.event_id = e.id
      WHERE u.telegram_id IS NOT NULL
    `
      )
      .all();

    console.log(`🔔 Найдено ${reminders.length} активных напоминаний пользователей`);

    if (reminders.length === 0) {
      return;
    }

    // Для каждого напоминания проверяем матчи
    for (const reminder of reminders) {
      const hoursInMs = reminder.hours_before * 60 * 60 * 1000;
      const targetTime = new Date(now.getTime() + hoursInMs);
      const targetTimeMinus5 = new Date(targetTime.getTime() - 5 * 60 * 1000);
      const targetTimePlus5 = new Date(targetTime.getTime() + 5 * 60 * 1000);

      // Получаем матчи турнира, которые начнутся через N часов
      const upcomingMatches = db
        .prepare(
          `
        SELECT m.id, m.team1_name, m.team2_name, m.match_date
        FROM matches m
        WHERE m.event_id = ? 
          AND m.match_date >= ? 
          AND m.match_date <= ? 
          AND m.winner IS NULL 
          AND m.match_date IS NOT NULL
        ORDER BY m.match_date ASC
      `
        )
        .all(reminder.event_id, targetTimeMinus5.toISOString(), targetTimePlus5.toISOString());

      if (upcomingMatches.length === 0) {
        continue;
      }

      console.log(
        `🔔 Пользователь ${reminder.username}: найдено ${upcomingMatches.length} матчей через ${reminder.hours_before}ч`
      );

      // Группируем матчи по времени начала
      const matchGroups = {};
      upcomingMatches.forEach((match) => {
        const key = match.match_date;
        if (!matchGroups[key]) {
          matchGroups[key] = {
            match_date: match.match_date,
            matches: []
          };
        }
        matchGroups[key].matches.push(match);
      });

      // Обрабатываем каждую группу матчей
      for (const groupKey in matchGroups) {
        const group = matchGroups[groupKey];
        const matches = group.matches;

        // Проверяем, было ли уже отправлено напоминание для этой группы этому пользователю
        const matchIds = matches.map(m => m.id);
        const existingReminders = db
          .prepare(
            `SELECT match_id FROM sent_personal_reminders 
             WHERE user_id = ? AND match_id IN (${matchIds.join(',')})`
          )
          .all(reminder.user_id);

        if (existingReminders.length > 0) {
          console.log(
            `🔔 Персональное напоминание для пользователя ${reminder.username} уже отправлено`
          );
          continue;
        }

        // Форматируем дату и время матча
        const matchDateTime = new Date(group.match_date);
        const matchDate = matchDateTime.toLocaleDateString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });
        const matchTime = matchDateTime.toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        });

        // Формируем список матчей
        const matchesList = matches.map((m, index) => 
          `${index + 1}. ⚽ <b>${m.team1_name}</b> vs <b>${m.team2_name}</b>`
        ).join('\n');

        const hoursText = reminder.hours_before === 1 ? 'час' : 
                          reminder.hours_before < 5 ? 'часа' : 'часов';

        const matchWord = matches.length === 1 ? 'Напоминание о матче!' : 'Напоминание о матчах!';

        // Составляем сообщение
        const message = `🔔 <b>${matchWord}</b>

🏆 Турнир: ${reminder.event_name}

${matchesList}

🕐 Начало через ${reminder.hours_before} ${hoursText}
🕐 Время начала: <b>${matchDate} ${matchTime}</b>

Не забудь сделать ставку! 🎯`;

        try {
          const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
          if (TELEGRAM_BOT_TOKEN) {
            await fetch(
              `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: reminder.telegram_id,
                  text: message,
                  parse_mode: "HTML",
                }),
              }
            );
            console.log(
              `✅ Персональное напоминание отправлено пользователю ${reminder.username} о ${matches.length} матчах`
            );
          }
        } catch (error) {
          console.error(
            `⚠️ Не удалось отправить персональное напоминание пользователю ${reminder.username}:`,
            error
          );
        }

        // Записываем в БД, что напоминание было отправлено
        const stmt = db.prepare(
          "INSERT INTO sent_personal_reminders (user_id, match_id) VALUES (?, ?)"
        );
        matches.forEach(match => {
          stmt.run(reminder.user_id, match.id);
        });

        console.log(
          `📢 Записи в БД добавлены для ${matches.length} матчей пользователя ${reminder.username}`
        );

        // Небольшая задержка между отправками
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  } catch (error) {
    console.error("❌ Ошибка при проверке персональных напоминаний:", error);
  }
}

// Функция для отправки объявления о турнире всем пользователям
async function sendTournamentAnnouncementToUsers(eventId, name, description, startDate, endDate) {
  try {
    console.log(`📢 Отправка объявления о турнире "${name}" всем пользователям...`);
    
    // Получаем всех пользователей с привязанным Telegram
    const users = db
      .prepare(
        `SELECT id, username, telegram_id FROM users WHERE telegram_id IS NOT NULL`
      )
      .all();
    
    console.log(`📢 Найдено ${users.length} пользователей с Telegram`);
    
    if (users.length === 0) {
      return;
    }
    
    // Форматируем даты
    let dateText = '';
    if (startDate && endDate) {
      const start = new Date(startDate).toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const end = new Date(endDate).toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      dateText = `📅 Даты: ${start} - ${end}`;
    } else if (startDate) {
      const start = new Date(startDate).toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      dateText = `📅 Начало: ${start}`;
    }
    
    // Формируем сообщение
    let message = `🏆 <b>НОВЫЙ ТУРНИР!</b>\n\n`;
    message += `<b>${name}</b>\n\n`;
    
    if (description) {
      message += `📝 ${description}\n\n`;
    }
    
    if (dateText) {
      message += `${dateText}\n\n`;
    }
    
    message += `Приготовьтесь делать прогнозы! 🎯\n\n`;
    message += `🔗 <a href="http://${SERVER_IP}:${PORT}">Открыть сайт</a>`;
    
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!TELEGRAM_BOT_TOKEN) {
      console.warn("⚠️ TELEGRAM_BOT_TOKEN не настроен");
      return;
    }
    
    // Отправляем каждому пользователю
    let successCount = 0;
    let errorCount = 0;
    
    for (const user of users) {
      try {
        // Проверяем детальные настройки уведомлений
        const notifSettings = db.prepare(`
          SELECT tournament_announcements 
          FROM user_notification_settings 
          WHERE user_id = ?
        `).get(user.id);
        
        // Если настройка выключена, пропускаем
        if (notifSettings && notifSettings.tournament_announcements === 0) {
          console.log(`⏭️ Пропускаем пользователя ${user.username} - объявления о турнирах выключены`);
          continue;
        }
        
        // Добавляем инлайн-кнопки реакций для личных сообщений
        const replyMarkup = {
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
        
        const response = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: user.telegram_id,
              text: message,
              parse_mode: "HTML",
              reply_markup: replyMarkup
            }),
          }
        );
        
        const result = await response.json();
        
        if (!result.ok) {
          console.error(`⚠️ Telegram API ошибка для ${user.username}:`, result);
          errorCount++;
        } else {
          successCount++;
        }
        
        // Небольшая задержка между отправками
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`⚠️ Не удалось отправить объявление пользователю ${user.username}:`, error.message);
        console.error(`   telegram_id: ${user.telegram_id}`);
        console.error(`   Полная ошибка:`, error);
        errorCount++;
      }
    }
    
    console.log(`✅ Объявление о турнире "${name}" отправлено: ${successCount} успешно, ${errorCount} ошибок`);
  } catch (error) {
    console.error("❌ Ошибка при отправке объявления пользователям:", error);
    throw error;
  }
}

// Функция для отправки объявления о турнире в группу
async function notifyTournamentToGroup(eventId, name, description, startDate, endDate) {
  try {
    console.log(`📢 Отправка объявления о турнире "${name}" в группу...`);
    
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const THREAD_ID = process.env.THREAD_ID;
    
    if (!TELEGRAM_BOT_TOKEN) {
      console.warn("⚠️ TELEGRAM_BOT_TOKEN не настроен");
      return;
    }
    
    if (!TELEGRAM_CHAT_ID) {
      console.warn("⚠️ TELEGRAM_CHAT_ID не настроен");
      return;
    }
    
    // Форматируем даты
    let dateText = '';
    if (startDate && endDate) {
      const start = new Date(startDate).toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const end = new Date(endDate).toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      dateText = `📅 Даты: ${start} - ${end}`;
    } else if (startDate) {
      const start = new Date(startDate).toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      dateText = `📅 Начало: ${start}`;
    }
    
    // Формируем сообщение
    let message = `🏆 <b>НОВЫЙ ТУРНИР!</b>\n\n`;
    message += `<b>${name}</b>\n\n`;
    
    if (description) {
      message += `📝 ${description}\n\n`;
    }
    
    if (dateText) {
      message += `${dateText}\n\n`;
    }
    
    message += `Приготовьтесь делать прогнозы! 🎯\n\n`;
    message += `🔗 <a href="http://${SERVER_IP}:${PORT}">Открыть сайт</a>`;
    
    // Формируем параметры запроса
    const requestBody = {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML",
    };
    
    // Добавляем thread_id если он указан
    if (THREAD_ID) {
      requestBody.message_thread_id = parseInt(THREAD_ID);
    }
    
    // Отправляем в группу
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );
    
    const result = await response.json();
    
    if (result.ok) {
      console.log(`✅ Объявление о турнире "${name}" отправлено в группу`);
    } else {
      console.error(`❌ Ошибка отправки в группу:`, result);
    }
  } catch (error) {
    console.error("❌ Ошибка при отправке объявления в группу:", error);
    throw error;
  }
}

// Функция для проверки и отправки уведомлений о начале матча
async function checkAndNotifyMatchStart() {
  try {
    const now = new Date();
    // Проверяем матчи, которые начались в течение последних 30 минут
    // (может быть задержка в уведомлении, поэтому берем больше времени)
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

    console.log(
      `⚽ checkAndNotifyMatchStart: Ищем матчи от ${thirtyMinutesAgo.toISOString()} до ${now.toISOString()}`
    );

    // Получаем матчи, которые начались в этом диапазоне
    const recentlyStartedMatches = db
      .prepare(
        `
      SELECT DISTINCT m.id, m.team1_name, m.team2_name, m.match_date, e.name as event_name
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.match_date > ? AND m.match_date <= ? AND m.winner IS NULL AND m.match_date IS NOT NULL
      ORDER BY m.match_date ASC
    `
      )
      .all(thirtyMinutesAgo.toISOString(), now.toISOString());

    console.log(
      `⚽ Найдено ${recentlyStartedMatches.length} матчей которые начались недавно`
    );

    if (recentlyStartedMatches.length === 0) {
      return;
    }

    // Группируем матчи по времени начала
    const matchesByTime = {};
    for (const match of recentlyStartedMatches) {
      // Проверяем, было ли уже отправлено уведомление о начале этого матча
      const existingNotification = db
        .prepare("SELECT id FROM sent_reminders WHERE match_id = ?")
        .get(match.id);

      // Пропускаем, если уведомление уже было отправлено
      if (existingNotification) {
        console.log(`⚽ Уведомление для матча ${match.id} уже было отправлено`);
        continue;
      }

      const timeKey = match.match_date; // Используем дату как ключ для группировки
      if (!matchesByTime[timeKey]) {
        matchesByTime[timeKey] = [];
      }
      matchesByTime[timeKey].push(match);
    }

    // Отправляем сообщение для каждой группы матчей (по времени начала)
    for (const [timeKey, matches] of Object.entries(matchesByTime)) {
      // Форматируем дату и время первого матча в группе
      const matchDateTime = new Date(matches[0].match_date);
      const matchDate = matchDateTime.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const matchTime = matchDateTime.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      });

      // Формируем список всех матчей в этой группе
      let matchesText = "";
      matches.forEach((match, index) => {
        matchesText += `${index + 1}. <b>${match.team1_name}</b> vs <b>${
          match.team2_name
        }</b> (${match.event_name})\n`;
      });

      // Составляем сообщение о начале матчей
      const matchCount = matches.length;
      const matchWord =
        matchCount === 1
          ? "МАТЧ"
          : matchCount === 2 || matchCount === 3 || matchCount === 4
          ? "МАТЧА"
          : "МАТЧЕЙ";

      const message = `⚽ <b>${matchCount} ${matchWord} НАЧАЛСЯ${
        matchCount === 1 ? "" : "О"
      }!</b>

${matchesText}
🕐 Время: ${matchDate} ${matchTime}

⛔ Ставить больше нельзя!

🔗 <a href="http://${SERVER_IP}:${PORT}">Открыть результаты</a>`;

      await sendGroupNotification(message);

      // Записываем в БД, что уведомления были отправлены
      for (const match of matches) {
        db.prepare("INSERT INTO sent_reminders (match_id) VALUES (?)").run(
          match.id
        );
      }

      console.log(
        `✅ Уведомление о начале ${matchCount} матча(ей) отправлено: ${matches
          .map((m) => `${m.team1_name} vs ${m.team2_name}`)
          .join(", ")}`
      );
    }
  } catch (error) {
    console.error("❌ Ошибка при проверке начала матчей:", error);
  }
}

// --- Admin endpoints for notification queue ---
// Simple protection: require ADMIN_LOGIN as query param (?admin=ADMIN_LOGIN)
function checkAdminAuth(req, res) {
  const admin = req.query.admin || req.headers["x-admin-token"];
  if (!process.env.ADMIN_LOGIN) return false;
  return admin && admin === process.env.ADMIN_LOGIN;
}

app.get("/admin/notifications/queue", (req, res) => {
  if (!checkAdminAuth(req, res)) {
    return res.status(403).json({ error: "forbidden" });
  }
  try {
    const q = getNotificationQueue();
    return res.json({ ok: true, queue: q });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/admin/notifications/queue/flush", async (req, res) => {
  if (!checkAdminAuth(req, res)) {
    return res.status(403).json({ error: "forbidden" });
  }
  try {
    const result = await flushQueueNow();
    return res.json({ ok: true, result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/admin/notifications/queue/clear", (req, res) => {
  if (!checkAdminAuth(req, res)) {
    return res.status(403).json({ error: "forbidden" });
  }
  try {
    writeNotificationQueue([]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Simple admin HTML page to view/manage notification queue
app.get("/admin/notifications", (req, res) => {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Notification Queue - Admin</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;margin:20px}
      .controls{margin-bottom:10px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #ddd;padding:8px;text-align:left}
      th{background:#f4f4f4}
      pre{white-space:pre-wrap;word-break:break-word}
      .small{font-size:0.9em;color:#b0b8c8}
      button{margin-right:8px}
    </style>
  </head>
  <body>
    <h2>Notifications queue</h2>
    <div class="controls">
      <label>Admin token: <input id="adminToken" style="width:300px" placeholder="Enter admin token"></label>
      <button id="saveToken">Save</button>
      <button id="refresh">Refresh</button>
      <button id="resendAll">Resend all</button>
      <button id="clearAll">Clear all</button>
      <span id="status" class="small"></span>
    </div>
    <div id="queueContainer"></div>

    <script>
      const tokenInput = document.getElementById('adminToken');
      const saved = localStorage.getItem('admin_token');
      if (saved) tokenInput.value = saved;
      document.getElementById('saveToken').addEventListener('click', ()=>{
        localStorage.setItem('admin_token', tokenInput.value.trim());
        setStatus('Saved token');
      });

      document.getElementById('refresh').addEventListener('click', ()=> fetchQueue());
      document.getElementById('resendAll').addEventListener('click', ()=> flushQueue());
      document.getElementById('clearAll').addEventListener('click', ()=> clearQueue());

      function setStatus(txt){ document.getElementById('status').textContent = txt; }

      async function fetchQueue(){
        const t = (tokenInput.value||localStorage.getItem('admin_token')||'').trim();
        if (!t) return setStatus('Provide admin token then Save');
        setStatus('Loading...');
        try{
          const r = await fetch('/admin/notifications/queue?admin='+encodeURIComponent(t));
          const json = await r.json();
          if (!json.ok) { setStatus('Error: '+(json.error||'unknown')); return; }
          renderQueue(json.queue || []);
          setStatus('Loaded '+(json.queue?json.queue.length:0)+' items');
        }catch(e){ setStatus('Fetch error: '+e.message); }
      }

      function renderQueue(queue){
        const c = document.getElementById('queueContainer');
        if (!queue.length) { c.innerHTML = '<p class="small">Queue is empty</p>'; return; }
        const rows = queue.map(function(q){
          return '<tr>'+
            '<td>'+ (q.id) +'</td>'+
            '<td>'+ (q.timestamp) +'</td>'+
            '<td>'+ (q.attempts||0) +'</td>'+
            '<td>'+ (new Date(q.nextAttemptAt).toLocaleString()) +'</td>'+
            '<td><pre>' + ((q.payload && (q.payload.message||JSON.stringify(q.payload)))||'') + '</pre></td>'+
          '</tr>';
        }).join('');
        c.innerHTML = '<table><thead><tr><th>id</th><th>timestamp</th><th>attempts</th><th>nextAttemptAt</th><th>payload</th></tr></thead><tbody>' + rows + '</tbody></table>';
      }

      async function flushQueue(){
        const t = (tokenInput.value||localStorage.getItem('admin_token')||'').trim();
        if (!t) return setStatus('Provide admin token');
        setStatus('Flushing...');
        try{
          const r = await fetch('/admin/notifications/queue/flush?admin='+encodeURIComponent(t), { method:'POST' });
          const j = await r.json();
          if (!j.ok) return setStatus('Error: '+(j.error||'unknown'));
          setStatus('Flush result: sent='+j.result.sent+' / total='+j.result.total);
          fetchQueue();
        }catch(e){ setStatus('Flush error: '+e.message); }
      }

      async function clearQueue(){
        const t = (tokenInput.value||localStorage.getItem('admin_token')||'').trim();
        if (!t) return setStatus('Provide admin token');
        if (!confirm('Clear all queued notifications?')) return;
        setStatus('Clearing...');
        try{
          const r = await fetch('/admin/notifications/queue/clear?admin='+encodeURIComponent(t), { method:'POST' });
          const j = await r.json();
          if (!j.ok) return setStatus('Error: '+(j.error||'unknown'));
          setStatus('Queue cleared');
          fetchQueue();
        }catch(e){ setStatus('Clear error: '+e.message); }
      }

      // auto-load
      fetchQueue();
    </script>
  </body>
</html>`;
  res.type("html").send(html);
});

// Сброс файла логов
function resetLogFile() {
  const template = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Логи ставок - 1xBetLineBoom</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e0e0e0;
      min-height: 100vh;
      padding: 20px;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding: 20px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .header h1 { color: #5a9fd4; font-size: 2em; margin-bottom: 10px; }
    .header p { color: #b0b8c8; font-size: 0.9em; }
    .logs-container { max-width: 1200px; margin: 0 auto; }
    .log-entry {
      background: rgba(255, 255, 255, 0.03);
      border-left: 4px solid #5a9fd4;
      padding: 15px 20px;
      margin-bottom: 10px;
      border-radius: 0 8px 8px 0;
      transition: all 0.3s ease;
    }
    .log-entry:hover { background: rgba(255, 255, 255, 0.08); transform: translateX(5px); }
    .log-entry.bet-placed { border-left-color: #4caf50; }
    .log-entry.bet-deleted { border-left-color: #f44336; }
    .log-entry.settings-changed { border-left-color: #ff9800; }
    .log-entry.moderator-assigned { border-left-color: #9c27b0; }
    .log-entry.moderator-removed { border-left-color: #f44336; }
    .log-entry.moderator-permissions-changed { border-left-color: #ff9800; }
    .log-entry.match-created { border-left-color: #4caf50; }
    .log-entry.match-edited { border-left-color: #2196f3; }
    .log-entry.match-deleted { border-left-color: #f44336; }
    .log-entry.match-result-set { border-left-color: #ff9800; }
    .log-entry.tournament-created { border-left-color: #9c27b0; }
    .log-entry.tournament-edited { border-left-color: #673ab7; }
    .log-entry.tournament-deleted { border-left-color: #f44336; }
    .log-entry.backup-created { border-left-color: #00bcd4; }
    .log-entry.backup-restored { border-left-color: #ff5722; }
    .log-entry.backup-deleted { border-left-color: #f44336; }
    .log-entry.backup-downloaded { border-left-color: #4caf50; }
    .log-entry.telegram-synced { border-left-color: #03a9f4; }
    .log-entry.orphaned-cleaned { border-left-color: #607d8b; }
    .log-entry.user-renamed { border-left-color: #ffc107; }
    .log-entry.user-deleted { border-left-color: #f44336; }
    .log-time { color: #b0b8c8; font-size: 0.85em; margin-bottom: 5px; }
    .log-action { font-weight: bold; margin-bottom: 8px; }
    .log-action.placed { color: #4caf50; }
    .log-action.deleted { color: #f44336; }
    .log-action.settings { color: #ff9800; }
    .log-action.moderator { color: #9c27b0; }
    .log-action.moderator-removed { color: #f44336; }
    .log-action.moderator-changed { color: #ff9800; }
    .log-action.match-created { color: #4caf50; }
    .log-action.match-edited { color: #2196f3; }
    .log-action.match-deleted { color: #f44336; }
    .log-action.match-result { color: #ff9800; }
    .log-action.tournament-created { color: #9c27b0; }
    .log-action.tournament-edited { color: #673ab7; }
    .log-action.tournament-deleted { color: #f44336; }
    .log-action.backup-created { color: #00bcd4; }
    .log-action.backup-restored { color: #ff5722; }
    .log-action.backup-deleted { color: #f44336; }
    .log-action.backup-downloaded { color: #4caf50; }
    .log-action.telegram-synced { color: #03a9f4; }
    .log-action.orphaned-cleaned { color: #607d8b; }
    .log-action.user-renamed { color: #ffc107; }
    .log-action.user-deleted { color: #f44336; }
    .log-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 10px;
      font-size: 0.9em;
    }
    .log-details span { padding: 5px 10px; background: rgba(0, 0, 0, 0.2); border-radius: 4px; }
    .log-details .user { color: #64b5f6; }
    .log-details .prediction { color: #ffb74d; }
    .log-details .match { color: #81c784; }
    .log-details .event { color: #ce93d8; }
    .log-details .setting { color: #ffcc80; }
    .log-details .permissions { color: #ba68c8; grid-column: 1 / -1; }
    .log-details .permissions-changes { grid-column: 1 / -1; padding: 5px 10px; background: rgba(0, 0, 0, 0.2); border-radius: 4px; }
    .log-details .tournament { color: #ba68c8; }
    .log-details .teams { color: #81c784; }
    .log-details .round { color: #ffb74d; }
    .log-details .score { color: #ff9800; }
    .log-details .backup { color: #00bcd4; }
    .log-details .details { color: #b0b8c8; grid-column: 1 / -1; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📋 Логи ставок</h1>
    <p>История всех ставок и удалений</p>
    <div id="logFileInfo" style="margin-top: 10px; font-size: 0.85em; color: #999;">
      Загрузка информации о файле...
    </div>
  </div>
  <div class="logs-container">
<!-- LOGS_START -->
<!-- LOGS_END -->
  </div>
  
  <script>
    // Загрузить информацию о размере файла логов
    async function loadLogFileInfo() {
      try {
        const response = await fetch('/api/bet-logs-info');
        const data = await response.json();
        
        if (data.success) {
          const infoDiv = document.getElementById('logFileInfo');
          const percentColor = data.percentUsed > 80 ? '#f44336' : data.percentUsed > 50 ? '#ff9800' : '#4caf50';
          
          infoDiv.innerHTML = \`
            📊 Размер файла: <strong style="color: #5a9fd4;">\${data.sizeFormatted}</strong> / \${data.maxSizeFormatted}
            <span style="color: \${percentColor}; margin-left: 10px;">(\${data.percentUsed}% использовано)</span>
          \`;
        }
      } catch (error) {
        console.error('Ошибка загрузки информации о файле:', error);
        document.getElementById('logFileInfo').innerHTML = '⚠️ Не удалось загрузить информацию о файле';
      }
    }
    
    // Загружаем информацию при загрузке страницы
    loadLogFileInfo();
    
    // Обновляем каждые 30 секунд
    setInterval(loadLogFileInfo, 30000);
  </script>
</body>
</html>`;
  fs.writeFileSync(LOG_FILE_PATH, template, "utf-8");
  console.log("🔄 Файл логов очищен/создан");
}

// Инициализируем базу данных
let db = new Database("1xBetLineBoom.db");

// Отключаем WAL-режим (используем DELETE режим для совместимости)
db.pragma("journal_mode = DELETE");

// Отключаем FOREIGN KEY constraints для упрощения операций удаления
db.pragma("foreign_keys = OFF");

// Middleware
app.use(express.json({ limit: "50mb" })); // Увеличиваем лимит для аватаров
app.use(express.static(".")); // Раздаем статические файлы (HTML, CSS, JS)

// ===== TELEGRAM WEBHOOK ENDPOINT =====
app.post("/telegram-webhook", async (req, res) => {
  try {
    console.log("📨 Получен webhook от Telegram");
    const update = req.body;
    
    // Импортируем функцию обработки update из бота
    const { handleWebhookUpdate } = await import("./OnexBetLineBoombot.js");
    
    // Обрабатываем update
    await handleWebhookUpdate(update);
    
    // Отвечаем Telegram что всё ОК
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Ошибка обработки webhook:", error);
    res.sendStatus(500);
  }
});

// Middleware для обновления last_activity при каждом запросе
app.use((req, res, next) => {
  // Пропускаем статические файлы
  if (req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/img/') || req.path.endsWith('.html')) {
    return next();
  }
  
  // Получаем session_token из заголовка или cookies
  const sessionToken = req.headers['x-session-token'] || req.cookies?.session_token;
  
  if (sessionToken) {
    try {
      // Обновляем last_activity для этой сессии
      db.prepare(`
        UPDATE sessions 
        SET last_activity = CURRENT_TIMESTAMP 
        WHERE session_token = ?
      `).run(sessionToken);
    } catch (error) {
      // Игнорируем ошибки обновления, чтобы не ломать запрос
      console.error('Ошибка обновления last_activity:', error);
    }
  }
  
  next();
});

// ===== ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ =====

// Функция для запуска миграций таблицы users
function runUsersMigrations() {
  console.log("🔄 Запуск миграций для таблицы users...");
  
  // Миграция: добавляем telegram_username если его нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN telegram_username TEXT`);
    console.log("✅ Колонка telegram_username добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем avatar если его нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN avatar LONGTEXT`);
    console.log("✅ Колонка avatar добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем telegram_notifications_enabled если её нет
  try {
    db.exec(
      `ALTER TABLE users ADD COLUMN telegram_notifications_enabled INTEGER DEFAULT 1`
    );
    console.log(
      "✅ Колонка telegram_notifications_enabled добавлена в таблицу users"
    );
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем telegram_group_reminders_enabled если её нет
  try {
    db.exec(
      `ALTER TABLE users ADD COLUMN telegram_group_reminders_enabled INTEGER DEFAULT 1`
    );
    console.log(
      "✅ Колонка telegram_group_reminders_enabled добавлена в таблицу users"
    );
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем avatar_path если её нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN avatar_path TEXT`);
    console.log("✅ Колонка avatar_path добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем theme если её нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'theme-default'`);
    console.log("✅ Колонка theme добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем show_bets если её нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN show_bets TEXT DEFAULT 'always'`);
    console.log("✅ Колонка show_bets добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем show_lucky_button если её нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN show_lucky_button INTEGER DEFAULT 1`);
    console.log("✅ Колонка show_lucky_button добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }
  
  // Миграция: добавляем live_sound если её нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN live_sound INTEGER DEFAULT 0`);
    console.log("✅ Колонка live_sound добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }
  
  // Миграция: добавляем telegram_id если его нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN telegram_id TEXT UNIQUE`);
    console.log("✅ Колонка telegram_id добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }
  
  console.log("✅ Миграции для таблицы users завершены");
}

// Таблица пользователей
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    telegram_username TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Запускаем миграции для таблицы users
runUsersMigrations();

// Таблица настроек системы
db.exec(`
  CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Инициализируем настройку автоподсчета если её нет
const autoCountingSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'auto_counting_enabled'").get();
if (!autoCountingSetting) {
  db.prepare("INSERT INTO system_settings (key, value) VALUES ('auto_counting_enabled', 'true')").run();
}

// Таблица для связки telegram username → chat_id (для отправки личных сообщений)
db.exec(`
  CREATE TABLE IF NOT EXISTS telegram_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_username TEXT UNIQUE NOT NULL,
    chat_id INTEGER NOT NULL,
    first_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Таблица для отслеживания событий матчей (голы, карточки) для уведомлений
db.exec(`
  CREATE TABLE IF NOT EXISTS match_events_sent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(match_id, event_id, user_id)
  )
`);

// Таблица событий (Лиги, турниры)
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    start_date DATETIME,
    end_date DATETIME,
    icon TEXT DEFAULT '🏆',
    background_color TEXT DEFAULT 'rgba(224, 230, 240, .4)',
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Таблица матчей (с командами)
db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    team1_name TEXT NOT NULL,
    team2_name TEXT NOT NULL,
    match_date DATETIME,
    status TEXT DEFAULT 'pending',
    winner TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id)
  )
`);

// Таблица ставок пользователей
db.exec(`
  CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    prediction TEXT NOT NULL,
    amount REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (match_id) REFERENCES matches(id)
  )
`);

// Таблица прогнозов на счет
db.exec(`
  CREATE TABLE IF NOT EXISTS score_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    score_team1 INTEGER NOT NULL,
    score_team2 INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (match_id) REFERENCES matches(id),
    UNIQUE(user_id, match_id)
  )
`);

// Таблица прогнозов на карточки
db.exec(`
  CREATE TABLE IF NOT EXISTS cards_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    yellow_cards INTEGER,
    red_cards INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (match_id) REFERENCES matches(id),
    UNIQUE(user_id, match_id)
  )
`);

// Таблица фактических счетов матчей
db.exec(`
  CREATE TABLE IF NOT EXISTS match_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL UNIQUE,
    score_team1 INTEGER NOT NULL,
    score_team2 INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id)
  )
`);

// ===== DATABASE MIGRATIONS =====
// Добавляем колонку match_date если её нет
try {
  db.prepare("ALTER TABLE matches ADD COLUMN match_date DATETIME").run();
} catch (error) {
  // Колонка уже существует, это нормально
}

// Добавляем колонку locked_reason если её нет (для блокировки турниров)
try {
  db.prepare("ALTER TABLE events ADD COLUMN locked_reason TEXT").run();
} catch (error) {
  // Колонка уже существует, это нормально
}

// Добавляем колонку end_date если её нет (для конца турнира)
try {
  db.prepare("ALTER TABLE events ADD COLUMN end_date DATETIME").run();
} catch (error) {
  // Колонка уже существует, это нормально
}

// Добавляем колонку icon если её нет (для иконки турнира)
try {
  db.prepare("ALTER TABLE events ADD COLUMN icon TEXT DEFAULT '🏆'").run();
} catch (error) {
  // Колонка уже существует, это нормально
}

// Добавляем колонку background_color если её нет (для цвета фона турнира)
try {
  db.prepare(
    "ALTER TABLE events ADD COLUMN background_color TEXT DEFAULT 'rgba(224, 230, 240, .4)'"
  ).run();
} catch (error) {
  // Колонка уже существует, это нормально
}

// Добавляем колонку team_file если её нет (для словаря команд турнира)
try {
  db.prepare("ALTER TABLE events ADD COLUMN team_file TEXT").run();
} catch (error) {
  // Колонка уже существует, это нормально
}

// Добавляем колонку score_prediction_enabled если её нет (для прогноза на счет)
try {
  db.prepare("ALTER TABLE matches ADD COLUMN score_prediction_enabled INTEGER DEFAULT 0").run();
} catch (error) {
  // Колонка уже существует, это нормально
}

// Добавляем колонки для прогноза на карточки
try {
  db.prepare("ALTER TABLE matches ADD COLUMN yellow_cards_prediction_enabled INTEGER DEFAULT 0").run();
} catch (error) {
  // Колонка уже существует, это нормально
}

try {
  db.prepare("ALTER TABLE matches ADD COLUMN red_cards_prediction_enabled INTEGER DEFAULT 0").run();
} catch (error) {
  // Колонка уже существует, это нормально
}

// Добавляем колонку result если её нет (для результата матча)
try {
  db.prepare("ALTER TABLE matches ADD COLUMN result TEXT").run();
} catch (error) {
  // Колонка уже существует, это нормально
}

// Добавляем колонку round если её нет (для тура/группы/стадии)
try {
  db.prepare("ALTER TABLE matches ADD COLUMN round TEXT").run();
} catch (error) {
  // Колонка уже существует, это нормально
}

// Создаём таблицу наград если её нет
try {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS tournament_awards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      event_name TEXT NOT NULL,
      won_bets INTEGER NOT NULL,
      awarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(event_id) REFERENCES events(id),
      UNIQUE(user_id, event_id)
    )
  `
  ).run();
} catch (error) {
  // Таблица уже существует
}

// Добавляем колонки для финального матча
try {
  db.prepare("ALTER TABLE matches ADD COLUMN is_final BOOLEAN DEFAULT 0").run();
} catch (error) {
  // Колонка уже существует
}

try {
  db.prepare(
    "ALTER TABLE matches ADD COLUMN show_exact_score BOOLEAN DEFAULT 0"
  ).run();
} catch (error) {
  // Колонка уже существует
}

try {
  db.prepare(
    "ALTER TABLE matches ADD COLUMN show_yellow_cards BOOLEAN DEFAULT 0"
  ).run();
} catch (error) {
  // Колонка уже существует
}

try {
  db.prepare(
    "ALTER TABLE matches ADD COLUMN show_red_cards BOOLEAN DEFAULT 0"
  ).run();
} catch (error) {
  // Колонка уже существует
}

try {
  db.prepare(
    "ALTER TABLE matches ADD COLUMN show_corners BOOLEAN DEFAULT 0"
  ).run();
} catch (error) {
  // Колонка уже существует
}

try {
  db.prepare(
    "ALTER TABLE matches ADD COLUMN show_penalties_in_game BOOLEAN DEFAULT 0"
  ).run();
} catch (error) {
  // Колонка уже существует
}

try {
  db.prepare(
    "ALTER TABLE matches ADD COLUMN show_extra_time BOOLEAN DEFAULT 0"
  ).run();
} catch (error) {
  // Колонка уже существует
}

try {
  db.prepare(
    "ALTER TABLE matches ADD COLUMN show_penalties_at_end BOOLEAN DEFAULT 0"
  ).run();
} catch (error) {
  // Колонка уже существует
}

// Добавляем колонки для финальных ставок в таблицу bets
try {
  db.prepare(
    "ALTER TABLE bets ADD COLUMN is_final_bet BOOLEAN DEFAULT 0"
  ).run();
} catch (error) {
  // Колонка уже существует
}

try {
  db.prepare("ALTER TABLE bets ADD COLUMN parameter_type TEXT").run();
} catch (error) {
  // Колонка уже существует
}

// Добавляем колонки для счета матча
try {
  db.prepare("ALTER TABLE matches ADD COLUMN team1_score INTEGER").run();
} catch (error) {
  // Колонка уже существует
}

try {
  db.prepare("ALTER TABLE matches ADD COLUMN team2_score INTEGER").run();
} catch (error) {
  // Колонка уже существует
}

// Добавляем колонки для фактических карточек в матче
try {
  db.prepare("ALTER TABLE matches ADD COLUMN yellow_cards INTEGER").run();
} catch (error) {
  // Колонка уже существует
}

try {
  db.prepare("ALTER TABLE matches ADD COLUMN red_cards INTEGER").run();
} catch (error) {
  // Колонка уже существует
}

// Таблица настроек сайта
db.exec(`
  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS final_parameters_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL UNIQUE,
    exact_score TEXT,
    yellow_cards INTEGER,
    red_cards INTEGER,
    corners INTEGER,
    penalties_in_game TEXT,
    extra_time TEXT,
    penalties_at_end TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id)
  );

  CREATE TABLE IF NOT EXISTS moderators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    permissions TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_id INTEGER,
    award_type TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    background_opacity REAL DEFAULT 1,
    award_color TEXT DEFAULT '#fbc02d',
    award_emoji TEXT DEFAULT '🏆',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (event_id) REFERENCES events(id)
  )
`);

// Таблица для автоматических наград за турниры
db.exec(`
  CREATE TABLE IF NOT EXISTS awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    won_bets_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (event_id) REFERENCES events(id)
  )
`);

// Таблица для отслеживания отправленных напоминаний о голосовании
db.exec(`
  CREATE TABLE IF NOT EXISTS sent_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id)
  )
`);

// Миграция: добавляем user_id в sent_reminders если его нет
try {
  db.exec(`ALTER TABLE sent_reminders ADD COLUMN user_id INTEGER`);
  console.log("✅ Колонка user_id добавлена в таблицу sent_reminders");
} catch (e) {
  // Колонка уже существует
}

// Таблица для отслеживания отправленных уведомлений за 3 часа до матча
db.exec(`
  CREATE TABLE IF NOT EXISTS sent_3hour_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id)
  )
`);

// Таблица для отслеживания отправленных персональных напоминаний из модального окна
db.exec(`
  CREATE TABLE IF NOT EXISTS sent_personal_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (match_id) REFERENCES matches(id),
    UNIQUE(user_id, match_id)
  )
`);

// Таблица для хранения ожидающих публикации объявлений о турнирах
db.exec(`
  CREATE TABLE IF NOT EXISTS pending_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    start_date TEXT,
    end_date TEXT,
    message TEXT NOT NULL,
    username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Миграция: добавляем image_url если её нет
try {
  db.prepare("ALTER TABLE user_awards ADD COLUMN image_url TEXT").run();
  console.log("✅ Колонка image_url добавлена в таблицу user_awards");
} catch (e) {
  // Колонка уже существует, игнорируем
}

// Миграция: добавляем background_opacity если её нет
try {
  db.prepare(
    "ALTER TABLE user_awards ADD COLUMN background_opacity REAL DEFAULT 1"
  ).run();
  console.log("✅ Колонка background_opacity добавлена в таблицу user_awards");
} catch (e) {
  // Колонка уже существует, игнорируем
}

// Миграция: добавляем award_color если её нет
try {
  db.prepare(
    "ALTER TABLE user_awards ADD COLUMN award_color TEXT DEFAULT '#fbc02d'"
  ).run();
  console.log("✅ Колонка award_color добавлена в таблицу user_awards");
} catch (e) {
  // Колонка уже существует, игнорируем
}

// Миграция: добавляем award_emoji если её нет
try {
  db.prepare(
    "ALTER TABLE user_awards ADD COLUMN award_emoji TEXT DEFAULT '🏆'"
  ).run();
  console.log("✅ Колонка award_emoji добавлена в таблицу user_awards");
} catch (e) {
  // Колонка уже существует, игнорируем
}

// ===== ТАБЛИЦЫ ДЛЯ СЕТОК ПЛЕЙ-ОФФ =====

// Таблица сеток плей-офф
db.exec(`
  CREATE TABLE IF NOT EXISTS brackets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    start_date DATETIME NOT NULL,
    start_stage TEXT DEFAULT 'round_of_16',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id)
  )
`);

// Миграция: добавляем start_stage если её нет
try {
  db.prepare("ALTER TABLE brackets ADD COLUMN start_stage TEXT DEFAULT 'round_of_16'").run();
  console.log("✅ Колонка start_stage добавлена в таблицу brackets");
} catch (e) {
  // Колонка уже существует, игнорируем
}

// Миграция: добавляем matches если её нет
try {
  db.prepare("ALTER TABLE brackets ADD COLUMN matches TEXT").run();
  console.log("✅ Колонка matches добавлена в таблицу brackets");
} catch (e) {
  // Колонка уже существует, игнорируем
}

// Миграция: добавляем is_locked если её нет
try {
  db.prepare("ALTER TABLE brackets ADD COLUMN is_locked INTEGER DEFAULT 0").run();
  console.log("✅ Колонка is_locked добавлена в таблицу brackets");
} catch (e) {
  // Колонка уже существует, игнорируем
}

// Миграция: добавляем lock_dates для каждой стадии (JSON)
try {
  db.prepare("ALTER TABLE brackets ADD COLUMN lock_dates TEXT").run();
  console.log("✅ Колонка lock_dates добавлена в таблицу brackets");
} catch (e) {
  // Колонка уже существует, игнорируем
}

// Миграция: добавляем temporary_teams для слотов с двумя командами (JSON)
try {
  db.prepare("ALTER TABLE brackets ADD COLUMN temporary_teams TEXT").run();
  console.log("✅ Колонка temporary_teams добавлена в таблицу brackets");
} catch (e) {
  // Колонка уже существует, игнорируем
}

// Таблица прогнозов пользователей в сетке
db.exec(`
  CREATE TABLE IF NOT EXISTS bracket_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bracket_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    stage TEXT NOT NULL,
    match_index INTEGER NOT NULL,
    predicted_winner TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bracket_id) REFERENCES brackets(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(bracket_id, user_id, stage, match_index)
  )
`);

// Таблица фактических результатов матчей в сетке (для админа)
db.exec(`
  CREATE TABLE IF NOT EXISTS bracket_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bracket_id INTEGER NOT NULL,
    stage TEXT NOT NULL,
    match_index INTEGER NOT NULL,
    actual_winner TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bracket_id) REFERENCES brackets(id),
    UNIQUE(bracket_id, stage, match_index)
  )
`);

// Таблица настроек напоминаний о матчах турнира
db.exec(`
  CREATE TABLE IF NOT EXISTS event_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    hours_before INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (event_id) REFERENCES events(id),
    UNIQUE(user_id, event_id)
  )
`);

// Таблица детальных настроек уведомлений пользователя
db.exec(`
  CREATE TABLE IF NOT EXISTS user_notification_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    match_reminders INTEGER DEFAULT 1,
    three_hour_reminders INTEGER DEFAULT 1,
    only_active_tournaments INTEGER DEFAULT 0,
    tournament_announcements INTEGER DEFAULT 1,
    match_results INTEGER DEFAULT 1,
    system_messages INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// Миграция: добавление колонки only_active_tournaments если её нет
try {
  const tableInfo = db.prepare("PRAGMA table_info(user_notification_settings)").all();
  const hasOnlyActiveTournaments = tableInfo.some(col => col.name === 'only_active_tournaments');
  
  if (!hasOnlyActiveTournaments) {
    console.log("🔄 Миграция: добавление колонки only_active_tournaments в user_notification_settings");
    db.exec(`ALTER TABLE user_notification_settings ADD COLUMN only_active_tournaments INTEGER DEFAULT 0`);
    console.log("✅ Миграция завершена");
  }
} catch (error) {
  console.error("❌ Ошибка миграции user_notification_settings:", error);
}

// Миграция: добавление колонки three_hour_reminders если её нет
try {
  const tableInfo = db.prepare("PRAGMA table_info(user_notification_settings)").all();
  const hasThreeHourReminders = tableInfo.some(col => col.name === 'three_hour_reminders');
  
  if (!hasThreeHourReminders) {
    console.log("🔄 Миграция: добавление колонки three_hour_reminders в user_notification_settings");
    db.exec(`ALTER TABLE user_notification_settings ADD COLUMN three_hour_reminders INTEGER DEFAULT 1`);
    console.log("✅ Миграция завершена");
  }
} catch (error) {
  console.error("❌ Ошибка миграции user_notification_settings:", error);
}

// ===== API ENDPOINTS =====

// 0. Получить конфигурацию (включая ADMIN_LOGIN)
app.get("/api/config", (req, res) => {
  const ADMIN_LOGIN = process.env.ADMIN_LOGIN;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  res.json({
    ADMIN_LOGIN: ADMIN_LOGIN || null,
    ADMIN_DB_NAME: ADMIN_DB_NAME || null,
  });
});

app.post("/api/awards/upload-image", (req, res) => {
  awardImageUpload.single("image")(req, res, (error) => {
    if (error) {
      return res.status(400).json({ success: false, error: error.message });
    }

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "Файл не был получен" });
    }

    const relativePath = `/uploads/award-images/${req.file.filename}`;
    res.json({ success: true, url: relativePath });
  });
});

// Отправить уведомление админу о попытке входа под админским именем
app.post("/api/notify-admin-login-attempt", async (req, res) => {
  const { attemptedUsername } = req.body;
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
    console.log("⚠️ Telegram не настроен, уведомление не отправлено");
    return res.json({ success: false, reason: "Telegram не настроен" });
  }

  try {
    const message = `⚠️ Попытка входа под именем "${attemptedUsername}"!\n\n🕐 Время: ${new Date().toLocaleString(
      "ru-RU"
    )}`;

    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_ADMIN_ID,
          text: message,
        }),
      }
    );

    const result = await response.json();
    console.log("📨 Уведомление админу отправлено:", result.ok);
    res.json({ success: result.ok });
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления:", error);
    res.json({ success: false, error: error.message });
  }
});

// Получить порядок туров (для всех пользователей)
app.get("/api/rounds-order", (req, res) => {
  try {
    const setting = db
      .prepare("SELECT value FROM site_settings WHERE key = 'rounds_order'")
      .get();

    if (setting && setting.value) {
      res.json(JSON.parse(setting.value));
    } else {
      res.json([]);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Сохранить порядок туров (только для админа)
app.put("/api/admin/rounds-order", (req, res) => {
  try {
    const { rounds } = req.body;

    if (!Array.isArray(rounds)) {
      return res.status(400).json({ error: "rounds должен быть массивом" });
    }

    const value = JSON.stringify(rounds);

    db.prepare(
      `
      INSERT INTO site_settings (key, value, updated_at) 
      VALUES ('rounds_order', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `
    ).run(value, value);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Получить настройку показа победителя на завершённых турнирах
app.get("/api/settings/show-tournament-winner", (req, res) => {
  try {
    const setting = db
      .prepare(
        "SELECT value FROM site_settings WHERE key = 'show_tournament_winner'"
      )
      .get();

    // По умолчанию показываем победителя (true)
    const showWinner = setting
      ? setting.value === "1" || setting.value === "true"
      : true;
    res.json({ show_tournament_winner: showWinner });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Сохранить настройку показа победителя
app.post("/api/settings/show-tournament-winner", async (req, res) => {
  try {
    const {
      show_tournament_winner,
      username = "Unknown",
      telegram_username = "Not set",
    } = req.body;

    if (typeof show_tournament_winner !== "boolean") {
      return res
        .status(400)
        .json({ error: "show_tournament_winner должен быть boolean" });
    }

    const value = show_tournament_winner ? "1" : "0";

    db.prepare(
      `
      INSERT INTO site_settings (key, value, updated_at) 
      VALUES ('show_tournament_winner', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `
    ).run(value, value);

    // Отправляем уведомление админу
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      try {
        const status = show_tournament_winner ? "✅ ВКЛЮЧЕН" : "❌ ВЫКЛЮЧЕН";
        const emoji = show_tournament_winner ? "🎯" : "🔒";
        const telegramDisplay =
          telegram_username && telegram_username !== "Not set"
            ? `@${telegram_username}`
            : telegram_username;
        const message = `${emoji} <b>Изменена настройка показа победителя</b>\n\n👤 Пользователь: ${username}\n📱 Telegram: ${telegramDisplay}\n\nПоказ победителя на завершённых турнирах: ${status}\n\n🕐 Время: ${new Date().toLocaleString(
          "ru-RU"
        )}`;

        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: message,
              parse_mode: "HTML",
            }),
          }
        );
        console.log(
          `📢 Уведомление админу отправлено: показ победителя ${status} (пользователь: ${username})`
        );
      } catch (err) {
        console.error("❌ Ошибка при отправке уведомления админу:", err);
      }
    }

    res.json({ success: true, show_tournament_winner });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Получить часовой пояс пользователя
app.get("/api/user/timezone", (req, res) => {
  try {
    const username = req.headers["x-username"] || req.query.username;

    if (!username) {
      return res.status(400).json({ error: "Не указано имя пользователя" });
    }

    const user = db
      .prepare("SELECT timezone FROM users WHERE username = ?")
      .get(username);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({ timezone: user.timezone || "Europe/Moscow" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Сохранить часовой пояс пользователя
app.post("/api/user/timezone", async (req, res) => {
  try {
    const { username, timezone } = req.body;

    if (!username || !timezone) {
      return res
        .status(400)
        .json({ error: "Не указаны username или timezone" });
    }

    // Проверяем что это корректный часовой пояс
    const validTimezones = Intl.supportedValuesOf("timeZone");
    if (!validTimezones.includes(timezone)) {
      return res
        .status(400)
        .json({ error: `Неверный часовой пояс: ${timezone}` });
    }

    // Получаем старый часовой пояс для логирования
    const user = db
      .prepare("SELECT timezone, telegram_username FROM users WHERE username = ?")
      .get(username);

    const oldTimezone = user?.timezone || 'не установлен';

    const result = db
      .prepare("UPDATE users SET timezone = ? WHERE username = ?")
      .run(timezone, username);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    console.log(
      `🕐 Часовой пояс пользователя ${username} изменен на ${timezone}`
    );

    // Отправляем уведомление админу об изменении часового пояса
    try {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const time = new Date().toLocaleString("ru-RU");

        const adminMessage = `🕐 ИЗМЕНЕНИЕ ЧАСОВОГО ПОЯСА

👤 Пользователь: ${username}
${user?.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Новый часовой пояс: ${timezone}
📍 Старый часовой пояс: ${oldTimezone}
🕐 Время: ${time}`;

        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: adminMessage,
            }),
          }
        );
      }
    } catch (err) {
      console.error(
        "⚠️ Ошибка отправки уведомления админу об изменении часового пояса:",
        err.message
      );
    }

    res.json({ success: true, timezone });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 1. Получить все турниры
app.get("/api/events", (req, res) => {
  try {
    const events = db
      .prepare(
        `SELECT e.*, COUNT(m.id) as match_count 
         FROM events e 
         LEFT JOIN matches m ON e.id = m.event_id 
         GROUP BY e.id
         ORDER BY 
           CASE WHEN e.status = 'active' THEN 0 ELSE 1 END,
           e.start_date DESC, 
           e.created_at DESC`
      )
      .all();
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Получить один турнир по ID
app.get("/api/events/:eventId", (req, res) => {
  try {
    const { eventId } = req.params;
    const event = db
      .prepare("SELECT * FROM events WHERE id = ? AND status = 'active'")
      .get(eventId);

    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }

    res.json(event);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Получить участников турнира (по event_id)
app.get("/api/events/:eventId/tournament-participants", (req, res) => {
  try {
    const { eventId } = req.params;

    const participants = db
      .prepare(
        `
      SELECT 
        u.id,
        u.username,
        u.avatar,
        u.show_bets,
        COUNT(DISTINCT b.id) as event_bets,
        (SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN
                       -- Базовое очко за угаданный результат (3 за финал, 1 за обычный матч)
                       CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
                       -- Дополнительное очко за угаданный счет
                       CASE 
                         WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                              ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                              sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
                         THEN 1 
                         ELSE 0 
                       END
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 2
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 2
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 2
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 2
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 2
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 2
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 2
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) + COALESCE((
          SELECT SUM(CASE WHEN bp.stage = 'final' THEN 3 ELSE 1 END)
          FROM bracket_predictions bp
          INNER JOIN bracket_results br ON bp.bracket_id = br.bracket_id 
            AND bp.stage = br.stage 
            AND bp.match_index = br.match_index
          INNER JOIN brackets bk ON bp.bracket_id = bk.id
          WHERE bp.user_id = u.id 
            AND bk.event_id = ?
            AND bp.predicted_winner = br.actual_winner
        ), 0)) as event_won,
        SUM(CASE 
          WHEN (m.winner IS NOT NULL OR fpr.id IS NOT NULL) THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN NOT ((b.prediction = 'team1' AND m.winner = 'team1') OR
                            (b.prediction = 'team2' AND m.winner = 'team2') OR
                            (b.prediction = 'draw' AND m.winner = 'draw') OR
                            (b.prediction = m.team1_name AND m.winner = 'team1') OR
                            (b.prediction = m.team2_name AND m.winner = 'team2')) THEN 1 
                  ELSE 0 
                END
              -- Финальные параметры
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) != fpr.yellow_cards THEN 2
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) != fpr.red_cards THEN 2
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) != fpr.corners THEN 2
                  WHEN b.parameter_type = 'exact_score' AND b.prediction != fpr.exact_score THEN 2
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction != fpr.penalties_in_game THEN 2
                  WHEN b.parameter_type = 'extra_time' AND b.prediction != fpr.extra_time THEN 2
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction != fpr.penalties_at_end THEN 2
                  ELSE 0
                END
              ELSE 0 
            END 
          ELSE 0 
        END) as event_lost,
        SUM(CASE WHEN m.winner IS NULL AND fpr.id IS NULL THEN 1 ELSE 0 END) as event_pending
      FROM users u
      INNER JOIN bets b ON u.id = b.user_id
      INNER JOIN matches m ON b.match_id = m.id
      LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN match_scores ms ON b.match_id = ms.match_id
      WHERE m.event_id = ?
      GROUP BY u.id, u.username, u.avatar, u.show_bets
      HAVING COUNT(DISTINCT b.id) > 0
      ORDER BY event_won DESC, event_bets DESC, event_lost ASC
    `
      )
      .all(eventId, eventId);

    res.json(participants);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Получить ставки пользователя в турнире (для сравнения)
app.get("/api/events/:eventId/user-bets/:userId", (req, res) => {
  try {
    const { eventId, userId } = req.params;
    
    // Получаем информацию о пользователе
    const user = db.prepare("SELECT id, username, avatar FROM users WHERE id = ?").get(userId);
    
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    
    // Получаем все ставки пользователя в этом турнире
    const bets = db.prepare(`
      SELECT 
        b.*,
        m.team1_name,
        m.team2_name,
        m.winner,
        m.match_date,
        m.round,
        CASE 
          WHEN m.winner IS NOT NULL THEN
            CASE 
              WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                   (b.prediction = 'team2' AND m.winner = 'team2') OR
                   (b.prediction = 'draw' AND m.winner = 'draw') OR
                   (b.prediction = m.team1_name AND m.winner = 'team1') OR
                   (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
              ELSE 0
            END
          ELSE NULL
        END as is_won,
        CASE 
          WHEN m.winner IS NOT NULL THEN
            CASE 
              WHEN NOT ((b.prediction = 'team1' AND m.winner = 'team1') OR
                        (b.prediction = 'team2' AND m.winner = 'team2') OR
                        (b.prediction = 'draw' AND m.winner = 'draw') OR
                        (b.prediction = m.team1_name AND m.winner = 'team1') OR
                        (b.prediction = m.team2_name AND m.winner = 'team2')) THEN 1
              ELSE 0
            END
          ELSE NULL
        END as is_lost
      FROM bets b
      INNER JOIN matches m ON b.match_id = m.id
      WHERE b.user_id = ? AND m.event_id = ?
      ORDER BY m.match_date ASC
    `).all(userId, eventId);
    
    // Получаем статистику
    const stats = db.prepare(`
      SELECT 
        COUNT(DISTINCT b.id) as event_bets,
        SUM(CASE 
          WHEN m.winner IS NOT NULL THEN
            CASE 
              WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                   (b.prediction = 'team2' AND m.winner = 'team2') OR
                   (b.prediction = 'draw' AND m.winner = 'draw') OR
                   (b.prediction = m.team1_name AND m.winner = 'team1') OR
                   (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
              ELSE 0
            END
          ELSE 0
        END) as event_won,
        SUM(CASE 
          WHEN m.winner IS NOT NULL THEN
            CASE 
              WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                   (b.prediction = 'team2' AND m.winner = 'team2') OR
                   (b.prediction = 'draw' AND m.winner = 'draw') OR
                   (b.prediction = m.team1_name AND m.winner = 'team1') OR
                   (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
              ELSE 0
            END
          ELSE 0
        END) as event_won_count,
        SUM(CASE 
          WHEN m.winner IS NOT NULL THEN
            CASE 
              WHEN NOT ((b.prediction = 'team1' AND m.winner = 'team1') OR
                        (b.prediction = 'team2' AND m.winner = 'team2') OR
                        (b.prediction = 'draw' AND m.winner = 'draw') OR
                        (b.prediction = m.team1_name AND m.winner = 'team1') OR
                        (b.prediction = m.team2_name AND m.winner = 'team2')) THEN 1
              ELSE 0
            END
          ELSE 0
        END) as event_lost,
        SUM(CASE WHEN m.winner IS NULL THEN 1 ELSE 0 END) as event_pending
      FROM bets b
      INNER JOIN matches m ON b.match_id = m.id
      WHERE b.user_id = ? AND m.event_id = ?
    `).get(userId, eventId);
    
    // Форматируем ставки с информацией о матчах
    const formattedBets = bets.map(bet => ({
      ...bet,
      round: bet.round,
      match: {
        team1_name: bet.team1_name,
        team2_name: bet.team2_name,
        winner: bet.winner,
        match_date: bet.match_date
      }
    }));
    
    res.json({
      user,
      bets: formattedBets,
      stats: stats || { event_bets: 0, event_won: 0, event_won_count: 0, event_lost: 0, event_pending: 0 }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Получить матчи по событию
app.get("/api/events/:eventId/matches", (req, res) => {
  try {
    const { eventId } = req.params;
    const { username } = req.query;
    
    // Если передан username, загружаем матчи с прогнозами пользователя
    if (username) {
      const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
      
      if (user) {
        const matches = db
          .prepare(
            `SELECT m.*, 
                    sp.score_team1 as predicted_score_team1, 
                    sp.score_team2 as predicted_score_team2,
                    cp.yellow_cards as predicted_yellow_cards,
                    cp.red_cards as predicted_red_cards
             FROM matches m
             LEFT JOIN score_predictions sp ON m.id = sp.match_id AND sp.user_id = ?
             LEFT JOIN cards_predictions cp ON m.id = cp.match_id AND cp.user_id = ?
             WHERE m.event_id = ? 
             ORDER BY m.created_at ASC`
          )
          .all(user.id, user.id, eventId);
        return res.json(matches);
      }
    }
    
    // Если username не передан, загружаем матчи без прогнозов
    const matches = db
      .prepare(
        "SELECT * FROM matches WHERE event_id = ? ORDER BY created_at ASC"
      )
      .all(eventId);
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Получить информацию о победителе турнира и его награде
app.get("/api/events/:eventId/tournament-winner", (req, res) => {
  try {
    const { eventId } = req.params;

    // Получаем информацию о турнире
    const event = db
      .prepare("SELECT id, name, icon FROM events WHERE id = ?")
      .get(eventId);

    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }

    // Сначала проверяем автоматические награды в tournament_awards
    const tournamentAward = db
      .prepare(
        `
        SELECT ta.id, ta.user_id, ta.event_id, ta.event_name, ta.won_bets, ta.awarded_at as created_at, 
               u.username, u.avatar_path, u.avatar
        FROM tournament_awards ta
        JOIN users u ON ta.user_id = u.id
        WHERE ta.event_id = ?
        ORDER BY ta.won_bets DESC, ta.awarded_at ASC
        LIMIT 1
      `
      )
      .get(eventId);

    console.log(`🏆 Найденная автоматическая награда:`, tournamentAward);

    if (tournamentAward) {
      // Возвращаем данные победителя из tournament_awards
      const winnerData = {
        id: tournamentAward.id,
        user_id: tournamentAward.user_id,
        event_id: tournamentAward.event_id,
        username: tournamentAward.username,
        avatar_path: tournamentAward.avatar_path,
        avatar: tournamentAward.avatar,
        won_bets_count: tournamentAward.won_bets,
        created_at: tournamentAward.created_at,
        description: `"${event.name}"`, // Используем актуальное название из events
      };

      return res.json({
        tournament: event,
        winner: winnerData,
      });
    }

    // Если автоматическая награда не найдена, проверяем пользовательские награды (таблица awards)
    const award = db
      .prepare(
        `
        SELECT a.id, a.user_id, a.event_id, a.description, a.created_at, u.username, u.avatar_path, u.avatar
        FROM awards a
        JOIN users u ON a.user_id = u.id
        WHERE a.event_id = ?
        ORDER BY a.created_at ASC
        LIMIT 1
      `
      )
      .get(eventId);

    console.log(`🏆 Найденная пользовательская награда:`, award);

    if (!award) {
      // Если награда не найдена, пробуем без JOIN
      const awardWithoutJoin = db
        .prepare(
          `
          SELECT a.id, a.user_id, a.event_id, a.description, a.created_at
          FROM awards a
          WHERE a.event_id = ?
          ORDER BY a.created_at ASC
          LIMIT 1
        `
        )
        .get(eventId);

      if (!awardWithoutJoin) {
        // Нет данных о победителе для этого турнира
        return res.json({
          tournament: event,
          winner: null,
          message: "Победитель отсутствует",
        });
      }

      // Получаем данные пользователя отдельно
      const user = db
        .prepare("SELECT id, username, avatar_path, avatar FROM users WHERE id = ?")
        .get(awardWithoutJoin.user_id);

      if (!user) {
        return res.status(404).json({ error: "Пользователь не найден" });
      }

      // Подсчитываем реальное количество правильных прогнозов в турнире
      const wonBetsResult = db
        .prepare(
          `
          SELECT COUNT(*) as won_count
          FROM bets b
          JOIN matches m ON b.match_id = m.id
          WHERE b.user_id = ? AND m.event_id = ? AND m.winner IS NOT NULL
          AND (
            (b.prediction = 'team1' AND m.winner = 'team1') OR
            (b.prediction = 'team2' AND m.winner = 'team2') OR
            (b.prediction = 'draw' AND m.winner = 'draw') OR
            (b.prediction = m.team1_name AND m.winner = 'team1') OR
            (b.prediction = m.team2_name AND m.winner = 'team2')
          )
        `
        )
        .get(awardWithoutJoin.user_id, eventId);

      const winnerData = {
        ...awardWithoutJoin,
        username: user.username,
        avatar_path: user.avatar_path,
        avatar: user.avatar,
        won_bets_count: wonBetsResult?.won_count || 0,
      };

      return res.json({
        tournament: event,
        winner: winnerData,
      });
    }

    // Подсчитываем реальное количество правильных прогнозов в турнире
    const wonBetsResult = db
      .prepare(
        `
        SELECT COUNT(*) as won_count
        FROM bets b
        JOIN matches m ON b.match_id = m.id
        WHERE b.user_id = ? AND m.event_id = ? AND m.winner IS NOT NULL
        AND (
          (b.prediction = 'team1' AND m.winner = 'team1') OR
          (b.prediction = 'team2' AND m.winner = 'team2') OR
          (b.prediction = 'draw' AND m.winner = 'draw') OR
          (b.prediction = m.team1_name AND m.winner = 'team1') OR
          (b.prediction = m.team2_name AND m.winner = 'team2')
        )
      `
      )
      .get(award.user_id, eventId);

    const winnerData = {
      ...award,
      won_bets_count: wonBetsResult?.won_count || 0,
    };

    res.json({
      tournament: event,
      winner: winnerData,
    });
  } catch (error) {
    console.error("❌ Ошибка в endpoint tournament-winner:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== API ДЛЯ СЕТОК ПЛЕЙ-ОФФ =====

// Получить сетки для турнира
app.get("/api/events/:eventId/brackets", (req, res) => {
  try {
    const { eventId } = req.params;
    const brackets = db
      .prepare("SELECT * FROM brackets WHERE event_id = ? ORDER BY created_at DESC")
      .all(eventId);
    res.json(brackets);
  } catch (error) {
    console.error("Ошибка получения сеток:", error);
    res.status(500).json({ error: error.message });
  }
});

// Получить список файлов команд из папки names
app.get("/api/team-files", (req, res) => {
  try {
    const namesDir = path.join(__dirname, 'names');
    
    // Проверяем существование папки
    if (!fs.existsSync(namesDir)) {
      return res.json([]);
    }
    
    // Читаем файлы из папки
    const files = fs.readdirSync(namesDir);
    
    // Фильтруем только нужные форматы
    const teamFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.json', '.txt', '.js'].includes(ext);
    }).map(file => ({
      name: file,
      path: `/names/${file}`
    }));
    
    res.json(teamFiles);
  } catch (error) {
    console.error("Ошибка получения списка файлов команд:", error);
    res.status(500).json({ error: error.message });
  }
});

// Получить сетку по ID
app.get("/api/brackets/:bracketId", (req, res) => {
  try {
    const { bracketId } = req.params;
    const bracket = db
      .prepare("SELECT * FROM brackets WHERE id = ?")
      .get(bracketId);
    
    if (!bracket) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    // Парсим matches из JSON если есть
    if (bracket.matches) {
      try {
        bracket.matches = JSON.parse(bracket.matches);
      } catch (e) {
        console.error('Ошибка парсинга matches:', e);
        bracket.matches = {};
      }
    } else {
      bracket.matches = {};
    }
    
    // Парсим lock_dates из JSON если есть
    if (bracket.lock_dates) {
      try {
        bracket.lock_dates = JSON.parse(bracket.lock_dates);
      } catch (e) {
        console.error('Ошибка парсинга lock_dates:', e);
        bracket.lock_dates = {};
      }
    } else {
      bracket.lock_dates = {};
    }
    
    // Парсим temporary_teams из JSON если есть
    if (bracket.temporary_teams) {
      try {
        bracket.temporary_teams = JSON.parse(bracket.temporary_teams);
      } catch (e) {
        console.error('Ошибка парсинга temporary_teams:', e);
        bracket.temporary_teams = {};
      }
    } else {
      bracket.temporary_teams = {};
    }
    
    res.json(bracket);
  } catch (error) {
    console.error("Ошибка получения сетки:", error);
    res.status(500).json({ error: error.message });
  }
});

// Получить прогнозы пользователя для сетки
app.get("/api/brackets/:bracketId/predictions/:userId", async (req, res) => {
  try {
    const { bracketId, userId } = req.params;
    const { viewerId, viewerUsername } = req.query; // ID и имя пользователя, который просматривает
    
    // Если просматривает не владелец прогнозов, проверяем настройки приватности
    if (viewerId && parseInt(viewerId) !== parseInt(userId)) {
      const targetUser = db
        .prepare("SELECT show_bets, username FROM users WHERE id = ?")
        .get(userId);
      
      if (!targetUser) {
        return res.status(404).json({ error: "Пользователь не найден" });
      }
      
      // Отправляем уведомление админу
      if (viewerUsername) {
        const bracket = db.prepare("SELECT b.*, e.name as event_name FROM brackets b LEFT JOIN events e ON b.event_id = e.id WHERE b.id = ?").get(bracketId);
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
        
        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
          const message = `🎯 ПРОСМОТР СЕТКИ

👤 Кто смотрит: ${viewerUsername}
🎯 Чью сетку: ${targetUser.username}
🏆 Турнир: ${bracket?.event_name || 'Неизвестно'}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

          try {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: TELEGRAM_ADMIN_ID,
                text: message,
              }),
            });
          } catch (error) {
            console.error("⚠️ Не удалось отправить уведомление о просмотре сетки:", error);
          }
        }
      }
      
      const showBets = targetUser.show_bets || 'always';
      
      // Если настройка 'after_start', проверяем дату начала сетки
      if (showBets === 'after_start') {
        const bracket = db
          .prepare("SELECT start_date FROM brackets WHERE id = ?")
          .get(bracketId);
        
        if (bracket && bracket.start_date) {
          const startDate = new Date(bracket.start_date);
          const now = new Date();
          
          // Если сетка еще не началась, возвращаем пустой массив
          if (now < startDate) {
            return res.json({ 
              predictions: [], 
              hidden: true, 
              message: "Пользователь скрыл свои прогнозы до начала плей-офф" 
            });
          }
        }
      }
    }
    
    const predictions = db
      .prepare("SELECT * FROM bracket_predictions WHERE bracket_id = ? AND user_id = ?")
      .all(bracketId, userId);
    res.json({ predictions, hidden: false });
  } catch (error) {
    console.error("Ошибка получения прогнозов:", error);
    res.status(500).json({ error: error.message });
  }
});

// Сохранить прогнозы пользователя
app.post("/api/brackets/:bracketId/predictions", async (req, res) => {
  try {
    const { bracketId } = req.params;
    const { user_id, predictions } = req.body;
    
    if (!user_id || !predictions || !Array.isArray(predictions)) {
      return res.status(400).json({ error: "Неверные данные" });
    }
    
    // Проверяем, не закрыта ли сетка
    const bracket = db
      .prepare("SELECT * FROM brackets WHERE id = ?")
      .get(bracketId);
    
    if (!bracket) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    // Проверяем ручную блокировку
    if (bracket.is_locked === 1) {
      return res.status(403).json({ error: "Сетка заблокирована администратором" });
    }
    
    // Проверяем автоматическую блокировку по дате
    const startDate = new Date(bracket.start_date);
    const now = new Date();
    
    if (now >= startDate) {
      return res.status(403).json({ error: "Ставки в сетке закрыты" });
    }
    
    // Проверяем существующие прогнозы для определения, новые они или измененные
    const existingPredictions = {};
    predictions.forEach(p => {
      const existing = db.prepare(`
        SELECT predicted_winner FROM bracket_predictions 
        WHERE bracket_id = ? AND user_id = ? AND stage = ? AND match_index = ?
      `).get(bracketId, user_id, p.stage, p.match_index);
      
      if (existing) {
        existingPredictions[`${p.stage}_${p.match_index}`] = existing.predicted_winner;
      }
    });
    
    // Используем UPSERT для каждого прогноза (обновление или вставка)
    const upsertStmt = db.prepare(`
      INSERT INTO bracket_predictions (bracket_id, user_id, stage, match_index, predicted_winner)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(bracket_id, user_id, stage, match_index) 
      DO UPDATE SET predicted_winner = excluded.predicted_winner
    `);
    
    predictions.forEach(p => {
      upsertStmt.run(bracketId, user_id, p.stage, p.match_index, p.predicted_winner);
    });
    
    console.log(`✅ Прогнозы пользователя ${user_id} для сетки ${bracketId} сохранены`);
    
    // Отправляем уведомление пользователю в Telegram
    const user = db.prepare("SELECT username, telegram_username, telegram_notifications_enabled FROM users WHERE id = ?").get(user_id);
    
    if (user && user.telegram_username && user.telegram_notifications_enabled === 1) {
      // Получаем chat_id из telegram_users
      const cleanUsername = user.telegram_username.toLowerCase();
      const telegramUser = db.prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?").get(cleanUsername);
      
      if (telegramUser && telegramUser.chat_id) {
        // Получаем информацию о турнире
        const event = db.prepare("SELECT name FROM events WHERE id = ?").get(bracket.event_id);
        const eventName = event ? event.name : "Турнир";
        
        // Формируем текст уведомления
        const stageNames = {
          'round_of_16': '1/16 финала',
          'round_of_8': '1/8 финала',
          'quarter_finals': '1/4 финала',
          'semi_finals': '1/2 финала',
          'final': 'Финал'
        };
        
        // Разделяем на новые и измененные прогнозы
        const newPredictions = [];
        const changedPredictions = [];
        
        predictions.forEach(p => {
          const key = `${p.stage}_${p.match_index}`;
          const oldWinner = existingPredictions[key];
          
          if (oldWinner && oldWinner !== p.predicted_winner) {
            // Прогноз изменен
            changedPredictions.push({
              stage: stageNames[p.stage] || p.stage,
              oldWinner: oldWinner,
              newWinner: p.predicted_winner
            });
          } else if (!oldWinner) {
            // Новый прогноз
            newPredictions.push({
              stage: stageNames[p.stage] || p.stage,
              winner: p.predicted_winner
            });
          }
        });
        
        let message = '';
        
        if (changedPredictions.length > 0) {
          message = `🔄 Прогноз в сетке плей-офф изменен!\n\n📊 Турнир: ${eventName}\n🏆 Сетка: ${bracket.name}\n\n`;
          changedPredictions.forEach(p => {
            message += `${p.stage}:\n  ❌ Было: ${p.oldWinner}\n  ✅ Стало: ${p.newWinner}\n\n`;
          });
        } else if (newPredictions.length > 0) {
          message = `🎯 Прогноз в сетке плей-офф сохранен!\n\n📊 Турнир: ${eventName}\n🏆 Сетка: ${bracket.name}\n\n`;
          newPredictions.forEach(p => {
            message += `${p.stage}: ${p.winner}\n`;
          });
        }
        
        if (message) {
          // Отправляем уведомление пользователю через Telegram API
          const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
          if (TELEGRAM_BOT_TOKEN) {
            fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: telegramUser.chat_id,
                text: message,
                parse_mode: 'HTML'
              })
            }).catch(err => {
              console.error(`Ошибка отправки уведомления пользователю ${user_id}:`, err);
            });
          }
        }
      }
    }
    
    // Отправляем уведомление админу
    try {
      const event = db.prepare("SELECT name FROM events WHERE id = ?").get(bracket.event_id);
      const eventName = event ? event.name : "Турнир";
      
      const stageNames = {
        'round_of_16': '1/16 финала',
        'round_of_8': '1/8 финала',
        'quarter_finals': '1/4 финала',
        'semi_finals': '1/2 финала',
        'final': 'Финал'
      };
      
      // Разделяем на новые и измененные прогнозы
      const newPredictions = [];
      const changedPredictions = [];
      
      predictions.forEach(p => {
        const key = `${p.stage}_${p.match_index}`;
        const oldWinner = existingPredictions[key];
        
        if (oldWinner && oldWinner !== p.predicted_winner) {
          changedPredictions.push({
            stage: stageNames[p.stage] || p.stage,
            oldWinner: oldWinner,
            newWinner: p.predicted_winner
          });
        } else if (!oldWinner) {
          newPredictions.push({
            stage: stageNames[p.stage] || p.stage,
            winner: p.predicted_winner
          });
        }
      });
      
      let adminMessage = '';
      
      if (changedPredictions.length > 0) {
        adminMessage = `🔄 <b>Прогноз в сетке изменен</b>\n\n👤 <b>Пользователь:</b> ${user.username}\n📊 <b>Турнир:</b> ${eventName}\n🏆 <b>Сетка:</b> ${bracket.name}\n\n`;
        changedPredictions.forEach(p => {
          adminMessage += `<b>${p.stage}:</b>\n  ❌ Было: ${p.oldWinner}\n  ✅ Стало: ${p.newWinner}\n\n`;
        });
      } else if (newPredictions.length > 0) {
        adminMessage = `🎯 <b>Новый прогноз в сетке</b>\n\n👤 <b>Пользователь:</b> ${user.username}\n📊 <b>Турнир:</b> ${eventName}\n🏆 <b>Сетка:</b> ${bracket.name}\n\n`;
        newPredictions.forEach(p => {
          adminMessage += `<b>${p.stage}:</b> ${p.winner}\n`;
        });
      }
      
      if (adminMessage) {
        await notifyAdmin(adminMessage);
      }
    } catch (err) {
      console.error(`Ошибка отправки уведомления админу:`, err);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("Ошибка сохранения прогнозов:", error);
    res.status(500).json({ error: error.message });
  }
});

// Удалить прогноз пользователя
app.delete("/api/brackets/:bracketId/predictions/:userId/:stage/:matchIndex", (req, res) => {
  try {
    const { bracketId, userId, stage, matchIndex } = req.params;
    
    // Проверяем, не закрыта ли сетка
    const bracket = db
      .prepare("SELECT * FROM brackets WHERE id = ?")
      .get(bracketId);
    
    if (!bracket) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    // Проверяем ручную блокировку
    if (bracket.is_locked === 1) {
      return res.status(403).json({ error: "Сетка заблокирована администратором" });
    }
    
    // Проверяем автоматическую блокировку по дате
    const startDate = new Date(bracket.start_date);
    const now = new Date();
    
    if (now >= startDate) {
      return res.status(403).json({ error: "Ставки в сетке закрыты" });
    }
    
    // Удаляем прогноз
    const result = db.prepare(`
      DELETE FROM bracket_predictions 
      WHERE bracket_id = ? AND user_id = ? AND stage = ? AND match_index = ?
    `).run(bracketId, userId, stage, matchIndex);
    
    console.log(`✅ Прогноз пользователя ${userId} для сетки ${bracketId} (${stage}, матч ${matchIndex}) удален`);
    
    // Отправляем уведомление пользователю в Telegram
    if (result.changes > 0) {
      const user = db.prepare("SELECT username, telegram_username, telegram_notifications_enabled FROM users WHERE id = ?").get(userId);
      
      if (user && user.telegram_username && user.telegram_notifications_enabled === 1) {
        // Получаем chat_id из telegram_users
        const cleanUsername = user.telegram_username.toLowerCase();
        const telegramUser = db.prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?").get(cleanUsername);
        
        if (telegramUser && telegramUser.chat_id) {
          // Получаем информацию о турнире
          const event = db.prepare("SELECT name FROM events WHERE id = ?").get(bracket.event_id);
          const eventName = event ? event.name : "Турнир";
          
          // Формируем текст уведомления
          const stageNames = {
            'round_of_16': '1/16 финала',
            'round_of_8': '1/8 финала',
            'quarter_finals': '1/4 финала',
            'semi_finals': '1/2 финала',
            'final': 'Финал'
          };
          
          const message = `🗑️ Прогноз в сетке плей-офф удален!\n\n📊 Турнир: ${eventName}\n🏆 Сетка: ${bracket.name}\n⚽ Стадия: ${stageNames[stage] || stage}`;
          
          // Отправляем через Telegram API
          const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
          if (TELEGRAM_BOT_TOKEN) {
            fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: telegramUser.chat_id,
                text: message,
                parse_mode: 'HTML'
              })
            }).catch(err => {
              console.error(`Ошибка отправки уведомления пользователю ${userId}:`, err);
            });
          }
        }
      }
      
      // Отправляем уведомление админу
      if (user) {
        const event = db.prepare("SELECT name FROM events WHERE id = ?").get(bracket.event_id);
        const eventName = event ? event.name : "Турнир";
        
        const stageNames = {
          'round_of_16': '1/16 финала',
          'round_of_8': '1/8 финала',
          'quarter_finals': '1/4 финала',
          'semi_finals': '1/2 финала',
          'final': 'Финал'
        };
        
        const adminMessage = `🗑️ <b>Прогноз в сетке удален</b>\n\n👤 <b>Пользователь:</b> ${user.username}\n📊 <b>Турнир:</b> ${eventName}\n🏆 <b>Сетка:</b> ${bracket.name}\n⚽ <b>Стадия:</b> ${stageNames[stage] || stage}`;
        
        notifyAdmin(adminMessage).catch(err => {
          console.error(`Ошибка отправки уведомления админу:`, err);
        });
      }
    }
    
    res.json({ success: true, deleted: result.changes > 0 });
  } catch (error) {
    console.error("Ошибка удаления прогноза:", error);
    res.status(500).json({ error: error.message });
  }
});

// Удалить прогнозы пользователей на определенные стадии (для админа при очистке)
app.delete("/api/brackets/:bracketId/predictions/cleanup", (req, res) => {
  try {
    const { bracketId } = req.params;
    const { username, stages } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    if (!stages || !Array.isArray(stages) || stages.length === 0) {
      return res.status(400).json({ error: "Не указаны стадии для удаления" });
    }
    
    // Удаляем прогнозы для указанных стадий
    const placeholders = stages.map(() => '?').join(',');
    const result = db.prepare(`
      DELETE FROM bracket_predictions 
      WHERE bracket_id = ? AND stage IN (${placeholders})
    `).run(bracketId, ...stages);
    
    console.log(`✅ Удалено ${result.changes} прогнозов для сетки ${bracketId} на стадиях: ${stages.join(', ')}`);
    res.json({ success: true, deletedCount: result.changes });
  } catch (error) {
    console.error("Ошибка удаления прогнозов:", error);
    res.status(500).json({ error: error.message });
  }
});

// Создать сетку (только для админа)
app.post("/api/admin/brackets", (req, res) => {
  try {
    const { event_id, name, start_date, start_stage, lock_dates, temporary_teams, username } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    if (!event_id || !name || !start_date) {
      return res.status(400).json({ error: "Не все поля заполнены" });
    }
    
    // Создаем сетку
    const result = db.prepare(`
      INSERT INTO brackets (event_id, name, start_date, start_stage, lock_dates, temporary_teams)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      event_id, 
      name, 
      start_date, 
      start_stage || 'round_of_16',
      lock_dates ? JSON.stringify(lock_dates) : null,
      temporary_teams ? JSON.stringify(temporary_teams) : null
    );
    
    console.log(`✅ Сетка "${name}" создана для турнира ${event_id} (начало: ${start_stage || 'round_of_16'})`);
    
    // Автоматически создаём новость о начале плей-офф
    try {
      const event = db.prepare("SELECT name FROM events WHERE id = ?").get(event_id);
      if (event) {
        const newsTitle = `🔥 Начало плей-офф: ${event.name}`;
        const newsMessage = `Турнир "${event.name}" переходит в стадию плей-офф!\n\n🏆 Сетка: ${name}\n📅 Начало: ${start_date}\n\n⚡ Самое интересное только начинается! Делайте свои прогнозы на сетку!`;
        
        db.prepare(`
          INSERT INTO news (type, title, message)
          VALUES (?, ?, ?)
        `).run('tournament', newsTitle, newsMessage);
        
        console.log(`✅ Автоматически создана новость о начале плей-офф: ${event.name}`);
      }
    } catch (error) {
      console.error("❌ Ошибка создания новости о плей-офф:", error);
    }
    
    res.json({ 
      success: true, 
      bracket_id: result.lastInsertRowid 
    });
  } catch (error) {
    console.error("Ошибка создания сетки:", error);
    res.status(500).json({ error: error.message });
  }
});

// Обновить сетку (только для админа)
app.put("/api/admin/brackets/:bracketId", (req, res) => {
  try {
    const { bracketId } = req.params;
    const { name, start_date, start_stage, lock_dates, temporary_teams, username } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    if (!name || !start_date) {
      return res.status(400).json({ error: "Не все поля заполнены" });
    }
    
    // Обновляем сетку
    const result = db.prepare(`
      UPDATE brackets 
      SET name = ?, start_date = ?, start_stage = ?, lock_dates = ?, temporary_teams = ?
      WHERE id = ?
    `).run(
      name, 
      start_date, 
      start_stage || 'round_of_16',
      lock_dates ? JSON.stringify(lock_dates) : null,
      temporary_teams ? JSON.stringify(temporary_teams) : null,
      bracketId
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    console.log(`✅ Сетка ${bracketId} обновлена: "${name}" (начало: ${start_stage || 'round_of_16'})`);
    
    res.json({ 
      success: true, 
      bracket_id: bracketId 
    });
  } catch (error) {
    console.error("Ошибка обновления сетки:", error);
    res.status(500).json({ error: error.message });
  }
});

// Обновить команды в сетке (только для админа)
app.put("/api/admin/brackets/:bracketId/teams", (req, res) => {
  try {
    const { bracketId } = req.params;
    const { username, matches, temporary_teams } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    if (!matches) {
      return res.status(400).json({ error: "Не указаны команды" });
    }
    
    // Удаляем результаты для пустых слотов
    // Проходим по всем стадиям и матчам
    Object.keys(matches).forEach(stageId => {
      Object.keys(matches[stageId]).forEach(matchIndex => {
        const match = matches[stageId][matchIndex];
        // Если обе команды пустые - удаляем результат этого матча
        if ((!match.team1 || match.team1.trim() === '') && (!match.team2 || match.team2.trim() === '')) {
          db.prepare(`
            DELETE FROM bracket_results 
            WHERE bracket_id = ? AND stage = ? AND match_index = ?
          `).run(bracketId, stageId, matchIndex);
          console.log(`🗑️ Удален результат для пустого матча: ${stageId} match ${matchIndex}`);
        }
      });
    });
    
    // Обновляем команды в сетке и временные команды (сохраняем как JSON)
    const result = db.prepare(`
      UPDATE brackets 
      SET matches = ?, temporary_teams = ?
      WHERE id = ?
    `).run(
      JSON.stringify(matches), 
      JSON.stringify(temporary_teams || {}),
      bracketId
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    console.log(`✅ Команды в сетке ${bracketId} обновлены`);
    
    res.json({ 
      success: true, 
      bracket_id: bracketId 
    });
  } catch (error) {
    console.error("Ошибка обновления команд в сетке:", error);
    res.status(500).json({ error: error.message });
  }
});

// Обновить структуру сетки (продвижение команд пользователями)
app.put("/api/brackets/:bracketId/structure", (req, res) => {
  try {
    const { bracketId } = req.params;
    const { user_id, matches, temporary_teams } = req.body;
    
    if (!user_id) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    if (!matches) {
      return res.status(400).json({ error: "Не указаны команды" });
    }
    
    // Получаем текущую структуру сетки
    const bracket = db.prepare("SELECT matches, temporary_teams FROM brackets WHERE id = ?").get(bracketId);
    
    if (!bracket) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    // Парсим текущие matches
    let currentMatches = {};
    if (bracket.matches) {
      try {
        currentMatches = JSON.parse(bracket.matches);
      } catch (e) {
        currentMatches = {};
      }
    }
    
    // Получаем информацию о сетке для определения начальной стадии
    const bracketInfo = db.prepare("SELECT start_stage FROM brackets WHERE id = ?").get(bracketId);
    
    // Определяем редактируемую стадию из БД
    const editableStages = bracketInfo && bracketInfo.start_stage ? [bracketInfo.start_stage] : ['round_of_16'];
    const filteredMatches = {};
    
    // Сохраняем только начальные стадии из новых данных
    Object.keys(matches).forEach(stageId => {
      if (editableStages.includes(stageId)) {
        filteredMatches[stageId] = matches[stageId];
      }
    });
    
    // Также сохраняем начальные стадии из старых данных, если их нет в новых
    Object.keys(currentMatches).forEach(stageId => {
      if (editableStages.includes(stageId) && !filteredMatches[stageId]) {
        filteredMatches[stageId] = currentMatches[stageId];
      }
    });
    
    // Сохраняем только отфильтрованную структуру (без последующих стадий) и временные команды
    const result = db.prepare(`
      UPDATE brackets 
      SET matches = ?, temporary_teams = ?
      WHERE id = ?
    `).run(
      JSON.stringify(filteredMatches), 
      JSON.stringify(temporary_teams || {}),
      bracketId
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    console.log(`✅ Структура сетки ${bracketId} обновлена пользователем ${user_id}`);
    
    res.json({ 
      success: true, 
      bracket_id: bracketId 
    });
  } catch (error) {
    console.error("Ошибка обновления структуры сетки:", error);
    res.status(500).json({ error: error.message });
  }
});

// Изменить блокировку сетки (только для админа)
app.put("/api/admin/brackets/:bracketId/lock", (req, res) => {
  try {
    const { bracketId } = req.params;
    const { username, is_locked } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    if (is_locked === undefined) {
      return res.status(400).json({ error: "Не указано состояние блокировки" });
    }
    
    // Обновляем блокировку сетки
    const result = db.prepare(`
      UPDATE brackets 
      SET is_locked = ?
      WHERE id = ?
    `).run(is_locked, bracketId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    const lockStatus = is_locked === 1 ? 'заблокирована' : 'разблокирована';
    console.log(`✅ Сетка ${bracketId} ${lockStatus}`);
    
    res.json({ 
      success: true, 
      bracket_id: bracketId,
      is_locked: is_locked
    });
  } catch (error) {
    console.error("Ошибка изменения блокировки сетки:", error);
    res.status(500).json({ error: error.message });
  }
});

// Установить результат матча в сетке (только для админа)
app.put("/api/admin/brackets/:bracketId/results", async (req, res) => {
  try {
    const { bracketId } = req.params;
    const { username, stage, match_index, actual_winner } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    if (!stage || match_index === undefined || !actual_winner) {
      return res.status(400).json({ error: "Не все поля заполнены" });
    }
    
    // Используем UPSERT для результата
    db.prepare(`
      INSERT INTO bracket_results (bracket_id, stage, match_index, actual_winner)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(bracket_id, stage, match_index) 
      DO UPDATE SET actual_winner = excluded.actual_winner
    `).run(bracketId, stage, match_index, actual_winner);
    
    console.log(`✅ Результат матча установлен: сетка ${bracketId}, ${stage}, матч ${match_index}, победитель: ${actual_winner}`);
    
    // Получаем информацию о сетке и турнире
    const bracket = db.prepare("SELECT name, event_id FROM brackets WHERE id = ?").get(bracketId);
    const event = bracket ? db.prepare("SELECT name FROM events WHERE id = ?").get(bracket.event_id) : null;
    const eventName = event ? event.name : "Турнир";
    
    // Названия стадий
    const stageNames = {
      'round_of_16': '1/16 финала',
      'round_of_8': '1/8 финала',
      'quarter_finals': '1/4 финала',
      'semi_finals': '1/2 финала',
      'final': 'Финал'
    };
    const stageName = stageNames[stage] || stage;
    
    // Получаем всех пользователей с прогнозами на этот матч
    const usersWithPredictions = db.prepare(`
      SELECT 
        bp.user_id, 
        bp.predicted_winner,
        u.username,
        u.telegram_username,
        u.telegram_notifications_enabled
      FROM bracket_predictions bp
      JOIN users u ON bp.user_id = u.id
      WHERE bp.bracket_id = ? AND bp.stage = ? AND bp.match_index = ?
    `).all(bracketId, stage, match_index);
    
    // Отправляем уведомления пользователям
    for (const user of usersWithPredictions) {
      if (user.telegram_username && user.telegram_notifications_enabled === 1) {
        // Получаем chat_id из telegram_users
        const cleanUsername = user.telegram_username.toLowerCase();
        const telegramUser = db.prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?").get(cleanUsername);
        
        if (telegramUser && telegramUser.chat_id) {
          const isCorrect = user.predicted_winner === actual_winner;
          const emoji = isCorrect ? '✅' : '❌';
          
          const message = `${emoji} Результат матча в сетке плей-офф!\n\n📊 Турнир: ${eventName}\n🏆 Сетка: ${bracket.name}\n⚽ Стадия: ${stageName}\n\n🏁 Победитель: ${actual_winner}\n🎯 Ваш прогноз: ${user.predicted_winner}\n\n${isCorrect ? '🎉 Поздравляем! Вы угадали!' : '😔 К сожалению, прогноз не сбылся'}`;
          
          try {
            await sendUserMessage(telegramUser.chat_id, message);
            console.log(`✅ Уведомление о результате отправлено пользователю ${user.username} (${isCorrect ? 'угадал' : 'не угадал'})`);
          } catch (err) {
            console.error(`❌ Ошибка отправки уведомления пользователю ${user.user_id}:`, err);
          }
        }
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("Ошибка установки результата матча:", error);
    res.status(500).json({ error: error.message });
  }
});

// Получить результаты матчей в сетке
app.get("/api/brackets/:bracketId/results", (req, res) => {
  try {
    const { bracketId } = req.params;
    
    const results = db.prepare(`
      SELECT stage, match_index, actual_winner 
      FROM bracket_results 
      WHERE bracket_id = ?
    `).all(bracketId);
    
    res.json(results);
  } catch (error) {
    console.error("Ошибка получения результатов:", error);
    res.status(500).json({ error: error.message });
  }
});

// Удалить сетку (только для админа)
app.delete("/api/admin/brackets/:bracketId", (req, res) => {
  try {
    const { bracketId } = req.params;
    const { username } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    // Проверяем существование сетки
    const bracket = db.prepare("SELECT * FROM brackets WHERE id = ?").get(bracketId);
    
    if (!bracket) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    // Удаляем все прогнозы для этой сетки
    const deletedPredictions = db.prepare(`
      DELETE FROM bracket_predictions WHERE bracket_id = ?
    `).run(bracketId);
    
    // Удаляем саму сетку
    const result = db.prepare(`
      DELETE FROM brackets WHERE id = ?
    `).run(bracketId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    console.log(`✅ Сетка ${bracketId} удалена (удалено прогнозов: ${deletedPredictions.changes})`);
    
    res.json({ 
      success: true, 
      bracket_id: bracketId,
      deleted_predictions: deletedPredictions.changes
    });
  } catch (error) {
    console.error("Ошибка удаления сетки:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/events/:eventId/award - Добавить награду за турнир (для админа)
app.post("/api/events/:eventId/award", (req, res) => {
  try {
    const { eventId } = req.params;
    const { user_id, description, won_bets_count } = req.body;

    // Проверяем параметры
    if (!user_id || !description) {
      return res.status(400).json({
        error: "Требуются: user_id, description",
      });
    }

    // Проверяем, существует ли пользователь
    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(user_id);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем, существует ли событие
    const event = db.prepare("SELECT id FROM events WHERE id = ?").get(eventId);

    if (!event) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    // Добавляем награду
    const stmt = db.prepare(
      `INSERT INTO awards (user_id, event_id, description, won_bets_count, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    );

    const result = stmt.run(user_id, eventId, description, won_bets_count || 0);

    // Логируем в систему
    writeBetLog("settings", {
      username: "Admin",
      setting: "Tournament Award",
      oldValue: null,
      newValue: `${description} для пользователя ${user_id}`,
    });

    res.json({
      success: true,
      message: "Награда добавлена",
      awardId: result.lastInsertRowid,
    });
  } catch (error) {
    console.error("❌ Ошибка при добавлении награды:", error);
    res.status(500).json({ error: error.message });
  }
});

// Получить ставки участника в турнире
app.get("/api/event/:eventId/participant/:userId/bets", async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const userId = parseInt(req.params.userId);
    const viewerUserId = req.query.viewerId ? parseInt(req.query.viewerId) : null;
    const viewerUsername = req.query.viewerUsername || null;

    // Получаем название турнира
    const event = db
      .prepare("SELECT name FROM events WHERE id = ?")
      .get(eventId);

    // Получаем настройку show_bets пользователя
    const userSettings = db
      .prepare("SELECT show_bets, username FROM users WHERE id = ?")
      .get(userId);
    
    const showBets = userSettings?.show_bets || 'always';
    const isOwner = viewerUserId === userId;
    
    // Отправляем уведомление админу если кто-то смотрит чужие ставки
    if (!isOwner && viewerUserId && viewerUsername && userSettings) {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
      
      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const message = `📊 ПРОСМОТР СТАВОК

👤 Кто смотрит: ${viewerUsername}
🎯 Чьи ставки: ${userSettings.username}
🏆 Турнир: ${event?.name || 'Неизвестно'}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

        try {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: message,
            }),
          });
        } catch (error) {
          console.error("⚠️ Не удалось отправить уведомление о просмотре ставок:", error);
        }
      }
    }

    // Получаем все туры для этого события (из таблицы matches)
    const rounds = db
      .prepare(
        `
        SELECT DISTINCT m.round
        FROM matches m
        WHERE m.event_id = ? AND m.round IS NOT NULL
        ORDER BY m.round ASC
      `
      )
      .all(eventId)
      .map((r) => r.round)
      .filter((r) => r);

    // Получаем завершенные туры (где все матчи имеют winner)
    const completedRounds = db
      .prepare(
        `
        SELECT DISTINCT m.round
        FROM matches m
        WHERE m.event_id = ? 
          AND m.round IS NOT NULL
          AND m.round IN (
            SELECT round 
            FROM matches 
            WHERE event_id = ? 
              AND round IS NOT NULL
            GROUP BY round
            HAVING COUNT(*) = SUM(CASE WHEN winner IS NOT NULL THEN 1 ELSE 0 END)
          )
      `
      )
      .all(eventId, eventId)
      .map((r) => r.round);

    // Получаем обычные ставки участника в матчах этого события
    const bets = db
      .prepare(
        `
        SELECT 
          b.id,
          b.prediction,
          m.team1_name as team1,
          m.team2_name as team2,
          m.winner,
          m.round as round,
          m.match_date,
          0 as is_final_bet,
          CASE WHEN m.score_prediction_enabled = 1 THEN sp.score_team1 ELSE NULL END as score_team1,
          CASE WHEN m.score_prediction_enabled = 1 THEN sp.score_team2 ELSE NULL END as score_team2,
          ms.score_team1 as actual_score_team1,
          ms.score_team2 as actual_score_team2,
          CASE WHEN m.yellow_cards_prediction_enabled = 1 THEN cp.yellow_cards ELSE NULL END as yellow_cards,
          CASE WHEN m.red_cards_prediction_enabled = 1 THEN cp.red_cards ELSE NULL END as red_cards,
          m.yellow_cards as actual_yellow_cards,
          m.red_cards as actual_red_cards,
          CASE 
            WHEN b.prediction = 'team1' THEN m.team1_name
            WHEN b.prediction = 'team2' THEN m.team2_name
            WHEN b.prediction = 'draw' THEN 'Ничья'
            ELSE b.prediction
          END as prediction_display,
          CASE 
            WHEN m.winner IS NULL THEN 'pending'
            WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                 (b.prediction = 'team2' AND m.winner = 'team2') OR
                 (b.prediction = 'draw' AND m.winner = 'draw') OR
                 (b.prediction = m.team1_name AND m.winner = 'team1') OR
                 (b.prediction = m.team2_name AND m.winner = 'team2') THEN 'won'
            ELSE 'lost'
          END as result,
          CASE 
            WHEN m.winner = 'team1' THEN m.team1_name
            WHEN m.winner = 'team2' THEN m.team2_name
            WHEN m.winner = 'draw' THEN 'Ничья'
            ELSE NULL
          END as actual_result
        FROM bets b
        JOIN matches m ON b.match_id = m.id
        LEFT JOIN score_predictions sp ON sp.user_id = b.user_id AND sp.match_id = b.match_id
        LEFT JOIN match_scores ms ON ms.match_id = b.match_id
        LEFT JOIN cards_predictions cp ON cp.user_id = b.user_id AND cp.match_id = b.match_id
        WHERE m.event_id = ? AND b.user_id = ? AND b.is_final_bet = 0
        ORDER BY m.id ASC
      `
      )
      .all(eventId, userId);

    // Получаем финальные ставки участника в матчах этого события
    const finalBets = db
      .prepare(
        `
        SELECT 
          b.id,
          b.prediction,
          m.team1_name as team1,
          m.team2_name as team2,
          m.winner,
          m.round as round,
          m.match_date,
          1 as is_final_bet,
          b.parameter_type,
          CASE 
            WHEN b.parameter_type = 'yellow_cards' THEN 'Жёлтые карточки: ' || b.prediction
            WHEN b.parameter_type = 'red_cards' THEN 'Красные карточки: ' || b.prediction
            WHEN b.parameter_type = 'corners' THEN 'Угловые: ' || b.prediction
            WHEN b.parameter_type = 'exact_score' THEN 'Точный счёт: ' || b.prediction
            WHEN b.parameter_type = 'penalties_in_game' THEN 'Пенальти в матче: ' || b.prediction
            WHEN b.parameter_type = 'extra_time' THEN 'Доп. время: ' || b.prediction
            WHEN b.parameter_type = 'penalties_at_end' THEN 'Пенальти в конце: ' || b.prediction
            ELSE b.prediction
          END as prediction_display,
          CASE 
            WHEN fpr.id IS NULL THEN 'pending'
            WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 'won'
            WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 'won'
            WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 'won'
            WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 'won'
            WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 'won'
            WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 'won'
            WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 'won'
            ELSE 'lost'
          END as result,
          CASE 
            WHEN b.parameter_type = 'yellow_cards' THEN 'Жёлтых: ' || COALESCE(fpr.yellow_cards, '?')
            WHEN b.parameter_type = 'red_cards' THEN 'Красных: ' || COALESCE(fpr.red_cards, '?')
            WHEN b.parameter_type = 'corners' THEN 'Угловых: ' || COALESCE(fpr.corners, '?')
            WHEN b.parameter_type = 'exact_score' THEN 'Счёт: ' || COALESCE(fpr.exact_score, '?')
            WHEN b.parameter_type = 'penalties_in_game' THEN COALESCE(fpr.penalties_in_game, '?')
            WHEN b.parameter_type = 'extra_time' THEN COALESCE(fpr.extra_time, '?')
            WHEN b.parameter_type = 'penalties_at_end' THEN COALESCE(fpr.penalties_at_end, '?')
            ELSE NULL
          END as actual_result
        FROM bets b
        JOIN matches m ON b.match_id = m.id
        LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id
        WHERE m.event_id = ? AND b.user_id = ? AND b.is_final_bet = 1
        ORDER BY m.id ASC
      `
      )
      .all(eventId, userId);

    // Объединяем обе таблицы
    let allBets = [...bets, ...finalBets];

    // Если show_bets = 'after_start' и не владелец, помечаем скрытые ставки
    if (showBets === 'after_start' && !isOwner) {
      const now = new Date();
      allBets = allBets.map(bet => {
        if (!bet.match_date) {
          return { ...bet, is_hidden: true };
        }
        const matchDate = new Date(bet.match_date);
        if (matchDate > now) {
          return { ...bet, is_hidden: true };
        }
        return { ...bet, is_hidden: false };
      });
    } else {
      allBets = allBets.map(bet => ({ ...bet, is_hidden: false }));
    }

    res.json({
      rounds: rounds.length > 0 ? rounds : [],
      bets: allBets,
      show_bets: showBets,
      event_name: event?.name || 'Турнир',
      completed_rounds: completedRounds,
    });
  } catch (error) {
    console.error(
      "Ошибка в /api/event/:eventId/participant/:userId/bets:",
      error
    );
    res.status(500).json({ error: error.message });
  }
});

// 5. Получить или создать пользователя
app.post("/api/user", async (req, res) => {
  try {
    const { username } = req.body;

    // Проверяем, существует ли пользователь
    let user = db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username);

    if (!user) {
      // Получаем IP адрес
      const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
      
      // Создаем нового пользователя
      const result = db
        .prepare("INSERT INTO users (username) VALUES (?)")
        .run(username);
      user = { id: result.lastInsertRowid, username };
      
      // Проверяем, были ли другие пользователи с этого IP
      const otherUsers = db.prepare(`
        SELECT DISTINCT u.username 
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.ip_address = ? AND u.id != ?
        ORDER BY s.created_at DESC
        LIMIT 5
      `).all(ip_address, user.id);

      const time = new Date().toLocaleString("ru-RU");
      
      let message = `👤 НОВЫЙ ПОЛЬЗОВАТЕЛЬ

🆔 ID: ${user.id}
👤 Имя: ${username}
🌍 IP: ${ip_address}
🕐 Время: ${time}`;

      if (otherUsers.length > 0) {
        message += `\n\n⚠️ С этого IP уже заходили:`;
        otherUsers.forEach(u => {
          message += `\n  • ${u.username}`;
        });
      }

      // Отправляем уведомление админу
      notifyAdmin(message).catch(err => {
        console.error("⚠️ Не удалось отправить уведомление о новом пользователе:", err);
      });

      res.json(user);
    } else {
      // Пользователь существует - проверяем, нужна ли 2FA
      // Проверяем: есть ли telegram_id И включена ли настройка require_login_2fa
      if (user.telegram_id && user.require_login_2fa !== 0) {
        // Проверяем, было ли это устройство доверенным ранее
        const { device_info, browser, os } = req.body;
        const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
        
        console.log("🔍 Проверка доверенного устройства:");
        console.log("  User ID:", user.id);
        console.log("  Device:", device_info);
        console.log("  Browser:", browser);
        console.log("  OS:", os);
        console.log("  IP:", ip_address);
        
        // Ищем любую доверенную сессию с этого устройства (даже старую)
        const wasTrusted = db.prepare(`
          SELECT id FROM sessions 
          WHERE user_id = ? AND device_info = ? AND browser = ? AND os = ? 
          AND ip_address = ? AND is_trusted = 1
          ORDER BY created_at DESC LIMIT 1
        `).get(user.id, device_info, browser, os, ip_address);

        console.log("  Найдена доверенная сессия:", wasTrusted ? "ДА" : "НЕТ");

        if (wasTrusted) {
          // Устройство было доверенным, пропускаем 2FA
          console.log("✅ Устройство доверенное, пропускаем 2FA");
          res.json(user);
        } else {
          // Требуется подтверждение через Telegram
          console.log("⚠️ Требуется 2FA");
          res.json({ 
            requiresConfirmation: true, 
            userId: user.id,
            username: user.username 
          });
        }
      } else {
        // 2FA не настроена или отключена, возвращаем пользователя
        res.json(user);
      }
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/login/request - Запросить код для входа
app.post("/api/user/login/request", async (req, res) => {
  try {
    const { userId } = req.body;

    const user = db
      .prepare("SELECT id, username, telegram_id, telegram_username FROM users WHERE id = ?")
      .get(userId);
    
    if (!user || !user.telegram_id) {
      return res.status(404).json({ error: "Пользователь не найден или Telegram не привязан" });
    }

    // Генерируем 6-значный код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Сохраняем код с временем истечения (5 минут)
    confirmationCodes.set(`login_${userId}`, {
      code,
      expires: Date.now() + 5 * 60 * 1000
    });

    // Отправляем код в Telegram через chat_id
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (TELEGRAM_BOT_TOKEN) {
      const message = `🔐 КОД ПОДТВЕРЖДЕНИЯ ВХОДА

<code>${code}</code> - это ваш код подтверждения:

Попытка входа в аккаунт на сайте 1xBetLineBoom.

👤 Аккаунт: ${user.username}

Код действителен 5 минут.

Если это были не вы, проигнорируйте это сообщение и смените пароль.`;

      try {
        await sendUserMessage(user.telegram_id, message);
        res.json({ success: true, message: "Код отправлен в Telegram" });
      } catch (err) {
        console.error("❌ Ошибка отправки кода:", err);
        res.status(500).json({ error: "Не удалось отправить код в Telegram" });
      }
    } else {
      res.status(500).json({ error: "Telegram бот не настроен" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/login/confirm - Подтвердить вход
app.post("/api/user/login/confirm", async (req, res) => {
  try {
    const { userId, confirmation_code } = req.body;

    const stored = confirmationCodes.get(`login_${userId}`);
    
    if (!stored) {
      return res.status(400).json({ error: "Код не найден. Запросите новый код." });
    }

    if (Date.now() > stored.expires) {
      confirmationCodes.delete(`login_${userId}`);
      return res.status(400).json({ error: "Код истек. Запросите новый код." });
    }

    if (stored.code !== confirmation_code) {
      return res.status(400).json({ error: "Неверный код подтверждения" });
    }

    // Код верный, возвращаем пользователя
    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Удаляем использованный код
    confirmationCodes.delete(`login_${userId}`);

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Хранилище токенов авторизации через Telegram (в памяти)
const telegramAuthTokens = new Map();

// POST /api/telegram-auth/create-token - Создать токен для авторизации через Telegram
app.post("/api/telegram-auth/create-token", async (req, res) => {
  try {
    const { auth_token, device_info, browser, os } = req.body;
    
    if (!auth_token) {
      return res.status(400).json({ error: "Токен обязателен" });
    }

    // Сохраняем токен с временем истечения (5 минут)
    telegramAuthTokens.set(auth_token, {
      status: 'pending',
      device_info,
      browser,
      os,
      created_at: Date.now(),
      expires_at: Date.now() + 5 * 60 * 1000 // 5 минут
    });

    // Получаем имя бота из переменных окружения
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'YourBotUsername';

    res.json({ 
      success: true,
      botUsername
    });
  } catch (error) {
    console.error("Ошибка создания токена:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/telegram-auth/check-status - Проверить статус авторизации
app.get("/api/telegram-auth/check-status", async (req, res) => {
  try {
    const { auth_token } = req.query;
    
    if (!auth_token) {
      return res.status(400).json({ error: "Токен обязателен" });
    }

    const tokenData = telegramAuthTokens.get(auth_token);
    
    if (!tokenData) {
      return res.json({ status: 'not_found' });
    }

    // Проверяем истечение токена
    if (Date.now() > tokenData.expires_at) {
      telegramAuthTokens.delete(auth_token);
      return res.json({ status: 'expired' });
    }

    if (tokenData.status === 'completed') {
      // Возвращаем данные пользователя
      res.json({
        status: 'completed',
        user: tokenData.user,
        isNewUser: tokenData.isNewUser
      });
      
      // Удаляем токен после успешной авторизации
      telegramAuthTokens.delete(auth_token);
    } else {
      res.json({ status: 'pending' });
    }
  } catch (error) {
    console.error("Ошибка проверки статуса:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/telegram-auth/complete - Завершить авторизацию (вызывается ботом)
app.post("/api/telegram-auth/complete", async (req, res) => {
  try {
    let { auth_token, telegram_id, first_name, username: tg_username } = req.body;
    
    // Приводим telegram username к нижнему регистру
    if (tg_username) {
      tg_username = tg_username.toLowerCase();
    }
    
    if (!auth_token || !telegram_id) {
      return res.status(400).json({ error: "Токен и Telegram ID обязательны" });
    }

    const tokenData = telegramAuthTokens.get(auth_token);
    
    if (!tokenData) {
      return res.status(404).json({ error: "Токен не найден" });
    }

    // Проверяем истечение токена
    if (Date.now() > tokenData.expires_at) {
      telegramAuthTokens.delete(auth_token);
      return res.status(400).json({ error: "Токен истек" });
    }

    // Проверяем, существует ли пользователь с таким telegram_id
    let user = db
      .prepare("SELECT * FROM users WHERE telegram_id = ?")
      .get(telegram_id);

    const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
    const isNewUser = !user;

    if (!user) {
      // Генерируем уникальное имя "Малютка{число}"
      let username;
      let attempts = 0;
      const maxAttempts = 100;
      
      do {
        const randomNum = Math.floor(Math.random() * 10000);
        username = `Малютка${randomNum}`;
        const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
        if (!existing) break;
        attempts++;
      } while (attempts < maxAttempts);

      if (attempts >= maxAttempts) {
        return res.status(500).json({ error: "Не удалось сгенерировать уникальное имя" });
      }

      // Создаем нового пользователя
      const result = db
        .prepare("INSERT INTO users (username, telegram_id, telegram_username) VALUES (?, ?, ?)")
        .run(username, telegram_id, tg_username || null);
      
      user = { 
        id: result.lastInsertRowid, 
        username,
        telegram_id,
        telegram_username: tg_username || null
      };

      // Проверяем, были ли другие пользователи с этого IP
      const otherUsers = db.prepare(`
        SELECT DISTINCT u.username 
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.ip_address = ? AND u.id != ?
        ORDER BY s.created_at DESC
        LIMIT 5
      `).all(ip_address, user.id);

      const time = new Date().toLocaleString("ru-RU");
      
      let message = `👤 НОВЫЙ ПОЛЬЗОВАТЕЛЬ (Telegram)

🆔 ID: ${user.id}
👤 Имя: ${username}
📱 Telegram: ${first_name || 'N/A'} ${tg_username ? `(@${tg_username})` : ''}
🔑 TG ID: ${telegram_id}
🌍 IP: ${ip_address}
🕐 Время: ${time}`;

      if (otherUsers.length > 0) {
        message += `\n\n⚠️ С этого IP уже заходили:`;
        otherUsers.forEach(u => {
          message += `\n  • ${u.username}`;
        });
      }

      // Отправляем уведомление админу
      notifyAdmin(message).catch(err => {
        console.error("⚠️ Не удалось отправить уведомление о новом пользователе:", err);
      });
    }

    // Обновляем токен с данными пользователя
    tokenData.status = 'completed';
    tokenData.user = user;
    tokenData.isNewUser = isNewUser;
    telegramAuthTokens.set(auth_token, tokenData);

    res.json({ 
      success: true,
      user,
      isNewUser
    });
  } catch (error) {
    console.error("Ошибка завершения авторизации:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/telegram-auth - Авторизация через Telegram
app.post("/api/user/telegram-auth", async (req, res) => {
  try {
    let { telegram_id, first_name, username: tg_username } = req.body;
    
    // Приводим telegram username к нижнему регистру
    if (tg_username) {
      tg_username = tg_username.toLowerCase();
    }
    
    if (!telegram_id) {
      return res.status(400).json({ error: "Telegram ID обязателен" });
    }

    // Проверяем, существует ли пользователь с таким telegram_id
    let user = db
      .prepare("SELECT * FROM users WHERE telegram_id = ?")
      .get(telegram_id);

    const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
    const isNewUser = !user;

    if (!user) {
      // Генерируем уникальное имя "Малютка{число}"
      let username;
      let attempts = 0;
      const maxAttempts = 100;
      
      do {
        const randomNum = Math.floor(Math.random() * 10000);
        username = `Малютка${randomNum}`;
        const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
        if (!existing) break;
        attempts++;
      } while (attempts < maxAttempts);

      if (attempts >= maxAttempts) {
        return res.status(500).json({ error: "Не удалось сгенерировать уникальное имя" });
      }

      // Создаем нового пользователя
      const result = db
        .prepare("INSERT INTO users (username, telegram_id, telegram_username) VALUES (?, ?, ?)")
        .run(username, telegram_id, tg_username || null);
      
      user = { 
        id: result.lastInsertRowid, 
        username,
        telegram_id,
        telegram_username: tg_username || null
      };

      // Проверяем, были ли другие пользователи с этого IP
      const otherUsers = db.prepare(`
        SELECT DISTINCT u.username 
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.ip_address = ? AND u.id != ?
        ORDER BY s.created_at DESC
        LIMIT 5
      `).all(ip_address, user.id);

      const time = new Date().toLocaleString("ru-RU");
      
      let message = `👤 НОВЫЙ ПОЛЬЗОВАТЕЛЬ (Telegram)

🆔 ID: ${user.id}
👤 Имя: ${username}
📱 Telegram: ${first_name || 'N/A'} ${tg_username ? `(@${tg_username})` : ''}
🔑 TG ID: ${telegram_id}
🌍 IP: ${ip_address}
🕐 Время: ${time}`;

      if (otherUsers.length > 0) {
        message += `\n\n⚠️ С этого IP уже заходили:`;
        otherUsers.forEach(u => {
          message += `\n  • ${u.username}`;
        });
      }

      // Отправляем уведомление админу
      notifyAdmin(message).catch(err => {
        console.error("⚠️ Не удалось отправить уведомление о новом пользователе:", err);
      });
    }

    res.json({ 
      user,
      isNewUser
    });
  } catch (error) {
    console.error("Ошибка Telegram авторизации:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.1 Получить всех пользователей
app.get("/api/users", (req, res) => {
  try {
    const users = db
      .prepare("SELECT id, username, telegram_username, telegram_notifications_enabled FROM users ORDER BY username ASC")
      .all();
    res.json(users);
  } catch (error) {
    console.error("Ошибка при получении пользователей:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.1.1 Получить детали пользователя (для админа)
app.get("/api/admin/user-details/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = db
      .prepare("SELECT id, username, telegram_username, telegram_notifications_enabled FROM users WHERE id = ?")
      .get(userId);
    
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    
    // Получаем информацию из telegram_users
    let telegramUser = null;
    if (user.telegram_username) {
      telegramUser = db
        .prepare("SELECT chat_id, first_name FROM telegram_users WHERE telegram_username = ?")
        .get(user.telegram_username);
    }
    
    res.json({
      user,
      telegramUser
    });
  } catch (error) {
    console.error("Ошибка при получении деталей пользователя:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.1.2 Получить глобальную статистику пользователя (за все турниры)
app.get("/api/users/:userId/global-stats", (req, res) => {
  try {
    const { userId } = req.params;
    
    // Получаем информацию о пользователе
    const user = db.prepare("SELECT id, username, avatar, created_at FROM users WHERE id = ?").get(userId);
    
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    
    // Получаем полную статистику ставок (как в профиле)
    const bets = db.prepare(`
      SELECT 
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 1
          ELSE 0
        END) as total_bets,
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN
                       -- Базовое очко за угаданный результат (3 за финал, 1 за обычный матч)
                       CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
                       -- Дополнительное очко за угаданный счет
                       CASE 
                         WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                              ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                              sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
                         THEN 1 
                         ELSE 0 
                       END
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_bets,
        -- Количество угаданных ставок (для процента побед)
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_count,
        SUM(CASE 
          WHEN (m.winner IS NOT NULL OR fpr.id IS NOT NULL) THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN NOT ((b.prediction = 'team1' AND m.winner = 'team1') OR
                            (b.prediction = 'team2' AND m.winner = 'team2') OR
                            (b.prediction = 'draw' AND m.winner = 'draw') OR
                            (b.prediction = m.team1_name AND m.winner = 'team1') OR
                            (b.prediction = m.team2_name AND m.winner = 'team2')) THEN 1 
                  ELSE 0 
                END
              -- Финальные параметры
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) != fpr.yellow_cards THEN 2
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) != fpr.red_cards THEN 2
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) != fpr.corners THEN 2
                  WHEN b.parameter_type = 'exact_score' AND b.prediction != fpr.exact_score THEN 2
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction != fpr.penalties_in_game THEN 2
                  WHEN b.parameter_type = 'extra_time' AND b.prediction != fpr.extra_time THEN 2
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction != fpr.penalties_at_end THEN 2
                  ELSE 0
                END
              ELSE 0 
            END 
          ELSE 0 
        END) as lost_bets,
        SUM(CASE 
          WHEN (b.is_final_bet = 0 AND m.winner IS NULL) OR 
               (b.is_final_bet = 1 AND fpr.id IS NULL) THEN 1 
          ELSE 0 
        END) as pending_bets,
        COUNT(DISTINCT m.event_id) as tournaments_count
      FROM bets b
      LEFT JOIN matches m ON b.match_id = m.id
      LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN match_scores ms ON b.match_id = ms.match_id
      WHERE b.user_id = ?
    `).get(userId);
    
    // Подсчитываем количество побед в турнирах (1-е места)
    const tournamentWins = db.prepare(`
      SELECT COUNT(*) as count
      FROM tournament_awards
      WHERE user_id = ?
    `).get(userId);
    
    // Получаем награды
    const awards = db.prepare(`
      SELECT ta.id, ta.event_name, ta.won_bets, ta.awarded_at, e.icon as event_icon
      FROM tournament_awards ta
      LEFT JOIN events e ON ta.event_id = e.id
      WHERE ta.user_id = ?
      ORDER BY ta.awarded_at DESC
    `).all(userId);
    
    // Подсчитываем статистику по сетке плей-офф
    const bracketStats = db.prepare(`
      SELECT 
        COUNT(*) as total_bracket_predictions,
        SUM(CASE WHEN bp.predicted_winner = br.actual_winner THEN 1 ELSE 0 END) as correct_bracket_predictions,
        SUM(CASE WHEN bp.predicted_winner != br.actual_winner THEN 1 ELSE 0 END) as incorrect_bracket_predictions
      FROM bracket_predictions bp
      LEFT JOIN bracket_results br ON bp.bracket_id = br.bracket_id 
        AND bp.stage = br.stage 
        AND bp.match_index = br.match_index
      WHERE bp.user_id = ? AND br.actual_winner IS NOT NULL
    `).get(userId);
    
    const stats = {
      total_bets: bets.total_bets || 0,
      won_bets: bets.won_bets || 0,
      won_count: bets.won_count || 0,
      lost_bets: bets.lost_bets || 0,
      pending_bets: bets.pending_bets || 0,
      tournaments_count: bets.tournaments_count || 0,
      tournament_wins: tournamentWins?.count || 0,
      win_accuracy: bets.total_bets > 0 ? Math.round((bets.won_count / bets.total_bets) * 100) : 0,
      bracket_correct: bracketStats?.correct_bracket_predictions || 0,
      bracket_incorrect: bracketStats?.incorrect_bracket_predictions || 0
    };
    
    res.json({
      user,
      stats,
      awards: awards || []
    });
  } catch (error) {
    console.error("Ошибка при получении глобальной статистики:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.2 Получить всех модераторов
app.get("/api/moderators", (req, res) => {
  try {
    const moderators = db
      .prepare(
        `
      SELECT m.id, u.id as user_id, u.username, m.permissions
      FROM moderators m
      JOIN users u ON m.user_id = u.id
      ORDER BY u.username ASC
    `
      )
      .all();

    // Парсим JSON-массив разрешений
    const result = moderators.map((mod) => ({
      ...mod,
      permissions: JSON.parse(mod.permissions || "[]"),
    }));

    res.json(result);
  } catch (error) {
    console.error("Ошибка при получении модераторов:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.3 Назначить нового модератора
app.post("/api/moderators", async (req, res) => {
  try {
    const { user_id, permissions } = req.body;

    if (!user_id || !Array.isArray(permissions)) {
      return res.status(400).json({ error: "Неверные параметры" });
    }

    // Проверяем существует ли пользователь
    const user = db.prepare("SELECT id, username, telegram_username FROM users WHERE id = ?").get(user_id);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    console.log(`📋 Назначение модератора: user_id=${user_id}, username=${user.username}, telegram_username=${user.telegram_username}`);

    // Проверяем, что пользователь связал профиль с ботом
    if (!user.telegram_username) {
      return res.status(400).json({ error: "Пользователь не привязал Telegram к профилю" });
    }

    // Проверяем, что пользователь писал боту (есть в telegram_users)
    const telegramUser = db.prepare(
      "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = LOWER(?)"
    ).get(user.telegram_username);

    if (!telegramUser) {
      return res.status(400).json({ error: "Пользователь не писал боту. Попросите его написать боту /start" });
    }

    // Проверяем, не является ли уже модератором
    const existingMod = db
      .prepare("SELECT id FROM moderators WHERE user_id = ?")
      .get(user_id);

    if (existingMod) {
      return res.status(400).json({ error: "Пользователь уже модератор" });
    }

    // Добавляем модератора
    const result = db
      .prepare("INSERT INTO moderators (user_id, permissions) VALUES (?, ?)")
      .run(user_id, JSON.stringify(permissions));

    console.log(`✅ Модератор добавлен в БД`);

    // Отправляем уведомление пользователю в Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    const permissionsText = permissions.map(p => {
      const permMap = {
        'manage_matches': '⚽ Управление матчами',
        'create_matches': '➕ Создание матчей',
        'edit_matches': '✏️ Редактирование матчей',
        'delete_matches': '🗑️ Удаление матчей',
        'manage_results': '📊 Управление результатами',
        'manage_tournaments': '🎯 Управление турнирами',
        'edit_tournaments': '✏️ Редактирование турниров',
        'delete_tournaments': '🗑️ Удаление турниров',
        'create_tournaments': '➕ Создание турниров',
        'view_logs': '📋 Просмотр логов',
        'view_counting': '📊 Подсчет результатов',
        'manage_db': '💾 Управление базой данных',
        'backup_db': '➕ Создание бэкапов',
        'download_backup': '💾 Скачивание бэкапов',
        'restore_db': '📥 Восстановление БД',
        'delete_backup': '🗑️ Удаление бэкапов',
        'manage_orphaned': '🗑️ Управление orphaned данными',
        'view_users': '👥 Просмотр пользователей',
        'check_bot': '🤖 Проверка контакта с ботом',
        'view_settings': '⚙️ Просмотр настроек пользователей',
        'sync_telegram_ids': '🔄 Синхронизация Telegram ID',
        'edit_users': '✏️ Редактирование пользователей',
        'delete_users': '❌ Удаление пользователей'
      };
      return permMap[p] || p;
    }).join('\n');

    const message = `🛡️ Вы назначены модераптором 1xBetLineBoom!

Ваши права:
${permissionsText}`;

    console.log(`📤 Отправляю уведомление модератору...`);

    try {
      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramUser.chat_id,
          text: message,
          parse_mode: "HTML"
        })
      });
      
      const responseData = await response.json();
      
      if (responseData.ok) {
        console.log(`✅ Уведомление о назначении модератором отправлено пользователю ${user.username}`);
      } else {
        console.error(`❌ Telegram API вернул ошибку:`, responseData);
      }
    } catch (error) {
      console.error(`❌ Ошибка отправки уведомления модератору ${user.username}:`, error);
    }

    // Записываем в лог
    writeBetLog("moderator_assigned", {
      username: user.username,
      permissions: permissionsText,
    });

    res.json({
      success: true,
      message: "Модератор успешно назначен",
      id: result.lastInsertRowid,
    });
  } catch (error) {
    console.error("Ошибка при назначении модератора:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.4 Удалить модератора
app.delete("/api/moderators/:moderatorId", (req, res) => {
  try {
    const { moderatorId } = req.params;

    // Получаем информацию о модераторе перед удалением
    const moderator = db.prepare(`
      SELECT m.id, m.permissions, u.username
      FROM moderators m
      JOIN users u ON m.user_id = u.id
      WHERE m.id = ?
    `).get(moderatorId);

    if (!moderator) {
      return res.status(404).json({ error: "Модератор не найден" });
    }

    const result = db
      .prepare("DELETE FROM moderators WHERE id = ?")
      .run(moderatorId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Модератор не найден" });
    }

    // Записываем в лог
    writeBetLog("moderator_removed", {
      username: moderator.username,
    });

    res.json({
      success: true,
      message: "Модератор удален",
    });
  } catch (error) {
    console.error("Ошибка при удалении модератора:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.5 Обновить разрешения модератора
app.put("/api/moderators/:moderatorId/permissions", async (req, res) => {
  try {
    const { moderatorId } = req.params;
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: "Разрешения должны быть массивом" });
    }

    // Получаем информацию о модераторе
    const moderator = db.prepare(`
      SELECT m.id, m.user_id, m.permissions, u.username, u.telegram_username
      FROM moderators m
      JOIN users u ON m.user_id = u.id
      WHERE m.id = ?
    `).get(moderatorId);

    if (!moderator) {
      return res.status(404).json({ error: "Модератор не найден" });
    }

    // Получаем старые права для сравнения
    const oldPermissions = JSON.parse(moderator.permissions || "[]");

    const result = db
      .prepare("UPDATE moderators SET permissions = ? WHERE id = ?")
      .run(JSON.stringify(permissions), moderatorId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Модератор не найден" });
    }

    // Определяем добавленные и удаленные права
    const addedPermissions = permissions.filter(p => !oldPermissions.includes(p));
    const removedPermissions = oldPermissions.filter(p => !permissions.includes(p));

    // Функция для форматирования прав
    const formatPermissions = (perms) => {
      const permMap = {
        'manage_matches': '⚽ Управление матчами',
        'create_matches': '➕ Создание матчей',
        'edit_matches': '✏️ Редактирование матчей',
        'delete_matches': '🗑️ Удаление матчей',
        'manage_results': '📊 Управление результатами',
        'manage_tournaments': '🎯 Управление турнирами',
        'edit_tournaments': '✏️ Редактирование турниров',
        'delete_tournaments': '🗑️ Удаление турниров',
        'create_tournaments': '➕ Создание турниров',
        'view_logs': '📋 Просмотр логов',
        'view_counting': '📊 Подсчет результатов',
        'manage_db': '💾 Управление базой данных',
        'backup_db': '➕ Создание бэкапов',
        'download_backup': '💾 Скачивание бэкапов',
        'restore_db': '📥 Восстановление БД',
        'delete_backup': '🗑️ Удаление бэкапов',
        'manage_orphaned': '🗑️ Управление orphaned данными',
        'view_users': '👥 Просмотр пользователей',
        'check_bot': '🤖 Проверка контакта с ботом',
        'view_settings': '⚙️ Просмотр настроек пользователей',
        'sync_telegram_ids': '🔄 Синхронизация Telegram ID',
        'edit_users': '✏️ Редактирование пользователей',
        'delete_users': '❌ Удаление пользователей'
      };
      return perms.map(p => permMap[p] || p).join('\n');
    };

    // Записываем в лог если были изменения
    if (addedPermissions.length > 0 || removedPermissions.length > 0) {
      writeBetLog("moderator_permissions_changed", {
        username: moderator.username,
        added: addedPermissions.length > 0 ? formatPermissions(addedPermissions) : null,
        removed: removedPermissions.length > 0 ? formatPermissions(removedPermissions) : null,
      });
    }

    // Отправляем уведомление модератору о изменении прав
    if (moderator.telegram_username && permissions.length > 0) {
      const telegramUser = db.prepare(
        "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = LOWER(?)"
      ).get(moderator.telegram_username);

      if (telegramUser) {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        
        const permissionsText = permissions.map(p => {
          const permMap = {
            'manage_matches': '⚽ Управление матчами',
            'create_matches': '➕ Создание матчей',
            'edit_matches': '✏️ Редактирование матчей',
            'delete_matches': '🗑️ Удаление матчей',
            'manage_results': '📊 Управление результатами',
            'manage_tournaments': '🎯 Управление турнирами',
            'edit_tournaments': '✏️ Редактирование турниров',
            'delete_tournaments': '🗑️ Удаление турниров',
            'create_tournaments': '➕ Создание турниров',
            'view_logs': '📋 Просмотр логов',
            'view_counting': '📊 Подсчет результатов',
            'manage_db': '💾 Управление базой данных',
            'backup_db': '➕ Создание бэкапов',
            'download_backup': '💾 Скачивание бэкапов',
            'restore_db': '📥 Восстановление БД',
            'delete_backup': '🗑️ Удаление бэкапов',
            'manage_orphaned': '🗑️ Управление orphaned данными',
            'view_users': '👥 Просмотр пользователей',
            'check_bot': '🤖 Проверка контакта с ботом',
            'view_settings': '⚙️ Просмотр настроек пользователей',
            'sync_telegram_ids': '🔄 Синхронизация Telegram ID',
            'edit_users': '✏️ Редактирование пользователей',
            'delete_users': '❌ Удаление пользователей'
          };
          return permMap[p] || p;
        }).join('\n');

        const message = `🔄 Ваши права модератора обновлены!

Текущие права:
${permissionsText}`;

        try {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: telegramUser.chat_id,
              text: message,
              parse_mode: "HTML"
            })
          });
          console.log(`✅ Уведомление об обновлении прав отправлено модератору ${moderator.username}`);
        } catch (error) {
          console.error(`❌ Ошибка отправки уведомления модератору ${moderator.username}:`, error);
        }
      }
    }

    res.json({
      success: true,
      message: "Разрешения обновлены",
    });
  } catch (error) {
    console.error("Ошибка при обновлении разрешений:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========== УПРАВЛЕНИЕ НАГРАДАМИ ==========

// 5.6 Получить все награды пользователя
app.get("/api/user/:userId/custom-awards", (req, res) => {
  try {
    const { userId } = req.params;

    const awards = db
      .prepare(
        `
      SELECT ua.id, ua.user_id, ua.event_id, e.name as event_name, 
             ua.award_type, ua.description, ua.created_at
      FROM user_awards ua
      LEFT JOIN events e ON ua.event_id = e.id
      WHERE ua.user_id = ?
      ORDER BY ua.created_at DESC
    `
      )
      .all(userId);

    res.json(awards);
  } catch (error) {
    console.error("Ошибка при получении наград пользователя:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.7 Получить все награды (для админ-панели)
app.get("/api/awards", (req, res) => {
  try {
    const awards = db
      .prepare(
        `
      SELECT ua.id, ua.user_id, u.username, ua.event_id, e.name as event_name,
             ua.award_type, ua.description, ua.image_url, ua.background_opacity,
             ua.award_color, ua.award_emoji, ua.created_at
      FROM user_awards ua
      JOIN users u ON ua.user_id = u.id
      LEFT JOIN events e ON ua.event_id = e.id
      ORDER BY ua.created_at DESC
    `
      )
      .all();

    res.json(awards);
  } catch (error) {
    console.error("Ошибка при получении наград:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.8 Выдать новую награду
app.post("/api/awards", (req, res) => {
  try {
    let {
      user_id,
      event_id,
      award_type,
      description,
      image_url,
      background_opacity,
      award_color,
      award_emoji,
    } = req.body;

    // Преобразуем в числа
    user_id = user_id ? parseInt(user_id, 10) : null;
    event_id = event_id ? parseInt(event_id, 10) : null;

    // Проверяем валидность ID
    if (!user_id || isNaN(user_id)) {
      return res
        .status(400)
        .json({ error: "user_id обязателен и должен быть числом" });
    }

    if (!award_type || typeof award_type !== "string") {
      return res
        .status(400)
        .json({ error: "award_type обязателен и должен быть строкой" });
    }

    // Проверяем существует ли пользователь
    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(user_id);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Если указан event_id, проверяем существует ли событие
    if (event_id && !isNaN(event_id)) {
      const event = db
        .prepare("SELECT id FROM events WHERE id = ?")
        .get(event_id);

      if (!event) {
        return res.status(404).json({ error: "Турнир не найден" });
      }
    } else {
      event_id = null;
    }

    // Валидируем прозрачность
    const opacity =
      background_opacity !== undefined ? parseFloat(background_opacity) : 1;
    if (opacity < 0 || opacity > 1) {
      return res
        .status(400)
        .json({ error: "Прозрачность должна быть от 0 до 1" });
    }

    // Валидируем цвет (должен быть hex формат или пустой)
    const color = award_color || "#fbc02d";
    if (!color.match(/^#[0-9A-F]{6}$/i)) {
      return res
        .status(400)
        .json({ error: "Цвет должен быть в формате #RRGGBB" });
    }

    // Валидируем эмодзи (не более 2 символов)
    const emoji = award_emoji || "🏆";
    if (emoji.length > 2) {
      return res
        .status(400)
        .json({ error: "Эмодзи не может быть длиннее 2 символов" });
    }

    // Добавляем награду
    const result = db
      .prepare(
        "INSERT INTO user_awards (user_id, event_id, award_type, description, image_url, background_opacity, award_color, award_emoji) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        user_id,
        event_id || null,
        award_type,
        description || null,
        image_url || null,
        opacity,
        color,
        emoji
      );

    console.log(`✓ Награда выдана пользователю ${user_id}: ${award_type}`);

    // Создаём автоматическую новость о награде
    try {
      const awardUser = db.prepare("SELECT username FROM users WHERE id = ?").get(user_id);
      const eventInfo = event_id ? db.prepare("SELECT name FROM events WHERE id = ?").get(event_id) : null;
      
      const awardTypeNames = {
        'winner': 'Победитель турнира',
        'top3': 'Топ-3 турнира',
        'best_predictor': 'Лучший прогнозист',
        'lucky': 'Счастливчик',
        'milestone': 'Достижение',
        'special': 'Особая награда',
        'custom': 'Награда'
      };
      
      const awardName = awardTypeNames[award_type] || 'Награда';
      
      let newsTitle = `🏆 ${awardUser.username} получил награду!`;
      let newsMessage = `${emoji} ${awardName}`;
      
      if (eventInfo) {
        newsMessage += `\n🏆 Турнир: ${eventInfo.name}`;
      }
      
      if (description) {
        newsMessage += `\n📝 ${description}`;
      }
      
      db.prepare(`
        INSERT INTO news (type, title, message, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('achievement', newsTitle, newsMessage);
      
      console.log(`✓ Создана новость о награде для ${awardUser.username}`);
    } catch (newsError) {
      console.error("⚠️ Ошибка создания новости о награде:", newsError);
      // Не прерываем выполнение, награда уже выдана
    }

    res.json({
      success: true,
      message: "Награда успешно выдана",
      id: result.lastInsertRowid,
    });
  } catch (error) {
    console.error("Ошибка при выдачи награды:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.8 Получить данные награды
app.get("/api/awards/:awardId", (req, res) => {
  try {
    const { awardId } = req.params;

    const award = db
      .prepare("SELECT * FROM user_awards WHERE id = ?")
      .get(awardId);

    if (!award) {
      return res.status(404).json({ error: "Награда не найдена" });
    }

    res.json(award);
  } catch (error) {
    console.error("Ошибка при получении награды:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.8 Редактировать награду
app.put("/api/awards/:awardId", (req, res) => {
  try {
    const { awardId } = req.params;
    const {
      award_type,
      description,
      image_url,
      background_opacity,
      award_color,
      award_emoji,
    } = req.body;

    // Валидация
    if (!award_type) {
      return res.status(400).json({ error: "Тип награды не указан" });
    }

    const validTypes = ["participant", "winner", "best_result", "special"];
    if (!validTypes.includes(award_type)) {
      return res.status(400).json({ error: "Неверный тип награды" });
    }

    // Валидация прозрачности
    const opacity = background_opacity !== undefined ? background_opacity : 1;
    if (opacity < 0 || opacity > 1) {
      return res
        .status(400)
        .json({ error: "Прозрачность должна быть от 0 до 1" });
    }

    // Валидируем цвет (должен быть hex формат или пустой)
    const color = award_color || "#fbc02d";
    if (!color.match(/^#[0-9A-F]{6}$/i)) {
      return res
        .status(400)
        .json({ error: "Цвет должен быть в формате #RRGGBB" });
    }

    // Валидируем эмодзи (не более 2 символов)
    const emoji = award_emoji || "🏆";
    if (emoji.length > 2) {
      return res
        .status(400)
        .json({ error: "Эмодзи не может быть длиннее 2 символов" });
    }

    // Обновляем награду
    const result = db
      .prepare(
        "UPDATE user_awards SET award_type = ?, description = ?, image_url = ?, background_opacity = ?, award_color = ?, award_emoji = ? WHERE id = ?"
      )
      .run(
        award_type,
        description || null,
        image_url || null,
        opacity,
        color,
        emoji,
        awardId
      );

    if (result.changes === 0) {
      return res.status(404).json({ error: "Награда не найдена" });
    }

    console.log(`✓ Награда обновлена: ${awardId}`);

    res.json({
      success: true,
      message: "Награда успешно обновлена",
    });
  } catch (error) {
    console.error("Ошибка при обновлении награды:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.9 Удалить награду
app.delete("/api/awards/:awardId", (req, res) => {
  try {
    const { awardId } = req.params;

    const result = db
      .prepare("DELETE FROM user_awards WHERE id = ?")
      .run(awardId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Награда не найдена" });
    }

    console.log(`✓ Награда удалена: ${awardId}`);

    res.json({
      success: true,
      message: "Награда удалена",
    });
  } catch (error) {
    console.error("Ошибка при удалении награды:", error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Создать ставку
app.post("/api/bets", async (req, res) => {
  try {
    const {
      user_id,
      match_id,
      prediction,
      amount,
      is_final_bet,
      parameter_type,
    } = req.body;

    // Получаем информацию о пользователе и матче
    const user = db
      .prepare(
        "SELECT username, telegram_username, telegram_notifications_enabled FROM users WHERE id = ?"
      )
      .get(user_id);

    // Проверяем матч и его дату
    const match = db
      .prepare(
        "SELECT m.status, m.match_date, m.winner, m.team1_name, m.team2_name, m.event_id, m.is_final, m.round, e.name as event_name FROM matches m LEFT JOIN events e ON m.event_id = e.id WHERE m.id = ?"
      )
      .get(match_id);

    if (!match) {
      return res.status(404).json({ error: "Матч не найден" });
    }

    // Определяем эффективный статус на основе даты
    const now = new Date();
    const matchDate = match.match_date ? new Date(match.match_date) : null;

    // Если матч в прошлом (началась дата) - ставка невозможна
    if (matchDate && matchDate <= now && !match.winner) {
      // Матч начался, но нет результата - это ongoing
      // Отправляем уведомление админу
      await notifyIllegalBet(
        user?.username || "неизвестный",
        match.team1_name,
        match.team2_name,
        prediction,
        "ongoing"
      );
      return res
        .status(400)
        .json({ error: "Ну, куда ты, малютка, матч уже начался" });
    }

    // Если есть результат - матч завершён
    if (match.winner) {
      // Отправляем уведомление админу
      await notifyIllegalBet(
        user?.username || "неизвестный",
        match.team1_name,
        match.team2_name,
        prediction,
        "finished"
      );
      return res
        .status(400)
        .json({ error: "Ну, куда ты, малютка, матч уже начался" });
    }

    // Дополнительная проверка статуса из БД (если админ установил вручную)
    if (match.status && match.status !== "pending") {
      // Отправляем уведомление админу
      let statusText = match.status;
      await notifyIllegalBet(
        user?.username || "неизвестный",
        match.team1_name,
        match.team2_name,
        prediction,
        statusText
      );
      return res
        .status(400)
        .json({ error: "Ну, куда ты, малютка, матч уже начался" });
    }

    const result = db
      .prepare(
        `
      INSERT INTO bets (user_id, match_id, prediction, amount, is_final_bet, parameter_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        user_id,
        match_id,
        prediction,
        amount,
        is_final_bet ? 1 : 0,
        parameter_type || null
      );

    // Получаем прогноз на счет если есть
    let scorePrediction = null;
    if (!is_final_bet) {
      scorePrediction = db
        .prepare("SELECT score_team1, score_team2 FROM score_predictions WHERE user_id = ? AND match_id = ?")
        .get(user_id, match_id);
    }

    // Записываем лог ставки
    writeBetLog("placed", {
      username: user?.username || "неизвестный",
      prediction: prediction,
      team1: match.team1_name,
      team2: match.team2_name,
      eventName: match.event_name,
      is_final_bet: is_final_bet,
      parameter_type: parameter_type,
      is_final_match: match.is_final,
      round: match.round,
      score_team1: scorePrediction?.score_team1,
      score_team2: scorePrediction?.score_team2,
    });

    // Отправляем уведомление админу о новой ставке
    try {
      let predictionText = prediction === "draw" ? "Ничья" : prediction;
      
      // Если прогноз содержит название команды, используем его как есть
      // Если это "team1" или "team2", преобразуем в названия команд
      if (prediction === "team1" || prediction === match.team1_name) {
        predictionText = match.team1_name;
      } else if (prediction === "team2" || prediction === match.team2_name) {
        predictionText = match.team2_name;
      }
      
      await notifyNewBet(
        user?.username || "неизвестный",
        match.team1_name,
        match.team2_name,
        predictionText,
        match.event_name
      );
    } catch (err) {
      console.error("⚠️ Ошибка отправки уведомления админу:", err.message);
      // Не прерываем процесс создания ставки если ошибка в отправке уведомления
    }

    // Отправляем личное сообщение пользователю в Telegram если он привязал аккаунт и не отключил уведомления
    if (user?.telegram_username && user?.telegram_notifications_enabled !== 0) {
      try {
        const cleanUsername = user.telegram_username.toLowerCase();
        const tgUser = db
          .prepare(
            "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?"
          )
          .get(cleanUsername);

        if (tgUser?.chat_id) {
          let predictionText = prediction === "draw" ? "Ничья" : prediction;

          // Если прогноз содержит название команды, используем его как есть
          // Если это "team1" или "team2", преобразуем в названия команд
          if (prediction === "team1" || prediction === match.team1_name) {
            predictionText = match.team1_name;
          } else if (
            prediction === "team2" ||
            prediction === match.team2_name
          ) {
            predictionText = match.team2_name;
          }

          const betMessage =
            `💰 <b>НОВАЯ СТАВКА!</b>\n\n` +
            `⚽ <b>${match.team1_name}</b> vs <b>${match.team2_name}</b>\n` +
            `🎯 Прогноз: <b>${predictionText}</b>\n` +
            `🏆 Турнир: ${match.event_name || "Неизвестный"}\n` +
            `⏰ ${new Date().toLocaleString("ru-RU")}`;

          await sendUserMessage(tgUser.chat_id, betMessage);
        }
      } catch (err) {
        console.error(
          "⚠️ Ошибка отправки уведомления пользователю в Telegram:",
          err.message
        );
        // Не прерываем процесс создания ставки если ошибка в отправке уведомления
      }
    }

    // Проверяем milestone достижения по количеству ставок
    try {
      const totalBets = db.prepare("SELECT COUNT(*) as count FROM bets").get().count;
      const milestones = [200, 500, 800, 1000];
      
      // Проверяем достигнут ли новый milestone
      if (milestones.includes(totalBets)) {
        const newsTitle = `🎉 Достижение: ${totalBets} ставок!`;
        const newsMessage = `Платформа достигла ${totalBets} ставок!\n\nСпасибо всем игрокам за активное участие! 🎯\n\nПродолжайте делать прогнозы и соревнуйтесь за первые места! 🏆`;
        
        db.prepare(`
          INSERT INTO news (type, title, message)
          VALUES (?, ?, ?)
        `).run('achievement', newsTitle, newsMessage);
        
        console.log(`✅ Автоматически создана новость о достижении: ${totalBets} ставок`);
      }
    } catch (error) {
      console.error("❌ Ошибка проверки milestone:", error);
    }

    res.json({
      id: result.lastInsertRowid,
      user_id,
      match_id,
      prediction,
      amount,
      status: "pending",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Получить ставки пользователя
app.get("/api/user/:userId/bets", async (req, res) => {
  try {
    const { userId } = req.params;
    const viewerUsername = req.query.viewerUsername; // Кто смотрит ставки
    
    // Получаем информацию о пользователе, чьи ставки смотрят
    const targetUser = db.prepare("SELECT username FROM users WHERE id = ?").get(userId);
    
    // Отправляем уведомление админу если кто-то смотрит чужие ставки
    if (viewerUsername && targetUser && viewerUsername !== targetUser.username) {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
      
      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const message = `📊 ПРОСМОТР СТАВОК

👤 Кто смотрит: ${viewerUsername}
🎯 Чьи ставки: ${targetUser.username}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

        try {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: message,
            }),
          });
        } catch (error) {
          console.error("⚠️ Не удалось отправить уведомление о просмотре ставок:", error);
        }
      }
    }
    
    const bets = db
      .prepare(
        `
      SELECT b.*, 
             m.team1_name, m.team2_name, m.winner, 
             m.status as match_status, m.round, m.is_final, m.match_date,
             m.event_id,
             m.yellow_cards as actual_yellow_cards,
             m.red_cards as actual_red_cards,
             e.name as event_name, 
             e.status as event_status,
             e.start_date as event_start_date,
             e.locked_reason as event_locked_reason,
             CASE WHEN m.score_prediction_enabled = 1 THEN sp.score_team1 ELSE NULL END as score_team1,
             CASE WHEN m.score_prediction_enabled = 1 THEN sp.score_team2 ELSE NULL END as score_team2,
             ms.score_team1 as actual_score_team1,
             ms.score_team2 as actual_score_team2,
             CASE WHEN m.yellow_cards_prediction_enabled = 1 THEN cp.yellow_cards ELSE NULL END as yellow_cards,
             CASE WHEN m.red_cards_prediction_enabled = 1 THEN cp.red_cards ELSE NULL END as red_cards
      FROM bets b
      JOIN matches m ON b.match_id = m.id
      JOIN events e ON m.event_id = e.id
      LEFT JOIN score_predictions sp ON sp.user_id = b.user_id AND sp.match_id = b.match_id
      LEFT JOIN match_scores ms ON ms.match_id = b.match_id
      LEFT JOIN cards_predictions cp ON cp.user_id = b.user_id AND cp.match_id = b.match_id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
    `
      )
      .all(userId);
    res.json(bets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/fd-matches - Получить матчи через SStats API (замена Football-Data)
app.get("/api/fd-matches", async (req, res) => {
  try {
    const { competition, dateFrom, dateTo, includeFuture } = req.query;
    if (!competition || !dateFrom || !dateTo) {
      return res
        .status(400)
        .json({ error: "Отсутствуют параметры competition/dateFrom/dateTo" });
    }

    const apiKey = process.env.SSTATS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }

    // Получаем League ID из маппинга
    const leagueId = SSTATS_LEAGUE_MAPPING[competition];
    if (!leagueId) {
      return res.status(400).json({ error: `Неизвестный турнир: ${competition}` });
    }

    // Определяем год для запроса к API
    const dateFromObj = new Date(dateFrom);
    let year = dateFromObj.getFullYear();
    
    // Для сезонных турниров (лиги) используем год начала сезона
    // Для кубковых турниров (WC, EC) используем год проведения
    const cupTournaments = ['WC', 'EC']; // World Cup, Euro Championship
    
    if (!cupTournaments.includes(competition)) {
      // Для лиг: если дата в первой половине года (январь-июль),
      // это продолжение сезона который начался в прошлом году
      if (dateFromObj.getMonth() < 7) {
        year = year - 1;
      }
    }

    // Запрос списка матчей к SStats API (параметры с большой буквы!)
    // Получаем весь сезон/турнир, фильтрацию по датам делаем на сервере
    const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&Year=${year}`;
    
    console.log(`📊 SStats API запрос для ${competition}: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SStats API ошибка: ${response.status} - ${errorText}`);
      return res
        .status(response.status)
        .json({ error: errorText || response.statusText });
    }

    const sstatsData = await response.json();
    
    if (sstatsData.status !== "OK") {
      console.error(`❌ SStats API статус не OK:`, sstatsData);
      return res.status(500).json({ error: "SStats API вернул ошибку" });
    }

    console.log(`✅ SStats API: получено ${sstatsData.count} матчей за сезон`);

    // Фильтруем по датам и статусу на сервере
    const filteredGames = (sstatsData.data || []).filter(game => {
      // Если includeFuture=true, пропускаем все матчи
      // Если includeFuture=false, только завершенные (status: 8 = Finished)
      if (includeFuture !== 'true' && game.status !== 8) return false;
      
      // Проверяем что дата матча в нужном диапазоне
      const gameDate = game.date.split('T')[0]; // Берем только дату без времени
      return gameDate >= dateFrom && gameDate <= dateTo;
    });
    
    const statusText = includeFuture === 'true' ? 'всех' : 'завершенных';
    console.log(`✅ Из них ${statusText} в диапазоне ${dateFrom} - ${dateTo}: ${filteredGames.length} матчей`);

    // Предупреждение для RPL о проблеме с датами в SStats API
    if (leagueId === 235) {
      console.warn(`⚠️ ВНИМАНИЕ: SStats API для RPL возвращает неточные даты матчей. Рекомендуется проверить и скорректировать даты вручную после парсинга.`);
    }

    // Преобразуем в формат SStats для совместимости с фронтом
    const matches = filteredGames.map(game => {
      // Обрабатываем название тура
      let roundName = game.roundName || game.round || game.stage || null;
      
      // Убираем "Regular Season -" и оставляем только "Тур X"
      if (roundName && roundName.includes('Regular Season -')) {
        roundName = 'Тур ' + roundName.replace('Regular Season -', '').trim();
      }
      // Заменяем "Group Stage -" на "Групповой этап"
      else if (roundName && roundName.includes('Group Stage -')) {
        roundName = 'Групповой этап ' + roundName.replace('Group Stage -', '').trim();
      }
      // Заменяем "League Stage -" на "Тур"
      else if (roundName && roundName.includes('League Stage -')) {
        roundName = 'Тур ' + roundName.replace('League Stage -', '').trim();
      }
      
      return {
        id: game.id,
        utcDate: game.date,
        status: game.status === 8 ? 'FINISHED' : 'SCHEDULED',
        round: roundName,
        homeTeam: {
          id: game.homeTeam.id,
          name: game.homeTeam.name,
          shortName: game.homeTeam.name
        },
        awayTeam: {
          id: game.awayTeam.id,
          name: game.awayTeam.name,
          shortName: game.awayTeam.name
        },
        score: {
          fullTime: {
            home: game.homeResult || null,
            away: game.awayResult || null
          }
        }
      };
    });

    // Возвращаем в том же формате что и SStats
    res.json({ matches });

  } catch (error) {
    console.error("❌ /api/fd-matches ошибка:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sstats-teams - Получить список команд из SStats для маппинга
app.get("/api/sstats-teams", async (req, res) => {
  try {
    const { competition, season } = req.query;
    
    if (!competition) {
      return res.status(400).json({ error: "Требуется параметр competition" });
    }

    const apiKey = process.env.SSTATS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }

    const leagueId = SSTATS_LEAGUE_MAPPING[competition];
    if (!leagueId) {
      return res.status(400).json({ error: `Неизвестный турнир: ${competition}` });
    }

    const year = season || new Date().getFullYear();
    
    // Запрос к SStats API для получения команд лиги
    const url = `${SSTATS_API_BASE}/Leagues/${leagueId}/Standings?year=${year}`;
    
    console.log(`📊 SStats API запрос команд: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SStats API ошибка: ${response.status} - ${errorText}`);
      return res.status(response.status).json({ error: errorText || response.statusText });
    }

    const sstatsData = await response.json();
    
    if (sstatsData.status !== "OK") {
      console.error(`❌ SStats API статус не OK:`, sstatsData);
      return res.status(500).json({ error: "SStats API вернул ошибку" });
    }

    // Извлекаем уникальные названия команд
    const teams = new Set();
    if (sstatsData.data && Array.isArray(sstatsData.data)) {
      sstatsData.data.forEach(standing => {
        if (standing.team && standing.team.name) {
          teams.add(standing.team.name);
        }
      });
    }

    const teamsList = Array.from(teams).sort();
    
    console.log(`✅ SStats API: получено ${teamsList.length} команд для ${competition}`);

    res.json({ 
      competition,
      leagueId,
      year,
      teams: teamsList 
    });

  } catch (error) {
    console.error("❌ /api/sstats-teams ошибка:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/live-matches - Получить live матчи для турнира на сегодня
app.get("/api/live-matches", async (req, res) => {
  console.log(`🔍 /api/live-matches запрос получен, eventId: ${req.query.eventId}`);
  
  try {
    const { eventId } = req.query;
    
    if (!eventId) {
      console.error(`❌ eventId не указан`);
      return res.status(400).json({ error: "Не указан eventId" });
    }
    
    const apiKey = process.env.SSTATS_API_KEY;
    if (!apiKey) {
      console.error(`❌ SSTATS_API_KEY не задан в переменных окружения`);
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }
    
    // Получаем информацию о турнире из БД
    console.log(`📊 Получение турнира из БД, eventId: ${eventId}`);
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
    if (!event) {
      console.error(`❌ Турнир не найден в БД, eventId: ${eventId}`);
      return res.status(404).json({ error: "Турнир не найден" });
    }
    
    console.log(`✅ Турнир найден: ${event.name}`);
    
    // Определяем код турнира по иконке (используем глобальный маппинг)
    console.log(`🔍 Определение кода турнира по иконке: "${event.icon}"`);
    
    let competition = ICON_TO_COMPETITION[event.icon] || null;
    
    // Если не удалось определить по иконке, пробуем по названию (fallback)
    if (!competition) {
      console.log(`⚠️ Иконка не в маппинге, пробуем определить по названию`);
      const eventName = event.name.toLowerCase();
      
      if (eventName.includes('champions') || eventName.includes('лига чемпионов')) {
        competition = 'CL';
      } else if (eventName.includes('europa') || eventName.includes('лига европы')) {
        competition = 'EL';
      } else if (eventName.includes('serie a') || eventName.includes('серия а')) {
        competition = 'SA';
      } else if (eventName.includes('premier') && eventName.includes('england')) {
        competition = 'PL';
      } else if (eventName.includes('bundesliga') || eventName.includes('бундеслига')) {
        competition = 'BL1';
      } else if (eventName.includes('la liga') || eventName.includes('ла лига')) {
        competition = 'PD';
      } else if (eventName.includes('ligue 1') || eventName.includes('лига 1')) {
        competition = 'FL1';
      } else if (eventName.includes('eredivisie') || eventName.includes('эредивизи')) {
        competition = 'DED';
      } else if (eventName.includes('рпл') || (eventName.includes('премьер') && eventName.includes('росс'))) {
        competition = 'RPL';
      }
    }
    
    console.log(`🎯 Определен код турнира: ${competition || 'НЕ ОПРЕДЕЛЕН'}`);
    
    if (!competition) {
      console.log(`ℹ️ Турнир не поддерживается SStats API: ${event.name} - возвращаем пустой массив`);
      return res.json({ matches: [] }); // Тихо возвращаем пустой массив без ошибки
    }
    
    const leagueId = SSTATS_LEAGUE_MAPPING[competition];
    console.log(`🆔 League ID для ${competition}: ${leagueId}`);
    
    if (!leagueId) {
      console.log(`ℹ️ League ID не найден для ${competition} - возвращаем пустой массив`);
      return res.json({ matches: [] }); // Тихо возвращаем пустой массив без ошибки
    }
    
    // Загружаем словарь команд для турнира
    const mappingFiles = {
      'SA': path.join(__dirname, 'names', 'SerieA.json'),
      'PL': path.join(__dirname, 'names', 'PremierLeague.json'),
      'BL1': path.join(__dirname, 'names', 'Bundesliga.json'),
      'PD': path.join(__dirname, 'names', 'LaLiga.json'),
      'FL1': path.join(__dirname, 'names', 'Ligue1.json'),
      'DED': path.join(__dirname, 'names', 'Eredivisie.json'),
      'CL': path.join(__dirname, 'names', 'LeagueOfChampionsTeams.json'),
      'EL': path.join(__dirname, 'names', 'EuropaLeague.json'),
      'RPL': path.join(__dirname, 'names', 'RussianPremierLeague.json')
    };
    
    let teamMapping = {}; // Русское -> Английское
    let reverseMapping = {}; // Английское -> Русское
    const mappingFile = mappingFiles[competition];
    if (mappingFile) {
      try {
        console.log(`📂 Попытка загрузить словарь: ${mappingFile}`);
        
        // Проверяем существование файла
        if (!fs.existsSync(mappingFile)) {
          console.warn(`⚠️ Файл словаря не найден: ${mappingFile}`);
        } else {
          const fileContent = fs.readFileSync(mappingFile, 'utf8');
          const mappingData = JSON.parse(fileContent);
          teamMapping = mappingData.teams || mappingData || {};
          
          // Создаем обратный маппинг: Английское -> Русское
          reverseMapping = {};
          for (const [russian, english] of Object.entries(teamMapping)) {
            if (english && typeof english === 'string') {
              reverseMapping[english.toLowerCase()] = russian;
            }
          }
          
          console.log(`📖 Загружен словарь команд для ${competition}: ${Object.keys(teamMapping).length} команд`);
        }
      } catch (error) {
        console.error(`❌ Ошибка загрузки словаря для ${competition}:`, error.message);
        console.error(`❌ Stack trace:`, error.stack);
      }
    }
    
    // Функция для перевода английского названия в русское
    const translateTeam = (teamName) => {
      if (!teamName) return 'Команда';
      
      const nameLower = teamName.toLowerCase().trim();
      
      // 1. Ищем точное совпадение в обратном маппинге
      if (reverseMapping[nameLower]) {
        return reverseMapping[nameLower];
      }
      
      // 2. Убираем распространенные суффиксы/префиксы и ищем снова
      const cleanName = nameLower
        .replace(/\b(fc|ac|as|us|ss|afc|bsc|fk|gk|gnk|sk|cf|cd|rc|rcd|ud|sd)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (reverseMapping[cleanName]) {
        return reverseMapping[cleanName];
      }
      
      // 3. Ищем частичное совпадение (команда содержит ключевое слово)
      for (const [englishLower, russian] of Object.entries(reverseMapping)) {
        const cleanEnglish = englishLower
          .replace(/\b(fc|ac|as|us|ss|afc|bsc|fk|gk|gnk|sk|cf|cd|rc|rcd|ud|sd)\b/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        // Проверяем точное совпадение очищенных названий
        if (cleanName === cleanEnglish) {
          return russian;
        }
        
        // Проверяем вхождение (для длинных названий)
        if (cleanName.length > 4 && cleanEnglish.length > 4) {
          if (cleanName.includes(cleanEnglish) || cleanEnglish.includes(cleanName)) {
            return russian;
          }
        }
      }
      
      // 4. Если не нашли в JSON, возвращаем оригинал (он будет обработан dict.js на клиенте)
      return teamName;
    };
    
    // Определяем диапазон дат для запроса (сегодня)
    const now = new Date();
    const today = now.toISOString().slice(0, 10); // "2026-01-21"
    const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10); // "2026-01-22"
    
    console.log(`🗓️ Запрос матчей за период: ${today} - ${tomorrow}`);
    
    // Используем фильтр по дате вместо Year для оптимизации
    const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&From=${today}&To=${tomorrow}`;
    
    console.log(`📊 SStats API запрос live матчей для ${event.name}: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SStats API ошибка: ${response.status} - ${errorText}`);
      return res.status(response.status).json({ error: errorText || response.statusText });
    }
    
    const sstatsData = await response.json();
    
    if (sstatsData.status !== "OK") {
      console.error(`❌ SStats API статус не OK:`, sstatsData);
      return res.status(500).json({ error: "SStats API вернул ошибку" });
    }
    
    console.log(`📊 Всего матчей получено от API: ${sstatsData.data?.length || 0}`);
    
    // Матчи уже отфильтрованы по дате в запросе, просто преобразуем их
    const todayMatches = sstatsData.data || [];
    
    console.log(`✅ Матчей на сегодня: ${todayMatches.length}`);
    if (todayMatches.length > 0) {
      console.log('Примеры матчей:', todayMatches.slice(0, 3).map(g => ({
        date: g.date,
        teams: `${g.homeTeam?.name} vs ${g.awayTeam?.name}`,
        status: g.statusName
      })));
    }
    
    // Преобразуем в формат нашего приложения с переводом названий
    const matches = todayMatches.map(game => {
      const originalTeam1 = game.homeTeam?.name || 'Команда 1';
      const originalTeam2 = game.awayTeam?.name || 'Команда 2';
      
      return {
        id: game.id,
        event_id: parseInt(eventId),
        team1: translateTeam(originalTeam1),
        team2: translateTeam(originalTeam2),
        team1_original: originalTeam1,
        team2_original: originalTeam2,
        match_time: game.date,
        status: game.statusName === 'Finished' ? 'finished' : 
                game.statusName === 'Not Started' ? 'scheduled' : 'live',
        score: game.homeResult !== null && game.awayResult !== null 
          ? `${game.homeResult}:${game.awayResult}` 
          : null,
        elapsed: game.elapsed || null,
        statusName: game.statusName
      };
    });
    
    console.log(`✅ Найдено ${matches.length} матчей на сегодня для ${event.name}`);
    if (matches.length > 0) {
      console.log('Пример перевода:', {
        original: matches[0].team1_original,
        translated: matches[0].team1
      });
    }
    
    res.json({ matches });
    
  } catch (error) {
    console.error("❌ /api/live-matches критическая ошибка:", error.message);
    console.error("❌ Stack trace:", error.stack);
    console.error("❌ Error details:", {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// GET /api/match-details/:matchId - Получить детальную информацию о матче из SStats
app.get("/api/match-details/:matchId", async (req, res) => {
  console.log(`🔍 /api/match-details запрос получен, matchId: ${req.params.matchId}`);
  
  try {
    const { matchId } = req.params;
    
    if (!matchId) {
      return res.status(400).json({ error: "Не указан matchId" });
    }
    
    const apiKey = process.env.SSTATS_API_KEY;
    if (!apiKey) {
      console.error(`❌ SSTATS_API_KEY не задан в переменных окружения`);
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }
    
    const url = `${SSTATS_API_BASE}/Games/${matchId}`;
    console.log(`📊 SStats API запрос деталей матча: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SStats API ошибка: ${response.status} - ${errorText}`);
      return res.status(response.status).json({ error: errorText || response.statusText });
    }
    
    const matchDetails = await response.json();
    
    console.log(`📦 Структура ответа:`, {
      status: matchDetails.status,
      hasData: !!matchDetails.data,
      dataKeys: matchDetails.data ? Object.keys(matchDetails.data).slice(0, 10) : []
    });
    
    if (matchDetails.status !== "OK") {
      console.error(`❌ SStats API статус не OK:`, matchDetails);
      return res.status(500).json({ error: "SStats API вернул ошибку" });
    }
    
    const data = matchDetails.data;
    console.log(`✅ Детали матча получены: ${data?.game?.homeTeam?.name || 'N/A'} vs ${data?.game?.awayTeam?.name || 'N/A'}`);
    console.log(`📊 Доступные поля:`, Object.keys(data || {}).join(', '));
    console.log(`⚽ События: ${data?.events?.length || 0}, Статистика: ${data?.statistics?.length || 0}, Игроки: ${data?.lineupPlayers?.length || 0}`);
    
    res.json(data);
    
  } catch (error) {
    console.error("❌ /api/match-details ошибка:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/match-glicko/:matchId - Получить данные Glicko-2 и xG для матча
app.get("/api/match-glicko/:matchId", async (req, res) => {
  console.log(`🔍 /api/match-glicko запрос получен, matchId: ${req.params.matchId}`);
  
  try {
    const { matchId } = req.params;
    const { refresh } = req.query; // Параметр для принудительного обновления
    
    if (!matchId) {
      return res.status(400).json({ error: "Не указан matchId" });
    }
    
    // Получаем информацию о матче из БД
    const match = db.prepare('SELECT sstats_match_id, team1_name, team2_name FROM matches WHERE id = ?').get(matchId);
    
    if (!match || !match.sstats_match_id) {
      console.error(`❌ Матч не найден или нет sstats_match_id, matchId: ${matchId}`);
      return res.status(404).json({ error: "Матч не найден или нет данных SStats" });
    }
    
    // Проверяем есть ли данные в кэше (если не запрошено обновление)
    if (refresh !== 'true') {
      const cached = db.prepare('SELECT * FROM glicko_cache WHERE match_id = ?').get(matchId);
      
      if (cached) {
        console.log(`✅ Данные Glicko-2 получены из кэша для матча ${match.team1_name} vs ${match.team2_name}`);
        return res.json({
          matchId: matchId,
          sstatsMatchId: match.sstats_match_id,
          team1: match.team1_name,
          team2: match.team2_name,
          glicko: {
            homeRating: cached.home_rating,
            awayRating: cached.away_rating,
            homeXg: cached.home_xg,
            awayXg: cached.away_xg,
            homeWinProbability: cached.home_win_probability,
            awayWinProbability: cached.away_win_probability
          },
          cached: true,
          cachedAt: cached.cached_at
        });
      }
    }
    
    // Если данных нет в кэше или запрошено обновление - загружаем из API
    const apiKey = process.env.SSTATS_API_KEY;
    if (!apiKey) {
      console.error(`❌ SSTATS_API_KEY не задан в переменных окружения`);
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }
    
    const url = `${SSTATS_API_BASE}/Games/glicko/${match.sstats_match_id}`;
    console.log(`📊 SStats API запрос Glicko-2: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SStats API ошибка: ${response.status} - ${errorText}`);
      return res.status(response.status).json({ error: errorText || response.statusText });
    }
    
    const glickoData = await response.json();
    
    if (glickoData.status !== "OK") {
      console.error(`❌ SStats API статус не OK:`, glickoData);
      
      // Если это ошибка "отсутствует Glicko аналитика" - возвращаем специальный статус
      if (glickoData.message && glickoData.message.includes('отсутствует Glicko аналитика')) {
        return res.status(404).json({ 
          error: "Glicko аналитика пока недоступна для этого матча",
          reason: "future_match"
        });
      }
      
      return res.status(500).json({ error: "SStats API вернул ошибку" });
    }
    
    const data = glickoData.data;
    console.log(`✅ Glicko-2 данные получены из API для матча ${match.team1_name} vs ${match.team2_name}`);
    
    // Сохраняем данные в кэш
    try {
      db.prepare(`
        INSERT OR REPLACE INTO glicko_cache 
        (match_id, sstats_match_id, home_rating, away_rating, home_xg, away_xg, home_win_probability, away_win_probability, cached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        matchId,
        match.sstats_match_id,
        data.glicko?.homeRating || null,
        data.glicko?.awayRating || null,
        data.glicko?.homeXg || null,
        data.glicko?.awayXg || null,
        data.glicko?.homeWinProbability || null,
        data.glicko?.awayWinProbability || null
      );
      console.log(`💾 Данные Glicko-2 сохранены в кэш`);
    } catch (cacheError) {
      console.warn(`⚠️ Не удалось сохранить в кэш:`, cacheError.message);
    }
    
    res.json({
      matchId: matchId,
      sstatsMatchId: match.sstats_match_id,
      team1: match.team1_name,
      team2: match.team2_name,
      glicko: data.glicko,
      fixture: data.fixture,
      cached: false
    });
    
  } catch (error) {
    console.error("❌ /api/match-glicko ошибка:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/yesterday-matches - Получить завершенные матчи сгруппированные по датам
app.get("/api/yesterday-matches", async (req, res) => {
  console.log(`🔍 /api/yesterday-matches запрос получен, eventId: ${req.query.eventId}`);
  
  try {
    const { eventId } = req.query;
    
    if (!eventId) {
      return res.status(400).json({ error: "eventId обязателен" });
    }
    
    // Получаем информацию о турнире
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
    
    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }
    
    console.log(`📅 Ищем завершенные матчи сгруппированные по датам`);
    
    // Получаем все завершенные матчи
    const allMatches = db.prepare(`
      SELECT 
        m.*,
        e.name as event_name,
        DATE(m.match_date) as match_day
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.event_id = ?
        AND m.winner IS NOT NULL
      ORDER BY m.match_date DESC
    `).all(eventId);
    
    // Группируем по датам
    const matchesByDate = {};
    allMatches.forEach(match => {
      const day = match.match_day;
      if (!matchesByDate[day]) {
        matchesByDate[day] = [];
      }
      matchesByDate[day].push(match);
    });
    
    // Проверяем какие дни полностью завершены (все матчи этого дня имеют результат)
    const completedDays = [];
    
    for (const day in matchesByDate) {
      // Получаем все матчи этого дня (включая незавершенные)
      const allDayMatches = db.prepare(`
        SELECT COUNT(*) as total
        FROM matches
        WHERE event_id = ?
          AND DATE(match_date) = ?
      `).get(eventId, day);
      
      const finishedDayMatches = matchesByDate[day].length;
      
      // Если все матчи дня завершены, добавляем в список
      if (allDayMatches.total === finishedDayMatches) {
        completedDays.push({
          date: day,
          matches: matchesByDate[day]
        });
      }
    }
    
    console.log(`✅ Найдено полностью завершенных дней: ${completedDays.length}`);
    
    // Автоматически заполняем sstats_match_id и счет для матчей
    let matchesWithoutSstatsId = 0;
    let matchesWithoutScore = 0;
    let matchesUpdated = 0;
    
    for (const day of completedDays) {
      for (const match of day.matches) {
        if (!match.sstats_match_id) {
          matchesWithoutSstatsId++;
        }
        // Проверяем матчи с sstats_match_id, но без счета
        if (match.sstats_match_id && (match.team1_score === null || match.team2_score === null)) {
          matchesWithoutScore++;
        }
      }
    }
    
    // Если есть матчи без счета, но с sstats_match_id - загружаем счет напрямую
    if (matchesWithoutScore > 0) {
      console.log(`⚠️ Найдено ${matchesWithoutScore} матчей с sstats_match_id, но без счета, загружаем счет...`);
      
      for (const day of completedDays) {
        for (const match of day.matches) {
          if (match.sstats_match_id && (match.team1_score === null || match.team2_score === null)) {
            try {
              const url = `${SSTATS_API_BASE}/Games/${match.sstats_match_id}`;
              const response = await fetch(url, {
                headers: { "X-API-Key": SSTATS_API_KEY }
              });
              
              if (response.ok) {
                const matchDetails = await response.json();
                if (matchDetails.status === "OK" && matchDetails.data?.game) {
                  const homeScore = matchDetails.data.game.homeResult ?? null;
                  const awayScore = matchDetails.data.game.awayResult ?? null;
                  
                  if (homeScore !== null && awayScore !== null) {
                    db.prepare('UPDATE matches SET team1_score = ?, team2_score = ? WHERE id = ?')
                      .run(homeScore, awayScore, match.id);
                    
                    match.team1_score = homeScore;
                    match.team2_score = awayScore;
                    matchesUpdated++;
                    
                    console.log(`✅ Обновлен счет для матча ${match.id}: ${match.team1_name} vs ${match.team2_name} -> ${homeScore}:${awayScore}`);
                  }
                }
              }
            } catch (err) {
              console.warn(`⚠️ Ошибка загрузки счета для матча ${match.id}:`, err.message);
            }
          }
        }
      }
      
      console.log(`✅ Обновлено счетов: ${matchesUpdated} из ${matchesWithoutScore}`);
    }
    
    if (matchesWithoutSstatsId > 0) {
      console.log(`⚠️ Найдено ${matchesWithoutSstatsId} матчей без sstats_match_id, пытаемся заполнить...`);
      
      try {
        // Определяем код турнира
        const competition = ICON_TO_COMPETITION[event.icon];
        const leagueId = competition ? SSTATS_LEAGUE_MAPPING[competition] : null;
        
        if (leagueId && SSTATS_API_KEY) {
          // Загружаем словарь команд для турнира
          const mappingFiles = {
            'SA': path.join(__dirname, 'names', 'SerieA.json'),
            'PL': path.join(__dirname, 'names', 'PremierLeague.json'),
            'BL1': path.join(__dirname, 'names', 'Bundesliga.json'),
            'PD': path.join(__dirname, 'names', 'LaLiga.json'),
            'FL1': path.join(__dirname, 'names', 'Ligue1.json'),
            'DED': path.join(__dirname, 'names', 'Eredivisie.json'),
            'CL': path.join(__dirname, 'names', 'LeagueOfChampionsTeams.json'),
            'EL': path.join(__dirname, 'names', 'EuropaLeague.json'),
            'RPL': path.join(__dirname, 'names', 'RussianPremierLeague.json')
          };
          
          let teamMapping = {}; // Русское -> Английское
          const mappingFile = mappingFiles[competition];
          
          if (mappingFile && fs.existsSync(mappingFile)) {
            try {
              const fileContent = fs.readFileSync(mappingFile, 'utf8');
              const mappingData = JSON.parse(fileContent);
              const originalMapping = mappingData.teams || mappingData || {};
              
              // Создаем регистронезависимый маппинг
              teamMapping = {};
              for (const [russian, english] of Object.entries(originalMapping)) {
                teamMapping[russian.toLowerCase()] = english;
              }
              
              console.log(`📖 Загружен словарь команд для ${competition}: ${Object.keys(teamMapping).length} команд`);
            } catch (err) {
              console.warn(`⚠️ Ошибка загрузки словаря: ${err.message}`);
            }
          }
          
          // Функция для нормализации названия команды (убираем FC, AC и т.д.)
          const normalizeTeamName = (name) => {
            if (!name) return '';
            return name.toLowerCase()
              .replace(/\b(fc|ac|as|us|ss|afc|bsc|fk|gk|gnk|sk|cf|cd|rc|rcd|ud|sd)\b/g, '')
              .replace(/\s+/g, ' ')
              .trim();
          };
          
          // Получаем все матчи турнира из SStats API за последние 30 дней
          const endDate = new Date().toISOString().slice(0, 10);
          const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          
          const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&From=${startDate}&To=${endDate}`;
          const response = await fetch(url, {
            headers: { "X-API-Key": SSTATS_API_KEY }
          });
          
          if (response.ok) {
            const sstatsData = await response.json();
            const sstatsMatches = sstatsData.data || [];
            
            console.log(`📊 Получено ${sstatsMatches.length} матчей из SStats API`);
            
            // Логируем первые 3 матча из SStats для отладки
            if (sstatsMatches.length > 0) {
              console.log('📋 Примеры матчей из SStats API:');
              sstatsMatches.slice(0, 3).forEach((sm, idx) => {
                console.log(`  ${idx + 1}. ${sm.homeTeam?.name} vs ${sm.awayTeam?.name} (${new Date(sm.date).toLocaleDateString('ru-RU')})`);
              });
            }
            
            // Логируем первые 3 матча из БД для отладки
            const matchesToUpdate = [];
            for (const day of completedDays) {
              for (const match of day.matches) {
                if (!match.sstats_match_id) {
                  matchesToUpdate.push(match);
                }
              }
            }
            
            if (matchesToUpdate.length > 0) {
              console.log('📋 Примеры матчей из БД (требуют обновления):');
              matchesToUpdate.slice(0, 3).forEach((m, idx) => {
                console.log(`  ${idx + 1}. ${m.team1_name} vs ${m.team2_name} (${new Date(m.match_date).toLocaleDateString('ru-RU')})`);
              });
            }
            
            // Сопоставляем матчи по командам и дате
            for (const day of completedDays) {
              for (const match of day.matches) {
                if (!match.sstats_match_id) {
                  // Переводим русские названия в английские (регистронезависимо)
                  const team1English = teamMapping[match.team1_name.toLowerCase()] || match.team1_name;
                  const team2English = teamMapping[match.team2_name.toLowerCase()] || match.team2_name;
                  
                  console.log(`🔍 Перевод: "${match.team1_name}" -> "${team1English}", "${match.team2_name}" -> "${team2English}"`);
                  
                  // Нормализуем названия
                  const team1Normalized = normalizeTeamName(team1English);
                  const team2Normalized = normalizeTeamName(team2English);
                  
                  // Ищем соответствующий матч в SStats
                  const sstatsMatch = sstatsMatches.find(sm => {
                    const matchDate = new Date(match.match_date);
                    const sstatsDate = new Date(sm.date);
                    const dateDiff = Math.abs(matchDate - sstatsDate) / (1000 * 60 * 60); // разница в часах
                    
                    // Нормализуем названия из SStats
                    const sstatsTeam1 = normalizeTeamName(sm.homeTeam?.name);
                    const sstatsTeam2 = normalizeTeamName(sm.awayTeam?.name);
                    
                    // Проверяем совпадение команд (более гибкое сравнение)
                    const team1Match = 
                      sstatsTeam1.includes(team1Normalized) || 
                      team1Normalized.includes(sstatsTeam1) ||
                      sstatsTeam1 === team1Normalized ||
                      // Дополнительная проверка по первым 4 символам (для коротких названий)
                      (team1Normalized.length >= 4 && sstatsTeam1.length >= 4 && 
                       team1Normalized.substring(0, 4) === sstatsTeam1.substring(0, 4));
                    
                    const team2Match = 
                      sstatsTeam2.includes(team2Normalized) || 
                      team2Normalized.includes(sstatsTeam2) ||
                      sstatsTeam2 === team2Normalized ||
                      // Дополнительная проверка по первым 4 символам
                      (team2Normalized.length >= 4 && sstatsTeam2.length >= 4 && 
                       team2Normalized.substring(0, 4) === sstatsTeam2.substring(0, 4));
                    
                    const isMatch = dateDiff < 24 && team1Match && team2Match;
                    
                    if (dateDiff < 24 && (team1Match || team2Match)) {
                      console.log(`🔍 Частичное совпадение (дата OK, команды: ${team1Match ? '✓' : '✗'}/${team2Match ? '✓' : '✗'}): ${match.team1_name} (${team1Normalized}) vs ${match.team2_name} (${team2Normalized}) = ${sm.homeTeam?.name} (${sstatsTeam1}) vs ${sm.awayTeam?.name} (${sstatsTeam2})`);
                    }
                    
                    if (isMatch) {
                      console.log(`🎯 Найдено совпадение: ${match.team1_name} (${team1Normalized}) vs ${match.team2_name} (${team2Normalized}) = ${sm.homeTeam?.name} (${sstatsTeam1}) vs ${sm.awayTeam?.name} (${sstatsTeam2})`);
                    }
                    
                    return isMatch;
                  });
                  
                  if (sstatsMatch) {
                    // Обновляем sstats_match_id и счет в БД
                    const homeScore = sstatsMatch.homeResult ?? null;
                    const awayScore = sstatsMatch.awayResult ?? null;
                    
                    db.prepare('UPDATE matches SET sstats_match_id = ?, team1_score = ?, team2_score = ? WHERE id = ?')
                      .run(sstatsMatch.id, homeScore, awayScore, match.id);
                    
                    match.sstats_match_id = sstatsMatch.id; // Обновляем в текущем объекте
                    match.team1_score = homeScore; // Обновляем счет
                    match.team2_score = awayScore; // Обновляем счет
                    
                    matchesUpdated++;
                    console.log(`✅ Обновлен sstats_match_id и счет для матча ${match.id}: ${match.team1_name} vs ${match.team2_name} -> ${sstatsMatch.id} (${homeScore}:${awayScore})`);
                  } else {
                    console.log(`❌ Не найдено совпадение для: ${match.team1_name} (${team1Normalized}) vs ${match.team2_name} (${team2Normalized}), дата: ${new Date(match.match_date).toLocaleDateString('ru-RU')}`);
                    
                    // Показываем ближайшие матчи по дате для отладки
                    const matchDate = new Date(match.match_date);
                    const nearbyMatches = sstatsMatches.filter(sm => {
                      const sstatsDate = new Date(sm.date);
                      const dateDiff = Math.abs(matchDate - sstatsDate) / (1000 * 60 * 60);
                      return dateDiff < 48; // В пределах 48 часов
                    }).slice(0, 3);
                    
                    if (nearbyMatches.length > 0) {
                      console.log(`  📅 Ближайшие матчи по дате:`);
                      nearbyMatches.forEach(sm => {
                        const sstatsTeam1 = normalizeTeamName(sm.homeTeam?.name);
                        const sstatsTeam2 = normalizeTeamName(sm.awayTeam?.name);
                        console.log(`    - ${sm.homeTeam?.name} (${sstatsTeam1}) vs ${sm.awayTeam?.name} (${sstatsTeam2}), дата: ${new Date(sm.date).toLocaleDateString('ru-RU')}`);
                      });
                    }
                  }
                }
              }
            }
            
            console.log(`✅ Обновлено ${matchesUpdated} из ${matchesWithoutSstatsId} матчей`);
          }
        }
      } catch (err) {
        console.warn('⚠️ Не удалось автоматически заполнить sstats_match_id:', err.message);
      }
    }
    
    // Логируем первые несколько матчей для отладки
    if (completedDays.length > 0 && completedDays[0].matches.length > 0) {
      console.log('📋 Пример матча из completedDays:', {
        id: completedDays[0].matches[0].id,
        sstats_match_id: completedDays[0].matches[0].sstats_match_id,
        team1_name: completedDays[0].matches[0].team1_name,
        team2_name: completedDays[0].matches[0].team2_name,
        team1_score: completedDays[0].matches[0].team1_score,
        team2_score: completedDays[0].matches[0].team2_score,
        winner: completedDays[0].matches[0].winner
      });
    }
    
    res.json({ 
      event: event, 
      completedDays: completedDays 
    });
    
  } catch (error) {
    console.error(`❌ /api/yesterday-matches критическая ошибка: ${error.message}`);
    console.error(`❌ Stack trace:`, error.stack);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/fill-upcoming-sstats-ids - Заполнить sstats_match_id для будущих матчей конкретного тура
app.post("/api/admin/fill-upcoming-sstats-ids", async (req, res) => {
  console.log(`🔍 /api/admin/fill-upcoming-sstats-ids запрос получен`);
  
  try {
    const { eventId, round } = req.body;
    
    if (!eventId) {
      return res.status(400).json({ error: "eventId обязателен" });
    }
    
    const apiKey = process.env.SSTATS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }
    
    // Получаем информацию о турнире
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
    
    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }
    
    // Получаем leagueId и year из event
    const leagueId = event.sstats_league_id;
    const year = event.year;
    
    if (!leagueId || !year) {
      return res.status(400).json({ error: "У турнира не указан sstats_league_id или year" });
    }
    
    // Загружаем словарь команд для перевода названий
    let teamTranslations = {};
    const dictionaryFile = event.team_file; // Используем team_file из events
    
    if (dictionaryFile) {
      try {
        const fs = await import('fs/promises');
        const dictData = JSON.parse(await fs.readFile(dictionaryFile, 'utf-8'));
        teamTranslations = dictData.teams || {};
        console.log(`✅ Загружен словарь команд: ${Object.keys(teamTranslations).length} команд`);
      } catch (err) {
        console.warn(`⚠️ Не удалось загрузить словарь из ${dictionaryFile}:`, err.message);
      }
    }
    
    // Функция для перевода названия команды из русского в английский
    const translateTeamName = (russianName) => {
      return teamTranslations[russianName] || russianName;
    };
    
    console.log(`📅 Ищем будущие матчи без sstats_match_id для турнира ${event.name}${round ? `, тур: ${round}` : ''}`);
    
    // Получаем будущие матчи без sstats_match_id (опционально фильтруем по туру)
    let query = `
      SELECT *
      FROM matches
      WHERE event_id = ?
        AND sstats_match_id IS NULL
        AND match_date > datetime('now')
    `;
    
    const params = [eventId];
    
    if (round && round !== 'all') {
      query += ` AND round = ?`;
      params.push(round);
    }
    
    query += ` ORDER BY match_date ASC`;
    
    const upcomingMatches = db.prepare(query).all(...params);
    
    if (upcomingMatches.length === 0) {
      console.log(`✅ Все будущие матчи${round ? ` тура ${round}` : ''} уже имеют sstats_match_id`);
      return res.json({ 
        message: `Все будущие матчи${round ? ` тура ${round}` : ''} уже имеют sstats_match_id`,
        matchesUpdated: 0
      });
    }
    
    console.log(`📊 Найдено ${upcomingMatches.length} будущих матчей без sstats_match_id`);
    
    // Определяем диапазон дат для запроса к SStats API
    const dates = upcomingMatches.map(m => new Date(m.match_date));
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    
    minDate.setDate(minDate.getDate() - 1);
    maxDate.setDate(maxDate.getDate() + 1);
    
    const dateFrom = minDate.toISOString().slice(0, 10);
    const dateTo = maxDate.toISOString().slice(0, 10);
    
    const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&From=${dateFrom}&To=${dateTo}`;
    console.log(`📊 SStats API запрос матчей для диапазона ${dateFrom} - ${dateTo}: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SStats API ошибка: ${response.status} - ${errorText}`);
      return res.status(response.status).json({ error: errorText || response.statusText });
    }
    
    const sstatsData = await response.json();
    
    if (sstatsData.status !== "OK") {
      console.error(`❌ SStats API статус не OK:`, sstatsData);
      return res.status(500).json({ error: "SStats API вернул ошибку" });
    }
    
    const sstatsMatches = sstatsData.data || [];
    console.log(`✅ SStats API: получено ${sstatsMatches.length} матчей для диапазона ${dateFrom} - ${dateTo}`);
    
    // Функция нормализации названия команды
    const normalizeTeamName = (name) => {
      if (!name) return '';
      return name
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-zа-я0-9]/g, '');
    };
    
    let matchesUpdated = 0;
    
    // Для каждого матча из БД ищем совпадение в SStats
    for (const match of upcomingMatches) {
      // Переводим русские названия в английские
      const team1English = translateTeamName(match.team1_name);
      const team2English = translateTeamName(match.team2_name);
      
      const team1Normalized = normalizeTeamName(team1English);
      const team2Normalized = normalizeTeamName(team2English);
      const matchDate = new Date(match.match_date);
      
      console.log(`🔍 Ищем: ${match.team1_name} (${team1English}) vs ${match.team2_name} (${team2English})`);
      
      // Ищем совпадение по командам и дате (в пределах 24 часов)
      const sstatsMatch = sstatsMatches.find(sm => {
        const sstatsTeam1 = normalizeTeamName(sm.homeTeam?.name);
        const sstatsTeam2 = normalizeTeamName(sm.awayTeam?.name);
        const sstatsDate = new Date(sm.date);
        const dateDiff = Math.abs(matchDate - sstatsDate) / (1000 * 60 * 60); // разница в часах
        
        // Проверяем совпадение команд (с учетом частичного совпадения)
        const team1Match = 
          sstatsTeam1.includes(team1Normalized) || 
          team1Normalized.includes(sstatsTeam1) ||
          sstatsTeam1 === team1Normalized ||
          (team1Normalized.length >= 4 && sstatsTeam1.length >= 4 && 
           team1Normalized.substring(0, 4) === sstatsTeam1.substring(0, 4));
        
        const team2Match = 
          sstatsTeam2.includes(team2Normalized) || 
          team2Normalized.includes(sstatsTeam2) ||
          sstatsTeam2 === team2Normalized ||
          (team2Normalized.length >= 4 && sstatsTeam2.length >= 4 && 
           team2Normalized.substring(0, 4) === sstatsTeam2.substring(0, 4));
        
        const isMatch = dateDiff < 24 && team1Match && team2Match;
        
        if (dateDiff < 24 && (team1Match || team2Match)) {
          console.log(`  🔍 Частичное совпадение: ${sm.homeTeam?.name} vs ${sm.awayTeam?.name} (дата OK: ${dateDiff.toFixed(1)}ч, команды: ${team1Match ? '✓' : '✗'}/${team2Match ? '✓' : '✗'})`);
        }
        
        return isMatch;
      });
      
      if (sstatsMatch) {
        // Обновляем sstats_match_id в БД
        db.prepare('UPDATE matches SET sstats_match_id = ? WHERE id = ?')
          .run(sstatsMatch.id, match.id);
        
        matchesUpdated++;
        console.log(`✅ Обновлен sstats_match_id для матча ${match.id}: ${match.team1_name} vs ${match.team2_name} -> ${sstatsMatch.id}`);
      } else {
        console.log(`❌ Не найдено совпадение для: ${match.team1_name} vs ${match.team2_name}, дата: ${matchDate.toLocaleDateString('ru-RU')}`);
      }
    }
    
    console.log(`✅ Обновлено ${matchesUpdated} из ${upcomingMatches.length} будущих матчей`);
    
    res.json({ 
      message: `Обновлено ${matchesUpdated} из ${upcomingMatches.length} будущих матчей`,
      matchesUpdated: matchesUpdated,
      totalMatches: upcomingMatches.length
    });
    
  } catch (error) {
    console.error(`❌ /api/admin/fill-upcoming-sstats-ids ошибка: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Вспомогательная функция для определения статуса матча
function getMatchStatus(match) {
  const now = new Date();
  const matchDate = match.match_date ? new Date(match.match_date) : null;
  
  // Если есть результат - матч завершен
  if (match.winner) {
    return 'finished';
  }
  
  // Если нет даты - считаем ожидающим
  if (!matchDate) {
    return 'pending';
  }
  
  // Если дата в будущем - ожидает
  if (matchDate > now) {
    return 'pending';
  }
  
  // Если дата прошла, но нет результата - идет
  return 'ongoing';
}

// POST /api/favorite-matches - Получить данные избранных матчей
app.post("/api/favorite-matches", async (req, res) => {
  try {
    const { matchIds } = req.body;
    
    console.log('📥 /api/favorite-matches запрос:', matchIds);
    
    if (!Array.isArray(matchIds) || matchIds.length === 0) {
      return res.json({ matches: [] });
    }
    
    // Получаем матчи из базы данных (синхронно, т.к. better-sqlite3)
    const placeholders = matchIds.map(() => '?').join(',');
    const query = `
      SELECT 
        m.*,
        e.name as event_name
      FROM matches m
      LEFT JOIN events e ON m.event_id = e.id
      WHERE m.id IN (${placeholders})
    `;
    
    console.log('🔍 SQL запрос для', matchIds.length, 'матчей');
    
    const matches = db.prepare(query).all(...matchIds);
    
    console.log(`📊 Получено ${matches ? matches.length : 0} матчей из БД`);
    
    if (!matches || matches.length === 0) {
      return res.json({ matches: [] });
    }
    
    const now = new Date();
    
    // Фильтруем только LIVE матчи и форматируем данные
    const results = matches
      .filter(match => {
        // Если есть результат - матч завершен
        if (match.winner) {
          console.log(`  Матч ${match.id}: завершен (есть winner)`);
          return false;
        }
        
        // Если нет даты - пропускаем
        if (!match.match_date) {
          console.log(`  Матч ${match.id}: нет даты`);
          return false;
        }
        
        const matchDate = new Date(match.match_date);
        
        // Если дата в будущем - ожидает
        if (matchDate > now) {
          console.log(`  Матч ${match.id}: в будущем`);
          return false;
        }
        
        // Если дата прошла, но нет результата - идет (LIVE)
        console.log(`  Матч ${match.id}: LIVE ✅`);
        return true;
      })
      .map(match => {
        return {
          id: match.id,
          team1: match.team1_name,
          team2: match.team2_name,
          score: match.score || '0:0',
          status: 'live',
          elapsed: null,
          event_name: match.event_name
        };
      });
    
    console.log(`✅ Найдено ${results.length} LIVE матчей из ${matchIds.length} избранных`);
    res.json({ matches: results });
    
  } catch (error) {
    console.error("❌ /api/favorite-matches общая ошибка:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/check-match-events - Проверить события матчей и отправить уведомления
app.post("/api/check-match-events", async (req, res) => {
  try {
    const { matchIds, userId } = req.body;
    
    if (!Array.isArray(matchIds) || matchIds.length === 0 || !userId) {
      return res.json({ success: false, message: 'Invalid parameters' });
    }
    
    console.log(`🔍 Проверка событий для ${matchIds.length} матчей, пользователь ${userId}`);
    
    // Получаем настройки пользователя
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!user || !user.telegram_notifications_enabled) {
      console.log(`⏭️ У пользователя ${userId} отключены уведомления`);
      return res.json({ success: true, notifications: 0 });
    }
    
    // Получаем chat_id пользователя
    const telegramUser = db.prepare(
      'SELECT chat_id FROM telegram_users WHERE telegram_username = ?'
    ).get(user.telegram_username);
    
    if (!telegramUser) {
      console.log(`⏭️ У пользователя ${userId} нет привязки Telegram`);
      return res.json({ success: true, notifications: 0 });
    }
    
    let notificationsSent = 0;
    
    // Для каждого матча проверяем события
    for (const matchId of matchIds) {
      try {
        // Получаем детали матча из SStats API
        const match = db.prepare('SELECT sstats_match_id FROM matches WHERE id = ?').get(matchId);
        
        if (!match || !match.sstats_match_id) {
          console.log(`⏭️ Матч ${matchId} не имеет sstats_match_id`);
          continue;
        }
        
        const detailsUrl = `${SSTATS_API_BASE}/Games/${match.sstats_match_id}`;
        const response = await fetch(detailsUrl, {
          headers: { 'X-API-Key': SSTATS_API_KEY }
        });
        
        if (!response.ok) {
          console.log(`⚠️ Не удалось загрузить детали матча ${matchId}`);
          continue;
        }
        
        const result = await response.json();
        const details = result.data || result;
        const events = details.events || [];
        
        // Проверяем каждое событие
        for (const event of events) {
          const eventId = `${event.id || event.elapsed}_${event.type}_${event.player?.name || 'unknown'}`;
          
          // Проверяем было ли уже отправлено уведомление
          const alreadySent = db.prepare(
            'SELECT id FROM match_events_sent WHERE match_id = ? AND event_id = ? AND user_id = ?'
          ).get(matchId, eventId, userId);
          
          if (alreadySent) {
            continue; // Уже отправляли
          }
          
          // Фильтруем только важные события: голы и карточки
          if (!['goal', 'yellowcard', 'redcard'].includes(event.type)) {
            continue;
          }
          
          // Формируем сообщение
          let message = '';
          const game = details.game;
          const matchInfo = `${game.homeTeam?.name || 'Команда 1'} ${game.homeResult || 0}:${game.awayResult || 0} ${game.awayTeam?.name || 'Команда 2'}`;
          
          if (event.type === 'goal') {
            const scorer = event.player?.name || 'Неизвестный игрок';
            const assist = event.assistPlayer?.name ? ` (ассист: ${event.assistPlayer.name})` : '';
            message = `⚽ ГОЛ!\n\n${matchInfo}\n\n${scorer} забил гол!${assist}\n⏱️ ${event.elapsed || '?'}'`;
          } else if (event.type === 'yellowcard') {
            const player = event.player?.name || 'Неизвестный игрок';
            message = `🟨 Желтая карточка\n\n${matchInfo}\n\n${player} получил предупреждение\n⏱️ ${event.elapsed || '?'}'`;
          } else if (event.type === 'redcard') {
            const player = event.player?.name || 'Неизвестный игрок';
            message = `🟥 Красная карточка!\n\n${matchInfo}\n\n${player} удален с поля!\n⏱️ ${event.elapsed || '?'}'`;
          }
          
          if (message) {
            // Отправляем уведомление через бота
            try {
              await sendTelegramMessage(telegramUser.chat_id, message);
              
              // Сохраняем что уведомление отправлено
              db.prepare(
                'INSERT INTO match_events_sent (match_id, event_id, event_type, user_id) VALUES (?, ?, ?, ?)'
              ).run(matchId, eventId, event.type, userId);
              
              notificationsSent++;
              console.log(`✅ Уведомление отправлено пользователю ${userId} о событии ${event.type} в матче ${matchId}`);
            } catch (err) {
              console.error(`❌ Ошибка отправки уведомления:`, err);
            }
          }
        }
      } catch (err) {
        console.error(`❌ Ошибка обработки матча ${matchId}:`, err);
      }
    }
    
    res.json({ success: true, notifications: notificationsSent });
    
  } catch (error) {
    console.error("❌ /api/check-match-events ошибка:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/live-matches-by-ids - Получить актуальные данные LIVE матчей по их ID из SSTATS API
app.post("/api/live-matches-by-ids", async (req, res) => {
  try {
    const { matchIds } = req.body;
    
    console.log('📥 /api/live-matches-by-ids запрос:', matchIds);
    
    if (!Array.isArray(matchIds) || matchIds.length === 0) {
      return res.json([]);
    }
    
    if (!SSTATS_API_KEY) {
      console.error(`❌ SSTATS_API_KEY не задан`);
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }
    
    const allMatches = [];
    
    // Для каждого matchId получаем данные из БД
    for (const matchId of matchIds) {
      try {
        // Ищем матч по id ИЛИ по sstats_match_id (т.к. на фронте может использоваться SStats ID)
        let match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
        
        if (!match) {
          // Пробуем найти по sstats_match_id
          match = db.prepare('SELECT * FROM matches WHERE sstats_match_id = ?').get(matchId);
        }
        
        if (!match) {
          console.log(`⏭️ Матч ${matchId} не найден в БД (ни по id, ни по sstats_match_id)`);
          continue;
        }
        
        console.log(`📊 Матч ${matchId}: DB_id=${match.id}, team1=${match.team1_name}, team2=${match.team2_name}, sstats_id=${match.sstats_match_id}, score=${match.score}`);
        
        // Если есть sstats_match_id - загружаем из API
        if (match.sstats_match_id) {
          try {
            const url = `${SSTATS_API_BASE}/Games/${match.sstats_match_id}`;
            console.log(`🔍 Загружаем из API: ${url}`);
            const response = await fetch(url, {
              headers: { 'X-API-Key': SSTATS_API_KEY }
            });
            
            if (response.ok) {
              const result = await response.json();
              const details = result.data || result;
              const game = details.game;
              
              if (game) {
                console.log(`✅ API вернул данные для матча ${matchId}: ${game.homeResult || 0}:${game.awayResult || 0}`);
                allMatches.push({
                  id: matchId, // Используем тот ID который пришел в запросе (SStats ID)
                  dbId: match.id, // ID из нашей БД
                  team1: match.team1_name, // Русское название из БД
                  team2: match.team2_name, // Русское название из БД
                  homeTeam: match.team1_name,
                  awayTeam: match.team2_name,
                  score: `${game.homeResult || 0}:${game.awayResult || 0}`,
                  homeResult: game.homeResult || 0,
                  awayResult: game.awayResult || 0,
                  status: game.statusName || 'live',
                  statusName: game.statusName,
                  elapsed: game.elapsed
                });
                continue;
              }
            } else {
              console.log(`⚠️ API вернул ошибку ${response.status} для матча ${matchId}`);
            }
          } catch (apiError) {
            console.log(`⚠️ Ошибка API для матча ${matchId}: ${apiError.message}`);
          }
        }
        
        // Fallback: используем данные из БД
        console.log(`📦 Используем данные из БД для матча ${matchId}`);
        allMatches.push({
          id: matchId, // Используем тот ID который пришел в запросе
          dbId: match.id, // ID из нашей БД
          team1: match.team1_name,
          team2: match.team2_name,
          homeTeam: match.team1_name,
          awayTeam: match.team2_name,
          score: match.score || '0:0',
          homeResult: match.team1_score || 0,
          awayResult: match.team2_score || 0,
          status: match.winner ? 'Finished' : 'live',
          statusName: match.winner ? 'Finished' : 'Live',
          elapsed: null
        });
        
      } catch (error) {
        console.error(`⚠️ Ошибка обработки матча ${matchId}:`, error.message);
      }
    }
    
    console.log(`✅ Возвращаем ${allMatches.length} матчей из ${matchIds.length} запрошенных`);
    res.json(allMatches);
    
  } catch (error) {
    console.error("❌ /api/live-matches-by-ids ошибка:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/live-match-stats - Получить статистику LIVE матча
app.get("/api/live-match-stats", async (req, res) => {
  try {
    const { matchId, eventId } = req.query;
    
    if (!matchId) {
      return res.status(400).json({ error: "Требуется matchId" });
    }
    
    console.log(`📊 /api/live-match-stats запрос: matchId=${matchId}, eventId=${eventId}`);
    
    // Получаем информацию о матче из БД
    const match = db.prepare(`
      SELECT 
        m.*,
        e.name as event_name
      FROM matches m
      LEFT JOIN events e ON m.event_id = e.id
      WHERE m.id = ?
    `).get(matchId);
    
    if (!match) {
      return res.status(404).json({ error: "Матч не найден" });
    }
    
    console.log(`📋 Информация о матче из БД:`, {
      id: match.id,
      team1: match.team1_name,
      team2: match.team2_name,
      status: match.status,
      score: match.score,
      event_name: match.event_name
    });
    
    // Базовая информация о матче (всегда возвращаем)
    const result = {
      matchId: match.id,
      team1: match.team1_name,
      team2: match.team2_name,
      score: match.score || null,
      status: match.status === 'live' || match.status === 'in_progress' ? '🔴 LIVE' : 
              match.status === 'finished' ? '✅ Завершен' : 
              'Предстоящий',
      matchTime: match.match_time,
      elapsed: match.elapsed || null,
      statistics: [],
      events: [],
      lineups: null
    };
    
    console.log(`✅ Базовая статистика матча ${matchId} подготовлена, отправляем клиенту`);
    res.json(result);
    
  } catch (error) {
    console.error("❌ /api/live-match-stats ошибка:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notify-live-action - Уведомить админа о действиях пользователя в LIVE
app.post("/api/notify-live-action", async (req, res) => {
  try {
    const { username, action, details } = req.body;
    
    if (!username || !action) {
      return res.status(400).json({ error: "Требуются username и action" });
    }
    
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
    
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
      console.log("⚠️ Telegram не настроен, уведомление не отправлено");
      return res.json({ success: false });
    }
    
    const time = new Date().toLocaleString("ru-RU");
    let message = '';
    
    switch (action) {
      case 'open_live_tournament':
        message = `📺 ОТКРЫТ LIVE ТУРНИР\n\n👤 Пользователь: ${username}\n🏆 Турнир: ${details.tournamentName}\n🕐 Время: ${time}`;
        break;
      case 'add_favorite':
        message = `⭐ ДОБАВЛЕН В ИЗБРАННОЕ\n\n👤 Пользователь: ${username}\n⚽ Матч: ${details.match}\n🏆 Турнир: ${details.tournamentName}\n🕐 Время: ${time}`;
        break;
      case 'remove_favorite':
        message = `💔 УДАЛЕН ИЗ ИЗБРАННОГО\n\n👤 Пользователь: ${username}\n⚽ Матч: ${details.match}\n🏆 Турнир: ${details.tournamentName}\n🕐 Время: ${time}`;
        break;
      case 'open_match_stats':
        message = `📊 ОТКРЫТА СТАТИСТИКА МАТЧА\n\n👤 Пользователь: ${username}\n⚽ Матч: ${details.match}\n🏆 Турнир: ${details.tournamentName}\n📈 Статус: ${details.status}\n🕐 Время: ${time}`;
        break;
      default:
        message = `🔔 ДЕЙСТВИЕ В LIVE\n\n👤 Пользователь: ${username}\n📝 Действие: ${action}\n🕐 Время: ${time}`;
    }
    
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_ADMIN_ID,
            text: message,
          }),
        }
      );
      
      if (response.ok) {
        console.log(`✅ Уведомление админу отправлено: ${action} от ${username}`);
        res.json({ success: true });
      } else {
        console.error(`❌ Ошибка отправки уведомления: ${response.statusText}`);
        res.json({ success: false });
      }
    } catch (error) {
      console.error("❌ Ошибка отправки уведомления:", error);
      res.json({ success: false });
    }
    
  } catch (error) {
    console.error("❌ Ошибка в /api/notify-live-action:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/counting-bets", (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    if (!dateFrom || !dateTo) {
      return res
        .status(400)
        .json({ error: "Требуются даты dateFrom и dateTo" });
    }

    // Запрашиваем все ставки в статусе pending, которые были созданы в выбранный период
    const bets = db
      .prepare(
        `
      SELECT 
        b.*,
        u.username,
        m.team1_name,
        m.team2_name,
        m.winner,
        m.status as match_status,
        m.round,
        m.is_final,
        m.match_date,
        e.name as event_name,
        sp.score_team1,
        sp.score_team2
      FROM bets b
      JOIN users u ON b.user_id = u.id
      JOIN matches m ON b.match_id = m.id
      JOIN events e ON m.event_id = e.id
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      WHERE m.winner IS NULL
        AND DATE(m.match_date) >= DATE(?)
        AND DATE(m.match_date) <= DATE(?)
      ORDER BY e.name, u.username, m.match_date
    `
      )
      .all(dateFrom, dateTo);

    res.json(bets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/bets/:betId - Удалить ставку пользователя
app.delete("/api/bets/:betId", async (req, res) => {
  try {
    const { betId } = req.params;
    const { user_id, username } = req.body;

    // Проверяем, является ли пользователь админом
    const isAdmin = username === process.env.ADMIN_DB_NAME;

    // Проверяем, что ставка существует
    const bet = db.prepare("SELECT * FROM bets WHERE id = ?").get(betId);

    if (!bet) {
      return res.status(404).json({ error: "Ставка не найдена" });
    }

    // Получаем информацию о матче и пользователе для лога
    const match = db
      .prepare(
        "SELECT m.team1_name, m.team2_name, m.status, m.is_final, m.round, e.name as event_name FROM matches m LEFT JOIN events e ON m.event_id = e.id WHERE m.id = ?"
      )
      .get(bet.match_id);
    const betUser = db
      .prepare(
        "SELECT username, telegram_username, telegram_notifications_enabled FROM users WHERE id = ?"
      )
      .get(bet.user_id);

    // Если не админ - проверяем принадлежность ставки
    if (!isAdmin && bet.user_id !== user_id) {
      return res.status(403).json({ error: "Эта ставка не принадлежит вам" });
    }

    // Проверяем статус матча - нельзя удалять ставки на начавшиеся/завершённые матчи (кроме админа)
    if (!isAdmin) {
      if (
        match &&
        (match.status === "ongoing" || match.status === "finished")
      ) {
        return res.status(403).json({
          error: "Нельзя удалить ставку — матч уже начался или завершён",
        });
      }
    }

    db.prepare("DELETE FROM bets WHERE id = ?").run(betId);

    // Удаляем связанные прогнозы на счёт и карточки для этого матча и пользователя
    try {
      const deletedScorePredictions = db.prepare(
        "DELETE FROM score_predictions WHERE user_id = ? AND match_id = ?"
      ).run(bet.user_id, bet.match_id);
      
      if (deletedScorePredictions.changes > 0) {
        console.log(`🗑️ Удалён прогноз на счёт для матча ${bet.match_id}`);
      }

      const deletedCardsPredictions = db.prepare(
        "DELETE FROM cards_predictions WHERE user_id = ? AND match_id = ?"
      ).run(bet.user_id, bet.match_id);
      
      if (deletedCardsPredictions.changes > 0) {
        console.log(`🗑️ Удалён прогноз на карточки для матча ${bet.match_id}`);
      }
    } catch (e) {
      console.warn(`⚠️ Ошибка при удалении связанных прогнозов: ${e.message}`);
    }

    // Если это была финальная ставка - проверяем есть ли еще ставки на этот матч
    if (bet.is_final_bet) {
      const remainingBets = db
        .prepare(
          "SELECT COUNT(*) as cnt FROM bets WHERE match_id = ? AND is_final_bet = 1"
        )
        .get(bet.match_id);

      // Если нет больше финальных ставок на этот матч - удаляем параметры финала
      if (remainingBets.cnt === 0) {
        try {
          db.prepare(
            "DELETE FROM final_parameters_results WHERE match_id = ?"
          ).run(bet.match_id);
          console.log(`🗑️ Удалены параметры финала для матча ${bet.match_id}`);
        } catch (e) {
          console.warn(`⚠️ Не удалось удалить параметры финала: ${e.message}`);
        }
      }
    }

    // Получаем прогноз на счет если есть (до удаления ставки)
    let scorePrediction = null;
    if (!bet.is_final_bet) {
      scorePrediction = db
        .prepare("SELECT score_team1, score_team2 FROM score_predictions WHERE user_id = ? AND match_id = ?")
        .get(bet.user_id, bet.match_id);
    }

    // Записываем лог удаления ставки
    writeBetLog("deleted", {
      username: betUser?.username || "неизвестный",
      prediction: bet.prediction,
      team1: match?.team1_name || "?",
      team2: match?.team2_name || "?",
      eventName: match?.event_name,
      is_final_bet: bet.is_final_bet,
      parameter_type: bet.parameter_type,
      is_final_match: match?.is_final,
      round: match?.round,
      score_team1: scorePrediction?.score_team1,
      score_team2: scorePrediction?.score_team2,
    });

    // Отправляем уведомление админу об удалении ставки
    try {
      let predictionText = bet.prediction === "draw" ? "Ничья" : bet.prediction;
      
      // Если прогноз содержит название команды, используем его как есть
      // Если это "team1" или "team2", преобразуем в названия команд
      if (bet.prediction === "team1" || bet.prediction === match?.team1_name) {
        predictionText = match?.team1_name || "?";
      } else if (bet.prediction === "team2" || bet.prediction === match?.team2_name) {
        predictionText = match?.team2_name || "?";
      }
      
      await notifyBetDeleted(
        betUser?.username || "неизвестный",
        match?.team1_name || "?",
        match?.team2_name || "?",
        predictionText,
        match?.event_name
      );
    } catch (err) {
      console.error("⚠️ Ошибка отправки уведомления админу об удалении ставки:", err.message);
      // Не прерываем процесс удаления ставки если ошибка в отправке уведомления
    }

    // Отправляем личное сообщение пользователю в Telegram об удалении ставки если он не отключил уведомления
    if (
      betUser?.telegram_username &&
      betUser?.telegram_notifications_enabled !== 0
    ) {
      try {
        const cleanUsername = betUser.telegram_username.toLowerCase();
        const tgUser = db
          .prepare(
            "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?"
          )
          .get(cleanUsername);

        if (tgUser?.chat_id) {
          let predictionText =
            bet.prediction === "draw" ? "Ничья" : bet.prediction;

          // Если прогноз содержит название команды, используем его как есть
          // Если это "team1" или "team2", преобразуем в названия команд
          if (
            bet.prediction === "team1" ||
            bet.prediction === match?.team1_name
          ) {
            predictionText = match?.team1_name || "?";
          } else if (
            bet.prediction === "team2" ||
            bet.prediction === match?.team2_name
          ) {
            predictionText = match?.team2_name || "?";
          }

          const deleteMessage =
            `❌ <b>СТАВКА УДАЛЕНА!</b>\n\n` +
            `⚽ <b>${match?.team1_name || "?"}</b> vs <b>${
              match?.team2_name || "?"
            }</b>\n` +
            `🎯 Прогноз: <b>${predictionText}</b>\n` +
            `🏆 Турнир: ${match?.event_name || "Неизвестный"}\n\n` +
            `⏰ ${new Date().toLocaleString("ru-RU")}`;

          await sendUserMessage(tgUser.chat_id, deleteMessage);
        }
      } catch (err) {
        console.error(
          "⚠️ Ошибка отправки уведомления об удалении ставки в Telegram:",
          err.message
        );
        // Не прерываем процесс удаления ставки если ошибка в отправке уведомления
      }
    }

    res.json({ message: "Ставка удалена" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== ПРОГНОЗЫ НА СЧЕТ =====

// POST /api/score-predictions - Создать/обновить прогноз на счет
app.post("/api/score-predictions", async (req, res) => {
  try {
    const { user_id, match_id, score_team1, score_team2 } = req.body;

    // Получаем информацию о пользователе
    const user = db
      .prepare("SELECT username, telegram_username, telegram_notifications_enabled FROM users WHERE id = ?")
      .get(user_id);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем матч
    const match = db
      .prepare(
        `SELECT m.status, m.match_date, m.winner, m.team1_name, m.team2_name, m.score_prediction_enabled, e.name as event_name 
         FROM matches m 
         LEFT JOIN events e ON m.event_id = e.id 
         WHERE m.id = ?`
      )
      .get(match_id);

    if (!match) {
      return res.status(404).json({ error: "Матч не найден" });
    }

    if (!match.score_prediction_enabled) {
      return res.status(400).json({ error: "Прогноз на счет не включен для этого матча" });
    }

    // Проверяем статус матча
    const now = new Date();
    const matchDate = match.match_date ? new Date(match.match_date) : null;

    if (matchDate && matchDate <= now) {
      return res.status(400).json({ error: "Матч уже начался" });
    }

    if (match.winner) {
      return res.status(400).json({ error: "Матч уже завершен" });
    }

    // Проверяем корректность счета
    if (score_team1 < 0 || score_team2 < 0) {
      return res.status(400).json({ error: "Счет не может быть отрицательным" });
    }

    // Получаем ставку пользователя на этот матч
    const userBet = db
      .prepare("SELECT prediction FROM bets WHERE user_id = ? AND match_id = ? AND is_final_bet = 0")
      .get(user_id, match_id);

    // Проверяем существует ли уже прогноз
    const existingPrediction = db
      .prepare("SELECT id FROM score_predictions WHERE user_id = ? AND match_id = ?")
      .get(user_id, match_id);

    const isNewPrediction = !existingPrediction;

    if (existingPrediction) {
      // Обновляем существующий прогноз
      db.prepare(
        "UPDATE score_predictions SET score_team1 = ?, score_team2 = ? WHERE user_id = ? AND match_id = ?"
      ).run(score_team1, score_team2, user_id, match_id);
    } else {
      // Создаем новый прогноз
      db.prepare(
        "INSERT INTO score_predictions (user_id, match_id, score_team1, score_team2) VALUES (?, ?, ?, ?)"
      ).run(user_id, match_id, score_team1, score_team2);
    }

    // Отправляем уведомление в Telegram только для новых прогнозов
    if (isNewPrediction && userBet) {
      try {
        // Определяем текст прогноза на результат
        let predictionText = userBet.prediction === "draw" ? "Ничья" : userBet.prediction;
        
        if (userBet.prediction === "team1" || userBet.prediction === match.team1_name) {
          predictionText = match.team1_name;
        } else if (userBet.prediction === "team2" || userBet.prediction === match.team2_name) {
          predictionText = match.team2_name;
        }

        // Отправляем уведомление пользователю (если у него включены уведомления)
        if (user.telegram_notifications_enabled && user.telegram_username) {
          const cleanUsername = user.telegram_username.toLowerCase();
          const tgUser = db
            .prepare(
              "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?"
            )
            .get(cleanUsername);

          if (tgUser?.chat_id) {
            const scoreMessage =
              `📊 <b>НОВЫЙ ПРОГНОЗ НА СЧЕТ!</b>\n\n` +
              `⚽ <b>${match.team1_name}</b> vs <b>${match.team2_name}</b>\n` +
              `🎯 Прогноз: <b>${predictionText}</b>\n` +
              `🎯 Прогноз счета: <b>${score_team1}-${score_team2}</b>\n` +
              `🏆 Турнир: ${match.event_name || "Неизвестный"}\n` +
              `⏰ ${new Date().toLocaleString("ru-RU")}`;

            await sendUserMessage(tgUser.chat_id, scoreMessage);
          }
        }
        
        // Отправляем уведомление админу ВСЕГДА
        await notifyNewScorePrediction(
          user.username,
          match.team1_name,
          match.team2_name,
          predictionText,
          score_team1,
          score_team2,
          match.event_name
        );
      } catch (err) {
        console.error(
          "⚠️ Ошибка отправки уведомления о прогнозе на счет в Telegram:",
          err.message
        );
        // Не прерываем процесс сохранения прогноза если ошибка в отправке уведомления
      }
    }

    // Записываем лог прогноза на счет только для новых прогнозов
    if (isNewPrediction && userBet) {
      // Определяем текст прогноза на результат
      let predictionText = userBet.prediction === "draw" ? "Ничья" : userBet.prediction;
      
      if (userBet.prediction === "team1" || userBet.prediction === match.team1_name) {
        predictionText = match.team1_name;
      } else if (userBet.prediction === "team2" || userBet.prediction === match.team2_name) {
        predictionText = match.team2_name;
      }

      // Получаем полную информацию о матче включая тур
      const fullMatch = db
        .prepare("SELECT round FROM matches WHERE id = ?")
        .get(match_id);

      writeBetLog("placed", {
        username: user.username,
        prediction: predictionText,
        team1: match.team1_name,
        team2: match.team2_name,
        eventName: match.event_name,
        is_final_bet: false,
        parameter_type: null,
        is_final_match: false,
        round: fullMatch?.round,
        score_team1: score_team1,
        score_team2: score_team2,
      });
    }

    res.json({ message: "Прогноз на счет сохранен" });
  } catch (error) {
    console.error("Ошибка при сохранении прогноза на счет:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cards-predictions - Создать/обновить прогноз на карточки
app.post("/api/cards-predictions", async (req, res) => {
  try {
    const { user_id, match_id, yellow_cards, red_cards } = req.body;

    // Получаем информацию о пользователе
    const user = db
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(user_id);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем матч
    const match = db
      .prepare(
        `SELECT m.status, m.match_date, m.winner, m.yellow_cards_prediction_enabled, m.red_cards_prediction_enabled
         FROM matches m 
         WHERE m.id = ?`
      )
      .get(match_id);

    if (!match) {
      return res.status(404).json({ error: "Матч не найден" });
    }

    if (!match.yellow_cards_prediction_enabled && !match.red_cards_prediction_enabled) {
      return res.status(400).json({ error: "Прогноз на карточки не включен для этого матча" });
    }

    // Проверяем статус матча
    const now = new Date();
    const matchDate = match.match_date ? new Date(match.match_date) : null;

    if (matchDate && matchDate <= now) {
      return res.status(400).json({ error: "Матч уже начался" });
    }

    if (match.winner) {
      return res.status(400).json({ error: "Матч уже завершен" });
    }

    // Проверяем корректность данных
    if (yellow_cards !== null && (yellow_cards < 0 || yellow_cards > 20)) {
      return res.status(400).json({ error: "Количество желтых карточек должно быть от 0 до 20" });
    }

    if (red_cards !== null && (red_cards < 0 || red_cards > 10)) {
      return res.status(400).json({ error: "Количество красных карточек должно быть от 0 до 10" });
    }

    // Проверяем существует ли уже прогноз
    const existingPrediction = db
      .prepare("SELECT id FROM cards_predictions WHERE user_id = ? AND match_id = ?")
      .get(user_id, match_id);

    if (existingPrediction) {
      // Обновляем существующий прогноз
      db.prepare(
        "UPDATE cards_predictions SET yellow_cards = ?, red_cards = ? WHERE user_id = ? AND match_id = ?"
      ).run(yellow_cards, red_cards, user_id, match_id);
    } else {
      // Создаем новый прогноз
      db.prepare(
        "INSERT INTO cards_predictions (user_id, match_id, yellow_cards, red_cards) VALUES (?, ?, ?, ?)"
      ).run(user_id, match_id, yellow_cards, red_cards);
    }

    // Получаем информацию о матче для уведомления
    const matchInfo = db.prepare(`
      SELECT m.team1_name, m.team2_name, m.match_date, e.name as event_name
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.id = ?
    `).get(match_id);

    // Формируем текст прогноза
    let predictionText = [];
    if (yellow_cards !== null && match.yellow_cards_prediction_enabled) {
      predictionText.push(`🟨 Жёлтые карточки: ${yellow_cards}`);
    }
    if (red_cards !== null && match.red_cards_prediction_enabled) {
      predictionText.push(`🟥 Красные карточки: ${red_cards}`);
    }

    // Отправляем уведомление пользователю
    const userMessage = 
      `✅ <b>Прогноз на карточки сохранён!</b>\n\n` +
      `⚽ <b>Матч:</b> ${matchInfo.team1_name} vs ${matchInfo.team2_name}\n` +
      `🏆 <b>Турнир:</b> ${matchInfo.event_name}\n` +
      `📅 <b>Дата:</b> ${new Date(matchInfo.match_date).toLocaleString('ru-RU')}\n\n` +
      `${predictionText.join('\n')}`;

    await notifyUser(user_id, userMessage);

    // Отправляем уведомление админу
    const adminMessage = 
      `📊 <b>Новый прогноз на карточки</b>\n\n` +
      `👤 <b>Пользователь:</b> ${user.username}\n` +
      `⚽ <b>Матч:</b> ${matchInfo.team1_name} vs ${matchInfo.team2_name}\n` +
      `🏆 <b>Турнир:</b> ${matchInfo.event_name}\n` +
      `📅 <b>Дата:</b> ${new Date(matchInfo.match_date).toLocaleString('ru-RU')}\n\n` +
      `Система прогноза на карточки работает`;

    await notifyAdmin(adminMessage);

    res.json({ message: "Прогноз на карточки сохранен" });
  } catch (error) {
    console.error("Ошибка при сохранении прогноза на карточки:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/score-predictions/:matchId - Удалить прогноз на счет
app.delete("/api/score-predictions/:matchId", async (req, res) => {
  try {
    const { matchId } = req.params;
    const { user_id } = req.body;

    // Проверяем существует ли прогноз
    const prediction = db
      .prepare("SELECT id FROM score_predictions WHERE user_id = ? AND match_id = ?")
      .get(user_id, matchId);

    if (!prediction) {
      return res.status(404).json({ error: "Прогноз не найден" });
    }

    db.prepare("DELETE FROM score_predictions WHERE user_id = ? AND match_id = ?")
      .run(user_id, matchId);

    res.json({ message: "Прогноз на счет удален" });
  } catch (error) {
    console.error("Ошибка при удалении прогноза на счет:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/cards-predictions/:matchId - Удалить прогноз на карточки
app.delete("/api/cards-predictions/:matchId", async (req, res) => {
  try {
    const { matchId } = req.params;
    const { user_id } = req.body;

    // Проверяем существует ли прогноз
    const prediction = db
      .prepare("SELECT id FROM cards_predictions WHERE user_id = ? AND match_id = ?")
      .get(user_id, matchId);

    if (!prediction) {
      return res.status(404).json({ error: "Прогноз не найден" });
    }

    db.prepare("DELETE FROM cards_predictions WHERE user_id = ? AND match_id = ?")
      .run(user_id, matchId);

    res.json({ message: "Прогноз на карточки удален" });
  } catch (error) {
    console.error("Ошибка при удалении прогноза на карточки:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/match-bet-stats/:matchId - Получить статистику ставок по матчу
app.get("/api/match-bet-stats/:matchId", (req, res) => {
  try {
    const { matchId } = req.params;

    // Получаем все ставки на этот матч (только обычные, не финальные)
    const bets = db
      .prepare(
        `SELECT prediction FROM bets 
         WHERE match_id = ? AND (is_final_bet = 0 OR is_final_bet IS NULL)`
      )
      .all(matchId);

    if (bets.length === 0) {
      return res.json({
        total: 0,
        team1: 0,
        draw: 0,
        team2: 0,
        team1Percent: 0,
        drawPercent: 0,
        team2Percent: 0,
      });
    }

    // Подсчитываем количество ставок на каждый исход
    const stats = {
      team1: 0,
      draw: 0,
      team2: 0,
    };

    bets.forEach((bet) => {
      if (bet.prediction === "team1") {
        stats.team1++;
      } else if (bet.prediction === "draw") {
        stats.draw++;
      } else if (bet.prediction === "team2") {
        stats.team2++;
      }
    });

    const total = bets.length;

    // Вычисляем проценты
    const team1Percent = Math.round((stats.team1 / total) * 100);
    const drawPercent = Math.round((stats.draw / total) * 100);
    const team2Percent = Math.round((stats.team2 / total) * 100);

    res.json({
      total,
      team1: stats.team1,
      draw: stats.draw,
      team2: stats.team2,
      team1Percent,
      drawPercent,
      team2Percent,
    });
  } catch (error) {
    console.error("Ошибка при получении статистики ставок:", error);
    res.status(500).json({ error: error.message });
  }
});

// 8. Получить всех участников с количеством ставок
app.get("/api/participants", (req, res) => {
  try {
    const participants = db
      .prepare(
        `
      SELECT 
        u.id,
        u.username,
        u.telegram_username,
        u.avatar,
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 1
          ELSE 0
        END) as total_bets,
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN
                       -- Базовое очко за угаданный результат (3 за финал, 1 за обычный матч)
                       CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
                       -- Дополнительное очко за угаданный счет
                       CASE 
                         WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                              ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                              sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
                         THEN 1 
                         ELSE 0 
                       END
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_bets,
        -- Количество угаданных ставок (для процента побед)
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_count,
        SUM(CASE 
          WHEN (m.winner IS NOT NULL OR fpr.id IS NOT NULL) THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN NOT ((b.prediction = 'team1' AND m.winner = 'team1') OR
                            (b.prediction = 'team2' AND m.winner = 'team2') OR
                            (b.prediction = 'draw' AND m.winner = 'draw') OR
                            (b.prediction = m.team1_name AND m.winner = 'team1') OR
                            (b.prediction = m.team2_name AND m.winner = 'team2')) THEN 1 
                  ELSE 0 
                END
              -- Финальные параметры
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) != fpr.yellow_cards THEN 2
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) != fpr.red_cards THEN 2
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) != fpr.corners THEN 2
                  WHEN b.parameter_type = 'exact_score' AND b.prediction != fpr.exact_score THEN 2
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction != fpr.penalties_in_game THEN 2
                  WHEN b.parameter_type = 'extra_time' AND b.prediction != fpr.extra_time THEN 2
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction != fpr.penalties_at_end THEN 2
                  ELSE 0
                END
              ELSE 0 
            END 
          ELSE 0 
        END) as lost_bets,
        SUM(CASE 
          WHEN (b.is_final_bet = 0 AND m.winner IS NULL) OR 
               (b.is_final_bet = 1 AND fpr.id IS NULL) THEN 1 
          ELSE 0 
        END) as pending_bets
      FROM users u
      LEFT JOIN bets b ON u.id = b.user_id
      LEFT JOIN matches m ON b.match_id = m.id
      LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN match_scores ms ON b.match_id = ms.match_id
      GROUP BY u.id, u.username, u.avatar
      ORDER BY COUNT(b.id) DESC
    `
      )
      .all();

    // Для каждого участника подсчитываем победы в турнирах (заблокированных событиях)
    const result = participants.map((participant) => {
      // Получаем все завершенные турниры (с locked_reason)
      const tournaments = db
        .prepare(
          `
        SELECT DISTINCT e.id, e.name, e.icon
        FROM events e
        WHERE e.locked_reason IS NOT NULL
      `
        )
        .all();

      let tournament_wins = 0;
      let won_icons = [];

      // Для каждого завершенного турнира проверяем, выиграл ли участник
      tournaments.forEach((tournament) => {
        // Подсчитываем выигрыши участника в этом турнире
        const userWinsInTournament =
          db
            .prepare(
              `
          SELECT COUNT(*) as wins
          FROM bets b
          JOIN matches m ON b.match_id = m.id
          WHERE b.user_id = ?
          AND m.event_id = ?
          AND m.winner IS NOT NULL
          AND (
            (b.prediction = 'team1' AND m.winner = 'team1') OR
            (b.prediction = 'team2' AND m.winner = 'team2') OR
            (b.prediction = 'draw' AND m.winner = 'draw') OR
            (b.prediction = m.team1_name AND m.winner = 'team1') OR
            (b.prediction = m.team2_name AND m.winner = 'team2')
          )
        `
            )
            .get(participant.id, tournament.id)?.wins || 0;

        // Подсчитываем максимальные выигрыши в этом турнире (кто первый)
        const maxWinsInTournament =
          db
            .prepare(
              `
          SELECT MAX(wins) as max_wins
          FROM (
            SELECT 
              b.user_id,
              COUNT(*) as wins
            FROM bets b
            JOIN matches m ON b.match_id = m.id
            WHERE m.event_id = ?
            AND m.winner IS NOT NULL
            AND (
              (b.prediction = 'team1' AND m.winner = 'team1') OR
              (b.prediction = 'team2' AND m.winner = 'team2') OR
              (b.prediction = 'draw' AND m.winner = 'draw') OR
              (b.prediction = m.team1_name AND m.winner = 'team1') OR
              (b.prediction = m.team2_name AND m.winner = 'team2')
            )
            GROUP BY b.user_id
          )
        `
            )
            .get(tournament.id)?.max_wins || 0;

        // Если участник имеет максимальные выигрыши в турнире — он победитель
        if (
          userWinsInTournament > 0 &&
          userWinsInTournament === maxWinsInTournament
        ) {
          tournament_wins++;
          won_icons.push(tournament.icon);
        }
      });

      return {
        ...participant,
        tournament_wins,
        won_icons,
      };
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Получить профиль пользователя
app.get("/api/user/:userId/profile", async (req, res) => {
  try {
    const { userId } = req.params;
    const viewerUsername = req.query.viewerUsername; // Кто смотрит профиль

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    
    // Отправляем уведомление админу если кто-то смотрит чужой профиль
    if (viewerUsername && viewerUsername !== user.username) {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
      
      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const message = `👁️ ПРОСМОТР ПРОФИЛЯ

👤 Кто смотрит: ${viewerUsername}
🎯 Чей профиль: ${user.username}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

        try {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: message,
            }),
          });
        } catch (error) {
          console.error("⚠️ Не удалось отправить уведомление о просмотре профиля:", error);
        }
      }
    }

    const bets = db
      .prepare(
        `
      SELECT 
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 1
          ELSE 0
        END) as total_bets,
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN
                       -- Базовое очко за угаданный результат (3 за финал, 1 за обычный матч)
                       CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
                       -- Дополнительное очко за угаданный счет
                       CASE 
                         WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                              ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                              sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
                         THEN 1 
                         ELSE 0 
                       END
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_bets,
        -- Количество угаданных ставок (для процента побед)
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_count,
        SUM(CASE 
          WHEN (m.winner IS NOT NULL OR fpr.id IS NOT NULL) THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN NOT ((b.prediction = 'team1' AND m.winner = 'team1') OR
                            (b.prediction = 'team2' AND m.winner = 'team2') OR
                            (b.prediction = 'draw' AND m.winner = 'draw') OR
                            (b.prediction = m.team1_name AND m.winner = 'team1') OR
                            (b.prediction = m.team2_name AND m.winner = 'team2')) THEN 1 
                  ELSE 0 
                END
              -- Финальные параметры
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) != fpr.yellow_cards THEN 2
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) != fpr.red_cards THEN 2
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) != fpr.corners THEN 2
                  WHEN b.parameter_type = 'exact_score' AND b.prediction != fpr.exact_score THEN 2
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction != fpr.penalties_in_game THEN 2
                  WHEN b.parameter_type = 'extra_time' AND b.prediction != fpr.extra_time THEN 2
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction != fpr.penalties_at_end THEN 2
                  ELSE 0
                END
              ELSE 0 
            END 
          ELSE 0 
        END) as lost_bets,
        SUM(CASE 
          WHEN (b.is_final_bet = 0 AND m.winner IS NULL) OR 
               (b.is_final_bet = 1 AND fpr.id IS NULL) THEN 1 
          ELSE 0 
        END) as pending_bets
      FROM bets b
      LEFT JOIN matches m ON b.match_id = m.id
      LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN match_scores ms ON b.match_id = ms.match_id
      WHERE b.user_id = ?
    `
      )
      .get(userId);

    const profile = {
      id: user.id,
      username: user.username,
      email: user.email,
      created_at: user.created_at,
      avatar: user.avatar || null,
      total_bets: bets.total_bets || 0,
      won_bets: bets.won_bets || 0,
      won_count: bets.won_count || 0,
      lost_bets: bets.lost_bets || 0,
      pending_bets: bets.pending_bets || 0,
    };

    // Подсчитываем количество побед в турнирах
    const tournamentWins = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM tournament_awards
        WHERE user_id = ?
      `
      )
      .get(userId);

    profile.tournament_wins = tournamentWins?.count || 0;

    // Рассчитываем максимальную серию угаданных ставок подряд
    const allBets = db
      .prepare(
        `
        SELECT 
          b.id,
          b.created_at,
          m.event_id,
          e.name as event_name,
          CASE 
            -- Обычные ставки
            WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
              CASE 
                WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                     (b.prediction = 'team2' AND m.winner = 'team2') OR
                     (b.prediction = 'draw' AND m.winner = 'draw') OR
                     (b.prediction = m.team1_name AND m.winner = 'team1') OR
                     (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
                ELSE 0
              END
            -- Финальные параметры
            WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
              CASE 
                WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                ELSE 0
              END
            ELSE NULL
          END as is_won
        FROM bets b
        LEFT JOIN matches m ON b.match_id = m.id
        LEFT JOIN events e ON m.event_id = e.id
        LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
        WHERE b.user_id = ? AND (m.winner IS NOT NULL OR fpr.id IS NOT NULL)
        ORDER BY b.created_at ASC
      `
      )
      .all(userId);

    let maxStreak = 0;
    let currentStreak = 0;
    let maxStreakEventId = null;
    let maxStreakEventName = null;
    let currentStreakEventId = null;

    allBets.forEach(bet => {
      if (bet.is_won === 1) {
        currentStreak++;
        if (currentStreak === 1) {
          currentStreakEventId = bet.event_id;
        }
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
          maxStreakEventId = currentStreakEventId;
          maxStreakEventName = bet.event_name;
        }
      } else {
        currentStreak = 0;
        currentStreakEventId = null;
      }
    });

    profile.max_win_streak = maxStreak;
    profile.max_win_streak_event = maxStreakEventName;

    // Подсчитываем статистику по сетке плей-офф
    const bracketStats = db.prepare(`
      SELECT 
        COUNT(*) as total_bracket_predictions,
        SUM(CASE WHEN bp.predicted_winner = br.actual_winner THEN 1 ELSE 0 END) as correct_bracket_predictions,
        SUM(CASE WHEN bp.predicted_winner != br.actual_winner THEN 1 ELSE 0 END) as incorrect_bracket_predictions
      FROM bracket_predictions bp
      LEFT JOIN bracket_results br ON bp.bracket_id = br.bracket_id 
        AND bp.stage = br.stage 
        AND bp.match_index = br.match_index
      WHERE bp.user_id = ? AND br.actual_winner IS NOT NULL
    `).get(userId);

    profile.bracket_correct = bracketStats?.correct_bracket_predictions || 0;
    profile.bracket_incorrect = bracketStats?.incorrect_bracket_predictions || 0;

    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Получить награды пользователя
app.get("/api/user/:userId/awards", (req, res) => {
  try {
    const { userId } = req.params;

    const awards = db
      .prepare(
        `
      SELECT ta.id, ta.event_name, ta.won_bets, ta.awarded_at, e.icon as event_icon
      FROM tournament_awards ta
      LEFT JOIN events e ON ta.event_id = e.id
      WHERE ta.user_id = ?
      ORDER BY ta.awarded_at DESC
    `
      )
      .all(userId);

    console.log(`📦 Получены награды для пользователя ${userId}:`, awards);

    res.json(awards || []);
  } catch (error) {
    console.error("Ошибка при получении наград:", error);
    res.status(500).json({ error: error.message });
  }
});

// 11. Уведомление админу о сравнении участников
app.post("/api/notify-comparison", async (req, res) => {
  try {
    const { viewerUsername, user1Username, user2Username, eventName } = req.body;

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      const message = `⚖️ СРАВНЕНИЕ УЧАСТНИКОВ

👤 Кто сравнивает: ${viewerUsername}
🆚 Сравнивает: ${user1Username} vs ${user2Username}
${eventName ? `🏆 Турнир: ${eventName}` : '🌐 Глобальное сравнение'}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

      try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_ADMIN_ID,
            text: message,
          }),
        });
        console.log("✅ Уведомление о сравнении отправлено админу");
      } catch (error) {
        console.error("⚠️ Не удалось отправить уведомление о сравнении:", error);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Ошибка при отправке уведомления о сравнении:", error);
    res.status(500).json({ error: error.message });
  }
});

// 12. Уведомление админу об открытии информации о турнире
app.post("/api/notify-tournament-info", async (req, res) => {
  try {
    const { username, eventName } = req.body;

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      const message = `ℹ️ ПРОСМОТР ИНФОРМАЦИИ О ТУРНИРЕ

👤 Пользователь: ${username}
${eventName ? `🏆 Турнир: ${eventName}` : ''}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

      try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_ADMIN_ID,
            text: message,
          }),
        });
        console.log("✅ Уведомление о просмотре информации отправлено админу");
      } catch (error) {
        console.error("⚠️ Не удалось отправить уведомление о просмотре информации:", error);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Ошибка при отправке уведомления о просмотре информации:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/avatar - Сохранить аватар пользователя
app.post("/api/user/:userId/avatar", (req, res) => {
  try {
    const { userId } = req.params;
    const { avatarData, fileType } = req.body;

    if (!avatarData) {
      return res.status(400).json({ error: "Данные аватара не предоставлены" });
    }

    // Определяем расширение файла на основе MIME type
    let extension = "png"; // По умолчанию PNG
    if (fileType === "image/jpeg" || fileType === "image/jpg") {
      extension = "jpg";
    }

    // Удаляем старый аватар если существует
    const user = db
      .prepare("SELECT avatar FROM users WHERE id = ?")
      .get(userId);
    if (user && user.avatar && user.avatar.startsWith("/img/avatar/")) {
      const oldFilename = user.avatar.split("/").pop();
      const oldFilepath = path.join(__dirname, "img", "avatar", oldFilename);
      try {
        if (fs.existsSync(oldFilepath)) {
          fs.unlinkSync(oldFilepath);
          console.log(`🗑️ Старый файл аватара удален: ${oldFilepath}`);
        }
      } catch (fileErr) {
        console.warn(`⚠️ Не удалось удалить старый файл: ${fileErr.message}`);
      }
    }

    // Конвертируем base64 в буфер
    const base64Data = avatarData.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Сохраняем файл в папку img/avatar/
    const filename = `user_${userId}_avatar.${extension}`;
    const filepath = path.join(__dirname, "img", "avatar", filename);

    fs.writeFileSync(filepath, buffer);

    // Сохраняем путь к файлу в БД
    const avatarPath = `/img/avatar/${filename}`;
    db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(
      avatarPath,
      userId
    );

    const finalSize = fs.statSync(filepath).size;
    res.json({
      success: true,
      message: "Аватар сохранен",
      avatarPath: avatarPath,
      fileSize: finalSize,
    });
  } catch (error) {
    console.error("Ошибка при сохранении аватара:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/user/:userId/avatar - Удалить аватар пользователя
app.delete("/api/user/:userId/avatar", (req, res) => {
  try {
    const { userId } = req.params;

    // Получаем текущий путь аватара
    const user = db
      .prepare("SELECT avatar FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Если есть аватар - удаляем файл
    if (user.avatar && user.avatar.startsWith("/img/avatar/")) {
      const filename = user.avatar.split("/").pop();
      const filepath = path.join(__dirname, "img", "avatar", filename);

      try {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
          console.log(`🗑️ Файл аватара удален: ${filepath}`);
        }
      } catch (fileErr) {
        console.warn(`⚠️ Не удалось удалить файл: ${fileErr.message}`);
      }
    }

    // Очищаем поле avatar в БД (устанавливаем NULL)
    db.prepare("UPDATE users SET avatar = NULL WHERE id = ?").run(userId);

    res.json({ success: true, message: "Аватар удален" });
  } catch (error) {
    console.error("Ошибка при удалении аватара:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/:userId/username - Изменить username пользователя
app.put("/api/user/:userId/username", async (req, res) => {
  try {
    const { userId } = req.params;
    const { username } = req.body;

    // Валидация
    if (!username || username.trim().length === 0) {
      return res.status(400).json({ error: "Имя не может быть пустым" });
    }
    if (username.length > 30) {
      return res
        .status(400)
        .json({ error: "Имя слишком длинное (макс 30 символов)" });
    }

    // Проверяем есть ли пользователь
    const user = db
      .prepare("SELECT id, username, telegram_id FROM users WHERE id = ?")
      .get(userId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Автоматически делаем первую букву заглавной
    const capitalizedUsername = username.charAt(0).toUpperCase() + username.slice(1);

    // Проверяем не используется ли это имя другим пользователем
    const existingUser = db
      .prepare("SELECT id FROM users WHERE username = ? AND id != ?")
      .get(capitalizedUsername, userId);

    if (existingUser) {
      return res.status(400).json({ error: "Это имя уже используется" });
    }

    // Проверка на запрещенные имена
    const forbiddenBase = capitalizedUsername.toLowerCase().replace(/[\s\d\.\-]/g, ''); // Убираем пробелы, цифры, точки, дефисы
    if (forbiddenBase === 'мемослав' || forbiddenBase === 'memoslav' || forbiddenBase === 'memoslave') {
      return res.status(400).json({ error: "Are you, ohuel tam?" });
    }

    // Обновляем имя
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(
      capitalizedUsername,
      userId
    );

    // Удаляем все сессии пользователя (разлогиниваем со всех устройств)
    const deletedSessions = db
      .prepare("DELETE FROM sessions WHERE user_id = ?")
      .run(userId);

    // Логируем
    console.log(
      `✅ Username изменён для пользователя ${userId}: "${user.username}" → "${capitalizedUsername}"`
    );
    console.log(`🔓 Удалено сессий: ${deletedSessions.changes}`);

    // Отправляем уведомление пользователю в Telegram если он привязал аккаунт
    if (user.telegram_id) {
      const userMessage = `👤 ИЗМЕНЕНИЕ ИМЕНИ

Ваше имя было успешно изменено:
• Старое имя: ${user.username}
• Новое имя: ${capitalizedUsername}

🔓 Вы были разлогинены со всех устройств (${deletedSessions.changes} сессий).
Войдите заново с новым именем.

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        if (TELEGRAM_BOT_TOKEN) {
          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: user.telegram_id,
                text: userMessage,
              }),
            }
          );
          console.log(`✅ Уведомление о смене имени отправлено пользователю ${capitalizedUsername}`);
        }
      } catch (error) {
        console.error("⚠️ Не удалось отправить уведомление пользователю:", error);
      }
    }

    // Отправляем уведомление админу в Telegram (не блокируем ответ)
    const notificationMessage = `👤 ПЕРЕИМЕНОВАНИЕ ПОЛЬЗОВАТЕЛЯ

📝 Пользователь самостоятельно изменил имя:
• Старое имя: ${user.username}
• Новое имя: ${capitalizedUsername}
• ID пользователя: ${userId}
• Удалено сессий: ${deletedSessions.changes}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

    // Отправляем уведомление асинхронно, не дожидаясь результата
    notifyAdmin(notificationMessage).catch(err => {
      console.error("⚠️ Не удалось отправить уведомление админу:", err);
    });

    res.json({ 
      success: true, 
      username: capitalizedUsername, 
      message: "Имя успешно изменено. Войдите заново с новым именем",
      deletedSessions: deletedSessions.changes
    });
  } catch (error) {
    console.error("Ошибка при изменении username:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/telegram - Получить Telegram username пользователя
app.get("/api/user/:userId/telegram", (req, res) => {
  try {
    const { userId } = req.params;
    const user = db
      .prepare("SELECT telegram_username FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({ telegram_username: user.telegram_username || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/:userId/telegram - Сохранить/обновить Telegram username
app.put("/api/user/:userId/telegram", async (req, res) => {
  try {
    const { userId } = req.params;
    let { telegram_username } = req.body;

    // Убираем @ если пользователь его ввёл
    if (telegram_username && telegram_username.startsWith("@")) {
      telegram_username = telegram_username.substring(1);
    }

    // Приводим к нижнему регистру
    if (telegram_username) {
      telegram_username = telegram_username.toLowerCase();
    }

    // Проверяем существование пользователя
    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем уникальность Telegram username
    if (telegram_username) {
      const existingUser = db
        .prepare("SELECT id FROM users WHERE LOWER(telegram_username) = ? AND id != ?")
        .get(telegram_username, userId);
      
      if (existingUser) {
        return res.status(400).json({ 
          error: `Telegram @${telegram_username} уже привязан к другому аккаунту` 
        });
      }
    }

    const oldTelegramUsername = user.telegram_username;

    // Получаем telegram_id (chat_id) из telegram_users если пользователь уже писал боту
    let telegramId = null;
    if (telegram_username) {
      const telegramUser = db
        .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
        .get(telegram_username);
      
      if (telegramUser && telegramUser.chat_id) {
        telegramId = telegramUser.chat_id;
      }
    }

    // Обновляем telegram_username и telegram_id
    db.prepare("UPDATE users SET telegram_username = ?, telegram_id = ? WHERE id = ?").run(
      telegram_username || null,
      telegramId,
      userId
    );

    // Отправляем уведомление админу и личное сообщение пользователю
    if (telegram_username && telegram_username !== oldTelegramUsername) {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const time = new Date().toLocaleString("ru-RU");
        const action = oldTelegramUsername ? "изменил" : "добавил";

        // Уведомление админу
        const adminMessage = `📱 TELEGRAM USERNAME

👤 Пользователь: ${user.username}
✏️ Действие: ${action} свой ТГ
📲 Username: @${telegram_username}
🕐 Время: ${time}`;

        try {
          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: TELEGRAM_ADMIN_ID,
                text: adminMessage,
              }),
            }
          );
        } catch (err) {
          console.error("❌ Ошибка отправки уведомления админу:", err);
        }

        // Личное сообщение пользователю
        const cleanUsername = telegram_username.toLowerCase();
        const telegramUser = db
          .prepare(
            "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?"
          )
          .get(cleanUsername);

        if (telegramUser && telegramUser.chat_id) {
          // Пользователь уже писал боту - отправляем личное сообщение напрямую
          notifyTelegramLinked(
            user.username,
            telegram_username,
            telegramUser.chat_id
          );
          console.log(
            `✅ Уведомление о привязке отправлено @${telegram_username} (${telegramUser.chat_id})`
          );
        } else {
          // Если пользователь ещё не писал боту, добавляем уведомление в очередь
          // чтобы отправить как только пользователь напишет боту
          notifyTelegramLinked(user.username, telegram_username);
          console.log(
            `📱 Уведомление о привязке добавлено в очередь для @${telegram_username}`
          );
        }
      }

      // Записываем в лог изменение настроек
      writeBetLog("settings", {
        username: user.username,
        setting: "Telegram",
        oldValue: oldTelegramUsername ? `@${oldTelegramUsername}` : null,
        newValue: `@${telegram_username}`,
      });
    }

    res.json({
      success: true,
      message: "Telegram username сохранён",
      telegram_username: telegram_username || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/user/:userId/telegram - Удалить Telegram username
app.delete("/api/user/:userId/telegram", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const oldTelegramUsername = user.telegram_username;

    db.prepare("UPDATE users SET telegram_username = NULL WHERE id = ?").run(
      userId
    );

    // Отправляем уведомление админу если telegram_username был удалён
    if (oldTelegramUsername) {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const time = new Date().toLocaleString("ru-RU");
        const message = `📱 УДАЛЕНИЕ TELEGRAM USERNAME

👤 Пользователь: ${user.username}
✏️ Действие: удалил привязку Telegram
📲 Был: @${oldTelegramUsername}
🕐 Время: ${time}`;

        try {
          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: TELEGRAM_ADMIN_ID,
                text: message,
              }),
            }
          );
        } catch (err) {
          console.error("❌ Ошибка отправки уведомления в Telegram:", err);
        }
      }
    }

    // Записываем в лог удаление настройки
    if (oldTelegramUsername) {
      writeBetLog("settings", {
        username: user.username,
        setting: "Telegram",
        oldValue: `@${oldTelegramUsername}`,
        newValue: null,
      });
    }

    res.json({
      success: true,
      message: "Telegram username удалён",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Хранилище кодов подтверждения (в памяти, можно перенести в БД)
const confirmationCodes = new Map();

// Вспомогательная функция для отправки сообщения пользователю по telegram_username
async function sendTelegramMessageByUsername(telegram_username, message) {
  const cleanUsername = telegram_username.toLowerCase();
  const telegramUser = db
    .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
    .get(cleanUsername);

  if (!telegramUser || !telegramUser.chat_id) {
    throw new Error(`Пользователь @${telegram_username} не найден в Telegram или не писал боту`);
  }

  await sendUserMessage(telegramUser.chat_id, message);
}

// POST /api/user/:userId/telegram/request-change - Запросить изменение Telegram username
app.post("/api/user/:userId/telegram/request-change", async (req, res) => {
  try {
    const { userId } = req.params;
    const { new_telegram_username } = req.body;

    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);
    
    if (!user || !user.telegram_username) {
      return res.status(404).json({ error: "Пользователь не найден или Telegram не привязан" });
    }

    // Генерируем 6-значный код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Сохраняем код с временем истечения (5 минут)
    confirmationCodes.set(`change_${userId}`, {
      code,
      newUsername: new_telegram_username,
      expires: Date.now() + 5 * 60 * 1000
    });

    // Отправляем код в Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (TELEGRAM_BOT_TOKEN) {
      const message = `🔐 КОД ПОДТВЕРЖДЕНИЯ

Вы запросили изменение Telegram логина на сайте 1xBetLineBoom.

Новый логин: @${new_telegram_username}

Ваш код подтверждения: <code>${code}</code>

Код действителен 5 минут.

Если это были не вы, проигнорируйте это сообщение.`;

      try {
        await sendTelegramMessageByUsername(user.telegram_username, message);
        res.json({ success: true, message: "Код отправлен в Telegram" });
      } catch (err) {
        console.error("❌ Ошибка отправки кода:", err);
        res.status(500).json({ error: "Не удалось отправить код в Telegram. Убедитесь, что вы писали боту." });
      }
    } else {
      res.status(500).json({ error: "Telegram бот не настроен" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/telegram/confirm-change - Подтвердить изменение Telegram username
app.post("/api/user/:userId/telegram/confirm-change", async (req, res) => {
  try {
    const { userId } = req.params;
    const { new_telegram_username, confirmation_code } = req.body;

    const stored = confirmationCodes.get(`change_${userId}`);
    
    if (!stored) {
      return res.status(400).json({ error: "Код не найден. Запросите новый код." });
    }

    if (Date.now() > stored.expires) {
      confirmationCodes.delete(`change_${userId}`);
      return res.status(400).json({ error: "Код истек. Запросите новый код." });
    }

    if (stored.code !== confirmation_code) {
      return res.status(400).json({ error: "Неверный код подтверждения" });
    }

    if (stored.newUsername !== new_telegram_username) {
      return res.status(400).json({ error: "Логин не совпадает с запрошенным" });
    }

    // Проверяем уникальность нового Telegram username
    let cleanNewUsername = new_telegram_username;
    if (cleanNewUsername && cleanNewUsername.startsWith("@")) {
      cleanNewUsername = cleanNewUsername.substring(1);
    }

    // Приводим к нижнему регистру
    if (cleanNewUsername) {
      cleanNewUsername = cleanNewUsername.toLowerCase();
    }

    if (cleanNewUsername) {
      const existingUser = db
        .prepare("SELECT id FROM users WHERE LOWER(telegram_username) = ? AND id != ?")
        .get(cleanNewUsername, userId);
      
      if (existingUser) {
        confirmationCodes.delete(`change_${userId}`);
        return res.status(400).json({ 
          error: `Telegram @${cleanNewUsername} уже привязан к другому аккаунту` 
        });
      }
    }

    // Код верный, обновляем username
    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    const oldUsername = user.telegram_username;

    // Получаем telegram_id (chat_id) из telegram_users
    let telegramId = null;
    if (cleanNewUsername) {
      const telegramUser = db
        .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
        .get(cleanNewUsername);
      
      if (telegramUser && telegramUser.chat_id) {
        telegramId = telegramUser.chat_id;
      }
    }

    // Обновляем telegram_username и telegram_id
    db.prepare("UPDATE users SET telegram_username = ?, telegram_id = ? WHERE id = ?").run(
      cleanNewUsername,
      telegramId,
      userId
    );

    // Удаляем использованный код
    confirmationCodes.delete(`change_${userId}`);

    // Уведомляем админа
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      const time = new Date().toLocaleString("ru-RU");
      const message = `📱 ИЗМЕНЕНИЕ TELEGRAM USERNAME

👤 Пользователь: ${user.username}
✏️ Действие: изменил Telegram логин
📲 Было: @${oldUsername}
📲 Стало: @${cleanNewUsername}
🕐 Время: ${time}`;

      try {
        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: message,
            }),
          }
        );
      } catch (err) {
        console.error("❌ Ошибка отправки уведомления:", err);
      }
    }

    res.json({ success: true, message: "Telegram username успешно изменен" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/telegram/request-delete - Запросить удаление Telegram username
app.post("/api/user/:userId/telegram/request-delete", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);
    
    if (!user || !user.telegram_username) {
      return res.status(404).json({ error: "Пользователь не найден или Telegram не привязан" });
    }

    // Генерируем 6-значный код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Сохраняем код с временем истечения (5 минут)
    confirmationCodes.set(`delete_${userId}`, {
      code,
      expires: Date.now() + 5 * 60 * 1000
    });

    // Отправляем код в Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (TELEGRAM_BOT_TOKEN) {
      const message = `🔐 КОД ПОДТВЕРЖДЕНИЯ

Вы запросили удаление Telegram логина на сайте 1xBetLineBoom.

Ваш код подтверждения: <code>${code}</code>

Код действителен 5 минут.

Если это были не вы, проигнорируйте это сообщение.`;

      try {
        await sendTelegramMessageByUsername(user.telegram_username, message);
        res.json({ success: true, message: "Код отправлен в Telegram" });
      } catch (err) {
        console.error("❌ Ошибка отправки кода:", err);
        res.status(500).json({ error: "Не удалось отправить код в Telegram. Убедитесь, что вы писали боту." });
      }
    } else {
      res.status(500).json({ error: "Telegram бот не настроен" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/telegram/confirm-delete - Подтвердить удаление Telegram username
app.post("/api/user/:userId/telegram/confirm-delete", async (req, res) => {
  try {
    const { userId } = req.params;
    const { confirmation_code } = req.body;

    const stored = confirmationCodes.get(`delete_${userId}`);
    
    if (!stored) {
      return res.status(400).json({ error: "Код не найден. Запросите новый код." });
    }

    if (Date.now() > stored.expires) {
      confirmationCodes.delete(`delete_${userId}`);
      return res.status(400).json({ error: "Код истек. Запросите новый код." });
    }

    if (stored.code !== confirmation_code) {
      return res.status(400).json({ error: "Неверный код подтверждения" });
    }

    // Код верный, удаляем username
    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    const oldUsername = user.telegram_username;

    db.prepare("UPDATE users SET telegram_username = NULL WHERE id = ?").run(userId);

    // Удаляем использованный код
    confirmationCodes.delete(`delete_${userId}`);

    // Уведомляем админа
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      const time = new Date().toLocaleString("ru-RU");
      const message = `📱 УДАЛЕНИЕ TELEGRAM USERNAME

👤 Пользователь: ${user.username}
✏️ Действие: удалил привязку Telegram (с подтверждением)
📲 Был: @${oldUsername}
🕐 Время: ${time}`;

      try {
        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: message,
            }),
          }
        );
      } catch (err) {
        console.error("❌ Ошибка отправки уведомления:", err);
      }
    }

    res.json({ success: true, message: "Telegram username успешно удален" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions - Создать новую сессию
app.post("/api/sessions", async (req, res) => {
  try {
    const { user_id, device_info, browser, os } = req.body;

    // Получаем IP адрес
    const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';

    // Проверяем, есть ли уже сессия с таким же устройством и IP
    const existingSession = db.prepare(`
      SELECT session_token, is_trusted FROM sessions 
      WHERE user_id = ? AND device_info = ? AND browser = ? AND os = ? AND ip_address = ?
    `).get(user_id, device_info, browser, os, ip_address);

    if (existingSession) {
      // Обновляем last_activity существующей сессии
      db.prepare(`
        UPDATE sessions 
        SET last_activity = CURRENT_TIMESTAMP 
        WHERE session_token = ?
      `).run(existingSession.session_token);

      return res.json({ 
        success: true, 
        session_token: existingSession.session_token,
        message: "Сессия обновлена" 
      });
    }

    // Проверяем, было ли это устройство доверенным ранее (даже если сессия была удалена)
    const wasTrusted = db.prepare(`
      SELECT is_trusted FROM sessions 
      WHERE user_id = ? AND device_info = ? AND browser = ? AND os = ? AND ip_address = ? AND is_trusted = 1
      ORDER BY created_at DESC LIMIT 1
    `).get(user_id, device_info, browser, os, ip_address);

    const is_trusted = wasTrusted ? 1 : 0;

    console.log("🔧 Создание новой сессии:");
    console.log("  User ID:", user_id);
    console.log("  Device:", device_info);
    console.log("  Browser:", browser);
    console.log("  OS:", os);
    console.log("  IP:", ip_address);
    console.log("  Было доверенным ранее:", wasTrusted ? "ДА" : "НЕТ");
    console.log("  is_trusted:", is_trusted);

    // Генерируем уникальный токен сессии
    const session_token = `${user_id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Создаем новую сессию с сохранением статуса доверенного устройства
    db.prepare(`
      INSERT INTO sessions (user_id, session_token, device_info, browser, os, ip_address, is_trusted)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user_id, session_token, device_info, browser, os, ip_address, is_trusted);

    res.json({ 
      success: true, 
      session_token,
      message: "Сессия создана" 
    });
  } catch (error) {
    console.error("❌ Ошибка создания сессии:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/sessions - Получить все сессии пользователя
app.get("/api/user/:userId/sessions", async (req, res) => {
  try {
    const { userId } = req.params;

    const sessions = db.prepare(`
      SELECT id, session_token, device_info, browser, os, ip_address, 
             last_activity, created_at, is_trusted
      FROM sessions
      WHERE user_id = ?
      ORDER BY last_activity DESC
    `).all(userId);

    res.json(sessions);
  } catch (error) {
    console.error("❌ Ошибка получения сессий:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:sessionToken/validate - Проверить валидность сессии
app.get("/api/sessions/:sessionToken/validate", async (req, res) => {
  try {
    const { sessionToken } = req.params;

    const session = db.prepare(`
      SELECT id FROM sessions WHERE session_token = ?
    `).get(sessionToken);

    if (!session) {
      return res.status(404).json({ valid: false, error: "Сессия не найдена" });
    }

    res.json({ valid: true });
  } catch (error) {
    console.error("❌ Ошибка валидации сессии:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/user/:userId/sessions/:sessionToken - Удалить конкретную сессию
app.delete("/api/user/:userId/sessions/:sessionToken", async (req, res) => {
  try {
    const { userId, sessionToken } = req.params;

    // Проверяем, что сессия принадлежит пользователю
    const session = db.prepare(`
      SELECT id FROM sessions WHERE user_id = ? AND session_token = ?
    `).get(userId, sessionToken);

    if (!session) {
      return res.status(404).json({ error: "Сессия не найдена" });
    }

    // Удаляем сессию
    db.prepare("DELETE FROM sessions WHERE session_token = ?").run(sessionToken);

    res.json({ success: true, message: "Сессия удалена" });
  } catch (error) {
    console.error("❌ Ошибка удаления сессии:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/sessions/:sessionToken/request-logout - Запросить выход с устройства
app.post("/api/user/:userId/sessions/:sessionToken/request-logout", async (req, res) => {
  try {
    const { userId, sessionToken } = req.params;

    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);
    
    if (!user || !user.telegram_username) {
      return res.status(404).json({ error: "Пользователь не найден или Telegram не привязан" });
    }

    // Проверяем, что сессия принадлежит пользователю
    const session = db.prepare(`
      SELECT device_info, browser, os FROM sessions WHERE user_id = ? AND session_token = ?
    `).get(userId, sessionToken);

    if (!session) {
      return res.status(404).json({ error: "Сессия не найдена" });
    }

    // Генерируем 6-значный код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Сохраняем код с временем истечения (5 минут)
    confirmationCodes.set(`logout_${userId}_${sessionToken}`, {
      code,
      expires: Date.now() + 5 * 60 * 1000
    });

    // Отправляем код в Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (TELEGRAM_BOT_TOKEN) {
      const message = `🔐 КОД ПОДТВЕРЖДЕНИЯ

Вы запросили выход с устройства на сайте 1xBetLineBoom.

Устройство: ${session.device_info || 'Неизвестно'}
Браузер: ${session.browser || 'Неизвестно'}
ОС: ${session.os || 'Неизвестно'}

Ваш код подтверждения: <code>${code}</code>

Код действителен 5 минут.

Если это были не вы, проигнорируйте это сообщение.`;

      try {
        await sendTelegramMessageByUsername(user.telegram_username, message);
        res.json({ success: true, message: "Код отправлен в Telegram" });
      } catch (err) {
        console.error("❌ Ошибка отправки кода:", err);
        res.status(500).json({ error: "Не удалось отправить код в Telegram. Убедитесь, что вы писали боту." });
      }
    } else {
      res.status(500).json({ error: "Telegram бот не настроен" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/sessions/:sessionToken/confirm-logout - Подтвердить выход с устройства
app.post("/api/user/:userId/sessions/:sessionToken/confirm-logout", async (req, res) => {
  try {
    const { userId, sessionToken } = req.params;
    const { confirmation_code } = req.body;

    const stored = confirmationCodes.get(`logout_${userId}_${sessionToken}`);
    
    if (!stored) {
      return res.status(400).json({ error: "Код не найден. Запросите новый код." });
    }

    if (Date.now() > stored.expires) {
      confirmationCodes.delete(`logout_${userId}_${sessionToken}`);
      return res.status(400).json({ error: "Код истек. Запросите новый код." });
    }

    if (stored.code !== confirmation_code) {
      return res.status(400).json({ error: "Неверный код подтверждения" });
    }

    // Код верный, удаляем сессию
    const user = db
      .prepare("SELECT id, username FROM users WHERE id = ?")
      .get(userId);

    const session = db.prepare(`
      SELECT device_info, browser, os FROM sessions WHERE user_id = ? AND session_token = ?
    `).get(userId, sessionToken);

    if (!session) {
      confirmationCodes.delete(`logout_${userId}_${sessionToken}`);
      return res.status(404).json({ error: "Сессия не найдена" });
    }

    // Удаляем сессию
    db.prepare("DELETE FROM sessions WHERE session_token = ?").run(sessionToken);

    // Удаляем использованный код
    confirmationCodes.delete(`logout_${userId}_${sessionToken}`);

    // Уведомляем админа
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      const time = new Date().toLocaleString("ru-RU");
      const message = `📱 ВЫХОД С УСТРОЙСТВА

👤 Пользователь: ${user.username}
✏️ Действие: завершил сеанс на устройстве (с подтверждением)
📱 Устройство: ${session.device_info || 'Неизвестно'}
🌐 Браузер: ${session.browser || 'Неизвестно'}
💻 ОС: ${session.os || 'Неизвестно'}
🕐 Время: ${time}`;

      try {
        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: message,
            }),
          }
        );
      } catch (err) {
        console.error("❌ Ошибка отправки уведомления:", err);
      }
    }

    res.json({ success: true, message: "Сессия успешно удалена" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/sessions/:sessionToken/request-trust - Запросить изменение статуса доверенного устройства
app.post("/api/user/:userId/sessions/:sessionToken/request-trust", async (req, res) => {
  try {
    const { userId, sessionToken } = req.params;
    const { is_trusted } = req.body;

    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);
    
    if (!user || !user.telegram_username) {
      return res.status(404).json({ error: "Пользователь не найден или Telegram не привязан" });
    }

    // Проверяем, что сессия принадлежит пользователю
    const session = db.prepare(`
      SELECT device_info, browser, os FROM sessions WHERE user_id = ? AND session_token = ?
    `).get(userId, sessionToken);

    if (!session) {
      return res.status(404).json({ error: "Сессия не найдена" });
    }

    // Генерируем 6-значный код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Сохраняем код с временем истечения (5 минут)
    confirmationCodes.set(`trust_${userId}_${sessionToken}`, {
      code,
      expires: Date.now() + 5 * 60 * 1000
    });

    // Отправляем код в Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (TELEGRAM_BOT_TOKEN) {
      const action = is_trusted ? 'добавить в доверенные' : 'убрать из доверенных';
      const message = `🔐 КОД ПОДТВЕРЖДЕНИЯ

Вы запросили изменение статуса устройства на сайте 1xBetLineBoom.

Устройство: ${session.device_info || 'Неизвестно'}
Браузер: ${session.browser || 'Неизвестно'}
ОС: ${session.os || 'Неизвестно'}

Действие: ${action}

Ваш код подтверждения: <code>${code}</code>

Код действителен 5 минут.

Если это были не вы, проигнорируйте это сообщение.`;

      try {
        await sendTelegramMessageByUsername(user.telegram_username, message);
        res.json({ success: true, message: "Код отправлен в Telegram" });
      } catch (err) {
        console.error("❌ Ошибка отправки кода:", err);
        res.status(500).json({ error: "Не удалось отправить код в Telegram. Убедитесь, что вы писали боту." });
      }
    } else {
      res.status(500).json({ error: "Telegram бот не настроен" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/sessions/:sessionToken/confirm-trust - Подтвердить изменение статуса доверенного устройства
app.post("/api/user/:userId/sessions/:sessionToken/confirm-trust", async (req, res) => {
  try {
    const { userId, sessionToken } = req.params;
    const { confirmation_code, is_trusted } = req.body;

    const stored = confirmationCodes.get(`trust_${userId}_${sessionToken}`);
    
    if (!stored) {
      return res.status(400).json({ error: "Код не найден. Запросите новый код." });
    }

    if (Date.now() > stored.expires) {
      confirmationCodes.delete(`trust_${userId}_${sessionToken}`);
      return res.status(400).json({ error: "Код истек. Запросите новый код." });
    }

    if (stored.code !== confirmation_code) {
      return res.status(400).json({ error: "Неверный код подтверждения" });
    }

    // Код верный, обновляем статус доверенного устройства
    const user = db
      .prepare("SELECT id, username FROM users WHERE id = ?")
      .get(userId);

    const session = db.prepare(`
      SELECT device_info, browser, os, is_trusted FROM sessions WHERE user_id = ? AND session_token = ?
    `).get(userId, sessionToken);

    if (!session) {
      confirmationCodes.delete(`trust_${userId}_${sessionToken}`);
      return res.status(404).json({ error: "Сессия не найдена" });
    }

    console.log("🔒 Обновление статуса доверенного устройства:");
    console.log("  User ID:", userId);
    console.log("  Session Token:", sessionToken);
    console.log("  Текущий is_trusted:", session.is_trusted);
    console.log("  Новый is_trusted:", is_trusted ? 1 : 0);

    // Обновляем статус
    const updateResult = db.prepare("UPDATE sessions SET is_trusted = ? WHERE session_token = ?").run(is_trusted ? 1 : 0, sessionToken);
    
    console.log("  Обновлено строк:", updateResult.changes);

    // Проверяем что обновилось
    const updatedSession = db.prepare("SELECT is_trusted FROM sessions WHERE session_token = ?").get(sessionToken);
    console.log("  Проверка после обновления - is_trusted:", updatedSession ? updatedSession.is_trusted : "сессия не найдена");

    // Удаляем использованный код
    confirmationCodes.delete(`trust_${userId}_${sessionToken}`);

    // Уведомляем админа
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      const time = new Date().toLocaleString("ru-RU");
      const action = is_trusted ? 'добавил в доверенные' : 'убрал из доверенных';
      const message = `🔒 ИЗМЕНЕНИЕ СТАТУСА УСТРОЙСТВА

👤 Пользователь: ${user.username}
✏️ Действие: ${action} устройство (с подтверждением)
📱 Устройство: ${session.device_info || 'Неизвестно'}
🌐 Браузер: ${session.browser || 'Неизвестно'}
💻 ОС: ${session.os || 'Неизвестно'}
🕐 Время: ${time}`;

      try {
        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: message,
            }),
          }
        );
      } catch (err) {
        console.error("❌ Ошибка отправки уведомления:", err);
      }
    }

    res.json({ success: true, message: "Статус устройства успешно изменен" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Получить все турниры (для админа)
app.get("/api/admin/all-events", (req, res) => {
  try {
    const events = db
      .prepare(
        `SELECT e.*, COUNT(m.id) as match_count 
         FROM events e 
         LEFT JOIN matches m ON e.id = m.event_id 
         GROUP BY e.id
         ORDER BY e.status DESC, e.start_date DESC`
      )
      .all();
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// PUT /api/user/:userId/settings - Управление настройками пользователя
app.put("/api/user/:userId/settings", async (req, res) => {
  try {
    const { userId } = req.params;
    const { telegram_notifications_enabled, telegram_group_reminders_enabled, theme, require_login_2fa, live_sound } =
      req.body;

    // Проверяем существование пользователя
    const user = db
      .prepare("SELECT id, username, telegram_username, theme FROM users WHERE id = ?")
      .get(userId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Обновляем настройку подтверждения логина через бота (если передана)
    if (require_login_2fa !== undefined) {
      const login2faEnabled = require_login_2fa ? 1 : 0;
      
      // Получаем старое значение
      const oldValue = db.prepare("SELECT require_login_2fa FROM users WHERE id = ?").get(userId);
      
      db.prepare(
        "UPDATE users SET require_login_2fa = ? WHERE id = ?"
      ).run(login2faEnabled, userId);

      // Записываем в лог изменение настройки
      writeBetLog("settings", {
        username: user.username,
        setting: "Login 2FA",
        oldValue: oldValue?.require_login_2fa ? "Включено" : "Отключено",
        newValue: login2faEnabled ? "Включено" : "Отключено",
      });

      // Отправляем уведомление админу об изменении настройки 2FA
      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
          const time = new Date().toLocaleString("ru-RU");
          const statusIcon = login2faEnabled ? '🔐' : '🔓';
          const statusText = login2faEnabled ? 'Включено' : 'Отключено';

          const adminMessage = `${statusIcon} ИЗМЕНЕНИЕ НАСТРОЙКИ 2FA

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Подтверждение логина через бота: ${statusText}
🕐 Время: ${time}`;

          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: TELEGRAM_ADMIN_ID,
                text: adminMessage,
              }),
            }
          );
        }
      } catch (err) {
        console.error(
          "⚠️ Ошибка отправки уведомления админу об изменении 2FA:",
          err.message
        );
      }
    }

    // Обновляем тему (если передана)
    if (theme !== undefined) {
      const oldTheme = user.theme || 'theme-default';
      db.prepare(
        "UPDATE users SET theme = ? WHERE id = ?"
      ).run(theme, userId);

      // Записываем в лог изменение темы
      writeBetLog("settings", {
        username: user.username,
        setting: "Theme",
        oldValue: oldTheme,
        newValue: theme,
      });

      // Отправляем уведомление админу об изменении темы
      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
          const time = new Date().toLocaleString("ru-RU");
          const themeNames = {
            'theme-default': 'Дефолтная',
            'theme-hacker-green': '💻 Hacker Green',
            'theme-solarized': '🌅 Solarized',
            'theme-matrix': '🟢 Matrix',
            'theme-cyberpunk': '🌃 Cyberpunk',
            'theme-leagueChampions': '🏆 League Champions',
            'theme-leagueEurope': '⭐ League Europe'
          };

          const adminMessage = `🎨 ИЗМЕНЕНИЕ ТЕМЫ

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Новая тема: ${themeNames[theme] || theme}
🕐 Время: ${time}`;

          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: TELEGRAM_ADMIN_ID,
                text: adminMessage,
              }),
            }
          );
        }
      } catch (err) {
        console.error(
          "⚠️ Ошибка отправки уведомления админу об изменении темы:",
          err.message
        );
      }
    }

    // Обновляем настройки (если они переданы)
    if (telegram_notifications_enabled !== undefined) {
      const notificationEnabled = telegram_notifications_enabled ? 1 : 0;
      db.prepare(
        "UPDATE users SET telegram_notifications_enabled = ? WHERE id = ?"
      ).run(notificationEnabled, userId);

      // Отправляем сообщение в Telegram при изменении настройки личных уведомлений
      if (user.telegram_username) {
        try {
          const cleanUsername = user.telegram_username.toLowerCase();
          const tgUser = db
            .prepare(
              "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?"
            )
            .get(cleanUsername);

          if (tgUser?.chat_id) {
            let notificationMessage;

            if (notificationEnabled === 0) {
              // Отключение уведомлений
              notificationMessage =
                `🔕 <b>УВЕДОМЛЕНИЯ ОТКЛЮЧЕНЫ</b>\n\n` +
                `Личные уведомления о ставках и результатах отключены.\n\n` +
                `Вы можете включить их снова в настройках профиля.\n\n` +
                `⏰ ${new Date().toLocaleString("ru-RU")}`;
            } else {
              // Включение уведомлений
              notificationMessage =
                `🔔 <b>УВЕДОМЛЕНИЯ ВКЛЮЧЕНЫ</b>\n\n` +
                `Личные уведомления о ставках и результатах включены!\n\n` +
                `Теперь ты будешь получать сообщения при создании и удалении ставок.\n\n` +
                `⏰ ${new Date().toLocaleString("ru-RU")}`;
            }

            await sendUserMessage(tgUser.chat_id, notificationMessage);
          }
        } catch (err) {
          console.error(
            "⚠️ Ошибка отправки сообщения об изменении уведомлений:",
            err.message
          );
          // Не прерываем процесс сохранения если ошибка в отправке
        }
      }

      // Записываем в лог изменение настройки
      writeBetLog("settings", {
        username: user.username,
        setting: "Telegram Notifications",
        oldValue: null,
        newValue: notificationEnabled ? "Включены" : "Отключены",
      });

      // Отправляем уведомление админу об изменении настроек уведомлений
      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
          const time = new Date().toLocaleString("ru-RU");
          const action = notificationEnabled ? "ВКЛЮЧИЛ" : "ОТКЛЮЧИЛ";
          const emoji = notificationEnabled ? "🔔" : "🔕";

          const adminMessage = `${emoji} ИЗМЕНЕНИЕ УВЕДОМЛЕНИЙ

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Действие: ${action} уведомления
🕐 Время: ${time}`;

          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: TELEGRAM_ADMIN_ID,
                text: adminMessage,
              }),
            }
          );
        }
      } catch (err) {
        console.error(
          "⚠️ Ошибка отправки уведомления админу об уведомлениях:",
          err.message
        );
        // Не прерываем процесс если ошибка в отправке админу
      }
    }

    // Обновляем настройку напоминаний в группе
    if (telegram_group_reminders_enabled !== undefined) {
      const groupRemindersEnabled = telegram_group_reminders_enabled ? 1 : 0;
      db.prepare(
        "UPDATE users SET telegram_group_reminders_enabled = ? WHERE id = ?"
      ).run(groupRemindersEnabled, userId);

      // Записываем в лог изменение настройки
      writeBetLog("settings", {
        username: user.username,
        setting: "Telegram Group Reminders",
        oldValue: null,
        newValue: groupRemindersEnabled ? "Включены" : "Отключены",
      });

      // Отправляем уведомление админу об изменении настроек напоминаний в группе
      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
          const time = new Date().toLocaleString("ru-RU");
          const action = groupRemindersEnabled ? "ВКЛЮЧИЛ" : "ОТКЛЮЧИЛ";
          const emoji = groupRemindersEnabled ? "👥" : "🔇";

          const adminMessage = `${emoji} ИЗМЕНЕНИЕ НАПОМИНАНИЙ В ГРУППЕ

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Действие: ${action} напоминания в группе
🕐 Время: ${time}`;

          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: TELEGRAM_ADMIN_ID,
                text: adminMessage,
              }),
            }
          );
        }
      } catch (err) {
        console.error(
          "⚠️ Ошибка отправки уведомления админу о напоминаниях в группе:",
          err.message
        );
        // Не прерываем процесс если ошибка в отправке админу
      }
    }

    // Обновляем настройку звука в LIVE матчах (если передана)
    if (live_sound !== undefined) {
      const liveSoundEnabled = live_sound ? 1 : 0;
      
      // Получаем старое значение
      const oldValue = db.prepare("SELECT live_sound FROM users WHERE id = ?").get(userId);
      
      db.prepare(
        "UPDATE users SET live_sound = ? WHERE id = ?"
      ).run(liveSoundEnabled, userId);

      // Записываем в лог изменение настройки
      writeBetLog("settings", {
        username: user.username,
        setting: "Live Sound",
        oldValue: oldValue?.live_sound ? "Включен" : "Отключен",
        newValue: liveSoundEnabled ? "Включен" : "Отключен",
      });

      // Отправляем уведомление админу об изменении настройки звука
      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
          const time = new Date().toLocaleString("ru-RU");
          const statusIcon = liveSoundEnabled ? '🔊' : '🔇';
          const statusText = liveSoundEnabled ? 'Включен' : 'Отключен';

          const adminMessage = `${statusIcon} ИЗМЕНЕНИЕ НАСТРОЙКИ ЗВУКА LIVE

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Звук в LIVE матчах: ${statusText}
🕐 Время: ${time}`;

          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: TELEGRAM_ADMIN_ID,
                text: adminMessage,
              }),
            }
          );
        }
      } catch (err) {
        console.error(
          "⚠️ Ошибка отправки уведомления админу об изменении звука LIVE:",
          err.message
        );
      }
    }

    res.json({
      success: true,
      message: "Настройки сохранены",
      telegram_notifications_enabled: telegram_notifications_enabled,
      telegram_group_reminders_enabled: telegram_group_reminders_enabled,
      theme: theme,
      live_sound: live_sound,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/notifications - Получить настройки уведомлений
app.get("/api/user/:userId/notifications", (req, res) => {
  try {
    const { userId } = req.params;
    const user = db
      .prepare(
        "SELECT telegram_notifications_enabled, telegram_group_reminders_enabled, theme, live_sound FROM users WHERE id = ?"
      )
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({
      telegram_notifications_enabled: user.telegram_notifications_enabled === 1,
      telegram_group_reminders_enabled:
        user.telegram_group_reminders_enabled === 1,
      theme: user.theme || 'theme-default',
      live_sound: user.live_sound === 1,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/show-bets - Получить настройку показа ставок
app.get("/api/user/:userId/show-bets", (req, res) => {
  try {
    const { userId } = req.params;
    
    let user;
    
    // Пытаемся получить пользователя
    try {
      user = db
        .prepare("SELECT show_bets FROM users WHERE id = ?")
        .get(userId);
    } catch (error) {
      // Если колонка не существует, добавляем её
      if (error.message.includes("no such column: show_bets")) {
        console.log("⚠️ Колонка show_bets отсутствует, добавляем...");
        db.exec(`ALTER TABLE users ADD COLUMN show_bets TEXT DEFAULT 'always'`);
        console.log("✅ Колонка show_bets добавлена в таблицу users");
        
        // Повторно получаем пользователя
        user = db
          .prepare("SELECT show_bets FROM users WHERE id = ?")
          .get(userId);
      } else {
        throw error;
      }
    }

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const showBets = user.show_bets || 'always';

    res.json({
      show_bets: showBets,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении настройки show_bets:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/:userId/show-bets - Сохранить настройку показа ставок
app.put("/api/user/:userId/show-bets", async (req, res) => {
  try {
    const { userId } = req.params;
    const { show_bets } = req.body;

    if (!show_bets || !['always', 'after_start'].includes(show_bets)) {
      return res.status(400).json({ error: "Неверное значение show_bets" });
    }

    const user = db
      .prepare("SELECT username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем существование колонки и добавляем если нужно
    try {
      db.prepare("UPDATE users SET show_bets = ? WHERE id = ?").run(show_bets, userId);
    } catch (error) {
      // Если колонка не существует, добавляем её
      if (error.message.includes("no such column: show_bets")) {
        console.log("⚠️ Колонка show_bets отсутствует, добавляем...");
        db.exec(`ALTER TABLE users ADD COLUMN show_bets TEXT DEFAULT 'always'`);
        console.log("✅ Колонка show_bets добавлена в таблицу users");
        
        // Повторяем UPDATE
        db.prepare("UPDATE users SET show_bets = ? WHERE id = ?").run(show_bets, userId);
      } else {
        throw error;
      }
    }

    // Записываем в логи
    const showBetsNames = {
      'always': 'Да (всегда показывать)',
      'after_start': 'Только после начала матча'
    };
    
    writeBetLog("settings", {
      username: user.username,
      setting: "Показывать ставки другим",
      newValue: showBetsNames[show_bets] || show_bets
    });

    // Отправляем уведомление админу
    try {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const time = new Date().toLocaleString("ru-RU", {
          timeZone: "Europe/Moscow",
        });

        const showBetsNames = {
          'always': 'Да (всегда показывать)',
          'after_start': 'Только после начала матча'
        };

        const adminMessage = `👁️ ИЗМЕНЕНИЕ НАСТРОЙКИ ПОКАЗА СТАВОК

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Новая настройка: ${showBetsNames[show_bets] || show_bets}
🕐 Время: ${time}`;

        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: adminMessage,
            }),
          }
        );
      }
    } catch (err) {
      console.error(
        "⚠️ Ошибка отправки уведомления админу об изменении настройки показа ставок:",
        err.message
      );
    }

    res.json({ success: true, show_bets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/show-lucky-button - Получить настройку показа кнопки "Мне повезет"
app.get("/api/user/:userId/show-lucky-button", (req, res) => {
  try {
    const { userId } = req.params;
    
    let user;
    
    // Пытаемся получить пользователя
    try {
      user = db
        .prepare("SELECT show_lucky_button FROM users WHERE id = ?")
        .get(userId);
    } catch (error) {
      // Если колонка не существует, добавляем её
      if (error.message.includes("no such column: show_lucky_button")) {
        console.log("⚠️ Колонка show_lucky_button отсутствует, добавляем...");
        db.exec(`ALTER TABLE users ADD COLUMN show_lucky_button INTEGER DEFAULT 1`);
        console.log("✅ Колонка show_lucky_button добавлена в таблицу users");
        
        // Повторно получаем пользователя
        user = db
          .prepare("SELECT show_lucky_button FROM users WHERE id = ?")
          .get(userId);
      } else {
        throw error;
      }
    }

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const showLuckyButton = user.show_lucky_button !== undefined ? user.show_lucky_button : 1;

    res.json({
      show_lucky_button: showLuckyButton,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении настройки show_lucky_button:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/:userId/show-lucky-button - Сохранить настройку показа кнопки "Мне повезет"
app.put("/api/user/:userId/show-lucky-button", async (req, res) => {
  try {
    const { userId } = req.params;
    const { show_lucky_button } = req.body;

    if (show_lucky_button === undefined || ![0, 1].includes(show_lucky_button)) {
      return res.status(400).json({ error: "Неверное значение show_lucky_button" });
    }

    const user = db
      .prepare("SELECT username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем существование колонки и добавляем если нужно
    try {
      db.prepare("UPDATE users SET show_lucky_button = ? WHERE id = ?").run(show_lucky_button, userId);
    } catch (error) {
      // Если колонка не существует, добавляем её
      if (error.message.includes("no such column: show_lucky_button")) {
        console.log("⚠️ Колонка show_lucky_button отсутствует, добавляем...");
        db.exec(`ALTER TABLE users ADD COLUMN show_lucky_button INTEGER DEFAULT 1`);
        console.log("✅ Колонка show_lucky_button добавлена в таблицу users");
        
        // Повторяем UPDATE
        db.prepare("UPDATE users SET show_lucky_button = ? WHERE id = ?").run(show_lucky_button, userId);
      } else {
        throw error;
      }
    }

    // Записываем в логи
    const showLuckyButtonNames = {
      1: 'Показывать',
      0: 'Скрыть'
    };
    
    writeBetLog("settings", {
      username: user.username,
      setting: "'Мне повезет'",
      newValue: showLuckyButtonNames[show_lucky_button]
    });

    // Отправляем уведомление админу
    try {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const time = new Date().toLocaleString("ru-RU", {
          timeZone: "Europe/Moscow",
        });

        const showLuckyButtonNames = {
          1: 'Показывать',
          0: 'Скрыть'
        };

        const adminMessage = `🎲 ИЗМЕНЕНИЕ НАСТРОЙКИ КНОПКИ "МНЕ ПОВЕЗЕТ"

👤 Пользователь: ${user.username}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Новая настройка: ${showLuckyButtonNames[show_lucky_button] || show_lucky_button}
🕐 Время: ${time}`;

        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_ADMIN_ID,
              text: adminMessage,
            }),
          }
        );
      }
    } catch (err) {
      console.error(
        "⚠️ Ошибка отправки уведомления админу об изменении настройки кнопки Мне повезет:",
        err.message
      );
    }

    res.json({ success: true, show_lucky_button });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/show-xg-button - Получить настройку показа кнопки xG
app.get("/api/user/:userId/show-xg-button", (req, res) => {
  try {
    const { userId } = req.params;
    
    let user;
    
    // Пытаемся получить пользователя
    try {
      user = db
        .prepare("SELECT show_xg_button FROM users WHERE id = ?")
        .get(userId);
    } catch (error) {
      // Если колонка не существует, добавляем её
      if (error.message.includes("no such column: show_xg_button")) {
        console.log("⚠️ Колонка show_xg_button отсутствует, добавляем...");
        db.exec(`ALTER TABLE users ADD COLUMN show_xg_button INTEGER DEFAULT 1`);
        console.log("✅ Колонка show_xg_button добавлена в таблицу users");
        
        // Повторно получаем пользователя
        user = db
          .prepare("SELECT show_xg_button FROM users WHERE id = ?")
          .get(userId);
      } else {
        throw error;
      }
    }

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const showXgButton = user.show_xg_button !== undefined ? user.show_xg_button : 1;

    res.json({
      show_xg_button: showXgButton,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении настройки show_xg_button:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/:userId/show-xg-button - Сохранить настройку показа кнопки xG
app.put("/api/user/:userId/show-xg-button", async (req, res) => {
  try {
    const { userId } = req.params;
    const { show_xg_button } = req.body;

    if (show_xg_button === undefined || ![0, 1].includes(show_xg_button)) {
      return res.status(400).json({ error: "Неверное значение show_xg_button" });
    }

    const user = db
      .prepare("SELECT username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем существование колонки и добавляем если нужно
    try {
      db.prepare("UPDATE users SET show_xg_button = ? WHERE id = ?").run(show_xg_button, userId);
    } catch (error) {
      // Если колонка не существует, добавляем её
      if (error.message.includes("no such column: show_xg_button")) {
        console.log("⚠️ Колонка show_xg_button отсутствует, добавляем...");
        db.exec(`ALTER TABLE users ADD COLUMN show_xg_button INTEGER DEFAULT 1`);
        console.log("✅ Колонка show_xg_button добавлена в таблицу users");
        
        // Повторяем UPDATE
        db.prepare("UPDATE users SET show_xg_button = ? WHERE id = ?").run(show_xg_button, userId);
      } else {
        throw error;
      }
    }

    // Записываем в логи
    const showXgButtonNames = {
      1: 'Показывать',
      0: 'Скрыть'
    };
    
    writeBetLog("settings", {
      username: user.username,
      setting: "'Кнопка xG'",
      newValue: showXgButtonNames[show_xg_button]
    });

    // Отправляем уведомление админу
    try {
      await notifyAdmin(
        `🎯 <b>ИЗМЕНЕНИЕ НАСТРОЙКИ КНОПКИ XG</b>\n\n` +
        `👤 Пользователь: <b>${user.username}</b>\n` +
        `${user.telegram_username ? `📱 Telegram: @${user.telegram_username}\n` : ""}` +
        `✏️ Новая настройка: <b>${showXgButtonNames[show_xg_button] || show_xg_button}</b>\n` +
        `🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`
      );
    } catch (err) {
      console.error(
        "⚠️ Ошибка отправки уведомления админу об изменении настройки кнопки xG:",
        err.message
      );
    }

    res.json({ success: true, show_xg_button });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/notify-on-view - Получить настройку уведомлений о просмотре
app.get("/api/user/:userId/notify-on-view", (req, res) => {
  try {
    const { userId } = req.params;
    const user = db
      .prepare("SELECT notify_on_view FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({
      notify_on_view: user.notify_on_view !== undefined ? user.notify_on_view : 1,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/:userId/notify-on-view - Сохранить настройку уведомлений о просмотре
app.put("/api/user/:userId/notify-on-view", async (req, res) => {
  try {
    const { userId } = req.params;
    const { notify_on_view } = req.body;

    if (notify_on_view === undefined || ![0, 1].includes(notify_on_view)) {
      return res.status(400).json({ error: "Неверное значение notify_on_view" });
    }

    const user = db
      .prepare("SELECT username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    db.prepare("UPDATE users SET notify_on_view = ? WHERE id = ?").run(notify_on_view, userId);

    // Записываем в логи
    const notifyNames = {
      1: 'Включено',
      0: 'Отключено'
    };
    
    writeBetLog("settings", {
      username: user.username,
      setting: "'Уведомления о просмотре'",
      newValue: notifyNames[notify_on_view]
    });

    // Отправляем уведомление админу
    const time = new Date().toLocaleString("ru-RU", {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const message = 
      `⚙️ <b>ИЗМЕНЕНИЕ НАСТРОЕК</b>\n\n` +
      `👤 Пользователь: ${user.username}\n` +
      `${user.telegram_username ? `📱 Telegram: @${user.telegram_username}\n` : ""}` +
      `✏️ Настройка: 👀 Уведомления о просмотре\n` +
      `📊 Новое значение: ${notifyNames[notify_on_view]}\n` +
      `🕐 Время: ${time}`;

    try {
      await sendAdminNotification(message);
    } catch (error) {
      console.error("Ошибка отправки уведомления админу:", error);
    }

    res.json({ success: true, notify_on_view });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notify-view-bets - Уведомить пользователя о просмотре его ставок
app.post("/api/notify-view-bets", async (req, res) => {
  try {
    const { viewedUserId, eventId } = req.body;

    if (!viewedUserId || !eventId) {
      return res.status(400).json({ error: "Не указаны viewedUserId или eventId" });
    }

    // Получаем информацию о пользователе чьи ставки смотрят
    const user = db.prepare("SELECT username, telegram_username, notify_on_view FROM users WHERE id = ?").get(viewedUserId);
    
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем включены ли уведомления
    if (user.notify_on_view === 0) {
      return res.json({ success: true, notified: false, reason: "notifications_disabled" });
    }

    // Получаем информацию о турнире
    const event = db.prepare("SELECT name FROM events WHERE id = ?").get(eventId);
    
    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }

    // Отправляем уведомление пользователю
    if (user.telegram_username) {
      try {
        const cleanUsername = user.telegram_username.toLowerCase();
        const tgUser = db
          .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
          .get(cleanUsername);

        if (tgUser?.chat_id) {
          const time = new Date().toLocaleString("ru-RU", { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
          });

          const message = 
            `📊 <b>ПРОСМОТР СТАВОК</b>\n\n` +
            `👤 Твои ставки кто-то посмотрел, будь бдительнее, малютка ${user.username} ;-)\n\n` +
            `🏆 Турнир: ${event.name}\n` +
            `🕐 Время: ${time}`;

          await sendUserMessage(tgUser.chat_id, message);
          
          return res.json({ success: true, notified: true });
        }
      } catch (err) {
        console.error("⚠️ Ошибка отправки уведомления о просмотре ставок:", err.message);
        return res.status(500).json({ error: "Ошибка отправки уведомления" });
      }
    }

    res.json({ success: true, notified: false, reason: "no_telegram" });
  } catch (error) {
    console.error("❌ Ошибка в /api/notify-view-bets:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notify-view-bracket - Уведомить пользователя о просмотре его сетки
app.post("/api/notify-view-bracket", async (req, res) => {
  try {
    const { viewedUserId, eventId } = req.body;

    if (!viewedUserId || !eventId) {
      return res.status(400).json({ error: "Не указаны viewedUserId или eventId" });
    }

    // Получаем информацию о пользователе чью сетку смотрят
    const user = db.prepare("SELECT username, telegram_username, notify_on_view FROM users WHERE id = ?").get(viewedUserId);
    
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем включены ли уведомления
    if (user.notify_on_view === 0) {
      return res.json({ success: true, notified: false, reason: "notifications_disabled" });
    }

    // Получаем информацию о турнире
    const event = db.prepare("SELECT name FROM events WHERE id = ?").get(eventId);
    
    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }

    // Отправляем уведомление пользователю
    if (user.telegram_username) {
      try {
        const cleanUsername = user.telegram_username.toLowerCase();
        const tgUser = db
          .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
          .get(cleanUsername);

        if (tgUser?.chat_id) {
          const time = new Date().toLocaleString("ru-RU", { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
          });

          const message = 
            `🎯 <b>ПРОСМОТР СЕТКИ</b>\n\n` +
            `👤 Твою сетку кто-то посмотрел, будь бдительнее, малютка ${user.username} ;-)\n\n` +
            `🏆 Турнир: ${event.name}\n` +
            `🕐 Время: ${time}`;

          await sendUserMessage(tgUser.chat_id, message);
          
          return res.json({ success: true, notified: true });
        }
      } catch (err) {
        console.error("⚠️ Ошибка отправки уведомления о просмотре сетки:", err.message);
        return res.status(500).json({ error: "Ошибка отправки уведомления" });
      }
    }

    res.json({ success: true, notified: false, reason: "no_telegram" });
  } catch (error) {
    console.error("❌ Ошибка в /api/notify-view-bracket:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/event/:eventId/reminders - Получить настройки напоминаний для турнира
app.get("/api/user/:userId/event/:eventId/reminders", (req, res) => {
  try {
    const { userId, eventId } = req.params;
    
    const reminder = db.prepare(`
      SELECT hours_before FROM event_reminders 
      WHERE user_id = ? AND event_id = ?
    `).get(userId, eventId);
    
    res.json({ 
      enabled: !!reminder,
      hours_before: reminder ? reminder.hours_before : null 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/event/:eventId/reminders - Сохранить настройки напоминаний для турнира
app.post("/api/user/:userId/event/:eventId/reminders", async (req, res) => {
  try {
    const { userId, eventId } = req.params;
    const { hours_before } = req.body;
    
    if (!hours_before || hours_before < 1 || hours_before > 12) {
      return res.status(400).json({ error: "hours_before должно быть от 1 до 12" });
    }
    
    // Проверяем существование пользователя и турнира
    const user = db.prepare("SELECT id, username, telegram_username FROM users WHERE id = ?").get(userId);
    const event = db.prepare("SELECT id, name FROM events WHERE id = ?").get(eventId);
    
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    
    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }
    
    // Сохраняем или обновляем настройку
    db.prepare(`
      INSERT INTO event_reminders (user_id, event_id, hours_before)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, event_id) 
      DO UPDATE SET hours_before = excluded.hours_before
    `).run(userId, eventId, hours_before);
    
    // Отправляем уведомление пользователю в Telegram
    if (user.telegram_username) {
      try {
        await notifyReminderEnabled(user.username, user.telegram_username, event.name, hours_before);
      } catch (error) {
        console.error("Ошибка отправки уведомления о включении напоминаний:", error);
      }
    }
    
    res.json({ success: true, hours_before });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/user/:userId/event/:eventId/reminders - Удалить настройки напоминаний для турнира
app.delete("/api/user/:userId/event/:eventId/reminders", async (req, res) => {
  try {
    const { userId, eventId } = req.params;
    
    // Получаем информацию о пользователе и турнире перед удалением
    const user = db.prepare("SELECT id, username, telegram_username FROM users WHERE id = ?").get(userId);
    const event = db.prepare("SELECT id, name FROM events WHERE id = ?").get(eventId);
    
    db.prepare(`
      DELETE FROM event_reminders 
      WHERE user_id = ? AND event_id = ?
    `).run(userId, eventId);
    
    // Отправляем уведомление пользователю в Telegram
    if (user && user.telegram_username && event) {
      try {
        await notifyReminderDeleted(user.username, user.telegram_username, event.name);
      } catch (error) {
        console.error("Ошибка отправки уведомления об удалении напоминаний:", error);
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/notification-settings - Получить детальные настройки уведомлений
app.get("/api/user/:userId/notification-settings", (req, res) => {
  try {
    const { userId } = req.params;
    
    // Получаем настройки или возвращаем значения по умолчанию
    let settings = db.prepare(`
      SELECT match_reminders, three_hour_reminders, only_active_tournaments, tournament_announcements, match_results, system_messages
      FROM user_notification_settings
      WHERE user_id = ?
    `).get(userId);
    
    // Если настроек нет, возвращаем значения по умолчанию
    if (!settings) {
      settings = {
        match_reminders: 1,
        three_hour_reminders: 1,
        only_active_tournaments: 0,
        tournament_announcements: 1,
        match_results: 1,
        system_messages: 1
      };
    }
    
    // Преобразуем в boolean
    res.json({
      match_reminders: settings.match_reminders === 1,
      three_hour_reminders: settings.three_hour_reminders === 1,
      only_active_tournaments: settings.only_active_tournaments === 1,
      tournament_announcements: settings.tournament_announcements === 1,
      match_results: settings.match_results === 1,
      system_messages: settings.system_messages === 1
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/notification-settings - Сохранить детальные настройки уведомлений
app.post("/api/user/:userId/notification-settings", async (req, res) => {
  try {
    const { userId } = req.params;
    const { match_reminders, three_hour_reminders, only_active_tournaments, tournament_announcements, match_results, system_messages } = req.body;
    
    // Проверяем существование пользователя
    const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(userId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    
    // Получаем старые настройки для сравнения
    const oldSettings = db.prepare(`
      SELECT match_reminders, three_hour_reminders, only_active_tournaments, tournament_announcements, match_results, system_messages
      FROM user_notification_settings
      WHERE user_id = ?
    `).get(userId);
    
    // Сохраняем или обновляем настройки
    db.prepare(`
      INSERT INTO user_notification_settings (user_id, match_reminders, three_hour_reminders, only_active_tournaments, tournament_announcements, match_results, system_messages, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) 
      DO UPDATE SET 
        match_reminders = excluded.match_reminders,
        three_hour_reminders = excluded.three_hour_reminders,
        only_active_tournaments = excluded.only_active_tournaments,
        tournament_announcements = excluded.tournament_announcements,
        match_results = excluded.match_results,
        system_messages = excluded.system_messages,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      userId,
      match_reminders ? 1 : 0,
      three_hour_reminders ? 1 : 0,
      only_active_tournaments ? 1 : 0,
      tournament_announcements ? 1 : 0,
      match_results ? 1 : 0,
      system_messages ? 1 : 0
    );
    
    // Формируем сообщение об изменениях для админа
    const changes = [];
    
    if (!oldSettings) {
      // Первая настройка - отправляем все значения
      changes.push(`🔔 Напоминания о матчах: ${match_reminders ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      changes.push(`⏰ Напоминания за 3 часа: ${three_hour_reminders ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      changes.push(`🎯 Только по турнирам с ставками: ${only_active_tournaments ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      changes.push(`🏆 Объявления о турнирах: ${tournament_announcements ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      changes.push(`⚽ Результаты матчей: ${match_results ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      changes.push(`📢 Системные уведомления: ${system_messages ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
    } else {
      // Сравниваем и добавляем только изменения
      if (oldSettings.match_reminders !== (match_reminders ? 1 : 0)) {
        changes.push(`🔔 Напоминания о матчах: ${match_reminders ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      }
      if (oldSettings.three_hour_reminders !== (three_hour_reminders ? 1 : 0)) {
        changes.push(`⏰ Напоминания за 3 часа: ${three_hour_reminders ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      }
      if (oldSettings.only_active_tournaments !== (only_active_tournaments ? 1 : 0)) {
        changes.push(`🎯 Только по турнирам с ставками: ${only_active_tournaments ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      }
      if (oldSettings.tournament_announcements !== (tournament_announcements ? 1 : 0)) {
        changes.push(`🏆 Объявления о турнирах: ${tournament_announcements ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      }
      if (oldSettings.match_results !== (match_results ? 1 : 0)) {
        changes.push(`⚽ Результаты матчей: ${match_results ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      }
      if (oldSettings.system_messages !== (system_messages ? 1 : 0)) {
        changes.push(`📢 Системные уведомления: ${system_messages ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      }
    }
    
    // Отправляем уведомление админу если были изменения
    if (changes.length > 0) {
      const message = `⚙️ <b>Изменение настроек уведомлений</b>\n\n` +
        `👤 Пользователь: <b>${user.username}</b>\n\n` +
        `${changes.join('\n')}`;
      
      try {
        await sendAdminNotification(message);
      } catch (error) {
        console.error("Ошибка отправки уведомления админу:", error);
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/telegram/register - Регистрация telegram пользователя (для связки username → chat_id)
app.post("/api/telegram/register", (req, res) => {
  try {
    const { telegram_username, chat_id, first_name } = req.body;

    if (!telegram_username || !chat_id) {
      return res
        .status(400)
        .json({ error: "telegram_username и chat_id обязательны" });
    }

    // Убираем @ если есть
    const cleanUsername = telegram_username.replace("@", "").toLowerCase();

    // Сохраняем или обновляем связку
    db.prepare(
      `
      INSERT INTO telegram_users (telegram_username, chat_id, first_name)
      VALUES (?, ?, ?)
      ON CONFLICT(telegram_username) DO UPDATE SET
        chat_id = excluded.chat_id,
        first_name = excluded.first_name
    `
    ).run(cleanUsername, chat_id, first_name || null);

    console.log(`📱 Зарегистрирован telegram: @${cleanUsername} → ${chat_id}`);

    // Синхронизируем telegram_username в таблице users (если пользователь привязан по telegram_id)
    try {
      const result = db.prepare(
        `UPDATE users SET telegram_username = ? WHERE telegram_id = ? AND (telegram_username IS NULL OR telegram_username != ?)`
      ).run(cleanUsername, chat_id, cleanUsername);
      
      if (result.changes > 0) {
        console.log(`🔄 Синхронизирован telegram_username для chat_id ${chat_id}: @${cleanUsername}`);
      }
    } catch (syncError) {
      console.error('⚠️ Ошибка синхронизации telegram_username:', syncError);
      // Не прерываем выполнение, т.к. основная регистрация прошла успешно
    }

    res.json({ success: true, telegram_username: cleanUsername, chat_id });
  } catch (error) {
    console.error("Ошибка регистрации telegram:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/telegram/chat-id/:username - Получить chat_id по telegram username
app.get("/api/telegram/chat-id/:username", (req, res) => {
  try {
    const username = req.params.username.replace("@", "").toLowerCase();

    const user = db
      .prepare(
        "SELECT chat_id, first_name FROM telegram_users WHERE LOWER(telegram_username) = ?"
      )
      .get(username);

    if (!user) {
      return res
        .status(404)
        .json({ error: "Пользователь не найден", found: false });
    }

    res.json({
      found: true,
      chat_id: user.chat_id,
      first_name: user.first_name,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Добавить демо-данные (если база пустая)
app.post("/api/seed-data", (req, res) => {
  try {
    // Проверяем, есть ли уже турниры
    const eventCount = db.prepare("SELECT COUNT(*) as count FROM events").get();

    if (eventCount.count === 0) {
      // Добавляем турниры
      const event1 = db
        .prepare("INSERT INTO events (name, description) VALUES (?, ?)")
        .run(
          "Лига чемпионов 2025-2026",
          "Чемпионская лига европейского футбола"
        );

      const event2 = db
        .prepare("INSERT INTO events (name, description) VALUES (?, ?)")
        .run("Чемпионат мира 2026", "Чемпионат мира по футболу");

      // Добавляем матчи для первого турнира
      db.prepare(
        `
        INSERT INTO matches (event_id, team1_name, team2_name)
        VALUES (?, ?, ?)
      `
      ).run(event1.lastInsertRowid, "Реал Мадрид", "Манчестер Сити");

      db.prepare(
        `
        INSERT INTO matches (event_id, team1_name, team2_name)
        VALUES (?, ?, ?)
      `
      ).run(event1.lastInsertRowid, "Барселона", "Ливерпуль");

      db.prepare(
        `
        INSERT INTO matches (event_id, team1_name, team2_name)
        VALUES (?, ?, ?)
      `
      ).run(event1.lastInsertRowid, "Байерн Мюнхен", "ПСЖ");

      // Добавляем матчи для второго турнира
      db.prepare(
        `
        INSERT INTO matches (event_id, team1_name, team2_name)
        VALUES (?, ?, ?)
      `
      ).run(event2.lastInsertRowid, "Манчестер Юнайтед", "Арсенал");

      db.prepare(
        `
        INSERT INTO matches (event_id, team1_name, team2_name)
        VALUES (?, ?, ?)
      `
      ).run(event2.lastInsertRowid, "Ливерпуль", "Челси");

      res.json({ message: "Демо-данные успешно добавлены" });
    } else {
      res.json({ message: "Данные уже существуют в базе" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== SStats API ENDPOINTS =====

// ===== АДМИН ФУНКЦИИ =====

// POST /api/admin/events - Создать новое событие (только для админа)
app.post("/api/admin/events", async (req, res) => {
  const {
    username,
    name,
    description,
    start_date,
    end_date,
    icon,
    background_color,
    team_file,
    sendToUsers,
    sendToGroup,
  } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;

  // Проверяем права
  const isAdminUser = username === ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("create_tournaments");
    }
    
    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  // Проверяем обязательные поля
  if (!name) {
    return res.status(400).json({ error: "Название турнира обязательно" });
  }

  try {
    const result = db
      .prepare(
        `
      INSERT INTO events (name, description, start_date, end_date, icon, background_color, team_file)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        name,
        description || null,
        start_date || null,
        end_date || null,
        icon || null,
        background_color || null,
        team_file || null
      );

    // Уведомление админу если это модератор
    if (isModerator && username) {
      const details = `🏆 Турнир: ${name}
📝 Описание: ${description || 'не указано'}
📅 Даты: ${start_date || 'не указана'} - ${end_date || 'не указана'}`;
      
      await notifyModeratorAction(username, "Создание турнира", details);
      
      // Запись в логи
      writeBetLog("tournament_created", {
        moderator: username,
        name: name,
        dates: start_date && end_date ? `${start_date} - ${end_date}` : null
      });
    }

    // Отправляем объявление о турнире пользователям (если чекбокс проставлен)
    if (sendToUsers) {
      try {
        await sendTournamentAnnouncementToUsers(result.lastInsertRowid, name, description, start_date, end_date);
      } catch (error) {
        console.error("❌ Ошибка отправки объявления пользователям:", error);
        // Не возвращаем ошибку, турнир уже создан
      }
    }

    // Отправляем объявление в группу (если чекбокс проставлен)
    if (sendToGroup) {
      try {
        await notifyTournamentToGroup(result.lastInsertRowid, name, description, start_date, end_date);
      } catch (error) {
        console.error("❌ Ошибка отправки объявления в группу:", error);
        // Не возвращаем ошибку, турнир уже создан
      }
    }
    
    // Автоматически создаём новость о новом турнире
    try {
      const newsTitle = `Новый турнир: ${name}`;
      let newsMessage = `Создан новый турнир "${name}"!`;
      if (description) {
        newsMessage += `\n\n${description}`;
      }
      if (start_date && end_date) {
        newsMessage += `\n\n📅 Даты проведения: ${start_date} - ${end_date}`;
      }
      newsMessage += `\n\n🎯 Делайте свои прогнозы и соревнуйтесь с другими игроками!`;
      
      db.prepare(`
        INSERT INTO news (type, title, message)
        VALUES (?, ?, ?)
      `).run('announcement', newsTitle, newsMessage);
      
      console.log(`✅ Автоматически создана новость о турнире: ${name}`);
    } catch (error) {
      console.error("❌ Ошибка создания новости о турнире:", error);
    }

    res.json({
      id: result.lastInsertRowid,
      name,
      description,
      start_date,
      end_date,
      icon,
      background_color,
      team_file,
      message: "Событие успешно создано",
    });
  } catch (error) {
    if (error.message.includes("UNIQUE constraint failed")) {
      res
        .status(400)
        .json({ error: "Событие с таким названием уже существует" });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// POST /api/admin/send-tournament-announcement - Отправить объявление о турнире админу на проверку
app.post("/api/admin/send-tournament-announcement", async (req, res) => {
  try {
    const { username, name, description, startDate, endDate, message } = req.body;
    
    if (!username || !name || !message) {
      return res.status(400).json({ error: "Недостаточно данных" });
    }
    
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    
    // Проверяем права (админ или модератор с правами)
    const isAdmin = username === ADMIN_DB_NAME;
    let hasPermission = isAdmin;
    
    if (!isAdmin) {
      // Проверяем права модератора
      const moderator = db.prepare(`
        SELECT permissions FROM moderators 
        WHERE user_id = (SELECT id FROM users WHERE username = ?)
      `).get(username);
      
      if (moderator) {
        const permissions = JSON.parse(moderator.permissions || "[]");
        hasPermission = permissions.includes("create_tournaments");
      }
    }
    
    if (!hasPermission) {
      console.log(`❌ Пользователь ${username} попытался отправить объявление без прав`);
      return res.status(403).json({ error: "Недостаточно прав для отправки объявлений" });
    }
    
    // Сохраняем объявление в БД
    const result = db.prepare(`
      INSERT INTO pending_announcements (name, description, start_date, end_date, message, username)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, description || null, startDate || null, endDate || null, message, username);
    
    const announcementId = result.lastInsertRowid;
    
    // Отправляем сообщение админу в Telegram с инлайн-кнопкой
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const ADMIN_TELEGRAM_ID = process.env.TELEGRAM_ADMIN_ID;
    
    if (TELEGRAM_BOT_TOKEN && ADMIN_TELEGRAM_ID) {
      const adminMessage = `📢 <b>ЗАПРОС НА ПУБЛИКАЦИЮ ТУРНИРА</b>\n\n` +
        `👤 От ${isAdmin ? 'админа' : 'модератора'}: <b>${username}</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `${message}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Нажмите кнопку ниже чтобы опубликовать объявление всем пользователям.`;
      
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: ADMIN_TELEGRAM_ID,
              text: adminMessage,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "✅ Опубликовать всем",
                      callback_data: `publish_${announcementId}`
                    }
                  ],
                  [
                    {
                      text: "❌ Отклонить",
                      callback_data: `reject_${announcementId}`
                    }
                  ]
                ]
              }
            }),
          }
        );
        
        if (!response.ok) {
          const error = await response.json();
          console.error("❌ Ошибка Telegram API:", error);
          return res.status(500).json({ error: "Не удалось отправить сообщение админу" });
        }
        
        console.log(`✅ Объявление о турнире "${name}" (ID: ${announcementId}) отправлено админу от ${username}`);
      } catch (error) {
        console.error("❌ Ошибка отправки объявления админу:", error);
        return res.status(500).json({ error: "Не удалось отправить сообщение админу" });
      }
    } else {
      console.warn("⚠️ TELEGRAM_BOT_TOKEN или TELEGRAM_ADMIN_ID не настроены");
      return res.status(500).json({ error: "Telegram бот не настроен" });
    }
    
    res.json({ success: true, message: "Объявление отправлено админу" });
  } catch (error) {
    console.error("❌ Ошибка при отправке объявления:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/send-feature-announcement - Отправить объявление о новых функциях
app.post("/api/admin/send-feature-announcement", async (req, res) => {
  try {
    const { username, title, text, testMode } = req.body;
    
    if (!username || !title || !text) {
      return res.status(400).json({ error: "Недостаточно данных" });
    }
    
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    
    // Проверяем что это админ
    if (username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!TELEGRAM_BOT_TOKEN) {
      return res.status(500).json({ error: "Telegram бот не настроен" });
    }
    
    // Форматируем текст для красивого отображения
    let formattedText = text;
    
    // Преобразуем простую разметку в HTML
    // *текст* → <b>текст</b> (жирный)
    formattedText = formattedText.replace(/\*([^*]+)\*/g, '<b>$1</b>');
    
    // _текст_ → <i>текст</i> (курсив)
    formattedText = formattedText.replace(/_([^_]+)_/g, '<i>$1</i>');
    
    // `текст` → <code>текст</code> (моноширинный)
    formattedText = formattedText.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Преобразуем списки с • или - в начале строки
    formattedText = formattedText.replace(/^[•\-]\s+(.+)$/gm, '  ▪️ $1');
    
    // Преобразуем цифровые списки
    formattedText = formattedText.replace(/^(\d+)\.\s+(.+)$/gm, '  <b>$1.</b> $2');
    
    // Добавляем отступы для подпунктов (строки начинающиеся с пробелов)
    formattedText = formattedText.replace(/^\s{2,}([•\-])\s+(.+)$/gm, '     ◦ $2');
    
    // Формируем красивое сообщение
    const message = `🎉 <b>${title}</b>\n\n${formattedText}\n\n━━━━━━━━━━━━━━━━━━━━\n\n💬 Победных ставок! 🎯`;
    
    if (testMode) {
      // Отправляем только админу для проверки
      const ADMIN_TELEGRAM_ID = process.env.TELEGRAM_ADMIN_ID;
      
      if (!ADMIN_TELEGRAM_ID) {
        return res.status(500).json({ error: "TELEGRAM_ADMIN_ID не настроен" });
      }
      
      try {
        // Добавляем инлайн-кнопки реакций для тестового сообщения
        const replyMarkup = {
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
        
        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: ADMIN_TELEGRAM_ID,
              text: `📝 <b>ТЕСТОВОЕ СООБЩЕНИЕ</b>\n\n${message}`,
              parse_mode: "HTML",
              reply_markup: replyMarkup
            }),
          }
        );
        
        console.log(`✅ Тестовое объявление отправлено админу`);
        return res.json({ success: true, message: "Тестовое сообщение отправлено" });
      } catch (error) {
        console.error("❌ Ошибка отправки тестового сообщения:", error);
        return res.status(500).json({ error: "Не удалось отправить тестовое сообщение" });
      }
    }
    
    // Отправляем всем пользователям с включенными уведомлениями
    const users = db.prepare(
      `SELECT id, username, telegram_id 
       FROM users 
       WHERE telegram_id IS NOT NULL 
       AND telegram_notifications_enabled = 1`
    ).all();
    
    console.log(`📢 Отправка объявления "${title}" ${users.length} пользователям...`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const user of users) {
      try {
        // Добавляем инлайн-кнопки реакций для личных сообщений
        const replyMarkup = {
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
        
        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: user.telegram_id,
              text: message,
              parse_mode: "HTML",
              reply_markup: replyMarkup
            }),
          }
        );
        successCount++;
        
        // Небольшая задержка между отправками
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`⚠️ Не удалось отправить объявление пользователю ${user.username}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`✅ Объявление "${title}" отправлено: ${successCount} успешно, ${errorCount} ошибок`);
    
    res.json({ 
      success: true, 
      successCount, 
      errorCount,
      message: `Объявление отправлено: ${successCount} успешно, ${errorCount} ошибок`
    });
  } catch (error) {
    console.error("❌ Ошибка при отправке объявления:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/events/:eventId - Редактировать событие (только для админа)
app.put("/api/admin/events/:eventId", (req, res) => {
  const { eventId } = req.params;
  const {
    username,
    name,
    description,
    start_date,
    end_date,
    icon,
    background_color,
    team_file,
  } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;

  // Проверяем, является ли пользователь админом
  if (username !== ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  // Проверяем обязательные поля
  if (!name) {
    return res.status(400).json({ error: "Название турнира обязательно" });
  }

  try {
    const result = db
      .prepare(
        `
      UPDATE events
      SET name = ?, description = ?, start_date = ?, end_date = ?, icon = ?, background_color = ?, team_file = ?
      WHERE id = ?
    `
      )
      .run(
        name,
        description || null,
        start_date || null,
        end_date || null,
        icon || null,
        background_color || null,
        team_file || null,
        eventId
      );

    if (result.changes === 0) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    res.json({
      id: eventId,
      name,
      description,
      start_date,
      end_date,
      icon,
      background_color,
      team_file,
      message: "Событие успешно обновлено",
    });
  } catch (error) {
    if (error.message.includes("UNIQUE constraint failed")) {
      res
        .status(400)
        .json({ error: "Событие с таким названием уже существует" });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// GET /api/admin/events/:eventId/rounds - Получить все уникальные туры турнира
app.get("/api/admin/events/:eventId/rounds", (req, res) => {
  const { eventId } = req.params;

  try {
    const rounds = db
      .prepare(
        `
        SELECT DISTINCT round FROM matches
        WHERE event_id = ? AND round IS NOT NULL
        ORDER BY round
      `
      )
      .all(eventId);

    res.json(rounds.map((r) => r.round));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/matches - Создать новый матч (только для админа)
app.post("/api/admin/matches", async (req, res) => {
  const {
    username,
    event_id,
    team1,
    team2,
    match_date,
    round,
    is_final,
    score_prediction_enabled,
    yellow_cards_prediction_enabled,
    red_cards_prediction_enabled,
    show_exact_score,
    show_yellow_cards,
    show_red_cards,
    show_corners,
    show_penalties_in_game,
    show_extra_time,
    show_penalties_at_end,
  } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;

  // Проверяем, является ли пользователь админом или модератором с правами
  const isAdminUser = username === ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("create_matches");
    }
    
    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  // Проверяем обязательные поля
  if (!event_id || !team1 || !team2) {
    return res
      .status(400)
      .json({ error: "Турнир, команда 1 и команда 2 обязательны" });
  }

  // Проверяем что дата валидная (если указана)
  if (match_date) {
    const dateObj = new Date(match_date);
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({
        error:
          "Неверный формат даты. Используйте ISO формат (YYYY-MM-DDTHH:mm:ss)",
      });
    }
  }

  try {
    const result = db
      .prepare(
        `
      INSERT INTO matches (
        event_id, team1_name, team2_name, match_date, round,
        is_final, score_prediction_enabled, yellow_cards_prediction_enabled, red_cards_prediction_enabled,
        show_exact_score, show_yellow_cards, show_red_cards,
        show_corners, show_penalties_in_game, show_extra_time, show_penalties_at_end
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        event_id,
        team1,
        team2,
        match_date || null,
        round || null,
        is_final ? 1 : 0,
        score_prediction_enabled ? 1 : 0,
        yellow_cards_prediction_enabled ? 1 : 0,
        red_cards_prediction_enabled ? 1 : 0,
        show_exact_score ? 1 : 0,
        show_yellow_cards ? 1 : 0,
        show_red_cards ? 1 : 0,
        show_corners ? 1 : 0,
        show_penalties_in_game ? 1 : 0,
        show_extra_time ? 1 : 0,
        show_penalties_at_end ? 1 : 0
      );

    // Отправляем уведомление админу если это модератор
    if (isModerator) {
      const event = db.prepare("SELECT name FROM events WHERE id = ?").get(event_id);
      const matchDateFormatted = match_date ? new Date(match_date).toLocaleString("ru-RU") : "не указана";
      
      const details = `⚽ Матч: ${team1} vs ${team2}
🏆 Турнир: ${event?.name || "Неизвестно"}
📅 Дата матча: ${matchDateFormatted}
🔢 Тур: ${round || "не указан"}${is_final ? "\n🏅 Финальный матч" : ""}`;

      await notifyModeratorAction(username, "Создание матча", details);
      
      // Запись в логи
      writeBetLog("match_created", {
        moderator: username,
        team1: team1,
        team2: team2,
        tournament: event?.name || "Неизвестно",
        round: round || "не указан",
        is_final: is_final
      });
    }

    res.json({
      id: result.lastInsertRowid,
      event_id,
      team1_name: team1,
      team2_name: team2,
      match_date: match_date || null,
      round: round || null,
      is_final: is_final ? 1 : 0,
      show_exact_score: show_exact_score ? 1 : 0,
      show_yellow_cards: show_yellow_cards ? 1 : 0,
      show_red_cards: show_red_cards ? 1 : 0,
      show_corners: show_corners ? 1 : 0,
      show_penalties_in_game: show_penalties_in_game ? 1 : 0,
      show_extra_time: show_extra_time ? 1 : 0,
      show_penalties_at_end: show_penalties_at_end ? 1 : 0,
      message: "Матч успешно создан",
    });
  } catch (error) {
    console.error("❌ Ошибка при создании матча:", error.message);
    if (error.message.includes("FOREIGN KEY constraint failed")) {
      return res.status(400).json({
        error:
          "❌ Ошибка: Указан несуществующий турнир. Сначала выберите турнир из списка.",
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// POST /api/matches/bulk-create - Bulk импорт матчей (для админа)
app.post("/api/matches/bulk-create", async (req, res) => {
  const { matches } = req.body;

  if (!Array.isArray(matches) || matches.length === 0) {
    return res.status(400).json({ message: "Укажите массив матчей" });
  }

  try {
    // Создаем обратный маппинг: Английское -> Русское
    let reverseMapping = {};
    
    // Пробуем определить турнир по первому матчу
    if (matches.length > 0 && matches[0].event_id) {
      const event = db.prepare("SELECT icon FROM events WHERE id = ?").get(matches[0].event_id);
      if (event && event.icon) {
        const competition = ICON_TO_COMPETITION[event.icon];
        const mappingFile = COMPETITION_DICTIONARY_MAPPING[competition];
        
        if (mappingFile) {
          try {
            const mappingData = JSON.parse(fs.readFileSync(path.join(__dirname, mappingFile), 'utf-8'));
            const teamMapping = mappingData.teams || {};
            
            // Создаем обратный маппинг: Английское -> Русское
            // Если для одной английской команды есть несколько русских вариантов,
            // выбираем самое короткое название (приоритет коротким названиям)
            for (const [russian, english] of Object.entries(teamMapping)) {
              const englishLower = english.toLowerCase();
              if (!reverseMapping[englishLower] || russian.length < reverseMapping[englishLower].length) {
                reverseMapping[englishLower] = russian;
              }
            }
            
            console.log(`✅ Загружен маппинг для ${competition}: ${Object.keys(reverseMapping).length} команд`);
          } catch (err) {
            console.warn(`⚠️ Не удалось загрузить маппинг из ${mappingFile}`);
          }
        }
      }
    }
    
    const createdMatches = [];

    matches.forEach((match) => {
      const { 
        team1_name, 
        team2_name, 
        match_date, 
        round, 
        event_id,
        team1_score,
        team2_score,
        winner,
        score_prediction_enabled
      } = match;

      if (!team1_name || !team2_name || !event_id) {
        throw new Error(
          "Отсутствуют обязательные поля: team1_name, team2_name, event_id"
        );
      }

      // Переводим названия команд на русский если есть маппинг
      const team1_russian = reverseMapping[team1_name.toLowerCase()] || team1_name;
      const team2_russian = reverseMapping[team2_name.toLowerCase()] || team2_name;

      // Если есть результаты - создаем матч с результатами
      if (team1_score !== undefined && team2_score !== undefined && winner) {
        const result = db
          .prepare(
            `INSERT INTO matches (event_id, team1_name, team2_name, match_date, round, team1_score, team2_score, winner, score_prediction_enabled, yellow_cards_prediction_enabled, red_cards_prediction_enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            event_id,
            team1_russian,
            team2_russian,
            match_date || null,
            round || null,
            team1_score,
            team2_score,
            winner,
            score_prediction_enabled || 0,
            match.yellow_cards_prediction_enabled || 0,
            match.red_cards_prediction_enabled || 0
          );

        createdMatches.push({
          id: result.lastInsertRowid,
          event_id,
          team1_name: team1_russian,
          team2_name: team2_russian,
          match_date,
          round,
          team1_score,
          team2_score,
          winner,
          score_prediction_enabled: score_prediction_enabled || 0,
          yellow_cards_prediction_enabled: match.yellow_cards_prediction_enabled || 0,
          red_cards_prediction_enabled: match.red_cards_prediction_enabled || 0
        });
      } else {
        // Создаем матч без результатов
        const result = db
          .prepare(
            `INSERT INTO matches (event_id, team1_name, team2_name, match_date, round, score_prediction_enabled, yellow_cards_prediction_enabled, red_cards_prediction_enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            event_id,
            team1_russian,
            team2_russian,
            match_date || null,
            round || null,
            score_prediction_enabled || 0,
            match.yellow_cards_prediction_enabled || 0,
            match.red_cards_prediction_enabled || 0
          );

        createdMatches.push({
          id: result.lastInsertRowid,
          event_id,
          team1_name: team1_russian,
          team2_name: team2_russian,
          match_date,
          round,
          score_prediction_enabled: score_prediction_enabled || 0,
          yellow_cards_prediction_enabled: match.yellow_cards_prediction_enabled || 0,
          red_cards_prediction_enabled: match.red_cards_prediction_enabled || 0
        });
      }
    });

    res.json({
      message: `Успешно создано ${createdMatches.length} матчей`,
      matches: createdMatches,
    });
  } catch (error) {
    console.error("Ошибка при импорте матчей:", error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/matches/bulk-update-dates - Массовое обновление дат матчей (для админа)
app.post("/api/matches/bulk-update-dates", async (req, res) => {
  const { updates, username } = req.body;

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: "Укажите массив обновлений" });
  }

  // Проверка прав доступа
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("edit_matches");
    }
    
    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  try {
    let updatedCount = 0;

    updates.forEach(update => {
      const { match_id, match_date } = update;

      if (!match_id || !match_date) {
        throw new Error("Отсутствуют обязательные поля: match_id, match_date");
      }

      // Проверяем что дата валидная
      const dateObj = new Date(match_date);
      if (isNaN(dateObj.getTime())) {
        throw new Error(`Неверный формат даты для матча ${match_id}`);
      }

      // Обновляем дату матча
      const result = db
        .prepare("UPDATE matches SET match_date = ? WHERE id = ?")
        .run(match_date, match_id);

      if (result.changes > 0) {
        updatedCount++;
      }
    });

    res.json({
      success: true,
      message: `Успешно обновлено дат: ${updatedCount}`,
      updatedCount
    });
  } catch (error) {
    console.error("Ошибка при массовом обновлении дат:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/matches/:matchId - Изменить статус или отредактировать матч (для админа и модераторов с правами)
app.put("/api/admin/matches/:matchId", async (req, res) => {
  const { matchId } = req.params;
  const {
    username,
    status,
    result,
    team1_name,
    team2_name,
    match_date,
    round,
    is_final,
    score_prediction_enabled,
    yellow_cards_prediction_enabled,
    red_cards_prediction_enabled,
    show_exact_score,
    show_yellow_cards,
    show_red_cards,
    show_corners,
    show_penalties_in_game,
    show_extra_time,
    show_penalties_at_end,
  } = req.body;

  console.log("🔵 PUT /api/admin/matches/:matchId", {
    matchId,
    username,
    status,
    result,
  });

  // Проверяем права
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  let hasPermission = false;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = true;
      
      console.log("   Права модератора:", permissions);
      
      // Определяем какое действие выполняется
      const isEditingMatch = team1_name || team2_name || match_date !== undefined || 
                             round !== undefined || is_final !== undefined || 
                             score_prediction_enabled !== undefined;
      const isSettingResult = status !== undefined;
      
      console.log("   Действия: редактирование =", isEditingMatch, ", установка результата =", isSettingResult);
      
      // Проверяем соответствующие права
      if (isEditingMatch && permissions.includes("edit_matches")) {
        hasPermission = true;
        console.log("   ✓ Есть право edit_matches");
      }
      
      if (isSettingResult && (permissions.includes("manage_results") || permissions.includes("edit_matches") || permissions.includes("view_counting"))) {
        hasPermission = true;
        console.log("   ✓ Есть право manage_results, edit_matches или view_counting");
      }
    }
    
    if (!isModerator || !hasPermission) {
      console.log("❌ Пользователь не имеет прав:", username);
      console.log("   Модератор:", isModerator, "Права:", hasPermission);
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  try {
    // Если приходит статус - обновляем статус и результат
    if (status) {
      const validStatuses = ["pending", "ongoing", "finished"];
      if (!validStatuses.includes(status)) {
        console.log("❌ Неверный статус:", status);
        return res.status(400).json({
          error:
            "Неверный статус. Допустимые значения: pending, ongoing, finished",
        });
      }

      // Определяем winner на основе result
      let winner = null;
      if (result) {
        const winnerMap = {
          team1_win: "team1",
          draw: "draw",
          team2_win: "team2",
        };
        winner = winnerMap[result] || null;
      }
      
      // Если передан winner напрямую (из модалки с прогнозом на счет), используем его
      if (req.body.winner) {
        winner = req.body.winner;
      }

      console.log("✓ Обновляем матч:", {
        matchId,
        status,
        result: result || null,
        winner,
        score_team1: req.body.score_team1,
        score_team2: req.body.score_team2,
      });

      // Если есть счет, сохраняем его в таблице match_scores
      if (req.body.score_team1 !== undefined && req.body.score_team2 !== undefined) {
        try {
          db.prepare(
            "INSERT OR REPLACE INTO match_scores (match_id, score_team1, score_team2) VALUES (?, ?, ?)"
          ).run(matchId, req.body.score_team1, req.body.score_team2);
        } catch (error) {
          console.error("Ошибка при сохранении счета:", error);
        }
      }

      db.prepare(
        "UPDATE matches SET status = ?, result = ?, winner = ?, team1_score = ?, team2_score = ? WHERE id = ?"
      ).run(status, result || null, winner, req.body.score_team1 || null, req.body.score_team2 || null, matchId);

      // Уведомление админу если это модератор
      if (isModerator && username) {
        const match = db.prepare("SELECT team1_name, team2_name FROM matches WHERE id = ?").get(matchId);
        const event = db.prepare("SELECT e.name FROM events e JOIN matches m ON m.event_id = e.id WHERE m.id = ?").get(matchId);
        const resultText = result === 'team1_win' ? match.team1_name : result === 'team2_win' ? match.team2_name : 'Ничья';
        const details = `⚽ Матч: ${match.team1_name} vs ${match.team2_name}
📊 Результат: ${resultText}
${req.body.score_team1 !== undefined ? `⚽ Счет: ${req.body.score_team1}:${req.body.score_team2}` : ''}`;
        
        await notifyModeratorAction(username, "Установка результата матча", details);
        
        // Запись в логи
        writeBetLog("match_result_set", {
          moderator: username,
          team1: match.team1_name,
          team2: match.team2_name,
          score: req.body.score_team1 !== undefined ? `${req.body.score_team1}:${req.body.score_team2}` : resultText,
          tournament: event?.name || "Неизвестно"
        });
      }
      
      // Проверяем рекорды пользователей после установки результата
      try {
        // Получаем всех пользователей с их ставками на этот матч
        const usersWithBets = db.prepare(`
          SELECT DISTINCT u.id, u.username
          FROM users u
          JOIN bets b ON b.user_id = u.id
          WHERE b.match_id = ?
        `).all(matchId);
        
        for (const user of usersWithBets) {
          // Получаем последние ставки пользователя (упорядоченные по дате матча)
          const recentBets = db.prepare(`
            SELECT b.id, b.prediction, m.winner, m.match_date
            FROM bets b
            JOIN matches m ON m.id = b.match_id
            WHERE b.user_id = ? AND m.winner IS NOT NULL
            ORDER BY m.match_date DESC
            LIMIT 15
          `).all(user.id);
          
          // Считаем серию правильных прогнозов
          let streak = 0;
          for (const bet of recentBets) {
            const isCorrect = bet.prediction === bet.winner;
            if (isCorrect) {
              streak++;
            } else {
              break; // Прерываем серию при первом неправильном прогнозе
            }
          }
          
          // Если серия >= 10, создаём новость о рекорде
          if (streak >= 10) {
            // Проверяем не создавали ли мы уже новость об этом рекорде
            const existingNews = db.prepare(`
              SELECT id FROM news 
              WHERE type = 'achievement' 
              AND message LIKE ?
              AND created_at > datetime('now', '-7 days')
            `).get(`%${user.username}%${streak}%подряд%`);
            
            if (!existingNews) {
              const newsTitle = `🔥 Рекорд: ${streak} точных прогнозов подряд!`;
              const newsMessage = `Пользователь ${user.username} установил рекорд - ${streak} точных прогнозов подряд!\n\n🎯 Невероятная серия! Так держать!`;
              
              db.prepare(`
                INSERT INTO news (type, title, message)
                VALUES (?, ?, ?)
              `).run('achievement', newsTitle, newsMessage);
              
              console.log(`✅ Автоматически создана новость о рекорде пользователя ${user.username}: ${streak} подряд`);
            }
          }
          
          // Проверяем достижения по точному счёту
          const exactScoreCount = db.prepare(`
            SELECT COUNT(*) as count
            FROM score_predictions sp
            JOIN matches m ON m.id = sp.match_id
            JOIN match_scores ms ON ms.match_id = m.id
            WHERE sp.user_id = ? 
            AND sp.score_team1 = ms.score_team1 
            AND sp.score_team2 = ms.score_team2
            AND m.winner IS NOT NULL
          `).get(user.id).count;
          
          // Если угадано 5+ точных счётов, создаём новость
          if (exactScoreCount >= 5 && exactScoreCount % 5 === 0) {
            const existingScoreNews = db.prepare(`
              SELECT id FROM news 
              WHERE type = 'achievement' 
              AND message LIKE ?
              AND created_at > datetime('now', '-7 days')
            `).get(`%${user.username}%${exactScoreCount}%точных счёт%`);
            
            if (!existingScoreNews) {
              const newsTitle = `⚽ Мастер счёта: ${exactScoreCount} точных прогнозов!`;
              const newsMessage = `Пользователь ${user.username} угадал ${exactScoreCount} точных счётов!\n\n🎯 Невероятная точность! Продолжай в том же духе!`;
              
              db.prepare(`
                INSERT INTO news (type, title, message)
                VALUES (?, ?, ?)
              `).run('achievement', newsTitle, newsMessage);
              
              console.log(`✅ Автоматически создана новость о точных счётах пользователя ${user.username}: ${exactScoreCount}`);
            }
          }
          
          // Проверяем достижения по карточкам
          const cardsCount = db.prepare(`
            SELECT COUNT(*) as count
            FROM cards_predictions cp
            JOIN matches m ON m.id = cp.match_id
            WHERE cp.user_id = ? 
            AND (
              (cp.yellow_cards = m.yellow_cards AND m.yellow_cards IS NOT NULL)
              OR (cp.red_cards = m.red_cards AND m.red_cards IS NOT NULL)
            )
            AND m.winner IS NOT NULL
          `).get(user.id).count;
          
          // Если угадано 5+ карточек, создаём новость
          if (cardsCount >= 5 && cardsCount % 5 === 0) {
            const existingCardsNews = db.prepare(`
              SELECT id FROM news 
              WHERE type = 'achievement' 
              AND message LIKE ?
              AND created_at > datetime('now', '-7 days')
            `).get(`%${user.username}%${cardsCount}%карточ%`);
            
            if (!existingCardsNews) {
              const newsTitle = `🟨🟥 Мастер карточек: ${cardsCount} точных прогнозов!`;
              const newsMessage = `Пользователь ${user.username} угадал ${cardsCount} прогнозов на карточки!\n\n🎯 Отличное чутьё на дисциплину! Так держать!`;
              
              db.prepare(`
                INSERT INTO news (type, title, message)
                VALUES (?, ?, ?)
              `).run('achievement', newsTitle, newsMessage);
              
              console.log(`✅ Автоматически создана новость о карточках пользователя ${user.username}: ${cardsCount}`);
            }
          }
        }
      } catch (error) {
        console.error("❌ Ошибка проверки рекордов:", error);
      }

      return res.json({
        message: "Статус матча успешно изменен",
        matchId,
        status,
        result: result || null,
      });
    }

    // Если приходят названия команд и/или дата и/или тур - обновляем их
    if (
      team1_name ||
      team2_name ||
      match_date !== undefined ||
      round !== undefined ||
      is_final !== undefined ||
      score_prediction_enabled !== undefined ||
      yellow_cards_prediction_enabled !== undefined ||
      red_cards_prediction_enabled !== undefined ||
      show_exact_score !== undefined ||
      show_yellow_cards !== undefined ||
      show_red_cards !== undefined ||
      show_corners !== undefined ||
      show_penalties_in_game !== undefined ||
      show_extra_time !== undefined ||
      show_penalties_at_end !== undefined
    ) {
      // Получаем текущие значения матча
      const currentMatch = db
        .prepare(
          `SELECT team1_name, team2_name, match_date, round, 
                   is_final, score_prediction_enabled, yellow_cards_prediction_enabled, red_cards_prediction_enabled,
                   show_exact_score, show_yellow_cards, show_red_cards,
                   show_corners, show_penalties_in_game, show_extra_time, show_penalties_at_end 
           FROM matches WHERE id = ?`
        )
        .get(matchId);

      if (!currentMatch) {
        return res.status(404).json({ error: "Матч не найден" });
      }

      // Проверяем была ли изменена дата матча
      const dateChanged =
        match_date !== undefined && match_date !== currentMatch.match_date;

      if (dateChanged) {
        console.log(
          `⏰ Дата матча изменена! Удаляем отправленные напоминания для матча ${matchId}`
        );
        // Удаляем все напоминания для этого матча, чтобы они отправились заново с новой датой
        db.prepare("DELETE FROM sent_reminders WHERE match_id = ?").run(
          matchId
        );
        console.log(
          `✅ Напоминания удалены. При новой дате напоминание отправится заново.`
        );
      }

      db.prepare(
        `UPDATE matches SET 
          team1_name = ?, 
          team2_name = ?, 
          match_date = ?, 
          round = ?,
          is_final = ?,
          score_prediction_enabled = ?,
          yellow_cards_prediction_enabled = ?,
          red_cards_prediction_enabled = ?,
          show_exact_score = ?,
          show_yellow_cards = ?,
          show_red_cards = ?,
          show_corners = ?,
          show_penalties_in_game = ?,
          show_extra_time = ?,
          show_penalties_at_end = ?
         WHERE id = ?`
      ).run(
        team1_name || currentMatch.team1_name,
        team2_name || currentMatch.team2_name,
        match_date !== undefined ? match_date : currentMatch.match_date,
        round !== undefined ? round : currentMatch.round,
        is_final !== undefined ? (is_final ? 1 : 0) : currentMatch.is_final,
        score_prediction_enabled !== undefined
          ? score_prediction_enabled
            ? 1
            : 0
          : currentMatch.score_prediction_enabled,
        yellow_cards_prediction_enabled !== undefined
          ? yellow_cards_prediction_enabled
            ? 1
            : 0
          : currentMatch.yellow_cards_prediction_enabled,
        red_cards_prediction_enabled !== undefined
          ? red_cards_prediction_enabled
            ? 1
            : 0
          : currentMatch.red_cards_prediction_enabled,
        show_exact_score !== undefined
          ? show_exact_score
            ? 1
            : 0
          : currentMatch.show_exact_score,
        show_yellow_cards !== undefined
          ? show_yellow_cards
            ? 1
            : 0
          : currentMatch.show_yellow_cards,
        show_red_cards !== undefined
          ? show_red_cards
            ? 1
            : 0
          : currentMatch.show_red_cards,
        show_corners !== undefined
          ? show_corners
            ? 1
            : 0
          : currentMatch.show_corners,
        show_penalties_in_game !== undefined
          ? show_penalties_in_game
            ? 1
            : 0
          : currentMatch.show_penalties_in_game,
        show_extra_time !== undefined
          ? show_extra_time
            ? 1
            : 0
          : currentMatch.show_extra_time,
        show_penalties_at_end !== undefined
          ? show_penalties_at_end
            ? 1
            : 0
          : currentMatch.show_penalties_at_end,
        matchId
      );

      // Если отключили прогноз на счет - удаляем все прогнозы на счет для этого матча
      if (score_prediction_enabled !== undefined && !score_prediction_enabled) {
        const deletedScores = db.prepare("DELETE FROM score_predictions WHERE match_id = ?").run(matchId);
        console.log(`🗑️ Удалено прогнозов на счет: ${deletedScores.changes}`);
      }

      // Если отключили прогноз на желтые карточки - удаляем прогнозы на желтые карточки
      if (yellow_cards_prediction_enabled !== undefined && !yellow_cards_prediction_enabled) {
        const deletedYellow = db.prepare("UPDATE cards_predictions SET yellow_cards = NULL WHERE match_id = ?").run(matchId);
        console.log(`🗑️ Удалено прогнозов на желтые карточки: ${deletedYellow.changes}`);
      }

      // Если отключили прогноз на красные карточки - удаляем прогнозы на красные карточки
      if (red_cards_prediction_enabled !== undefined && !red_cards_prediction_enabled) {
        const deletedRed = db.prepare("UPDATE cards_predictions SET red_cards = NULL WHERE match_id = ?").run(matchId);
        console.log(`🗑️ Удалено прогнозов на красные карточки: ${deletedRed.changes}`);
      }

      // Удаляем записи в cards_predictions где оба поля NULL
      db.prepare("DELETE FROM cards_predictions WHERE match_id = ? AND yellow_cards IS NULL AND red_cards IS NULL").run(matchId);

      // Уведомление админу если это модератор
      if (isModerator && username) {
        const event = db.prepare("SELECT e.name FROM events e JOIN matches m ON m.event_id = e.id WHERE m.id = ?").get(matchId);
        const details = `⚽ Матч: ${team1_name || currentMatch.team1_name} vs ${team2_name || currentMatch.team2_name}
📅 Дата: ${match_date || currentMatch.match_date || 'не указана'}
🔢 Тур: ${round || currentMatch.round || 'не указан'}`;
        
        await notifyModeratorAction(username, "Редактирование матча", details);
        
        // Запись в логи
        writeBetLog("match_edited", {
          moderator: username,
          team1: team1_name || currentMatch.team1_name,
          team2: team2_name || currentMatch.team2_name,
          tournament: event?.name || "Неизвестно",
          round: round || currentMatch.round || 'не указан'
        });
      }

      return res.json({
        success: true,
        message: "Матч успешно обновлен",
        matchId,
      });
    }

    return res.status(400).json({ error: "Не указаны данные для обновления" });
  } catch (error) {
    console.error("❌ Ошибка при обновлении матча:", error.message);
    if (error.message.includes("FOREIGN KEY constraint failed")) {
      return res.status(400).json({
        error:
          "❌ Ошибка: Указан несуществующий турнир. Выберите существующий турнир.",
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/events/:eventId - Удалить событие (для админа и модераторов с правами)
app.delete("/api/admin/events/:eventId", async (req, res) => {
  const { eventId } = req.params;
  const username = req.body.username;

  // Проверяем права
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("delete_tournaments");
    }
    
    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  try {
    // Получаем информацию о турнире для уведомления
    const event = db.prepare("SELECT name FROM events WHERE id = ?").get(eventId);
    const eventName = event ? event.name : `ID: ${eventId}`;

    // Получаем все матчи этого события чтобы удалить их параметры финала
    const matchIds = db
      .prepare("SELECT id FROM matches WHERE event_id = ?")
      .all(eventId);

    // Удаляем связанные ставки
    db.prepare(
      "DELETE FROM bets WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)"
    ).run(eventId);

    // Также удаляем из final_bets если таблица существует
    try {
      db.prepare(
        "DELETE FROM final_bets WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)"
      ).run(eventId);
    } catch (e) {
      // Таблица final_bets не существует, это нормально
    }

    // Удаляем параметры финала для всех матчей этого события
    matchIds.forEach((match) => {
      try {
        db.prepare(
          "DELETE FROM final_parameters_results WHERE match_id = ?"
        ).run(match.id);
      } catch (e) {
        console.warn(`⚠️ Не удалось удалить параметры финала: ${e.message}`);
      }
    });

    // Удаляем напоминания о матчах этого события
    try {
      db.prepare(
        "DELETE FROM sent_reminders WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)"
      ).run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить напоминания: ${e.message}`);
    }

    // Удаляем напоминания за 3 часа до матчей
    try {
      db.prepare(
        "DELETE FROM sent_3hour_reminders WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)"
      ).run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить 3-часовые напоминания: ${e.message}`);
    }

    // Удаляем персональные напоминания для матчей турнира
    try {
      db.prepare(
        "DELETE FROM sent_personal_reminders WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)"
      ).run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить персональные напоминания: ${e.message}`);
    }

    // Удаляем настройки напоминаний пользователей для этого турнира
    try {
      db.prepare("DELETE FROM event_reminders WHERE event_id = ?").run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить настройки напоминаний: ${e.message}`);
    }

    // Удаляем автоматические награды за турнир
    try {
      db.prepare("DELETE FROM awards WHERE event_id = ?").run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить автоматические награды: ${e.message}`);
    }

    // Удаляем прогнозы на сетки плей-офф для этого турнира
    try {
      db.prepare(
        "DELETE FROM bracket_predictions WHERE bracket_id IN (SELECT id FROM brackets WHERE event_id = ?)"
      ).run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить прогнозы на сетки: ${e.message}`);
    }

    // Удаляем результаты сеток плей-офф для этого турнира
    try {
      db.prepare(
        "DELETE FROM bracket_results WHERE bracket_id IN (SELECT id FROM brackets WHERE event_id = ?)"
      ).run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить результаты сеток: ${e.message}`);
    }

    // Удаляем сетки плей-офф для этого турнира
    try {
      db.prepare("DELETE FROM brackets WHERE event_id = ?").run(eventId);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить сетки плей-офф: ${e.message}`);
    }

    // Удаляем связанные матчи
    db.prepare("DELETE FROM matches WHERE event_id = ?").run(eventId);

    // Удаляем награды при удалении события
    try {
      db.prepare("DELETE FROM tournament_awards WHERE event_id = ?").run(
        eventId
      );
    } catch (error) {
      console.error("Ошибка при удалении наград:", error);
    }

    // Удаляем само событие
    const result = db.prepare("DELETE FROM events WHERE id = ?").run(eventId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    // Запись в логи
    writeBetLog("tournament_deleted", {
      user: username,
      name: eventName,
      event_id: eventId,
      is_moderator: isModerator
    });

    // Отправляем уведомление админу
    if (isModerator) {
      // Если удалил модератор - отправляем через notifyModeratorAction
      const detailsText = `Турнир: ${eventName}\nID: ${eventId}`;
      await notifyModeratorAction(username, "Удаление турнира", detailsText);
    } else {
      // Если удалил админ - отправляем обычное уведомление
      const message = 
        `🗑️ <b>Турнир удалён</b>\n\n` +
        `👤 Администратор: ${username}\n` +
        `🏆 Турнир: ${eventName}\n` +
        `🔢 ID: ${eventId}`;
      await sendAdminNotification(message);
    }

    res.json({ message: "Событие успешно удалено" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/events/:eventId/lock - Заблокировать турнир с причиной (только для админа)
app.put("/api/admin/events/:eventId/lock", (req, res) => {
  const { eventId } = req.params;
  const { username, reason } = req.body;

  // Проверяем, является ли пользователь админом
  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  if (!reason || reason.trim() === "") {
    return res.status(400).json({ error: "Причина блокировки обязательна" });
  }

  try {
    // Получаем информацию о турнире
    const event = db
      .prepare("SELECT id, name FROM events WHERE id = ?")
      .get(eventId);

    if (!event) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    // Блокируем турнир
    const result = db
      .prepare("UPDATE events SET locked_reason = ? WHERE id = ?")
      .run(reason.trim(), eventId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    // Получаем победителя турнира (участника с максимальным количеством побед)
    const winner = db
      .prepare(
        `
        SELECT u.id, u.username, COUNT(b.id) as wins
        FROM users u
        LEFT JOIN bets b ON u.id = b.user_id
        LEFT JOIN matches m ON b.match_id = m.id
        WHERE m.event_id = ?
        AND m.winner IS NOT NULL
        AND (
          (b.prediction = 'team1' AND m.winner = 'team1') OR
          (b.prediction = 'team2' AND m.winner = 'team2') OR
          (b.prediction = 'draw' AND m.winner = 'draw') OR
          (b.prediction = m.team1_name AND m.winner = 'team1') OR
          (b.prediction = m.team2_name AND m.winner = 'team2')
        )
        GROUP BY u.id, u.username
        ORDER BY wins DESC
        LIMIT 1
      `
      )
      .get(eventId);

    // Если есть победитель, выдаём награду и отправляем уведомление в Telegram
    if (winner) {
      // Выдаём награду победителю
      try {
        db.prepare(
          `
          INSERT INTO tournament_awards (user_id, event_id, event_name, won_bets)
          VALUES (?, ?, ?, ?)
        `
        ).run(winner.id, eventId, event.name, winner.wins);
        console.log(
          `🏆 Награда выдана! user_id: ${winner.id}, event: "${event.name}", wins: ${winner.wins}`
        );
      } catch (error) {
        console.error("Ошибка при выдаче награды:", error);
      }

      sendTournamentWinnerNotification(event.name, winner.username);
      
      // Автоматически создаём новость о победителе турнира
      try {
        const newsTitle = `🏆 Победитель турнира: ${event.name}`;
        const newsMessage = `Поздравляем победителя турнира "${event.name}"!\n\n👑 Победитель: ${winner.username}\n🎯 Угаданных прогнозов: ${winner.wins}\n\n🎉 Отличная игра! Так держать!`;
        
        db.prepare(`
          INSERT INTO news (type, title, message)
          VALUES (?, ?, ?)
        `).run('achievement', newsTitle, newsMessage);
        
        console.log(`✅ Автоматически создана новость о победителе турнира: ${event.name}`);
      } catch (error) {
        console.error("❌ Ошибка создания новости о победителе:", error);
      }
    }

    res.json({
      message: "Турнир заблокирован",
      eventId,
      reason: reason.trim(),
      winner: winner ? { username: winner.username, wins: winner.wins } : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/events/:eventId/unlock - Разблокировать турнир (только для админа)
app.put("/api/admin/events/:eventId/unlock", (req, res) => {
  const { eventId } = req.params;
  const { username } = req.body;

  // Проверяем, является ли пользователь админом
  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    const result = db
      .prepare("UPDATE events SET locked_reason = NULL WHERE id = ?")
      .run(eventId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    // Удаляем награду при разблокировке турнира
    try {
      db.prepare("DELETE FROM tournament_awards WHERE event_id = ?").run(
        eventId
      );
    } catch (error) {
      console.error("Ошибка при удалении награды:", error);
    }

    res.json({
      message: "Турнир разблокирован",
      eventId,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/events/:eventId - Редактировать турнир (для админа и модераторов с правами)
app.put("/api/admin/events/:eventId", async (req, res) => {
  const { eventId } = req.params;
  const { username, name, description, start_date, end_date } = req.body;

  // Проверяем права
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("edit_tournaments");
    }
    
    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  // Проверяем обязательные поля
  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Название турнира обязательно" });
  }

  try {
    const result = db
      .prepare(
        "UPDATE events SET name = ?, description = ?, start_date = ?, end_date = ? WHERE id = ?"
      )
      .run(
        name,
        description || null,
        start_date || null,
        end_date || null,
        eventId
      );

    if (result.changes === 0) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    // Отправляем уведомление админу, если действие выполнил модератор
    if (isModerator) {
      const detailsText = `Турнир: ${name}\nID: ${eventId}`;
      await notifyModeratorAction(username, "Редактирование турнира", detailsText);
      
      // Запись в логи
      writeBetLog("tournament_edited", {
        moderator: username,
        name: name
      });
    }

    res.json({
      message: "Турнир успешно отредактирован",
      eventId,
      name,
      description,
      start_date,
      end_date,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/users - Получить всех пользователей (для админа и модераторов с правами)
app.get("/api/admin/users", (req, res) => {
  const username = req.query.username;

  console.log(`📋 Запрос списка пользователей от: ${username}`);

  if (!username) {
    console.log(`❌ Username не передан`);
    return res.status(400).json({ error: "Username не передан" });
  }

  // Проверяем, является ли пользователь админом
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  
  console.log(`🔍 Проверка прав: isAdmin=${isAdminUser}, ADMIN_DB_NAME=${process.env.ADMIN_DB_NAME}`);
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    console.log(`🔍 Модератор найден:`, moderator);
    
    if (!moderator) {
      console.log(`❌ Модератор не найден для username: ${username}`);
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    console.log(`🔍 Права модератора:`, permissions);
    
    if (!permissions.includes("view_users")) {
      console.log(`❌ У модератора нет права view_users`);
      return res.status(403).json({ error: "Недостаточно прав для просмотра пользователей" });
    }
  }

  try {
    const users = db
      .prepare(
        `
      SELECT 
        u.id,
        u.username,
        u.created_at,
        COUNT(b.id) as total_bets,
        SUM(CASE WHEN b.status = 'won' THEN 1 ELSE 0 END) as won_bets,
        SUM(CASE WHEN b.status = 'lost' THEN 1 ELSE 0 END) as lost_bets
      FROM users u
      LEFT JOIN bets b ON u.id = b.user_id
      GROUP BY u.id, u.username
      ORDER BY u.created_at DESC
    `
      )
      .all();

    console.log(`✅ Возвращено пользователей: ${users.length}`);
    res.json(users);
  } catch (error) {
    console.error(`❌ Ошибка при получении пользователей:`, error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/users/:userId - Переименовать пользователя (только для админа)
app.put("/api/admin/users/:userId", async (req, res) => {
  const { userId } = req.params;
  const { username: adminUsername, newUsername } = req.body;

  // Проверяем, является ли пользователь админом или модератором с правами
  const isAdminUser = adminUsername === process.env.ADMIN_DB_NAME;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(adminUsername);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    if (!permissions.includes("edit_users")) {
      return res.status(403).json({ error: "Недостаточно прав для редактирования пользователей" });
    }
  }

  // Проверяем обязательные поля
  if (!newUsername || newUsername.trim() === "") {
    return res
      .status(400)
      .json({ error: "Новое имя пользователя обязательно" });
  }

  try {
    // Получаем старое имя для уведомления
    const oldUser = db.prepare("SELECT username, telegram_id FROM users WHERE id = ?").get(userId);

    if (!oldUser) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем, не пытается ли модератор переименовать админа
    if (!isAdminUser && oldUser.username === process.env.ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Модератор не может переименовать администратора" });
    }

    // Автоматически делаем первую букву заглавной
    const capitalizedNewUsername = newUsername.charAt(0).toUpperCase() + newUsername.slice(1);

    // Проверяем, не занято ли имя
    const existing = db
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(capitalizedNewUsername);
    if (existing) {
      return res.status(400).json({ error: "Это имя уже занято" });
    }

    // Проверка на запрещенные имена
    const forbiddenBase = capitalizedNewUsername.toLowerCase().replace(/[\s\d\.\-]/g, ''); // Убираем пробелы, цифры, точки, дефисы
    if (forbiddenBase === 'мемослав' || forbiddenBase === 'memoslav' || forbiddenBase === 'memoslave') {
      return res.status(400).json({ error: "Are you, ohuel tam?" });
    }

    const result = db
      .prepare("UPDATE users SET username = ? WHERE id = ?")
      .run(capitalizedNewUsername, userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Удаляем все сессии переименованного пользователя (разлогиниваем со всех устройств)
    const deletedSessions = db
      .prepare("DELETE FROM sessions WHERE user_id = ?")
      .run(userId);
    
    console.log(`✅ Пользователь ${oldUser.username} переименован в ${capitalizedNewUsername}`);
    console.log(`🔓 Удалено сессий: ${deletedSessions.changes}`);

    // Отправляем уведомление пользователю в Telegram если он привязал аккаунт
    if (oldUser.telegram_id) {
      const userMessage = `👤 ИЗМЕНЕНИЕ ИМЕНИ

${isAdminUser ? 'Администратор' : 'Модератор'} изменил ваше имя:
• Старое имя: ${oldUser.username}
• Новое имя: ${capitalizedNewUsername}

🔓 Вы были разлогинены со всех устройств (${deletedSessions.changes} сессий).
Войдите заново с новым именем.

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        if (TELEGRAM_BOT_TOKEN) {
          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: oldUser.telegram_id,
                text: userMessage,
              }),
            }
          );
          console.log(`✅ Уведомление о смене имени отправлено пользователю ${capitalizedNewUsername}`);
        }
      } catch (error) {
        console.error("⚠️ Не удалось отправить уведомление пользователю:", error);
      }
    }

    // Отправляем уведомление админу если это модератор
    if (!isAdminUser) {
      const details = `👤 Пользователь: ${oldUser.username}
➡️ Новое имя: ${capitalizedNewUsername}
🔓 Разлогинен со всех устройств (удалено сессий: ${deletedSessions.changes})`;
      
      await notifyModeratorAction(adminUsername, "Переименование пользователя", details);
      
      // Запись в логи
      writeBetLog("user_renamed", {
        moderator: adminUsername,
        oldName: oldUser.username,
        newName: capitalizedNewUsername
      });
    }

    res.json({ 
      message: "Пользователь успешно переименован и разлогинен со всех устройств", 
      newUsername: capitalizedNewUsername,
      deletedSessions: deletedSessions.changes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/users/:userId/bot-contact-check - Проверить, писал ли пользователь боту
app.get("/api/admin/users/:userId/bot-contact-check", (req, res) => {
  const { userId } = req.params;
  const username = req.query.username;

  // Проверяем, является ли пользователь админом
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    if (!permissions.includes("check_bot")) {
      return res.status(403).json({ error: "Недостаточно прав для проверки контакта с ботом" });
    }
  }

  try {
    // Получаем информацию о пользователе
    const user = db
      .prepare("SELECT username, telegram_username, telegram_id, require_login_2fa FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем в реальном времени, есть ли пользователь в telegram_users
    let actualTelegramId = user.telegram_id;
    let hasBotContact = false;

    if (user.telegram_username) {
      const telegramUser = db
        .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
        .get(user.telegram_username.toLowerCase());
      
      if (telegramUser && telegramUser.chat_id) {
        actualTelegramId = telegramUser.chat_id;
        hasBotContact = true;

        // Если telegram_id в users не совпадает с актуальным, обновляем его
        if (user.telegram_id !== telegramUser.chat_id) {
          db.prepare("UPDATE users SET telegram_id = ? WHERE id = ?").run(telegramUser.chat_id, userId);
          console.log(`✅ Автоматически обновлен telegram_id для ${user.username}: ${telegramUser.chat_id}`);
        }
      }
    }

    const result = {
      username: user.username,
      telegram_username: user.telegram_username,
      telegram_id: actualTelegramId,
      has_bot_contact: hasBotContact,
      require_login_2fa: user.require_login_2fa !== 0
    };

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/sync-telegram-ids - Синхронизировать telegram_id для всех пользователей
app.post("/api/admin/sync-telegram-ids", async (req, res) => {
  const { username } = req.body;
  
  // Проверяем, является ли пользователь админом
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    if (!permissions.includes("sync_telegram_ids")) {
      return res.status(403).json({ error: "Недостаточно прав для синхронизации Telegram ID" });
    }
  }
  
  try {
    // Получаем всех пользователей с привязанным Telegram
    const users = db.prepare(`
      SELECT id, username, telegram_username, telegram_id 
      FROM users 
      WHERE telegram_username IS NOT NULL
    `).all();

    // Получаем пользователей БЕЗ привязанного Telegram
    const usersWithoutTelegram = db.prepare(`
      SELECT id, username 
      FROM users 
      WHERE telegram_username IS NULL
    `).all();

    let updated = 0;
    let skipped = 0;
    let notFound = 0;
    const details = [];
    const notFoundUsers = [];

    // Обновляем telegram_id для пользователей
    for (const user of users) {
      if (!user.telegram_id && user.telegram_username) {
        const telegramUser = db.prepare(`
          SELECT chat_id FROM telegram_users 
          WHERE LOWER(telegram_username) = ?
        `).get(user.telegram_username.toLowerCase());

        if (telegramUser) {
          db.prepare(`
            UPDATE users SET telegram_id = ? WHERE id = ?
          `).run(telegramUser.chat_id, user.id);
          
          updated++;
          details.push({
            username: user.username,
            telegram_username: user.telegram_username,
            telegram_id: telegramUser.chat_id
          });
          
          console.log(`✅ Обновлен telegram_id для ${user.username}: ${telegramUser.chat_id}`);
        } else {
          notFound++;
          notFoundUsers.push({
            username: user.username,
            telegram_username: user.telegram_username
          });
          console.log(`⚠️ Не найден в telegram_users: ${user.telegram_username}`);
        }
      } else if (user.telegram_id) {
        skipped++;
      }
    }

    res.json({
      success: true,
      total: users.length,
      updated,
      skipped,
      not_found: notFound,
      details,
      not_found_users: notFoundUsers,
      without_telegram: usersWithoutTelegram.length,
      without_telegram_users: usersWithoutTelegram
    });

    // Уведомление админу если это модератор
    if (!isAdminUser && username && updated > 0) {
      const detailsText = `🔄 Обновлено: ${updated}
⏭️ Пропущено: ${skipped}
❌ Не найдено: ${notFound}`;
      
      await notifyModeratorAction(username, "Синхронизация Telegram ID", detailsText);
      
      // Запись в логи
      writeBetLog("telegram_synced", {
        moderator: username,
        updated: updated,
        notFound: notFound
      });
    }
  } catch (error) {
    console.error("❌ Ошибка синхронизации:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/users/:userId - Удалить пользователя (только для админа)
app.delete("/api/admin/users/:userId", async (req, res) => {
  const { userId } = req.params;
  const { username: adminUsername } = req.body;

  // Проверяем, является ли пользователь админом или модератором с правами
  const isAdminUser = adminUsername === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(adminUsername);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("delete_users");
    }
    
    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав для удаления пользователей" });
    }
  }

  // Получаем информацию о пользователе, которого хотят удалить
  const userToDelete = db
    .prepare("SELECT username FROM users WHERE id = ?")
    .get(userId);
    
  if (!userToDelete) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }

  // Не даем удалить админа
  if (userToDelete.username === process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Нельзя удалить админа" });
  }
  
  // Модератор не может удалить админа (дополнительная проверка)
  if (!isAdminUser && userToDelete.username === process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Модератор не может удалить администратора" });
  }

  try {
    // Получаем информацию о пользователе перед удалением
    const userInfo = db
      .prepare("SELECT username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    if (!userInfo) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Получаем все финальные ставки пользователя чтобы потом удалить их параметры
    const finalBets = db
      .prepare(
        "SELECT match_id FROM bets WHERE user_id = ? AND is_final_bet = 1"
      )
      .all(userId);

    // Получаем количество ставок пользователя
    const betsCount = db
      .prepare("SELECT COUNT(*) as count FROM bets WHERE user_id = ?")
      .get(userId);

    // Удаляем все ставки пользователя
    db.prepare("DELETE FROM bets WHERE user_id = ?").run(userId);

    // Удаляем права модератора если они есть
    db.prepare("DELETE FROM moderators WHERE user_id = ?").run(userId);

    // Удаляем параметры финала для матчей, где у этого пользователя больше нет ставок
    finalBets.forEach((bet) => {
      const remainingBets = db
        .prepare(
          "SELECT COUNT(*) as cnt FROM bets WHERE match_id = ? AND is_final_bet = 1"
        )
        .get(bet.match_id);

      if (remainingBets.cnt === 0) {
        try {
          db.prepare(
            "DELETE FROM final_parameters_results WHERE match_id = ?"
          ).run(bet.match_id);
        } catch (e) {
          console.warn(`⚠️ Не удалось удалить параметры финала: ${e.message}`);
        }
      }
    });

    // Удаляем самого пользователя
    const result = db.prepare("DELETE FROM users WHERE id = ?").run(userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Отправляем уведомление админу если это модератор
    if (isModerator) {
      const details = `👤 Пользователь: ${userInfo.username}
${userInfo.telegram_username ? `📱 Telegram: @${userInfo.telegram_username}` : ''}
📊 Удалено ставок: ${betsCount.count}`;
      
      await notifyModeratorAction(adminUsername, "Удаление пользователя", details);
      
      // Запись в логи
      writeBetLog("user_deleted", {
        moderator: adminUsername,
        username: userInfo.username,
        betsDeleted: betsCount.count
      });
    }

    res.json({ message: "Пользователь успешно удален" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/group-reminders-card-visibility - Получить текущую видимость карточки напоминаний
app.get("/api/admin/group-reminders-card-visibility", (req, res) => {
  try {
    // Создаём таблицу если её нет
    db.prepare(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      )
    `).run();

    // Получаем настройку
    const setting = db.prepare('SELECT value FROM global_settings WHERE key = ?').get('group_reminders_card_hidden');
    
    const hidden = setting ? setting.value === 'true' : false;

    res.json({ hidden });
  } catch (error) {
    console.error('Ошибка при получении видимости карточки:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/group-reminders-card-visibility - Изменить видимость карточки напоминаний в группе для всех пользователей
app.put("/api/admin/group-reminders-card-visibility", (req, res) => {
  try {
    const { hidden, admin_username } = req.body;
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;

    // Проверка прав админа
    if (admin_username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }

    // Создаём таблицу если её нет
    db.prepare(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      )
    `).run();

    // Сохраняем настройку
    db.prepare(`
      INSERT INTO global_settings (key, value, updated_by)
      VALUES ('group_reminders_card_hidden', ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = excluded.updated_by
    `).run(hidden ? 'true' : 'false', admin_username);

    console.log(`🔧 Админ ${admin_username} ${hidden ? 'скрыл' : 'показал'} карточку напоминаний в группе для всех пользователей`);

    res.json({ 
      success: true, 
      hidden,
      message: hidden ? 'Карточка скрыта для всех пользователей' : 'Карточка показана для всех пользователей'
    });
  } catch (error) {
    console.error('Ошибка при изменении видимости карточки:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/toggle-xg-button - Показать/скрыть кнопку xG для всех пользователей
app.post("/api/admin/toggle-xg-button", (req, res) => {
  try {
    const { admin_username, hidden } = req.body;

    if (!admin_username) {
      return res.status(400).json({ error: "Требуется admin_username" });
    }

    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    if (admin_username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }

    // Создаём таблицу если её нет (уже должна существовать)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      )
    `).run();

    // Сохраняем настройку
    db.prepare(`
      INSERT INTO global_settings (key, value, updated_by)
      VALUES ('xg_button_hidden', ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = excluded.updated_by
    `).run(hidden ? 'true' : 'false', admin_username);

    console.log(`🔧 Админ ${admin_username} ${hidden ? 'скрыл' : 'показал'} кнопку xG для всех пользователей`);

    res.json({ 
      success: true, 
      hidden,
      message: hidden ? 'Кнопка xG скрыта для всех пользователей' : 'Кнопка xG показана для всех пользователей'
    });
  } catch (error) {
    console.error('Ошибка при изменении видимости кнопки xG:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/xg-button-visibility - Получить статус видимости кнопки xG
app.get("/api/xg-button-visibility", (req, res) => {
  try {
    const setting = db.prepare(`
      SELECT value FROM global_settings WHERE key = 'xg_button_hidden'
    `).get();

    const hidden = setting ? setting.value === 'true' : false;

    res.json({ hidden });
  } catch (error) {
    console.error('Ошибка при получении видимости кнопки xG:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notify-xg-modal-opened - Уведомить админа об открытии модалки xG
app.post("/api/notify-xg-modal-opened", async (req, res) => {
  try {
    const { username, eventName, round } = req.body;

    if (!username) {
      return res.status(400).json({ error: "Требуется username" });
    }

    console.log(`📊 Пользователь ${username} открыл модалку xG для турнира: ${eventName || 'N/A'}, тур: ${round || 'N/A'}`);

    // Отправляем уведомление админу
    try {
      await notifyAdmin(
        `📊 <b>Открыта модалка xG</b>\n\n` +
        `👤 Пользователь: <b>${username}</b>\n` +
        `🏆 Турнир: <b>${eventName || 'Не указан'}</b>\n` +
        `🎯 Тур: <b>${round || 'Не указан'}</b>`
      );
      console.log('✅ Уведомление админу отправлено');
    } catch (error) {
      console.error('Ошибка отправки уведомления админу:', error);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка при уведомлении об открытии модалки xG:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/user-settings/:userId - Отправить настройки пользователя админу/модератору в Telegram
app.post("/api/admin/user-settings/:userId", async (req, res) => {
  const { userId } = req.params;
  const { username: adminUsername } = req.body;

  // Проверяем, является ли пользователь админом
  const isAdminUser = adminUsername === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  let moderatorChatId = null;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(adminUsername);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    if (!permissions.includes("view_settings")) {
      return res.status(403).json({ error: "Недостаточно прав для просмотра настроек пользователей" });
    }
    
    isModerator = true;
    
    // Получаем chat_id модератора
    const moderatorUser = db.prepare(`
      SELECT telegram_username FROM users WHERE username = ?
    `).get(adminUsername);
    
    if (moderatorUser && moderatorUser.telegram_username) {
      const telegramUser = db.prepare(`
        SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = LOWER(?)
      `).get(moderatorUser.telegram_username);
      
      if (telegramUser) {
        moderatorChatId = telegramUser.chat_id;
      }
    }
  }

  try {
    // Получаем полную информацию о пользователе
    const user = db
      .prepare(
        `SELECT 
          id, username, email, created_at, telegram_username, telegram_id,
          timezone, theme, show_bets,
          telegram_notifications_enabled, telegram_group_reminders_enabled,
          require_login_2fa
        FROM users 
        WHERE id = ?`
      )
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем, есть ли пользователь в telegram_users (писал ли боту)
    let hasBotContact = false;
    if (user.telegram_username) {
      const telegramUser = db
        .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
        .get(user.telegram_username.toLowerCase());
      
      if (telegramUser && telegramUser.chat_id) {
        hasBotContact = true;
      }
    }

    // Названия тем
    const themeNames = {
      'theme-default': 'Дефолтная',
      'theme-hacker-green': '💻 Hacker Green',
      'theme-solarized': '🌅 Solarized',
      'theme-matrix': '🟢 Matrix',
      'theme-cyberpunk': '🌃 Cyberpunk',
      'theme-leagueChampions': '🏆 League Champions',
      'theme-leagueEurope': '⭐ League Europe',
      'theme-dark': '🌙 Темная',
      'theme-light': '☀️ Светлая'
    };

    // Форматируем настройки для отправки
    const settingsMessage = `⚙️ НАСТРОЙКИ ПОЛЬЗОВАТЕЛЯ

👤 Пользователь: ${user.username}
🆔 ID: ${user.id}
${user.email ? `📧 Email: ${user.email}` : ""}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : "📱 Telegram: не привязан"}
${user.telegram_id ? `💬 Chat ID: ${user.telegram_id}` : ""}
${user.telegram_username ? `🤖 Писал боту: ${hasBotContact ? "✅ Да" : "❌ Нет"}` : ""}
📅 Регистрация: ${user.created_at ? new Date(user.created_at).toLocaleString("ru-RU") : "неизвестно"}

🔔 УВЕДОМЛЕНИЯ:
• Личные сообщения в ТГ: ${user.telegram_notifications_enabled ? "✅ Включены" : "❌ Отключены"}
• Напоминания в группе: ${user.telegram_group_reminders_enabled ? "✅ Включены" : "❌ Отключены"}

🔐 БЕЗОПАСНОСТЬ:
• 2FA при логине: ${user.require_login_2fa ? "✅ Включено" : "❌ Отключено"}

🎨 ИНТЕРФЕЙС:
• Тема: ${themeNames[user.theme] || user.theme || "Дефолтная"}
• Часовой пояс: ${user.timezone || "Europe/Moscow (по умолчанию)"}

🔒 ПРИВАТНОСТЬ:
• Показывать ставки: ${user.show_bets === "always" ? "Всегда" : user.show_bets === "after_start" ? "После начала матча" : "Не установлено"}`;

    // Определяем кому отправлять сообщение
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    let targetChatId;
    
    if (isModerator && moderatorChatId) {
      // Отправляем модератору
      targetChatId = moderatorChatId;
    } else {
      // Отправляем админу
      targetChatId = process.env.TELEGRAM_ADMIN_ID;
    }

    if (!TELEGRAM_BOT_TOKEN || !targetChatId) {
      return res.status(500).json({ 
        error: isModerator && !moderatorChatId 
          ? "Ваш Telegram не привязан или вы не писали боту" 
          : "Telegram не настроен" 
      });
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: targetChatId,
          text: settingsMessage,
        }),
      }
    );

    if (!telegramResponse.ok) {
      throw new Error("Ошибка отправки в Telegram");
    }

    const recipient = isModerator ? `модератору ${adminUsername}` : "админу";
    console.log(`✅ Настройки пользователя ${user.username} отправлены ${recipient}`);
    res.json({ success: true, message: "Настройки отправлены в Telegram" });
  } catch (error) {
    console.error("Ошибка при отправке настроек:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bug-report - Отправить багрепорт админу
app.post("/api/bug-report", async (req, res) => {
  try {
    const { userId, username, bugText } = req.body;

    if (!userId || !username || !bugText) {
      return res.status(400).json({ error: "Не все данные предоставлены" });
    }

    // Сохраняем багрепорт в базу данных
    const result = db.prepare(`
      INSERT INTO bug_reports (user_id, username, bug_text, status)
      VALUES (?, ?, ?, 'new')
    `).run(userId, username, bugText);

    // Получаем информацию о пользователе
    const user = db
      .prepare("SELECT telegram_username FROM users WHERE id = ?")
      .get(userId);

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
      return res.status(500).json({ error: "Telegram не настроен" });
    }

    const time = new Date().toLocaleString("ru-RU");
    const message = `🐛 СООБЩЕНИЕ ОБ ОШИБКЕ #${result.lastInsertRowid}

👤 От пользователя: ${username}
${user?.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
🕐 Время: ${time}

📝 Описание проблемы:
${bugText}`;

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_ADMIN_ID,
          text: message,
        }),
      }
    );

    if (!telegramResponse.ok) {
      throw new Error("Ошибка отправки в Telegram");
    }

    console.log(`✅ Багрепорт #${result.lastInsertRowid} от ${username} отправлен админу`);
    res.json({ success: true, message: "Багрепорт отправлен" });
  } catch (error) {
    console.error("Ошибка при отправке багрепорта:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/bug-reports - Получить все багрепорты
app.get("/api/admin/bug-reports", (req, res) => {
  const { username: adminUsername } = req.query;

  // Проверяем, является ли пользователь админом
  if (adminUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    const bugReports = db.prepare(`
      SELECT 
        br.id,
        br.user_id,
        br.username,
        br.bug_text,
        br.status,
        br.created_at,
        u.telegram_username
      FROM bug_reports br
      LEFT JOIN users u ON br.user_id = u.id
      ORDER BY br.created_at DESC
    `).all();

    res.json(bugReports);
  } catch (error) {
    console.error("Ошибка при получении багрепортов:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/bug-reports/:id/status - Изменить статус багрепорта
app.put("/api/admin/bug-reports/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status, username: adminUsername } = req.body;

  // Проверяем, является ли пользователь админом
  if (adminUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    // Получаем информацию о багрепорте до обновления
    const bugReport = db.prepare(`
      SELECT br.id, br.user_id, br.username, br.bug_text, br.status as old_status
      FROM bug_reports br
      WHERE br.id = ?
    `).get(id);

    if (!bugReport) {
      return res.status(404).json({ error: "Багрепорт не найден" });
    }

    // Обновляем статус
    db.prepare("UPDATE bug_reports SET status = ? WHERE id = ?").run(status, id);

    // Отправляем уведомление пользователю, если статус изменился
    if (bugReport.old_status !== status) {
      const user = db.prepare("SELECT telegram_id FROM users WHERE id = ?").get(bugReport.user_id);
      
      if (user && user.telegram_id) {
        const statusEmoji = {
          'new': '🆕',
          'in_progress': '🔄',
          'resolved': '✅',
          'rejected': '❌'
        };

        const statusText = {
          'new': 'Новый',
          'in_progress': 'В работе',
          'resolved': 'Решено',
          'rejected': 'Отклонено'
        };

        const message = `🐛 ОБНОВЛЕНИЕ СТАТУСА БАГРЕПОРТА #${id}

${statusEmoji[status]} Статус изменен на: <b>${statusText[status]}</b>

📝 Ваше сообщение:
${bugReport.bug_text.substring(0, 200)}${bugReport.bug_text.length > 200 ? '...' : ''}

${status === 'resolved' ? '✅ Спасибо за помощь, малютка!' : ''}
${status === 'in_progress' ? '🔄 Как нехуй - щас починим.' : ''}
${status === 'rejected' ? '❌ Это не баг, это фича.' : ''}`;

        try {
          await sendUserMessage(user.telegram_id, message);
          console.log(`✅ Уведомление о смене статуса багрепорта #${id} отправлено пользователю ${bugReport.username}`);
        } catch (error) {
          console.error(`❌ Ошибка отправки уведомления пользователю:`, error);
        }
      }
    }

    res.json({ success: true, message: "Статус обновлен" });
  } catch (error) {
    console.error("Ошибка при обновлении статуса:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/test-group-notification - Отправить тестовое уведомление в группу
app.post("/api/admin/test-group-notification", async (req, res) => {
  const { username: adminUsername, testMode } = req.body;

  // Проверяем, является ли пользователь админом
  if (adminUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    // Получаем пользователей с включенными напоминаниями в группе
    const usersWithReminders = db
      .prepare(
        "SELECT username, telegram_username FROM users WHERE telegram_group_reminders_enabled = 1"
      )
      .all();

    // Создаём список упоминаний
    const mentions = usersWithReminders
      .map((user) =>
        user.telegram_username ? `@${user.telegram_username}` : user.username
      )
      .join(", ");

    // Формируем тестовое сообщение
    const testMessage = `⏰ <b>🧪 ТЕСТОВОЕ НАПОМИНАНИЕ</b>

Это тестовое сообщение для проверки уведомлений в группе.

Матч начнётся <b>20.01.2026 в 18:30</b>

⚽ <b>Реал Мадрид</b> vs <b>Барселона</b>
🏆 Турнир: Лига Чемпионов 2024/25

👥 <b>Пользователи с включенными напоминаниями:</b>
${mentions || "Нет пользователей"}

💬 Не забудьте сделать прогноз!

🔗 <a href="http://${SERVER_IP}:${PORT}">Открыть сайт</a>

<i>Это тестовое сообщение отправлено администратором</i>
${testMode ? '\n\n🧪 <b>ТЕСТОВЫЙ РЕЖИМ:</b> Отправлено только админу' : ''}`;

    // Отправляем в группу или только админу
    if (testMode) {
      await sendAdminNotification(testMessage);
      console.log("✅ Тестовое уведомление отправлено только админу");
    } else {
      await sendGroupNotification(testMessage);
      console.log("✅ Тестовое уведомление отправлено в группу");
    }

    res.json({ 
      success: true, 
      message: testMode ? "Тестовое уведомление отправлено только админу" : "Тестовое уведомление отправлено в группу"
    });
  } catch (error) {
    console.error("Ошибка при отправке тестового уведомления:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/test-auto-counting - Тест автоподсчета (СИМУЛЯЦИЯ без изменения БД)
app.post("/api/admin/test-auto-counting", async (req, res) => {
  const { username: adminUsername, eventId, testMode } = req.body;

  // Проверяем, является ли пользователь админом
  if (adminUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    console.log(`\n🧪 ========================================`);
    console.log(`🧪 ТЕСТ АВТОПОДСЧЕТА (СИМУЛЯЦИЯ)`);
    console.log(`🧪 Event ID: ${eventId}`);
    console.log(`🧪 Режим: ${testMode ? 'Только админу' : 'В реальную группу'}`);
    console.log(`🧪 ========================================\n`);

    // Получаем информацию о турнире
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
    
    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }

    // Получаем ВСЕ незавершенные матчи текущего турнира
    const dbMatches = db.prepare(`
      SELECT * FROM matches
      WHERE event_id = ?
        AND status != 'finished'
      ORDER BY match_date, round
    `).all(eventId);

    if (dbMatches.length === 0) {
      return res.status(400).json({ 
        error: "Нет незавершенных матчей в этом турнире" 
      });
    }

    console.log(`📊 Найдено незавершенных матчей: ${dbMatches.length}`);
    console.log(`🎭 СИМУЛИРУЕМ завершение (БЕЗ изменения БД)\n`);

    // Группируем матчи по датам и турам
    const matchesByDateRound = {};
    dbMatches.forEach(match => {
      const date = match.match_date.split('T')[0];
      const key = `${date}_${match.round}`;
      if (!matchesByDateRound[key]) {
        matchesByDateRound[key] = {
          date,
          round: match.round,
          matches: []
        };
      }
      matchesByDateRound[key].matches.push(match);
    });

    console.log(`📅 Дат/туров: ${Object.keys(matchesByDateRound).length}\n`);

    // Генерируем СИМУЛИРОВАННЫЕ результаты (в памяти, не в БД)
    const simulatedResults = {};
    
    for (const dbMatch of dbMatches) {
      // Генерируем случайный счет (0-4 голов для каждой команды)
      const score1 = Math.floor(Math.random() * 5);
      const score2 = Math.floor(Math.random() * 5);
      
      // Определяем победителя
      let winner;
      if (score1 > score2) {
        winner = 'team1';
      } else if (score1 < score2) {
        winner = 'team2';
      } else {
        winner = 'draw';
      }
      
      simulatedResults[dbMatch.id] = {
        winner,
        score_team1: score1,
        score_team2: score2
      };
      
      console.log(`🎭 Симуляция: ${dbMatch.team1_name} ${score1}-${score2} ${dbMatch.team2_name} (${winner})`);
    }

    console.log(`\n✅ Симулировано ${Object.keys(simulatedResults).length} результатов\n`);

    // Теперь подсчитываем результаты для каждой даты/тура
    for (const [key, group] of Object.entries(matchesByDateRound)) {
      const { date, round } = group;
      
      console.log(`\n📊 Подсчет для ${date} | ${round}\n`);

      // Получаем ставки за эту дату/тур
      const bets = db.prepare(`
        SELECT 
          b.*,
          u.username,
          u.telegram_id,
          u.telegram_notifications_enabled,
          m.team1_name,
          m.team2_name,
          m.score_prediction_enabled,
          sp.score_team1 as predicted_score_team1,
          sp.score_team2 as predicted_score_team2
        FROM bets b
        JOIN users u ON b.user_id = u.id
        JOIN matches m ON b.match_id = m.id
        LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
        WHERE DATE(m.match_date) = ?
          AND m.round = ?
          AND m.status != 'finished'
          AND b.is_final_bet = 0
      `).all(date, round);

      if (bets.length === 0) {
        console.log(`⚠️ Нет ставок для ${date} | ${round}`);
        continue;
      }

      // Подсчитываем результаты используя СИМУЛИРОВАННЫЕ данные
      const userStats = {};
      
      bets.forEach(bet => {
        const username = bet.username;
        if (!userStats[username]) {
          userStats[username] = {
            userId: bet.user_id,
            telegramId: bet.telegram_id,
            telegramNotificationsEnabled: bet.telegram_notifications_enabled,
            points: 0,
            correctResults: 0,
            correctScores: 0
          };
        }
        
        // Берем СИМУЛИРОВАННЫЙ результат
        const simResult = simulatedResults[bet.match_id];
        if (!simResult) return;
        
        // Проверяем результат
        let isWon = false;
        if (bet.prediction === 'draw' && simResult.winner === 'draw') {
          isWon = true;
        } else if (bet.prediction === 'team1' && simResult.winner === 'team1') {
          isWon = true;
        } else if (bet.prediction === 'team2' && simResult.winner === 'team2') {
          isWon = true;
        } else if (bet.prediction === bet.team1_name && simResult.winner === 'team1') {
          isWon = true;
        } else if (bet.prediction === bet.team2_name && simResult.winner === 'team2') {
          isWon = true;
        }
        
        if (isWon) {
          userStats[username].points++;
          userStats[username].correctResults++;
          
          // Проверяем счет (только если включен прогноз на счет для этого матча)
          if (bet.score_prediction_enabled === 1 &&
              bet.predicted_score_team1 != null && bet.predicted_score_team2 != null &&
              bet.predicted_score_team1 === simResult.score_team1 &&
              bet.predicted_score_team2 === simResult.score_team2) {
            userStats[username].points++;
            userStats[username].correctScores++;
          }
        }
      });

      // Формируем сообщение
      const formatDate = (dateStr) => {
        const d = new Date(dateStr);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}.${month}.${year}`;
      };

      let message = `🧪 <b>ТЕСТ АВТОПОДСЧЕТА (СИМУЛЯЦИЯ)</b>\n\n`;
      message += `📅 Дата: ${formatDate(date)}\n`;
      message += `🏆 Тур: ${round}\n`;
      message += `🎯 Турнир: ${event.name}\n\n`;
      message += `📈 Статистика:\n`;

      const sortedUsers = Object.entries(userStats).sort(([, a], [, b]) => b.points - a.points);
      
      if (sortedUsers.length === 0) {
        message += `Нет результатов\n`;
      } else {
        sortedUsers.forEach(([username, stats]) => {
          const statsText = [];
          if (stats.correctResults > 0) {
            statsText.push(`✅ ${stats.correctResults}`);
          }
          if (stats.correctScores > 0) {
            statsText.push(`🎯 ${stats.correctScores}`);
          }
          const statsStr = statsText.length > 0 ? ` (${statsText.join(', ')})` : '';
          message += `• ${username}: ${stats.points} ${stats.points === 1 ? 'очко' : stats.points < 5 ? 'очка' : 'очков'}${statsStr}\n`;
        });
      }

      if (testMode) {
        message += `\n\n🧪 <b>ТЕСТОВЫЙ РЕЖИМ:</b> Отправлено только админу`;
      }

      // Отправляем уведомления в зависимости от режима
      if (testMode) {
        // Только админу
        await sendAdminNotification(message);
        console.log(`✅ Уведомление отправлено только админу (тестовый режим)`);
      } else {
        // В реальную группу
        await sendAdminNotification(message);
        console.log(`✅ Уведомление отправлено админу`);
        
        // Через 5 секунд отправляем в группу и персональные сообщения
        setTimeout(async () => {
          try {
            console.log(`📤 Отправка результатов в группу и пользователям...`);
            
            // Отправляем в группу
            await sendGroupNotification(message.replace('🧪 <b>ТЕСТ АВТОПОДСЧЕТА (СИМУЛЯЦИЯ)</b>', '🤖 <b>Результаты подсчета</b>'));
            
            // Отправляем персональные сообщения
            if (sortedUsers.length > 0) {
              const bestUser = sortedUsers[0];
              const worstUser = sortedUsers[sortedUsers.length - 1];
              
              for (const [username, stats] of sortedUsers) {
                if (!stats.telegramId || stats.telegramNotificationsEnabled !== 1) continue;
                
                let personalMessage = '';
                
                if (username === bestUser[0] && sortedUsers.length > 1) {
                  personalMessage = `🏆 <b>Сегодня ты лучший!</b>\n\n`;
                  personalMessage += `Ты набрал ${stats.points} ${stats.points === 1 ? 'очко' : stats.points < 5 ? 'очка' : 'очков'}`;
                  if (stats.correctScores > 0) {
                    personalMessage += ` и угадал ${stats.correctScores} ${stats.correctScores === 1 ? 'счет' : 'счета'} 🎯`;
                  }
                  personalMessage += `!\n\nТак держать! 💪`;
                } else if (username === worstUser[0] && sortedUsers.length > 1 && stats.points === 0) {
                  personalMessage = `😢 <b>Сегодня ты лох...</b>\n\n`;
                  personalMessage += `Ты набрал 0 очков.\n\nНе расстраивайся, в следующий раз обязательно получится! 🍀`;
                } else {
                  personalMessage = `📊 <b>Сегодня ты не лучший...</b>\n\n`;
                  personalMessage += `Ты набрал ${stats.points} ${stats.points === 1 ? 'очко' : stats.points < 5 ? 'очка' : 'очков'}`;
                  if (stats.correctScores > 0) {
                    personalMessage += ` и угадал ${stats.correctScores} ${stats.correctScores === 1 ? 'счет' : 'счета'} 🎯`;
                  }
                  personalMessage += `.\n\nПродолжай стараться! 💪`;
                }
                
                personalMessage += `\n\n📅 Дата: ${formatDate(date)}\n🏆 Тур: ${round}`;
                
                await sendTelegramMessage(stats.telegramId, personalMessage);
              }
            }
            
            console.log(`✅ Результаты отправлены в группу и пользователям`);
          } catch (error) {
            console.error(`❌ Ошибка отправки результатов:`, error);
          }
        }, 5000);
      }
    }

    console.log(`\n🧪 ========================================`);
    console.log(`🧪 ТЕСТ ЗАВЕРШЕН (БД НЕ ИЗМЕНЕНА)`);
    console.log(`🧪 ========================================\n`);

    res.json({ 
      success: true, 
      message: `Тест автоподсчета завершен (симуляция). БД не изменена.`,
      simulatedMatches: Object.keys(simulatedResults).length
    });

  } catch (error) {
    console.error("❌ Ошибка теста автоподсчета:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/notify-illegal-bet - уведомление админу о попытке запретной ставки
app.post("/api/admin/notify-illegal-bet", async (req, res) => {
  const { username, team1, team2, prediction, matchStatus } = req.body;
  console.log("📨 Получен запрос на уведомление о запретной ставке:", {
    username,
    team1,
    team2,
    prediction,
    matchStatus,
  });
  try {
    await notifyIllegalBet(username, team1, team2, prediction, matchStatus);
    res.json({ success: true });
  } catch (error) {
    console.error("Ошибка при отправке уведомления:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/notify-lucky-bet - Уведомить админа о случайной ставке
app.post("/api/admin/notify-lucky-bet", async (req, res) => {
  const { userId, eventName, round, matchesCount, scorePredictions, cardsPredictions } = req.body;

  try {
    // Получаем информацию о пользователе
    const user = db
      .prepare(
        "SELECT username, email, telegram_username FROM users WHERE id = ?"
      )
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Формируем сообщение для админа
    const luckyMessage = `🎲 СЛУЧАЙНАЯ СТАВКА

👤 Пользователь: ${user.username}
🆔 ID: ${userId}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}

🏆 Турнир: ${eventName}
🎯 Тур: ${round}
⚽ Матчей: ${matchesCount}

📊 Прогнозы:
${scorePredictions > 0 ? `✅ Счёт: ${scorePredictions} из ${matchesCount}` : '❌ Счёт: не ставилось'}
${cardsPredictions > 0 ? `✅ Карточки: ${cardsPredictions} из ${matchesCount}` : '❌ Карточки: не ставилось'}

💭 Пользователь решил положиться на удачу!`;

    // Отправляем сообщение админу
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
      console.log("⚠️ Telegram не настроен, уведомление не отправлено");
      return res.json({ success: true, message: "Telegram не настроен" });
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_ADMIN_ID,
          text: luckyMessage,
        }),
      }
    );

    if (!telegramResponse.ok) {
      throw new Error("Ошибка отправки в Telegram");
    }

    console.log(`✅ Уведомление о случайной ставке от ${user.username} отправлено админу`);
    res.json({ success: true, message: "Уведомление отправлено" });
  } catch (error) {
    console.error("Ошибка при отправке уведомления о случайной ставке:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/notify-database-access - Уведомить админа об открытии панели управления БД модератором
app.post("/api/admin/notify-database-access", async (req, res) => {
  const { username, userId } = req.body;

  try {
    if (!username) {
      return res.status(400).json({ error: "Не указано имя пользователя" });
    }

    // Формируем сообщение для админа
    const message = `🗄️ ДОСТУП К УПРАВЛЕНИЮ БД

👤 Модератор: ${username}
🆔 ID: ${userId}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}

⚠️ Модератор открыл панель управления базой данных`;

    // Отправляем сообщение админу
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
      console.log("⚠️ Telegram не настроен, уведомление не отправлено");
      return res.json({ success: true, message: "Telegram не настроен" });
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_ADMIN_ID,
          text: message,
        }),
      }
    );

    if (!telegramResponse.ok) {
      throw new Error("Ошибка отправки в Telegram");
    }

    console.log(`✅ Уведомление об открытии панели БД модератором ${username} отправлено админу`);
    res.json({ success: true, message: "Уведомление отправлено" });
  } catch (error) {
    console.error("Ошибка при отправке уведомления об открытии панели БД:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/matches/:matchId - Удалить матч
app.delete("/api/admin/matches/:matchId", async (req, res) => {
  const { matchId } = req.params;
  const { username } = req.body;

  // Проверяем права
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("delete_matches");
    }
    
    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  try {
    // Получаем информацию о матче для уведомления
    const match = db.prepare("SELECT team1_name, team2_name, match_date, round FROM matches WHERE id = ?").get(matchId);
    
    // Сначала удаляем все ставки, связанные с матчем (из таблицы bets)
    db.prepare("DELETE FROM bets WHERE match_id = ?").run(matchId);

    // Также удаляем из final_bets если таблица существует
    try {
      db.prepare("DELETE FROM final_bets WHERE match_id = ?").run(matchId);
    } catch (e) {
      // Таблица final_bets не существует, это нормально
    }

    // Удаляем параметры финала для этого матча
    try {
      db.prepare("DELETE FROM final_parameters_results WHERE match_id = ?").run(
        matchId
      );
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить параметры финала: ${e.message}`);
    }

    // Затем удаляем сам матч
    db.prepare("DELETE FROM matches WHERE id = ?").run(matchId);

    // Уведомление админу если это модератор
    if (isModerator && username && match) {
      const event = db.prepare("SELECT e.name FROM events e JOIN matches m ON m.event_id = e.id WHERE m.id = ?").get(matchId);
      const details = `⚽ Матч: ${match.team1_name} vs ${match.team2_name}
📅 Дата: ${match.match_date || 'не указана'}
🔢 Тур: ${match.round || 'не указан'}`;
      
      await notifyModeratorAction(username, "Удаление матча", details);
      
      // Запись в логи
      writeBetLog("match_deleted", {
        moderator: username,
        team1: match.team1_name,
        team2: match.team2_name,
        tournament: event?.name || "Неизвестно",
        round: match.round || 'не указан'
      });
    }

    res.json({ success: true, message: "Матч успешно удален" });
  } catch (error) {
    console.error("❌ Ошибка при удалении матча:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/rounds/:roundName - Удалить тур и все его матчи
app.delete("/api/admin/rounds/:roundName", (req, res) => {
  const { roundName } = req.params;
  const { username, event_id } = req.body;

  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    // Получаем все матчи этого тура
    const matches = db
      .prepare("SELECT id FROM matches WHERE round = ? AND event_id = ?")
      .all(roundName, event_id);

    console.log(`🗑️ Удаление тура "${roundName}" с ${matches.length} матчами`);

    // Удаляем ставки для каждого матча
    for (const match of matches) {
      db.prepare("DELETE FROM bets WHERE match_id = ?").run(match.id);
      
      try {
        db.prepare("DELETE FROM final_bets WHERE match_id = ?").run(match.id);
      } catch (e) {
        // Таблица final_bets не существует
      }

      try {
        db.prepare("DELETE FROM final_parameters_results WHERE match_id = ?").run(match.id);
      } catch (e) {
        // Таблица не существует
      }
    }

    // Удаляем все матчи тура
    const result = db
      .prepare("DELETE FROM matches WHERE round = ? AND event_id = ?")
      .run(roundName, event_id);

    console.log(`✅ Тур "${roundName}" удален, удалено матчей: ${result.changes}`);
    
    res.json({ 
      success: true, 
      message: `Тур "${roundName}" и ${matches.length} матчей успешно удалены`,
      deletedMatches: matches.length
    });
  } catch (error) {
    console.error("❌ Ошибка при удалении тура:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/send-counting-results - Отправить результаты подсчета в группу
app.post("/api/admin/send-counting-results", async (req, res) => {
  const { dateFrom, dateTo } = req.body;

  try {
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: "Не указаны даты" });
    }

    // Получаем все турниры
    const events = db.prepare("SELECT id, name FROM events").all();

    // Для каждого турнира считаем очки пользователей за период
    const tournamentResults = [];

    for (const event of events) {
      // Получаем завершенные матчи в указанном периоде
      const matches = db.prepare(`
        SELECT id, team1_name, team2_name, winner, match_date
        FROM matches
        WHERE event_id = ? 
          AND winner IS NOT NULL
          AND DATE(match_date) >= DATE(?)
          AND DATE(match_date) <= DATE(?)
      `).all(event.id, dateFrom, dateTo);

      if (matches.length === 0) continue;

      // Получаем ставки на эти матчи с прогнозами на счет
      const matchIds = matches.map(m => m.id);
      const placeholders = matchIds.map(() => '?').join(',');
      
      const bets = db.prepare(`
        SELECT 
          b.user_id, 
          b.match_id, 
          b.prediction, 
          m.winner, 
          m.is_final,
          m.score_prediction_enabled,
          m.yellow_cards_prediction_enabled,
          m.red_cards_prediction_enabled,
          u.username, 
          u.telegram_username,
          sp.score_team1 as predicted_score1,
          sp.score_team2 as predicted_score2,
          ms.score_team1 as actual_score1,
          ms.score_team2 as actual_score2,
          cp.yellow_cards as predicted_yellow_cards,
          cp.red_cards as predicted_red_cards,
          m.yellow_cards as actual_yellow_cards,
          m.red_cards as actual_red_cards
        FROM bets b
        JOIN matches m ON b.match_id = m.id
        JOIN users u ON b.user_id = u.id
        LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
        LEFT JOIN match_scores ms ON b.match_id = ms.match_id
        LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
        WHERE b.match_id IN (${placeholders})
      `).all(...matchIds);

      // Подсчитываем очки для каждого пользователя
      const userPoints = {};

      for (const bet of bets) {
        if (!userPoints[bet.user_id]) {
          userPoints[bet.user_id] = {
            username: bet.username,
            telegram_username: bet.telegram_username,
            points: 0,
            correctResults: 0,
            correctScores: 0,
            correctYellowCards: 0,
            correctRedCards: 0
          };
        }

        // Проверяем правильность ставки на результат
        const isCorrect = 
          (bet.prediction === 'team1' && bet.winner === 'team1') ||
          (bet.prediction === 'team2' && bet.winner === 'team2') ||
          (bet.prediction === 'draw' && bet.winner === 'draw');

        if (isCorrect) {
          // Очки за результат (1 или 3 для финала)
          const resultPoints = bet.is_final ? 3 : 1;
          userPoints[bet.user_id].points += resultPoints;
          userPoints[bet.user_id].correctResults++;

          // Проверяем прогноз на счет (только если включен для этого матча)
          if (bet.score_prediction_enabled === 1 &&
              bet.predicted_score1 !== null && bet.predicted_score2 !== null &&
              bet.actual_score1 !== null && bet.actual_score2 !== null) {
            const scoreCorrect = 
              bet.predicted_score1 === bet.actual_score1 && 
              bet.predicted_score2 === bet.actual_score2;
            
            if (scoreCorrect) {
              userPoints[bet.user_id].points++;
              userPoints[bet.user_id].correctScores++;
            }
          }

          // Проверяем прогноз на желтые карточки (только если включен для этого матча)
          if (bet.yellow_cards_prediction_enabled === 1 &&
              bet.predicted_yellow_cards !== null &&
              bet.actual_yellow_cards !== null &&
              bet.predicted_yellow_cards === bet.actual_yellow_cards) {
            userPoints[bet.user_id].points++;
            userPoints[bet.user_id].correctYellowCards++;
          }

          // Проверяем прогноз на красные карточки (только если включен для этого матча)
          if (bet.red_cards_prediction_enabled === 1 &&
              bet.predicted_red_cards !== null &&
              bet.actual_red_cards !== null &&
              bet.predicted_red_cards === bet.actual_red_cards) {
            userPoints[bet.user_id].points++;
            userPoints[bet.user_id].correctRedCards++;
          }
        }
      }

      // Сортируем по очкам
      const sortedUsers = Object.values(userPoints).sort((a, b) => b.points - a.points);

      if (sortedUsers.length > 0) {
        tournamentResults.push({
          eventName: event.name,
          users: sortedUsers
        });
      }
    }

    if (tournamentResults.length === 0) {
      return res.status(404).json({ error: "Нет результатов за указанный период" });
    }

    // Формируем сообщение для Telegram
    const dateFromFormatted = new Date(dateFrom).toLocaleDateString('ru-RU');
    const dateToFormatted = new Date(dateTo).toLocaleDateString('ru-RU');
    
    let message = `📊 <b>Результаты за период</b>\n`;
    message += `📅 ${dateFromFormatted} - ${dateToFormatted}\n\n`;

    for (const tournament of tournamentResults) {
      message += `🏆 <b>${tournament.eventName}</b>\n\n`;

      // Показываем результаты всех пользователей
      if (tournament.users.length > 0) {
        // Определяем уникальные значения очков для присвоения мест
        const uniqueScores = [...new Set(tournament.users.map(u => u.points))];
        
        for (let i = 0; i < tournament.users.length; i++) {
          const user = tournament.users[i];
          
          // Определяем место по уникальному значению очков
          const place = uniqueScores.indexOf(user.points) + 1;
          
          // Присваиваем медаль по месту (только первые 3 места получают медали)
          const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '▪️';
          
          // Правильное склонение для очков
          let pointsWord;
          if (user.points === 0) {
            pointsWord = 'очков';
          } else if (user.points === 1) {
            pointsWord = 'очко';
          } else if (user.points >= 2 && user.points <= 4) {
            pointsWord = 'очка';
          } else {
            pointsWord = 'очков';
          }
          
          let userLine = `${medal} ${user.username}: <b>${user.points}</b> ${pointsWord}`;
          
          // Добавляем статистику по результатам и счетам
          const stats = [];
          if (user.correctResults > 0) {
            stats.push(`✅ ${user.correctResults}`);
          }
          if (user.correctScores > 0) {
            stats.push(`🎯 ${user.correctScores}`);
          }
          if (user.correctYellowCards > 0) {
            stats.push(`🟨 ${user.correctYellowCards}`);
          }
          if (user.correctRedCards > 0) {
            stats.push(`🟥 ${user.correctRedCards}`);
          }
          if (stats.length > 0) {
            userLine += ` (${stats.join(', ')})`;
          }
          
          message += userLine + '\n';
        }

        // Лучшие за период (может быть несколько с одинаковыми очками)
        if (tournament.users.length > 0) {
          const maxPoints = tournament.users[0].points;
          const winners = tournament.users.filter(u => u.points === maxPoints);
          
          message += `\n👑 <b>Лучший за период ${dateFromFormatted} - ${dateToFormatted}:</b>\n`;
          
          if (winners.length === 1) {
            message += `Поздравляем, малютка ${winners[0].username}! 🎉\n`;
            if (winners[0].correctScores > 0) {
              message += `🎯 Угадано счетов: ${winners[0].correctScores}\n`;
            }
          } else {
            // Несколько победителей с одинаковыми очками
            const winnerNames = winners.map(w => w.username).join(' и ');
            message += `Поздравляем малюток ${winnerNames}! 🎉\n`;
          }
        }
      } else {
        message += `Нет участников\n`;
      }

      message += `\n`;
    }

    // Отправляем в группу напрямую через Telegram API (без топика)
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.error("❌ Telegram токен или chat ID не настроены");
      return res.status(500).json({ error: "Telegram не настроен" });
    }

    const chatIds = TELEGRAM_CHAT_ID.split(",").map((id) => id.trim());

    // Отправляем в группу через sendGroupNotification (с кнопками реакций)
    try {
      await sendGroupNotification(message);
      console.log(`✅ Результаты отправлены в группу`);
    } catch (error) {
      console.error(`❌ Ошибка отправки результатов в группу:`, error);
    }

    // Отправляем персонализированные сообщения в личку пользователям
    try {
      // Получаем всех пользователей с привязанным Telegram и включенной настройкой личных сообщений
      const usersWithTelegram = db.prepare(`
        SELECT u.id, u.username, u.telegram_id, u.telegram_username
        FROM users u
        WHERE u.telegram_id IS NOT NULL 
          AND u.telegram_notifications_enabled = 1
      `).all();

      console.log(`📱 Найдено ${usersWithTelegram.length} пользователей для отправки личных сообщений`);

      // Для каждого турнира отправляем персонализированные сообщения
      for (const tournament of tournamentResults) {
        const users = tournament.users;
        
        if (users.length === 0) continue;

        // Находим максимальное и минимальное количество очков
        const maxPoints = users[0].points;
        const minPoints = users[users.length - 1].points;

        // Находим всех победителей (может быть несколько с одинаковыми очками)
        const winners = users.filter(u => u.points === maxPoints);

        // Отправляем каждому пользователю персонализированное сообщение
        for (const user of users) {
          // Проверяем, есть ли этот пользователь в списке с Telegram
          const telegramUser = usersWithTelegram.find(u => u.username === user.username);
          
          if (!telegramUser) {
            console.log(`⏭️ Пропускаем ${user.username} - нет Telegram или отключены уведомления`);
            continue;
          }

          // Формируем персонализированное сообщение
          let personalMessage = `📊 <b>Результаты за период</b>\n`;
          personalMessage += `📅 ${dateFromFormatted} - ${dateToFormatted}\n\n`;
          personalMessage += `🏆 <b>${tournament.eventName}</b>\n\n`;

          // Добавляем список всех участников с правильными медалями
          // Определяем уникальные значения очков для присвоения мест
          const uniqueScores = [...new Set(users.map(u => u.points))];
          
          for (let i = 0; i < users.length; i++) {
            const u = users[i];
            
            // Определяем место по уникальному значению очков
            const place = uniqueScores.indexOf(u.points) + 1;
            
            // Присваиваем медаль по месту (только первые 3 места получают медали)
            const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '▪️';
            
            // Правильное склонение для очков
            let pointsWord;
            if (u.points === 0) {
              pointsWord = 'очков';
            } else if (u.points === 1) {
              pointsWord = 'очко';
            } else if (u.points >= 2 && u.points <= 4) {
              pointsWord = 'очка';
            } else {
              pointsWord = 'очков';
            }
            
            let userLine = `${medal} ${u.username}: <b>${u.points}</b> ${pointsWord}`;
            
            // Добавляем статистику
            const stats = [];
            if (u.correctResults > 0) {
              stats.push(`✅ ${u.correctResults}`);
            }
            if (u.correctScores > 0) {
              stats.push(`🎯 ${u.correctScores}`);
            }
            if (u.correctYellowCards > 0) {
              stats.push(`🟨 ${u.correctYellowCards}`);
            }
            if (u.correctRedCards > 0) {
              stats.push(`🟥 ${u.correctRedCards}`);
            }
            if (stats.length > 0) {
              userLine += ` (${stats.join(', ')})`;
            }
            
            personalMessage += userLine + '\n';
          }

          personalMessage += '\n';

          // Добавляем персонализированное окончание
          // Правильное склонение для очков текущего пользователя
          let userPointsWord;
          if (user.points === 0) {
            userPointsWord = 'очков';
          } else if (user.points === 1) {
            userPointsWord = 'очко';
          } else if (user.points >= 2 && user.points <= 4) {
            userPointsWord = 'очка';
          } else {
            userPointsWord = 'очков';
          }

          if (user.points === maxPoints) {
            // Пользователь лучший (или один из лучших)
            if (winners.length === 1) {
              personalMessage += `Сегодня ты лучший, у тебя <b>${user.points} ${userPointsWord}</b>, поздравляю, малютка 👑 ${user.username}! 🎉`;
            } else {
              personalMessage += `Сегодня ты один из лучших, у тебя <b>${user.points} ${userPointsWord}</b>, поздравляю, малютка 👑 ${user.username}! 🎉`;
            }
          } else if (user.points === minPoints) {
            // Пользователь худший (или один из худших)
            if (winners.length === 1) {
              personalMessage += `Сегодня ты лох, такое может случиться с каждым, у тебя <b>${user.points} ${userPointsWord}</b>, а лучший, это малютка 👑 ${winners[0].username}! 🎉`;
            } else {
              const winnerNames = winners.map(w => w.username).join(' и ');
              personalMessage += `Сегодня ты лох, такое может случиться с каждым, у тебя <b>${user.points} ${userPointsWord}</b>, а лучшие, это малютки 👑 ${winnerNames}! 🎉`;
            }
          } else {
            // Пользователь в середине
            if (winners.length === 1) {
              personalMessage += `Сегодня ты не лучший, у тебя <b>${user.points} ${userPointsWord}</b>, а лучший, это малютка 👑 ${winners[0].username}! 🎉`;
            } else {
              const winnerNames = winners.map(w => w.username).join(' и ');
              personalMessage += `Сегодня ты не лучший, у тебя <b>${user.points} ${userPointsWord}</b>, а лучшие, это малютки 👑 ${winnerNames}! 🎉`;
            }
          }

          // Отправляем личное сообщение через sendUserMessage (с кнопками реакций)
          try {
            await sendUserMessage(telegramUser.telegram_id, personalMessage);
            console.log(`✅ Личное сообщение отправлено ${user.username} (${telegramUser.telegram_id})`);
          } catch (error) {
            console.error(`❌ Ошибка отправки личного сообщения ${user.username}:`, error);
          }

          // Небольшая задержка между отправками, чтобы не превысить лимиты Telegram API
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } catch (error) {
      console.error("❌ Ошибка отправки личных сообщений:", error);
    }

    res.json({ success: true, message: "Результаты отправлены в группу и личные сообщения" });
  } catch (error) {
    console.error("❌ Ошибка отправки результатов:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/get-events-for-date - Получить список турниров для выбранной даты
app.get("/api/admin/get-events-for-date", (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: "Не указана дата" });
  }

  try {
    // Получаем все турниры для указанной даты с количеством матчей
    const events = db.prepare(`
      SELECT 
        e.id as event_id,
        e.name as event_name,
        COUNT(*) as matches_count
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE DATE(m.match_date) = ?
      GROUP BY e.id, e.name
      ORDER BY e.name
    `).all(date);

    res.json({ events });
  } catch (error) {
    console.error("❌ Ошибка получения турниров:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/get-rounds-for-event - Получить список туров для выбранного турнира и даты
app.get("/api/admin/get-rounds-for-event", (req, res) => {
  const { eventId, date } = req.query;

  if (!eventId || !date) {
    return res.status(400).json({ error: "Не указан турнир или дата" });
  }

  try {
    // Получаем все туры для указанного турнира и даты с количеством матчей
    const rounds = db.prepare(`
      SELECT 
        m.round,
        COUNT(*) as matches_count,
        SUM(CASE WHEN m.status = 'finished' THEN 1 ELSE 0 END) as finished_count
      FROM matches m
      WHERE m.event_id = ?
        AND DATE(m.match_date) = ?
      GROUP BY m.round
      ORDER BY m.round
    `).all(eventId, date);

    res.json({ rounds });
  } catch (error) {
    console.error("❌ Ошибка получения туров:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/cleanup-disabled-predictions - Очистить прогнозы для матчей с отключенными чекбоксами
app.post("/api/admin/cleanup-disabled-predictions", async (req, res) => {
  const { username } = req.body;

  // Проверяем права (админ или модератор с правами на подсчет)
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  const isAdmin = username === ADMIN_DB_NAME;
  
  if (!isAdmin) {
    const moderator = db.prepare(`
      SELECT m.*, u.username 
      FROM moderators m
      JOIN users u ON m.user_id = u.id
      WHERE u.username = ?
    `).get(username);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = moderator.permissions ? moderator.permissions.split(',') : [];
    if (!permissions.includes('view_counting')) {
      return res.status(403).json({ error: "Недостаточно прав для очистки прогнозов" });
    }
  }

  try {
    console.log(`\n🧹 ========================================`);
    console.log(`🧹 ОЧИСТКА ПРОГНОЗОВ С ОТКЛЮЧЕННЫМИ ЧЕКБОКСАМИ`);
    console.log(`🧹 Инициатор: ${username}`);
    console.log(`🧹 ========================================\n`);

    // Получаем все матчи
    const matches = db.prepare("SELECT id, team1_name, team2_name, score_prediction_enabled, yellow_cards_prediction_enabled, red_cards_prediction_enabled FROM matches").all();
    
    let totalDeletedScores = 0;
    let totalDeletedYellow = 0;
    let totalDeletedRed = 0;
    let totalDeletedCardsRecords = 0;

    matches.forEach(match => {
      // Удаляем прогнозы на счет если чекбокс отключен
      if (match.score_prediction_enabled === 0) {
        const deleted = db.prepare("DELETE FROM score_predictions WHERE match_id = ?").run(match.id);
        if (deleted.changes > 0) {
          console.log(`🗑️ Матч ${match.team1_name} - ${match.team2_name}: удалено ${deleted.changes} прогнозов на счет`);
          totalDeletedScores += deleted.changes;
        }
      }

      // Удаляем прогнозы на желтые карточки если чекбокс отключен
      if (match.yellow_cards_prediction_enabled === 0) {
        const deleted = db.prepare("UPDATE cards_predictions SET yellow_cards = NULL WHERE match_id = ?").run(match.id);
        if (deleted.changes > 0) {
          console.log(`🗑️ Матч ${match.team1_name} - ${match.team2_name}: удалено ${deleted.changes} прогнозов на желтые карточки`);
          totalDeletedYellow += deleted.changes;
        }
      }

      // Удаляем прогнозы на красные карточки если чекбокс отключен
      if (match.red_cards_prediction_enabled === 0) {
        const deleted = db.prepare("UPDATE cards_predictions SET red_cards = NULL WHERE match_id = ?").run(match.id);
        if (deleted.changes > 0) {
          console.log(`🗑️ Матч ${match.team1_name} - ${match.team2_name}: удалено ${deleted.changes} прогнозов на красные карточки`);
          totalDeletedRed += deleted.changes;
        }
      }
    });

    // Удаляем пустые записи в cards_predictions (где оба поля NULL)
    const deletedEmpty = db.prepare("DELETE FROM cards_predictions WHERE yellow_cards IS NULL AND red_cards IS NULL").run();
    totalDeletedCardsRecords = deletedEmpty.changes;

    console.log(`\n✅ Очистка завершена!`);
    console.log(`📊 Статистика:`);
    console.log(`   - Удалено прогнозов на счет: ${totalDeletedScores}`);
    console.log(`   - Удалено прогнозов на желтые карточки: ${totalDeletedYellow}`);
    console.log(`   - Удалено прогнозов на красные карточки: ${totalDeletedRed}`);
    console.log(`   - Удалено пустых записей в cards_predictions: ${totalDeletedCardsRecords}\n`);

    res.json({
      success: true,
      message: "Прогнозы успешно очищены",
      stats: {
        deletedScores: totalDeletedScores,
        deletedYellow: totalDeletedYellow,
        deletedRed: totalDeletedRed,
        deletedCardsRecords: totalDeletedCardsRecords
      }
    });
  } catch (error) {
    console.error("❌ Ошибка очистки прогнозов:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/recount-results - Пересчитать результаты для конкретной даты
app.post("/api/admin/recount-results", async (req, res) => {
  const { username, date, round, sendToGroup, sendToUsers } = req.body;

  console.log('🔄 Пересчет результатов:', { username, date, round, sendToGroup, sendToUsers });

  // Проверяем права (админ или модератор с правами на подсчет)
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  const isAdmin = username === ADMIN_DB_NAME;
  
  if (!isAdmin) {
    console.log('Проверка прав модератора для:', username);
    const moderator = db.prepare(`
      SELECT m.*, u.username 
      FROM moderators m
      JOIN users u ON m.user_id = u.id
      WHERE u.username = ?
    `).get(username);
    
    console.log('Найден модератор:', moderator);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = moderator.permissions ? moderator.permissions.split(',') : [];
    if (!permissions.includes('view_counting')) {
      return res.status(403).json({ error: "Недостаточно прав для пересчета" });
    }
  }

  try {
    if (!date || !round) {
      return res.status(400).json({ error: "Не указаны дата или тур" });
    }

    console.log(`\n🔄 ========================================`);
    console.log(`🔄 ПЕРЕСЧЕТ РЕЗУЛЬТАТОВ`);
    console.log(`🔄 Инициатор: ${username}`);
    console.log(`🔄 Дата: ${date}`);
    console.log(`🔄 Тур: ${round}`);
    console.log(`🔄 ========================================\n`);

    // Шаг 1: Получаем все матчи для этой даты и тура
    const matches = db.prepare(`
      SELECT m.*, e.icon, e.name as event_name
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE DATE(m.match_date) = ?
        AND m.round = ?
    `).all(date, round);

    if (matches.length === 0) {
      return res.status(404).json({ error: "Не найдено матчей для указанной даты и тура" });
    }

    console.log(`📊 Найдено матчей: ${matches.length}`);

    // Шаг 1.5: Очищаем прогнозы для матчей где админ отключил чекбоксы
    let totalDeletedScores = 0;
    let totalDeletedYellow = 0;
    let totalDeletedRed = 0;

    matches.forEach(match => {
      // Удаляем прогнозы на счет если чекбокс отключен
      if (match.score_prediction_enabled === 0) {
        const deleted = db.prepare("DELETE FROM score_predictions WHERE match_id = ?").run(match.id);
        totalDeletedScores += deleted.changes;
      }

      // Удаляем прогнозы на желтые карточки если чекбокс отключен
      if (match.yellow_cards_prediction_enabled === 0) {
        const deleted = db.prepare("UPDATE cards_predictions SET yellow_cards = NULL WHERE match_id = ?").run(match.id);
        totalDeletedYellow += deleted.changes;
      }

      // Удаляем прогнозы на красные карточки если чекбокс отключен
      if (match.red_cards_prediction_enabled === 0) {
        const deleted = db.prepare("UPDATE cards_predictions SET red_cards = NULL WHERE match_id = ?").run(match.id);
        totalDeletedRed += deleted.changes;
      }
    });

    // Удаляем пустые записи в cards_predictions
    const matchIds = matches.map(m => m.id);
    if (matchIds.length > 0) {
      const placeholders = matchIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM cards_predictions WHERE match_id IN (${placeholders}) AND yellow_cards IS NULL AND red_cards IS NULL`).run(...matchIds);
    }

    if (totalDeletedScores > 0) {
      console.log(`🗑️ Удалено прогнозов на счет (чекбокс отключен): ${totalDeletedScores}`);
    }
    if (totalDeletedYellow > 0) {
      console.log(`🗑️ Удалено прогнозов на желтые карточки (чекбокс отключен): ${totalDeletedYellow}`);
    }
    if (totalDeletedRed > 0) {
      console.log(`🗑️ Удалено прогнозов на красные карточки (чекбокс отключен): ${totalDeletedRed}`);
    }

    // Шаг 2: Сбрасываем результаты этих матчей
    const resetStmt = db.prepare(`
      UPDATE matches
      SET status = 'pending',
          winner = NULL,
          team1_score = NULL,
          team2_score = NULL,
          yellow_cards = NULL,
          red_cards = NULL
      WHERE DATE(match_date) = ?
        AND round = ?
        AND result IS NULL
    `);

    const resetResult = resetStmt.run(date, round);
    console.log(`✅ Сброшено матчей: ${resetResult.changes}`);

    // Шаг 3: Удаляем обработанную дату из списка
    const dateKey = `${date}_${round}`;
    if (processedDates.has(dateKey)) {
      processedDates.delete(dateKey);
      console.log(`✅ Удалена обработанная дата: ${dateKey}`);
    }

    // Шаг 4: Запускаем автоподсчет для этой даты
    const event = matches[0];
    const competition_code = ICON_TO_COMPETITION[event.icon];

    if (!competition_code) {
      return res.status(400).json({ error: "Не удалось определить турнир" });
    }

    console.log(`🔄 Запуск автоподсчета для ${date} | ${round}...`);

    // Вызываем функцию автоподсчета
    const dateGroup = {
      event_id: event.event_id,
      competition_code,
      round,
      date
    };

    // Проверяем завершение матчей
    const { allFinished, matches: matchedMatches } = await checkDateCompletion(dateGroup);

    if (!allFinished) {
      return res.status(400).json({ 
        error: "Не все матчи завершены. Пересчет возможен только для полностью завершенных дат." 
      });
    }

    // Обновляем матчи из API
    const matchesWithApi = matchedMatches.filter(m => m.apiMatch !== null);
    if (matchesWithApi.length > 0) {
      const updated = updateMatchesFromAPI(matchesWithApi);
      if (!updated) {
        return res.status(500).json({ error: "Не удалось обновить результаты матчей" });
      }
    }

    // Помечаем дату как обработанную
    const fullDateKey = `${date}_${round}_${competition_code}`;
    processedDates.add(fullDateKey);
    saveProcessedDate(fullDateKey);

    console.log(`✅ Результаты обновлены`);

    // Шаг 5: Получаем ставки и подсчитываем результаты
    const bets = db.prepare(`
      SELECT 
        b.*,
        u.username,
        u.telegram_id,
        u.telegram_notifications_enabled,
        m.team1_name,
        m.team2_name,
        m.winner,
        m.team1_score as actual_score_team1,
        m.team2_score as actual_score_team2,
        m.yellow_cards as actual_yellow_cards,
        m.red_cards as actual_red_cards,
        m.score_prediction_enabled,
        m.yellow_cards_prediction_enabled,
        m.red_cards_prediction_enabled,
        sp.score_team1 as predicted_score_team1,
        sp.score_team2 as predicted_score_team2,
        cp.yellow_cards as predicted_yellow_cards,
        cp.red_cards as predicted_red_cards
      FROM bets b
      JOIN users u ON b.user_id = u.id
      JOIN matches m ON b.match_id = m.id
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
      WHERE DATE(m.match_date) = ?
        AND m.round = ?
        AND m.status = 'finished'
        AND b.is_final_bet = 0
    `).all(date, round);

    console.log(`📊 Найдено ставок: ${bets.length}`);

    // Подсчитываем результаты
    const userStats = {};
    
    bets.forEach(bet => {
      const username = bet.username;
      if (!userStats[username]) {
        userStats[username] = {
          userId: bet.user_id,
          telegramId: bet.telegram_id,
          telegramNotificationsEnabled: bet.telegram_notifications_enabled,
          points: 0,
          correctResults: 0,
          correctScores: 0,
          correctYellowCards: 0,
          correctRedCards: 0
        };
      }
      
      // Проверяем результат
      let isWon = false;
      if (bet.prediction === 'draw' && bet.winner === 'draw') {
        isWon = true;
      } else if (bet.prediction === 'team1' && bet.winner === 'team1') {
        isWon = true;
      } else if (bet.prediction === 'team2' && bet.winner === 'team2') {
        isWon = true;
      } else if (bet.prediction === bet.team1_name && bet.winner === 'team1') {
        isWon = true;
      } else if (bet.prediction === bet.team2_name && bet.winner === 'team2') {
        isWon = true;
      }
      
      if (isWon) {
        userStats[username].points++;
        userStats[username].correctResults++;
        
        // Проверяем счет (только если включен прогноз на счет для этого матча)
        if (bet.score_prediction_enabled === 1 &&
            bet.predicted_score_team1 != null && bet.predicted_score_team2 != null &&
            bet.predicted_score_team1 === bet.actual_score_team1 &&
            bet.predicted_score_team2 === bet.actual_score_team2) {
          userStats[username].points++;
          userStats[username].correctScores++;
        }
        
        // Проверяем желтые карточки (только если включен прогноз на желтые карточки для этого матча)
        if (bet.yellow_cards_prediction_enabled === 1 &&
            bet.predicted_yellow_cards != null &&
            bet.actual_yellow_cards != null &&
            bet.predicted_yellow_cards === bet.actual_yellow_cards) {
          userStats[username].points++;
          userStats[username].correctYellowCards++;
        }
        
        // Проверяем красные карточки (только если включен прогноз на красные карточки для этого матча)
        if (bet.red_cards_prediction_enabled === 1 &&
            bet.predicted_red_cards != null &&
            bet.actual_red_cards != null &&
            bet.predicted_red_cards === bet.actual_red_cards) {
          userStats[username].points++;
          userStats[username].correctRedCards++;
        }
      }
    });

    // Формируем сообщение
    const formatDate = (dateStr) => {
      const d = new Date(dateStr);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}.${month}.${year}`;
    };

    let message = `🔄 <b>Результаты пересчета</b>\n\n`;
    message += `📅 Дата: ${formatDate(date)}\n`;
    message += `🏆 Тур: ${round}\n`;
    message += `🎯 Турнир: ${event.event_name}\n\n`;
    message += `📈 Статистика:\n`;

    const sortedUsers = Object.entries(userStats).sort(([, a], [, b]) => b.points - a.points);
    
    if (sortedUsers.length === 0) {
      message += `Нет результатов\n`;
    } else {
      // Определяем уникальные значения очков для присвоения мест
      const uniqueScores = [...new Set(sortedUsers.map(([, stats]) => stats.points))];
      
      sortedUsers.forEach(([username, stats]) => {
        // Определяем место по уникальному значению очков
        const place = uniqueScores.indexOf(stats.points) + 1;
        
        // Присваиваем медаль по месту (только первые 3 места получают медали)
        const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '▪️';
        
        const statsText = [];
        if (stats.correctResults > 0) {
          statsText.push(`✅ ${stats.correctResults}`);
        }
        if (stats.correctScores > 0) {
          statsText.push(`🎯 ${stats.correctScores}`);
        }
        if (stats.correctYellowCards > 0) {
          statsText.push(`🟨 ${stats.correctYellowCards}`);
        }
        if (stats.correctRedCards > 0) {
          statsText.push(`🟥 ${stats.correctRedCards}`);
        }
        const statsStr = statsText.length > 0 ? ` (${statsText.join(', ')})` : '';
        message += `${medal} ${username}: ${stats.points} ${stats.points === 1 ? 'очко' : stats.points < 5 ? 'очка' : 'очков'}${statsStr}\n`;
      });
    }

    console.log(`✅ Пересчет завершен`);

    // Шаг 6: Отправляем уведомления если нужно
    if (sendToGroup || sendToUsers) {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

      if (!TELEGRAM_BOT_TOKEN) {
        console.log('⚠️ Telegram не настроен, уведомления не отправлены');
      } else {
        // Отправляем в группу
        if (sendToGroup && TELEGRAM_CHAT_ID) {
          const chatIds = TELEGRAM_CHAT_ID.split(",").map((id) => id.trim());
          for (const chatId of chatIds) {
            try {
              await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: chatId,
                    text: message,
                    parse_mode: "HTML",
                  }),
                }
              );
              console.log(`✅ Результаты пересчета отправлены в группу ${chatId}`);
            } catch (error) {
              console.error(`❌ Ошибка отправки в группу ${chatId}:`, error);
            }
          }
        }

        // Отправляем пользователям
        if (sendToUsers && sortedUsers.length > 0) {
          const maxPoints = sortedUsers[0][1].points;
          const minPoints = sortedUsers[sortedUsers.length - 1][1].points;
          const winners = sortedUsers.filter(([, stats]) => stats.points === maxPoints);
          
          // Определяем уникальные значения очков для присвоения мест
          const uniqueScores = [...new Set(sortedUsers.map(([, stats]) => stats.points))];
          
          for (const [username, stats] of sortedUsers) {
            if (!stats.telegramId || stats.telegramNotificationsEnabled !== 1) continue;
            
            let personalMessage = '🔄 <b>Результаты пересчета</b>\n\n';
            personalMessage += `📅 Дата: ${formatDate(date)}\n`;
            personalMessage += `🏆 Тур: ${round}\n`;
            personalMessage += `🎯 Турнир: ${event.event_name}\n\n`;
            personalMessage += `📈 Статистика:\n`;
            
            // Добавляем список всех участников с медалями
            sortedUsers.forEach(([uname, ustats]) => {
              // Определяем место по уникальному значению очков
              const place = uniqueScores.indexOf(ustats.points) + 1;
              
              // Присваиваем медаль по месту
              const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '▪️';
              
              const statsText = [];
              if (ustats.correctResults > 0) {
                statsText.push(`✅ ${ustats.correctResults}`);
              }
              if (ustats.correctScores > 0) {
                statsText.push(`🎯 ${ustats.correctScores}`);
              }
              if (ustats.correctYellowCards > 0) {
                statsText.push(`🟨 ${ustats.correctYellowCards}`);
              }
              if (ustats.correctRedCards > 0) {
                statsText.push(`🟥 ${ustats.correctRedCards}`);
              }
              const statsStr = statsText.length > 0 ? ` (${statsText.join(', ')})` : '';
              personalMessage += `${medal} ${uname}: ${ustats.points} ${ustats.points === 1 ? 'очко' : ustats.points < 5 ? 'очка' : 'очков'}${statsStr}\n`;
            });
            
            personalMessage += '\n';
            
            // Добавляем персонализированное окончание
            let userPointsWord;
            if (stats.points === 0) {
              userPointsWord = 'очков';
            } else if (stats.points === 1) {
              userPointsWord = 'очко';
            } else if (stats.points >= 2 && stats.points <= 4) {
              userPointsWord = 'очка';
            } else {
              userPointsWord = 'очков';
            }

            if (stats.points === maxPoints) {
              // Пользователь лучший (или один из лучших)
              if (winners.length === 1) {
                personalMessage += `Сегодня ты лучший, у тебя <b>${stats.points} ${userPointsWord}</b>, поздравляю, малютка 👑 ${username}! 🎉`;
              } else {
                personalMessage += `Сегодня ты один из лучших, у тебя <b>${stats.points} ${userPointsWord}</b>, поздравляю, малютка 👑 ${username}! 🎉`;
              }
            } else if (stats.points === minPoints) {
              // Пользователь худший (или один из худших)
              if (winners.length === 1) {
                personalMessage += `Сегодня ты лох, такое может случиться с каждым, у тебя <b>${stats.points} ${userPointsWord}</b>, а лучший, это малютка 👑 ${winners[0][0]}! 🎉`;
              } else {
                const winnerNames = winners.map(([name]) => name).join(' и ');
                personalMessage += `Сегодня ты лох, такое может случиться с каждым, у тебя <b>${stats.points} ${userPointsWord}</b>, а лучшие, это малютки 👑 ${winnerNames}! 🎉`;
              }
            } else {
              // Пользователь в середине
              if (winners.length === 1) {
                personalMessage += `Сегодня ты не лучший, у тебя <b>${stats.points} ${userPointsWord}</b>, а лучший, это малютка 👑 ${winners[0][0]}! 🎉`;
              } else {
                const winnerNames = winners.map(([name]) => name).join(' и ');
                personalMessage += `Сегодня ты не лучший, у тебя <b>${stats.points} ${userPointsWord}</b>, а лучшие, это малютки 👑 ${winnerNames}! 🎉`;
              }
            }
            
            try {
              await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: stats.telegramId,
                    text: personalMessage,
                    parse_mode: "HTML",
                  }),
                }
              );
              console.log(`✅ Результаты пересчета отправлены пользователю ${username}`);
            } catch (error) {
              console.error(`❌ Ошибка отправки пользователю ${username}:`, error);
            }
            
            // Задержка между отправками
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      }
    }

    console.log(`\n🔄 ========================================`);
    console.log(`🔄 ПЕРЕСЧЕТ ЗАВЕРШЕН`);
    console.log(`🔄 ========================================\n`);

    res.json({ 
      success: true, 
      message: `Результаты успешно пересчитаны! Обновлено матчей: ${resetResult.changes}`,
      matchesUpdated: resetResult.changes,
      betsProcessed: bets.length
    });

  } catch (error) {
    console.error("❌ Ошибка пересчета результатов:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/clear-logs - Очистить файл логов (только для админа)
app.post("/api/admin/clear-logs", (req, res) => {
  const { username } = req.body;

  // Проверяем, является ли пользователь админом
  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    resetLogFile();
    console.log("🗑️ Логи очищены админом:", username);
    res.json({ message: "Логи успешно очищены" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/migrate-logs - Обновить файл логов без удаления содержимого (добавить недостающий код)
app.post("/api/admin/migrate-logs", (req, res) => {
  const { username } = req.body;

  // Проверяем, является ли пользователь админом
  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    if (!fs.existsSync(LOG_FILE_PATH)) {
      return res.status(404).json({ error: "Файл логов не найден" });
    }

    // Читаем текущий файл
    let content = fs.readFileSync(LOG_FILE_PATH, 'utf-8');

    // Проверяем, есть ли уже код для отображения размера файла
    if (content.includes('logFileInfo')) {
      return res.json({ message: "Файл логов уже содержит код отображения размера", alreadyMigrated: true });
    }

    // Находим закрывающий тег </p> после "История всех ставок и удалений"
    const headerEndRegex = /<p>История всех ставок и удалений<\/p>/;
    
    if (!headerEndRegex.test(content)) {
      return res.status(400).json({ error: "Не удалось найти заголовок в файле логов" });
    }

    // Добавляем код для отображения размера файла после заголовка
    const logFileInfoDiv = `
    <div id="logFileInfo" style="margin-top: 10px; font-size: 0.85em; color: #999;">
      Загрузка информации о файле...
    </div>`;

    content = content.replace(
      /<p>История всех ставок и удалений<\/p>/,
      `<p>История всех ставок и удалений</p>${logFileInfoDiv}`
    );

    // Проверяем, есть ли уже скрипт для загрузки информации
    if (!content.includes('loadLogFileInfo')) {
      // Находим закрывающий тег </body>
      const scriptCode = `
  <script>
    // Загрузить информацию о размере файла логов
    async function loadLogFileInfo() {
      try {
        const response = await fetch('/api/bet-logs-info');
        const data = await response.json();
        
        if (data.success) {
          const infoDiv = document.getElementById('logFileInfo');
          const percentColor = data.percentUsed > 80 ? '#f44336' : data.percentUsed > 50 ? '#ff9800' : '#4caf50';
          
          infoDiv.innerHTML = \`
            📊 Размер файла: <strong style="color: #5a9fd4;">\${data.sizeFormatted}</strong> / \${data.maxSizeFormatted}
            <span style="color: \${percentColor}; margin-left: 10px;">(\${data.percentUsed}% использовано)</span>
          \`;
        }
      } catch (error) {
        console.error('Ошибка загрузки информации о файле:', error);
        document.getElementById('logFileInfo').innerHTML = '⚠️ Не удалось загрузить информацию о файле';
      }
    }
    
    // Загружаем информацию при загрузке страницы
    loadLogFileInfo();
    
    // Обновляем каждые 30 секунд
    setInterval(loadLogFileInfo, 30000);
  </script>`;

      content = content.replace('</body>', `${scriptCode}
</body>`);
    }

    // Сохраняем обновленный файл
    fs.writeFileSync(LOG_FILE_PATH, content, 'utf-8');
    
    console.log("✅ Файл логов успешно обновлен (миграция)");
    res.json({ message: "Файл логов успешно обновлен", migrated: true });
  } catch (error) {
    console.error("❌ Ошибка миграции файла логов:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/final-parameters-results - Установить результаты финальных параметров
app.post("/api/admin/final-parameters-results", (req, res) => {
  const {
    matchId,
    exact_score,
    yellow_cards,
    red_cards,
    corners,
    penalties_in_game,
    extra_time,
    penalties_at_end,
    username,
  } = req.body;

  // Проверяем, является ли пользователь админом
  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    // Создаём таблицу если её ещё нет
    db.exec(`
      CREATE TABLE IF NOT EXISTS final_parameters_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL UNIQUE,
        exact_score TEXT,
        yellow_cards INTEGER,
        red_cards INTEGER,
        corners INTEGER,
        penalties_in_game TEXT,
        extra_time TEXT,
        penalties_at_end TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (match_id) REFERENCES matches(id)
      )
    `);

    // Вставляем или обновляем результаты
    db.prepare(
      `
      INSERT INTO final_parameters_results 
      (match_id, exact_score, yellow_cards, red_cards, corners, penalties_in_game, extra_time, penalties_at_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(match_id) DO UPDATE SET
        exact_score = excluded.exact_score,
        yellow_cards = excluded.yellow_cards,
        red_cards = excluded.red_cards,
        corners = excluded.corners,
        penalties_in_game = excluded.penalties_in_game,
        extra_time = excluded.extra_time,
        penalties_at_end = excluded.penalties_at_end
    `
    ).run(
      matchId,
      exact_score || null,
      yellow_cards !== undefined ? yellow_cards : null,
      red_cards !== undefined ? red_cards : null,
      corners !== undefined ? corners : null,
      penalties_in_game || null,
      extra_time || null,
      penalties_at_end || null
    );

    console.log(
      `✓ Результаты финальных параметров установлены для матча ${matchId}`
    );

    res.json({
      message: "Результаты финальных параметров успешно установлены",
      matchId,
    });
  } catch (error) {
    console.error("Ошибка при установке результатов параметров:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/final-parameters-results - Получить результаты финальных параметров
app.get("/api/final-parameters-results", (req, res) => {
  console.log("🔵 GET /api/final-parameters-results был вызван");
  try {
    const results = db.prepare("SELECT * FROM final_parameters_results").all();

    console.log("✓ Найдено параметров:", results.length);

    // Преобразуем в объект с ключом match_id для удобства
    const resultsMap = {};
    results.forEach((result) => {
      resultsMap[result.match_id] = result;
    });

    console.log("✓ Отправляю результат");
    res.json(resultsMap);
  } catch (error) {
    console.error("❌ Ошибка при получении результатов параметров:", error);
    // Если таблица не существует, возвращаем пустой объект
    res.json({});
  }
});

// POST /api/backup - Создать бэкап базы данных
app.post("/api/backup", async (req, res) => {
  try {
    const { username } = req.body;
    
    // Проверяем что юзер админ или модератор с правами
    const isAdminUser = username === process.env.ADMIN_DB_NAME;

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, -5);
    const backupFilename = `1xBetLineBoom_backup_${timestamp}.db`;
    const backupPath = path.join(BACKUPS_DIR, backupFilename);
    const dbPath = path.join(__dirname, "1xBetLineBoom.db");

    // Синхронизируем все изменения в основной файл БД перед копированием
    db.pragma("synchronous = FULL");
    console.log("✓ Синхронизация БД выполнена перед созданием бэкапа");

    // Копируем файл БД
    fs.copyFileSync(dbPath, backupPath);

    // Сохраняем метаданные бэкапа
    const metadataPath = path.join(BACKUPS_DIR, 'backups-metadata.json');
    let metadata = {};
    
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      } catch (err) {
        console.error('Ошибка чтения метаданных:', err);
      }
    }
    
    metadata[backupFilename] = {
      createdBy: username || 'unknown',
      isAdmin: isAdminUser,
      createdAt: new Date().toISOString(),
      isLocked: false
    };
    
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    console.log(`✓ Бэкап БД создан: ${backupFilename} (пользователь: ${username})`);

    // Уведомление админу если это модератор
    if (!isAdminUser && username) {
      const isModerator = db.prepare("SELECT id FROM moderators WHERE user_id = (SELECT id FROM users WHERE username = ?)").get(username);
      if (isModerator) {
        const fileSize = (fs.statSync(backupPath).size / 1024 / 1024).toFixed(2);
        const details = `💾 Файл: ${backupFilename}
📦 Размер: ${fileSize} MB`;
        
        await notifyModeratorAction(username, "Создание бэкапа БД", details);
        
        // Запись в логи
        writeBetLog("backup_created", {
          moderator: username,
          filename: backupFilename,
          size: `${fileSize} MB`
        });
      }
    }

    res.json({
      success: true,
      filename: backupFilename,
      timestamp: new Date().toISOString(),
      message: "Бэкап успешно создан",
    });
  } catch (error) {
    console.error("❌ Ошибка при создании бэкапа БД:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /download-backup/:filename - Скачать бэкап БД
app.get("/download-backup/:filename", async (req, res) => {
  try {
    const filename = req.params.filename;
    const username = req.query.username; // Получаем username из query параметров

    // Проверяем права
    const isAdminUser = username === process.env.ADMIN_DB_NAME;
    let isModerator = false;
    
    if (!isAdminUser) {
      // Проверяем права модератора
      const moderator = db.prepare(`
        SELECT permissions FROM moderators 
        WHERE user_id = (SELECT id FROM users WHERE username = ?)
      `).get(username);
      
      if (moderator) {
        const permissions = JSON.parse(moderator.permissions || "[]");
        isModerator = permissions.includes("download_backup");
      }
      
      if (!isModerator) {
        return res.status(403).json({ error: "Недостаточно прав для скачивания бэкапов" });
      }
    }

    // Проверяем что имя файла содержит только допустимые символы (безопасность)
    if (!/^1xBetLineBoom_backup_(before_restore_)?[\dT\-]+\.db$/.test(filename)) {
      return res.status(400).json({ error: "Неверное имя файла" });
    }

    const backupPath = path.join(BACKUPS_DIR, filename);

    // Проверяем что файл существует
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: "Файл бэкапа не найден" });
    }

    // Уведомление админу если это модератор
    if (isModerator && username) {
      const fileSize = (fs.statSync(backupPath).size / 1024 / 1024).toFixed(2);
      const details = `💾 Файл: ${filename}
📦 Размер: ${fileSize} MB`;
      
      await notifyModeratorAction(username, "Скачивание бэкапа БД", details);
      
      // Запись в логи
      writeBetLog("backup_downloaded", {
        moderator: username,
        filename: filename,
        size: `${fileSize} MB`
      });
    }

    // Отправляем файл
    res.download(backupPath, filename, (err) => {
      if (err) {
        console.error("❌ Ошибка при скачивании файла:", err);
      } else {
        console.log(`✓ Бэкап БД скачан: ${filename} (пользователь: ${username || 'неизвестен'})`);
      }
    });
  } catch (error) {
    console.error("❌ Ошибка при скачивании бэкапа:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/backups - Получить список бэкапов
app.get("/api/admin/backups", (req, res) => {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      return res.json([]);
    }

    // Загружаем метаданные
    const metadataPath = path.join(BACKUPS_DIR, 'backups-metadata.json');
    let metadata = {};
    
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      } catch (err) {
        console.error('Ошибка чтения метаданных:', err);
      }
    }

    const files = fs.readdirSync(BACKUPS_DIR);
    let metadataUpdated = false;
    
    // Получаем список существующих .db файлов
    const existingFiles = files.filter(file => file.endsWith('.db'));
    
    // Удаляем из metadata записи для несуществующих файлов
    for (const key in metadata) {
      if (!existingFiles.includes(key)) {
        console.log(`🗑️ Удаление записи из metadata для несуществующего файла: ${key}`);
        delete metadata[key];
        metadataUpdated = true;
      }
    }
    
    const backups = existingFiles
      .map(file => {
        const filePath = path.join(BACKUPS_DIR, file);
        const stats = fs.statSync(filePath);
        let fileMetadata = metadata[file];
        
        // Если метаданных нет для этого файла - создаем их
        if (!fileMetadata) {
          fileMetadata = {
            createdBy: 'unknown',
            isAdmin: false,
            createdAt: stats.birthtime.toISOString(),
            isLocked: false
          };
          metadata[file] = fileMetadata;
          metadataUpdated = true;
        }
        
        return {
          filename: file,
          size: stats.size,
          created: stats.birthtime,
          sizeFormatted: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
          createdBy: fileMetadata.createdBy || 'unknown',
          isAdminBackup: fileMetadata.isAdmin || false,
          isLocked: fileMetadata.isLocked || false
        };
      })
      .sort((a, b) => b.created - a.created); // Сортируем по дате, новые первые

    // Сохраняем обновленные метаданные если были изменения
    if (metadataUpdated) {
      try {
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        console.log('✅ Метаданные бэкапов обновлены');
      } catch (err) {
        console.error('⚠️ Ошибка сохранения метаданных:', err);
      }
    }

    res.json(backups);
  } catch (error) {
    console.error("❌ Ошибка при получении списка бэкапов:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/restore-backup - Восстановить БД из бэкапа
app.post("/api/admin/restore-backup", async (req, res) => {
  const { filename, username } = req.body;

  // Проверяем права
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    if (!permissions.includes("restore_db")) {
      return res.status(403).json({ error: "Недостаточно прав для восстановления БД" });
    }
  }

  try {
    if (!filename) {
      return res.status(400).json({ error: "Имя файла не указано" });
    }

    console.log(`🔍 Проверка имени файла для восстановления: "${filename}"`);

    // Проверяем что имя файла содержит только допустимые символы (безопасность)
    // Разрешаем как обычные бэкапы, так и бэкапы before_restore
    if (!/^1xBetLineBoom_backup_(before_restore_)?[\dT\-]+\.db$/.test(filename)) {
      console.log(`❌ Имя файла не прошло проверку: "${filename}"`);
      return res.status(400).json({ error: "Неверное имя файла" });
    }

    const backupPath = path.join(BACKUPS_DIR, filename);
    const dbPath = path.join(__dirname, "1xBetLineBoom.db");

    // Проверяем что файл бэкапа существует
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: "Файл бэкапа не найден" });
    }

    // Создаем бэкап текущей БД перед восстановлением
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, -5);
    const currentBackupFilename = `1xBetLineBoom_backup_before_restore_${timestamp}.db`;
    const currentBackupPath = path.join(BACKUPS_DIR, currentBackupFilename);
    
    fs.copyFileSync(dbPath, currentBackupPath);
    console.log(`✓ Создан бэкап текущей БД: ${currentBackupFilename}`);

    // Закрываем текущее соединение с БД
    db.close();

    // Копируем бэкап на место текущей БД
    fs.copyFileSync(backupPath, dbPath);
    console.log(`✓ БД восстановлена из бэкапа: ${filename} (пользователь: ${username})`);

    // Переоткрываем соединение с БД
    db = new Database("./1xBetLineBoom.db");
    db.pragma("journal_mode = DELETE");

    // Запускаем миграции для восстановленной БД
    console.log("🔄 Запуск миграций после восстановления БД...");
    runUsersMigrations();
    console.log("✅ Миграции после восстановления завершены");

    // Уведомление админу если это модератор
    if (!isAdminUser && username) {
      const details = `📥 Восстановлено из: ${filename}
💾 Создан бэкап текущей БД: ${currentBackupFilename}`;
      
      await notifyModeratorAction(username, "Восстановление БД", details);
      
      // Запись в логи
      writeBetLog("backup_restored", {
        moderator: username,
        filename: filename,
        currentBackup: currentBackupFilename
      });
    }

    res.json({
      success: true,
      message: "БД успешно восстановлена",
      restored_from: filename,
      backup_created: currentBackupFilename
    });
  } catch (error) {
    console.error("❌ Ошибка при восстановлении БД:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/delete-backup - Удалить бэкап
app.post("/api/admin/delete-backup", async (req, res) => {
  const { filename, username } = req.body;

  // Проверяем права
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    if (!permissions.includes("delete_backup")) {
      return res.status(403).json({ error: "Недостаточно прав для удаления бэкапов" });
    }
  }

  try {
    if (!filename) {
      return res.status(400).json({ error: "Имя файла не указано" });
    }

    console.log(`🔍 Попытка удаления бэкапа: "${filename}"`);

    // Проверяем что имя файла содержит только допустимые символы (безопасность)
    if (!/^1xBetLineBoom_backup_(before_restore_)?[\dT\-]+\.db$/.test(filename)) {
      console.log(`❌ Имя файла не прошло проверку: "${filename}"`);
      return res.status(400).json({ error: "Неверное имя файла" });
    }

    const backupPath = path.join(BACKUPS_DIR, filename);

    // Проверяем что файл бэкапа существует
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: "Файл бэкапа не найден" });
    }

    // Загружаем метаданные
    const metadataPath = path.join(BACKUPS_DIR, 'backups-metadata.json');
    let metadata = {};
    
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      } catch (err) {
        console.error('Ошибка чтения метаданных:', err);
      }
    }

    // Проверка: Бэкап заблокирован?
    const fileMetadata = metadata[filename];
    if (fileMetadata && fileMetadata.isLocked) {
      return res.status(403).json({ 
        error: "Этот бэкап заблокирован и не может быть удален",
        isLocked: true
      });
    }

    // Удаляем файл
    fs.unlinkSync(backupPath);
    
    // Удаляем метаданные
    if (metadata[filename]) {
      delete metadata[filename];
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    }
    
    console.log(`✓ Бэкап удален: ${filename} (пользователь: ${username})`);

    // Уведомление админу если это модератор
    if (!isAdminUser && username) {
      const details = `🗑️ Файл: ${filename}`;
      
      await notifyModeratorAction(username, "Удаление бэкапа БД", details);
      
      // Запись в логи
      writeBetLog("backup_deleted", {
        moderator: username,
        filename: filename
      });
    }

    res.json({
      success: true,
      message: "Бэкап успешно удален",
      deleted_file: filename
    });
  } catch (error) {
    console.error("❌ Ошибка при удалении бэкапа:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/toggle-backup-lock - Заблокировать/разблокировать бэкап (только для админа)
app.post("/api/admin/toggle-backup-lock", (req, res) => {
  const { filename, username } = req.body;

  // Проверяем что пользователь админ
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  
  if (!isAdminUser) {
    return res.status(403).json({ error: "Только админ может блокировать/разблокировать бэкапы" });
  }

  try {
    if (!filename) {
      return res.status(400).json({ error: "Имя файла не указано" });
    }

    console.log(`🔍 Попытка изменения блокировки бэкапа: "${filename}"`);

    // Проверяем что имя файла содержит только допустимые символы (безопасность)
    if (!/^1xBetLineBoom_backup_(before_restore_)?[\dT\-]+\.db$/.test(filename)) {
      console.log(`❌ Имя файла не прошло проверку: "${filename}"`);
      return res.status(400).json({ error: "Неверное имя файла" });
    }

    const backupPath = path.join(BACKUPS_DIR, filename);

    // Проверяем что файл бэкапа существует
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: "Файл бэкапа не найден" });
    }

    // Загружаем метаданные
    const metadataPath = path.join(BACKUPS_DIR, 'backups-metadata.json');
    let metadata = {};
    
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      } catch (err) {
        console.error('Ошибка чтения метаданных:', err);
      }
    }

    // Инициализируем метаданные если их нет
    if (!metadata[filename]) {
      metadata[filename] = {
        createdBy: 'unknown',
        isAdmin: false,
        createdAt: new Date().toISOString(),
        isLocked: false
      };
    }

    // Переключаем статус блокировки
    const newLockStatus = !metadata[filename].isLocked;
    metadata[filename].isLocked = newLockStatus;
    
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    
    const statusText = newLockStatus ? 'заблокирован' : 'разблокирован';
    console.log(`✓ Бэкап ${statusText}: ${filename} (пользователь: ${username})`);

    res.json({
      success: true,
      message: `Бэкап успешно ${statusText}`,
      filename: filename,
      isLocked: newLockStatus
    });
  } catch (error) {
    console.error("❌ Ошибка при изменении блокировки бэкапа:", error);
    res.status(500).json({ error: error.message });
  }
});

// Запуск Telegram бота
startBot();

// Запуск фоновой задачи для напоминания непроголосовавших пользователей (каждые 5 минут)
setInterval(checkAndRemindNonVoters, 5 * 60 * 1000);
console.log(
  "🔔 Фоновая задача проверки непроголосовавших пользователей запущена (интервал: 5 минут)"
);

// Запуск фоновой задачи для уведомления о начале матча (каждую минуту)
setInterval(checkAndNotifyMatchStart, 60 * 1000);
console.log(
  "⚽ Фоновая задача уведомления о начале матча запущена (интервал: 1 минута)"
);

// Запуск фоновой задачи для уведомления за 3 часа до матча (каждые 5 минут)
setInterval(checkAndNotifyUpcomingMatches, 5 * 60 * 1000);
// Запускаем сразу при старте сервера
checkAndNotifyUpcomingMatches();
console.log(
  "🔔 Фоновая задача уведомления за 3 часа до матча запущена (интервал: 5 минут)"
);

// Запуск фоновой задачи для персональных напоминаний из модального окна (каждые 5 минут)
setInterval(checkAndSendPersonalReminders, 5 * 60 * 1000);
// Запускаем сразу при старте сервера
checkAndSendPersonalReminders();
console.log(
  "🔔 Фоновая задача персональных напоминаний запущена (интервал: 5 минут)"
);

// GET /api/admin/orphaned-data - Проверить orphaned данные (для админа и модераторов с правами)
app.get("/api/admin/orphaned-data", (req, res) => {
  const username = req.query.username;

  console.log(`🔍 Запрос orphaned-data от пользователя: "${username}"`);

  // Проверяем права
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("manage_orphaned");
    }
    
    if (!isModerator) {
      console.log(`❌ Доступ запрещён: пользователь "${username}" не имеет прав`);
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  try {
    // Матчи, чьи события удалены
    const orphanedMatches = db
      .prepare(
        `SELECT m.id, m.team1_name, m.team2_name, m.match_date, m.event_id 
         FROM matches m 
         LEFT JOIN events e ON m.event_id = e.id 
         WHERE e.id IS NULL`
      )
      .all();

    // Ставки, чьи матчи удалены
    const orphanedBets = db
      .prepare(
        `SELECT b.id, b.user_id, b.match_id, b.prediction 
         FROM bets b 
         LEFT JOIN matches m ON b.match_id = m.id 
         WHERE m.id IS NULL`
      )
      .all();

    // Финальные ставки, чьи матчи удалены
    let orphanedFinalBets = [];
    try {
      orphanedFinalBets = db
        .prepare(
          `SELECT fb.id, fb.user_id, fb.match_id 
           FROM final_bets fb 
           LEFT JOIN matches m ON fb.match_id = m.id 
           WHERE m.id IS NULL`
        )
        .all();
    } catch (e) {
      // Таблица не существует
    }

    // Напоминания, чьи матчи удалены
    const orphanedReminders = db
      .prepare(
        `SELECT sr.id, sr.match_id, sr.sent_at 
         FROM sent_reminders sr 
         LEFT JOIN matches m ON sr.match_id = m.id 
         WHERE m.id IS NULL`
      )
      .all();

    // Награды, чьи события удалены
    const orphanedAwards = db
      .prepare(
        `SELECT ta.id, ta.event_id, ta.user_id 
         FROM tournament_awards ta 
         LEFT JOIN events e ON ta.event_id = e.id 
         WHERE e.id IS NULL`
      )
      .all();

    // Параметры финала, чьи матчи удалены
    const orphanedFinalParams = db
      .prepare(
        `SELECT fp.id, fp.match_id 
         FROM final_parameters_results fp 
         LEFT JOIN matches m ON fp.match_id = m.id 
         WHERE m.id IS NULL`
      )
      .all();

    const summary = {
      total_orphaned: {
        matches: orphanedMatches.length,
        bets: orphanedBets.length,
        final_bets: orphanedFinalBets.length,
        reminders: orphanedReminders.length,
        awards: orphanedAwards.length,
        final_parameters: orphanedFinalParams.length,
      },
      orphaned_matches: orphanedMatches,
      orphaned_bets: orphanedBets,
      orphaned_final_bets: orphanedFinalBets,
      orphaned_reminders: orphanedReminders,
      orphaned_awards: orphanedAwards,
      orphaned_final_parameters: orphanedFinalParams,
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/cleanup-orphaned-data - Удалить orphaned данные (только для админа)
app.post("/api/admin/cleanup-orphaned-data", async (req, res) => {
  const { username, dataType } = req.body;

  // Проверяем, является ли пользователь админом или модератором с правами
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("manage_orphaned");
    }
    
    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  try {
    const deletedCounts = {};

    // Если dataType не указан или равен "all", удаляем всё
    const deleteAll = !dataType || dataType === "all";

    if (deleteAll || dataType === "final_parameters") {
      // Удаляем orphaned параметры финала
      const result1 = db.exec(
        `DELETE FROM final_parameters_results 
         WHERE match_id NOT IN (SELECT id FROM matches)`
      );
      deletedCounts.final_parameters = result1.changes || 0;
    }

    if (deleteAll || dataType === "final_bets") {
      // Удаляем orphaned финальные ставки
      try {
        const result2 = db.exec(
          `DELETE FROM final_bets 
           WHERE match_id NOT IN (SELECT id FROM matches)`
        );
        deletedCounts.final_bets = result2.changes || 0;
      } catch (e) {
        // Таблица не существует
      }
    }

    if (deleteAll || dataType === "reminders") {
      // Удаляем orphaned напоминания
      const result3 = db.exec(
        `DELETE FROM sent_reminders 
         WHERE match_id NOT IN (SELECT id FROM matches)`
      );
      deletedCounts.reminders = result3.changes || 0;
    }

    if (deleteAll || dataType === "bets") {
      // Удаляем orphaned ставки
      const result4 = db.exec(
        `DELETE FROM bets 
         WHERE match_id NOT IN (SELECT id FROM matches)`
      );
      deletedCounts.bets = result4.changes || 0;
    }

    if (deleteAll || dataType === "awards") {
      // Удаляем orphaned награды
      const result5 = db.exec(
        `DELETE FROM tournament_awards 
         WHERE event_id NOT IN (SELECT id FROM events)`
      );
      deletedCounts.awards = result5.changes || 0;
    }

    if (deleteAll || dataType === "matches") {
      // Удаляем orphaned матчи
      const result6 = db.exec(
        `DELETE FROM matches 
         WHERE event_id NOT IN (SELECT id FROM events)`
      );
      deletedCounts.matches = result6.changes || 0;
    }

    res.json({
      message: "✅ Orphaned данные успешно удалены",
      deleted: deletedCounts,
    });

    // Уведомление админу если это модератор
    if (isModerator && username) {
      const totalDeleted = Object.values(deletedCounts).reduce((sum, count) => sum + count, 0);
      const detailsText = `🗑️ Всего удалено: ${totalDeleted}
${Object.entries(deletedCounts).map(([key, count]) => `  • ${key}: ${count}`).join('\n')}`;
      
      await notifyModeratorAction(username, "Очистка orphaned данных", detailsText);
      
      // Запись в логи
      const detailsFormatted = Object.entries(deletedCounts)
        .map(([key, count]) => `${key}: ${count}`)
        .join(', ');
      
      writeBetLog("orphaned_cleaned", {
        moderator: username,
        details: detailsFormatted
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== API ENDPOINTS ДЛЯ ТЕРМИНАЛА =====

// GET /api/bet-logs-info - получить информацию о файле логов ставок
app.get("/api/bet-logs-info", (req, res) => {
  try {
    if (fs.existsSync(LOG_FILE_PATH)) {
      const stats = fs.statSync(LOG_FILE_PATH);
      const sizeInMB = (stats.size / 1024 / 1024).toFixed(2);
      const maxSizeInMB = (MAX_LOG_SIZE / 1024 / 1024).toFixed(0);
      const percentUsed = ((stats.size / MAX_LOG_SIZE) * 100).toFixed(1);
      
      res.json({
        success: true,
        size: stats.size,
        sizeFormatted: `${sizeInMB} MB`,
        maxSize: MAX_LOG_SIZE,
        maxSizeFormatted: `${maxSizeInMB} MB`,
        percentUsed: percentUsed
      });
    } else {
      res.json({
        success: true,
        size: 0,
        sizeFormatted: "0 MB",
        maxSize: MAX_LOG_SIZE,
        maxSizeFormatted: "10 MB",
        percentUsed: "0"
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/terminal-logs - получить логи терминала
app.get("/api/terminal-logs", (req, res) => {
  try {
    const logs = terminalLogs.join("\n");
    res.json({
      success: true,
      logs: logs || "[Логи пусты]",
      count: terminalLogs.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// DELETE /api/terminal-logs - очистить логи терминала
app.delete("/api/terminal-logs", (req, res) => {
  try {
    terminalLogs = [];

    // Очищаем файл логов
    try {
      fs.writeFileSync(TERMINAL_LOGS_PATH, "", "utf-8");
    } catch (err) {
      console.error("Ошибка при очистке файла логов:", err);
    }

    res.json({
      success: true,
      message: "✅ Логи терминала очищены",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Отправка уведомления о подсчете ставок в Telegram
app.post("/api/notify-counting-results", async (req, res) => {
  try {
    const { dateFrom, dateTo, results } = req.body;

    if (!dateFrom || !dateTo || !results) {
      return res
        .status(400)
        .json({ error: "Не указаны обязательные параметры" });
    }

    // Группируем результаты по пользователям и считаем очки
    const userStats = {};

    results.forEach((result) => {
      const username = result.username;
      if (!userStats[username]) {
        userStats[username] = {
          points: 0,
          correctResults: 0,
          correctScores: 0
        };
      }
      
      if (result.isWon) {
        // Базовое очко за результат
        userStats[username].points++;
        userStats[username].correctResults++;
        
        // Проверяем угаданный счет
        if (result.scoreIsWon) {
          userStats[username].points++;
          userStats[username].correctScores++;
        }
      }
    });

    // Находим победителя (максимальное количество очков)
    let maxPoints = 0;
    let winner = null;
    Object.entries(userStats).forEach(([username, stats]) => {
      if (stats.points > maxPoints) {
        maxPoints = stats.points;
        winner = username;
      }
    });

    // Форматируем даты в дд.мм.гггг
    const formatDate = (dateStr) => {
      const date = new Date(dateStr);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}.${month}.${year}`;
    };

    // Формируем сообщение
    const dateStr = new Date().toLocaleDateString("ru-RU");
    let message = `📊 <b>Результаты подсчета ставок</b>\n\n`;
    message += `📅 Дата: ${dateStr}\n`;
    message += `📆 Период: ${formatDate(dateFrom)} - ${formatDate(dateTo)}\n\n`;

    if (winner) {
      const winnerStats = userStats[winner];
      message += `🏆 Победитель дня: <b>${winner}</b> (${winnerStats.points} ${winnerStats.points === 1 ? 'очко' : winnerStats.points < 5 ? 'очка' : 'очков'})\n\n`;
    }

    message += `📈 Статистика участников:\n`;
    Object.entries(userStats)
      .sort(([, a], [, b]) => b.points - a.points)
      .forEach(([username, stats]) => {
        const statsText = [];
        if (stats.correctResults > 0) {
          statsText.push(`✅ ${stats.correctResults}`);
        }
        if (stats.correctScores > 0) {
          statsText.push(`🎯 ${stats.correctScores}`);
        }
        const statsStr = statsText.length > 0 ? ` (${statsText.join(', ')})` : '';
        message += `• ${username}: ${stats.points} ${stats.points === 1 ? 'очко' : stats.points < 5 ? 'очка' : 'очков'}${statsStr}\n`;
      });

    // Отправляем сообщение только админу в Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
      console.error("❌ Telegram токен или admin ID не настроены");
      return res.status(500).json({ error: "Telegram не настроен" });
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_id: TELEGRAM_ADMIN_ID,
            text: message,
            parse_mode: "HTML",
          }),
        }
      );

      if (!response.ok) {
        console.error(
          `❌ Ошибка отправки админу ${TELEGRAM_ADMIN_ID}:`,
          response.statusText
        );
      } else {
        console.log(`✅ Уведомление отправлено админу ${TELEGRAM_ADMIN_ID}`);
      }
    } catch (error) {
      console.error(`❌ Ошибка отправки уведомления админу:`, error);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Ошибка при отправке уведомления:", error);
    res.status(500).json({ error: error.message });
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Получен SIGINT, останавливаем сервер...");
  stopBot();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Получен SIGTERM, останавливаем сервер...");
  stopBot();
  process.exit(0);
});

// Тестовый endpoint для проверки начисления очков за счет
app.get("/api/test/score-points/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    
    // Получаем все завершенные ставки пользователя с прогнозом на счет
    const betsWithScore = db.prepare(`
      SELECT 
        b.id as bet_id,
        b.prediction,
        m.team1_name,
        m.team2_name,
        m.winner,
        m.is_final,
        m.score_prediction_enabled,
        m.yellow_cards_prediction_enabled,
        m.red_cards_prediction_enabled,
        sp.score_team1 as predicted_score1,
        sp.score_team2 as predicted_score2,
        ms.score_team1 as actual_score1,
        ms.score_team2 as actual_score2,
        cp.yellow_cards as predicted_yellow_cards,
        cp.red_cards as predicted_red_cards,
        m.yellow_cards as actual_yellow_cards,
        m.red_cards as actual_red_cards,
        CASE 
          WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
               (b.prediction = 'team2' AND m.winner = 'team2') OR
               (b.prediction = 'draw' AND m.winner = 'draw') OR
               (b.prediction = m.team1_name AND m.winner = 'team1') OR
               (b.prediction = m.team2_name AND m.winner = 'team2') 
          THEN 1 
          ELSE 0 
        END as result_correct,
        CASE 
          WHEN m.score_prediction_enabled = 1 AND
               sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
               ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
               sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
          THEN 1 
          ELSE 0 
        END as score_correct,
        CASE 
          WHEN m.yellow_cards_prediction_enabled = 1 AND
               cp.yellow_cards IS NOT NULL AND
               m.yellow_cards IS NOT NULL AND
               cp.yellow_cards = m.yellow_cards
          THEN 1 
          ELSE 0 
        END as yellow_cards_correct,
        CASE 
          WHEN m.red_cards_prediction_enabled = 1 AND
               cp.red_cards IS NOT NULL AND
               m.red_cards IS NOT NULL AND
               cp.red_cards = m.red_cards
          THEN 1 
          ELSE 0 
        END as red_cards_correct,
        CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END as base_points,
        CASE 
          WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
               (b.prediction = 'team2' AND m.winner = 'team2') OR
               (b.prediction = 'draw' AND m.winner = 'draw') OR
               (b.prediction = m.team1_name AND m.winner = 'team1') OR
               (b.prediction = m.team2_name AND m.winner = 'team2') 
          THEN 
            CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
            CASE 
              WHEN m.score_prediction_enabled = 1 AND
                   sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                   ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                   sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
              THEN 1 
              ELSE 0 
            END +
            CASE 
              WHEN m.yellow_cards_prediction_enabled = 1 AND
                   cp.yellow_cards IS NOT NULL AND
                   m.yellow_cards IS NOT NULL AND
                   cp.yellow_cards = m.yellow_cards
              THEN 1 
              ELSE 0 
            END +
            CASE 
              WHEN m.red_cards_prediction_enabled = 1 AND
                   cp.red_cards IS NOT NULL AND
                   m.red_cards IS NOT NULL AND
                   cp.red_cards = m.red_cards
              THEN 1 
              ELSE 0 
            END
          ELSE 0 
        END as total_points
      FROM bets b
      JOIN matches m ON b.match_id = m.id
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
      LEFT JOIN match_scores ms ON b.match_id = ms.match_id
      WHERE b.user_id = ? 
        AND b.is_final_bet = 0 
        AND m.winner IS NOT NULL
      ORDER BY b.id DESC
      LIMIT 20
    `).all(userId);
    
    const totalPoints = betsWithScore.reduce((sum, bet) => sum + bet.total_points, 0);
    
    res.json({
      user_id: userId,
      total_points: totalPoints,
      bets: betsWithScore
    });
  } catch (error) {
    console.error("Ошибка в тестовом endpoint:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// АВТОМАТИЧЕСКИЙ ПОДСЧЕТ РЕЗУЛЬТАТОВ
// ============================================

// Маппинг иконок турниров на коды для API
const ICON_TO_COMPETITION = {
  'img/cups/champions-league.png': 'CL',
  'img/cups/european-league.png': 'EL',
  'img/cups/england-premier-league.png': 'PL',
  'img/cups/bundesliga.png': 'BL1',
  'img/cups/spain-la-liga.png': 'PD',
  'img/cups/serie-a.png': 'SA',
  'img/cups/france-league-ligue-1.png': 'FL1',
  'img/cups/rpl.png': 'RPL',
  'img/cups/world-cup.png': 'WC',
  'img/cups/uefa-euro.png': 'EC',
  '🇳🇱': 'DED'  // Eredivisie
};

// Хранилище обработанных дат (чтобы не обрабатывать повторно)
const processedDates = new Set();

// Создаем таблицу для хранения обработанных дат автоподсчета
db.exec(`
  CREATE TABLE IF NOT EXISTS auto_counting_processed (
    date_key TEXT PRIMARY KEY,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Загружаем обработанные даты из БД при старте
const loadProcessedDates = () => {
  try {
    const dates = db.prepare('SELECT date_key FROM auto_counting_processed').all();
    dates.forEach(row => processedDates.add(row.date_key));
    console.log(`📋 Загружено ${dates.length} обработанных дат из БД`);
  } catch (error) {
    console.error('❌ Ошибка загрузки обработанных дат:', error);
  }
};

// Сохранить обработанную дату в БД
const saveProcessedDate = (dateKey) => {
  try {
    db.prepare('INSERT OR IGNORE INTO auto_counting_processed (date_key) VALUES (?)').run(dateKey);
  } catch (error) {
    console.error('❌ Ошибка сохранения обработанной даты:', error);
  }
};

// Загружаем при старте
loadProcessedDates();

// Функции для работы с настройкой автоподсчета в БД
function getAutoCountingEnabled() {
  const setting = db.prepare("SELECT value FROM system_settings WHERE key = 'auto_counting_enabled'").get();
  return setting ? setting.value === 'true' : true;
}

function setAutoCountingEnabled(enabled) {
  db.prepare("UPDATE system_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'auto_counting_enabled'")
    .run(enabled ? 'true' : 'false');
}

/**
 * Нормализация названия команды для сопоставления
 */
function normalizeTeamNameForAPI(name) {
  if (!name) return '';
  
  // Удаляем диакритику
  const withoutDiacritics = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  
  return withoutDiacritics
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9\u0400-\u04FF\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Перевести русское название команды в английское для сопоставления с API
 */
function translateTeamNameToEnglish(russianName, competitionCode) {
  if (!russianName) return russianName;
  
  // Загружаем словарь для турнира
  const dictionaryFiles = {
    'CL': 'names/LeagueOfChampionsTeams.json',
    'PL': 'names/PremierLeague.json',
    'LL': 'names/LaLiga.json',
    'SA': 'names/SerieA.json',
    'BL': 'names/Bundesliga.json',
    'L1': 'names/Ligue1.json',
    'ED': 'names/Eredivisie.json',
    'RPL': 'names/RussianPremierLeague.json'
  };
  
  const dictionaryFile = dictionaryFiles[competitionCode];
  if (!dictionaryFile) {
    return russianName; // Нет словаря для этого турнира
  }
  
  try {
    const dictionary = JSON.parse(fs.readFileSync(dictionaryFile, 'utf8'));
    const teams = dictionary.teams || {};
    
    // Ищем перевод
    const englishName = teams[russianName];
    if (englishName) {
      return englishName;
    }
    
    // Если не найден точный перевод, возвращаем оригинал
    return russianName;
  } catch (error) {
    console.error(`⚠️ Ошибка загрузки словаря ${dictionaryFile}:`, error.message);
    return russianName;
  }
}

/**
 * Получить активные даты с незавершенными матчами или недавно завершенными
 */
function getActiveDates() {
  try {
    const dates = db.prepare(`
      SELECT DISTINCT 
        m.event_id,
        e.icon,
        m.round,
        DATE(m.match_date) as date
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.match_date IS NOT NULL
        AND DATE(m.match_date) >= DATE('now', '-2 days')
        AND DATE(m.match_date) <= DATE('now', '+1 days')
      GROUP BY m.event_id, e.icon, m.round, DATE(m.match_date)
      ORDER BY m.match_date
    `).all();
    
    // Определяем competition_code по иконке
    return dates.map(date => ({
      ...date,
      competition_code: ICON_TO_COMPETITION[date.icon] || null
    }));
  } catch (error) {
    console.error('❌ Ошибка получения активных дат:', error);
    return [];
  }
}

/**
 * Проверить завершение всех матчей для конкретной даты
 */
async function checkDateCompletion(dateGroup) {
  try {
    const { event_id, competition_code, round, date } = dateGroup;
    
    // Если не удалось определить турнир по иконке - пропускаем
    if (!competition_code) {
      console.log(`⚠️ Не удалось определить турнир для event_id=${event_id} (иконка не в маппинге)`);
      return { allFinished: false, matches: [] };
    }
    
    // Получаем ВСЕ матчи из БД для этой даты (включая завершенные)
    const allDbMatches = db.prepare(`
      SELECT * FROM matches
      WHERE event_id = ?
        AND round = ?
        AND DATE(match_date) = ?
    `).all(event_id, round, date);
    
    if (allDbMatches.length === 0) {
      console.log(`⚠️ Нет матчей для даты ${date}`);
      return { allFinished: false, matches: [] };
    }
    
    // Проверяем сколько матчей уже завершено
    const finishedCount = allDbMatches.filter(m => m.status === 'finished').length;
    console.log(`📊 Матчей для ${date}: ${allDbMatches.length}, завершено: ${finishedCount}`);
    
    // Если все уже завершены в БД - возвращаем их для подсчета
    if (finishedCount === allDbMatches.length) {
      console.log(`✅ Все матчи уже завершены в БД для ${date}`);
      return { 
        allFinished: true, 
        matches: allDbMatches.map(dbMatch => ({ dbMatch, apiMatch: null }))
      };
    }
    
    // Есть незавершенные - проверяем через API
    const dbMatches = allDbMatches.filter(m => m.status !== 'finished');
    
    // Запрашиваем матчи из API
    const leagueId = SSTATS_LEAGUE_MAPPING[competition_code];
    if (!leagueId) {
      console.log(`⚠️ Неизвестный турнир: ${competition_code}`);
      return { allFinished: false, matches: [] };
    }
    
    const dateObj = new Date(date);
    let year = dateObj.getFullYear();
    
    // Для лиг: если дата в первой половине года, это прошлый сезон
    const cupTournaments = ['WC', 'EC'];
    if (!cupTournaments.includes(competition_code) && dateObj.getMonth() < 7) {
      year = year - 1;
    }
    
    const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&Year=${year}`;
    
    console.log(`🔍 Запрос к API: ${url}`);
    console.log(`📅 Ищем матчи для даты: ${date}`);
    
    const response = await fetch(url, {
      headers: { "X-API-Key": SSTATS_API_KEY }
    });
    
    if (!response.ok) {
      console.error(`❌ SStats API ошибка: ${response.status}`);
      return { allFinished: false, matches: [] };
    }
    
    const sstatsData = await response.json();
    
    if (sstatsData.status !== "OK") {
      console.error(`❌ SStats API статус не OK`);
      return { allFinished: false, matches: [] };
    }
    
    console.log(`📊 API вернул ${sstatsData.data?.length || 0} матчей всего`);
    
    // Фильтруем матчи по дате
    const apiMatches = (sstatsData.data || []).filter(game => {
      const gameDate = game.date.split('T')[0];
      return gameDate === date;
    });
    
    console.log(`📊 Матчей для даты ${date}: ${apiMatches.length}`);
    
    if (apiMatches.length > 0) {
      console.log(`📋 Статусы матчей из API:`);
      apiMatches.forEach(game => {
        console.log(`  - ${game.homeTeam.name} vs ${game.awayTeam.name}: status=${game.status} (${game.statusName})`);
      });
    }
    
    // Сопоставляем матчи БД с API
    const matchedMatches = [];
    
    console.log(`🔄 Сопоставление ${dbMatches.length} матчей из БД с API...`);
    
    for (const dbMatch of dbMatches) {
      // Переводим русские названия в английские
      const dbTeam1English = translateTeamNameToEnglish(dbMatch.team1_name, competition_code);
      const dbTeam2English = translateTeamNameToEnglish(dbMatch.team2_name, competition_code);
      
      const apiMatch = apiMatches.find(api => {
        const apiHome = normalizeTeamNameForAPI(api.homeTeam.name);
        const apiAway = normalizeTeamNameForAPI(api.awayTeam.name);
        const dbHome = normalizeTeamNameForAPI(dbTeam1English);
        const dbAway = normalizeTeamNameForAPI(dbTeam2English);
        
        return (apiHome === dbHome && apiAway === dbAway) ||
               (apiHome === dbAway && apiAway === dbHome);
      });
      
      if (apiMatch) {
        matchedMatches.push({ dbMatch, apiMatch });
        console.log(`  ✅ Сопоставлен: ${dbMatch.team1_name} - ${dbMatch.team2_name} (API status: ${apiMatch.status})`);
      } else {
        console.log(`  ❌ НЕ найден в API: ${dbMatch.team1_name} (${dbTeam1English}) - ${dbMatch.team2_name} (${dbTeam2English})`);
      }
    }
    
    console.log(`📊 Сопоставлено матчей: ${matchedMatches.length} из ${dbMatches.length}`);
    
    // Проверяем что все матчи завершены (status: 8)
    const allFinished = matchedMatches.length > 0 && 
                       matchedMatches.every(({ apiMatch }) => apiMatch.status === 8);
    
    console.log(`✅ Все матчи завершены: ${allFinished}`);
    
    if (!allFinished && matchedMatches.length > 0) {
      const notFinished = matchedMatches.filter(({ apiMatch }) => apiMatch.status !== 8);
      console.log(`⏸️ Незавершенные матчи (${notFinished.length}):`);
      notFinished.forEach(({ dbMatch, apiMatch }) => {
        console.log(`  - ${dbMatch.team1_name} - ${dbMatch.team2_name}: status=${apiMatch.status} (${apiMatch.statusName})`);
      });
    }
    
    return { allFinished, matches: matchedMatches };
    
  } catch (error) {
    console.error('❌ Ошибка проверки завершения даты:', error);
    return { allFinished: false, matches: [] };
  }
}

/**
 * Обновить матчи в БД из API
 */
function updateMatchesFromAPI(matches) {
  try {
    const updateStmt = db.prepare(`
      UPDATE matches
      SET status = 'finished',
          winner = ?,
          team1_score = ?,
          team2_score = ?
      WHERE id = ?
    `);
    
    for (const { dbMatch, apiMatch } of matches) {
      const homeScore = apiMatch.homeResult;
      const awayScore = apiMatch.awayResult;
      
      // Получаем код турнира для перевода названий
      const event = db.prepare("SELECT icon FROM events WHERE id = ?").get(dbMatch.event_id);
      const competition_code = event ? ICON_TO_COMPETITION[event.icon] : null;
      
      // Определяем победителя с учетом возможного обратного порядка команд
      const apiHome = normalizeTeamNameForAPI(apiMatch.homeTeam.name);
      // ИСПРАВЛЕНИЕ: переводим русское название в английское перед сравнением
      const dbTeam1English = translateTeamNameToEnglish(dbMatch.team1_name, competition_code);
      const dbHome = normalizeTeamNameForAPI(dbTeam1English);
      const isReversed = apiHome !== dbHome;
      
      let winner;
      if (homeScore > awayScore) {
        winner = isReversed ? 'team2' : 'team1';
      } else if (homeScore < awayScore) {
        winner = isReversed ? 'team1' : 'team2';
      } else {
        winner = 'draw';
      }
      
      const score1 = isReversed ? awayScore : homeScore;
      const score2 = isReversed ? homeScore : awayScore;
      
      updateStmt.run(winner, score1, score2, dbMatch.id);
      
      console.log(`✅ Обновлен матч: ${dbMatch.team1_name} ${score1}-${score2} ${dbMatch.team2_name} (${winner})`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Ошибка обновления матчей:', error);
    return false;
  }
}

/**
 * Запустить автоподсчет для конкретной даты
 */
async function triggerAutoCountingForDate(dateGroup) {
  try {
    const { date, round, competition_code } = dateGroup;
    const dateKey = `${date}_${round}_${competition_code}`;
    
    // Проверяем что не обрабатывали эту дату ранее
    if (processedDates.has(dateKey)) {
      return;
    }
    
    console.log(`\n🤖 ========================================`);
    console.log(`🤖 АВТОПОДСЧЕТ для ${date} | ${round}`);
    console.log(`🤖 ========================================\n`);
    
    // Проверяем завершение
    const { allFinished, matches } = await checkDateCompletion(dateGroup);
    
    if (!allFinished) {
      console.log(`⏸️ Не все матчи завершены для ${date}`);
      return;
    }
    
    console.log(`✅ Все матчи завершены для ${date}!`);
    
    // Обновляем матчи в БД (только если есть данные из API)
    const matchesWithApi = matches.filter(m => m.apiMatch !== null);
    if (matchesWithApi.length > 0) {
      const updated = updateMatchesFromAPI(matchesWithApi);
      
      if (!updated) {
        console.error(`❌ Не удалось обновить матчи для ${date}`);
        return;
      }
    } else {
      console.log(`ℹ️ Все матчи уже обновлены в БД`);
    }
    
    // Помечаем дату как обработанную
    processedDates.add(dateKey);
    saveProcessedDate(dateKey);
    console.log(`✅ Дата ${dateKey} помечена как обработанная`);
    
    // Получаем ставки за эту дату
    const bets = db.prepare(`
      SELECT 
        b.*,
        u.username,
        m.team1_name,
        m.team2_name,
        m.winner,
        m.team1_score as actual_score_team1,
        m.team2_score as actual_score_team2,
        m.yellow_cards as actual_yellow_cards,
        m.red_cards as actual_red_cards,
        m.score_prediction_enabled,
        m.yellow_cards_prediction_enabled,
        m.red_cards_prediction_enabled,
        cp.yellow_cards as predicted_yellow_cards,
        cp.red_cards as predicted_red_cards
      FROM bets b
      JOIN users u ON b.user_id = u.id
      JOIN matches m ON b.match_id = m.id
      LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
      WHERE DATE(m.match_date) = ?
        AND m.status = 'finished'
        AND b.is_final_bet = 0
    `).all(date);
    
    if (bets.length === 0) {
      console.log(`⚠️ Нет ставок для ${date}`);
      return;
    }
    
    // Подсчитываем результаты
    const userStats = {};
    
    bets.forEach(bet => {
      const username = bet.username;
      if (!userStats[username]) {
        userStats[username] = {
          points: 0,
          correctResults: 0,
          correctScores: 0,
          correctYellowCards: 0,
          correctRedCards: 0
        };
      }
      
      // Проверяем результат
      let isWon = false;
      if (bet.prediction === 'draw' && bet.winner === 'draw') {
        isWon = true;
      } else if (bet.prediction === 'team1' && bet.winner === 'team1') {
        isWon = true;
      } else if (bet.prediction === 'team2' && bet.winner === 'team2') {
        isWon = true;
      } else if (bet.prediction === bet.team1_name && bet.winner === 'team1') {
        isWon = true;
      } else if (bet.prediction === bet.team2_name && bet.winner === 'team2') {
        isWon = true;
      }
      
      if (isWon) {
        userStats[username].points++;
        userStats[username].correctResults++;
        
        // Проверяем счет (только если включен прогноз на счет для этого матча)
        if (bet.score_prediction_enabled === 1 &&
            bet.score_team1 != null && bet.score_team2 != null &&
            bet.score_team1 === bet.actual_score_team1 &&
            bet.score_team2 === bet.actual_score_team2) {
          userStats[username].points++;
          userStats[username].correctScores++;
        }
        
        // Проверяем желтые карточки (только если включен прогноз на желтые карточки для этого матча)
        if (bet.yellow_cards_prediction_enabled === 1 &&
            bet.predicted_yellow_cards != null &&
            bet.actual_yellow_cards != null &&
            bet.predicted_yellow_cards === bet.actual_yellow_cards) {
          userStats[username].points++;
          userStats[username].correctYellowCards++;
        }
        
        // Проверяем красные карточки (только если включен прогноз на красные карточки для этого матча)
        if (bet.red_cards_prediction_enabled === 1 &&
            bet.predicted_red_cards != null &&
            bet.actual_red_cards != null &&
            bet.predicted_red_cards === bet.actual_red_cards) {
          userStats[username].points++;
          userStats[username].correctRedCards++;
        }
      }
    });
    
    // Формируем сообщение для админа
    const formatDate = (dateStr) => {
      const d = new Date(dateStr);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}.${month}.${year}`;
    };
    
    let message = `🤖 <b>Автоподсчет завершен</b>\n\n`;
    message += `📅 Дата: ${formatDate(date)}\n`;
    message += `🏆 Тур: ${round}\n\n`;
    message += `📈 Статистика:\n`;
    
    Object.entries(userStats)
      .sort(([, a], [, b]) => b.points - a.points)
      .forEach(([username, stats]) => {
        const statsText = [];
        if (stats.correctResults > 0) {
          statsText.push(`✅ ${stats.correctResults}`);
        }
        if (stats.correctScores > 0) {
          statsText.push(`🎯 ${stats.correctScores}`);
        }
        if (stats.correctYellowCards > 0) {
          statsText.push(`🟨 ${stats.correctYellowCards}`);
        }
        if (stats.correctRedCards > 0) {
          statsText.push(`🟥 ${stats.correctRedCards}`);
        }
        const statsStr = statsText.length > 0 ? ` (${statsText.join(', ')})` : '';
        message += `• ${username}: ${stats.points} ${stats.points === 1 ? 'очко' : stats.points < 5 ? 'очка' : 'очков'}${statsStr}\n`;
      });
    
    // Отправляем админу
    await sendAdminNotification(message);
    console.log(`✅ Уведомление отправлено админу`);
    
    // Через 5 секунд отправляем результаты в группу и пользователям
    setTimeout(async () => {
      try {
        console.log(`📤 Отправка результатов в группу и пользователям...`);
        
        // Вызываем эндпоинт отправки результатов
        const response = await fetch(`http://localhost:${PORT}/api/admin/send-counting-results`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dateFrom: date,
            dateTo: date
          })
        });
        
        if (response.ok) {
          console.log(`✅ Результаты отправлены в группу и пользователям`);
        } else {
          console.error(`❌ Ошибка отправки результатов: ${response.status}`);
        }
      } catch (error) {
        console.error(`❌ Ошибка отправки результатов:`, error);
      }
    }, 5000);
    
  } catch (error) {
    console.error('❌ Ошибка автоподсчета:', error);
  }
}

/**
 * Основная функция проверки и автоподсчета
 */
async function checkAndAutoCount() {
  try {
    const autoCountingEnabled = getAutoCountingEnabled();
    
    if (!autoCountingEnabled) {
      console.log(`⏸️ Автоподсчет отключен`);
      return;
    }
    
    console.log(`\n🔍 Проверка завершенных матчей... ${new Date().toLocaleString('ru-RU')}`);
    
    const activeDates = getActiveDates();
    
    if (activeDates.length === 0) {
      console.log(`✓ Нет активных дат для проверки`);
      return;
    }
    
    console.log(`📊 Найдено активных дат: ${activeDates.length}`);
    
    for (const dateGroup of activeDates) {
      await triggerAutoCountingForDate(dateGroup);
    }
    
  } catch (error) {
    console.error('❌ Ошибка в checkAndAutoCount:', error);
  }
}

// Эндпоинт для управления автоподсчетом
app.get("/api/admin/auto-counting-status", (req, res) => {
  const enabled = getAutoCountingEnabled();
  res.json({ enabled });
});

app.post("/api/admin/toggle-auto-counting", (req, res) => {
  const { username } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  
  if (username !== ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }
  
  const currentStatus = getAutoCountingEnabled();
  const newStatus = !currentStatus;
  setAutoCountingEnabled(newStatus);
  
  console.log(`🤖 Автоподсчет ${newStatus ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН'}`);
  
  res.json({ 
    enabled: newStatus,
    message: `Автоподсчет ${newStatus ? 'включен' : 'выключен'}`
  });
});

// Эндпоинт для очистки обработанных дат (для повторного подсчета)
app.post("/api/admin/clear-processed-dates", (req, res) => {
  const { username } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  
  if (username !== ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }
  
  try {
    // Очищаем из памяти
    processedDates.clear();
    
    // Очищаем из БД
    db.prepare('DELETE FROM auto_counting_processed').run();
    
    console.log(`🧹 Очищены все обработанные даты автоподсчета`);
    
    res.json({ 
      success: true,
      message: 'Обработанные даты очищены. Автоподсчет запустится заново при следующей проверке.'
    });
  } catch (error) {
    console.error('❌ Ошибка очистки обработанных дат:', error);
    res.status(500).json({ error: error.message });
  }
});

// Эндпоинт для запуска утилитных скриптов
app.post("/api/admin/run-utility", (req, res) => {
  const { username, script, args = [] } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  
  if (username !== ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }
  
  const scriptMap = {
    'check-processed-dates': { file: 'check-processed-dates.cjs', title: 'Обработанные даты' },
    'clear-processed-dates': { file: 'clear-processed-dates.cjs', title: 'Очистка дат' },
    'check-match-dates': { file: 'check-match-dates.cjs', title: 'Даты матчей' },
    'check-event-id': { file: 'check-event-id.cjs', title: 'ID турниров' },
    'check-tables': { file: 'check-tables.js', title: 'Структура БД' },
    'check-user-settings': { file: 'check-user-settings.cjs', title: 'Настройки пользователей' },
    'deactivate-old-events': { file: 'deactivate-old-events.cjs', title: 'Деактивация турниров' },
    'enable-notifications': { file: 'enable-notifications.cjs', title: 'Включение уведомлений' },
    'enable-notifications-for-all': { file: 'enable-notifications-for-all.cjs', title: 'Уведомления для всех' },
    'update-sstats-ids': { file: 'update-sstats-ids.cjs', title: 'Обновление SStats ID' }
  };
  
  const scriptInfo = scriptMap[script];
  if (!scriptInfo) {
    return res.status(400).json({ error: 'Неизвестный скрипт' });
  }
  
  try {
    const command = `node ${scriptInfo.file} ${args.join(' ')}`;
    console.log(`🔧 Запуск утилиты: ${command}`);
    
    const result = execSync(command, { 
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 10 // 10MB
    });
    
    res.json({ 
      success: true,
      title: scriptInfo.title,
      output: result
    });
  } catch (error) {
    console.error(`❌ Ошибка запуска ${scriptInfo.file}:`, error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      output: error.stdout || error.stderr || ''
    });
  }
});

// Эндпоинт для деактивации выбранных турниров
app.post("/api/admin/deactivate-events", (req, res) => {
  const { username, eventIds } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  
  if (username !== ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }
  
  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    return res.status(400).json({ error: "Не выбраны турниры" });
  }
  
  try {
    const placeholders = eventIds.map(() => '?').join(',');
    
    // Получаем названия турниров перед деактивацией
    const events = db.prepare(`SELECT id, name FROM events WHERE id IN (${placeholders})`).all(...eventIds);
    
    // Деактивируем турниры
    const result = db.prepare(`UPDATE events SET status = 'completed' WHERE id IN (${placeholders})`).run(...eventIds);
    
    console.log(`🔒 Деактивировано турниров: ${result.changes}`);
    events.forEach(e => console.log(`  - ${e.name} (ID: ${e.id})`));
    
    res.json({ 
      success: true,
      deactivated: result.changes,
      events: events
    });
  } catch (error) {
    console.error('❌ Ошибка деактивации турниров:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== API ДЛЯ НОВОСТЕЙ =====

// GET /api/news - Получить последние новости
app.get("/api/news", (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const type = req.query.type; // Фильтр по типу (опционально)
    const username = req.query.username; // Для получения реакций пользователя
    
    let query = `
      SELECT 
        n.*,
        (SELECT COUNT(*) FROM news_reactions WHERE news_id = n.id AND reaction = 'like') as likes,
        (SELECT COUNT(*) FROM news_reactions WHERE news_id = n.id AND reaction = 'dislike') as dislikes
    `;
    
    // Если передан username, добавляем реакцию пользователя
    if (username) {
      query += `,
        (SELECT reaction FROM news_reactions WHERE news_id = n.id AND username = ?) as user_reaction
      `;
    }
    
    query += " FROM news n";
    
    let params = [];
    
    // Добавляем username в параметры если он есть
    if (username) {
      params.push(username);
    }
    
    if (type && type !== 'all') {
      query += " WHERE n.type = ?";
      params.push(type);
    }
    
    query += " ORDER BY n.created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    
    const news = db.prepare(query).all(...params);
    
    res.json({ success: true, news });
  } catch (error) {
    console.error("❌ Ошибка получения новостей:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/news/:id/reaction - Добавить/изменить реакцию на новость
app.post("/api/news/:id/reaction", async (req, res) => {
  try {
    const newsId = parseInt(req.params.id);
    const { username, reaction } = req.body;
    
    // Проверка обязательных полей
    if (!username || !reaction) {
      return res.status(400).json({ error: "Не указаны обязательные поля" });
    }
    
    // Проверка типа реакции
    if (!['like', 'dislike'].includes(reaction)) {
      return res.status(400).json({ error: "Неверный тип реакции" });
    }
    
    // Проверяем существует ли новость
    const news = db.prepare("SELECT * FROM news WHERE id = ?").get(newsId);
    if (!news) {
      return res.status(404).json({ error: "Новость не найдена" });
    }
    
    // Проверяем существует ли уже реакция пользователя
    const existingReaction = db.prepare(`
      SELECT * FROM news_reactions WHERE news_id = ? AND username = ?
    `).get(newsId, username);
    
    if (existingReaction) {
      if (existingReaction.reaction === reaction) {
        // Если пользователь нажал на ту же кнопку - удаляем реакцию
        db.prepare(`
          DELETE FROM news_reactions WHERE news_id = ? AND username = ?
        `).run(newsId, username);
      } else {
        // Если пользователь изменил реакцию - обновляем
        db.prepare(`
          UPDATE news_reactions SET reaction = ? WHERE news_id = ? AND username = ?
        `).run(reaction, newsId, username);
      }
    } else {
      // Добавляем новую реакцию
      db.prepare(`
        INSERT INTO news_reactions (news_id, username, reaction)
        VALUES (?, ?, ?)
      `).run(newsId, username, reaction);
    }
    
    // Получаем обновленные счетчики
    const likes = db.prepare(`
      SELECT COUNT(*) as count FROM news_reactions WHERE news_id = ? AND reaction = 'like'
    `).get(newsId).count;
    
    const dislikes = db.prepare(`
      SELECT COUNT(*) as count FROM news_reactions WHERE news_id = ? AND reaction = 'dislike'
    `).get(newsId).count;
    
    // Получаем текущую реакцию пользователя
    const userReaction = db.prepare(`
      SELECT reaction FROM news_reactions WHERE news_id = ? AND username = ?
    `).get(newsId, username);
    
    // Отправляем уведомление админу
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username, telegram_username FROM users WHERE username = ?").get(username);
    
    const reactionEmoji = reaction === 'like' ? '👍' : '👎';
    const reactionText = reaction === 'like' ? 'Лайк' : 'Дизлайк';
    
    const time = new Date().toLocaleString("ru-RU", {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const adminMessage = 
      `📢 <b>ОЦЕНКА НОВОСТИ</b>\n\n` +
      `👤 Пользователь: ${user.username}\n` +
      (user.telegram_username ? `📱 Telegram: @${user.telegram_username}\n` : '') +
      `📰 Новость: ${news.title}\n` +
      `${reactionEmoji} Оценка: ${reactionText}\n\n` +
      `🕐 Время: ${time}`;
    
    try {
      await sendAdminNotification(adminMessage);
    } catch (error) {
      console.error("Ошибка отправки уведомления админу:", error);
    }
    
    res.json({ 
      success: true, 
      likes, 
      dislikes,
      user_reaction: userReaction ? userReaction.reaction : null
    });
  } catch (error) {
    console.error("❌ Ошибка добавления реакции:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/news/:id - Удалить новость (только для админа)
app.delete("/api/admin/news/:id", async (req, res) => {
  try {
    const newsId = parseInt(req.params.id);
    const { username } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    // Проверяем существует ли новость
    const news = db.prepare("SELECT * FROM news WHERE id = ?").get(newsId);
    if (!news) {
      return res.status(404).json({ error: "Новость не найдена" });
    }
    
    // Удаляем реакции на новость
    db.prepare("DELETE FROM news_reactions WHERE news_id = ?").run(newsId);
    
    // Удаляем новость
    db.prepare("DELETE FROM news WHERE id = ?").run(newsId);
    
    // Логируем действие
    writeBetLog("admin", {
      username: username,
      action: "Удалена новость",
      details: `ID: ${newsId}, Заголовок: ${news.title}`
    });
    
    // Отправляем уведомление админу
    const time = new Date().toLocaleString("ru-RU", {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const adminMessage = 
      `🗑️ <b>НОВОСТЬ УДАЛЕНА</b>\n\n` +
      `📰 Заголовок: ${news.title}\n` +
      `💬 Текст: ${news.message}\n\n` +
      `👤 Удалил: ${username}\n` +
      `🕐 Время: ${time}`;
    
    try {
      await sendAdminNotification(adminMessage);
    } catch (error) {
      console.error("Ошибка отправки уведомления админу:", error);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Ошибка удаления новости:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rss-news - Получить RSS новости с фильтрацией по турнирам
app.get("/api/rss-news", async (req, res) => {
  try {
    const tournament = req.query.tournament || 'all';
    
    // Проверяем кэш
    const now = Date.now();
    if (rssNewsCache.data && (now - rssNewsCache.timestamp) < rssNewsCache.ttl) {
      console.log("📰 Возвращаем RSS новости из кэша");
      const filteredNews = filterNewsByTournament(rssNewsCache.data, tournament);
      return res.json({ success: true, news: filteredNews, cached: true });
    }
    
    console.log("📰 Загружаем свежие RSS новости...");
    
    // Парсим RSS ленты
    const sources = [
      'http://www.sports.ru/rss/rubric.xml?s=208', // Sports.ru футбол
      'https://www.gazeta.ru/export/rss/sport.xml', // Gazeta.ru спорт
      'https://www.sport-express.ru/services/materials/news/football/se/' // Спорт-Экспресс футбол
    ];
    
    let allNews = [];
    
    for (const source of sources) {
      try {
        const feed = await rssParser.parseURL(source);
        
        // Определяем источник по URL
        let sourceName = 'Неизвестный источник';
        if (source.includes('sports.ru')) {
          sourceName = 'Sports.ru';
        } else if (source.includes('gazeta.ru')) {
          sourceName = 'Gazeta.ru';
        } else if (source.includes('sport-express.ru')) {
          sourceName = 'Спорт-Экспресс';
        }
        
        const newsItems = feed.items.map(item => ({
          title: item.title,
          link: item.link,
          description: item.contentSnippet || item.content || '',
          pubDate: item.pubDate,
          source: sourceName
        }));
        allNews = allNews.concat(newsItems);
      } catch (error) {
        console.error(`❌ Ошибка парсинга ${source}:`, error.message);
      }
    }
    
    // Сортируем по дате (новые первыми)
    allNews.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    
    // Ограничиваем до 100 новостей
    allNews = allNews.slice(0, 100);
    
    // Сохраняем в кэш
    rssNewsCache.data = allNews;
    rssNewsCache.timestamp = now;
    
    console.log(`✅ Загружено ${allNews.length} RSS новостей`);
    
    // Фильтруем по турниру
    const filteredNews = filterNewsByTournament(allNews, tournament);
    
    res.json({ success: true, news: filteredNews, cached: false });
  } catch (error) {
    console.error("❌ Ошибка получения RSS новостей:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Функция фильтрации новостей по турниру
function filterNewsByTournament(news, tournament) {
  if (tournament === 'all') {
    return news;
  }
  
  // Получаем ключевые слова из БД
  const includeKeywords = db.prepare(`
    SELECT keyword, priority FROM rss_keywords 
    WHERE tournament = ? AND type = 'include'
    ORDER BY priority DESC
  `).all(tournament);
  
  const excludeKeywords = db.prepare(`
    SELECT keyword FROM rss_keywords 
    WHERE (tournament = ? OR tournament = 'all') AND type = 'exclude'
  `).all(tournament);
  
  if (includeKeywords.length === 0) {
    return [];
  }
  
  // Фильтруем новости
  const filteredNews = news.filter(item => {
    const text = `${item.title} ${item.description}`.toLowerCase();
    
    // Проверяем исключения (если есть хоть одно - новость отбрасывается)
    const hasExclude = excludeKeywords.some(kw => 
      text.includes(kw.keyword.toLowerCase())
    );
    
    if (hasExclude) {
      return false;
    }
    
    // Проверяем включения
    const matchedKeyword = includeKeywords.find(kw => 
      text.includes(kw.keyword.toLowerCase())
    );
    
    if (matchedKeyword) {
      // Сохраняем приоритет для сортировки
      item._priority = matchedKeyword.priority;
      return true;
    }
    
    return false;
  });
  
  // Сортируем по приоритету (выше приоритет - выше в списке)
  filteredNews.sort((a, b) => (b._priority || 0) - (a._priority || 0));
  
  // Удаляем служебное поле
  filteredNews.forEach(item => delete item._priority);
  
  return filteredNews;
}

// GET /api/rss-keywords - Получить все ключевые слова
app.get("/api/rss-keywords", (req, res) => {
  try {
    const keywords = db.prepare(`
      SELECT * FROM rss_keywords 
      ORDER BY tournament, priority DESC, keyword
    `).all();
    
    res.json({ success: true, keywords });
  } catch (error) {
    console.error("❌ Ошибка получения ключевых слов:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rss-keywords/:tournament - Получить ключевые слова для турнира
app.get("/api/rss-keywords/:tournament", (req, res) => {
  try {
    const { tournament } = req.params;
    
    const keywords = db.prepare(`
      SELECT * FROM rss_keywords 
      WHERE tournament = ? OR tournament = 'all'
      ORDER BY type DESC, priority DESC, keyword
    `).all(tournament);
    
    res.json({ success: true, keywords });
  } catch (error) {
    console.error("❌ Ошибка получения ключевых слов:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/rss-keywords - Добавить ключевое слово (только для админа)
app.post("/api/admin/rss-keywords", (req, res) => {
  try {
    const { username, tournament, keyword, type, priority } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    if (!tournament || !keyword || !type) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    // Проверяем, не существует ли уже такое ключевое слово
    const existing = db.prepare(`
      SELECT id FROM rss_keywords 
      WHERE tournament = ? AND keyword = ? AND type = ?
    `).get(tournament, keyword, type);
    
    if (existing) {
      return res.status(400).json({ error: "Keyword already exists" });
    }
    
    const result = db.prepare(`
      INSERT INTO rss_keywords (tournament, keyword, type, priority)
      VALUES (?, ?, ?, ?)
    `).run(tournament, keyword, type, priority || 0);
    
    const newKeyword = db.prepare("SELECT * FROM rss_keywords WHERE id = ?").get(result.lastInsertRowid);
    
    // Очищаем кэш RSS новостей
    rssNewsCache.data = null;
    rssNewsCache.timestamp = 0;
    
    // Уведомление админу
    const typeEmojis = { 'include': '✅', 'exclude': '❌' };
    const adminMessage = 
      `${typeEmojis[type]} <b>ДОБАВЛЕНО КЛЮЧЕВОЕ СЛОВО</b>\n\n` +
      `🏆 Турнир: ${tournament}\n` +
      `🔑 Слово: "${keyword}"\n` +
      `📊 Тип: ${type}\n` +
      `⭐ Приоритет: ${priority || 0}\n\n` +
      `👤 Админ: ${username}`;
    
    notifyAdmin(adminMessage).catch(err => {
      console.error("⚠️ Не удалось отправить уведомление админу:", err);
    });
    
    res.json({ success: true, keyword: newKeyword });
  } catch (error) {
    console.error("❌ Ошибка добавления ключевого слова:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/rss-keywords/:id - Удалить ключевое слово (только для админа)
app.delete("/api/admin/rss-keywords/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    // Получаем информацию о ключевом слове перед удалением
    const keyword = db.prepare("SELECT * FROM rss_keywords WHERE id = ?").get(id);
    
    if (!keyword) {
      return res.status(404).json({ error: "Keyword not found" });
    }
    
    db.prepare("DELETE FROM rss_keywords WHERE id = ?").run(id);
    
    // Очищаем кэш RSS новостей
    rssNewsCache.data = null;
    rssNewsCache.timestamp = 0;
    
    // Уведомление админу
    const typeEmojis = { 'include': '✅', 'exclude': '❌' };
    const adminMessage = 
      `${typeEmojis[keyword.type]} <b>УДАЛЕНО КЛЮЧЕВОЕ СЛОВО</b>\n\n` +
      `🏆 Турнир: ${keyword.tournament}\n` +
      `🔑 Слово: "${keyword.keyword}"\n` +
      `📊 Тип: ${keyword.type}\n\n` +
      `👤 Админ: ${username}`;
    
    notifyAdmin(adminMessage).catch(err => {
      console.error("⚠️ Не удалось отправить уведомление админу:", err);
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Ошибка удаления ключевого слова:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/rss-keywords/:id - Обновить ключевое слово (только для админа)
app.put("/api/admin/rss-keywords/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { username, keyword, type, priority } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const existing = db.prepare("SELECT * FROM rss_keywords WHERE id = ?").get(id);
    
    if (!existing) {
      return res.status(404).json({ error: "Keyword not found" });
    }
    
    db.prepare(`
      UPDATE rss_keywords 
      SET keyword = ?, type = ?, priority = ?
      WHERE id = ?
    `).run(keyword, type, priority, id);
    
    const updated = db.prepare("SELECT * FROM rss_keywords WHERE id = ?").get(id);
    
    // Очищаем кэш RSS новостей
    rssNewsCache.data = null;
    rssNewsCache.timestamp = 0;
    
    res.json({ success: true, keyword: updated });
  } catch (error) {
    console.error("❌ Ошибка обновления ключевого слова:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notify-news-view - Уведомление админу о просмотре новостей
app.post("/api/notify-news-view", async (req, res) => {
  try {
    const { username, type } = req.body; // type: 'news' или 'rss'
    
    if (!username || !type) {
      return res.status(400).json({ error: "Missing username or type" });
    }
    
    const typeEmojis = {
      'news': '📢',
      'rss': '🌐'
    };
    
    const typeNames = {
      'news': 'Новости',
      'rss': 'Другие новости (RSS)'
    };
    
    const emoji = typeEmojis[type] || '📰';
    const typeName = typeNames[type] || type;
    
    const time = new Date().toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    
    const adminMessage = 
      `${emoji} <b>ПРОСМОТР: ${typeName}</b>\n\n` +
      `👤 Пользователь: <b>${username}</b>\n` +
      `🕐 Время: ${time}`;
    
    // Отправляем уведомление асинхронно
    notifyAdmin(adminMessage).catch(err => {
      console.error("⚠️ Не удалось отправить уведомление админу:", err);
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/news - Добавить новость (только для админа)
app.post("/api/admin/news", async (req, res) => {
  try {
    const { username, type, title, message } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    // Проверка обязательных полей
    if (!type || !title || !message) {
      return res.status(400).json({ error: "Не указаны обязательные поля" });
    }
    
    // Проверка типа новости
    const validTypes = ['tournament', 'system', 'achievement', 'announcement'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: "Неверный тип новости" });
    }
    
    // Добавляем новость
    const result = db.prepare(`
      INSERT INTO news (type, title, message)
      VALUES (?, ?, ?)
    `).run(type, title, message);
    
    const newsId = result.lastInsertRowid;
    
    // Получаем добавленную новость
    const news = db.prepare("SELECT * FROM news WHERE id = ?").get(newsId);
    
    // Логируем действие
    writeBetLog("admin", {
      username: username,
      action: "Добавлена новость",
      details: `Тип: ${type}, Заголовок: ${title}`
    });
    
    // Отправляем уведомление админу
    const typeEmojis = {
      'tournament': '🏆',
      'system': '⚙️',
      'achievement': '🏅',
      'announcement': '📣'
    };
    
    const time = new Date().toLocaleString("ru-RU", {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const adminMessage = 
      `📢 <b>НОВОСТЬ ОПУБЛИКОВАНА</b>\n\n` +
      `${typeEmojis[type]} Тип: ${type}\n` +
      `📝 Заголовок: ${title}\n` +
      `💬 Текст: ${message}\n\n` +
      `👤 Автор: ${username}\n` +
      `🕐 Время: ${time}`;
    
    try {
      await sendAdminNotification(adminMessage);
    } catch (error) {
      console.error("Ошибка отправки уведомления админу:", error);
    }
    
    res.json({ success: true, news });
  } catch (error) {
    console.error("❌ Ошибка добавления новости:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/panel-config - Получить конфигурацию админ-панели
app.get("/api/admin/panel-config", (req, res) => {
  try {
    const config = db.prepare(`
      SELECT config_data, updated_at, updated_by 
      FROM admin_panel_config 
      ORDER BY id DESC 
      LIMIT 1
    `).get();
    
    if (!config) {
      return res.status(404).json({ error: "Конфигурация не найдена" });
    }
    
    res.json({
      success: true,
      config: JSON.parse(config.config_data),
      updated_at: config.updated_at,
      updated_by: config.updated_by
    });
  } catch (error) {
    console.error("❌ Ошибка получения конфигурации админ-панели:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/panel-config - Сохранить конфигурацию админ-панели (только для админа)
app.post("/api/admin/panel-config", (req, res) => {
  try {
    const { username, config } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Доступ запрещён" });
    }
    
    if (!config || !config.categories) {
      return res.status(400).json({ error: "Неверный формат конфигурации" });
    }
    
    // Сохраняем конфигурацию
    db.prepare(`
      INSERT INTO admin_panel_config (config_data, updated_by, updated_at)
      VALUES (?, ?, datetime('now'))
    `).run(JSON.stringify(config), username);
    
    console.log(`✅ Конфигурация админ-панели обновлена пользователем ${username}`);
    
    // Уведомление админу
    const adminMessage = 
      `⚙️ <b>КОНФИГУРАЦИЯ АДМИН-ПАНЕЛИ ОБНОВЛЕНА</b>\n\n` +
      `👤 Пользователь: ${username}\n` +
      `📊 Категорий: ${config.categories.length}\n` +
      `🕐 ${new Date().toLocaleString("ru-RU")}`;
    
    notifyAdmin(adminMessage).catch(err => {
      console.error("⚠️ Не удалось отправить уведомление админу:", err);
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Ошибка сохранения конфигурации админ-панели:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/panel-config/reset - Сбросить конфигурацию к дефолтной (только для админа)
app.post("/api/admin/panel-config/reset", (req, res) => {
  try {
    const { username } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Доступ запрещён" });
    }
    
    // Дефолтная конфигурация
    const defaultConfig = {
      categories: [
        {
          id: 'system',
          name: '📊 Система и логи',
          icon: '📊',
          collapsed: true,
          buttons: [
            { id: 'migrate-logs', text: '🔄 Обновить логи', action: 'migrateLogs()', type: 'modal' },
            { id: 'clear-logs', text: '🗑️ Очистить логи', action: 'clearLogs()', type: 'modal' },
            { id: 'open-logs', text: '📋 Открыть логи', action: 'window.open("/log.html", "_blank")', type: 'external' },
            { id: 'database', text: '💾 База данных', action: 'openDatabaseModal()', type: 'modal' },
            { id: 'orphaned', text: '🔍 Проверить orphaned', action: 'checkOrphanedData()', type: 'modal' }
          ]
        },
        {
          id: 'users',
          name: '👥 Пользователи и модерация',
          icon: '👥',
          collapsed: false,
          buttons: [
            { id: 'users-list', text: '👥 Пользователи', action: 'loadAdminUsers()', type: 'modal' },
            { id: 'moderators', text: '🛡️ Модераторы', action: 'openModeratorsPanel()', type: 'modal' },
            { id: 'bugs', text: '🐛 Баги', action: 'openBugReportsModal()', type: 'modal' }
          ]
        },
        {
          id: 'content',
          name: '📢 Контент и новости',
          icon: '📢',
          collapsed: false,
          buttons: [
            { id: 'add-news', text: '📢 Добавить новость', action: 'openNewsModal()', type: 'modal' },
            { id: 'announcement', text: '📢 Объявление', action: 'openAnnouncementModal()', type: 'modal' },
            { id: 'rss-keywords', text: '🔑 Ключевые слова RSS', action: 'openRssKeywordsModal()', type: 'modal' },
            { id: 'awards', text: '🏆 Награды', action: 'openAwardsPanel()', type: 'modal' }
          ]
        },
        {
          id: 'interface',
          name: '⚙️ Настройки интерфейса',
          icon: '⚙️',
          collapsed: false,
          buttons: [
            { id: 'xg-button', text: '🎯 Кнопка xG', action: 'toggleXgButton()', type: 'toggle' },
            { id: 'group-reminders', text: '🔔 Напоминания группы', action: 'toggleGroupRemindersCardVisibility()', type: 'toggle' }
          ]
        },
        {
          id: 'notifications',
          name: '🔔 Уведомления',
          icon: '🔔',
          collapsed: false,
          buttons: [
            { id: 'notifications-queue', text: '📬 Очередь уведомлений', action: 'window.open("/admin/notifications", "_blank")', type: 'external' },
            { id: 'manage-notifications', text: '🔔 Управление уведомлениями', action: 'openNotificationsModal()', type: 'modal' }
          ]
        },
        {
          id: 'utilities',
          name: '🛠️ Утилиты и инструменты',
          icon: '🛠️',
          collapsed: true,
          buttons: [
            { id: 'manage-dates', text: '📅 Управление датами', action: 'openDatesManagementModal()', type: 'modal' },
            { id: 'event-ids', text: '🏆 ID турниров', action: 'runUtilityScript("check-event-id")', type: 'modal' },
            { id: 'db-structure', text: '🗄️ Структура БД', action: 'runUtilityScript("check-tables")', type: 'modal' },
            { id: 'deactivate-old', text: '🔒 Деактивировать старые', action: 'openDeactivateEventsModal()', type: 'modal' },
            { id: 'update-sstats', text: '🔄 Обновить SStats ID', action: 'openUpdateSstatsModal()', type: 'modal' },
            { id: 'tests', text: '🧪 Тесты', action: 'openTestsModal()', type: 'modal' }
          ]
        }
      ]
    };
    
    // Сохраняем дефолтную конфигурацию
    db.prepare(`
      INSERT INTO admin_panel_config (config_data, updated_by, updated_at)
      VALUES (?, ?, datetime('now'))
    `).run(JSON.stringify(defaultConfig), username);
    
    console.log(`✅ Конфигурация админ-панели сброшена к дефолту пользователем ${username}`);
    
    // Уведомление админу
    const adminMessage = 
      `🔄 <b>КОНФИГУРАЦИЯ АДМИН-ПАНЕЛИ СБРОШЕНА</b>\n\n` +
      `👤 Пользователь: ${username}\n` +
      `📊 Восстановлена дефолтная конфигурация\n` +
      `🕐 ${new Date().toLocaleString("ru-RU")}`;
    
    notifyAdmin(adminMessage).catch(err => {
      console.error("⚠️ Не удалось отправить уведомление админу:", err);
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Ошибка сброса конфигурации админ-панели:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Запускаем проверку каждые 5 минут
const AUTO_COUNT_INTERVAL = 5 * 60 * 1000; // 5 минут
setInterval(checkAndAutoCount, AUTO_COUNT_INTERVAL);

console.log(`\n🤖 Автоподсчет активирован (проверка каждые 5 минут)\n`);

// Запуск сервера
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `\n🎯 1xBetLineBoom сервер запущен на http://0.0.0.0:${PORT} (доступен на http://144.124.237.222:${PORT})\n`
  );
  
  // Запускаем первую проверку через 30 секунд после старта
  setTimeout(() => {
    console.log(`\n🤖 Запуск первой проверки автоподсчета...\n`);
    checkAndAutoCount();
  }, 30000);
});
