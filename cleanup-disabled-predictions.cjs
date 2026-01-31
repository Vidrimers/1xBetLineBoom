const Database = require("better-sqlite3");
const path = require("path");

// Подключаемся к базе данных
const dbPath = path.join(__dirname, "1xBetLineBoom.db");
const db = new Database(dbPath);

console.log("🧹 Очистка прогнозов для матчей с отключенными чекбоксами...\n");

try {
  // Получаем все матчи
  const matches = db.prepare("SELECT id, team1_name, team2_name, score_prediction_enabled, yellow_cards_prediction_enabled, red_cards_prediction_enabled FROM matches").all();
  
  let totalDeletedScores = 0;
  let totalDeletedYellow = 0;
  let totalDeletedRed = 0;
  let totalDeletedCardsRecords = 0;

  matches.forEach(match => {
    // Удаляем прогнозы на счет если чекбокс отключен
    if (match.score_prediction_enabled === 0) {
      const deleted = db.prepare("DELETE FROM score_predictions WHERE match_id = ?").run(match.id);
      if (deleted.changes > 0) {
        console.log(`🗑️ Матч ${match.team1_name} - ${match.team2_name}: удалено ${deleted.changes} прогнозов на счет`);
        totalDeletedScores += deleted.changes;
      }
    }

    // Удаляем прогнозы на желтые карточки если чекбокс отключен
    if (match.yellow_cards_prediction_enabled === 0) {
      const deleted = db.prepare("UPDATE cards_predictions SET yellow_cards = NULL WHERE match_id = ?").run(match.id);
      if (deleted.changes > 0) {
        console.log(`🗑️ Матч ${match.team1_name} - ${match.team2_name}: удалено ${deleted.changes} прогнозов на желтые карточки`);
        totalDeletedYellow += deleted.changes;
      }
    }

    // Удаляем прогнозы на красные карточки если чекбокс отключен
    if (match.red_cards_prediction_enabled === 0) {
      const deleted = db.prepare("UPDATE cards_predictions SET red_cards = NULL WHERE match_id = ?").run(match.id);
      if (deleted.changes > 0) {
        console.log(`🗑️ Матч ${match.team1_name} - ${match.team2_name}: удалено ${deleted.changes} прогнозов на красные карточки`);
        totalDeletedRed += deleted.changes;
      }
    }
  });

  // Удаляем пустые записи в cards_predictions (где оба поля NULL)
  const deletedEmpty = db.prepare("DELETE FROM cards_predictions WHERE yellow_cards IS NULL AND red_cards IS NULL").run();
  totalDeletedCardsRecords = deletedEmpty.changes;

  console.log("\n✅ Очистка завершена!");
  console.log(`📊 Статистика:`);
  console.log(`   - Удалено прогнозов на счет: ${totalDeletedScores}`);
  console.log(`   - Удалено прогнозов на желтые карточки: ${totalDeletedYellow}`);
  console.log(`   - Удалено прогнозов на красные карточки: ${totalDeletedRed}`);
  console.log(`   - Удалено пустых записей в cards_predictions: ${totalDeletedCardsRecords}`);

} catch (error) {
  console.error("❌ Ошибка:", error);
} finally {
  db.close();
}
