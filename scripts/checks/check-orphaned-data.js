import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "../../1xBetLineBoom.db");

const db = new Database(dbPath);

console.log("🔍 Проверка удалённых данных в БД...\n");

// 1. Матчи без события
console.log("=".repeat(60));
console.log("1️⃣  МАТЧИ БЕЗ СОБЫТИЯ (orphaned matches)");
console.log("=".repeat(60));
const orphanedMatches = db
  .prepare(
    `SELECT m.id, m.team1_name, m.team2_name, m.match_date, m.event_id
     FROM matches m
     LEFT JOIN events e ON m.event_id = e.id
     WHERE e.id IS NULL`
  )
  .all();

if (orphanedMatches.length > 0) {
  console.log(`❌ Найдено ${orphanedMatches.length} матчей без события:\n`);
  orphanedMatches.forEach((match) => {
    console.log(
      `  • ID: ${match.id} | ${match.team1_name} vs ${match.team2_name} | Дата: ${match.match_date} | event_id: ${match.event_id}`
    );
  });
} else {
  console.log("✅ Все матчи привязаны к существующим событиям\n");
}

// 2. Ставки на удалённые матчи
console.log("=".repeat(60));
console.log("2️⃣  СТАВКИ НА УДАЛЁННЫЕ МАТЧИ (orphaned bets)");
console.log("=".repeat(60));
const orphanedBets = db
  .prepare(
    `SELECT b.id, b.user_id, b.match_id, b.prediction, b.created_at
     FROM bets b
     LEFT JOIN matches m ON b.match_id = m.id
     WHERE m.id IS NULL`
  )
  .all();

if (orphanedBets.length > 0) {
  console.log(`❌ Найдено ${orphanedBets.length} ставок на удалённые матчи:\n`);
  orphanedBets.forEach((bet) => {
    console.log(
      `  • ID: ${bet.id} | Пользователь: ${bet.user_id} | match_id: ${bet.match_id} | Прогноз: ${bet.prediction} | Дата: ${bet.created_at}`
    );
  });
} else {
  console.log("✅ Все ставки привязаны к существующим матчам\n");
}

// 3. Напоминания на удалённые матчи
console.log("=".repeat(60));
console.log("3️⃣  НАПОМИНАНИЯ НА УДАЛЁННЫЕ МАТЧИ (orphaned reminders)");
console.log("=".repeat(60));
const orphanedReminders = db
  .prepare(
    `SELECT sr.id, sr.match_id, sr.sent_at
     FROM sent_reminders sr
     LEFT JOIN matches m ON sr.match_id = m.id
     WHERE m.id IS NULL`
  )
  .all();

if (orphanedReminders.length > 0) {
  console.log(
    `❌ Найдено ${orphanedReminders.length} напоминаний на удалённые матчи:\n`
  );
  orphanedReminders.forEach((reminder) => {
    console.log(
      `  • ID: ${reminder.id} | match_id: ${reminder.match_id} | Дата: ${reminder.sent_at}`
    );
  });
} else {
  console.log("✅ Все напоминания привязаны к существующим матчам\n");
}

// 4. Статистика БД
console.log("=".repeat(60));
console.log("4️⃣  СТАТИСТИКА БД");
console.log("=".repeat(60));
const stats = db
  .prepare(
    `SELECT 
     (SELECT COUNT(*) FROM events) as events_count,
     (SELECT COUNT(*) FROM matches) as matches_count,
     (SELECT COUNT(*) FROM bets) as bets_count,
     (SELECT COUNT(*) FROM sent_reminders) as reminders_count,
     (SELECT COUNT(*) FROM users) as users_count`
  )
  .get();

console.log(`📊 Всего в БД:`);
console.log(`  • Турниры (events): ${stats.events_count}`);
console.log(`  • Матчи (matches): ${stats.matches_count}`);
console.log(`  • Ставки (bets): ${stats.bets_count}`);
console.log(`  • Напоминания (sent_reminders): ${stats.reminders_count}`);
console.log(`  • Пользователи (users): ${stats.users_count}\n`);

// 5. Итоговый отчёт
console.log("=".repeat(60));
console.log("📋 ИТОГОВЫЙ ОТЧЁТ");
console.log("=".repeat(60));
const totalOrphaned =
  orphanedMatches.length + orphanedBets.length + orphanedReminders.length;
if (totalOrphaned === 0) {
  console.log("✅ БД ЧИСТАЯ! Нет удалённых данных.");
} else {
  console.log(`⚠️  НАЙДЕНО ${totalOrphaned} ЗАПИСЕЙ УДАЛЁННЫХ ДАННЫХ!`);
  console.log(
    "\n💡 Чтобы очистить, используйте скрипт scripts/checks/cleanup-orphaned-data.js"
  );
}

db.close();
