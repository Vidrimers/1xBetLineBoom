import * as state from './state.js';
import { setMatches, setCurrentRoundFilter } from './state.js';
import { loadRoundsOrder, saveRoundsOrderToStorage, sortRoundsByOrder } from './config.js';

// ===== МАТЧИ =====

// Определяем статус матча на основе даты
export function getMatchStatusByDate(match) {
  // Сначала проверяем специальные статусы (отменённые/перенесённые)
  if (['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(match.status)) {
    return match.status; // Возвращаем как есть
  }

  // Проверяем явный статус finished (только если есть победитель)
  if (match.status === "finished" || match.winner) {
    return "finished";
  }

  if (!match.match_date) {
    // Если даты нет, возвращаем статус из БД
    return match.status || "pending";
  }

  const now = new Date();
  const matchDate = new Date(match.match_date);

  // Если матч в будущем - pending
  if (matchDate > now) {
    return "pending";
  }

  // Если матч начался (дата в прошлом) и нет результата - ongoing
  return "ongoing";
}

// Загрузить матчи для события
export async function loadMatches(eventId) {
  try {
    // На мобильных переключаемся на секцию матчей
    if (window.innerWidth <= 768) {
      if (typeof showMobileSection === 'function') showMobileSection('matches');
    }

    // Сохраняем выбранный турнир в localStorage
    localStorage.setItem('selectedEventId', eventId);

    // Загружаем порядок туров для этого турнира
    await loadRoundsOrder();

    // Получаем информацию о турнире
    const eventResponse = await fetch("/api/events");
    const eventsList = await eventResponse.json();
    const currentEvent = eventsList.find((e) => e.id === eventId);

    // Если турнир завершён (заблокирован), проверяем настройку показа победителя
    if (currentEvent && currentEvent.locked_reason) {
      // Загружаем настройку показа победителя
      const settingResponse = await fetch(
        "/api/settings/show-tournament-winner"
      );
      const settingData = await settingResponse.json();

      // Если показ победителя включён, отображаем победителя
      if (settingData.show_tournament_winner) {
        displayTournamentWinner(eventId);
        return;
      }
      // Иначе показываем матчи как обычно
    }

    // Загружаем и отображаем матчи
    const username = state.currentUser?.username;
    const url = username
      ? `/api/events/${eventId}/matches?username=${encodeURIComponent(username)}`
      : `/api/events/${eventId}/matches`;
    const response = await fetch(url);
    setMatches(await response.json());
    setCurrentRoundFilter("all"); // Сбрасываем фильтр при загрузке нового турнира
    displayMatches();

    // Обновляем видимость кнопки "Мне повезет"
    if (typeof updateLuckyButtonVisibility === 'function') updateLuckyButtonVisibility();
  } catch (error) {
    console.error("Ошибка при загрузке матчей:", error);
    document.getElementById("matchesContainer").innerHTML =
      '<div class="empty-message">Ошибка при загрузке матчей</div>';
  }
}

// Фильтрация матчей по туру
export function filterByRound(round) {
  setCurrentRoundFilter(round);
  displayMatches();
}

// Инициализация состояния toggle'ов на основе сохраненных ставок
export function initToggleStates() {
  if (!state.userBets || state.userBets.length === 0) return;

  const toggleParameterMap = {
    penalties_in_game: "penaltiesInGame_",
    extra_time: "extraTime_",
    penalties_at_end: "penaltiesAtEnd_",
  };

  state.userBets.forEach((bet) => {
    if (bet.is_final_bet) {
      // Инициализируем toggle'ы
      if (toggleParameterMap[bet.parameter_type]) {
        const paramType = bet.parameter_type;
        const idPrefix = toggleParameterMap[paramType];
        const checkboxId = idPrefix + bet.match_id;
        const checkbox = document.getElementById(checkboxId);

        if (checkbox) {
          // Определяем состояние: true = ДА, false = НЕТ, neutral = не выбрано
          const isYes =
            bet.prediction === "ДА" ||
            bet.prediction === "1" ||
            bet.prediction === 1 ||
            bet.prediction === true;

          const toggleState = isYes ? "true" : "false";
          checkbox.setAttribute("data-toggle-state", toggleState);
          checkbox.checked = isYes;

          // Обновляем визуальное состояние toggle'а
          const span = checkbox.nextElementSibling;
          const circle = span?.querySelector("span");

          if (circle && span) {
            if (isYes) {
              // ДА - СЛЕВА
              span.style.backgroundColor = "#4db8a8";
              circle.style.transform = "translateX(-11px)";
            } else {
              // НЕТ - СПРАВА
              span.style.backgroundColor = "#3a5f7a";
              circle.style.transform = "translateX(17px)";
            }
          }

          // Обновляем цвет текста (ДА/НЕТ)
          const yesLabel = document.getElementById(
            `${idPrefix}yes_${bet.match_id}`
          );
          const noLabel = document.getElementById(
            `${idPrefix}no_${bet.match_id}`
          );

          if (yesLabel && noLabel) {
            if (isYes) {
              yesLabel.style.color = "#4db8a8";
              noLabel.style.color = "#888888";
            } else {
              yesLabel.style.color = "#888888";
              noLabel.style.color = "#4db8a8";
            }
          }
        }
      }

      // Блокируем параметр если ставка уже существует
      if (typeof lockFinalParameter === 'function') lockFinalParameter(bet.match_id, bet.parameter_type);
    }
  });
}

// Инициализация toggle-кнопок результатов матчей
export function initMatchResultToggles() {
  const toggles = document.querySelectorAll(".match-result-toggle");

  toggles.forEach((toggle) => {
    const matchId = toggle.dataset.matchId;
    const panel = document.querySelector(
      `.match-result-controls[data-match-id="${matchId}"]`
    );
    if (!panel) return;

    toggle.addEventListener("click", () => {
      const isVisible = panel.classList.toggle("visible");
      toggle.setAttribute("aria-expanded", isVisible ? "true" : "false");
      toggle.textContent = isVisible ? "×" : ">";
    });
  });
}

// Инициализация toggle-кнопок админских действий с матчами
export function initAdminActionToggles() {
  const toggles = document.querySelectorAll(".match-admin-toggle");

  toggles.forEach((toggle) => {
    const matchId = toggle.dataset.matchId;
    const panel = document.querySelector(
      `.match-admin-controls[data-match-id="${matchId}"]`
    );
    if (!panel) return;

    toggle.addEventListener("click", () => {
      const isVisible = panel.classList.toggle("visible");
      toggle.setAttribute("aria-expanded", isVisible ? "true" : "false");
      toggle.textContent = isVisible ? "×" : "<";
    });
  });
}

// Инициализация обработчиков кликов по строкам матчей
export function initMatchRowClickHandlers() {
  const matchRows = document.querySelectorAll(".match-row");
  let isProcessing = false;

  matchRows.forEach((row) => {
    row.addEventListener("click", (e) => {
      // Не закрывать если кликнули на кнопку админ-панели или результатов
      if (
        e.target.closest(".match-admin-actions") ||
        e.target.closest(".match-admin-panel") ||
        e.target.closest(".match-result-controls")
      ) {
        e.stopPropagation();
        return;
      }

      isProcessing = true;

      // Закрыть все остальные панели
      matchRows.forEach((other) => {
        if (other !== row) {
          other.classList.remove("hovered");
        }
      });

      // Переключить текущую панель
      row.classList.toggle("hovered");

      // Предотвратить срабатывание document click handler
      setTimeout(() => {
        isProcessing = false;
      }, 50);
    });
  });

  // Закрыть панели при клике вне контейнера матчей
  document.addEventListener("click", (e) => {
    if (isProcessing) return;

    const matchesContainer = document.getElementById("matchesContainer");
    if (matchesContainer && !matchesContainer.contains(e.target)) {
      matchRows.forEach((row) => {
        row.classList.remove("hovered");
      });
    }
  });
}

// Отображение карточки победителя завершённого турнира
export async function displayTournamentWinner(eventId) {
  try {
    const matchesContainer = document.getElementById("matchesContainer");
    const roundsFilterContainer = document.getElementById(
      "roundsFilterContainer"
    );

    // Скрываем фильтры туров
    if (roundsFilterContainer) {
      roundsFilterContainer.style.display = "none";
    }

    console.log(`🏆 Загрузка победителя для турнира ${eventId}`);

    // Загружаем данные о победителе
    const response = await fetch(`/api/events/${eventId}/tournament-winner`);
    const data = await response.json();

    console.log(`📡 Ответ сервера:`, data);
    console.log(`🏆 Данные победителя:`, data.winner);

    // Если победитель отсутствует
    if (!data.winner) {
      console.log(`⚠️ Победитель не найден для турнира ${eventId}`);
      const tournamentIcon = data.tournament.icon || "🏆";
      const displayIcon = tournamentIcon.startsWith("img/")
        ? `<img src="${tournamentIcon}" alt="tournament" class="tournament-icon" style="width: 1.2em; height: 1.2em; vertical-align: middle;">`
        : tournamentIcon;

      const noWinnerHTML = `
        <div class="tournament-winner-container">
          <div class="tournament-winner-card">
            <div class="winner-header">
              ${displayIcon} Турнир "${data.tournament.name}"
            </div>
            
            <div class="winner-content">
              <div class="no-winner-message">
                ⚠️ Победитель отсутствует
              </div>
            </div>
          </div>
        </div>
      `;
      matchesContainer.innerHTML = noWinnerHTML;
      return;
    }

    const { tournament, winner } = data;

    // Правильно формируем путь к аватарке
    let avatarPath = "/img/default-avatar.jpg";
    if (winner.avatar_path) {
      avatarPath = `/img/${winner.avatar_path}`;
    } else if (winner.avatar) {
      avatarPath = winner.avatar; // base64 или полный путь
    }

    console.log(`✅ Отображение победителя:`, winner.username);

    const tournamentIcon = tournament.icon || "🏆";
    const displayIcon = tournamentIcon.startsWith("img/")
      ? `<img src="${tournamentIcon}" alt="tournament" class="tournament-icon" style="width: 1.2em; height: 1.2em; vertical-align: middle;">`
      : tournamentIcon;

    const winnerHTML = `
      <div class="tournament-winner-container">
        <div class="tournament-winner-card">
          <div class="winner-header">
            ${displayIcon} "${tournament.name}"
          </div>
          
          <div class="winner-content">
            <div class="winner-avatar">
              <img src="${avatarPath}" alt="${winner.username}" />
            </div>
            
            <div class="winner-info">
              <div class="winner-name">${winner.username}</div>
              
              <div class="winner-stats">
                
                
                <div class="stat-item">
                  <span class="stat-label">Награда:</span>
                  <span class="stat-value award-description">${
                    winner.description
                  }</span>
                </div>
                
                <div class="stat-item">
                  <span class="stat-label">Дата присуждения:</span>
                  <span class="stat-value">${new Date(
                    winner.created_at
                  ).toLocaleDateString("ru-RU")}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    matchesContainer.innerHTML = winnerHTML;
  } catch (error) {
    console.error("❌ Ошибка при загрузке информации о победителе:", error);
    document.getElementById(
      "matchesContainer"
    ).innerHTML = `<div class="empty-message">Ошибка при загрузке информации о победителе: ${error.message}</div>`;
  }
}

// Отобразить матчи текущего события
export async function displayMatches() {
  // ===== СОХРАНЯЕМ ВВЕДЁННЫЕ ЗНАЧЕНИЯ ПЕРЕД ОБНОВЛЕНИЕМ =====
  const savedInputValues = {};
  const focusedElement = document.activeElement;
  let hasFocusOnInput = false;
  
  // Проверяем есть ли фокус на полях ввода прогнозов
  if (focusedElement && (
    focusedElement.id?.includes('scoreTeam') || 
    focusedElement.id?.includes('yellowCards') || 
    focusedElement.id?.includes('redCards')
  )) {
    hasFocusOnInput = true;
    console.log(`⏸️ Пользователь вводит данные в поле ${focusedElement.id}, пропускаем обновление`);
    return; // Не обновляем если пользователь вводит данные
  }
  
  // Сохраняем все введённые значения из полей
  document.querySelectorAll('input[id^="scoreTeam"], input[id^="yellowCards"], input[id^="redCards"]').forEach(input => {
    if (input.value && input.value.trim() !== '') {
      savedInputValues[input.id] = input.value;
    }
  });
  
  const matchesContainer = document.getElementById("matchesContainer");
  const roundsFilterContainer = document.getElementById(
    "roundsFilterContainer"
  );

  if (matches.length === 0) {
    matchesContainer.innerHTML =
      '<div class="empty-message">Матчи не найдены</div>';
    roundsFilterContainer.style.display = "none";
    // Очищаем кнопки сетки если нет матчей
    const matchesBracketButtons = document.getElementById('matchesBracketButtons');
    if (matchesBracketButtons) {
      matchesBracketButtons.innerHTML = '';
    }
    return;
  }

  // Собираем уникальные туры из матчей
  const uniqueRounds = [
    ...new Set(matches.map((m) => m.round).filter((r) => r && r.trim())),
  ];

  // Сортируем туры по сохраненному порядку
  const rounds = sortRoundsByOrder(uniqueRounds);

  // Сохраняем отсортированные туры глобально для использования в модалке
  window.sortedRounds = rounds;

  // Проверяем, завершены ли все матчи в каждом туре (исключая отменённые/перенесённые)
  function isRoundFinished(round) {
    const roundMatches = matches.filter((m) => m.round === round);
    if (roundMatches.length === 0) return false;
    
    // Матч считается обработанным, если он завершён или отменён/перенесён
    return roundMatches.every((m) => {
      const status = getMatchStatusByDate(m);
      return status === "finished" || 
             ['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(status);
    });
  }

  // Находим первый незавершённый тур
  function getFirstUnfinishedRound() {
    // Сначала проверяем финальные матчи
    const hasFinalMatches = matches.some(
      (m) => m.is_final === 1 || m.is_final === true
    );
    if (hasFinalMatches) {
      const finalMatches = matches.filter(
        (m) => m.is_final === 1 || m.is_final === true
      );
      const allFinalFinished = finalMatches.every((m) => {
        const status = getMatchStatusByDate(m);
        return status === "finished" || 
               ['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(status);
      });
      if (!allFinalFinished) {
        return "🏆 Финал";
      }
    }

    // Затем проверяем обычные туры
    for (const round of rounds) {
      if (!isRoundFinished(round)) {
        return round;
      }
    }
    // Если все туры завершены, возвращаем последний
    return rounds[rounds.length - 1] || rounds[0];
  }

  // Показываем фильтры только если есть хотя бы один тур или финальные матчи
  const hasFinalMatches = matches.some(
    (m) => m.is_final === 1 || m.is_final === true
  );

  // Если есть финальные матчи и финала нет в roundsOrder, добавляем его
  if (hasFinalMatches && !roundsOrder.includes("🏆 Финал")) {
    roundsOrder.push("🏆 Финал");
    // Сохраняем новый порядок в БД
    saveRoundsOrderToStorage().catch((e) =>
      console.error("Ошибка сохранения финала в порядок:", e)
    );
  }

  if (rounds.length > 0 || hasFinalMatches) {
    // Если текущий фильтр "all" или не существует в списке туров, выбираем первый незавершённый тур
    if (
      currentRoundFilter === "all" ||
      (!rounds.includes(currentRoundFilter) &&
        currentRoundFilter !== "🏆 Финал")
    ) {
      currentRoundFilter = getFirstUnfinishedRound();
    }

    roundsFilterContainer.style.display = "block";
    const filterButtons = document.getElementById("roundsFilterScroll");

    // Проверяем, является ли текущий пользователем админом
    const isAdmin = currentUser && currentUser.isAdmin;

    // Получаем иконку текущего турнира
    let currentEventIcon = '🏆';
    if (currentEventId && events && events.length > 0) {
      const currentEvent = events.find(e => e.id === currentEventId);
      if (currentEvent && currentEvent.icon) {
        currentEventIcon = currentEvent.icon;
      }
    }

    // Загружаем сетки для текущего турнира
    let bracketsHTML = '';
    if (currentEventId && typeof loadBracketsForEvent === 'function') {
      try {
        const brackets = await loadBracketsForEvent(currentEventId);
        if (brackets && brackets.length > 0) {
          brackets.forEach(bracket => {
            const isClosedByDate = bracket.start_date && new Date(bracket.start_date) <= new Date();
            const isManuallyLocked = bracket.is_locked === 1;
            const isClosed = isClosedByDate || isManuallyLocked;
            
            // Формируем иконку
            let iconHtml = '';
            if (isClosed) {
              iconHtml = '🔒';
            } else if (currentEventIcon.startsWith('img/') || currentEventIcon.startsWith('http')) {
              iconHtml = `<img src="${currentEventIcon}" alt="icon" style="width: 16px; height: 16px; vertical-align: middle; margin-right: 4px;" />`;
            } else {
              iconHtml = currentEventIcon;
            }
            
            bracketsHTML += `
              <button class="round-filter-btn bracket-filter-btn" 
                      onclick="openBracketModal(${bracket.id})" 
                      title="${bracket.name}${isClosed ? ' (Ставки закрыты)' : ' (Ставки открыты)'}">
                ${iconHtml} ${bracket.name}
              </button>
            `;
          });
        }
      } catch (err) {
        console.error('Ошибка загрузки сеток для фильтра:', err);
      }
    }

    // Рендерим кнопки сетки в matches-container (всегда обновляем, даже если пусто)
    const matchesBracketButtons = document.getElementById('matchesBracketButtons');
    if (matchesBracketButtons) {
      // Проверяем видимость кнопки xG
      let xgButtonHTML = '';
      
      // Проверяем настройку пользователя
      const userShowXgButton = currentUser && currentUser.show_xg_button !== undefined ? currentUser.show_xg_button : 1;
      
      if (userShowXgButton === 1) {
        try {
          const xgVisibilityResponse = await fetch('/api/xg-button-visibility');
          if (xgVisibilityResponse.ok) {
            const xgVisibility = await xgVisibilityResponse.json();
            if (!xgVisibility.hidden) {
              xgButtonHTML = `
                <button class="round-filter-btn xg-filter-btn" 
                        onclick="openXgModal()" 
                        title="Прогнозы Glicko-2 и xG"
                        style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                  🎯 xG
                </button>
              `;
            }
          }
        } catch (err) {
          console.error('Ошибка проверки видимости кнопки xG:', err);
        }
      }
      
      matchesBracketButtons.innerHTML = bracketsHTML + xgButtonHTML;
    }

    // Рендерим кнопки туров в roundsFilterScroll
    filterButtons.innerHTML = `
      ${rounds
        .map(
          (round) => `
        <button class="round-filter-btn ${
          currentRoundFilter === round ? "active" : ""
        } ${
            isRoundFinished(round) ? "finished" : ""
          }" data-round="${round}" onclick="filterByRound('${round.replace(
            /'/g,
            "\\'"
          )}')">${round}</button>
      `
        )
        .join("")}
    `;

    // Прокручиваем к последнему туру (прокручиваем КОНТЕЙНЕР, а не внутренний div!)
    const scrollToEnd = () => {
      const roundsContainer = document.getElementById("roundsFilterContainer"); // Внешний контейнер!
      if (roundsContainer) {
        const maxScroll = roundsContainer.scrollWidth - roundsContainer.clientWidth;
        roundsContainer.scrollLeft = maxScroll;
        console.log(`📜 Прокрутка к последнему туру: scrollLeft=${roundsContainer.scrollLeft}, maxScroll=${maxScroll}, scrollWidth=${roundsContainer.scrollWidth}, clientWidth=${roundsContainer.clientWidth}, активен: ${currentRoundFilter}`);
      }
    };
    
    // Множественные попытки с разными задержками
    setTimeout(scrollToEnd, 100);
    setTimeout(scrollToEnd, 300);
    setTimeout(scrollToEnd, 600);
    setTimeout(scrollToEnd, 1000);
  } else {
    roundsFilterContainer.style.display = "none";
    currentRoundFilter = "all"; // Сбрасываем фильтр если туров и финальных матчей нет
  }
  // Фильтруем матчи по выбранному туру
  let filteredMatches = matches;
  if (currentRoundFilter !== "all") {
    // Обычный фильтр по туру (включая "🏆 Финал")
    filteredMatches = matches.filter((m) => m.round === currentRoundFilter);
  }

  if (filteredMatches.length === 0) {
    matchesContainer.innerHTML =
      '<div class="empty-message">Нет матчей для выбранного тура</div>';
    return;
  }

  // Сортируем матчи: идущие сверху, потом ожидающие по дате, завершенные внизу
  const sortedMatches = [...filteredMatches].sort((a, b) => {
    const statusA = getMatchStatusByDate(a);
    const statusB = getMatchStatusByDate(b);

    // Приоритет статусов: ongoing > pending > finished
    const statusPriority = {
      ongoing: 0,
      pending: 1,
      finished: 2,
    };

    const priorityA = statusPriority[statusA] ?? 99;
    const priorityB = statusPriority[statusB] ?? 99;

    // Сначала сортируем по приоритету статуса
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    // Если оба в одинаковом статусе - сортируем по дате
    if (a.match_date && b.match_date) {
      return new Date(a.match_date) - new Date(b.match_date);
    }

    return 0;
  });

  // Группируем матчи по датам
  const matchesByDate = {};
  sortedMatches.forEach((match) => {
    let dateKey = "Без даты";
    if (match.match_date) {
      const date = new Date(match.match_date);
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      dateKey = `${day}.${month}.${year}`;
    }
    if (!matchesByDate[dateKey]) {
      matchesByDate[dateKey] = [];
    }
    matchesByDate[dateKey].push(match);
  });

  // Сортируем ключи дат
  // Сначала проверяем, все ли матчи в дате завершены
  const sortedDateKeys = Object.keys(matchesByDate).sort((a, b) => {
    if (a === "Без даты") return 1;
    if (b === "Без даты") return -1;
    
    // Проверяем, все ли матчи завершены в каждой дате (включая отменённые/перенесённые)
    const allFinishedA = matchesByDate[a].every(m => {
      const status = getMatchStatusByDate(m);
      return status === "finished" || 
             ['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(status);
    });
    const allFinishedB = matchesByDate[b].every(m => {
      const status = getMatchStatusByDate(m);
      return status === "finished" || 
             ['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(status);
    });
    
    // Если в одной дате все завершены, а в другой нет - незавершенная идет первой
    if (allFinishedA && !allFinishedB) return 1;  // A вниз
    if (!allFinishedA && allFinishedB) return -1; // B вниз
    
    // Если обе даты в одинаковом состоянии (обе завершены или обе нет) - сортируем по дате
    const [dayA, monthA, yearA] = a.split(".").map(Number);
    const [dayB, monthB, yearB] = b.split(".").map(Number);
    const dateA = new Date(yearA, monthA - 1, dayA);
    const dateB = new Date(yearB, monthB - 1, dayB);
    return dateA - dateB;
  });

  // Генерируем HTML с разделителями по датам
  let htmlContent = "";
  
  sortedDateKeys.forEach((dateKey) => {
    // Добавляем разделитель даты
    htmlContent += `<div style="text-align: center; color: #b0b8c8; font-size: 0.9em; margin: 15px 0 10px 0; background: rgba(0, 0, 0, 0.2); padding: 8px; border-radius: 4px;">━━━ ${dateKey} ━━━</div>`;
    
    // Добавляем матчи для этой даты
    matchesByDate[dateKey].forEach((match) => {
      // Определяем статус на основе даты
      const effectiveStatus = getMatchStatusByDate(match);

      // Проверяем, есть ли ставка пользователя на команду этого матча (только команднные ставки, не финальные)
      const userBetOnMatch = userBets.find(
        (bet) => bet.match_id === match.id && !bet.is_final_bet
      );
      
      // Определяем класс в зависимости от результата ставки
      let betClass = "";
      if (userBetOnMatch) {
        betClass = "has-user-bet";
        
        // Если матч завершен, добавляем класс результата
        if (match.winner) {
          const isWon = (userBetOnMatch.prediction === 'team1' && match.winner === 'team1') ||
                        (userBetOnMatch.prediction === 'team2' && match.winner === 'team2') ||
                        (userBetOnMatch.prediction === 'draw' && match.winner === 'draw') ||
                        (userBetOnMatch.prediction === match.team1_name && match.winner === 'team1') ||
                        (userBetOnMatch.prediction === match.team2_name && match.winner === 'team2');
          
          betClass += isWon ? " bet-won" : " bet-lost";
        }
      }

      // Определяем текст и цвет статуса
      let statusBadge = "";
      if (effectiveStatus === "ongoing") {
        statusBadge =
          '<span style="display: inline-block; padding: 3px 8px; background: #ff9800; color: white; border-radius: 12px; font-size: 0.75em; margin-left: 5px;">🔴 ИДЕТ</span>';
      } else if (effectiveStatus === "finished") {
        statusBadge =
          '<span style="display: inline-block; padding: 3px 8px; background: rgba(100, 100, 100, 0.8); color: #e0e0e0; border-radius: 12px; font-size: 0.75em; margin-left: 5px;">✓ ЗАВЕРШЕН</span>';
      } else if (['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(effectiveStatus)) {
        statusBadge =
          '<span class="match-status-cancelled" style="display: inline-block; padding: 3px 8px; background: #ff5722; color: white; border-radius: 12px; font-size: 0.75em; margin-left: 5px;">⚠️ ОТМЕНА</span>';
      }

      // Определяем, отменён ли матч
      const isCancelled = ['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(effectiveStatus);

      const matchHtml = `
        <div class="match-row ${betClass} ${isCancelled ? 'match-cancelled' : ''}" data-match-id="${match.id}" style="position: relative;">
            ${
              canManageMatches()
                ? `
              <div class="match-admin-panel">
                ${
                  match.is_final
                    ? `
                <button onclick="openFinalMatchResultModal(${match.id})"
                  style="background: transparent; color: #4db8a8; border: 1px solid #4db8a8; padding: 5px 10px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.85em; font-weight: bold;"
                  onmouseover="this.style.background='rgba(77, 184, 168, 0.2)'"
                  onmouseout="this.style.background='transparent'"
                  title="Установить результат финала и параметры">
                  📝
                </button>
                `
                    : match.score_prediction_enabled
                    ? `
                <button
                  onclick="openScoreMatchResultModal(${match.id}, '${match.team1_name.replace(/'/g, "\\'")}', '${match.team2_name.replace(/'/g, "\\'")}')"
                  style="background: transparent; border: 1px solid rgb(58, 123, 213); color: rgb(224, 230, 240); padding: 5px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.8em;"
                  onmouseover="this.style.background='rgba(58, 123, 213, 0.6)'; this.style.color='white'"
                  onmouseout="this.style.background='transparent'; this.style.color='rgb(224, 230, 240)'"
                  title="Установить результат матча">
                  📝
                </button>
                `
                    : `
                <button
                  class="match-result-toggle"
                  data-match-id="${match.id}"
                  type="button"
                  aria-expanded="false"
                  title="Показать кнопки результата"
                  style="padding: 0;"
                >
                  &gt;
                </button>
                <div class="match-result-controls" data-match-id="${match.id}">
                  <button onclick="setMatchResult(${match.id}, 'team1')"
                    style="background: transparent; color: #e0e6f0; border: 1px solid rgba(58, 123, 213, 0.7); padding: 5px 5px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.75em; font-weight: bold;"
                    onmouseover="this.style.background='rgba(58, 123, 213, 0.9)'"
                    onmouseout="this.style.background='transparent'">
                    1
                  </button>
                  <button onclick="setMatchResult(${match.id}, 'draw')"
                    style="background: transparent; color: white; border: 1px solid #f57c00; padding: 5px 5px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.75em; font-weight: bold;"
                    onmouseover="this.style.background='#e65100'"
                    onmouseout="this.style.background='transparent'">
                    X
                  </button>
                  <button onclick="setMatchResult(${match.id}, 'team2')"
                    style="background: transparent; color: #a0d895; border: 1px solid rgba(76, 175, 80, 0.7); padding: 5px 5px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.75em; font-weight: bold;"
                    onmouseover="this.style.background='rgba(76, 175, 80, 0.9)'"
                    onmouseout="this.style.background='transparent'">
                    2
                  </button>
                </div>
                `
                }
              </div>
              <div class="match-admin-actions" data-match-id="${match.id}">
                <div class="match-admin-controls" data-match-id="${match.id}">
                  ${
                    effectiveStatus === "finished"
                      ? `
                  <button onclick="unlockMatch(${match.id})"
                    style="background: transparent; border: 1px solid #f57c00; color: #ffe0b2; padding: 5px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.6em;"
                    onmouseover="this.style.background='rgba(255, 152, 0, 0.6)'; this.style.color='#fff'"
                    onmouseout="this.style.background='transparent'; this.style.color='#ffe0b2'"
                    title="Разблокировать матч">
                    🔓
                  </button>
                  `
                      : ""
                  }
                  ${canEditMatches() ? `<button onclick="openEditMatchModal(${match.id}, '${
                    match.team1_name.replace(/'/g, "\\'")
                  }', '${match.team2_name.replace(/'/g, "\\'")}', '${match.match_date || ""}', '${
                    match.round || ""
                  }')"
                    style="background: transparent; border: 1px solid #3a7bd5; color: #7ab0e0; padding: 5px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.6em;"
                    onmouseover="this.style.background='rgba(58, 123, 213, 0.6)'; this.style.color='white'"
                    onmouseout="this.style.background='transparent'; this.style.color='#7ab0e0'">
                    ✏️
                  </button>` : ''}
                  ${canDeleteMatches() ? `<button onclick="deleteMatch(${match.id})"
                    style="background: transparent; border: 1px solid #f44336; color: #f44336; padding: 5px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.6em;"
                    onmouseover="this.style.background='#f44336'; this.style.color='white'"
                    onmouseout="this.style.background='transparent'; this.style.color='#f44336'">
                    ✕
                  </button>` : ''}
                </div>
                <button
                  class="match-admin-toggle"
                  data-match-id="${match.id}"
                  type="button"
                  aria-expanded="false"
                  title="Работа с матчем"
                >
                  &lt;
                </button>
              </div>
            `
                : ""
            }
            <div class="match-teams">
                <div class="match-vs">
                    <div class="team team-left">${match.team1_name}</div>
                    <div class="vs-text">VS</div>
                    <div class="team team-right">${match.team2_name}</div>
                </div>
                ${
                  match.round || match.score_prediction_enabled || match.yellow_cards_prediction_enabled || match.red_cards_prediction_enabled
                    ? `<div class="match-round-row">
                      ${match.score_prediction_enabled ? `<input type="number" id="scoreTeam1_${match.id}" class="score-input score-input-left" min="0" value="${match.predicted_score_team1 != null ? match.predicted_score_team1 : ''}" placeholder="0" ${effectiveStatus !== "pending" || !userBetOnMatch?.prediction || (match.predicted_score_team1 != null && match.predicted_score_team2 != null) ? "disabled" : ""} oninput="syncScoreInputs(${match.id}, '${userBetOnMatch?.prediction || ''}')">` : ""}
                      ${match.round ? `<div class="match-round">${match.round}</div>` : ""}
                      ${match.score_prediction_enabled ? `<input type="number" id="scoreTeam2_${match.id}" class="score-input score-input-right" min="0" value="${match.predicted_score_team2 != null ? match.predicted_score_team2 : ''}" placeholder="0" ${effectiveStatus !== "pending" || !userBetOnMatch?.prediction || (match.predicted_score_team1 != null && match.predicted_score_team2 != null) ? "disabled" : ""} oninput="syncScoreInputs(${match.id}, '${userBetOnMatch?.prediction || ''}')">` : ""}
                      ${(match.score_prediction_enabled || match.yellow_cards_prediction_enabled || match.red_cards_prediction_enabled) && userBetOnMatch?.prediction && effectiveStatus === "pending" && !((match.score_prediction_enabled ? (match.predicted_score_team1 != null && match.predicted_score_team2 != null) : true) && (match.yellow_cards_prediction_enabled ? match.predicted_yellow_cards != null : true) && (match.red_cards_prediction_enabled ? match.predicted_red_cards != null : true)) ? `<div class="score-action-btns" id="scoreButtons_${match.id}">
                        <button class="score-confirm-btn" onclick="placeScorePrediction(${match.id}, '${userBetOnMatch?.prediction || ''}')">✅</button>
                      </div>` : ""}
                    </div>`
                    : ""
                }
                ${
                  (match.yellow_cards_prediction_enabled || match.red_cards_prediction_enabled) && userBetOnMatch?.prediction
                    ? `<div class="match-cards-row" style="display: flex; justify-content: center; gap: 10px; margin-top: 5px;">
                      ${match.yellow_cards_prediction_enabled ? `<div style="display: flex; align-items: center; gap: 5px;">
                        <span style="font-size: 0.9em;">🟨</span>
                        <input type="number" id="yellowCards_${match.id}" class="score-input" min="0" max="20" value="${match.predicted_yellow_cards != null ? match.predicted_yellow_cards : ''}" placeholder="0" ${effectiveStatus !== "pending" || (match.predicted_yellow_cards != null) ? "disabled" : ""} style="width: 50px; text-align: center;">
                      </div>` : ""}
                      ${match.red_cards_prediction_enabled ? `<div style="display: flex; align-items: center; gap: 5px;">
                        <span style="font-size: 0.9em;">🟥</span>
                        <input type="number" id="redCards_${match.id}" class="score-input" min="0" max="10" value="${match.predicted_red_cards != null ? match.predicted_red_cards : ''}" placeholder="0" ${effectiveStatus !== "pending" || (match.predicted_red_cards != null) ? "disabled" : ""} style="width: 50px; text-align: center;">
                      </div>` : ""}
                    </div>`
                    : ""
                }
                ${
                  match.match_date
                    ? `<div class="match-date" style="text-align: center; font-size: 0.8em; color: #b0b8c8; margin: 10px auto;"><span class="match-date-text">${formatMatchTime(
                        match.match_date
                      )}</span>${statusBadge}</div>`
                    : `<div class="match-noDate" style="text-align: center; font-size: 0.8em; color: #666; margin: 10px auto;"><span class="match-date-text">Дата не указана</span>${statusBadge}</div>`
                }
                <div class="bet-buttons-three">
                    <button class="bet-btn team1 ${
                      userBetOnMatch?.prediction === "team1" ? "selected" : ""
                    }" onclick="placeBet(${match.id}, '${
        match.team1_name.replace(/'/g, "\\'")
      }', 'team1')" ${
        effectiveStatus !== "pending"
          ? "disabled"
          : userBetOnMatch?.prediction === "team1"
          ? "disabled"
          : ""
      }>
                        ${match.team1_name}
                    </button>
                    <button class="bet-btn draw ${
                      userBetOnMatch?.prediction === "draw" ? "selected" : ""
                    }" onclick="placeBet(${match.id}, 'draw', 'draw')" ${
        effectiveStatus !== "pending"
          ? "disabled"
          : userBetOnMatch?.prediction === "draw"
          ? "disabled"
          : ""
      }>
                          Ничья
                      </button>
                    <button class="bet-btn team2 ${
                      userBetOnMatch?.prediction === "team2" ? "selected" : ""
                    }" onclick="placeBet(${match.id}, '${
        match.team2_name.replace(/'/g, "\\'")
      }', 'team2')" ${
        effectiveStatus !== "pending"
          ? "disabled"
          : userBetOnMatch?.prediction === "team2"
          ? "disabled"
          : ""
      }>
                        ${match.team2_name}
                    </button>
                </div>
                ${
                  match.is_final
                    ? `
                <div style="background: rgba(58, 123, 213, 0.1); padding: 12px; border-radius: 4px; margin: 10px 0;">
                  <div style="color: #7ab0e0; font-size: 0.85em; font-weight: 500; margin-bottom: 12px;">🏆 ФИНАЛЬНЫЕ ПАРАМЕТРЫ:</div>
                  
                  ${
                    match.show_exact_score
                      ? `
                  <div style="margin-bottom: 12px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <div style="color: #b0b8c8; font-size: 0.85em; margin-bottom: 6px;">📊 Точный счет</div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <input type="number" id="exactScore1_${match.id}" min="0" value="0" style="width: 50px; padding: 4px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px;">
                      <span style="color: #7ab0e0;">vs</span>
                      <input type="number" id="exactScore2_${match.id}" min="0" value="0" style="width: 50px; padding: 4px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px;">
                      <button onclick="placeFinalBet(${match.id}, 'exact_score')" style="background: #4db8a8; border: none; color: white; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 0.85em;">✓</button>
                    </div>
                  </div>
                  `
                      : ""
                  }
                  
                  ${
                    match.show_yellow_cards
                      ? `
                  <div style="margin-bottom: 12px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <div style="color: #b0b8c8; font-size: 0.85em; margin-bottom: 6px;">🟨 Желтые карточки</div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <input type="number" id="yellowCards_${match.id}" min="0" value="0" style="width: 70px; padding: 4px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px;">
                      <button onclick="placeFinalBet(${match.id}, 'yellow_cards')" style="background: #4db8a8; border: none; color: white; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 0.85em;">✓</button>
                    </div>
                  </div>
                  `
                      : ""
                  }
                  
                  ${
                    match.show_red_cards
                      ? `
                  <div style="margin-bottom: 12px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <div style="color: #b0b8c8; font-size: 0.85em; margin-bottom: 6px;">🟥 Красные карточки</div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <input type="number" id="redCards_${match.id}" min="0" value="0" style="width: 70px; padding: 4px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px;">
                      <button onclick="placeFinalBet(${match.id}, 'red_cards')" style="background: #4db8a8; border: none; color: white; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 0.85em;">✓</button>
                    </div>
                  </div>
                  `
                      : ""
                  }
                  
                  ${
                    match.show_corners
                      ? `
                  <div style="margin-bottom: 12px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <div style="color: #b0b8c8; font-size: 0.85em; margin-bottom: 6px;">⚽ Угловые</div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <input type="number" id="corners_${match.id}" min="0" value="0" style="width: 70px; padding: 4px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px;">
                      <button onclick="placeFinalBet(${match.id}, 'corners')" style="background: #4db8a8; border: none; color: white; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 0.85em;">✓</button>
                    </div>
                  </div>
                  `
                      : ""
                  }
                  
                  ${
                    match.show_penalties_in_game
                      ? `
                  <div style="margin-bottom: 12px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <div style="color: #b0b8c8; font-size: 0.85em; margin-bottom: 6px;">⚽ Пенальти в игре</div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span id="penaltiesInGame_yes_${match.id}" style="color: #888888; font-size: 0.85em; font-weight: 500;">ДА</span>
                        <label style="position: relative; display: inline-block; width: 50px; height: 24px; cursor: pointer;">
                          <input type="checkbox" id="penaltiesInGame_${match.id}" data-toggle-state="neutral" style="display: none;">
                          <span style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: #666666; border-radius: 24px; transition: background-color 0.3s; cursor: pointer;" onclick="(function() { const checkbox = document.getElementById('penaltiesInGame_${match.id}'); const currentState = checkbox.getAttribute('data-toggle-state'); let newState; if (currentState === 'neutral') { newState = 'true'; } else { newState = currentState === 'true' ? 'false' : 'true'; } checkbox.setAttribute('data-toggle-state', newState); checkbox.checked = newState === 'true'; const span = checkbox.nextElementSibling; const circle = span.querySelector('span'); const yesLabel = document.getElementById('penaltiesInGame_yes_${match.id}'); const noLabel = document.getElementById('penaltiesInGame_no_${match.id}'); if (newState === 'true') { span.style.backgroundColor = '#4db8a8'; circle.style.transform = 'translateX(-11px)'; yesLabel.style.color = '#4db8a8'; noLabel.style.color = '#888888'; } else { span.style.backgroundColor = '#3a5f7a'; circle.style.transform = 'translateX(17px)'; yesLabel.style.color = '#888888'; noLabel.style.color = '#4db8a8'; } })();">
                            <span style="position: absolute; height: 18px; width: 18px; top: 3px; left: 13px; background-color: white; border-radius: 50%; transition: transform 0.3s;"></span>
                          </span>
                        </label>
                        <span id="penaltiesInGame_no_${match.id}" style="color: #888888; font-size: 0.85em;">НЕТ</span>
                      </div>
                      <button onclick="placeFinalBet(${match.id}, 'penalties_in_game')" style="background: #4db8a8; border: none; color: white; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 0.85em;">✓</button>
                    </div>
                  </div>
                  `
                      : ""
                  }
                  
                  ${
                    match.show_extra_time
                      ? `
                  <div style="margin-bottom: 12px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <div style="color: #b0b8c8; font-size: 0.85em; margin-bottom: 6px;">⏱️ Дополнительное время</div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span id="extraTime_yes_${match.id}" style="color: #888888; font-size: 0.85em; font-weight: 500;">ДА</span>
                        <label style="position: relative; display: inline-block; width: 50px; height: 24px; cursor: pointer;">
                          <input type="checkbox" id="extraTime_${match.id}" data-toggle-state="neutral" style="display: none;">
                          <span style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: #666666; border-radius: 24px; transition: background-color 0.3s; cursor: pointer;" onclick="(function() { const checkbox = document.getElementById('extraTime_${match.id}'); const currentState = checkbox.getAttribute('data-toggle-state'); let newState; if (currentState === 'neutral') { newState = 'true'; } else { newState = currentState === 'true' ? 'false' : 'true'; } checkbox.setAttribute('data-toggle-state', newState); checkbox.checked = newState === 'true'; const span = checkbox.nextElementSibling; const circle = span.querySelector('span'); const yesLabel = document.getElementById('extraTime_yes_${match.id}'); const noLabel = document.getElementById('extraTime_no_${match.id}'); if (newState === 'true') { span.style.backgroundColor = '#4db8a8'; circle.style.transform = 'translateX(-11px)'; yesLabel.style.color = '#4db8a8'; noLabel.style.color = '#888888'; } else { span.style.backgroundColor = '#3a5f7a'; circle.style.transform = 'translateX(17px)'; yesLabel.style.color = '#888888'; noLabel.style.color = '#4db8a8'; } })();">
                            <span style="position: absolute; height: 18px; width: 18px; top: 3px; left: 13px; background-color: white; border-radius: 50%; transition: transform 0.3s;"></span>
                          </span>
                        </label>
                        <span id="extraTime_no_${match.id}" style="color: #888888; font-size: 0.85em;">НЕТ</span>
                      </div>
                      <button onclick="placeFinalBet(${match.id}, 'extra_time')" style="background: #4db8a8; border: none; color: white; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 0.85em;">✓</button>
                    </div>
                  </div>
                  `
                      : ""
                  }
                  
                  ${
                    match.show_penalties_at_end
                      ? `
                  <div style="margin-bottom: 12px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <div style="color: #b0b8c8; font-size: 0.85em; margin-bottom: 6px;">⚽ Пенальти в конце</div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span id="penaltiesAtEnd_yes_${match.id}" style="color: #888888; font-size: 0.85em; font-weight: 500;">ДА</span>
                        <label style="position: relative; display: inline-block; width: 50px; height: 24px; cursor: pointer;">
                          <input type="checkbox" id="penaltiesAtEnd_${match.id}" data-toggle-state="neutral" style="display: none;">
                          <span style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: #666666; border-radius: 24px; transition: background-color 0.3s; cursor: pointer;" onclick="(function() { const checkbox = document.getElementById('penaltiesAtEnd_${match.id}'); const currentState = checkbox.getAttribute('data-toggle-state'); let newState; if (currentState === 'neutral') { newState = 'true'; } else { newState = currentState === 'true' ? 'false' : 'true'; } checkbox.setAttribute('data-toggle-state', newState); checkbox.checked = newState === 'true'; const span = checkbox.nextElementSibling; const circle = span.querySelector('span'); const yesLabel = document.getElementById('penaltiesAtEnd_yes_${match.id}'); const noLabel = document.getElementById('penaltiesAtEnd_no_${match.id}'); if (newState === 'true') { span.style.backgroundColor = '#4db8a8'; circle.style.transform = 'translateX(-11px)'; yesLabel.style.color = '#4db8a8'; noLabel.style.color = '#888888'; } else { span.style.backgroundColor = '#3a5f7a'; circle.style.transform = 'translateX(17px)'; yesLabel.style.color = '#888888'; noLabel.style.color = '#4db8a8'; } })();">
                            <span style="position: absolute; height: 18px; width: 18px; top: 3px; left: 13px; background-color: white; border-radius: 50%; transition: transform 0.3s;"></span>
                          </span>
                        </label>
                        <span id="penaltiesAtEnd_no_${match.id}" style="color: #888888; font-size: 0.85em;">НЕТ</span>
                      </div>
                      <button onclick="placeFinalBet(${match.id}, 'penalties_at_end')" style="background: #4db8a8; border: none; color: white; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 0.85em;">✓</button>
                    </div>
                  </div>
                  `
                      : ""
                  }
                </div>
                `
                    : ""
                }
            </div>
        </div>
    `;
      htmlContent += matchHtml;
    });
  });

  matchesContainer.innerHTML = htmlContent;

  // Добавляем обработчики для disabled кнопок
  const disabledButtons = matchesContainer.querySelectorAll("button[disabled]");

  disabledButtons.forEach((button) => {
    // Полностью переопределяем onclick для disabled кнопок
    const originalOnclick = button.onclick;
    button.onclick = function (e) {
      // Пытаемся получить информацию о матче из кнопки
      const matchRow = button.closest(".match-row");
      const teamsDiv = matchRow.querySelector(".match-vs");
      const team1 = teamsDiv.querySelector(".team-left").textContent;
      const team2 = teamsDiv.querySelector(".team-right").textContent;
      const prediction = button.textContent.trim();

      // Отправляем уведомление админу
      fetch("/api/admin/notify-illegal-bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: currentUser?.username || "неизвестный",
          team1: team1,
          team2: team2,
          prediction: prediction,
          matchStatus: "ongoing",
        }),
      }).catch((error) =>
        console.error("Ошибка при отправке уведомления:", error)
      );

      alert("Ну, куда ты, малютка, матч уже начался");
      return false;
    };
  });

  // Инициализируем состояние toggle'ов после добавления HTML в DOM
  initToggleStates();
  initMatchResultToggles();
  initAdminActionToggles();
  initMatchRowClickHandlers();
  
  // ===== ВОССТАНАВЛИВАЕМ ВВЕДЁННЫЕ ЗНАЧЕНИЯ =====
  if (Object.keys(savedInputValues).length > 0) {
    Object.entries(savedInputValues).forEach(([inputId, value]) => {
      const input = document.getElementById(inputId);
      if (input) {
        input.value = value;
      }
    });
  }
  
  // Загружаем статистику для всех матчей БЕЗ анимации
  filteredMatches.forEach(match => {
    loadAndDisplayBetStats(match.id, false);
  });
}

