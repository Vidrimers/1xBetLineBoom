import { currentUser } from './state.js';
import * as state from './state.js';
import { setTournamentParticipantsInterval } from './state.js';

// ===== УЧАСТНИКИ =====

export async function loadParticipants() {
  try {
    const response = await fetch("/api/participants");
    const participants = await response.json();
    console.log("📊 Загруженные участники:", participants);
    displayParticipants(participants);
  } catch (error) {
    console.error("Ошибка при загрузке участников:", error);
    document.getElementById("participantsList").innerHTML =
      '<div class="empty-message">Ошибка при загрузке участников</div>';
  }
}

// Отобразить участников
export function displayParticipants(participants) {
  const participantsList = document.getElementById("participantsList");

  // Обновляем заголовок с количеством участников
  const participantsHeader = document.getElementById('participantsHeader');
  if (participantsHeader) {
    participantsHeader.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#icon-participants"></use></svg> Всего участников: ${participants.length}`;
  }

  if (participants.length === 0) {
    participantsList.innerHTML =
      '<div class="empty-message">Участники не найдены</div>';
    return;
  }

  // Сортируем по сумме весов выигранных турниров, затем по количеству побед, затем по имени
  const sortedParticipants = [...participants].sort((a, b) => {
    const aWeight = a.total_weight || 0;
    const bWeight = b.total_weight || 0;
    
    if (bWeight !== aWeight) {
      return bWeight - aWeight; // Больше суммарный вес → выше
    }

    // При равном весе — больше побед в турнирах → выше
    const aWins = (a.won_icons || []).length;
    const bWins = (b.won_icons || []).length;
    if (bWins !== aWins) {
      return bWins - aWins;
    }
    
    // При равном количестве побед — по имени (алфавитный порядок)
    return a.username.localeCompare(b.username, 'ru');
  });

  // Вычисляем места с учетом одинаковых показателей
  const placesMap = new Map();
  let currentPlace = 1;
  
  sortedParticipants.forEach((participant, index) => {
    if (index === 0) {
      placesMap.set(index, 1);
    } else {
      const prev = sortedParticipants[index - 1];
      const currentWeight = participant.total_weight || 0;
      const prevWeight = prev.total_weight || 0;
      const currentWins = (participant.won_icons || []).length;
      const prevWins = (prev.won_icons || []).length;
      
      // Если суммарный вес и количество побед одинаковые - то же место
      if (currentWeight === prevWeight && currentWins === prevWins) {
        placesMap.set(index, placesMap.get(index - 1));
      } else {
        currentPlace = index + 1;
        placesMap.set(index, currentPlace);
      }
    }
  });

  participantsList.innerHTML = sortedParticipants
    .map((participant, index) => {
      const place = placesMap.get(index);
      // Формируем трофеи из иконок турниров
      const wonIcons = participant.won_icons || [];
      let trophies = "";
      if (wonIcons.length > 0) {
        const iconCounts = {};
        wonIcons.forEach((icon) => {
          iconCounts[icon] = (iconCounts[icon] || 0) + 1;
        });
        trophies = Object.entries(iconCounts)
          .map(([icon, count]) => {
            const displayIcon = icon.startsWith("img/")
              ? `<img src="${icon}" alt="trophy" class="tournament-icon">`
              : icon;
            return count > 1 ? `<span>${displayIcon}x${count}</span>` : displayIcon;
          })
          .join(" ");
      }

      return `
    <div class="participant-item " onclick="showUserProfile(${
      participant.id
    }, '${participant.username.replace(/'/g, "\\'")}')">
      <div class="participant-rank">#${place}</div>
      <img src="${participant.avatar || "img/default-avatar.jpg"}" alt="${
        participant.username
      }" class="participant-avatar" />
      <div class="participant-info">
        <div class="participant-name">${participant.username}</div>
        ${
          wonIcons.length > 0
            ? `<div class="participant-tournaments">Победы в турнирах: ${trophies}</div>`
            : ""
        }
        <div class="participant-stats">
          <span>Ставок за всё время: ${participant.total_bets || 0} |</span>
          <span>Угаданных ставок за всё время: ${participant.won_count || 0} |</span>
          <span>Неугаданных ставок за всё время: ${participant.lost_bets || 0} |</span>
          <span>В ожидании: ${participant.pending_bets || 0}</span>
        </div>
      </div>
    </div>
`;
    })
    .join("");
}

// ===== ТУРНИРЫ =====

export async function loadTournamentsList() {
  try {
    const response = await fetch("/api/events");
    const events = await response.json();
    displayTournaments(events);

    // Загружаем участников за всё время
    await loadParticipants();
  } catch (error) {
    console.error("Ошибка при загрузке турниров:", error);
    document.getElementById("eventsGrid").innerHTML =
      '<div class="empty-message">Ошибка при загрузке турниров</div>';
  }
}

