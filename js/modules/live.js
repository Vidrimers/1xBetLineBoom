// ===== LIVE МАТЧИ =====
// Перенесено из js/index.js

import { currentUser, currentLiveEventId, completedDaysData, completedDaysLoaded, setCurrentLiveEventId, setCompletedDaysData } from './state.js';
import { updateFavoriteStars, updateFavoriteMatchesData, pollFavoriteMatches, toggleFavoriteMatch } from './liveFavorites.js';
import { showLiveTeamStats } from './liveStats.js';
import { selectEvent } from './events.js';
import { switchTab } from './tabs.js';

// Вспомогательная функция форматирования времени матча
function formatMatchTimeOnly(matchDate) {
  try {
    const date = new Date(matchDate);
    const userTimezone = currentUser?.timezone || 'Europe/Moscow';
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: userTimezone,
      hour: '2-digit',
      minute: '2-digit',
    });
    return formatter.format(date);
  } catch (error) {
    console.error('Ошибка при форматировании времени:', error);
    return new Date(matchDate).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
}

async function loadLiveMatches() {
  const container = document.getElementById('liveMatchesContainer');

  // Восстанавливаем выбранный турнир из localStorage
  const savedLiveEventId = localStorage.getItem('currentLiveEventId');
  if (savedLiveEventId && !currentLiveEventId) {
    setCurrentLiveEventId(parseInt(savedLiveEventId));
  }

  // Если выбран турнир, показываем его матчи
  if (currentLiveEventId) {
    await showLiveEventMatches(currentLiveEventId);
    return;
  }

  // Иначе показываем список турниров
  try {
    const eventsResponse = await fetch('/api/events');
    const allEvents = await eventsResponse.json();

    const now = new Date();

    const activeEvents = allEvents.filter((event) => {
      if (event.locked_reason) return false;
      if (!event.start_date) return false;
      return new Date(event.start_date) <= now;
    });

    if (activeEvents.length === 0) {
      container.innerHTML = `
        <div class="empty-message">
          <p>Нет активных турниров</p>
          <p style="font-size: 0.9em; color: #b0b8c8; margin-top: 10px;">
            Активные турниры появятся здесь после начала
          </p>
        </div>
      `;
      return;
    }

    let html = '<div class="live-events-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 15px;">';

    for (const event of activeEvents) {
      let hasLiveMatches = false;
      try {
        const matchesResponse = await fetch(`/api/live-matches?eventId=${event.id}`);
        if (matchesResponse.ok) {
          const matchesData = await matchesResponse.json();
          const matches = matchesData.matches || [];
          hasLiveMatches = matches.some(m => m.status === 'live' || m.status === 'in_progress');
        }
      } catch (e) {
        // Тихо игнорируем ошибки
      }

      html += `
        <div class="live-event-card ${hasLiveMatches ? 'has-live' : ''}" onclick="showLiveEventMatches(${event.id})" style="
          background: rgba(255, 255, 255, 0.05);
          border: 2px solid rgba(90, 159, 212, 0.5);
          border-radius: 8px;
          padding: 20px;
          cursor: pointer;
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        " onmouseover="this.style.background='rgba(90, 159, 212, 0.1)'; this.style.transform='translateY(-5px)'; this.style.boxShadow='0 8px 20px ${hasLiveMatches ? 'rgba(244, 67, 54, 0.3)' : 'rgba(90, 159, 212, 0.3)'}';" onmouseout="this.style.background='rgba(255, 255, 255, 0.05)'; this.style.transform='translateY(0)'; this.style.boxShadow='none';">

          ${hasLiveMatches ? '<span class="live-indicator" style="position: absolute; top: 20px; right: 20px; width: 10px; height: 10px;"></span>' : ''}

          <div>
            <div style="text-align: center; margin-bottom: 15px;">
              ${event.icon ? (
                event.icon.startsWith('img/') || event.icon.startsWith('http')
                  ? `<img src="${event.icon}" alt="иконка" style="width: 60px; height: 60px; object-fit: contain; background: ${event.background_color === 'transparent' || !event.background_color ? 'rgba(224, 230, 240, .4)' : event.background_color}; padding: 5px; border-radius: 5px;">`
                  : `<span style="font-size: 3em; display: block; background: ${event.background_color === 'transparent' || !event.background_color ? 'rgba(224, 230, 240, .4)' : event.background_color}; width: 60px; height: 60px; line-height: 60px; margin: 0 auto; border-radius: 5px;">${event.icon}</span>`
              ) : ''}
            </div>

            <h3 style="color: #e0e6f0; margin: 0 0 15px 0; font-size: 1.1em; text-align: center;">
              ${event.name}
            </h3>

            ${event.start_date || event.end_date ? `
              <p style="color: #b0b8c8; font-size: 0.85em; margin: 0 0 15px 0; text-align: center; opacity: 0.6;">
                ${event.start_date ? `<svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> с ${new Date(event.start_date).toLocaleDateString('ru-RU')}` : ''}
                ${event.end_date ? ` по ${new Date(event.end_date).toLocaleDateString('ru-RU')}` : ''}
              </p>
            ` : ''}
          </div>

          <button onclick="event.stopPropagation(); selectEvent(${event.id}); switchTab('allbets');" style="width: 100%; text-align: center; padding: 10px; background: rgba(90, 159, 212, 0.1); border-radius: 5px; border: 1px solid rgba(90, 159, 212, 0.3); cursor: pointer; transition: all 0.3s ease;" onmouseover="this.style.background='rgba(90, 159, 212, 0.3)'" onmouseout="this.style.background='rgba(90, 159, 212, 0.1)'">
            <span style="color: #7ab0e0; font-weight: 600; font-size: 0.95em;">
              <svg class="icon" aria-hidden="true"><use href="#icon-matches"></use></svg> К ставкам
            </span>
          </button>
        </div>
      `;
    }

    html += '</div>';
    container.innerHTML = html;

  } catch (error) {
    console.error('Ошибка при загрузке live турниров:', error);
    container.innerHTML = `
      <div class="empty-message" style="color: #f44336;">
        Ошибка при загрузке турниров: ${error.message}
      </div>
    `;
  }
}

