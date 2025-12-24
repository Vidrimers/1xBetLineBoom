// Случайная ставка по всем матчам выбранного тура
async function luckyBetForCurrentRound() {
  if (!currentUser) {
    alert("Сначала войдите в аккаунт");
    return;
  }
  if (!currentRoundFilter || currentRoundFilter === "all") {
    alert("Сначала выберите тур");
    return;
  }
  // Находим все матчи выбранного тура, которые еще не завершены и на которые пользователь не ставил
  const matchesToBet = matches.filter(
    (m) =>
      m.round === currentRoundFilter &&
      getMatchStatusByDate(m) !== "finished" &&
      !userBets.some((b) => b.match_id === m.id)
  );
  if (matchesToBet.length === 0) {
    alert("Нет доступных матчей для случайной ставки в этом туре");
    return;
  }
  // Для каждого такого матча делаем случайную ставку
  for (const match of matchesToBet) {
    const options = [match.team1_name, "draw", match.team2_name];
    const random = Math.floor(Math.random() * options.length);
    const prediction = options[random];
    try {
      await fetch("/api/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: currentUser.id,
          match_id: match.id,
          prediction: prediction,
          amount: 0,
        }),
      });
    } catch (e) {
      console.error("Ошибка при отправке случайной ставки:", e);
    }
  }
  await loadMyBets();
  displayMatches();
}

// Переключатель для финального матча
function toggleFinalMatch(modal) {
  const prefix = modal === "edit" ? "edit" : "";
  const isFinalCheckbox = document.getElementById(
    prefix ? "editMatchIsFinal" : "matchIsFinal"
  );
  const roundInput = document.getElementById(
    prefix ? "editMatchRound" : "matchRound"
  );
  const paramsDiv = document.getElementById(
    prefix ? "finalMatchParamsEdit" : "finalMatchParamsCreate"
  );

  if (isFinalCheckbox.checked) {
    // Финал включен
    roundInput.disabled = true;
    roundInput.value = "";
    paramsDiv.style.display = "block";
  } else {
    // Финал отключен
    roundInput.disabled = false;
    paramsDiv.style.display = "none";
    // Отключить все чекбоксы параметров
    const checkboxes = paramsDiv.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb) => (cb.checked = false));
  }
}

// Глобальные переменные
let currentUser = null;
let currentEventId = null;
let events = [];
let matches = [];
let userBets = [];
let ADMIN_LOGIN = null;
let cropper = null;
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
  // Собираем все туры (включая финал если есть финальные матчи)
  const uniqueRounds = [
    ...new Set(matches.map((m) => m.round).filter((r) => r && r.trim())),
  ];

  // Добавляем "🏆 Финал" если есть финальные матчи
  const hasFinalMatches = matches.some(
    (m) => m.is_final === 1 || m.is_final === true
  );
  if (hasFinalMatches && !uniqueRounds.includes("🏆 Финал")) {
    uniqueRounds.push("🏆 Финал");
  }

  // Убедимся, что финал есть в roundsOrder если он есть в uniqueRounds
  if (hasFinalMatches && !roundsOrder.includes("🏆 Финал")) {
    roundsOrder.push("🏆 Финал");
  }

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
  console.log("🔄 DOMContentLoaded - начало загрузки");

  // Загружаем конфиг сначала
  await loadConfig();

  // Загружаем сохраненный порядок туров из БД
  await loadRoundsOrder();

  // Проверяем, есть ли пользователь в localStorage
  const savedUser = localStorage.getItem("currentUser");
  console.log("💾 savedUser из localStorage:", savedUser);

  if (savedUser) {
    const user = JSON.parse(savedUser);
    currentUser = user;
    console.log("✅ currentUser установлен:", currentUser);

    // Обновляем классы контейнера для показа контента
    const container = document.querySelector(".container");
    container.classList.remove("not-logged-in");
    container.classList.add("logged-in");

    // Меняем логотип с анимированного на обычный
    document.getElementById("headerLogo").src = "img/logo_nobg.png";

    // Показываем ссылку на Google Sheets когда залогинен
    document.getElementById("headerLogoLink").style.display = "block";
    document.getElementById("headerLogoDefault").style.display = "none";

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

    loadEventsList();
    await loadMyBets();
  } else {
    loadEventsList();
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

    // Показываем ссылку на Google Sheets когда залогинен
    document.getElementById("headerLogoLink").style.display = "block";
    document.getElementById("headerLogoDefault").style.display = "none";

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

    // Загружаем турниры, матчи и ставки пользователя
    loadEventsList();
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

  // Скрываем ссылку на Google Sheets когда вышли
  document.getElementById("headerLogoLink").style.display = "none";
  document.getElementById("headerLogoDefault").style.display = "block";

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
  authBtn.style.border = "1px solid #3a7bd5";
  authBtn.onclick = () => initUser();

  // Очищаем ставки
  document.getElementById("myBetsList").innerHTML =
    '<div class="empty-message">У вас пока нет ставок</div>';
}

// ===== ТУРНИРЫ =====

