import Database from "better-sqlite3";
const db = new Database("1xBetLineBoom.db");

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Таблицы в БД:');
tables.forEach(t => console.log('  ' + t.name));

db.close();
