const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "1xBetLineBoom.db");
const db = new Database(dbPath);

try {
  db.exec("DELETE FROM final_parameters_results");
  console.log("✅ Таблица final_parameters_results очищена!");
} catch (error) {
  console.error("❌ Ошибка:", error.message);
}

db.close();
