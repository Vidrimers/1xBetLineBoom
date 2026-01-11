import Database from "better-sqlite3";

const db = new Database("./1xBetLineBoom.db");

console.log("🕐 Начинаем миграцию дат матчей в UTC...");

// Получаем все матчи с датами
const matches = db
  .prepare("SELECT id, team1_name, team2_name, match_date FROM matches WHERE match_date IS NOT NULL")
  .all();

console.log(`📊 Найдено матчей с датами: ${matches.length}`);

if (matches.length === 0) {
  console.log("✅ Нет матчей для миграции");
  process.exit(0);
}

// Часовой пояс админа (GMT+3 = Europe/Moscow)
const ADMIN_TIMEZONE_OFFSET = 3; // часов от UTC

let updated = 0;
let skipped = 0;

matches.forEach((match) => {
  try {
    const currentDate = new Date(match.match_date);
    
    // Проверяем что дата валидная
    if (isNaN(currentDate.getTime())) {
      console.log(`⚠️  Пропускаем матч ${match.id}: невалидная дата ${match.match_date}`);
      skipped++;
      return;
    }

    // Предполагаем что текущая дата в БД - это локальное время GMT+3
    // Нужно вычесть 3 часа чтобы получить UTC
    const utcDate = new Date(currentDate.getTime() - (ADMIN_TIMEZONE_OFFSET * 60 * 60 * 1000));
    const utcString = utcDate.toISOString();

    console.log(`🔄 Матч ${match.id}: ${match.team1_name} vs ${match.team2_name}`);
    console.log(`   Было: ${match.match_date}`);
    console.log(`   Стало: ${utcString}`);

    // Обновляем в БД
    db.prepare("UPDATE matches SET match_date = ? WHERE id = ?").run(utcString, match.id);
    updated++;
  } catch (error) {
    console.error(`❌ Ошибка при обработке матча ${match.id}:`, error.message);
    skipped++;
  }
});

console.log("\n✅ Миграция завершена!");
console.log(`   Обновлено: ${updated}`);
console.log(`   Пропущено: ${skipped}`);
console.log("\n⚠️  ВАЖНО: Проверьте что время отображается правильно!");
console.log("   Если нет - возможно нужно изменить ADMIN_TIMEZONE_OFFSET в скрипте");

db.close();
