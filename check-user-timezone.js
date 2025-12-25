#!/usr/bin/env node

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "1xBetLineBoom.db"));

console.log("🔍 Проверка данных пользователя в БД:\n");

const user = db
  .prepare("SELECT * FROM users WHERE username = ?")
  .get("Мемослав");

if (user) {
  console.log("✅ Найден пользователь:");
  console.log(JSON.stringify(user, null, 2));
} else {
  console.log("❌ Пользователь не найден");
}

db.close();
