import { sendGroupNotification, sendAdminNotification, sendUserMessage, buildSiteButtons } from "../../OnexBetLineBoombot.js";
import { db } from "../database/db.js";
import { PORT, SERVER_IP, SITE_URL } from "../config.js";
import { getGroupMembership, buildUserMention, buildPlainUserName } from "./telegramService.js";

// Кнопки сайта для ЛС (JWT 3 часа); без userId — обычный URL без токена
function siteKeyboard(siteUserId, telegramId) {
  return { reply_markup: { inline_keyboard: buildSiteButtons(siteUserId, telegramId) } };
}

// Гостевые кнопки для групповых сообщений (без JWT)
// web_app-кнопки Telegram не принимает в группах (BUTTON_TYPE_INVALID) — только URL
function siteKeyboardGuest() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🌐 Сайт", url: SITE_URL },
        ],
      ],
    },
  };
}

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
        .prepare(`SELECT match_id FROM sent_reminders WHERE kind = 'group_vote' AND match_id IN (${matchIds.join(',')})`)
        .all();

      if (existingReminders.length > 0) {
        console.log(`⏰ Напоминание уже было отправлено для группы матчей`);
        continue;
      }

      const allUsers = db
        .prepare("SELECT id, username, telegram_username, telegram_id, telegram_group_reminders_enabled FROM users WHERE telegram_id IS NOT NULL")
        .all();

      console.log(`⏰ Всего пользователей с Telegram: ${allUsers.length}`);

      if (allUsers.length === 0) {
        console.log(`⏰ ⚠️ НЕТ ПОЛЬЗОВАТЕЛЕЙ С TELEGRAM!`);
        continue;
      }

      // Напоминаем только тем, кто уже играет в этот турнир (есть хотя бы одна ставка в event)
      const hasAnyBetInEvent = (userId) => {
        const row = db.prepare(`
          SELECT COUNT(*) as count
          FROM bets b
          JOIN matches m ON b.match_id = m.id
          WHERE b.user_id = ? AND m.event_id = ?
        `).get(userId, group.event_id);
        return row && row.count > 0;
      };

      const usersWithAllBets = allUsers.filter(user => {
        const userBets = db
          .prepare(`SELECT DISTINCT match_id FROM bets WHERE user_id = ? AND match_id IN (${matchIds.join(',')})`)
          .all(user.id)
          .map(row => row.match_id);
        return userBets.length === matches.length;
      });

      const nonVotersRaw = allUsers.filter(
        (user) => !usersWithAllBets.some(u => u.id === user.id) && hasAnyBetInEvent(user.id)
      );

      const nonVoters = [];
      for (const user of nonVotersRaw) {
        if (user.telegram_id) {
          const { inGroup, user: tgUser } = await getGroupMembership(user.telegram_id);
          if (inGroup) {
            nonVoters.push({ ...user, tgUser });
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

        // Тумблер "Напоминания в группе" управляет только пингом: ВКЛ — @вася, ВЫКЛ — просто вася
        const mentions = nonVoters
          .map((user) =>
            user.telegram_group_reminders_enabled === 0
              ? buildPlainUserName(user.tgUser, user.telegram_username || user.username)
              : buildUserMention(user.telegram_id, user.tgUser, user.telegram_username || user.username)
          )
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

🔗 <a href="${SITE_URL}">Открыть сайт</a>`;

        console.log(`⏰ Отправляем напоминание в группу для ${matches.length} матчей`);
        console.log(`📝 Сообщение: ${message.substring(0, 150)}...`);

        const sentOk = await sendGroupNotification(message, siteKeyboardGuest());
        if (sentOk) {
          try {
            const stmt = db.prepare("INSERT INTO sent_reminders (match_id, kind) VALUES (?, 'group_vote')");
            matches.forEach(match => { stmt.run(match.id); });
            console.log(`📢 Записи в БД добавлены для ${matches.length} матчей`);
          } catch (err) {
            console.error(`❌ ОШИБКА при добавлении в БД: ${err.message}`);
          }
        } else {
          console.warn(`⚠️ group_vote не отправлено — дедуп не записан, повторим в следующем цикле`);
        }
      } else {
        console.log(`⏰ Нет непроголосовавших (все поставили, либо никто ещё не играл в этом турнире)`);
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

      const placeholders = matchIds.map(() => "?").join(",");
      let sentCount = 0;
      let failedCount = 0;

      for (const user of usersWithNotifications) {
        if (user.only_active_tournaments === 1) {
          const hasBets = db.prepare(`
            SELECT COUNT(*) as count
            FROM bets b
            JOIN matches m ON b.match_id = m.id
            WHERE b.user_id = ? AND m.event_id = ?
          `).get(user.id, group.event_id);

          if (!hasBets || hasBets.count === 0) {
            console.log(`⏭️ Пропускаем пользователя ${user.username} - нет ставок в турнире ${group.event_name}`);
            continue;
          }
        }

        // Персональный дедуп: повтор цикла не заденет уже получивших
        const alreadySent = db
          .prepare(`SELECT id FROM sent_reminders WHERE kind = '3hour' AND user_id = ? AND match_id IN (${placeholders})`)
          .get(user.id, ...matchIds);
        if (alreadySent) continue;

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

🔗 <a href="${SITE_URL}">Открыть сайт</a>`;

        try {
          const delivered = await sendUserMessage(user.telegram_id, message, {
            parse_mode: "HTML",
            noReactionButtons: true,
            ...siteKeyboard(user.id, user.telegram_id),
          });
          if (!delivered) {
            failedCount++;
            console.warn(`⚠️ Уведомление за 3 часа не доставлено пользователю ${user.username} — дедуп не записан`);
            continue;
          }
          for (const matchId of matchIds) {
            db.prepare("INSERT INTO sent_reminders (match_id, user_id, kind) VALUES (?, ?, '3hour')").run(matchId, user.id);
          }
          sentCount++;
          console.log(`✅ Уведомление за 3 часа отправлено пользователю ${user.username} (${user.telegram_id})`);
        } catch (error) {
          failedCount++;
          console.error(`⚠️ Не удалось отправить уведомление пользователю ${user.username}:`, error);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Маркер группы — только когда все доставки прошли; иначе повтор недоставленным
      if (failedCount === 0) {
        const stmt = db.prepare("INSERT INTO sent_3hour_reminders (match_id) VALUES (?)");
        matches.forEach(match => { stmt.run(match.id); });
        console.log(`✅ Уведомления за 3 часа для ${matches.length} матчей отправлены (${sentCount})`);
      } else {
        console.warn(`⚠️ ${failedCount} уведомлений за 3 часа не доставлено — маркер группы не записан, повтор в следующем цикле`);
      }
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
      LEFT JOIN user_notification_settings uns ON er.user_id = uns.user_id
      WHERE u.telegram_id IS NOT NULL
        AND COALESCE(uns.match_reminders, 1) = 1
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
                body: JSON.stringify({
                  chat_id: reminder.telegram_id,
                  text: message,
                  parse_mode: "HTML",
                  reply_markup: siteKeyboard(reminder.user_id, reminder.telegram_id).reply_markup,
                }),
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
    message += `🔗 <a href="${SITE_URL}">Открыть сайт</a>`;

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

        const telegramEnabled = db.prepare(`
          SELECT telegram_notifications_enabled FROM users WHERE id = ?
        `).get(user.id);

        if (telegramEnabled && telegramEnabled.telegram_notifications_enabled === 0) {
          continue;
        }

        const siteRows = buildSiteButtons(user.id, user.telegram_id);
        const replyMarkup = {
          inline_keyboard: [
            ...siteRows,
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
    message += `🔗 <a href="${SITE_URL}">Открыть сайт</a>`;

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
      SELECT DISTINCT m.id, m.team1_name, m.team2_name, m.match_date, e.name as event_name, e.id as event_id
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.winner IS NULL AND m.match_date IS NOT NULL
      ORDER BY m.match_date ASC
      LIMIT 100
    `
      )
      .all()
      .filter((match) => {
        // Фильтруем в JS: SQL-сравнение строк ломается на смещении таймзоны (+03:00 / Z)
        const matchTime = new Date(match.match_date).getTime();
        return matchTime > thirtyMinutesAgo.getTime() && matchTime <= now.getTime();
      });

    console.log(`⚽ Найдено ${recentlyStartedMatches.length} матчей которые начались недавно`);

    if (recentlyStartedMatches.length === 0) return;

    const matchesByTime = {};
    for (const match of recentlyStartedMatches) {
      const existingNotification = db
        .prepare("SELECT id FROM sent_reminders WHERE kind = 'match_start' AND user_id IS NULL AND match_id = ?")
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

⛔ Ставить больше нельзя!`;

      // Личные уведомления в ЛС (мастер-тумблер + "Матч начался"); в группу не шлём
      const allDelivered = await sendMatchStartPersonalNotifications(matches, message, matchIdsOf(matches));

      // Маркер матча пишем только при полном успехе — иначе в следующем цикле повторим недоставленным
      if (allDelivered) {
        for (const match of matches) {
          db.prepare("INSERT INTO sent_reminders (match_id, kind) VALUES (?, 'match_start')").run(match.id);
        }
        console.log(
          `✅ Уведомление о начале ${matchCount} матча(ей) обработано: ${matches.map((m) => `${m.team1_name} vs ${m.team2_name}`).join(", ")}`
        );
      } else {
        console.warn(
          `⚠️ Часть личных уведомлений "Матч начался" не доставлена — маркер матча не записан, повтор в следующем цикле`
        );
      }
    }
  } catch (error) {
    console.error("❌ Ошибка при проверке начала матчей:", error);
  }
}

function matchIdsOf(matches) {
  return matches.map((m) => m.id);
}

// Есть ли у пользователя хотя бы одна ставка в одном из турниров этих матчей
function hasBetInAnyEvent(userId, matches) {
  const eventIds = [...new Set(matches.map((m) => m.event_id).filter(Boolean))];
  if (eventIds.length === 0) return false;

  const placeholders = eventIds.map(() => "?").join(",");
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM bets b
    JOIN matches m ON b.match_id = m.id
    WHERE b.user_id = ? AND m.event_id IN (${placeholders})
  `).get(userId, ...eventIds);
  return row && row.count > 0;
}

// true — все нужные доставки прошли (или получателей нет), false — кто-то не получил и нужен повтор
async function sendMatchStartPersonalNotifications(matches, groupMessage, matchIds) {
  try {
    const users = db
      .prepare(
        `
      SELECT u.id, u.telegram_id
      FROM users u
      LEFT JOIN user_notification_settings uns ON u.id = uns.user_id
      WHERE u.telegram_notifications_enabled = 1
        AND u.telegram_id IS NOT NULL
        AND COALESCE(uns.match_start_notifications, 1) = 1
    `
      )
      .all();

    if (users.length === 0) return true;

    const personalMessage = `${groupMessage}

<i>Отключить можно в настройках сайта → «Получение личных сообщений в ТГ»</i>`;

    const placeholders = matchIds.map(() => "?").join(",");
    let sentCount = 0;
    let failedCount = 0;

    for (const user of users) {
      // Не спамим тем, кто ни разу не ставил в этом турнире
      if (!hasBetInAnyEvent(user.id, matches)) continue;

      const alreadySent = db
        .prepare(
          `SELECT id FROM sent_reminders WHERE kind = 'match_start' AND user_id = ? AND match_id IN (${placeholders})`
        )
        .get(user.id, ...matchIds);

      if (alreadySent) continue;

      try {
        const delivered = await sendUserMessage(user.telegram_id, personalMessage, {
          parse_mode: "HTML",
          ...siteKeyboard(user.id, user.telegram_id),
        });
        if (!delivered) {
          console.warn(`⚠️ "Матч начался" не доставлен пользователю ${user.id} — дедуп не записан`);
          failedCount++;
          continue;
        }
        for (const matchId of matchIds) {
          db.prepare(
            "INSERT INTO sent_reminders (match_id, user_id, kind) VALUES (?, ?, 'match_start')"
          ).run(matchId, user.id);
        }
        sentCount++;
      } catch (error) {
        failedCount++;
        console.error(`⚠️ Не удалось отправить "Матч начался" пользователю ${user.id}:`, error.message);
      }
    }

    if (sentCount > 0) {
      console.log(`✅ Личные уведомления "Матч начался" отправлены: ${sentCount}`);
    }
    return failedCount === 0;
  } catch (error) {
    console.error("❌ Ошибка при отправке личных уведомлений о начале матча:", error);
    return false;
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
      personalMessage += `🔗 <a href="${SITE_URL}">Открыть сайт</a>`;

      // Сообщение в группу (THREAD_ID)
      let groupMessage = `🚀 <b>ТУРНИР НАЧАЛСЯ!</b>\n\n`;
      groupMessage += `🏆 <b>${event.name}</b>\n\n`;
      if (event.description) groupMessage += `${event.description}\n\n`;
      if (dateText) groupMessage += `${dateText}\n\n`;
      groupMessage += `Все на сайт — делаем прогнозы! ⚽🔥\n\n`;
      groupMessage += `🔗 <a href="${SITE_URL}">Открыть сайт</a>`;

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

// Уведомление пользователям о создании новых туров
async function notifyNewRoundsToUsers(eventId, eventName, roundNames, totalMatches, nearestMatch) {
  try {
    console.log(`📢 Отправка уведомления о новых турах в "${eventName}" пользователям...`);

    const users = db
      .prepare(`SELECT id, username, telegram_id FROM users WHERE telegram_id IS NOT NULL`)
      .all();

    if (users.length === 0) return;

    let message = `⚽ <b>Новые туры в турнире "${eventName}"</b>\n\n`;
    message += `📌 Туры: ${roundNames.join(', ')}\n\n`;
    message += `🎯 ${totalMatches} матчей добавлено\n\n`;

    if (nearestMatch) {
      const date = new Date(nearestMatch.match_date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
      message += `📅 Ближайший матч: ${date}\n`;
      message += `   ${nearestMatch.team1_name} vs ${nearestMatch.team2_name} (${nearestMatch.round || '—'})\n\n`;
    }

    message += `🔗 <a href="${SITE_URL}">Открыть сайт</a>\n\n`;
    message += `💡 Эти уведомления можно отключить в настройках на сайте`;

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!TELEGRAM_BOT_TOKEN) return;

    let successCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        const notifSettings = db.prepare(`
          SELECT new_rounds FROM user_notification_settings WHERE user_id = ?
        `).get(user.id);

        if (notifSettings && notifSettings.new_rounds === 0) continue;

        const telegramEnabled = db.prepare(`
          SELECT telegram_notifications_enabled FROM users WHERE id = ?
        `).get(user.id);

        if (telegramEnabled && telegramEnabled.telegram_notifications_enabled === 0) continue;

        // Кнопки сайта; реакции добавит sendUserMessage
        await sendUserMessage(user.telegram_id, message, {
          parse_mode: "HTML",
          ...siteKeyboard(user.id, user.telegram_id),
        });
        successCount++;
      } catch (error) {
        errorCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✅ Уведомление о турах "${eventName}" отправлено: ${successCount} успешно, ${errorCount} ошибок`);
  } catch (error) {
    console.error("❌ Ошибка при отправке уведомления о турах:", error);
  }
}

// Уведомление в группу о создании новых туров
async function notifyNewRoundsToGroup(eventName, roundNames, totalMatches, nearestMatch) {
  try {
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    if (!TELEGRAM_CHAT_ID) return;

    let message = `⚽ <b>Новые туры в турнире "${eventName}"</b>\n\n`;
    message += `📌 Туры: ${roundNames.join(', ')}\n\n`;
    message += `🎯 ${totalMatches} матчей добавлено\n\n`;

    if (nearestMatch) {
      const date = new Date(nearestMatch.match_date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
      message += `📅 Ближайший матч: ${date}\n`;
      message += `   ${nearestMatch.team1_name} vs ${nearestMatch.team2_name} (${nearestMatch.round || '—'})\n\n`;
    }

    message += `🔗 <a href="${SITE_URL}">Открыть сайт</a>`;

    await sendGroupNotification(message);
    console.log(`✅ Уведомление о турах "${eventName}" отправлено в группу`);
  } catch (error) {
    console.error("❌ Ошибка при отправке уведомления о турах в группу:", error);
  }
}

// Личные уведомления о результате матча тем, кто на него ставил
// Включается настройкой "Результат каждого матча" + мастер-тумблером ЛС
async function notifyMatchResultToBettors(matchId) {
  try {
    const match = db.prepare(`
      SELECT m.id, m.team1_name, m.team2_name, m.winner, m.team1_score, m.team2_score, m.event_id, m.is_final, e.name as event_name
      FROM matches m
      JOIN events e ON m.event_id = e.id
      WHERE m.id = ?
    `).get(matchId);

    if (!match || !match.winner) return;

    const resultText =
      match.winner === 'draw' ? 'Ничья' :
      match.winner === 'team1' ? match.team1_name :
      match.winner === 'team2' ? match.team2_name : match.winner;

    const scoreText =
      match.team1_score != null && match.team2_score != null
        ? `\n⚽ Счёт: <b>${match.team1_score}:${match.team2_score}</b>`
        : '';

    const matchRow = db.prepare(`
      SELECT score_prediction_enabled, yellow_cards_prediction_enabled, red_cards_prediction_enabled,
             yellow_cards, red_cards
      FROM matches WHERE id = ?
    `).get(matchId);

    const finalParams = db.prepare(`
      SELECT * FROM final_parameters_results WHERE match_id = ?
    `).get(matchId);

    // Финал: шлём ОДНО полное сообщение после того, как админ записал исход и параметры.
    // Пока параметров нет — не резаем на "сначала исход, потом параметры".
    if (match.is_final && !finalParams) {
      return;
    }

    const bettors = db.prepare(`
      SELECT DISTINCT u.id, u.telegram_id
      FROM users u
      LEFT JOIN user_notification_settings uns ON u.id = uns.user_id
      WHERE u.telegram_notifications_enabled = 1
        AND u.telegram_id IS NOT NULL
        AND COALESCE(uns.per_match_results, 1) = 1
        AND (
          EXISTS (SELECT 1 FROM bets b WHERE b.user_id = u.id AND b.match_id = ?)
          OR EXISTS (SELECT 1 FROM score_predictions sp WHERE sp.user_id = u.id AND sp.match_id = ?)
          OR EXISTS (SELECT 1 FROM cards_predictions cp WHERE cp.user_id = u.id AND cp.match_id = ?)
        )
    `).all(matchId, matchId, matchId);

    if (bettors.length === 0) return;

    const paramNames = {
      yellow_cards: '🟨 Жёлтые',
      red_cards: '🟥 Красные',
      corners: '🚩 Угловые',
      exact_score: '🎯 Точный счёт',
      penalties_in_game: '⚽ Пенальти',
      extra_time: '⏱ Доп. время',
      penalties_at_end: '🥅 Серия пенальти',
      goal_difference: '⚖️ Разница голов',
    };

    let sentCount = 0;

    for (const bettor of bettors) {
      // Резервируем дедуп ДО отправки: два параллельных notify (auto-count + live)
      // иначе проходят SELECT и шлют дубль
      const claim = db.prepare(`
        INSERT OR IGNORE INTO sent_reminders (match_id, user_id, kind)
        VALUES (?, ?, 'match_result')
      `).run(matchId, bettor.id);
      if (claim.changes === 0) continue;

      const lines = [];
      let anyWin = false;
      let anyBet = false;
      let extrasMatchedNotCounted = false;

      // 1. Исход — от него зависят очки за счёт и карточки (как в подсчёте)
      const outcomeBet = db.prepare(`
        SELECT prediction FROM bets
        WHERE user_id = ? AND match_id = ? AND (is_final_bet = 0 OR is_final_bet IS NULL)
      `).get(bettor.id, matchId);

      let outcomeWon = false;
      if (outcomeBet) {
        anyBet = true;
        outcomeWon =
          (outcomeBet.prediction === 'team1' && match.winner === 'team1') ||
          (outcomeBet.prediction === 'team2' && match.winner === 'team2') ||
          (outcomeBet.prediction === 'draw' && match.winner === 'draw') ||
          (outcomeBet.prediction === match.team1_name && match.winner === 'team1') ||
          (outcomeBet.prediction === match.team2_name && match.winner === 'team2');
        if (outcomeWon) anyWin = true;

        const predictionText =
          outcomeBet.prediction === 'team1' ? match.team1_name :
          outcomeBet.prediction === 'team2' ? match.team2_name :
          outcomeBet.prediction === 'draw' ? 'Ничья' : outcomeBet.prediction;

        lines.push(`${outcomeWon ? '✅' : '❌'} Исход: <b>${predictionText}</b>`);
      }

      // 2. Точный счёт — очко только при угаданном исходе
      if (matchRow?.score_prediction_enabled === 1) {
        const sp = db.prepare(`
          SELECT score_team1, score_team2 FROM score_predictions WHERE user_id = ? AND match_id = ?
        `).get(bettor.id, matchId);
        if (sp) {
          anyBet = true;
          const scoreMatched =
            match.team1_score != null && match.team2_score != null &&
            sp.score_team1 === match.team1_score && sp.score_team2 === match.team2_score;
          const isWon = outcomeWon && scoreMatched;
          if (isWon) anyWin = true;
          else if (scoreMatched) extrasMatchedNotCounted = true;
          // ✅ — цифра угадана (даже если не засчитана, об этом ниже)
          lines.push(`${scoreMatched ? '✅' : '❌'} Счёт: <b>${sp.score_team1}:${sp.score_team2}</b>`);
        }
      }

      // 3. Карточки — очки только при угаданном исходе
      if (matchRow?.yellow_cards_prediction_enabled === 1 || matchRow?.red_cards_prediction_enabled === 1) {
        const cp = db.prepare(`
          SELECT yellow_cards, red_cards FROM cards_predictions WHERE user_id = ? AND match_id = ?
        `).get(bettor.id, matchId);
        if (cp) {
          const parts = [];
          if (matchRow.yellow_cards_prediction_enabled === 1 && cp.yellow_cards != null) {
            anyBet = true;
            const matched = matchRow.yellow_cards != null && cp.yellow_cards === matchRow.yellow_cards;
            const isWon = outcomeWon && matched;
            if (isWon) anyWin = true;
            else if (matched) extrasMatchedNotCounted = true;
            parts.push(`${matched ? '✅' : '❌'} 🟨 <b>${cp.yellow_cards}</b>`);
          }
          if (matchRow.red_cards_prediction_enabled === 1 && cp.red_cards != null) {
            anyBet = true;
            const matched = matchRow.red_cards != null && cp.red_cards === matchRow.red_cards;
            const isWon = outcomeWon && matched;
            if (isWon) anyWin = true;
            else if (matched) extrasMatchedNotCounted = true;
            parts.push(`${matched ? '✅' : '❌'} 🟥 <b>${cp.red_cards}</b>`);
          }
          if (parts.length > 0) lines.push(`Карточки: ${parts.join('  ')}`);
        }
      }

      // 4. Финальные параметры
      const finalBets = db.prepare(`
        SELECT parameter_type, prediction FROM bets
        WHERE user_id = ? AND match_id = ? AND is_final_bet = 1
      `).all(bettor.id, matchId);

      // Ждём итоги финальных параметров только если кроме них ставок нет.
      // Иначе шлём сразу (исход/счёт/карточки), чтобы не ждать конец дня.
      if (finalBets.length > 0 && !finalParams && lines.length === 0) {
        continue;
      }

      for (const fb of finalBets) {
        if (!finalParams) continue;
        anyBet = true;
        let actual;
        if (fb.parameter_type === 'goal_difference') {
          actual = finalParams.goal_difference;
        } else {
          actual = finalParams[fb.parameter_type];
        }
        const isWon = actual != null && String(fb.prediction) === String(actual);
        if (isWon) anyWin = true;
        const label = paramNames[fb.parameter_type] || fb.parameter_type;
        lines.push(`${isWon ? '✅' : '❌'} ${label}: <b>${fb.prediction}</b>`);
      }

      if (!anyBet) continue;

      const extrasNote = extrasMatchedNotCounted
        ? '\nℹ️ Доп. прогнозы угаданы, но не засчитаны — нужен угаданный исход'
        : '';

      const message = `${anyWin ? '✅' : '❌'} <b>Результат матча</b>

🏆 Турнир: ${match.event_name}
⚽ <b>${match.team1_name}</b> vs <b>${match.team2_name}</b>
🏁 Итог: <b>${resultText}</b>${scoreText}

🎯 <b>Ваши прогнозы:</b>
${lines.join('\n')}${extrasNote}
${anyWin ? '\n🎉 Поздравляем! Есть угаданные прогнозы!' : '\n😔 К сожалению, текущий прогноз не сбылся'}

<i>Отключить можно в настройках сайта → «Получение личных сообщений в ТГ» → «Еще» → «Результат каждого матча»</i>`;

      try {
        await sendUserMessage(bettor.telegram_id, message, {
          parse_mode: "HTML",
          ...siteKeyboard(bettor.id, bettor.telegram_id),
        });
        sentCount++;
      } catch (error) {
        // Отправка не удалась — снимаем дедуп, чтобы можно было повторить
        db.prepare(
          `DELETE FROM sent_reminders WHERE kind = 'match_result' AND user_id = ? AND match_id = ?`
        ).run(bettor.id, matchId);
        console.error(`⚠️ Не удалось отправить результат матча пользователю ${bettor.id}:`, error.message);
      }
    }

    if (sentCount > 0) {
      console.log(`✅ Личные уведомления о результате матча ${matchId} отправлены: ${sentCount}`);
    }
  } catch (error) {
    console.error("❌ Ошибка при отправке результатов матча:", error);
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
  notifyNewRoundsToUsers,
  notifyNewRoundsToGroup,
  notifyMatchResultToBettors,
};
