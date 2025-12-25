#!/usr/bin/env node

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "1xBetLineBoom.db"));

console.log("🗑️ Удаление тестовых матчей...\n");

// Удаляем тестовые матчи (174, 175, 176)
const testMatchIds = [174, 175, 176];

testMatchIds.forEach((id) => {
  // Удаляем ставки для этого матча
  db.prepare("DELETE FROM bets WHERE match_id = ?").run(id);

  // Удаляем напоминания
  db.prepare("DELETE FROM sent_reminders WHERE match_id = ?").run(id);

  // Удаляем сам матч
  const result = db.prepare("DELETE FROM matches WHERE id = ?").run(id);

  if (result.changes > 0) {
    console.log(`✅ Удален матч ID ${id}`);
  }
});

console.log("\n✅ Все тестовые матчи удалены!");

db.close();
