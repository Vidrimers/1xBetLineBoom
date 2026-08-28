import { sendGroupNotification, sendAdminNotification } from "../../OnexBetLineBoombot.js";
import { db } from "../database/db.js";
import { PORT, SERVER_IP } from "../config.js";
import { isUserInGroup } from "./telegramService.js";

// Отправить уведомление админу о действиях модератора
async function notifyModeratorAction(moderatorUsername, action, details) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
    return;
  }

  const time = new Date().toLocaleString("ru-RU");
  const message = `🛡️ ДЕЙСТВИЕ МОДЕРАТОРА

👤 Модератор: ${moderatorUsername}
🎬 Действие: ${action}

${details}

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
    console.log(`✅ Уведомление о действии модератора отправлено админу`);
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления админу:", error);
  }
}

// Отправить уведомление админу (общая)
async function notifyAdmin(message) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
    console.log("⚠️ Telegram не настроен, уведомление не отправлено");
    return;
  }

  try {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_ADMIN_ID,
          text: message,
          parse_mode: 'HTML'
        }),
      }
    );
    console.log(`✅ Уведомление отправлено админу`);
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления админу:", error);
  }
}

// Отправить уведомление пользователю
async function notifyUser(user_id, message) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  if (!TELEGRAM_BOT_TOKEN) {
    console.log("⚠️ Telegram не настроен, уведомление не отправлено");
    return;
  }

  try {
    const user = db.prepare("SELECT telegram_username, telegram_notifications_enabled FROM users WHERE id = ?").get(user_id);

    if (!user || !user.telegram_username || user.telegram_notifications_enabled === 0) {
      console.log(`⚠️ Пользователь ${user_id} не привязал Telegram или отключил уведомления`);
      return;
    }

    const cleanUsername = user.telegram_username.toLowerCase();
    const tgUser = db.prepare("SELECT chat_id FROM telegram_users WHERE LOWER(telegram_username) = ?").get(cleanUsername);

    if (!tgUser || !tgUser.chat_id) {
      console.log(`⚠️ Chat ID не найден для пользователя ${user.telegram_username}`);
      return;
    }

    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tgUser.chat_id,
          text: message,
          parse_mode: 'HTML'
        }),
      }
    );
    console.log(`✅ Уведомление отправлено пользователю ${user.telegram_username}`);
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления пользователю:", error);
  }
}

// Проверка и отправка напоминаний непроголосовавших пользователей за 3 часа до матча
async function checkAndRemindNonVoters() {
  console.log(
    `\n========== ⏰ checkAndRemindNonVoters ВЫЗВАНА В ${new Date().toISOString()} ==========`
  );
  try {
    const now = new Date();
    const threeHoursLater = new Date(now.getTime() + 3 * 60 * 60 * 1000);

    console.log(
      `⏰ checkAndRemindNonVoters: Ищем матчи от ${now.toISOString()} (${now.getTime()}) до ${threeHoursLater.toISOString()} (${threeHoursLater.getTime()})`
    );

    const allMatches = db
      .prepare(
        `
      SELECT m.id, m.team1_name, m.team2_name, m.match_date, e.name as event_name, e.id as event_id
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.winner IS NULL AND m.match_date IS NOT NULL
      ORDER BY m.match_date ASC
      LIMIT 50
    `
      )
      .all();

    console.log(`⏰ Матчей без победителя и с датой: ${allMatches.length}`);

    allMatches.forEach((match) => {
      const matchTime = new Date(match.match_date);
      const diffMs = matchTime.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      console.log(
        `⏰ Матч: ${match.team1_name} vs ${match.team2_name}, дата: ${match.match_date}, через ${diffHours.toFixed(2)} часов`
      );
    });

    const upcomingMatches = allMatches.filter((match) => {
      const matchTime = new Date(match.match_date);
      const inWindow = matchTime > now && matchTime <= threeHoursLater;
      if (!inWindow) {
        const diffMs = matchTime.getTime() - now.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);
        console.log(
          `⏰   ${match.team1_name} vs ${match.team2_name}: дата ${match.match_date}, через ${diffHours.toFixed(2)} часов - ИСКЛЮЧЕН`
        );
      }
      return inWindow;
    });

    console.log(`⏰ Найдено ${upcomingMatches.length} матчей в течение 3 часов`);

    if (upcomingMatches.length === 0) {
      console.log(`⏰ Нет матчей для проверки напоминаний`);
      return;
    }

    const matchGroups = {};
    upcomingMatches.forEach((match) => {
      const key = `${match.match_date}_${match.event_id}`;
      if (!matchGroups[key]) {
        matchGroups[key] = {
          match_date: match.match_date,
          event_name: match.event_name,
          event_id: match.event_id,
          matches: []
        };
      }
      matchGroups[key].matches.push(match);
    });

    console.log(`⏰ Сгруппировано в ${Object.keys(matchGroups).length} групп(ы) по времени и турниру`);

    for (const groupKey in matchGroups) {
      const group = matchGroups[groupKey];
      const matches = group.matches;

      console.log(`⏰ Обрабатываем группу: ${matches.length} матчей в ${group.match_date}, турнир: ${group.event_name}`);

      const matchIds = matches.map(m => m.id);
      const existingReminders = db
        .prepare(`SELECT match_id FROM sent_reminders WHERE match_id IN (${matchIds.join(',')})`)
        .all();

      if (existingReminders.length > 0) {
        console.log(`⏰ Напоминание уже было отправлено для группы матчей`);
        continue;
      }

      const allUsers = db
        .prepare("SELECT id, username, telegram_username, telegram_id FROM users WHERE telegram_group_reminders_enabled = 1")
        .all();

      console.log(`⏰ Всего пользователей с включёнными напоминаниями: ${allUsers.length}`);

      if (allUsers.length === 0) {
        console.log(`⏰ ⚠️ НЕТ ПОЛЬЗОВАТЕЛЕЙ С ВКЛЮЧЕННЫМИ НАПОМИНАНИЯМИ!`);
        continue;
      }

      const usersWithAllBets = allUsers.filter(user => {
        const userBets = db
          .prepare(`SELECT DISTINCT match_id FROM bets WHERE user_id = ? AND match_id IN (${matchIds.join(',')})`)
          .all(user.id)
          .map(row => row.match_id);
        return userBets.length === matches.length;
      });

      const nonVotersRaw = allUsers.filter(
        (user) => !usersWithAllBets.some(u => u.id === user.id)
      );

      const nonVoters = [];
      for (const user of nonVotersRaw) {
        if (user.telegram_id) {
          const inGroup = await isUserInGroup(user.telegram_id);
          if (inGroup) {
            nonVoters.push(user);
          } else {
            console.log(`⏰ Пользователь ${user.username} (@${user.telegram_username}) не состоит в группе — пропускаем`);
          }
        }
      }

      if (nonVoters.length > 0) {
        console.log(`⏰ Найдено ${nonVoters.length} непроголосовавших пользователей для группы матчей`);

        const matchDateTime = new Date(group.match_date);
        const matchDate = matchDateTime.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
        const matchTime = matchDateTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

        const mentions = nonVoters
          .map((user) => user.telegram_username ? `@${user.telegram_username}` : user.username)
          .join(", ");

        const matchesList = matches.map((m, index) =>
          `${index + 1}. ⚽ <b>${m.team1_name}</b> vs <b>${m.team2_name}</b>`
        ).join('\n');

        const matchWord = matches.length === 1 ? 'Матч начнётся' : 'Матчи начнутся';

        const message = `⏰ <b>Напоминание о голосовании!</b>

