// ===== СТАТИСТИКА LIVE МАТЧЕЙ =====
// Перенесено из js/index.js

import { currentUser, currentLiveEventId } from './state.js';
import { showCustomAlert } from './ui.js';

// Кэш для словаря имен игроков
let playerNamesDict = null;
let currentPlayersDictTournament = null;

// Глобальная переменная для хранения сохраненных имен игроков
window.savedEventPlayers = {};

export function determineTournamentCode(icon) {
  const iconMapping = {
    'img/cups/champions-league.png': 'CL',
    'img/cups/european-league.png': 'EL',
    'img/cups/england-premier-league.png': 'PL',
    'img/cups/bundesliga.png': 'BL1',
    'img/cups/spain-la-liga.png': 'PD',
    'img/cups/serie-a.png': 'SA',
    'img/cups/france-league-ligue-1.png': 'FL1',
    'img/cups/rpl.png': 'RPL',
    'img/cups/world-cup.png': 'WC'
  };

  return iconMapping[icon] || 'CL';
}

export const PLAYERS_DICT_FILES = {
  'CL': 'names/LeagueOfChampionsPlayers.json',
  'EL': 'names/EuropaLeaguePlayers.json',
  'PL': 'names/PremierLeaguePlayers.json',
  'BL1': 'names/BundesligaPlayers.json',
  'PD': 'names/LaLigaPlayers.json',
  'SA': 'names/SerieAPlayers.json',
  'FL1': 'names/Ligue1Players.json',
  'DED': 'names/EredivisiePlayers.json',
  'RPL': 'names/RussianPremierLeaguePlayers.json',
  'WC': 'names/PlayerNames.json',
  'EC': 'names/PlayerNames.json'
};

export async function loadPlayerNamesDict(tournamentCode) {
  if (playerNamesDict && currentPlayersDictTournament === tournamentCode) {
    return playerNamesDict;
  }

  const dictFile = PLAYERS_DICT_FILES[tournamentCode] || 'names/PlayerNames.json';

  try {
    const response = await fetch(`/${dictFile}`);
    if (response.ok) {
      playerNamesDict = await response.json();
      currentPlayersDictTournament = tournamentCode;
      console.log(`✅ Словарь игроков загружен для ${tournamentCode}:`, Object.keys(playerNamesDict).length, 'имен');
    } else {
      playerNamesDict = {};
      currentPlayersDictTournament = null;
    }
  } catch (error) {
    console.warn('⚠ Не удалось загрузить словарь имен игроков:', error);
    playerNamesDict = {};
    currentPlayersDictTournament = null;
  }

  return playerNamesDict;
}

export function translatePlayerName(englishName) {
  if (!playerNamesDict || !englishName) {
    console.log(`⚠ Перевод невозможен: dict=${!!playerNamesDict}, name=${englishName}`);
    return englishName;
  }

  for (const [russian, english] of Object.entries(playerNamesDict)) {
    if (english === englishName) {
      console.log(`✅ Переведено: ${englishName} → ${russian}`);
      return `${russian} (${englishName})`;
    }
  }

  console.log(`❌ Не найдено в словаре: ${englishName}`);
  return englishName;
}