async function showLiveEventMatches(eventId) {
  setCurrentLiveEventId(eventId);
  localStorage.setItem('currentLiveEventId', eventId);
  const container = document.getElementById('liveMatchesContainer');

  try {
    const eventsResponse = await fetch('/api/events');
    const allEvents = await eventsResponse.json();
    const event = allEvents.find(e => e.id === eventId);

    if (!event) {
      container.innerHTML = '<div class="empty-message">Турнир не найден</div>';
      return;
    }

    const matchesResponse = await fetch(`/api/live-matches?eventId=${eventId}`);
    if (!matchesResponse.ok) {
      throw new Error(`Ошибка загрузки матчей: ${matchesResponse.status} ${matchesResponse.statusText}`);
    }

    const matchesData = await matchesResponse.json();
    const todayMatches = matchesData.matches || [];

    const today = new Date();
    let html = `
      <h2 style="color: #e0e6f0; margin-bottom: 10px; display: flex; align-items: center; gap: 10px;">
        ${event.icon ? (
          event.icon.startsWith('img/') || event.icon.startsWith('http')
            ? `<img src="${event.icon}" alt="иконка" style="width: 40px; height: 40px; object-fit: contain; background: ${event.background_color === 'transparent' || !event.background_color ? 'rgba(224, 230, 240, .4)' : event.background_color}; padding: 3px; border-radius: 5px;">`
            : `<span style="font-size: 1.5em;">${event.icon}</span>`
        ) : ''}
        <span>${event.name}</span>
      </h2>

      <p style="color: #b0b8c8; font-size: 0.9em; margin-bottom: 20px;">
        <svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> Матчи на сегодня: ${today.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })}
      </p>
    `;

    if (todayMatches.length === 0) {
      html += `
        <div class="empty-message">
          <p>Сегодня ничего нет, уходи</p>
        </div>
      `;
    } else {
      const sortedMatches = todayMatches.sort((a, b) => {
        const aIsLive = a.status === 'live' || a.status === 'in_progress';
        const bIsLive = b.status === 'live' || b.status === 'in_progress';
        const aIsFinished = a.status === 'finished' || a.status === 'completed';
        const bIsFinished = b.status === 'finished' || b.status === 'completed';

        if (aIsLive && !bIsLive) return -1;
        if (!aIsLive && bIsLive) return 1;
        if (aIsFinished && !bIsFinished) return 1;
        if (!aIsFinished && bIsFinished) return -1;

        return new Date(a.match_time) - new Date(b.match_time);
      });

      html += '<div class="live-matches-grid">';

      for (const match of sortedMatches) {
        const timeStr = formatMatchTimeOnly(match.match_time);
        const isLive = match.status === 'live' || match.status === 'in_progress' || match.status === 'LIVE';
        const isFinished = match.status === 'finished' || match.status === 'completed';
        const isCancelled = ['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(match.status);
        const hasStarted = isLive || isFinished;

        let betTeam = null;
        if (currentUser && currentUser.bets) {
          const bet = currentUser.bets.find(b => b.match_id === match.id);
          if (bet) betTeam = bet.prediction;
        }

        const isDraw = betTeam && (betTeam.toLowerCase() === 'ничья' || betTeam.toLowerCase() === 'draw');
        const shouldUnderlineTeam1 = (betTeam === match.team1 || isDraw);
        const shouldUnderlineTeam2 = (betTeam === match.team2 || isDraw);

        html += `
          <div class="live-match-card ${isLive ? 'is-live' : ''} ${isCancelled ? 'match-cancelled' : ''}" data-match-id="${match.id}"
            onclick='showLiveTeamStats(${JSON.stringify(match).replace(/'/g, "\\'")})'
            style="
            background: ${isCancelled ? 'rgba(60, 60, 60, 0.7)' : 'rgba(255, 255, 255, 0.05)'};
            border: 2px solid ${isCancelled ? '#666' : isLive ? '#f44336' : isFinished ? '#4caf50' : 'rgba(90, 159, 212, 0.5)'};
            border-radius: 8px;
            padding: 15px;
            transition: all 0.3s ease;
            position: relative;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            min-height: 180px;
            cursor: pointer;
          " onmouseover="this.style.transform='translateY(-5px)'; this.style.boxShadow='0 8px 20px ${isLive ? 'rgba(244, 67, 54, 0.3)' : 'rgba(90, 159, 212, 0.3)'}';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none';">

            ${isLive ? `
              <span class="favorite-star" data-match-id="${match.id}" onclick="toggleFavoriteMatch(${match.id}, event)"><svg class="icon" aria-label="Иконка"><use href="#icon-best-result"></use></svg></span>
              <div style="position: absolute; top: 10px; right: 10px;">
                <span class="live-indicator" style="position: static; transform: none;"></span>
              </div>
            ` : ''}

            <div style="text-align: center; margin-bottom: 10px;">
              <div style="color: ${isCancelled ? '#ff5722' : isLive ? '#f44336' : '#b0b8c8'}; font-size: 0.85em; font-weight: 600;">
                ${isCancelled ? '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg> ОТМЕНА' : isLive ? '<svg class="icon" aria-hidden="true"><use href="#icon-live"></use></svg> LIVE' : isFinished ? '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Завершен' : '<svg class="icon" aria-hidden="true"><use href="#icon-clock"></use></svg> ' + timeStr}
              </div>
            </div>

            <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; text-align: center; ${isCancelled ? 'filter: grayscale(100%);' : ''}">
              <div style="color: #e0e6f0; font-size: 0.95em; font-weight: 600; margin-bottom: ${hasStarted && match.score ? '5px' : '8px'}; line-height: 1.3;">
                ${shouldUnderlineTeam1 ? `<span style="position: relative; display: inline-block;">${match.team1}<span style="position: absolute; bottom: -2px; left: 0; right: 0; height: 2px; background: #4caf50;"></span></span>` : match.team1}
              </div>

              ${hasStarted && match.score ? `
                <div style="color: #4caf50; font-size: 1.3em; font-weight: 700; margin-bottom: 5px;">
                  ${match.score}
                </div>
              ` : `
                <div style="color: #7ab0e0; font-size: 0.8em; margin-bottom: 8px;">
                  vs
                </div>
              `}

              <div style="color: #e0e6f0; font-size: 0.95em; font-weight: 600; line-height: 1.3;">
                ${shouldUnderlineTeam2 ? `<span style="position: relative; display: inline-block;">${match.team2}<span style="position: absolute; bottom: -2px; left: 0; right: 0; height: 2px; background: #4caf50;"></span></span>` : match.team2}
              </div>
            </div>
          </div>
        `;
      }

      html += '</div>';
    }

    html += `
      <div id="completedDaysContainer" style="margin-top: 30px; border-top: 2px solid rgba(255, 255, 255, 0.1); padding-top: 20px;">
        <!-- Завершенные матчи загружаются отдельно -->
      </div>
    `;

    html += `
      <div style="margin-top: 30px; text-align: center;">
        <button onclick="backToLiveEvents()" style="padding: 10px 20px; background: rgba(90, 159, 212, 0.2); color: #7ab0e0; border: 1px solid rgba(90, 159, 212, 0.5); border-radius: 5px; cursor: pointer; font-size: 1em; transition: all 0.3s ease;" onmouseover="this.style.background='rgba(90, 159, 212, 0.3)'" onmouseout="this.style.background='rgba(90, 159, 212, 0.2)'">
          ← Назад к LIVE турнирам
        </button>
      </div>
    `;

    const existingCompletedDaysContainer = document.getElementById('completedDaysContainer');
    const savedCompletedDaysHTML = existingCompletedDaysContainer ? existingCompletedDaysContainer.innerHTML : null;

    container.innerHTML = html;

    if (savedCompletedDaysHTML) {
      const newCompletedDaysContainer = document.getElementById('completedDaysContainer');
      if (newCompletedDaysContainer) {
        newCompletedDaysContainer.innerHTML = savedCompletedDaysHTML;
        console.log('✅ Восстановлено содержимое completedDaysContainer');
      }
    }

    const isFirstLoad = !completedDaysData || !savedCompletedDaysHTML;
    if (isFirstLoad) {
      setCompletedDaysData(null);
      loadCompletedDays(eventId, true);
    }

    updateFavoriteStars();
    updateFavoriteMatchesData(todayMatches);

    if (currentUser) {
      console.log('🔄 Запуск polling после загрузки LIVE матчей');
      pollFavoriteMatches();
    }

  } catch (error) {
    console.error('Ошибка при загрузке матчей турнира:', error);
    container.innerHTML = `
      <div class="empty-message" style="color: #f44336;">
        Ошибка при загрузке матчей: ${error.message}
      </div>

      <div style="margin-top: 30px; text-align: center;">
        <button onclick="backToLiveEvents()" style="padding: 10px 20px; background: rgba(90, 159, 212, 0.2); color: #7ab0e0; border: 1px solid rgba(90, 159, 212, 0.5); border-radius: 5px; cursor: pointer; font-size: 1em; transition: all 0.3s ease;" onmouseover="this.style.background='rgba(90, 159, 212, 0.3)'" onmouseout="this.style.background='rgba(90, 159, 212, 0.2)'">
          ← Назад к LIVE турнирам
        </button>
      </div>
    `;
  }
}

function backToLiveEvents() {
  setCurrentLiveEventId(null);
  localStorage.removeItem('currentLiveEventId');
  loadLiveMatches();
}

async function loadCompletedDays(eventId, forceReload = false) {
  try {
    let openSections = null;
    if (completedDaysData && !forceReload) {
      openSections = new Set();
      completedDaysData.completedDays?.forEach(day => {
        const dayId = `day-${day.date}`;
        const container = document.getElementById(`${dayId}Container`);
        if (container && container.style.display !== 'none') {
          openSections.add(dayId);
        }
      });
    }

    if (forceReload || !completedDaysData) {
      completedDaysOffset = 0; // Сбрасываем пагинацию при перезагрузке данных
      const response = await fetch(`/api/yesterday-matches?eventId=${eventId}`);
      if (!response.ok) {
        throw new Error(`Ошибка: ${response.status}`);
      }

      const data = await response.json();
      setCompletedDaysData(data);

      console.log('📥 Загружены завершенные дни:', completedDaysData.completedDays?.length || 0);
    }

    renderCompletedDays(eventId, openSections);

  } catch (error) {
    console.error('Ошибка загрузки завершенных дней:', error);
  }
}

// Количество завершённых дней, показываемых по умолчанию
const COMPLETED_DAYS_LIMIT = 5;
// Текущий сдвиг для показа дополнительных завершённых дней
let completedDaysOffset = 0;

function renderCompletedDays(eventId, savedOpenSections = null) {
  if (!completedDaysData) return;

  const completedDays = completedDaysData.completedDays || [];
  const container = document.getElementById('completedDaysContainer');
  if (!container) return;

  if (completedDays.length === 0) {
    container.innerHTML = '';
    return;
  }

  let openSections = savedOpenSections;
  if (!openSections) {
    openSections = new Set();
    completedDays.forEach(day => {
      const dayId = `day-${day.date}`;
      const dayContainer = document.getElementById(`${dayId}Container`);
      if (dayContainer && dayContainer.style.display !== 'none') {
        openSections.add(dayId);
      }
    });
  }

  // Ограничиваем количество отображаемых дней
  // completedDays отсортированы от новых к старым (или наоборот) — берём последние (самые свежие)
  const totalDays = completedDays.length;
  const showCount = COMPLETED_DAYS_LIMIT + completedDaysOffset;
  const hasMoreDays = totalDays > showCount;
  // Показываем первые showCount дней (самые свежие идут первыми)
  const visibleDays = completedDays.slice(0, showCount);

  let html = '';

  for (const day of visibleDays) {
    const dayDate = new Date(day.date + 'T00:00:00');
    const dateStr = dayDate.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
    const dayId = `day-${day.date}`;
    const matchCount = day.matches?.length || 0;

    const wasOpen = openSections.has(dayId);
    const displayStyle = wasOpen ? 'block' : 'none';
    const iconText = wasOpen ? '▲' : '▼';

    html += `
      <div style="margin-bottom: 20px;">
        <p onclick="toggleCompletedDay('${dayId}', ${eventId})" style="
          color: #b0b8c8;
          font-size: 0.9em;
          margin-bottom: 15px;
          cursor: pointer;
          transition: color 0.3s ease;
          user-select: none;
        " onmouseover="this.style.color='#e0e6f0'" onmouseout="this.style.color='#b0b8c8'">
          <span id="${dayId}Icon" style="display: inline-block; transition: transform 0.3s; ${wasOpen ? 'transform: rotate(180deg);' : ''}">${iconText}</span>
          <svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> Завершенные матчи: ${dateStr}
          <span style="color: #7ab0e0; font-size: 0.85em;">(${matchCount})</span>
        </p>
        <div id="${dayId}Container" style="display: ${displayStyle};" data-date="${day.date}"></div>
      </div>
    `;
  }

  container.innerHTML = html;

  // Кнопка "Ранее" — показывается если есть скрытые дни, размещается после всех дней
  if (hasMoreDays) {
    html += `
      <div style="text-align: center; margin-top: 5px;">
        <button 
          onclick="showMoreCompletedDays(${eventId})" 
          style="background: transparent; border: none; color: #7ab0e0; padding: 4px 8px; cursor: pointer; font-size: 0.85em;"
        >
          <svg class="icon" aria-hidden="true"><use href="#icon-clock"></use></svg> Ранее
        </button>
      </div>
    `;
    container.innerHTML = html;
  }

  openSections.forEach(dayId => {
    completedDaysLoaded[dayId] = false;
    const dayContainer = document.getElementById(`${dayId}Container`);
    if (dayContainer) {
      renderCompletedDayMatches(dayId);
    }
  });
}

// Показать ещё завершённые дни (кнопка "Ранее")
function showMoreCompletedDays(eventId) {
  completedDaysOffset += COMPLETED_DAYS_LIMIT;
  renderCompletedDays(eventId);
}

function renderCompletedDayMatches(dayId) {
  const container = document.getElementById(`${dayId}Container`);
  if (!container) return;

  if (!completedDaysData) {
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #f44336;">Данные не загружены</div>';
    return;
  }

  const completedDays = completedDaysData.completedDays || [];
  const dayDate = container.getAttribute('data-date');
  const dayData = completedDays.find(d => d.date === dayDate);

  if (!dayData || dayData.matches.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #b0b8c8;">Нет матчей</div>';
    return;
  }

  let html = '<div class="live-matches-grid">';

  for (const match of dayData.matches) {
    const matchTime = new Date(match.match_date);
    const timeStr = matchTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const dateStr = matchTime.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

    let betTeam = null;
    if (currentUser && currentUser.bets) {
      const bet = currentUser.bets.find(b => b.match_id === match.id);
      if (bet) betTeam = bet.prediction;
    }

    const isDraw = betTeam && (betTeam.toLowerCase() === 'ничья' || betTeam.toLowerCase() === 'draw');
    const shouldUnderlineTeam1 = (betTeam === match.team1_name || isDraw);
    const shouldUnderlineTeam2 = (betTeam === match.team2_name || isDraw);

    const hasScore = (match.team1_score !== null && match.team1_score !== undefined &&
                     match.team2_score !== null && match.team2_score !== undefined);

    let resultDisplay = '';
    if (hasScore) {
      resultDisplay = `<div style="color: #4caf50; font-size: 1.3em; font-weight: 700; margin-bottom: 5px;">${match.team1_score}:${match.team2_score}</div>`;
    } else if (match.winner === 'team1') {
      resultDisplay = `<div style="color: #4caf50; font-size: 1.1em; font-weight: 700; margin-bottom: 5px; word-spacing: 0.2em;">Победа ${match.team1_name}</div>`;
    } else if (match.winner === 'team2') {
      resultDisplay = `<div style="color: #4caf50; font-size: 1.1em; font-weight: 700; margin-bottom: 5px; word-spacing: 0.2em;">Победа ${match.team2_name}</div>`;
    } else if (match.winner === 'draw') {
      resultDisplay = `<div style="color: #4caf50; font-size: 1.1em; font-weight: 700; margin-bottom: 5px;">Ничья</div>`;
    } else {
      resultDisplay = `<div style="color: #888; font-size: 0.9em; margin-bottom: 5px;">vs</div>`;
    }

    const matchData = {
      id: match.sstats_match_id,
      dbId: match.id,
      team1: match.team1_name,
      team2: match.team2_name,
      score: hasScore ? `${match.team1_score}:${match.team2_score}` : null,
      status: 'finished',
      match_time: match.match_date,
      elapsed: 90
    };

    html += `
      <div class="live-match-card" onclick='showLiveTeamStats(${JSON.stringify(matchData).replace(/'/g, "\\'")})'  style="
        background: rgba(255, 255, 255, 0.05);
        border: 2px solid #4caf50;
        border-radius: 8px;
        padding: 15px;
        transition: all 0.3s ease;
        position: relative;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        min-height: 180px;
        opacity: 0.8;
        cursor: pointer;
      " onmouseover="this.style.transform='translateY(-5px)'; this.style.opacity='1';" onmouseout="this.style.transform='translateY(0)'; this.style.opacity='0.8';">

        <div style="text-align: center; margin-bottom: 10px;">
          <div style="color: #4caf50; font-size: 0.85em; font-weight: 600;">
            <svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Завершен • ${dateStr} ${timeStr}
          </div>
        </div>

        <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; text-align: center;">
          <div style="color: #e0e6f0; font-size: 0.95em; font-weight: 600; margin-bottom: 5px; line-height: 1.3;">
            ${shouldUnderlineTeam1 ? `<span style="position: relative; display: inline-block;">${match.team1_name}<span style="position: absolute; bottom: -2px; left: 0; right: 0; height: 2px; background: #4caf50;"></span></span>` : match.team1_name}
          </div>

          ${resultDisplay}

          <div style="color: #e0e6f0; font-size: 0.95em; font-weight: 600; line-height: 1.3;">
            ${shouldUnderlineTeam2 ? `<span style="position: relative; display: inline-block;">${match.team2_name}<span style="position: absolute; bottom: -2px; left: 0; right: 0; height: 2px; background: #4caf50;"></span></span>` : match.team2_name}
          </div>
        </div>
      </div>
    `;
  }

  html += '</div>';
  container.innerHTML = html;
  completedDaysLoaded[dayId] = true;
}

async function toggleCompletedDay(dayId, eventId) {
  const container = document.getElementById(`${dayId}Container`);
  const icon = document.getElementById(`${dayId}Icon`);

  if (!container || !icon) return;

  if (container.style.display === 'none') {
    container.style.display = 'block';
    icon.textContent = '▲';
    icon.style.transform = 'rotate(180deg)';

    if (!completedDaysLoaded[dayId]) {
      container.innerHTML = '<div style="text-align: center; padding: 20px; color: #b0b8c8;">Загрузка...</div>';
      renderCompletedDayMatches(dayId);
    }
  } else {
    container.style.display = 'none';
    icon.textContent = '▼';
    icon.style.transform = 'rotate(0deg)';
  }
}

// Показать/скрыть завершенные матчи предыдущего дня (старая функция — оставляем для совместимости)
let yesterdayMatchesLoaded = false;
async function toggleYesterdayMatches(eventId) {
  const container = document.getElementById('yesterdayMatchesContainer');
  const btn = document.getElementById('toggleYesterdayBtn');
  const icon = document.getElementById('yesterdayBtnIcon');

  if (container.style.display === 'none') {
    container.style.display = 'block';
    icon.textContent = '▲';

    if (!yesterdayMatchesLoaded) {
      container.innerHTML = '<div style="text-align: center; padding: 20px; color: #b0b8c8;">Загрузка...</div>';

      try {
        const response = await fetch(`/api/yesterday-matches?eventId=${eventId}`);
        if (!response.ok) throw new Error(`Ошибка: ${response.status}`);

        const data = await response.json();
        const matches = data.matches || [];

        if (matches.length === 0) {
          container.innerHTML = '<div style="text-align: center; padding: 20px; color: #b0b8c8;">Нет завершенных матчей за предыдущий день</div>';
        } else {
          let html = '<div class="live-matches-grid">';

          for (const match of matches) {
            const matchTime = new Date(match.match_date);
            const timeStr = matchTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            const dateStr = matchTime.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

            let betTeam = null;
            if (currentUser && currentUser.bets) {
              const bet = currentUser.bets.find(b => b.match_id === match.id);
              if (bet) betTeam = bet.prediction;
            }

            const isDraw = betTeam && (betTeam.toLowerCase() === 'ничья' || betTeam.toLowerCase() === 'draw');
            const shouldUnderlineTeam1 = (betTeam === match.team1_name || isDraw);
            const shouldUnderlineTeam2 = (betTeam === match.team2_name || isDraw);

            const hasScore = (match.team1_score !== null && match.team1_score !== undefined &&
                             match.team2_score !== null && match.team2_score !== undefined);

            let resultDisplay = '';
            if (hasScore) {
              resultDisplay = `<div style="color: #4caf50; font-size: 1.3em; font-weight: 700; margin-bottom: 5px;">${match.team1_score}:${match.team2_score}</div>`;
            } else if (match.winner === 'team1') {
              resultDisplay = `<div style="color: #4caf50; font-size: 1.1em; font-weight: 700; margin-bottom: 5px;">Победа ${match.team1_name}</div>`;
            } else if (match.winner === 'team2') {
              resultDisplay = `<div style="color: #4caf50; font-size: 1.1em; font-weight: 700; margin-bottom: 5px;">Победа ${match.team2_name}</div>`;
            } else if (match.winner === 'draw') {
              resultDisplay = `<div style="color: #4caf50; font-size: 1.1em; font-weight: 700; margin-bottom: 5px;">Ничья</div>`;
            } else {
              resultDisplay = `<div style="color: #888; font-size: 0.9em; margin-bottom: 5px;">vs</div>`;
            }

            const matchData = {
              id: match.sstats_match_id,
              dbId: match.id,
              team1: match.team1_name,
              team2: match.team2_name,
              score: hasScore ? `${match.team1_score}:${match.team2_score}` : null,
              status: 'finished',
              match_time: match.match_date,
              elapsed: 90
            };

            html += `
              <div class="live-match-card" onclick='showLiveTeamStats(${JSON.stringify(matchData).replace(/'/g, "\\'")})'  style="
                background: rgba(255, 255, 255, 0.05);
                border: 2px solid #4caf50;
                border-radius: 8px;
                padding: 15px;
                transition: all 0.3s ease;
                position: relative;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                min-height: 180px;
                opacity: 0.8;
                cursor: pointer;
              " onmouseover="this.style.transform='translateY(-5px)'; this.style.opacity='1';" onmouseout="this.style.transform='translateY(0)'; this.style.opacity='0.8';">

                <div style="text-align: center; margin-bottom: 10px;">
                  <div style="color: #4caf50; font-size: 0.85em; font-weight: 600;">
                    <svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Завершен • ${dateStr} ${timeStr}
                  </div>
                </div>

                <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; text-align: center;">
                  <div style="color: #e0e6f0; font-size: 0.95em; font-weight: 600; margin-bottom: 5px; line-height: 1.3;">
                    ${shouldUnderlineTeam1 ? `<span style="position: relative; display: inline-block;">${match.team1_name}<span style="position: absolute; bottom: -2px; left: 0; right: 0; height: 2px; background: #4caf50;"></span></span>` : match.team1_name}
                  </div>

                  ${resultDisplay}

                  <div style="color: #e0e6f0; font-size: 0.95em; font-weight: 600; line-height: 1.3;">
                    ${shouldUnderlineTeam2 ? `<span style="position: relative; display: inline-block;">${match.team2_name}<span style="position: absolute; bottom: -2px; left: 0; right: 0; height: 2px; background: #4caf50;"></span></span>` : match.team2_name}
                  </div>
                </div>
              </div>
            `;
          }

          html += '</div>';
          container.innerHTML = html;
        }

        yesterdayMatchesLoaded = true;
      } catch (error) {
        console.error('Ошибка загрузки завершенных матчей:', error);
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #f44336;">Ошибка загрузки матчей</div>';
      }
    }
  } else {
    container.style.display = 'none';
    icon.textContent = '▼';
  }
}

// ===== АВТООБНОВЛЕНИЕ LIVE МАТЧЕЙ =====
let liveMatchesUpdateInterval = null;

function startLiveMatchesAutoUpdate() {
  if (liveMatchesUpdateInterval) {
    clearInterval(liveMatchesUpdateInterval);
  }

  liveMatchesUpdateInterval = setInterval(() => {
    const activeTab = document.querySelector('.tab-btn.active');
    if (!activeTab || !activeTab.textContent.includes('LIVE')) {
      stopLiveMatchesAutoUpdate();
      return;
    }

    if (currentLiveEventId) {
      console.log('🔄 Автообновление матчей турнира:', currentLiveEventId);
      showLiveEventMatches(currentLiveEventId);
    } else {
      console.log('🔄 Автообновление списка LIVE турниров');
      loadLiveMatches();
    }

    if (currentUser) {
      pollFavoriteMatches();
    }
  }, 30000);

  console.log('✅ Автообновление LIVE матчей запущено');
}

function stopLiveMatchesAutoUpdate() {
  if (liveMatchesUpdateInterval) {
    clearInterval(liveMatchesUpdateInterval);
    liveMatchesUpdateInterval = null;
    console.log('⏹ Автообновление LIVE матчей остановлено');
  }
}

export {
  loadLiveMatches,
  showLiveEventMatches,
  backToLiveEvents,
  loadCompletedDays,
  renderCompletedDays,
  renderCompletedDayMatches,
  toggleCompletedDay,
  toggleYesterdayMatches,
  showMoreCompletedDays,
  startLiveMatchesAutoUpdate,
  stopLiveMatchesAutoUpdate,
};