${matchWord} через 3 часа!

🕐 Время начала: <b>${matchDate} ${matchTime}</b>
🏆 Турнир: ${group.event_name}

${matchesList}

👥 <b>Не проголосовали:</b>
${mentions}

💬 Не забудьте сделать прогноз, малютки!

🔗 <a href="https://${SERVER_IP}">Открыть сайт</a>`;

        console.log(`⏰ Отправляем напоминание в группу для ${matches.length} матчей`);
        console.log(`📝 Сообщение: ${message.substring(0, 150)}...`);

        try {
          await sendGroupNotification(message);
          console.log(`✅ sendGroupNotification выполнена успешно`);
        } catch (err) {
          console.error(`❌ ОШИБКА при отправке sendGroupNotification: ${err.message}`);
          console.error(`   ${err.stack}`);
        }

        try {
          const stmt = db.prepare("INSERT INTO sent_reminders (match_id) VALUES (?)");
          matches.forEach(match => { stmt.run(match.id); });
          console.log(`📢 Записи в БД добавлены для ${matches.length} матчей`);
        } catch (err) {
          console.error(`❌ ОШИБКА при добавлении в БД: ${err.message}`);
        }
      } else {
        console.log(`⏰ Нет непроголосовавших пользователей для группы матчей (все сделали ставки)`);
      }
    }
  } catch (error) {
    console.error("❌ Ошибка при проверке непроголосовавших пользователей:", error);
  }
}

// Отправка личных уведомлений пользователям за 3 часа до матча
async function checkAndNotifyUpcomingMatches() {
  try {
    const now = new Date();
    const threeHoursLater = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const threeHoursLaterMinus5 = new Date(threeHoursLater.getTime() - 5 * 60 * 1000);
    const threeHoursLaterPlus5 = new Date(threeHoursLater.getTime() + 5 * 60 * 1000);

    console.log(
      `🔔 checkAndNotifyUpcomingMatches: Ищем матчи от ${threeHoursLaterMinus5.toISOString()} до ${threeHoursLaterPlus5.toISOString()}`
    );

    // Загружаем все незавершённые матчи и фильтруем в JS,
    // чтобы корректно работать с датами, содержащими смещение таймзоны (+03:00 и т.д.)
    const allMatches = db
      .prepare(
        `
      SELECT DISTINCT m.id, m.team1_name, m.team2_name, m.match_date, e.name as event_name, e.id as event_id
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.winner IS NULL AND m.match_date IS NOT NULL
      ORDER BY m.match_date ASC
      LIMIT 100
    `
      )
      .all();

    const upcomingMatches = allMatches.filter((match) => {
      const matchTime = new Date(match.match_date).getTime();
      return matchTime > threeHoursLaterMinus5.getTime() && matchTime <= threeHoursLaterPlus5.getTime();
    });

    console.log(`🔔 Найдено ${upcomingMatches.length} матчей которые начнутся через ~3 часа`);

    if (upcomingMatches.length === 0) return;

    const usersWithNotifications = db
      .prepare(
        `
      SELECT u.id, u.username, u.telegram_id, u.telegram_username,
             COALESCE(uns.three_hour_reminders, 1) as three_hour_reminders,
             COALESCE(uns.only_active_tournaments, 0) as only_active_tournaments
      FROM users u
      LEFT JOIN user_notification_settings uns ON u.id = uns.user_id
      WHERE u.telegram_notifications_enabled = 1 
        AND u.telegram_id IS NOT NULL
        AND COALESCE(uns.three_hour_reminders, 1) = 1
    `
      )
      .all();

    console.log(`🔔 Найдено ${usersWithNotifications.length} пользователей с включенными уведомлениями за 3 часа`);

    if (usersWithNotifications.length === 0) return;

    const matchGroups = {};
    upcomingMatches.forEach((match) => {
      const key = `${match.match_date}_${match.event_id}`;
      if (!matchGroups[key]) {
        matchGroups[key] = { match_date: match.match_date, event_name: match.event_name, event_id: match.event_id, matches: [] };
      }
      matchGroups[key].matches.push(match);
    });

    console.log(`🔔 Сгруппировано в ${Object.keys(matchGroups).length} групп(ы) по времени и турниру`);

    for (const groupKey in matchGroups) {
      const group = matchGroups[groupKey];
      const matches = group.matches;

      console.log(`🔔 Обрабатываем группу: ${matches.length} матчей в ${group.match_date}, турнир: ${group.event_name}`);

      const matchIds = matches.map(m => m.id);
      const existingNotifications = db
        .prepare(`SELECT match_id FROM sent_3hour_reminders WHERE match_id IN (${matchIds.join(',')})`)
        .all();

      if (existingNotifications.length > 0) {
        console.log(`🔔 Уведомление за 3 часа для группы матчей уже было отправлено`);
        continue;
      }

      const matchDateTime = new Date(group.match_date);
      const matchDate = matchDateTime.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
      const matchTime = matchDateTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

      const matchWord = matches.length === 1 ? 'НАПОМИНАНИЕ О МАТЧЕ' : 'НАПОМИНАНИЕ О МАТЧАХ';
      const startWord = matches.length === 1 ? 'Матч начнется' : 'Матчи начнутся';

      for (const user of usersWithNotifications) {
        if (user.only_active_tournaments === 1) {
          const hasBets = db.prepare(`
            SELECT COUNT(*) as count
            FROM predictions p
            JOIN matches m ON p.match_id = m.id
            WHERE p.user_id = ? AND m.event_id = ?
          `).get(user.id, group.event_id);

          if (!hasBets || hasBets.count === 0) {
            console.log(`⏭️ Пропускаем пользователя ${user.username} - нет ставок в турнире ${group.event_name}`);
            continue;
          }
        }

        const userBetMatchIds = db
          .prepare(`SELECT DISTINCT match_id FROM bets WHERE user_id = ? AND match_id IN (${matchIds.join(',')})`)
          .all(user.id)
          .map(row => row.match_id);

        const matchesListWithStatus = matches.map((m, index) => {
          const hasBet = userBetMatchIds.includes(m.id);
          const status = hasBet ? '✅ Ставка принята' : '❌ Нет ставки';
          return `${index + 1}. ⚽ <b>${m.team1_name}</b> vs <b>${m.team2_name}</b> ${status}`;
        }).join('\n');

        const message = `⏰ <b>${matchWord}</b>

