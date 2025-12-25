#!/usr/bin/env node

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "1xBetLineBoom.db"));

console.log("🕐 ПРОВЕРКА ЧАСОВЫХ ПОЯСОВ\n");

const now = new Date();
console.log(`JavaScript new Date():`);
console.log(`  Текущая дата/время: ${now}`);
console.log(`  toISOString(): ${now.toISOString()}`);
console.log(`  getTime() (миллисекунды): ${now.getTime()}`);
console.log(
  `  Часовой пояс: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`
);
console.log();

// Смещение часового пояса
const offsetMs = now.getTimezoneOffset() * 60 * 1000;
const offsetHours = -now.getTimezoneOffset() / 60;
console.log(
  `Смещение от UTC: ${offsetHours > 0 ? "+" : ""}${offsetHours} часов`
);
console.log();

// Проверим что в БД для матча 173
console.log("📊 Матч 173 в БД:");
const match = db
  .prepare(
    "SELECT id, team1_name, team2_name, match_date FROM matches WHERE id = 173"
  )
  .get();

if (match) {
  console.log(`  Значение match_date в БД: "${match.match_date}"`);

  const matchDate = new Date(match.match_date);
  console.log(`  Распарено как: ${matchDate}`);
  console.log(`  toISOString(): ${matchDate.toISOString()}`);
  console.log(`  getTime(): ${matchDate.getTime()}`);

  const diff = matchDate.getTime() - now.getTime();
  const diffHours = diff / (1000 * 60 * 60);
  console.log(`\n⏰ Расчеты:`);
  console.log(`  Разница в миллисекундах: ${diff}`);
  console.log(`  Разница в часах: ${diffHours.toFixed(2)}`);
  console.log(
    `  В окне 3-часов? ${diffHours > 0 && diffHours <= 3 ? "✅ ДА" : "❌ НЕТ"}`
  );
}

db.close();
