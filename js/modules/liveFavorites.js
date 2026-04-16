// ===== ИЗБРАННЫЕ LIVE МАТЧИ =====
// Перенесено из js/index.js

import { currentUser, currentLiveEventId, matchScores, matchFinishTimes, deletedFinishedMatches } from './state.js';
import { showCustomAlert } from './ui.js';
import { saveDeletedFinishedMatches, showGoalNotification, playGoalSound, addNotificationToQueue, updateDesktopNotification, processMatches, checkMatchEventsForNotifications } from './goalNotifications.js';
import { showLiveTeamStats } from './liveStats.js';

let favoriteMatchesInterval = null;

function startFavoriteMatchesPolling() {
  if (favoriteMatchesInterval) {
    clearInterval(favoriteMatchesInterval);
  }

  pollFavoriteMatches();

  favoriteMatchesInterval = setInterval(() => {
    if (currentUser) {
      pollFavoriteMatches();
    }
  }, 30000);

  console.log('✅ Polling избранных матчей запущен (глобально)');
}

function stopFavoriteMatchesPolling() {
  if (favoriteMatchesInterval) {
    clearInterval(favoriteMatchesInterval);
    favoriteMatchesInterval = null;
    console.log('⏹ Polling избранных матчей остановлен');
  }
}

function getFavoriteMatches() {
  const favorites = localStorage.getItem('favoriteMatches');
  return favorites ? JSON.parse(favorites) : [];
}

function saveFavoriteMatches(favorites) {
  localStorage.setItem('favoriteMatches', JSON.stringify(favorites));
}

function getFavoriteMatchData(matchId) {
  const data = localStorage.getItem(`favoriteMatch_${matchId}`);
  return data ? JSON.parse(data) : null;
}

function saveFavoriteMatchData(matchId, matchData) {
  localStorage.setItem(`favoriteMatch_${matchId}`, JSON.stringify(matchData));
}

function removeFavoriteMatchData(matchId) {
  localStorage.removeItem(`favoriteMatch_${matchId}`);
}

function updateFavoriteMatchesData(liveMatches) {
  const favorites = getFavoriteMatches();

  favorites.forEach(matchId => {
    const match = liveMatches.find(m => m.id === matchId);
    if (match) {
      let betTeam = null;
      if (currentUser && currentUser.bets) {
        const bet = currentUser.bets.find(b => b.match_id === matchId);
        if (bet) betTeam = bet.prediction;
      }

      const matchData = {
        id: match.id,
        team1: match.team1,
        team2: match.team2,
        score: match.score || '0:0',
        status: match.status,
        betTeam: betTeam,
        updatedAt: new Date().toISOString()
      };

      saveFavoriteMatchData(matchId, matchData);
      console.log(`💾 Обновлены данные матча ${matchId}:`, matchData);
    }
  });
}

function toggleFavoriteMatch(matchId, event) {
  event.stopPropagation();
  event.preventDefault();

  let favorites = getFavoriteMatches();
  const index = favorites.indexOf(matchId);

  const matchCard = event.target.closest('.live-match-card');
  let matchInfo = { match: 'Неизвестный матч', tournamentName: 'Неизвестный турнир' };

  if (matchCard) {
    const teamDivs = matchCard.querySelectorAll('div[style*="font-size: 0.95em"][style*="font-weight: 600"]');
    const team1 = teamDivs[0]?.textContent.trim() || 'Команда 1';
    const team2 = teamDivs[1]?.textContent.trim() || 'Команда 2';
    matchInfo.match = `${team1} vs ${team2}`;

    if (currentLiveEventId) {
      fetch('/api/events')
        .then(res => res.json())
        .then(events => {
          const ev = events.find(e => e.id === currentLiveEventId);
          if (ev) matchInfo.tournamentName = ev.name;
        })
        .catch(() => {});
    }
  }

  if (index > -1) {
    favorites.splice(index, 1);
    removeFavoriteMatchData(matchId);

    deletedFinishedMatches.delete(matchId);
    saveDeletedFinishedMatches();

    if (currentUser && currentUser.username) {
      fetch('/api/notify-live-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUser.username,
          action: 'remove_favorite',
          details: matchInfo
        })
      }).catch(err => console.log('Ошибка отправки уведомления:', err));
    }
  } else {
    if (favorites.length >= 20) {
      showCustomAlert('Максимум 20 избранных матчей одновременно', 'Ограничение', '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
      return;
    }
    favorites.push(matchId);

    if (matchCard) {
      const teamDivs = matchCard.querySelectorAll('div[style*="font-size: 0.95em"][style*="font-weight: 600"]');
      const scoreDiv = matchCard.querySelector('div[style*="font-size: 1.3em"][style*="color: #4caf50"]');
      const statusDiv = matchCard.querySelector('div[style*="color: #ff9800"]');

      let betTeam = null;
      if (currentUser && currentUser.bets) {
        const bet = currentUser.bets.find(b => b.match_id === matchId);
        if (bet) betTeam = bet.prediction;
      }

      const matchData = {
        id: matchId,
        team1: teamDivs[0]?.textContent.trim() || 'Команда 1',
        team2: teamDivs[1]?.textContent.trim() || 'Команда 2',
        score: scoreDiv?.textContent.trim() || '0:0',
        status: statusDiv?.textContent.trim() || 'live',
        betTeam: betTeam,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      saveFavoriteMatchData(matchId, matchData);
      console.log('💾 Сохранены данные матча:', matchData);

      const isDesktop = window.innerWidth > 1400;
      if (isDesktop) {
        console.log('🖥 ДЕСКТОП: Создаем карточку сразу после добавления в избранное');
        updateDesktopNotification(matchData);
      }
    }

    if (currentUser && currentUser.username) {
      fetch('/api/notify-live-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUser.username,
          action: 'add_favorite',
          details: matchInfo
        })
      }).catch(err => console.log('Ошибка отправки уведомления:', err));
    }
  }

  saveFavoriteMatches(favorites);
  console.log('💾 Сохранен список избранных:', favorites);
  updateFavoriteStars();

  if (index > -1) {
    pollFavoriteMatches();
  }
}

