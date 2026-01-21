const Database = require('better-sqlite3');

const db = new Database('1xBetLineBoom.db');

const events = db.prepare(`
  SELECT id, name, status 
  FROM events 
  WHERE name LIKE '%Лига чемпионов%' OR name LIKE '%Champions%'
  ORDER BY id DESC
`).all();

console.log('\n📋 Найденные турниры:');
events.forEach(event => {
  console.log(`  ID: ${event.id} | Название: ${event.name} | Статус: ${event.status}`);
});

db.close();
