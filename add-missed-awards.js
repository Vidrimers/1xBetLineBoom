import Database from "better-sqlite3";

const db = new Database("1xBetLineBoom.db");

// Получаем все заблокированные события
const lockedEvents = db
  .prepare(
    "SELECT id, name FROM events WHERE locked_reason IS NOT NULL ORDER BY id"
  )
  .all();

console.log(`📦 Найдено ${lockedEvents.length} заблокированных событий\n`);

let addedCount = 0;

lockedEvents.forEach((event) => {
  // Получаем победителя для этого события
  const winner = db
    .prepare(
      `
      SELECT u.id, u.username, COUNT(b.id) as wins
      FROM users u
      LEFT JOIN bets b ON u.id = b.user_id
      LEFT JOIN matches m ON b.match_id = m.id
      WHERE m.event_id = ?
      AND m.winner IS NOT NULL
      AND (
        (b.prediction = 'team1' AND m.winner = 'team1') OR
        (b.prediction = 'team2' AND m.winner = 'team2') OR
        (b.prediction = 'draw' AND m.winner = 'draw') OR
        (b.prediction = m.team1_name AND m.winner = 'team1') OR
        (b.prediction = m.team2_name AND m.winner = 'team2')
      )
      GROUP BY u.id, u.username
      ORDER BY wins DESC
      LIMIT 1
    `
    )
    .get(event.id);

  if (winner) {
    try {
      // Проверяем, есть ли уже награда
      const existingAward = db
        .prepare(
          "SELECT id FROM tournament_awards WHERE user_id = ? AND event_id = ?"
        )
        .get(winner.id, event.id);

      if (!existingAward) {
        db.prepare(
          `
          INSERT INTO tournament_awards (user_id, event_id, event_name, won_bets)
          VALUES (?, ?, ?, ?)
        `
        ).run(winner.id, event.id, event.name, winner.wins);

        console.log(
          `✅ ${event.name} → ${winner.username} (${winner.wins} побед)`
        );
        addedCount++;
      } else {
        console.log(`⏭️  ${event.name} → награда уже существует`);
      }
    } catch (error) {
      console.error(
        `❌ Ошибка при добавлении награды для "${event.name}":`,
        error.message
      );
    }
  } else {
    console.log(`⚠️  ${event.name} → победитель не найден`);
  }
});

console.log(`\n🎉 Всего добавлено наград: ${addedCount}`);

db.close();
