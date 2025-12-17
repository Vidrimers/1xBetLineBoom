// Глобальные переменные
let currentUser = null;
let currentEventId = null;
let events = [];
let matches = [];
let userBets = [];
let ADMIN_LOGIN = null;
let ADMIN_DB_NAME = null;
let matchUpdateInterval = null;
let isMatchUpdatingEnabled = true;
let currentRoundFilter = "all"; // Текущий фильтр по туру
let roundsOrder = []; // Порядок туров из БД
let tempRoundsOrder = []; // Временный порядок для редактирования

// ===== ИНИЦИАЛИЗАЦИЯ =====

// Загрузить порядок туров из БД
async function loadRoundsOrder() {
  try {
    const response = await fetch("/api/rounds-order");
    if (response.ok) {
      roundsOrder = await response.json();
    } else {
      roundsOrder = [];
    }
  } catch (e) {
    console.error("Ошибка загрузки порядка туров:", e);
    roundsOrder = [];
  }
}

// Сохранить порядок туров в БД (только админ)
async function saveRoundsOrderToStorage() {
  try {
    const response = await fetch("/api/admin/rounds-order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rounds: roundsOrder }),
    });

    if (!response.ok) {
      throw new Error("Ошибка сохранения");
    }
  } catch (e) {
    console.error("Ошибка сохранения порядка туров:", e);
    alert("Ошибка сохранения порядка туров");
  }
}

// Открыть модальное окно редактирования порядка туров
function openRoundsOrderModal() {
  const uniqueRounds = [
    ...new Set(matches.map((m) => m.round).filter((r) => r && r.trim())),
  ];

  // Сортируем туры по сохраненному порядку
  tempRoundsOrder = sortRoundsByOrder(uniqueRounds);

  renderRoundsOrderList();
  document.getElementById("roundsOrderModal").classList.add("active");
}

// Закрыть модальное окно
function closeRoundsOrderModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById("roundsOrderModal").classList.remove("active");
}

// Отрисовать список туров в модальном окне
function renderRoundsOrderList() {
  const list = document.getElementById("roundsOrderList");
  list.innerHTML = tempRoundsOrder
    .map(
      (round, index) => `
      <li class="rounds-order-item" draggable="true" data-index="${index}">
        <span class="drag-handle">☰</span>
        <span class="round-name">${round}</span>
      </li>
    `
    )
    .join("");

  // Добавляем обработчики drag-and-drop
  const items = list.querySelectorAll(".rounds-order-item");
  items.forEach((item) => {
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragend", handleDragEnd);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("drop", handleDrop);
    item.addEventListener("dragenter", handleDragEnter);
    item.addEventListener("dragleave", handleDragLeave);
  });
}

// Drag-and-drop обработчики
let draggedItem = null;

function handleDragStart(e) {
  draggedItem = this;
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}

function handleDragEnd(e) {
  this.classList.remove("dragging");
  document.querySelectorAll(".rounds-order-item").forEach((item) => {
    item.classList.remove("drag-over");
  });
  draggedItem = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}

function handleDragEnter(e) {
  e.preventDefault();
  if (this !== draggedItem) {
    this.classList.add("drag-over");
  }
}

function handleDragLeave(e) {
  this.classList.remove("drag-over");
}

function handleDrop(e) {
  e.preventDefault();
  this.classList.remove("drag-over");

  if (draggedItem && this !== draggedItem) {
    const fromIndex = parseInt(draggedItem.dataset.index);
    const toIndex = parseInt(this.dataset.index);

    // Перемещаем элемент в массиве
    const item = tempRoundsOrder.splice(fromIndex, 1)[0];
    tempRoundsOrder.splice(toIndex, 0, item);

    // Перерисовываем список
    renderRoundsOrderList();
  }
}

// Сохранить порядок туров
async function saveRoundsOrder() {
  roundsOrder = [...tempRoundsOrder];
  await saveRoundsOrderToStorage();
  closeRoundsOrderModal();
  displayMatches();
}

// Сортировать туры по сохраненному порядку
function sortRoundsByOrder(rounds) {
  return rounds.sort((a, b) => {
    const indexA = roundsOrder.indexOf(a);
    const indexB = roundsOrder.indexOf(b);

    // Если оба в сохраненном порядке - сортируем по индексу
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }
    // Если только a в порядке - a идет первым
    if (indexA !== -1) return -1;
    // Если только b в порядке - b идет первым
    if (indexB !== -1) return 1;
    // Если оба не в порядке - оставляем как есть
    return 0;
  });
}

// Загрузить конфигурацию сервера
async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    ADMIN_LOGIN = config.ADMIN_LOGIN;
    ADMIN_DB_NAME = config.ADMIN_DB_NAME;
  } catch (error) {
    console.error("❌ Ошибка при загрузке конфигурации:", error);
  }
}

// Загрузить турниры при загрузке страницы
document.addEventListener("DOMContentLoaded", async () => {
  // Загружаем конфиг сначала
  await loadConfig();

  // Загружаем сохраненный порядок туров из БД
  await loadRoundsOrder();

  // Проверяем, есть ли пользователь в localStorage
  const savedUser = localStorage.getItem("currentUser");

  if (savedUser) {
    const user = JSON.parse(savedUser);
    currentUser = user;

    // Обновляем классы контейнера для показа контента
    const container = document.querySelector(".container");
    container.classList.remove("not-logged-in");
    container.classList.add("logged-in");

    // Меняем логотип с анимированного на обычный
    document.getElementById("headerLogo").src = "img/logo_nobg.png";

    // Показываем информацию о пользователе
    document.getElementById("userStatus").style.display = "block";
    document.getElementById("usernameBold").textContent = user.username;
    document.getElementById("username").value = user.username;
    document.getElementById("username").disabled = true;

    // Меняем кнопку на "Выход"
    const authBtn = document.getElementById("authBtn");
    authBtn.textContent = "Выход";
    authBtn.style.border = "1px solid rgba(244, 67, 54)";
    authBtn.style.background = "transparent";
    authBtn.onclick = () => logoutUser();

    // Показываем админ-кнопки если это админ
    if (user.isAdmin) {
      document.getElementById("adminBtn").style.display = "inline-block";
      document.getElementById("countingBtn").style.display = "inline-block";
      document.getElementById("adminSettingsPanel").style.display = "block";
    }

    loadEvents();
    loadMyBets();
  } else {
    loadEvents();
  }

  // Запускаем обновление статусов матчей каждые 30 секунд
  matchUpdateInterval = setInterval(() => {
    if (matches.length > 0 && isMatchUpdatingEnabled) {
      displayMatches();
    }
  }, 30000);
});

// ===== ПОЛЬЗОВАТЕЛЬ =====

