const Database = require('better-sqlite3');

const db = new Database('1xBetLineBoom.db');

// Деактивируем старые турниры
const oldEventIds = [19, 21]; // ID старых турниров

console.log('\n🔄 Деактивация старых турниров...');

oldEventIds.forEach(eventId => {
  const event = db.prepare('SELECT id, name FROM events WHERE id = ?').get(eventId);
  
  if (event) {
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run('completed', eventId);
    console.log(`✅ Деактивирован: ID ${eventId} - ${event.name}`);
  } else {
    console.log(`⚠️ Турнир с ID ${eventId} не найден`);
  }
});

console.log('\n📋 Активные турниры после обновления:');
const activeEvents = db.prepare(`
  SELECT id, name, status 
  FROM events 
  WHERE status = 'active'
  ORDER BY id DESC
`).all();

activeEvents.forEach(event => {
  console.log(`  ID: ${event.id} | Название: ${event.name}`);
});

db.close();
console.log('\n✅ Готово!');
