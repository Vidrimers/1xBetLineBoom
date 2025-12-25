#!/usr/bin/env node

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "1xBetLineBoom.db"));

console.log("🔍 Проверка матчей на сегодня...\n");

const today = new Date();
today.setHours(0, 0, 0, 0);
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);

const todayStr = "2025-12-25"; // Текущая дата

console.log(`📅 Ищем матчи на ${todayStr}\n`);

// Все матчи на сегодня без условия по победителю
const allMatches = db
  .prepare(
    `
    SELECT m.id, m.team1_name, m.team2_name, m.match_date, m.winner, e.name as event_name
    FROM matches m
    LEFT JOIN events e ON m.event_id = e.id
    WHERE m.match_date LIKE ?
    ORDER BY m.match_date ASC
  `
  )
  .all(`${todayStr}%`);

console.log(`📊 Всего матчей на сегодня: ${allMatches.length}\n`);

allMatches.forEach((match) => {
  console.log(`ID ${match.id}: ${match.team1_name} vs ${match.team2_name}`);
  console.log(`  Дата: ${match.match_date}`);
  console.log(`  Событие: ${match.event_name}`);
  console.log(`  Результат: ${match.winner ? match.winner : "Нет"}`);
  console.log();
});

db.close();
