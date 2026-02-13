const Database = require("better-sqlite3");
const db = new Database("1xBetLineBoom.db");

console.log("🔧 Создание таблицы glicko_cache для кэширования данных xG...");

try {
  // Создаем таблицу для кэширования данных Glicko-2
  db.prepare(`
    CREATE TABLE IF NOT EXISTS glicko_cache (
      match_id INTEGER PRIMARY KEY,
      sstats_match_id INTEGER NOT NULL,
      home_rating REAL,
      away_rating REAL,
      home_xg REAL,
      away_xg REAL,
      home_win_probability REAL,
      away_win_probability REAL,
      cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
    )
  `).run();
  
  console.log("✅ Таблица glicko_cache создана");
  
  // Создаем индекс для быстрого поиска
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_glicko_cache_match_id 
    ON glicko_cache(match_id)
  `).run();
  
  console.log("✅ Индекс создан");
  
  // Показываем структуру таблицы
  console.log("\n📊 Структура таблицы glicko_cache:");
  const columns = db.prepare("PRAGMA table_info(glicko_cache)").all();
  columns.forEach(col => {
    console.log(`  ${col.name}: ${col.type}${col.notnull ? ' NOT NULL' : ''}${col.dflt_value ? ` DEFAULT ${col.dflt_value}` : ''}`);
  });
  
  console.log("\n✅ Миграция завершена успешно!");
  
} catch (error) {
  console.error("❌ Ошибка при миграции:", error.message);
  process.exit(1);
} finally {
  db.close();
}
