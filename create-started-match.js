#!/usr/bin/env node

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "1xBetLineBoom.db"));

console.log("🏃 Создание матча который начался 5 минут назад...\n");

const now = new Date();
const matchTime = new Date(now.getTime() - 5 * 60 * 1000); // 5 минут назад
const matchTimeISO = matchTime.toISOString().slice(0, 19);

console.log(`⏰ Текущее время: ${now.toISOString()}`);
console.log(`⏰ Матч начался в: ${matchTimeISO}\n`);

// Получаем первый турнир
const event = db.prepare("SELECT id FROM events LIMIT 1").get();

if (!event) {
  console.error("❌ Нет турниров в БД");
  db.close();
  process.exit(1);
}

const result = db
  .prepare(
    `INSERT INTO matches (event_id, team1_name, team2_name, match_date)
     VALUES (?, ?, ?, ?)`
  )
  .run(event.id, "Матч А", "Матч Б", matchTimeISO);

const matchId = result.lastInsertRowid;

console.log(`✅ Матч создан!`);
console.log(`   ID: ${matchId}`);
console.log(`   Дата: ${matchTimeISO} (5 минут назад)`);
console.log(
  `\n✅ Уведомление о начале этого матча должно появиться в течение 1 минуты!`
);

db.close();