async function initUser() {
  let username = document.getElementById("username").value.trim();

  if (!username) {
    alert("Пожалуйста, введите имя");
    return;
  }

  // Преобразуем первую букву в заглавную
  username = username.charAt(0).toUpperCase() + username.slice(1).toLowerCase();

  // Проверяем, пытается ли кто-то логиниться под ADMIN_DB_NAME
  if (username === ADMIN_DB_NAME) {
    // Отправляем уведомление админу в Telegram
    fetch("/api/notify-admin-login-attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptedUsername: username }),
    }).catch((err) => console.error("Ошибка отправки уведомления:", err));

    alert("Ну, ты давай не охуевай совсем, малютка");
    document.getElementById("username").value = "";
    return;
  }

  // Если админ логинится под ADMIN_LOGIN, то отправляем ADMIN_DB_NAME на сервер
  let usernameToSend = username === ADMIN_LOGIN ? ADMIN_DB_NAME : username;
  let isAdminUser = username === ADMIN_LOGIN;

  // Обновляем input с правильным логином
  document.getElementById("username").value = usernameToSend;

  try {
    const response = await fetch("/api/user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: usernameToSend }),
    });

    const user = await response.json();
    currentUser = user;
    currentUser.isAdmin = isAdminUser; // Устанавливаем флаг админа

    // Сохраняем пользователя в localStorage
    localStorage.setItem("currentUser", JSON.stringify(currentUser));

    // Обновляем классы контейнера для показа контента
    const container = document.querySelector(".container");
    container.classList.remove("not-logged-in");
    container.classList.add("logged-in");

    // Меняем логотип с анимированного на обычный
    document.getElementById("headerLogo").src = "img/logo_nobg.png";

    // Показываем информацию о пользователе
    document.getElementById("userStatus").style.display = "block";
    document.getElementById("usernameBold").textContent = user.username;
    document.getElementById("username").disabled = true;

    // Меняем кнопку на "Выход"
    const authBtn = document.getElementById("authBtn");
    authBtn.textContent = "Выход";
    authBtn.style.background = "transparent";
    authBtn.onclick = () => logoutUser();

    // Показываем админ-кнопки если это админ
    if (currentUser.isAdmin) {
      document.getElementById("adminBtn").style.display = "inline-block";
      document.getElementById("countingBtn").style.display = "inline-block";
      document.getElementById("adminSettingsPanel").style.display = "block";
    }

    // Загружаем ставки пользователя
    loadMyBets();
  } catch (error) {
    console.error("Ошибка при входе:", error);
    alert("Ошибка при входе");
  }
}

// Функция выхода из аккаунта
function logoutUser() {
  // Удаляем пользователя из localStorage
  localStorage.removeItem("currentUser");

  // Очищаем переменную
  currentUser = null;

  // Обновляем классы контейнера для скрытия контента
  const container = document.querySelector(".container");
  container.classList.remove("logged-in");
  container.classList.add("not-logged-in");

  // Меняем логотип обратно на анимированный
  document.getElementById("headerLogo").src = "img/logo_anim.gif";

  // Скрываем информацию о пользователе
  document.getElementById("userStatus").style.display = "none";
  document.getElementById("username").value = "";
  document.getElementById("username").disabled = false;

  // Скрываем админ-кнопки
  document.getElementById("adminBtn").style.display = "none";
  document.getElementById("countingBtn").style.display = "none";
  document.getElementById("adminSettingsPanel").style.display = "none";

  // Меняем кнопку обратно на "Начать"
  const authBtn = document.getElementById("authBtn");
  authBtn.textContent = "Войти";
  authBtn.style.background = "";
  authBtn.style.border = "1px solid #0066cc";
  authBtn.onclick = () => initUser();

  // Очищаем ставки
  document.getElementById("myBetsList").innerHTML =
    '<div class="empty-message">У вас пока нет ставок</div>';
}

// ===== ТУРНИРЫ =====

async function loadEvents() {
  try {
    const response = await fetch("/api/events");
    events = await response.json();
    displayEvents();

    // При первой загрузке выбираем первый незаблокированный турнир
    if (!currentEventId && events.length > 0) {
      const firstActiveEvent =
        events.find((e) => !e.locked_reason) || events[0];
      selectEvent(firstActiveEvent.id);
    }
  } catch (error) {
    console.error("Ошибка при загрузке событий:", error);
    document.getElementById("eventsList").innerHTML =
      '<div class="empty-message">Ошибка при загрузке событий</div>';
  }
}

function displayEvents() {
  const eventsList = document.getElementById("eventsList");

  if (events.length === 0) {
    eventsList.innerHTML =
      '<div class="empty-message">Событий не найдено</div>';
    return;
  }

  // Сортируем события: активные сверху, заблокированные снизу
  const sortedEvents = [...events].sort((a, b) => {
    const aLocked = a.locked_reason ? 1 : 0;
    const bLocked = b.locked_reason ? 1 : 0;
    return aLocked - bLocked;
  });

  let html = "";
  let lastWasLocked = false;
  let activeIndex = 1;
  let completedIndex = 1;

  html += sortedEvents
    .map((event) => {
      // Добавляем разделитель перед заблокированными турнирами
      let separator = "";
      if (event.locked_reason && !lastWasLocked) {
        separator =
          '<div style="text-align: center; color: #ccc; font-size: 0.9em;">━━━ ЗАВЕРШЕННЫЕ ТУРНИРЫ ━━━</div>';
        completedIndex = 1; // Начинаем нумерацию завершенных с 1
      }
      lastWasLocked = !!event.locked_reason;

      // Определяем номер позиции
      const positionNumber = event.locked_reason ? completedIndex : activeIndex;
      if (event.locked_reason) {
        completedIndex++;
      } else {
        activeIndex++;
      }

      // Если турнир заблокирован, показываем индикатор
      const lockedBadge = event.locked_reason
        ? `<div style="display: flex; align-items: center; gap: 5px; margin-top: 8px; padding: 5px 8px; background: #ffe0e0; border-radius: 3px;">
              <span style="color: #f44336; font-weight: bold; font-size: 0.8em;">🔒</span>
              <span style="color: #666; font-size: 0.85em;">${event.locked_reason}</span>
            </div>`
        : "";

      return `${separator}
        <div style="display: flex; align-items: flex-start; gap: 10px;">
          <div style="font-size: 1em; font-weight: bold; color: #667eea; min-width: 30px; text-align: center; padding-top: 5px;">#${positionNumber}</div>
          <div class="event-item ${event.locked_reason ? "locked" : ""} ${
        event.id === currentEventId ? "active" : ""
      }" style="flex: 1;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div onclick="selectEvent(${event.id}, '${
        event.name
      }')" style="flex: 1; cursor: ${
        event.locked_reason ? "not-allowed" : "pointer"
      };">
                <strong>${event.name}</strong>
                <p style="font-size: 0.9em; opacity: 0.7; margin-top: 5px;">${
                  event.description || "Нет описания"
                }</p>
                ${
                  event.start_date || event.end_date
                    ? `<p style="font-size: 0.85em; opacity: 0.6; margin-top: 3px;">
                        ${
                          event.start_date
                            ? `📅 с ${new Date(
                                event.start_date
                              ).toLocaleDateString("ru-RU")}`
                            : ""
                        }
                        ${
                          event.end_date
                            ? ` по ${new Date(
                                event.end_date
                              ).toLocaleDateString("ru-RU")}`
                            : ""
                        }
                      </p>`
                    : ""
                }
                ${lockedBadge}
              </div>
              ${
                isAdmin()
                  ? `<div style="display: flex; gap: 5px; margin-left: 10px; flex-wrap: wrap; justify-content: flex-end;">
                    <button onclick="openEditEventModal(${
                      event.id
                    }, '${event.name.replace(/'/g, "\\'")}', '${
                      event.description
                        ? event.description.replace(/'/g, "\\'")
                        : ""
                    }', '${event.start_date || ""}', '${
                      event.end_date || ""
                    }')" style="background: transparent; padding: 5px; font-size: 0.8em; border: 1px solid #2196f3; color: #2196f3; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(33, 150, 243, 0.1)'" onmouseout="this.style.background='transparent'">✏️</button>
                    ${
                      event.locked_reason
                        ? `<button onclick="unlockEvent(${event.id})" style="background: transparent; padding: 5px; font-size: 0.8em; border: 1px solid #4caf50; color: #4caf50; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(76, 175, 80, 0.1)'" onmouseout="this.style.background='transparent'">🔓</button>`
                        : `<button onclick="openLockEventModal(${event.id}, '${event.name}')" style="background: transparent; padding: 5px; font-size: 0.8em; border: 1px solid #ff9800; color: #ff9800; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(255, 152, 0, 0.1)'" onmouseout="this.style.background='transparent'">🔒</button>`
                    }
                    <button class="event-delete-btn" onclick="deleteEvent(${
                      event.id
                    })" style="background: transparent; padding: 5px 10px; font-size: 0.8em; border: 1px solid #f44336; color: #f44336; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(244, 67, 54, 0.1)'" onmouseout="this.style.background='transparent'">✕</button>
                  </div>`
                  : ""
              }
            </div>
          </div>
        </div>
    `;
    })
    .join("");

  eventsList.innerHTML = html;
}