function updateFavoriteStars() {
  const favorites = getFavoriteMatches();
  document.querySelectorAll('.favorite-star').forEach(star => {
    const matchId = parseInt(star.getAttribute('data-match-id'));
    if (favorites.includes(matchId)) {
      star.innerHTML = '<svg class="icon" aria-hidden="true" style="color: #ffc107;"><use href="#icon-best-result"></use></svg>';
      star.classList.add('active');
    } else {
      star.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-best-result"></use></svg>';
      star.classList.remove('active');
    }
  });
}

async function updateLiveIndicator() {
  const indicator = document.getElementById('liveTabIndicator');
  if (!indicator) {
    console.warn('⚠ Индикатор LIVE не найден');
    return;
  }

  try {
    console.log('🔄 Обновление индикатора LIVE...');

    const eventsResponse = await fetch('/api/events');
    if (!eventsResponse.ok) {
      console.error('❌ Ошибка загрузки турниров для индикатора');
      indicator.classList.add('static');
      return;
    }

    const allEvents = await eventsResponse.json();

    const now = new Date();
    const activeEvents = allEvents.filter((event) => {
      if (event.locked_reason) return false;
      if (!event.start_date) return false;
      return new Date(event.start_date) <= now;
    });

    console.log(`📊 Активных турниров: ${activeEvents.length}`);

    let hasAnyLiveMatches = false;

    for (const event of activeEvents) {
      try {
        const matchesResponse = await fetch(`/api/live-matches?eventId=${event.id}`);
        if (matchesResponse.ok) {
          const matchesData = await matchesResponse.json();
          const matches = matchesData.matches || [];
          const liveMatches = matches.filter(m => m.status === 'live' || m.status === 'in_progress');

          if (liveMatches.length > 0) {
            console.log(`🔴 Найдены LIVE матчи в турнире "${event.name}": ${liveMatches.length}`);
            hasAnyLiveMatches = true;
            break;
          }
        }
      } catch (e) {
        console.warn(`⚠ Ошибка проверки турнира ${event.name}:`, e.message);
      }
    }

    if (hasAnyLiveMatches) {
      console.log('🔴 Индикатор: КРАСНЫЙ (есть live матчи)');
      indicator.classList.remove('static');
    } else {
      console.log('🔵 Индикатор: СИНИЙ (нет live матчей)');
      indicator.classList.add('static');
    }
  } catch (error) {
    console.error('❌ Ошибка обновления live индикатора:', error);
    indicator.classList.add('static');
  }
}

