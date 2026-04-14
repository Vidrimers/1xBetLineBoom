import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

// ===== КОНФИГ =====
import { PORT, BACKUPS_DIR, TERMINAL_LOGS_PATH } from "./config.js";

// ===== ЛОГГЕР (инициализируем до всего остального) =====
import {
  addTerminalLog,
  initTerminalLogs,
} from "./utils/logger.js";

// Загружаем логи терминала из файла при запуске
initTerminalLogs(TERMINAL_LOGS_PATH);

// Перехватываем console.log/error/warn для терминала
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

// ===== БАЗА ДАННЫХ =====
import { initDatabase } from "./database/init.js";
import { runMigrations } from "./database/migrations.js";

initDatabase();
runMigrations();

// ===== TELEGRAM БОТ =====
import { startBot } from "../OnexBetLineBoombot.js";

// ===== СЕРВИСЫ =====
import {
  checkAndRemindNonVoters,
  checkAndNotifyUpcomingMatches,
  checkAndSendPersonalReminders,
  checkAndNotifyMatchStart,
} from "./services/notificationService.js";

import { checkAndAutoCount } from "./services/autoCountingService.js";

// ===== РОУТЫ =====
import authRouter from "./routes/auth.js";
import eventsRouter from "./routes/events.js";
import matchesRouter from "./routes/matches.js";
import betsRouter from "./routes/bets.js";
import usersRouter from "./routes/users.js";
import bracketRouter from "./routes/bracket.js";
import liveRouter from "./routes/live.js";
import newsRouter from "./routes/news.js";
import settingsRouter from "./routes/settings.js";
import awardsRouter from "./routes/awards.js";
import adminRouter from "./routes/admin.js";
import terminalRouter from "./routes/terminal.js";
import autocountingRouter from "./routes/autocounting.js";
import aiChatRouter from "./routes/aiChat.js";

// ===== EXPRESS APP =====
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Создаём папку backups если её нет
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  console.log("📁 Папка backups создана");
}

// ===== MIDDLEWARE =====
app.use(express.json({ limit: "50mb" })); // Увеличиваем лимит для аватаров
app.use(express.static(".")); // Раздаём статические файлы (HTML, CSS, JS)

// ===== TELEGRAM WEBHOOK =====
app.post("/telegram-webhook", async (req, res) => {
  try {
    console.log("📨 Получен webhook от Telegram");
    const update = req.body;
    const { handleWebhookUpdate } = await import("../OnexBetLineBoombot.js");
    await handleWebhookUpdate(update);
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Ошибка обработки webhook:", error);
    res.sendStatus(500);
  }
});

// ===== MIDDLEWARE: обновление last_activity при каждом запросе =====
import { db } from "./database/db.js";

app.use((req, res, next) => {
  // Пропускаем статические файлы
  if (
    req.path.startsWith("/css/") ||
    req.path.startsWith("/js/") ||
    req.path.startsWith("/img/") ||
    req.path.endsWith(".html")
  ) {
    return next();
  }

  // Получаем session_token из заголовка или cookies
  const sessionToken =
    req.headers["x-session-token"] || req.cookies?.session_token;

  if (sessionToken) {
    try {
      db.prepare(`
        UPDATE sessions 
        SET last_activity = CURRENT_TIMESTAMP 
        WHERE session_token = ?
      `).run(sessionToken);
    } catch (error) {
      console.error("Ошибка обновления last_activity:", error);
    }
  }

  next();
});

// ===== ПОДКЛЮЧЕНИЕ РОУТОВ =====
app.use(authRouter);
app.use(eventsRouter);
app.use(matchesRouter);
app.use(betsRouter);
app.use(usersRouter);
app.use(bracketRouter);
app.use(liveRouter);
app.use(newsRouter);
app.use(settingsRouter);
app.use(awardsRouter);
app.use(adminRouter);
app.use(terminalRouter);
app.use(autocountingRouter);
app.use(aiChatRouter);

// ===== ЗАПУСК TELEGRAM БОТА =====
startBot();

// ===== ИНТЕРВАЛЫ =====

// Напоминания непроголосовавших (каждые 5 минут)
setInterval(checkAndRemindNonVoters, 5 * 60 * 1000);
console.log(
  "🔔 Фоновая задача проверки непроголосовавших пользователей запущена (интервал: 5 минут)"
);

// Уведомление о начале матча (каждую минуту)
setInterval(checkAndNotifyMatchStart, 60 * 1000);
console.log(
  "⚽ Фоновая задача уведомления о начале матча запущена (интервал: 1 минута)"
);

// Уведомление за 3 часа до матча (каждые 5 минут) + сразу при старте
setInterval(checkAndNotifyUpcomingMatches, 5 * 60 * 1000);
checkAndNotifyUpcomingMatches();
console.log(
  "🔔 Фоновая задача уведомления за 3 часа до матча запущена (интервал: 5 минут)"
);

// Персональные напоминания (каждые 5 минут) + сразу при старте
setInterval(checkAndSendPersonalReminders, 5 * 60 * 1000);
checkAndSendPersonalReminders();
console.log(
  "🔔 Фоновая задача персональных напоминаний запущена (интервал: 5 минут)"
);

// Автоподсчёт (каждые 5 минут)
const AUTO_COUNT_INTERVAL = 5 * 60 * 1000;
setInterval(checkAndAutoCount, AUTO_COUNT_INTERVAL);
console.log(`\n🤖 Автоподсчет активирован (проверка каждые 5 минут)\n`);

// ===== ЗАПУСК СЕРВЕРА =====
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `\n🎯 1xBetLineBoom сервер запущен на http://0.0.0.0:${PORT}\n`
  );

  // Первая проверка автоподсчёта через 30 секунд после старта
  setTimeout(() => {
    console.log(`\n🤖 Запуск первой проверки автоподсчета...\n`);
    checkAndAutoCount();
  }, 30000);
});