async function selectEvent(eventId, eventName) {
  // Проверяем, заблокирован ли турнир
  const event = events.find((e) => e.id === eventId);

  if (event && event.locked_reason) {
    alert(`Этот турнир заблокирован.\nПричина: ${event.locked_reason}`);
    return;
  }

  currentEventId = eventId;
  displayEvents(); // Обновляем выделение

  // Показываем кнопку добавления матча для админа
  const addMatchBtn = document.getElementById("addMatchBtn");
  if (addMatchBtn && isAdmin()) {
    addMatchBtn.style.display = "inline-block";
  }

  loadMatches(eventId);
}

// ===== МАТЧИ =====

// Определяем статус матча на основе даты
function getMatchStatusByDate(match) {
  // Сначала проверяем явный статус finished (только если есть победитель)
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

async function loadMatches(eventId) {
  try {
    const response = await fetch(`/api/events/${eventId}/matches`);
    matches = await response.json();
    currentRoundFilter = "all"; // Сбрасываем фильтр при загрузке нового турнира
    displayMatches();
  } catch (error) {
    console.error("Ошибка при загрузке матчей:", error);
    document.getElementById("matchesContainer").innerHTML =
      '<div class="empty-message">Ошибка при загрузке матчей</div>';
  }
}

// Фильтрация матчей по туру
function filterByRound(round) {
  currentRoundFilter = round;
  displayMatches();
}

function displayMatches() {
  const matchesContainer = document.getElementById("matchesContainer");
  const roundsFilterContainer = document.getElementById(
    "roundsFilterContainer"
  );

  if (matches.length === 0) {
    matchesContainer.innerHTML =
      '<div class="empty-message">Матчи не найдены</div>';
    roundsFilterContainer.style.display = "none";
    return;
  }

  // Собираем уникальные туры из матчей
  const uniqueRounds = [
    ...new Set(matches.map((m) => m.round).filter((r) => r && r.trim())),
  ];

  // Сортируем туры по сохраненному порядку
  const rounds = sortRoundsByOrder(uniqueRounds);

  // Показываем фильтры только если есть хотя бы один тур
  if (rounds.length > 0) {
    // Если текущий фильтр "all" или не существует в списке туров, выбираем первый тур
    if (currentRoundFilter === "all" || !rounds.includes(currentRoundFilter)) {
      currentRoundFilter = rounds[0];
    }

    roundsFilterContainer.style.display = "block";
    const filterButtons = roundsFilterContainer.querySelector("div");

    // Проверяем, является ли текущий пользователь админом
    const isAdmin = currentUser && currentUser.isAdmin;

    filterButtons.innerHTML = `
      ${rounds
        .map(
          (round) => `
        <button class="round-filter-btn ${
          currentRoundFilter === round ? "active" : ""
        }" data-round="${round}" onclick="filterByRound('${round.replace(
            /'/g,
            "\\'"
          )}')">${round}</button>
      `
        )
        .join("")}
      ${
        isAdmin
          ? '<button class="edit-rounds-btn" onclick="openRoundsOrderModal()" title="Изменить порядок туров">✎</button>'
          : ""
      }
    `;
  } else {
    roundsFilterContainer.style.display = "none";
    currentRoundFilter = "all"; // Сбрасываем фильтр если туров нет
  }

  // Фильтруем матчи по выбранному туру
  let filteredMatches = matches;
  if (currentRoundFilter !== "all" && rounds.length > 0) {
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

  matchesContainer.innerHTML = sortedMatches
    .map((match) => {
      // Определяем статус на основе даты
      const effectiveStatus = getMatchStatusByDate(match);

      // Проверяем, есть ли ставка пользователя на этот матч
      const userBetOnMatch = userBets.find((bet) => bet.match_id === match.id);
      const betClass = userBetOnMatch ? "has-user-bet" : "";

      // Определяем текст и цвет статуса
      let statusBadge = "";
      if (effectiveStatus === "ongoing") {
        statusBadge =
          '<span style="display: inline-block; padding: 3px 8px; background: #ff9800; color: white; border-radius: 12px; font-size: 0.75em; margin-left: 5px;">🔴 ИДЕТ</span>';
      } else if (effectiveStatus === "finished") {
        statusBadge =
          '<span style="display: inline-block; padding: 3px 8px; background: #666; color: white; border-radius: 12px; font-size: 0.75em; margin-left: 5px;">✓ ЗАВЕРШЕН</span>';
      }

      return `
        <div class="match-row ${betClass}" style="position: relative;">
            ${
              isAdmin()
                ? `
              <div style="position: absolute; top: 5px; left: 5px; display: flex; gap: 5px; z-index: 10;">
                <button onclick="setMatchResult(${match.id}, 'team1')"
                  style="background: #1976d2; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.75em; font-weight: bold;"
                  onmouseover="this.style.background='#1565c0'"
                  onmouseout="this.style.background='#1976d2'">
                  1
                </button>
                <button onclick="setMatchResult(${match.id}, 'draw')"
                  style="background: #f57c00; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.75em; font-weight: bold;"
                  onmouseover="this.style.background='#e65100'"
                  onmouseout="this.style.background='#f57c00'">
                  X
                </button>
                <button onclick="setMatchResult(${match.id}, 'team2')"
                  style="background: #388e3c; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.75em; font-weight: bold;"
                  onmouseover="this.style.background='#2e7d32'"
                  onmouseout="this.style.background='#388e3c'">
                  2
                </button>
              </div>
              <div style="position: absolute; top: 5px; right: 5px; display: flex; gap: 5px; z-index: 10;">
                <button onclick="openEditMatchModal(${match.id}, '${
                    match.team1_name
                  }', '${match.team2_name}', '${match.match_date || ""}', '${
                    match.round || ""
                  }')"
                  style="background: transparent; border: 1px solid #0066cc; color: #0066cc; padding: 5px 10px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.6em;"
                  onmouseover="this.style.background='#0066cc'; this.style.color='white'"
                  onmouseout="this.style.background='transparent'; this.style.color='#0066cc'">
                  ✏️
                </button>
                <button onclick="deleteMatch(${match.id})"
                  style="background: transparent; border: 1px solid #f44336; color: #f44336; padding: 5px 10px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.6em;"
                  onmouseover="this.style.background='#f44336'; this.style.color='white'"
                  onmouseout="this.style.background='transparent'; this.style.color='#f44336'">
                  ✕
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
                  match.round
                    ? `<div style="text-align: center; font-size: 0.8em; color: #667eea; font-weight: 500; margin: 5px auto 0;">${match.round}</div>`
                    : ""
                }
                ${
                  match.match_date
                    ? `<div style="text-align: center; font-size: 0.85em; color: #999; margin: 10px auto;">${new Date(
                        match.match_date
                      ).toLocaleString("ru-RU", {
                        hour: "2-digit",
                        minute: "2-digit",
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                      })}${statusBadge}</div>`
                    : ""
                }
                <div class="bet-buttons-three">
                    <button class="bet-btn team1 ${
                      userBetOnMatch?.prediction === match.team1_name
                        ? "selected"
                        : ""
                    }" onclick="placeBet(${match.id}, '${match.team1_name}', '${
        match.team1_name
      }')" ${
        effectiveStatus !== "pending" ||
        userBetOnMatch?.prediction === match.team1_name
          ? "disabled"
          : ""
      }>
                        ${match.team1_name}
                    </button>
                    <button class="bet-btn draw ${
                      userBetOnMatch?.prediction === "Ничья" ? "selected" : ""
                    }" onclick="placeBet(${match.id}, 'Ничья', 'Ничья')" ${
        effectiveStatus !== "pending" || userBetOnMatch?.prediction === "Ничья"
          ? "disabled"
          : ""
      }>
                        Ничья
                    </button>
                    <button class="bet-btn team2 ${
                      userBetOnMatch?.prediction === match.team2_name
                        ? "selected"
                        : ""
                    }" onclick="placeBet(${match.id}, '${match.team2_name}', '${
        match.team2_name
      }')" ${
        effectiveStatus !== "pending" ||
        userBetOnMatch?.prediction === match.team2_name
          ? "disabled"
          : ""
      }>
                        ${match.team2_name}
                    </button>
                </div>
            </div>
        </div>
    `;
    })
    .join("");

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
}

// ===== СТАВКИ =====

async function placeBet(matchId, teamName, prediction) {
  if (!currentUser) {
    alert("Сначала введите ваше имя");
    return;
  }

  // Проверяем статус матча на основе даты
  const match = matches.find((m) => m.id === matchId);
  if (match) {
    const effectiveStatus = getMatchStatusByDate(match);
    if (effectiveStatus !== "pending") {
      alert("Ну, куда ты, малютка, матч уже начался");

      // Отправляем уведомление админу о попытке запретной ставки
      try {
        await fetch("/api/admin/notify-illegal-bet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: currentUser.username,
            team1: match.team1_name,
            team2: match.team2_name,
            prediction: prediction || teamName,
            matchStatus: effectiveStatus,
          }),
        });
      } catch (error) {
        console.error("Ошибка при отправке уведомления:", error);
      }

      return;
    }
  }

  const betAmount = 1; // Фиксированная сумма ставки

  try {
    // Сначала проверяем, есть ли уже ставка этого пользователя на этот матч
    const checkResponse = await fetch(`/api/user/${currentUser.id}/bets`);
    const allBets = await checkResponse.json();
    const existingBet = allBets.find((bet) => bet.match_id === matchId);

    // Если уже есть ставка на этот матч - удаляем её
    if (existingBet) {
      await fetch(`/api/bets/${existingBet.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: currentUser.id,
        }),
      });
    }

    // Создаём новую ставку
    const response = await fetch("/api/bets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: currentUser.id,
        match_id: matchId,
        prediction: prediction || teamName,
        amount: betAmount,
      }),
    });

    if (response.ok) {
      loadMyBets();
    } else {
      alert("Ошибка при создании ставки");
    }
  } catch (error) {
    console.error("Ошибка при размещении ставки:", error);
    alert("Ошибка при размещении ставки");
  }
}

