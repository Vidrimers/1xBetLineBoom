import Database from "better-sqlite3";

// Подключение к базе данных
let db = new Database("1xBetLineBoom.db");

// Используем DELETE режим для совместимости (не WAL)
db.pragma("journal_mode = DELETE");

// Отключаем FOREIGN KEY constraints для упрощения операций удаления
db.pragma("foreign_keys = OFF");

export { db };
