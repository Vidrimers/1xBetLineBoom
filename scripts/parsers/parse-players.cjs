const Database = require('better-sqlite3');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Загружаем .env из корня проекта
dotenv.config({ path: path.join(__dirname, '../../.env') });

const SSTATS_API_KEY = process.env.SSTATS_API_KEY;
const SSTATS_API_BASE = "https://api.sstats.net";

// Корень проекта
const ROOT_DIR = path.join(__dirname, '../..');

// Маппинг League ID на название файла
const LEAGUE_FILES = {
  2: 'LeagueOfChampionsPlayers',    // Champions League
  3: 'EuropaLeaguePlayers',         // Europa League
  39: 'PremierLeaguePlayers',       // Premier League
  78: 'BundesligaPlayers',          // Bundesliga
  140: 'LaLigaPlayers',             // La Liga
  135: 'SerieAPlayers',             // Serie A
  61: 'Ligue1Players',              // Ligue 1
  88: 'EredivisiePlayers',          // Eredivisie
  235: 'RussianPremierLeaguePlayers' // RPL
};

async function fetchPlayers(leagueId, leagueName) {
  console.log(`\n📊 Парсинг игроков для ${leagueName} (League ID: ${leagueId})...`);
  
  try {
    // Получаем матчи за последние 30 дней
    const today = new Date();
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 30);
    
    const fromDate = monthAgo.toISOString().split('T')[0];
    const toDate = today.toISOString().split('T')[0];
    
    const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&From=${fromDate}&To=${toDate}`;
    
    console.log(`🔍 Запрос: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'X-API-Key': SSTATS_API_KEY
      }
    });
    
    if (!response.ok) {
      console.error(`❌ Ошибка: ${response.status}`);
      const errorText = await response.text();
      console.error(`❌ Ответ:`, errorText);
      return new Set();
    }
    
    const result = await response.json();
    
    console.log(`📦 Тип ответа:`, typeof result);
    console.log(`📦 Статус:`, result.status);
    console.log(`📦 Количество:`, result.count);
    
    // API возвращает объект с полем data
    const matches = result.data;
    
    if (!matches || !Array.isArray(matches)) {
      console.error(`❌ Неверный формат ответа - ожидался массив в result.data`);
      console.error(`📦 Получено:`, typeof matches);
      return new Set();
    }
    
    console.log(`✅ Получено матчей: ${matches.length}`);
    
    if (matches.length === 0) {
      console.log('⚠️ Матчей не найдено за последние 30 дней');
      return new Set();
    }
    
    const players = new Set();
    
    // Для каждого матча получаем составы
    const matchesToProcess = Math.min(matches.length, 30);
    for (let i = 0; i < matchesToProcess; i++) {
      const match = matches[i];
      console.log(`  📥 Загрузка матча ${i + 1}/${matchesToProcess}: ${match.id}`);
      
      try {
        const detailsUrl = `${SSTATS_API_BASE}/Games/${match.id}`;
        const detailsResponse = await fetch(detailsUrl, {
          headers: {
            'X-API-Key': SSTATS_API_KEY
          }
        });
        
        if (detailsResponse.ok) {
          const response = await detailsResponse.json();
          const details = response.data || response;
          
          // Логируем структуру первого матча для отладки
          if (i === 0) {
            console.log(`\n🔍 Структура данных матча ${match.id}:`);
            console.log(`  - Ключи:`, Object.keys(details));
            if (details.lineupPlayers) {
              console.log(`  - lineupPlayers длина:`, details.lineupPlayers?.length);
              if (details.lineupPlayers.length > 0) {
                console.log(`  - Пример игрока:`, JSON.stringify(details.lineupPlayers[0], null, 2));
              }
            }
            if (details.events) {
              console.log(`  - events длина:`, details.events?.length);
            }
          }
          
          // Добавляем игроков из составов
          if (details.lineupPlayers && Array.isArray(details.lineupPlayers)) {
            details.lineupPlayers.forEach(player => {
              if (player.playerName) {
                players.add(player.playerName);
              }
            });
          }
          
          // Добавляем игроков из событий
          if (details.events && Array.isArray(details.events)) {
            details.events.forEach(event => {
              if (event.player && event.player.name) {
                players.add(event.player.name);
              }
              if (event.assistPlayer && event.assistPlayer.name) {
                players.add(event.assistPlayer.name);
              }
            });
          }
        }
        
        // Задержка чтобы не перегружать API
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (err) {
        console.error(`  ⚠️ Ошибка загрузки матча ${match.id}:`, err.message);
      }
    }
    
    console.log(`✅ Найдено уникальных игроков: ${players.size}`);
    return players;
    
  } catch (error) {
    console.error(`❌ Ошибка парсинга:`, error.message);
    return new Set();
  }
}

async function main() {
  const leagueId = process.argv[2] || 2; // По умолчанию Champions League
  const leagueName = process.argv[3] || 'Champions League';
  
  console.log('🚀 Начинаем парсинг игроков из SStats API...');
  
  const players = await fetchPlayers(leagueId, leagueName);
  
  if (players.size === 0) {
    console.log('❌ Игроки не найдены');
    return;
  }
  
  // Сортируем по алфавиту
  const sortedPlayers = Array.from(players).sort();
  
  // Создаем JSON объект (пока без переводов)
  const playersObj = {};
  sortedPlayers.forEach(player => {
    playersObj[player] = player; // Пока оставляем английское имя как значение
  });
  
  // Сохраняем в файл
  const fileName = LEAGUE_FILES[leagueId] || 'Players';
  
  // Создаем директории если не существуют
  const tempDir = path.join(ROOT_DIR, 'temp');
  const parsedDir = path.join(tempDir, 'parsed');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }
  if (!fs.existsSync(parsedDir)) {
    fs.mkdirSync(parsedDir);
  }
  
  const filePath = path.join(parsedDir, `${fileName}_parsed.json`);
  
  fs.writeFileSync(filePath, JSON.stringify(playersObj, null, 2), 'utf-8');
  
  console.log(`\n✅ Готово!`);
  console.log(`📁 Файл сохранен: ${filePath}`);
  console.log(`📊 Всего игроков: ${players.size}`);
  console.log(`\n💡 Теперь нужно вручную добавить русские переводы для ключей`);
}

main().catch(console.error);
