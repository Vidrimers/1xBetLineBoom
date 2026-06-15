import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { db } from '../database/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { notifyAdmin } from '../services/notificationService.js';
import { SSTATS_API_KEY, SSTATS_API_BASE, SSTATS_LEAGUE_MAPPING, COMPETITION_DICTIONARY_MAPPING, PLAYERS_DICTIONARY_MAPPING, ICON_TO_COMPETITION, ROOT_DIR } from '../config.js';
import { normalizeTeamNameForAPI, translateTeamNameToEnglish, normalizeTeamName, getMatchStatus } from '../utils/helpers.js';

const router = Router();

router.get("/api/fd-matches", async (req, res) => {
  try {
    const { competition, dateFrom, dateTo, includeFuture } = req.query;
    if (!competition || !dateFrom || !dateTo) {
      return res
        .status(400)
        .json({ error: "Отсутствуют параметры competition/dateFrom/dateTo" });
    }

    const apiKey = process.env.SSTATS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }

    // Получаем League ID из маппинга
    const leagueId = SSTATS_LEAGUE_MAPPING[competition];
    if (!leagueId) {
      return res.status(400).json({ error: `Неизвестный турнир: ${competition}` });
    }

    // Определяем год для запроса к API
    const dateFromObj = new Date(dateFrom);
    let year = dateFromObj.getFullYear();
    
    // Для сезонных турниров (лиги) используем год начала сезона
    // Для кубковых турниров (WC, EC) используем год проведения
    const cupTournaments = ['WC', 'EC']; // World Cup, Euro Championship
    
    if (!cupTournaments.includes(competition)) {
      // Для лиг: если дата в первой половине года (январь-июль),
      // это продолжение сезона который начался в прошлом году
      if (dateFromObj.getMonth() < 7) {
        year = year - 1;
      }
    }

    // Запрос списка матчей к SStats API (параметры с большой буквы!)
    // Получаем весь сезон/турнир, фильтрацию по датам делаем на сервере
    const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&Year=${year}`;
    
    console.log(`📊 SStats API запрос для ${competition}: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SStats API ошибка: ${response.status} - ${errorText}`);
      return res
        .status(response.status)
        .json({ error: errorText || response.statusText });
    }

    const sstatsData = await response.json();
    
    if (sstatsData.status !== "OK") {
      console.error(`❌ SStats API статус не OK:`, sstatsData);
      return res.status(500).json({ error: "SStats API вернул ошибку" });
    }

    console.log(`✅ SStats API: получено ${sstatsData.count} матчей за сезон`);

    // Фильтруем по датам и статусу на сервере
    const filteredGames = (sstatsData.data || []).filter(game => {
      // Если includeFuture=true, пропускаем все матчи
      // Если includeFuture=false, только завершенные (status: 8, 9, 10 = Finished, After ET, After Penalties)
      // Исключаем специальные статусы: 13=Прерван, 14=Перенесён, 15=Отменён, 17=Техническое поражение, 18=Walkover
      const specialStatuses = [13, 14, 15, 17, 18];
      if (specialStatuses.includes(game.status)) return false; // Не показываем отменённые/перенесённые матчи
      
      if (includeFuture !== 'true' && ![8, 9, 10].includes(game.status)) return false;
      
      // Проверяем что дата матча в нужном диапазоне
      const gameDate = game.date.split('T')[0]; // Берем только дату без времени
      return gameDate >= dateFrom && gameDate <= dateTo;
    });
    
    const statusText = includeFuture === 'true' ? 'всех' : 'завершенных';
    console.log(`✅ Из них ${statusText} в диапазоне ${dateFrom} - ${dateTo}: ${filteredGames.length} матчей`);

    // Предупреждение для RPL о проблеме с датами в SStats API
    if (leagueId === 235) {
      console.warn(`⚠️ ВНИМАНИЕ: SStats API для RPL возвращает неточные даты матчей. Рекомендуется проверить и скорректировать даты вручную после парсинга.`);
    }

    // Преобразуем в формат SStats для совместимости с фронтом
    const matches = filteredGames.map(game => {
      // Обрабатываем название тура
      let roundName = game.roundName || game.round || game.stage || null;
      
      // Убираем "Regular Season -" и оставляем только "Тур X"
      if (roundName && roundName.includes('Regular Season -')) {
        roundName = 'Тур ' + roundName.replace('Regular Season -', '').trim();
      }
      // Заменяем "Group Stage -" на "Групповой этап"
      else if (roundName && roundName.includes('Group Stage -')) {
        roundName = 'Групповой этап ' + roundName.replace('Group Stage -', '').trim();
      }
      // Заменяем "League Stage -" на "Тур"
      else if (roundName && roundName.includes('League Stage -')) {
        roundName = 'Тур ' + roundName.replace('League Stage -', '').trim();
      }
      
      return {
        id: game.id,
        utcDate: game.date,
        status: [8, 9, 10].includes(game.status) ? 'FINISHED' : 
                [11, 12, 13, 14, 15].includes(game.status) ? 'CANCELLED' : 'SCHEDULED',
        round: roundName,
        homeTeam: {
          id: game.homeTeam.id,
          name: game.homeTeam.name,
          shortName: game.homeTeam.name
        },
        awayTeam: {
          id: game.awayTeam.id,
          name: game.awayTeam.name,
          shortName: game.awayTeam.name
        },
        score: {
          fullTime: {
            home: game.homeResult || null,
            away: game.awayResult || null
          }
        }
      };
    });

    // Возвращаем в том же формате что и SStats
    res.json({ matches });

  } catch (error) {
    console.error("❌ /api/fd-matches ошибка:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sstats-teams - Получить список команд из SStats для маппинга
router.get("/api/sstats-teams", async (req, res) => {
  try {
    const { competition, season } = req.query;
    
    if (!competition) {
      return res.status(400).json({ error: "Требуется параметр competition" });
    }

    const apiKey = process.env.SSTATS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }

    const leagueId = SSTATS_LEAGUE_MAPPING[competition];
    if (!leagueId) {
      return res.status(400).json({ error: `Неизвестный турнир: ${competition}` });
    }

    const year = season || new Date().getFullYear();
    
    // Запрос к SStats API для получения команд лиги
    const url = `${SSTATS_API_BASE}/Leagues/${leagueId}/Standings?year=${year}`;
    
    console.log(`📊 SStats API запрос команд: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SStats API ошибка: ${response.status} - ${errorText}`);
      return res.status(response.status).json({ error: errorText || response.statusText });
    }

    const sstatsData = await response.json();
    
    if (sstatsData.status !== "OK") {
      console.error(`❌ SStats API статус не OK:`, sstatsData);
      return res.status(500).json({ error: "SStats API вернул ошибку" });
    }

    // Извлекаем уникальные названия команд
    const teams = new Set();
    if (sstatsData.data && Array.isArray(sstatsData.data)) {
      sstatsData.data.forEach(standing => {
        if (standing.team && standing.team.name) {
          teams.add(standing.team.name);
        }
      });
    }

    const teamsList = Array.from(teams).sort();
    
    console.log(`✅ SStats API: получено ${teamsList.length} команд для ${competition}`);

    res.json({ 
      competition,
      leagueId,
      year,
      teams: teamsList 
    });

  } catch (error) {
    console.error("❌ /api/sstats-teams ошибка:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/live-matches - Получить live матчи для турнира на сегодня
router.get("/api/live-matches", async (req, res) => {
  console.log(`🔍 /api/live-matches запрос получен, eventId: ${req.query.eventId}`);
  
  try {
    const { eventId } = req.query;
    
    if (!eventId) {
      console.error(`❌ eventId не указан`);
      return res.status(400).json({ error: "Не указан eventId" });
    }
    
    const apiKey = process.env.SSTATS_API_KEY;
    if (!apiKey) {
      console.error(`❌ SSTATS_API_KEY не задан в переменных окружения`);
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }
    
    // Получаем информацию о турнире из БД
    console.log(`📊 Получение турнира из БД, eventId: ${eventId}`);
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
    if (!event) {
      console.error(`❌ Турнир не найден в БД, eventId: ${eventId}`);
      return res.status(404).json({ error: "Турнир не найден" });
    }
    
    console.log(`✅ Турнир найден: ${event.name}`);
    
    // Определяем код турнира по иконке (используем глобальный маппинг)
    console.log(`🔍 Определение кода турнира по иконке: "${event.icon}"`);
    
    let competition = ICON_TO_COMPETITION[event.icon] || null;
    
    // Если не удалось определить по иконке, пробуем по названию (fallback)
    if (!competition) {
      console.log(`⚠️ Иконка не в маппинге, пробуем определить по названию`);
      const eventName = event.name.toLowerCase();
      
      if (eventName.includes('champions') || eventName.includes('лига чемпионов')) {
        competition = 'CL';
      } else if (eventName.includes('europa') || eventName.includes('лига европы')) {
        competition = 'EL';
      } else if (eventName.includes('serie a') || eventName.includes('серия а')) {
        competition = 'SA';
      } else if (eventName.includes('premier') && eventName.includes('england')) {
        competition = 'PL';
      } else if (eventName.includes('bundesliga') || eventName.includes('бундеслига')) {
        competition = 'BL1';
      } else if (eventName.includes('la liga') || eventName.includes('ла лига')) {
        competition = 'PD';
      } else if (eventName.includes('ligue 1') || eventName.includes('лига 1')) {
        competition = 'FL1';
      } else if (eventName.includes('eredivisie') || eventName.includes('эредивизи')) {
        competition = 'DED';
      } else if (eventName.includes('рпл') || (eventName.includes('премьер') && eventName.includes('росс'))) {
        competition = 'RPL';
      }
    }
    
    console.log(`🎯 Определен код турнира: ${competition || 'НЕ ОПРЕДЕЛЕН'}`);
    
    if (!competition) {
      console.log(`ℹ️ Турнир не поддерживается SStats API: ${event.name} - возвращаем пустой массив`);
      return res.json({ matches: [] }); // Тихо возвращаем пустой массив без ошибки
    }
    
    const leagueId = SSTATS_LEAGUE_MAPPING[competition];
    console.log(`🆔 League ID для ${competition}: ${leagueId}`);
    
    if (!leagueId) {
      console.log(`ℹ️ League ID не найден для ${competition} - возвращаем пустой массив`);
      return res.json({ matches: [] }); // Тихо возвращаем пустой массив без ошибки
    }
    
    // Загружаем словарь команд для турнира
    const mappingFiles = {
      'SA': path.join(ROOT_DIR, 'names', 'SerieA.json'),
      'PL': path.join(ROOT_DIR, 'names', 'PremierLeague.json'),
      'BL1': path.join(ROOT_DIR, 'names', 'Bundesliga.json'),
      'PD': path.join(ROOT_DIR, 'names', 'LaLiga.json'),
      'FL1': path.join(ROOT_DIR, 'names', 'Ligue1.json'),
      'DED': path.join(ROOT_DIR, 'names', 'Eredivisie.json'),
      'CL': path.join(ROOT_DIR, 'names', 'LeagueOfChampionsTeams.json'),
      'EL': path.join(ROOT_DIR, 'names', 'EuropaLeague.json'),
      'ECL': path.join(ROOT_DIR, 'names', 'ConferenceLeague.json'),
      'RPL': path.join(ROOT_DIR, 'names', 'RussianPremierLeague.json')
    };
    
    let teamMapping = {}; // Русское -> Английское
    let reverseMapping = {}; // Английское -> Русское
    const mappingFile = mappingFiles[competition];
    if (mappingFile) {
      try {
        console.log(`📂 Попытка загрузить словарь: ${mappingFile}`);
        
        // Проверяем существование файла
        if (!fs.existsSync(mappingFile)) {
          console.warn(`⚠️ Файл словаря не найден: ${mappingFile}`);
        } else {
          const fileContent = fs.readFileSync(mappingFile, 'utf8');
          const mappingData = JSON.parse(fileContent);
          teamMapping = mappingData.teams || mappingData || {};
          
          // Создаем обратный маппинг: Английское -> Русское
          reverseMapping = {};
          for (const [russian, english] of Object.entries(teamMapping)) {
            if (english && typeof english === 'string') {
              reverseMapping[english.toLowerCase()] = russian;
            }
          }
          
          console.log(`📖 Загружен словарь команд для ${competition}: ${Object.keys(teamMapping).length} команд`);
        }
      } catch (error) {
        console.error(`❌ Ошибка загрузки словаря для ${competition}:`, error.message);
        console.error(`❌ Stack trace:`, error.stack);
      }
    }
    
    // Функция для перевода английского названия в русское
    const translateTeam = (teamName) => {
      if (!teamName) return 'Команда';
      
      const nameLower = teamName.toLowerCase().trim();
      
      // 1. Ищем точное совпадение в обратном маппинге
      if (reverseMapping[nameLower]) {
        return reverseMapping[nameLower];
      }
      
      // 2. Убираем распространенные суффиксы/префиксы и ищем снова
      const cleanName = nameLower
        .replace(/\b(fc|ac|as|us|ss|afc|bsc|fk|gk|gnk|sk|cf|cd|rc|rcd|ud|sd)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (reverseMapping[cleanName]) {
        return reverseMapping[cleanName];
      }
      
      // 3. Ищем частичное совпадение (команда содержит ключевое слово)
      for (const [englishLower, russian] of Object.entries(reverseMapping)) {
        const cleanEnglish = englishLower
          .replace(/\b(fc|ac|as|us|ss|afc|bsc|fk|gk|gnk|sk|cf|cd|rc|rcd|ud|sd)\b/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        // Проверяем точное совпадение очищенных названий
        if (cleanName === cleanEnglish) {
          return russian;
        }
        
        // Проверяем вхождение (для длинных названий)
        if (cleanName.length > 4 && cleanEnglish.length > 4) {
          if (cleanName.includes(cleanEnglish) || cleanEnglish.includes(cleanName)) {
            return russian;
          }
        }
      }
      
      // 4. Если не нашли в JSON, возвращаем оригинал (он будет обработан dict.js на клиенте)
      return teamName;
    };
    
    // Определяем диапазон дат для запроса (сегодня)
    const now = new Date();
    const today = now.toISOString().slice(0, 10); // "2026-01-21"
    const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10); // "2026-01-22"
    
    console.log(`🗓️ Запрос матчей за период: ${today} - ${tomorrow}`);
    
    // Используем фильтр по дате вместо Year для оптимизации
    const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&From=${today}&To=${tomorrow}`;
    
    console.log(`📊 SStats API запрос live матчей для ${event.name}: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SStats API ошибка: ${response.status} - ${errorText}`);
      return res.status(response.status).json({ error: errorText || response.statusText });
    }
    
    const sstatsData = await response.json();
    
    if (sstatsData.status !== "OK") {
      console.error(`❌ SStats API статус не OK:`, sstatsData);
      return res.status(500).json({ error: "SStats API вернул ошибку" });
    }
    
    console.log(`📊 Всего матчей получено от API: ${sstatsData.data?.length || 0}`);
    
    // Матчи уже отфильтрованы по дате в запросе, просто преобразуем их
    const todayMatches = sstatsData.data || [];
    
    console.log(`✅ Матчей на сегодня: ${todayMatches.length}`);
    if (todayMatches.length > 0) {
      console.log('Примеры матчей:', todayMatches.slice(0, 3).map(g => ({
        date: g.date,
        teams: `${g.homeTeam?.name} vs ${g.awayTeam?.name}`,
        status: g.statusName
      })));
    }
    
    // Преобразуем в формат нашего приложения с переводом названий
    const matches = todayMatches.map(game => {
      const originalTeam1 = game.homeTeam?.name || 'Команда 1';
      const originalTeam2 = game.awayTeam?.name || 'Команда 2';
      const translatedTeam1 = translateTeam(originalTeam1);
      const translatedTeam2 = translateTeam(originalTeam2);
      
      // Предупреждение если перевод не найден убрано — перевод работает корректно
      
      return {
        id: game.id,
        event_id: parseInt(eventId),
        team1: translatedTeam1,
        team2: translatedTeam2,
        team1_original: originalTeam1,
        team2_original: originalTeam2,
        match_time: game.date,
        status: game.statusName?.includes('Finished') ? 'finished' : 
                game.statusName === 'Not Started' ? 'scheduled' :
                game.statusName === 'Postponed' ? 'postponed' :
                game.statusName === 'Cancelled' ? 'cancelled' :
                game.statusName === 'Abandoned' ? 'abandoned' :
                game.statusName === 'Technical Loss' ? 'technical_loss' :
                game.statusName === 'Walk Over' ? 'walkover' :
                'live',
        score: game.homeResult !== null && game.awayResult !== null 
          ? `${game.homeResult}:${game.awayResult}` 
          : null,
        elapsed: game.elapsed || null,
        statusName: game.statusName
      };
    });
    
    console.log(`✅ Найдено ${matches.length} матчей на сегодня для ${event.name}`);
    if (matches.length > 0) {
      console.log('📋 Все матчи с переводом:');
      matches.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m.team1_original} -> ${m.team1} vs ${m.team2_original} -> ${m.team2} (status: ${m.statusName})`);
      });
    }
    
    res.json({ matches });
    
  } catch (error) {
    console.error("❌ /api/live-matches критическая ошибка:", error.message);
    console.error("❌ Stack trace:", error.stack);
    console.error("❌ Error details:", {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// GET /api/match-details/:matchId - Получить детальную информацию о матче из SStats
router.get("/api/match-details/:matchId", async (req, res) => {
  console.log(`🔍 /api/match-details запрос получен, matchId: ${req.params.matchId}`);
  
  try {
    const { matchId } = req.params;
    
    if (!matchId) {
      return res.status(400).json({ error: "Не указан matchId" });
    }
    
    const apiKey = process.env.SSTATS_API_KEY;
    if (!apiKey) {
      console.error(`❌ SSTATS_API_KEY не задан в переменных окружения`);
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }

    const url = `${SSTATS_API_BASE}/Games/${matchId}`;
    console.log(`📊 SStats API запрос деталей матча: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SStats API ошибка: ${response.status} - ${errorText}`);
      return res.status(response.status).json({ error: errorText || response.statusText });
    }
    
    const matchDetails = await response.json();
    
    console.log(`📦 Структура ответа:`, {
      status: matchDetails.status,
      hasData: !!matchDetails.data,
      dataKeys: matchDetails.data ? Object.keys(matchDetails.data).slice(0, 10) : []
    });
    
    if (matchDetails.status !== "OK") {
      console.error(`❌ SStats API статус не OK:`, matchDetails);
      return res.status(500).json({ error: "SStats API вернул ошибку" });
    }
    
    const data = matchDetails.data;
    console.log(`✅ Детали матча получены: ${data?.game?.homeTeam?.name || 'N/A'} vs ${data?.game?.awayTeam?.name || 'N/A'}`);
    console.log(`📊 Доступные поля:`, Object.keys(data || {}).join(', '));
    console.log(`⚽ События: ${data?.events?.length || 0}, Статистика: ${data?.statistics?.length || 0}, Игроки: ${data?.lineupPlayers?.length || 0}`);
    
    // Логируем структуру событий для отладки
    if (data?.events && data.events.length > 0) {
      console.log(`🔍 Пример события:`, JSON.stringify(data.events[0], null, 2));
      const eventsWithoutPlayer = data.events.filter(e => !e.player || !e.player.name);
      if (eventsWithoutPlayer.length > 0) {
        console.log(`⚠️ События без имени игрока (${eventsWithoutPlayer.length}):`, 
          eventsWithoutPlayer.map(e => ({ type: e.type, elapsed: e.elapsed, playerId: e.player?.id }))
        );
      }
    }
    
    res.json(data);
    
  } catch (error) {
    console.error("❌ /api/match-details ошибка:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/match-glicko/:matchId - Получить данные Glicko-2 и xG для матча
router.get("/api/match-glicko/:matchId", async (req, res) => {
  console.log(`🔍 /api/match-glicko запрос получен, matchId: ${req.params.matchId}`);
  
  try {
    const { matchId } = req.params;
    const { refresh } = req.query; // Параметр для принудительного обновления
    
    if (!matchId) {
      return res.status(400).json({ error: "Не указан matchId" });
    }
    
    // Получаем информацию о матче из БД
    const match = db.prepare('SELECT sstats_match_id, team1_name, team2_name FROM matches WHERE id = ?').get(matchId);
    
    if (!match || !match.sstats_match_id) {
      console.error(`❌ Матч не найден или нет sstats_match_id, matchId: ${matchId}`);
      return res.status(404).json({ error: "Матч не найден или нет данных SStats" });
    }
    
    // Проверяем есть ли данные в кэше (если не запрошено обновление)
    if (refresh !== 'true') {
      const cached = db.prepare('SELECT * FROM glicko_cache WHERE match_id = ?').get(matchId);
      
      if (cached) {
        console.log(`✅ Данные Glicko-2 получены из кэша для матча ${match.team1_name} vs ${match.team2_name}`);
        return res.json({
          matchId: matchId,
          sstatsMatchId: match.sstats_match_id,
          team1: match.team1_name,
          team2: match.team2_name,
          glicko: {
            homeRating: cached.home_rating,
            awayRating: cached.away_rating,
            homeXg: cached.home_xg,
            awayXg: cached.away_xg,
            homeWinProbability: cached.home_win_probability,
            awayWinProbability: cached.away_win_probability
          },
          cached: true,
          cachedAt: cached.cached_at
        });
      }
    }
    
    // Если данных нет в кэше или запрошено обновление - загружаем из API
    const apiKey = process.env.SSTATS_API_KEY;
    if (!apiKey) {
      console.error(`❌ SSTATS_API_KEY не задан в переменных окружения`);
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }
    
    const url = `${SSTATS_API_BASE}/Games/glicko/${match.sstats_match_id}`;
    console.log(`📊 SStats API запрос Glicko-2: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SStats API ошибка: ${response.status} - ${errorText}`);
      return res.status(response.status).json({ error: errorText || response.statusText });
    }
    
    const glickoData = await response.json();
    
    if (glickoData.status !== "OK") {
      console.error(`❌ SStats API статус не OK:`, glickoData);
      
      // Если это ошибка "отсутствует Glicko аналитика" - возвращаем специальный статус
      if (glickoData.message && glickoData.message.includes('отсутствует Glicko аналитика')) {
        return res.status(404).json({ 
          error: "Glicko аналитика пока недоступна для этого матча",
          reason: "future_match"
        });
      }
      
      return res.status(500).json({ error: "SStats API вернул ошибку" });
    }
    
    const data = glickoData.data;
    console.log(`✅ Glicko-2 данные получены из API для матча ${match.team1_name} vs ${match.team2_name}`);
    
    // Сохраняем данные в кэш
    try {
      db.prepare(`
        INSERT OR REPLACE INTO glicko_cache 
        (match_id, sstats_match_id, home_rating, away_rating, home_xg, away_xg, home_win_probability, away_win_probability, cached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        matchId,
        match.sstats_match_id,
        data.glicko?.homeRating || null,
        data.glicko?.awayRating || null,
        data.glicko?.homeXg || null,
        data.glicko?.awayXg || null,
        data.glicko?.homeWinProbability || null,
        data.glicko?.awayWinProbability || null
      );
      console.log(`💾 Данные Glicko-2 сохранены в кэш`);
    } catch (cacheError) {
      console.warn(`⚠️ Не удалось сохранить в кэш:`, cacheError.message);
    }
    
    res.json({
      matchId: matchId,
      sstatsMatchId: match.sstats_match_id,
      team1: match.team1_name,
      team2: match.team2_name,
      glicko: data.glicko,
      fixture: data.fixture,
      cached: false
    });
    
  } catch (error) {
    console.error("❌ /api/match-glicko ошибка:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/yesterday-matches - Получить завершенные матчи сгруппированные по датам
router.get("/api/yesterday-matches", async (req, res) => {
  console.log(`🔍 /api/yesterday-matches запрос получен, eventId: ${req.query.eventId}`);
  
  try {
    const { eventId } = req.query;
    
    if (!eventId) {
      return res.status(400).json({ error: "eventId обязателен" });
    }
    
    // Получаем информацию о турнире
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
    
    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }
    
    console.log(`📅 Ищем завершенные матчи сгруппированные по датам`);
    
    // Получаем все завершенные матчи
    const allMatches = db.prepare(`
      SELECT 
        m.*,
        e.name as event_name,
        DATE(m.match_date) as match_day
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.event_id = ?
        AND m.winner IS NOT NULL
      ORDER BY m.match_date DESC
    `).all(eventId);
    
    // Группируем по датам
    const matchesByDate = {};
    allMatches.forEach(match => {
      const day = match.match_day;
      if (!matchesByDate[day]) {
        matchesByDate[day] = [];
      }
      matchesByDate[day].push(match);
    });
    
    // Проверяем какие дни полностью завершены (все матчи этого дня имеют результат)
    const completedDays = [];
    
    for (const day in matchesByDate) {
      // Получаем все матчи этого дня (включая незавершенные)
      const allDayMatches = db.prepare(`
        SELECT COUNT(*) as total
        FROM matches
        WHERE event_id = ?
          AND DATE(match_date) = ?
      `).get(eventId, day);
      
      const finishedDayMatches = matchesByDate[day].length;
      
      // Если все матчи дня завершены, добавляем в список
      if (allDayMatches.total === finishedDayMatches) {
        completedDays.push({
          date: day,
          matches: matchesByDate[day]
        });
      }
    }
    
    console.log(`✅ Найдено полностью завершенных дней: ${completedDays.length}`);
    
    // Автоматически заполняем sstats_match_id и счет для матчей
    let matchesWithoutSstatsId = 0;
    let matchesWithoutScore = 0;
    let matchesUpdated = 0;
    
    for (const day of completedDays) {
      for (const match of day.matches) {
        if (!match.sstats_match_id) {
          matchesWithoutSstatsId++;
        }
        // Проверяем матчи с sstats_match_id, но без счета
        if (match.sstats_match_id && (match.team1_score === null || match.team2_score === null)) {
          matchesWithoutScore++;
        }
      }
    }
    
    // Если есть матчи без счета, но с sstats_match_id - загружаем счет напрямую
    if (matchesWithoutScore > 0) {
      console.log(`⚠️ Найдено ${matchesWithoutScore} матчей с sstats_match_id, но без счета, загружаем счет...`);
      
      for (const day of completedDays) {
        for (const match of day.matches) {
          if (match.sstats_match_id && (match.team1_score === null || match.team2_score === null)) {
            try {
              const url = `${SSTATS_API_BASE}/Games/${match.sstats_match_id}`;
              const response = await fetch(url, {
                headers: { "X-API-Key": SSTATS_API_KEY }
              });
              
              if (response.ok) {
                const matchDetails = await response.json();
                if (matchDetails.status === "OK" && matchDetails.data?.game) {
                  const homeScore = matchDetails.data.game.homeResult ?? null;
                  const awayScore = matchDetails.data.game.awayResult ?? null;
                  
                  if (homeScore !== null && awayScore !== null) {
                    db.prepare('UPDATE matches SET team1_score = ?, team2_score = ? WHERE id = ?')
                      .run(homeScore, awayScore, match.id);
                    
                    match.team1_score = homeScore;
                    match.team2_score = awayScore;
                    matchesUpdated++;
                    
                    console.log(`✅ Обновлен счет для матча ${match.id}: ${match.team1_name} vs ${match.team2_name} -> ${homeScore}:${awayScore}`);
                  }
                }
              }
            } catch (err) {
              console.warn(`⚠️ Ошибка загрузки счета для матча ${match.id}:`, err.message);
            }
          }
        }
      }
      
      console.log(`✅ Обновлено счетов: ${matchesUpdated} из ${matchesWithoutScore}`);
    }
    
    if (matchesWithoutSstatsId > 0) {
      console.log(`⚠️ Найдено ${matchesWithoutSstatsId} матчей без sstats_match_id, пытаемся заполнить...`);
      
      try {
        // Определяем код турнира
        const competition = ICON_TO_COMPETITION[event.icon];
        const leagueId = competition ? SSTATS_LEAGUE_MAPPING[competition] : null;
        
        if (leagueId && SSTATS_API_KEY) {
          // Загружаем словарь команд для турнира
          const mappingFiles = {
            'SA': path.join(ROOT_DIR, 'names', 'SerieA.json'),
            'PL': path.join(ROOT_DIR, 'names', 'PremierLeague.json'),
            'BL1': path.join(ROOT_DIR, 'names', 'Bundesliga.json'),
            'PD': path.join(ROOT_DIR, 'names', 'LaLiga.json'),
            'FL1': path.join(ROOT_DIR, 'names', 'Ligue1.json'),
            'DED': path.join(ROOT_DIR, 'names', 'Eredivisie.json'),
            'CL': path.join(ROOT_DIR, 'names', 'LeagueOfChampionsTeams.json'),
            'EL': path.join(ROOT_DIR, 'names', 'EuropaLeague.json'),
            'ECL': path.join(ROOT_DIR, 'names', 'ConferenceLeague.json'),
            'RPL': path.join(ROOT_DIR, 'names', 'RussianPremierLeague.json')
          };
          
          let teamMapping = {}; // Русское -> Английское
          const mappingFile = mappingFiles[competition];
          
          if (mappingFile && fs.existsSync(mappingFile)) {
            try {
              const fileContent = fs.readFileSync(mappingFile, 'utf8');
              const mappingData = JSON.parse(fileContent);
              const originalMapping = mappingData.teams || mappingData || {};
              
              // Создаем регистронезависимый маппинг
              teamMapping = {};
              for (const [russian, english] of Object.entries(originalMapping)) {
                teamMapping[russian.toLowerCase()] = english;
              }
              
              console.log(`📖 Загружен словарь команд для ${competition}: ${Object.keys(teamMapping).length} команд`);
            } catch (err) {
              console.warn(`⚠️ Ошибка загрузки словаря: ${err.message}`);
            }
          }
          
          // Функция для нормализации названия команды (убираем FC, AC и т.д.)
          const normalizeTeamName = (name) => {
            if (!name) return '';
            return name.toLowerCase()
              .replace(/\b(fc|ac|as|us|ss|afc|bsc|fk|gk|gnk|sk|cf|cd|rc|rcd|ud|sd)\b/g, '')
              .replace(/\s+/g, ' ')
              .trim();
          };
          
          // Получаем все матчи турнира из SStats API за последние 30 дней
          const endDate = new Date().toISOString().slice(0, 10);
          const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          
          const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&From=${startDate}&To=${endDate}`;
          const response = await fetch(url, {
            headers: { "X-API-Key": SSTATS_API_KEY }
          });
          
          if (response.ok) {
            const sstatsData = await response.json();
            const sstatsMatches = sstatsData.data || [];
            
            console.log(`📊 Получено ${sstatsMatches.length} матчей из SStats API`);
            
            // Логируем первые 3 матча из SStats для отладки
            if (sstatsMatches.length > 0) {
              console.log('📋 Примеры матчей из SStats API:');
              sstatsMatches.slice(0, 3).forEach((sm, idx) => {
                console.log(`  ${idx + 1}. ${sm.homeTeam?.name} vs ${sm.awayTeam?.name} (${new Date(sm.date).toLocaleDateString('ru-RU')})`);
              });
            }
            
            // Логируем первые 3 матча из БД для отладки
            const matchesToUpdate = [];
            for (const day of completedDays) {
              for (const match of day.matches) {
                if (!match.sstats_match_id) {
                  matchesToUpdate.push(match);
                }
              }
            }
            
            if (matchesToUpdate.length > 0) {
              console.log('📋 Примеры матчей из БД (требуют обновления):');
              matchesToUpdate.slice(0, 3).forEach((m, idx) => {
                console.log(`  ${idx + 1}. ${m.team1_name} vs ${m.team2_name} (${new Date(m.match_date).toLocaleDateString('ru-RU')})`);
              });
            }
            
            // Сопоставляем матчи по командам и дате
            for (const day of completedDays) {
              for (const match of day.matches) {
                if (!match.sstats_match_id) {
                  // Переводим русские названия в английские (регистронезависимо)
                  const team1English = teamMapping[match.team1_name.toLowerCase()] || match.team1_name;
                  const team2English = teamMapping[match.team2_name.toLowerCase()] || match.team2_name;
                  
                  console.log(`🔍 Перевод: "${match.team1_name}" -> "${team1English}", "${match.team2_name}" -> "${team2English}"`);
                  
                  // Нормализуем названия
                  const team1Normalized = normalizeTeamName(team1English);
                  const team2Normalized = normalizeTeamName(team2English);
                  
                  // Ищем соответствующий матч в SStats
                  const sstatsMatch = sstatsMatches.find(sm => {
                    const matchDate = new Date(match.match_date);
                    const sstatsDate = new Date(sm.date);
                    const dateDiff = Math.abs(matchDate - sstatsDate) / (1000 * 60 * 60); // разница в часах
                    
                    // Нормализуем названия из SStats
                    const sstatsTeam1 = normalizeTeamName(sm.homeTeam?.name);
                    const sstatsTeam2 = normalizeTeamName(sm.awayTeam?.name);
                    
                    // Проверяем совпадение команд (более гибкое сравнение)
                    const team1Match = 
                      sstatsTeam1.includes(team1Normalized) || 
                      team1Normalized.includes(sstatsTeam1) ||
                      sstatsTeam1 === team1Normalized ||
                      // Дополнительная проверка по первым 4 символам (для коротких названий)
                      (team1Normalized.length >= 4 && sstatsTeam1.length >= 4 && 
                       team1Normalized.substring(0, 4) === sstatsTeam1.substring(0, 4));
                    
                    const team2Match = 
                      sstatsTeam2.includes(team2Normalized) || 
                      team2Normalized.includes(sstatsTeam2) ||
                      sstatsTeam2 === team2Normalized ||
                      // Дополнительная проверка по первым 4 символам
                      (team2Normalized.length >= 4 && sstatsTeam2.length >= 4 && 
                       team2Normalized.substring(0, 4) === sstatsTeam2.substring(0, 4));
                    
                    const isMatch = dateDiff < 24 && team1Match && team2Match;
                    
                    if (dateDiff < 24 && (team1Match || team2Match)) {
                      console.log(`🔍 Частичное совпадение (дата OK, команды: ${team1Match ? '✓' : '✗'}/${team2Match ? '✓' : '✗'}): ${match.team1_name} (${team1Normalized}) vs ${match.team2_name} (${team2Normalized}) = ${sm.homeTeam?.name} (${sstatsTeam1}) vs ${sm.awayTeam?.name} (${sstatsTeam2})`);
                    }
                    
                    if (isMatch) {
                      console.log(`🎯 Найдено совпадение: ${match.team1_name} (${team1Normalized}) vs ${match.team2_name} (${team2Normalized}) = ${sm.homeTeam?.name} (${sstatsTeam1}) vs ${sm.awayTeam?.name} (${sstatsTeam2})`);
                    }
                    
                    return isMatch;
                  });
                  
                  if (sstatsMatch) {
                    // Обновляем sstats_match_id и счет в БД
                    const homeScore = sstatsMatch.homeResult ?? null;
                    const awayScore = sstatsMatch.awayResult ?? null;
                    
                    db.prepare('UPDATE matches SET sstats_match_id = ?, team1_score = ?, team2_score = ? WHERE id = ?')
                      .run(sstatsMatch.id, homeScore, awayScore, match.id);
                    
                    match.sstats_match_id = sstatsMatch.id; // Обновляем в текущем объекте
                    match.team1_score = homeScore; // Обновляем счет
                    match.team2_score = awayScore; // Обновляем счет
                    
                    matchesUpdated++;
                    console.log(`✅ Обновлен sstats_match_id и счет для матча ${match.id}: ${match.team1_name} vs ${match.team2_name} -> ${sstatsMatch.id} (${homeScore}:${awayScore})`);
                  } else {
                    console.log(`❌ Не найдено совпадение для: ${match.team1_name} (${team1Normalized}) vs ${match.team2_name} (${team2Normalized}), дата: ${new Date(match.match_date).toLocaleDateString('ru-RU')}`);
                    
                    // Показываем ближайшие матчи по дате для отладки
                    const matchDate = new Date(match.match_date);
                    const nearbyMatches = sstatsMatches.filter(sm => {
                      const sstatsDate = new Date(sm.date);
                      const dateDiff = Math.abs(matchDate - sstatsDate) / (1000 * 60 * 60);
                      return dateDiff < 48; // В пределах 48 часов
                    }).slice(0, 3);
                    
                    if (nearbyMatches.length > 0) {
                      console.log(`  📅 Ближайшие матчи по дате:`);
                      nearbyMatches.forEach(sm => {
                        const sstatsTeam1 = normalizeTeamName(sm.homeTeam?.name);
                        const sstatsTeam2 = normalizeTeamName(sm.awayTeam?.name);
                        console.log(`    - ${sm.homeTeam?.name} (${sstatsTeam1}) vs ${sm.awayTeam?.name} (${sstatsTeam2}), дата: ${new Date(sm.date).toLocaleDateString('ru-RU')}`);
                      });
                    }
                  }
                }
              }
            }
            
            console.log(`✅ Обновлено ${matchesUpdated} из ${matchesWithoutSstatsId} матчей`);
          }
        }
      } catch (err) {
        console.warn('⚠️ Не удалось автоматически заполнить sstats_match_id:', err.message);
      }
    }
    
    // Логируем первые несколько матчей для отладки
    if (completedDays.length > 0 && completedDays[0].matches.length > 0) {
      console.log('📋 Пример матча из completedDays:', {
        id: completedDays[0].matches[0].id,
        sstats_match_id: completedDays[0].matches[0].sstats_match_id,
        team1_name: completedDays[0].matches[0].team1_name,
        team2_name: completedDays[0].matches[0].team2_name,
        team1_score: completedDays[0].matches[0].team1_score,
        team2_score: completedDays[0].matches[0].team2_score,
        winner: completedDays[0].matches[0].winner
      });
    }
    
    res.json({ 
      event: event, 
      completedDays: completedDays 
    });
    
  } catch (error) {
    console.error(`❌ /api/yesterday-matches критическая ошибка: ${error.message}`);
    console.error(`❌ Stack trace:`, error.stack);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/fill-upcoming-sstats-ids - Заполнить sstats_match_id для будущих матчей конкретного тура
router.post("/api/admin/fill-upcoming-sstats-ids", async (req, res) => {
  console.log(`🔍 /api/admin/fill-upcoming-sstats-ids запрос получен`);
  
  try {
    const { eventId, round } = req.body;
    
    if (!eventId) {
      return res.status(400).json({ error: "eventId обязателен" });
    }
    
    const apiKey = process.env.SSTATS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }
    
    // Получаем информацию о турнире
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
    
    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }
    
    // Получаем leagueId и year из event
    const leagueId = event.sstats_league_id;
    const year = event.year;
    
    if (!leagueId || !year) {
      return res.status(400).json({ error: "У турнира не указан sstats_league_id или year" });
    }
    
    // Загружаем словарь команд для перевода названий
    let teamTranslations = {};
    const dictionaryFile = event.team_file; // Используем team_file из events
    
    if (dictionaryFile) {
      try {
        const fs = await import('fs/promises');
        const dictData = JSON.parse(await fs.readFile(dictionaryFile, 'utf-8'));
        teamTranslations = dictData.teams || {};
        console.log(`✅ Загружен словарь команд: ${Object.keys(teamTranslations).length} команд`);
      } catch (err) {
        console.warn(`⚠️ Не удалось загрузить словарь из ${dictionaryFile}:`, err.message);
      }
    }
    
    // Функция для перевода названия команды из русского в английский
    const translateTeamName = (russianName) => {
      return teamTranslations[russianName] || russianName;
    };
    
    console.log(`📅 Ищем будущие матчи без sstats_match_id для турнира ${event.name}${round ? `, тур: ${round}` : ''}`);
    
    // Получаем будущие матчи без sstats_match_id (опционально фильтруем по туру)
    let query = `
      SELECT *
      FROM matches
      WHERE event_id = ?
        AND sstats_match_id IS NULL
        AND match_date > datetime('now')
    `;
    
    const params = [eventId];
    
    if (round && round !== 'all') {
      query += ` AND round = ?`;
      params.push(round);
    }
    
    query += ` ORDER BY match_date ASC`;
    
    const upcomingMatches = db.prepare(query).all(...params);
    
    if (upcomingMatches.length === 0) {
      console.log(`✅ Все будущие матчи${round ? ` тура ${round}` : ''} уже имеют sstats_match_id`);
      return res.json({ 
        message: `Все будущие матчи${round ? ` тура ${round}` : ''} уже имеют sstats_match_id`,
        matchesUpdated: 0
      });
    }
    
    console.log(`📊 Найдено ${upcomingMatches.length} будущих матчей без sstats_match_id`);
    
    // Определяем диапазон дат для запроса к SStats API
    const dates = upcomingMatches.map(m => new Date(m.match_date));
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    
    minDate.setDate(minDate.getDate() - 1);
    maxDate.setDate(maxDate.getDate() + 1);
    
    const dateFrom = minDate.toISOString().slice(0, 10);
    const dateTo = maxDate.toISOString().slice(0, 10);
    
    const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&From=${dateFrom}&To=${dateTo}`;
    console.log(`📊 SStats API запрос матчей для диапазона ${dateFrom} - ${dateTo}: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SStats API ошибка: ${response.status} - ${errorText}`);
      return res.status(response.status).json({ error: errorText || response.statusText });
    }
    
    const sstatsData = await response.json();
    
    if (sstatsData.status !== "OK") {
      console.error(`❌ SStats API статус не OK:`, sstatsData);
      return res.status(500).json({ error: "SStats API вернул ошибку" });
    }
    
    const sstatsMatches = sstatsData.data || [];
    console.log(`✅ SStats API: получено ${sstatsMatches.length} матчей для диапазона ${dateFrom} - ${dateTo}`);
    
    // Функция нормализации названия команды
    const normalizeTeamName = (name) => {
      if (!name) return '';
      return name
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-zа-я0-9]/g, '');
    };
    
    let matchesUpdated = 0;
    
    // Для каждого матча из БД ищем совпадение в SStats
    for (const match of upcomingMatches) {
      // Переводим русские названия в английские
      const team1English = translateTeamName(match.team1_name);
      const team2English = translateTeamName(match.team2_name);
      
      const team1Normalized = normalizeTeamName(team1English);
      const team2Normalized = normalizeTeamName(team2English);
      const matchDate = new Date(match.match_date);
      
      console.log(`🔍 Ищем: ${match.team1_name} (${team1English}) vs ${match.team2_name} (${team2English})`);
      
      // Ищем совпадение по командам и дате (в пределах 24 часов)
      const sstatsMatch = sstatsMatches.find(sm => {
        const sstatsTeam1 = normalizeTeamName(sm.homeTeam?.name);
        const sstatsTeam2 = normalizeTeamName(sm.awayTeam?.name);
        const sstatsDate = new Date(sm.date);
        const dateDiff = Math.abs(matchDate - sstatsDate) / (1000 * 60 * 60); // разница в часах
        
        // Проверяем совпадение команд (с учетом частичного совпадения)
        const team1Match = 
          sstatsTeam1.includes(team1Normalized) || 
          team1Normalized.includes(sstatsTeam1) ||
          sstatsTeam1 === team1Normalized ||
          (team1Normalized.length >= 4 && sstatsTeam1.length >= 4 && 
           team1Normalized.substring(0, 4) === sstatsTeam1.substring(0, 4));
        
        const team2Match = 
          sstatsTeam2.includes(team2Normalized) || 
          team2Normalized.includes(sstatsTeam2) ||
          sstatsTeam2 === team2Normalized ||
          (team2Normalized.length >= 4 && sstatsTeam2.length >= 4 && 
           team2Normalized.substring(0, 4) === sstatsTeam2.substring(0, 4));
        
        const isMatch = dateDiff < 24 && team1Match && team2Match;
        
        if (dateDiff < 24 && (team1Match || team2Match)) {
          console.log(`  🔍 Частичное совпадение: ${sm.homeTeam?.name} vs ${sm.awayTeam?.name} (дата OK: ${dateDiff.toFixed(1)}ч, команды: ${team1Match ? '✓' : '✗'}/${team2Match ? '✓' : '✗'})`);
        }
        
        return isMatch;
      });
      
      if (sstatsMatch) {
        // Обновляем sstats_match_id в БД
        db.prepare('UPDATE matches SET sstats_match_id = ? WHERE id = ?')
          .run(sstatsMatch.id, match.id);
        
        matchesUpdated++;
        console.log(`✅ Обновлен sstats_match_id для матча ${match.id}: ${match.team1_name} vs ${match.team2_name} -> ${sstatsMatch.id}`);
      } else {
        console.log(`❌ Не найдено совпадение для: ${match.team1_name} vs ${match.team2_name}, дата: ${matchDate.toLocaleDateString('ru-RU')}`);
      }
    }
    
    console.log(`✅ Обновлено ${matchesUpdated} из ${upcomingMatches.length} будущих матчей`);
    
    res.json({ 
      message: `Обновлено ${matchesUpdated} из ${upcomingMatches.length} будущих матчей`,
      matchesUpdated: matchesUpdated,
      totalMatches: upcomingMatches.length
    });
    
  } catch (error) {
    console.error(`❌ /api/admin/fill-upcoming-sstats-ids ошибка: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// getMatchStatus — перенесена в server/utils/helpers.js

// POST /api/favorite-matches - Получить данные избранных матчей
router.post("/api/favorite-matches", async (req, res) => {
  try {
    const { matchIds } = req.body;
    
    console.log('📥 /api/favorite-matches запрос:', matchIds);
    
    if (!Array.isArray(matchIds) || matchIds.length === 0) {
      return res.json({ matches: [] });
    }
    
    // Получаем матчи из базы данных (синхронно, т.к. better-sqlite3)
    const placeholders = matchIds.map(() => '?').join(',');
    const query = `
      SELECT 
        m.*,
        e.name as event_name
      FROM matches m
      LEFT JOIN events e ON m.event_id = e.id
      WHERE m.id IN (${placeholders})
    `;
    
    console.log('🔍 SQL запрос для', matchIds.length, 'матчей');
    
    const matches = db.prepare(query).all(...matchIds);
    
    console.log(`📊 Получено ${matches ? matches.length : 0} матчей из БД`);
    
    if (!matches || matches.length === 0) {
      return res.json({ matches: [] });
    }
    
    const now = new Date();
    
    // Фильтруем только LIVE матчи и форматируем данные
    const results = matches
      .filter(match => {
        // Если есть результат - матч завершен
        if (match.winner) {
          console.log(`  Матч ${match.id}: завершен (есть winner)`);
          return false;
        }
        
        // Если нет даты - пропускаем
        if (!match.match_date) {
          console.log(`  Матч ${match.id}: нет даты`);
          return false;
        }
        
        const matchDate = new Date(match.match_date);
        
        // Если дата в будущем - ожидает
        if (matchDate > now) {
          console.log(`  Матч ${match.id}: в будущем`);
          return false;
        }
        
        // Проверяем что матч не слишком старый (максимум 3 часа с начала)
        const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
        if (matchDate < threeHoursAgo) {
          console.log(`  Матч ${match.id}: слишком старый (больше 3 часов)`);
          return false;
        }
        
        // Если дата прошла, но нет результата и прошло меньше 3 часов - идет (LIVE)
        console.log(`  Матч ${match.id}: LIVE ✅`);
        return true;
      })
      .map(match => {
        return {
          id: match.id,
          team1: match.team1_name,
          team2: match.team2_name,
          score: match.score || '0:0',
          status: 'live',
          elapsed: null,
          event_name: match.event_name
        };
      });
    
    console.log(`✅ Найдено ${results.length} LIVE матчей из ${matchIds.length} избранных`);
    res.json({ matches: results });
    
  } catch (error) {
    console.error("❌ /api/favorite-matches общая ошибка:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/check-match-events - Проверить события матчей и отправить уведомления
router.post("/api/check-match-events", async (req, res) => {
  try {
    const { matchIds, userId } = req.body;
    
    if (!Array.isArray(matchIds) || matchIds.length === 0 || !userId) {
      return res.json({ success: false, message: 'Invalid parameters' });
    }
    
    console.log(`🔍 Проверка событий для ${matchIds.length} матчей, пользователь ${userId}`);
    
    // Получаем настройки пользователя
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!user || !user.telegram_notifications_enabled) {
      console.log(`⏭️ У пользователя ${userId} отключены уведомления`);
      return res.json({ success: true, notifications: 0 });
    }
    
    // Получаем chat_id пользователя
    const telegramUser = db.prepare(
      'SELECT chat_id FROM telegram_users WHERE telegram_username = ?'
    ).get(user.telegram_username);
    
    if (!telegramUser) {
      console.log(`⏭️ У пользователя ${userId} нет привязки Telegram`);
      return res.json({ success: true, notifications: 0 });
    }
    
    let notificationsSent = 0;
    
    // Для каждого матча проверяем события
    for (const matchId of matchIds) {
      try {
        // Получаем детали матча из SStats API
        const match = db.prepare('SELECT sstats_match_id FROM matches WHERE id = ?').get(matchId);
        
        if (!match || !match.sstats_match_id) {
          console.log(`⏭️ Матч ${matchId} не имеет sstats_match_id`);
          continue;
        }
        
        const detailsUrl = `${SSTATS_API_BASE}/Games/${match.sstats_match_id}`;
        const response = await fetch(detailsUrl, {
          headers: { 'X-API-Key': SSTATS_API_KEY }
        });
        
        if (!response.ok) {
          console.log(`⚠️ Не удалось загрузить детали матча ${matchId}`);
          continue;
        }
        
        const result = await response.json();
        const details = result.data || result;
        const events = details.events || [];
        
        // Проверяем каждое событие
        for (const event of events) {
          const eventId = `${event.id || event.elapsed}_${event.type}_${event.player?.name || 'unknown'}`;
          
          // Проверяем было ли уже отправлено уведомление
          const alreadySent = db.prepare(
            'SELECT id FROM match_events_sent WHERE match_id = ? AND event_id = ? AND user_id = ?'
          ).get(matchId, eventId, userId);
          
          if (alreadySent) {
            continue; // Уже отправляли
          }
          
          // Фильтруем только важные события: голы и карточки
          if (!['goal', 'yellowcard', 'redcard'].includes(event.type)) {
            continue;
          }
          
          // Формируем сообщение
          let message = '';
          const game = details.game;
          const matchInfo = `${game.homeTeam?.name || 'Команда 1'} ${game.homeResult || 0}:${game.awayResult || 0} ${game.awayTeam?.name || 'Команда 2'}`;
          
          if (event.type === 'goal') {
            const scorer = event.player?.name || 'Неизвестный игрок';
            const assist = event.assistPlayer?.name ? ` (ассист: ${event.assistPlayer.name})` : '';
            message = `⚽ ГОЛ!\n\n${matchInfo}\n\n${scorer} забил гол!${assist}\n⏱️ ${event.elapsed || '?'}'`;
          } else if (event.type === 'yellowcard') {
            const player = event.player?.name || 'Неизвестный игрок';
            message = `🟨 Желтая карточка\n\n${matchInfo}\n\n${player} получил предупреждение\n⏱️ ${event.elapsed || '?'}'`;
          } else if (event.type === 'redcard') {
            const player = event.player?.name || 'Неизвестный игрок';
            message = `🟥 Красная карточка!\n\n${matchInfo}\n\n${player} удален с поля!\n⏱️ ${event.elapsed || '?'}'`;
          }
          
          if (message) {
            // Отправляем уведомление через бота
            try {
              await sendTelegramMessage(telegramUser.chat_id, message);
              
              // Сохраняем что уведомление отправлено
              db.prepare(
                'INSERT INTO match_events_sent (match_id, event_id, event_type, user_id) VALUES (?, ?, ?, ?)'
              ).run(matchId, eventId, event.type, userId);
              
              notificationsSent++;
              console.log(`✅ Уведомление отправлено пользователю ${userId} о событии ${event.type} в матче ${matchId}`);
            } catch (err) {
              console.error(`❌ Ошибка отправки уведомления:`, err);
            }
          }
        }
      } catch (err) {
        console.error(`❌ Ошибка обработки матча ${matchId}:`, err);
      }
    }
    
    res.json({ success: true, notifications: notificationsSent });
    
  } catch (error) {
    console.error("❌ /api/check-match-events ошибка:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/live-matches-by-ids - Получить актуальные данные LIVE матчей по их ID из SSTATS API
router.post("/api/live-matches-by-ids", async (req, res) => {
  try {
    const { matchIds } = req.body;
    
    console.log('📥 /api/live-matches-by-ids запрос:', matchIds);
    
    if (!Array.isArray(matchIds) || matchIds.length === 0) {
      return res.json([]);
    }
    
    if (!SSTATS_API_KEY) {
      console.error(`❌ SSTATS_API_KEY не задан`);
      return res.status(500).json({ error: "SSTATS_API_KEY не задан" });
    }
    
    const allMatches = [];
    
    // Для каждого matchId получаем данные из БД
    for (const matchId of matchIds) {
      try {
        // Ищем матч по id ИЛИ по sstats_match_id (т.к. на фронте может использоваться SStats ID)
        let match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
        
        if (!match) {
          // Пробуем найти по sstats_match_id
          match = db.prepare('SELECT * FROM matches WHERE sstats_match_id = ?').get(matchId);
        }
        
        if (!match) {
          console.log(`⏭️ Матч ${matchId} не найден в БД, пробуем напрямую из SStats API...`);
          // Матч не в БД — это SStats game ID, запрашиваем напрямую из API
          try {
            const url = `${SSTATS_API_BASE}/Games/${matchId}`;
            console.log(`🔍 Прямой запрос к SStats API: ${url}`);
            const response = await fetch(url, {
              headers: { 'X-API-Key': SSTATS_API_KEY }
            });
            
            if (response.ok) {
              const result = await response.json();
              const details = result.data || result;
              const game = details.game;
              
              if (game) {
                console.log(`✅ SStats API вернул данные для матча ${matchId}: ${game.homeTeam?.name} ${game.homeResult || 0}:${game.awayResult || 0} ${game.awayTeam?.name}`);
                allMatches.push({
                  id: matchId,
                  team1: game.homeTeam?.name || 'Команда 1',
                  team2: game.awayTeam?.name || 'Команда 2',
                  homeTeam: game.homeTeam?.name || 'Команда 1',
                  awayTeam: game.awayTeam?.name || 'Команда 2',
                  score: `${game.homeResult || 0}:${game.awayResult || 0}`,
                  homeResult: game.homeResult || 0,
                  awayResult: game.awayResult || 0,
                  status: game.statusName || 'live',
                  statusName: game.statusName,
                  elapsed: game.elapsed
                });
                continue;
              }
            } else {
              console.log(`⚠️ SStats API вернул ошибку ${response.status} для матча ${matchId}`);
            }
          } catch (apiError) {
            console.log(`⚠️ Ошибка прямого запроса SStats API для матча ${matchId}: ${apiError.message}`);
          }
          continue;
        }
        
        console.log(`📊 Матч ${matchId}: DB_id=${match.id}, team1=${match.team1_name}, team2=${match.team2_name}, sstats_id=${match.sstats_match_id}, score=${match.score}`);
        
        // Если есть sstats_match_id - загружаем из API
        if (match.sstats_match_id) {
          try {
            const url = `${SSTATS_API_BASE}/Games/${match.sstats_match_id}`;
            console.log(`🔍 Загружаем из API: ${url}`);
            const response = await fetch(url, {
              headers: { 'X-API-Key': SSTATS_API_KEY }
            });
            
            if (response.ok) {
              const result = await response.json();
              const details = result.data || result;
              const game = details.game;
              
              if (game) {
                console.log(`✅ API вернул данные для матча ${matchId}: ${game.homeResult || 0}:${game.awayResult || 0}`);

                // Обновляем api_finished если матч физически завершён
                const apiFinishedStatuses = [8, 9, 10];
                if (apiFinishedStatuses.includes(game.status) && match.api_finished !== 1) {
                  db.prepare('UPDATE matches SET api_finished = 1 WHERE id = ?').run(match.id);
                  console.log(`✅ api_finished = 1 для матча ${match.id} (${match.team1_name} vs ${match.team2_name})`);
                }

                allMatches.push({
                  id: matchId, // Используем тот ID который пришел в запросе (SStats ID)
                  dbId: match.id, // ID из нашей БД
                  team1: match.team1_name, // Русское название из БД
                  team2: match.team2_name, // Русское название из БД
                  homeTeam: match.team1_name,
                  awayTeam: match.team2_name,
                  score: `${game.homeResult || 0}:${game.awayResult || 0}`,
                  homeResult: game.homeResult || 0,
                  awayResult: game.awayResult || 0,
                  status: game.statusName || 'live',
                  statusName: game.statusName,
                  elapsed: game.elapsed,
                  api_finished: apiFinishedStatuses.includes(game.status) ? 1 : 0
                });
                continue;
              }
            } else {
              console.log(`⚠️ API вернул ошибку ${response.status} для матча ${matchId}`);
            }
          } catch (apiError) {
            console.log(`⚠️ Ошибка API для матча ${matchId}: ${apiError.message}`);
          }
        }
        
        // Fallback: используем данные из БД
        console.log(`📦 Используем данные из БД для матча ${matchId}`);
        allMatches.push({
          id: matchId, // Используем тот ID который пришел в запросе
          dbId: match.id, // ID из нашей БД
          team1: match.team1_name,
          team2: match.team2_name,
          homeTeam: match.team1_name,
          awayTeam: match.team2_name,
          score: match.score || '0:0',
          homeResult: match.team1_score || 0,
          awayResult: match.team2_score || 0,
          status: match.winner ? 'Finished' : 'live',
          statusName: match.winner ? 'Finished' : 'Live',
          elapsed: null
        });
        
      } catch (error) {
        console.error(`⚠️ Ошибка обработки матча ${matchId}:`, error.message);
      }
    }
    
    console.log(`✅ Возвращаем ${allMatches.length} матчей из ${matchIds.length} запрошенных`);
    res.json(allMatches);
    
  } catch (error) {
    console.error("❌ /api/live-matches-by-ids ошибка:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/live-match-stats - Получить статистику LIVE матча
router.get("/api/live-match-stats", async (req, res) => {
  try {
    const { matchId, eventId } = req.query;
    
    if (!matchId) {
      return res.status(400).json({ error: "Требуется matchId" });
    }
    
    console.log(`📊 /api/live-match-stats запрос: matchId=${matchId}, eventId=${eventId}`);
    
    // Получаем информацию о матче из БД
    const match = db.prepare(`
      SELECT 
        m.*,
        e.name as event_name
      FROM matches m
      LEFT JOIN events e ON m.event_id = e.id
      WHERE m.id = ?
    `).get(matchId);
    
    if (!match) {
      return res.status(404).json({ error: "Матч не найден" });
    }
    
    console.log(`📋 Информация о матче из БД:`, {
      id: match.id,
      team1: match.team1_name,
      team2: match.team2_name,
      status: match.status,
      score: match.score,
      event_name: match.event_name
    });
    
    // Базовая информация о матче (всегда возвращаем)
    const result = {
      matchId: match.id,
      sstatsMatchId: match.sstats_match_id || null,
      api_finished: match.api_finished || 0,
      team1: match.team1_name,
      team2: match.team2_name,
      score: match.score || null,
      status: match.status === 'live' || match.status === 'in_progress' ? '🔴 LIVE' : 
              match.status === 'finished' ? '✅ Завершен' :
              match.status === 'cancelled' ? '❌ Отменён' :
              match.status === 'postponed' ? '⏸️ Перенесён' :
              match.status === 'abandoned' ? '⚠️ Прерван' :
              match.status === 'technical_loss' ? '⚠️ Тех. поражение' :
              match.status === 'walkover' ? '⚠️ Неявка' :
              'Предстоящий',
      matchTime: match.match_date,
      elapsed: match.elapsed || null,
      statistics: [],
      events: [],
      lineups: null
    };
    
    console.log(`✅ Базовая статистика матча ${matchId} подготовлена, отправляем клиенту`);
    res.json(result);
    
  } catch (error) {
    console.error("❌ /api/live-match-stats ошибка:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notify-live-action - Уведомить админа о действиях пользователя в LIVE
router.post("/api/notify-live-action", async (req, res) => {
  try {
    const { username, action, details } = req.body;
    
    if (!username || !action) {
      return res.status(400).json({ error: "Требуются username и action" });
    }
    
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
    
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
      console.log("⚠️ Telegram не настроен, уведомление не отправлено");
      return res.json({ success: false });
    }
    
    const time = new Date().toLocaleString("ru-RU");
    let message = '';
    
    switch (action) {
      case 'open_live_tournament':
        message = `📺 ОТКРЫТ LIVE ТУРНИР\n\n👤 Пользователь: ${username}\n🏆 Турнир: ${details.tournamentName}\n🕐 Время: ${time}`;
        break;
      case 'add_favorite':
        message = `⭐ ДОБАВЛЕН В ИЗБРАННОЕ\n\n👤 Пользователь: ${username}\n⚽ Матч: ${details.match}\n🏆 Турнир: ${details.tournamentName}\n🕐 Время: ${time}`;
        break;
      case 'remove_favorite':
        message = `💔 УДАЛЕН ИЗ ИЗБРАННОГО\n\n👤 Пользователь: ${username}\n⚽ Матч: ${details.match}\n🏆 Турнир: ${details.tournamentName}\n🕐 Время: ${time}`;
        break;
      case 'open_match_stats':
        message = `📊 ОТКРЫТА СТАТИСТИКА МАТЧА\n\n👤 Пользователь: ${username}\n⚽ Матч: ${details.match}\n🏆 Турнир: ${details.tournamentName}\n📈 Статус: ${details.status}\n🕐 Время: ${time}`;
        break;
      default:
        message = `🔔 ДЕЙСТВИЕ В LIVE\n\n👤 Пользователь: ${username}\n📝 Действие: ${action}\n🕐 Время: ${time}`;
    }
    
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_ADMIN_ID,
            text: message,
          }),
        }
      );
      
      if (response.ok) {
        console.log(`✅ Уведомление админу отправлено: ${action} от ${username}`);
        res.json({ success: true });
      } else {
        console.error(`❌ Ошибка отправки уведомления: ${response.statusText}`);
        res.json({ success: false });
      }
    } catch (error) {
      console.error("❌ Ошибка отправки уведомления:", error);
      res.json({ success: false });
    }
    
  } catch (error) {
    console.error("❌ Ошибка в /api/notify-live-action:", error);
    res.status(500).json({ error: error.message });
  }
});


// GET /api/matches/:matchId/events/players - Получить сохраненные имена игроков для событий матча
router.get("/api/matches/:matchId/events/players", async (req, res) => {
  try {
    const { matchId } = req.params;
    const events = db.prepare(`
      SELECT
        sstats_event_id,
        event_type,
        minute,
        extra_minute,
        team_id,
        player_name,
        assist_player_name
      FROM match_events
      WHERE match_id = ?
    `).all(matchId);
    res.json({ success: true, events });
  } catch (error) {
    console.error("❌ Ошибка при получении имен игроков:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
