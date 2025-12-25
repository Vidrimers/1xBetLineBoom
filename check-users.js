#!/usr/bin/env node

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "1xBetLineBoom.db"));

console.log("👥 ПРОВЕРКА ПОЛЬЗОВАТЕЛЕЙ\n");

// Все пользователи
const allUsers = db.prepare("SELECT * FROM users").all();
console.log(`📊 Всего пользователей в БД: ${allUsers.length}`);

// Пользователи с включенными напоминаниями
const remindersEnabled = db
  .prepare(
    "SELECT id, username, telegram_username, telegram_group_reminders_enabled FROM users WHERE telegram_group_reminders_enabled = 1"
  )
  .all();

console.log(
  `📢 Пользователей с включенными напоминаниями: ${remindersEnabled.length}`
);

if (remindersEnabled.length > 0) {
  console.log("\n📋 Список:");
  remindersEnabled.forEach((u) => {
    console.log(
      `  - ID ${u.id}: @${u.telegram_username || "N/A"} (${u.username})`
    );
  });
} else {
  console.log(`\n❌ ПРОБЛЕМА: НЕ ВКЛЮЧЕНЫ НАПОМИНАНИЯ НИ У КОГО!`);
}

// Проверим все значения флага
console.log(`\n🔍 Распределение флага telegram_group_reminders_enabled:`);
const distribution = db
  .prepare(
    "SELECT telegram_group_reminders_enabled, COUNT(*) as count FROM users GROUP BY telegram_group_reminders_enabled"
  )
  .all();

distribution.forEach((d) => {
  console.log(
    `  ${d.telegram_group_reminders_enabled}: ${d.count} пользователей`
  );
});

db.close();