${startWord} через 3 часа!

🕐 Время начала: <b>${matchDate} ${matchTime}</b>
📅 Турнир: ${group.event_name}

${matchesListWithStatus}

⏳ Успейте сделать ставку!

🔗 <a href="https://${SERVER_IP}">Открыть сайт</a>`;

        try {
          const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
          if (TELEGRAM_BOT_TOKEN) {
            await fetch(
              `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: user.telegram_id, text: message, parse_mode: "HTML" }),
              }
            );
            console.log(`✅ Уведомление за 3 часа отправлено пользователю ${user.username} (${user.telegram_id})`);
          }
        } catch (error) {
          console.error(`⚠️ Не удалось отправить уведомление пользователю ${user.username}:`, error);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const stmt = db.prepare("INSERT INTO sent_3hour_reminders (match_id) VALUES (?)");
      matches.forEach(match => { stmt.run(match.id); });

      console.log(`✅ Уведомления за 3 часа для ${matches.length} матчей отправлены всем пользователям`);
    }
  } catch (error) {
    console.error("❌ Ошибка при проверке предстоящих матчей:", error);
  }
}

// Отправка персональных напоминаний из модального окна (event_reminders)
async function checkAndSendPersonalReminders() {
  try {
    const now = new Date();

    console.log(`🔔 checkAndSendPersonalReminders: Проверка персональных напоминаний в ${now.toISOString()}`);

    const reminders = db
      .prepare(
        `
      SELECT 
        er.id as reminder_id,
        er.user_id,
        er.event_id,
        er.hours_before,
        u.username,
        u.telegram_id,
        u.telegram_username,
        e.name as event_name
      FROM event_reminders er
      JOIN users u ON er.user_id = u.id
      JOIN events e ON er.event_id = e.id
      WHERE u.telegram_id IS NOT NULL
    `
      )
      .all();

    console.log(`🔔 Найдено ${reminders.length} активных напоминаний пользователей`);

    if (reminders.length === 0) return;

    for (const reminder of reminders) {
      const hoursInMs = reminder.hours_before * 60 * 60 * 1000;
      const targetTime = new Date(now.getTime() + hoursInMs);
      const targetTimeMinus5 = new Date(targetTime.getTime() - 5 * 60 * 1000);
      const targetTimePlus5 = new Date(targetTime.getTime() + 5 * 60 * 1000);

      // Загружаем все матчи турнира и фильтруем в JS,
      // чтобы корректно работать с датами, содержащими смещение таймзоны (+03:00 и т.д.)
      const allEventMatches = db
        .prepare(
          `
        SELECT m.id, m.team1_name, m.team2_name, m.match_date
        FROM matches m
        WHERE m.event_id = ?
          AND m.winner IS NULL
          AND m.match_date IS NOT NULL
        ORDER BY m.match_date ASC
      `
        )
        .all(reminder.event_id);

      const upcomingMatches = allEventMatches.filter((match) => {
        const matchTime = new Date(match.match_date).getTime();
        return matchTime > targetTimeMinus5.getTime() && matchTime <= targetTimePlus5.getTime();
      });

      if (upcomingMatches.length === 0) continue;

      console.log(`🔔 Пользователь ${reminder.username}: найдено ${upcomingMatches.length} матчей через ${reminder.hours_before}ч`);

      const matchGroups = {};
      upcomingMatches.forEach((match) => {
        const key = match.match_date;
        if (!matchGroups[key]) {
          matchGroups[key] = { match_date: match.match_date, matches: [] };
        }
        matchGroups[key].matches.push(match);
      });

      for (const groupKey in matchGroups) {
        const group = matchGroups[groupKey];
        const matches = group.matches;

        const matchIds = matches.map(m => m.id);
        const existingReminders = db
          .prepare(
            `SELECT match_id FROM sent_personal_reminders 
             WHERE user_id = ? AND match_id IN (${matchIds.join(',')})`
          )
          .all(reminder.user_id);

        if (existingReminders.length > 0) {
          console.log(`🔔 Персональное напоминание для пользователя ${reminder.username} уже отправлено`);
          continue;
        }

        const matchDateTime = new Date(group.match_date);
        const matchDate = matchDateTime.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
        const matchTime = matchDateTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

        const userBetMatchIds = db
          .prepare(`SELECT DISTINCT match_id FROM bets WHERE user_id = ? AND match_id IN (${matchIds.join(',')})`)
          .all(reminder.user_id)
          .map(row => row.match_id);

        const matchesListWithStatus = matches.map((m, index) => {
          const hasBet = userBetMatchIds.includes(m.id);
          const status = hasBet ? '✅ Ставка принята' : '❌ Нет ставки';
          return `${index + 1}. ⚽ <b>${m.team1_name}</b> vs <b>${m.team2_name}</b> ${status}`;
        }).join('\n');

        const hoursText = reminder.hours_before === 1 ? 'час' :
                          reminder.hours_before < 5 ? 'часа' : 'часов';

        const matchWord = matches.length === 1 ? 'Напоминание о матче!' : 'Напоминание о матчах!';

        const message = `🔔 <b>${matchWord}</b>

🏆 Турнир: ${reminder.event_name}

${matchesListWithStatus}

🕐 Начало через ${reminder.hours_before} ${hoursText}
🕐 Время начала: <b>${matchDate} ${matchTime}</b>

Не забудь сделать ставку! 🎯`;

        try {
          const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
          if (TELEGRAM_BOT_TOKEN) {
            await fetch(
              `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: reminder.telegram_id, text: message, parse_mode: "HTML" }),
              }
            );
            console.log(`✅ Персональное напоминание отправлено пользователю ${reminder.username} о ${matches.length} матчах`);
          }
        } catch (error) {
          console.error(`⚠️ Не удалось отправить персональное напоминание пользователю ${reminder.username}:`, error);
        }

        const stmt = db.prepare("INSERT INTO sent_personal_reminders (user_id, match_id) VALUES (?, ?)");
        matches.forEach(match => { stmt.run(reminder.user_id, match.id); });

        console.log(`📢 Записи в БД добавлены для ${matches.length} матчей пользователя ${reminder.username}`);

        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  } catch (error) {
    console.error("❌ Ошибка при проверке персональных напоминаний:", error);
  }
}

// Отправка объявления о турнире всем пользователям
async function sendTournamentAnnouncementToUsers(eventId, name, description, startDate, endDate) {
  try {
    console.log(`📢 Отправка объявления о турнире "${name}" всем пользователям...`);

    const users = db
      .prepare(`SELECT id, username, telegram_id FROM users WHERE telegram_id IS NOT NULL`)
      .all();

    console.log(`📢 Найдено ${users.length} пользователей с Telegram`);

    if (users.length === 0) return;

    let dateText = '';
    if (startDate && endDate) {
      const start = new Date(startDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
      const end = new Date(endDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
      dateText = `📅 Даты: ${start} - ${end}`;
    } else if (startDate) {
      const start = new Date(startDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
      dateText = `📅 Начало: ${start}`;
    }

    let message = `🏆 <b>НОВЫЙ ТУРНИР!</b>\n\n`;
    message += `<b>${name}</b>\n\n`;
    if (description) message += `📝 ${description}\n\n`;
    if (dateText) message += `${dateText}\n\n`;
    message += `Приготовьтесь делать прогнозы! 🎯\n\n`;
    message += `🔗 <a href="https://${SERVER_IP}">Открыть сайт</a>`;

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn("⚠️ TELEGRAM_BOT_TOKEN не настроен");
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        const notifSettings = db.prepare(`
          SELECT tournament_announcements 
          FROM user_notification_settings 
          WHERE user_id = ?
        `).get(user.id);

        if (notifSettings && notifSettings.tournament_announcements === 0) {
          console.log(`⏭️ Пропускаем пользователя ${user.username} - объявления о турнирах выключены`);
          continue;
        }

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

        const response = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: user.telegram_id, text: message, parse_mode: "HTML", reply_markup: replyMarkup }),
          }
        );

        const result = await response.json();

        if (!result.ok) {
          console.error(`⚠️ Telegram API ошибка для ${user.username}:`, result);
          errorCount++;
        } else {
          successCount++;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`⚠️ Не удалось отправить объявление пользователю ${user.username}:`, error.message);
        errorCount++;
      }
    }

    console.log(`✅ Объявление о турнире "${name}" отправлено: ${successCount} успешно, ${errorCount} ошибок`);
  } catch (error) {
    console.error("❌ Ошибка при отправке объявления пользователям:", error);
    throw error;
  }
}

// Отправка объявления о турнире в группу
async function notifyTournamentToGroup(eventId, name, description, startDate, endDate) {
  try {
    console.log(`📢 Отправка объявления о турнире "${name}" в группу...`);

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const THREAD_ID = process.env.THREAD_ID;

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn("⚠️ TELEGRAM_BOT_TOKEN не настроен");
      return;
    }

    if (!TELEGRAM_CHAT_ID) {
      console.warn("⚠️ TELEGRAM_CHAT_ID не настроен");
      return;
    }

    let dateText = '';
    if (startDate && endDate) {
      const start = new Date(startDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
      const end = new Date(endDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
      dateText = `📅 Даты: ${start} - ${end}`;
    } else if (startDate) {
      const start = new Date(startDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
      dateText = `📅 Начало: ${start}`;
    }

    let message = `🏆 <b>НОВЫЙ ТУРНИР!</b>\n\n`;
    message += `<b>${name}</b>\n\n`;
    if (description) message += `📝 ${description}\n\n`;
    if (dateText) message += `${dateText}\n\n`;
    message += `Приготовьтесь делать прогнозы! 🎯\n\n`;
    message += `🔗 <a href="https://${SERVER_IP}">Открыть сайт</a>`;

    const requestBody = {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML",
    };

    if (THREAD_ID) {
      requestBody.message_thread_id = parseInt(THREAD_ID);
    }

    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );

    const result = await response.json();

    if (result.ok) {
      console.log(`✅ Объявление о турнире "${name}" отправлено в группу`);
    } else {
      console.error(`❌ Ошибка отправки в группу:`, result);
    }
  } catch (error) {
    console.error("❌ Ошибка при отправке объявления в группу:", error);
    throw error;
  }
}

// Проверка и отправка уведомлений о начале матча
async function checkAndNotifyMatchStart() {
  try {
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

    console.log(`⚽ checkAndNotifyMatchStart: Ищем матчи от ${thirtyMinutesAgo.toISOString()} до ${now.toISOString()}`);

    const recentlyStartedMatches = db
      .prepare(
        `
      SELECT DISTINCT m.id, m.team1_name, m.team2_name, m.match_date, e.name as event_name
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.match_date > ? AND m.match_date <= ? AND m.winner IS NULL AND m.match_date IS NOT NULL
      ORDER BY m.match_date ASC
    `
      )
      .all(thirtyMinutesAgo.toISOString(), now.toISOString());

    console.log(`⚽ Найдено ${recentlyStartedMatches.length} матчей которые начались недавно`);

    if (recentlyStartedMatches.length === 0) return;

    const matchesByTime = {};
    for (const match of recentlyStartedMatches) {
      const existingNotification = db
        .prepare("SELECT id FROM sent_reminders WHERE match_id = ?")
        .get(match.id);

      if (existingNotification) {
        console.log(`⚽ Уведомление для матча ${match.id} уже было отправлено`);
        continue;
      }

      const timeKey = match.match_date;
      if (!matchesByTime[timeKey]) {
        matchesByTime[timeKey] = [];
      }
      matchesByTime[timeKey].push(match);
    }

    for (const [timeKey, matches] of Object.entries(matchesByTime)) {
      const matchDateTime = new Date(matches[0].match_date);
      const matchDate = matchDateTime.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
      const matchTime = matchDateTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

      let matchesText = "";
      matches.forEach((match, index) => {
        matchesText += `${index + 1}. <b>${match.team1_name}</b> vs <b>${match.team2_name}</b> (${match.event_name})\n`;
      });

      const matchCount = matches.length;
      const matchWord =
        matchCount === 1 ? "МАТЧ" :
        matchCount === 2 || matchCount === 3 || matchCount === 4 ? "МАТЧА" : "МАТЧЕЙ";

      const message = `⚽ <b>${matchCount} ${matchWord} НАЧАЛСЯ${matchCount === 1 ? "" : "О"}!</b>

${matchesText}
🕐 Время: ${matchDate} ${matchTime}

⛔ Ставить больше нельзя!

🔗 <a href="http://${SERVER_IP}:${PORT}">Открыть результаты</a>`;

      await sendGroupNotification(message);

      for (const match of matches) {
        db.prepare("INSERT INTO sent_reminders (match_id) VALUES (?)").run(match.id);
      }

      console.log(
        `✅ Уведомление о начале ${matchCount} матча(ей) отправлено: ${matches.map((m) => `${m.team1_name} vs ${m.team2_name}`).join(", ")}`
      );
    }
  } catch (error) {
    console.error("❌ Ошибка при проверке начала матчей:", error);
  }
}

// Проверка и уведомление о начале турниров (предстоящий → активный)
async function checkAndNotifyTournamentStart() {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

    // Ищем турниры со статусом active, у которых start_date наступила недавно (в пределах 2 дней)
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = twoDaysAgo.toISOString().split('T')[0];

    const events = db.prepare(`
      SELECT id, name, description, start_date, end_date
      FROM events
      WHERE status = 'active'
        AND start_date IS NOT NULL
        AND start_date <= ?
        AND start_date >= ?
    `).all(todayStr, twoDaysAgoStr);

    if (events.length === 0) return;

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const THREAD_ID = process.env.THREAD_ID;

    if (!TELEGRAM_BOT_TOKEN) return;

    for (const event of events) {
      // Проверяем, не отправляли ли уже уведомление
      const alreadyNotified = db.prepare(
        "SELECT value FROM system_settings WHERE key = ?"
      ).get(`tournament_started_${event.id}`);

      if (alreadyNotified) continue;

      console.log(`🚀 Турнир "${event.name}" начался! Отправляем уведомления...`);

      // Формируем текст даты
      let dateText = '';
      if (event.start_date && event.end_date) {
        const start = new Date(event.start_date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
        const end = new Date(event.end_date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
        dateText = `📅 ${start} - ${end}`;
      } else if (event.start_date) {
        const start = new Date(event.start_date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
        dateText = `📅 Начало: ${start}`;
      }

      // Сообщение в личку
      let personalMessage = `🚀 <b>ТУРНИР НАЧАЛСЯ!</b>\n\n`;
      personalMessage += `🏆 <b>${event.name}</b>\n\n`;
      if (event.description) personalMessage += `${event.description}\n\n`;
      if (dateText) personalMessage += `${dateText}\n\n`;
      personalMessage += `Время делать прогнозы! Заходи и ставь 🎯\n\n`;
      personalMessage += `🔗 <a href="https://${SERVER_IP}">Открыть сайт</a>`;

      // Сообщение в группу (THREAD_ID)
      let groupMessage = `🚀 <b>ТУРНИР НАЧАЛСЯ!</b>\n\n`;
      groupMessage += `🏆 <b>${event.name}</b>\n\n`;
      if (event.description) groupMessage += `${event.description}\n\n`;
      if (dateText) groupMessage += `${dateText}\n\n`;
      groupMessage += `Все на сайт — делаем прогнозы! ⚽🔥\n\n`;
      groupMessage += `🔗 <a href="https://${SERVER_IP}">Открыть сайт</a>`;

      // Отправляем в личку всем пользователям
      const users = db.prepare(
        `SELECT id, username, telegram_id FROM users WHERE telegram_id IS NOT NULL`
      ).all();

      let successCount = 0;
      let errorCount = 0;

      for (const user of users) {
        try {
          // Проверяем настройку уведомлений
          const notifSettings = db.prepare(`
            SELECT tournament_announcements 
            FROM user_notification_settings 
            WHERE user_id = ?
          `).get(user.id);

          if (notifSettings && notifSettings.tournament_announcements === 0) {
            continue;
          }

          const response = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: user.telegram_id,
                text: personalMessage,
                parse_mode: "HTML",
              }),
            }
          );

          const result = await response.json();
          if (result.ok) {
            successCount++;
          } else {
            errorCount++;
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          errorCount++;
        }
      }

      console.log(`📨 Личные уведомления о старте "${event.name}": ${successCount} успешно, ${errorCount} ошибок`);

      // Отправляем в THREAD_ID группы
      if (TELEGRAM_CHAT_ID) {
        try {
          const requestBody = {
            chat_id: TELEGRAM_CHAT_ID,
            text: groupMessage,
            parse_mode: "HTML",
          };

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

          console.log(`📨 Уведомление о старте "${event.name}" отправлено в группу`);
        } catch (error) {
          console.error(`❌ Ошибка отправки в группу:`, error.message);
        }
      }

      // Помечаем что уведомление отправлено
      db.prepare(
        "INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)"
      ).run(`tournament_started_${event.id}`, 'true');

      console.log(`✅ Турнир "${event.name}" помечен как уведомлённый о старте`);
    }
  } catch (error) {
    console.error("❌ Ошибка при проверке старта турниров:", error);
  }
}

export {
  notifyAdmin,
  notifyUser,
  notifyModeratorAction,
  checkAndRemindNonVoters,
  checkAndNotifyUpcomingMatches,
  checkAndSendPersonalReminders,
  checkAndNotifyMatchStart,
  sendTournamentAnnouncementToUsers,
  notifyTournamentToGroup,
  checkAndNotifyTournamentStart,
};
