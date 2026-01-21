const Database = require('better-sqlite3');

const db = new Database('1xBetLineBoom.db');

const userId = process.argv[2] || 2; // По умолчанию пользователь 2

const user = db.prepare(`
  SELECT id, username, telegram_username, telegram_notifications_enabled 
  FROM users 
  WHERE id = ?
`).get(userId);

if (!user) {
  console.log(`❌ Пользователь с ID ${userId} не найден`);
  process.exit(1);
}

console.log('\n👤 Информация о пользователе:');
console.log(`  ID: ${user.id}`);
console.log(`  Username: ${user.username}`);
console.log(`  Telegram: ${user.telegram_username || 'не привязан'}`);
console.log(`  Уведомления: ${user.telegram_notifications_enabled ? '✅ Включены' : '❌ Отключены'}`);

// Проверяем привязку в telegram_users
const telegramUser = db.prepare(`
  SELECT chat_id, first_name 
  FROM telegram_users 
  WHERE telegram_username = ?
`).get(user.telegram_username);

if (telegramUser) {
  console.log(`\n📱 Telegram привязка:`);
  console.log(`  Chat ID: ${telegramUser.chat_id}`);
  console.log(`  Имя: ${telegramUser.first_name}`);
} else {
  console.log(`\n⚠️ Нет записи в telegram_users для @${user.telegram_username}`);
}

// Если уведомления отключены - предлагаем включить
if (!user.telegram_notifications_enabled) {
  console.log(`\n💡 Включить уведомления? (y/n)`);
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  rl.question('> ', (answer) => {
    if (answer.toLowerCase() === 'y') {
      db.prepare('UPDATE users SET telegram_notifications_enabled = 1 WHERE id = ?').run(userId);
      console.log('✅ Уведомления включены!');
    }
    rl.close();
    db.close();
  });
} else {
  db.close();
}