async function loadMyBets() {
  if (!currentUser) return;

  try {
    const response = await fetch(`/api/user/${currentUser.id}/bets`);
    const bets = await response.json();
    userBets = bets; // Сохраняем в глобальную переменную
    displayMyBets(bets);
    if (isMatchUpdatingEnabled) {
      displayMatches(); // Перерисовываем матчи чтобы выделить с ставками
    }
  } catch (error) {
    console.error("Ошибка при загрузке ставок:", error);
  }
}

function displayMyBets(bets) {
  const myBetsList = document.getElementById("myBetsList");

  if (bets.length === 0) {
    myBetsList.innerHTML =
      '<div class="empty-message">У вас пока нет ставок</div>';
    return;
  }

  myBetsList.innerHTML = bets
    .map((bet) => {
      let statusClass = "pending";
      let statusText = "⏳ В ожидании";

      if (bet.winner) {
        // Маппинг winner (из БД) в prediction format
        // winner: "team1" | "team2" | "draw"
        // prediction: team1_name | team2_name | "Ничья"
        let winnerPrediction;
        if (bet.winner === "team1") {
          winnerPrediction = bet.team1_name;
        } else if (bet.winner === "team2") {
          winnerPrediction = bet.team2_name;
        } else if (bet.winner === "draw") {
          winnerPrediction = "Ничья";
        }

        if (winnerPrediction === bet.prediction) {
          statusClass = "won";
          statusText = "✅ Выиграла";
        } else {
          statusClass = "lost";
          statusText = "❌ Проиграла";
        }
      }

      // Показываем кнопку удаления: админу всегда, остальным только для матчей со статусом "pending"
      const canDelete = isAdmin() || bet.match_status === "pending";
      const deleteBtn = canDelete
        ? `<button class="bet-delete-btn" onclick="deleteBet(${bet.id})">✕</button>`
        : "";

      return `
            <div class="bet-item ${statusClass}" data-bet-id="${bet.id}">
                <div class="bet-info">
                    <span class="bet-match">${bet.team1_name} vs ${
        bet.team2_name
      }</span>
                    <span class="bet-status ${statusClass}">${statusText}</span>
                </div>
                <div class="bet-info" style="font-size: 0.9em; color: #666;">
                    <span>Ставка: <strong>${bet.prediction}</strong></span>
                </div>
                <div style="font-size: 0.85em; color: #999; margin-top: 5px;">
                    Турнир: ${bet.event_name}${
        bet.round ? ` • ${bet.round}` : ""
      }
                </div>
                ${deleteBtn}
            </div>
        `;
    })
    .join("");
}

