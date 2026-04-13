import { Router } from 'express';
import { execSync } from 'child_process';
import { db } from '../database/db.js';
import { SSTATS_API_KEY, SSTATS_API_BASE } from '../config.js';
import { getAutoCountingEnabled, setAutoCountingEnabled, processedDates } from '../services/autoCountingService.js';

const router = Router();

// Эндпоинт для управления автоподсчетом
router.get("/api/admin/auto-counting-status", (req, res) => {
  const enabled = getAutoCountingEnabled();
  res.json({ enabled });
});

router.post("/api/admin/toggle-auto-counting", (req, res) => {
  const { username } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  
  if (username !== ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }
  
  const currentStatus = getAutoCountingEnabled();
  const newStatus = !currentStatus;
  setAutoCountingEnabled(newStatus);
  
  console.log(`🤖 Автоподсчет ${newStatus ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН'}`);
  
  res.json({ 
    enabled: newStatus,
    message: `Автоподсчет ${newStatus ? 'включен' : 'выключен'}`
  });
});

// Эндпоинт для получения списка обработанных дат
router.get("/api/admin/processed-dates", (req, res) => {
  try {
    const dates = db.prepare('SELECT * FROM auto_counting_processed ORDER BY date_key').all();
    res.json({ success: true, dates });
  } catch (error) {
    console.error('❌ Ошибка получения обработанных дат:', error);
    res.status(500).json({ error: error.message });
  }
});

// ВРЕМЕННЫЙ endpoint для проверки карточек из API
router.get("/api/admin/check-cards/:matchId", async (req, res) => {
  try {
    const { matchId } = req.params;
    
    // Получаем информацию о матче из БД
    const match = db.prepare(`
      SELECT m.*, e.icon
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.id = ?
    `).get(matchId);
    
    if (!match) {
      return res.status(404).json({ error: 'Матч не найден' });
    }
    
    // Получаем прогноз пользователя
    const prediction = db.prepare(`
      SELECT cp.*, u.username
      FROM cards_predictions cp
      JOIN users u ON cp.user_id = u.id
      WHERE cp.match_id = ?
    `).all(matchId);
    
    const result = {
      match: {
        id: match.id,
        team1: match.team1_name,
        team2: match.team2_name,
        date: match.match_date,
        sstats_id: match.sstats_match_id,
        yellow_cards_db: match.yellow_cards,
        red_cards_db: match.red_cards
      },
      predictions: prediction.map(p => ({
        username: p.username,
        yellow: p.yellow_cards,
        red: p.red_cards
      })),
      api_data: null
    };
    
    // Запрашиваем из API если есть sstats_match_id
    if (match.sstats_match_id) {
      const apiUrl = `${SSTATS_API_BASE}/Games/${match.sstats_match_id}`;
      console.log(`🔍 Запрос к API: ${apiUrl}`);
      
      const apiResponse = await fetch(apiUrl, {
        headers: { "X-API-Key": SSTATS_API_KEY }
      });
      
      if (apiResponse.ok) {
        const apiData = await apiResponse.json();
        const game = apiData.data?.game || apiData.game;
        
        if (game) {
          // Получаем карточки из массива events (находится в data.events)
          let yellowCards = null;
          let redCards = null;
          
          const eventsArray = apiData.data?.events || apiData.events;
          
          if (eventsArray && Array.isArray(eventsArray)) {
            yellowCards = eventsArray.filter(e => e.name === 'Yellow Card').length;
            redCards = eventsArray.filter(e => e.name === 'Red Card').length;
          }
          
          result.api_data = {
            yellow_cards: yellowCards,
            red_cards: redCards,
            status: game.status,
            statusName: game.statusName,
            homeTeam: game.homeTeam?.name,
            awayTeam: game.awayTeam?.name,
            homeResult: game.homeResult,
            awayResult: game.awayResult,
            events_count: eventsArray?.length || 0
          };
          
          // Проверяем совпадение прогнозов
          result.predictions = result.predictions.map(p => ({
            ...p,
            yellow_correct: yellowCards !== null ? p.yellow === yellowCards : null,
            red_correct: redCards !== null ? p.red === redCards : null,
            both_correct: yellowCards !== null && redCards !== null 
              ? (p.yellow === yellowCards && p.red === redCards)
              : null
          }));
        }
      } else {
        result.api_error = `HTTP ${apiResponse.status}`;
      }
    }
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ Ошибка проверки карточек:', error);
    res.status(500).json({ error: error.message });
  }
});

