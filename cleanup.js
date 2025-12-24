import Database from "better-sqlite3";

const db = new Database("1xBetLineBoom.db");

try {
  db.exec("DELETE FROM final_parameters_results");
  console.log("✅ Таблица очищена!");

  // Проверяем что осталось
  const count = db
    .prepare("SELECT COUNT(*) as cnt FROM final_parameters_results")
    .get();
  console.log(`📊 Осталось записей: ${count.cnt}`);
} catch (error) {
  console.error("❌ Ошибка:", error.message);
}

db.close();