// Удалить ставку
async function deleteBet(betId) {
  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  try {
    const response = await fetch(`/api/bets/${betId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: currentUser.id,
        username: currentUser.username,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert("Ошибка: " + result.error);
      return;
    }

    // ✨ Удаляем ставку из DOM плавной анимацией без перезагрузки
    const betElement = document.querySelector(`[data-bet-id="${betId}"]`);
    if (betElement) {
      betElement.style.opacity = "0.5";
      betElement.style.transform = "scale(0.95)";
      betElement.style.transition = "all 0.3s ease";

      setTimeout(() => {
        betElement.remove();

        // Если ставок больше нет - показываем пустое сообщение
        const myBetsList = document.getElementById("myBetsList");
        if (myBetsList.children.length === 0) {
          myBetsList.innerHTML =
            '<div class="empty-message">У вас пока нет ставок</div>';
        }

        // 🔄 Обновляем карточки матчей, чтобы убрать подсветку
        if (currentEventId) {
          loadMatches(currentEventId);
        }
      }, 300);
    }

    // Обновляем локальный массив ставок
    userBets = userBets.filter((bet) => bet.id !== betId);
  } catch (error) {
    console.error("Ошибка при удалении ставки:", error);
    alert("Ошибка при удалении ставки");
  }
}

// ===== ВКЛАДКИ =====

function switchTab(tabName) {
  // Скрываем все содержимое вкладок
  document.getElementById("allbets-content").style.display = "none";
  document.getElementById("participants-content").style.display = "none";
  document.getElementById("profile-content").style.display = "none";
  document.getElementById("settings-content").style.display = "none";
  document.getElementById("counting-content").style.display = "none";

  // Удаляем активный класс со всех кнопок вкладок
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  // Показываем нужное содержимое и отмечаем кнопку как активную
  if (tabName === "allbets") {
    document.getElementById("allbets-content").style.display = "grid";
    document.querySelectorAll(".tab-btn")[0].classList.add("active");
    loadEvents();
    if (currentEventId) {
      loadMatches(currentEventId);
    }
    loadMyBets();
  } else if (tabName === "participants") {
    document.getElementById("participants-content").style.display = "flex";
    document.querySelectorAll(".tab-btn")[1].classList.add("active");
    loadParticipants();
  } else if (tabName === "profile") {
    document.getElementById("profile-content").style.display = "flex";
    document.querySelectorAll(".tab-btn")[2].classList.add("active");
    loadProfile();
  } else if (tabName === "settings") {
    document.getElementById("settings-content").style.display = "flex";
    document.querySelectorAll(".tab-btn")[3].classList.add("active");
    loadSettings();
  } else if (tabName === "counting") {
    document.getElementById("counting-content").style.display = "flex";
    // Отмечаем кнопку подсчета как активную (не табуляцию, так как это отдельная кнопка)
    loadCounting();
  }
}
// Загрузить всех участников с их ставками
async function loadParticipants() {
  try {
    const response = await fetch("/api/participants");
    const participants = await response.json();
    displayParticipants(participants);
  } catch (error) {
    console.error("Ошибка при загрузке участников:", error);
    document.getElementById("participantsList").innerHTML =
      '<div class="empty-message">Ошибка при загрузке участников</div>';
  }
}

// Отобразить участников
function displayParticipants(participants) {
  const participantsList = document.getElementById("participantsList");

  if (participants.length === 0) {
    participantsList.innerHTML =
      '<div class="empty-message">Участники не найдены</div>';
    return;
  }

  participantsList.innerHTML = participants
    .map(
      (participant) => `
    <div class="participant-item">
      <div class="participant-info">
        <div class="participant-name">${participant.username}</div>
        <div class="participant-stats">
          Всего ставок: ${participant.total_bets} | 
          Выигрышей: ${participant.won_bets} | 
          Проигрышей: ${participant.lost_bets} | 
          В ожидании: ${participant.pending_bets}
        </div>
      </div>
      <div class="participant-bets-count">${participant.total_bets}</div>
    </div>
  `
    )
    .join("");
}

// ===== ПРОФИЛЬ =====

async function loadProfile() {
  if (!currentUser) {
    alert("Пожалуйста, сначала войдите в аккаунт");
    return;
  }

  try {
    const response = await fetch(`/api/user/${currentUser.id}/profile`);
    const profile = await response.json();
    displayProfile(profile);
  } catch (error) {
    console.error("Ошибка при загрузке профиля:", error);
    document.getElementById("profileContainer").innerHTML =
      '<div class="empty-message">Ошибка при загрузке профиля</div>';
  }
}

function displayProfile(profile) {
  const profileContainer = document.getElementById("profileContainer");

  const createdDate = new Date(profile.created_at).toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  profileContainer.innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar">
      <img src="img/logo_nobg.png" style="width: 100px;">
      </div>
      <div class="profile-username">${profile.username}</div>
      <div class="profile-member-since">Участник с ${createdDate}</div>
    </div>

    <div class="profile-stats-grid">
      <div class="stat-card">
        <div class="stat-label">Всего ставок</div>
        <div class="stat-value">${profile.total_bets}</div>
      </div>
      <div class="stat-card won">
        <div class="stat-label">✅ Угаданных ставок всего</div>
        <div class="stat-value">${profile.won_bets}</div>
      </div>
      <div class="stat-card lost">
        <div class="stat-label">❌ Неугаданных ставок всего</div>
        <div class="stat-value">${profile.lost_bets}</div>
      </div>
      <div class="stat-card pending">
        <div class="stat-label">⏳ В ожидании</div>
        <div class="stat-value">${profile.pending_bets}</div>
      </div>
    </div>

    <div class="profile-section">
      <div class="profile-section-title">📊 Статистика</div>
      <div class="profile-section-content">
        <p><strong>Процент побед:</strong> ${
          profile.total_bets > 0
            ? ((profile.won_bets / profile.total_bets) * 100).toFixed(1)
            : 0
        }%</p>
      </div>
    </div>
  `;
}

// ===== ДЕМО-ДАННЫЕ =====

async function seedData() {
  try {
    const response = await fetch("/api/seed-data", {
      method: "POST",
    });

    const result = await response.json();
    alert(result.message);
    loadEvents();
  } catch (error) {
    console.error("Ошибка при загрузке демо-данных:", error);
    alert("Ошибка при загрузке демо-данных");
  }
}

// ===== АДМИН-ФУНКЦИИ =====

// Проверить, является ли пользователь админом
function isAdmin() {
  return currentUser && currentUser.isAdmin === true;
}

// Создать новое событие (только для админа)
function openCreateEventModal() {
  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  if (!isAdmin()) {
    alert("У вас нет прав для создания событий");
    return;
  }

  // Открываем модальное окно
  const modal = document.getElementById("createEventModal");
  if (modal) {
    modal.style.display = "flex";
  }
}

// Закрыть модальное окно для создания турнира
function closeCreateEventModal() {
  const modal = document.getElementById("createEventModal");
  modal.style.display = "none";

  // Очищаем форму
  document.getElementById("createEventForm").reset();
}

// Отправить форму создания турнира
async function submitCreateEvent(event) {
  event.preventDefault();

  const name = document.getElementById("eventName").value.trim();
  const description = document.getElementById("eventDescription").value.trim();
  const start_date = document.getElementById("eventDate").value;
  const end_date = document.getElementById("eventEndDate").value;

  if (!name) {
    alert("Пожалуйста, введите название турнира");
    return;
  }

  try {
    const response = await fetch("/api/admin/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser.username,
        name,
        description: description || null,
        start_date: start_date || null,
        end_date: end_date || null,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert("Ошибка: " + result.error);
      return;
    }

    // Закрываем модальное окно
    closeCreateEventModal();

    // Перезагружаем турниры
    loadEvents();
  } catch (error) {
    console.error("Ошибка при создании турнира:", error);
    alert("Ошибка при создании турнира");
  }
}

// Удалить событие (только для админа)
async function deleteEvent(eventId) {
  console.log("deleteEvent вызвана для eventId:", eventId);
  console.log("currentUser:", currentUser);
  console.log("isAdmin():", isAdmin());

  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  if (!isAdmin()) {
    alert("У вас нет прав для удаления событий");
    return;
  }

  if (!confirm("Вы уверены, что хотите удалить это событие?")) {
    return;
  }

  try {
    const response = await fetch(`/api/admin/events/${eventId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser.username,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert("Ошибка: " + result.error);
      return;
    }

    loadEvents();
  } catch (error) {
    console.error("Ошибка при удалении турнира:", error);
    alert("Ошибка при удалении турнира");
  }
}

// Открыть модальное окно для блокировки турнира
function openLockEventModal(eventId, eventName) {
  if (!isAdmin()) {
    alert("У вас нет прав");
    return;
  }

  // Сохраняем ID события для использования в submitLockEvent
  document.getElementById("lockEventForm").dataset.eventId = eventId;
  document.getElementById("lockEventForm").dataset.eventName = eventName;

  const modal = document.getElementById("lockEventModal");
  if (modal) {
    modal.style.display = "flex";
  }
}

// Закрыть модальное окно для блокировки турнира
function closeLockEventModal() {
  const modal = document.getElementById("lockEventModal");
  modal.style.display = "none";

  // Очищаем форму
  document.getElementById("lockEventForm").reset();
  delete document.getElementById("lockEventForm").dataset.eventId;
}

// Отправить форму блокировки турнира
async function submitLockEvent(event) {
  event.preventDefault();

  const form = document.getElementById("lockEventForm");
  const eventId = form.dataset.eventId;
  const reason = document.getElementById("eventLockReason").value.trim();

  if (!reason) {
    alert("Пожалуйста, укажите причину блокировки");
    return;
  }

  try {
    const response = await fetch(`/api/admin/events/${eventId}/lock`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser.username,
        reason: reason,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert("Ошибка: " + result.error);
      return;
    }

    // Закрываем модальное окно
    closeLockEventModal();

    // Перезагружаем турниры
    loadEvents();
  } catch (error) {
    console.error("Ошибка при блокировке турнира:", error);
    alert("Ошибка при блокировке турнира");
  }
}

// Разблокировать турнир
async function unlockEvent(eventId) {
  if (!isAdmin()) {
    alert("У вас нет прав");
    return;
  }

  if (!confirm("Вы уверены, что хотите разблокировать этот турнир?")) {
    return;
  }

  try {
    const response = await fetch(`/api/admin/events/${eventId}/unlock`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser.username,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert("Ошибка: " + result.error);
      return;
    }

    // Перезагружаем турниры
    loadEvents();
  } catch (error) {
    console.error("Ошибка при разблокировке турнира:", error);
    alert("Ошибка при разблокировке турнира");
  }
}

// Открыть модальное окно редактирования турнира
function openEditEventModal(
  eventId,
  eventName,
  eventDescription,
  startDate,
  endDate
) {
  if (!isAdmin()) {
    alert("У вас нет прав");
    return;
  }

  // Сохраняем ID события для использования в submitEditEvent
  document.getElementById("editEventForm").dataset.eventId = eventId;

  // Заполняем поля формы текущими значениями
  document.getElementById("editEventName").value = eventName;
  document.getElementById("editEventDescription").value = eventDescription;
  document.getElementById("editEventStartDate").value = startDate
    ? startDate.split("T")[0]
    : "";
  document.getElementById("editEventEndDate").value = endDate
    ? endDate.split("T")[0]
    : "";

  const modal = document.getElementById("editEventModal");
  if (modal) {
    modal.style.display = "flex";
  }
}

// Закрыть модальное окно редактирования турнира
function closeEditEventModal() {
  const modal = document.getElementById("editEventModal");
  modal.style.display = "none";

  // Очищаем форму
  document.getElementById("editEventForm").reset();
  delete document.getElementById("editEventForm").dataset.eventId;
}

// Отправить форму редактирования турнира
async function submitEditEvent(event) {
  event.preventDefault();

  const form = document.getElementById("editEventForm");
  const eventId = form.dataset.eventId;
  const name = document.getElementById("editEventName").value.trim();
  const description = document
    .getElementById("editEventDescription")
    .value.trim();
  const start_date = document.getElementById("editEventStartDate").value;
  const end_date = document.getElementById("editEventEndDate").value;

  if (!name) {
    alert("Пожалуйста, укажите название турнира");
    return;
  }

  try {
    const response = await fetch(`/api/admin/events/${eventId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser.username,
        name: name,
        description: description,
        start_date: start_date || null,
        end_date: end_date || null,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert("Ошибка: " + result.error);
      return;
    }

    // Закрываем модальное окно
    closeEditEventModal();

    // Перезагружаем турниры
    loadEvents();
  } catch (error) {
    console.error("Ошибка при редактировании турнира:", error);
    alert("Ошибка при редактировании турнира");
  }
}

// ===== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ (ДЛЯ АДМИНА) =====

let adminUsers = [];

// Загрузить список всех пользователей
async function loadAdminUsers() {
  if (!isAdmin()) {
    alert("У вас нет прав для просмотра пользователей");
    return;
  }

  try {
    const response = await fetch(
      `/api/admin/users?username=${currentUser.username}`
    );
    adminUsers = await response.json();
    displayAdminUsersModal();
    document.getElementById("adminModal").style.display = "flex";
  } catch (error) {
    console.error("Ошибка при загрузке пользователей:", error);
    alert("Ошибка при загрузке пользователей");
  }
}

// Закрыть модальное окно
function closeAdminModal() {
  document.getElementById("adminModal").style.display = "none";
}

// Загрузить подсчет результатов
function loadCounting() {
  if (!isAdmin()) {
    alert("У вас нет прав");
    return;
  }

  // Здесь будет функционал для подсчета
  const countingContainer = document.getElementById("countingContainer");
  countingContainer.innerHTML =
    '<div class="empty-message">Функция в разработке</div>';
}

// Закрыть модальное окно при клике вне его
window.onclick = function (event) {
  const adminModal = document.getElementById("adminModal");
  if (event.target === adminModal) {
    adminModal.style.display = "none";
  }

  const lockEventModal = document.getElementById("lockEventModal");
  if (event.target === lockEventModal) {
    lockEventModal.style.display = "none";
  }

  const editEventModal = document.getElementById("editEventModal");
  if (event.target === editEventModal) {
    editEventModal.style.display = "none";
  }

  const createEventModal = document.getElementById("createEventModal");
  if (event.target === createEventModal) {
    createEventModal.style.display = "none";
  }

  const createMatchModal = document.getElementById("createMatchModal");
  if (event.target === createMatchModal) {
    createMatchModal.style.display = "none";
  }
};

// Отобразить список пользователей в модальном окне
function displayAdminUsersModal() {
  const adminUsersList = document.getElementById("adminUsersList");

  if (adminUsers.length === 0) {
    adminUsersList.innerHTML =
      '<div class="empty-message">Пользователей не найдено</div>';
    return;
  }

  adminUsersList.innerHTML = adminUsers
    .map(
      (user) => `
    <div class="admin-user-item">
      <div class="admin-user-info">
        <div class="admin-user-name">${user.username}</div>
        <div class="admin-user-stats">
          Ставок: ${user.total_bets || 0} | 
          Выиграл: ${user.won_bets || 0} | 
          Проиграл: ${user.lost_bets || 0}
        </div>
      </div>
      <div class="admin-user-actions">
        <button class="admin-btn admin-btn-rename" onclick="renameUser(${
          user.id
        }, '${user.username}')">✏️ Переименовать</button>
        <button class="admin-btn admin-btn-delete" onclick="deleteUser(${
          user.id
        }, '${user.username}')">🗑️ Удалить</button>
      </div>
    </div>
  `
    )
    .join("");
}

// Отобразить список пользователей в отдельном окне
function displayAdminUsers() {
  const usersHTML = adminUsers
    .map(
      (user) => `
    <div style="padding: 12px; background: #f0f0f0; border-radius: 5px; margin-bottom: 10px; border-left: 4px solid #667eea;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>${user.username}</strong>
          <p style="font-size: 0.85em; color: #999; margin: 3px 0;">Всего ставок: ${
            user.total_bets || 0
          } | Выиграл: ${user.won_bets || 0} | Проиграл: ${
        user.lost_bets || 0
      }</p>
        </div>
        <div style="display: flex; gap: 5px;">
          <button onclick="renameUser(${user.id}, '${
        user.username
      }')" style="background: #ff9800; padding: 5px 10px; font-size: 0.8em;">✏️ Переименовать</button>
          <button onclick="deleteUser(${user.id}, '${
        user.username
      }')" style="background: #f44336; padding: 5px 10px; font-size: 0.8em;">🗑️ Удалить</button>
        </div>
      </div>
    </div>
  `
    )
    .join("");

  alert(
    "Список пользователей:\n\n" +
      adminUsers
        .map((u) => `${u.username} (Ставок: ${u.total_bets})`)
        .join("\n")
  );
}

// Переименовать пользователя
async function renameUser(userId, currentUsername) {
  if (!isAdmin()) {
    alert("У вас нет прав");
    return;
  }

  const newUsername = prompt(`Новое имя для ${currentUsername}:`);
  if (!newUsername || newUsername.trim() === "") {
    return;
  }

  try {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser.username,
        newUsername: newUsername.trim(),
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert("Ошибка: " + result.error);
      return;
    }

    alert(result.message);
    loadAdminUsers();
  } catch (error) {
    console.error("Ошибка при переименовании:", error);
    alert("Ошибка при переименовании пользователя");
  }
}

// Удалить пользователя
async function deleteUser(userId, username) {
  if (!isAdmin()) {
    alert("У вас нет прав");
    return;
  }

  if (
    !confirm(
      `Вы уверены, что хотите удалить пользователя "${username}"?\nВсе его ставки будут удалены!`
    )
  ) {
    return;
  }

  try {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser.username,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert("Ошибка: " + result.error);
      return;
    }

    loadAdminUsers();
  } catch (error) {
    console.error("Ошибка при удалении:", error);
    alert("Ошибка при удалении пользователя");
  }
}

// Загрузить настройки
async function loadSettings() {
  if (!currentUser) {
    document.getElementById("settingsContainer").innerHTML =
      '<div class="empty-message">Войдите в систему для доступа к настройкам</div>';
    return;
  }

  try {
    // Загружаем текущий Telegram username
    const response = await fetch(`/api/user/${currentUser.id}/telegram`);
    const data = await response.json();
    const telegramUsername = data.telegram_username || "";

    document.getElementById("settingsContainer").innerHTML = `
      <!-- Telegram -->
      <div class="setting-item">
        <div class="setting-label">
          <span>📱 Telegram</span>
          ${
            telegramUsername
              ? `<a href="https://t.me/${telegramUsername}" target="_blank" class="setting-link">@${telegramUsername}</a>`
              : ""
          }
        </div>
        <p class="setting-hint">ТГ для уведомлений/напоминаний</p>
        <div class="setting-control">
          <input type="text" id="telegramUsernameInput" value="${telegramUsername}" placeholder="@username" onkeypress="if(event.key === 'Enter') saveTelegramUsername()">
          <button onclick="saveTelegramUsername()" class="btn-save">💾</button>
          ${
            telegramUsername
              ? `<button onclick="deleteTelegramUsername()" class="btn-delete">🗑️</button>`
              : ""
          }
        </div>
        <p class="setting-hint-small">Свой ТГ можно узнать в <a href="https://t.me/OnexBetLineBoomBot" target="_blank">боте</a> → Профиль или /profile</p>
      </div>
    `;
  } catch (error) {
    console.error("Ошибка при загрузке настроек:", error);
    document.getElementById("settingsContainer").innerHTML =
      '<div class="empty-message">Ошибка при загрузке настроек</div>';
  }
}

// Сохранить Telegram username
async function saveTelegramUsername() {
  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  const input = document.getElementById("telegramUsernameInput");
  const username = input.value.trim();

  try {
    const response = await fetch(`/api/user/${currentUser.id}/telegram`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_username: username }),
    });

    const result = await response.json();

    if (response.ok) {
      loadSettings(); // Перезагружаем настройки
    } else {
      alert("Ошибка: " + result.error);
    }
  } catch (error) {
    console.error("Ошибка при сохранении:", error);
    alert("Ошибка при сохранении");
  }
}

