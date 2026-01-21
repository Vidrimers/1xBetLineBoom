// Скрипт для обновления sstats_match_id в БД из SStats API
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database('1xBetLineBoom.db');
const SSTATS_API_BASE = 'https://api.sstats.net';
const SSTATS_API_KEY = process.env.SSTATS_API_KEY;

// Маппинг иконок на коды турниров
const ICON_TO_COMPETITION = {
  'img/cups/champions-league.png': 'CL',
  'img/cups/european-league.png': 'EL',
  'img/cups/england-premier-league.png': 'PL',
  'img/cups/bundesliga.png': 'BL1',
  'img/cups/spain-la-liga.png': 'PD',
  'img/cups/serie-a.png': 'SA',
  'img/cups/france-league-ligue-1.png': 'FL1',
  'img/cups/eredivisie.png': 'DED',
  'img/cups/russian-premier-league.png': 'RPL',
  'img/cups/world-cup.png': 'WC',
  'img/cups/euro-cup.png': 'EC'
};

const SSTATS_LEAGUE_MAPPING = {
  'CL': 2,
  'EL': 3,
  'PL': 39,
  'BL1': 78,
  'PD': 140,
  'SA': 135,
  'FL1': 61,
  'DED': 88,
  'RPL': 235,
  'WC': 1,
  'EC': 4
};

async function updateMatchIds(eventId) {
  console.log(`\n🔄 Обновление sstats_match_id для турнира ${eventId}...`);
  
  // Проверяем и добавляем колонку sstats_match_id если её нет
  try {
    const tableInfo = db.prepare("PRAGMA table_info(matches)").all();
    const hasColumn = tableInfo.some(col => col.name === 'sstats_match_id');
    
    if (!hasColumn) {
      console.log('📝 Добавляем колонку sstats_match_id...');
      db.prepare('ALTER TABLE matches ADD COLUMN sstats_match_id INTEGER').run();
      console.log('✅ Колонка добавлена');
    }
  } catch (err) {
    console.error('❌ Ошибка при добавлении колонки:', err.message);
    return;
  }
  
  // Получаем турнир
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) {
    console.error('❌ Турнир не найден');
    return;
  }
  
  console.log(`📋 Турнир: ${event.name}`);
  
  // Определяем код турнира
  const competition = ICON_TO_COMPETITION[event.icon];
  if (!competition) {
    console.error('❌ Не удалось определить код турнира по иконке:', event.icon);
    return;
  }
  
  const leagueId = SSTATS_LEAGUE_MAPPING[competition];
  console.log(`🎯 Код турнира: ${competition}, League ID: ${leagueId}`);
  
  // Получаем матчи из БД за последние 7 дней
  const matches = db.prepare(`
    SELECT * FROM matches 
    WHERE event_id = ? 
      AND match_date >= date('now', '-7 days')
    ORDER BY match_date DESC
  `).all(eventId);
  
  console.log(`📊 Найдено матчей в БД: ${matches.length}`);
  
  if (matches.length === 0) {
    console.log('ℹ️ Нет матчей для обновления');
    return;
  }
  
  // Получаем матчи из SStats за последние 7 дней
  const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toDate = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  
  const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&From=${fromDate}&To=${toDate}`;
  console.log(`🌐 Запрос к SStats API: ${url}`);
  
  const response = await fetch(url, {
    headers: { 'X-API-Key': SSTATS_API_KEY }
  });
  
  if (!response.ok) {
    console.error('❌ Ошибка запроса к SStats API:', response.status);
    return;
  }
  
  const data = await response.json();
  if (data.status !== 'OK') {
    console.error('❌ SStats API вернул ошибку');
    return;
  }
  
  const sstatsMatches = data.data || [];
  console.log(`📊 Получено матчей из SStats: ${sstatsMatches.length}`);
  
  // Загружаем словарь команд для турнира
  const fs = require('fs');
  const path = require('path');
  
  const mappingFiles = {
    'SA': path.join(__dirname, 'names', 'SerieA.json'),
    'PL': path.join(__dirname, 'names', 'PremierLeague.json'),
    'BL1': path.join(__dirname, 'names', 'Bundesliga.json'),
    'PD': path.join(__dirname, 'names', 'LaLiga.json'),
    'FL1': path.join(__dirname, 'names', 'Ligue1.json'),
    'DED': path.join(__dirname, 'names', 'Eredivisie.json'),
    'CL': path.join(__dirname, 'names', 'LeagueOfChampionsTeams.json'),
    'EL': path.join(__dirname, 'names', 'EuropaLeague.json'),
    'RPL': path.join(__dirname, 'names', 'RussianPremierLeague.json'),
    'WC': path.join(__dirname, 'names', 'Countries.json'),
    'EC': path.join(__dirname, 'names', 'Countries.json')
  };
  
  let teamMapping = {}; // Русское -> Английское
  const mappingFile = mappingFiles[competition];
  
  if (mappingFile && fs.existsSync(mappingFile)) {
    const fileContent = fs.readFileSync(mappingFile, 'utf8');
    const mappingData = JSON.parse(fileContent);
    teamMapping = mappingData.teams || mappingData || {};
    console.log(`📖 Загружен словарь команд: ${Object.keys(teamMapping).length} команд`);
  }
  
  // Обновляем sstats_match_id
  let updated = 0;
  const updateStmt = db.prepare('UPDATE matches SET sstats_match_id = ? WHERE id = ?');
  
  for (const match of matches) {
    // Переводим русские названия в английские
    const team1English = teamMapping[match.team1_name] || match.team1_name;
    const team2English = teamMapping[match.team2_name] || match.team2_name;
    
    // Ищем соответствующий матч в SStats
    const sstatsMatch = sstatsMatches.find(sm => {
      const homeMatch = sm.homeTeam?.name?.toLowerCase() === team1English.toLowerCase() ||
                       sm.homeTeam?.name?.toLowerCase().includes(team1English.toLowerCase()) ||
                       team1English.toLowerCase().includes(sm.homeTeam?.name?.toLowerCase());
      const awayMatch = sm.awayTeam?.name?.toLowerCase() === team2English.toLowerCase() ||
                       sm.awayTeam?.name?.toLowerCase().includes(team2English.toLowerCase()) ||
                       team2English.toLowerCase().includes(sm.awayTeam?.name?.toLowerCase());
      
      const matchDate = new Date(match.match_date).toISOString().slice(0, 10);
      const sstatsDate = sm.date?.slice(0, 10);
      
      return homeMatch && awayMatch && matchDate === sstatsDate;
    });
    
    if (sstatsMatch) {
      updateStmt.run(sstatsMatch.id, match.id);
      console.log(`✅ ${match.team1_name} (${team1English}) vs ${match.team2_name} (${team2English}) → ID: ${sstatsMatch.id}`);
      updated++;
    } else {
      console.log(`⚠️ Не найден: ${match.team1_name} (${team1English}) vs ${match.team2_name} (${team2English})`);
    }
  }
  
  console.log(`\n✅ Обновлено матчей: ${updated} из ${matches.length}`);
}

// Запуск
const eventId = process.argv[2];

if (!eventId) {
  console.log('Использование: node update-sstats-ids.js <eventId>');
  console.log('Пример: node update-sstats-ids.js 22');
  process.exit(1);
}

updateMatchIds(parseInt(eventId))
  .then(() => {
    console.log('\n🎉 Готово!');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Ошибка:', err);
    process.exit(1);
  });
