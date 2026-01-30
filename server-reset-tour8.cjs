const Database = require('better-sqlite3');

const db = new Database('1xBetLineBoom.db');

console.log('\n🔄 Сброс неправильных результатов Тура 8 на сервере\n');

// Получаем все матчи Тура 8 с result = null (установлены через API)
const matches = db.prepare(`
  SELECT 
    m.id,
    m.team1_name,
    m.team2_name,
    m.team1_score,
    m.team2_score,
    m.winner,
    m.status
  FROM matches m
  WHERE m.round = 'Тур 8'
    AND m.result IS NULL
`).all();

console.log(`📊 Найдено матчей Тура 8: ${matches.length}\n`);

if (matches.length === 0) {
  console.log('✅ Нет матчей для сброса');
  db.close();
  process.exit(0);
}

console.log('Матчи, которые будут сброшены:');
matches.forEach(m => {
  const score = m.team1_score !== null ? `${m.team1_score}-${m.team2_score}` : '?-?';
  console.log(`  ${m.id}. ${m.team1_name} ${score} ${m.team2_name} (${m.winner || 'нет'}) [${m.status}]`);
});

console.log('\n⚠️  ВНИМАНИЕ: Это действие сбросит результаты всех матчей Тура 8!');
console.log('⚠️  После этого нужно будет перезапустить сервер и дождаться автоподсчета.');
console.log('\n❓ Для подтверждения запустите скрипт с параметром --confirm:');
console.log('   node server-reset-tour8.cjs --confirm\n');

if (process.argv.includes('--confirm')) {
  console.log('🔄 Сбрасываем результаты...\n');
  
  const resetStmt = db.prepare(`
    UPDATE matches
    SET status = 'pending',
        winner = NULL,
        team1_score = NULL,
        team2_score = NULL
    WHERE round = 'Тур 8'
      AND result IS NULL
  `);
  
  const result = resetStmt.run();
  
  console.log(`✅ Сброшено матчей: ${result.changes}`);
  console.log('\n📝 Следующие шаги:');
  console.log('   1. Перезапустите сервер: pm2 restart server');
  console.log('   2. Дождитесь автоподсчета (каждые 5 минут)');
  console.log('   3. Проверьте результаты в админке\n');
}

db.close();