// Удалить Telegram username
async function deleteTelegramUsername() {
  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  try {
    const response = await fetch(`/api/user/${currentUser.id}/telegram`, {
      method: "DELETE",
    });

    const result = await response.json();

    if (response.ok) {
      loadSettings(); // Перезагружаем настройки
    } else {
      alert("Ошибка: " + result.error);
    }
  } catch (error) {
    console.error("Ошибка при удалении:", error);
    alert("Ошибка при удалении");
  }
}

// ===== СОЗДАНИЕ МАТЧЕЙ =====

// Открыть модальное окно для создания матча
function openCreateMatchModal() {
  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  if (!isAdmin()) {
    alert("У вас нет прав для создания матчей");
    return;
  }

  if (!currentEventId) {
    alert("Пожалуйста, сначала выберите турнир");
    return;
  }

  // Открываем модальное окно
  const modal = document.getElementById("createMatchModal");
  if (modal) {
    modal.style.display = "flex";
  }
}

// Закрыть модальное окно для создания матча
function closeCreateMatchModal() {
  const modal = document.getElementById("createMatchModal");
  modal.style.display = "none";

  // Очищаем форму
  document.getElementById("createMatchForm").reset();
}

// Отправить форму создания матча
async function submitCreateMatch(event) {
  event.preventDefault();

  const team1 = document.getElementById("matchTeam1").value.trim();
  const team2 = document.getElementById("matchTeam2").value.trim();
  const matchDate = document.getElementById("matchDate").value;
  const round = document.getElementById("matchRound").value.trim();
  const copies = parseInt(document.getElementById("matchCopies").value) || 1;

  if (!team1 || !team2) {
    alert("Пожалуйста, введите обе команды");
    return;
  }

  if (!currentEventId) {
    alert("Турнир не выбран");
    return;
  }

  // Ограничиваем количество копий
  const copiesCount = Math.min(Math.max(copies, 1), 20);

  try {
    let created = 0;
    let lastError = null;

    for (let i = 0; i < copiesCount; i++) {
      const response = await fetch("/api/admin/matches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: currentUser.username,
          event_id: currentEventId,
          team1,
          team2,
          match_date: matchDate || null,
          round: round || null,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        lastError = result.error;
      } else {
        created++;
      }
    }

    if (created === 0 && lastError) {
      alert("Ошибка: " + lastError);
      return;
    }

    // Закрываем модальное окно
    closeCreateMatchModal();

    // Перезагружаем матчи
    loadMatches(currentEventId);
  } catch (error) {
    console.error("Ошибка при создании матча:", error);
    alert("Ошибка при создании матча: " + error.message);
  }
}

