import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../database/db.js';
import { notifyAdmin } from '../services/notificationService.js';
import { writeBetLog } from '../utils/logger.js';
import { sendUserMessage, sendAdminNotification, sendGroupNotification, notifyIllegalBet } from '../../OnexBetLineBoombot.js';
import { BACKUPS_DIR, LOG_FILE_PATH, ROOT_DIR } from '../config.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

router.get("/api/moderators", (req, res) => {
  try {
    const moderators = db
      .prepare(
        `
      SELECT m.id, u.id as user_id, u.username, m.permissions
      FROM moderators m
      JOIN users u ON m.user_id = u.id
      ORDER BY u.username ASC
    `
      )
      .all();

    // Парсим JSON-массив разрешений
    const result = moderators.map((mod) => ({
      ...mod,
      permissions: JSON.parse(mod.permissions || "[]"),
    }));

    res.json(result);
  } catch (error) {
    console.error("Ошибка при получении модераторов:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.3 Назначить нового модератора
router.post("/api/moderators", async (req, res) => {
  try {
    const { user_id, permissions } = req.body;

    if (!user_id || !Array.isArray(permissions)) {
      return res.status(400).json({ error: "Неверные параметры" });
    }

    // Проверяем существует ли пользователь
    const user = db.prepare("SELECT id, username, telegram_username FROM users WHERE id = ?").get(user_id);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    console.log(`📋 Назначение модератора: user_id=${user_id}, username=${user.username}, telegram_username=${user.telegram_username}`);

    // Проверяем, что пользователь связал профиль с ботом
    if (!user.telegram_username) {
      return res.status(400).json({ error: "Пользователь не привязал Telegram к профилю" });
    }

    // Проверяем, что пользователь писал боту (есть в telegram_users)
    const telegramUser = db.prepare(
      "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = LOWER(?)"
    ).get(user.telegram_username);

    if (!telegramUser) {
      return res.status(400).json({ error: "Пользователь не писал боту. Попросите его написать боту /start" });
    }

    // Проверяем, не является ли уже модератором
    const existingMod = db
      .prepare("SELECT id FROM moderators WHERE user_id = ?")
      .get(user_id);

    if (existingMod) {
      return res.status(400).json({ error: "Пользователь уже модератор" });
    }

    // Добавляем модератора
    const result = db
      .prepare("INSERT INTO moderators (user_id, permissions) VALUES (?, ?)")
      .run(user_id, JSON.stringify(permissions));

    console.log(`✅ Модератор добавлен в БД`);

    // Отправляем уведомление пользователю в Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    const permissionsText = permissions.map(p => {
      const permMap = {
        'manage_matches': '⚽ Управление матчами',
        'create_matches': '➕ Создание матчей',
        'edit_matches': '✏️ Редактирование матчей',
        'delete_matches': '🗑️ Удаление матчей',
        'manage_results': '📊 Управление результатами',
        'manage_tournaments': '🎯 Управление турнирами',
        'edit_tournaments': '✏️ Редактирование турниров',
        'delete_tournaments': '🗑️ Удаление турниров',
        'create_tournaments': '➕ Создание турниров',
        'view_logs': '📋 Просмотр логов',
        'view_counting': '📊 Подсчет результатов',
        'manage_db': '💾 Управление базой данных',
        'backup_db': '➕ Создание бэкапов',
        'download_backup': '💾 Скачивание бэкапов',
        'restore_db': '📥 Восстановление БД',
        'delete_backup': '🗑️ Удаление бэкапов',
        'manage_orphaned': '🗑️ Управление orphaned данными',
        'view_users': '👥 Просмотр пользователей',
        'check_bot': '🤖 Проверка контакта с ботом',
        'view_settings': '⚙️ Просмотр настроек пользователей',
        'sync_telegram_ids': '🔄 Синхронизация Telegram ID',
        'edit_users': '✏️ Редактирование пользователей',
        'delete_users': '❌ Удаление пользователей'
      };
      return permMap[p] || p;
    }).join('\n');

    const message = `🛡️ Вы назначены модераптором 1xBetLineBoom!

Ваши права:
${permissionsText}`;

    console.log(`📤 Отправляю уведомление модератору...`);

    try {
      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramUser.chat_id,
          text: message,
          parse_mode: "HTML"
        })
      });
      
      const responseData = await response.json();
      
      if (responseData.ok) {
        console.log(`✅ Уведомление о назначении модератором отправлено пользователю ${user.username}`);
      } else {
        console.error(`❌ Telegram API вернул ошибку:`, responseData);
      }
    } catch (error) {
      console.error(`❌ Ошибка отправки уведомления модератору ${user.username}:`, error);
    }

    // Записываем в лог
    writeBetLog("moderator_assigned", {
      username: user.username,
      permissions: permissionsText,
    });

    res.json({
      success: true,
      message: "Модератор успешно назначен",
      id: result.lastInsertRowid,
    });
  } catch (error) {
    console.error("Ошибка при назначении модератора:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.4 Удалить модератора
router.delete("/api/moderators/:moderatorId", (req, res) => {
  try {
    const { moderatorId } = req.params;

    // Получаем информацию о модераторе перед удалением
    const moderator = db.prepare(`
      SELECT m.id, m.permissions, u.username
      FROM moderators m
      JOIN users u ON m.user_id = u.id
      WHERE m.id = ?
    `).get(moderatorId);

    if (!moderator) {
      return res.status(404).json({ error: "Модератор не найден" });
    }

    const result = db
      .prepare("DELETE FROM moderators WHERE id = ?")
      .run(moderatorId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Модератор не найден" });
    }

    // Записываем в лог
    writeBetLog("moderator_removed", {
      username: moderator.username,
    });

    res.json({
      success: true,
      message: "Модератор удален",
    });
  } catch (error) {
    console.error("Ошибка при удалении модератора:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5.5 Обновить разрешения модератора
router.put("/api/moderators/:moderatorId/permissions", async (req, res) => {
  try {
    const { moderatorId } = req.params;
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: "Разрешения должны быть массивом" });
    }

    // Получаем информацию о модераторе
    const moderator = db.prepare(`
      SELECT m.id, m.user_id, m.permissions, u.username, u.telegram_username
      FROM moderators m
      JOIN users u ON m.user_id = u.id
      WHERE m.id = ?
    `).get(moderatorId);

    if (!moderator) {
      return res.status(404).json({ error: "Модератор не найден" });
    }

    // Получаем старые права для сравнения
    const oldPermissions = JSON.parse(moderator.permissions || "[]");

    const result = db
      .prepare("UPDATE moderators SET permissions = ? WHERE id = ?")
      .run(JSON.stringify(permissions), moderatorId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Модератор не найден" });
    }

    // Определяем добавленные и удаленные права
    const addedPermissions = permissions.filter(p => !oldPermissions.includes(p));
    const removedPermissions = oldPermissions.filter(p => !permissions.includes(p));

    // Функция для форматирования прав
    const formatPermissions = (perms) => {
      const permMap = {
        'manage_matches': '⚽ Управление матчами',
        'create_matches': '➕ Создание матчей',
        'edit_matches': '✏️ Редактирование матчей',
        'delete_matches': '🗑️ Удаление матчей',
        'manage_results': '📊 Управление результатами',
        'manage_tournaments': '🎯 Управление турнирами',
        'edit_tournaments': '✏️ Редактирование турниров',
        'delete_tournaments': '🗑️ Удаление турниров',
        'create_tournaments': '➕ Создание турниров',
        'view_logs': '📋 Просмотр логов',
        'view_counting': '📊 Подсчет результатов',
        'manage_db': '💾 Управление базой данных',
        'backup_db': '➕ Создание бэкапов',
        'download_backup': '💾 Скачивание бэкапов',
        'restore_db': '📥 Восстановление БД',
        'delete_backup': '🗑️ Удаление бэкапов',
        'manage_orphaned': '🗑️ Управление orphaned данными',
        'view_users': '👥 Просмотр пользователей',
        'check_bot': '🤖 Проверка контакта с ботом',
        'view_settings': '⚙️ Просмотр настроек пользователей',
        'sync_telegram_ids': '🔄 Синхронизация Telegram ID',
        'edit_users': '✏️ Редактирование пользователей',
        'delete_users': '❌ Удаление пользователей'
      };
      return perms.map(p => permMap[p] || p).join('\n');
    };

    // Записываем в лог если были изменения
    if (addedPermissions.length > 0 || removedPermissions.length > 0) {
      writeBetLog("moderator_permissions_changed", {
        username: moderator.username,
        added: addedPermissions.length > 0 ? formatPermissions(addedPermissions) : null,
        removed: removedPermissions.length > 0 ? formatPermissions(removedPermissions) : null,
      });
    }

    // Отправляем уведомление модератору о изменении прав
    if (moderator.telegram_username && permissions.length > 0) {
      const telegramUser = db.prepare(
        "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = LOWER(?)"
      ).get(moderator.telegram_username);

      if (telegramUser) {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        
        const permissionsText = permissions.map(p => {
          const permMap = {
            'manage_matches': '⚽ Управление матчами',
            'create_matches': '➕ Создание матчей',
            'edit_matches': '✏️ Редактирование матчей',
            'delete_matches': '🗑️ Удаление матчей',
            'manage_results': '📊 Управление результатами',
            'manage_tournaments': '🎯 Управление турнирами',
            'edit_tournaments': '✏️ Редактирование турниров',
            'delete_tournaments': '🗑️ Удаление турниров',
            'create_tournaments': '➕ Создание турниров',
            'view_logs': '📋 Просмотр логов',
            'view_counting': '📊 Подсчет результатов',
            'manage_db': '💾 Управление базой данных',
            'backup_db': '➕ Создание бэкапов',
            'download_backup': '💾 Скачивание бэкапов',
            'restore_db': '📥 Восстановление БД',
            'delete_backup': '🗑️ Удаление бэкапов',
            'manage_orphaned': '🗑️ Управление orphaned данными',
            'view_users': '👥 Просмотр пользователей',
            'check_bot': '🤖 Проверка контакта с ботом',
            'view_settings': '⚙️ Просмотр настроек пользователей',
            'sync_telegram_ids': '🔄 Синхронизация Telegram ID',
            'edit_users': '✏️ Редактирование пользователей',
            'delete_users': '❌ Удаление пользователей'
          };
          return permMap[p] || p;
        }).join('\n');

        const message = `🔄 Ваши права модератора обновлены!

Текущие права:
${permissionsText}`;

        try {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: telegramUser.chat_id,
              text: message,
              parse_mode: "HTML"
            })
          });
          console.log(`✅ Уведомление об обновлении прав отправлено модератору ${moderator.username}`);
        } catch (error) {
          console.error(`❌ Ошибка отправки уведомления модератору ${moderator.username}:`, error);
        }
      }
    }

    res.json({
      success: true,
      message: "Разрешения обновлены",
    });
  } catch (error) {
    console.error("Ошибка при обновлении разрешений:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========== УПРАВЛЕНИЕ НАГРАДАМИ ==========

// 5.6 Получить все награды пользователя
router.get("/api/admin/users", (req, res) => {
  const username = req.query.username;

  console.log(`📋 Запрос списка пользователей от: ${username}`);

  if (!username) {
    console.log(`❌ Username не передан`);
    return res.status(400).json({ error: "Username не передан" });
  }

  // Проверяем, является ли пользователь админом
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  
  console.log(`🔍 Проверка прав: isAdmin=${isAdminUser}, ADMIN_DB_NAME=${process.env.ADMIN_DB_NAME}`);
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    console.log(`🔍 Модератор найден:`, moderator);
    
    if (!moderator) {
      console.log(`❌ Модератор не найден для username: ${username}`);
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    console.log(`🔍 Права модератора:`, permissions);
    
    if (!permissions.includes("view_users")) {
      console.log(`❌ У модератора нет права view_users`);
      return res.status(403).json({ error: "Недостаточно прав для просмотра пользователей" });
    }
  }

  try {
    const users = db
      .prepare(
        `
      SELECT 
        u.id,
        u.username,
        u.created_at,
        COUNT(b.id) as total_bets,
        SUM(CASE WHEN b.status = 'won' THEN 1 ELSE 0 END) as won_bets,
        SUM(CASE WHEN b.status = 'lost' THEN 1 ELSE 0 END) as lost_bets
      FROM users u
      LEFT JOIN bets b ON u.id = b.user_id
      GROUP BY u.id, u.username
      ORDER BY u.created_at DESC
    `
      )
      .all();

    console.log(`✅ Возвращено пользователей: ${users.length}`);
    res.json(users);
  } catch (error) {
    console.error(`❌ Ошибка при получении пользователей:`, error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/users/:userId - Переименовать пользователя (только для админа)
router.put("/api/admin/users/:userId", async (req, res) => {
  const { userId } = req.params;
  const { username: adminUsername, newUsername } = req.body;

  // Проверяем, является ли пользователь админом или модератором с правами
  const isAdminUser = adminUsername === process.env.ADMIN_DB_NAME;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(adminUsername);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    if (!permissions.includes("edit_users")) {
      return res.status(403).json({ error: "Недостаточно прав для редактирования пользователей" });
    }
  }

  // Проверяем обязательные поля
  if (!newUsername || newUsername.trim() === "") {
    return res
      .status(400)
      .json({ error: "Новое имя пользователя обязательно" });
  }

  try {
    // Получаем старое имя для уведомления
    const oldUser = db.prepare("SELECT username, telegram_id FROM users WHERE id = ?").get(userId);

    if (!oldUser) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем, не пытается ли модератор переименовать админа
    if (!isAdminUser && oldUser.username === process.env.ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Модератор не может переименовать администратора" });
    }

    // Автоматически делаем первую букву заглавной
    const capitalizedNewUsername = newUsername.charAt(0).toUpperCase() + newUsername.slice(1);

    // Проверяем, не занято ли имя
    const existing = db
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(capitalizedNewUsername);
    if (existing) {
      return res.status(400).json({ error: "Это имя уже занято" });
    }

    // Проверка на запрещенные имена
    const forbiddenBase = capitalizedNewUsername.toLowerCase().replace(/[\s\d\.\-]/g, ''); // Убираем пробелы, цифры, точки, дефисы
    if (forbiddenBase === 'мемослав' || forbiddenBase === 'memoslav' || forbiddenBase === 'memoslave') {
      return res.status(400).json({ error: "Are you, ohuel tam?" });
    }

    const result = db
      .prepare("UPDATE users SET username = ? WHERE id = ?")
      .run(capitalizedNewUsername, userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Удаляем все сессии переименованного пользователя (разлогиниваем со всех устройств)
    const deletedSessions = db
      .prepare("DELETE FROM sessions WHERE user_id = ?")
      .run(userId);
    
    console.log(`✅ Пользователь ${oldUser.username} переименован в ${capitalizedNewUsername}`);
    console.log(`🔓 Удалено сессий: ${deletedSessions.changes}`);

    // Отправляем уведомление пользователю в Telegram если он привязал аккаунт
    if (oldUser.telegram_id) {
      const userMessage = `👤 ИЗМЕНЕНИЕ ИМЕНИ

${isAdminUser ? 'Администратор' : 'Модератор'} изменил ваше имя:
• Старое имя: ${oldUser.username}
• Новое имя: ${capitalizedNewUsername}

🔓 Вы были разлогинены со всех устройств (${deletedSessions.changes} сессий).
Войдите заново с новым именем.

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

      try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        if (TELEGRAM_BOT_TOKEN) {
          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: oldUser.telegram_id,
                text: userMessage,
              }),
            }
          );
          console.log(`✅ Уведомление о смене имени отправлено пользователю ${capitalizedNewUsername}`);
        }
      } catch (error) {
        console.error("⚠️ Не удалось отправить уведомление пользователю:", error);
      }
    }

    // Отправляем уведомление админу если это модератор
    if (!isAdminUser) {
      const details = `👤 Пользователь: ${oldUser.username}
➡️ Новое имя: ${capitalizedNewUsername}
🔓 Разлогинен со всех устройств (удалено сессий: ${deletedSessions.changes})`;
      
      await notifyModeratorAction(adminUsername, "Переименование пользователя", details);
      
      // Запись в логи
      writeBetLog("user_renamed", {
        moderator: adminUsername,
        oldName: oldUser.username,
        newName: capitalizedNewUsername
      });
    }

    res.json({ 
      message: "Пользователь успешно переименован и разлогинен со всех устройств", 
      newUsername: capitalizedNewUsername,
      deletedSessions: deletedSessions.changes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/users/:userId/bot-contact-check - Проверить, писал ли пользователь боту
router.get("/api/admin/users/:userId/bot-contact-check", (req, res) => {
  const { userId } = req.params;
  const username = req.query.username;

  // Проверяем, является ли пользователь админом
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    if (!permissions.includes("check_bot")) {
      return res.status(403).json({ error: "Недостаточно прав для проверки контакта с ботом" });
    }
  }

  try {
    // Получаем информацию о пользователе
    const user = db
      .prepare("SELECT username, telegram_username, telegram_id, require_login_2fa FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем в реальном времени, есть ли пользователь в telegram_users
    let actualTelegramId = user.telegram_id;
    let hasBotContact = false;

    if (user.telegram_username) {
      const telegramUser = db
        .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
        .get(user.telegram_username.toLowerCase());
      
      if (telegramUser && telegramUser.chat_id) {
        actualTelegramId = telegramUser.chat_id;
        hasBotContact = true;

        // Если telegram_id в users не совпадает с актуальным, обновляем его
        if (user.telegram_id !== telegramUser.chat_id) {
          db.prepare("UPDATE users SET telegram_id = ? WHERE id = ?").run(telegramUser.chat_id, userId);
          console.log(`✅ Автоматически обновлен telegram_id для ${user.username}: ${telegramUser.chat_id}`);
        }
      }
    }

    const result = {
      username: user.username,
      telegram_username: user.telegram_username,
      telegram_id: actualTelegramId,
      has_bot_contact: hasBotContact,
      require_login_2fa: user.require_login_2fa !== 0
    };

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/sync-telegram-ids - Синхронизировать telegram_id для всех пользователей
router.post("/api/admin/sync-telegram-ids", async (req, res) => {
  const { username } = req.body;
  
  // Проверяем, является ли пользователь админом
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    if (!permissions.includes("sync_telegram_ids")) {
      return res.status(403).json({ error: "Недостаточно прав для синхронизации Telegram ID" });
    }
  }
  
  try {
    // Получаем всех пользователей с привязанным Telegram
    const users = db.prepare(`
      SELECT id, username, telegram_username, telegram_id 
      FROM users 
      WHERE telegram_username IS NOT NULL
    `).all();

    // Получаем пользователей БЕЗ привязанного Telegram
    const usersWithoutTelegram = db.prepare(`
      SELECT id, username 
      FROM users 
      WHERE telegram_username IS NULL
    `).all();

    let updated = 0;
    let skipped = 0;
    let notFound = 0;
    const details = [];
    const notFoundUsers = [];

    // Обновляем telegram_id для пользователей
    for (const user of users) {
      if (!user.telegram_id && user.telegram_username) {
        const telegramUser = db.prepare(`
          SELECT chat_id FROM telegram_users 
          WHERE LOWER(telegram_username) = ?
        `).get(user.telegram_username.toLowerCase());

        if (telegramUser) {
          db.prepare(`
            UPDATE users SET telegram_id = ? WHERE id = ?
          `).run(telegramUser.chat_id, user.id);
          
          updated++;
          details.push({
            username: user.username,
            telegram_username: user.telegram_username,
            telegram_id: telegramUser.chat_id
          });
          
          console.log(`✅ Обновлен telegram_id для ${user.username}: ${telegramUser.chat_id}`);
        } else {
          notFound++;
          notFoundUsers.push({
            username: user.username,
            telegram_username: user.telegram_username
          });
          console.log(`⚠️ Не найден в telegram_users: ${user.telegram_username}`);
        }
      } else if (user.telegram_id) {
        skipped++;
      }
    }

    res.json({
      success: true,
      total: users.length,
      updated,
      skipped,
      not_found: notFound,
      details,
      not_found_users: notFoundUsers,
      without_telegram: usersWithoutTelegram.length,
      without_telegram_users: usersWithoutTelegram
    });

    // Уведомление админу если это модератор
    if (!isAdminUser && username && updated > 0) {
      const detailsText = `🔄 Обновлено: ${updated}
⏭️ Пропущено: ${skipped}
❌ Не найдено: ${notFound}`;
      
      await notifyModeratorAction(username, "Синхронизация Telegram ID", detailsText);
      
      // Запись в логи
      writeBetLog("telegram_synced", {
        moderator: username,
        updated: updated,
        notFound: notFound
      });
    }
  } catch (error) {
    console.error("❌ Ошибка синхронизации:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/users/:userId - Удалить пользователя (только для админа)
router.delete("/api/admin/users/:userId", async (req, res) => {
  const { userId } = req.params;
  const { username: adminUsername } = req.body;

  // Проверяем, является ли пользователь админом или модератором с правами
  const isAdminUser = adminUsername === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(adminUsername);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("delete_users");
    }
    
    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав для удаления пользователей" });
    }
  }

  // Получаем информацию о пользователе, которого хотят удалить
  const userToDelete = db
    .prepare("SELECT username FROM users WHERE id = ?")
    .get(userId);
    
  if (!userToDelete) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }

  // Не даем удалить админа
  if (userToDelete.username === process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Нельзя удалить админа" });
  }
  
  // Модератор не может удалить админа (дополнительная проверка)
  if (!isAdminUser && userToDelete.username === process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Модератор не может удалить администратора" });
  }

  try {
    // Получаем информацию о пользователе перед удалением
    const userInfo = db
      .prepare("SELECT username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    if (!userInfo) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Получаем все финальные ставки пользователя чтобы потом удалить их параметры
    const finalBets = db
      .prepare(
        "SELECT match_id FROM bets WHERE user_id = ? AND is_final_bet = 1"
      )
      .all(userId);

    // Получаем количество ставок пользователя
    const betsCount = db
      .prepare("SELECT COUNT(*) as count FROM bets WHERE user_id = ?")
      .get(userId);

    // Удаляем все ставки пользователя
    db.prepare("DELETE FROM bets WHERE user_id = ?").run(userId);

    // Удаляем права модератора если они есть
    db.prepare("DELETE FROM moderators WHERE user_id = ?").run(userId);

    // Удаляем параметры финала для матчей, где у этого пользователя больше нет ставок
    finalBets.forEach((bet) => {
      const remainingBets = db
        .prepare(
          "SELECT COUNT(*) as cnt FROM bets WHERE match_id = ? AND is_final_bet = 1"
        )
        .get(bet.match_id);

      if (remainingBets.cnt === 0) {
        try {
          db.prepare(
            "DELETE FROM final_parameters_results WHERE match_id = ?"
          ).run(bet.match_id);
        } catch (e) {
          console.warn(`⚠️ Не удалось удалить параметры финала: ${e.message}`);
        }
      }
    });

    // Удаляем самого пользователя
    const result = db.prepare("DELETE FROM users WHERE id = ?").run(userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Отправляем уведомление админу если это модератор
    if (isModerator) {
      const details = `👤 Пользователь: ${userInfo.username}
${userInfo.telegram_username ? `📱 Telegram: @${userInfo.telegram_username}` : ''}
📊 Удалено ставок: ${betsCount.count}`;
      
      await notifyModeratorAction(adminUsername, "Удаление пользователя", details);
      
      // Запись в логи
      writeBetLog("user_deleted", {
        moderator: adminUsername,
        username: userInfo.username,
        betsDeleted: betsCount.count
      });
    }

    res.json({ message: "Пользователь успешно удален" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/group-reminders-card-visibility - Получить текущую видимость карточки напоминаний
router.get("/api/admin/group-reminders-card-visibility", (req, res) => {
  try {
    // Создаём таблицу если её нет
    db.prepare(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      )
    `).run();

    // Получаем настройку
    const setting = db.prepare('SELECT value FROM global_settings WHERE key = ?').get('group_reminders_card_hidden');
    
    const hidden = setting ? setting.value === 'true' : false;

    res.json({ hidden });
  } catch (error) {
    console.error('Ошибка при получении видимости карточки:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/group-reminders-card-visibility - Изменить видимость карточки напоминаний в группе для всех пользователей
router.put("/api/admin/group-reminders-card-visibility", (req, res) => {
  try {
    const { hidden, admin_username } = req.body;
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;

    // Проверка прав админа
    if (admin_username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }

    // Создаём таблицу если её нет
    db.prepare(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      )
    `).run();

    // Сохраняем настройку
    db.prepare(`
      INSERT INTO global_settings (key, value, updated_by)
      VALUES ('group_reminders_card_hidden', ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = excluded.updated_by
    `).run(hidden ? 'true' : 'false', admin_username);

    console.log(`🔧 Админ ${admin_username} ${hidden ? 'скрыл' : 'показал'} карточку напоминаний в группе для всех пользователей`);

    res.json({ 
      success: true, 
      hidden,
      message: hidden ? 'Карточка скрыта для всех пользователей' : 'Карточка показана для всех пользователей'
    });
  } catch (error) {
    console.error('Ошибка при изменении видимости карточки:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/toggle-xg-button - Показать/скрыть кнопку xG для всех пользователей
router.post("/api/admin/toggle-xg-button", (req, res) => {
  try {
    const { admin_username, hidden } = req.body;

    if (!admin_username) {
      return res.status(400).json({ error: "Требуется admin_username" });
    }

    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    if (admin_username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }

    // Создаём таблицу если её нет (уже должна существовать)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      )
    `).run();

    // Сохраняем настройку
    db.prepare(`
      INSERT INTO global_settings (key, value, updated_by)
      VALUES ('xg_button_hidden', ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = excluded.updated_by
    `).run(hidden ? 'true' : 'false', admin_username);

    console.log(`🔧 Админ ${admin_username} ${hidden ? 'скрыл' : 'показал'} кнопку xG для всех пользователей`);

    res.json({ 
      success: true, 
      hidden,
      message: hidden ? 'Кнопка xG скрыта для всех пользователей' : 'Кнопка xG показана для всех пользователей'
    });
  } catch (error) {
    console.error('Ошибка при изменении видимости кнопки xG:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/xg-button-visibility - Получить статус видимости кнопки xG
router.get("/api/xg-button-visibility", (req, res) => {
  try {
    const setting = db.prepare(`
      SELECT value FROM global_settings WHERE key = 'xg_button_hidden'
    `).get();

    const hidden = setting ? setting.value === 'true' : false;

    res.json({ hidden });
  } catch (error) {
    console.error('Ошибка при получении видимости кнопки xG:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notify-xg-modal-opened - Уведомить админа об открытии модалки xG
router.post("/api/notify-xg-modal-opened", async (req, res) => {
  try {
    const { username, eventName, round } = req.body;

    if (!username) {
      return res.status(400).json({ error: "Требуется username" });
    }

    console.log(`📊 Пользователь ${username} открыл модалку xG для турнира: ${eventName || 'N/A'}, тур: ${round || 'N/A'}`);

    // Отправляем уведомление админу
    try {
      await notifyAdmin(
        `📊 <b>Открыта модалка xG</b>\n\n` +
        `👤 Пользователь: <b>${username}</b>\n` +
        `🏆 Турнир: <b>${eventName || 'Не указан'}</b>\n` +
        `🎯 Тур: <b>${round || 'Не указан'}</b>`
      );
      console.log('✅ Уведомление админу отправлено');
    } catch (error) {
      console.error('Ошибка отправки уведомления админу:', error);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка при уведомлении об открытии модалки xG:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/user-settings/:userId - Отправить настройки пользователя админу/модератору в Telegram
router.post("/api/admin/user-settings/:userId", async (req, res) => {
  const { userId } = req.params;
  const { username: adminUsername } = req.body;

  // Проверяем, является ли пользователь админом
  const isAdminUser = adminUsername === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  let moderatorChatId = null;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(adminUsername);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    if (!permissions.includes("view_settings")) {
      return res.status(403).json({ error: "Недостаточно прав для просмотра настроек пользователей" });
    }
    
    isModerator = true;
    
    // Получаем chat_id модератора
    const moderatorUser = db.prepare(`
      SELECT telegram_username FROM users WHERE username = ?
    `).get(adminUsername);
    
    if (moderatorUser && moderatorUser.telegram_username) {
      const telegramUser = db.prepare(`
        SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = LOWER(?)
      `).get(moderatorUser.telegram_username);
      
      if (telegramUser) {
        moderatorChatId = telegramUser.chat_id;
      }
    }
  }

  try {
    // Получаем полную информацию о пользователе
    const user = db
      .prepare(
        `SELECT 
          id, username, email, created_at, telegram_username, telegram_id,
          timezone, theme, show_bets,
          telegram_notifications_enabled, telegram_group_reminders_enabled,
          require_login_2fa
        FROM users 
        WHERE id = ?`
      )
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем, есть ли пользователь в telegram_users (писал ли боту)
    let hasBotContact = false;
    if (user.telegram_username) {
      const telegramUser = db
        .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
        .get(user.telegram_username.toLowerCase());
      
      if (telegramUser && telegramUser.chat_id) {
        hasBotContact = true;
      }
    }

    // Названия тем
    const themeNames = {
      'theme-default': 'Дефолтная',
      'theme-hacker-green': '💻 Hacker Green',
      'theme-solarized': '🌅 Solarized',
      'theme-matrix': '🟢 Matrix',
      'theme-cyberpunk': '🌃 Cyberpunk',
      'theme-leagueChampions': '🏆 League Champions',
      'theme-leagueEurope': '⭐ League Europe',
      'theme-dark': '🌙 Темная',
      'theme-light': '☀️ Светлая',
      'theme-cream-material': '☀️ Cream Material'
    };

    // Форматируем настройки для отправки
    const settingsMessage = `⚙️ НАСТРОЙКИ ПОЛЬЗОВАТЕЛЯ

👤 Пользователь: ${user.username}
🆔 ID: ${user.id}
${user.email ? `📧 Email: ${user.email}` : ""}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : "📱 Telegram: не привязан"}
${user.telegram_id ? `💬 Chat ID: ${user.telegram_id}` : ""}
${user.telegram_username ? `🤖 Писал боту: ${hasBotContact ? "✅ Да" : "❌ Нет"}` : ""}
📅 Регистрация: ${user.created_at ? new Date(user.created_at).toLocaleString("ru-RU") : "неизвестно"}

🔔 УВЕДОМЛЕНИЯ:
• Личные сообщения в ТГ: ${user.telegram_notifications_enabled ? "✅ Включены" : "❌ Отключены"}
• Напоминания в группе: ${user.telegram_group_reminders_enabled ? "✅ Включены" : "❌ Отключены"}

🔐 БЕЗОПАСНОСТЬ:
• 2FA при логине: ${user.require_login_2fa ? "✅ Включено" : "❌ Отключено"}

🎨 ИНТЕРФЕЙС:
• Тема: ${themeNames[user.theme] || user.theme || "Дефолтная"}
• Часовой пояс: ${user.timezone || "Europe/Moscow (по умолчанию)"}

🔒 ПРИВАТНОСТЬ:
• Показывать ставки: ${user.show_bets === "always" ? "Всегда" : user.show_bets === "after_start" ? "После начала матча" : "Не установлено"}`;

    // Определяем кому отправлять сообщение
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    let targetChatId;
    
    if (isModerator && moderatorChatId) {
      // Отправляем модератору
      targetChatId = moderatorChatId;
    } else {
      // Отправляем админу
      targetChatId = process.env.TELEGRAM_ADMIN_ID;
    }

    if (!TELEGRAM_BOT_TOKEN || !targetChatId) {
      return res.status(500).json({ 
        error: isModerator && !moderatorChatId 
          ? "Ваш Telegram не привязан или вы не писали боту" 
          : "Telegram не настроен" 
      });
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: targetChatId,
          text: settingsMessage,
        }),
      }
    );

    if (!telegramResponse.ok) {
      throw new Error("Ошибка отправки в Telegram");
    }

    const recipient = isModerator ? `модератору ${adminUsername}` : "админу";
    console.log(`✅ Настройки пользователя ${user.username} отправлены ${recipient}`);
    res.json({ success: true, message: "Настройки отправлены в Telegram" });
  } catch (error) {
    console.error("Ошибка при отправке настроек:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bug-report - Отправить багрепорт админу
router.post("/api/bug-report", async (req, res) => {
  try {
    const { userId, username, bugText, images } = req.body;

    if (!userId || !username || !bugText) {
      return res.status(400).json({ error: "Не все данные предоставлены" });
    }

    // Сохраняем багрепорт в базу данных
    const result = db.prepare(`
      INSERT INTO bug_reports (user_id, username, bug_text, status)
      VALUES (?, ?, ?, 'new')
    `).run(userId, username, bugText);

    const bugReportId = result.lastInsertRowid;

    // Сохраняем изображения если они есть
    if (images && Array.isArray(images) && images.length > 0) {
      const insertImage = db.prepare(`
        INSERT INTO bug_report_images (bug_report_id, image_data, image_name, image_size)
        VALUES (?, ?, ?, ?)
      `);

      for (const img of images) {
        insertImage.run(bugReportId, img.data, img.name, img.size);
      }
    }

    // Получаем информацию о пользователе
    const user = db
      .prepare("SELECT telegram_username FROM users WHERE id = ?")
      .get(userId);

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
      return res.status(500).json({ error: "Telegram не настроен" });
    }

    const time = new Date().toLocaleString("ru-RU");
    const message = `🐛 СООБЩЕНИЕ ОБ ОШИБКЕ #${bugReportId}

👤 От пользователя: ${username}
${user?.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
🕐 Время: ${time}

📝 Описание проблемы:
${bugText}${images && images.length > 0 ? `\n\n📎 Прикреплено изображений: ${images.length}` : ""}`;

    // Отправляем текстовое сообщение
    const telegramResponse = await fetch(
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

    if (!telegramResponse.ok) {
      throw new Error("Ошибка отправки в Telegram");
    }

    // Отправляем изображения если они есть
    if (images && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        
        try {
          // Конвертируем base64 в Buffer
          const base64Data = img.data.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          
          // Создаем Blob из Buffer
          const blob = new Blob([buffer], { type: 'image/jpeg' });
          
          // Создаем FormData
          const formData = new FormData();
          formData.append('chat_id', TELEGRAM_ADMIN_ID);
          formData.append('photo', blob, img.name || `image_${i + 1}.jpg`);
          formData.append('caption', `📷 Изображение ${i + 1}/${images.length} к багрепорту #${bugReportId}`);

          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
            {
              method: 'POST',
              body: formData
            }
          );
        } catch (imgError) {
          console.error(`⚠️ Ошибка отправки изображения ${i + 1}:`, imgError);
        }
      }
    }

    console.log(`✅ Багрепорт #${bugReportId} от ${username} отправлен админу${images && images.length > 0 ? ` с ${images.length} изображениями` : ''}`);
    res.json({ success: true, message: "Багрепорт отправлен" });
  } catch (error) {
    console.error("Ошибка при отправке багрепорта:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/bug-reports - Получить все багрепорты
router.get("/api/admin/bug-reports", (req, res) => {
  const { username: adminUsername } = req.query;

  // Проверяем, является ли пользователь админом
  if (adminUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    const bugReports = db.prepare(`
      SELECT 
        br.id,
        br.user_id,
        br.username,
        br.bug_text,
        br.status,
        br.created_at,
        u.telegram_username
      FROM bug_reports br
      LEFT JOIN users u ON br.user_id = u.id
      ORDER BY br.created_at DESC
    `).all();

    // Для каждого багрепорта получаем изображения
    const bugReportsWithImages = bugReports.map(report => {
      const images = db.prepare(`
        SELECT id, image_name, image_size, image_data
        FROM bug_report_images
        WHERE bug_report_id = ?
        ORDER BY created_at ASC
      `).all(report.id);

      return {
        ...report,
        images: images || []
      };
    });

    res.json(bugReportsWithImages);
  } catch (error) {
    console.error("Ошибка при получении багрепортов:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/bug-reports/:id/status - Изменить статус багрепорта
router.put("/api/admin/bug-reports/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status, username: adminUsername } = req.body;

  // Проверяем, является ли пользователь админом
  if (adminUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    // Получаем информацию о багрепорте до обновления
    const bugReport = db.prepare(`
      SELECT br.id, br.user_id, br.username, br.bug_text, br.status as old_status
      FROM bug_reports br
      WHERE br.id = ?
    `).get(id);

    if (!bugReport) {
      return res.status(404).json({ error: "Багрепорт не найден" });
    }

    // Обновляем статус
    db.prepare("UPDATE bug_reports SET status = ? WHERE id = ?").run(status, id);

    // Отправляем уведомление пользователю, если статус изменился
    if (bugReport.old_status !== status) {
      const user = db.prepare("SELECT telegram_id FROM users WHERE id = ?").get(bugReport.user_id);
      
      if (user && user.telegram_id) {
        const statusEmoji = {
          'new': '🆕',
          'in_progress': '🔄',
          'resolved': '✅',
          'rejected': '❌'
        };

        const statusText = {
          'new': 'Новый',
          'in_progress': 'В работе',
          'resolved': 'Решено',
          'rejected': 'Отклонено'
        };

        const cleanBugText = bugReport.bug_text.replace(/<[^>]*>/g, '').trim();
        const message = `🐛 ОБНОВЛЕНИЕ СТАТУСА БАГРЕПОРТА #${id}

${statusEmoji[status]} Статус изменен на: <b>${statusText[status]}</b>

📝 Ваше сообщение:
${cleanBugText.substring(0, 200)}${cleanBugText.length > 200 ? '...' : ''}

${status === 'resolved' ? '✅ Спасибо за помощь, малютка!' : ''}
${status === 'in_progress' ? '🔄 Как нехуй - щас починим.' : ''}
${status === 'rejected' ? '❌ Это не баг, это фича.' : ''}`;

        try {
          await sendUserMessage(user.telegram_id, message);
          console.log(`✅ Уведомление о смене статуса багрепорта #${id} отправлено пользователю ${bugReport.username}`);
        } catch (error) {
          console.error(`❌ Ошибка отправки уведомления пользователю:`, error);
        }
      }
    }

    res.json({ success: true, message: "Статус обновлен" });
  } catch (error) {
    console.error("Ошибка при обновлении статуса:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/bug-reports - Получить багрепорты пользователя
router.get("/api/user/bug-reports", (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: "userId обязателен" });
  }

  try {
    const bugReports = db.prepare(`
      SELECT 
        id,
        bug_text,
        status,
        created_at
      FROM bug_reports
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId);

    res.json(bugReports);
  } catch (error) {
    console.error("Ошибка при получении багрепортов пользователя:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/bug-reports/:id - Удалить багрепорт
router.delete("/api/admin/bug-reports/:id", async (req, res) => {
  const { id } = req.params;
  const { username: adminUsername } = req.body;

  // Проверяем, является ли пользователь админом
  if (adminUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    // Проверяем существование багрепорта
    const bugReport = db.prepare("SELECT id FROM bug_reports WHERE id = ?").get(id);

    if (!bugReport) {
      return res.status(404).json({ error: "Багрепорт не найден" });
    }

    // Удаляем изображения (благодаря ON DELETE CASCADE они удалятся автоматически)
    // Но можно явно удалить для логирования
    const deletedImages = db.prepare("DELETE FROM bug_report_images WHERE bug_report_id = ?").run(id);
    
    // Удаляем сам багрепорт
    db.prepare("DELETE FROM bug_reports WHERE id = ?").run(id);

    console.log(`✅ Багрепорт #${id} удален вместе с ${deletedImages.changes} изображениями`);
    res.json({ success: true, message: "Багрепорт удален" });
  } catch (error) {
    console.error("Ошибка при удалении багрепорта:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/test-group-notification - Отправить тестовое уведомление в группу
router.post("/api/admin/test-auto-counting", async (req, res) => {
  const { username: adminUsername, eventId, testMode } = req.body;

  // Проверяем, является ли пользователь админом
  if (adminUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    console.log(`\n🧪 ========================================`);
    console.log(`🧪 ТЕСТ АВТОПОДСЧЕТА (СИМУЛЯЦИЯ)`);
    console.log(`🧪 Event ID: ${eventId}`);
    console.log(`🧪 Режим: ${testMode ? 'Только админу' : 'В реальную группу'}`);
    console.log(`🧪 ========================================\n`);

    // Получаем информацию о турнире
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
    
    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }

    // Получаем ВСЕ незавершенные матчи текущего турнира
    const dbMatches = db.prepare(`
      SELECT * FROM matches
      WHERE event_id = ?
        AND status != 'finished'
      ORDER BY match_date, round
    `).all(eventId);

    if (dbMatches.length === 0) {
      return res.status(400).json({ 
        error: "Нет незавершенных матчей в этом турнире" 
      });
    }

    console.log(`📊 Найдено незавершенных матчей: ${dbMatches.length}`);
    console.log(`🎭 СИМУЛИРУЕМ завершение (БЕЗ изменения БД)\n`);

    // Группируем матчи по датам и турам
    const matchesByDateRound = {};
    dbMatches.forEach(match => {
      const date = match.match_date.split('T')[0];
      const key = `${date}_${match.round}`;
      if (!matchesByDateRound[key]) {
        matchesByDateRound[key] = {
          date,
          round: match.round,
          matches: []
        };
      }
      matchesByDateRound[key].matches.push(match);
    });

    console.log(`📅 Дат/туров: ${Object.keys(matchesByDateRound).length}\n`);

    // Генерируем СИМУЛИРОВАННЫЕ результаты (в памяти, не в БД)
    const simulatedResults = {};
    
    for (const dbMatch of dbMatches) {
      // Генерируем случайный счет (0-4 голов для каждой команды)
      const score1 = Math.floor(Math.random() * 5);
      const score2 = Math.floor(Math.random() * 5);
      
      // Определяем победителя
      let winner;
      if (score1 > score2) {
        winner = 'team1';
      } else if (score1 < score2) {
        winner = 'team2';
      } else {
        winner = 'draw';
      }
      
      simulatedResults[dbMatch.id] = {
        winner,
        score_team1: score1,
        score_team2: score2
      };
      
      console.log(`🎭 Симуляция: ${dbMatch.team1_name} ${score1}-${score2} ${dbMatch.team2_name} (${winner})`);
    }

    console.log(`\n✅ Симулировано ${Object.keys(simulatedResults).length} результатов\n`);

    // Теперь подсчитываем результаты для каждой даты/тура
    for (const [key, group] of Object.entries(matchesByDateRound)) {
      const { date, round } = group;
      
      console.log(`\n📊 Подсчет для ${date} | ${round}\n`);

      // Получаем ставки за эту дату/тур
      const bets = db.prepare(`
        SELECT 
          b.*,
          u.username,
          u.telegram_id,
          u.telegram_notifications_enabled,
          m.team1_name,
          m.team2_name,
          m.score_prediction_enabled,
          sp.score_team1 as predicted_score_team1,
          sp.score_team2 as predicted_score_team2
        FROM bets b
        JOIN users u ON b.user_id = u.id
        JOIN matches m ON b.match_id = m.id
        LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
        WHERE DATE(m.match_date) = ?
          AND m.round = ?
          AND m.status != 'finished'
          AND b.is_final_bet = 0
      `).all(date, round);

      if (bets.length === 0) {
        console.log(`⚠️ Нет ставок для ${date} | ${round}`);
        continue;
      }

      // Подсчитываем результаты используя СИМУЛИРОВАННЫЕ данные
      const userStats = {};
      
      bets.forEach(bet => {
        const username = bet.username;
        if (!userStats[username]) {
          userStats[username] = {
            userId: bet.user_id,
            telegramId: bet.telegram_id,
            telegramNotificationsEnabled: bet.telegram_notifications_enabled,
            points: 0,
            correctResults: 0,
            correctScores: 0
          };
        }
        
        // Берем СИМУЛИРОВАННЫЙ результат
        const simResult = simulatedResults[bet.match_id];
        if (!simResult) return;
        
        // Проверяем результат
        let isWon = false;
        if (bet.prediction === 'draw' && simResult.winner === 'draw') {
          isWon = true;
        } else if (bet.prediction === 'team1' && simResult.winner === 'team1') {
          isWon = true;
        } else if (bet.prediction === 'team2' && simResult.winner === 'team2') {
          isWon = true;
        } else if (bet.prediction === bet.team1_name && simResult.winner === 'team1') {
          isWon = true;
        } else if (bet.prediction === bet.team2_name && simResult.winner === 'team2') {
          isWon = true;
        }
        
        if (isWon) {
          userStats[username].points++;
          userStats[username].correctResults++;
          
          // Проверяем счет (только если включен прогноз на счет для этого матча)
          if (bet.score_prediction_enabled === 1 &&
              bet.predicted_score_team1 != null && bet.predicted_score_team2 != null &&
              bet.predicted_score_team1 === simResult.score_team1 &&
              bet.predicted_score_team2 === simResult.score_team2) {
            userStats[username].points++;
            userStats[username].correctScores++;
          }
        }
      });

      // Формируем сообщение
      const formatDate = (dateStr) => {
        const d = new Date(dateStr);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}.${month}.${year}`;
      };

      let message = `🧪 <b>ТЕСТ АВТОПОДСЧЕТА (СИМУЛЯЦИЯ)</b>\n\n`;
      message += `📅 Дата: ${formatDate(date)}\n`;
      message += `🏆 Тур: ${round}\n`;
      message += `🎯 Турнир: ${event.name}\n\n`;
      message += `📈 Статистика:\n`;

      const sortedUsers = Object.entries(userStats).sort(([, a], [, b]) => b.points - a.points);
      
      if (sortedUsers.length === 0) {
        message += `Нет результатов\n`;
      } else {
        sortedUsers.forEach(([username, stats]) => {
          const statsText = [];
          if (stats.correctResults > 0) {
            statsText.push(`✅ ${stats.correctResults}`);
          }
          if (stats.correctScores > 0) {
            statsText.push(`🎯 ${stats.correctScores}`);
          }
          const statsStr = statsText.length > 0 ? ` (${statsText.join(', ')})` : '';
          message += `• ${username}: ${stats.points} ${stats.points === 1 ? 'очко' : stats.points < 5 ? 'очка' : 'очков'}${statsStr}\n`;
        });
      }

      if (testMode) {
        message += `\n\n🧪 <b>ТЕСТОВЫЙ РЕЖИМ:</b> Отправлено только админу`;
      }

      // Отправляем уведомления в зависимости от режима
      if (testMode) {
        // Только админу
        await sendAdminNotification(message);
        console.log(`✅ Уведомление отправлено только админу (тестовый режим)`);
      } else {
        // В реальную группу
        await sendAdminNotification(message);
        console.log(`✅ Уведомление отправлено админу`);
        
        // Через 5 секунд отправляем в группу и персональные сообщения
        setTimeout(async () => {
          try {
            console.log(`📤 Отправка результатов в группу и пользователям...`);
            
            // Отправляем в группу
            await sendGroupNotification(message.replace('🧪 <b>ТЕСТ АВТОПОДСЧЕТА (СИМУЛЯЦИЯ)</b>', '🤖 <b>Результаты подсчета</b>'));
            
            // Отправляем персональные сообщения
            if (sortedUsers.length > 0) {
              const bestUser = sortedUsers[0];
              const worstUser = sortedUsers[sortedUsers.length - 1];
              
              for (const [username, stats] of sortedUsers) {
                if (!stats.telegramId || stats.telegramNotificationsEnabled !== 1) continue;
                
                let personalMessage = '';
                
                if (username === bestUser[0] && sortedUsers.length > 1) {
                  personalMessage = `🏆 <b>Сегодня ты лучший!</b>\n\n`;
                  personalMessage += `Ты набрал ${stats.points} ${stats.points === 1 ? 'очко' : stats.points < 5 ? 'очка' : 'очков'}`;
                  if (stats.correctScores > 0) {
                    personalMessage += ` и угадал ${stats.correctScores} ${stats.correctScores === 1 ? 'счет' : 'счета'} 🎯`;
                  }
                  personalMessage += `!\n\nТак держать! 💪`;
                } else if (username === worstUser[0] && sortedUsers.length > 1 && stats.points === 0) {
                  personalMessage = `😢 <b>Сегодня ты лох...</b>\n\n`;
                  personalMessage += `Ты набрал 0 очков.\n\nНе расстраивайся, в следующий раз обязательно получится! 🍀`;
                } else {
                  personalMessage = `📊 <b>Сегодня ты не лучший...</b>\n\n`;
                  personalMessage += `Ты набрал ${stats.points} ${stats.points === 1 ? 'очко' : stats.points < 5 ? 'очка' : 'очков'}`;
                  if (stats.correctScores > 0) {
                    personalMessage += ` и угадал ${stats.correctScores} ${stats.correctScores === 1 ? 'счет' : 'счета'} 🎯`;
                  }
                  personalMessage += `.\n\nПродолжай стараться! 💪`;
                }
                
                personalMessage += `\n\n📅 Дата: ${formatDate(date)}\n🏆 Тур: ${round}`;
                
                await sendTelegramMessage(stats.telegramId, personalMessage);
              }
            }
            
            console.log(`✅ Результаты отправлены в группу и пользователям`);
          } catch (error) {
            console.error(`❌ Ошибка отправки результатов:`, error);
          }
        }, 5000);
      }
    }

    console.log(`\n🧪 ========================================`);
    console.log(`🧪 ТЕСТ ЗАВЕРШЕН (БД НЕ ИЗМЕНЕНА)`);
    console.log(`🧪 ========================================\n`);

    res.json({ 
      success: true, 
      message: `Тест автоподсчета завершен (симуляция). БД не изменена.`,
      simulatedMatches: Object.keys(simulatedResults).length
    });

  } catch (error) {
    console.error("❌ Ошибка теста автоподсчета:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/notify-illegal-bet - уведомление админу о попытке запретной ставки
router.post("/api/admin/notify-illegal-bet", async (req, res) => {
  const { username, team1, team2, prediction, matchStatus } = req.body;
  console.log("📨 Получен запрос на уведомление о запретной ставке:", {
    username,
    team1,
    team2,
    prediction,
    matchStatus,
  });
  try {
    await notifyIllegalBet(username, team1, team2, prediction, matchStatus);
    res.json({ success: true });
  } catch (error) {
    console.error("Ошибка при отправке уведомления:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/notify-lucky-bet - Уведомить админа о случайной ставке
router.post("/api/admin/notify-lucky-bet", async (req, res) => {
  const { userId, eventName, round, matchesCount, scorePredictions, cardsPredictions } = req.body;

  try {
    // Получаем информацию о пользователе
    const user = db
      .prepare(
        "SELECT username, email, telegram_username FROM users WHERE id = ?"
      )
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Формируем сообщение для админа
    const luckyMessage = `🎲 СЛУЧАЙНАЯ СТАВКА

👤 Пользователь: ${user.username}
🆔 ID: ${userId}
${user.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}

🏆 Турнир: ${eventName}
🎯 Тур: ${round}
⚽ Матчей: ${matchesCount}

📊 Прогнозы:
${scorePredictions > 0 ? `✅ Счёт: ${scorePredictions} из ${matchesCount}` : '❌ Счёт: не ставилось'}
${cardsPredictions > 0 ? `✅ Карточки: ${cardsPredictions} из ${matchesCount}` : '❌ Карточки: не ставилось'}

💭 Пользователь решил положиться на удачу!`;

    // Отправляем сообщение админу
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
      console.log("⚠️ Telegram не настроен, уведомление не отправлено");
      return res.json({ success: true, message: "Telegram не настроен" });
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_ADMIN_ID,
          text: luckyMessage,
        }),
      }
    );

    if (!telegramResponse.ok) {
      throw new Error("Ошибка отправки в Telegram");
    }

    console.log(`✅ Уведомление о случайной ставке от ${user.username} отправлено админу`);
    res.json({ success: true, message: "Уведомление отправлено" });
  } catch (error) {
    console.error("Ошибка при отправке уведомления о случайной ставке:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/notify-database-access - Уведомить админа об открытии панели управления БД модератором
router.post("/api/admin/notify-database-access", async (req, res) => {
  const { username, userId } = req.body;

  try {
    if (!username) {
      return res.status(400).json({ error: "Не указано имя пользователя" });
    }

    // Формируем сообщение для админа
    const message = `🗄️ ДОСТУП К УПРАВЛЕНИЮ БД

👤 Модератор: ${username}
🆔 ID: ${userId}

🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}

⚠️ Модератор открыл панель управления базой данных`;

    // Отправляем сообщение админу
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
      console.log("⚠️ Telegram не настроен, уведомление не отправлено");
      return res.json({ success: true, message: "Telegram не настроен" });
    }

    const telegramResponse = await fetch(
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

    if (!telegramResponse.ok) {
      throw new Error("Ошибка отправки в Telegram");
    }

    console.log(`✅ Уведомление об открытии панели БД модератором ${username} отправлено админу`);
    res.json({ success: true, message: "Уведомление отправлено" });
  } catch (error) {
    console.error("Ошибка при отправке уведомления об открытии панели БД:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/matches/:matchId - Удалить матч
router.delete("/api/admin/matches/:matchId", async (req, res) => {
  const { matchId } = req.params;
  const { username } = req.body;

  // Проверяем права
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("delete_matches");
    }
    
    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  try {
    // Получаем информацию о матче для уведомления
    const match = db.prepare("SELECT team1_name, team2_name, match_date, round FROM matches WHERE id = ?").get(matchId);
    
    // Сначала удаляем все ставки, связанные с матчем (из таблицы bets)
    db.prepare("DELETE FROM bets WHERE match_id = ?").run(matchId);

    // Также удаляем из final_bets если таблица существует
    try {
      db.prepare("DELETE FROM final_bets WHERE match_id = ?").run(matchId);
    } catch (e) {
      // Таблица final_bets не существует, это нормально
    }

    // Удаляем параметры финала для этого матча
    try {
      db.prepare("DELETE FROM final_parameters_results WHERE match_id = ?").run(
        matchId
      );
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить параметры финала: ${e.message}`);
    }

    // Затем удаляем сам матч
    db.prepare("DELETE FROM matches WHERE id = ?").run(matchId);

    // Уведомление админу если это модератор
    if (isModerator && username && match) {
      const event = db.prepare("SELECT e.name FROM events e JOIN matches m ON m.event_id = e.id WHERE m.id = ?").get(matchId);
      const details = `⚽ Матч: ${match.team1_name} vs ${match.team2_name}
📅 Дата: ${match.match_date || 'не указана'}
🔢 Тур: ${match.round || 'не указан'}`;
      
      await notifyModeratorAction(username, "Удаление матча", details);
      
      // Запись в логи
      writeBetLog("match_deleted", {
        moderator: username,
        team1: match.team1_name,
        team2: match.team2_name,
        tournament: event?.name || "Неизвестно",
        round: match.round || 'не указан'
      });
    }

    res.json({ success: true, message: "Матч успешно удален" });
  } catch (error) {
    console.error("❌ Ошибка при удалении матча:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/rounds/:roundName - Удалить тур и все его матчи
router.delete("/api/admin/rounds/:roundName", (req, res) => {
  const { roundName } = req.params;
  const { username, event_id } = req.body;

  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    // Получаем все матчи этого тура
    const matches = db
      .prepare("SELECT id FROM matches WHERE round = ? AND event_id = ?")
      .all(roundName, event_id);

    console.log(`🗑️ Удаление тура "${roundName}" с ${matches.length} матчами`);

    // Удаляем ставки для каждого матча
    for (const match of matches) {
      db.prepare("DELETE FROM bets WHERE match_id = ?").run(match.id);
      
      try {
        db.prepare("DELETE FROM final_bets WHERE match_id = ?").run(match.id);
      } catch (e) {
        // Таблица final_bets не существует
      }

      try {
        db.prepare("DELETE FROM final_parameters_results WHERE match_id = ?").run(match.id);
      } catch (e) {
        // Таблица не существует
      }
    }

    // Удаляем все матчи тура
    const result = db
      .prepare("DELETE FROM matches WHERE round = ? AND event_id = ?")
      .run(roundName, event_id);

    console.log(`✅ Тур "${roundName}" удален, удалено матчей: ${result.changes}`);
    
    res.json({ 
      success: true, 
      message: `Тур "${roundName}" и ${matches.length} матчей успешно удалены`,
      deletedMatches: matches.length
    });
  } catch (error) {
    console.error("❌ Ошибка при удалении тура:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/send-counting-results - Отправить результаты подсчета в группу
router.post("/api/admin/send-counting-results", async (req, res) => {
  const { dateFrom, dateTo } = req.body;

  try {
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: "Не указаны даты" });
    }

    // Получаем все турниры
    const events = db.prepare("SELECT id, name FROM events").all();

    // Для каждого турнира считаем очки пользователей за период
    const tournamentResults = [];

    for (const event of events) {
      // Получаем завершенные матчи в указанном периоде
      const matches = db.prepare(`
        SELECT id, team1_name, team2_name, winner, match_date
        FROM matches
        WHERE event_id = ? 
          AND winner IS NOT NULL
          AND DATE(match_date) >= DATE(?)
          AND DATE(match_date) <= DATE(?)
      `).all(event.id, dateFrom, dateTo);

      if (matches.length === 0) continue;

      // Получаем ставки на эти матчи с прогнозами на счет
      const matchIds = matches.map(m => m.id);
      const placeholders = matchIds.map(() => '?').join(',');
      
      const bets = db.prepare(`
        SELECT 
          b.user_id, 
          b.match_id, 
          b.prediction, 
          m.winner, 
          m.is_final,
          m.score_prediction_enabled,
          m.yellow_cards_prediction_enabled,
          m.red_cards_prediction_enabled,
          u.username, 
          u.telegram_username,
          sp.score_team1 as predicted_score1,
          sp.score_team2 as predicted_score2,
          ms.score_team1 as actual_score1,
          ms.score_team2 as actual_score2,
          cp.yellow_cards as predicted_yellow_cards,
          cp.red_cards as predicted_red_cards,
          m.yellow_cards as actual_yellow_cards,
          m.red_cards as actual_red_cards
        FROM bets b
        JOIN matches m ON b.match_id = m.id
        JOIN users u ON b.user_id = u.id
        LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
        LEFT JOIN match_scores ms ON b.match_id = ms.match_id
        LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
        WHERE b.match_id IN (${placeholders})
      `).all(...matchIds);

      // Подсчитываем очки для каждого пользователя
      const userPoints = {};

      for (const bet of bets) {
        if (!userPoints[bet.user_id]) {
          userPoints[bet.user_id] = {
            username: bet.username,
            telegram_username: bet.telegram_username,
            points: 0,
            correctResults: 0,
            correctScores: 0,
            correctYellowCards: 0,
            correctRedCards: 0
          };
        }

        // Проверяем правильность ставки на результат
        const isCorrect = 
          (bet.prediction === 'team1' && bet.winner === 'team1') ||
          (bet.prediction === 'team2' && bet.winner === 'team2') ||
          (bet.prediction === 'draw' && bet.winner === 'draw');

        if (isCorrect) {
          // Очки за результат (1 или 3 для финала)
          const resultPoints = bet.is_final ? 3 : 1;
          userPoints[bet.user_id].points += resultPoints;
          userPoints[bet.user_id].correctResults++;

          // Проверяем прогноз на счет (только если включен для этого матча)
          if (bet.score_prediction_enabled === 1 &&
              bet.predicted_score1 !== null && bet.predicted_score2 !== null &&
              bet.actual_score1 !== null && bet.actual_score2 !== null) {
            const scoreCorrect = 
              bet.predicted_score1 === bet.actual_score1 && 
              bet.predicted_score2 === bet.actual_score2;
            
            if (scoreCorrect) {
              userPoints[bet.user_id].points++;
              userPoints[bet.user_id].correctScores++;
            }
          }

          // Проверяем прогноз на желтые карточки (только если включен для этого матча)
          if (bet.yellow_cards_prediction_enabled === 1 &&
              bet.predicted_yellow_cards !== null &&
              bet.actual_yellow_cards !== null &&
              bet.predicted_yellow_cards === bet.actual_yellow_cards) {
            userPoints[bet.user_id].points++;
            userPoints[bet.user_id].correctYellowCards++;
          }

          // Проверяем прогноз на красные карточки (только если включен для этого матча)
          if (bet.red_cards_prediction_enabled === 1 &&
              bet.predicted_red_cards !== null &&
              bet.actual_red_cards !== null &&
              bet.predicted_red_cards === bet.actual_red_cards) {
            userPoints[bet.user_id].points++;
            userPoints[bet.user_id].correctRedCards++;
          }
        }
      }

      // Сортируем по очкам
      const sortedUsers = Object.values(userPoints).sort((a, b) => b.points - a.points);

      if (sortedUsers.length > 0) {
        tournamentResults.push({
          eventName: event.name,
          users: sortedUsers
        });
      }
    }

    if (tournamentResults.length === 0) {
      return res.status(404).json({ error: "Нет результатов за указанный период" });
    }

    // Формируем сообщение для Telegram
    const dateFromFormatted = new Date(dateFrom).toLocaleDateString('ru-RU');
    const dateToFormatted = new Date(dateTo).toLocaleDateString('ru-RU');
    
    let message = `📊 <b>Результаты за период</b>\n`;
    message += `📅 ${dateFromFormatted} - ${dateToFormatted}\n\n`;

    for (const tournament of tournamentResults) {
      message += `🏆 <b>${tournament.eventName}</b>\n\n`;

      // Показываем результаты всех пользователей
      if (tournament.users.length > 0) {
        // Определяем уникальные значения очков для присвоения мест
        const uniqueScores = [...new Set(tournament.users.map(u => u.points))];
        
        for (let i = 0; i < tournament.users.length; i++) {
          const user = tournament.users[i];
          
          // Определяем место по уникальному значению очков
          const place = uniqueScores.indexOf(user.points) + 1;
          
          // Присваиваем медаль по месту (только первые 3 места получают медали)
          const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '▪️';
          
          // Правильное склонение для очков
          let pointsWord;
          if (user.points === 0) {
            pointsWord = 'очков';
          } else if (user.points === 1) {
            pointsWord = 'очко';
          } else if (user.points >= 2 && user.points <= 4) {
            pointsWord = 'очка';
          } else {
            pointsWord = 'очков';
          }
          
          let userLine = `${medal} ${user.username}: <b>${user.points}</b> ${pointsWord}`;
          
          // Добавляем статистику по результатам и счетам
          const stats = [];
          if (user.correctResults > 0) {
            stats.push(`✅ ${user.correctResults}`);
          }
          if (user.correctScores > 0) {
            stats.push(`🎯 ${user.correctScores}`);
          }
          if (user.correctYellowCards > 0) {
            stats.push(`🟨 ${user.correctYellowCards}`);
          }
          if (user.correctRedCards > 0) {
            stats.push(`🟥 ${user.correctRedCards}`);
          }
          if (stats.length > 0) {
            userLine += ` (${stats.join(', ')})`;
          }
          
          message += userLine + '\n';
        }

        // Лучшие за период (может быть несколько с одинаковыми очками)
        if (tournament.users.length > 0) {
          const maxPoints = tournament.users[0].points;
          const winners = tournament.users.filter(u => u.points === maxPoints);
          
          if (maxPoints === 0) {
            // Все набрали 0 очков — никого поздравлять не с чем
            message += `\n😶 <b>Никто ничего не угадал за период ${dateFromFormatted} - ${dateToFormatted}.</b> Бывает.\n`;
          } else {
            message += `\n👑 <b>Лучший за период ${dateFromFormatted} - ${dateToFormatted}:</b>\n`;
            
            if (winners.length === 1) {
              message += `Поздравляем, малютка ${winners[0].username}! 🎉\n`;
              if (winners[0].correctScores > 0) {
                message += `🎯 Угадано счетов: ${winners[0].correctScores}\n`;
              }
            } else {
              // Несколько победителей с одинаковыми очками
              const winnerNames = winners.map(w => w.username).join(' и ');
              message += `Поздравляем малюток ${winnerNames}! 🎉\n`;
            }
          }
        }
      } else {
        message += `Нет участников\n`;
      }

      message += `\n`;
    }

    // Отправляем в группу напрямую через Telegram API (без топика)
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.error("❌ Telegram токен или chat ID не настроены");
      return res.status(500).json({ error: "Telegram не настроен" });
    }

    const chatIds = TELEGRAM_CHAT_ID.split(",").map((id) => id.trim());

    // Отправляем в группу через sendGroupNotification (с кнопками реакций)
    try {
      await sendGroupNotification(message);
      console.log(`✅ Результаты отправлены в группу`);
    } catch (error) {
      console.error(`❌ Ошибка отправки результатов в группу:`, error);
    }

    // Отправляем персонализированные сообщения в личку пользователям
    try {
      // Получаем всех пользователей с привязанным Telegram и включенной настройкой личных сообщений
      const usersWithTelegram = db.prepare(`
        SELECT u.id, u.username, u.telegram_id, u.telegram_username
        FROM users u
        WHERE u.telegram_id IS NOT NULL 
          AND u.telegram_notifications_enabled = 1
      `).all();

      console.log(`📱 Найдено ${usersWithTelegram.length} пользователей для отправки личных сообщений`);

      // Для каждого турнира отправляем персонализированные сообщения
      for (const tournament of tournamentResults) {
        const users = tournament.users;
        
        if (users.length === 0) continue;

        // Находим максимальное и минимальное количество очков
        const maxPoints = users[0].points;
        const minPoints = users[users.length - 1].points;

        // Находим всех победителей (может быть несколько с одинаковыми очками)
        const winners = users.filter(u => u.points === maxPoints);

        // Отправляем каждому пользователю персонализированное сообщение
        for (const user of users) {
          // Проверяем, есть ли этот пользователь в списке с Telegram
          const telegramUser = usersWithTelegram.find(u => u.username === user.username);
          
          if (!telegramUser) {
            console.log(`⏭️ Пропускаем ${user.username} - нет Telegram или отключены уведомления`);
            continue;
          }

          // Формируем персонализированное сообщение
          let personalMessage = `📊 <b>Результаты за период</b>\n`;
          personalMessage += `📅 ${dateFromFormatted} - ${dateToFormatted}\n\n`;
          personalMessage += `🏆 <b>${tournament.eventName}</b>\n\n`;

          // Добавляем список всех участников с правильными медалями
          // Определяем уникальные значения очков для присвоения мест
          const uniqueScores = [...new Set(users.map(u => u.points))];
          
          for (let i = 0; i < users.length; i++) {
            const u = users[i];
            
            // Определяем место по уникальному значению очков
            const place = uniqueScores.indexOf(u.points) + 1;
            
            // Присваиваем медаль по месту (только первые 3 места получают медали)
            const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '▪️';
            
            // Правильное склонение для очков
            let pointsWord;
            if (u.points === 0) {
              pointsWord = 'очков';
            } else if (u.points === 1) {
              pointsWord = 'очко';
            } else if (u.points >= 2 && u.points <= 4) {
              pointsWord = 'очка';
            } else {
              pointsWord = 'очков';
            }
            
            let userLine = `${medal} ${u.username}: <b>${u.points}</b> ${pointsWord}`;
            
            // Добавляем статистику
            const stats = [];
            if (u.correctResults > 0) {
              stats.push(`✅ ${u.correctResults}`);
            }
            if (u.correctScores > 0) {
              stats.push(`🎯 ${u.correctScores}`);
            }
            if (u.correctYellowCards > 0) {
              stats.push(`🟨 ${u.correctYellowCards}`);
            }
            if (u.correctRedCards > 0) {
              stats.push(`🟥 ${u.correctRedCards}`);
            }
            if (stats.length > 0) {
              userLine += ` (${stats.join(', ')})`;
            }
            
            personalMessage += userLine + '\n';
          }

          personalMessage += '\n';

          // Добавляем персонализированное окончание
          // Правильное склонение для очков текущего пользователя
          let userPointsWord;
          if (user.points === 0) {
            userPointsWord = 'очков';
          } else if (user.points === 1) {
            userPointsWord = 'очко';
          } else if (user.points >= 2 && user.points <= 4) {
            userPointsWord = 'очка';
          } else {
            userPointsWord = 'очков';
          }

          if (user.points === maxPoints) {
            // Пользователь лучший (или один из лучших)
            if (maxPoints === 0) {
              // Все набрали 0 — никто не победил
              personalMessage += `😶 Сегодня никто ничего не угадал, ты не одинок в своём провале, малютка ${user.username}.`;
            } else if (winners.length === 1) {
              personalMessage += `Сегодня ты лучший, у тебя <b>${user.points} ${userPointsWord}</b>, поздравляю, малютка 👑 ${user.username}! 🎉`;
            } else {
              personalMessage += `Сегодня ты один из лучших, у тебя <b>${user.points} ${userPointsWord}</b>, поздравляю, малютка 👑 ${user.username}! 🎉`;
            }
          } else if (user.points === minPoints) {
            // Пользователь худший (или один из худших)
            if (winners.length === 1) {
              personalMessage += `Сегодня ты лох, такое может случиться с каждым, у тебя <b>${user.points} ${userPointsWord}</b>, а лучший, это малютка 👑 ${winners[0].username}! 🎉`;
            } else {
              const winnerNames = winners.map(w => w.username).join(' и ');
              personalMessage += `Сегодня ты лох, такое может случиться с каждым, у тебя <b>${user.points} ${userPointsWord}</b>, а лучшие, это малютки 👑 ${winnerNames}! 🎉`;
            }
          } else {
            // Пользователь в середине
            if (winners.length === 1) {
              personalMessage += `Сегодня ты не лучший, у тебя <b>${user.points} ${userPointsWord}</b>, а лучший, это малютка 👑 ${winners[0].username}! 🎉`;
            } else {
              const winnerNames = winners.map(w => w.username).join(' и ');
              personalMessage += `Сегодня ты не лучший, у тебя <b>${user.points} ${userPointsWord}</b>, а лучшие, это малютки 👑 ${winnerNames}! 🎉`;
            }
          }

          // Отправляем личное сообщение через sendUserMessage (с кнопками реакций)
          try {
            await sendUserMessage(telegramUser.telegram_id, personalMessage);
            console.log(`✅ Личное сообщение отправлено ${user.username} (${telegramUser.telegram_id})`);
          } catch (error) {
            console.error(`❌ Ошибка отправки личного сообщения ${user.username}:`, error);
          }

          // Небольшая задержка между отправками, чтобы не превысить лимиты Telegram API
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } catch (error) {
      console.error("❌ Ошибка отправки личных сообщений:", error);
    }

    res.json({ success: true, message: "Результаты отправлены в группу и личные сообщения" });
  } catch (error) {
    console.error("❌ Ошибка отправки результатов:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/get-events-for-date - Получить список турниров для выбранной даты
router.get("/api/admin/get-events-for-date", (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: "Не указана дата" });
  }

  try {
    // Получаем все турниры для указанной даты с количеством матчей
    const events = db.prepare(`
      SELECT 
        e.id as event_id,
        e.name as event_name,
        COUNT(*) as matches_count
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE DATE(m.match_date) = ?
      GROUP BY e.id, e.name
      ORDER BY e.name
    `).all(date);

    res.json({ events });
  } catch (error) {
    console.error("❌ Ошибка получения турниров:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/get-rounds-for-event - Получить список туров для выбранного турнира и даты
router.get("/api/admin/get-rounds-for-event", (req, res) => {
  const { eventId, date } = req.query;

  if (!eventId || !date) {
    return res.status(400).json({ error: "Не указан турнир или дата" });
  }

  try {
    // Получаем все туры для указанного турнира и даты с количеством матчей
    const rounds = db.prepare(`
      SELECT 
        m.round,
        COUNT(*) as matches_count,
        SUM(CASE WHEN m.status = 'finished' THEN 1 ELSE 0 END) as finished_count
      FROM matches m
      WHERE m.event_id = ?
        AND DATE(m.match_date) = ?
      GROUP BY m.round
      ORDER BY m.round
    `).all(eventId, date);

    res.json({ rounds });
  } catch (error) {
    console.error("❌ Ошибка получения туров:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/cleanup-disabled-predictions - Очистить прогнозы для матчей с отключенными чекбоксами
router.post("/api/admin/cleanup-disabled-predictions", async (req, res) => {
  const { username } = req.body;

  // Проверяем права (админ или модератор с правами на подсчет)
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  const isAdmin = username === ADMIN_DB_NAME;
  
  if (!isAdmin) {
    const moderator = db.prepare(`
      SELECT m.*, u.username 
      FROM moderators m
      JOIN users u ON m.user_id = u.id
      WHERE u.username = ?
    `).get(username);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = moderator.permissions ? moderator.permissions.split(',') : [];
    if (!permissions.includes('view_counting')) {
      return res.status(403).json({ error: "Недостаточно прав для очистки прогнозов" });
    }
  }

  try {
    console.log(`\n🧹 ========================================`);
    console.log(`🧹 ОЧИСТКА ПРОГНОЗОВ С ОТКЛЮЧЕННЫМИ ЧЕКБОКСАМИ`);
    console.log(`🧹 Инициатор: ${username}`);
    console.log(`🧹 ========================================\n`);

    // Получаем все матчи
    const matches = db.prepare("SELECT id, team1_name, team2_name, score_prediction_enabled, yellow_cards_prediction_enabled, red_cards_prediction_enabled FROM matches").all();
    
    let totalDeletedScores = 0;
    let totalDeletedYellow = 0;
    let totalDeletedRed = 0;
    let totalDeletedCardsRecords = 0;

    matches.forEach(match => {
      // Удаляем прогнозы на счет если чекбокс отключен
      if (match.score_prediction_enabled === 0) {
        const deleted = db.prepare("DELETE FROM score_predictions WHERE match_id = ?").run(match.id);
        if (deleted.changes > 0) {
          console.log(`🗑️ Матч ${match.team1_name} - ${match.team2_name}: удалено ${deleted.changes} прогнозов на счет`);
          totalDeletedScores += deleted.changes;
        }
      }

      // Удаляем прогнозы на желтые карточки если чекбокс отключен
      if (match.yellow_cards_prediction_enabled === 0) {
        const deleted = db.prepare("UPDATE cards_predictions SET yellow_cards = NULL WHERE match_id = ?").run(match.id);
        if (deleted.changes > 0) {
          console.log(`🗑️ Матч ${match.team1_name} - ${match.team2_name}: удалено ${deleted.changes} прогнозов на желтые карточки`);
          totalDeletedYellow += deleted.changes;
        }
      }

      // Удаляем прогнозы на красные карточки если чекбокс отключен
      if (match.red_cards_prediction_enabled === 0) {
        const deleted = db.prepare("UPDATE cards_predictions SET red_cards = NULL WHERE match_id = ?").run(match.id);
        if (deleted.changes > 0) {
          console.log(`🗑️ Матч ${match.team1_name} - ${match.team2_name}: удалено ${deleted.changes} прогнозов на красные карточки`);
          totalDeletedRed += deleted.changes;
        }
      }
    });

    // Удаляем пустые записи в cards_predictions (где оба поля NULL)
    const deletedEmpty = db.prepare("DELETE FROM cards_predictions WHERE yellow_cards IS NULL AND red_cards IS NULL").run();
    totalDeletedCardsRecords = deletedEmpty.changes;

    console.log(`\n✅ Очистка завершена!`);
    console.log(`📊 Статистика:`);
    console.log(`   - Удалено прогнозов на счет: ${totalDeletedScores}`);
    console.log(`   - Удалено прогнозов на желтые карточки: ${totalDeletedYellow}`);
    console.log(`   - Удалено прогнозов на красные карточки: ${totalDeletedRed}`);
    console.log(`   - Удалено пустых записей в cards_predictions: ${totalDeletedCardsRecords}\n`);

    res.json({
      success: true,
      message: "Прогнозы успешно очищены",
      stats: {
        deletedScores: totalDeletedScores,
        deletedYellow: totalDeletedYellow,
        deletedRed: totalDeletedRed,
        deletedCardsRecords: totalDeletedCardsRecords
      }
    });
  } catch (error) {
    console.error("❌ Ошибка очистки прогнозов:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/recount-results - Пересчитать результаты для конкретной даты
router.post("/api/admin/recount-results", async (req, res) => {
  const { username, date, round, eventId, sendToGroup, sendToUsers } = req.body;

  console.log('🔄 Пересчет результатов:', { username, date, round, sendToGroup, sendToUsers });

  // Проверяем права (админ или модератор с правами на подсчет)
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  const isAdmin = username === ADMIN_DB_NAME;
  
  if (!isAdmin) {
    console.log('Проверка прав модератора для:', username);
    const moderator = db.prepare(`
      SELECT m.*, u.username 
      FROM moderators m
      JOIN users u ON m.user_id = u.id
      WHERE u.username = ?
    `).get(username);
    
    console.log('Найден модератор:', moderator);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = moderator.permissions ? moderator.permissions.split(',') : [];
    if (!permissions.includes('view_counting')) {
      return res.status(403).json({ error: "Недостаточно прав для пересчета" });
    }
  }

  try {
    if (!date || !round) {
      return res.status(400).json({ error: "Не указаны дата или тур" });
    }

    console.log(`\n🔄 ========================================`);
    console.log(`🔄 ПЕРЕСЧЕТ РЕЗУЛЬТАТОВ`);
    console.log(`🔄 Инициатор: ${username}`);
    console.log(`🔄 Дата: ${date}`);
    console.log(`🔄 Тур: ${round}`);
    console.log(`🔄 ========================================\n`);

    // Шаг 1: Получаем все матчи для этой даты и тура
    const matches = db.prepare(`
      SELECT m.*, e.icon, e.name as event_name
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE DATE(m.match_date) = ?
        AND m.round = ?
        ${eventId ? 'AND m.event_id = ?' : ''}
    `).all(...[date, round, ...(eventId ? [eventId] : [])]);

    if (matches.length === 0) {
      return res.status(404).json({ error: "Не найдено матчей для указанной даты и тура" });
    }

    console.log(`📊 Найдено матчей: ${matches.length}`);

    // Шаг 1.5: Очищаем прогнозы для матчей где админ отключил чекбоксы
    let totalDeletedScores = 0;
    let totalDeletedYellow = 0;
    let totalDeletedRed = 0;

    matches.forEach(match => {
      // Удаляем прогнозы на счет если чекбокс отключен
      if (match.score_prediction_enabled === 0) {
        const deleted = db.prepare("DELETE FROM score_predictions WHERE match_id = ?").run(match.id);
        totalDeletedScores += deleted.changes;
      }

      // Удаляем прогнозы на желтые карточки если чекбокс отключен
      if (match.yellow_cards_prediction_enabled === 0) {
        const deleted = db.prepare("UPDATE cards_predictions SET yellow_cards = NULL WHERE match_id = ?").run(match.id);
        totalDeletedYellow += deleted.changes;
      }

      // Удаляем прогнозы на красные карточки если чекбокс отключен
      if (match.red_cards_prediction_enabled === 0) {
        const deleted = db.prepare("UPDATE cards_predictions SET red_cards = NULL WHERE match_id = ?").run(match.id);
        totalDeletedRed += deleted.changes;
      }
    });

    // Удаляем пустые записи в cards_predictions
    const matchIds = matches.map(m => m.id);
    if (matchIds.length > 0) {
      const placeholders = matchIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM cards_predictions WHERE match_id IN (${placeholders}) AND yellow_cards IS NULL AND red_cards IS NULL`).run(...matchIds);
    }

    if (totalDeletedScores > 0) {
      console.log(`🗑️ Удалено прогнозов на счет (чекбокс отключен): ${totalDeletedScores}`);
    }
    if (totalDeletedYellow > 0) {
      console.log(`🗑️ Удалено прогнозов на желтые карточки (чекбокс отключен): ${totalDeletedYellow}`);
    }
    if (totalDeletedRed > 0) {
      console.log(`🗑️ Удалено прогнозов на красные карточки (чекбокс отключен): ${totalDeletedRed}`);
    }

    // Шаг 2: Сбрасываем результаты этих матчей (только для выбранного турнира)
    const matchIdsToReset = matches.map(m => m.id);
    const placeholdersReset = matchIdsToReset.map(() => '?').join(',');
    const resetResult = db.prepare(`
      UPDATE matches
      SET status = 'pending',
          winner = NULL,
          team1_score = NULL,
          team2_score = NULL,
          yellow_cards = NULL,
          red_cards = NULL
      WHERE id IN (${placeholdersReset})
    `).run(...matchIdsToReset);
    console.log(`✅ Сброшено матчей: ${resetResult.changes}`);

    // Шаг 3: Удаляем обработанную дату из списка
    // Шаг 4: Запускаем автоподсчет для этой даты
    const event = matches[0];
    const competition_code = ICON_TO_COMPETITION[event.icon];

    if (!competition_code) {
      return res.status(400).json({ error: "Не удалось определить турнир" });
    }

    // Удаляем обработанную дату из Set и из БД (правильный ключ с competition_code)
    const dateKey = `${date}_${round}_${competition_code}`;
    if (processedDates.has(dateKey)) {
      processedDates.delete(dateKey);
      console.log(`✅ Удалена обработанная дата из Set: ${dateKey}`);
    }
    db.prepare('DELETE FROM auto_counting_processed WHERE date_key = ?').run(dateKey);
    console.log(`✅ Удалена обработанная дата из БД: ${dateKey}`);

    console.log(`🔄 Запуск автоподсчета для ${date} | ${round}...`);

    // Вызываем функцию автоподсчета
    const dateGroup = {
      event_id: event.event_id,
      competition_code,
      round,
      date
    };

    // Проверяем завершение матчей
    const { allFinished, matches: matchedMatches } = await checkDateCompletion(dateGroup, true);

    if (!allFinished) {
      return res.status(400).json({ 
        error: "Не все матчи завершены. Пересчет возможен только для полностью завершенных дат." 
      });
    }

    // Обновляем матчи из API
    const matchesWithApi = matchedMatches.filter(m => m.apiMatch !== null);
    if (matchesWithApi.length > 0) {
      const updated = await updateMatchesFromAPI(matchesWithApi);
      if (!updated) {
        return res.status(500).json({ error: "Не удалось обновить результаты матчей" });
      }
    }

    // Помечаем дату как обработанную
    const fullDateKey = `${date}_${round}_${competition_code}`;
    processedDates.add(fullDateKey);
    saveProcessedDate(fullDateKey);

    console.log(`✅ Результаты обновлены`);

    // Шаг 5: Получаем ставки и подсчитываем результаты
    const bets = db.prepare(`
      SELECT 
        b.*,
        u.username,
        u.telegram_id,
        u.telegram_notifications_enabled,
        m.team1_name,
        m.team2_name,
        m.winner,
        m.team1_score as actual_score_team1,
        m.team2_score as actual_score_team2,
        m.yellow_cards as actual_yellow_cards,
        m.red_cards as actual_red_cards,
        m.score_prediction_enabled,
        m.yellow_cards_prediction_enabled,
        m.red_cards_prediction_enabled,
        sp.score_team1 as predicted_score_team1,
        sp.score_team2 as predicted_score_team2,
        cp.yellow_cards as predicted_yellow_cards,
        cp.red_cards as predicted_red_cards
      FROM bets b
      JOIN users u ON b.user_id = u.id
      JOIN matches m ON b.match_id = m.id
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
      WHERE DATE(m.match_date) = ?
        AND m.round = ?
        AND m.event_id = ?
        AND m.status = 'finished'
        AND b.is_final_bet = 0
    `).all(date, round, event.event_id);

    console.log(`📊 Найдено ставок: ${bets.length}`);

    // Подсчитываем результаты
    const userStats = {};
    
    bets.forEach(bet => {
      const username = bet.username;
      if (!userStats[username]) {
        userStats[username] = {
          userId: bet.user_id,
          telegramId: bet.telegram_id,
          telegramNotificationsEnabled: bet.telegram_notifications_enabled,
          points: 0,
          correctResults: 0,
          correctScores: 0,
          correctYellowCards: 0,
          correctRedCards: 0
        };
      }
      
      // Проверяем результат
      let isWon = false;
      if (bet.prediction === 'draw' && bet.winner === 'draw') {
        isWon = true;
      } else if (bet.prediction === 'team1' && bet.winner === 'team1') {
        isWon = true;
      } else if (bet.prediction === 'team2' && bet.winner === 'team2') {
        isWon = true;
      } else if (bet.prediction === bet.team1_name && bet.winner === 'team1') {
        isWon = true;
      } else if (bet.prediction === bet.team2_name && bet.winner === 'team2') {
        isWon = true;
      }
      
      if (isWon) {
        userStats[username].points++;
        userStats[username].correctResults++;
        
        // Проверяем счет (только если включен прогноз на счет для этого матча)
        if (bet.score_prediction_enabled === 1 &&
            bet.predicted_score_team1 != null && bet.predicted_score_team2 != null &&
            bet.predicted_score_team1 === bet.actual_score_team1 &&
            bet.predicted_score_team2 === bet.actual_score_team2) {
          userStats[username].points++;
          userStats[username].correctScores++;
        }
        
        // Проверяем желтые карточки (только если включен прогноз на желтые карточки для этого матча)
        if (bet.yellow_cards_prediction_enabled === 1 &&
            bet.predicted_yellow_cards != null &&
            bet.actual_yellow_cards != null &&
            bet.predicted_yellow_cards === bet.actual_yellow_cards) {
          userStats[username].points++;
          userStats[username].correctYellowCards++;
        }
        
        // Проверяем красные карточки (только если включен прогноз на красные карточки для этого матча)
        if (bet.red_cards_prediction_enabled === 1 &&
            bet.predicted_red_cards != null &&
            bet.actual_red_cards != null &&
            bet.predicted_red_cards === bet.actual_red_cards) {
          userStats[username].points++;
          userStats[username].correctRedCards++;
        }
      }
    });

    // Формируем сообщение
    const formatDate = (dateStr) => {
      const d = new Date(dateStr);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}.${month}.${year}`;
    };

    let message = `🔄 <b>Результаты пересчета</b>\n\n`;
    message += `📅 Дата: ${formatDate(date)}\n`;
    message += `🏆 Тур: ${round}\n`;
    message += `🎯 Турнир: ${event.event_name}\n\n`;
    message += `📈 Статистика:\n`;

    const sortedUsers = Object.entries(userStats).sort(([, a], [, b]) => b.points - a.points);
    
    if (sortedUsers.length === 0) {
      message += `Нет результатов\n`;
    } else {
      // Определяем уникальные значения очков для присвоения мест
      const uniqueScores = [...new Set(sortedUsers.map(([, stats]) => stats.points))];
      
      sortedUsers.forEach(([username, stats]) => {
        // Определяем место по уникальному значению очков
        const place = uniqueScores.indexOf(stats.points) + 1;
        
        // Присваиваем медаль по месту (только первые 3 места получают медали)
        const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '▪️';
        
        const statsText = [];
        if (stats.correctResults > 0) {
          statsText.push(`✅ ${stats.correctResults}`);
        }
        if (stats.correctScores > 0) {
          statsText.push(`🎯 ${stats.correctScores}`);
        }
        if (stats.correctYellowCards > 0) {
          statsText.push(`🟨 ${stats.correctYellowCards}`);
        }
        if (stats.correctRedCards > 0) {
          statsText.push(`🟥 ${stats.correctRedCards}`);
        }
        const statsStr = statsText.length > 0 ? ` (${statsText.join(', ')})` : '';
        message += `${medal} ${username}: ${stats.points} ${stats.points === 1 ? 'очко' : stats.points < 5 ? 'очка' : 'очков'}${statsStr}\n`;
      });
    }

    console.log(`✅ Пересчет завершен`);

    // Шаг 6: Отправляем уведомления если нужно
    if (sendToGroup || sendToUsers) {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

      if (!TELEGRAM_BOT_TOKEN) {
        console.log('⚠️ Telegram не настроен, уведомления не отправлены');
      } else {
        // Отправляем в группу
        if (sendToGroup && TELEGRAM_CHAT_ID) {
          const chatIds = TELEGRAM_CHAT_ID.split(",").map((id) => id.trim());
          for (const chatId of chatIds) {
            try {
              const replyMarkup = {
                inline_keyboard: [
                  [
                    { text: "👍", callback_data: `group_reaction_thumbsup` },
                    { text: "🔥", callback_data: `group_reaction_fire` },
                    { text: "❤️", callback_data: `group_reaction_heart` },
                    { text: "🫡", callback_data: `group_reaction_salute` },
                    { text: "😂", callback_data: `group_reaction_laugh` }
                  ],
                  [
                    { text: "👎", callback_data: `group_reaction_thumbsdown` },
                    { text: "😐", callback_data: `group_reaction_neutral` },
                    { text: "💩", callback_data: `group_reaction_poop` },
                    { text: "🤡", callback_data: `group_reaction_clown` },
                    { text: "🤮", callback_data: `group_reaction_vomit` }
                  ]
                ]
              };
              
              const requestBody = {
                chat_id: chatId,
                text: message,
                parse_mode: "HTML",
                reply_markup: replyMarkup,
              };
              
              // Добавляем thread_id если он указан
              const THREAD_ID = process.env.THREAD_ID;
              if (THREAD_ID) {
                requestBody.message_thread_id = parseInt(THREAD_ID);
              }
              
              await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(requestBody),
                }
              );
              console.log(`✅ Результаты пересчета отправлены в группу ${chatId}`);
            } catch (error) {
              console.error(`❌ Ошибка отправки в группу ${chatId}:`, error);
            }
          }
        }

        // Отправляем пользователям
        if (sendToUsers && sortedUsers.length > 0) {
          const maxPoints = sortedUsers[0][1].points;
          const minPoints = sortedUsers[sortedUsers.length - 1][1].points;
          const winners = sortedUsers.filter(([, stats]) => stats.points === maxPoints);
          
          // Определяем уникальные значения очков для присвоения мест
          const uniqueScores = [...new Set(sortedUsers.map(([, stats]) => stats.points))];
          
          for (const [username, stats] of sortedUsers) {
            if (!stats.telegramId || stats.telegramNotificationsEnabled !== 1) continue;
            
            let personalMessage = '🔄 <b>Результаты пересчета</b>\n\n';
            personalMessage += `📅 Дата: ${formatDate(date)}\n`;
            personalMessage += `🏆 Тур: ${round}\n`;
            personalMessage += `🎯 Турнир: ${event.event_name}\n\n`;
            personalMessage += `📈 Статистика:\n`;
            
            // Добавляем список всех участников с медалями
            sortedUsers.forEach(([uname, ustats]) => {
              // Определяем место по уникальному значению очков
              const place = uniqueScores.indexOf(ustats.points) + 1;
              
              // Присваиваем медаль по месту
              const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '▪️';
              
              const statsText = [];
              if (ustats.correctResults > 0) {
                statsText.push(`✅ ${ustats.correctResults}`);
              }
              if (ustats.correctScores > 0) {
                statsText.push(`🎯 ${ustats.correctScores}`);
              }
              if (ustats.correctYellowCards > 0) {
                statsText.push(`🟨 ${ustats.correctYellowCards}`);
              }
              if (ustats.correctRedCards > 0) {
                statsText.push(`🟥 ${ustats.correctRedCards}`);
              }
              const statsStr = statsText.length > 0 ? ` (${statsText.join(', ')})` : '';
              personalMessage += `${medal} ${uname}: ${ustats.points} ${ustats.points === 1 ? 'очко' : ustats.points < 5 ? 'очка' : 'очков'}${statsStr}\n`;
            });
            
            personalMessage += '\n';
            
            // Добавляем персонализированное окончание
            let userPointsWord;
            if (stats.points === 0) {
              userPointsWord = 'очков';
            } else if (stats.points === 1) {
              userPointsWord = 'очко';
            } else if (stats.points >= 2 && stats.points <= 4) {
              userPointsWord = 'очка';
            } else {
              userPointsWord = 'очков';
            }

            if (stats.points === maxPoints) {
              // Пользователь лучший (или один из лучших)
              if (maxPoints === 0) {
                // Все набрали 0 — никто не победил
                personalMessage += `😶 Сегодня никто ничего не угадал, ты не одинок в своём провале, малютка ${username}.`;
              } else if (winners.length === 1) {
                personalMessage += `Сегодня ты лучший, у тебя <b>${stats.points} ${userPointsWord}</b>, поздравляю, малютка 👑 ${username}! 🎉`;
              } else {
                personalMessage += `Сегодня ты один из лучших, у тебя <b>${stats.points} ${userPointsWord}</b>, поздравляю, малютка 👑 ${username}! 🎉`;
              }
            } else if (stats.points === minPoints) {
              // Пользователь худший (или один из худших)
              if (winners.length === 1) {
                personalMessage += `Сегодня ты лох, такое может случиться с каждым, у тебя <b>${stats.points} ${userPointsWord}</b>, а лучший, это малютка 👑 ${winners[0][0]}! 🎉`;
              } else {
                const winnerNames = winners.map(([name]) => name).join(' и ');
                personalMessage += `Сегодня ты лох, такое может случиться с каждым, у тебя <b>${stats.points} ${userPointsWord}</b>, а лучшие, это малютки 👑 ${winnerNames}! 🎉`;
              }
            } else {
              // Пользователь в середине
              if (winners.length === 1) {
                personalMessage += `Сегодня ты не лучший, у тебя <b>${stats.points} ${userPointsWord}</b>, а лучший, это малютка 👑 ${winners[0][0]}! 🎉`;
              } else {
                const winnerNames = winners.map(([name]) => name).join(' и ');
                personalMessage += `Сегодня ты не лучший, у тебя <b>${stats.points} ${userPointsWord}</b>, а лучшие, это малютки 👑 ${winnerNames}! 🎉`;
              }
            }
            
            try {
              const replyMarkup = {
                inline_keyboard: [
                  [
                    { text: "👍", callback_data: `reaction_positive_thumbsup_${Date.now()}` },
                    { text: "🔥", callback_data: `reaction_positive_fire_${Date.now() + 1}` },
                    { text: "❤️", callback_data: `reaction_positive_heart_${Date.now() + 2}` },
                    { text: "🫡", callback_data: `reaction_positive_salute_${Date.now() + 3}` },
                    { text: "😂", callback_data: `reaction_positive_laugh_${Date.now() + 4}` }
                  ],
                  [
                    { text: "👎", callback_data: `reaction_negative_thumbsdown_${Date.now()}` },
                    { text: "😐", callback_data: `reaction_negative_neutral_${Date.now() + 1}` },
                    { text: "💩", callback_data: `reaction_negative_poop_${Date.now() + 2}` },
                    { text: "🤡", callback_data: `reaction_negative_clown_${Date.now() + 3}` },
                    { text: "🤮", callback_data: `reaction_negative_vomit_${Date.now() + 4}` }
                  ]
                ]
              };
              
              await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: stats.telegramId,
                    text: personalMessage,
                    parse_mode: "HTML",
                    reply_markup: replyMarkup,
                  }),
                }
              );
              console.log(`✅ Результаты пересчета отправлены пользователю ${username}`);
            } catch (error) {
              console.error(`❌ Ошибка отправки пользователю ${username}:`, error);
            }
            
            // Задержка между отправками
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      }
    }

    console.log(`\n🔄 ========================================`);
    console.log(`🔄 ПЕРЕСЧЕТ ЗАВЕРШЕН`);
    console.log(`🔄 ========================================\n`);

    res.json({ 
      success: true, 
      message: `Результаты успешно пересчитаны! Обновлено матчей: ${resetResult.changes}`,
      matchesUpdated: resetResult.changes,
      betsProcessed: bets.length
    });

  } catch (error) {
    console.error("❌ Ошибка пересчета результатов:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/clear-logs - Очистить файл логов (только для админа)
router.post("/api/admin/clear-logs", (req, res) => {
  const { username } = req.body;

  // Проверяем, является ли пользователь админом
  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    resetLogFile();
    console.log("🗑️ Логи очищены админом:", username);
    res.json({ message: "Логи успешно очищены" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/migrate-logs - Обновить файл логов без удаления содержимого (добавить недостающий код)
router.post("/api/admin/migrate-logs", (req, res) => {
  const { username } = req.body;

  // Проверяем, является ли пользователь админом
  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    if (!fs.existsSync(LOG_FILE_PATH)) {
      return res.status(404).json({ error: "Файл логов не найден" });
    }

    // Читаем текущий файл
    let content = fs.readFileSync(LOG_FILE_PATH, 'utf-8');

    // Проверяем, есть ли уже код для отображения размера файла
    if (content.includes('logFileInfo')) {
      return res.json({ message: "Файл логов уже содержит код отображения размера", alreadyMigrated: true });
    }

    // Находим закрывающий тег </p> после "История всех ставок и удалений"
    const headerEndRegex = /<p>История всех ставок и удалений<\/p>/;
    
    if (!headerEndRegex.test(content)) {
      return res.status(400).json({ error: "Не удалось найти заголовок в файле логов" });
    }

    // Добавляем код для отображения размера файла после заголовка
    const logFileInfoDiv = `
    <div id="logFileInfo" style="margin-top: 10px; font-size: 0.85em; color: #999;">
      Загрузка информации о файле...
    </div>`;

    content = content.replace(
      /<p>История всех ставок и удалений<\/p>/,
      `<p>История всех ставок и удалений</p>${logFileInfoDiv}`
    );

    // Проверяем, есть ли уже скрипт для загрузки информации
    if (!content.includes('loadLogFileInfo')) {
      // Находим закрывающий тег </body>
      const scriptCode = `
  <script>
    // Загрузить информацию о размере файла логов
    async function loadLogFileInfo() {
      try {
        const response = await fetch('/api/bet-logs-info');
        const data = await response.json();
        
        if (data.success) {
          const infoDiv = document.getElementById('logFileInfo');
          const percentColor = data.percentUsed > 80 ? '#f44336' : data.percentUsed > 50 ? '#ff9800' : '#4caf50';
          
          infoDiv.innerHTML = \`
            📊 Размер файла: <strong style="color: #5a9fd4;">\${data.sizeFormatted}</strong> / \${data.maxSizeFormatted}
            <span style="color: \${percentColor}; margin-left: 10px;">(\${data.percentUsed}% использовано)</span>
          \`;
        }
      } catch (error) {
        console.error('Ошибка загрузки информации о файле:', error);
        document.getElementById('logFileInfo').innerHTML = '⚠️ Не удалось загрузить информацию о файле';
      }
    }
    
    // Загружаем информацию при загрузке страницы
    loadLogFileInfo();
    
    // Обновляем каждые 30 секунд
    setInterval(loadLogFileInfo, 30000);
  </script>`;

      content = content.replace('</body>', `${scriptCode}
</body>`);
    }

    // Сохраняем обновленный файл
    fs.writeFileSync(LOG_FILE_PATH, content, 'utf-8');
    
    console.log("✅ Файл логов успешно обновлен (миграция)");
    res.json({ message: "Файл логов успешно обновлен", migrated: true });
  } catch (error) {
    console.error("❌ Ошибка миграции файла логов:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/final-parameters-results - Установить результаты финальных параметров
router.post("/api/admin/final-parameters-results", (req, res) => {
  const {
    matchId,
    exact_score,
    yellow_cards,
    red_cards,
    corners,
    penalties_in_game,
    extra_time,
    penalties_at_end,
    username,
  } = req.body;

  // Проверяем, является ли пользователь админом
  if (username !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    // Создаём таблицу если её ещё нет
    db.exec(`
      CREATE TABLE IF NOT EXISTS final_parameters_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL UNIQUE,
        exact_score TEXT,
        yellow_cards INTEGER,
        red_cards INTEGER,
        corners INTEGER,
        penalties_in_game TEXT,
        extra_time TEXT,
        penalties_at_end TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (match_id) REFERENCES matches(id)
      )
    `);

    // Вставляем или обновляем результаты
    db.prepare(
      `
      INSERT INTO final_parameters_results 
      (match_id, exact_score, yellow_cards, red_cards, corners, penalties_in_game, extra_time, penalties_at_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(match_id) DO UPDATE SET
        exact_score = excluded.exact_score,
        yellow_cards = excluded.yellow_cards,
        red_cards = excluded.red_cards,
        corners = excluded.corners,
        penalties_in_game = excluded.penalties_in_game,
        extra_time = excluded.extra_time,
        penalties_at_end = excluded.penalties_at_end
    `
    ).run(
      matchId,
      exact_score || null,
      yellow_cards !== undefined ? yellow_cards : null,
      red_cards !== undefined ? red_cards : null,
      corners !== undefined ? corners : null,
      penalties_in_game || null,
      extra_time || null,
      penalties_at_end || null
    );

    console.log(
      `✓ Результаты финальных параметров установлены для матча ${matchId}`
    );
    
    // 🎲 Везунчик - угадал сложную ставку (финал с параметрами)
    // 💯 Рекорд очков за матч - новый рекорд по очкам за один матч
    try {
      // Получаем всех пользователей с финальными ставками на этот матч
      const usersWithFinalBets = db.prepare(`
        SELECT DISTINCT u.id, u.username
        FROM users u
        JOIN bets b ON b.user_id = u.id
        WHERE b.match_id = ? AND b.is_final_bet = 1
      `).all(matchId);
      
      const match = db.prepare("SELECT team1_name, team2_name, winner FROM matches WHERE id = ?").get(matchId);
      
      for (const user of usersWithFinalBets) {
        // Подсчитываем очки за этот матч
        let matchPoints = 0;
        let correctParams = 0;
        
        // Проверяем основной результат
        const mainBet = db.prepare(`
          SELECT prediction FROM bets 
          WHERE user_id = ? AND match_id = ? AND is_final_bet = 0
        `).get(user.id, matchId);
        
        if (mainBet && match.winner) {
          const isCorrect = mainBet.prediction === match.winner;
          if (isCorrect) {
            matchPoints += 3; // За финальный матч 3 очка
          }
        }
        
        // Проверяем финальные параметры
        const finalBets = db.prepare(`
          SELECT parameter_type, prediction FROM bets 
          WHERE user_id = ? AND match_id = ? AND is_final_bet = 1
        `).all(user.id, matchId);
        
        for (const bet of finalBets) {
          let isCorrect = false;
          
          if (bet.parameter_type === 'yellow_cards' && yellow_cards !== undefined) {
            isCorrect = parseInt(bet.prediction) === yellow_cards;
          } else if (bet.parameter_type === 'red_cards' && red_cards !== undefined) {
            isCorrect = parseInt(bet.prediction) === red_cards;
          } else if (bet.parameter_type === 'corners' && corners !== undefined) {
            isCorrect = parseInt(bet.prediction) === corners;
          } else if (bet.parameter_type === 'penalties_in_game' && penalties_in_game) {
            isCorrect = bet.prediction === penalties_in_game;
          } else if (bet.parameter_type === 'extra_time' && extra_time) {
            isCorrect = bet.prediction === extra_time;
          } else if (bet.parameter_type === 'penalties_at_end' && penalties_at_end) {
            isCorrect = bet.prediction === penalties_at_end;
          }
          
          if (isCorrect) {
            matchPoints += 2;
            correctParams++;
          }
        }
        
        // 🎲 Везунчик - угадал 3+ финальных параметра
        if (correctParams >= 3) {
          const existingLuckyNews = db.prepare(`
            SELECT id FROM news 
            WHERE type = 'achievement' 
            AND message LIKE ?
            AND created_at > datetime('now', '-7 days')
          `).get(`%${user.username}%${match.team1_name}%${match.team2_name}%`);
          
          if (!existingLuckyNews) {
            const newsTitle = `🎲 Везунчик: ${correctParams} параметров!`;
            const newsMessage = `Пользователь ${user.username} угадал ${correctParams} финальных параметра в матче ${match.team1_name} vs ${match.team2_name}!\n\n🔥 Невероятная удача и интуиция!`;
            
            db.prepare(`
              INSERT INTO news (type, title, message)
              VALUES (?, ?, ?)
            `).run('achievement', newsTitle, newsMessage);
            
            console.log(`✅ Автоматически создана новость о везунчике: ${user.username} (${correctParams} параметров)`);
          }
        }
        
        // 💯 Рекорд очков за матч - если набрал 10+ очков за один матч
        if (matchPoints >= 10) {
          // Проверяем это ли максимум для этого пользователя
          const maxPoints = db.prepare(`
            SELECT MAX(points) as max FROM (
              SELECT 
                m.id as match_id,
                SUM(CASE 
                  WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                    CASE WHEN b.prediction = m.winner THEN 3 ELSE 0 END
                  WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                    CASE 
                      WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 2
                      WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 2
                      WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 2
                      WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 2
                      WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 2
                      WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 2
                      ELSE 0
                    END
                  ELSE 0
                END) as points
              FROM bets b
              JOIN matches m ON b.match_id = m.id
              LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id
              WHERE b.user_id = ? AND m.id != ?
              GROUP BY m.id
            )
          `).get(user.id, matchId);
          
          if (!maxPoints.max || matchPoints > maxPoints.max) {
            const existingRecordNews = db.prepare(`
              SELECT id FROM news 
              WHERE type = 'achievement' 
              AND message LIKE ?
              AND created_at > datetime('now', '-7 days')
            `).get(`%${user.username}%${matchPoints}%очков за матч%`);
            
            if (!existingRecordNews) {
              const newsTitle = `💯 Рекорд: ${matchPoints} очков за матч!`;
              const newsMessage = `Пользователь ${user.username} установил личный рекорд - ${matchPoints} очков за один матч!\n\n🏆 Матч: ${match.team1_name} vs ${match.team2_name}\n\n🎯 Невероятный результат!`;
              
              db.prepare(`
                INSERT INTO news (type, title, message)
                VALUES (?, ?, ?)
              `).run('achievement', newsTitle, newsMessage);
              
              console.log(`✅ Автоматически создана новость о рекорде очков: ${user.username} (${matchPoints} очков)`);
            }
          }
        }
      }
    } catch (error) {
      console.error("❌ Ошибка проверки везунчика и рекорда очков:", error);
    }

    res.json({
      message: "Результаты финальных параметров успешно установлены",
      matchId,
    });
  } catch (error) {
    console.error("Ошибка при установке результатов параметров:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/final-parameters-results - Получить результаты финальных параметров
router.get("/api/final-parameters-results", (req, res) => {
  console.log("🔵 GET /api/final-parameters-results был вызван");
  try {
    const results = db.prepare("SELECT * FROM final_parameters_results").all();

    console.log("✓ Найдено параметров:", results.length);

    // Преобразуем в объект с ключом match_id для удобства
    const resultsMap = {};
    results.forEach((result) => {
      resultsMap[result.match_id] = result;
    });

    console.log("✓ Отправляю результат");
    res.json(resultsMap);
  } catch (error) {
    console.error("❌ Ошибка при получении результатов параметров:", error);
    // Если таблица не существует, возвращаем пустой объект
    res.json({});
  }
});

// POST /api/backup - Создать бэкап базы данных
router.post("/api/backup", async (req, res) => {
  try {
    const { username } = req.body;
    
    // Проверяем что юзер админ или модератор с правами
    const isAdminUser = username === process.env.ADMIN_DB_NAME;

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, -5);
    const backupFilename = `1xBetLineBoom_backup_${timestamp}.db`;
    const backupPath = path.join(BACKUPS_DIR, backupFilename);
    const dbPath = path.join(ROOT_DIR, "1xBetLineBoom.db");

    // Синхронизируем все изменения в основной файл БД перед копированием
    db.pragma("synchronous = FULL");
    console.log("✓ Синхронизация БД выполнена перед созданием бэкапа");

    // Копируем файл БД
    fs.copyFileSync(dbPath, backupPath);

    // Сохраняем метаданные бэкапа
    const metadataPath = path.join(BACKUPS_DIR, 'backups-metadata.json');
    let metadata = {};
    
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      } catch (err) {
        console.error('Ошибка чтения метаданных:', err);
      }
    }
    
    metadata[backupFilename] = {
      createdBy: username || 'unknown',
      isAdmin: isAdminUser,
      createdAt: new Date().toISOString(),
      isLocked: false
    };
    
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    console.log(`✓ Бэкап БД создан: ${backupFilename} (пользователь: ${username})`);

    // Уведомление админу если это модератор
    if (!isAdminUser && username) {
      const isModerator = db.prepare("SELECT id FROM moderators WHERE user_id = (SELECT id FROM users WHERE username = ?)").get(username);
      if (isModerator) {
        const fileSize = (fs.statSync(backupPath).size / 1024 / 1024).toFixed(2);
        const details = `💾 Файл: ${backupFilename}
📦 Размер: ${fileSize} MB`;
        
        await notifyModeratorAction(username, "Создание бэкапа БД", details);
        
        // Запись в логи
        writeBetLog("backup_created", {
          moderator: username,
          filename: backupFilename,
          size: `${fileSize} MB`
        });
      }
    }

    res.json({
      success: true,
      filename: backupFilename,
      timestamp: new Date().toISOString(),
      message: "Бэкап успешно создан",
    });
  } catch (error) {
    console.error("❌ Ошибка при создании бэкапа БД:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /download-backup/:filename - Скачать бэкап БД
router.get("/download-backup/:filename", async (req, res) => {
  try {
    const filename = req.params.filename;
    const username = req.query.username; // Получаем username из query параметров

    // Проверяем права
    const isAdminUser = username === process.env.ADMIN_DB_NAME;
    let isModerator = false;
    
    if (!isAdminUser) {
      // Проверяем права модератора
      const moderator = db.prepare(`
        SELECT permissions FROM moderators 
        WHERE user_id = (SELECT id FROM users WHERE username = ?)
      `).get(username);
      
      if (moderator) {
        const permissions = JSON.parse(moderator.permissions || "[]");
        isModerator = permissions.includes("download_backup");
      }
      
      if (!isModerator) {
        return res.status(403).json({ error: "Недостаточно прав для скачивания бэкапов" });
      }
    }

    // Проверяем что имя файла содержит только допустимые символы (безопасность)
    if (!/^1xBetLineBoom_backup_(before_restore_)?[\dT\-]+\.db$/.test(filename)) {
      return res.status(400).json({ error: "Неверное имя файла" });
    }

    const backupPath = path.join(BACKUPS_DIR, filename);

    // Проверяем что файл существует
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: "Файл бэкапа не найден" });
    }

    // Уведомление админу если это модератор
    if (isModerator && username) {
      const fileSize = (fs.statSync(backupPath).size / 1024 / 1024).toFixed(2);
      const details = `💾 Файл: ${filename}
📦 Размер: ${fileSize} MB`;
      
      await notifyModeratorAction(username, "Скачивание бэкапа БД", details);
      
      // Запись в логи
      writeBetLog("backup_downloaded", {
        moderator: username,
        filename: filename,
        size: `${fileSize} MB`
      });
    }

    // Отправляем файл
    res.download(backupPath, filename, (err) => {
      if (err) {
        console.error("❌ Ошибка при скачивании файла:", err);
      } else {
        console.log(`✓ Бэкап БД скачан: ${filename} (пользователь: ${username || 'неизвестен'})`);
      }
    });
  } catch (error) {
    console.error("❌ Ошибка при скачивании бэкапа:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/backups - Получить список бэкапов
router.get("/api/admin/backups", (req, res) => {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      return res.json([]);
    }

    // Загружаем метаданные
    const metadataPath = path.join(BACKUPS_DIR, 'backups-metadata.json');
    let metadata = {};
    
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      } catch (err) {
        console.error('Ошибка чтения метаданных:', err);
      }
    }

    const files = fs.readdirSync(BACKUPS_DIR);
    let metadataUpdated = false;
    
    // Получаем список существующих .db файлов
    const existingFiles = files.filter(file => file.endsWith('.db'));
    
    // Удаляем из metadata записи для несуществующих файлов
    for (const key in metadata) {
      if (!existingFiles.includes(key)) {
        console.log(`🗑️ Удаление записи из metadata для несуществующего файла: ${key}`);
        delete metadata[key];
        metadataUpdated = true;
      }
    }
    
    const backups = existingFiles
      .map(file => {
        const filePath = path.join(BACKUPS_DIR, file);
        const stats = fs.statSync(filePath);
        let fileMetadata = metadata[file];
        
        // Если метаданных нет для этого файла - создаем их
        if (!fileMetadata) {
          fileMetadata = {
            createdBy: 'unknown',
            isAdmin: false,
            createdAt: stats.birthtime.toISOString(),
            isLocked: false
          };
          metadata[file] = fileMetadata;
          metadataUpdated = true;
        }
        
        return {
          filename: file,
          size: stats.size,
          created: stats.birthtime,
          sizeFormatted: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
          createdBy: fileMetadata.createdBy || 'unknown',
          isAdminBackup: fileMetadata.isAdmin || false,
          isLocked: fileMetadata.isLocked || false
        };
      })
      .sort((a, b) => b.created - a.created); // Сортируем по дате, новые первые

    // Сохраняем обновленные метаданные если были изменения
    if (metadataUpdated) {
      try {
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        console.log('✅ Метаданные бэкапов обновлены');
      } catch (err) {
        console.error('⚠️ Ошибка сохранения метаданных:', err);
      }
    }

    res.json(backups);
  } catch (error) {
    console.error("❌ Ошибка при получении списка бэкапов:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/restore-backup - Восстановить БД из бэкапа
router.post("/api/admin/restore-backup", async (req, res) => {
  const { filename, username } = req.body;

  // Проверяем права
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    if (!permissions.includes("restore_db")) {
      return res.status(403).json({ error: "Недостаточно прав для восстановления БД" });
    }
  }

  try {
    if (!filename) {
      return res.status(400).json({ error: "Имя файла не указано" });
    }

    console.log(`🔍 Проверка имени файла для восстановления: "${filename}"`);

    // Проверяем что имя файла содержит только допустимые символы (безопасность)
    // Разрешаем как обычные бэкапы, так и бэкапы before_restore
    if (!/^1xBetLineBoom_backup_(before_restore_)?[\dT\-]+\.db$/.test(filename)) {
      console.log(`❌ Имя файла не прошло проверку: "${filename}"`);
      return res.status(400).json({ error: "Неверное имя файла" });
    }

    const backupPath = path.join(BACKUPS_DIR, filename);
    const dbPath = path.join(ROOT_DIR, "1xBetLineBoom.db");

    // Проверяем что файл бэкапа существует
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: "Файл бэкапа не найден" });
    }

    // Создаем бэкап текущей БД перед восстановлением
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, -5);
    const currentBackupFilename = `1xBetLineBoom_backup_before_restore_${timestamp}.db`;
    const currentBackupPath = path.join(BACKUPS_DIR, currentBackupFilename);
    
    fs.copyFileSync(dbPath, currentBackupPath);
    console.log(`✓ Создан бэкап текущей БД: ${currentBackupFilename}`);

    // Закрываем текущее соединение с БД
    db.close();

    // Копируем бэкап на место текущей БД
    fs.copyFileSync(backupPath, dbPath);
    console.log(`✓ БД восстановлена из бэкапа: ${filename} (пользователь: ${username})`);

    // Переоткрываем соединение с БД
    db = new Database("./1xBetLineBoom.db");
    db.pragma("journal_mode = DELETE");

    // Запускаем миграции для восстановленной БД
    console.log("🔄 Запуск миграций после восстановления БД...");
    runUsersMigrations();
    console.log("✅ Миграции после восстановления завершены");

    // Уведомление админу если это модератор
    if (!isAdminUser && username) {
      const details = `📥 Восстановлено из: ${filename}
💾 Создан бэкап текущей БД: ${currentBackupFilename}`;
      
      await notifyModeratorAction(username, "Восстановление БД", details);
      
      // Запись в логи
      writeBetLog("backup_restored", {
        moderator: username,
        filename: filename,
        currentBackup: currentBackupFilename
      });
    }

    res.json({
      success: true,
      message: "БД успешно восстановлена",
      restored_from: filename,
      backup_created: currentBackupFilename
    });
  } catch (error) {
    console.error("❌ Ошибка при восстановлении БД:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/delete-backup - Удалить бэкап
router.post("/api/admin/delete-backup", async (req, res) => {
  const { filename, username } = req.body;

  // Проверяем права
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (!moderator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    
    const permissions = JSON.parse(moderator.permissions || "[]");
    if (!permissions.includes("delete_backup")) {
      return res.status(403).json({ error: "Недостаточно прав для удаления бэкапов" });
    }
  }

  try {
    if (!filename) {
      return res.status(400).json({ error: "Имя файла не указано" });
    }

    console.log(`🔍 Попытка удаления бэкапа: "${filename}"`);

    // Проверяем что имя файла содержит только допустимые символы (безопасность)
    if (!/^1xBetLineBoom_backup_(before_restore_)?[\dT\-]+\.db$/.test(filename)) {
      console.log(`❌ Имя файла не прошло проверку: "${filename}"`);
      return res.status(400).json({ error: "Неверное имя файла" });
    }

    const backupPath = path.join(BACKUPS_DIR, filename);

    // Проверяем что файл бэкапа существует
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: "Файл бэкапа не найден" });
    }

    // Загружаем метаданные
    const metadataPath = path.join(BACKUPS_DIR, 'backups-metadata.json');
    let metadata = {};
    
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      } catch (err) {
        console.error('Ошибка чтения метаданных:', err);
      }
    }

    // Проверка: Бэкап заблокирован?
    const fileMetadata = metadata[filename];
    if (fileMetadata && fileMetadata.isLocked) {
      return res.status(403).json({ 
        error: "Этот бэкап заблокирован и не может быть удален",
        isLocked: true
      });
    }

    // Удаляем файл
    fs.unlinkSync(backupPath);
    
    // Удаляем метаданные
    if (metadata[filename]) {
      delete metadata[filename];
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    }
    
    console.log(`✓ Бэкап удален: ${filename} (пользователь: ${username})`);

    // Уведомление админу если это модератор
    if (!isAdminUser && username) {
      const details = `🗑️ Файл: ${filename}`;
      
      await notifyModeratorAction(username, "Удаление бэкапа БД", details);
      
      // Запись в логи
      writeBetLog("backup_deleted", {
        moderator: username,
        filename: filename
      });
    }

    res.json({
      success: true,
      message: "Бэкап успешно удален",
      deleted_file: filename
    });
  } catch (error) {
    console.error("❌ Ошибка при удалении бэкапа:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/toggle-backup-lock - Заблокировать/разблокировать бэкап (только для админа)
router.post("/api/admin/toggle-backup-lock", (req, res) => {
  const { filename, username } = req.body;

  // Проверяем что пользователь админ
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  
  if (!isAdminUser) {
    return res.status(403).json({ error: "Только админ может блокировать/разблокировать бэкапы" });
  }

  try {
    if (!filename) {
      return res.status(400).json({ error: "Имя файла не указано" });
    }

    console.log(`🔍 Попытка изменения блокировки бэкапа: "${filename}"`);

    // Проверяем что имя файла содержит только допустимые символы (безопасность)
    if (!/^1xBetLineBoom_backup_(before_restore_)?[\dT\-]+\.db$/.test(filename)) {
      console.log(`❌ Имя файла не прошло проверку: "${filename}"`);
      return res.status(400).json({ error: "Неверное имя файла" });
    }

    const backupPath = path.join(BACKUPS_DIR, filename);

    // Проверяем что файл бэкапа существует
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: "Файл бэкапа не найден" });
    }

    // Загружаем метаданные
    const metadataPath = path.join(BACKUPS_DIR, 'backups-metadata.json');
    let metadata = {};
    
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      } catch (err) {
        console.error('Ошибка чтения метаданных:', err);
      }
    }

    // Инициализируем метаданные если их нет
    if (!metadata[filename]) {
      metadata[filename] = {
        createdBy: 'unknown',
        isAdmin: false,
        createdAt: new Date().toISOString(),
        isLocked: false
      };
    }

    // Переключаем статус блокировки
    const newLockStatus = !metadata[filename].isLocked;
    metadata[filename].isLocked = newLockStatus;
    
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    
    const statusText = newLockStatus ? 'заблокирован' : 'разблокирован';
    console.log(`✓ Бэкап ${statusText}: ${filename} (пользователь: ${username})`);

    res.json({
      success: true,
      message: `Бэкап успешно ${statusText}`,
      filename: filename,
      isLocked: newLockStatus
    });
  } catch (error) {
    console.error("❌ Ошибка при изменении блокировки бэкапа:", error);
    res.status(500).json({ error: error.message });
  }
});



// GET /api/admin/orphaned-data - Проверить orphaned данные (для админа и модераторов с правами)
router.get("/api/admin/orphaned-data", (req, res) => {
  const username = req.query.username;

  console.log(`🔍 Запрос orphaned-data от пользователя: "${username}"`);

  // Проверяем права
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("manage_orphaned");
    }
    
    if (!isModerator) {
      console.log(`❌ Доступ запрещён: пользователь "${username}" не имеет прав`);
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  try {
    // Матчи, чьи события удалены
    const orphanedMatches = db
      .prepare(
        `SELECT m.id, m.team1_name, m.team2_name, m.match_date, m.event_id 
         FROM matches m 
         LEFT JOIN events e ON m.event_id = e.id 
         WHERE e.id IS NULL`
      )
      .all();

    // Ставки, чьи матчи удалены
    const orphanedBets = db
      .prepare(
        `SELECT b.id, b.user_id, b.match_id, b.prediction 
         FROM bets b 
         LEFT JOIN matches m ON b.match_id = m.id 
         WHERE m.id IS NULL`
      )
      .all();

    // Финальные ставки, чьи матчи удалены
    let orphanedFinalBets = [];
    try {
      orphanedFinalBets = db
        .prepare(
          `SELECT fb.id, fb.user_id, fb.match_id 
           FROM final_bets fb 
           LEFT JOIN matches m ON fb.match_id = m.id 
           WHERE m.id IS NULL`
        )
        .all();
    } catch (e) {
      // Таблица не существует
    }

    // Напоминания, чьи матчи удалены
    const orphanedReminders = db
      .prepare(
        `SELECT sr.id, sr.match_id, sr.sent_at 
         FROM sent_reminders sr 
         LEFT JOIN matches m ON sr.match_id = m.id 
         WHERE m.id IS NULL`
      )
      .all();

    // Награды, чьи события удалены
    const orphanedAwards = db
      .prepare(
        `SELECT ta.id, ta.event_id, ta.user_id 
         FROM tournament_awards ta 
         LEFT JOIN events e ON ta.event_id = e.id 
         WHERE e.id IS NULL`
      )
      .all();

    // Параметры финала, чьи матчи удалены
    const orphanedFinalParams = db
      .prepare(
        `SELECT fp.id, fp.match_id 
         FROM final_parameters_results fp 
         LEFT JOIN matches m ON fp.match_id = m.id 
         WHERE m.id IS NULL`
      )
      .all();

    const summary = {
      total_orphaned: {
        matches: orphanedMatches.length,
        bets: orphanedBets.length,
        final_bets: orphanedFinalBets.length,
        reminders: orphanedReminders.length,
        awards: orphanedAwards.length,
        final_parameters: orphanedFinalParams.length,
      },
      orphaned_matches: orphanedMatches,
      orphaned_bets: orphanedBets,
      orphaned_final_bets: orphanedFinalBets,
      orphaned_reminders: orphanedReminders,
      orphaned_awards: orphanedAwards,
      orphaned_final_parameters: orphanedFinalParams,
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/cleanup-orphaned-data - Удалить orphaned данные (только для админа)
router.post("/api/admin/cleanup-orphaned-data", async (req, res) => {
  const { username, dataType } = req.body;

  // Проверяем, является ли пользователь админом или модератором с правами
  const isAdminUser = username === process.env.ADMIN_DB_NAME;
  let isModerator = false;
  
  if (!isAdminUser) {
    // Проверяем права модератора
    const moderator = db.prepare(`
      SELECT permissions FROM moderators 
      WHERE user_id = (SELECT id FROM users WHERE username = ?)
    `).get(username);
    
    if (moderator) {
      const permissions = JSON.parse(moderator.permissions || "[]");
      isModerator = permissions.includes("manage_orphaned");
    }
    
    if (!isModerator) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
  }

  try {
    const deletedCounts = {};

    // Если dataType не указан или равен "all", удаляем всё
    const deleteAll = !dataType || dataType === "all";

    if (deleteAll || dataType === "final_parameters") {
      // Удаляем orphaned параметры финала
      const result1 = db.exec(
        `DELETE FROM final_parameters_results 
         WHERE match_id NOT IN (SELECT id FROM matches)`
      );
      deletedCounts.final_parameters = result1.changes || 0;
    }

    if (deleteAll || dataType === "final_bets") {
      // Удаляем orphaned финальные ставки
      try {
        const result2 = db.exec(
          `DELETE FROM final_bets 
           WHERE match_id NOT IN (SELECT id FROM matches)`
        );
        deletedCounts.final_bets = result2.changes || 0;
      } catch (e) {
        // Таблица не существует
      }
    }

    if (deleteAll || dataType === "reminders") {
      // Удаляем orphaned напоминания
      const result3 = db.exec(
        `DELETE FROM sent_reminders 
         WHERE match_id NOT IN (SELECT id FROM matches)`
      );
      deletedCounts.reminders = result3.changes || 0;
    }

    if (deleteAll || dataType === "bets") {
      // Удаляем orphaned ставки
      const result4 = db.exec(
        `DELETE FROM bets 
         WHERE match_id NOT IN (SELECT id FROM matches)`
      );
      deletedCounts.bets = result4.changes || 0;
    }

    if (deleteAll || dataType === "awards") {
      // Удаляем orphaned награды
      const result5 = db.exec(
        `DELETE FROM tournament_awards 
         WHERE event_id NOT IN (SELECT id FROM events)`
      );
      deletedCounts.awards = result5.changes || 0;
    }

    if (deleteAll || dataType === "matches") {
      // Удаляем orphaned матчи
      const result6 = db.exec(
        `DELETE FROM matches 
         WHERE event_id NOT IN (SELECT id FROM events)`
      );
      deletedCounts.matches = result6.changes || 0;
    }

    res.json({
      message: "✅ Orphaned данные успешно удалены",
      deleted: deletedCounts,
    });

    // Уведомление админу если это модератор
    if (isModerator && username) {
      const totalDeleted = Object.values(deletedCounts).reduce((sum, count) => sum + count, 0);
      const detailsText = `🗑️ Всего удалено: ${totalDeleted}
${Object.entries(deletedCounts).map(([key, count]) => `  • ${key}: ${count}`).join('\n')}`;
      
      await notifyModeratorAction(username, "Очистка orphaned данных", detailsText);
      
      // Запись в логи
      const detailsFormatted = Object.entries(deletedCounts)
        .map(([key, count]) => `${key}: ${count}`)
        .join(', ');
      
      writeBetLog("orphaned_cleaned", {
        moderator: username,
        details: detailsFormatted
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== API ENDPOINTS ДЛЯ ТЕРМИНАЛА =====

// GET /api/bet-logs-info - получить информацию о файле логов ставок
router.get("/api/bet-logs-info", (req, res) => {
  try {
    if (fs.existsSync(LOG_FILE_PATH)) {
      const stats = fs.statSync(LOG_FILE_PATH);
      const sizeInMB = (stats.size / 1024 / 1024).toFixed(2);
      const maxSizeInMB = (MAX_LOG_SIZE / 1024 / 1024).toFixed(0);
      const percentUsed = ((stats.size / MAX_LOG_SIZE) * 100).toFixed(1);
      
      res.json({
        success: true,
        size: stats.size,
        sizeFormatted: `${sizeInMB} MB`,
        maxSize: MAX_LOG_SIZE,
        maxSizeFormatted: `${maxSizeInMB} MB`,
        percentUsed: percentUsed
      });
    } else {
      res.json({
        success: true,
        size: 0,
        sizeFormatted: "0 MB",
        maxSize: MAX_LOG_SIZE,
        maxSizeFormatted: "10 MB",
        percentUsed: "0"
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/terminal-logs - получить логи терминала
router.get("/api/test/score-points/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    
    // Получаем все завершенные ставки пользователя с прогнозом на счет
    const betsWithScore = db.prepare(`
      SELECT 
        b.id as bet_id,
        b.prediction,
        m.team1_name,
        m.team2_name,
        m.winner,
        m.is_final,
        m.score_prediction_enabled,
        m.yellow_cards_prediction_enabled,
        m.red_cards_prediction_enabled,
        sp.score_team1 as predicted_score1,
        sp.score_team2 as predicted_score2,
        ms.score_team1 as actual_score1,
        ms.score_team2 as actual_score2,
        cp.yellow_cards as predicted_yellow_cards,
        cp.red_cards as predicted_red_cards,
        m.yellow_cards as actual_yellow_cards,
        m.red_cards as actual_red_cards,
        CASE 
          WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
               (b.prediction = 'team2' AND m.winner = 'team2') OR
               (b.prediction = 'draw' AND m.winner = 'draw') OR
               (b.prediction = m.team1_name AND m.winner = 'team1') OR
               (b.prediction = m.team2_name AND m.winner = 'team2') 
          THEN 1 
          ELSE 0 
        END as result_correct,
        CASE 
          WHEN m.score_prediction_enabled = 1 AND
               sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
               ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
               sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
          THEN 1 
          ELSE 0 
        END as score_correct,
        CASE 
          WHEN m.yellow_cards_prediction_enabled = 1 AND
               cp.yellow_cards IS NOT NULL AND
               m.yellow_cards IS NOT NULL AND
               cp.yellow_cards = m.yellow_cards
          THEN 1 
          ELSE 0 
        END as yellow_cards_correct,
        CASE 
          WHEN m.red_cards_prediction_enabled = 1 AND
               cp.red_cards IS NOT NULL AND
               m.red_cards IS NOT NULL AND
               cp.red_cards = m.red_cards
          THEN 1 
          ELSE 0 
        END as red_cards_correct,
        CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END as base_points,
        CASE 
          WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
               (b.prediction = 'team2' AND m.winner = 'team2') OR
               (b.prediction = 'draw' AND m.winner = 'draw') OR
               (b.prediction = m.team1_name AND m.winner = 'team1') OR
               (b.prediction = m.team2_name AND m.winner = 'team2') 
          THEN 
            CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
            CASE 
              WHEN m.score_prediction_enabled = 1 AND
                   sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                   ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                   sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
              THEN 1 
              ELSE 0 
            END +
            CASE 
              WHEN m.yellow_cards_prediction_enabled = 1 AND
                   cp.yellow_cards IS NOT NULL AND
                   m.yellow_cards IS NOT NULL AND
                   cp.yellow_cards = m.yellow_cards
              THEN 1 
              ELSE 0 
            END +
            CASE 
              WHEN m.red_cards_prediction_enabled = 1 AND
                   cp.red_cards IS NOT NULL AND
                   m.red_cards IS NOT NULL AND
                   cp.red_cards = m.red_cards
              THEN 1 
              ELSE 0 
            END
          ELSE 0 
        END as total_points
      FROM bets b
      JOIN matches m ON b.match_id = m.id
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
      LEFT JOIN match_scores ms ON b.match_id = ms.match_id
      WHERE b.user_id = ? 
        AND b.is_final_bet = 0 
        AND m.winner IS NOT NULL
      ORDER BY b.id DESC
      LIMIT 20
    `).all(userId);
    
    const totalPoints = betsWithScore.reduce((sum, bet) => sum + bet.total_points, 0);
    
    res.json({
      user_id: userId,
      total_points: totalPoints,
      bets: betsWithScore
    });
  } catch (error) {
    console.error("Ошибка в тестовом endpoint:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// АВТОМАТИЧЕСКИЙ ПОДСЧЕТ РЕЗУЛЬТАТОВ
// ============================================

// Маппинг иконок турниров на коды для API — перенесён в server/config.js

// Хранилище обработанных дат (чтобы не обрабатывать повторно)
const processedDates = new Set();

// Создаем таблицу для хранения обработанных дат автоподсчета
db.exec(`
  CREATE TABLE IF NOT EXISTS auto_counting_processed (
    date_key TEXT PRIMARY KEY,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Загружаем обработанные даты из БД при старте
const loadProcessedDates = () => {
  try {
    const dates = db.prepare('SELECT date_key FROM auto_counting_processed').all();
    dates.forEach(row => processedDates.add(row.date_key));
    console.log(`📋 Загружено ${dates.length} обработанных дат из БД`);
  } catch (error) {
    console.error('❌ Ошибка загрузки обработанных дат:', error);
  }
};

// Сохранить обработанную дату в БД
const saveProcessedDate = (dateKey) => {
  try {
    db.prepare('INSERT OR IGNORE INTO auto_counting_processed (date_key) VALUES (?)').run(dateKey);
  } catch (error) {
    console.error('❌ Ошибка сохранения обработанной даты:', error);
  }
};

// Загружаем при старте
loadProcessedDates();

// Функции для работы с настройкой автоподсчета в БД
function getAutoCountingEnabled() {
  const setting = db.prepare("SELECT value FROM system_settings WHERE key = 'auto_counting_enabled'").get();
  return setting ? setting.value === 'true' : true;
}

function setAutoCountingEnabled(enabled) {
  db.prepare("UPDATE system_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'auto_counting_enabled'")
    .run(enabled ? 'true' : 'false');
}

// normalizeTeamNameForAPI, translateTeamNameToEnglish — перенесены в server/utils/helpers.js

/**
 * Получить активные даты с незавершенными матчами или недавно завершенными
 */
function getActiveDates() {
  try {
    const dates = db.prepare(`
      SELECT DISTINCT 
        m.event_id,
        e.icon,
        m.round,
        DATE(m.match_date) as date
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.match_date IS NOT NULL
        AND DATE(m.match_date) >= DATE('now', '-2 days')
        AND DATE(m.match_date) <= DATE('now', '+1 days')
      GROUP BY m.event_id, e.icon, m.round, DATE(m.match_date)
      ORDER BY m.match_date
    `).all();
    
    // Определяем competition_code по иконке
    return dates.map(date => ({
      ...date,
      competition_code: ICON_TO_COMPETITION[date.icon] || null
    }));
  } catch (error) {
    console.error('❌ Ошибка получения активных дат:', error);
    return [];
  }
}

/**
 * Проверить завершение всех матчей для конкретной даты
 */
async function checkDateCompletion(dateGroup, forceUpdate = false) {
  try {
    const { event_id, competition_code, round, date } = dateGroup;
    
    // Если не удалось определить турнир по иконке - пропускаем
    if (!competition_code) {
      console.log(`⚠️ Не удалось определить турнир для event_id=${event_id} (иконка не в маппинге)`);
      return { allFinished: false, matches: [] };
    }
    
    // Получаем ВСЕ матчи из БД для этой даты (включая завершенные)
    const allDbMatches = db.prepare(`
      SELECT * FROM matches
      WHERE event_id = ?
        AND round = ?
        AND DATE(match_date) = ?
    `).all(event_id, round, date);
    
    if (allDbMatches.length === 0) {
      console.log(`⚠️ Нет матчей для даты ${date}`);
      return { allFinished: false, matches: [] };
    }
    
    // Проверяем сколько матчей уже завершено или отменено/перенесено
    const finishedCount = allDbMatches.filter(m => m.status === 'finished').length;
    const cancelledCount = allDbMatches.filter(m => ['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(m.status)).length;
    console.log(`📊 Матчей для ${date}: ${allDbMatches.length}, завершено: ${finishedCount}, отменено/перенесено: ${cancelledCount}`);
    
    // Если все уже завершены/отменены в БД и НЕ принудительное обновление - возвращаем их для подсчета
    const processedCount = finishedCount + cancelledCount;
    if (processedCount === allDbMatches.length && !forceUpdate) {
      console.log(`✅ Все матчи уже обработаны в БД для ${date}`);
      return { 
        allFinished: true, 
        matches: allDbMatches.map(dbMatch => ({ dbMatch, apiMatch: null }))
      };
    }
    
    // Есть необработанные ИЛИ принудительное обновление - проверяем через API
    const dbMatches = forceUpdate ? allDbMatches : allDbMatches.filter(m => 
      !['finished', 'cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(m.status)
    );
    
    // Запрашиваем матчи из API
    const leagueId = SSTATS_LEAGUE_MAPPING[competition_code];
    if (!leagueId) {
      console.log(`⚠️ Неизвестный турнир: ${competition_code}`);
      return { allFinished: false, matches: [] };
    }
    
    const dateObj = new Date(date);
    let year = dateObj.getFullYear();
    
    // Для лиг: если дата в первой половине года, это прошлый сезон
    const cupTournaments = ['WC', 'EC'];
    if (!cupTournaments.includes(competition_code) && dateObj.getMonth() < 7) {
      year = year - 1;
    }
    
    const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&Year=${year}`;
    
    console.log(`🔍 Запрос к API: ${url}`);
    console.log(`📅 Ищем матчи для даты: ${date}`);
    
    const response = await fetch(url, {
      headers: { "X-API-Key": SSTATS_API_KEY }
    });
    
    if (!response.ok) {
      console.error(`❌ SStats API ошибка: ${response.status}`);
      return { allFinished: false, matches: [] };
    }
    
    const sstatsData = await response.json();
    
    if (sstatsData.status !== "OK") {
      console.error(`❌ SStats API статус не OK`);
      return { allFinished: false, matches: [] };
    }
    
    console.log(`📊 API вернул ${sstatsData.data?.length || 0} матчей всего`);
    
    // Фильтруем матчи по дате
    const apiMatches = (sstatsData.data || []).filter(game => {
      const gameDate = game.date.split('T')[0];
      return gameDate === date;
    });
    
    console.log(`📊 Матчей для даты ${date}: ${apiMatches.length}`);
    
    if (apiMatches.length > 0) {
      console.log(`📋 Статусы матчей из API:`);
      apiMatches.forEach(game => {
        console.log(`  - ${game.homeTeam.name} vs ${game.awayTeam.name}: status=${game.status} (${game.statusName})`);
      });
    }
    
    // Сопоставляем матчи БД с API
    const matchedMatches = [];
    
    console.log(`🔄 Сопоставление ${dbMatches.length} матчей из БД с API...`);
    
    for (const dbMatch of dbMatches) {
      // Переводим русские названия в английские
      const dbTeam1English = translateTeamNameToEnglish(dbMatch.team1_name, competition_code);
      const dbTeam2English = translateTeamNameToEnglish(dbMatch.team2_name, competition_code);
      
      const apiMatch = apiMatches.find(api => {
        const apiHome = normalizeTeamNameForAPI(api.homeTeam.name);
        const apiAway = normalizeTeamNameForAPI(api.awayTeam.name);
        const dbHome = normalizeTeamNameForAPI(dbTeam1English);
        const dbAway = normalizeTeamNameForAPI(dbTeam2English);
        
        return (apiHome === dbHome && apiAway === dbAway) ||
               (apiHome === dbAway && apiAway === dbHome);
      });
      
      if (apiMatch) {
        matchedMatches.push({ dbMatch, apiMatch });
        console.log(`  ✅ Сопоставлен: ${dbMatch.team1_name} - ${dbMatch.team2_name} (API status: ${apiMatch.status})`);
      } else {
        console.log(`  ❌ НЕ найден в API: ${dbMatch.team1_name} (${dbTeam1English}) - ${dbMatch.team2_name} (${dbTeam2English})`);
      }
    }
    
    console.log(`📊 Сопоставлено матчей: ${matchedMatches.length} из ${dbMatches.length}`);
    
    // Проверяем что все матчи завершены или отменены
    // Статусы завершения: 8 = Finished, 9 = Finished after extra time, 10 = Finished after penalties
    // Специальные статусы (не учитываются): 13=Прерван, 14=Перенесён, 15=Отменён, 17=Техническое поражение, 18=Walkover
    const finishedStatuses = [8, 9, 10];
    const specialStatuses = [13, 14, 15, 17, 18]; // Отменённые/перенесённые - не учитываются
    
    const allFinished = matchedMatches.length > 0 && 
                       matchedMatches.every(({ apiMatch }) => 
                         finishedStatuses.includes(apiMatch.status) || specialStatuses.includes(apiMatch.status)
                       );
    
    console.log(`✅ Все матчи завершены или отменены: ${allFinished}`);
    
    if (!allFinished && matchedMatches.length > 0) {
      const notFinished = matchedMatches.filter(({ apiMatch }) => 
        !finishedStatuses.includes(apiMatch.status) && !specialStatuses.includes(apiMatch.status)
      );
      console.log(`⏸️ Незавершенные матчи (${notFinished.length}):`);
      notFinished.forEach(({ dbMatch, apiMatch }) => {
        console.log(`  - ${dbMatch.team1_name} - ${dbMatch.team2_name}: status=${apiMatch.status} (${apiMatch.statusName})`);
      });
    }
    
    // Логируем отменённые/перенесённые матчи отдельно
    const specialMatches = matchedMatches.filter(({ apiMatch }) => specialStatuses.includes(apiMatch.status));
    if (specialMatches.length > 0) {
      console.log(`⚠️ Отменённые/перенесённые матчи (${specialMatches.length}):`);
      specialMatches.forEach(({ dbMatch, apiMatch }) => {
        const statusNames = {
          11: 'Перенесён',
          12: 'Отменён',
          13: 'Прерван',
          14: 'Техническое поражение',
          15: 'Неявка'
        };
        console.log(`  - ${dbMatch.team1_name} - ${dbMatch.team2_name}: ${statusNames[apiMatch.status] || apiMatch.statusName}`);
      });
    }
    
    return { allFinished, matches: matchedMatches };
    
  } catch (error) {
    console.error('❌ Ошибка проверки завершения даты:', error);
    return { allFinished: false, matches: [] };
  }
}

/**
 * Обновить матчи в БД из API
 */
async function updateMatchesFromAPI(matches) {
  try {
    const updateFinishedStmt = db.prepare(`
      UPDATE matches
      SET status = 'finished',
          winner = ?,
          team1_score = ?,
          team2_score = ?,
          yellow_cards = ?,
          red_cards = ?
      WHERE id = ?
    `);
    
    const updateSpecialStmt = db.prepare(`
      UPDATE matches
      SET status = ?
      WHERE id = ?
    `);
    
    const insertScoreStmt = db.prepare(`
      INSERT OR REPLACE INTO match_scores (match_id, score_team1, score_team2)
      VALUES (?, ?, ?)
    `);
    
    // Маппинг специальных статусов (по документации SStats)
    const specialStatusMap = {
      13: 'abandoned',      // Матч прерван
      14: 'postponed',      // Матч перенесён
      15: 'cancelled',      // Матч отменён
      17: 'technical_loss', // Техническое поражение
      18: 'walkover'        // Победа без игры (соперник не явился)
    };
    
    const specialStatusNames = {
      13: 'Прерван',
      14: 'Перенесён',
      15: 'Отменён',
      17: 'Техническое поражение',
      18: 'Победа без игры'
    };
    
    for (const { dbMatch, apiMatch } of matches) {
      // Проверяем специальные статусы (отменённые/перенесённые)
      if (specialStatusMap[apiMatch.status]) {
        const dbStatus = specialStatusMap[apiMatch.status];
        const statusName = specialStatusNames[apiMatch.status];
        
        updateSpecialStmt.run(dbStatus, dbMatch.id);
        console.log(`⚠️ Матч отмечен как "${statusName}": ${dbMatch.team1_name} - ${dbMatch.team2_name}`);
        continue; // Пропускаем дальнейшую обработку для этого матча
      }
      
      // Обрабатываем только завершённые матчи (статусы 8, 9, 10)
      if (![8, 9, 10].includes(apiMatch.status)) {
        console.log(`⏭️ Пропускаем матч (статус ${apiMatch.status}): ${dbMatch.team1_name} - ${dbMatch.team2_name}`);
        continue;
      }
      
      // Для матчей с доп. временем (9) и пенальти (10) берём счёт за 90 минут (homeFTResult/awayFTResult)
      // Для обычных матчей (8) берём homeResult/awayResult
      const homeScore = ([9, 10].includes(apiMatch.status) && apiMatch.homeFTResult != null)
        ? apiMatch.homeFTResult
        : apiMatch.homeResult;
      const awayScore = ([9, 10].includes(apiMatch.status) && apiMatch.awayFTResult != null)
        ? apiMatch.awayFTResult
        : apiMatch.awayResult;
      
      // Получаем код турнира для перевода названий
      const event = db.prepare("SELECT icon FROM events WHERE id = ?").get(dbMatch.event_id);
      const competition_code = event ? ICON_TO_COMPETITION[event.icon] : null;
      
      // Определяем победителя с учетом возможного обратного порядка команд
      const apiHome = normalizeTeamNameForAPI(apiMatch.homeTeam.name);
      // ИСПРАВЛЕНИЕ: переводим русское название в английское перед сравнением
      const dbTeam1English = translateTeamNameToEnglish(dbMatch.team1_name, competition_code);
      const dbHome = normalizeTeamNameForAPI(dbTeam1English);
      const isReversed = apiHome !== dbHome;
      
      let winner;
      if (homeScore > awayScore) {
        winner = isReversed ? 'team2' : 'team1';
      } else if (homeScore < awayScore) {
        winner = isReversed ? 'team1' : 'team2';
      } else {
        winner = 'draw';
      }
      
      const score1 = isReversed ? awayScore : homeScore;
      const score2 = isReversed ? homeScore : awayScore;
      
      // Получаем карточки из API
      // /games/list не возвращает карточки, нужен запрос к /Games/{id}
      let yellowCards = null;
      let redCards = null;
      
      // Если есть sstats_match_id, делаем дополнительный запрос
      if (apiMatch.id) {
        try {
          const detailsUrl = `${SSTATS_API_BASE}/Games/${apiMatch.id}`;
          console.log(`  🔍 Запрос карточек для матча ${dbMatch.team1_name} - ${dbMatch.team2_name}: ${detailsUrl}`);
          
          const detailsResponse = await fetch(detailsUrl, {
            headers: { "X-API-Key": SSTATS_API_KEY }
          });
          
          if (detailsResponse.ok) {
            const detailsData = await detailsResponse.json();
            const gameDetails = detailsData.data?.game || detailsData.game;
            
            // events находится в data.events, а не в game.events
            const eventsArray = detailsData.data?.events || detailsData.events;
            
            if (eventsArray && Array.isArray(eventsArray)) {
              // Считаем карточки из массива событий
              // Ищем по названию события, т.к. type может меняться
              yellowCards = eventsArray.filter(e => e.name === 'Yellow Card').length;
              redCards = eventsArray.filter(e => e.name === 'Red Card').length;
              
              console.log(`  ✅ Карточки получены из events: 🟨${yellowCards} 🟥${redCards}`);
            } else {
              console.log(`  ⚠️ Массив events не найден в ответе API`);
            }
          } else {
            console.warn(`  ⚠️ Ошибка запроса карточек для матча ${dbMatch.id}: HTTP ${detailsResponse.status}`);
          }
        } catch (error) {
          console.warn(`  ⚠️ Не удалось получить карточки для матча ${dbMatch.id}:`, error.message);
        }
      }
      
      updateFinishedStmt.run(winner, score1, score2, yellowCards, redCards, dbMatch.id);
      
      // Сохраняем счет в таблицу match_scores
      insertScoreStmt.run(dbMatch.id, score1, score2);
      
      console.log(`✅ Обновлен матч: ${dbMatch.team1_name} ${score1}-${score2} ${dbMatch.team2_name} (${winner})${yellowCards !== null ? ` | 🟨${yellowCards}` : ''}${redCards !== null ? ` | 🟥${redCards}` : ''}`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Ошибка обновления матчей:', error);
    return false;
  }
}

/**
 * Запустить автоподсчет для конкретной даты
 */
async function triggerAutoCountingForDate(dateGroup) {
  try {
    const { date, round, competition_code } = dateGroup;
    const dateKey = `${date}_${round}_${competition_code}`;
    
    // Проверяем что не обрабатывали эту дату ранее
    if (processedDates.has(dateKey)) {
      return;
    }
    
    console.log(`\n🤖 ========================================`);
    console.log(`🤖 АВТОПОДСЧЕТ для ${date} | ${round}`);
    console.log(`🤖 ========================================\n`);
    
    // Проверяем завершение
    const { allFinished, matches } = await checkDateCompletion(dateGroup);
    
    if (!allFinished) {
      console.log(`⏸️ Не все матчи завершены для ${date}`);
      return;
    }
    
    console.log(`✅ Все матчи завершены для ${date}!`);
    
    // Обновляем матчи в БД (только если есть данные из API)
    const matchesWithApi = matches.filter(m => m.apiMatch !== null);
    if (matchesWithApi.length > 0) {
      const updated = await updateMatchesFromAPI(matchesWithApi);
      
      if (!updated) {
        console.error(`❌ Не удалось обновить матчи для ${date}`);
        return;
      }
    } else {
      console.log(`ℹ️ Все матчи уже обновлены в БД`);
    }
    
    // Помечаем дату как обработанную
    processedDates.add(dateKey);
    saveProcessedDate(dateKey);
    console.log(`✅ Дата ${dateKey} помечена как обработанная`);
    
    // Получаем ставки за эту дату (исключаем отменённые/перенесённые матчи)
    const bets = db.prepare(`
      SELECT 
        b.*,
        u.username,
        m.team1_name,
        m.team2_name,
        m.winner,
        m.team1_score as actual_score_team1,
        m.team2_score as actual_score_team2,
        m.yellow_cards as actual_yellow_cards,
        m.red_cards as actual_red_cards,
        m.score_prediction_enabled,
        m.yellow_cards_prediction_enabled,
        m.red_cards_prediction_enabled,
        cp.yellow_cards as predicted_yellow_cards,
        cp.red_cards as predicted_red_cards
      FROM bets b
      JOIN users u ON b.user_id = u.id
      JOIN matches m ON b.match_id = m.id
      LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
      WHERE DATE(m.match_date) = ?
        AND m.status = 'finished'
        AND b.is_final_bet = 0
    `).all(date);
    
    if (bets.length === 0) {
      console.log(`⚠️ Нет ставок для ${date}`);
      return;
    }
    
    // Подсчитываем результаты
    const userStats = {};
    
    bets.forEach(bet => {
      const username = bet.username;
      if (!userStats[username]) {
        userStats[username] = {
          points: 0,
          correctResults: 0,
          correctScores: 0,
          correctYellowCards: 0,
          correctRedCards: 0
        };
      }
      
      // Проверяем результат
      let isWon = false;
      if (bet.prediction === 'draw' && bet.winner === 'draw') {
        isWon = true;
      } else if (bet.prediction === 'team1' && bet.winner === 'team1') {
        isWon = true;
      } else if (bet.prediction === 'team2' && bet.winner === 'team2') {
        isWon = true;
      } else if (bet.prediction === bet.team1_name && bet.winner === 'team1') {
        isWon = true;
      } else if (bet.prediction === bet.team2_name && bet.winner === 'team2') {
        isWon = true;
      }
      
      if (isWon) {
        userStats[username].points++;
        userStats[username].correctResults++;
        
        // Проверяем счет (только если включен прогноз на счет для этого матча)
        if (bet.score_prediction_enabled === 1 &&
            bet.score_team1 != null && bet.score_team2 != null &&
            bet.score_team1 === bet.actual_score_team1 &&
            bet.score_team2 === bet.actual_score_team2) {
          userStats[username].points++;
          userStats[username].correctScores++;
        }
        
        // Проверяем желтые карточки (только если включен прогноз на желтые карточки для этого матча)
        if (bet.yellow_cards_prediction_enabled === 1 &&
            bet.predicted_yellow_cards != null &&
            bet.actual_yellow_cards != null &&
            bet.predicted_yellow_cards === bet.actual_yellow_cards) {
          userStats[username].points++;
          userStats[username].correctYellowCards++;
        }
        
        // Проверяем красные карточки (только если включен прогноз на красные карточки для этого матча)
        if (bet.red_cards_prediction_enabled === 1 &&
            bet.predicted_red_cards != null &&
            bet.actual_red_cards != null &&
            bet.predicted_red_cards === bet.actual_red_cards) {
          userStats[username].points++;
          userStats[username].correctRedCards++;
        }
      }
    });
    
    // Формируем сообщение для админа
    const formatDate = (dateStr) => {
      const d = new Date(dateStr);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}.${month}.${year}`;
    };
    
    let message = `🤖 <b>Автоподсчет завершен</b>\n\n`;
    message += `📅 Дата: ${formatDate(date)}\n`;
    message += `🏆 Тур: ${round}\n\n`;
    message += `📈 Статистика:\n`;
    
    Object.entries(userStats)
      .sort(([, a], [, b]) => b.points - a.points)
      .forEach(([username, stats]) => {
        const statsText = [];
        if (stats.correctResults > 0) {
          statsText.push(`✅ ${stats.correctResults}`);
        }
        if (stats.correctScores > 0) {
          statsText.push(`🎯 ${stats.correctScores}`);
        }
        if (stats.correctYellowCards > 0) {
          statsText.push(`🟨 ${stats.correctYellowCards}`);
        }
        if (stats.correctRedCards > 0) {
          statsText.push(`🟥 ${stats.correctRedCards}`);
        }
        const statsStr = statsText.length > 0 ? ` (${statsText.join(', ')})` : '';
        message += `• ${username}: ${stats.points} ${stats.points === 1 ? 'очко' : stats.points < 5 ? 'очка' : 'очков'}${statsStr}\n`;
      });
    
    // Отправляем админу
    await sendAdminNotification(message);
    console.log(`✅ Уведомление отправлено админу`);
    
    // Через 5 секунд отправляем результаты в группу и пользователям
    setTimeout(async () => {
      try {
        console.log(`📤 Отправка результатов в группу и пользователям...`);
        
        // Вызываем эндпоинт отправки результатов
        const response = await fetch(`http://localhost:${PORT}/api/admin/send-counting-results`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dateFrom: date,
            dateTo: date
          })
        });
        
        if (response.ok) {
          console.log(`✅ Результаты отправлены в группу и пользователям`);
        } else {
          console.error(`❌ Ошибка отправки результатов: ${response.status}`);
        }
      } catch (error) {
        console.error(`❌ Ошибка отправки результатов:`, error);
      }
    }, 5000);
    
  } catch (error) {
    console.error('❌ Ошибка автоподсчета:', error);
  }
}

/**
 * Основная функция проверки и автоподсчета
 */
async function checkAndAutoCount() {
  try {
    const autoCountingEnabled = getAutoCountingEnabled();
    
    if (!autoCountingEnabled) {
      console.log(`⏸️ Автоподсчет отключен`);
      return;
    }
    
    console.log(`\n🔍 Проверка завершенных матчей... ${new Date().toLocaleString('ru-RU')}`);
    
    const activeDates = getActiveDates();
    
    if (activeDates.length === 0) {
      console.log(`✓ Нет активных дат для проверки`);
      return;
    }
    
    console.log(`📊 Найдено активных дат: ${activeDates.length}`);
    
    for (const dateGroup of activeDates) {
      await triggerAutoCountingForDate(dateGroup);
    }
    
  } catch (error) {
    console.error('❌ Ошибка в checkAndAutoCount:', error);
  }
}

// Эндпоинт для управления автоподсчетом
router.post("/api/admin/deactivate-events", (req, res) => {
  const { username, eventIds } = req.body;
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  
  if (username !== ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }
  
  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    return res.status(400).json({ error: "Не выбраны турниры" });
  }
  
  try {
    const placeholders = eventIds.map(() => '?').join(',');
    
    // Получаем названия турниров перед деактивацией
    const events = db.prepare(`SELECT id, name FROM events WHERE id IN (${placeholders})`).all(...eventIds);
    
    // Деактивируем турниры
    const result = db.prepare(`UPDATE events SET status = 'completed' WHERE id IN (${placeholders})`).run(...eventIds);
    
    console.log(`🔒 Деактивировано турниров: ${result.changes}`);
    events.forEach(e => console.log(`  - ${e.name} (ID: ${e.id})`));
    
    res.json({ 
      success: true,
      deactivated: result.changes,
      events: events
    });
  } catch (error) {
    console.error('❌ Ошибка деактивации турниров:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== API ДЛЯ НОВОСТЕЙ =====

// GET /api/news - Получить последние новости
router.get("/api/admin/panel-config", (req, res) => {
  try {
    const config = db.prepare(`
      SELECT config_data, updated_at, updated_by 
      FROM admin_panel_config 
      ORDER BY id DESC 
      LIMIT 1
    `).get();
    
    if (!config) {
      return res.status(404).json({ error: "Конфигурация не найдена" });
    }
    
    res.json({
      success: true,
      config: JSON.parse(config.config_data),
      updated_at: config.updated_at,
      updated_by: config.updated_by
    });
  } catch (error) {
    console.error("❌ Ошибка получения конфигурации админ-панели:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/panel-config - Сохранить конфигурацию админ-панели (только для админа)
router.post("/api/admin/panel-config", (req, res) => {
  try {
    const { username, config } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Доступ запрещён" });
    }
    
    if (!config || !config.categories) {
      return res.status(400).json({ error: "Неверный формат конфигурации" });
    }
    
    // Сохраняем конфигурацию
    db.prepare(`
      INSERT INTO admin_panel_config (config_data, updated_by, updated_at)
      VALUES (?, ?, datetime('now'))
    `).run(JSON.stringify(config), username);
    
    console.log(`✅ Конфигурация админ-панели обновлена пользователем ${username}`);
    
    // Уведомление админу
    const adminMessage = 
      `⚙️ <b>КОНФИГУРАЦИЯ АДМИН-ПАНЕЛИ ОБНОВЛЕНА</b>\n\n` +
      `👤 Пользователь: ${username}\n` +
      `📊 Категорий: ${config.categories.length}\n` +
      `🕐 ${new Date().toLocaleString("ru-RU")}`;
    
    notifyAdmin(adminMessage).catch(err => {
      console.error("⚠️ Не удалось отправить уведомление админу:", err);
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Ошибка сохранения конфигурации админ-панели:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/panel-config/reset - Сбросить конфигурацию к дефолтной (только для админа)
router.post("/api/admin/panel-config/reset", (req, res) => {
  try {
    const { username } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Доступ запрещён" });
    }
    
    // Дефолтная конфигурация
    const defaultConfig = {
      categories: [
        {
          id: 'system',
          name: '📊 Система и логи',
          icon: '📊',
          collapsed: true,
          buttons: [
            { id: 'migrate-logs', text: '🔄 Обновить логи', action: 'migrateLogs()', type: 'modal' },
            { id: 'clear-logs', text: '🗑️ Очистить логи', action: 'clearLogs()', type: 'modal' },
            { id: 'open-logs', text: '📋 Открыть логи', action: 'window.open("/log.html", "_blank")', type: 'external' },
            { id: 'database', text: '💾 База данных', action: 'openDatabaseModal()', type: 'modal' },
            { id: 'orphaned', text: '🔍 Проверить orphaned', action: 'checkOrphanedData()', type: 'modal' }
          ]
        },
        {
          id: 'users',
          name: '👥 Пользователи и модерация',
          icon: '👥',
          collapsed: false,
          buttons: [
            { id: 'users-list', text: '👥 Пользователи', action: 'loadAdminUsers()', type: 'modal' },
            { id: 'moderators', text: '🛡️ Модераторы', action: 'openModeratorsPanel()', type: 'modal' },
            { id: 'bugs', text: '🐛 Баги', action: 'openBugReportsModal()', type: 'modal' }
          ]
        },
        {
          id: 'content',
          name: '📢 Контент и новости',
          icon: '📢',
          collapsed: false,
          buttons: [
            { id: 'add-news', text: '📢 Добавить новость', action: 'openNewsModal()', type: 'modal' },
            { id: 'announcement', text: '📢 Объявление', action: 'openAnnouncementModal()', type: 'modal' },
            { id: 'rss-keywords', text: '🔑 Ключевые слова RSS', action: 'openRssKeywordsModal()', type: 'modal' },
            { id: 'awards', text: '🏆 Награды', action: 'openAwardsPanel()', type: 'modal' }
          ]
        },
        {
          id: 'interface',
          name: '⚙️ Настройки интерфейса',
          icon: '⚙️',
          collapsed: false,
          buttons: [
            { id: 'xg-button', text: '🎯 Кнопка xG', action: 'toggleXgButton()', type: 'toggle' },
            { id: 'group-reminders', text: '🔔 Напоминания группы', action: 'toggleGroupRemindersCardVisibility()', type: 'toggle' }
          ]
        },
        {
          id: 'notifications',
          name: '🔔 Уведомления',
          icon: '🔔',
          collapsed: false,
          buttons: [
            { id: 'notifications-queue', text: '📬 Очередь уведомлений', action: 'window.open("/admin/notifications", "_blank")', type: 'external' },
            { id: 'manage-notifications', text: '🔔 Управление уведомлениями', action: 'openNotificationsModal()', type: 'modal' }
          ]
        },
        {
          id: 'utilities',
          name: '🛠️ Утилиты и инструменты',
          icon: '🛠️',
          collapsed: true,
          buttons: [
            { id: 'manage-dates', text: '📅 Управление датами', action: 'openDatesManagementModal()', type: 'modal' },
            { id: 'event-ids', text: '🏆 ID турниров', action: 'runUtilityScript("check-event-id")', type: 'modal' },
            { id: 'db-structure', text: '🗄️ Структура БД', action: 'runUtilityScript("check-tables")', type: 'modal' },
            { id: 'deactivate-old', text: '🔒 Деактивировать старые', action: 'openDeactivateEventsModal()', type: 'modal' },
            { id: 'update-sstats', text: '🔄 Обновить SStats ID', action: 'openUpdateSstatsModal()', type: 'modal' }
          ]
        }
      ]
    };
    
    // Сохраняем дефолтную конфигурацию
    db.prepare(`
      INSERT INTO admin_panel_config (config_data, updated_by, updated_at)
      VALUES (?, ?, datetime('now'))
    `).run(JSON.stringify(defaultConfig), username);
    
    console.log(`✅ Конфигурация админ-панели сброшена к дефолту пользователем ${username}`);
    
    // Уведомление админу
    const adminMessage = 
      `🔄 <b>КОНФИГУРАЦИЯ АДМИН-ПАНЕЛИ СБРОШЕНА</b>\n\n` +
      `👤 Пользователь: ${username}\n` +
      `📊 Восстановлена дефолтная конфигурация\n` +
      `🕐 ${new Date().toLocaleString("ru-RU")}`;
    
    notifyAdmin(adminMessage).catch(err => {
      console.error("⚠️ Не удалось отправить уведомление админу:", err);
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Ошибка сброса конфигурации админ-панели:", error.message);
    res.status(500).json({ error: error.message });
  }
});


export default router;
