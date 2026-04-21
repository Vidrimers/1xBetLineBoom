/**
 * Модуль для формирования полного контекста из БД для AI
 * Используется как в веб-чате, так и в Telegram боте
 */

import { db } from '../database/db.js';
import { getTournamentParticipantsWithPoints } from './tournamentData.js';

/**
 * Получает ставки пользователя с учетом настройки show_bets
 * @param {number} userId - ID пользователя чьи ставки смотрим
 * @param {number} viewerUserId - ID пользователя который смотрит (null = AI)
 * @param {number} eventId - ID турнира
 */
function getUserBets(userId, viewerUserId, eventId) {
  const userSettings = db.prepare('SELECT show_bets, username FROM users WHERE id = ?').get(userId);
  if (!userSettings) return null;

  const showBets = userSettings.show_bets || 'always';
  const isOwner = viewerUserId === userId;

  const bets = db.prepare(`
    SELECT 
      b.id,
      m.team1_name as team1,
      m.team2_name as team2,
      m.winner,
      m.status as match_status,
      m.match_date,
      m.round,
      m.is_final,
      CASE 
        WHEN b.prediction = 'team1' THEN m.team1_name
        WHEN b.prediction = 'team2' THEN m.team2_name
        WHEN b.prediction = 'draw' THEN 'Ничья'
        ELSE b.prediction
      END as prediction_display,
      CASE 
        WHEN m.winner IS NULL THEN 'pending'
        WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
             (b.prediction = 'team2' AND m.winner = 'team2') OR
             (b.prediction = 'draw' AND m.winner = 'draw') OR
             (b.prediction = m.team1_name AND m.winner = 'team1') OR
             (b.prediction = m.team2_name AND m.winner = 'team2') THEN 'won'
        ELSE 'lost'
      END as result
    FROM bets b
    JOIN matches m ON b.match_id = m.id
    WHERE m.event_id = ? AND b.user_id = ? AND b.is_final_bet = 0
    ORDER BY m.match_date ASC
  `).all(eventId, userId);

  // Применяем фильтр show_bets
  if (showBets === 'after_start' && !isOwner) {
    const now = new Date();
    return bets.map(bet => {
      if (!bet.match_date) return { ...bet, hidden: true };
      const matchDate = new Date(bet.match_date);
      return matchDate > now ? { ...bet, hidden: true } : { ...bet, hidden: false };
    });
  }

  return bets.map(bet => ({ ...bet, hidden: false }));
}

/**
 * Форматирует ставки компактно: последний завершённый тур + текущий незавершённый.
 * Это позволяет уложиться в лимит токенов ИИ и не обрезать ответ.
 */
function formatBetsCompact(bets, label) {
  // Разбиваем на завершённые и незавершённые
  const finished = bets.filter(b => !b.hidden && b.result !== 'pending');
  const pending  = bets.filter(b => !b.hidden && b.result === 'pending');
  const hidden   = bets.filter(b => b.hidden);

  const lines = [];

  // Последний завершённый тур
  if (finished.length > 0) {
    const rounds = [...new Set(finished.map(b => b.round))].sort((a, b) => b - a);
    const lastRound = rounds[0];
    const lastRoundBets = finished.filter(b => b.round === lastRound);
    const won = lastRoundBets.filter(b => b.result === 'won').length;
    const total = lastRoundBets.length;
    const matchLines = lastRoundBets.map(b => {
      const r = b.result === 'won' ? '✅' : '❌';
      return `${b.team1}-${b.team2}:${b.prediction_display}${r}`;
    }).join(', ');
    lines.push(`Тур${lastRound}(${won}/${total}): ${matchLines}`);
  }

  // Текущий незавершённый тур (только количество, без деталей — экономим токены)
  if (pending.length > 0) {
    const rounds = [...new Set(pending.map(b => b.round))];
    lines.push(`Ожидают результата: ${pending.length} ставок (туры: ${rounds.join(',')})`);
  }

  if (hidden.length > 0) {
    lines.push(`Скрыто ставок: ${hidden.length}`);
  }

  if (lines.length === 0) return null;
  return `${label}:\n${lines.join('\n')}`;
}