async function loadEventsList() {
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
          '<div style="text-align: center; color: #b0b8c8; font-size: 0.9em;">━━━ ЗАВЕРШЕННЫЕ ТУРНИРЫ ━━━</div>';
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
        ? `<div style="display: flex; align-items: center; justify-content: center; gap: 5px; margin-top: 8px; padding: 5px 8px; background: #ffe0e0; border-radius: 3px; font-size: 0.85em;color: #f44336;background: rgba(244, 67, 54, 0.2);">
              <span style="color: #f44336; font-weight: bold; font-size: 0.8em;">🔒</span>
              <span style="color: #b0b8c8; font-size: 0.85em;">${event.locked_reason}</span>
            </div>`
        : "";

      return `${separator}
        <div style="display: flex; align-items: flex-start; gap: 10px;">
          <div style="font-size: 1em; font-weight: bold; color: #5a9fd4; min-width: 30px; text-align: center; padding-top: 5px;">#${positionNumber}</div>
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
                    }')" style="background: transparent; padding: 5px; font-size: 0.7em; border: 1px solid #3a7bd5; color: #7ab0e0; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(33, 150, 243, 0.5)'" onmouseout="this.style.background='transparent'">✏️</button>
                    ${
                      event.locked_reason
                        ? `<button onclick="unlockEvent(${event.id})" style="background: rgba(76, 175, 80, 0.3); padding: 5px; font-size: 0.8em; border: 1px solid #4caf50; color: #7ed321; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(76, 175, 80, 0.5)'" onmouseout="this.style.background='rgba(76, 175, 80, 0.3)'">🔓</button>`
                        : `<button onclick="openLockEventModal(${event.id}, '${event.name}')" style="background: transparent; padding: 5px; font-size: 0.7em; border: 1px solid #f57c00; color: #ffe0b2; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(255, 152, 0, 0.5)'" onmouseout="this.style.background='transparent'">🔒</button>`
                    }
                    <button class="event-delete-btn" onclick="deleteEvent(${
                      event.id
                    })" style="background: transparent; padding: 5px; font-size: 0.7em; border: 1px solid #f44336; color: #ffb3b3; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(244, 67, 54, 0.5)'" onmouseout="this.style.background='transparent'">✕</button>
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

  // Если турнир заблокирован — разрешаем выбор, но можно показать подсказку (не блокируя действие)
  if (event && event.locked_reason) {
    // Не прерываем выполнение: карточки останутся стилизованы как locked, но будут кликабельны.
    // Опционально: показать короткое уведомление (необязательно). Сейчас оставляем без alert, чтобы не мешать UX.
    console.info(
      `Выбрана завершённая/заблокированная карточка турнира (id=${eventId}). Причина: ${event.locked_reason}`
    );
  }

  currentEventId = eventId;
  displayEvents(); // Обновляем выделение

  // Показываем кнопку добавления матча для админа
  const addMatchBtn = document.getElementById("addMatchBtn");
  if (addMatchBtn && isAdmin()) {
    addMatchBtn.style.display = "inline-block";
  }

  // Показываем кнопку импорта матчей для админа
  const importMatchesBtn = document.getElementById("importMatchesBtn");
  if (importMatchesBtn && isAdmin()) {
    importMatchesBtn.style.display = "inline-block";
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

// Инициализация состояния toggle'ов на основе сохраненных ставок
function initToggleStates() {
  if (!userBets || userBets.length === 0) return;

  const toggleParameterMap = {
    penalties_in_game: "penaltiesInGame_",
    extra_time: "extraTime_",
    penalties_at_end: "penaltiesAtEnd_",
  };

  userBets.forEach((bet) => {
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
      lockFinalParameter(bet.match_id, bet.parameter_type);
    }
  });
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

  // Сохраняем отсортированные туры глобально для использования в модалке
  window.sortedRounds = rounds;

  // Проверяем, завершены ли все матчи в каждом туре
  function isRoundFinished(round) {
    const roundMatches = matches.filter((m) => m.round === round);
    if (roundMatches.length === 0) return false;
    return roundMatches.every((m) => getMatchStatusByDate(m) === "finished");
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
      const allFinalFinished = finalMatches.every(
        (m) => getMatchStatusByDate(m) === "finished"
      );
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
    // Если все туры завершены, возвращаем первый
    return rounds[0];
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
    const filterButtons = roundsFilterContainer.querySelector("div");

    // Проверяем, является ли текущий пользователем админом
    const isAdmin = currentUser && currentUser.isAdmin;

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
      ${
        isAdmin
          ? '<button class="edit-rounds-btn" onclick="openRoundsOrderModal()" title="Изменить порядок туров">✎</button>'
          : ""
      }
    `;
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

  matchesContainer.innerHTML = sortedMatches
    .map((match) => {
      // Определяем статус на основе даты
      const effectiveStatus = getMatchStatusByDate(match);

      // Проверяем, есть ли ставка пользователя на команду этого матча (только команднные ставки, не финальные)
      const userBetOnMatch = userBets.find(
        (bet) => bet.match_id === match.id && !bet.is_final_bet
      );
      const betClass = userBetOnMatch ? "has-user-bet" : "";

      // Определяем текст и цвет статуса
      let statusBadge = "";
      if (effectiveStatus === "ongoing") {
        statusBadge =
          '<span style="display: inline-block; padding: 3px 8px; background: #ff9800; color: white; border-radius: 12px; font-size: 0.75em; margin-left: 5px;">🔴 ИДЕТ</span>';
      } else if (effectiveStatus === "finished") {
        statusBadge =
          '<span style="display: inline-block; padding: 3px 8px; background: rgba(100, 100, 100, 0.8); color: #e0e0e0; border-radius: 12px; font-size: 0.75em; margin-left: 5px;">✓ ЗАВЕРШЕН</span>';
      }

      return `
        <div class="match-row ${betClass}" data-match-id="${
        match.id
      }" style="position: relative;">
            ${
              isAdmin()
                ? `
              <div style="position: absolute; top: 5px; left: 5px; display: flex; gap: 5px; z-index: 1;">
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
                    : `
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
                `
                }
              </div>
              <div style="position: absolute; top: 5px; right: 5px; display: flex; gap: 5px; z-index: 1;">
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
                <button onclick="openEditMatchModal(${match.id}, '${
                    match.team1_name
                  }', '${match.team2_name}', '${match.match_date || ""}', '${
                    match.round || ""
                  }')"
                  style="background: transparent; border: 1px solid #3a7bd5; color: #7ab0e0; padding: 5px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.6em;"
                  onmouseover="this.style.background='rgba(58, 123, 213, 0.6)'; this.style.color='white'"
                  onmouseout="this.style.background='transparent'; this.style.color='#7ab0e0'">
                  ✏️
                </button>
                <button onclick="deleteMatch(${match.id})"
                  style="background: transparent; border: 1px solid #f44336; color: #f44336; padding: 5px; border-radius: 3px; cursor: pointer; transition: all 0.2s; font-size: 0.6em;"
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
                    ? `<div style="text-align: center; font-size: 0.8em; color: #5a9fd4; font-weight: 500; margin: 5px auto 0;">${match.round}</div>`
                    : ""
                }
                ${
                  match.match_date
                    ? `<div style="text-align: center; font-size: 0.85em; color: #b0b8c8; margin: 10px auto;">${new Date(
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
                      userBetOnMatch?.prediction === "team1" ? "selected" : ""
                    }" onclick="placeBet(${match.id}, '${
        match.team1_name
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
        match.team2_name
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

  // Инициализируем состояние toggle'ов после добавления HTML в DOM
  initToggleStates();
}

// ===== СТАВКИ =====

async function placeBet(matchId, teamName, prediction) {
  if (!currentUser) {
    alert("Сначала введите ваше имя");
    return;
  }

  // Сразу делаем кнопку disabled и курсор wait
  const button = event.target;
  if (button) {
    button.disabled = true;
    button.style.cursor = "wait";
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
    // Сначала проверяем, есть ли уже ОБЫЧНАЯ ставка этого пользователя на этот матч
    const checkResponse = await fetch(`/api/user/${currentUser.id}/bets`);
    const allBets = await checkResponse.json();
    const existingBet = allBets.find(
      (bet) =>
        bet.match_id === matchId &&
        (!bet.is_final_bet || bet.is_final_bet === 0)
    );

    // Если уже есть обычная ставка на этот матч - удаляем её
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

// Функция для разблокировки параметра при удалении ставки
function unlockFinalParameter(matchId, parameterType) {
  let element = null;

  // Находим главный элемент параметра
  if (parameterType === "exact_score") {
    element = document.getElementById(`exactScore1_${matchId}`);
  } else if (parameterType === "yellow_cards") {
    element = document.getElementById(`yellowCards_${matchId}`);
  } else if (parameterType === "red_cards") {
    element = document.getElementById(`redCards_${matchId}`);
  } else if (parameterType === "corners") {
    element = document.getElementById(`corners_${matchId}`);
  } else if (parameterType === "penalties_in_game") {
    element = document.getElementById(`penaltiesInGame_${matchId}`);
  } else if (parameterType === "extra_time") {
    element = document.getElementById(`extraTime_${matchId}`);
  } else if (parameterType === "penalties_at_end") {
    element = document.getElementById(`penaltiesAtEnd_${matchId}`);
  }

  if (!element) {
    return;
  }

  // Находим родительский контейнер с margin-bottom: 12px (весь параметр целиком)
  const paramMainContainer = element.closest(
    'div[style*="margin-bottom: 12px"]'
  );
  if (!paramMainContainer) {
    return;
  }

  // Разблокируем все input'ы числовые
  const inputs = paramMainContainer.querySelectorAll('input[type="number"]');
  inputs.forEach((input) => {
    input.disabled = false;
    input.style.opacity = "1";
    input.style.cursor = "text";
  });

  // Разблокируем toggle span'ы
  const labels = paramMainContainer.querySelectorAll("label");
  labels.forEach((label) => {
    const span = label.querySelector("span");
    if (span && span.style.borderRadius === "24px") {
      span.style.opacity = "1";
      span.style.cursor = "pointer";
      span.style.pointerEvents = "auto"; // 🔓 Восстанавливаем возможность клика
    }
  });

  // Разблокируем checkbox'ы
  const checkboxes = paramMainContainer.querySelectorAll(
    'input[type="checkbox"]'
  );
  checkboxes.forEach((checkbox) => {
    checkbox.disabled = false;
  });

  // Показываем кнопку "✓"
  const button = paramMainContainer.querySelector("button");
  if (button) {
    button.style.display = "inline-block";
  }
}

// Функция для блокировки параметра после сохранения ставки
function lockFinalParameter(matchId, parameterType) {
  let element = null;

  // Находим главный элемент параметра
  if (parameterType === "exact_score") {
    element = document.getElementById(`exactScore1_${matchId}`);
  } else if (parameterType === "yellow_cards") {
    element = document.getElementById(`yellowCards_${matchId}`);
  } else if (parameterType === "red_cards") {
    element = document.getElementById(`redCards_${matchId}`);
  } else if (parameterType === "corners") {
    element = document.getElementById(`corners_${matchId}`);
  } else if (parameterType === "penalties_in_game") {
    element = document.getElementById(`penaltiesInGame_${matchId}`);
  } else if (parameterType === "extra_time") {
    element = document.getElementById(`extraTime_${matchId}`);
  } else if (parameterType === "penalties_at_end") {
    element = document.getElementById(`penaltiesAtEnd_${matchId}`);
  }

  if (!element) {
    return;
  }

  // Находим родительский контейнер с margin-bottom: 12px (весь параметр целиком)
  const paramMainContainer = element.closest(
    'div[style*="margin-bottom: 12px"]'
  );
  if (!paramMainContainer) {
    return;
  }

  // Блокируем все input'ы числовые
  const inputs = paramMainContainer.querySelectorAll('input[type="number"]');
  inputs.forEach((input) => {
    input.disabled = true;
    input.style.opacity = "0.6";
    input.style.cursor = "not-allowed";
  });

  // Блокируем toggle span'ы - делаем их неклабиваемыми через pointr-events
  const labels = paramMainContainer.querySelectorAll("label");
  labels.forEach((label) => {
    const span = label.querySelector("span");
    if (span && span.style.borderRadius === "24px") {
      span.style.opacity = "0.6";
      span.style.cursor = "not-allowed";
      span.style.pointerEvents = "none"; // 🔒 Делаем элемент неклабиваемым
    }
  });

  // Блокируем checkbox'ы
  const checkboxes = paramMainContainer.querySelectorAll(
    'input[type="checkbox"]'
  );
  checkboxes.forEach((checkbox) => {
    checkbox.disabled = true;
  });

  // Скрываем кнопку "✓"
  const button = paramMainContainer.querySelector("button");
  if (button) {
    button.style.display = "none";
  }
}

async function placeFinalBet(matchId, parameterType) {
  if (!currentUser) {
    alert("Сначала введите ваше имя");
    return;
  }

  // Получаем значение из input'а в зависимости от типа параметра
  let betValue;

  if (parameterType === "exact_score") {
    const team1Score = document.getElementById(`exactScore1_${matchId}`).value;
    const team2Score = document.getElementById(`exactScore2_${matchId}`).value;
    betValue = `${team1Score}:${team2Score}`;
  } else if (
    parameterType === "yellow_cards" ||
    parameterType === "red_cards" ||
    parameterType === "corners"
  ) {
    // Преобразуем параметр в camelCase для ID
    let fieldId;
    if (parameterType === "yellow_cards") fieldId = `yellowCards_${matchId}`;
    if (parameterType === "red_cards") fieldId = `redCards_${matchId}`;
    if (parameterType === "corners") fieldId = `corners_${matchId}`;

    const inputField = document.getElementById(fieldId);
    if (!inputField) {
      console.error(`❌ Input field not found: ${fieldId}`);
      alert("Ошибка: поле ввода не найдено");
      return;
    }
    const value = inputField.value;
    betValue = value;
  } else if (
    parameterType === "penalties_in_game" ||
    parameterType === "extra_time" ||
    parameterType === "penalties_at_end"
  ) {
    // Преобразуем параметр в camelCase для ID
    let fieldId;
    if (parameterType === "penalties_in_game")
      fieldId = `penaltiesInGame_${matchId}`;
    if (parameterType === "extra_time") fieldId = `extraTime_${matchId}`;
    if (parameterType === "penalties_at_end")
      fieldId = `penaltiesAtEnd_${matchId}`;

    const checkbox = document.getElementById(fieldId);
    if (!checkbox) {
      console.error(`❌ Checkbox field not found: ${fieldId}`);
      alert("Ошибка: поле переключателя не найдено");
      return;
    }

    // Проверяем, что toggle не в нейтральном состоянии
    const toggleState = checkbox.getAttribute("data-toggle-state");
    if (toggleState === "neutral") {
      alert("⚠️ Пожалуйста, выберите значение: ДА или НЕТ");
      return;
    }

    // Читаем значение из data-toggle-state, а не из checkbox.checked!
    betValue = toggleState === "true" ? "ДА" : "НЕТ";
  }

  const match = matches.find((m) => m.id === matchId);
  if (match) {
    const effectiveStatus = getMatchStatusByDate(match);
    if (effectiveStatus !== "pending") {
      alert("Ну, куда ты, малютка, матч уже начался");
      return;
    }
  } else {
    alert("Матч не найден");
    return;
  }

  try {
    // Проверяем, есть ли уже ставка на этот параметр
    const checkResponse = await fetch(`/api/user/${currentUser.id}/bets`);
    const allBets = await checkResponse.json();
    const existingBet = allBets.find(
      (bet) =>
        bet.match_id === matchId &&
        bet.parameter_type === parameterType &&
        (bet.is_final_bet === 1 || bet.is_final_bet === true)
    );

    // Если уже есть ставка на этот параметр - удаляем её
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

    // Создаём новую ставку на финальный параметр
    console.log(
      `💾 Отправляю ставку: matchId=${matchId}, parameter=${parameterType}, value=${betValue}`
    );
    const response = await fetch("/api/bets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: currentUser.id,
        match_id: matchId,
        prediction: betValue,
        amount: 1,
        is_final_bet: 1,
        parameter_type: parameterType,
      }),
    });

    if (response.ok) {
      console.log(`✅ Ставка успешно создана`);

      // Обновляем список ставок
      const checkResponse = await fetch(`/api/user/${currentUser.id}/bets`);
      const bets = await checkResponse.json();
      userBets = bets;
      console.log("💰 Мои ставки:", bets);

      // Загружаем параметры финала для корректного отображения статуса
      let finalParameters = {};
      try {
        const paramsResponse = await fetch("/api/final-parameters-results");
        if (paramsResponse.ok) {
          finalParameters = await paramsResponse.json();
          console.log("📊 Загруженные параметры финала:", finalParameters);
        }
      } catch (paramError) {
        console.warn("Не удалось загрузить параметры финала:", paramError);
      }

      // Прикрепляем параметры к ставкам
      bets.forEach((bet) => {
        if (bet.is_final_bet) {
          bet.final_parameters = finalParameters[bet.match_id] || null;
        }
      });

      displayMyBets(bets);

      // Перерисовываем матчи чтобы кнопки команд обновились
      displayMatches();

      // Восстанавливаем состояние всех тоглов (displayMatches их сбрасывает)
      initToggleStates();

      // Блокируем параметр после успешного сохранения ставки
      lockFinalParameter(matchId, parameterType);
    } else {
      alert("Ошибка при создании ставки");
    }
  } catch (error) {
    console.error("Ошибка при размещении ставки на финальный параметр:", error);
    alert("Ошибка при размещении ставки");
  }
}

async function loadMyBets() {
  if (!currentUser) {
    console.log("❌ loadMyBets: currentUser не установлен");
    return;
  }

  try {
    const response = await fetch(`/api/user/${currentUser.id}/bets`);
    const bets = await response.json();
    console.log(
      `📥 Загружено ${bets.length} ставок для пользователя ${currentUser.id}`
    );
    userBets = bets; // Сохраняем в глобальную переменную

    // Загружаем параметры финала для проверки ставок
    let finalParameters = {};
    try {
      const paramsResponse = await fetch("/api/final-parameters-results");
      if (paramsResponse.ok) {
        finalParameters = await paramsResponse.json();
        console.log("📊 Загруженные параметры финала:", finalParameters);
      }
    } catch (paramError) {
      console.warn("Не удалось загрузить параметры финала:", paramError);
    }

    // Прикрепляем параметры к ставкам
    bets.forEach((bet) => {
      if (bet.is_final_bet) {
        // ВСЕГДА прикрепляем параметры для финальных ставок, даже если их нет (undefined)
        bet.final_parameters = finalParameters[bet.match_id] || null;
      }
    });

    displayMyBets(bets);
    if (isMatchUpdatingEnabled) {
      displayMatches(); // Перерисовываем матчи чтобы выделить с ставками
      // initToggleStates вызовется в конце displayMatches
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

  // Группируем ставки по турнирам (event_name)
  const betsByEvent = {};
  bets.forEach((bet) => {
    const eventName = bet.event_name || "Турнир не указан";
    if (!betsByEvent[eventName]) {
      betsByEvent[eventName] = [];
    }
    betsByEvent[eventName].push(bet);
  });

  // Сортируем турниры по названию
  const sortedEvents = Object.keys(betsByEvent).sort();

  // Формируем HTML с разделителями по турнирам
  let html = "";

  sortedEvents.forEach((eventName) => {
    html += `<div style="text-align: center; color: #b0b8c8; font-size: 0.9em; margin: 15px 0 10px 0;">━━━ ${eventName} ━━━</div>`;

    html += betsByEvent[eventName]
      .map((bet) => {
        let statusClass = "pending";
        let statusText = "⏳ В ожидании";
        let normalizedPrediction = bet.prediction; // Инициализируем ДО всех условий!

        // Если это финальная ставка на параметр матча (желтые карты, красные карты и т.д.)
        if (bet.is_final_bet) {
          const params = bet.final_parameters;

          // Проверяем, установлено ли конкретное поле параметра для этого типа ставки
          let parameterIsSet = false;

          if (params) {
            if (bet.parameter_type === "yellow_cards") {
              parameterIsSet =
                params.yellow_cards !== null &&
                params.yellow_cards !== undefined;
            } else if (bet.parameter_type === "red_cards") {
              parameterIsSet =
                params.red_cards !== null && params.red_cards !== undefined;
            } else if (bet.parameter_type === "corners") {
              parameterIsSet =
                params.corners !== null && params.corners !== undefined;
            } else if (bet.parameter_type === "exact_score") {
              parameterIsSet =
                params.exact_score !== null &&
                params.exact_score !== undefined &&
                params.exact_score !== "";
            } else if (bet.parameter_type === "penalties_in_game") {
              parameterIsSet =
                params.penalties_in_game !== null &&
                params.penalties_in_game !== undefined &&
                params.penalties_in_game !== "";
            } else if (bet.parameter_type === "extra_time") {
              parameterIsSet =
                params.extra_time !== null &&
                params.extra_time !== undefined &&
                params.extra_time !== "";
            } else if (bet.parameter_type === "penalties_at_end") {
              parameterIsSet =
                params.penalties_at_end !== null &&
                params.penalties_at_end !== undefined &&
                params.penalties_at_end !== "";
            }
          }

          // Если параметр для этого типа ставки еще не установлен админом
          if (!parameterIsSet) {
            statusClass = "pending";
            statusText = "⏳ В ожидании";
          } else {
            // Параметр установлен - проверяем результат
            let isWon = false;

            if (bet.parameter_type === "yellow_cards") {
              isWon = parseInt(bet.prediction) === params.yellow_cards;
            } else if (bet.parameter_type === "red_cards") {
              isWon = parseInt(bet.prediction) === params.red_cards;
            } else if (bet.parameter_type === "corners") {
              isWon = parseInt(bet.prediction) === params.corners;
            } else if (bet.parameter_type === "exact_score") {
              isWon = bet.prediction === params.exact_score;
            } else if (bet.parameter_type === "penalties_in_game") {
              isWon = bet.prediction === params.penalties_in_game;
            } else if (bet.parameter_type === "extra_time") {
              isWon = bet.prediction === params.extra_time;
            } else if (bet.parameter_type === "penalties_at_end") {
              isWon = bet.prediction === params.penalties_at_end;
            }

            if (isWon) {
              statusClass = "won";
              statusText = "✅ Выиграла";
            } else {
              statusClass = "lost";
              statusText = "❌ Проиграла";
            }
          }
        } else if (!bet.is_final_bet) {
          // Это обычная ставка на результат матча (не финальный параметр)
          // Нормализуем prediction - преобразуем в актуальные названия команд

          if (bet.prediction !== "draw") {
            // prediction может быть: "team1", "team2", старое название команды
            if (bet.prediction === "team1") {
              normalizedPrediction = bet.team1_name;
            } else if (bet.prediction === "team2") {
              normalizedPrediction = bet.team2_name;
            } else {
              // Это старое название - проверяем совпадение с актуальными названиями
              if (bet.prediction === bet.team1_name) {
                normalizedPrediction = bet.team1_name;
              } else if (bet.prediction === bet.team2_name) {
                normalizedPrediction = bet.team2_name;
              } else {
                // Старое название больше не совпадает
                // Это значит админ изменил названия команд после ставки
                // Мы не можем точно знать, на какую команду была ставка
                // Но в БД этот prediction - это скорее всего team1 (первая команда)
                // Попытаемся быть умнее и использовать логику содержимого
                // Но для простоты - используем team1_name как fallback
                // (это не идеально, но лучше чем показывать несуществующее имя)
                normalizedPrediction = bet.team1_name;
              }
            }
          }

          // Проверяем, есть ли результат матча
          if (bet.winner) {
            // Маппинг winner (из БД) в prediction format
            // winner: "team1" | "team2" | "draw"
            let winnerPrediction;
            if (bet.winner === "team1") {
              winnerPrediction = bet.team1_name;
            } else if (bet.winner === "team2") {
              winnerPrediction = bet.team2_name;
            } else if (bet.winner === "draw") {
              winnerPrediction = "draw";
            }

            if (winnerPrediction === normalizedPrediction) {
              statusClass = "won";
              statusText = "✅ Выиграла";
            } else {
              statusClass = "lost";
              statusText = "❌ Проиграла";
            }
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
                <div class="bet-info" style="font-size: 0.9em; color: #b0b8c8;">
                    <span>Ставка: <strong>${(() => {
                      // Если это финальная ставка на параметр
                      if (bet.is_final_bet) {
                        const paramName = {
                          exact_score: "Точный счет",
                          yellow_cards: "Желтые",
                          red_cards: "Красные",
                          corners: "Угловые",
                          penalties_in_game: "Пенальти в игре",
                          extra_time: "Доп. время",
                          penalties_at_end: "Пенальти в конце",
                        }[bet.parameter_type];

                        if (bet.parameter_type === "exact_score") {
                          // Формат: "Точный счет: Команда1 2:0 Команда2"
                          return `${paramName}: ${bet.team1_name} ${bet.prediction} ${bet.team2_name}`;
                        } else {
                          // Формат: "Желтые: 5" или "Пенальти в игре: ДА"
                          return `${paramName}: ${bet.prediction}`;
                        }
                      } else {
                        // Обычная ставка - выводим нормализованное имя
                        if (normalizedPrediction === "draw") {
                          return "Ничья";
                        } else {
                          return normalizedPrediction;
                        }
                      }
                    })()}</strong></span>
                </div>
                <div style="font-size: 0.85em; color: #b0b8c8; margin-top: 5px;">
                    ${
                      bet.is_final
                        ? "🏆 ФИНАЛ"
                        : bet.round
                        ? `${bet.round}`
                        : ""
                    }
                </div>
                ${deleteBtn}
            </div>
        `;
      })
      .join("");
  });

  myBetsList.innerHTML = html;
}

