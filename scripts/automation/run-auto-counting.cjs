const Database = require('better-sqlite3');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const dbPath = path.join(__dirname, '../../1xBetLineBoom.db');
const db = new Database(dbPath);

console.log('\n🤖 Запуск автоподсчета вручную...\n');

// Получаем все активные турниры
const activeEvents = db.prepare(`
  SELECT id, name FROM events WHERE status = 'active' ORDER BY id DESC
`).all();

if (activeEvents.length === 0) {
  console.log('❌ Нет активных турниров');
  db.close();
  process.exit(0);
}

console.log('📋 Активные турниры:');
activeEvents.forEach(event => {
  console.log(`  ${event.id}. ${event.name}`);
});

// Ищем завершенные даты
const completedDates = [];

activeEvents.forEach(event => {
  const matches = db.prepare(`
    SELECT 
      DATE(match_date) as date,
      round,
      COUNT(*) as total,
      SUM(CASE WHEN winner IS NOT NULL THEN 1 ELSE 0 END) as finished
    FROM matches
    WHERE event_id = ? AND match_date IS NOT NULL
    GROUP BY DATE(match_date), round
    HAVING total = finished
    ORDER BY date DESC
  `).all(event.id);
  
  matches.forEach(m => {
    completedDates.push({
      eventId: event.id,
      eventName: event.name,
      date: m.date,
      round: m.round,
      total: m.total
    });
  });
});

if (completedDates.length === 0) {
  console.log('\n✅ Нет полностью завершенных дат для автоподсчета');
  db.close();
  process.exit(0);
}

console.log(`\n📊 Найдено завершенных дат: ${completedDates.length}\n`);
completedDates.forEach((d, i) => {
  console.log(`${i + 1}. ${d.eventName} | ${d.date} | ${d.round} (${d.total} матчей)`);
});

console.log('\n💡 Для запуска автоподсчета используйте API endpoint:');
console.log('   POST /api/admin/trigger-auto-counting');
console.log('   Body: { "eventId": <id>, "date": "<date>", "round": "<round>" }');
console.log('\nИли включите автоподсчет в настройках (кнопка "A")');

db.close();
