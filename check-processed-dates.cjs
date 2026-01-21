#!/usr/bin/env node

const Database = require('better-sqlite3');

const db = new Database('1xBetLineBoom.db');

console.log('📋 Обработанные даты автоподсчета:\n');

try {
  const dates = db.prepare('SELECT * FROM auto_counting_processed ORDER BY processed_at DESC').all();
  
  if (dates.length === 0) {
    console.log('✓ Нет обработанных дат');
  } else {
    console.log(`Всего обработанных дат: ${dates.length}\n`);
    
    dates.forEach((row, index) => {
      console.log(`${index + 1}. ${row.date_key}`);
      console.log(`   Обработано: ${row.processed_at}\n`);
    });
  }
  
} catch (error) {
  console.error('❌ Ошибка:', error.message);
} finally {
  db.close();
}