// Карта аббревиатур турниров → ключевые слова для поиска в названии
const TOURNAMENT_ALIASES = {
  'лч': 'чемпионов',
  'лига чемпионов': 'чемпионов',
  'champions league': 'чемпионов',
  ' cl ': 'чемпионов',
  'лe': 'европы',
  'лига европы': 'европы',
  'europa league': 'европы',
  ' el ': 'европы',
  'лк': 'конференций',
  'лига конференций': 'конференций',
  'conference league': 'конференций',
  'рпл': 'премьер лига',
  'российская премьер': 'премьер лига',
  'апл': 'английская',
  'английская премьер': 'английская',
  'premier league': 'английская',
  'ла лига': 'ла лига',
  'la liga': 'ла лига',
  ' лм ': 'ла лига',
  'бундеслига': 'бундеслига',
  'bundesliga': 'бундеслига',
  ' бл ': 'бундеслига',
  'серия а': 'серия а',
  'serie a': 'серия а',
  ' са ': 'серия а',
  'лига 1': 'лига 1',
  'ligue 1': 'лига 1',
  ' л1 ': 'лига 1',
};

// Ключевые слова статистических запросов
const STATS_KEYWORDS = [
  'карточк', 'красн', 'жёлт', 'желт', 'угловы', 'пенальти', 'статистик',
  'red card', 'yellow card', 'corner',
];

/**
 * Определяет, является ли запрос статистическим
 */
