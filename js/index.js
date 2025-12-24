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

    loadEventsList();
    loadMyBets();
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
                      userBetOnMatch?.prediction === "draw" ? "selected" : ""
                    }" onclick="placeBet(${match.id}, 'draw', 'draw')" ${
        effectiveStatus !== "pending" || userBetOnMatch?.prediction === "draw"
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
    console.log(`📊 Получено значение для ${parameterType}: ${value}`);
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

      // Для toggle'ов - обновляем их визуально после фиксации
      if (
        parameterType === "penalties_in_game" ||
        parameterType === "extra_time" ||
        parameterType === "penalties_at_end"
      ) {
        let fieldId;
        if (parameterType === "penalties_in_game")
          fieldId = `penaltiesInGame_${matchId}`;
        if (parameterType === "extra_time") fieldId = `extraTime_${matchId}`;
        if (parameterType === "penalties_at_end")
          fieldId = `penaltiesAtEnd_${matchId}`;

        const checkbox = document.getElementById(fieldId);
        if (checkbox) {
          // Получаем текущее состояние из data-toggle-state (без изменения!)
          const toggleState = checkbox.getAttribute("data-toggle-state");

          // Обновляем стили toggle'а напрямую
          const label = checkbox.parentElement;
          const span = label.querySelector("span:not(input)");
          if (span) {
            const circle = span.querySelector("span");
            if (toggleState === "true") {
              span.style.backgroundColor = "#4db8a8";
              if (circle) circle.style.transform = "translateX(17px)";
            } else {
              span.style.backgroundColor = "#3a5f7a";
              if (circle) circle.style.transform = "translateX(-11px)";
            }
          }
        }
      }

      // Обновляем только список ставок, без перерисовки матчей
      const checkResponse = await fetch(`/api/user/${currentUser.id}/bets`);
      const bets = await checkResponse.json();
      userBets = bets;
      console.log("💰 Мои ставки:", bets);
      displayMyBets(bets);

      // Блокируем параметр после успешного сохранения ставки
      lockFinalParameter(matchId, parameterType);
      // Не вызываем displayMatches() чтобы не потерять состояние кнопок
    } else {
      alert("Ошибка при создании ставки");
    }
  } catch (error) {
    console.error("Ошибка при размещении ставки на финальный параметр:", error);
    alert("Ошибка при размещении ставки");
  }
}

async function loadMyBets() {
  if (!currentUser) return;

  try {
    const response = await fetch(`/api/user/${currentUser.id}/bets`);
    const bets = await response.json();
    userBets = bets; // Сохраняем в глобальную переменную
    console.log("💰 Мои ставки:", bets);
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

        // Проверяем, есть ли результат матча
        if (bet.winner) {
          // Маппинг winner (из БД) в prediction format
          // winner: "team1" | "team2" | "draw"
          // prediction: team1_name | team2_name | "draw"
          let winnerPrediction;
          if (bet.winner === "team1") {
            winnerPrediction = bet.team1_name;
          } else if (bet.winner === "team2") {
            winnerPrediction = bet.team2_name;
          } else if (bet.winner === "draw") {
            winnerPrediction = "draw";
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
                        // Обычная ставка
                        return bet.prediction === "draw"
                          ? "Ничья"
                          : bet.prediction;
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

    // Если это была final bet - разблокируем параметр
    if (isFinalBet && matchId && parameterType) {
      unlockFinalParameter(matchId, parameterType);
    }

    // ✨ Удаляем ставку из DOM плавной анимацией без перезагрузки
    const betElement = document.querySelector(`[data-bet-id="${betId}"]`);
    if (betElement) {
      // Находим турнир (родительский div с разделителем выше)
      let previousSibling = betElement.previousElementSibling;
      let eventDivider = null;

      // Ищем ближайший разделитель выше удаляемой ставки
      while (previousSibling) {
        if (previousSibling.textContent.includes("━━━")) {
          eventDivider = previousSibling;
          break;
        }
        previousSibling = previousSibling.previousElementSibling;
      }

      betElement.style.opacity = "0.5";
      betElement.style.transform = "scale(0.95)";
      betElement.style.transition = "all 0.3s ease";

      setTimeout(() => {
        betElement.remove();

        // Проверяем, есть ли еще ставки для этого турнира
        let nextSibling = eventDivider?.nextElementSibling;
        let hasMoreBets = false;

        while (nextSibling) {
          // Если встретили следующий разделитель - нет ставок в этом турнире
          if (nextSibling.textContent.includes("━━━")) {
            break;
          }
          // Если встретили ставку - есть ставки
          if (nextSibling.classList.contains("bet-item")) {
            hasMoreBets = true;
            break;
          }
          nextSibling = nextSibling.nextElementSibling;
        }

        // Удаляем разделитель если ставок нет
        if (!hasMoreBets && eventDivider) {
          eventDivider.remove();
        }

        // Если ставок больше нет - показываем пустое сообщение
        const myBetsList = document.getElementById("myBetsList");
        if (myBetsList.children.length === 0) {
          myBetsList.innerHTML =
            '<div class="empty-message">У вас пока нет ставок</div>';
        }

        // Удаляем ставку из userBets массива
        userBets = userBets.filter((b) => b.id !== betId);

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
    <div class="participant-item">
      <div class="participant-rank">#${index + 1}</div>
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
      <div class="participant-bets-count">${participant.won_bets || 0}</div>
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

    // Скрываем section с сеткой турниров и показываем участников турнира
    document.getElementById("tournamentsSection").style.display = "none";
    document.getElementById("tournamentSection").style.display = "block";
    document.getElementById("tournamentTitle").innerText = `📋 ${eventName}`;

    displayTournamentParticipants(participants, isLocked);
  } catch (error) {
    console.error("Ошибка при загрузке участников турнира:", error);
    document.getElementById("tournamentParticipantsList").innerHTML =
      '<div class="empty-message">Ошибка при загрузке участников турнира</div>';
  }
}

function displayTournamentParticipants(participants, isLocked = false) {
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
    <div class="participant-item ${winnerClass}">
      <div class="participant-rank participant-rank-events">#${place} ${emoji}</div>
      <div class="participant-info">
        <div class="participant-name">${participant.username}</div>
        <div class="participant-stats">
          Ставок в турнире: ${participant.event_bets || 0} | 
          Угаданных: ${participant.event_won || 0} | 
          Неугаданных: ${participant.event_lost || 0} | 
          В ожидании: ${participant.event_pending || 0}
        </div>
      </div>
      <div class="participant-bets-count">${participant.event_won || 0}</div>
    </div>
  `;
    })
    .join("");
}

function backToTournaments() {
  document.getElementById("tournamentsSection").style.display = "block";
  document.getElementById("tournamentSection").style.display = "none";
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