export async function showLiveTeamStats(matchData) {
  const modal = document.getElementById('liveTeamStatsModal');
  const title = document.getElementById('liveTeamStatsTitle');
  const content = document.getElementById('liveTeamStatsContent');

  modal.style.display = 'flex';
  title.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> ${matchData.team1} vs ${matchData.team2}`;
  content.innerHTML = '<div class="empty-message">⏳ Загрузка статистики...</div>';

  if (currentLiveEventId) {
    try {
      const events = await fetch('/api/events').then(r => r.json());
      const event = events.find(e => e.id === currentLiveEventId);
      if (event && event.icon) {
        const tournamentCode = determineTournamentCode(event.icon);
        await loadPlayerNamesDict(tournamentCode);
      }
    } catch (err) {
      console.warn('⚠ Не удалось загрузить словарь игроков:', err);
    }
  }

  if (currentUser && currentUser.username && currentLiveEventId) {
    fetch('/api/events')
      .then(res => res.json())
      .then(events => {
        const event = events.find(e => e.id === currentLiveEventId);
        const isLive = matchData.status === 'live' || matchData.status === 'in_progress';
        const isFinished = matchData.status === 'finished' || matchData.status === 'completed';
        const statusText = isLive ? '<svg class="icon" aria-hidden="true"><use href="#icon-live"></use></svg> LIVE' : isFinished ? '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Завершен' : 'Предстоящий';

        return fetch('/api/notify-live-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: currentUser.username,
            action: 'open_match_stats',
            details: {
              match: `${matchData.team1} vs ${matchData.team2}`,
              tournamentName: event ? event.name : 'Неизвестный турнир',
              status: statusText
            }
          })
        });
      })
      .catch(err => console.log('Ошибка отправки уведомления:', err));
  }

  try {
    if (matchData.id) {
      console.log('🔍 Загружаем детали матча:', {
        id: matchData.id,
        team1: matchData.team1,
        team2: matchData.team2,
        status: matchData.status
      });
      const detailsResponse = await fetch(`/api/match-details/${matchData.id}`);

      if (detailsResponse.ok) {
        const details = await detailsResponse.json();
        console.log('✅ Детали получены:', details);
        await displayDetailedStats(details, matchData);
        return;
      } else {
        console.warn('⚠ Не удалось загрузить детали:', {
          status: detailsResponse.status,
          statusText: detailsResponse.statusText,
          matchId: matchData.id
        });
      }
    } else {
      console.log('ℹ У матча нет SStats ID (sstats_match_id), показываем базовую статистику');
    }

    displayBasicStats(matchData);

  } catch (error) {
    console.error('Ошибка загрузки статистики:', error);
    displayBasicStats(matchData);
  }
}

export function displayBasicStats(matchData) {
  const content = document.getElementById('liveTeamStatsContent');

  const isLive = matchData.status === 'live' || matchData.status === 'in_progress';
  const isFinished = matchData.status === 'finished' || matchData.status === 'completed';
  const statusText = isLive ? '<svg class="icon" aria-hidden="true"><use href="#icon-live"></use></svg> LIVE' : isFinished ? '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Завершен' : 'Предстоящий';

  let html = `
    <div style="background: rgba(90, 159, 212, 0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 3px solid #5a9fd4;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div style="text-align: center; flex: 1;">
          <div style="color: #e0e6f0; font-size: 1.1em; font-weight: 600; margin-bottom: 5px;">${matchData.team1}</div>
        </div>
        <div style="text-align: center; padding: 0 20px;">
          <div style="color: #4caf50; font-size: 1.5em; font-weight: 700;">${matchData.score || 'vs'}</div>
          <div style="color: #b0b8c8; font-size: 0.85em; margin-top: 5px;">${statusText}</div>
          ${matchData.elapsed ? `<div style="color: #f44336; font-size: 0.9em; margin-top: 3px;">${matchData.elapsed}'</div>` : ''}
        </div>
        <div style="text-align: center; flex: 1;">
          <div style="color: #e0e6f0; font-size: 1.1em; font-weight: 600; margin-bottom: 5px;">${matchData.team2}</div>
        </div>
      </div>
      ${matchData.match_time ? `
        <div style="text-align: center; color: #b0b8c8; font-size: 0.9em; margin-top: 10px;">
          <svg class="icon" aria-hidden="true"><use href="#icon-clock"></use></svg> ${new Date(matchData.match_time).toLocaleString('ru-RU', {
            day: '2-digit',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </div>
      ` : ''}
    </div>
  `;

  if (!isLive && !isFinished) {
    html += `
      <div class="empty-message">
        <p><svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> Матч еще не начался</p>
        <p style="font-size: 0.9em; color: #b0b8c8; margin-top: 10px;">Статистика появится после начала матча</p>
      </div>
    `;
  } else if (!matchData.id) {
    html += `
      <div class="empty-message">
        <p><svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Детальная статистика недоступна</p>
        <p style="font-size: 0.9em; color: #b0b8c8; margin-top: 10px;">
          Для этого матча отсутствует связь с SStats API
        </p>
        <p style="font-size: 0.85em; color: #888; margin-top: 8px;">
          Обновите SStats ID через панель управления турниром
        </p>
      </div>
    `;
  } else {
    html += `
      <div class="empty-message">
        <p><svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Детальная статистика</p>
        <p style="font-size: 0.9em; color: #b0b8c8; margin-top: 10px;">
          ${isLive ? 'Матч идет в данный момент' : 'Матч завершен'}
        </p>
      </div>
    `;
  }

  content.innerHTML = html;
}

export async function displayDetailedStats(details, matchData) {
  const content = document.getElementById('liveTeamStatsContent');
  const game = details.game;
  const stats = details.statistics;
  const events = details.events || [];
  const lineupPlayers = details.lineupPlayers || [];

  console.log('🔍 Статус матча:', {
    status: game.status,
    statusName: game.statusName,
    elapsed: game.elapsed,
    homeResult: game.homeResult,
    awayResult: game.awayResult
  });

  const isLive = game.statusName === 'Live' ||
                 game.status === 4 ||
                 game.status === 3 ||
                 (game.elapsed && game.elapsed > 0) ||
                 (game.statusName && game.statusName.toLowerCase().includes('live'));

  const isFinished = game.statusName === 'Finished' ||
                     [7, 8, 9, 10].includes(game.status) ||
                     (game.statusName && (game.statusName.toLowerCase().includes('finished') || game.statusName.toLowerCase().includes('ft')));

  const hasStarted = isLive || isFinished || (game.homeResult !== null && game.homeResult !== undefined);

  console.log('📊 Определение статуса:', { isLive, isFinished, hasStarted });

  const statusText = isLive ? '<svg class="icon" aria-hidden="true"><use href="#icon-live"></use></svg> LIVE' : isFinished ? '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Завершен' : '<svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> Предстоящий';

  let html = `
    <div style="background: rgba(90, 159, 212, 0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 3px solid #5a9fd4;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div style="text-align: center; flex: 1;">
          <div style="color: #e0e6f0; font-size: 1.1em; font-weight: 600; margin-bottom: 5px;">${matchData.team1}</div>
        </div>
        <div style="text-align: center; padding: 0 20px;">
          <div style="color: #4caf50; font-size: 1.5em; font-weight: 700;">${game.homeResult ?? 0} : ${game.awayResult ?? 0}</div>
          <div style="color: #b0b8c8; font-size: 0.85em; margin-top: 5px;">${statusText}</div>
          ${game.elapsed ? `<div style="color: #f44336; font-size: 0.9em; margin-top: 3px;">${game.elapsed}'</div>` : ''}
        </div>
        <div style="text-align: center; flex: 1;">
          <div style="color: #e0e6f0; font-size: 1.1em; font-weight: 600; margin-bottom: 5px;">${matchData.team2}</div>
        </div>
      </div>
      ${game.date ? `
        <div style="text-align: center; color: #b0b8c8; font-size: 0.9em; margin-top: 10px;">
          <svg class="icon" aria-hidden="true"><use href="#icon-clock"></use></svg> ${new Date(game.date).toLocaleString('ru-RU', {
            day: '2-digit',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </div>
      ` : ''}
    </div>
  `;

  if (!hasStarted) {
    html += `
      <div class="empty-message">
        <p><svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> Матч еще не начался</p>
        <p style="font-size: 0.9em; color: #b0b8c8; margin-top: 10px;">Статистика появится после начала матча</p>
      </div>
    `;
    content.innerHTML = html;
    return;
  }

  html += `
    <div style="display: flex; gap: 10px; margin-bottom: 15px; border-bottom: 2px solid rgba(255, 255, 255, 0.1);">
      <button onclick="switchLiveStatsTab('statistics')" id="liveStatsTab-statistics" style="flex: 1; padding: 10px; background: rgba(90, 159, 212, 0.3); border: none; border-bottom: 3px solid #5a9fd4; color: #e0e6f0; cursor: pointer; font-size: 0.9em; transition: all 0.3s;">
        <svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Статистика
      </button>
      <button onclick="switchLiveStatsTab('lineups')" id="liveStatsTab-lineups" style="flex: 1; padding: 10px; background: transparent; border: none; border-bottom: 3px solid transparent; color: #b0b8c8; cursor: pointer; font-size: 0.9em; transition: all 0.3s;">
        <svg class="icon" aria-hidden="true"><use href="#icon-participants"></use></svg> Составы
      </button>
      <button onclick="switchLiveStatsTab('events')" id="liveStatsTab-events" style="flex: 1; padding: 10px; background: transparent; border: none; border-bottom: 3px solid transparent; color: #b0b8c8; cursor: pointer; font-size: 0.9em; transition: all 0.3s;">
        <svg class="icon" aria-hidden="true"><use href="#icon-matches"></use></svg> События
      </button>
    </div>
    <div id="liveStatsTabContent"></div>
  `;

  content.innerHTML = html;

  window.currentLiveStatsData = { details, matchData, stats, events, lineupPlayers, game };

  await loadSavedEventPlayers(matchData.id);

  switchLiveStatsTab('statistics');
}

export function switchLiveStatsTab(tab) {
  const data = window.currentLiveStatsData;
  if (!data) return;

  ['statistics', 'lineups', 'events'].forEach(t => {
    const btn = document.getElementById(`liveStatsTab-${t}`);
    if (btn) {
      if (t === tab) {
        btn.style.background = 'rgba(90, 159, 212, 0.3)';
        btn.style.borderBottom = '3px solid #5a9fd4';
        btn.style.color = '#e0e6f0';
      } else {
        btn.style.background = 'transparent';
        btn.style.borderBottom = '3px solid transparent';
        btn.style.color = '#b0b8c8';
      }
    }
  });

  const content = document.getElementById('liveStatsTabContent');

  if (tab === 'statistics') {
    content.innerHTML = renderStatistics(data.stats);
  } else if (tab === 'lineups') {
    content.innerHTML = renderLineups(data.lineupPlayers, data.game);
  } else if (tab === 'events') {
    content.innerHTML = renderEvents(data.events, data.game);
  }
}

export function renderStatistics(stats) {
  if (!stats) {
    return `
      <div class="empty-message">
        <p><svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Статистика пока недоступна</p>
        <p style="font-size: 0.9em; color: #b0b8c8; margin-top: 10px;">Данные появятся в ходе матча</p>
      </div>
    `;
  }

  let html = `
    <div style="background: rgba(255, 255, 255, 0.03); padding: 15px; border-radius: 8px;">
      <div style="display: flex; flex-direction: column; gap: 10px;">
  `;

  const mainStats = [
    { key: 'ballPossessionHome', label: 'Владение мячом', suffix: '%' },
    { key: 'totalShotsHome', label: 'Удары' },
    { key: 'shotsOnGoalHome', label: 'Удары в створ' },
    { key: 'cornerKicksHome', label: 'Угловые' },
    { key: 'foulsHome', label: 'Фолы' },
    { key: 'yellowCardsHome', label: 'Желтые карточки' }
  ];

  mainStats.forEach(stat => {
    const homeValue = stats[stat.key] ?? 0;
    const awayKey = stat.key.replace('Home', 'Away');
    const awayValue = stats[awayKey] ?? 0;
    const total = homeValue + awayValue || 1;
    const homePercent = (homeValue / total) * 100;
    const awayPercent = (awayValue / total) * 100;

    html += `
      <div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 0.85em;">
          <span style="color: #e0e6f0;">${homeValue}${stat.suffix || ''}</span>
          <span style="color: #b0b8c8;">${stat.label}</span>
          <span style="color: #e0e6f0;">${awayValue}${stat.suffix || ''}</span>
        </div>
        <div style="display: flex; height: 6px; background: rgba(255, 255, 255, 0.1); border-radius: 3px; overflow: hidden;">
          <div style="width: ${homePercent}%; background: #5a9fd4;"></div>
          <div style="width: ${awayPercent}%; background: #f44336;"></div>
        </div>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  return html;
}

