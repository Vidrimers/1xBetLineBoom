import express from "express";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const FD_API_TOKEN = process.env.FD_API_TOKEN;
const FD_API_BASE = "https://api.football-data.org/v4";

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

// ===== API ENDPOINTS =====

// 1. Получить все события
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
app.post("/api/bets", (req, res) => {
  try {
    const { user_id, match_id, prediction, amount } = req.body;

    const result = db
      .prepare(
        `
      INSERT INTO bets (user_id, match_id, prediction, amount)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(user_id, match_id, prediction, amount);

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
      SELECT b.*, m.team1_name, m.team2_name, m.winner, e.name as event_name
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
        SUM(CASE WHEN b.status = 'won' THEN 1 ELSE 0 END) as won_bets,
        SUM(CASE WHEN b.status = 'lost' THEN 1 ELSE 0 END) as lost_bets,
        SUM(CASE WHEN b.status = 'pending' THEN 1 ELSE 0 END) as pending_bets
      FROM users u
      LEFT JOIN bets b ON u.id = b.user_id
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

// 8. Добавить демо-данные (если база пустая)
app.post("/api/seed-data", (req, res) => {
  try {
    // Проверяем, есть ли уже события
    const eventCount = db.prepare("SELECT COUNT(*) as count FROM events").get();

    if (eventCount.count === 0) {
      // Добавляем события
      const event1 = db
        .prepare("INSERT INTO events (name, description) VALUES (?, ?)")
        .run(
          "Лига чемпионов 2025-2026",
          "Чемпионская лига европейского футбола"
        );

      const event2 = db
        .prepare("INSERT INTO events (name, description) VALUES (?, ?)")
        .run("Чемпионат мира 2026", "Чемпионат мира по футболу");

      // Добавляем матчи для первого события
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

      // Добавляем матчи для второго события
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
          : "Draw";

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

// Запуск сервера
app.listen(PORT, () => {
  console.log(
    `\n🎯 1xBetLineBoom сервер запущен на http://localhost:${PORT}\n`
  );
});
