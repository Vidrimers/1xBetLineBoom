#!/usr/bin/env node

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "1xBetLineBoom.db"));

console.log("🗑️  Удаление отправленного напоминания для матча 173...\n");

const deleted = db
  .prepare("DELETE FROM sent_reminders WHERE match_id = 173")
  .run();

console.log(`✅ Удалено записей: ${deleted.changes}`);
console.log(`\n💡 Теперь обнови дату матча 173 на сайте`);
console.log(`   Система автоматически удалит напоминание если дата изменится`);
console.log(`   И отправит его заново при следующей проверке (каждые 5 минут)`);

db.close();
