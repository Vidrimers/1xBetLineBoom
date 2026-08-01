import { Router } from 'express';
import { db } from '../database/db.js';
import { requireOwnership } from '../middleware/auth.js';
import { notifyAdmin } from '../services/notificationService.js';
import { sendUserMessage, notifyTelegramLinked } from '../../OnexBetLineBoombot.js';
import { writeBetLog } from '../utils/logger.js';

const router = Router();

// Хранилище кодов подтверждения (в памяти)
const confirmationCodes = new Map();

// Хранилище токенов авторизации через Telegram (в памяти)
const telegramAuthTokens = new Map();

// Хранилище токенов создания сессий (после успешного логина/2FA)
// Ключ: user_id, Значение: {token, expiresAt}
const sessionCreationTokens = new Map();

// Очистка истёкших токенов каждые 5 минут
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of sessionCreationTokens) {
    if (val.expiresAt < now) sessionCreationTokens.delete(key);
  }
}, 5 * 60 * 1000);

// Вспомогательная функция для отправки сообщения пользователю по telegram_username
async function sendTelegramMessageByUsername(telegram_username, message) {
  const cleanUsername = telegram_username.toLowerCase();
  const telegramUser = db
    .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
    .get(cleanUsername);

  if (!telegramUser || !telegramUser.chat_id) {
    throw new Error(`Пользователь @${telegram_username} не найден в Telegram или не писал боту`);
  }

  await sendUserMessage(telegramUser.chat_id, message);
}

// POST /api/notify-admin-login-attempt
router.post("/api/notify-admin-login-attempt", async (req, res) => {
  const { attemptedUsername } = req.body;
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
    console.log("⚠️ Telegram не настроен, уведомление не отправлено");
    return res.json({ success: false, reason: "Telegram не настроен" });
  }

  try {
    const message = `⚠️ Попытка входа под именем "${attemptedUsername}"!\n\n🕐 Время: ${new Date().toLocaleString(
      "ru-RU"
    )}`;

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

    const result = await response.json();
    console.log("📨 Уведомление админу отправлено:", result.ok);
    res.json({ success: result.ok });
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления:", error);
    res.json({ success: false, error: error.message });
  }
});

