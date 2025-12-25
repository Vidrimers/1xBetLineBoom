#!/usr/bin/env node

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "1xBetLineBoom.db"));

console.log("🔍 Проверка матчей в окне ±3 часов...\n");

const now = new Date();
const threeHoursLater = new Date(now.getTime() + 3 * 60 * 60 * 1000);

console.log(`⏰ Текущее время: ${now.toISOString()}`);
console.log(`⏰ Проверяем матчи до: ${threeHoursLater.toISOString()}\n`);

// Ищем матчи в БД как делает функция
const allMatches = db
  .prepare(
    `
  SELECT m.id, m.team1_name, m.team2_name, m.match_date, e.name as event_name
  FROM matches m
  JOIN events e ON m.event_id = e.id
  WHERE m.winner IS NULL AND m.match_date IS NOT NULL
  ORDER BY m.match_date ASC
  LIMIT 20
`
  )
  .all();

console.log(`📊 Матчей без победителя и с датой: ${allMatches.length}\n`);

allMatches.forEach((match) => {
  const matchTime = new Date(match.match_date);
  const diffMs = matchTime.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const inWindow = matchTime > now && matchTime <= threeHoursLater;

  console.log(`ID ${match.id}: ${match.team1_name} vs ${match.team2_name}`);
  console.log(`  Дата: ${match.match_date}`);
  console.log(`  Через часов: ${diffHours.toFixed(2)}`);
  console.log(`  В окне 3-часов? ${inWindow ? "✅ ДА" : "❌ НЕТ"}`);
  console.log();
});

// Ищем матчи в окне 3 часов
const upcomingMatches = allMatches.filter((match) => {
  if (!match.match_date) {
    return false;
  }
  const matchTime = new Date(match.match_date);
  return matchTime > now && matchTime <= threeHoursLater;
});

console.log(`\n🎯 Матчей в окне 3-часов: ${upcomingMatches.length}`);

if (upcomingMatches.length > 0) {
  console.log("\n📢 ЭТИ МАТЧИ ДОЛЖНЫ ПОЛУЧИТЬ НАПОМИНАНИЯ:");
  upcomingMatches.forEach((match) => {
    console.log(`  - ${match.team1_name} vs ${match.team2_name}`);

    // Проверяем было ли напоминание отправлено
    const reminder = db
      .prepare("SELECT id FROM sent_reminders WHERE match_id = ?")
      .get(match.id);

    if (reminder) {
      console.log(`    ⏳ Напоминание УЖЕ отправлено`);
    } else {
      console.log(`    ✅ Напоминание ЕЩЕ НЕ отправлено`);
    }
  });
}

db.close();