// ===== РЕДАКТИРОВАНИЕ И УДАЛЕНИЕ МАТЧЕЙ =====

function openEditMatchModal(id, team1, team2, date, round) {
  if (!isAdmin()) {
    alert("❌ Только администратор может редактировать матчи");
    return;
  }

  document.getElementById("editMatchId").value = id;
  document.getElementById("editMatchTeam1").value = team1;
  document.getElementById("editMatchTeam2").value = team2;
  document.getElementById("editMatchDate").value = date || "";
  document.getElementById("editMatchRound").value = round || "";
  document.getElementById("editMatchModal").style.display = "flex";
}

function closeEditMatchModal() {
  document.getElementById("editMatchModal").style.display = "none";
}

async function submitEditMatch(event) {
  event.preventDefault();

  const id = document.getElementById("editMatchId").value;
  const team1 = document.getElementById("editMatchTeam1").value.trim();
  const team2 = document.getElementById("editMatchTeam2").value.trim();
  const date = document.getElementById("editMatchDate").value;
  const round = document.getElementById("editMatchRound").value.trim();

  if (!team1 || !team2) {
    alert("❌ Заполните названия обеих команд");
    return;
  }

  try {
    const response = await fetch(`/api/admin/matches/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentUser.username,
        team1_name: team1,
        team2_name: team2,
        match_date: date,
        round: round || null,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      closeEditMatchModal();
      loadMatches(currentEventId);
    } else {
      alert(`❌ Ошибка: ${result.error}`);
    }
  } catch (error) {
    console.error("Ошибка при редактировании матча:", error);
    alert("❌ Ошибка при редактировании матча");
  }
}

async function deleteMatch(id) {
  if (!isAdmin()) {
    alert("❌ Только администратор может удалять матчи");
    return;
  }

  if (!confirm("⚠️ Вы уверены, что хотите удалить этот матч?")) {
    return;
  }

  try {
    const response = await fetch(`/api/admin/matches/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: currentUser.username }),
    });

    const result = await response.json();

    if (response.ok) {
      // Находим матч который удаляем
      const deletedMatch = matches.find((m) => m.id === id);

      if (deletedMatch) {
        // Удаляем ставки этого матча из DOM плавной анимацией
        const deletedBetIds = userBets
          .filter((bet) => bet.match_id === id)
          .map((bet) => bet.id);

        deletedBetIds.forEach((betId) => {
          const betElement = document.querySelector(`[data-bet-id="${betId}"]`);
          if (betElement) {
            betElement.style.opacity = "0.5";
            betElement.style.transform = "scale(0.95)";
            betElement.style.transition = "all 0.3s ease";

            setTimeout(() => {
              betElement.remove();

              // Если ставок больше нет - показываем пустое сообщение
              const myBetsList = document.getElementById("myBetsList");
              if (myBetsList.children.length === 0) {
                myBetsList.innerHTML =
                  '<div class="empty-message">У вас пока нет ставок</div>';
              }
            }, 300);
          }
        });

        // Обновляем локальный массив ставок
        userBets = userBets.filter((bet) => bet.match_id !== id);

        // Удаляем матч из массива
        matches = matches.filter((m) => m.id !== id);

        // Перерисовываем матчи БЕЗ полной перезагрузки
        displayMatches();
      }
    } else {
      alert(`❌ Ошибка: ${result.error}`);
    }
  } catch (error) {
    console.error("Ошибка при удалении матча:", error);
    alert("❌ Ошибка при удалении матча");
  }
}