// Удалить ставку
async function deleteBet(betId) {
  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  try {
    // Находим информацию о ставке перед удалением
    const bet = userBets.find((b) => b.id === betId);
    const matchId = bet?.match_id;
    const parameterType = bet?.parameter_type;
    const isFinalBet = bet?.is_final_bet;

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

    // Удаляем ставку из userBets массива
    userBets = userBets.filter((b) => b.id !== betId);

    // Если это была final bet - разблокируем параметр
    if (isFinalBet && matchId && parameterType) {
      unlockFinalParameter(matchId, parameterType);
    }

    // 🔄 Полностью перезагружаем список ставок с БД
    await loadMyBets();

    // 🔄 Обновляем карточки матчей, чтобы убрать подсветку
    if (currentEventId) {
      displayMatches();
    }
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
    loadEventsList();
    if (currentEventId) {
      loadMatches(currentEventId);
    }
    loadMyBets();
  } else if (tabName === "participants") {
    document.getElementById("participants-content").style.display = "flex";
    document.querySelectorAll(".tab-btn")[1].classList.add("active");
    loadTournamentsList();
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
    console.log("📊 Загруженные участники:", participants);
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

  // Сортируем по выигранным ставкам в убывающем порядке
  // При одинаковых won_bets сортируем по меньшему количеству проигрышей
  const sortedParticipants = [...participants].sort((a, b) => {
    if ((b.won_bets || 0) !== (a.won_bets || 0)) {
      return (b.won_bets || 0) - (a.won_bets || 0); // Выигрыши: больше → выше
    }
    return (a.lost_bets || 0) - (b.lost_bets || 0); // Проигрыши: меньше → выше
  });

  participantsList.innerHTML = sortedParticipants
    .map((participant, index) => {
      // Формируем трофеи
      const wins = participant.tournament_wins || 0;
      let trophies = "";
      if (wins <= 5) {
        trophies = "🏆".repeat(wins);
      } else {
        trophies = "🏆x" + wins;
      }

      return `
    <div class="participant-item" onclick="showUserProfile(${
      participant.id
    }, '${participant.username.replace(/'/g, "\\'")}')">
      <div class="participant-rank">#${index + 1}</div>
      <img src="${participant.avatar || "img/default-avatar.jpg"}" alt="${
        participant.username
      }" class="participant-avatar" />
      <div class="participant-info">
        <div class="participant-name">${participant.username}</div>
        ${
          wins > 0
            ? `<div class="participant-tournaments">Побед в турнирах: ${trophies}</div>`
            : ""
        }
        <div class="participant-stats">
          Ставок за всё время: ${participant.total_bets || 0} | 
          Угаданных ставок за всё время: ${participant.won_bets || 0} | 
          Неугаданных ставок за всё время: ${participant.lost_bets || 0} | 
          В ожидании: ${participant.pending_bets || 0}
        </div>
      </div>
      <div class="participant-points">очки
      <div class="participant-bets-count">${
        participant.won_bets || 0
      }</div></div>
    </div>
`;
    })
    .join("");
}

// ===== ТУРНИРЫ =====

async function loadTournamentsList() {
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

async function displayTournaments(events) {
  const eventsGrid = document.getElementById("eventsGrid");

  if (events.length === 0) {
    eventsGrid.innerHTML =
      '<div class="empty-message">Турниры не найдены</div>';
    return;
  }

  // Сортируем события: активные в начале, заблокированные в конце
  const sortedEvents = events.sort((a, b) => {
    const aLocked = a.locked_reason ? 1 : 0;
    const bLocked = b.locked_reason ? 1 : 0;
    return aLocked - bLocked;
  });

  // Разделяем события на активные и заблокированные
  const activeEvents = sortedEvents.filter((e) => !e.locked_reason);
  const lockedEvents = sortedEvents.filter((e) => e.locked_reason);

  // Для каждого события загружаем дополнительные данные если оно заблокировано
  const activeCards = await Promise.all(
    activeEvents.map(async (event) => {
      return `
    <div class="event-card" onclick="loadTournamentParticipants(${
      event.id
    }, '${event.name.replace(/'/g, "\\'")}')">
      <div class="event-card-title">🏆 ${event.name}</div>
      <div class="event-card-count">Матчей: ${event.match_count || 0}</div>
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
          winnerInfo = `<div class="event-card-winner">👑 Победитель: <strong>${winner.username}</strong></div>`;
        }
      } catch (error) {
        console.error("Ошибка при загрузке участников турнира:", error);
      }

      return `
    <div class="event-card locked" onclick="loadTournamentParticipants(${
      event.id
    }, '${event.name.replace(/'/g, "\\'")}')">
      <div class="event-card-title">🏆 ${event.name}</div>
      <div class="event-card-count">Матчей: ${event.match_count || 0}</div>
      <div class="event-card-locked">🔒 ${
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

  if (lockedCards.length > 0) {
    html +=
      '<div class="tournaments-section-divider">ЗАВЕРШЕННЫЕ ТУРНИРЫ</div>';
    html += lockedCards.join("");
  }

  eventsGrid.innerHTML = html;
}

async function loadTournamentParticipants(eventId, eventName) {
  try {
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

    // Скрываем section с сеткой турниров и показываем участников турнира
    document.getElementById("tournamentsSection").style.display = "none";
    document.getElementById("tournamentSection").style.display = "block";
    document.getElementById("tournamentTitle").innerText = `📋 ${eventName}`;

    displayTournamentParticipants(participants, isLocked, eventId);
  } catch (error) {
    console.error("Ошибка при загрузке участников турнира:", error);
    document.getElementById("tournamentParticipantsList").innerHTML =
      '<div class="empty-message">Ошибка при загрузке участников турнира</div>';
  }
}

function displayTournamentParticipants(
  participants,
  isLocked = false,
  eventId = null
) {
  const tournamentParticipantsList = document.getElementById(
    "tournamentParticipantsList"
  );

  if (participants.length === 0) {
    tournamentParticipantsList.innerHTML =
      '<div class="empty-message">Участники не найдены</div>';
    return;
  }

  // Сортируем по выигранным ставкам в турнире в убывающем порядке
  const sortedParticipants = [...participants].sort((a, b) => {
    if ((b.event_won || 0) !== (a.event_won || 0)) {
      return (b.event_won || 0) - (a.event_won || 0); // Выигрыши: больше → выше
    }
    return (a.event_lost || 0) - (b.event_lost || 0); // Проигрыши: меньше → выше
  });

  tournamentParticipantsList.innerHTML = sortedParticipants
    .map((participant, index) => {
      const place = index + 1;
      const totalParticipants = sortedParticipants.length;
      let emoji = "😐"; // нейтральное для середины

      if (place === 1) {
        emoji = "😎"; // первое место
      } else if (place === totalParticipants && totalParticipants > 1) {
        emoji = "💩"; // последнее место
      }

      // Добавляем класс 'winner' если это заблокированный турнир и первое место
      const winnerClass = isLocked && place === 1 ? "winner" : "";

      return `
    <div class="participant-item ${winnerClass}" onclick="showTournamentParticipantBets(${
        participant.id
      }, '${participant.username.replace(/'/g, "\\'")}', ${eventId})">
      <div class="participant-rank participant-rank-events">#${place} ${emoji}</div>
      <img src="${participant.avatar || "img/default-avatar.jpg"}" alt="${
        participant.username
      }" class="participant-avatar" />
      <div class="participant-info">
        <div class="participant-name">${participant.username}</div>
        <div class="participant-stats">
          Ставок в турнире: ${participant.event_bets || 0} | 
          Угаданных: ${participant.event_won || 0} | 
          Неугаданных: ${participant.event_lost || 0} | 
          В ожидании: ${participant.event_pending || 0}
        </div>
        </div>
        <div class="participant-points">очки
      <div class="participant-bets-count">${
        participant.event_won || 0
      }</div></div>
    </div>
  `;
    })
    .join("");
}

function backToTournaments() {
  document.getElementById("tournamentsSection").style.display = "block";
  document.getElementById("tournamentSection").style.display = "none";
}

// Показать ставки участника турнира
async function showTournamentParticipantBets(userId, username, eventId) {
  try {
    console.log("Загружаем ставки для юзера:", userId, "в турнире:", eventId);

    // Получаем ставки участника в турнире
    const response = await fetch(
      `/api/event/${eventId}/participant/${userId}/bets`
    );

    console.log("Статус ответа:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Ошибка ответа:", errorText);
      alert("Не удалось загрузить ставки");
      return;
    }

    const betsData = await response.json();
    const { rounds, bets } = betsData;

    // Применяем глобальный порядок туров если он есть
    let sortedRounds = rounds;
    if (window.sortedRounds && window.sortedRounds.length > 0) {
      // Сортируем раунды по глобальному порядку
      sortedRounds = rounds.sort((a, b) => {
        const indexA = window.sortedRounds.indexOf(a);
        const indexB = window.sortedRounds.indexOf(b);
        return (
          (indexA === -1 ? rounds.length : indexA) -
          (indexB === -1 ? rounds.length : indexB)
        );
      });
    }

    // Устанавливаем заголовок
    document.getElementById(
      "tournamentParticipantBetsTitle"
    ).textContent = `📊 Ставки ${username} в турнире`;

    // Определяем завершённые туры (где ВСЕ ставки имеют результат, нет pending)
    const completedRounds = new Set();
    const roundsSet = new Set(sortedRounds);

    roundsSet.forEach((round) => {
      const roundBets = bets.filter((b) => b.round === round);
      // Тур завершён только если все ставки в нём имеют результат (нет pending)
      // Проверяем: у каждой ставки result !== 'pending'
      if (
        roundBets.length > 0 &&
        roundBets.every((b) => b.result !== "pending")
      ) {
        completedRounds.add(round);
      }
    });

    // Создаём кнопки туров
    const roundsFilter = document.getElementById("tournamentRoundsFilter");
    roundsFilter.innerHTML =
      `<button class="round-filter-btn" data-round="all" 
              onclick="filterTournamentParticipantBets('all')">
        Все туры
      </button>` +
      sortedRounds
        .map((round) => {
          const isCompleted = completedRounds.has(round);
          const isActive = sortedRounds.length > 0 && round === sortedRounds[0];
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

    // Сохраняем данные для фильтрации
    window.currentTournamentBets = bets;
    window.currentTournamentRounds = sortedRounds;
    window.completedTournamentRounds = completedRounds;

    // Отображаем ставки первого тура (если есть туры) или все ставки
    if (sortedRounds.length > 0) {
      const firstRound = sortedRounds[0];
      const filteredBets = bets.filter((bet) => bet.round === firstRound);
      displayTournamentParticipantBets(filteredBets);
    } else {
      displayTournamentParticipantBets(bets);
    }

    // Открываем модальное окно
    document.getElementById("tournamentParticipantBetsModal").style.display =
      "flex";
  } catch (error) {
    console.error("Ошибка при загрузке ставок турнира:", error);
    alert("Ошибка при загрузке ставок");
  }
}

// Отображение ставок участника турнира
function displayTournamentParticipantBets(bets) {
  const betsList = document.getElementById("tournamentParticipantBetsList");

  if (!bets || bets.length === 0) {
    betsList.innerHTML =
      '<div class="empty-message">Нет ставок в этом туре</div>';
    return;
  }

  betsList.innerHTML = bets
    .map(
      (bet) => `
    <div style="background: #1a1a2e; padding: 15px; margin-bottom: 10px; border-radius: 8px; border-left: 4px solid ${
      bet.result === "won"
        ? "#4caf50"
        : bet.result === "lost"
        ? "#f44336"
        : "#ff9800"
    };">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <strong style="color: #7ab0e0;">${bet.team1} vs ${bet.team2}</strong>
        <span style="background: ${
          bet.result === "won"
            ? "#4caf50"
            : bet.result === "lost"
            ? "#f44336"
            : "#ff9800"
        }; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85em;">
          ${
            bet.result === "won"
              ? "✅ Угадано"
              : bet.result === "lost"
              ? "❌ Неугадано"
              : "⏳ В ожидании"
          }
        </span>
      </div>
      <div style="color: #999; font-size: 0.9em; margin-bottom: 5px;">
        Ставка: <strong>${bet.prediction_display || bet.prediction}</strong>
        ${
          bet.result !== "pending"
            ? ` | Результат: <strong>${bet.actual_result}</strong>`
            : ""
        }
      </div>
      ${
        bet.round
          ? `<div style="color: #666; font-size: 0.85em;">${bet.round}</div>`
          : ""
      }
    </div>
  `
    )
    .join("");
}

// Фильтр ставок по туру
function filterTournamentParticipantBets(round) {
  const allBets = window.currentTournamentBets || [];
  const filteredBets =
    round === "all" ? allBets : allBets.filter((bet) => bet.round === round);

  const completedRounds = window.completedTournamentRounds || new Set();

  // Обновляем активную кнопку
  document
    .querySelectorAll("#tournamentRoundsFilter .round-filter-btn")
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
function closeTournamentParticipantBetsModal() {
  document.getElementById("tournamentParticipantBetsModal").style.display =
    "none";
  window.currentTournamentBets = null;
  window.currentTournamentRounds = null;
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

  // Проверяем localStorage сначала для быстрой загрузки
  let avatarSrc = localStorage.getItem(`avatar_${profile.id}`);
  if (!avatarSrc) {
    // Если нет в localStorage, используем из профиля (с сервера)
    avatarSrc = profile.avatar || "img/default-avatar.jpg";
    // И сохраняем в localStorage для следующего раза
    if (profile.avatar) {
      localStorage.setItem(`avatar_${profile.id}`, profile.avatar);
    }
  }

  profileContainer.innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar" style="position: relative;" onmouseover="document.getElementById('avatarEditBtn').style.opacity='1'" onmouseout="document.getElementById('avatarEditBtn').style.opacity='0'">
        <img src="${avatarSrc}" style="width: 100px; border-radius: 30%;">
        <button id="avatarEditBtn" onclick="openAvatarModal()" style="
          position: absolute;
          bottom: 0;
          right: 0;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: transparent;
          border: none;
          color: #fff;
          cursor: pointer;
          font-size: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.3s ease;
        ">📷</button>
      </div>
      <div class="profile-username">${profile.username}</div>
      <div class="profile-member-since">Участник с ${createdDate}</div>
    </div>

    <div class="profile-stats-grid">
      <div class="stat-card">
        <div class="stat-label">Ставок за всё время</div>
        <div class="stat-value">${profile.total_bets}</div>
      </div>
      <div class="stat-card won">
        <div class="stat-label">✅ Угаданных ставок за всё время</div>
        <div class="stat-value">${profile.won_bets}</div>
      </div>
      <div class="stat-card lost">
        <div class="stat-label">❌ Неугаданных ставок за всё время</div>
        <div class="stat-value">${profile.lost_bets}</div>
      </div>
      <div class="stat-card pending">
        <div class="stat-label">⏳ В ожидании</div>
        <div class="stat-value">${profile.pending_bets}</div>
      </div>
      <div class="stat-card" style="background: rgba(255, 152, 0, 0.15); border-left: 4px solid #ffc107;">
        <div class="stat-label">🏆 Побед в турнирах</div>
        <div class="stat-value" style="color: #ffc107;">${
          profile.tournament_wins || 0
        }</div>
      </div>
    </div>

    <div class="profile-section">
      <div class="profile-section-title">📊 Статистика</div>
      <div class="profile-section-content">
        <p><strong>Процент побед:</strong> ${
          profile.total_bets > 0
            ? ((profile.won_count / profile.total_bets) * 100).toFixed(1)
            : 0
        }%</p>
      </div>
    </div>

    <div class="profile-section" id="awardsSection" style="display: none;">
      <div class="profile-section-title">🏆 НАГРАДЫ</div>
      <div class="profile-section-content" id="awardsContainer">
        Загружаем награды...
      </div>
    </div>
  `;

  // Загружаем награды после отображения профиля
  loadUserAwards(profile.id);
}

async function loadUserAwards(userId) {
  try {
    console.log(`🏆 Загружаем награды для пользователя ${userId}`);

    // Загружаем награды за победу в турнирах (автоматические)
    const response1 = await fetch(`/api/user/${userId}/awards`);
    const tournamentAwards = await response1.json();

    // Загружаем пользовательские награды (выданные админом)
    const response2 = await fetch(`/api/user/${userId}/custom-awards`);
    const customAwards = await response2.json();

    console.log("Награды за турниры:", tournamentAwards);
    console.log("Пользовательские награды:", customAwards);

    const awardsSection = document.getElementById("awardsSection");
    const awardsContainer = document.getElementById("awardsContainer");

    // Объединяем обе массива
    const allAwards = [...(tournamentAwards || []), ...(customAwards || [])];

    if (!allAwards || allAwards.length === 0) {
      console.log("Нет наград для отображения");
      awardsSection.style.display = "none";
      return;
    }

    awardsSection.style.display = "block";

    let awardsHTML = '<div class="awards-grid">';

    // Отображаем автоматические награды за турниры
    tournamentAwards.forEach((award) => {
      const awardDate = new Date(award.awarded_at).toLocaleDateString("ru-RU");
      awardsHTML += `
        <div class="award-card">
          <div class="award-icon">🏆</div>
          <div class="award-title">Победитель в турнире "${award.event_name}"</div>
          <div class="award-info">Угадано: <strong>${award.won_bets}</strong> ставок</div>
          <div class="award-date">${awardDate}</div>
        </div>
      `;
    });

    // Отображаем пользовательские награды
    const awardTypeText = {
      participant: "👤 Участник турнира",
      winner: "🥇 Победитель",
      best_result: "⭐ Лучший результат",
      special: "🎖️ Специальная награда",
    };

    customAwards.forEach((award) => {
      const awardDate = new Date(award.created_at).toLocaleDateString("ru-RU");
      const eventText = award.event_name
        ? ` в турнире "${award.event_name}"`
        : "";
      const descText = award.description
        ? `<div class="award-info-small">${award.description}</div>`
        : "";

      awardsHTML += `
        <div class="award-card" style="background: linear-gradient(135deg, rgba(255, 193, 7, 0.2), rgba(255, 152, 0, 0.2));">
          <div class="award-icon">${getAwardIcon(award.award_type)}</div>
          <div class="award-title">${
            awardTypeText[award.award_type] || award.award_type
          }${eventText}</div>
          ${descText}
          <div class="award-date">${awardDate}</div>
        </div>
      `;
    });

    awardsHTML += "</div>";

    awardsContainer.innerHTML = awardsHTML;
    console.log("✅ Награды успешно отображены");
  } catch (error) {
    console.error("Ошибка при загрузке наград:", error);
    document.getElementById("awardsContainer").innerHTML =
      "Ошибка при загрузке наград";
  }
}

// Функция для получения иконки награды
function getAwardIcon(awardType) {
  const icons = {
    participant: "👤",
    winner: "🥇",
    best_result: "⭐",
    special: "🎖️",
  };
  return icons[awardType] || "🏆";
}

// ===== ДЕМО-ДАННЫЕ =====

async function seedData() {
  try {
    const response = await fetch("/api/seed-data", {
      method: "POST",
    });

    const result = await response.json();
    alert(result.message);
    loadEventsList();
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

// Функция для создания бэкапа базы данных
async function backupDatabase() {
  if (!isAdmin()) {
    alert("❌ У вас нет прав для создания бэкапа БД");
    return;
  }

  try {
    // Показываем индикатор загрузки
    const backupBtn = document.querySelector('[onclick="backupDatabase()"]');
    const originalText = backupBtn.textContent;
    backupBtn.textContent = "⏳ Создание бэкапа...";
    backupBtn.disabled = true;

    const response = await fetch("/api/backup", {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && data.filename) {
      alert(
        `✅ Бэкап БД успешно создан:\n${data.filename}\n\nФайл сохранен в папке /backups/`
      );
    } else {
      alert(
        `❌ Ошибка при создании бэкапа: ${data.error || "Неизвестная ошибка"}`
      );
    }
  } catch (error) {
    console.error("Ошибка при создании бэкапа:", error);
    alert(`❌ Ошибка при создании бэкапа БД:\n${error.message}`);
  } finally {
    // Восстанавливаем кнопку
    const backupBtn = document.querySelector('[onclick="backupDatabase()"]');
    if (backupBtn) {
      backupBtn.textContent = "💾 Бэкап БД";
      backupBtn.disabled = false;
    }
  }
}

// ========== УПРАВЛЕНИЕ МОДЕРАТОРАМИ ==========

// Открыть панель управления модераторами
async function openModeratorsPanel() {
  if (!isAdmin()) {
    alert("❌ У вас нет прав для управления модераторами");
    return;
  }

  const modal = document.getElementById("moderatorsModal");
  modal.style.display = "flex";

  // Загружаем список модераторов
  loadModeratorsList();

  // Загружаем список пользователей
  loadUsersList();
}

// Закрыть панель управления модераторами
function closeModeratorsPanel() {
  const modal = document.getElementById("moderatorsModal");
  modal.style.display = "none";
}

// Загрузить список модераторов
async function loadModeratorsList() {
  try {
    const response = await fetch("/api/moderators");
    const moderators = await response.json();

    const listContainer = document.getElementById("moderatorsList");

    if (!Array.isArray(moderators) || moderators.length === 0) {
      listContainer.innerHTML =
        '<div class="empty-message">Модераторов нет</div>';
      return;
    }

    listContainer.innerHTML = moderators
      .map(
        (mod) => `
      <div style="
        background: rgba(156, 39, 176, 0.2);
        border: 1px solid #9c27b0;
        padding: 12px;
        margin-bottom: 10px;
        border-radius: 6px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <div>
          <div style="color: #e0e0e0; font-weight: bold; margin-bottom: 5px">${
            mod.username
          }</div>
          <div style="color: #b0b0b0; font-size: 0.9em">
            Разрешения: ${getPermissionsText(mod.permissions || [])}
          </div>
        </div>
        <button
          onclick="removeModerator(${mod.id})"
          style="
            background: rgba(244, 67, 54, 0.7);
            color: #ffb3b3;
            border: 1px solid #f44336;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
          "
          onmouseover="this.style.transform='scale(1.05)'"
          onmouseout="this.style.transform='scale(1)'"
        >
          🗑️ Удалить
        </button>
      </div>
    `
      )
      .join("");
  } catch (error) {
    console.error("Ошибка при загрузке модераторов:", error);
    document.getElementById("moderatorsList").innerHTML =
      '<div class="empty-message">Ошибка загрузки модераторов</div>';
  }
}

// Загрузить список пользователей для выбора
async function loadUsersList() {
  try {
    const response = await fetch("/api/users");
    const users = await response.json();

    // Получаем список модераторов
    const modsResponse = await fetch("/api/moderators");
    const moderators = await modsResponse.json();
    const moderatorUserIds = new Set(moderators.map((mod) => mod.user_id));

    const select = document.getElementById("userSelectForModerator");

    // Очищаем текущие опции кроме первой
    while (select.options.length > 1) {
      select.remove(1);
    }

    // Добавляем пользователей, исключая админа и существующих модераторов
    users.forEach((user) => {
      // Исключаем админа (его имя совпадает с ADMIN_LOGIN)
      if (user.username === ADMIN_LOGIN) {
        return; // Пропускаем админа
      }

      // Исключаем ADMIN_DB_NAME
      if (user.username === ADMIN_DB_NAME) {
        return; // Пропускаем ADMIN_DB_NAME
      }

      // Исключаем уже существующих модераторов
      if (moderatorUserIds.has(user.id)) {
        return; // Пропускаем если уже модератор
      }

      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = user.username;
      select.appendChild(option);
    });
  } catch (error) {
    console.error("Ошибка при загрузке пользователей:", error);
  }
}

// Получить текст разрешений
function getPermissionsText(permissions) {
  const permText = {
    manage_matches: "матчи",
    manage_results: "результаты",
    manage_tournaments: "турниры",
    view_logs: "логи",
  };

  if (permissions.length === 0) return "нет";

  return permissions.map((p) => permText[p] || p).join(", ");
}

// Назначить нового модератора
async function assignModerator() {
  const userId = document.getElementById("userSelectForModerator").value;

  if (!userId) {
    alert("❌ Выберите пользователя");
    return;
  }

  // Собираем разрешения
  const permissions = [];
  if (document.getElementById("permManageMatches").checked)
    permissions.push("manage_matches");
  if (document.getElementById("permManageResults").checked)
    permissions.push("manage_results");
  if (document.getElementById("permManageTournaments").checked)
    permissions.push("manage_tournaments");
  if (document.getElementById("permViewLogs").checked)
    permissions.push("view_logs");

  if (permissions.length === 0) {
    alert("❌ Выберите хотя бы одно разрешение");
    return;
  }

  try {
    const response = await fetch("/api/moderators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        permissions: permissions,
      }),
    });

    const data = await response.json();

    if (data.success) {
      alert("✅ Модератор успешно назначен");

      // Очищаем форму
      document.getElementById("userSelectForModerator").value = "";
      document.getElementById("permManageMatches").checked = false;
      document.getElementById("permManageResults").checked = false;
      document.getElementById("permManageTournaments").checked = false;
      document.getElementById("permViewLogs").checked = false;

      // Перезагружаем список
      loadModeratorsList();
    } else {
      alert(`❌ Ошибка: ${data.error || "Неизвестная ошибка"}`);
    }
  } catch (error) {
    console.error("Ошибка при назначении модератора:", error);
    alert(`❌ Ошибка при назначении модератора: ${error.message}`);
  }
}

// Удалить модератора
async function removeModerator(moderatorId) {
  if (!confirm("⚠️ Вы уверены? Модератор будет удален из системы")) {
    return;
  }

  try {
    const response = await fetch(`/api/moderators/${moderatorId}`, {
      method: "DELETE",
    });

    const data = await response.json();

    if (data.success) {
      alert("✅ Модератор удален");
      loadModeratorsList();
    } else {
      alert(`❌ Ошибка: ${data.error || "Неизвестная ошибка"}`);
    }
  } catch (error) {
    console.error("Ошибка при удалении модератора:", error);
    alert(`❌ Ошибка при удалении модератора: ${error.message}`);
  }
}

// ========== УПРАВЛЕНИЕ НАГРАДАМИ ==========

// Открыть панель управления наградами
async function openAwardsPanel() {
  if (!isAdmin()) {
    alert("❌ У вас нет прав для управления наградами");
    return;
  }

  const modal = document.getElementById("awardsModal");
  modal.style.display = "flex";

  // Загружаем список наград
  loadAwardsList();

  // Загружаем список турниров
  loadEventsForAwards();
}

// Закрыть панель управления наградами
function closeAwardsPanel() {
  const modal = document.getElementById("awardsModal");
  modal.style.display = "none";
}

// Загрузить список выданных наград
async function loadAwardsList() {
  try {
    const response = await fetch("/api/awards");
    const awards = await response.json();

    const listContainer = document.getElementById("awardsList");

    if (!Array.isArray(awards) || awards.length === 0) {
      listContainer.innerHTML =
        '<div class="empty-message">Наград не найдено</div>';
      return;
    }

    const awardTypeText = {
      participant: "👤 Участник турнира",
      winner: "🥇 Победитель",
      best_result: "⭐ Лучший результат",
      special: "🎖️ Специальная награда",
    };

    listContainer.innerHTML = awards
      .map(
        (award) => `
      <div style="
        background: rgba(255, 193, 7, 0.15);
        border: 1px solid #fbc02d;
        padding: 12px;
        margin-bottom: 10px;
        border-radius: 6px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      ">
        <div>
          <div style="color: #e0e0e0; font-weight: bold; margin-bottom: 3px">${
            award.username
          }</div>
          <div style="color: #b0b0b0; font-size: 0.9em; margin-bottom: 3px">
            ${awardTypeText[award.award_type] || award.award_type}
          </div>
          <div style="color: #888; font-size: 0.85em; margin-bottom: 3px">
            ${award.event_name ? "🏆 " + award.event_name : "Общая награда"}
          </div>
          ${
            award.description
              ? `<div style="color: #888; font-size: 0.85em; font-style: italic">"${award.description}"</div>`
              : ""
          }
        </div>
        <button
          onclick="removeAward(${award.id})"
          style="
            background: rgba(244, 67, 54, 0.7);
            color: #ffb3b3;
            border: 1px solid #f44336;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            flex-shrink: 0;
            margin-left: 10px;
          "
          onmouseover="this.style.transform='scale(1.05)'"
          onmouseout="this.style.transform='scale(1)'"
        >
          🗑️ Удалить
        </button>
      </div>
    `
      )
      .join("");
  } catch (error) {
    console.error("Ошибка при загрузке наград:", error);
    document.getElementById("awardsList").innerHTML =
      '<div class="empty-message">Ошибка загрузки наград</div>';
  }
}

// Загрузить список турниров для выбора
async function loadEventsForAwards() {
  try {
    const response = await fetch("/api/events");
    const events = await response.json();

    const select = document.getElementById("eventSelectForAward");

    // Очищаем текущие опции кроме первой
    while (select.options.length > 1) {
      select.remove(1);
    }

    // Добавляем события
    events.forEach((event) => {
      const option = document.createElement("option");
      option.value = event.id;
      option.textContent = event.name;
      select.appendChild(option);
    });

    // Добавляем обработчик изменения турнира
    select.onchange = () => {
      if (select.value) {
        loadTournamentParticipantsForAward(select.value);
      } else {
        document.getElementById("participantSelectForAward").innerHTML =
          '<option value="">-- Выбрать участника --</option>';
      }
    };
  } catch (error) {
    console.error("Ошибка при загрузке турниров:", error);
  }
}

// Загрузить участников турнира
async function loadTournamentParticipantsForAward(eventId) {
  try {
    const response = await fetch(
      `/api/events/${eventId}/tournament-participants`
    );
    const participants = await response.json();

    console.log("Загруженные участники:", participants);

    const select = document.getElementById("participantSelectForAward");

    // Очищаем текущие опции кроме первой
    while (select.options.length > 1) {
      select.remove(1);
    }

    if (!Array.isArray(participants) || participants.length === 0) {
      select.innerHTML =
        '<option value="">-- Участников не найдено --</option>';
      return;
    }

    // Добавляем участников
    participants.forEach((participant) => {
      const option = document.createElement("option");
      // Используем id вместо user_id (так как API возвращает id)
      const userId = participant.user_id || participant.id;
      option.value = String(userId);
      option.textContent = participant.username;
      select.appendChild(option);
      console.log(`Добавлен участник: ${participant.username}, ID: ${userId}`);
    });
  } catch (error) {
    console.error("Ошибка при загрузке участников:", error);
  }
}

// Выдать новую награду
async function assignAward() {
  const eventId = document.getElementById("eventSelectForAward").value;
  const userIdStr = document.getElementById("participantSelectForAward").value;
  const awardType = document.getElementById("awardTypeSelect").value;
  const description = document.getElementById("awardDescriptionInput").value;

  console.log("=== assignAward Debug ===");
  console.log("eventId:", eventId);
  console.log("userIdStr:", userIdStr);
  console.log("awardType:", awardType);

  if (!userIdStr || !awardType) {
    alert("❌ Выберите участника и тип награды");
    return;
  }

  // Преобразуем userId в число
  const userId = parseInt(userIdStr, 10);
  console.log("userId после parseInt:", userId, "isNaN:", isNaN(userId));

  if (isNaN(userId)) {
    alert(
      "❌ Ошибка: некорректный ID участника. Выбранное значение: " + userIdStr
    );
    return;
  }

  try {
    const response = await fetch("/api/awards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        event_id: eventId || null,
        award_type: awardType,
        description: description || null,
      }),
    });

    const data = await response.json();

    if (data.success) {
      alert("✅ Награда успешно выдана");

      // Очищаем форму
      document.getElementById("eventSelectForAward").value = "";
      document.getElementById("participantSelectForAward").innerHTML =
        '<option value="">-- Выбрать участника --</option>';
      document.getElementById("awardTypeSelect").value = "";
      document.getElementById("awardDescriptionInput").value = "";

      // Перезагружаем список
      loadAwardsList();
    } else {
      alert(`❌ Ошибка: ${data.error || "Неизвестная ошибка"}`);
    }
  } catch (error) {
    console.error("Ошибка при выдачи награды:", error);
    alert(`❌ Ошибка при выдачи награды: ${error.message}`);
  }
}

// Удалить награду
async function removeAward(awardId) {
  if (!confirm("⚠️ Вы уверены? Награда будет удалена")) {
    return;
  }

  try {
    const response = await fetch(`/api/awards/${awardId}`, {
      method: "DELETE",
    });

    const data = await response.json();

    if (data.success) {
      alert("✅ Награда удалена");
      loadAwardsList();
    } else {
      alert(`❌ Ошибка: ${data.error || "Неизвестная ошибка"}`);
    }
  } catch (error) {
    console.error("Ошибка при удалении награды:", error);
    alert(`❌ Ошибка при удалении награды: ${error.message}`);
  }
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
    loadEventsList();
  } catch (error) {
    console.error("Ошибка при создании турнира:", error);
    alert("Ошибка при создании турнира");
  }
}

// Удалить событие (только для админа)
async function deleteEvent(eventId) {
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

    loadEventsList();
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
    loadEventsList();
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
    loadEventsList();
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
    loadEventsList();
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
          Регистрация: ${
            user.created_at
              ? new Date(user.created_at).toLocaleDateString("ru-RU")
              : "неизвестно"
          }
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
    <div style="padding: 12px; background: rgba(44, 50, 63, 0.7); border-radius: 5px; margin-bottom: 10px; border-left: 4px solid #5a9fd4;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>${user.username}</strong>
          <p style="font-size: 0.85em; color: #b0b8c8; margin: 3px 0;">Всего ставок: ${
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

  // Очищаем все поля
  document.getElementById("createMatchForm").reset();
  document.getElementById("matchIsFinal").checked = false;
  document.getElementById("finalMatchParamsCreate").style.display = "none";
  document.getElementById("matchRound").disabled = false;
  // Очищаем все чекбоксы параметров
  document.getElementById("showExactScore").checked = false;
  document.getElementById("showYellowCards").checked = false;
  document.getElementById("showRedCards").checked = false;
  document.getElementById("showCorners").checked = false;
  document.getElementById("showPenaltiesInGame").checked = false;
  document.getElementById("showExtraTime").checked = false;
  document.getElementById("showPenaltiesAtEnd").checked = false;

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
  document.getElementById("matchIsFinal").checked = false;
  document.getElementById("finalMatchParamsCreate").style.display = "none";
  document.getElementById("matchRound").disabled = false;
}

// Отправить форму создания матча
async function submitCreateMatch(event) {
  event.preventDefault();

  const team1 = document.getElementById("matchTeam1").value.trim();
  const team2 = document.getElementById("matchTeam2").value.trim();
  const matchDate = document.getElementById("matchDate").value;
  let round = document.getElementById("matchRound").value.trim();
  const copies = parseInt(document.getElementById("matchCopies").value) || 1;

  const isFinal = document.getElementById("matchIsFinal").checked;

  // Если это финальный матч, устанавливаем round = "🏆 Финал"
  if (isFinal) {
    round = "🏆 Финал";
  }

  const showExactScore = document.getElementById("showExactScore").checked;
  const showYellowCards = document.getElementById("showYellowCards").checked;
  const showRedCards = document.getElementById("showRedCards").checked;
  const showCorners = document.getElementById("showCorners").checked;
  const showPenaltiesInGame = document.getElementById(
    "showPenaltiesInGame"
  ).checked;
  const showExtraTime = document.getElementById("showExtraTime").checked;
  const showPenaltiesAtEnd =
    document.getElementById("showPenaltiesAtEnd").checked;

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
          is_final: isFinal,
          show_exact_score: showExactScore,
          show_yellow_cards: showYellowCards,
          show_red_cards: showRedCards,
          show_corners: showCorners,
          show_penalties_in_game: showPenaltiesInGame,
          show_extra_time: showExtraTime,
          show_penalties_at_end: showPenaltiesAtEnd,
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

  // Найдем матч в массиве, чтобы получить все параметры
  const match = matches.find((m) => m.id === id);

  document.getElementById("editMatchId").value = id;
  document.getElementById("editMatchTeam1").value = team1;
  document.getElementById("editMatchTeam2").value = team2;
  document.getElementById("editMatchDate").value = date || "";
  document.getElementById("editMatchRound").value = round || "";

  // Установим параметры финального матча
  if (match) {
    document.getElementById("editMatchIsFinal").checked =
      match.is_final || false;
    document.getElementById("editShowExactScore").checked =
      match.show_exact_score || false;
    document.getElementById("editShowYellowCards").checked =
      match.show_yellow_cards || false;
    document.getElementById("editShowRedCards").checked =
      match.show_red_cards || false;
    document.getElementById("editShowCorners").checked =
      match.show_corners || false;
    document.getElementById("editShowPenaltiesInGame").checked =
      match.show_penalties_in_game || false;
    document.getElementById("editShowExtraTime").checked =
      match.show_extra_time || false;
    document.getElementById("editShowPenaltiesAtEnd").checked =
      match.show_penalties_at_end || false;

    // Обновим состояние тура и параметров в зависимости от is_final
    toggleFinalMatch("edit");
  }

  document.getElementById("editMatchModal").style.display = "flex";
}

function closeEditMatchModal() {
  document.getElementById("editMatchModal").style.display = "none";

  // Очищаем параметры финального матча
  document.getElementById("editMatchIsFinal").checked = false;
  document.getElementById("finalMatchParamsEdit").style.display = "none";
  document.getElementById("editMatchRound").disabled = false;
}

async function submitEditMatch(event) {
  event.preventDefault();

  const id = document.getElementById("editMatchId").value;
  const team1 = document.getElementById("editMatchTeam1").value.trim();
  const team2 = document.getElementById("editMatchTeam2").value.trim();
  const date = document.getElementById("editMatchDate").value;
  let round = document.getElementById("editMatchRound").value.trim();

  const isFinal = document.getElementById("editMatchIsFinal").checked;

  // Если это финальный матч, устанавливаем round = "🏆 Финал"
  if (isFinal) {
    round = "🏆 Финал";
  }
  const showExactScore = document.getElementById("editShowExactScore").checked;
  const showYellowCards = document.getElementById(
    "editShowYellowCards"
  ).checked;
  const showRedCards = document.getElementById("editShowRedCards").checked;
  const showCorners = document.getElementById("editShowCorners").checked;
  const showPenaltiesInGame = document.getElementById(
    "editShowPenaltiesInGame"
  ).checked;
  const showExtraTime = document.getElementById("editShowExtraTime").checked;
  const showPenaltiesAtEnd = document.getElementById(
    "editShowPenaltiesAtEnd"
  ).checked;

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
        is_final: isFinal,
        show_exact_score: showExactScore,
        show_yellow_cards: showYellowCards,
        show_red_cards: showRedCards,
        show_corners: showCorners,
        show_penalties_in_game: showPenaltiesInGame,
        show_extra_time: showExtraTime,
        show_penalties_at_end: showPenaltiesAtEnd,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      closeEditMatchModal();

      // Обновляем локальные данные матча
      const matchIndex = matches.findIndex((m) => m.id === parseInt(id));
      if (matchIndex !== -1) {
        matches[matchIndex] = {
          ...matches[matchIndex],
          team1_name: team1,
          team2_name: team2,
          match_date: date,
          round: round,
          is_final: isFinal,
          show_exact_score: showExactScore,
          show_yellow_cards: showYellowCards,
          show_red_cards: showRedCards,
          show_corners: showCorners,
          show_penalties_in_game: showPenaltiesInGame,
          show_extra_time: showExtraTime,
          show_penalties_at_end: showPenaltiesAtEnd,
        };
      }

      // Перезагружаем и отображаем ставки
      await loadMyBets();
      displayMatches();
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
 * Разблокировать завершённый матч (сбросить результат)
 * Использование: unlockMatch(matchId)
 */
async function unlockMatch(matchId) {
  const match = matches.find((m) => m.id === matchId);
  if (!match) {
    console.error("Матч не найден:", matchId);
    return;
  }

  if (
    !confirm(
      `Разблокировать матч "${match.team1_name} vs ${match.team2_name}"?\n\nРезультат будет сброшен и ставки снова станут активными.`
    )
  ) {
    return;
  }

  try {
    const response = await fetch(`/api/admin/matches/${matchId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentUser?.username,
        status: "pending",
        result: null,
        winner: null,
      }),
    });

    const responseData = await response.json();

    if (response.ok) {
      // Обновляем матч локально
      match.status = "pending";
      match.result = null;
      match.winner = null;

      console.log(
        `🔓 Матч ${match.team1_name} vs ${match.team2_name} разблокирован`
      );
      displayMatches();

      // Обновляем ставки
      setTimeout(() => {
        loadMyBets();
      }, 300);
    } else {
      console.error("Ошибка разблокировки матча:", responseData.error);
      alert("Ошибка: " + responseData.error);
    }
  } catch (error) {
    console.error("Ошибка при разблокировке матча:", error);
    alert("Ошибка при разблокировке матча");
  }
}

// Глобальная переменная для хранения ID матча в модале
let currentFinalMatchId = null;
let currentFinalResult = null;

/**
 * Открыть модальное окно для установления результата финала и параметров
 */
function openFinalMatchResultModal(matchId) {
  currentFinalMatchId = matchId;
  currentFinalResult = null;

  const match = matches.find((m) => m.id === matchId);
  if (!match) return;

  const modal = document.getElementById("finalMatchResultModal");
  const container = document.getElementById("finalParametersContainer");
  const buttonsContainer = document.getElementById(
    "finalResultButtonsContainer"
  );

  if (!modal || !container || !buttonsContainer) {
    console.error("Modal elements not found!");
    return;
  }

  // Очищаем контейнеры
  container.innerHTML = "";
  buttonsContainer.innerHTML = "";

  // Создаем кнопки результатов с названиями команд
  buttonsContainer.innerHTML = `
    <button
      id="finalResult_team1"
      class="result-btn"
      onclick="setFinalResult('team1')"
      style="flex: 1"
    >
      ${match.team1_name || "Team 1"}
    </button>
    <button
      id="finalResult_draw"
      class="result-btn"
      onclick="setFinalResult('draw')"
      style="flex: 1"
    >
      Ничья
    </button>
    <button
      id="finalResult_team2"
      class="result-btn"
      onclick="setFinalResult('team2')"
      style="flex: 1"
    >
      ${match.team2_name || "Team 2"}
    </button>
  `;

  // Создаем поля для каждого параметра если матч - финал
  if (match.is_final) {
    let parametersHTML =
      '<h4 style="margin-bottom: 15px; color: #7ab0e0;">📊 Результаты параметров</h4>';
    parametersHTML +=
      '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">';

    if (match.show_exact_score) {
      parametersHTML += `
        <div style="padding: 10px; background: rgba(77, 184, 168, 0.1); border: 1px solid rgba(77, 184, 168, 0.3); border-radius: 6px;">
          <label style="color: #4db8a8; font-size: 0.85em; display: block; margin-bottom: 6px;">📊 Точный счет</label>
          <input type="text" id="param_exact_score" placeholder="2:1" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;">
        </div>
      `;
    }

    if (match.show_yellow_cards) {
      parametersHTML += `
        <div style="padding: 10px; background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 6px;">
          <label style="color: #ffc107; font-size: 0.85em; display: block; margin-bottom: 6px;">🟨 Жёлтые</label>
          <input type="number" id="param_yellow_cards" min="0" max="20" placeholder="5" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;">
        </div>
      `;
    }

    if (match.show_red_cards) {
      parametersHTML += `
        <div style="padding: 10px; background: rgba(244, 67, 54, 0.1); border: 1px solid rgba(244, 67, 54, 0.3); border-radius: 6px;">
          <label style="color: #f44336; font-size: 0.85em; display: block; margin-bottom: 6px;">🟥 Красные</label>
          <input type="number" id="param_red_cards" min="0" max="10" placeholder="0" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;">
        </div>
      `;
    }

    if (match.show_corners) {
      parametersHTML += `
        <div style="padding: 10px; background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 6px;">
          <label style="color: #4caf50; font-size: 0.85em; display: block; margin-bottom: 6px;">⚽ Угловые</label>
          <input type="number" id="param_corners" min="0" max="30" placeholder="8" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;">
        </div>
      `;
    }

    if (match.show_penalties_in_game) {
      parametersHTML += `
        <div style="padding: 10px; background: rgba(156, 39, 176, 0.1); border: 1px solid rgba(156, 39, 176, 0.3); border-radius: 6px;">
          <label style="color: #9c27b0; font-size: 0.85em; display: block; margin-bottom: 6px;">⚽ Пенальти в игре</label>
          <select id="param_penalties_in_game" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;">
            <option value="">-- Выбрать --</option>
            <option value="ДА">ДА</option>
            <option value="НЕТ">НЕТ</option>
          </select>
        </div>
      `;
    }

    if (match.show_extra_time) {
      parametersHTML += `
        <div style="padding: 10px; background: rgba(33, 150, 243, 0.1); border: 1px solid rgba(33, 150, 243, 0.3); border-radius: 6px;">
          <label style="color: #2196f3; font-size: 0.85em; display: block; margin-bottom: 6px;">⏱️ Доп. время</label>
          <select id="param_extra_time" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;">
            <option value="">-- Выбрать --</option>
            <option value="ДА">ДА</option>
            <option value="НЕТ">НЕТ</option>
          </select>
        </div>
      `;
    }

    if (match.show_penalties_at_end) {
      parametersHTML += `
        <div style="padding: 10px; background: rgba(255, 87, 34, 0.1); border: 1px solid rgba(255, 87, 34, 0.3); border-radius: 6px;">
          <label style="color: #ff5722; font-size: 0.85em; display: block; margin-bottom: 6px;">🎯 Пенальти в конце</label>
          <select id="param_penalties_at_end" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;">
            <option value="">-- Выбрать --</option>
            <option value="ДА">ДА</option>
            <option value="НЕТ">НЕТ</option>
          </select>
        </div>
      `;
    }

    parametersHTML += "</div>"; // Закрываем grid

    container.innerHTML = parametersHTML;
  }

  modal.style.display = "flex";
}

/**
 * Закрыть модальное окно результата финала
 */
function closeFinalMatchResultModal(event) {
  if (event && event.target.id !== "finalMatchResultModal") return;

  const modal = document.getElementById("finalMatchResultModal");
  modal.style.display = "none";
  currentFinalMatchId = null;
  currentFinalResult = null;

  // Сбрасываем кнопки результатов
  const btn1 = document.getElementById("finalResult_team1");
  const btnDraw = document.getElementById("finalResult_draw");
  const btn2 = document.getElementById("finalResult_team2");

  if (btn1) btn1.style.background = "transparent";
  if (btnDraw) btnDraw.style.background = "transparent";
  if (btn2) btn2.style.background = "transparent";
}

/**
 * Установить результат матча в модале
 */
function setFinalResult(result) {
  currentFinalResult = result;

  // Обновляем визуальное отображение
  const btn1 = document.getElementById("finalResult_team1");
  const btnDraw = document.getElementById("finalResult_draw");
  const btn2 = document.getElementById("finalResult_team2");

  if (btn1)
    btn1.style.background =
      result === "team1" ? "rgba(58, 123, 213, 0.6)" : "transparent";
  if (btnDraw)
    btnDraw.style.background =
      result === "draw" ? "rgba(255, 152, 0, 0.6)" : "transparent";
  if (btn2)
    btn2.style.background =
      result === "team2" ? "rgba(76, 175, 80, 0.6)" : "transparent";
}

/**
 * Сохранить результат финала и параметры
 */
async function saveFinalMatchResult() {
  if (!currentFinalMatchId || !currentFinalResult) {
    alert("Выберите результат матча");
    return;
  }

  const match = matches.find((m) => m.id === currentFinalMatchId);
  if (!match) return;

  try {
    // Сначала устанавливаем результат матча
    const resultMap = {
      team1: "team1_win",
      draw: "draw",
      team2: "team2_win",
    };

    const matchResponse = await fetch(
      `/api/admin/matches/${currentFinalMatchId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: currentUser?.username,
          status: "finished",
          result: resultMap[currentFinalResult],
        }),
      }
    );

    if (!matchResponse.ok) {
      const error = await matchResponse.json();
      alert("Ошибка при установке результата матча: " + error.error);
      return;
    }

    // Обновляем матч локально
    match.status = "finished";
    match.result = resultMap[currentFinalResult];
    match.winner = currentFinalResult;

    // Теперь устанавливаем параметры (если есть)
    const parametersData = {
      matchId: currentFinalMatchId,
      username: currentUser?.username,
    };

    if (match.show_exact_score) {
      const exactScore = document.getElementById("param_exact_score").value;
      if (exactScore) parametersData.exact_score = exactScore;
    }

    if (match.show_yellow_cards) {
      const value = document.getElementById("param_yellow_cards").value;
      if (value) parametersData.yellow_cards = parseInt(value);
    }

    if (match.show_red_cards) {
      const value = document.getElementById("param_red_cards").value;
      if (value) parametersData.red_cards = parseInt(value);
    }

    if (match.show_corners) {
      const value = document.getElementById("param_corners").value;
      if (value) parametersData.corners = parseInt(value);
    }

    if (match.show_penalties_in_game) {
      const value = document.getElementById("param_penalties_in_game").value;
      if (value) parametersData.penalties_in_game = value;
    }

    if (match.show_extra_time) {
      const value = document.getElementById("param_extra_time").value;
      if (value) parametersData.extra_time = value;
    }

    if (match.show_penalties_at_end) {
      const value = document.getElementById("param_penalties_at_end").value;
      if (value) parametersData.penalties_at_end = value;
    }

    // Отправляем параметры на сервер
    const paramsResponse = await fetch("/api/admin/final-parameters-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parametersData),
    });

    if (!paramsResponse.ok) {
      console.error(
        "Ошибка при установке параметров (параметры всё равно сохранены, но результат не учтён)"
      );
    }

    console.log("✓ Результат финала и параметры успешно установлены");
    closeFinalMatchResultModal();
    displayMatches();

    // Обновляем ставки
    setTimeout(() => {
      loadMyBets();
    }, 300);
  } catch (error) {
    console.error("Ошибка при сохранении результата:", error);
    alert("Ошибка при сохранении результата");
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
  "color: #5a9fd4; font-size: 14px; font-weight: bold;"
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

// ===== ИМПОРТ МАТЧЕЙ =====

// Открыть модальное окно импорта матчей
function openImportMatchesModal() {
  const importEventSelect = document.getElementById("importEventId");
  importEventSelect.innerHTML =
    '<option value="">-- Выберите турнир --</option>';

  // Загрузить список событий
  events.forEach((event) => {
    const option = document.createElement("option");
    option.value = event.id;
    option.textContent = event.name;
    importEventSelect.appendChild(option);
  });

  document.getElementById("importMatchesModal").style.display = "flex";
}

function closeImportMatchesModal() {
  document.getElementById("importMatchesModal").style.display = "none";
  document.getElementById("importMatchesData").value = "";
  document.getElementById("importEventId").value = "";
}

async function submitImportMatches(event) {
  event.preventDefault();

  const importData = document.getElementById("importMatchesData").value.trim();
  const eventId = document.getElementById("importEventId").value;
  const includeDates = document.getElementById("importIncludeDate").checked;

  if (!eventId) {
    alert("❌ Выберите турнир");
    return;
  }

  if (!importData) {
    alert("❌ Введите данные матчей");
    return;
  }

  const lines = importData.split("\n").filter((line) => line.trim());
  const matches = [];
  const errors = [];

  lines.forEach((line, index) => {
    const parts = line.split("|").map((p) => p.trim());

    if (parts.length < 1 || !parts[0]) {
      errors.push(`Строка ${index + 1}: Не указаны команды`);
      return;
    }

    const teamsPart = parts[0];
    const datePart = includeDates ? parts[1] || "" : "";
    const roundPart = includeDates ? parts[2] || "" : parts[1] || "";

    // Парсим команды (разделитель: \ с опциональными пробелами)
    const teams = teamsPart.split(/\s*\\\s*/);
    if (teams.length < 1 || !teams[0].trim()) {
      errors.push(`Строка ${index + 1}: Не указана первая команда`);
      return;
    }

    const team1 = teams[0].trim();
    const team2 = teams.length > 1 ? teams[1].trim() : null;

    // Если не указана вторая команда
    if (!team2) {
      errors.push(
        `Строка ${
          index + 1
        }: Не указана вторая команда (или используйте только одну команду)`
      );
      return;
    }

    // Парсим дату (если включена опция)
    let matchDate = null;
    if (includeDates && datePart) {
      const dateRegex = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/;
      const dateMatch = datePart.match(dateRegex);

      if (dateMatch) {
        const [, day, month, year, hour, minute] = dateMatch;
        matchDate = `${year}-${month}-${day}T${hour}:${minute}`;
      } else {
        errors.push(
          `Строка ${
            index + 1
          }: Неправильный формат даты (используйте ДД.ММ.YYYY ЧЧ:MM)`
        );
        return;
      }
    }

    matches.push({
      team1_name: team1,
      team2_name: team2,
      match_date: matchDate,
      round: roundPart || null,
      event_id: parseInt(eventId),
    });
  });

  if (errors.length > 0) {
    alert("❌ Ошибки при импорте:\n\n" + errors.join("\n"));
    return;
  }

  if (matches.length === 0) {
    alert("❌ Не найдено ни одного матча для импорта");
    return;
  }

  try {
    // Отправляем матчи на сервер
    const response = await fetch(`/api/matches/bulk-create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ matches }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Ошибка при импорте");
    }

    alert(`✅ Успешно импортировано ${matches.length} матчей`);
    closeImportMatchesModal();

    // Перезагружаем матчи
    if (currentEventId) {
      loadMatches(currentEventId);
    }
  } catch (error) {
    console.error("Ошибка при импорте матчей:", error);
    alert(`❌ Ошибка при импорте: ${error.message}`);
  }
}

