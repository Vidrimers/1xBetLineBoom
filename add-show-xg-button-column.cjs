const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '1xBetLineBoom.db');
const db = new Database(dbPath);

console.log('🔧 Добавление колонки show_xg_button в таблицу users...');

try {
  // Проверяем существует ли колонка
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const columnExists = columns.some(col => col.name === 'show_xg_button');
  
  if (columnExists) {
    console.log('✅ Колонка show_xg_button уже существует');
  } else {
    // Добавляем колонку
    db.exec(`ALTER TABLE users ADD COLUMN show_xg_button INTEGER DEFAULT 1`);
    console.log('✅ Колонка show_xg_button успешно добавлена');
  }
  
  // Проверяем результат
  const updatedColumns = db.prepare("PRAGMA table_info(users)").all();
  const xgButtonColumn = updatedColumns.find(col => col.name === 'show_xg_button');
  
  if (xgButtonColumn) {
    console.log('✅ Проверка: колонка show_xg_button присутствует в таблице');
    console.log(`   Тип: ${xgButtonColumn.type}, По умолчанию: ${xgButtonColumn.dflt_value}`);
  } else {
    console.error('❌ Ошибка: колонка show_xg_button не найдена после добавления');
  }
  
} catch (error) {
  console.error('❌ Ошибка при добавлении колонки:', error.message);
  process.exit(1);
} finally {
  db.close();
}

console.log('✅ Миграция завершена');
