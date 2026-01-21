#!/usr/bin/env node

const Database = require('better-sqlite3');

const db = new Database('1xBetLineBoom.db');

console.log('🧹 Очистка обработанных дат автоподсчета...\n');

try {
  // Показываем текущие обработанные даты
  const dates = db.prepare('SELECT * FROM auto_counting_processed ORDER BY processed_at DESC').all();
  
  if (dates.length === 0) {
    console.log('✓ Нет обработанных дат для очистки');
    process.exit(0);
  }
  
  console.log(`📋 Найдено обработанных дат: ${dates.length}\n`);
  dates.forEach(row => {
    console.log(`  - ${row.date_key} (обработано: ${row.processed_at})`);
  });
  
  console.log('\n⚠️  Вы уверены что хотите очистить все обработанные даты?');
  console.log('   Это позволит автоподсчету запуститься повторно для этих дат.\n');
  
  // Простое подтверждение
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  rl.question('Введите "yes" для подтверждения: ', (answer) => {
    if (answer.toLowerCase() === 'yes') {
      const result = db.prepare('DELETE FROM auto_counting_processed').run();
      console.log(`\n✅ Удалено записей: ${result.changes}`);
      console.log('✓ Автоподсчет запустится заново при следующей проверке (каждые 5 минут)');
    } else {
      console.log('\n❌ Отменено');
    }
    
    rl.close();
    db.close();
  });
  
} catch (error) {
  console.error('❌ Ошибка:', error.message);
  db.close();
  process.exit(1);
}