// Показать профиль пользователя
async function showUserProfile(userId, username) {
  try {
    const response = await fetch(`/api/user/${userId}/profile`);
    const userData = await response.json();

    if (!response.ok) {
      alert("Не удалось загрузить профиль");
      return;
    }

    // Загружаем награды
    const awardsResponse = await fetch(`/api/user/${userId}/awards`);
    const awards = await awardsResponse.json();

    // Формируем модальное окно
    const profileHTML = `
      <div style="background: #0a0e27; padding: 30px; border-radius: 12px; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #7ab0e0; margin-bottom: 20px; text-align: center;">${username}</h2>
        
        <div style="text-align: center; margin-bottom: 25px;">
          <img src="${
            userData.avatar || "img/default-avatar.jpg"
          }" alt="${username}" style="width: 120px; height: 120px; border-radius: 50%; border: 3px solid #3a7bd5; object-fit: cover;" />
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
          <div style="background: #1a1a2e; padding: 15px; border-radius: 8px;">
            <div style="font-size: 0.85em; color: #999; margin-bottom: 5px;">Всего ставок</div>
            <div style="font-size: 1.6em; font-weight: bold; color: #7ab0e0;">${
              userData.total_bets || 0
            }</div>
          </div>
          <div style="background: #1a1a2e; padding: 15px; border-radius: 8px;">
            <div style="font-size: 0.85em; color: #999; margin-bottom: 5px;">Угаданных</div>
            <div style="font-size: 1.6em; font-weight: bold; color: #4caf50;">${
              userData.won_bets || 0
            }</div>
          </div>
          <div style="background: #1a1a2e; padding: 15px; border-radius: 8px;">
            <div style="font-size: 0.85em; color: #999; margin-bottom: 5px;">Неугаданных</div>
            <div style="font-size: 1.6em; font-weight: bold; color: #f44336;">${
              userData.lost_bets || 0
            }</div>
          </div>
          <div style="background: #1a1a2e; padding: 15px; border-radius: 8px;">
            <div style="font-size: 0.85em; color: #999; margin-bottom: 5px;">В ожидании</div>
            <div style="font-size: 1.6em; font-weight: bold; color: #ff9800;">${
              userData.pending_bets || 0
            }</div>
          </div>
          <div style="background: rgba(255, 152, 0, 0.15); padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <div style="font-size: 0.85em; color: #999; margin-bottom: 5px;">🏆 Побед в турнирах</div>
            <div style="font-size: 1.6em; font-weight: bold; color: #ffc107;">${
              userData.tournament_wins || 0
            }</div>
          </div>
        </div>

        ${
          userData.total_bets > 0
            ? `
          <div style="background: #0a3a1a; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <div style="font-size: 0.85em; color: #999; margin-bottom: 5px;">Точность угадывания</div>
            <div style="font-size: 1.6em; font-weight: bold; color: #4caf50;">${(
              (userData.won_count / userData.total_bets) *
              100
            ).toFixed(1)}%</div>
          </div>
        `
            : ""
        }

        ${
          userData.tournament_wins > 0
            ? `
          <div style="background: #2a1a0a; padding: 15px; border-radius: 8px;">
            <div style="font-size: 0.85em; color: #999; margin-bottom: 5px;">Побед в турнирах</div>
            <div style="font-size: 1.4em; font-weight: bold; color: #ffc107;">
              ${"🏆".repeat(Math.min(userData.tournament_wins, 5))}${
                userData.tournament_wins > 5
                  ? " (" + userData.tournament_wins + ")"
                  : ""
              }
            </div>
          </div>
        `
            : ""
        }

        ${
          awards && awards.length > 0
            ? `
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #333;">
            <h3 style="color: #d4af37; margin-bottom: 15px; font-size: 1.1em;text-align: center;">🏆 НАГРАДЫ</h3>
            <div style="display: grid; grid-template-columns: 1fr; gap: 10px;">
              ${awards
                .map((award) => {
                  const awardDate = new Date(
                    award.awarded_at
                  ).toLocaleDateString("ru-RU");
                  return `
                <div style="background: linear-gradient(135deg, rgba(212, 175, 55, 0.6) 0%, rgba(212, 175, 55, 0.5) 100%), url('img/winner.jpg') center / cover; border: 2px solid rgba(212, 175, 55, 0.7); border-radius: 8px; padding: 10px; text-align: center;height: 200px;display: flex;flex-direction: column;justify-content: center;">
                <div class="award-icon">🏆</div>
                  <div style="color: #fff; font-weight: 600; margin-bottom: 4px; font-size: 0.9em; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.7);">${award.event_name}</div>
                  <div style="color: #fff; font-size: 0.85em; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);">Угадано: <strong>${award.won_bets}</strong> ставок</div>
                  <div style="color: #ffe0b2; font-size: 0.75em; margin-top: 4px; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);">${awardDate}</div>
                </div>
              `;
                })
                .join("")}
            </div>
          </div>
        `
            : ""
        }
      </div>
    `;

    // Создаем простой overlay для модального окна
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;";
    overlay.innerHTML = `
      <div style="position: relative; background: #0a0e27; padding: 30px; border-radius: 12px; max-width: 500px; width: 90%; max-height: 90vh; overflow-y: auto;">
        <button onclick="this.parentElement.parentElement.remove()" style="position: absolute; top: 10px; right: 10px; background: none; border: none; color: #999; font-size: 24px; cursor: pointer;">×</button>
        ${profileHTML.replace(
          '<div style="background: #0a0e27;',
          '<div style="background: transparent;'
        )}
      </div>
    `;
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
    document.body.appendChild(overlay);
  } catch (error) {
    console.error("Ошибка при загрузке профиля:", error);
    alert("❌ Ошибка при загрузке профиля");
  }
}

