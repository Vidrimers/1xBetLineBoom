import express from "express";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { startBot, notifyIllegalBet } from "./OnexBetLineBoombot.js";

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

// ===== API ENDPOINTS =====

// 0. Получить конфигурацию (включая ADMIN_USER)
app.get("/api/config", (req, res) => {
  const ADMIN_USER = process.env.ADMIN_USER_ID;
  res.json({
    ADMIN_USER: ADMIN_USER || null,
  });
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
        "SELECT status, match_date, winner, team1_name, team2_name FROM matches WHERE id = ?"
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

// DELETE /api/bets/:betId - Удалить ставку пользователя
app.delete("/api/bets/:betId", (req, res) => {
  try {
    const { betId } = req.params;
    const { user_id } = req.body;

    // Проверяем, что ставка принадлежит пользователю
    const bet = db
      .prepare("SELECT * FROM bets WHERE id = ? AND user_id = ?")
      .get(betId, user_id);

    if (!bet) {
      return res.status(403).json({ error: "Эта ставка не принадлежит вам" });
    }

    db.prepare("DELETE FROM bets WHERE id = ?").run(betId);

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
  const ADMIN_USER = process.env.ADMIN_USER_ID;

  // Проверяем, является ли пользователь админом
  if (username !== ADMIN_USER) {
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
  const { username, event_id, team1, team2, match_date } = req.body;
  const ADMIN_USER = process.env.ADMIN_USER_ID;

  // Проверяем, является ли пользователь админом
  if (username !== ADMIN_USER) {
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
      INSERT INTO matches (event_id, team1_name, team2_name, match_date)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(event_id, team1, team2, match_date || null);

    res.json({
      id: result.lastInsertRowid,
      event_id,
      team1_name: team1,
      team2_name: team2,
      match_date: match_date || null,
      message: "Матч успешно создан",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/matches/:matchId - Изменить статус или отредактировать матч (только для админа)
app.put("/api/admin/matches/:matchId", (req, res) => {
  const { matchId } = req.params;
  const { username, status, team1_name, team2_name, match_date } = req.body;
  const ADMIN_USER = process.env.ADMIN_USER_ID;

  // Проверяем, является ли пользователь админом
  if (username !== ADMIN_USER) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    // Если приходит статус - обновляем только статус
    if (status) {
      const validStatuses = ["pending", "ongoing", "finished"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error:
            "Неверный статус. Допустимые значения: pending, ongoing, finished",
        });
      }

      db.prepare("UPDATE matches SET status = ? WHERE id = ?").run(
        status,
        matchId
      );

      return res.json({
        message: "Статус матча успешно изменен",
        matchId,
        status,
      });
    }

    // Если приходят названия команд и/или дата - обновляем их
    if (team1_name || team2_name || match_date !== undefined) {
      // Получаем текущие значения матча
      const currentMatch = db
        .prepare(
          "SELECT team1_name, team2_name, match_date FROM matches WHERE id = ?"
        )
        .get(matchId);

      if (!currentMatch) {
        return res.status(404).json({ error: "Матч не найден" });
      }

      db.prepare(
        "UPDATE matches SET team1_name = ?, team2_name = ?, match_date = ? WHERE id = ?"
      ).run(
        team1_name || currentMatch.team1_name,
        team2_name || currentMatch.team2_name,
        match_date || currentMatch.match_date,
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
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/events/:eventId - Удалить событие (только для админа)
app.delete("/api/admin/events/:eventId", (req, res) => {
  const { eventId } = req.params;
  const username = req.body.username;
  const ADMIN_USER = process.env.ADMIN_USER_ID;

  // Проверяем, является ли пользователь админом
  if (username !== ADMIN_USER) {
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
  const ADMIN_USER = process.env.ADMIN_USER_ID;

  // Проверяем, является ли пользователь админом
  if (username !== ADMIN_USER) {
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
  const ADMIN_USER = process.env.ADMIN_USER_ID;

  // Проверяем, является ли пользователь админом
  if (username !== ADMIN_USER) {
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
  const ADMIN_USER = process.env.ADMIN_USER_ID;

  // Проверяем, является ли пользователем админом
  if (username !== ADMIN_USER) {
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
  const ADMIN_USER = process.env.ADMIN_USER_ID;
  const username = req.query.username;

  // Проверяем, является ли пользователь админом
  if (username !== ADMIN_USER) {
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
  const ADMIN_USER = process.env.ADMIN_USER_ID;

  // Проверяем, является ли пользователь админом
  if (adminUsername !== ADMIN_USER) {
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
  const ADMIN_USER = process.env.ADMIN_USER_ID;

  // Проверяем, является ли пользователь админом
  if (adminUsername !== ADMIN_USER) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  // Не даем удалить самого админа
  const userToDelete = db
    .prepare("SELECT username FROM users WHERE id = ?")
    .get(userId);
  if (userToDelete && userToDelete.username === ADMIN_USER) {
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
  const ADMIN_USER = process.env.ADMIN_USER_ID;

  if (username !== ADMIN_USER) {
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

// Запуск Telegram бота
startBot();

// Запуск сервера
app.listen(PORT, () => {
  console.log(
    `\n🎯 1xBetLineBoom сервер запущен на http://localhost:${PORT}\n`
  );
});