export function renderLineups(lineupPlayers, game) {
  if (!lineupPlayers || lineupPlayers.length === 0) {
    return `
      <div class="empty-message">
        <p><svg class="icon" aria-hidden="true"><use href="#icon-participants"></use></svg> Составы пока недоступны</p>
        <p style="font-size: 0.9em; color: #b0b8c8; margin-top: 10px;">Данные появятся перед началом матча</p>
      </div>
    `;
  }

  const homePlayers = lineupPlayers.filter(p => p.teamId === game.homeTeam.id);
  const awayPlayers = lineupPlayers.filter(p => p.teamId === game.awayTeam.id);

  let html = `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">`;

  html += `
    <div style="background: rgba(90, 159, 212, 0.1); padding: 15px; border-radius: 8px;">
      <h4 style="color: #5a9fd4; margin: 0 0 10px 0; font-size: 0.95em;">${game.homeTeam.name}</h4>
      <div style="display: flex; flex-direction: column; gap: 5px;">
  `;

  homePlayers.filter(p => p.startXI).forEach(p => {
    const translatedName = translatePlayerName(p.playerName);
    html += `
      <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85em; color: #e0e6f0;">
        <span style="background: rgba(90, 159, 212, 0.3); padding: 2px 6px; border-radius: 3px; min-width: 25px; text-align: center;">${p.number}</span>
        <span>${translatedName}</span>
      </div>
    `;
  });

  html += `</div></div>`;

  html += `
    <div style="background: rgba(244, 67, 54, 0.1); padding: 15px; border-radius: 8px;">
      <h4 style="color: #f44336; margin: 0 0 10px 0; font-size: 0.95em;">${game.awayTeam.name}</h4>
      <div style="display: flex; flex-direction: column; gap: 5px;">
  `;

  awayPlayers.filter(p => p.startXI).forEach(p => {
    const translatedName = translatePlayerName(p.playerName);
    html += `
      <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85em; color: #e0e6f0;">
        <span style="background: rgba(244, 67, 54, 0.3); padding: 2px 6px; border-radius: 3px; min-width: 25px; text-align: center;">${p.number}</span>
        <span>${translatedName}</span>
      </div>
    `;
  });

  html += `</div></div></div>`;

  return html;
}

