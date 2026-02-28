// Скрипт для парсинга игроков РПЛ из SStats API
require('dotenv').config();
const fs = require('fs');

const SSTATS_API_BASE = 'https://api.sstats.net';
const LEAGUE_ID = 235; // Russian Premier League
const OUTPUT_FILE = 'names/RussianPremierLeaguePlayers.json';

async function parseRPLPlayers() {
  const apiKey = process.env.SSTATS_API_KEY;
  
  if (!apiKey) {
    console.error('❌ SSTATS_API_KEY не задан');
    return;
  }
  
  console.log('🔍 Получаем матчи РПЛ из SStats API...\n');
  
  // Получаем все матчи РПЛ за текущий сезон
  const url = `${SSTATS_API_BASE}/games/list?LeagueId=${LEAGUE_ID}&Year=2025&Limit=1000`;
  
  try {
    const response = await fetch(url, {
      headers: { 'X-API-Key': apiKey }
    });
    
    if (!response.ok) {
      console.error(`❌ Ошибка: ${response.status}`);
      return;
    }
    
    const data = await response.json();
    
    if (data.status !== 'OK') {
      console.error('❌ API вернул ошибку:', data);
      return;
    }
    
    const games = data.data || [];
    console.log(`✅ Получено матчей: ${games.length}\n`);
    
    // Собираем уникальных игроков
    const playersMap = new Map();
    let processedMatches = 0;
    
    console.log('📊 Обрабатываем матчи и извлекаем игроков...\n');
    
    for (const game of games) {
      // Получаем детали матча для получения составов
      const detailUrl = `${SSTATS_API_BASE}/Games/${game.id}`;
      
      try {
        const detailResponse = await fetch(detailUrl, {
          headers: { 'X-API-Key': apiKey }
        });
        
        if (!detailResponse.ok) {
          console.warn(`⚠️ Не удалось получить детали матча ${game.id}`);
          continue;
        }
        
        const detailData = await detailResponse.json();
        
        if (detailData.status !== 'OK') {
          continue;
        }
        
        const matchData = detailData.data;
        const lineupPlayers = matchData.lineupPlayers || [];
        
        // Добавляем игроков в карту
        lineupPlayers.forEach(player => {
          if (player.playerName && player.playerId) {
            // Используем английское имя как ключ, русское как значение
            // Но у нас нет русских имен из API, поэтому сохраняем английские
            playersMap.set(player.playerName, player.playerName);
          }
        });
        
        processedMatches++;
        
        if (processedMatches % 10 === 0) {
          console.log(`   Обработано матчей: ${processedMatches}/${games.length}, найдено игроков: ${playersMap.size}`);
        }
        
        // Небольшая задержка чтобы не перегружать API
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.warn(`⚠️ Ошибка обработки матча ${game.id}:`, error.message);
      }
    }
    
    console.log(`\n✅ Обработано матчей: ${processedMatches}`);
    console.log(`✅ Найдено уникальных игроков: ${playersMap.size}\n`);
    
    // Загружаем существующий словарь
    let existingDict = {};
    if (fs.existsSync(OUTPUT_FILE)) {
      const fileContent = fs.readFileSync(OUTPUT_FILE, 'utf-8');
      existingDict = JSON.parse(fileContent);
      console.log(`📖 Загружен существующий словарь: ${Object.keys(existingDict).length} записей`);
    }
    
    // Объединяем с новыми данными (приоритет у существующих)
    const mergedDict = { ...Object.fromEntries(playersMap), ...existingDict };
    
    // Сортируем по алфавиту
    const sortedDict = Object.keys(mergedDict)
      .sort()
      .reduce((acc, key) => {
        acc[key] = mergedDict[key];
        return acc;
      }, {});
    
    // Сохраняем в файл
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(sortedDict, null, 2), 'utf-8');
    
    console.log(`\n✅ Словарь обновлен: ${Object.keys(sortedDict).length} записей`);
    console.log(`📁 Файл сохранен: ${OUTPUT_FILE}`);
    
    // Показываем примеры новых игроков
    const newPlayers = Array.from(playersMap.keys()).filter(name => !existingDict[name]);
    if (newPlayers.length > 0) {
      console.log(`\n🆕 Добавлено новых игроков: ${newPlayers.length}`);
      console.log('Примеры:');
      newPlayers.slice(0, 10).forEach(name => console.log(`  - ${name}`));
      if (newPlayers.length > 10) {
        console.log(`  ... и еще ${newPlayers.length - 10}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

parseRPLPlayers();
