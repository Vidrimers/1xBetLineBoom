import Database from "better-sqlite3";

const db = new Database("./1xBetLineBoom.db");

try {
  console.log("📊 Анализ пользователей...\n");

  // Все пользователи с привязанным Telegram
  const usersWithTelegram = db.prepare(`
    SELECT id, username, telegram_username, telegram_id, require_login_2fa
    FROM users 
    WHERE telegram_username IS NOT NULL
    ORDER BY username
  `).all();

  console.log(`Всего пользователей с привязанным Telegram: ${usersWithTelegram.length}\n`);

  // Пользователи, которые НЕ писали боту (telegram_id = null)
  const usersWithoutBotContact = usersWithTelegram.filter(u => !u.telegram_id);

  // Пользователи, которые писали боту (telegram_id есть)
  const usersWithBotContact = usersWithTelegram.filter(u => u.telegram_id);

  console.log("✅ Пользователи, которые ПИСАЛИ боту в личку:");
  console.log("=" .repeat(60));
  if (usersWithBotContact.length > 0) {
    usersWithBotContact.forEach(u => {
      const login2fa = u.require_login_2fa !== 0 ? "✅ Включено" : "❌ Выключено";
      console.log(`👤 ${u.username.padEnd(15)} | @${u.telegram_username.padEnd(20)} | 2FA: ${login2fa}`);
    });
  } else {
    console.log("   Нет таких пользователей");
  }

  console.log("\n❌ Пользователи, которые НЕ писали боту в личку:");
  console.log("=" .repeat(60));
  if (usersWithoutBotContact.length > 0) {
    usersWithoutBotContact.forEach(u => {
      const login2fa = u.require_login_2fa !== 0 ? "✅ Включено" : "❌ Выключено";
      console.log(`👤 ${u.username.padEnd(15)} | @${u.telegram_username.padEnd(20)} | 2FA: ${login2fa}`);
    });
    
    console.log("\n⚠️ ВНИМАНИЕ:");
    console.log("Эти пользователи НЕ смогут:");
    console.log("  - Получать коды подтверждения при логине (если 2FA включено)");
    console.log("  - Получать коды для выхода с устройств");
    console.log("  - Получать коды для изменения/удаления Telegram username");
    console.log("\nИм нужно написать боту @OnexBetLineBoomBot команду /start в ЛИЧНЫХ сообщениях!");
  } else {
    console.log("   Все пользователи писали боту! 🎉");
  }

  console.log("\n📈 Статистика:");
  console.log(`   Писали боту: ${usersWithBotContact.length}`);
  console.log(`   Не писали боту: ${usersWithoutBotContact.length}`);
  console.log(`   Процент охвата: ${Math.round(usersWithBotContact.length / usersWithTelegram.length * 100)}%`);

  // Проверяем записи в telegram_users
  const telegramUsersCount = db.prepare("SELECT COUNT(*) as count FROM telegram_users").get();
  console.log(`\n💾 Записей в telegram_users: ${telegramUsersCount.count}`);

} catch (error) {
  console.error("❌ Ошибка:", error);
} finally {
  db.close();
}