export function renderEvents(events, game) {
  if (!events || events.length === 0) {
    return `
      <div class="empty-message">
        <p><svg class="icon" aria-hidden="true"><use href="#icon-matches"></use></svg> События пока отсутствуют</p>
        <p style="font-size: 0.9em; color: #b0b8c8; margin-top: 10px;">События появятся в ходе матча</p>
      </div>
    `;
  }

  // Иконки событий матча (гол, карточки, замена)
  const eventIcons = {
    1: '<svg class="icon" aria-hidden="true"><use href="#icon-matches"></use></svg>',
    2: '<svg class="icon" aria-hidden="true"><use href="#icon-yellow-card"></use></svg>',
    3: '<svg class="icon" aria-hidden="true"><use href="#icon-refresh"></use></svg>',
    4: '<svg class="icon" aria-hidden="true"><use href="#icon-red-card"></use></svg>'
  };
  const eventNames = { 1: 'Гол', 2: 'Желтая карточка', 3: 'Замена', 4: 'Красная карточка' };

  const homeEvents = events.filter(e => e.teamId === game.homeTeam.id).sort((a, b) => (a.elapsed || 0) - (b.elapsed || 0));
  const awayEvents = events.filter(e => e.teamId === game.awayTeam.id).sort((a, b) => (a.elapsed || 0) - (b.elapsed || 0));

  const renderTeamEvents = (teamEvents, isHome) => {
    if (teamEvents.length === 0) {
      return `<div style="text-align: center; padding: 20px; color: #888; font-size: 0.9em;">Нет событий</div>`;
    }

    let html = '';
    teamEvents.forEach(event => {
      const icon = eventIcons[event.type] || '<svg class="icon" aria-hidden="true"><use href="#icon-attach"></use></svg>';
      const eventName = eventNames[event.type] || event.name;
      const isGoal = event.type === 1;
      const isYellowCard = event.type === 2;
      const isRedCard = event.type === 4;
      const isSubstitution = event.type === 3;

      let playerName = 'N/A';
      let isPlayerNameMissing = false;

      if (event.player?.name) {
        playerName = translatePlayerName(event.player.name);
      } else if (event.player?.id && window.currentLiveStatsData?.lineupPlayers) {
        const player = window.currentLiveStatsData.lineupPlayers.find(p => p.id === event.player.id);
        if (player && player.name) {
          playerName = translatePlayerName(player.name);
        }
      }

      if (window.savedEventPlayers && window.savedEventPlayers[event.id]) {
        playerName = window.savedEventPlayers[event.id].player_name;
      } else if (playerName === 'N/A' && (isGoal || isYellowCard || isRedCard)) {
        isPlayerNameMissing = true;
      }

      const assistName = event.assistPlayer ? translatePlayerName(event.assistPlayer.name) : null;

      let bgColor, borderColor;
      if (isGoal) {
        bgColor = 'rgba(7, 255, 23, 0.2)';
        borderColor = 'rgb(7, 255, 23)';
      } else if (isYellowCard) {
        bgColor = 'rgba(255, 215, 0, 0.15)';
        borderColor = 'rgb(255, 215, 0)';
      } else if (isRedCard) {
        bgColor = 'rgba(244, 67, 54, 0.1)';
        borderColor = 'rgb(244, 67, 54)';
      } else if (isSubstitution) {
        bgColor = 'rgba(56, 118, 235, 0.3)';
        borderColor = 'rgb(56, 118, 235)';
      } else {
        bgColor = `rgba(${isHome ? '90, 159, 212' : '244, 67, 54'}, 0.1)`;
        borderColor = isHome ? '#5a9fd4' : '#f44336';
      }

      html += `
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: ${bgColor}; border-radius: 5px; border-left: 3px solid ${borderColor}; margin-bottom: 8px;">
          <div style="min-width: 35px; text-align: center; color: #e0e6f0; font-weight: 600; font-size: 0.85em;">
            ${event.elapsed}'
          </div>
          <div style="font-size: 1.1em;">${icon}</div>
          <div style="flex: 1;">
            <div style="color: #e0e6f0; font-size: 0.85em; font-weight: 600;">
              ${isPlayerNameMissing ?
                `<span class="editable-player-name"
                       data-event-id="${event.id}"
                       data-event-type="${event.type === 1 ? 'goal' : event.type === 2 ? 'yellow_card' : 'red_card'}"
                       data-minute="${event.elapsed}"
                       data-extra-minute="${event.extra || ''}"
                       data-team-id="${event.teamId}"
                       style="cursor: pointer; border-bottom: 2px dashed #5a9fd4; padding-bottom: 2px;"
                       onclick="openPlayerNameEditor(this)"
                       title="Нажмите, чтобы добавить имя игрока">
                  ${playerName}
                </span>`
                : playerName
              }
            </div>
            <div style="color: #b0b8c8; font-size: 0.75em;">
              ${eventName}${assistName ? ` (ассист: ${assistName})` : ''}
            </div>
          </div>
        </div>
      `;
    });

    return html;
  };

  return `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
      <div style="background: rgba(90, 159, 212, 0.05); padding: 15px; border-radius: 8px;">
        <h4 style="color: #5a9fd4; margin: 0 0 15px 0; font-size: 0.95em; text-align: center;">${game.homeTeam.name}</h4>
        ${renderTeamEvents(homeEvents, true)}
      </div>
      <div style="background: rgba(244, 67, 54, 0.05); padding: 15px; border-radius: 8px;">
        <h4 style="color: #f44336; margin: 0 0 15px 0; font-size: 0.95em; text-align: center;">${game.awayTeam.name}</h4>
        ${renderTeamEvents(awayEvents, false)}
      </div>
    </div>
  `;
}