// POST /api/user
router.post("/api/user", async (req, res) => {
  try {
    const { username } = req.body;

    // Проверяем, существует ли пользователь
    let user = db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username);

    if (!user) {
      // Проверка на запрещенные имена при регистрации
      const checkName = username.trim().toLowerCase();
      const bannedNames = db.prepare("SELECT name, is_partial FROM banned_names").all();
      for (const banned of bannedNames) {
        const matched = banned.is_partial ? checkName.includes(banned.name) : checkName === banned.name;
        if (matched) {
          const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
          const matchType = banned.is_partial ? 'частичное' : 'точное';
          const reason = banned.is_partial
            ? `Имя содержит запрещённое слово "${banned.name}"`
            : `Имя "${banned.name}" запрещено к использованию`;

          // Уведомляем админа
          const message = `🚫 ПОПЫТКА ИСПОЛЬЗОВАТЬ ЗАПРЕТНОЕ ИМЯ

📝 Введённое имя: ${username}
👤 Кто: Новый пользователь (регистрация)
🌍 IP: ${ip_address}
📋 Правило: "${banned.name}" (${matchType} совпадение)
📍 Контекст: Регистрация
🕐 Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

          notifyAdmin(message).catch(err => {
            console.error("⚠️ Не удалось отправить уведомление о запретном имени:", err);
          });

          return res.status(400).json({ error: "BANNED_NAME", reason });
        }
      }

      // Получаем IP адрес
      const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
      
      // Создаем нового пользователя
      const result = db
        .prepare("INSERT INTO users (username) VALUES (?)")
        .run(username);
      user = { id: result.lastInsertRowid, username };
      
      // Проверяем, были ли другие пользователи с этого IP
      const otherUsers = db.prepare(`
        SELECT DISTINCT u.username 
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.ip_address = ? AND u.id != ?
        ORDER BY s.created_at DESC
        LIMIT 5
      `).all(ip_address, user.id);

      const time = new Date().toLocaleString("ru-RU");
      
      let message = `👤 НОВЫЙ ПОЛЬЗОВАТЕЛЬ

🆔 ID: ${user.id}
👤 Имя: ${username}
🌍 IP: ${ip_address}
🕐 Время: ${time}`;

      if (otherUsers.length > 0) {
        message += `\n\n⚠️ С этого IP уже заходили:`;
        otherUsers.forEach(u => {
          message += `\n  • ${u.username}`;
        });
      }

      // Отправляем уведомление админу
      notifyAdmin(message).catch(err => {
        console.error("⚠️ Не удалось отправить уведомление о новом пользователе:", err);
      });
      
      // 👤 Новый пользователь - топ-5 по счету
      try {
        const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
        
        if (totalUsers <= 5) {
          const newsTitle = `👤 Новый участник: ${username}`;
          const newsMessage = `Добро пожаловать на платформу, ${username}!\n\n🎉 Вы ${totalUsers}-й участник нашего сообщества!\n\n🎯 Делайте прогнозы и соревнуйтесь за первые места!`;
          
          db.prepare(`
            INSERT INTO news (type, title, message)
            VALUES (?, ?, ?)
          `).run('system', newsTitle, newsMessage);
          
          console.log(`✅ Автоматически создана новость о новом пользователе: ${username} (${totalUsers}-й)`);
        }
      } catch (error) {
        console.error("❌ Ошибка создания новости о новом пользователе:", error);
      }

      res.json(user);
    } else {
      // Пользователь существует - проверяем, нужна ли 2FA
      // Проверяем: есть ли telegram_id И включена ли настройка require_login_2fa
      // Для админа 2FA обязательна всегда (если привязан Telegram)
      const isAdminAccount = user.username === process.env.ADMIN_DB_NAME;
      if (user.telegram_id && (user.require_login_2fa !== 0 || isAdminAccount)) {
        // Проверяем, было ли это устройство доверенным ранее
        const { device_info, browser, os } = req.body;
        const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
        
        console.log("🔍 Проверка доверенного устройства:");
        console.log("  User ID:", user.id);
        console.log("  Device:", device_info);
        console.log("  Browser:", browser);
        console.log("  OS:", os);
        console.log("  IP:", ip_address);
        
        // Ищем любую доверенную сессию с этого устройства (даже старую)
        const wasTrusted = db.prepare(`
          SELECT id FROM sessions 
          WHERE user_id = ? AND device_info = ? AND browser = ? AND os = ? 
          AND ip_address = ? AND is_trusted = 1
          ORDER BY created_at DESC LIMIT 1
        `).get(user.id, device_info, browser, os, ip_address);

        console.log("  Найдена доверенная сессия:", wasTrusted ? "ДА" : "НЕТ");

        if (wasTrusted) {
          // Устройство было доверенным, пропускаем 2FA
          console.log("✅ Устройство доверенное, пропускаем 2FA");
          // Генерируем токен создания сессии
          const sessionCreationToken = `${user.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          sessionCreationTokens.set(user.id, { token: sessionCreationToken, expiresAt: Date.now() + 5 * 60 * 1000 });
          res.json({ ...user, sessionCreationToken });
        } else {
          // Требуется подтверждение через Telegram
          console.log("⚠️ Требуется 2FA");
          res.json({ 
            requiresConfirmation: true, 
            userId: user.id,
            username: user.username 
          });
        }
      } else {
        // 2FA не настроена или отключена, возвращаем пользователя
        // Генерируем токен создания сессии
        const sessionCreationToken = `${user.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        sessionCreationTokens.set(user.id, { token: sessionCreationToken, expiresAt: Date.now() + 5 * 60 * 1000 });
        res.json({ ...user, sessionCreationToken });
      }
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/login/request - Запросить код для входа
router.post("/api/user/login/request", async (req, res) => {
  try {
    const { userId } = req.body;

    const user = db
      .prepare("SELECT id, username, telegram_id, telegram_username FROM users WHERE id = ?")
      .get(userId);
    
    if (!user || !user.telegram_id) {
      return res.status(404).json({ error: "Пользователь не найден или Telegram не привязан" });
    }

    // Генерируем 6-значный код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Сохраняем код с временем истечения (5 минут)
    confirmationCodes.set(`login_${userId}`, {
      code,
      expires: Date.now() + 5 * 60 * 1000
    });

    // Отправляем код в Telegram через chat_id
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (TELEGRAM_BOT_TOKEN) {
      const message = `🔐 КОД ПОДТВЕРЖДЕНИЯ ВХОДА

<code>${code}</code> - это ваш код подтверждения:

Попытка входа в аккаунт на сайте 1xBetLineBoom.

👤 Аккаунт: ${user.username}

Код действителен 5 минут.

Если это были не вы, проигнорируйте это сообщение и смените пароль.`;

      try {
        await sendUserMessage(user.telegram_id, message);
        res.json({ success: true, message: "Код отправлен в Telegram" });
      } catch (err) {
        console.error("❌ Ошибка отправки кода:", err);
        res.status(500).json({ error: "Не удалось отправить код в Telegram" });
      }
    } else {
      res.status(500).json({ error: "Telegram бот не настроен" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/login/confirm - Подтвердить вход
router.post("/api/user/login/confirm", async (req, res) => {
  try {
    const { userId, confirmation_code } = req.body;

    const stored = confirmationCodes.get(`login_${userId}`);
    
    if (!stored) {
      return res.status(400).json({ error: "Код не найден. Запросите новый код." });
    }

    if (Date.now() > stored.expires) {
      confirmationCodes.delete(`login_${userId}`);
      return res.status(400).json({ error: "Код истек. Запросите новый код." });
    }

    if (stored.code !== confirmation_code) {
      return res.status(400).json({ error: "Неверный код подтверждения" });
    }

    // Код верный, возвращаем пользователя
    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Удаляем использованный код
    confirmationCodes.delete(`login_${userId}`);

    // Генерируем токен создания сессии
    const sessionCreationToken = `${user.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessionCreationTokens.set(user.id, { token: sessionCreationToken, expiresAt: Date.now() + 5 * 60 * 1000 });

    res.json({ ...user, sessionCreationToken });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/telegram-auth/create-token - Создать токен для авторизации через Telegram
router.post("/api/telegram-auth/create-token", async (req, res) => {
  try {
    const { auth_token, device_info, browser, os } = req.body;
    
    if (!auth_token) {
      return res.status(400).json({ error: "Токен обязателен" });
    }

    // Сохраняем токен с временем истечения (5 минут)
    telegramAuthTokens.set(auth_token, {
      status: 'pending',
      device_info,
      browser,
      os,
      created_at: Date.now(),
      expires_at: Date.now() + 5 * 60 * 1000 // 5 минут
    });

    // Получаем имя бота из переменных окружения
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'YourBotUsername';

    res.json({ 
      success: true,
      botUsername
    });
  } catch (error) {
    console.error("Ошибка создания токена:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/telegram-auth/check-status - Проверить статус авторизации
router.get("/api/telegram-auth/check-status", async (req, res) => {
  try {
    const { auth_token } = req.query;
    
    if (!auth_token) {
      return res.status(400).json({ error: "Токен обязателен" });
    }

    const tokenData = telegramAuthTokens.get(auth_token);
    
    if (!tokenData) {
      return res.json({ status: 'not_found' });
    }

    // Проверяем истечение токена
    if (Date.now() > tokenData.expires_at) {
      telegramAuthTokens.delete(auth_token);
      return res.json({ status: 'expired' });
    }

    if (tokenData.status === 'completed') {
      // Возвращаем данные пользователя
      res.json({
        status: 'completed',
        user: tokenData.user,
        isNewUser: tokenData.isNewUser,
        sessionCreationToken: tokenData.sessionCreationToken
      });
      
      // Удаляем токен после успешной авторизации
      telegramAuthTokens.delete(auth_token);
    } else {
      res.json({ status: 'pending' });
    }
  } catch (error) {
    console.error("Ошибка проверки статуса:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/telegram-auth/complete - Завершить авторизацию (вызывается ботом)
router.post("/api/telegram-auth/complete", async (req, res) => {
  try {
    let { auth_token, telegram_id, first_name, username: tg_username } = req.body;
    
    // Приводим telegram username к нижнему регистру
    if (tg_username) {
      tg_username = tg_username.toLowerCase();
    }
    
    if (!auth_token || !telegram_id) {
      return res.status(400).json({ error: "Токен и Telegram ID обязательны" });
    }

    const tokenData = telegramAuthTokens.get(auth_token);
    
    if (!tokenData) {
      return res.status(404).json({ error: "Токен не найден" });
    }

    // Проверяем истечение токена
    if (Date.now() > tokenData.expires_at) {
      telegramAuthTokens.delete(auth_token);
      return res.status(400).json({ error: "Токен истек" });
    }

    // Проверяем, существует ли пользователь с таким telegram_id
    let user = db
      .prepare("SELECT * FROM users WHERE telegram_id = ?")
      .get(telegram_id);

    const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
    const isNewUser = !user;

    if (!user) {
      // Генерируем уникальное имя "Малютка{число}"
      let username;
      let attempts = 0;
      const maxAttempts = 100;
      
      do {
        const randomNum = Math.floor(Math.random() * 10000);
        username = `Малютка${randomNum}`;
        const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
        if (!existing) break;
        attempts++;
      } while (attempts < maxAttempts);

      if (attempts >= maxAttempts) {
        return res.status(500).json({ error: "Не удалось сгенерировать уникальное имя" });
      }

      // Создаем нового пользователя
      const result = db
        .prepare("INSERT INTO users (username, telegram_id, telegram_username) VALUES (?, ?, ?)")
        .run(username, telegram_id, tg_username || null);
      
      user = { 
        id: result.lastInsertRowid, 
        username,
        telegram_id,
        telegram_username: tg_username || null
      };

      // Проверяем, были ли другие пользователи с этого IP
      const otherUsers = db.prepare(`
        SELECT DISTINCT u.username 
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.ip_address = ? AND u.id != ?
        ORDER BY s.created_at DESC
        LIMIT 5
      `).all(ip_address, user.id);

      const time = new Date().toLocaleString("ru-RU");
      
      const displayIp = (ip_address === '127.0.0.1' || ip_address === '::1') ? 'Telegram (IP недоступен)' : ip_address;
      
      let message = `👤 НОВЫЙ ПОЛЬЗОВАТЕЛЬ (Telegram)

🆔 ID: ${user.id}
👤 Имя: ${username}
📱 Telegram: ${first_name || 'N/A'} ${tg_username ? `(@${tg_username})` : ''}
🔑 TG ID: ${telegram_id}
🌍 IP: ${displayIp}
🕐 Время: ${time}`;

      if (otherUsers.length > 0 && displayIp !== 'Telegram (IP недоступен)') {
        message += `\n\n⚠️ С этого IP уже заходили:`;
        otherUsers.forEach(u => {
          message += `\n  • ${u.username}`;
        });
      }

      // Отправляем уведомление админу
      notifyAdmin(message).catch(err => {
        console.error("⚠️ Не удалось отправить уведомление о новом пользователе:", err);
      });
    }

    // Генерируем токен создания сессии
    const sessionCreationToken = `${user.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessionCreationTokens.set(user.id, { token: sessionCreationToken, expiresAt: Date.now() + 5 * 60 * 1000 });

    // Обновляем токен с данными пользователя
    tokenData.status = 'completed';
    tokenData.user = user;
    tokenData.isNewUser = isNewUser;
    tokenData.sessionCreationToken = sessionCreationToken;
    telegramAuthTokens.set(auth_token, tokenData);

    res.json({ 
      success: true,
      user,
      isNewUser
    });
  } catch (error) {
    console.error("Ошибка завершения авторизации:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/telegram-auth - Авторизация через Telegram
router.post("/api/user/telegram-auth", async (req, res) => {
  try {
    let { telegram_id, first_name, username: tg_username } = req.body;
    
    // Приводим telegram username к нижнему регистру
    if (tg_username) {
      tg_username = tg_username.toLowerCase();
    }
    
    if (!telegram_id) {
      return res.status(400).json({ error: "Telegram ID обязателен" });
    }

    // Проверяем, существует ли пользователь с таким telegram_id
    let user = db
      .prepare("SELECT * FROM users WHERE telegram_id = ?")
      .get(telegram_id);

    const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
    const isNewUser = !user;

    if (!user) {
      // Генерируем уникальное имя "Малютка{число}"
      let username;
      let attempts = 0;
      const maxAttempts = 100;
      
      do {
        const randomNum = Math.floor(Math.random() * 10000);
        username = `Малютка${randomNum}`;
        const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
        if (!existing) break;
        attempts++;
      } while (attempts < maxAttempts);

      if (attempts >= maxAttempts) {
        return res.status(500).json({ error: "Не удалось сгенерировать уникальное имя" });
      }

      // Создаем нового пользователя
      const result = db
        .prepare("INSERT INTO users (username, telegram_id, telegram_username) VALUES (?, ?, ?)")
        .run(username, telegram_id, tg_username || null);
      
      user = { 
        id: result.lastInsertRowid, 
        username,
        telegram_id,
        telegram_username: tg_username || null
      };

      // Проверяем, были ли другие пользователи с этого IP
      const otherUsers = db.prepare(`
        SELECT DISTINCT u.username 
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.ip_address = ? AND u.id != ?
        ORDER BY s.created_at DESC
        LIMIT 5
      `).all(ip_address, user.id);

      const time = new Date().toLocaleString("ru-RU");
      const displayIp = (ip_address === '127.0.0.1' || ip_address === '::1') ? 'Telegram (IP недоступен)' : ip_address;
      
      let message = `👤 НОВЫЙ ПОЛЬЗОВАТЕЛЬ (Telegram)

🆔 ID: ${user.id}
👤 Имя: ${username}
📱 Telegram: ${first_name || 'N/A'} ${tg_username ? `(@${tg_username})` : ''}
🔑 TG ID: ${telegram_id}
🌍 IP: ${displayIp}
🕐 Время: ${time}`;

      if (otherUsers.length > 0 && displayIp !== 'Telegram (IP недоступен)') {
        message += `\n\n⚠️ С этого IP уже заходили:`;
        otherUsers.forEach(u => {
          message += `\n  • ${u.username}`;
        });
      }

      // Отправляем уведомление админу
      notifyAdmin(message).catch(err => {
        console.error("⚠️ Не удалось отправить уведомление о новом пользователе:", err);
      });
    }

    res.json({ 
      user,
      isNewUser
    });
  } catch (error) {
    console.error("Ошибка Telegram авторизации:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/telegram - Получить Telegram username пользователя
router.get("/api/user/:userId/telegram", (req, res) => {
  try {
    const { userId } = req.params;
    const user = db
      .prepare("SELECT telegram_username FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({ telegram_username: user.telegram_username || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/:userId/telegram - Сохранить/обновить Telegram username
router.put("/api/user/:userId/telegram", requireOwnership, async (req, res) => {
  try {
    const { userId } = req.params;
    let { telegram_username } = req.body;

    // Убираем @ если пользователь его ввёл
    if (telegram_username && telegram_username.startsWith("@")) {
      telegram_username = telegram_username.substring(1);
    }

    // Приводим к нижнему регистру
    if (telegram_username) {
      telegram_username = telegram_username.toLowerCase();
    }

    // Проверяем существование пользователя
    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем уникальность Telegram username
    if (telegram_username) {
      const existingUser = db
        .prepare("SELECT id FROM users WHERE LOWER(telegram_username) = ? AND id != ?")
        .get(telegram_username, userId);
      
      if (existingUser) {
        return res.status(400).json({ 
          error: `Telegram @${telegram_username} уже привязан к другому аккаунту` 
        });
      }
    }

    const oldTelegramUsername = user.telegram_username;

    // Получаем telegram_id (chat_id) из telegram_users если пользователь уже писал боту
    let telegramId = null;
    if (telegram_username) {
      const telegramUser = db
        .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
        .get(telegram_username);
      
      if (telegramUser && telegramUser.chat_id) {
        telegramId = telegramUser.chat_id;
      }
    }

    // Обновляем telegram_username и telegram_id
    db.prepare("UPDATE users SET telegram_username = ?, telegram_id = ? WHERE id = ?").run(
      telegram_username || null,
      telegramId,
      userId
    );

    // Отправляем уведомление админу и личное сообщение пользователю
    if (telegram_username && telegram_username !== oldTelegramUsername) {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const time = new Date().toLocaleString("ru-RU");
        const action = oldTelegramUsername ? "изменил" : "добавил";

        // Уведомление админу
        const adminMessage = `📱 TELEGRAM USERNAME

👤 Пользователь: ${user.username}
✏️ Действие: ${action} свой ТГ
📲 Username: @${telegram_username}
🕐 Время: ${time}`;

        try {
          await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: TELEGRAM_ADMIN_ID,
                text: adminMessage,
              }),
            }
          );
        } catch (err) {
          console.error("❌ Ошибка отправки уведомления админу:", err);
        }

        // Личное сообщение пользователю
        const cleanUsername = telegram_username.toLowerCase();
        const telegramUser = db
          .prepare(
            "SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?"
          )
          .get(cleanUsername);

        if (telegramUser && telegramUser.chat_id) {
          // Пользователь уже писал боту - отправляем личное сообщение напрямую
          notifyTelegramLinked(
            user.username,
            telegram_username,
            telegramUser.chat_id
          );
          console.log(
            `✅ Уведомление о привязке отправлено @${telegram_username} (${telegramUser.chat_id})`
          );
        } else {
          // Если пользователь ещё не писал боту, добавляем уведомление в очередь
          // чтобы отправить как только пользователь напишет боту
          notifyTelegramLinked(user.username, telegram_username);
          console.log(
            `📱 Уведомление о привязке добавлено в очередь для @${telegram_username}`
          );
        }
      }

      // Записываем в лог изменение настроек
      writeBetLog("settings", {
        username: user.username,
        setting: "Telegram",
        oldValue: oldTelegramUsername ? `@${oldTelegramUsername}` : null,
        newValue: `@${telegram_username}`,
      });
    }

    res.json({
      success: true,
      message: "Telegram username сохранён",
      telegram_username: telegram_username || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/user/:userId/telegram - Удалить Telegram username
router.delete("/api/user/:userId/telegram", requireOwnership, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const oldTelegramUsername = user.telegram_username;

    db.prepare("UPDATE users SET telegram_username = NULL WHERE id = ?").run(
      userId
    );

    // Отправляем уведомление админу если telegram_username был удалён
    if (oldTelegramUsername) {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const time = new Date().toLocaleString("ru-RU");
        const message = `📱 УДАЛЕНИЕ TELEGRAM USERNAME

👤 Пользователь: ${user.username}
✏️ Действие: удалил привязку Telegram
📲 Был: @${oldTelegramUsername}
🕐 Время: ${time}`;

        try {
          await fetch(
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
        } catch (err) {
          console.error("❌ Ошибка отправки уведомления в Telegram:", err);
        }
      }
    }

    // Записываем в лог удаление настройки
    if (oldTelegramUsername) {
      writeBetLog("settings", {
        username: user.username,
        setting: "Telegram",
        oldValue: `@${oldTelegramUsername}`,
        newValue: null,
      });
    }

    res.json({
      success: true,
      message: "Telegram username удалён",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/telegram/request-change - Запросить изменение Telegram username
router.post("/api/user/:userId/telegram/request-change", requireOwnership, async (req, res) => {
  try {
    const { userId } = req.params;
    const { new_telegram_username } = req.body;

    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);
    
    if (!user || !user.telegram_username) {
      return res.status(404).json({ error: "Пользователь не найден или Telegram не привязан" });
    }

    // Генерируем 6-значный код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Сохраняем код с временем истечения (5 минут)
    confirmationCodes.set(`change_${userId}`, {
      code,
      newUsername: new_telegram_username,
      expires: Date.now() + 5 * 60 * 1000
    });

    // Отправляем код в Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (TELEGRAM_BOT_TOKEN) {
      const message = `🔐 КОД ПОДТВЕРЖДЕНИЯ

Вы запросили изменение Telegram логина на сайте 1xBetLineBoom.

Новый логин: @${new_telegram_username}

Ваш код подтверждения: <code>${code}</code>

Код действителен 5 минут.

Если это были не вы, проигнорируйте это сообщение.`;

      try {
        await sendTelegramMessageByUsername(user.telegram_username, message);
        res.json({ success: true, message: "Код отправлен в Telegram" });
      } catch (err) {
        console.error("❌ Ошибка отправки кода:", err);
        res.status(500).json({ error: "Не удалось отправить код в Telegram. Убедитесь, что вы писали боту." });
      }
    } else {
      res.status(500).json({ error: "Telegram бот не настроен" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/telegram/confirm-change - Подтвердить изменение Telegram username
router.post("/api/user/:userId/telegram/confirm-change", requireOwnership, async (req, res) => {
  try {
    const { userId } = req.params;
    const { new_telegram_username, confirmation_code } = req.body;

    const stored = confirmationCodes.get(`change_${userId}`);
    
    if (!stored) {
      return res.status(400).json({ error: "Код не найден. Запросите новый код." });
    }

    if (Date.now() > stored.expires) {
      confirmationCodes.delete(`change_${userId}`);
      return res.status(400).json({ error: "Код истек. Запросите новый код." });
    }

    if (stored.code !== confirmation_code) {
      return res.status(400).json({ error: "Неверный код подтверждения" });
    }

    if (stored.newUsername !== new_telegram_username) {
      return res.status(400).json({ error: "Логин не совпадает с запрошенным" });
    }

    // Проверяем уникальность нового Telegram username
    let cleanNewUsername = new_telegram_username;
    if (cleanNewUsername && cleanNewUsername.startsWith("@")) {
      cleanNewUsername = cleanNewUsername.substring(1);
    }

    // Приводим к нижнему регистру
    if (cleanNewUsername) {
      cleanNewUsername = cleanNewUsername.toLowerCase();
    }

    if (cleanNewUsername) {
      const existingUser = db
        .prepare("SELECT id FROM users WHERE LOWER(telegram_username) = ? AND id != ?")
        .get(cleanNewUsername, userId);
      
      if (existingUser) {
        confirmationCodes.delete(`change_${userId}`);
        return res.status(400).json({ 
          error: `Telegram @${cleanNewUsername} уже привязан к другому аккаунту` 
        });
      }
    }

    // Код верный, обновляем username
    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    const oldUsername = user.telegram_username;

    // Получаем telegram_id (chat_id) из telegram_users
    let telegramId = null;
    if (cleanNewUsername) {
      const telegramUser = db
        .prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?")
        .get(cleanNewUsername);
      
      if (telegramUser && telegramUser.chat_id) {
        telegramId = telegramUser.chat_id;
      }
    }

    // Обновляем telegram_username и telegram_id
    db.prepare("UPDATE users SET telegram_username = ?, telegram_id = ? WHERE id = ?").run(
      cleanNewUsername,
      telegramId,
      userId
    );

    // Удаляем использованный код
    confirmationCodes.delete(`change_${userId}`);

    // Уведомляем админа
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      const time = new Date().toLocaleString("ru-RU");
      const message = `📱 ИЗМЕНЕНИЕ TELEGRAM USERNAME

👤 Пользователь: ${user.username}
✏️ Действие: изменил Telegram логин
📲 Было: @${oldUsername}
📲 Стало: @${cleanNewUsername}
🕐 Время: ${time}`;

      try {
        await fetch(
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
      } catch (err) {
        console.error("❌ Ошибка отправки уведомления:", err);
      }
    }

    res.json({ success: true, message: "Telegram username успешно изменен" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/telegram/request-delete - Запросить удаление Telegram username
router.post("/api/user/:userId/telegram/request-delete", requireOwnership, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);
    
    if (!user || !user.telegram_username) {
      return res.status(404).json({ error: "Пользователь не найден или Telegram не привязан" });
    }

    // Генерируем 6-значный код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Сохраняем код с временем истечения (5 минут)
    confirmationCodes.set(`delete_${userId}`, {
      code,
      expires: Date.now() + 5 * 60 * 1000
    });

    // Отправляем код в Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (TELEGRAM_BOT_TOKEN) {
      const message = `🔐 КОД ПОДТВЕРЖДЕНИЯ

Вы запросили удаление Telegram логина на сайте 1xBetLineBoom.

Ваш код подтверждения: <code>${code}</code>

Код действителен 5 минут.

Если это были не вы, проигнорируйте это сообщение.`;

      try {
        await sendTelegramMessageByUsername(user.telegram_username, message);
        res.json({ success: true, message: "Код отправлен в Telegram" });
      } catch (err) {
        console.error("❌ Ошибка отправки кода:", err);
        res.status(500).json({ error: "Не удалось отправить код в Telegram. Убедитесь, что вы писали боту." });
      }
    } else {
      res.status(500).json({ error: "Telegram бот не настроен" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/telegram/confirm-delete - Подтвердить удаление Telegram username
router.post("/api/user/:userId/telegram/confirm-delete", requireOwnership, async (req, res) => {
  try {
    const { userId } = req.params;
    const { confirmation_code } = req.body;

    const stored = confirmationCodes.get(`delete_${userId}`);
    
    if (!stored) {
      return res.status(400).json({ error: "Код не найден. Запросите новый код." });
    }

    if (Date.now() > stored.expires) {
      confirmationCodes.delete(`delete_${userId}`);
      return res.status(400).json({ error: "Код истек. Запросите новый код." });
    }

    if (stored.code !== confirmation_code) {
      return res.status(400).json({ error: "Неверный код подтверждения" });
    }

    // Код верный, удаляем username
    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);

    const oldUsername = user.telegram_username;

    db.prepare("UPDATE users SET telegram_username = NULL WHERE id = ?").run(userId);

    // Удаляем использованный код
    confirmationCodes.delete(`delete_${userId}`);

    // Уведомляем админа
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      const time = new Date().toLocaleString("ru-RU");
      const message = `📱 УДАЛЕНИЕ TELEGRAM USERNAME

👤 Пользователь: ${user.username}
✏️ Действие: удалил привязку Telegram (с подтверждением)
📲 Был: @${oldUsername}
🕐 Время: ${time}`;

      try {
        await fetch(
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
      } catch (err) {
        console.error("❌ Ошибка отправки уведомления:", err);
      }
    }

    res.json({ success: true, message: "Telegram username успешно удален" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions - Создать новую сессию
router.post("/api/sessions", async (req, res) => {
  try {
    const { user_id, device_info, browser, os, sessionCreationToken } = req.body;

    // Проверяем токен создания сессии (требуется после логина/2FA)
    const pending = sessionCreationTokens.get(user_id);
    if (!pending || pending.token !== sessionCreationToken || pending.expiresAt < Date.now()) {
      return res.status(403).json({ error: 'Требуется авторизация для создания сессии' });
    }
    // Удаляем использованный токен
    sessionCreationTokens.delete(user_id);

    // Получаем IP адрес
    const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';

    // Проверяем, есть ли уже сессия с таким же устройством и IP
    const existingSession = db.prepare(`
      SELECT session_token, is_trusted FROM sessions 
      WHERE user_id = ? AND device_info = ? AND browser = ? AND os = ? AND ip_address = ?
    `).get(user_id, device_info, browser, os, ip_address);

    if (existingSession) {
      // Обновляем last_activity существующей сессии
      db.prepare(`
        UPDATE sessions 
        SET last_activity = CURRENT_TIMESTAMP 
        WHERE session_token = ?
      `).run(existingSession.session_token);

      return res.json({ 
        success: true, 
        session_token: existingSession.session_token,
        message: "Сессия обновлена" 
      });
    }

    // Проверяем, было ли это устройство доверенным ранее (даже если сессия была удалена)
    const wasTrusted = db.prepare(`
      SELECT is_trusted FROM sessions 
      WHERE user_id = ? AND device_info = ? AND browser = ? AND os = ? AND ip_address = ? AND is_trusted = 1
      ORDER BY created_at DESC LIMIT 1
    `).get(user_id, device_info, browser, os, ip_address);

    const is_trusted = wasTrusted ? 1 : 0;

    console.log("🔧 Создание новой сессии:");
    console.log("  User ID:", user_id);
    console.log("  Device:", device_info);
    console.log("  Browser:", browser);
    console.log("  OS:", os);
    console.log("  IP:", ip_address);
    console.log("  Было доверенным ранее:", wasTrusted ? "ДА" : "НЕТ");
    console.log("  is_trusted:", is_trusted);

    // Генерируем уникальный токен сессии
    const session_token = `${user_id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Создаем новую сессию с сохранением статуса доверенного устройства
    db.prepare(`
      INSERT INTO sessions (user_id, session_token, device_info, browser, os, ip_address, is_trusted)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user_id, session_token, device_info, browser, os, ip_address, is_trusted);

    res.json({ 
      success: true, 
      session_token,
      message: "Сессия создана" 
    });
  } catch (error) {
    console.error("❌ Ошибка создания сессии:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/sessions - Получить все сессии пользователя
router.get("/api/user/:userId/sessions", async (req, res) => {
  try {
    const { userId } = req.params;

    const sessions = db.prepare(`
      SELECT id, session_token, device_info, browser, os, ip_address, 
             last_activity, created_at, is_trusted
      FROM sessions
      WHERE user_id = ?
      ORDER BY last_activity DESC
    `).all(userId);

    res.json(sessions);
  } catch (error) {
    console.error("❌ Ошибка получения сессий:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:sessionToken/validate - Проверить валидность сессии
router.get("/api/sessions/:sessionToken/validate", async (req, res) => {
  try {
    const { sessionToken } = req.params;

    const session = db.prepare(`
      SELECT id FROM sessions WHERE session_token = ?
    `).get(sessionToken);

    if (!session) {
      return res.status(404).json({ valid: false, error: "Сессия не найдена" });
    }

    res.json({ valid: true });
  } catch (error) {
    console.error("❌ Ошибка валидации сессии:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/user/:userId/sessions/:sessionToken - Удалить конкретную сессию
router.delete("/api/user/:userId/sessions/:sessionToken", requireOwnership, async (req, res) => {
  try {
    const { userId, sessionToken } = req.params;

    // Проверяем, что сессия принадлежит пользователю
    const session = db.prepare(`
      SELECT id FROM sessions WHERE user_id = ? AND session_token = ?
    `).get(userId, sessionToken);

    if (!session) {
      return res.status(404).json({ error: "Сессия не найдена" });
    }

    // Удаляем сессию
    db.prepare("DELETE FROM sessions WHERE session_token = ?").run(sessionToken);

    res.json({ success: true, message: "Сессия удалена" });
  } catch (error) {
    console.error("❌ Ошибка удаления сессии:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/sessions/:sessionToken/request-logout - Запросить выход с устройства
router.post("/api/user/:userId/sessions/:sessionToken/request-logout", requireOwnership, async (req, res) => {
  try {
    const { userId, sessionToken } = req.params;

    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);
    
    if (!user || !user.telegram_username) {
      return res.status(404).json({ error: "Пользователь не найден или Telegram не привязан" });
    }

    // Проверяем, что сессия принадлежит пользователю
    const session = db.prepare(`
      SELECT device_info, browser, os FROM sessions WHERE user_id = ? AND session_token = ?
    `).get(userId, sessionToken);

    if (!session) {
      return res.status(404).json({ error: "Сессия не найдена" });
    }

    // Генерируем 6-значный код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Сохраняем код с временем истечения (5 минут)
    confirmationCodes.set(`logout_${userId}_${sessionToken}`, {
      code,
      expires: Date.now() + 5 * 60 * 1000
    });

    // Отправляем код в Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (TELEGRAM_BOT_TOKEN) {
      const message = `🔐 КОД ПОДТВЕРЖДЕНИЯ

Вы запросили выход с устройства на сайте 1xBetLineBoom.

Устройство: ${session.device_info || 'Неизвестно'}
Браузер: ${session.browser || 'Неизвестно'}
ОС: ${session.os || 'Неизвестно'}

Ваш код подтверждения: <code>${code}</code>

Код действителен 5 минут.

Если это были не вы, проигнорируйте это сообщение.`;

      try {
        await sendTelegramMessageByUsername(user.telegram_username, message);
        res.json({ success: true, message: "Код отправлен в Telegram" });
      } catch (err) {
        console.error("❌ Ошибка отправки кода:", err);
        res.status(500).json({ error: "Не удалось отправить код в Telegram. Убедитесь, что вы писали боту." });
      }
    } else {
      res.status(500).json({ error: "Telegram бот не настроен" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/sessions/:sessionToken/confirm-logout - Подтвердить выход с устройства
router.post("/api/user/:userId/sessions/:sessionToken/confirm-logout", requireOwnership, async (req, res) => {
  try {
    const { userId, sessionToken } = req.params;
    const { confirmation_code } = req.body;

    const stored = confirmationCodes.get(`logout_${userId}_${sessionToken}`);
    
    if (!stored) {
      return res.status(400).json({ error: "Код не найден. Запросите новый код." });
    }

    if (Date.now() > stored.expires) {
      confirmationCodes.delete(`logout_${userId}_${sessionToken}`);
      return res.status(400).json({ error: "Код истек. Запросите новый код." });
    }

    if (stored.code !== confirmation_code) {
      return res.status(400).json({ error: "Неверный код подтверждения" });
    }

    // Код верный, удаляем сессию
    const user = db
      .prepare("SELECT id, username FROM users WHERE id = ?")
      .get(userId);

    const session = db.prepare(`
      SELECT device_info, browser, os FROM sessions WHERE user_id = ? AND session_token = ?
    `).get(userId, sessionToken);

    if (!session) {
      confirmationCodes.delete(`logout_${userId}_${sessionToken}`);
      return res.status(404).json({ error: "Сессия не найдена" });
    }

    // Удаляем сессию
    db.prepare("DELETE FROM sessions WHERE session_token = ?").run(sessionToken);

    // Удаляем использованный код
    confirmationCodes.delete(`logout_${userId}_${sessionToken}`);

    // Уведомляем админа
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      const time = new Date().toLocaleString("ru-RU");
      const message = `📱 ВЫХОД С УСТРОЙСТВА

👤 Пользователь: ${user.username}
✏️ Действие: завершил сеанс на устройстве (с подтверждением)
📱 Устройство: ${session.device_info || 'Неизвестно'}
🌐 Браузер: ${session.browser || 'Неизвестно'}
💻 ОС: ${session.os || 'Неизвестно'}
🕐 Время: ${time}`;

      try {
        await fetch(
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
      } catch (err) {
        console.error("❌ Ошибка отправки уведомления:", err);
      }
    }

    res.json({ success: true, message: "Сессия успешно удалена" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/sessions/:sessionToken/request-trust - Запросить изменение статуса доверенного устройства
router.post("/api/user/:userId/sessions/:sessionToken/request-trust", async (req, res) => {
  try {
    const { userId, sessionToken } = req.params;
    const { is_trusted } = req.body;

    const user = db
      .prepare("SELECT id, username, telegram_username FROM users WHERE id = ?")
      .get(userId);
    
    if (!user || !user.telegram_username) {
      return res.status(404).json({ error: "Пользователь не найден или Telegram не привязан" });
    }

    // Проверяем, что сессия принадлежит пользователю
    const session = db.prepare(`
      SELECT device_info, browser, os FROM sessions WHERE user_id = ? AND session_token = ?
    `).get(userId, sessionToken);

    if (!session) {
      return res.status(404).json({ error: "Сессия не найдена" });
    }

    // Генерируем 6-значный код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Сохраняем код с временем истечения (5 минут)
    confirmationCodes.set(`trust_${userId}_${sessionToken}`, {
      code,
      expires: Date.now() + 5 * 60 * 1000
    });

    // Отправляем код в Telegram
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (TELEGRAM_BOT_TOKEN) {
      const action = is_trusted ? 'добавить в доверенные' : 'убрать из доверенных';
      const message = `🔐 КОД ПОДТВЕРЖДЕНИЯ

Вы запросили изменение статуса устройства на сайте 1xBetLineBoom.

Устройство: ${session.device_info || 'Неизвестно'}
Браузер: ${session.browser || 'Неизвестно'}
ОС: ${session.os || 'Неизвестно'}

Действие: ${action}

Ваш код подтверждения: <code>${code}</code>

Код действителен 5 минут.

Если это были не вы, проигнорируйте это сообщение.`;

      try {
        await sendTelegramMessageByUsername(user.telegram_username, message);
        res.json({ success: true, message: "Код отправлен в Telegram" });
      } catch (err) {
        console.error("❌ Ошибка отправки кода:", err);
        res.status(500).json({ error: "Не удалось отправить код в Telegram. Убедитесь, что вы писали боту." });
      }
    } else {
      res.status(500).json({ error: "Telegram бот не настроен" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/sessions/:sessionToken/confirm-trust - Подтвердить изменение статуса доверенного устройства
router.post("/api/user/:userId/sessions/:sessionToken/confirm-trust", async (req, res) => {
  try {
    const { userId, sessionToken } = req.params;
    const { confirmation_code, is_trusted } = req.body;

    const stored = confirmationCodes.get(`trust_${userId}_${sessionToken}`);
    
    if (!stored) {
      return res.status(400).json({ error: "Код не найден. Запросите новый код." });
    }

    if (Date.now() > stored.expires) {
      confirmationCodes.delete(`trust_${userId}_${sessionToken}`);
      return res.status(400).json({ error: "Код истек. Запросите новый код." });
    }

    if (stored.code !== confirmation_code) {
      return res.status(400).json({ error: "Неверный код подтверждения" });
    }

    // Код верный, обновляем статус доверенного устройства
    const user = db
      .prepare("SELECT id, username FROM users WHERE id = ?")
      .get(userId);

    const session = db.prepare(`
      SELECT device_info, browser, os, is_trusted FROM sessions WHERE user_id = ? AND session_token = ?
    `).get(userId, sessionToken);

    if (!session) {
      confirmationCodes.delete(`trust_${userId}_${sessionToken}`);
      return res.status(404).json({ error: "Сессия не найдена" });
    }

    console.log("🔒 Обновление статуса доверенного устройства:");
    console.log("  User ID:", userId);
    console.log("  Session Token:", sessionToken);
    console.log("  Текущий is_trusted:", session.is_trusted);
    console.log("  Новый is_trusted:", is_trusted ? 1 : 0);

    // Обновляем статус
    const updateResult = db.prepare("UPDATE sessions SET is_trusted = ? WHERE session_token = ?").run(is_trusted ? 1 : 0, sessionToken);
    
    console.log("  Обновлено строк:", updateResult.changes);

    // Проверяем что обновилось
    const updatedSession = db.prepare("SELECT is_trusted FROM sessions WHERE session_token = ?").get(sessionToken);
    console.log("  Проверка после обновления - is_trusted:", updatedSession ? updatedSession.is_trusted : "сессия не найдена");

    // Удаляем использованный код
    confirmationCodes.delete(`trust_${userId}_${sessionToken}`);

    // Уведомляем админа
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
      const time = new Date().toLocaleString("ru-RU");
      const action = is_trusted ? 'добавил в доверенные' : 'убрал из доверенных';
      const message = `🔒 ИЗМЕНЕНИЕ СТАТУСА УСТРОЙСТВА

👤 Пользователь: ${user.username}
✏️ Действие: ${action} устройство (с подтверждением)
📱 Устройство: ${session.device_info || 'Неизвестно'}
🌐 Браузер: ${session.browser || 'Неизвестно'}
💻 ОС: ${session.os || 'Неизвестно'}
🕐 Время: ${time}`;

      try {
        await fetch(
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
      } catch (err) {
        console.error("❌ Ошибка отправки уведомления:", err);
      }
    }

    res.json({ success: true, message: "Статус устройства успешно изменен" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/telegram/register
router.post("/api/telegram/register", (req, res) => {
  try {
    const { telegram_username, chat_id, first_name } = req.body;

    if (!telegram_username || !chat_id) {
      return res
        .status(400)
        .json({ error: "telegram_username и chat_id обязательны" });
    }

    // Убираем @ если есть
    const cleanUsername = telegram_username.replace("@", "").toLowerCase();

    // Сохраняем или обновляем связку
    db.prepare(
      `
      INSERT INTO telegram_users (telegram_username, chat_id, first_name)
      VALUES (?, ?, ?)
      ON CONFLICT(telegram_username) DO UPDATE SET
        chat_id = excluded.chat_id,
        first_name = excluded.first_name
    `
    ).run(cleanUsername, chat_id, first_name || null);

    console.log(`📱 Зарегистрирован telegram: @${cleanUsername} → ${chat_id}`);

    // Синхронизируем telegram_username в таблице users (если пользователь привязан по telegram_id)
    try {
      const result = db.prepare(
        `UPDATE users SET telegram_username = ? WHERE telegram_id = ? AND (telegram_username IS NULL OR telegram_username != ?)`
      ).run(cleanUsername, chat_id, cleanUsername);
      
      if (result.changes > 0) {
        console.log(`🔄 Синхронизирован telegram_username для chat_id ${chat_id}: @${cleanUsername}`);
      }
    } catch (syncError) {
      console.error('⚠️ Ошибка синхронизации telegram_username:', syncError);
      // Не прерываем выполнение, т.к. основная регистрация прошла успешно
    }

    res.json({ success: true, telegram_username: cleanUsername, chat_id });
  } catch (error) {
    console.error("Ошибка регистрации telegram:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/telegram/chat-id/:username - Получить chat_id по telegram username
router.get("/api/telegram/chat-id/:username", (req, res) => {
  try {
    const username = req.params.username.replace("@", "").toLowerCase();

    const user = db
      .prepare(
        "SELECT chat_id, first_name FROM telegram_users WHERE LOWER(telegram_username) = ?"
      )
      .get(username);

    if (!user) {
      return res
        .status(404)
        .json({ error: "Пользователь не найден", found: false });
    }

    res.json({
      found: true,
      chat_id: user.chat_id,
      first_name: user.first_name,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