// Эндпоинт для очистки обработанных дат (для повторного подсчета)
router.post("/api/admin/clear-processed-dates", (req, res) => {
  const { username, dateKeys } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  
  if (username !== ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }
  
  try {
    if (!dateKeys || dateKeys.length === 0) {
      // Очищаем все даты (старое поведение)
      processedDates.clear();
      db.prepare('DELETE FROM auto_counting_processed').run();
      console.log(`🧹 Очищены все обработанные даты автоподсчета`);
      
      return res.json({ 
        success: true,
        message: 'Все обработанные даты очищены. Автоподсчет запустится заново при следующей проверке.'
      });
    }
    
    // Очищаем конкретные даты
    const deleteStmt = db.prepare('DELETE FROM auto_counting_processed WHERE date_key = ?');
    let deletedCount = 0;
    
    dateKeys.forEach(dateKey => {
      const result = deleteStmt.run(dateKey);
      deletedCount += result.changes;
      
      // Удаляем из памяти
      processedDates.delete(dateKey);
    });
    
    console.log(`🧹 Очищено ${deletedCount} обработанных дат автоподсчета`);
    
    res.json({ 
      success: true,
      message: `Очищено ${deletedCount} дат. Автоподсчет пересчитает их при следующей проверке.`,
      deletedCount
    });
  } catch (error) {
    console.error('❌ Ошибка очистки обработанных дат:', error);
    res.status(500).json({ error: error.message });
  }
});

// Эндпоинт для запуска утилитных скриптов
router.post("/api/admin/run-utility", (req, res) => {
  const { username, script, args = [] } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  
  if (username !== ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }
  
  const scriptMap = {
    'check-processed-dates': { file: 'check-processed-dates.cjs', title: 'Обработанные даты' },
    'clear-processed-dates': { file: 'clear-processed-dates.cjs', title: 'Очистка дат' },
    'check-match-dates': { file: 'check-match-dates.cjs', title: 'Даты матчей' },
    'check-event-id': { file: 'check-event-id.cjs', title: 'ID турниров' },
    'check-tables': { file: 'check-tables.js', title: 'Структура БД' },
    'check-user-settings': { file: 'check-user-settings.cjs', title: 'Настройки пользователей' },
    'deactivate-old-events': { file: 'deactivate-old-events.cjs', title: 'Деактивация турниров' },
    'enable-notifications': { file: 'enable-notifications.cjs', title: 'Включение уведомлений' },
    'enable-notifications-for-all': { file: 'enable-notifications-for-all.cjs', title: 'Уведомления для всех' },
    'update-sstats-ids': { file: 'update-sstats-ids.cjs', title: 'Обновление SStats ID' }
  };
  
  const scriptInfo = scriptMap[script];
  if (!scriptInfo) {
    return res.status(400).json({ error: 'Неизвестный скрипт' });
  }
  
  try {
    const command = `node ${scriptInfo.file} ${args.join(' ')}`;
    console.log(`🔧 Запуск утилиты: ${command}`);
    
    const result = execSync(command, { 
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 10 // 10MB
    });
    
    res.json({ 
      success: true,
      title: scriptInfo.title,
      output: result
    });
  } catch (error) {
    console.error(`❌ Ошибка запуска ${scriptInfo.file}:`, error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      output: error.stdout || error.stderr || ''
    });
  }
});

export default router;
