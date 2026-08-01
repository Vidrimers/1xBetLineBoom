import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// ===== КОНФИГ (dotenv загружается внутри config.js) =====
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
  checkAndNotifyTournamentStart,
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

// ===== MIDDLEWARE: авторизация =====
import { requireAuth } from "./middleware/auth.js";

// Публичные пути (без авторизации)
// ВАЖНО: req.path здесь — БЕЗ префикса /api (т.к. middleware смонтирован на /api)
const PUBLIC_PATHS_EXACT = [
  '/user',                              // POST: логин/регистрация
  '/sessions',                          // POST: создание сессии (логин)
  '/notify-admin-login-attempt',        // Уведомление о попытке входа
  '/events',                            // GET: список турниров
  '/participants',                      // GET: участники
  '/config',                            // GET: конфиг приложения
  '/xg-button-visibility',              // GET: видимость кнопки xG
];

const PUBLIC_PATHS_PREFIX = [
  '/sessions/',                         // GET: валидация сессии
  '/user/login/',                       // 2FA эндпоинты
  '/telegram-auth/',                    // Telegram авторизация
  '/events/',                           // GET: матчи турниров, статистика
  '/match-bet-stats/',                  // GET: статистика ставок по матчу
];

function isPublicPath(path) {
  return PUBLIC_PATHS_EXACT.includes(path) ||
         PUBLIC_PATHS_PREFIX.some(p => path.startsWith(p));
}

// Применяем auth ко всем /api/* кроме публичных
app.use('/api', (req, res, next) => {
  if (isPublicPath(req.path)) {
    return next();
  }
  requireAuth(req, res, next);
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

// ===== СТРАНИЦА ОЧЕРЕДИ УВЕДОМЛЕНИЙ =====
app.get("/admin/notifications", (req, res) => {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Notification Queue - Admin</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;margin:20px;background:#1a1a2e;color:#e0e6f0}
      .controls{margin-bottom:10px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #3a7bd5;padding:8px;text-align:left}
      th{background:#2a3a4a}
      pre{white-space:pre-wrap;word-break:break-word}
      .small{font-size:0.9em;color:#b0b8c8}
      button{margin-right:8px;padding:6px 14px;background:#3a7bd5;color:#fff;border:none;border-radius:4px;cursor:pointer}
      input{padding:6px;background:#2a3a4a;color:#e0e6f0;border:1px solid #3a7bd5;border-radius:4px}
    </style>
  </head>
  <body>
    <h2>📬 Очередь уведомлений</h2>
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
      document.getElementById('saveToken').addEventListener('click', () => {
        localStorage.setItem('admin_token', tokenInput.value.trim());
        setStatus('Saved token');
      });
      document.getElementById('refresh').addEventListener('click', () => fetchQueue());
      document.getElementById('resendAll').addEventListener('click', () => flushQueue());
      document.getElementById('clearAll').addEventListener('click', () => clearQueue());
      function setStatus(txt) { document.getElementById('status').textContent = txt; }
      async function fetchQueue() {
        const t = (tokenInput.value || localStorage.getItem('admin_token') || '').trim();
        if (!t) return setStatus('Provide admin token then Save');
        setStatus('Loading...');
        try {
          const r = await fetch('/admin/notifications/queue?admin=' + encodeURIComponent(t));
          const json = await r.json();
          if (!json.ok) { setStatus('Error: ' + (json.error || 'unknown')); return; }
          renderQueue(json.queue || []);
          setStatus('Loaded ' + (json.queue ? json.queue.length : 0) + ' items');
        } catch(e) { setStatus('Fetch error: ' + e.message); }
      }
      function renderQueue(queue) {
        const c = document.getElementById('queueContainer');
        if (!queue.length) { c.innerHTML = '<p class="small">Queue is empty</p>'; return; }
        const rows = queue.map(q => '<tr><td>' + q.id + '</td><td>' + q.timestamp + '</td><td>' + (q.attempts||0) + '</td><td>' + new Date(q.nextAttemptAt).toLocaleString() + '</td><td><pre>' + ((q.payload && (q.payload.message || JSON.stringify(q.payload))) || '') + '</pre></td></tr>').join('');
        c.innerHTML = '<table><thead><tr><th>id</th><th>timestamp</th><th>attempts</th><th>nextAttemptAt</th><th>payload</th></tr></thead><tbody>' + rows + '</tbody></table>';
      }
      async function flushQueue() {
        const t = (tokenInput.value || localStorage.getItem('admin_token') || '').trim();
        if (!t) return setStatus('Provide admin token');
        setStatus('Flushing...');
        try {
          const r = await fetch('/admin/notifications/queue/flush?admin=' + encodeURIComponent(t), { method: 'POST' });
          const j = await r.json();
          if (!j.ok) return setStatus('Error: ' + (j.error || 'unknown'));
          setStatus('Flush result: sent=' + j.result.sent + ' / total=' + j.result.total);
          fetchQueue();
        } catch(e) { setStatus('Flush error: ' + e.message); }
      }
      async function clearQueue() {
        const t = (tokenInput.value || localStorage.getItem('admin_token') || '').trim();
        if (!t) return setStatus('Provide admin token');
        if (!confirm('Clear all queued notifications?')) return;
        setStatus('Clearing...');
        try {
          const r = await fetch('/admin/notifications/queue/clear?admin=' + encodeURIComponent(t), { method: 'POST' });
          const j = await r.json();
          if (!j.ok) return setStatus('Error: ' + (j.error || 'unknown'));
          setStatus('Queue cleared');
          fetchQueue();
        } catch(e) { setStatus('Clear error: ' + e.message); }
      }
      fetchQueue();
    </script>
  </body>
</html>`;
  res.type("html").send(html);
});

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

// Проверка старта турниров (каждые 30 минут) + сразу при старте
setInterval(checkAndNotifyTournamentStart, 30 * 60 * 1000);
checkAndNotifyTournamentStart();
console.log(
  "🚀 Фоновая задача уведомления о старте турниров запущена (интервал: 30 минут)"
);

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
