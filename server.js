import express from "express";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  startBot,
  notifyIllegalBet,
  getNotificationQueue,
  flushQueueNow,
  writeNotificationQueue,
} from "./OnexBetLineBoombot.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 1984;
const FD_API_TOKEN = process.env.FD_API_TOKEN;
const FD_API_BASE = "https://api.football-data.org/v4";

// Путь к файлу логов
const LOG_FILE_PATH = path.join(__dirname, "log.html");
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

// Функция отправки уведомления о ставке админу в Telegram
async function notifyBetAction(action, data) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
    return;
  }

  try {
    const time = new Date().toLocaleString("ru-RU");
    let emoji = action === "placed" ? "✅" : "❌";
    let actionText = action === "placed" ? "СТАВКА СДЕЛАНА" : "СТАВКА УДАЛЕНА";

    // Преобразуем draw -> Ничья для сообщений
    const predictionText =
      data.prediction === "draw" ? "Ничья" : data.prediction;
    const message = `${emoji} ${actionText}

👤 Пользователь: ${data.username}
🎯 Ставка: ${predictionText}
⚽ Матч: ${data.team1} vs ${data.team2}
🏆 Турнир: ${data.eventName || "Неизвестный"}
🕐 Время: ${time}`;

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
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления в Telegram:", error);
  }
}