// ===== ФУНКЦИИ РЕДАКТИРОВАНИЯ АВАТАРА =====

function openAvatarModal() {
  console.log("openAvatarModal вызвана");
  const modal = document.getElementById("avatarModal");
  const input = document.getElementById("avatarInput");
  const container = document.getElementById("cropperContainer");
  const saveBtn = document.getElementById("savAvatarBtn");

  console.log("modal:", modal);
  console.log("input:", input);
  console.log("container:", container);
  console.log("saveBtn:", saveBtn);

  if (!modal || !input || !container || !saveBtn) {
    console.error("❌ Не найдены необходимые элементы");
    alert("Ошибка: модальное окно не инициализировано корректно");
    return;
  }

  modal.style.display = "flex";
  input.value = "";
  container.style.display = "none";
  saveBtn.style.display = "none";
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }

  // Инициализируем обработчик выбора файла если еще не инициализирован
  initAvatarInput();
}

function initAvatarInput() {
  console.log("initAvatarInput вызвана");
  console.log("Проверяю наличие Cropper:", typeof Cropper);

  const avatarInput = document.getElementById("avatarInput");
  console.log("avatarInput:", avatarInput);

  if (avatarInput && !avatarInput.hasAttribute("data-initialized")) {
    console.log("✅ Инициализирую обработчик change");
    avatarInput.setAttribute("data-initialized", "true");
    avatarInput.addEventListener("change", (e) => {
      console.log("change событие сработало");
      const file = e.target.files[0];
      console.log("file:", file);
      if (!file) return;

      const isGif =
        file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
      console.log("Это GIF?", isGif);

      const reader = new FileReader();
      reader.onload = (event) => {
        console.log("✅ Файл прочитан");
        const img = document.getElementById("avatarImage");
        console.log("img:", img);
        img.src = event.target.result;

        // Уничтожаем старый cropper если существует
        if (cropper) {
          cropper.destroy();
          cropper = null;
        }

        // Для GIF - не используем cropper, просто сохраняем оригинал
        if (isGif) {
          console.log("✅ GIF выбран, не используем cropper");
          document.getElementById("cropperContainer").style.display = "none";
          document.getElementById("gifPreviewColumn").style.display = "flex";
          document.getElementById("pngPreviewContainer").style.display = "none";
          document.getElementById("gifResultPreview").style.display = "block";
          document.getElementById("savAvatarBtn").style.display = "block";

          // Показываем GIF в полном размере для выбора области
          document.getElementById("gifFullPreview").src = event.target.result;

          // Инициализируем контроли для выбора позиции
          window.gifPositionX = 0;
          window.gifPositionY = 0;
          window.gifZoom = 1;
          window.gifBase64 = event.target.result;

          // Обновляем preview результата
          updateGifResultPreview();

          // Удаляем старые обработчики события
          const selectionBox = document.getElementById("gifSelectionBox");
          const newSelectionBox = selectionBox.cloneNode(true);
          selectionBox.parentNode.replaceChild(newSelectionBox, selectionBox);

          // Добавляем drag функцию для квадрата
          const newBox = document.getElementById("gifSelectionBox");
          const gifPreview = document.getElementById("gifFullPreview");
          const gifPreviewColumn = document.getElementById("gifPreviewColumn");
          let isDragging = false;
          let offsetX = 0;
          let offsetY = 0;

          newBox.addEventListener("mousedown", (e) => {
            isDragging = true;
            // Запоминаем начальное смещение мыши от левого верхнего угла рамки
            const boxRect = newBox.getBoundingClientRect();
            offsetX = e.clientX - boxRect.left;
            offsetY = e.clientY - boxRect.top;
            e.preventDefault();
          });

          const handleMouseMove = (e) => {
            if (!isDragging || !gifPreview.complete) return;

            // Получаем координаты GIF на странице
            const gifRect = gifPreview.getBoundingClientRect();
            const columnRect = gifPreviewColumn.getBoundingClientRect();

            // Позиция мыши в системе координат контейнера
            const mouseX = e.clientX - columnRect.left;
            const mouseY = e.clientY - columnRect.top;

            // Позиция GIF в системе координат контейнера
            const gifX = gifRect.left - columnRect.left;
            const gifY = gifRect.top - columnRect.top;

            // Желаемая позиция рамки в системе координат контейнера
            let boxX = mouseX - offsetX;
            let boxY = mouseY - offsetY;

            // Преобразуем в координаты внутри GIF (логические координаты)
            let logicalX = (boxX - gifX) / window.gifZoom;
            let logicalY = (boxY - gifY) / window.gifZoom;

            // Ограничиваем координаты
            const maxX = gifPreview.naturalWidth - 200;
            const maxY = gifPreview.naturalHeight - 200;

            logicalX = Math.max(0, Math.min(logicalX, maxX));
            logicalY = Math.max(0, Math.min(logicalY, maxY));

            window.gifPositionX = logicalX;
            window.gifPositionY = logicalY;

            // Визуальная позиция рамки на экране
            const visualX = gifX + logicalX * window.gifZoom;
            const visualY = gifY + logicalY * window.gifZoom;

            newBox.style.left = visualX + "px";
            newBox.style.top = visualY + "px";

            updateGifResultPreview();
          };

          const handleMouseUp = () => {
            isDragging = false;
          };

          document.addEventListener("mousemove", handleMouseMove);
          document.addEventListener("mouseup", handleMouseUp);

          // Сохраняем обработчики для удаления позже
          window.gifMouseMoveHandler = handleMouseMove;
          window.gifMouseUpHandler = handleMouseUp;

          // Добавляем zoom через скролл мыши
          const handleWheel = (e) => {
            if (!window.gifBase64) return;
            e.preventDefault();

            // Определяем направление скролла
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            window.gifZoom = Math.max(0.5, Math.min(window.gifZoom + delta, 3));

            // Применяем масштаб к изображению
            gifPreview.style.transform = `scale(${window.gifZoom})`;
            gifPreview.style.transformOrigin = "top left";
            console.log(`🔍 Zoom: ${(window.gifZoom * 100).toFixed(0)}%`);

            // Обновляем позицию рамки при изменении zoom
            const gifRect = gifPreview.getBoundingClientRect();
            const columnRect = gifPreviewColumn.getBoundingClientRect();
            const gifX = gifRect.left - columnRect.left;
            const gifY = gifRect.top - columnRect.top;

            const visualX = gifX + window.gifPositionX * window.gifZoom;
            const visualY = gifY + window.gifPositionY * window.gifZoom;

            newBox.style.left = visualX + "px";
            newBox.style.top = visualY + "px";

            updateGifResultPreview();
          };

          gifPreviewColumn.addEventListener("wheel", handleWheel, {
            passive: false,
          });
          window.gifWheelHandler = handleWheel;

          // Сохраняем оригинальный файл как base64
          window.gifAvatarData = event.target.result;
          return;
        }

        console.log("Создаю Cropper для обычного изображения...");
        console.log("Cropper доступен:", typeof Cropper);

        // Скрываем GIF контейнер и показываем Cropper для PNG/JPG
        document.getElementById("gifPreviewColumn").style.display = "none";
        document.getElementById("cropperContainer").style.display = "block";
        document.getElementById("pngPreviewContainer").style.display = "block";
        document.getElementById("gifResultPreview").style.display = "none";
        document.getElementById("savAvatarBtn").style.display = "block";

        // Очищаем сохраненные GIF данные
        window.gifAvatarData = null;
        window.gifBase64 = null;
        window.gifPositionX = 0;
        window.gifPositionY = 0;
        window.gifZoom = 1;

        // Удаляем обработчики GIF если они были установлены
        if (window.gifMouseMoveHandler) {
          document.removeEventListener("mousemove", window.gifMouseMoveHandler);
          window.gifMouseMoveHandler = null;
        }
        if (window.gifMouseUpHandler) {
          document.removeEventListener("mouseup", window.gifMouseUpHandler);
          window.gifMouseUpHandler = null;
        }
        if (window.gifWheelHandler) {
          const gifPreviewColumn = document.getElementById("gifPreviewColumn");
          if (gifPreviewColumn) {
            gifPreviewColumn.removeEventListener(
              "wheel",
              window.gifWheelHandler
            );
          }
          window.gifWheelHandler = null;
        }

        // Создаем новый cropper
        try {
          cropper = new Cropper(img, {
            aspectRatio: 1,
            viewMode: 1,
            autoCropArea: 1,
            responsive: true,
            restore: true,
            guides: true,
            center: true,
            highlight: true,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: true,
          });
          console.log("✅ Cropper создан успешно");
        } catch (err) {
          console.error("❌ Ошибка при создании Cropper:", err);
          alert(
            "❌ Ошибка инициализации редактора изображений: " + err.message
          );
          return;
        }

        console.log("✅ Контейнер и кнопка показаны");
      };
      reader.readAsDataURL(file);
    });
  } else {
    console.log("⚠️ avatarInput не найден или уже инициализирован");
  }
}
function closeAvatarModal(event) {
  if (event && event.target.id !== "avatarModal") {
    return;
  }
  document.getElementById("avatarModal").style.display = "none";
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }

  // Удаляем обработчики GIF drag-and-drop
  if (window.gifMouseMoveHandler) {
    document.removeEventListener("mousemove", window.gifMouseMoveHandler);
  }
  if (window.gifMouseUpHandler) {
    document.removeEventListener("mouseup", window.gifMouseUpHandler);
  }
  if (window.gifWheelHandler) {
    const gifPreviewColumn = document.getElementById("gifPreviewColumn");
    if (gifPreviewColumn) {
      gifPreviewColumn.removeEventListener("wheel", window.gifWheelHandler);
    }
  }

  // Очищаем сохраненные GIF данные
  window.gifAvatarData = null;
  window.gifBase64 = null;
  window.gifPositionX = 0;
  window.gifPositionY = 0;
  window.gifZoom = 1;
  window.gifMouseMoveHandler = null;
  window.gifMouseUpHandler = null;
  window.gifWheelHandler = null;

  // Сбрасываем трансформацию GIF изображения
  const gifPreview = document.getElementById("gifFullPreview");
  if (gifPreview) {
    gifPreview.style.transform = "scale(1)";
    gifPreview.src = "";
  }

  // Очищаем результаты превью
  const gifCropResult = document.getElementById("gifCropResult");
  if (gifCropResult) {
    gifCropResult.src = "";
  }

  // Скрываем контейнеры редактирования
  document.getElementById("gifPreviewColumn").style.display = "none";
  document.getElementById("gifResultPreview").style.display = "block"; // Показываем по умолчанию для следующего раза
  document.getElementById("pngPreviewContainer").style.display = "none";
  document.getElementById("cropperContainer").style.display = "none";
  document.getElementById("avatarImage").src = "";
}

