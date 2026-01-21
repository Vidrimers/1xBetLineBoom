const Database = require('better-sqlite3');

const db = new Database('1xBetLineBoom.db');

console.log('\n🔔 Включение уведомлений для всех пользователей с Telegram...\n');

// Получаем список пользователей с отключенными уведомлениями
const usersToUpdate = db.prepare(`
  SELECT id, username, telegram_username 
  FROM users 
  WHERE telegram_username IS NOT NULL 
  AND telegram_notifications_enabled = 0
`).all();

if (usersToUpdate.length === 0) {
  console.log('✅ У всех пользователей с Telegram уже включены уведомления');
  db.close();
  process.exit(0);
}

console.log(`📋 Найдено пользователей с отключенными уведомлениями: ${usersToUpdate.length}\n`);
usersToUpdate.forEach(user => {
  console.log(`  - ${user.username} (@${user.telegram_username})`);
});

console.log('\n⚠️ ВНИМАНИЕ: Это включит уведомления для всех этих пользователей!');
console.log('Возможно, кто-то специально отключил уведомления.\n');

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Продолжить? (yes/no): ', (answer) => {
  if (answer.toLowerCase() === 'yes') {
    const result = db.prepare(`
      UPDATE users 
      SET telegram_notifications_enabled = 1 
      WHERE telegram_username IS NOT NULL 
      AND telegram_notifications_enabled = 0
    `).run();
    
    console.log(`\n✅ Уведомления включены для ${result.changes} пользователей`);
    console.log('💡 Пользователи могут отключить их в настройках профиля');
  } else {
    console.log('\n❌ Операция отменена');
  }
  
  rl.close();
  db.close();
});