export async function displayTournaments(events) {
  const eventsGrid = document.getElementById("eventsGrid");

  if (events.length === 0) {
    eventsGrid.innerHTML =
      '<div class="empty-message">Турниры не найдены</div>';
    return;
  }

  const now = new Date();

  // Разделяем события на категории
  const upcomingEvents = events.filter((event) => {
    if (event.locked_reason) return false;
    if (!event.start_date) return true; // Если нет даты начала, считаем предстоящим
    return new Date(event.start_date) > now;
  });

  const activeEvents = events.filter((event) => {
    if (event.locked_reason) return false;
    if (!event.start_date) return false;
    return new Date(event.start_date) <= now;
  });

  const lockedEvents = events.filter((event) => event.locked_reason);

  // Для каждого события загружаем дополнительные данные если оно заблокировано
  const activeCards = await Promise.all(
    activeEvents.map(async (event) => {
      const iconHtml =
        event.icon && event.icon.startsWith("img/")
          ? `<img class="event-icon" src="${event.icon}" alt="icon"/>`
          : event.icon || '<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg>';
      return `
    <div class="event-card" onclick="loadTournamentParticipants(${
      event.id
    }, '${event.name.replace(/'/g, "\\'")}')">
      <div class="event-card-title">${iconHtml} ${event.name}</div>
      <div class="event-card-count">Матчей: ${event.match_count || 0}</div>
    </div>
  `;
    })
  );

  const upcomingCards = await Promise.all(
    upcomingEvents.map(async (event) => {
      const iconHtml =
        event.icon && event.icon.startsWith("img/")
          ? `<img class="event-icon" src="${event.icon}" alt="icon"/>`
          : event.icon || '<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg>';
      
      const startDateText = event.start_date 
        ? `<div class="event-card-start-date"><svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> Начало: ${new Date(event.start_date).toLocaleDateString('ru-RU')}</div>`
        : '';
      
      return `
    <div class="event-card upcoming" onclick="loadTournamentParticipants(${
      event.id
    }, '${event.name.replace(/'/g, "\\'")}')">
      <div class="event-card-title">${iconHtml} ${event.name}</div>
      <div class="event-card-count">Матчей: ${event.match_count || 0}</div>
      ${startDateText}
    </div>
  `;
    })
  );

  const lockedCards = await Promise.all(
    lockedEvents.map(async (event) => {
      let winnerInfo = "";

      // Загружаем победителя
      try {
        const response = await fetch(
          `/api/events/${event.id}/tournament-participants`
        );
        const participants = await response.json();

        if (participants.length > 0) {
          // Сортируем по выигранным ставкам
          const winner = participants.sort(
            (a, b) => (b.event_won || 0) - (a.event_won || 0)
          )[0];
          winnerInfo = `<div class="event-card-winner"><svg class="icon" aria-hidden="true"><use href="#icon-crown"></use></svg> Победитель: <strong>${winner.username}</strong></div>`;
        }
      } catch (error) {
        console.error("Ошибка при загрузке участников турнира:", error);
      }

      const iconHtml =
        event.icon && event.icon.startsWith("img/")
          ? `<img class="event-icon" src="${event.icon}" alt="icon"/>`
          : event.icon || '<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg>';

      return `
    <div class="event-card locked" onclick="loadTournamentParticipants(${
      event.id
    }, '${event.name.replace(/'/g, "\\'")}')">
      <div class="event-card-title">${iconHtml} ${event.name}</div>
      <div class="event-card-count">Матчей: ${event.match_count || 0}</div>
      <div class="event-card-locked"><svg class="icon" aria-hidden="true"><use href="#icon-hidden"></use></svg> ${
        event.locked_reason
      }</div>${winnerInfo}
    </div>
  `;
    })
  );

  // Формируем итоговый HTML с разделителями
  let html = "";

  if (activeCards.length > 0) {
    html +=
      '<div class="tournaments-section-divider">ДЕЙСТВУЮЩИЕ ТУРНИРЫ</div>';
    html += activeCards.join("");
  }

  if (upcomingCards.length > 0) {
    html +=
      '<div class="tournaments-section-divider">ПРЕДСТОЯЩИЕ ТУРНИРЫ</div>';
    html += upcomingCards.join("");
  }

  if (lockedCards.length > 0) {
    html +=
      '<div class="tournaments-section-divider">ЗАВЕРШЕННЫЕ ТУРНИРЫ</div>';
    html += lockedCards.join("");
  }

  eventsGrid.innerHTML = html;
}

export async function loadTournamentParticipants(eventId, eventName) {
  try {
    // Останавливаем предыдущий интервал если есть
    stopTournamentParticipantsPolling();
    
    // Получаем информацию о событии, чтобы узнать, заблокировано ли оно
    const eventsResponse = await fetch("/api/events");
    const events = await eventsResponse.json();
    const currentEvent = events.find((e) => e.id === eventId);
    const isLocked =
      currentEvent?.locked_reason !== null &&
      currentEvent?.locked_reason !== undefined;

    const response = await fetch(
      `/api/events/${eventId}/tournament-participants`
    );
    const participants = await response.json();

    // Сохраняем eventId для дальнейшего использования
    window.currentEventId = eventId;
    window.currentEventName = eventName;
    window.currentEventIsLocked = isLocked;

    // Загружаем информацию о сетке для проверки даты начала
    let bracketStartDate = null;
    try {
      const brackets = await loadBracketsForEvent(eventId);
      if (brackets && brackets.length > 0) {
        bracketStartDate = brackets[0].start_date;
      }
    } catch (error) {
      console.error('Ошибка загрузки информации о сетке:', error);
    }
    
    window.currentBracketStartDate = bracketStartDate;

    // Скрываем section с сеткой турниров и показываем участников турнира
    document.getElementById("tournamentsSection").style.display = "none";
    document.getElementById("tournamentSection").style.display = "block";
    document.getElementById("tournamentTitle").innerHTML = `<svg class="icon" aria-hidden="true"><use href="#icon-members"></use></svg> ${eventName}`;

    await displayTournamentParticipants(participants, isLocked, eventId, bracketStartDate);
    
    // Запускаем автообновление
    startTournamentParticipantsPolling();
  } catch (error) {
    console.error("Ошибка при загрузке участников турнира:", error);
    document.getElementById("tournamentParticipantsList").innerHTML =
      '<div class="empty-message">Ошибка при загрузке участников турнира</div>';
  }
}

