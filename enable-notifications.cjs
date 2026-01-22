const Database = require('better-sqlite3');

const db = new Database('1xBetLineBoom.db');

const userId = process.argv[2];
const enableFlag = process.argv[3]; // '1' для включения, '0' для выключения

if (!userId) {
  console.log('❌ Укажите ID пользователя');
  console.log('Использование: node enable-notifications.cjs <user_id> [1|0]');
  console.log('Пример: node enable-notifications.cjs 2 1');
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

// Если не указан флаг, по умолчанию включаем
const shouldEnable = enableFlag === '0' ? 0 : 1;

if (user.telegram_notifications_enabled === shouldEnable) {
  console.log(`\n✅ Уведомления уже ${shouldEnable ? 'включены' : 'отключены'}`);
  db.close();
  process.exit(0);
}

db.prepare('UPDATE users SET telegram_notifications_enabled = ? WHERE id = ?').run(shouldEnable, userId);

console.log(`\n✅ Уведомления ${shouldEnable ? 'включены' : 'отключены'}!`);
if (shouldEnable) {
  console.log('💡 Пользователь может отключить их в настройках профиля');
}

db.close();
