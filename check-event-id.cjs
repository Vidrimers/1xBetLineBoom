const Database = require('better-sqlite3');

const db = new Database('1xBetLineBoom.db');

const events = db.prepare(`
  SELECT id, name, status, start_date, end_date
  FROM events 
  ORDER BY id DESC
`).all();

console.log('📋 Все турниры в базе данных');
console.log(`Всего: ${events.length} турниров`);
console.log('');

events.forEach((event, index) => {
  const startDate = event.start_date ? new Date(event.start_date).toLocaleDateString('ru-RU') : 'не указана';
  const endDate = event.end_date ? new Date(event.end_date).toLocaleDateString('ru-RU') : 'не указана';
  const statusIcon = event.status === 'active' ? '✅' : '🏁';
  
  console.log(`${index + 1}. ${event.name}`);
  console.log(`   ID: ${event.id} | Статус: ${statusIcon} ${event.status}`);
  console.log(`   Даты: ${startDate} - ${endDate}`);
  console.log('');
});

db.close();