// Функция записи лога в HTML файл
function writeBetLog(action, data) {
  try {
    // Отправляем уведомление в Telegram только для ставок (не для настроек)
    if (action === "placed" || action === "deleted") {
      notifyBetAction(action, data);
    }

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

    let logEntry = "";
    if (action === "placed") {
      // Преобразуем draw -> Ничья для логов
      const predictionText =
        data.prediction === "draw" ? "Ничья" : data.prediction;
      logEntry = `
    <div class="log-entry bet-placed">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action placed">✅ СТАВКА СДЕЛАНА</div>
      <div class="log-details">
        <span class="user">👤 ${data.username}</span>
        <span class="prediction">🎯 ${predictionText}</span>
        <span class="match">⚽ ${data.team1} vs ${data.team2}</span>
        <span class="event">🏆 ${data.eventName || "Неизвестный турнир"}</span>
      </div>
    </div>`;
    } else if (action === "deleted") {
      // Преобразуем draw -> Ничья для логов
      const predictionText =
        data.prediction === "draw" ? "Ничья" : data.prediction;
      logEntry = `
    <div class="log-entry bet-deleted">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action deleted">❌ СТАВКА УДАЛЕНА</div>
      <div class="log-details">
        <span class="user">👤 ${data.username}</span>
        <span class="prediction">🎯 ${predictionText}</span>
        <span class="match">⚽ ${data.team1} vs ${data.team2}</span>
        <span class="event">🏆 ${data.eventName || "Неизвестный турнир"}</span>
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

// Middleware
app.use(express.json());
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

// Таблица настроек сайта
db.exec(`
  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

// 1. Получить все турниры
app.get("/api/events", (req, res) => {
  try {
    const events = db
      .prepare("SELECT * FROM events WHERE status = 'active'")
      .all();
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Получить матчи по событию
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

// 3. Получить или создать пользователя
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

// 4. Создать ставку
app.post("/api/bets", async (req, res) => {
  try {
    const { user_id, match_id, prediction, amount } = req.body;

    // Получаем информацию о пользователе и матче
    const user = db
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(user_id);

    // Проверяем матч и его дату
    const match = db
      .prepare(
        "SELECT m.status, m.match_date, m.winner, m.team1_name, m.team2_name, m.event_id, e.name as event_name FROM matches m LEFT JOIN events e ON m.event_id = e.id WHERE m.id = ?"
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
      INSERT INTO bets (user_id, match_id, prediction, amount)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(user_id, match_id, prediction, amount);

    // Записываем лог ставки
    writeBetLog("placed", {
      username: user?.username || "неизвестный",
      prediction: prediction,
      team1: match.team1_name,
      team2: match.team2_name,
      eventName: match.event_name,
    });

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

// 5. Получить ставки пользователя
app.get("/api/user/:userId/bets", (req, res) => {
  try {
    const { userId } = req.params;
    const bets = db
      .prepare(
        `
      SELECT b.*, m.team1_name, m.team2_name, m.winner, m.status as match_status, m.round, e.name as event_name
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

// DELETE /api/bets/:betId - Удалить ставку пользователя
app.delete("/api/bets/:betId", (req, res) => {
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
        "SELECT m.team1_name, m.team2_name, m.status, e.name as event_name FROM matches m LEFT JOIN events e ON m.event_id = e.id WHERE m.id = ?"
      )
      .get(bet.match_id);
    const betUser = db
      .prepare("SELECT username FROM users WHERE id = ?")
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

    // Записываем лог удаления ставки
    writeBetLog("deleted", {
      username: betUser?.username || "неизвестный",
      prediction: bet.prediction,
      team1: match?.team1_name || "?",
      team2: match?.team2_name || "?",
      eventName: match?.event_name,
    });

    res.json({ message: "Ставка удалена" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Получить всех участников с количеством ставок
app.get("/api/participants", (req, res) => {
  try {
    const participants = db
      .prepare(
        `
      SELECT 
        u.id,
        u.username,
        COUNT(b.id) as total_bets,
        SUM(CASE 
          WHEN m.winner IS NOT NULL THEN 
            CASE 
              WHEN (b.prediction = m.team1_name AND m.winner = 'team1') OR
                   (b.prediction = m.team2_name AND m.winner = 'team2') OR
                   (b.prediction = 'draw' AND m.winner = 'draw') THEN 1 
              ELSE 0 
            END 
          ELSE 0 
        END) as won_bets,
        SUM(CASE 
          WHEN m.winner IS NOT NULL THEN 
            CASE 
              WHEN NOT ((b.prediction = m.team1_name AND m.winner = 'team1') OR
                        (b.prediction = m.team2_name AND m.winner = 'team2') OR
                        (b.prediction = 'draw' AND m.winner = 'draw')) THEN 1 
              ELSE 0 
            END 
          ELSE 0 
        END) as lost_bets,
        SUM(CASE WHEN m.winner IS NULL THEN 1 ELSE 0 END) as pending_bets
      FROM users u
      LEFT JOIN bets b ON u.id = b.user_id
      LEFT JOIN matches m ON b.match_id = m.id
      GROUP BY u.id, u.username
      ORDER BY COUNT(b.id) DESC
    `
      )
      .all();

    res.json(participants);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Получить профиль пользователя
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
        COUNT(id) as total_bets,
        SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won_bets,
        SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost_bets,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_bets
      FROM bets
      WHERE user_id = ?
    `
      )
      .get(userId);

    const profile = {
      id: user.id,
      username: user.username,
      email: user.email,
      created_at: user.created_at,
      total_bets: bets.total_bets || 0,
      won_bets: bets.won_bets || 0,
      lost_bets: bets.lost_bets || 0,
      pending_bets: bets.pending_bets || 0,
    };

    res.json(profile);
  } catch (error) {
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
          const personalMessage = `🎉 <b>Добро пожаловать в 1xBetLineBoom!</b>

✅ Твой Telegram успешно привязан к аккаунту <b>${user.username}</b>

📊 Теперь ты будешь получать:
• Уведомления о результатах матчей
• Напоминания о предстоящих играх
• Результаты твоих ставок

Удачных ставок, малютка! 🍀`;

          try {
            await fetch(
              `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: telegramUser.chat_id,
                  text: personalMessage,
                  parse_mode: "HTML",
                }),
              }
            );
            console.log(`✅ Личное сообщение отправлено @${telegram_username}`);
          } catch (err) {
            console.error("❌ Ошибка отправки личного сообщения:", err);
          }
        } else {
          console.log(
            `⚠️ Пользователь @${telegram_username} не писал боту, личное сообщение не отправлено`
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
        const message = `📱 TELEGRAM USERNAME

👤 Пользователь: ${user.username}
✏️ Действие: удалил свой ТГ
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

// 8. Добавить демо-данные (если база пустая)
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
  const { username, name, description, start_date, end_date } = req.body;
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
      INSERT INTO events (name, description, start_date, end_date)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(name, description || null, start_date || null, end_date || null);

    res.json({
      id: result.lastInsertRowid,
      name,
      description,
      start_date,
      end_date,
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

// POST /api/admin/matches - Создать новый матч (только для админа)
app.post("/api/admin/matches", (req, res) => {
  const { username, event_id, team1, team2, match_date, round } = req.body;
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

  try {
    const result = db
      .prepare(
        `
      INSERT INTO matches (event_id, team1_name, team2_name, match_date, round)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(event_id, team1, team2, match_date || null, round || null);

    res.json({
      id: result.lastInsertRowid,
      event_id,
      team1_name: team1,
      team2_name: team2,
      match_date: match_date || null,
      round: round || null,
      message: "Матч успешно создан",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
      round !== undefined
    ) {
      // Получаем текущие значения матча
      const currentMatch = db
        .prepare(
          "SELECT team1_name, team2_name, match_date, round FROM matches WHERE id = ?"
        )
        .get(matchId);

      if (!currentMatch) {
        return res.status(404).json({ error: "Матч не найден" });
      }

      db.prepare(
        "UPDATE matches SET team1_name = ?, team2_name = ?, match_date = ?, round = ? WHERE id = ?"
      ).run(
        team1_name || currentMatch.team1_name,
        team2_name || currentMatch.team2_name,
        match_date !== undefined ? match_date : currentMatch.match_date,
        round !== undefined ? round : currentMatch.round,
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
    console.error("❌ Ошибка на сервере:", error);
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
    // Удаляем связанные ставки
    db.prepare(
      "DELETE FROM bets WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)"
    ).run(eventId);

    // Удаляем связанные матчи
    db.prepare("DELETE FROM matches WHERE event_id = ?").run(eventId);

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
    const result = db
      .prepare("UPDATE events SET locked_reason = ? WHERE id = ?")
      .run(reason.trim(), eventId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Событие не найдено" });
    }

    res.json({
      message: "Турнир заблокирован",
      eventId,
      reason: reason.trim(),
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
    // Удаляем все ставки пользователя
    db.prepare("DELETE FROM bets WHERE user_id = ?").run(userId);

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
    // Сначала удаляем все ставки, связанные с матчем
    db.prepare("DELETE FROM bets WHERE match_id = ?").run(matchId);

    // Затем удаляем сам матч
    db.prepare("DELETE FROM matches WHERE id = ?").run(matchId);

    res.json({ success: true, message: "Матч успешно удален" });
  } catch (error) {
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

// Запуск Telegram бота
startBot();

// Запуск сервера
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `\n🎯 1xBetLineBoom сервер запущен на http://0.0.0.0:${PORT} (доступен на http://144.124.237.222:${PORT})\n`
  );
});
