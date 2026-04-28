import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../database/db.js';
import { notifyAdmin } from '../services/notificationService.js';
import { sendUserMessage } from '../../OnexBetLineBoombot.js';
import { ROOT_DIR } from '../config.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

router.get("/api/events/:eventId/brackets", (req, res) => {
  try {
    const { eventId } = req.params;
    const brackets = db
      .prepare("SELECT * FROM brackets WHERE event_id = ? ORDER BY created_at DESC")
      .all(eventId);
    res.json(brackets);
  } catch (error) {
    console.error("Ошибка получения сеток:", error);
    res.status(500).json({ error: error.message });
  }
});

// Получить список файлов команд из папки names
router.get("/api/team-files", (req, res) => {
  try {
    const namesDir = path.join(ROOT_DIR, 'names');
    
    // Проверяем существование папки
    if (!fs.existsSync(namesDir)) {
      return res.json([]);
    }
    
    // Читаем файлы из папки
    const files = fs.readdirSync(namesDir);
    
    // Фильтруем только нужные форматы
    const teamFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.json', '.txt', '.js'].includes(ext);
    }).map(file => ({
      name: file,
      path: `/names/${file}`
    }));
    
    res.json(teamFiles);
  } catch (error) {
    console.error("Ошибка получения списка файлов команд:", error);
    res.status(500).json({ error: error.message });
  }
});

// Получить сетку по ID
router.get("/api/brackets/:bracketId", (req, res) => {
  try {
    const { bracketId } = req.params;
    
    // Получаем сетку вместе с team_file из события
    const bracket = db
      .prepare(`
        SELECT b.*, e.team_file 
        FROM brackets b
        LEFT JOIN events e ON b.event_id = e.id
        WHERE b.id = ?
      `)
      .get(bracketId);
    
    if (!bracket) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    // Парсим matches из JSON если есть
    if (bracket.matches) {
      try {
        bracket.matches = JSON.parse(bracket.matches);
      } catch (e) {
        console.error('Ошибка парсинга matches:', e);
        bracket.matches = {};
      }
    } else {
      bracket.matches = {};
    }
    
    // Парсим lock_dates из JSON если есть
    if (bracket.lock_dates) {
      try {
        bracket.lock_dates = JSON.parse(bracket.lock_dates);
      } catch (e) {
        console.error('Ошибка парсинга lock_dates:', e);
        bracket.lock_dates = {};
      }
    } else {
      bracket.lock_dates = {};
    }
    
    // Парсим temporary_teams из JSON если есть
    if (bracket.temporary_teams) {
      try {
        bracket.temporary_teams = JSON.parse(bracket.temporary_teams);
      } catch (e) {
        console.error('Ошибка парсинга temporary_teams:', e);
        bracket.temporary_teams = {};
      }
    } else {
      bracket.temporary_teams = {};
    }
    
    res.json(bracket);
  } catch (error) {
    console.error("Ошибка получения сетки:", error);
    res.status(500).json({ error: error.message });
  }
});

