import Database from "better-sqlite3";

const db = new Database("1xBetLineBoom.db");

// Получаем список пользователей и событий
const users = db.prepare("SELECT id, username FROM users LIMIT 5").all();
const events = db
  .prepare(
    "SELECT id, name FROM events WHERE locked_reason IS NOT NULL LIMIT 5"
  )
  .all();

console.log("\n📋 Доступные пользователи:");
users.forEach((u) => console.log(`  - ID: ${u.id}, Имя: ${u.username}`));

console.log("\n🏆 Завершённые турниры:");
events.forEach((e) => console.log(`  - ID: ${e.id}, Название: ${e.name}`));

if (users.length > 0 && events.length > 0) {
  const userId = users[0].id;

  // Добавляем награды для каждого завершённого турнира
  for (const event of events) {
    console.log(
      `\n➕ Добавляю награду для пользователя ${users[0].username} (ID: ${userId}) за турнир "${event.name}" (ID: ${event.id})`
    );

    try {
      // Проверяем, нет ли уже награды для этого турнира
      const existingAward = db
        .prepare("SELECT id FROM awards WHERE event_id = ?")
        .get(event.id);

      if (existingAward) {
        console.log(
          `⏭️ Награда для этого турнира уже существует (ID: ${existingAward.id})`
        );
        continue;
      }

      const stmt = db.prepare(
        `INSERT INTO awards (user_id, event_id, description, won_bets_count, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      );

      let description = "Победитель турнира!";
      let wonBets = Math.floor(Math.random() * 20) + 10; // От 10 до 30

      const result = stmt.run(userId, event.id, description, wonBets);

      console.log(`✅ Награда добавлена! ID: ${result.lastInsertRowid}`);

      // Проверяем, что награда добавлена
      const award = db
        .prepare("SELECT * FROM awards WHERE id = ?")
        .get(result.lastInsertRowid);
      console.log("📦 Созданная награда:", award);
    } catch (err) {
      console.error("❌ Ошибка при добавлении награды:", err.message);
    }
  }
} else {
  console.log("\n❌ Нет доступных пользователей или завершённых турниров!");
  console.log("Создайте сначала пользователя и завершите турнир.");
}

db.close();