function isStatsQuery(text) {
  const lower = text.toLowerCase();
  return STATS_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Определяет ID турнира по тексту запроса
 * @param {string} text - Текст сообщения
 * @param {Array} events - Список турниров из БД
 * @returns {number|null} ID турнира или null
 */
function detectTournamentFromText(text, events) {
  const lower = ` ${text.toLowerCase()} `;
  for (const [alias, keyword] of Object.entries(TOURNAMENT_ALIASES)) {
    if (lower.includes(alias)) {
      const found = events.find(e => e.name.toLowerCase().includes(keyword));
      if (found) return found.id;
    }
  }
  // Попробуем прямое совпадение с названием турнира
  for (const event of events) {
    if (lower.includes(event.name.toLowerCase())) return event.id;
  }
  return null;
}

/**
 * Получает матчи турнира
 */
function getMatches(eventId) {
  return db.prepare(`
    SELECT 
      m.id,
      m.team1_name as team1,
      m.team2_name as team2,
      m.winner,
      m.status,
      m.match_date,
      m.round,
      m.is_final,
      ms.score_team1,
      ms.score_team2,
      m.yellow_cards,
      m.red_cards
    FROM matches m
    LEFT JOIN match_scores ms ON m.id = ms.match_id
    WHERE m.event_id = ?
    ORDER BY m.match_date ASC
  `).all(eventId);
}

/**
 * Получает турнирную сетку
 */
function getBrackets(eventId) {
  const brackets = db.prepare(`
    SELECT id, name, start_date, is_locked
    FROM brackets
    WHERE event_id = ?
  `).all(eventId);

  return brackets.map(bracket => {
    const results = db.prepare(`
      SELECT stage, match_index, actual_winner
      FROM bracket_results
      WHERE bracket_id = ?
    `).all(bracket.id);

    return { ...bracket, results };
  });
}

/**
 * Получает прогнозы пользователя в турнирной сетке с учетом show_bets
 */
function getUserBracketPredictions(userId, eventId, viewerUserId) {
  const userSettings = db.prepare('SELECT show_bets, username FROM users WHERE id = ?').get(userId);
  if (!userSettings) return null;

  const showBets = userSettings.show_bets || 'always';
  const isOwner = viewerUserId === userId;

  const brackets = db.prepare('SELECT id, start_date, lock_dates FROM brackets WHERE event_id = ?').all(eventId);
  const result = [];

  for (const bracket of brackets) {
    const predictions = db.prepare(`
      SELECT bp.stage, bp.match_index, bp.predicted_winner
      FROM bracket_predictions bp
      WHERE bp.bracket_id = ? AND bp.user_id = ?
    `).all(bracket.id, userId);

    if (showBets === 'after_start' && !isOwner) {
      const now = new Date();
      let lockDates = {};
      try { lockDates = bracket.lock_dates ? JSON.parse(bracket.lock_dates) : {}; } catch (e) {}

      const visible = predictions.filter(pred => {
        const stageDate = lockDates[pred.stage];
        if (!stageDate) {
          return bracket.start_date ? new Date(bracket.start_date) <= now : true;
        }
        return new Date(stageDate) <= now;
      });

      if (visible.length === 0 && predictions.length > 0) {
        result.push({ bracketId: bracket.id, hidden: true, message: 'Прогнозы скрыты до начала стадий' });
      } else {
        result.push({ bracketId: bracket.id, hidden: false, predictions: visible });
      }
    } else {
      result.push({ bracketId: bracket.id, hidden: false, predictions });
    }
  }

  return result;
}

/**
 * Получает статистику профиля пользователя
 */
function getUserProfile(userId) {
  const user = db.prepare('SELECT id, username, avatar, created_at FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  const stats = db.prepare(`
    SELECT 
      COUNT(DISTINCT b.id) as total_bets,
      SUM(CASE 
        WHEN (m.winner IS NOT NULL OR fpr.id IS NOT NULL) AND (
          (b.is_final_bet = 0 AND (
            (b.prediction = 'team1' AND m.winner = 'team1') OR
            (b.prediction = 'team2' AND m.winner = 'team2') OR
            (b.prediction = 'draw' AND m.winner = 'draw') OR
            (b.prediction = m.team1_name AND m.winner = 'team1') OR
            (b.prediction = m.team2_name AND m.winner = 'team2')
          )) OR
          (b.is_final_bet = 1 AND (
            (b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards) OR
            (b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards) OR
            (b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners) OR
            (b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score)
          ))
        ) THEN 1 ELSE 0 
      END) as won_bets,
      COUNT(DISTINCT m.event_id) as tournaments_count
    FROM bets b
    LEFT JOIN matches m ON b.match_id = m.id
    LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
    WHERE b.user_id = ?
  `).get(userId);

  const awards = db.prepare(`
    SELECT COUNT(*) as count FROM tournament_awards WHERE user_id = ?
  `).get(userId);

  return {
    username: user.username,
    created_at: user.created_at,
    total_bets: stats?.total_bets || 0,
    won_bets: stats?.won_bets || 0,
    win_rate: stats?.total_bets > 0 ? Math.round((stats.won_bets / stats.total_bets) * 100) : 0,
    tournaments_count: stats?.tournaments_count || 0,
    awards_count: awards?.count || 0,
  };
}

/**
 * Получает последние новости
 */
function getLatestNews(limit = 10) {
  return db.prepare(`
    SELECT id, title, message, type, created_at
    FROM news
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Формирует контекст только для конкретного турнира
 */
function buildTournamentContext(telegramUsername, tournamentName) {
  const context = {};
  
  try {
    // Определяем пользователя
    let currentUser = null;
    if (telegramUsername) {
      currentUser = db.prepare('SELECT id, username, show_bets FROM users WHERE LOWER(telegram_username) = LOWER(?)').get(telegramUsername);
    }

    if (currentUser) {
      context.currentUser = `Пользователь: ${currentUser.username} (Telegram: @${telegramUsername})`;
    } else if (telegramUsername) {
      context.currentUser = `Пользователь: @${telegramUsername} (не привязан к аккаунту на сайте)`;
    }

    // Ищем турнир по названию
    const event = db.prepare(`
      SELECT id, name, status FROM events 
      WHERE LOWER(name) LIKE LOWER(?) 
      ORDER BY start_date DESC 
      LIMIT 1
    `).get(`%${tournamentName}%`);

    if (event) {
      const participants = getTournamentParticipantsWithPoints(event.id);
      if (participants && participants.length > 0) {
        context.tournament = `📊 ${event.name}:\n` +
          participants.slice(0, 10).map((p, i) => {
            const position = i + 1;
            const isCurrentUser = currentUser && p.username.toLowerCase() === currentUser.username.toLowerCase();
            const marker = isCurrentUser ? ' ⭐' : '';
            return `${position}. ${p.username}: ${p.event_won || 0} очков${marker}`;
          }).join('\n');
      }
    }
  } catch (error) {
    console.error('❌ Ошибка формирования контекста турнира:', error);
  }

  return context;
}
/**
 * Формирует полный контекст для AI
 * @param {string} telegramUsername - Telegram username пользователя (опционально)
 * @param {string} siteUsername - Username на сайте (опционально, для веб-чата)
 * @param {number} telegramId - Telegram ID пользователя (приоритетный способ поиска)
 */
export function buildFullAIContext(telegramUsername = null, siteUsername = null, telegramId = null, messageText = null) {
  const context = {};

  try {
    // Определяем пользователя
    let currentUser = null;
    if (siteUsername) {
      currentUser = db.prepare('SELECT id, username, show_bets FROM users WHERE LOWER(username) = LOWER(?)').get(siteUsername);
    } else if (telegramId) {
      // Приоритет: поиск по telegram_id (надёжнее, не зависит от смены ника)
      currentUser = db.prepare('SELECT id, username, show_bets FROM users WHERE telegram_id = ?').get(telegramId);
    } else if (telegramUsername) {
      // Fallback: поиск по telegram_username
      currentUser = db.prepare('SELECT id, username, show_bets FROM users WHERE LOWER(telegram_username) = LOWER(?)').get(telegramUsername);
    }

    if (currentUser) {
      context.currentUser = `Пользователь: ${currentUser.username}`;
      if (telegramUsername) context.currentUser += ` (Telegram: @${telegramUsername})`;
    } else if (telegramUsername) {
      context.currentUser = `Пользователь: @${telegramUsername} (не привязан к аккаунту на сайте)`;
    }

    // Все турниры
    const events = db.prepare(`
      SELECT id, name, status FROM events ORDER BY start_date DESC LIMIT 10
    `).all();

    if (events.length > 0) {
      context.events = events.map(e => `• ${e.name} (${e.status || 'активный'})`).join('\n');

      // Таблицы только активных турниров (топ-10 участников с подробной информацией)
      const allParticipants = [];
      const userPositions = []; // Явные позиции пользователя по турнирам
      const activeEvents = events.filter(e => e.status === 'active' || !e.status); // активные или без статуса
      for (const event of activeEvents) {
        try {
          const participants = getTournamentParticipantsWithPoints(event.id);
          if (participants && participants.length > 0) {
            // Находим позицию текущего пользователя если он есть
            let currentUserPosition = null;
            let currentUserPoints = null;
            if (currentUser) {
              const userIndex = participants.findIndex(p => p.username.toLowerCase() === currentUser.username.toLowerCase());
              if (userIndex !== -1) {
                currentUserPosition = userIndex + 1;
                currentUserPoints = participants[userIndex].event_won || 0;
                userPositions.push(`${event.name}: место ${currentUserPosition} из ${participants.length}, очков ${currentUserPoints}`);
              }
            }
            
            allParticipants.push(
              `📊 ${event.name}:\n` +
              participants.slice(0, 10).map((p, i) => {
                const position = i + 1;
                const isCurrentUser = currentUser && p.username.toLowerCase() === currentUser.username.toLowerCase();
                const marker = isCurrentUser ? ' ⭐' : '';
                return `${position}. ${p.username}: ${p.event_won || 0} очков${marker}`;
              }).join('\n')
            );
            
            // Добавляем информацию о позиции текущего пользователя если он не в топ-10
            if (currentUser && currentUserPosition && currentUserPosition > 10) {
              allParticipants[allParticipants.length - 1] += `\n...\n${currentUserPosition}. ${currentUser.username}: ${currentUserPoints} очков ⭐`;
            }
          }
        } catch (e) {}
      }
      
      // Сохраняем явные позиции пользователя в контекст
      if (userPositions.length > 0) {
        context.userPositions = userPositions.join('\n');
      }
      if (allParticipants.length > 0) {
        context.participants = allParticipants.join('\n');
      }

      // Матчи: умный контекст в зависимости от запроса
      const activeEventsForMatches = events.filter(e => e.status === 'active');
      const matchesData = [];
      const statsQuery = messageText && isStatsQuery(messageText);
      const targetEventId = messageText ? detectTournamentFromText(messageText, events) : null;

      // Если статистический запрос без указания турнира — просим уточнить
      if (statsQuery && !targetEventId) {
        context.statsQueryNeedsClarification = true;
      }

      // Определяем какие турниры обрабатывать
      const eventsToProcess = targetEventId
        ? activeEventsForMatches.filter(e => e.id === targetEventId)
        : activeEventsForMatches;

      for (const event of eventsToProcess) {
        const matches = getMatches(event.id);
        const upcoming = matches.filter(m => !m.winner && m.status !== 'cancelled').slice(0, 6);

        let finished;
        if (statsQuery) {
          // Статистический запрос — все завершённые матчи турнира (или конкретного турнира)
          finished = matches.filter(m => m.winner);
        } else {
          // Обычный запрос — последние 6
          finished = matches.filter(m => m.winner).slice(-6);
        }

        if (upcoming.length > 0 || finished.length > 0) {
          let matchText = `${event.name}:`;
          upcoming.forEach(m => {
            const date = m.match_date ? new Date(m.match_date).toLocaleDateString('ru-RU') : '?';
            matchText += `\n⏳${m.team1} vs ${m.team2} (${date},тур${m.round || '?'})`;
          });
          finished.forEach(m => {
            const score = m.score_team1 !== null ? `${m.score_team1}:${m.score_team2}` : '';
            const winner = m.winner === 'team1' ? m.team1 : m.winner === 'team2' ? m.team2 : 'Ничья';
            const cards = [];
            if (m.yellow_cards !== null && m.yellow_cards !== undefined) cards.push(`🟨${m.yellow_cards}`);
            if (m.red_cards !== null && m.red_cards !== undefined) cards.push(`🟥${m.red_cards}`);
            const cardsStr = cards.length > 0 ? ` [${cards.join(' ')}]` : '';
            matchText += `\n✅${m.team1} vs ${m.team2}:${winner}${score}${cardsStr}`;
          });
          matchesData.push(matchText);
        }
      }
      if (matchesData.length > 0) context.matches = matchesData.join('\n');

      // Ставки и профиль текущего пользователя (все активные турниры)
      if (currentUser) {
        const profile = getUserProfile(currentUser.id);
        if (profile) {
          context.userProfile = `${profile.username}:ставок${profile.total_bets},угадано${profile.won_bets}(${profile.win_rate}%),турниров${profile.tournaments_count},наград${profile.awards_count}`;
        }

        // Если в сообщении упоминается другой пользователь — подгружаем его профиль
        if (messageText) {
          const allUsers = db.prepare('SELECT id, username FROM users').all();
          const mentionedUsers = allUsers.filter(u =>
            u.id !== currentUser.id &&
            messageText.toLowerCase().includes(u.username.toLowerCase())
          );
          if (mentionedUsers.length > 0) {
            const mentionedProfiles = mentionedUsers.map(u => {
              const p = getUserProfile(u.id);
              if (!p) return null;
              return `${p.username}:ставок${p.total_bets},угадано${p.won_bets}(${p.win_rate}%),турниров${p.tournaments_count},наград${p.awards_count}`;
            }).filter(Boolean);
            if (mentionedProfiles.length > 0) {
              context.mentionedProfiles = mentionedProfiles.join('\n');
            }
          }
        }

        const userBetsData = [];
        for (const event of activeEventsForMatches) {
          const bets = getUserBets(currentUser.id, currentUser.id, event.id);
          if (bets && bets.length > 0) {
            const betsText = formatBetsCompact(bets, event.name);
            if (betsText) userBetsData.push(betsText);
          }
        }
        if (userBetsData.length > 0) context.userBets = userBetsData.join('\n');

        // Ставки упомянутых пользователей (с учётом show_bets)
        if (messageText) {
          const mentionedBetsData = [];
          const allUsers = db.prepare('SELECT id, username FROM users').all();
          const mentionedForBets = allUsers.filter(u =>
            u.id !== currentUser.id &&
            messageText.toLowerCase().includes(u.username.toLowerCase())
          );
          for (const mu of mentionedForBets) {
            for (const event of activeEventsForMatches) {
              const bets = getUserBets(mu.id, currentUser.id, event.id);
              if (bets && bets.length > 0) {
                const betsText = formatBetsCompact(bets, `${event.name} (${mu.username})`);
                if (betsText) mentionedBetsData.push(betsText);
              }
            }
          }
          if (mentionedBetsData.length > 0) {
            context.mentionedBets = mentionedBetsData.join('\n');
          }
        }
      }
    }

    // Последние 10 новостей
    const news = getLatestNews(10);
    if (news.length > 0) {
      context.news = news.map(n => {
        const date = new Date(n.created_at).toLocaleDateString('ru-RU');
        return `[${date}]${(n.title || n.message || '').substring(0, 60)}`;
      }).join('\n');
    }

  } catch (error) {
    console.error('❌ Ошибка формирования контекста AI:', error);
  }

  return context;
}

/**
 * Получает ставки конкретного пользователя для AI (с учетом show_bets)
 * viewerUsername - кто спрашивает (null = AI/анонимный)
 */
export function getAIUserBets(targetUsername, viewerUsername, eventId) {
  const targetUser = db.prepare('SELECT id, username, show_bets FROM users WHERE LOWER(username) = LOWER(?)').get(targetUsername);
  if (!targetUser) return null;

  const viewerUser = viewerUsername
    ? db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(viewerUsername)
    : null;

  const bets = getUserBets(targetUser.id, viewerUser?.id || null, eventId);
  const showBets = targetUser.show_bets || 'always';

  return { bets, showBets, username: targetUser.username };
}

/**
 * Экспорт функции для контекста конкретного турнира
 */
export { buildTournamentContext };