// Запустить автообновление рейтинга участников
export function startTournamentParticipantsPolling() {
  stopTournamentParticipantsPolling();
  
  setTournamentParticipantsInterval(setInterval(async () => {
    if (!window.currentEventId) {
      stopTournamentParticipantsPolling();
      return;
    }
    
    try {
      const response = await fetch(`/api/events/${window.currentEventId}/tournament-participants`);
      const participants = await response.json();
      await displayTournamentParticipants(
        participants, 
        window.currentEventIsLocked, 
        window.currentEventId, 
        window.currentBracketStartDate
      );
    } catch (error) {
      console.error('Ошибка автообновления рейтинга:', error);
    }
  }, 30000)); // Обновление каждые 30 секунд
  
  console.log('✅ Запущено автообновление рейтинга участников');
}

// Остановить автообновление рейтинга участников
export function stopTournamentParticipantsPolling() {
  if (state.tournamentParticipantsInterval) {
    clearInterval(state.tournamentParticipantsInterval);
    setTournamentParticipantsInterval(null);
    console.log('⏹ Остановлено автообновление рейтинга участников');
  }
}

// Вычислить максимальную серию угаданных ставок подряд для пользователя в турнире
export async function calculateMaxWinStreak(userId, eventId) {
  try {
    const response = await fetch(`/api/event/${eventId}/participant/${userId}/bets`);
    if (!response.ok) return 0;
    
    const { bets } = await response.json();
    if (!bets || bets.length === 0) return 0;
    
    // Сортируем ставки по дате матча
    const sortedBets = bets.sort((a, b) => new Date(a.match_date) - new Date(b.match_date));
    
    let maxStreak = 0;
    let currentStreak = 0;
    
    for (const bet of sortedBets) {
      // Проверяем только завершенные ставки
      if (bet.winner === null && !bet.final_result) continue;
      
      let isWin = false;
      
      // Обычные ставки
      if (!bet.is_final_bet && bet.winner) {
        isWin = (bet.prediction === 'team1' && bet.winner === 'team1') ||
                (bet.prediction === 'team2' && bet.winner === 'team2') ||
                (bet.prediction === 'draw' && bet.winner === 'draw') ||
                (bet.prediction === bet.team1_name && bet.winner === 'team1') ||
                (bet.prediction === bet.team2_name && bet.winner === 'team2');
      }
      // Финальные параметры
      else if (bet.is_final_bet && bet.final_result !== undefined) {
        isWin = String(bet.prediction) === String(bet.final_result);
      }
      
      if (isWin) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
    
    return maxStreak;
  } catch (error) {
    console.error('Ошибка при вычислении серии побед:', error);
    return 0;
  }
}

export async function displayTournamentParticipants(
  participants,
  isLocked = false,
  eventId = null,
  bracketStartDate = null
) {
  const tournamentParticipantsList = document.getElementById(
    "tournamentParticipantsList"
  );

  if (participants.length === 0) {
    tournamentParticipantsList.innerHTML =
      '<div class="empty-message">Участники не найдены</div>';
    return;
  }

  // Проверяем наличие сетки плей-офф для этого турнира
  let hasBracket = false;
  let brackets = null;
  if (eventId) {
    try {
      brackets = await loadBracketsForEvent(eventId);
      hasBracket = brackets && brackets.length > 0;
      // Если дата не была передана, получаем её из загруженной сетки
      if (!bracketStartDate && hasBracket) {
        bracketStartDate = brackets[0].start_date;
      }
    } catch (error) {
      console.error('Ошибка проверки наличия сетки:', error);
    }
  }

  // Проверяем, началась ли сетка плей-офф
  let isBracketStarted = false;
  if (hasBracket && brackets && brackets.length > 0) {
    const bracket = brackets[0];
    const now = new Date();
    
    // Проверяем lock_dates для каждой стадии
    if (bracket.lock_dates) {
      try {
        const lockDates = typeof bracket.lock_dates === 'string' 
          ? JSON.parse(bracket.lock_dates) 
          : bracket.lock_dates;
        
        // Проверяем все стадии - если хотя бы одна еще не началась, сетка считается не начавшейся
        const allStagesStarted = Object.values(lockDates).every(dateStr => {
          const stageDate = new Date(dateStr);
          return now >= stageDate;
        });
        
        isBracketStarted = allStagesStarted;
      } catch (e) {
        console.error('Ошибка парсинга lock_dates:', e);
        // Fallback на старую логику
        if (bracketStartDate) {
          const startDate = new Date(bracketStartDate);
          isBracketStarted = now >= startDate;
        }
      }
    } else if (bracketStartDate) {
      // Если нет lock_dates, используем start_date
      const startDate = new Date(bracketStartDate);
      isBracketStarted = now >= startDate;
    }
  }

  // Получаем максимальные серии для всех участников
  const participantsWithStreaks = await Promise.all(
    participants.map(async (participant) => {
      const maxStreak = await calculateMaxWinStreak(participant.id, eventId);
      return { ...participant, max_win_streak: maxStreak };
    })
  );

  // Сортируем по выигранным ставкам в турнире в убывающем порядке
  const sortedParticipants = [...participantsWithStreaks].sort((a, b) => {
    // Сначала по очкам
    if ((b.event_won || 0) !== (a.event_won || 0)) {
      return (b.event_won || 0) - (a.event_won || 0);
    }
    // При равенстве очков - по максимальной серии побед подряд
    if ((b.max_win_streak || 0) !== (a.max_win_streak || 0)) {
      return (b.max_win_streak || 0) - (a.max_win_streak || 0);
    }
    // При равенстве серий - по проигрышам (меньше = выше)
    return (a.event_lost || 0) - (b.event_lost || 0);
  });

  // Вычисляем места с учетом одинаковых показателей
  const placesMap = new Map();
  let currentPlace = 1;
  
  sortedParticipants.forEach((participant, index) => {
    if (index === 0) {
      placesMap.set(index, 1);
    } else {
      const prev = sortedParticipants[index - 1];
      // Если все критерии сортировки одинаковые - то же место
      if (participant.event_won === prev.event_won && 
          participant.max_win_streak === prev.max_win_streak && 
          participant.event_lost === prev.event_lost) {
        placesMap.set(index, placesMap.get(index - 1));
      } else {
        // Следующее место учитывает количество участников на предыдущем месте
        currentPlace = index + 1;
        placesMap.set(index, currentPlace);
      }
    }
  });

  tournamentParticipantsList.innerHTML = sortedParticipants
    .map((participant, index) => {
      const place = placesMap.get(index);
      const totalParticipants = sortedParticipants.length;
      let emoji = '<svg class="icon" aria-hidden="true"><use href="#icon-place-mid"></use></svg>'; // нейтральное для середины

      if (place === 1) {
        emoji = '<svg class="icon" aria-hidden="true"><use href="#icon-place-1"></use></svg>'; // первое место
      } else if (index === totalParticipants - 1 && totalParticipants > 1 && place !== 1) {
        emoji = '<svg class="icon" aria-hidden="true"><use href="#icon-place-last"></use></svg>'; // последнее место
      }

      // Добавляем класс 'winner' если это заблокированный турнир и первое место
      const winnerClass = isLocked && place === 1 ? "winner" : "";

      // Кнопка сетки плей-офф показывается только если сетка существует
      // Проверяем настройки приватности пользователя
      const showBets = participant.show_bets || 'always';
      const isPrivate = showBets === 'after_start' && !isBracketStarted; // Показываем замок только если сетка еще не началась
      
      const bracketButton = hasBracket ? `
      <button class="round-filter-btn bracket-filter-btn modal-bracket-filter-btn" 
              onclick="event.stopPropagation(); showUserBracketPredictionsInline(${participant.id}, '${participant.username.replace(/'/g, "\\'")}');" 
              title="${isPrivate ? 'Сетка плей-офф (прогнозы скрыты до начала)' : 'Сетка плей-офф'}"
              style="margin-left: 10px; font-size: 0.9em;
              background: transparent !important;
              color: #b0b8c8 !important;
              box-shadow: none !important;
              border: 1px solid #3a7bd5 !important;">
        ${isPrivate ? '<svg class="icon" aria-hidden="true"><use href="#icon-hidden"></use></svg> ' : ''}Сетка плей-офф
      </button>` : '';

      return `
    <div class="participant-item events-participant-item ${winnerClass}" onclick="showTournamentParticipantBets(${
        participant.id
      }, '${participant.username.replace(/'/g, "\\'")}', ${eventId})" style="cursor: pointer;">
      <div class="participant-rank participant-rank-events">#${place} ${emoji}</div>
      <img src="${participant.avatar || "img/default-avatar.jpg"}" alt="${
        participant.username
      }" class="participant-avatar" />
      <div class="participant-info" style="flex: 1;">
        <div class="participant-name">${participant.username}</div>
        <div class="participant-stats">
          <span>Ставок в турнире: ${participant.event_bets || 0} |</span>
          <span>Угаданных: ${participant.event_won_count || 0} |</span>
          <span>Неугаданных: ${participant.event_lost || 0} |</span>
          <span>В ожидании: ${participant.event_pending || 0}</span>
        </div>
      </div>
      ${bracketButton}
      <div class="participant-points">очки
        <div class="participant-bets-count">${
          participant.event_won || 0
        }</div>
      </div>
    </div>
  `;
    })
    .join("");
}

export function backToTournaments() {
  stopTournamentParticipantsPolling(); // Останавливаем автообновление
  document.getElementById("tournamentsSection").style.display = "block";
  document.getElementById("tournamentSection").style.display = "none";
}

// Показать ставки участника турнира
export async function showTournamentParticipantBets(userId, username, eventId) {
  try {
    console.log("Загружаем ставки для юзера:", userId, "в турнире:", eventId);

    // Отправляем уведомление о просмотре ставок (если смотрит не владелец)
    if (currentUser && currentUser.id !== userId) {
      fetch('/api/notify-view-bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewedUserId: userId,
          eventId: eventId
        })
      }).catch(err => console.error('Ошибка отправки уведомления о просмотре ставок:', err));
    }

    // Загружаем словарь для перевода названий команд
    let teamTranslations = {};
    
    // Определяем турнир по eventId и загружаем соответствующий словарь
    const eventResponse = await fetch(`/api/event/${eventId}`);
    if (eventResponse.ok) {
      const eventData = await eventResponse.json();
      const competition = eventData.competition;
      
      const dictionaryMapping = {
        'CL': '/names/LeagueOfChampionsTeams.json',
        'EL': '/names/EuropaLeague.json',
        'ECL': '/names/ConferenceLeague.json',
        'PL': '/names/PremierLeague.json',
        'BL1': '/names/Bundesliga.json',
        'PD': '/names/LaLiga.json',
        'SA': '/names/SerieA.json',
        'FL1': '/names/Ligue1.json',
        'DED': '/names/Eredivisie.json',
        'RPL': '/names/RussianPremierLeague.json',
        'WC': '/names/Countries.json',
        'EC': '/names/Countries.json'
      };
      
      const dictionaryFile = dictionaryMapping[competition];
      
      if (dictionaryFile) {
        try {
          const dictResponse = await fetch(dictionaryFile);
          if (dictResponse.ok) {
            const dictData = await dictResponse.json();
            const teams = dictData.teams || {};
            
            // Функция для удаления диакритических знаков
            const removeDiacritics = (str) => {
              return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            };
            
            // Создаем обратный маппинг: Английское -> Русское
            for (const [russian, english] of Object.entries(teams)) {
              const englishLower = english.toLowerCase();
              const englishNormalized = removeDiacritics(englishLower);
              
              // Сохраняем оригинальное название
              if (!teamTranslations[englishLower] || russian.length < teamTranslations[englishLower].length) {
                teamTranslations[englishLower] = russian;
              }
              
              // Сохраняем нормализованное название (без диакритических знаков)
              if (englishNormalized !== englishLower) {
                if (!teamTranslations[englishNormalized] || russian.length < teamTranslations[englishNormalized].length) {
                  teamTranslations[englishNormalized] = russian;
                }
              }
            }
            
            console.log(`✅ Загружен словарь для ${competition}: ${Object.keys(teamTranslations).length} команд`);
          }
        } catch (err) {
          console.warn(`⚠ Не удалось загрузить словарь из ${dictionaryFile}`);
        }
      }
    }
    
    // Сохраняем функцию перевода в глобальную область для использования в displayTournamentParticipantBets
    window.translateTeamNameForBets = (englishName) => {
      return teamTranslations[englishName.toLowerCase()] || englishName;
    };

    // Получаем ставки участника в турнире, передаем viewerId и viewerUsername
    const viewerId = currentUser?.id || null;
    const viewerUsername = currentUser?.username || null;
    const params = new URLSearchParams();
    if (viewerId) params.append('viewerId', viewerId);
    if (viewerUsername) params.append('viewerUsername', viewerUsername);
    const url = `/api/event/${eventId}/participant/${userId}/bets${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await fetch(url);

    console.log("Статус ответа:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Ошибка ответа:", errorText);
      await showCustomAlert("Не удалось загрузить ставки", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      return;
    }

    const betsData = await response.json();
    const { rounds, bets, show_bets, event_name, completed_rounds } = betsData;

    // Применяем порядок туров с сервера (уже отсортирован по site_settings)
    let sortedRounds = rounds;

    // Устанавливаем заголовок
    document.getElementById(
      "tournamentParticipantBetsTitle"
    ).innerHTML = `<svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Ставки ${username}`;

    // Рассчитываем точность угадывания для этого турнира
    const totalBets = bets.length;
    const wonBets = bets.filter((b) => b.result === "won").length;
    const lostBets = bets.filter((b) => b.result === "lost").length;
    const pendingBets = bets.filter((b) => b.result === "pending").length;
    const completedBets = wonBets + lostBets;

    let accuracyHTML = "";
    if (completedBets > 0) {
      const accuracy = ((wonBets / completedBets) * 100).toFixed(1);
      accuracyHTML = `Точность: <strong>${accuracy}%</strong> (${wonBets}/${completedBets})`;
    } else if (pendingBets > 0) {
      accuracyHTML = `Все ставки в ожидании (${pendingBets})`;
    } else {
      accuracyHTML = `Нет завершенных ставок`;
    }

    document.getElementById("tournamentParticipantAccuracy").innerHTML =
      accuracyHTML;

    // Рассчитываем максимальную серию угаданных ставок подряд в этом турнире
    let maxStreak = 0;
    let currentStreak = 0;
    // Для расчета серии учитываем все завершенные ставки, независимо от is_hidden
    const completedBetsOrdered = bets
      .filter(b => (b.result === 'won' || b.result === 'lost'))
      .sort((a, b) => a.id - b.id);

    completedBetsOrdered.forEach(bet => {
      if (bet.result === 'won') {
        currentStreak++;
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
        }
      } else {
        currentStreak = 0;
      }
    });

    document.getElementById("tournamentParticipantStreak").innerHTML = 
      `<span title="Турнир: ${event_name}" style="cursor: help;"><svg class="icon" aria-hidden="true"><use href="#icon-streak"></use></svg> Макс. серия: <strong>${maxStreak}</strong></span>`;

    // Используем завершенные туры из сервера (на основе матчей, а не ставок)
    const completedRoundsSet = new Set(completed_rounds || []);

    // Создаём кнопки туров
    const roundsFilter = document.getElementById("tournamentRoundsFilterScroll");
    if (!roundsFilter) {
      console.error("tournamentRoundsFilterScroll не найден");
      return;
    }
    
    // Находим первый незавершенный тур для установки активным
    const firstUnfinishedRound = sortedRounds.find(round => !completedRoundsSet.has(round));
    // Если все туры завершены, выбираем последний тур
    const defaultActiveRound = firstUnfinishedRound || sortedRounds[sortedRounds.length - 1] || sortedRounds[0];
    
    roundsFilter.innerHTML =
      `<button class="round-filter-btn" data-round="all" 
              onclick="filterTournamentParticipantBets('all')">
        Все туры
      </button>` +
      sortedRounds
        .map((round) => {
          const isCompleted = completedRoundsSet.has(round);
          const isActive = round === defaultActiveRound;
          const activeClass = isActive ? "active" : "";
          // Finished класс добавляется для всех завершённых туров
          const finishedClass = isCompleted ? "finished" : "";
          return `<button class="round-filter-btn ${finishedClass} ${activeClass}" data-round="${round}" 
                  onclick="filterTournamentParticipantBets('${round.replace(
                    /'/g,
                    "\\'"
                  )}')">
            ${round}
          </button>`;
        })
        .join("");

    // Прокручиваем к последнему туру (прокручиваем КОНТЕЙНЕР tournamentRoundsFilter!)
    const scrollToEnd = () => {
      const tournamentRoundsContainer = document.getElementById("tournamentRoundsFilter"); // Внешний контейнер!
      if (tournamentRoundsContainer) {
        const maxScroll = tournamentRoundsContainer.scrollWidth - tournamentRoundsContainer.clientWidth;
        tournamentRoundsContainer.scrollLeft = maxScroll;
      }
    };
    
    // Множественные попытки с разными задержками
    setTimeout(scrollToEnd, 100);
    setTimeout(scrollToEnd, 300);
    setTimeout(scrollToEnd, 600);

    // Сохраняем данные для фильтрации
    window.currentTournamentBets = bets;
    window.currentTournamentRounds = sortedRounds;
    window.completedTournamentRounds = completedRoundsSet;

    // Отображаем ставки первого незавершенного тура (если есть туры) или все ставки
    if (sortedRounds.length > 0) {
      const filteredBets = bets.filter((bet) => bet.round === defaultActiveRound);
      displayTournamentParticipantBets(filteredBets);
    } else {
      displayTournamentParticipantBets(bets);
    }

    // Открываем модальное окно
    document.getElementById("tournamentParticipantBetsModal").style.display =
      "flex";
    
    // Блокируем прокрутку страницы
    document.body.style.overflow = 'hidden';
  } catch (error) {
    console.error("Ошибка при загрузке ставок турнира:", error);
    await showCustomAlert("Ошибка при загрузке ставок", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Отображение ставок участника турнира
export function displayTournamentParticipantBets(bets) {
  const betsList = document.getElementById("tournamentParticipantBetsList");

  if (!bets || bets.length === 0) {
    betsList.innerHTML =
      '<div class="empty-message">Нет ставок в этом туре</div>';
    return;
  }

  // Логируем первую ставку для проверки данных
  if (bets.length > 0) {
    console.log("Загружено ставок:", bets.length);
  }

  // Группируем ставки по датам матча
  const betsByDate = {};
  bets.forEach((bet) => {
    let dateKey = "Без даты";
    if (bet.match_date) {
      const date = new Date(bet.match_date);
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      dateKey = `${day}.${month}.${year}`;
    }
    if (!betsByDate[dateKey]) {
      betsByDate[dateKey] = [];
    }
    betsByDate[dateKey].push(bet);
  });

  // Сортируем ключи дат: незавершённые даты выше завершённых
  const sortedDateKeys = Object.keys(betsByDate).sort((a, b) => {
    if (a === "Без даты") return 1;
    if (b === "Без даты") return -1;

    const isAllFinished = (dateKey) => betsByDate[dateKey].every((bet) => {
      return bet.result !== "pending" ||
        ['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(bet.match_status);
    });

    const allFinishedA = isAllFinished(a);
    const allFinishedB = isAllFinished(b);

    if (allFinishedA && !allFinishedB) return 1;
    if (!allFinishedA && allFinishedB) return -1;

    const [dayA, monthA, yearA] = a.split(".").map(Number);
    const [dayB, monthB, yearB] = b.split(".").map(Number);
    return new Date(yearA, monthA - 1, dayA) - new Date(yearB, monthB - 1, dayB);
  });

  // Генерируем HTML с разделителями по датам
  let htmlContent = "";

  sortedDateKeys.forEach((dateKey) => {
    htmlContent += `<div style="text-align: center; color: #b0b8c8; font-size: 0.9em; margin: 15px 0 10px 0; background: rgba(0, 0, 0, 0.2); padding: 5px; border-radius: 4px;">━━━ ${dateKey} ━━━</div>`;

    htmlContent += betsByDate[dateKey].map(
      (bet) => {
        // Переводим названия команд на русский
        const team1 = window.translateTeamNameForBets ? window.translateTeamNameForBets(bet.team1) : bet.team1;
        const team2 = window.translateTeamNameForBets ? window.translateTeamNameForBets(bet.team2) : bet.team2;
        
        // Проверяем, завершен ли тур
        const completedRounds = window.completedTournamentRounds || new Set();
        const isRoundFinished = completedRounds.has(bet.round);
        
        // В завершенных турах всегда показываем ставки
        const shouldHideBet = bet.is_hidden && !isRoundFinished;
        
        // Проверяем, отменён ли матч
        const isCancelled = ['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(bet.match_status);
        
        return `
    <div style="background: ${isCancelled ? 'rgba(60, 60, 60, 0.7)' : '#1a1a2e'}; padding: 15px; margin-bottom: 10px; border-radius: 8px; border-left: 4px solid ${
      shouldHideBet
        ? "#9e9e9e"
        : isCancelled
        ? "#666"
        : bet.result === "won"
        ? "#4caf50"
        : bet.result === "lost"
        ? "#f44336"
        : "#ff9800"
    };">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <strong style="color: #7ab0e0; ${isCancelled ? 'text-decoration: line-through; filter: grayscale(100%); opacity: 0.7;' : ''}">${team1} vs ${team2}</strong>
        ${shouldHideBet ? 
          `<span style="background: #9e9e9e; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85em;">
            <svg class="icon" aria-hidden="true"><use href="#icon-hidden"></use></svg> Скрыто
          </span>` :
          isCancelled ?
          `<span style="background: #ff5722; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85em;">
            <svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg> Отмена
          </span>` :
          `<span style="background: ${
            bet.result === "won"
              ? "#4caf50"
              : bet.result === "lost"
              ? "#f44336"
              : "#ff9800"
          }; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85em;">
            ${
              bet.result === "won"
                ? '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Угадано'
                : bet.result === "lost"
                ? '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Неугадано'
                : '<svg class="icon" aria-hidden="true"><use href="#icon-pending"></use></svg> В ожидании'
            }
          </span>`
        }
      </div>
      ${shouldHideBet ?
        `<div style="color: #ffa726; font-size: 0.9em; font-style: italic;">
          <svg class="icon" aria-hidden="true"><use href="#icon-hidden"></use></svg> Ставка скрыта до начала матча
        </div>` :
        `<div style="color: #999; font-size: 0.9em; margin-bottom: 5px; ${isCancelled ? 'text-decoration: line-through; filter: grayscale(100%); opacity: 0.7;' : ''}">
          Ставка: <strong>${bet.prediction_display || bet.prediction}</strong>
          ${
            bet.result !== "pending"
              ? ` | Результат: <strong>${bet.actual_result}</strong>`
              : ""
          }
        </div>
        ${
          bet.score_team1 !== null && bet.score_team1 !== undefined && bet.score_team2 !== null && bet.score_team2 !== undefined
            ? `<div style="color: #999; font-size: 0.9em; margin-bottom: 5px; ${isCancelled ? 'text-decoration: line-through; filter: grayscale(100%); opacity: 0.7;' : ''}">
                <svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Счет: <span style="${
                  bet.actual_score_team1 != null && bet.actual_score_team2 != null && bet.result !== 'pending'
                    ? Number(bet.score_team1) === Number(bet.actual_score_team1) && Number(bet.score_team2) === Number(bet.actual_score_team2)
                      ? 'border: 1px solid #4caf50; padding: 2px 5px; border-radius: 3px;'
                      : 'border: 1px solid #f44336; padding: 2px 5px; border-radius: 3px;'
                    : ''
                }">${bet.score_team1}-${bet.score_team2}</span>
                ${
                  bet.actual_score_team1 != null && bet.actual_score_team2 != null && bet.result !== 'pending'
                    ? ` | Результат: <strong>${bet.actual_score_team1}-${bet.actual_score_team2}</strong>`
                    : ""
                }
                ${
                  bet.actual_score_team1 != null && bet.actual_score_team2 != null && bet.result !== 'pending' && 
                  Number(bet.score_team1) === Number(bet.actual_score_team1) && Number(bet.score_team2) === Number(bet.actual_score_team2) && bet.result !== 'won'
                    ? ' <span style="color: #ff9800; font-size: 0.85em;">(не засчитано)</span>'
                    : ""
                }
              </div>
              ${
                // Разница голов: только если матч выигран, не ничья, счёт не угадан точно, но разница совпала
                bet.result === 'won' &&
                bet.actual_score_team1 != null && bet.actual_score_team2 != null &&
                bet.actual_result !== 'Ничья' &&
                !(Number(bet.score_team1) === Number(bet.actual_score_team1) && Number(bet.score_team2) === Number(bet.actual_score_team2)) &&
                (Number(bet.score_team1) - Number(bet.score_team2)) === (Number(bet.actual_score_team1) - Number(bet.actual_score_team2))
                  ? `<div style="color: #81c784; font-size: 0.9em; margin-bottom: 5px;">
                      ⚖️ Разница голов угадана: <strong>+1 очко</strong>
                    </div>`
                  : ""
              }`
            : ""
        }
        ${
          bet.yellow_cards !== null && bet.yellow_cards !== undefined
            ? `<div style="color: #999; font-size: 0.9em; margin-bottom: 5px; ${isCancelled ? 'text-decoration: line-through; filter: grayscale(100%); opacity: 0.7;' : ''}">
                <svg class="icon" aria-hidden="true"><use href="#icon-yellow-card"></use></svg> Желтые: <span style="${
                  bet.actual_yellow_cards != null && bet.result !== 'pending'
                    ? Number(bet.yellow_cards) === Number(bet.actual_yellow_cards)
                      ? 'border: 1px solid #4caf50; padding: 2px 5px; border-radius: 3px;'
                      : 'border: 1px solid #f44336; padding: 2px 5px; border-radius: 3px;'
                    : ''
                }">${bet.yellow_cards}</span>
                ${
                  bet.actual_yellow_cards != null && bet.result !== 'pending'
                    ? ` | Результат: <strong>${bet.actual_yellow_cards}</strong>`
                    : ""
                }
                ${
                  bet.actual_yellow_cards != null && bet.result !== 'pending' && 
                  Number(bet.yellow_cards) === Number(bet.actual_yellow_cards) && bet.result !== 'won'
                    ? ' <span style="color: #ff9800; font-size: 0.85em;">(не засчитано)</span>'
                    : ""
                }
              </div>`
            : ""
        }
        ${
          bet.red_cards !== null && bet.red_cards !== undefined
            ? `<div style="color: #999; font-size: 0.9em; margin-bottom: 5px; ${isCancelled ? 'text-decoration: line-through; filter: grayscale(100%); opacity: 0.7;' : ''}">
                <svg class="icon" aria-hidden="true"><use href="#icon-red-card"></use></svg> Красные: <span style="${
                  bet.actual_red_cards != null && bet.result !== 'pending'
                    ? Number(bet.red_cards) === Number(bet.actual_red_cards)
                      ? 'border: 1px solid #4caf50; padding: 2px 5px; border-radius: 3px;'
                      : 'border: 1px solid #f44336; padding: 2px 5px; border-radius: 3px;'
                    : ''
                }">${bet.red_cards}</span>
                ${
                  bet.actual_red_cards != null && bet.result !== 'pending'
                    ? ` | Результат: <strong>${bet.actual_red_cards}</strong>`
                    : ""
                }
                ${
                  bet.actual_red_cards != null && bet.result !== 'pending' && 
                  Number(bet.red_cards) === Number(bet.actual_red_cards) && bet.result !== 'won'
                    ? ' <span style="color: #ff9800; font-size: 0.85em;">(не засчитано)</span>'
                    : ""
                }
              </div>`
            : ""
        }`
      }
      ${
        bet.round
          ? `<div style="color: #666; font-size: 0.85em; ${isCancelled ? 'text-decoration: line-through; filter: grayscale(100%); opacity: 0.7;' : ''}">${bet.round}</div>`
          : ""
      }
    </div>
  `;
      }
    ).join("");
  });

  betsList.innerHTML = htmlContent;
}

// Фильтр ставок по туру
export function filterTournamentParticipantBets(round) {
  const allBets = window.currentTournamentBets || [];
  const filteredBets =
    round === "all" ? allBets : allBets.filter((bet) => bet.round === round);

  const completedRounds = window.completedTournamentRounds || new Set();

  // Обновляем активную кнопку
  document
    .querySelectorAll("#tournamentRoundsFilterScroll .round-filter-btn")
    .forEach((btn) => {
      btn.classList.remove("active");
      // Добавляем active только если это кнопка "Все туры" или незавершённый тур
      if (btn.dataset.round === round && !completedRounds.has(round)) {
        btn.classList.add("active");
      }
    });

  displayTournamentParticipantBets(filteredBets);
}

// Закрыть модальное окно ставок турнира
export function closeTournamentParticipantBetsModal() {
  document.getElementById("tournamentParticipantBetsModal").style.display =
    "none";
  window.currentTournamentBets = null;
  window.currentTournamentRounds = null;
  
  // Разблокируем прокрутку страницы
  document.body.style.overflow = '';
}
