import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "../../1xBetLineBoom.db");

const db = new Database(dbPath);

console.log("🧹 Очистка удалённых данных из БД...\n");

// 1. Удаляем напоминания на удалённые матчи
console.log("🗑️  Удаляем напоминания на удалённые матчи...");
const deletedReminders = db
  .prepare(
    `DELETE FROM sent_reminders 
     WHERE match_id NOT IN (SELECT id FROM matches)`
  )
  .run();
console.log(`   ✅ Удалено ${deletedReminders.changes} записей из sent_reminders\n`);

// 2. Удаляем ставки на удалённые матчи
console.log("🗑️  Удаляем ставки на удалённые матчи...");
const deletedBets = db
  .prepare(
    `DELETE FROM bets 
     WHERE match_id NOT IN (SELECT id FROM matches)`
  )
  .run();
console.log(`   ✅ Удалено ${deletedBets.changes} записей из bets\n`);

// 3. Удаляем матчи без события
console.log("🗑️  Удаляем матчи без события...");
const deletedMatches = db
  .prepare(
    `DELETE FROM matches 
     WHERE event_id NOT IN (SELECT id FROM events)`
  )
  .run();
console.log(`   ✅ Удалено ${deletedMatches.changes} записей из matches\n`);

// 4. Удаляем финальные ставки на удалённые матчи
console.log("🗑️  Удаляем финальные ставки на удалённые матчи...");
try {
  const deletedFinalBets = db
    .prepare(
      `DELETE FROM final_bets 
       WHERE match_id NOT IN (SELECT id FROM matches)`
    )
    .run();
  console.log(
    `   ✅ Удалено ${deletedFinalBets.changes} записей из final_bets\n`
  );
} catch (e) {
  console.log(`   ⚠️  Таблица final_bets не существует (это нормально)\n`);
}

// 5. Удаляем параметры финала на удалённые матчи
console.log("🗑️  Удаляем параметры финала на удалённые матчи...");
try {
  const deletedParameters = db
    .prepare(
      `DELETE FROM final_parameters_results 
       WHERE match_id NOT IN (SELECT id FROM matches)`
    )
    .run();
  console.log(
    `   ✅ Удалено ${deletedParameters.changes} записей из final_parameters_results\n`
  );
} catch (e) {
  console.log(
    `   ⚠️  Таблица final_parameters_results не существует (это нормально)\n`
  );
}

// 6. Статистика после очистки
console.log("=".repeat(60));
console.log("📊 СТАТИСТИКА ПОСЛЕ ОЧИСТКИ");
console.log("=".repeat(60));
const stats = db
  .prepare(
    `SELECT 
     (SELECT COUNT(*) FROM events) as events_count,
     (SELECT COUNT(*) FROM matches) as matches_count,
     (SELECT COUNT(*) FROM bets) as bets_count,
     (SELECT COUNT(*) FROM sent_reminders) as reminders_count`
  )
  .get();

console.log(`📋 Осталось в БД:`);
console.log(`  • Турниры (events): ${stats.events_count}`);
console.log(`  • Матчи (matches): ${stats.matches_count}`);
console.log(`  • Ставки (bets): ${stats.bets_count}`);
console.log(`  • Напоминания (sent_reminders): ${stats.reminders_count}\n`);

const totalDeleted =
  deletedReminders.changes +
  deletedBets.changes +
  deletedMatches.changes;
console.log("=".repeat(60));
console.log(`✅ ОЧИСТКА ЗАВЕРШЕНА! Удалено ${totalDeleted} записей.\n`);

db.close();