// Получить прогнозы пользователя для сетки
router.get("/api/brackets/:bracketId/predictions/:userId", async (req, res) => {
  try {
    const { bracketId, userId } = req.params;
    const { viewerId, viewerUsername } = req.query; // ID и имя пользователя, который просматривает
    
    // Если просматривает не владелец прогнозов, проверяем настройки приватности
    if (viewerId && parseInt(viewerId) !== parseInt(userId)) {
      const targetUser = db
        .prepare("SELECT show_bets, username FROM users WHERE id = ?")
        .get(userId);
      
      if (!targetUser) {
        return res.status(404).json({ error: "Пользователь не найден" });
      }
      
      // Отправляем уведомление админу
      if (viewerUsername) {
        const bracket = db.prepare("SELECT b.*, e.name as event_name FROM brackets b LEFT JOIN events e ON b.event_id = e.id WHERE b.id = ?").get(bracketId);
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
        
        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
          const message = `🎯 ПРОСМОТР СЕТКИ

👤 Кто смотрит: ${viewerUsername}
🎯 Чью сетку: ${targetUser.username}
🏆 Турнир: ${bracket?.event_name || 'Неизвестно'}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

          try {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: TELEGRAM_ADMIN_ID,
                text: message,
              }),
            });
          } catch (error) {
            console.error("⚠️ Не удалось отправить уведомление о просмотре сетки:", error);
          }
        }
      }
      
      const showBets = targetUser.show_bets || 'always';
      
      // Если настройка 'after_start', проверяем даты начала стадий
      if (showBets === 'after_start') {
        const bracket = db
          .prepare("SELECT start_date, lock_dates FROM brackets WHERE id = ?")
          .get(bracketId);
        
        if (bracket) {
          const now = new Date();
          
          // Парсим lock_dates (даты блокировки для каждой стадии)
          let lockDates = {};
          if (bracket.lock_dates) {
            try {
              lockDates = JSON.parse(bracket.lock_dates);
            } catch (e) {
              console.error('Ошибка парсинга lock_dates:', e);
            }
          }
          
          // Получаем все прогнозы пользователя
          const allPredictions = db
            .prepare("SELECT * FROM bracket_predictions WHERE bracket_id = ? AND user_id = ?")
            .all(bracketId, userId);
          
          // Фильтруем прогнозы: показываем только те стадии которые уже начались
          const visiblePredictions = allPredictions.filter(pred => {
            const stageDate = lockDates[pred.stage];
            if (!stageDate) {
              // Если нет даты для стадии, используем общую дату начала сетки
              if (bracket.start_date) {
                const startDate = new Date(bracket.start_date);
                return now >= startDate;
              }
              return true; // Если вообще нет дат, показываем
            }
            
            const stageLockDate = new Date(stageDate);
            return now >= stageLockDate;
          });
          
          // Если все прогнозы скрыты, возвращаем сообщение
          if (visiblePredictions.length === 0 && allPredictions.length > 0) {
            return res.json({ 
              predictions: [], 
              hidden: true, 
              message: "Пользователь скрыл свои прогнозы до начала стадий плей-офф" 
            });
          }
          
          // Возвращаем только видимые прогнозы
          return res.json({ 
            predictions: visiblePredictions, 
            hidden: false,
            hideUnstartedStages: true // Флаг что нужно скрывать незапущенные стадии
          });
        }
      }
    }
    
    const predictions = db
      .prepare("SELECT * FROM bracket_predictions WHERE bracket_id = ? AND user_id = ?")
      .all(bracketId, userId);
    res.json({ predictions, hidden: false });
  } catch (error) {
    console.error("Ошибка получения прогнозов:", error);
    res.status(500).json({ error: error.message });
  }
});

// Сохранить прогнозы пользователя
router.post("/api/brackets/:bracketId/predictions", async (req, res) => {
  try {
    const { bracketId } = req.params;
    const { user_id, predictions } = req.body;
    
    if (!user_id || !predictions || !Array.isArray(predictions)) {
      return res.status(400).json({ error: "Неверные данные" });
    }
    
    // Проверяем, не закрыта ли сетка
    const bracket = db
      .prepare("SELECT * FROM brackets WHERE id = ?")
      .get(bracketId);
    
    if (!bracket) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    // Проверяем ручную блокировку
    if (bracket.is_locked === 1) {
      return res.status(403).json({ error: "Сетка заблокирована администратором" });
    }
    
    // Проверяем блокировку для каждой стадии отдельно
    const now = new Date();
    let lockDates = {};
    
    // Парсим lock_dates если они есть
    if (bracket.lock_dates) {
      try {
        lockDates = typeof bracket.lock_dates === 'string' 
          ? JSON.parse(bracket.lock_dates) 
          : bracket.lock_dates;
      } catch (e) {
        console.error('Ошибка парсинга lock_dates:', e);
      }
    }
    
    // Проверяем каждый прогноз на блокировку его стадии
    for (const prediction of predictions) {
      const stage = prediction.stage;
      
      // Получаем эффективную дату блокировки для стадии
      let effectiveLockDate = bracket.start_date; // Дефолтная дата
      
      if (lockDates[stage]) {
        // Если для стадии указана своя дата - используем её
        effectiveLockDate = lockDates[stage];
      } else {
        // Иначе ищем предыдущую заполненную дату
        const stageOrder = ['round_of_16', 'round_of_8', 'quarter_finals', 'semi_finals', 'final'];
        const currentIndex = stageOrder.indexOf(stage);
        
        if (currentIndex > 0) {
          for (let i = currentIndex - 1; i >= 0; i--) {
            if (lockDates[stageOrder[i]]) {
              effectiveLockDate = lockDates[stageOrder[i]];
              break;
            }
          }
        }
      }
      
      // Проверяем блокировку для этой стадии
      if (effectiveLockDate && now >= new Date(effectiveLockDate)) {
        return res.status(403).json({ 
          error: `Ставки для стадии ${stage} закрыты`,
          stage: stage
        });
      }
    }
    
    // Проверяем существующие прогнозы для определения, новые они или измененные
    const existingPredictions = {};
    predictions.forEach(p => {
      const existing = db.prepare(`
        SELECT predicted_winner FROM bracket_predictions 
        WHERE bracket_id = ? AND user_id = ? AND stage = ? AND match_index = ?
      `).get(bracketId, user_id, p.stage, p.match_index);
      
      if (existing) {
        existingPredictions[`${p.stage}_${p.match_index}`] = existing.predicted_winner;
      }
    });
    
    // Используем UPSERT для каждого прогноза (обновление или вставка)
    const upsertStmt = db.prepare(`
      INSERT INTO bracket_predictions (bracket_id, user_id, stage, match_index, predicted_winner)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(bracket_id, user_id, stage, match_index) 
      DO UPDATE SET predicted_winner = excluded.predicted_winner
    `);
    
    predictions.forEach(p => {
      upsertStmt.run(bracketId, user_id, p.stage, p.match_index, p.predicted_winner);
    });
    
    console.log(`✅ Прогнозы пользователя ${user_id} для сетки ${bracketId} сохранены`);
    
    // Отправляем уведомление пользователю в Telegram
    const user = db.prepare("SELECT username, telegram_username, telegram_notifications_enabled FROM users WHERE id = ?").get(user_id);
    
    if (user && user.telegram_username && user.telegram_notifications_enabled === 1) {
      // Получаем chat_id из telegram_users
      const cleanUsername = user.telegram_username.toLowerCase();
      const telegramUser = db.prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?").get(cleanUsername);
      
      if (telegramUser && telegramUser.chat_id) {
        // Получаем информацию о турнире
        const event = db.prepare("SELECT name FROM events WHERE id = ?").get(bracket.event_id);
        const eventName = event ? event.name : "Турнир";
        
        // Формируем текст уведомления
        const stageNames = {
          'round_of_16': '1/16 финала',
          'round_of_8': '1/8 финала',
          'quarter_finals': '1/4 финала',
          'semi_finals': '1/2 финала',
          'final': 'Финал'
        };
        
        // Разделяем на новые и измененные прогнозы
        const newPredictions = [];
        const changedPredictions = [];
        
        predictions.forEach(p => {
          const key = `${p.stage}_${p.match_index}`;
          const oldWinner = existingPredictions[key];
          
          if (oldWinner && oldWinner !== p.predicted_winner) {
            // Прогноз изменен
            changedPredictions.push({
              stage: stageNames[p.stage] || p.stage,
              oldWinner: oldWinner,
              newWinner: p.predicted_winner
            });
          } else if (!oldWinner) {
            // Новый прогноз
            newPredictions.push({
              stage: stageNames[p.stage] || p.stage,
              winner: p.predicted_winner
            });
          }
        });
        
        let message = '';
        
        if (changedPredictions.length > 0) {
          message = `🔄 Прогноз в сетке плей-офф изменен!\n\n📊 Турнир: ${eventName}\n🏆 Сетка: ${bracket.name}\n\n`;
          changedPredictions.forEach(p => {
            message += `${p.stage}:\n  ❌ Было: ${p.oldWinner}\n  ✅ Стало: ${p.newWinner}\n\n`;
          });
        } else if (newPredictions.length > 0) {
          message = `🎯 Прогноз в сетке плей-офф сохранен!\n\n📊 Турнир: ${eventName}\n🏆 Сетка: ${bracket.name}\n\n`;
          newPredictions.forEach(p => {
            message += `${p.stage}: ${p.winner}\n`;
          });
        }
        
        if (message) {
          // Отправляем уведомление пользователю через Telegram API
          const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
          if (TELEGRAM_BOT_TOKEN) {
            fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: telegramUser.chat_id,
                text: message,
                parse_mode: 'HTML'
              })
            }).catch(err => {
              console.error(`Ошибка отправки уведомления пользователю ${user_id}:`, err);
            });
          }
        }
      }
    }
    
    // Отправляем уведомление админу
    try {
      const event = db.prepare("SELECT name FROM events WHERE id = ?").get(bracket.event_id);
      const eventName = event ? event.name : "Турнир";
      
      const stageNames = {
        'round_of_16': '1/16 финала',
        'round_of_8': '1/8 финала',
        'quarter_finals': '1/4 финала',
        'semi_finals': '1/2 финала',
        'final': 'Финал'
      };
      
      // Разделяем на новые и измененные прогнозы
      const newPredictions = [];
      const changedPredictions = [];
      
      predictions.forEach(p => {
        const key = `${p.stage}_${p.match_index}`;
        const oldWinner = existingPredictions[key];
        
        if (oldWinner && oldWinner !== p.predicted_winner) {
          changedPredictions.push({
            stage: stageNames[p.stage] || p.stage,
            oldWinner: oldWinner,
            newWinner: p.predicted_winner
          });
        } else if (!oldWinner) {
          newPredictions.push({
            stage: stageNames[p.stage] || p.stage,
            winner: p.predicted_winner
          });
        }
      });
      
      let adminMessage = '';
      
      if (changedPredictions.length > 0) {
        adminMessage = `🔄 <b>Прогноз в сетке изменен</b>\n\n👤 <b>Пользователь:</b> ${user.username}\n📊 <b>Турнир:</b> ${eventName}\n🏆 <b>Сетка:</b> ${bracket.name}\n\n`;
        changedPredictions.forEach(p => {
          adminMessage += `<b>${p.stage}:</b>\n  ❌ Было: ${p.oldWinner}\n  ✅ Стало: ${p.newWinner}\n\n`;
        });
      } else if (newPredictions.length > 0) {
        adminMessage = `🎯 <b>Новый прогноз в сетке</b>\n\n👤 <b>Пользователь:</b> ${user.username}\n📊 <b>Турнир:</b> ${eventName}\n🏆 <b>Сетка:</b> ${bracket.name}\n\n`;
        newPredictions.forEach(p => {
          adminMessage += `<b>${p.stage}:</b> ${p.winner}\n`;
        });
      }
      
      if (adminMessage) {
        await notifyAdmin(adminMessage);
      }
    } catch (err) {
      console.error(`Ошибка отправки уведомления админу:`, err);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("Ошибка сохранения прогнозов:", error);
    res.status(500).json({ error: error.message });
  }
});

// Удалить прогноз пользователя
router.delete("/api/brackets/:bracketId/predictions/:userId/:stage/:matchIndex", (req, res) => {
  try {
    const { bracketId, userId, stage, matchIndex } = req.params;
    
    // Проверяем, не закрыта ли сетка
    const bracket = db
      .prepare("SELECT * FROM brackets WHERE id = ?")
      .get(bracketId);
    
    if (!bracket) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    // Проверяем ручную блокировку
    if (bracket.is_locked === 1) {
      return res.status(403).json({ error: "Сетка заблокирована администратором" });
    }
    
    // Проверяем блокировку для конкретной стадии
    const now = new Date();
    let lockDates = {};
    
    // Парсим lock_dates если они есть
    if (bracket.lock_dates) {
      try {
        lockDates = typeof bracket.lock_dates === 'string' 
          ? JSON.parse(bracket.lock_dates) 
          : bracket.lock_dates;
      } catch (e) {
        console.error('Ошибка парсинга lock_dates:', e);
      }
    }
    
    // Получаем эффективную дату блокировки для стадии
    let effectiveLockDate = bracket.start_date; // Дефолтная дата
    
    if (lockDates[stage]) {
      // Если для стадии указана своя дата - используем её
      effectiveLockDate = lockDates[stage];
    } else {
      // Иначе ищем предыдущую заполненную дату
      const stageOrder = ['round_of_16', 'round_of_8', 'quarter_finals', 'semi_finals', 'final'];
      const currentIndex = stageOrder.indexOf(stage);
      
      if (currentIndex > 0) {
        for (let i = currentIndex - 1; i >= 0; i--) {
          if (lockDates[stageOrder[i]]) {
            effectiveLockDate = lockDates[stageOrder[i]];
            break;
          }
        }
      }
    }
    
    // Проверяем блокировку для этой стадии
    if (effectiveLockDate && now >= new Date(effectiveLockDate)) {
      return res.status(403).json({ 
        error: `Ставки для стадии ${stage} закрыты`,
        stage: stage
      });
    }
    
    // Удаляем прогноз
    const result = db.prepare(`
      DELETE FROM bracket_predictions 
      WHERE bracket_id = ? AND user_id = ? AND stage = ? AND match_index = ?
    `).run(bracketId, userId, stage, matchIndex);
    
    console.log(`✅ Прогноз пользователя ${userId} для сетки ${bracketId} (${stage}, матч ${matchIndex}) удален`);
    
    // Отправляем уведомление пользователю в Telegram
    if (result.changes > 0) {
      const user = db.prepare("SELECT username, telegram_username, telegram_notifications_enabled FROM users WHERE id = ?").get(userId);
      
      if (user && user.telegram_username && user.telegram_notifications_enabled === 1) {
        // Получаем chat_id из telegram_users
        const cleanUsername = user.telegram_username.toLowerCase();
        const telegramUser = db.prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?").get(cleanUsername);
        
        if (telegramUser && telegramUser.chat_id) {
          // Получаем информацию о турнире
          const event = db.prepare("SELECT name FROM events WHERE id = ?").get(bracket.event_id);
          const eventName = event ? event.name : "Турнир";
          
          // Формируем текст уведомления
          const stageNames = {
            'round_of_16': '1/16 финала',
            'round_of_8': '1/8 финала',
            'quarter_finals': '1/4 финала',
            'semi_finals': '1/2 финала',
            'final': 'Финал'
          };
          
          const message = `🗑️ Прогноз в сетке плей-офф удален!\n\n📊 Турнир: ${eventName}\n🏆 Сетка: ${bracket.name}\n⚽ Стадия: ${stageNames[stage] || stage}`;
          
          // Отправляем через Telegram API
          const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
          if (TELEGRAM_BOT_TOKEN) {
            fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: telegramUser.chat_id,
                text: message,
                parse_mode: 'HTML'
              })
            }).catch(err => {
              console.error(`Ошибка отправки уведомления пользователю ${userId}:`, err);
            });
          }
        }
      }
      
      // Отправляем уведомление админу
      if (user) {
        const event = db.prepare("SELECT name FROM events WHERE id = ?").get(bracket.event_id);
        const eventName = event ? event.name : "Турнир";
        
        const stageNames = {
          'round_of_16': '1/16 финала',
          'round_of_8': '1/8 финала',
          'quarter_finals': '1/4 финала',
          'semi_finals': '1/2 финала',
          'final': 'Финал'
        };
        
        const adminMessage = `🗑️ <b>Прогноз в сетке удален</b>\n\n👤 <b>Пользователь:</b> ${user.username}\n📊 <b>Турнир:</b> ${eventName}\n🏆 <b>Сетка:</b> ${bracket.name}\n⚽ <b>Стадия:</b> ${stageNames[stage] || stage}`;
        
        notifyAdmin(adminMessage).catch(err => {
          console.error(`Ошибка отправки уведомления админу:`, err);
        });
      }
    }
    
    res.json({ success: true, deleted: result.changes > 0 });
  } catch (error) {
    console.error("Ошибка удаления прогноза:", error);
    res.status(500).json({ error: error.message });
  }
});

// Удалить прогнозы пользователей на определенные стадии (для админа при очистке)
router.delete("/api/brackets/:bracketId/predictions/cleanup", (req, res) => {
  try {
    const { bracketId } = req.params;
    const { username, stages } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    if (!stages || !Array.isArray(stages) || stages.length === 0) {
      return res.status(400).json({ error: "Не указаны стадии для удаления" });
    }
    
    // Удаляем прогнозы для указанных стадий
    const placeholders = stages.map(() => '?').join(',');
    const result = db.prepare(`
      DELETE FROM bracket_predictions 
      WHERE bracket_id = ? AND stage IN (${placeholders})
    `).run(bracketId, ...stages);
    
    console.log(`✅ Удалено ${result.changes} прогнозов для сетки ${bracketId} на стадиях: ${stages.join(', ')}`);
    res.json({ success: true, deletedCount: result.changes });
  } catch (error) {
    console.error("Ошибка удаления прогнозов:", error);
    res.status(500).json({ error: error.message });
  }
});

// Создать сетку (только для админа)
router.post("/api/admin/brackets", (req, res) => {
  try {
    const { event_id, name, start_date, start_stage, lock_dates, temporary_teams, username } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    if (!event_id || !name || !start_date) {
      return res.status(400).json({ error: "Не все поля заполнены" });
    }
    
    // Создаем сетку
    const result = db.prepare(`
      INSERT INTO brackets (event_id, name, start_date, start_stage, lock_dates, temporary_teams)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      event_id, 
      name, 
      start_date, 
      start_stage || 'round_of_16',
      lock_dates ? JSON.stringify(lock_dates) : null,
      temporary_teams ? JSON.stringify(temporary_teams) : null
    );
    
    console.log(`✅ Сетка "${name}" создана для турнира ${event_id} (начало: ${start_stage || 'round_of_16'})`);
    
    // Автоматически создаём новость о начале плей-офф
    try {
      const event = db.prepare("SELECT name FROM events WHERE id = ?").get(event_id);
      if (event) {
        const newsTitle = `🔥 Начало плей-офф: ${event.name}`;
        const newsMessage = `Турнир "${event.name}" переходит в стадию плей-офф!\n\n🏆 Сетка: ${name}\n📅 Начало: ${start_date}\n\n⚡ Самое интересное только начинается! Делайте свои прогнозы на сетку!`;
        
        db.prepare(`
          INSERT INTO news (type, title, message)
          VALUES (?, ?, ?)
        `).run('tournament', newsTitle, newsMessage);
        
        console.log(`✅ Автоматически создана новость о начале плей-офф: ${event.name}`);
      }
    } catch (error) {
      console.error("❌ Ошибка создания новости о плей-офф:", error);
    }
    
    res.json({ 
      success: true, 
      bracket_id: result.lastInsertRowid 
    });
  } catch (error) {
    console.error("Ошибка создания сетки:", error);
    res.status(500).json({ error: error.message });
  }
});

// Обновить сетку (только для админа)
router.put("/api/admin/brackets/:bracketId", (req, res) => {
  try {
    const { bracketId } = req.params;
    const { name, start_date, start_stage, lock_dates, temporary_teams, username } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    if (!name || !start_date) {
      return res.status(400).json({ error: "Не все поля заполнены" });
    }
    
    // Обновляем сетку
    const result = db.prepare(`
      UPDATE brackets 
      SET name = ?, start_date = ?, start_stage = ?, lock_dates = ?, temporary_teams = ?
      WHERE id = ?
    `).run(
      name, 
      start_date, 
      start_stage || 'round_of_16',
      lock_dates ? JSON.stringify(lock_dates) : null,
      temporary_teams ? JSON.stringify(temporary_teams) : null,
      bracketId
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    console.log(`✅ Сетка ${bracketId} обновлена: "${name}" (начало: ${start_stage || 'round_of_16'})`);
    
    res.json({ 
      success: true, 
      bracket_id: bracketId 
    });
  } catch (error) {
    console.error("Ошибка обновления сетки:", error);
    res.status(500).json({ error: error.message });
  }
});

// Обновить команды в сетке (только для админа)
router.put("/api/admin/brackets/:bracketId/teams", (req, res) => {
  try {
    const { bracketId } = req.params;
    const { username, matches, temporary_teams } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    if (!matches) {
      return res.status(400).json({ error: "Не указаны команды" });
    }
    
    // Удаляем результаты для пустых слотов
    // Проходим по всем стадиям и матчам
    Object.keys(matches).forEach(stageId => {
      Object.keys(matches[stageId]).forEach(matchIndex => {
        const match = matches[stageId][matchIndex];
        // Если обе команды пустые - удаляем результат этого матча
        if ((!match.team1 || match.team1.trim() === '') && (!match.team2 || match.team2.trim() === '')) {
          db.prepare(`
            DELETE FROM bracket_results 
            WHERE bracket_id = ? AND stage = ? AND match_index = ?
          `).run(bracketId, stageId, matchIndex);
          console.log(`🗑️ Удален результат для пустого матча: ${stageId} match ${matchIndex}`);
        }
      });
    });
    
    // Обновляем команды в сетке и временные команды (сохраняем как JSON)
    const result = db.prepare(`
      UPDATE brackets 
      SET matches = ?, temporary_teams = ?
      WHERE id = ?
    `).run(
      JSON.stringify(matches), 
      JSON.stringify(temporary_teams || {}),
      bracketId
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    // Очищаем неправильные прогнозы пользователей
    // Проходим по всем стадиям и матчам
    let cleanedPredictionsCount = 0;
    Object.keys(matches).forEach(stageId => {
      Object.keys(matches[stageId]).forEach(matchIndex => {
        const match = matches[stageId][matchIndex];
        const team1 = match.team1 || '';
        const team2 = match.team2 || '';
        
        // Получаем все прогнозы для этого матча
        const predictions = db.prepare(`
          SELECT user_id, predicted_winner 
          FROM bracket_predictions 
          WHERE bracket_id = ? AND stage = ? AND match_index = ?
        `).all(bracketId, stageId, matchIndex);
        
        // Удаляем прогнозы, где команда больше не участвует в матче
        predictions.forEach(pred => {
          const predictedTeam = pred.predicted_winner;
          // Если прогнозируемая команда не является ни team1, ни team2 - удаляем прогноз
          if (predictedTeam !== team1 && predictedTeam !== team2) {
            db.prepare(`
              DELETE FROM bracket_predictions 
              WHERE bracket_id = ? AND user_id = ? AND stage = ? AND match_index = ?
            `).run(bracketId, pred.user_id, stageId, matchIndex);
            
            cleanedPredictionsCount++;
            console.log(`🗑️ Удален неправильный прогноз пользователя ${pred.user_id}: ${predictedTeam} в ${stageId} матч ${matchIndex}`);
          }
        });
      });
    });
    
    console.log(`✅ Команды в сетке ${bracketId} обновлены. Очищено прогнозов: ${cleanedPredictionsCount}`);
    
    res.json({ 
      success: true, 
      bracket_id: bracketId,
      cleaned_predictions: cleanedPredictionsCount
    });
  } catch (error) {
    console.error("Ошибка обновления команд в сетке:", error);
    res.status(500).json({ error: error.message });
  }
});

// Обновить структуру сетки (продвижение команд пользователями)
router.put("/api/brackets/:bracketId/structure", (req, res) => {
  try {
    const { bracketId } = req.params;
    const { user_id, matches, temporary_teams } = req.body;
    
    if (!user_id) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    if (!matches) {
      return res.status(400).json({ error: "Не указаны команды" });
    }
    
    // Получаем текущую структуру сетки
    const bracket = db.prepare("SELECT matches, temporary_teams FROM brackets WHERE id = ?").get(bracketId);
    
    if (!bracket) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    // Парсим текущие matches
    let currentMatches = {};
    if (bracket.matches) {
      try {
        currentMatches = JSON.parse(bracket.matches);
      } catch (e) {
        currentMatches = {};
      }
    }
    
    // Получаем информацию о сетке для определения начальной стадии
    const bracketInfo = db.prepare("SELECT start_stage FROM brackets WHERE id = ?").get(bracketId);
    
    // Определяем редактируемую стадию из БД
    const editableStages = bracketInfo && bracketInfo.start_stage ? [bracketInfo.start_stage] : ['round_of_16'];
    const filteredMatches = {};
    
    // Сохраняем только начальные стадии из новых данных
    Object.keys(matches).forEach(stageId => {
      if (editableStages.includes(stageId)) {
        filteredMatches[stageId] = matches[stageId];
      }
    });
    
    // ВАЖНО: Сохраняем ВСЕ остальные стадии из старых данных (которые установил админ)
    Object.keys(currentMatches).forEach(stageId => {
      if (!editableStages.includes(stageId)) {
        // Это стадия которую установил админ (например round_of_8, quarter_finals)
        // НЕ УДАЛЯЕМ её, сохраняем как есть
        filteredMatches[stageId] = currentMatches[stageId];
      } else if (!filteredMatches[stageId]) {
        // Это начальная стадия которая есть в старых данных но нет в новых
        filteredMatches[stageId] = currentMatches[stageId];
      }
    });
    
    // Сохраняем только отфильтрованную структуру (без последующих стадий) и временные команды
    const result = db.prepare(`
      UPDATE brackets 
      SET matches = ?, temporary_teams = ?
      WHERE id = ?
    `).run(
      JSON.stringify(filteredMatches), 
      JSON.stringify(temporary_teams || {}),
      bracketId
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    console.log(`✅ Структура сетки ${bracketId} обновлена пользователем ${user_id}`);
    
    res.json({ 
      success: true, 
      bracket_id: bracketId 
    });
  } catch (error) {
    console.error("Ошибка обновления структуры сетки:", error);
    res.status(500).json({ error: error.message });
  }
});

// Изменить блокировку сетки (только для админа)
router.put("/api/admin/brackets/:bracketId/lock", (req, res) => {
  try {
    const { bracketId } = req.params;
    const { username, is_locked } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    if (is_locked === undefined) {
      return res.status(400).json({ error: "Не указано состояние блокировки" });
    }
    
    // Обновляем блокировку сетки
    const result = db.prepare(`
      UPDATE brackets 
      SET is_locked = ?
      WHERE id = ?
    `).run(is_locked, bracketId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    const lockStatus = is_locked === 1 ? 'заблокирована' : 'разблокирована';
    console.log(`✅ Сетка ${bracketId} ${lockStatus}`);
    
    res.json({ 
      success: true, 
      bracket_id: bracketId,
      is_locked: is_locked
    });
  } catch (error) {
    console.error("Ошибка изменения блокировки сетки:", error);
    res.status(500).json({ error: error.message });
  }
});

// Установить результат матча в сетке (только для админа)
router.put("/api/admin/brackets/:bracketId/results", async (req, res) => {
  try {
    const { bracketId } = req.params;
    const { username, stage, match_index, actual_winner } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    if (!stage || match_index === undefined || !actual_winner) {
      return res.status(400).json({ error: "Не все поля заполнены" });
    }
    
    // Используем UPSERT для результата
    db.prepare(`
      INSERT INTO bracket_results (bracket_id, stage, match_index, actual_winner)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(bracket_id, stage, match_index) 
      DO UPDATE SET actual_winner = excluded.actual_winner
    `).run(bracketId, stage, match_index, actual_winner);
    
    console.log(`✅ Результат матча установлен: сетка ${bracketId}, ${stage}, матч ${match_index}, победитель: ${actual_winner}`);
    
    // Получаем информацию о сетке и турнире
    const bracket = db.prepare("SELECT name, event_id FROM brackets WHERE id = ?").get(bracketId);
    const event = bracket ? db.prepare("SELECT name FROM events WHERE id = ?").get(bracket.event_id) : null;
    const eventName = event ? event.name : "Турнир";
    
    // Названия стадий
    const stageNames = {
      'round_of_16': '1/16 финала',
      'round_of_8': '1/8 финала',
      'quarter_finals': '1/4 финала',
      'semi_finals': '1/2 финала',
      'final': 'Финал'
    };
    const stageName = stageNames[stage] || stage;
    
    // Получаем всех пользователей с прогнозами на этот матч
    const usersWithPredictions = db.prepare(`
      SELECT 
        bp.user_id, 
        bp.predicted_winner,
        u.username,
        u.telegram_username,
        u.telegram_notifications_enabled
      FROM bracket_predictions bp
      JOIN users u ON bp.user_id = u.id
      WHERE bp.bracket_id = ? AND bp.stage = ? AND bp.match_index = ?
    `).all(bracketId, stage, match_index);
    
    // Отправляем уведомления пользователям
    for (const user of usersWithPredictions) {
      if (user.telegram_username && user.telegram_notifications_enabled === 1) {
        // Получаем chat_id из telegram_users
        const cleanUsername = user.telegram_username.toLowerCase();
        const telegramUser = db.prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?").get(cleanUsername);
        
        if (telegramUser && telegramUser.chat_id) {
          const isCorrect = user.predicted_winner === actual_winner;
          const emoji = isCorrect ? '✅' : '❌';
          
          const message = `${emoji} Результат матча в сетке плей-офф!\n\n📊 Турнир: ${eventName}\n🏆 Сетка: ${bracket.name}\n⚽ Стадия: ${stageName}\n\n🏁 Победитель: ${actual_winner}\n🎯 Ваш прогноз: ${user.predicted_winner}\n\n${isCorrect ? '🎉 Поздравляем! Вы угадали!' : '😔 К сожалению, прогноз не сбылся'}`;
          
          try {
            await sendUserMessage(telegramUser.chat_id, message);
            console.log(`✅ Уведомление о результате отправлено пользователю ${user.username} (${isCorrect ? 'угадал' : 'не угадал'})`);
          } catch (err) {
            console.error(`❌ Ошибка отправки уведомления пользователю ${user.user_id}:`, err);
          }
        }
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("Ошибка установки результата матча:", error);
    res.status(500).json({ error: error.message });
  }
});

// Удалить результат матча в сетке (только для админа)
router.delete("/api/admin/brackets/:bracketId/results", async (req, res) => {
  try {
    const { bracketId } = req.params;
    const { username, stage, match_index } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    if (!stage || match_index === undefined) {
      return res.status(400).json({ error: "Не все поля заполнены" });
    }
    
    // Удаляем результат
    db.prepare(`
      DELETE FROM bracket_results 
      WHERE bracket_id = ? AND stage = ? AND match_index = ?
    `).run(bracketId, stage, match_index);
    
    console.log(`✅ Результат матча удалён: сетка ${bracketId}, ${stage}, матч ${match_index}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error("Ошибка удаления результата матча:", error);
    res.status(500).json({ error: error.message });
  }
});

// Получить результаты матчей в сетке
router.get("/api/brackets/:bracketId/results", (req, res) => {
  try {
    const { bracketId } = req.params;
    
    const results = db.prepare(`
      SELECT stage, match_index, actual_winner 
      FROM bracket_results 
      WHERE bracket_id = ?
    `).all(bracketId);
    
    res.json(results);
  } catch (error) {
    console.error("Ошибка получения результатов:", error);
    res.status(500).json({ error: error.message });
  }
});

// Удалить сетку (только для админа)
router.delete("/api/admin/brackets/:bracketId", (req, res) => {
  try {
    const { bracketId } = req.params;
    const { username } = req.body;
    
    if (!username) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    
    // Проверяем, что пользователь - админ
    const isAdmin = username === process.env.ADMIN_DB_NAME;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    // Проверяем существование сетки
    const bracket = db.prepare("SELECT * FROM brackets WHERE id = ?").get(bracketId);
    
    if (!bracket) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    // Удаляем все прогнозы для этой сетки
    const deletedPredictions = db.prepare(`
      DELETE FROM bracket_predictions WHERE bracket_id = ?
    `).run(bracketId);
    
    // Удаляем саму сетку
    const result = db.prepare(`
      DELETE FROM brackets WHERE id = ?
    `).run(bracketId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: "Сетка не найдена" });
    }
    
    console.log(`✅ Сетка ${bracketId} удалена (удалено прогнозов: ${deletedPredictions.changes})`);
    
    res.json({ 
      success: true, 
      bracket_id: bracketId,
      deleted_predictions: deletedPredictions.changes
    });
  } catch (error) {
    console.error("Ошибка удаления сетки:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/events/:eventId/award - Добавить награду за турнир (для админа)

export default router;
