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
  notifyBetDeleted,
  getNotificationQueue,
  flushQueueNow,
  writeNotificationQueue,
  sendUserMessage,
  sendGroupNotification,
  notifyTelegramLinked,
  stopBot,
} from "./OnexBetLineBoombot.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 1984;
const SERVER_IP = process.env.SERVER_IP || "localhost";
const FD_API_TOKEN = process.env.FD_API_TOKEN;
const FD_API_BASE = "https://api.football-data.org/v4";
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

      logEntry = `
    <div class="log-entry bet-placed">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action placed">✅ СТАВКА СДЕЛАНА</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Пользователь</div>👤 ${
          data.username
        }</span>
        <span class="prediction"><div class="log-label">Ставка</div>🎯 ${predictionText}</span>
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

      logEntry = `
    <div class="log-entry bet-deleted">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action deleted">❌ СТАВКА УДАЛЕНА</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Пользователь</div>👤 ${
          data.username
        }</span>
        <span class="prediction"><div class="log-label">Ставка</div>🎯 ${predictionText}</span>
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
    .log-time { color: #b0b8c8; font-size: 0.85em; margin-bottom: 5px; }
    .log-action { font-weight: bold; margin-bottom: 8px; }
    .log-action.placed { color: #4caf50; }
    .log-action.deleted { color: #f44336; }
    .log-action.settings { color: #ff9800; }
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
  </style>
</head>
<body>
  <div class="header">
    <h1>📋 Логи ставок</h1>
    <p>История всех ставок и удалений</p>
  </div>
  <div class="logs-container">
<!-- LOGS_START -->
<!-- LOGS_END -->
  </div>
</body>
</html>`;
  fs.writeFileSync(LOG_FILE_PATH, template, "utf-8");
  console.log("🔄 Файл логов очищен/создан");
}

// Инициализируем базу данных
const db = new Database("1xBetLineBoom.db");

// Отключаем FOREIGN KEY constraints для упрощения операций удаления
db.pragma("foreign_keys = OFF");

// Middleware
app.use(express.json({ limit: "50mb" })); // Увеличиваем лимит для аватаров
app.use(express.static(".")); // Раздаем статические файлы (HTML, CSS, JS)

// ===== ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ =====

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
    FOREIGN KEY (user_id) REFERENCES users(id)
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
        COUNT(DISTINCT b.id) as event_bets,
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
                       CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END
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
        END) as event_won,
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
      WHERE m.event_id = ?
      GROUP BY u.id, u.username, u.avatar
      HAVING COUNT(DISTINCT b.id) > 0
      ORDER BY event_won DESC, event_bets DESC
    `
      )
      .all(eventId);

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
app.get("/api/event/:eventId/participant/:userId/bets", (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const userId = parseInt(req.params.userId);
    const viewerUserId = req.query.viewerId ? parseInt(req.query.viewerId) : null;

    // Получаем название турнира
    const event = db
      .prepare("SELECT name FROM events WHERE id = ?")
      .get(eventId);

    // Получаем настройку show_bets пользователя
    const userSettings = db
      .prepare("SELECT show_bets FROM users WHERE id = ?")
      .get(userId);
    
    const showBets = userSettings?.show_bets || 'always';
    const isOwner = viewerUserId === userId;

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
app.post("/api/user", (req, res) => {
  try {
    const { username } = req.body;

    // Проверяем, существует ли пользователь
    let user = db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username);

    if (!user) {
      const result = db
        .prepare("INSERT INTO users (username) VALUES (?)")
        .run(username);
      user = { id: result.lastInsertRowid, username };
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5.1 Получить всех пользователей
app.get("/api/users", (req, res) => {
  try {
    const users = db
      .prepare("SELECT id, username FROM users ORDER BY username ASC")
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
app.post("/api/moderators", (req, res) => {
  try {
    const { user_id, permissions } = req.body;

    if (!user_id || !Array.isArray(permissions)) {
      return res.status(400).json({ error: "Неверные параметры" });
    }

    // Проверяем существует ли пользователь
    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(user_id);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
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

    const result = db
      .prepare("DELETE FROM moderators WHERE id = ?")
      .run(moderatorId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Модератор не найден" });
    }

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
app.put("/api/moderators/:moderatorId/permissions", (req, res) => {
  try {
    const { moderatorId } = req.params;
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: "Разрешения должны быть массивом" });
    }

    const result = db
      .prepare("UPDATE moderators SET permissions = ? WHERE id = ?")
      .run(JSON.stringify(permissions), moderatorId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Модератор не найден" });
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
app.get("/api/user/:userId/bets", (req, res) => {
  try {
    const { userId } = req.params;
    const bets = db
      .prepare(
        `
      SELECT b.*, 
             m.team1_name, m.team2_name, m.winner, 
             m.status as match_status, m.round, m.is_final, 
             e.name as event_name, 
             e.status as event_status,
             e.start_date as event_start_date,
             e.locked_reason as event_locked_reason
      FROM bets b
      JOIN matches m ON b.match_id = m.id
      JOIN events e ON m.event_id = e.id
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

// GET /api/fd-token - Получить токен Football-Data API
app.get("/api/fd-token", (req, res) => {
  const token = process.env.FD_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "FD_API_TOKEN не установлен" });
  }
  res.json({ token });
});

// GET /api/counting-bets - Получить все ставки в статусе "pending" за период
app.get("/api/fd-matches", async (req, res) => {
  try {
    const { competition, dateFrom, dateTo } = req.query;
    if (!competition || !dateFrom || !dateTo) {
      return res
        .status(400)
        .json({ error: "Отсутствуют параметры competition/dateFrom/dateTo" });
    }

    const token = process.env.FD_API_TOKEN;
    if (!token) {
      return res.status(500).json({ error: "FD_API_TOKEN не задан" });
    }

    const url = `https://api.football-data.org/v4/competitions/${encodeURIComponent(
      competition
    )}/matches?status=FINISHED&dateFrom=${encodeURIComponent(
      dateFrom
    )}&dateTo=${encodeURIComponent(dateTo)}`;

    const response = await fetch(url, {
      headers: {
        "X-Auth-Token": token,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res
        .status(response.status)
        .json({ error: errorText || response.statusText });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("/api/fd-matches", error);
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
        e.name as event_name
      FROM bets b
      JOIN users u ON b.user_id = u.id
      JOIN matches m ON b.match_id = m.id
      JOIN events e ON m.event_id = e.id
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
                       CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END
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
app.get("/api/user/:userId/profile", (req, res) => {
  try {
    const { userId } = req.params;

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
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
                       CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END
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
app.put("/api/user/:userId/username", (req, res) => {
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
      .prepare("SELECT id, username FROM users WHERE id = ?")
      .get(userId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем не используется ли это имя другим пользователем
    const existingUser = db
      .prepare("SELECT id FROM users WHERE username = ? AND id != ?")
      .get(username, userId);

    if (existingUser) {
      return res.status(400).json({ error: "Это имя уже используется" });
    }

    // Обновляем имя
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(
      username,
      userId
    );

    // Логируем
    console.log(
      `✅ Username изменён для пользователя ${userId}: "${user.username}" → "${username}"`
    );

    res.json({ success: true, username, message: "Имя успешно изменено" });
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

    const oldTelegramUsername = user.telegram_username;

    db.prepare("UPDATE users SET telegram_username = ? WHERE id = ?").run(
      telegram_username || null,
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

// PUT /api/user/:userId/settings - Управление настройками пользователя
app.put("/api/user/:userId/settings", async (req, res) => {
  try {
    const { userId } = req.params;
    const { telegram_notifications_enabled, telegram_group_reminders_enabled, theme } =
      req.body;

    // Проверяем существование пользователя
    const user = db
      .prepare("SELECT id, username, telegram_username, theme FROM users WHERE id = ?")
      .get(userId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
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

    res.json({
      success: true,
      message: "Настройки сохранены",
      telegram_notifications_enabled: telegram_notifications_enabled,
      telegram_group_reminders_enabled: telegram_group_reminders_enabled,
      theme: theme,
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
        "SELECT telegram_notifications_enabled, telegram_group_reminders_enabled, theme FROM users WHERE id = ?"
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
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/show-bets - Получить настройку показа ставок
app.get("/api/user/:userId/show-bets", (req, res) => {
  try {
    const { userId } = req.params;
    const user = db
      .prepare("SELECT show_bets FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({
      show_bets: user.show_bets || 'always',
    });
  } catch (error) {
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

    db.prepare("UPDATE users SET show_bets = ? WHERE id = ?").run(show_bets, userId);

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

// ===== FOOTBALL-DATA.ORG API ENDPOINTS =====

// Вспомогательные функции для работы с API
async function fetchFromFootballData(endpoint) {
  try {
    const response = await fetch(`${FD_API_BASE}${endpoint}`, {
      headers: { "X-Auth-Token": FD_API_TOKEN },
    });

    if (response.status === 429) {
      console.warn("Football-data.org API: Rate limit exceeded");
      return null;
    }

    if (!response.ok) {
      console.error(`Football-data.org API error: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("Football-data.org API fetch error:", error.message);
    return null;
  }
}

// Получить финальные матчи Лиги чемпионов за дату
app.get("/api/football-data/cl-matches", async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    let endpoint = "/competitions/CL/matches?status=FINISHED";
    if (dateFrom) endpoint += `&dateFrom=${dateFrom}`;
    if (dateTo) endpoint += `&dateTo=${dateTo}`;

    const data = await fetchFromFootballData(endpoint);

    if (!data || !data.matches) {
      return res.json({ matches: [] });
    }

    const matches = data.matches.map((match) => ({
      date: match.utcDate.slice(0, 10),
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      homeScore: match.score.fullTime.home,
      awayScore: match.score.fullTime.away,
      winner:
        match.score.fullTime.home > match.score.fullTime.away
          ? match.homeTeam.name
          : match.score.fullTime.home < match.score.fullTime.away
          ? match.awayTeam.name
          : "Draw",
    }));

    res.json({ matches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Синхронизировать результаты матчей в базу данных
app.post("/api/football-data/sync-results", async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.body;

    let endpoint = "/competitions/CL/matches?status=FINISHED";
    if (dateFrom) endpoint += `&dateFrom=${dateFrom}`;
    if (dateTo) endpoint += `&dateTo=${dateTo}`;

    const data = await fetchFromFootballData(endpoint);

    if (!data || !data.matches) {
      return res.json({ synced: 0, message: "Нет данных для синхронизации" });
    }

    let synced = 0;

    data.matches.forEach((match) => {
      const winner =
        match.score.fullTime.home > match.score.fullTime.away
          ? match.homeTeam.name
          : match.score.fullTime.home < match.score.fullTime.away
          ? match.awayTeam.name
          : "Ничья";

      try {
        db.prepare(
          `
          UPDATE matches 
          SET status = 'finished', winner = ?
          WHERE team1_name = ? AND team2_name = ? AND status = 'pending'
        `
        ).run(winner, match.homeTeam.name, match.awayTeam.name);

        synced++;
      } catch (err) {
        console.error("Error updating match result:", err.message);
      }
    });

    // Обновляем статусы ставок
    try {
      const unfinishedBets = db
        .prepare(
          `
        SELECT DISTINCT b.id, b.match_id, b.prediction, m.winner
        FROM bets b
        JOIN matches m ON b.match_id = m.id
        WHERE b.status = 'pending' AND m.status = 'finished'
      `
        )
        .all();

      unfinishedBets.forEach((bet) => {
        const won = bet.prediction === bet.winner ? "won" : "lost";
        db.prepare("UPDATE bets SET status = ? WHERE id = ?").run(won, bet.id);
      });
    } catch (err) {
      console.error("Error updating bet statuses:", err.message);
    }

    res.json({ synced, message: `Синхронизировано ${synced} матчей` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== АДМИН ФУНКЦИИ =====

// POST /api/admin/events - Создать новое событие (только для админа)
app.post("/api/admin/events", (req, res) => {
  const {
    username,
    name,
    description,
    start_date,
    end_date,
    icon,
    background_color,
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
      INSERT INTO events (name, description, start_date, end_date, icon, background_color)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        name,
        description || null,
        start_date || null,
        end_date || null,
        icon || null,
        background_color || null
      );

    res.json({
      id: result.lastInsertRowid,
      name,
      description,
      start_date,
      end_date,
      icon,
      background_color,
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
      SET name = ?, description = ?, start_date = ?, end_date = ?, icon = ?, background_color = ?
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
app.post("/api/admin/matches", (req, res) => {
  const {
    username,
    event_id,
    team1,
    team2,
    match_date,
    round,
    is_final,
    show_exact_score,
    show_yellow_cards,
    show_red_cards,
    show_corners,
    show_penalties_in_game,
    show_extra_time,
    show_penalties_at_end,
  } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;

  // Проверяем, является ли пользователь админом
  if (username !== ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
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
        is_final, show_exact_score, show_yellow_cards, show_red_cards,
        show_corners, show_penalties_in_game, show_extra_time, show_penalties_at_end
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        event_id,
        team1,
        team2,
        match_date || null,
        round || null,
        is_final ? 1 : 0,
        show_exact_score ? 1 : 0,
        show_yellow_cards ? 1 : 0,
        show_red_cards ? 1 : 0,
        show_corners ? 1 : 0,
        show_penalties_in_game ? 1 : 0,
        show_extra_time ? 1 : 0,
        show_penalties_at_end ? 1 : 0
      );

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

// PUT /api/admin/matches/:matchId - Изменить статус или отредактировать матч (только для админа)
app.put("/api/admin/matches/:matchId", (req, res) => {
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

  // Проверяем, является ли пользователь админом
  if (username !== process.env.ADMIN_DB_NAME) {
    console.log("❌ Пользователь не админ:", username);
    return res.status(403).json({ error: "Недостаточно прав" });
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

      console.log("✓ Обновляем матч:", {
        matchId,
        status,
        result: result || null,
        winner,
      });

      db.prepare(
        "UPDATE matches SET status = ?, result = ?, winner = ? WHERE id = ?"
      ).run(status, result || null, winner, matchId);

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
                   is_final, show_exact_score, show_yellow_cards, show_red_cards,
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

// DELETE /api/admin/events/:eventId - Удалить событие (только для админа)
app.delete("/api/admin/events/:eventId", (req, res) => {
  const { eventId } = req.params;
  const username = req.body.username;

  // Проверяем, является ли пользователь админом
  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
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

// PUT /api/admin/events/:eventId - Редактировать турнир (только для админа)
app.put("/api/admin/events/:eventId", (req, res) => {
  const { eventId } = req.params;
  const { username, name, description, start_date, end_date } = req.body;

  // Проверяем, является ли пользователем админом
  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
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

// GET /api/admin/users - Получить всех пользователей (только для админа)
app.get("/api/admin/users", (req, res) => {
  const username = req.query.username;

  // Проверяем, является ли пользователь админом
  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
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

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/users/:userId - Переименовать пользователя (только для админа)
app.put("/api/admin/users/:userId", (req, res) => {
  const { userId } = req.params;
  const { username: adminUsername, newUsername } = req.body;

  // Проверяем, является ли пользователь админом
  if (adminUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  // Проверяем обязательные поля
  if (!newUsername || newUsername.trim() === "") {
    return res
      .status(400)
      .json({ error: "Новое имя пользователя обязательно" });
  }

  try {
    // Проверяем, не занято ли имя
    const existing = db
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(newUsername);
    if (existing) {
      return res.status(400).json({ error: "Это имя уже занято" });
    }

    const result = db
      .prepare("UPDATE users SET username = ? WHERE id = ?")
      .run(newUsername, userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({ message: "Пользователь успешно переименован", newUsername });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/users/:userId - Удалить пользователя (только для админа)
app.delete("/api/admin/users/:userId", (req, res) => {
  const { userId } = req.params;
  const { username: adminUsername } = req.body;

  // Проверяем, является ли пользователь админом
  if (adminUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  // Не даем удалить самого админа
  const userToDelete = db
    .prepare("SELECT username FROM users WHERE id = ?")
    .get(userId);
  if (userToDelete && userToDelete.username === process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Нельзя удалить админа" });
  }

  try {
    // Получаем все финальные ставки пользователя чтобы потом удалить их параметры
    const finalBets = db
      .prepare(
        "SELECT match_id FROM bets WHERE user_id = ? AND is_final_bet = 1"
      )
      .all(userId);

    // Удаляем все ставки пользователя
    db.prepare("DELETE FROM bets WHERE user_id = ?").run(userId);

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

    res.json({ message: "Пользователь успешно удален" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/user-settings/:userId - Отправить настройки пользователя админу в Telegram
app.post("/api/admin/user-settings/:userId", async (req, res) => {
  const { userId } = req.params;
  const { username: adminUsername } = req.body;

  // Проверяем, является ли пользователь админом
  if (adminUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    // Получаем полную информацию о пользователе
    const user = db
      .prepare(
        `SELECT 
          id, username, email, created_at, telegram_username, 
          timezone, theme, show_bets,
          telegram_notifications_enabled, telegram_group_reminders_enabled
        FROM users 
        WHERE id = ?`
      )
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Форматируем настройки для отправки
    const settingsMessage = `⚙️ НАСТРОЙКИ ПОЛЬЗОВАТЕЛЯ

👤 Пользователь: ${user.username}
🆔 ID: ${user.id}
${user.email ? `📧 Email: ${user.email}` : ""}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : "📱 Telegram: не привязан"}
📅 Регистрация: ${user.created_at ? new Date(user.created_at).toLocaleString("ru-RU") : "неизвестно"}

🔔 УВЕДОМЛЕНИЯ:
• Личные сообщения в ТГ: ${user.telegram_notifications_enabled ? "✅ Включены" : "❌ Отключены"}
• Напоминания в группе: ${user.telegram_group_reminders_enabled ? "✅ Включены" : "❌ Отключены"}

🎨 ИНТЕРФЕЙС:
• Тема: ${
  user.theme === "theme-dark" ? "🌙 Темная" : 
  user.theme === "theme-light" ? "☀️ Светлая" : 
  user.theme === "theme-leagueChampions" ? "⚽ Лига Чемпионов" :
  user.theme === "theme-default" ? "🔄 По умолчанию" :
  user.theme || "🔄 По умолчанию"
}
• Часовой пояс: ${user.timezone || "Europe/Moscow (по умолчанию)"}

🔒 ПРИВАТНОСТЬ:
• Показывать ставки: ${user.show_bets === "always" ? "Всегда" : user.show_bets === "after_start" ? "После начала матча" : "Не установлено"}`;

    // Отправляем сообщение админу
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
      return res.status(500).json({ error: "Telegram не настроен" });
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_ADMIN_ID,
          text: settingsMessage,
        }),
      }
    );

    if (!telegramResponse.ok) {
      throw new Error("Ошибка отправки в Telegram");
    }

    console.log(`✅ Настройки пользователя ${user.username} отправлены админу`);
    res.json({ success: true, message: "Настройки отправлены в Telegram" });
  } catch (error) {
    console.error("Ошибка при отправке настроек:", error);
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

// DELETE /api/admin/matches/:matchId - Удалить матч
app.delete("/api/admin/matches/:matchId", (req, res) => {
  const { matchId } = req.params;
  const { username } = req.body;

  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
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

    res.json({ success: true, message: "Матч успешно удален" });
  } catch (error) {
    console.error("❌ Ошибка при удалении матча:", error.message);
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
app.post("/api/backup", (req, res) => {
  try {
    // Проверяем что юзер админ (базовая проверка)
    // В реальной системе нужна проверка авторизации

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, -5);
    const backupFilename = `1xBetLineBoom_backup_${timestamp}.db`;
    const backupPath = path.join(BACKUPS_DIR, backupFilename);
    const dbPath = path.join(__dirname, "1xBetLineBoom.db");

    // Копируем файл БД
    fs.copyFileSync(dbPath, backupPath);

    console.log(`✓ Бэкап БД создан: ${backupFilename}`);

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
app.get("/download-backup/:filename", (req, res) => {
  try {
    const filename = req.params.filename;

    // Проверяем что имя файла содержит только допустимые символы (безопасность)
    if (!/^1xBetLineBoom_backup_[\d\-]+\.db$/.test(filename)) {
      return res.status(400).json({ error: "Неверное имя файла" });
    }

    const backupPath = path.join(BACKUPS_DIR, filename);

    // Проверяем что файл существует
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: "Файл бэкапа не найден" });
    }

    // Отправляем файл
    res.download(backupPath, filename, (err) => {
      if (err) {
        console.error("❌ Ошибка при скачивании файла:", err);
      } else {
        console.log(`✓ Бэкап БД скачан: ${filename}`);
      }
    });
  } catch (error) {
    console.error("❌ Ошибка при скачивании бэкапа:", error);
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

// GET /api/admin/orphaned-data - Проверить orphaned данные (только для админа)
app.get("/api/admin/orphaned-data", (req, res) => {
  const username = req.query.username;

  console.log(`🔍 Запрос orphaned-data от пользователя: "${username}"`);
  console.log(`🔐 ADMIN_DB_NAME: "${process.env.ADMIN_DB_NAME}"`);

  // Проверяем, является ли пользователь админом
  if (username !== process.env.ADMIN_DB_NAME) {
    console.log(
      `❌ Доступ запрещён: "${username}" !== "${process.env.ADMIN_DB_NAME}"`
    );
    return res.status(403).json({ error: "Недостаточно прав" });
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
app.post("/api/admin/cleanup-orphaned-data", (req, res) => {
  const { username, dataType } = req.body;

  // Проверяем, является ли пользователь админом
  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== API ENDPOINTS ДЛЯ ТЕРМИНАЛА =====

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
    let maxPoints = 0;
    let winner = null;

    results.forEach((result) => {
      const username = result.username;
      if (!userStats[username]) {
        userStats[username] = 0;
      }
      if (result.isWon) {
        userStats[username]++;
      }
    });

    // Находим победителя (максимальное количество очков)
    Object.entries(userStats).forEach(([username, points]) => {
      if (points > maxPoints) {
        maxPoints = points;
        winner = username;
      }
    });

    // Формируем сообщение
    const dateStr = new Date().toLocaleDateString("ru-RU");
    let message = `📊 <b>Результаты подсчета ставок</b>\n\n`;
    message += `📅 Дата: ${dateStr}\n`;
    message += `📆 Период: ${dateFrom} - ${dateTo}\n\n`;

    if (winner) {
      message += `🏆 Победитель дня: <b>${winner}</b> (${maxPoints} очков)\n\n`;
    }

    message += `📈 Статистика участников:\n`;
    Object.entries(userStats)
      .sort(([, a], [, b]) => b - a)
      .forEach(([username, points]) => {
        message += `• ${username}: ${points} очков\n`;
      });

    // Отправляем сообщение в Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.error("❌ Telegram токен или chat ID не настроены");
      return res.status(500).json({ error: "Telegram не настроен" });
    }

    const chatIds = TELEGRAM_CHAT_ID.split(",").map((id) => id.trim());

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
          console.log(`✅ Уведомление отправлено в чат ${chatId}`);
        }
      } catch (error) {
        console.error(`❌ Ошибка отправки уведомления в чат ${chatId}:`, error);
      }
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

// Запуск сервера
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `\n🎯 1xBetLineBoom сервер запущен на http://0.0.0.0:${PORT} (доступен на http://144.124.237.222:${PORT})\n`
  );
});
