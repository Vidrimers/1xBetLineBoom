import Database from "better-sqlite3";

const db = new Database("./1xBetLineBoom.db");

try {
  // Создаем таблицу sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_token TEXT NOT NULL UNIQUE,
      device_info TEXT,
      browser TEXT,
      os TEXT,
      ip_address TEXT,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  console.log("✅ Таблица sessions успешно создана");
} catch (error) {
  console.error("❌ Ошибка при создании таблицы:", error);
} finally {
  db.close();
}