export function closeLiveTeamStatsModal() {
  const modal = document.getElementById('liveTeamStatsModal');
  modal.style.display = 'none';
}

export async function loadSavedEventPlayers(matchId) {
  try {
    const response = await fetch(`/api/matches/${matchId}/events/players`);
    const data = await response.json();

    if (data.success && data.events) {
      window.savedEventPlayers = {};
      data.events.forEach(event => {
        window.savedEventPlayers[event.sstats_event_id] = event;
      });
      console.log('✅ Загружены сохраненные имена игроков:', window.savedEventPlayers);
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки сохраненных имен игроков:', error);
  }
}

export function openPlayerNameEditor(element) {
  const eventId = element.dataset.eventId;
  const eventType = element.dataset.eventType;
  const minute = element.dataset.minute;
  const extraMinute = element.dataset.extraMinute;
  const teamId = element.dataset.teamId;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Начните вводить имя...';
  input.style.cssText = `
    width: 200px;
    padding: 5px 8px;
    background: rgba(50, 55, 70, 0.9);
    border: 2px solid #5a9fd4;
    color: #e0e6f0;
    border-radius: 4px;
    font-size: 0.85em;
    outline: none;
  `;

  const suggestionsList = document.createElement('div');
  suggestionsList.style.cssText = `
    position: absolute;
    background: rgba(30, 35, 50, 0.98);
    border: 1px solid #5a9fd4;
    border-radius: 4px;
    max-height: 200px;
    overflow-y: auto;
    z-index: 10000;
    display: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;

  element.replaceWith(input);
  input.parentElement.style.position = 'relative';
  input.parentElement.appendChild(suggestionsList);
  input.focus();

  let playersDictionary = [];
  const matchData = window.currentLiveStatsData;

  if (matchData && matchData.game && matchData.game.season && matchData.game.season.league) {
    const leagueId = matchData.game.season.league.id;
    const leagueCodeMap = {
      2: 'CL', 3: 'EL', 848: 'ECL', 39: 'PL', 78: 'BL1',
      140: 'PD', 135: 'SA', 61: 'FL1', 88: 'DED', 235: 'RPL',
      1: 'WC', 4: 'EC'
    };
    const competitionCode = leagueCodeMap[leagueId] || 'RPL';

    loadPlayersDictionary(competitionCode).then(players => {
      playersDictionary = players;
    });
  }

  input.addEventListener('input', () => {
    const query = input.value.toLowerCase().trim();

    if (query.length < 2) {
      suggestionsList.style.display = 'none';
      return;
    }

    const matches = playersDictionary.filter(player =>
      player.toLowerCase().includes(query)
    ).slice(0, 10);

    if (matches.length === 0) {
      suggestionsList.style.display = 'none';
      return;
    }

    suggestionsList.innerHTML = matches.map(player => `
      <div class="player-suggestion" style="
        padding: 8px 12px;
        cursor: pointer;
        color: #e0e6f0;
        font-size: 0.85em;
        border-bottom: 1px solid rgba(90, 159, 212, 0.2);
      " onmouseover="this.style.background='rgba(90, 159, 212, 0.3)'"
         onmouseout="this.style.background='transparent'"
         onclick="selectPlayer('${player.replace(/'/g, "\\'")}', '${eventId}', '${eventType}', ${minute}, '${extraMinute}', ${teamId})">
        ${player}
      </div>
    `).join('');

    suggestionsList.style.display = 'block';
  });

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const playerName = input.value.trim();
      if (playerName) {
        await savePlayerName(playerName, eventId, eventType, minute, extraMinute, teamId);
      }
    } else if (e.key === 'Escape') {
      input.replaceWith(element);
      suggestionsList.remove();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (input.parentElement) {
        input.replaceWith(element);
        suggestionsList.remove();
      }
    }, 200);
  });
}

export async function selectPlayer(playerName, eventId, eventType, minute, extraMinute, teamId) {
  await savePlayerName(playerName, eventId, eventType, minute, extraMinute, teamId);
}

export async function savePlayerName(playerName, eventId, eventType, minute, extraMinute, teamId) {
  try {
    const matchId = window.currentLiveStatsData?.matchData?.id ||
                    window.currentLiveStatsData?.details?.id;

    if (!matchId) {
      console.error('❌ ID матча не найден', window.currentLiveStatsData);
      await showCustomAlert('ID матча не найден. Попробуйте перезагрузить статистику.', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      return;
    }

    console.log('📝 Сохранение имени игрока:', { matchId, playerName, eventId });

    const response = await fetch(`/api/matches/${matchId}/events/player`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sstats_event_id: parseInt(eventId),
        event_type: eventType,
        minute: parseInt(minute),
        extra_minute: extraMinute ? parseInt(extraMinute) : null,
        team_id: parseInt(teamId),
        player_name: playerName
      })
    });

    const data = await response.json();

    if (data.success) {
      console.log('✅ Имя игрока сохранено:', playerName);
      window.savedEventPlayers[eventId] = { player_name: playerName };
      switchLiveStatsTab('events');
    } else {
      console.error('❌ Ошибка сохранения:', data.error);
      await showCustomAlert('Ошибка сохранения имени игрока', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error('❌ Ошибка сохранения имени игрока:', error);
    await showCustomAlert('Ошибка сохранения имени игрока', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

export async function loadPlayersDictionary(competitionCode) {
  const dictionaryMap = {
    'CL': 'names/LeagueOfChampionsPlayers.json',
    'EL': 'names/EuropaLeaguePlayers.json',
    'ECL': 'names/ConferenceLeaguePlayers.json',
    'PL': 'names/PremierLeaguePlayers.json',
    'BL1': 'names/BundesligaPlayers.json',
    'PD': 'names/LaLigaPlayers.json',
    'SA': 'names/SerieAPlayers.json',
    'FL1': 'names/Ligue1Players.json',
    'DED': 'names/EredivisiePlayers.json',
    'RPL': 'names/RussianPremierLeaguePlayers.json',
    'WC': 'names/PlayerNames.json',
    'EC': 'names/PlayerNames.json'
  };

  const dictionaryPath = dictionaryMap[competitionCode] || 'names/PlayerNames.json';

  try {
    const response = await fetch(`/${dictionaryPath}`);
    const data = await response.json();
    return Object.keys(data);
  } catch (error) {
    console.error('❌ Ошибка загрузки словаря игроков:', error);
    return [];
  }
}