function updateGifResultPreview() {
  const preview = document.getElementById("gifFullPreview");
  const resultImg = document.getElementById("gifCropResult");

  if (!preview.src || !window.gifBase64) return;

  // Показываем нужный участок GIF в окошке результата
  resultImg.src = window.gifBase64;

  // Учитываем zoom при расчете смещения
  const zoomFactor = window.gifZoom || 1;
  const offsetX = window.gifPositionX * zoomFactor;
  const offsetY = window.gifPositionY * zoomFactor;

  resultImg.style.objectPosition = `-${offsetX}px -${offsetY}px`;

  console.log(
    `📍 Позиция GIF: X=${window.gifPositionX}, Y=${
      window.gifPositionY
    }, Zoom: ${(zoomFactor * 100).toFixed(0)}%`
  );
}

// Обновляем аватар в профиле без перезагрузки страницы
function updateAvatarInProfile(avatarPath) {
  const profileAvatar = document.querySelector(".profile-avatar img");
  if (profileAvatar) {
    // Добавляем параметр версии чтобы избежать кэша браузера
    const timestamp = new Date().getTime();
    profileAvatar.src = avatarPath + `?v=${timestamp}`;
    console.log(`✅ Аватар обновлен в профиле: ${avatarPath}`);
  }
}

async function saveAvatar() {
  console.log("saveAvatar вызвана");

  // Проверяем если это GIF
  if (window.gifAvatarData) {
    console.log("Обнаружен GIF, вызываю saveGifAvatar");
    return saveGifAvatar();
  }

  console.log("cropper:", cropper);

  if (!cropper) {
    alert("Пожалуйста, выберите изображение");
    return;
  }

  try {
    console.log("Получаю обрезанный canvas...");
    const canvas = cropper.getCroppedCanvas({
      maxWidth: 200,
      maxHeight: 200,
      fillColor: "rgba(0, 0, 0, 0)", // Прозрачный фон
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
    });
    console.log("✅ Canvas получен", canvas);

    // Сохраняем как PNG с оптимизацией
    const avatarData = canvas.toDataURL("image/png", 0.8);
    const fileType = "image/png";
    console.log("✅ Avatar data получен, размер:", avatarData.length);

    console.log("Отправляю на сервер...");
    const response = await fetch(`/api/user/${currentUser.id}/avatar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ avatarData, fileType }),
    });

    const result = await response.json();
    console.log("Ответ сервера:", result);

    if (!response.ok) {
      console.error(
        "❌ Ошибка при сохранении аватара: " +
          (result.error || "Неизвестная ошибка")
      );
      return;
    }

    console.log("✅ Аватар сохранен на сервер");

    // Сохраняем в localStorage для быстрой загрузки
    if (result.avatarPath) {
      localStorage.setItem(`avatar_${currentUser.id}`, result.avatarPath);
      console.log("✅ Аватар сохранен в localStorage");
    }
    // Закрываем модальное окно и обновляем аватар в профиле
    closeAvatarModal();
    if (result.avatarPath) {
      updateAvatarInProfile(result.avatarPath);
    }
  } catch (error) {
    console.error("❌ Ошибка при сохранении аватара:", error);
  }
}

async function saveGifAvatar() {
  try {
    // Используем сохраненный GIF base64
    let avatarData = window.gifAvatarData;
    const fileType = "image/gif";

    if (!avatarData) {
      console.error("❌ GIF не выбран");
      return;
    }

    // Сжимаем GIF: переводим в canvas 200x200, затем обратно в base64
    // Для GIF это потребует специальной библиотеки, пока просто проверяем размер
    const gifSize = avatarData.length;
    console.log(`📊 Размер GIF: ${(gifSize / 1024 / 1024).toFixed(2)} MB`);

    // Если GIF больше 2MB, уменьшаем качество
    if (gifSize > 2 * 1024 * 1024) {
      console.warn("⚠️ GIF слишком большой, пытаюсь сжать...");

      // Используем Canvas для уменьшения размера (теряет анимацию, но сжимает)
      // ЛУЧШЕ: оставляем оригинальный GIF но показываем первый кадр
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 200;
        canvas.height = 200;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "rgba(0, 0, 0, 0)";
        ctx.fillRect(0, 0, 200, 200);
        ctx.drawImage(img, 0, 0, 200, 200);

        // Используем оригинальный GIF если возможно, иначе PNG
        if (gifSize < 5 * 1024 * 1024) {
          // GIF поместится в 5MB лимит
          console.log("✅ GIF в пределах лимита, сохраняю оригинальный");
        } else {
          // GIF слишком большой
          console.error(
            "❌ GIF слишком большой (более 5MB). Рекомендуется использовать меньший файл."
          );
          return;
        }
      };
      img.src = avatarData;

      // Ждем загрузки картинки
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log("Отправляю GIF на сервер...");
    const response = await fetch(`/api/user/${currentUser.id}/avatar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        avatarData,
        fileType,
        gifPositionX: window.gifPositionX || 0,
        gifPositionY: window.gifPositionY || 0,
        gifZoom: window.gifZoom || 1,
      }),
    });

    const result = await response.json();
    console.log("Ответ сервера:", result);

    if (!response.ok) {
      console.error(
        "❌ Ошибка при сохранении GIF: " +
          (result.error || "Неизвестная ошибка")
      );
      return;
    }

    console.log("✅ GIF аватар сохранен на сервер");

    // Показываем информацию о размере файла
    if (result.fileSize) {
      const sizeMB = (result.fileSize / 1024 / 1024).toFixed(2);
      console.log(`📊 Финальный размер: ${sizeMB} MB`);
    }

    // Сохраняем в localStorage для быстрой загрузки
    if (result.avatarPath) {
      localStorage.setItem(`avatar_${currentUser.id}`, result.avatarPath);
      console.log("✅ GIF аватар сохранен в localStorage");
    }
    // Закрываем модальное окно и обновляем аватар в профиле
    closeAvatarModal();
    if (result.avatarPath) {
      updateAvatarInProfile(result.avatarPath);
    }
  } catch (error) {
    console.error("❌ Ошибка при сохранении GIF аватара:", error);
  }
}

async function deleteAvatar() {
  if (!confirm("Вы уверены, что хотите удалить аватар?")) {
    return;
  }

  try {
    console.log("Удаляю аватар...");
    const response = await fetch(`/api/user/${currentUser.id}/avatar`, {
      method: "DELETE",
    });

    const result = await response.json();
    console.log("Ответ сервера:", result);

    if (!response.ok) {
      console.error(
        "❌ Ошибка при удалении аватара: " +
          (result.error || "Неизвестная ошибка")
      );
      return;
    }

    console.log("✅ Аватар удален");

    // Удаляем из localStorage
    localStorage.removeItem(`avatar_${currentUser.id}`);
    console.log("✅ Аватар удален из localStorage");

    // Закрываем модальное окно и обновляем аватар в профиле (возвращаем дефолтный)
    closeAvatarModal();
    updateAvatarInProfile("img/default-avatar.jpg");
  } catch (error) {
    console.error("❌ Ошибка при удалении аватара:", error);
  }
}