async function pollFavoriteMatches() {
  if (!currentUser) {
    console.log('⏸ Polling избранных: пользователь не залогинен');
    return;
  }

  const favorites = getFavoriteMatches();
  console.log(`🔄 Polling избранных матчей: ${favorites.length} в списке`, favorites);

  let needsSave = false;
  deletedFinishedMatches.forEach(matchId => {
    if (!favorites.includes(matchId)) {
      deletedFinishedMatches.delete(matchId);
      needsSave = true;
    }
  });
  if (needsSave) {
    saveDeletedFinishedMatches();
    console.log('🧹 Очищены старые записи из deletedFinishedMatches');
  }

  if (favorites.length === 0) {
    const container = document.getElementById('goalNotifications');
    if (container) container.innerHTML = '';
    console.log('📭 Нет избранных матчей, контейнер очищен');
    return;
  }

  const isDesktop = window.innerWidth > 1400;
  console.log(`💻 Режим: ${isDesktop ? 'ДЕСКТОП' : 'МОБИЛЬНАЯ'} (ширина: ${window.innerWidth}px)`);

  try {
    const response = await fetch('/api/live-matches-by-ids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchIds: favorites })
    });

    if (response.ok) {
      const apiMatches = await response.json();
      console.log(`📡 Получено ${apiMatches.length} матчей через API`);

      apiMatches.forEach(match => {
        let betTeam = null;
        if (currentUser && currentUser.bets) {
          const bet = currentUser.bets.find(b => b.match_id === match.id);
          if (bet) betTeam = bet.prediction;
        }

        const matchData = {
          id: match.id,
          team1: match.team1 || match.homeTeam,
          team2: match.team2 || match.awayTeam,
          score: match.score || `${match.homeResult || 0}:${match.awayResult || 0}`,
          status: match.status || match.statusName || 'live',
          elapsed: match.elapsed || null,
          betTeam: betTeam,
          updatedAt: new Date().toISOString()
        };
        saveFavoriteMatchData(match.id, matchData);
      });

      console.log('✅ Данные в localStorage обновлены');

      if (currentUser && currentUser.id && favorites.length > 0) {
        checkMatchEventsForNotifications(favorites, currentUser.id);
      }
    }
  } catch (error) {
    console.log('⚠ Не удалось обновить через API, используем данные из localStorage:', error.message);
  }

  const matches = [];
  favorites.forEach(matchId => {
    const matchData = getFavoriteMatchData(matchId);
    if (matchData) {
      matches.push({
        id: matchData.id,
        team1: matchData.team1,
        team2: matchData.team2,
        score: matchData.score || '0:0',
        status: matchData.status || 'live',
        elapsed: matchData.elapsed || null,
        betTeam: matchData.betTeam || null
      });
    }
  });

  console.log(`📦 Загружено ${matches.length} матчей из localStorage`);

  if (matches.length > 0) {
    processMatches(matches, favorites, isDesktop);
  }
}

function cleanupOldFavorites() {
  const favorites = getFavoriteMatches();
  if (favorites.length === 0) return;

  console.log(`🧹 Проверка ${favorites.length} избранных матчей на актуальность...`);

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let cleaned = 0;
  const updatedFavorites = favorites.filter(matchId => {
    const matchData = getFavoriteMatchData(matchId);

    if (!matchData) {
      console.log(`🗑 Удаляем матч ${matchId} - нет данных`);
      removeFavoriteMatchData(matchId);
      cleaned++;
      return false;
    }

    const isFinished = matchData.status === 'Finished' ||
                      matchData.status === 'finished' ||
                      matchData.status === 'Full Time' ||
                      matchData.status === 'FT' ||
                      matchData.status === 'Completed' ||
                      matchData.status === 'completed' ||
                      matchData.status === 'FINISHED' ||
                      matchData.status === 'COMPLETED';

    if (isFinished) {
      console.log(`🗑 Удаляем матч ${matchId} - завершен`);
      removeFavoriteMatchData(matchId);
      cleaned++;
      return false;
    }

    const timestamp = matchData.updatedAt || matchData.addedAt;
    if (timestamp) {
      const updatedAt = new Date(timestamp);
      if (updatedAt < oneDayAgo) {
        console.log(`🗑 Удаляем матч ${matchId} - данные старше 24 часов`);
        removeFavoriteMatchData(matchId);
        cleaned++;
        return false;
      }
    }

    return true;
  });

  if (cleaned > 0) {
    saveFavoriteMatches(updatedFavorites);
    console.log(`✅ Очищено ${cleaned} старых матчей из избранного`);
  } else {
    console.log('✅ Все избранные матчи актуальны');
  }
}

export {
  getFavoriteMatches,
  saveFavoriteMatches,
  getFavoriteMatchData,
  saveFavoriteMatchData,
  removeFavoriteMatchData,
  updateFavoriteMatchesData,
  toggleFavoriteMatch,
  updateFavoriteStars,
  updateLiveIndicator,
  startFavoriteMatchesPolling,
  stopFavoriteMatchesPolling,
  cleanupOldFavorites,
  pollFavoriteMatches,
};
