import express from "express";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { execSync, spawnSync } from "child_process";
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

const app = express();
const PORT = process.env.PORT || 1984;
const SERVER_IP = process.env.SERVER_IP || "localhost";
const SSTATS_API_KEY = process.env.SSTATS_API_KEY;
const SSTATS_API_BASE = "https://api.sstats.net";

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
        }),
      }
    );
    console.log(`✅ Уведомление отправлено админу`);
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления админу:", error);
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
      SELECT m.id, m.team1_name, m.team2_name, m.match_date, e.name as event_name
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.winner IS NULL AND m.match_date IS NOT NULL
      ORDER BY m.match_date ASC
      LIMIT 20
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
    }

    // Для каждого матча проверяем непроголосовавших пользователей
    for (const match of upcomingMatches) {
      console.log(
        `⏰ Проверяем матч: ${match.team1_name} vs ${match.team2_name} (${match.match_date})`
      );

      // Проверяем, было ли уже отправлено напоминание для этого матча
      const existingReminder = db
        .prepare("SELECT id FROM sent_reminders WHERE match_id = ?")
        .get(match.id);

      if (existingReminder) {
        // Напоминание уже было отправлено, пропускаем
        console.log(`⏰ Напоминание уже было отправлено для матча ${match.id}`);
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
      }

      // Получаем пользователей, которые уже сделали ставку на этот матч
      const usersWithBets = db
        .prepare(
          `
        SELECT DISTINCT user_id FROM bets WHERE match_id = ?
      `
        )
        .all(match.id)
        .map((row) => row.user_id);

      console.log(
        `⏰ Пользователей с ставками на этот матч: ${usersWithBets.length}`
      );

      // Находим пользователей, которые НЕ сделали ставку
      const nonVoters = allUsers.filter(
        (user) => !usersWithBets.includes(user.id)
      );

      if (nonVoters.length > 0) {
        console.log(
          `⏰ Найдено ${nonVoters.length} непроголосовавших пользователей для матча ${match.id}`
        );

        // Форматируем дату и время матча
        const matchDateTime = new Date(match.match_date);
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

        // Составляем сообщение
        const message = `⏰ <b>Напоминание о голосовании!</b>

Матч начнётся <b>${matchDate} в ${matchTime}</b>

⚽ <b>${match.team1_name}</b> vs <b>${match.team2_name}</b>
🏆 Турнир: ${match.event_name}

👥 <b>Не проголосовали:</b>
${mentions}

💬 Не забудьте сделать прогноз!

🔗 <a href="http://${SERVER_IP}:${PORT}">Открыть сайт</a>`;

        console.log(`⏰ Отправляем напоминание в группу для матча ${match.id}`);
        console.log(`📝 Сообщение: ${message.substring(0, 100)}...`);

        try {
          await sendGroupNotification(message);
          console.log(`✅ sendGroupNotification выполнена успешно`);
        } catch (err) {
          console.error(
            `❌ ОШИБКА при отправке sendGroupNotification: ${err.message}`
          );
          console.error(`   ${err.stack}`);
        }

        // Записываем в БД, что напоминание было отправлено
        try {
          db.prepare("INSERT INTO sent_reminders (match_id) VALUES (?)").run(
            match.id
          );
          console.log(
            `📢 Запись в БД добавлена для матча: ${match.team1_name} vs ${match.team2_name}`
          );
        } catch (err) {
          console.error(`❌ ОШИБКА при добавлении в БД: ${err.message}`);
        }
      } else {
        console.log(
          `⏰ Нет непроголосовавших пользователей для матча ${match.id} (все сделали ставку)`
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
      SELECT DISTINCT m.id, m.team1_name, m.team2_name, m.match_date, e.name as event_name
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
      SELECT id, username, telegram_id, telegram_username
      FROM users
      WHERE telegram_notifications_enabled = 1 AND telegram_id IS NOT NULL
    `
      )
      .all();

    console.log(
      `🔔 Найдено ${usersWithNotifications.length} пользователей с включенными уведомлениями`
    );

    if (usersWithNotifications.length === 0) {
      return;
    }

    // Для каждого матча отправляем уведомления пользователям
    for (const match of upcomingMatches) {
      // Проверяем, было ли уже отправлено уведомление за 3 часа для этого матча
      const existingNotification = db
        .prepare("SELECT id FROM sent_3hour_reminders WHERE match_id = ?")
        .get(match.id);

      if (existingNotification) {
        console.log(`🔔 Уведомление за 3 часа для матча ${match.id} уже было отправлено`);
        continue;
      }

      // Форматируем дату и время матча
      const matchDateTime = new Date(match.match_date);
      const matchDate = matchDateTime.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const matchTime = matchDateTime.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      });

      // Отправляем уведомление каждому пользователю
      for (const user of usersWithNotifications) {
        const message = `⏰ <b>НАПОМИНАНИЕ О МАТЧЕ</b>

Матч начнется через 3 часа!

⚽ <b>${match.team1_name}</b> vs <b>${match.team2_name}</b>
📅 Турнир: ${match.event_name}
🕐 Время начала: ${matchDate} ${matchTime}

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

      // Записываем в БД, что уведомление за 3 часа было отправлено
      db.prepare("INSERT INTO sent_3hour_reminders (match_id) VALUES (?)").run(match.id);

      console.log(
        `✅ Уведомления за 3 часа для матча ${match.team1_name} vs ${match.team2_name} отправлены всем пользователям`
      );
    }
  } catch (error) {
    console.error("❌ Ошибка при проверке предстоящих матчей:", error);
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

// Отключаем FOREIGN KEY constraints для упрощения операций удаления
db.pragma("foreign_keys = OFF");

// Middleware
app.use(express.json({ limit: "50mb" })); // Увеличиваем лимит для аватаров
app.use(express.static(".")); // Раздаем статические файлы (HTML, CSS, JS)

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
         WHERE e.status = 'active' 
         GROUP BY e.id
         ORDER BY e.start_date ASC, e.created_at ASC`
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
      ORDER BY event_won DESC, event_bets DESC
    `
      )
      .all(eventId, eventId);

    res.json(participants);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Получить матчи по событию
app.get("/api/events/:eventId/matches", (req, res) => {
  try {
    const { eventId } = req.params;
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
app.post("/api/brackets/:bracketId/predictions", (req, res) => {
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
          sendUserMessage(telegramUser.chat_id, message).catch(err => {
            console.error(`Ошибка отправки уведомления пользователю ${user_id}:`, err);
          });
        }
      }
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
          
          sendUserMessage(telegramUser.chat_id, message).catch(err => {
            console.error(`Ошибка отправки уведомления пользователю ${userId}:`, err);
          });
        }
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
    const { event_id, name, start_date, start_stage, username } = req.body;
    
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
      INSERT INTO brackets (event_id, name, start_date, start_stage)
      VALUES (?, ?, ?, ?)
    `).run(event_id, name, start_date, start_stage || 'round_of_16');
    
    console.log(`✅ Сетка "${name}" создана для турнира ${event_id} (начало: ${start_stage || 'round_of_16'})`);
    
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
    const { name, start_date, start_stage, username } = req.body;
    
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
      SET name = ?, start_date = ?, start_stage = ?
      WHERE id = ?
    `).run(name, start_date, start_stage || 'round_of_16', bracketId);
    
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
    const { username, matches } = req.body;
    
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
    
    // Обновляем команды в сетке (сохраняем как JSON)
    const result = db.prepare(`
      UPDATE brackets 
      SET matches = ?
      WHERE id = ?
    `).run(JSON.stringify(matches), bracketId);
    
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
    const { user_id, matches } = req.body;
    
    if (!user_id) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    if (!matches) {
      return res.status(400).json({ error: "Не указаны команды" });
    }
    
    // Получаем текущую структуру сетки
    const bracket = db.prepare("SELECT matches FROM brackets WHERE id = ?").get(bracketId);
    
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
    
    // Сохраняем только отфильтрованную структуру (без последующих стадий)
    const result = db.prepare(`
      UPDATE brackets 
      SET matches = ?
      WHERE id = ?
    `).run(JSON.stringify(filteredMatches), bracketId);
    
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
          sp.score_team1,
          sp.score_team2,
          ms.score_team1 as actual_score_team1,
          ms.score_team2 as actual_score_team2,
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

Попытка входа в аккаунт на сайте 1xBetLineBoom.

👤 Аккаунт: ${user.username}

Ваш код подтверждения: <code>${code}</code>

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

// 5.1 Получить всех пользователей
app.get("/api/users", (req, res) => {
  try {
    const users = db
      .prepare("SELECT id, username, telegram_username FROM users ORDER BY username ASC")
      .all();
    res.json(users);
  } catch (error) {
    console.error("Ошибка при получении пользователей:", error);
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
             m.status as match_status, m.round, m.is_final, 
             e.name as event_name, 
             e.status as event_status,
             e.start_date as event_start_date,
             e.locked_reason as event_locked_reason,
             sp.score_team1,
             sp.score_team2,
             ms.score_team1 as actual_score_team1,
             ms.score_team2 as actual_score_team2
      FROM bets b
      JOIN matches m ON b.match_id = m.id
      JOIN events e ON m.event_id = e.id
      LEFT JOIN score_predictions sp ON sp.user_id = b.user_id AND sp.match_id = b.match_id
      LEFT JOIN match_scores ms ON ms.match_id = b.match_id
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
    const { competition, dateFrom, dateTo } = req.query;
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
      // Проверяем что матч завершен (status: 8 = Finished)
      if (game.status !== 8) return false;
      
      // Проверяем что дата матча в нужном диапазоне
      const gameDate = game.date.split('T')[0]; // Берем только дату без времени
      return gameDate >= dateFrom && gameDate <= dateTo;
    });
    
    console.log(`✅ Из них завершенных в диапазоне ${dateFrom} - ${dateTo}: ${filteredGames.length} матчей`);

    // Преобразуем в формат SStats для совместимости с фронтом
    const matches = filteredGames.map(game => ({
      id: game.id,
      utcDate: game.date,
      status: 'FINISHED',
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
          home: game.homeResult,
          away: game.awayResult
        }
      }
    }));

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
    
    // Определяем код турнира по иконке (как в автоподсчете)
    console.log(`🔍 Определение кода турнира по иконке: "${event.icon}"`);
    
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
      'img/cups/uefa-euro.png': 'EC'
    };
    
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
      console.warn(`⚠️ Турнир не поддерживается: ${event.name}`);
      return res.json({ matches: [] }); // Если турнир не поддерживается, возвращаем пустой массив
    }
    
    const leagueId = SSTATS_LEAGUE_MAPPING[competition];
    console.log(`🆔 League ID для ${competition}: ${leagueId}`);
    
    if (!leagueId) {
      console.warn(`⚠️ League ID не найден для ${competition}`);
      return res.json({ matches: [] });
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
    
    // Определяем год для запроса
    // Для сезонных турниров используем текущий сезон
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    
    console.log(`🗓️ Текущая дата: ${now.toISOString()}, год: ${currentYear}, месяц: ${currentMonth}`);
    
    // Если сейчас январь-июль, то сезон начался в прошлом году
    // Например, январь 2026 = сезон 2025/2026, используем Year=2025
    const year = currentMonth <= 7 ? currentYear - 1 : currentYear;
    
    console.log(`🎯 Определен год для запроса: ${year} (логика: месяц ${currentMonth} <= 7 ? ${currentYear - 1} : ${currentYear})`);
    
    const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&Year=${year}`;
    
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
    
    // Получаем сегодняшнюю дату
    const today = new Date().toISOString().slice(0, 10); // "2026-01-20"
    
    console.log(`📅 Ищем матчи на дату: ${today}`);
    console.log(`📊 Всего матчей получено: ${sstatsData.data?.length || 0}`);
    
    // Фильтруем матчи: только на сегодня (показываем все - и live, и предстоящие, и завершенные)
    const todayMatches = (sstatsData.data || []).filter(game => {
      // Проверяем что матч на сегодня
      if (!game.date) return false;
      const matchDate = game.date.slice(0, 10);
      return matchDate === today;
    });
    
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
    
    // Логируем первые несколько матчей для отладки
    if (completedDays.length > 0 && completedDays[0].matches.length > 0) {
      console.log('📋 Пример матча из completedDays:', {
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

// POST /api/live-matches-by-ids - Получить актуальные данные LIVE матчей по их ID из SSTATS API
app.post("/api/live-matches-by-ids", async (req, res) => {
  try {
    const { matchIds } = req.body;
    
    console.log('📥 /api/live-matches-by-ids запрос:', matchIds);
    
    if (!Array.isArray(matchIds) || matchIds.length === 0) {
      return res.json([]);
    }
    
    const apiKey = process.env.SSTATS_API_KEY;
    if (!apiKey) {
      console.error(`❌ SSTATS_API_KEY не задан`);
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }
    
    // Получаем все активные турниры
    const activeEvents = db.prepare(`
      SELECT * FROM events 
      WHERE status = 'active' 
      ORDER BY name
    `).all();
    
    console.log(`📊 Найдено ${activeEvents.length} активных турниров`);
    
    const allMatches = [];
    
    // Проходим по каждому турниру и ищем матчи
    for (const event of activeEvents) {
      // Определяем код турнира
      let competition = null;
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
      
      if (!competition) continue;
      
      const leagueId = SSTATS_LEAGUE_MAPPING[competition];
      if (!leagueId) continue;
      
      try {
        // Получаем матчи из SSTATS API
        const url = `https://api.sstats.one/api/v1/leagues/${leagueId}/matches?apiKey=${apiKey}`;
        const response = await fetch(url);
        
        if (!response.ok) continue;
        
        const data = await response.json();
        if (!data.data || !Array.isArray(data.data)) continue;
        
        // Фильтруем только нужные матчи
        const filteredMatches = data.data
          .filter(match => matchIds.includes(match.id))
          .map(match => ({
            id: match.id,
            team1: match.homeTeam,
            team2: match.awayTeam,
            score: `${match.homeResult || 0}:${match.awayResult || 0}`,
            status: match.statusName || 'live',
            elapsed: match.elapsed
          }));
        
        allMatches.push(...filteredMatches);
        
      } catch (error) {
        console.error(`⚠️ Ошибка загрузки матчей для ${event.name}:`, error.message);
      }
    }
    
    console.log(`✅ Найдено ${allMatches.length} матчей из ${matchIds.length} запрошенных`);
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
        .get(telegram_username.toLowerCase(), userId);
      
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
      const cleanUsername = telegram_username.toLowerCase();
      const telegramUser = db
        .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
        .get(cleanUsername);
      
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

    if (cleanNewUsername) {
      const existingUser = db
        .prepare("SELECT id FROM users WHERE LOWER(telegram_username) = ? AND id != ?")
        .get(cleanNewUsername.toLowerCase(), userId);
      
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
        .get(cleanNewUsername.toLowerCase());
      
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
        is_final, score_prediction_enabled, show_exact_score, show_yellow_cards, show_red_cards,
        show_corners, show_penalties_in_game, show_extra_time, show_penalties_at_end
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
app.post("/api/matches/bulk-create", (req, res) => {
  const { matches } = req.body;

  if (!Array.isArray(matches) || matches.length === 0) {
    return res.status(400).json({ message: "Укажите массив матчей" });
  }

  try {
    const createdMatches = [];

    matches.forEach((match) => {
      const { team1_name, team2_name, match_date, round, event_id } = match;

      if (!team1_name || !team2_name || !event_id) {
        throw new Error(
          "Отсутствуют обязательные поля: team1_name, team2_name, event_id"
        );
      }

      const result = db
        .prepare(
          `INSERT INTO matches (event_id, team1_name, team2_name, match_date, round)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          event_id,
          team1_name,
          team2_name,
          match_date || null,
          round || null
        );

      createdMatches.push({
        id: result.lastInsertRowid,
        event_id,
        team1_name,
        team2_name,
        match_date,
        round,
      });
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
                   is_final, score_prediction_enabled, show_exact_score, show_yellow_cards, show_red_cards,
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
  const { username: adminUsername } = req.body;

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

<i>Это тестовое сообщение отправлено администратором</i>`;

    // Отправляем в группу
    await sendGroupNotification(testMessage);

    console.log("✅ Тестовое уведомление отправлено в группу");
    res.json({ success: true, message: "Тестовое уведомление отправлено" });
  } catch (error) {
    console.error("Ошибка при отправке тестового уведомления:", error);
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
  const { userId, eventName, round, matchesCount } = req.body;

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
          u.username, 
          u.telegram_username,
          sp.score_team1 as predicted_score1,
          sp.score_team2 as predicted_score2,
          ms.score_team1 as actual_score1,
          ms.score_team2 as actual_score2
        FROM bets b
        JOIN matches m ON b.match_id = m.id
        JOIN users u ON b.user_id = u.id
        LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
        LEFT JOIN match_scores ms ON b.match_id = ms.match_id
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
            correctScores: 0
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

          // Проверяем прогноз на счет
          if (bet.predicted_score1 !== null && bet.predicted_score2 !== null &&
              bet.actual_score1 !== null && bet.actual_score2 !== null) {
            const scoreCorrect = 
              bet.predicted_score1 === bet.actual_score1 && 
              bet.predicted_score2 === bet.actual_score2;
            
            if (scoreCorrect) {
              // Дополнительное очко за угаданный счет
              userPoints[bet.user_id].points++;
              userPoints[bet.user_id].correctScores++;
            }
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
        for (let i = 0; i < tournament.users.length; i++) {
          const user = tournament.users[i];
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '▪️';
          
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
          if (stats.length > 0) {
            userLine += ` (${stats.join(', ')})`;
          }
          
          message += userLine + '\n';
        }

        // Лучший за период
        if (tournament.users.length > 0) {
          const winner = tournament.users[0];
          message += `\n👑 <b>Лучший за период ${dateFromFormatted} - ${dateToFormatted}:</b>\n`;
          message += `Поздравляем, малютка ${winner.username}! 🎉\n`;
          
          // Если есть угаданные счета, показываем
          if (winner.correctScores > 0) {
            message += `🎯 Угадано счетов: ${winner.correctScores}\n`;
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

    // Отправляем в группу
    for (const chatId of chatIds) {
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              chat_id: chatId,
              text: message,
              parse_mode: "HTML",
            }),
          }
        );

        if (!response.ok) {
          console.error(
            `❌ Ошибка отправки в чат ${chatId}:`,
            response.statusText
          );
        } else {
          console.log(`✅ Результаты отправлены в чат ${chatId}`);
        }
      } catch (error) {
        console.error(`❌ Ошибка отправки результатов в чат ${chatId}:`, error);
      }
    }

    // Отправляем персонализированные сообщения в личку пользователям
    try {
      // Получаем всех пользователей с привязанным Telegram и включенной настройкой личных сообщений
      const usersWithTelegram = db.prepare(`
        SELECT u.id, u.username, u.telegram_id, u.telegram_username
        FROM users u
        WHERE u.telegram_id IS NOT NULL 
          AND u.telegram_notifications = 1
      `).all();

      console.log(`📱 Найдено ${usersWithTelegram.length} пользователей для отправки личных сообщений`);

      // Для каждого турнира отправляем персонализированные сообщения
      for (const tournament of tournamentResults) {
        const users = tournament.users;
        
        if (users.length === 0) continue;

        // Находим максимальное и минимальное количество очков
        const maxPoints = users[0].points;
        const minPoints = users[users.length - 1].points;

        // Находим победителя (первого с максимальными очками)
        const winner = users[0];

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

          // Добавляем список всех участников
          for (let i = 0; i < users.length; i++) {
            const u = users[i];
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '▪️';
            
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
            personalMessage += `Сегодня ты лучший, у тебя <b>${user.points} ${userPointsWord}</b>, поздравляю, малютка 👑 ${user.username}! 🎉`;
          } else if (user.points === minPoints) {
            // Пользователь худший (или один из худших)
            personalMessage += `Сегодня ты лох, такое может случиться с каждым, у тебя <b>${user.points} ${userPointsWord}</b>, а лучший, это малютка 👑 ${winner.username}! 🎉`;
          } else {
            // Пользователь в середине
            personalMessage += `Сегодня ты не лучший, у тебя <b>${user.points} ${userPointsWord}</b>, а лучший, это малютка 👑 ${winner.username}! 🎉`;
          }

          // Отправляем личное сообщение
          try {
            const response = await fetch(
              `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  chat_id: telegramUser.telegram_id,
                  text: personalMessage,
                  parse_mode: "HTML",
                }),
              }
            );

            if (!response.ok) {
              const errorData = await response.json();
              console.error(
                `❌ Ошибка отправки личного сообщения ${user.username} (${telegramUser.telegram_id}):`,
                errorData
              );
            } else {
              console.log(`✅ Личное сообщение отправлено ${user.username} (${telegramUser.telegram_id})`);
            }
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

    // ВАЖНО: Записываем все изменения из WAL в основной файл БД перед копированием
    db.pragma("wal_checkpoint(FULL)");
    console.log("✓ WAL checkpoint выполнен перед созданием бэкапа");

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
    db.pragma("journal_mode = WAL");

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
        sp.score_team1 as predicted_score1,
        sp.score_team2 as predicted_score2,
        ms.score_team1 as actual_score1,
        ms.score_team2 as actual_score2,
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
          WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
               ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
               sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
          THEN 1 
          ELSE 0 
        END as score_correct,
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
              WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                   ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                   sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
              THEN 1 
              ELSE 0 
            END
          ELSE 0 
        END as total_points
      FROM bets b
      JOIN matches m ON b.match_id = m.id
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
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
  'img/cups/uefa-euro.png': 'EC'
};

// Хранилище обработанных дат (чтобы не обрабатывать повторно)
const processedDates = new Set();

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
 * Получить активные даты с незавершенными матчами
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
      WHERE m.status != 'finished'
        AND m.match_date IS NOT NULL
        AND DATE(m.match_date) >= DATE('now', '-1 day')
        AND DATE(m.match_date) <= DATE('now', '+3 days')
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
    
    // Получаем матчи из БД для этой даты
    const dbMatches = db.prepare(`
      SELECT * FROM matches
      WHERE event_id = ?
        AND round = ?
        AND DATE(match_date) = ?
        AND status != 'finished'
    `).all(event_id, round, date);
    
    if (dbMatches.length === 0) {
      return { allFinished: true, matches: [] };
    }
    
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
    
    // Фильтруем матчи по дате
    const apiMatches = (sstatsData.data || []).filter(game => {
      const gameDate = game.date.split('T')[0];
      return gameDate === date;
    });
    
    // Сопоставляем матчи БД с API
    const matchedMatches = [];
    
    for (const dbMatch of dbMatches) {
      const apiMatch = apiMatches.find(api => {
        const apiHome = normalizeTeamNameForAPI(api.homeTeam.name);
        const apiAway = normalizeTeamNameForAPI(api.awayTeam.name);
        const dbHome = normalizeTeamNameForAPI(dbMatch.team1_name);
        const dbAway = normalizeTeamNameForAPI(dbMatch.team2_name);
        
        return (apiHome === dbHome && apiAway === dbAway) ||
               (apiHome === dbAway && apiAway === dbHome);
      });
      
      if (apiMatch) {
        matchedMatches.push({ dbMatch, apiMatch });
      }
    }
    
    // Проверяем что все матчи завершены (status: 8)
    const allFinished = matchedMatches.length > 0 && 
                       matchedMatches.every(({ apiMatch }) => apiMatch.status === 8);
    
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
          score_team1 = ?,
          score_team2 = ?
      WHERE id = ?
    `);
    
    for (const { dbMatch, apiMatch } of matches) {
      const homeScore = apiMatch.homeResult;
      const awayScore = apiMatch.awayResult;
      
      // Определяем победителя с учетом возможного обратного порядка команд
      const apiHome = normalizeTeamNameForAPI(apiMatch.homeTeam.name);
      const dbHome = normalizeTeamNameForAPI(dbMatch.team1_name);
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
    
    if (!allFinished || matches.length === 0) {
      console.log(`⏸️ Не все матчи завершены для ${date}`);
      return;
    }
    
    console.log(`✅ Все матчи завершены для ${date}!`);
    
    // Обновляем матчи в БД
    const updated = updateMatchesFromAPI(matches);
    
    if (!updated) {
      console.error(`❌ Не удалось обновить матчи для ${date}`);
      return;
    }
    
    // Помечаем дату как обработанную
    processedDates.add(dateKey);
    
    // Получаем ставки за эту дату
    const bets = db.prepare(`
      SELECT 
        b.*,
        u.username,
        m.team1_name,
        m.team2_name,
        m.winner,
        m.score_team1 as actual_score_team1,
        m.score_team2 as actual_score_team2
      FROM bets b
      JOIN users u ON b.user_id = u.id
      JOIN matches m ON b.match_id = m.id
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
          correctScores: 0
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
        
        // Проверяем счет
        if (bet.score_team1 != null && bet.score_team2 != null &&
            bet.score_team1 === bet.actual_score_team1 &&
            bet.score_team2 === bet.actual_score_team2) {
          userStats[username].points++;
          userStats[username].correctScores++;
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
