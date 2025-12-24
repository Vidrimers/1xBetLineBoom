import Database from "better-sqlite3";

const db = new Database("1xBetLineBoom.db");

// Проверяем таблицу awards
console.log("📋 ТАБЛИЦА TOURNAMENT_AWARDS:");
const awards = db.prepare("SELECT * FROM tournament_awards").all();
console.log(awards);

// Проверяем заблокированные события
console.log("\n🔒 ЗАБЛОКИРОВАННЫЕ СОБЫТИЯ:");
const lockedEvents = db
  .prepare(
    "SELECT id, name, locked_reason FROM events WHERE locked_reason IS NOT NULL"
  )
  .all();
console.log(lockedEvents);

// Проверяем победителей в каждом событии
console.log("\n🏆 ПОБЕДИТЕЛИ ПО СОБЫТИЯМ:");
const winners = db
  .prepare(
    `
    SELECT 
      m.event_id,
      e.name as event_name,
      u.id,
      u.username,
      COUNT(DISTINCT m.id) as total_matches,
      SUM(CASE 
        WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
             (b.prediction = 'team2' AND m.winner = 'team2') OR
             (b.prediction = 'draw' AND m.winner = 'draw') OR
             (b.prediction = m.team1_name AND m.winner = 'team1') OR
             (b.prediction = m.team2_name AND m.winner = 'team2')
        THEN 1 ELSE 0
      END) as wins
    FROM bets b
    JOIN matches m ON b.match_id = m.id
    JOIN events e ON m.event_id = e.id
    JOIN users u ON b.user_id = u.id
    GROUP BY m.event_id, u.id
    ORDER BY m.event_id, wins DESC
  `
  )
  .all();
console.log(winners);

db.close();
