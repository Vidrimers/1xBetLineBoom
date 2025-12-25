#!/usr/bin/env node

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "1xBetLineBoom.db"));

console.log("🔍 Структура таблицы sent_reminders:\n");

const schema = db.prepare(`PRAGMA table_info(sent_reminders)`).all();

schema.forEach((col) => {
  console.log(`  ${col.name}: ${col.type}`);
});

console.log("\n🔍 Записи в sent_reminders для матча 173:\n");

const reminders = db
  .prepare("SELECT * FROM sent_reminders WHERE match_id = 173")
  .all();

if (reminders.length === 0) {
  console.log("❌ НЕТ ЗАПИСЕЙ");
} else {
  console.log(`✅ НАЙДЕНО ${reminders.length} записей:`);
  reminders.forEach((r) => {
    console.log(`  - ID: ${r.id}, match_id: ${r.match_id}`);
  });
}

db.close();
