const Database = require("better-sqlite3");
const db = new Database("1xBetLineBoom.db");

console.log("🔧 Добавление полей sstats_league_id и year в таблицу events...");

try {
  // Проверяем существуют ли уже колонки
  const columns = db.prepare("PRAGMA table_info(events)").all();
  const hasLeagueId = columns.some(col => col.name === 'sstats_league_id');
  const hasYear = columns.some(col => col.name === 'year');
  
  if (!hasLeagueId) {
    console.log("➕ Добавляем колонку sstats_league_id...");
    db.prepare("ALTER TABLE events ADD COLUMN sstats_league_id INTEGER").run();
  } else {
    console.log("✅ Колонка sstats_league_id уже существует");
  }
  
  if (!hasYear) {
    console.log("➕ Добавляем колонку year...");
    db.prepare("ALTER TABLE events ADD COLUMN year INTEGER").run();
  } else {
    console.log("✅ Колонка year уже существует");
  }
  
  // Заполняем значения для существующих турниров
  console.log("\n📝 Заполняем значения для существующих турниров...");
  
  // Лига чемпионов - LeagueId: 2 (UEFA Champions League)
  db.prepare("UPDATE events SET sstats_league_id = 2, year = 2023, team_file = 'names/LeagueOfChampionsTeams.json' WHERE name = 'Лига чемпионов 2023-2024'").run();
  db.prepare("UPDATE events SET sstats_league_id = 2, year = 2024, team_file = 'names/LeagueOfChampionsTeams.json' WHERE name = 'Лига чемпионов 2024-2025'").run();
  db.prepare("UPDATE events SET sstats_league_id = 2, year = 2025, team_file = 'names/LeagueOfChampionsTeams.json' WHERE name = 'Лига чемпионов 2025-2026'").run();
  
  // Российская Премьер Лига - LeagueId: 235
  db.prepare("UPDATE events SET sstats_league_id = 235, year = 2025 WHERE name = 'Российская Премьер Лига 2025-2026'").run();
  
  // Чемпионат Европы - LeagueId: 4 (UEFA European Championship)
  db.prepare("UPDATE events SET sstats_league_id = 4, year = 2024, team_file = 'names/Countries.json' WHERE name = 'Чемпионат Европы 2024'").run();
  
  // Чемпионат мира - LeagueId: 28 (FIFA World Cup)
  db.prepare("UPDATE events SET sstats_league_id = 28, year = 2026, team_file = 'names/Countries.json' WHERE name = 'Чемпионат мира 2026'").run();
  
  console.log("✅ Значения заполнены");
  
  // Показываем результат
  console.log("\n📊 Текущие значения:");
  const events = db.prepare("SELECT id, name, sstats_league_id, year, team_file FROM events").all();
  events.forEach(event => {
    console.log(`  ${event.id}: ${event.name} -> LeagueId: ${event.sstats_league_id}, Year: ${event.year}, TeamFile: ${event.team_file || 'не указан'}`);
  });
  
  console.log("\n✅ Миграция завершена успешно!");
  
} catch (error) {
  console.error("❌ Ошибка при миграции:", error.message);
  process.exit(1);
} finally {
  db.close();
}