// ===== УПРАВЛЕНИЕ ОБНОВЛЕНИЕМ МАТЧЕЙ (ДЛЯ КОНСОЛИ) =====

/**
 * Остановить автоматическое обновление матчей
 * Использование: stopMatchUpdates()
 */
function stopMatchUpdates() {
  isMatchUpdatingEnabled = false;
  // Также очищаем интервал полностью
  if (matchUpdateInterval) {
    clearInterval(matchUpdateInterval);
    matchUpdateInterval = null;
  }
  console.log("⏸️ Обновление матчей ПОЛНОСТЬЮ ОСТАНОВЛЕНО");
  console.log(
    "✓ Флаг isMatchUpdatingEnabled установлен в:",
    isMatchUpdatingEnabled
  );
  console.log("✓ Интервал отменён");
}

/**
 * Установить результат матча (завершить матч)
 * result: 'team1' | 'draw' | 'team2'
 * Использование: setMatchResult(matchId, 'team1')
 */
async function setMatchResult(matchId, result) {
  const match = matches.find((m) => m.id === matchId);
  if (!match) {
    console.error("Матч не найден:", matchId);
    return;
  }

  const resultMap = {
    team1: "team1_win",
    draw: "draw",
    team2: "team2_win",
  };

  try {
    const requestBody = {
      username: currentUser?.username,
      status: "finished",
      result: resultMap[result],
    };

    console.log("📤 Отправляем запрос завершения матча:", {
      matchId,
      result,
      requestBody,
    });

    const response = await fetch(`/api/admin/matches/${matchId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const responseData = await response.json();
    console.log("📥 Ответ сервера:", responseData, "статус:", response.status);

    if (response.ok) {
      // Обновляем матч локально
      match.status = "finished";
      match.result = resultMap[result];
      match.winner = result; // team1, draw, team2

      console.log(
        `✓ Матч ${match.team1_name} vs ${match.team2_name} завершен с результатом: ${result}`
      );
      displayMatches();

      // Обновляем ставки чтобы показать новые цвета (с небольшой задержкой для синхронизации с БД)
      setTimeout(() => {
        loadMyBets();
      }, 300);
    } else {
      console.error("Ошибка установки результата:", responseData.error);
      alert("Ошибка: " + responseData.error);
    }
  } catch (error) {
    console.error("Ошибка при установке результата:", error);
    alert("Ошибка при установке результата матча");
  }
}

/**
 * Запустить автоматическое обновление матчей
 * Использование: startMatchUpdates()
 */
function startMatchUpdates() {
  isMatchUpdatingEnabled = true;

  // Если интервала нет - создаём новый
  if (!matchUpdateInterval) {
    matchUpdateInterval = setInterval(() => {
      if (matches.length > 0 && isMatchUpdatingEnabled) {
        displayMatches();
      }
    }, 30000);
  }

  console.log("▶️ Обновление матчей ЗАПУЩЕНО");
  console.log(
    "✓ Флаг isMatchUpdatingEnabled установлен в:",
    isMatchUpdatingEnabled
  );
  console.log("✓ Интервал перезапущен (30 сек)");
}

/**
 * Переключить состояние обновления матчей
 * Использование: toggleMatchUpdates()
 */
function toggleMatchUpdates() {
  isMatchUpdatingEnabled = !isMatchUpdatingEnabled;
  const status = isMatchUpdatingEnabled ? "▶️ ЗАПУЩЕНО" : "⏸️ ОСТАНОВЛЕНО";
  console.log(`Обновление матчей: ${status}`);
}

/**
 * Получить статус обновления матчей
 * Использование: getMatchUpdateStatus()
 */
function getMatchUpdateStatus() {
  const status = isMatchUpdatingEnabled ? "▶️ АКТИВНО" : "⏸️ ОСТАНОВЛЕНО";
  console.log(`Статус обновления матчей: ${status}`);
  return {
    enabled: isMatchUpdatingEnabled,
    status: status,
    updateInterval: "30 секунд",
  };
}

/**
 * Обновить матчи прямо сейчас (принудительное обновление)
 * Использование: forceUpdateMatches()
 */
function forceUpdateMatches() {
  if (matches.length > 0) {
    displayMatches();
    console.log("🔄 Матчи обновлены принудительно");
  } else {
    console.log("ℹ️ Нет матчей для обновления");
  }
}

// Вывод справки в консоль при загрузке
console.log(
  "%c🎯 1xBetLineBoom - Команды управления обновлением матчей:",
  "color: #667eea; font-size: 14px; font-weight: bold;"
);
console.log(
  "%c  stopMatchUpdates()       - ⏸️ Остановить обновление каждые 30 сек",
  "color: #f44336; font-size: 12px;"
);
console.log(
  "%c  startMatchUpdates()      - ▶️ Запустить обновление каждые 30 сек",
  "color: #4caf50; font-size: 12px;"
);
console.log(
  "%c  toggleMatchUpdates()     - 🔄 Переключить (вкл ↔ выкл)",
  "color: #ff9800; font-size: 12px;"
);
console.log(
  "%c  getMatchUpdateStatus()   - ℹ️ Показать текущий статус",
  "color: #2196f3; font-size: 12px;"
);
console.log(
  "%c  forceUpdateMatches()     - 🔄 Обновить матчи СЕЙЧАС (вне графика)",
  "color: #9c27b0; font-size: 12px;"
);

// ===== ОЧИСТКА ЛОГОВ =====
async function clearLogs() {
  if (!isAdmin()) {
    alert("Недостаточно прав");
    return;
  }

  if (!confirm("Вы уверены, что хотите очистить все логи ставок?")) {
    return;
  }

  try {
    const response = await fetch("/api/admin/clear-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: currentUser.username }),
    });

    const result = await response.json();

    if (response.ok) {
      alert("✅ Логи успешно очищены!");
    } else {
      alert("Ошибка: " + result.error);
    }
  } catch (error) {
    console.error("Ошибка при очистке логов:", error);
    alert("Ошибка при очистке логов");
  }
}
