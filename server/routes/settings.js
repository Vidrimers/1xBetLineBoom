import { Router } from 'express';
import { db } from '../database/db.js';
import { PORT, SERVER_IP } from '../config.js';
import { notifyIllegalBet, sendAdminNotification, sendGroupNotification, notifyReminderEnabled, notifyReminderDeleted } from '../../OnexBetLineBoombot.js';

const router = Router();

// GET /api/user/timezone
router.get("/api/user/timezone", (req, res) => {
  try {
    const username = req.headers["x-username"] || req.query.username;

    if (!username) {
      return res.status(400).json({ error: "Не указано имя пользователя" });
    }

    const user = db
      .prepare("SELECT timezone FROM users WHERE username = ?")
      .get(username);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({ timezone: user.timezone || "Europe/Moscow" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/timezone
router.post("/api/user/timezone", async (req, res) => {
  try {
    const { username, timezone } = req.body;

    if (!username || !timezone) {
      return res
        .status(400)
        .json({ error: "Не указаны username или timezone" });
    }

    const validTimezones = Intl.supportedValuesOf("timeZone");
    if (!validTimezones.includes(timezone)) {
      return res
        .status(400)
        .json({ error: `Неверный часовой пояс: ${timezone}` });
    }

    const user = db
      .prepare("SELECT timezone, telegram_username FROM users WHERE username = ?")
      .get(username);

    const oldTimezone = user?.timezone || 'не установлен';

    const result = db
      .prepare("UPDATE users SET timezone = ? WHERE username = ?")
      .run(timezone, username);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    console.log(
      `🕐 Часовой пояс пользователя ${username} изменен на ${timezone}`
    );

    try {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_ID) {
        const time = new Date().toLocaleString("ru-RU");

        const adminMessage = `🕐 ИЗМЕНЕНИЕ ЧАСОВОГО ПОЯСА

👤 Пользователь: ${username}
${user?.telegram_username ? `📱 Telegram: @${user.telegram_username}` : ""}
✏️ Новый часовой пояс: ${timezone}
🕐 Старый часовой пояс: ${oldTimezone}
🕐 Время: ${time}`;

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
      }
    } catch (err) {
      console.error(
        "⚠️ Ошибка отправки уведомления админу об изменении часового пояса:",
        err.message
      );
    }

    res.json({ success: true, timezone });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/event/:eventId/reminders
router.get("/api/user/:userId/event/:eventId/reminders", (req, res) => {
  try {
    const { userId, eventId } = req.params;
    
    const reminder = db.prepare(`
      SELECT hours_before FROM event_reminders 
      WHERE user_id = ? AND event_id = ?
    `).get(userId, eventId);
    
    res.json({ 
      enabled: !!reminder,
      hours_before: reminder ? reminder.hours_before : null 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/event/:eventId/reminders
router.post("/api/user/:userId/event/:eventId/reminders", async (req, res) => {
  try {
    const { userId, eventId } = req.params;
    const { hours_before } = req.body;
    
    if (!hours_before || hours_before < 1 || hours_before > 12) {
      return res.status(400).json({ error: "hours_before должно быть от 1 до 12" });
    }
    
    const user = db.prepare("SELECT id, username, telegram_username FROM users WHERE id = ?").get(userId);
    const event = db.prepare("SELECT id, name FROM events WHERE id = ?").get(eventId);
    
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    
    if (!event) {
      return res.status(404).json({ error: "Турнир не найден" });
    }
    
    db.prepare(`
      INSERT INTO event_reminders (user_id, event_id, hours_before)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, event_id) 
      DO UPDATE SET hours_before = excluded.hours_before
    `).run(userId, eventId, hours_before);
    
    if (user.telegram_username) {
      try {
        await notifyReminderEnabled(user.username, user.telegram_username, event.name, hours_before);
      } catch (error) {
        console.error("Ошибка отправки уведомления о включении напоминаний:", error);
      }
    }
    
    res.json({ success: true, hours_before });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/user/:userId/event/:eventId/reminders
router.delete("/api/user/:userId/event/:eventId/reminders", async (req, res) => {
  try {
    const { userId, eventId } = req.params;
    
    const user = db.prepare("SELECT id, username, telegram_username FROM users WHERE id = ?").get(userId);
    const event = db.prepare("SELECT id, name FROM events WHERE id = ?").get(eventId);
    
    db.prepare(`
      DELETE FROM event_reminders 
      WHERE user_id = ? AND event_id = ?
    `).run(userId, eventId);
    
    if (user && user.telegram_username && event) {
      try {
        await notifyReminderDeleted(user.username, user.telegram_username, event.name);
      } catch (error) {
        console.error("Ошибка отправки уведомления об удалении напоминаний:", error);
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/:userId/notification-settings
router.get("/api/user/:userId/notification-settings", (req, res) => {
  try {
    const { userId } = req.params;
    
    let settings = db.prepare(`
      SELECT match_reminders, three_hour_reminders, only_active_tournaments, tournament_announcements, match_results, system_messages
      FROM user_notification_settings
      WHERE user_id = ?
    `).get(userId);
    
    if (!settings) {
      settings = {
        match_reminders: 1,
        three_hour_reminders: 1,
        only_active_tournaments: 0,
        tournament_announcements: 1,
        match_results: 1,
        system_messages: 1
      };
    }
    
    res.json({
      match_reminders: settings.match_reminders === 1,
      three_hour_reminders: settings.three_hour_reminders === 1,
      only_active_tournaments: settings.only_active_tournaments === 1,
      tournament_announcements: settings.tournament_announcements === 1,
      match_results: settings.match_results === 1,
      system_messages: settings.system_messages === 1
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/:userId/notification-settings
router.post("/api/user/:userId/notification-settings", async (req, res) => {
  try {
    const { userId } = req.params;
    const { match_reminders, three_hour_reminders, only_active_tournaments, tournament_announcements, match_results, system_messages } = req.body;
    
    const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(userId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    
    const oldSettings = db.prepare(`
      SELECT match_reminders, three_hour_reminders, only_active_tournaments, tournament_announcements, match_results, system_messages
      FROM user_notification_settings
      WHERE user_id = ?
    `).get(userId);
    
    db.prepare(`
      INSERT INTO user_notification_settings (user_id, match_reminders, three_hour_reminders, only_active_tournaments, tournament_announcements, match_results, system_messages, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) 
      DO UPDATE SET 
        match_reminders = excluded.match_reminders,
        three_hour_reminders = excluded.three_hour_reminders,
        only_active_tournaments = excluded.only_active_tournaments,
        tournament_announcements = excluded.tournament_announcements,
        match_results = excluded.match_results,
        system_messages = excluded.system_messages,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      userId,
      match_reminders ? 1 : 0,
      three_hour_reminders ? 1 : 0,
      only_active_tournaments ? 1 : 0,
      tournament_announcements ? 1 : 0,
      match_results ? 1 : 0,
      system_messages ? 1 : 0
    );
    
    const changes = [];
    
    if (!oldSettings) {
      changes.push(`🔔 Напоминания о матчах: ${match_reminders ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      changes.push(`⏰ Напоминания за 3 часа: ${three_hour_reminders ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      changes.push(`🎯 Только по турнирам с ставками: ${only_active_tournaments ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      changes.push(`📢 Объявления о турнирах: ${tournament_announcements ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      changes.push(`⚽ Результаты матчей: ${match_results ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      changes.push(`🔔 Системные уведомления: ${system_messages ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
    } else {
      if (oldSettings.match_reminders !== (match_reminders ? 1 : 0)) {
        changes.push(`🔔 Напоминания о матчах: ${match_reminders ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      }
      if (oldSettings.three_hour_reminders !== (three_hour_reminders ? 1 : 0)) {
        changes.push(`⏰ Напоминания за 3 часа: ${three_hour_reminders ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      }
      if (oldSettings.only_active_tournaments !== (only_active_tournaments ? 1 : 0)) {
        changes.push(`🎯 Только по турнирам с ставками: ${only_active_tournaments ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      }
      if (oldSettings.tournament_announcements !== (tournament_announcements ? 1 : 0)) {
        changes.push(`📢 Объявления о турнирах: ${tournament_announcements ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      }
      if (oldSettings.match_results !== (match_results ? 1 : 0)) {
        changes.push(`⚽ Результаты матчей: ${match_results ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      }
      if (oldSettings.system_messages !== (system_messages ? 1 : 0)) {
        changes.push(`🔔 Системные уведомления: ${system_messages ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
      }
    }
    
    if (changes.length > 0) {
      const message = `⚙️ <b>Изменение настроек уведомлений</b>\n\n` +
        `👤 Пользователь: <b>${user.username}</b>\n\n` +
        `${changes.join('\n')}`;
      
      try {
        await sendAdminNotification(message);
      } catch (error) {
        console.error("Ошибка отправки уведомления админу:", error);
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/test-group-notification
router.post("/api/admin/test-group-notification", async (req, res) => {
  const { username: adminUsername, testMode } = req.body;

  if (adminUsername !== process.env.ADMIN_DB_NAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  try {
    const usersWithReminders = db
      .prepare(
        "SELECT username, telegram_username FROM users WHERE telegram_group_reminders_enabled = 1"
      )
      .all();

    const mentions = usersWithReminders
      .map((user) =>
        user.telegram_username ? `@${user.telegram_username}` : user.username
      )
      .join(", ");

    const testMessage = `⏰ <b>🔔 ТЕСТОВОЕ НАПОМИНАНИЕ</b>

Это тестовое сообщение для проверки уведомлений в группе.

Матч начнётся <b>20.01.2026 в 18:30</b>

⚽ <b>Реал Мадрид</b> vs <b>Барселона</b>
🏆 Турнир: Лига Чемпионов 2024/25

👥 <b>Пользователи с включенными напоминаниями:</b>
${mentions || "Нет пользователей"}

🎯 Не забудьте сделать прогноз!

🌐 <a href="http://${SERVER_IP}:${PORT}">Открыть сайт</a>

<i>Это тестовое сообщение отправлено администратором</i>
${testMode ? '\n\n🧪 <b>ТЕСТОВЫЙ РЕЖИМ:</b> Отправлено только админу' : ''}`;

    if (testMode) {
      await sendAdminNotification(testMessage);
      console.log("✅ Тестовое уведомление отправлено только админу");
    } else {
      await sendGroupNotification(testMessage);
      console.log("✅ Тестовое уведомление отправлено в группу");
    }

    res.json({ 
      success: true, 
      message: testMode ? "Тестовое уведомление отправлено только админу" : "Тестовое уведомление отправлено в группу"
    });
  } catch (error) {
    console.error("Ошибка при отправке тестового уведомления:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
