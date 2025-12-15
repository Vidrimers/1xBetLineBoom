// Глобальные переменные
let currentUser = null;
let currentEventId = null;
let events = [];
let matches = [];
let userBets = [];
let ADMIN_USER = null;

// ===== ИНИЦИАЛИЗАЦИЯ =====

// Загрузить конфигурацию сервера
async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    ADMIN_USER = config.ADMIN_USER;
  } catch (error) {
    console.error("❌ Ошибка при загрузке конфигурации:", error);
  }
}

// Загрузить турниры при загрузке страницы
document.addEventListener("DOMContentLoaded", async () => {
  // Загружаем конфиг сначала
  await loadConfig();

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
    if (user.username === ADMIN_USER) {
      document.getElementById("adminBtn").style.display = "inline-block";
      document.getElementById("adminUsersBtn").style.display = "inline-block";
    }

    loadEvents();
    loadMyBets();
  } else {
    loadEvents();
  }

  // Запускаем обновление статусов матчей каждые 30 секунд
  setInterval(() => {
    if (matches.length > 0) {
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

  // Обновляем input с правильным логином
  document.getElementById("username").value = username;

  try {
    const response = await fetch("/api/user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username }),
    });

    const user = await response.json();
    currentUser = user;

    // Сохраняем пользователя в localStorage
    localStorage.setItem("currentUser", JSON.stringify(user));

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
    if (currentUser.username === ADMIN_USER) {
      document.getElementById("adminBtn").style.display = "inline-block";
      document.getElementById("adminUsersBtn").style.display = "inline-block";
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
  document.getElementById("adminUsersBtn").style.display = "none";

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

  html += sortedEvents
    .map((event) => {
      // Добавляем разделитель перед заблокированными турнирами
      let separator = "";
      if (event.locked_reason && !lastWasLocked) {
        separator =
          '<div style="margin: 15px 0; text-align: center; color: #ccc; font-size: 0.9em;">━━━ ЗАВЕРШЕННЫЕ ТУРНИРЫ ━━━</div>';
      }
      lastWasLocked = !!event.locked_reason;

      // Если турнир заблокирован, показываем индикатор
      const lockedBadge = event.locked_reason
        ? `<div style="display: flex; align-items: center; gap: 5px; margin-top: 8px; padding: 5px 8px; background: #ffe0e0; border-left: 3px solid #f44336; border-radius: 3px;">
              <span style="color: #f44336; font-weight: bold; font-size: 0.8em;">🔒 ЗАБЛОКИРОВАН</span>
              <span style="color: #666; font-size: 0.85em;">${event.locked_reason}</span>
            </div>`
        : "";

      return `${separator}
        <div class="event-item ${event.locked_reason ? "locked" : ""} ${
        event.id === currentEventId ? "active" : ""
      }">
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
              ${lockedBadge}
            </div>
            ${
              isAdmin()
                ? `<div style="display: flex; gap: 5px; margin-left: 10px; flex-wrap: wrap; justify-content: flex-end;">
                  ${
                    event.locked_reason
                      ? `<button onclick="unlockEvent(${event.id})" style="background: transparent; padding: 5px 10px; font-size: 0.8em; border: 1px solid #4caf50; color: #4caf50; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(76, 175, 80, 0.1)'" onmouseout="this.style.background='transparent'">🔓</button>`
                      : `<button onclick="openLockEventModal(${event.id}, '${event.name}')" style="background: transparent; padding: 5px 10px; font-size: 0.8em; border: 1px solid #ff9800; color: #ff9800; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(255, 152, 0, 0.1)'" onmouseout="this.style.background='transparent'">🔒</button>`
                  }
                  <button class="event-delete-btn" onclick="deleteEvent(${
                    event.id
                  })" style="background: transparent; padding: 5px 10px; font-size: 0.8em; border: 1px solid #f44336; color: #f44336; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(244, 67, 54, 0.1)'" onmouseout="this.style.background='transparent'">✕</button>
                </div>`
                : ""
            }
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

  // Если матч начался (в прошлом) - ongoing (пока не установлен результат)
  if (!match.winner) {
    return "ongoing";
  }

  // Если установлен результат - finished
  return "finished";
}

async function loadMatches(eventId) {
  try {
    const response = await fetch(`/api/events/${eventId}/matches`);
    matches = await response.json();
    displayMatches();
  } catch (error) {
    console.error("Ошибка при загрузке матчей:", error);
    document.getElementById("matchesContainer").innerHTML =
      '<div class="empty-message">Ошибка при загрузке матчей</div>';
  }
}

function displayMatches() {
  const matchesContainer = document.getElementById("matchesContainer");

  if (matches.length === 0) {
    matchesContainer.innerHTML =
      '<div class="empty-message">Матчи не найдены</div>';
    return;
  }

  matchesContainer.innerHTML = matches
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
        <div class="match-row ${betClass}">
            <div class="match-teams">
                <div class="match-vs">
                    <div class="team team-left">${match.team1_name}</div>
                    <div class="vs-text">VS</div>
                    <div class="team team-right">${match.team2_name}</div>
                </div>
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
                    <button class="bet-btn team1" onclick="placeBet(${
                      match.id
                    }, '${match.team1_name}', '1')" ${
        effectiveStatus !== "pending" ? "disabled" : ""
      }>
                        ${match.team1_name}
                    </button>
                    <button class="bet-btn draw" onclick="placeBet(${
                      match.id
                    }, 'Ничья', 'X')" ${
        effectiveStatus !== "pending" ? "disabled" : ""
      }>
                        Ничья
                    </button>
                    <button class="bet-btn team2" onclick="placeBet(${
                      match.id
                    }, '${match.team2_name}', '2')" ${
        effectiveStatus !== "pending" ? "disabled" : ""
      }>
                        ${match.team2_name}
                    </button>
                </div>
            </div>
        </div>
    `;
    })
    .join("");
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
    displayMatches(); // Перерисовываем матчи чтобы выделить с ставками
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
        if (bet.winner === bet.prediction) {
          statusClass = "won";
          statusText = "✅ Выиграла";
        } else {
          statusClass = "lost";
          statusText = "❌ Проиграла";
        }
      }

      return `
            <div class="bet-item ${statusClass}">
                <div class="bet-info">
                    <span class="bet-match">${bet.team1_name} vs ${bet.team2_name}</span>
                    <span class="bet-status ${statusClass}">${statusText}</span>
                </div>
                <div class="bet-info" style="font-size: 0.9em; color: #666;">
                    <span>Ставка: <strong>${bet.prediction}</strong></span>
                    <span>Сумма: <strong>${bet.amount}</strong></span>
                </div>
                <div style="font-size: 0.85em; color: #999; margin-top: 5px;">
                    Событие: ${bet.event_name}
                </div>
                <button class="bet-delete-btn" onclick="deleteBet(${bet.id})">✕</button>
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
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert("Ошибка: " + result.error);
      return;
    }

    loadMyBets();
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

  // Удаляем активный класс со всех кнопок вкладок
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  // Показываем нужное содержимое и отмечаем кнопку как активную
  if (tabName === "allbets") {
    document.getElementById("allbets-content").style.display = "grid";
    document.querySelectorAll(".tab-btn")[0].classList.add("active");
    loadEvents();
    loadMatches();
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
        <div class="stat-label">✅ Выигрышей</div>
        <div class="stat-value">${profile.won_bets}</div>
      </div>
      <div class="stat-card lost">
        <div class="stat-label">❌ Проигрышей</div>
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
  return currentUser && currentUser.username === ADMIN_USER;
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

    alert(result.message);
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

// Закрыть модальное окно при клике вне его
window.onclick = function (event) {
  const modal = document.getElementById("adminModal");
  if (event.target === modal) {
    modal.style.display = "none";
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
function loadSettings() {
  // Заглушка для функции загрузки настроек
  // Здесь можно добавить загрузку пользовательских настроек
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

  if (!team1 || !team2) {
    alert("Пожалуйста, введите обе команды");
    return;
  }

  if (!currentEventId) {
    alert("Турнир не выбран");
    return;
  }

  try {
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
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert("Ошибка: " + result.error);
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
