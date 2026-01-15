// Скрипт для очистки команд из последующих стадий в сетках плей-офф
// Оставляет только начальные стадии (1/16 и 1/8)

const Database = require('better-sqlite3');
const db = new Database('1xBetLineBoom.db');

console.log('🔄 Начинаем очистку команд из последующих стадий...');

try {
  // Получаем все сетки
  const brackets = db.prepare('SELECT id, name, matches FROM brackets').all();
  
  console.log(`📊 Найдено сеток: ${brackets.length}`);
  
  let updatedCount = 0;
  const editableStages = ['round_of_16', 'round_of_8'];
  
  brackets.forEach(bracket => {
    if (!bracket.matches) {
      console.log(`⏭️  Сетка "${bracket.name}" (ID: ${bracket.id}) - нет данных о командах`);
      return;
    }
    
    let matches;
    try {
      matches = JSON.parse(bracket.matches);
    } catch (e) {
      console.log(`❌ Ошибка парсинга JSON для сетки "${bracket.name}" (ID: ${bracket.id})`);
      return;
    }
    
    // Фильтруем только начальные стадии
    const filteredMatches = {};
    let hasChanges = false;
    
    Object.keys(matches).forEach(stageId => {
      if (editableStages.includes(stageId)) {
        filteredMatches[stageId] = matches[stageId];
      } else {
        hasChanges = true;
        console.log(`  🗑️  Удаляем стадию "${stageId}" из сетки "${bracket.name}"`);
      }
    });
    
    if (hasChanges) {
      // Обновляем сетку
      db.prepare('UPDATE brackets SET matches = ? WHERE id = ?')
        .run(JSON.stringify(filteredMatches), bracket.id);
      
      updatedCount++;
      console.log(`✅ Сетка "${bracket.name}" (ID: ${bracket.id}) обновлена`);
    } else {
      console.log(`⏭️  Сетка "${bracket.name}" (ID: ${bracket.id}) - изменений не требуется`);
    }
  });
  
  console.log('\n✅ Очистка завершена!');
  console.log(`📊 Обновлено сеток: ${updatedCount} из ${brackets.length}`);
  
} catch (error) {
  console.error('❌ Ошибка при очистке:', error);
} finally {
  db.close();
}
