// Проверка наличия колонок для карточек в таблице matches
const Database = require('better-sqlite3');
const db = new Database('1xBetLineBoom.db');

console.log('🔍 Проверка структуры таблицы matches...\n');

try {
  // Получаем структуру таблицы matches
  const columns = db.prepare("PRAGMA table_info(matches)").all();
  
  console.log('📋 Колонки таблицы matches:');
  columns.forEach(col => {
    console.log(`  - ${col.name} (${col.type})`);
  });
  
  console.log('\n🔍 Проверка наличия колонок для карточек:');
  
  const hasYellowCards = columns.some(col => col.name === 'yellow_cards');
  const hasRedCards = columns.some(col => col.name === 'red_cards');
  const hasYellowPredEnabled = columns.some(col => col.name === 'yellow_cards_prediction_enabled');
  const hasRedPredEnabled = columns.some(col => col.name === 'red_cards_prediction_enabled');
  
  console.log(`  yellow_cards: ${hasYellowCards ? '✅' : '❌'}`);
  console.log(`  red_cards: ${hasRedCards ? '✅' : '❌'}`);
  console.log(`  yellow_cards_prediction_enabled: ${hasYellowPredEnabled ? '✅' : '❌'}`);
  console.log(`  red_cards_prediction_enabled: ${hasRedPredEnabled ? '✅' : '❌'}`);
  
  if (!hasYellowCards || !hasRedCards || !hasYellowPredEnabled || !hasRedPredEnabled) {
    console.log('\n⚠️ ВНИМАНИЕ: Не все колонки для карточек присутствуют!');
    console.log('Перезапусти сервер чтобы колонки были добавлены автоматически.');
  } else {
    console.log('\n✅ Все колонки для карточек присутствуют!');
  }
  
  // Проверяем таблицу cards_predictions
  console.log('\n🔍 Проверка таблицы cards_predictions:');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cards_predictions'").all();
  
  if (tables.length > 0) {
    console.log('✅ Таблица cards_predictions существует');
    const cardsPredColumns = db.prepare("PRAGMA table_info(cards_predictions)").all();
    console.log('📋 Колонки:');
    cardsPredColumns.forEach(col => {
      console.log(`  - ${col.name} (${col.type})`);
    });
  } else {
    console.log('❌ Таблица cards_predictions НЕ существует!');
  }
  
} catch (error) {
  console.error('❌ Ошибка:', error.message);
}

db.close();
