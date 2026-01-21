const Database = require('better-sqlite3');

const db = new Database('1xBetLineBoom.db');

const userId = process.argv[2];

if (!userId) {
  console.log('❌ Укажите ID пользователя');
  console.log('Использование: node enable-notifications.cjs <user_id>');
  console.log('Пример: node enable-notifications.cjs 2');
  process.exit(1);
}

const user = db.prepare('SELECT id, username, telegram_username, telegram_notifications_enabled FROM users WHERE id = ?').get(userId);

if (!user) {
  console.log(`❌ Пользователь с ID ${userId} не найден`);
  db.close();
  process.exit(1);
}

console.log(`\n👤 Пользователь: ${user.username} (@${user.telegram_username || 'не привязан'})`);
console.log(`📱 Уведомления: ${user.telegram_notifications_enabled ? '✅ Включены' : '❌ Отключены'}`);

if (user.telegram_notifications_enabled) {
  console.log('\n✅ Уведомления уже включены');
  db.close();
  process.exit(0);
}

db.prepare('UPDATE users SET telegram_notifications_enabled = 1 WHERE id = ?').run(userId);

console.log('\n✅ Уведомления включены!');
console.log('💡 Пользователь может отключить их в настройках профиля');

db.close();
