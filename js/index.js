// Глобальные переменные
let currentUser = null;
let currentEventId = null;
let events = [];
let matches = [];
let ADMIN_USER = null;

// ===== ИНИЦИАЛИЗАЦИЯ =====

// Загрузить конфигурацию сервера
async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    ADMIN_USER = config.ADMIN_USER;
    console.log("✅ Конфиг загружен. ADMIN_USER:", ADMIN_USER);
  } catch (error) {
    console.error("❌ Ошибка при загрузке конфигурации:", error);
  }
}

// Загрузить события при загрузке страницы
document.addEventListener("DOMContentLoaded", async () => {
  // Загружаем конфиг сначала
  await loadConfig();

  // Проверяем, есть ли пользователь в localStorage
  const savedUser = localStorage.getItem("currentUser");

  if (savedUser) {
    const user = JSON.parse(savedUser);
    currentUser = user;

    // Показываем информацию о пользователе
    document.getElementById("userStatus").style.display = "block";
    document.getElementById("usernameBold").textContent = user.username;
    document.getElementById("username").value = user.username;
    document.getElementById("username").disabled = true;

    // Меняем кнопку на "Выход"
    const authBtn = document.getElementById("authBtn");
    authBtn.textContent = "Выход";
    authBtn.style.background = "#F44336";
    authBtn.onclick = () => logoutUser();

    // Показываем админ-кнопку если это админ
    if (user.username === ADMIN_USER) {
      document.getElementById("adminBtn").style.display = "inline-block";
    }

    loadEvents();
    loadMyBets();
  } else {
    loadEvents();
  }
});

// ===== ПОЛЬЗОВАТЕЛЬ =====

async function initUser() {
  const username = document.getElementById("username").value.trim();

  if (!username) {
    alert("Пожалуйста, введите имя");
    return;
  }

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

    // Показываем информацию о пользователе
    document.getElementById("userStatus").style.display = "block";
    document.getElementById("usernameBold").textContent = user.username;
    document.getElementById("username").disabled = true;

    // Меняем кнопку на "Выход"
    const authBtn = document.getElementById("authBtn");
    authBtn.textContent = "Выход";
    authBtn.style.background = "#F44336";
    authBtn.onclick = () => logoutUser();

    // Показываем админ-кнопку если это админ
    if (user.username === ADMIN_USER) {
      document.getElementById("adminBtn").style.display = "inline-block";
    }

    // Загружаем ставки пользователя
    loadMyBets();

    alert(`✅ Добро пожаловать, ${user.username}!`);
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

  // Скрываем информацию о пользователе
  document.getElementById("userStatus").style.display = "none";
  document.getElementById("username").value = "";
  document.getElementById("username").disabled = false;

  // Скрываем админ-кнопку
  document.getElementById("adminBtn").style.display = "none";

  // Меняем кнопку обратно на "Начать"
  const authBtn = document.getElementById("authBtn");
  authBtn.textContent = "Начать";
  authBtn.style.background = "";
  authBtn.onclick = () => initUser();

  // Очищаем ставки
  document.getElementById("myBetsList").innerHTML =
    '<div class="empty-message">У вас пока нет ставок</div>';

  alert("👋 Вы вышли из аккаунта");
}

// ===== СОБЫТИЯ =====

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

  eventsList.innerHTML = events
    .map(
      (event) => `
        <div class="event-item ${
          event.id === currentEventId ? "active" : ""
        }" onclick="selectEvent(${event.id}, '${event.name}')">
            <strong>${event.name}</strong>
            <p style="font-size: 0.9em; opacity: 0.7; margin-top: 5px;">${
              event.description || "Нет описания"
            }</p>
        </div>
    `
    )
    .join("");
}

async function selectEvent(eventId, eventName) {
  currentEventId = eventId;
  displayEvents(); // Обновляем выделение
  loadMatches(eventId);
}

// ===== МАТЧИ =====

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
    .map(
      (match) => `
        <div class="match-row">
            <div class="match-teams">
                <div class="match-vs">
                    <div class="team">${match.team1_name}</div>
                    <div class="vs-text">VS</div>
                    <div class="team">${match.team2_name}</div>
                </div>
                <div class="bet-buttons">
                    <button class="bet-btn team1" onclick="placeBet(${match.id}, '${match.team1_name}')">
                        На ${match.team1_name}
                    </button>
                    <button class="bet-btn team2" onclick="placeBet(${match.id}, '${match.team2_name}')">
                        На ${match.team2_name}
                    </button>
                </div>
            </div>
        </div>
    `
    )
    .join("");
}

// ===== СТАВКИ =====

async function placeBet(matchId, teamName) {
  if (!currentUser) {
    alert("Сначала введите ваше имя");
    return;
  }

  const amount = prompt(
    `На какую сумму ставить на ${teamName}? (по умолчанию 1)`
  );

  if (amount === null) return; // Отмена

  const betAmount = amount ? parseFloat(amount) : 1;

  if (isNaN(betAmount) || betAmount <= 0) {
    alert("Введите корректную сумму");
    return;
  }

  try {
    const response = await fetch("/api/bets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: currentUser.id,
        match_id: matchId,
        prediction: teamName,
        amount: betAmount,
      }),
    });

    if (response.ok) {
      alert(`✅ Ставка на ${teamName} в размере ${betAmount} принята!`);
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
    displayMyBets(bets);
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
            </div>
        `;
    })
    .join("");
}

// ===== ВКЛАДКИ =====

function switchTab(tabName) {
  // Скрываем все вкладки
  document.getElementById("bets-tab").style.display = "none";
  document.getElementById("participants-tab").style.display = "none";
  document.getElementById("profile-tab").style.display = "none";

  // Удаляем класс active со всех кнопок
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  // Показываем выбранную вкладку
  if (tabName === "bets") {
    document.getElementById("bets-tab").style.display = "block";
    document
      .querySelector("button[onclick=\"switchTab('bets')\"]")
      .classList.add("active");
  } else if (tabName === "participants") {
    document.getElementById("participants-tab").style.display = "block";
    document
      .querySelector("button[onclick=\"switchTab('participants')\"]")
      .classList.add("active");
    loadParticipants();
  } else if (tabName === "profile") {
    document.getElementById("profile-tab").style.display = "block";
    document
      .querySelector("button[onclick=\"switchTab('profile')\"]")
      .classList.add("active");
    loadProfile();
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
      <div class="profile-username">🎯 ${profile.username}</div>
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
async function createEvent() {
  console.log("createEvent вызвана");
  console.log("currentUser:", currentUser);
  console.log("ADMIN_USER:", ADMIN_USER);

  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  if (!isAdmin()) {
    alert("У вас нет прав для создания событий");
    return;
  }

  const name = prompt("Введите название события:");
  if (!name) return;

  const description = prompt("Введите описание события (опционально):");
  const start_date = prompt(
    "Введите дату начала (опционально, формат: YYYY-MM-DD):"
  );

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

    alert(result.message);
    loadEvents();
  } catch (error) {
    console.error("Ошибка при создании события:", error);
    alert("Ошибка при создании события");
  }
}

// Удалить событие (только для админа)
async function deleteEvent(eventId) {
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
    console.error("Ошибка при удалении события:", error);
    alert("Ошибка при удалении события");
  }
}
