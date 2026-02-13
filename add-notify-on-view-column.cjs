const Database = require("better-sqlite3");
const db = new Database("1xBetLineBoom.db");

console.log("🔧 Добавление колонки notify_on_view в таблицу users...");

try {
  // Проверяем существует ли уже колонка
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const hasColumn = columns.some(col => col.name === 'notify_on_view');
  
  if (!hasColumn) {
    console.log("➕ Добавляем колонку notify_on_view...");
    db.prepare("ALTER TABLE users ADD COLUMN notify_on_view INTEGER DEFAULT 1").run();
    console.log("✅ Колонка notify_on_view добавлена (по умолчанию: включено)");
  } else {
    console.log("✅ Колонка notify_on_view уже существует");
  }
  
  // Показываем несколько пользователей для проверки
  console.log("\n📊 Примеры пользователей:");
  const users = db.prepare("SELECT id, username, notify_on_view FROM users LIMIT 3").all();
  users.forEach(user => {
    console.log(`  ${user.id}: ${user.username} -> notify_on_view: ${user.notify_on_view}`);
  });
  
  console.log("\n✅ Миграция завершена успешно!");
  
} catch (error) {
  console.error("❌ Ошибка при миграции:", error.message);
  process.exit(1);
} finally {
  db.close();
}
