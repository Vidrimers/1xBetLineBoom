// Скрипт для автоматического исправления chat_id
// Удаляет записи с неправильным chat_id (ID группы)
// При следующем сообщении боту, chat_id обновится автоматически на правильный

import Database from "better-sqlite3";

const db = new Database("1xBetLineBoom.db");

console.log("🔍 Проверяем пользователей с неправильным chat_id...\n");

// ID группы (отрицательный)
const GROUP_CHAT_ID = -1003639638830;

// Находим пользователей с chat_id группы
const usersWithGroupId = db.prepare(
  "SELECT * FROM telegram_users WHERE chat_id = ?"
).all(GROUP_CHAT_ID);

if (usersWithGroupId.length > 0) {
  console.log(`❌ Найдено пользователей с неправильным chat_id: ${usersWithGroupId.length}`);
  console.log("\nСписок:");
  usersWithGroupId.forEach(u => {
    console.log(`  - @${u.telegram_username} (${u.first_name || 'без имени'})`);
  });
  
  console.log("\n🔧 Удаляю неправильные записи...");
  
  const result = db.prepare(
    "DELETE FROM telegram_users WHERE chat_id = ?"
  ).run(GROUP_CHAT_ID);
  
  console.log(`✅ Удалено записей: ${result.changes}`);
  console.log("\n📝 Теперь когда эти пользователи напишут что-то боту,");
  console.log("   их chat_id автоматически обновится на правильный личный ID");
} else {
  console.log("✅ Все пользователи имеют правильный chat_id");
}

// Показываем оставшихся пользователей
const remainingUsers = db.prepare("SELECT * FROM telegram_users").all();
console.log(`\n📋 Пользователей в базе после очистки: ${remainingUsers.length}`);
remainingUsers.forEach(u => {
  console.log(`  ✅ @${u.telegram_username}: ${u.chat_id} (${u.first_name || 'без имени'})`);
});

db.close();
