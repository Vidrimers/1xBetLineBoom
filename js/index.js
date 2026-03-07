// Случайная ставка по всем матчам выбранного тура

// Позиционирование кубика относительно кнопки
function updateDicePosition() {
  const btn = document.querySelector('.lucky-btn');
  const dice = document.querySelector('.dice-wrapper');
  
  if (!btn || !dice) return;
  
  const rect = btn.getBoundingClientRect();
  const isSpinning = btn.classList.contains('spinning');
  const isHovered = btn.matches(':hover') && window.innerWidth >= 769; // Только для десктопа
  
  if (isSpinning || isHovered) {
    // Включаем плавный переход
    dice.classList.add('dice-transitioning');
    
    // В центре кнопки
    dice.style.left = `${rect.left + rect.width / 2}px`;
    dice.style.top = `${rect.top + rect.height / 2}px`;
    dice.style.transform = isSpinning ? 'translate(-50%, -50%) scale(1.57)' : 'translate(-50%, -50%)';
  } else {
    // Включаем плавный переход для возврата
    dice.classList.add('dice-transitioning');
    
    // Слева от текста
    dice.style.left = `${rect.left + 8}px`;
    dice.style.top = `${rect.top + rect.height / 2}px`;
    dice.style.transform = 'translateY(-50%)';
    
    // Убираем transition после завершения анимации, чтобы не мешать при скролле
    setTimeout(() => {
      if (!btn.matches(':hover') && !btn.classList.contains('spinning')) {
        dice.classList.remove('dice-transitioning');
      }
    }, 400);
  }
}

// Обновляем позицию при скролле и ресайзе
let dicePositionInterval = null;

function startDicePositionTracking() {
  updateDicePosition();
  if (!dicePositionInterval) {
    dicePositionInterval = setInterval(() => {
      const btn = document.querySelector('.lucky-btn');
      const dice = document.querySelector('.dice-wrapper');
      
      // Обновляем позицию без transition при скролле
      if (btn && dice && !btn.matches(':hover') && !btn.classList.contains('spinning')) {
        const rect = btn.getBoundingClientRect();
        dice.style.left = `${rect.left + 8}px`;
        dice.style.top = `${rect.top + rect.height / 2}px`;
      } else {
        updateDicePosition();
      }
    }, 16); // ~60fps
  }
  
  // Добавляем обработчики hover для десктопа
  const btn = document.querySelector('.lucky-btn');
  if (btn && window.innerWidth >= 769) {
    btn.addEventListener('mouseenter', updateDicePosition);
    btn.addEventListener('mouseleave', updateDicePosition);
  }
}

function stopDicePositionTracking() {
  if (dicePositionInterval) {
    clearInterval(dicePositionInterval);
    dicePositionInterval = null;
  }
}

// Соответствие иконок их текстовым описаниям для title атрибутов
const iconTitles = {
  "🏆": "Стандартный",
  "img/cups/world-cup.png": "Чемпионат мира",
  "img/cups/champions-league.png": "Лига чемпионов",
  "img/cups/european-league.png": "Лига европы",
  "img/cups/conference-league.png": "Лига конференций",
  "img/cups/serie-a.png": "Serie A",
  "img/cups/england-premier-league.png": "Английская премьер лига",
  "img/cups/spain-la-liga.png": "Ла Лига",
  "img/cups/france-league-ligue-1.png": "Лига 1",
  "img/cups/bundesliga.png": "Бундеслига",
};

// Функция для получения title иконки
function getIconTitle(icon) {
  return (
    iconTitles[icon] ||
    (icon.startsWith("http") || icon.length > 10 ? "Кастомная иконка" : icon)
  );
}

async function luckyBetForCurrentRound() {
  if (!currentUser) {
    alert("Сначала войдите в аккаунт");
    return;
  }
  if (!currentRoundFilter || currentRoundFilter === "all") {
    alert("Сначала выберите тур");
    return;
  }
  // Находим все матчи выбранного тура, которые еще не завершены/отменены и на которые пользователь не ставил
  const matchesToBet = matches.filter(
    (m) =>
      m.round === currentRoundFilter &&
      getMatchStatusByDate(m) !== "finished" &&
      !['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(getMatchStatusByDate(m)) &&
      !userBets.some((b) => b.match_id === m.id)
  );
  if (matchesToBet.length === 0) {
    alert("Нет доступных матчей для случайной ставки в этом туре");
    return;
  }
  
  // Находим кнопку и добавляем класс для анимации
  const luckyBtn = document.querySelector('.lucky-btn');
  if (luckyBtn) {
    luckyBtn.classList.add('spinning');
    luckyBtn.disabled = true;
    updateDicePosition(); // Обновляем позицию для центрирования
  }
  
  // Ждем 2 секунды пока кубик крутится
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Подсчитываем сколько матчей с прогнозами на счёт и карточки
  let scorePredictionsCount = 0;
  let cardsPredictionsCount = 0;
  
  // Для каждого такого матча делаем случайную ставку
  for (const match of matchesToBet) {
    // Генерируем рандомный счет (0-5 голов для каждой команды)
    const team1Score = Math.floor(Math.random() * 6);
    const team2Score = Math.floor(Math.random() * 6);
    
    // Определяем результат на основе счета
    let prediction;
    if (team1Score > team2Score) {
      prediction = "team1";
    } else if (team2Score > team1Score) {
      prediction = "team2";
    } else {
      prediction = "draw";
    }
    
    // Генерируем рандомные карточки (общее количество в матче)
    const yellowCards = Math.floor(Math.random() * 9); // 0-8 желтых карточек
    const redCards = Math.floor(Math.random() * 4); // 0-3 красных карточек
    
    try {
      // Отправляем ставку на результат
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
      
      // Отправляем прогноз на счет если включен для матча
      if (match.score_prediction_enabled) {
        await fetch("/api/score-predictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: currentUser.id,
            match_id: match.id,
            score_team1: team1Score,
            score_team2: team2Score,
          }),
        });
        scorePredictionsCount++;
      }
      
      // Отправляем прогноз на карточки если включен для матча
      if (match.yellow_cards_prediction_enabled || match.red_cards_prediction_enabled) {
        await fetch("/api/cards-predictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: currentUser.id,
            match_id: match.id,
            yellow_cards: match.yellow_cards_prediction_enabled ? yellowCards : null,
            red_cards: match.red_cards_prediction_enabled ? redCards : null,
          }),
        });
        cardsPredictionsCount++;
      }
      
    } catch (e) {
      console.error("Ошибка при отправке случайной ставки:", e);
    }
  }
  
  // Отправляем уведомление админу
  try {
    const currentEvent = events.find(e => e.id === currentEventId);
    await fetch("/api/admin/notify-lucky-bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: currentUser.id,
        eventName: currentEvent ? currentEvent.name : "Неизвестный турнир",
        round: currentRoundFilter,
        matchesCount: matchesToBet.length,
        scorePredictions: scorePredictionsCount,
        cardsPredictions: cardsPredictionsCount,
      }),
    });
  } catch (e) {
    console.error("Ошибка при отправке уведомления админу:", e);
  }
  
  // Убираем анимацию и включаем кнопку
  if (luckyBtn) {
    luckyBtn.classList.remove('spinning');
    luckyBtn.disabled = false;
    updateDicePosition(); // Возвращаем позицию обратно
  }
  
  await loadMyBets();
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
let tournamentParticipantsInterval = null; // Интервал для автообновления рейтинга

// Кастомные модальные окна
function showCustomAlert(message, title = "Уведомление", icon = "ℹ️") {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay';
    
    overlay.innerHTML = `
      <div class="custom-modal">
        <div class="custom-modal-title">${icon} ${title}</div>
        <div class="custom-modal-message" style="
          text-align: left;
          white-space: pre-wrap;
          font-family: 'Courier New', monospace;
          line-height: 1.6;
          max-height: 60vh;
          overflow-y: auto;
        ">${message}</div>
        <div class="custom-modal-buttons">
          <button class="custom-modal-btn custom-modal-btn-primary">OK</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelector('.custom-modal-btn').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(true);
      }
    });
  });
}

function showCustomConfirm(message, title = "Подтверждение", icon = "❓") {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay';
    
    overlay.innerHTML = `
      <div class="custom-modal">
        <div class="custom-modal-title">${icon} ${title}</div>
        <div class="custom-modal-message">${message}</div>
        <div class="custom-modal-buttons">
          <button class="custom-modal-btn custom-modal-btn-secondary" data-action="cancel">Отмена</button>
          <button class="custom-modal-btn custom-modal-btn-primary" data-action="confirm">Продолжить</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelectorAll('.custom-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        overlay.remove();
        resolve(action === 'confirm');
      });
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

function showCustomSaveConfirm(message, title = "Несохраненные изменения", icon = "⚠️") {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay';
    
    overlay.innerHTML = `
      <div class="custom-modal">
        <div class="custom-modal-title">${icon} ${title}</div>
        <div class="custom-modal-message">${message}</div>
        <div class="custom-modal-buttons" style="display: flex; gap: 10px; justify-content: center;">
          <button class="custom-modal-btn custom-modal-btn-secondary" data-action="cancel">Отмена</button>
          <button class="custom-modal-btn custom-modal-btn-danger" data-action="discard">Не сохранять</button>
          <button class="custom-modal-btn custom-modal-btn-primary" data-action="save">Сохранить</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelectorAll('.custom-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        overlay.remove();
        resolve(action); // Возвращаем 'save', 'discard' или 'cancel'
      });
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve('cancel');
      }
    });
  });
}

function showCustomPrompt(message, title = "Ввод данных", icon = "✏️", placeholder = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay';
    
    overlay.innerHTML = `
      <div class="custom-modal">
        <div class="custom-modal-title">${icon} ${title}</div>
        <div class="custom-modal-message">${message}</div>
        <input type="text" class="custom-modal-input" placeholder="${placeholder}" autofocus>
        <div class="custom-modal-buttons">
          <button class="custom-modal-btn custom-modal-btn-secondary" data-action="cancel">Отмена</button>
          <button class="custom-modal-btn custom-modal-btn-primary" data-action="confirm">OK</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    const input = overlay.querySelector('.custom-modal-input');
    
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        overlay.remove();
        resolve(input.value.trim() || null);
      }
    });
    
    overlay.querySelectorAll('.custom-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        overlay.remove();
        resolve(action === 'confirm' ? (input.value.trim() || null) : null);
      });
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });
    
    setTimeout(() => input.focus(), 100);
  });
}
let matches = [];
let userBets = [];
let ADMIN_LOGIN = null;
let cropper = null;
let ADMIN_DB_NAME = null;
let matchUpdateInterval = null;
let sessionCheckInterval = null;
let isMatchUpdatingEnabled = true;
let isRenamingUser = false; // Флаг для блокировки автовыхода при переименовании
let currentRoundFilter = "all"; // Текущий фильтр по туру
let roundsOrder = []; // Порядок туров из БД
let tempRoundsOrder = []; // Временный порядок для редактирования

function moveAuthButtonToProfile() {
  const authBtn = document.getElementById("authBtn");
  const placeholder = document.getElementById("profileAuthPlaceholder");
  if (!authBtn || !placeholder) return;
  if (!placeholder.contains(authBtn)) {
    // Показываем кнопку и убираем все скрывающие стили
    authBtn.style.display = '';
    authBtn.style.position = '';
    authBtn.style.left = '';
    placeholder.appendChild(authBtn);
  }
}

function moveAuthButtonToLoginForm() {
  const authBtn = document.getElementById("authBtn");
  const userInput = document.querySelector(".user-input");
  
  // Проверяем что элементы существуют
  if (!authBtn || !userInput) return;
  
  // Проверяем видимость через getComputedStyle
  const computedStyle = window.getComputedStyle(userInput);
  if (computedStyle.display === 'none') return; // Не перемещаем если форма скрыта
  
  const countingBtn = document.getElementById("countingBtn");
  if (userInput.contains(authBtn)) return;
  
  try {
    if (countingBtn && countingBtn.parentNode === userInput) {
      userInput.insertBefore(authBtn, countingBtn);
    } else {
      userInput.appendChild(authBtn);
    }
  } catch (e) {
    console.warn('⚠️ Не удалось переместить кнопку авторизации:', e);
  }
}

function setAuthButtonToLogoutState() {
  const authBtn = document.getElementById("authBtn");
  if (!authBtn) return;
  authBtn.classList.add("logout-mode");
  authBtn.innerHTML =
    '<span class="logout-text logout-text-before">ВЫ</span><span class="logout-cross">X</span><span class="logout-text logout-text-after">ОД</span>';
  authBtn.onclick = () => logoutUser();
  moveAuthButtonToProfile();
  hideTelegramAuthButtons();
}

function setAuthButtonToLoginState() {
  const authBtn = document.getElementById("authBtn");
  if (!authBtn) return;
  authBtn.classList.remove("logout-mode");
  authBtn.innerHTML = "Войти";
  authBtn.onclick = () => initUser();
  moveAuthButtonToLoginForm();
  // НЕ показываем кнопки Telegram в гостевом режиме
  // showTelegramAuthButtons();
}

// Скрыть кнопки Telegram авторизации
function hideTelegramAuthButtons() {
  const telegramAuthBtn = document.getElementById("telegramAuthBtn");
  const telegramAuthBtnMobile = document.getElementById("telegramAuthBtnMobile");
  if (telegramAuthBtn) telegramAuthBtn.style.display = "none";
  if (telegramAuthBtnMobile) telegramAuthBtnMobile.style.display = "none";
}

// Показать кнопки Telegram авторизации
function showTelegramAuthButtons() {
  const telegramAuthBtn = document.getElementById("telegramAuthBtn");
  const telegramAuthBtnMobile = document.getElementById("telegramAuthBtnMobile");
  if (telegramAuthBtn) telegramAuthBtn.style.display = "flex";
  if (telegramAuthBtnMobile) telegramAuthBtnMobile.style.display = "flex";
}

// ===== ТЕМЫ =====

// Изменить тему сайта
// Предварительный просмотр темы (без сохранения на сервере)
function previewTheme(themeName) {
  console.log(`🎨 Предпросмотр темы: ${themeName}`);

  // Удаляем все классы тем
  document.body.classList.remove(
    "theme-default",
    "theme-hacker-green",
    "theme-solarized",
    "theme-matrix",
    "theme-cyberpunk",
    "theme-leagueChampions",
    "theme-leagueEurope"
  );

  // Добавляем новый класс темы
  document.body.classList.add(themeName);

  console.log(`✅ Тема ${themeName} применена для предпросмотра`);
}

// Сохранить выбранную тему
async function saveTheme() {
  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  const themeSelect = document.getElementById("themeSelect");
  const themeName = themeSelect.value;

  try {
    showSaveStatus('themeStatus', 'saving');

    const response = await fetch(`/api/user/${currentUser.id}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: themeName }),
    });

    if (response.ok) {
      localStorage.setItem("selectedTheme", themeName);
      
      // Применяем тему
      document.body.classList.remove(
        "theme-default",
        "theme-hacker-green",
        "theme-solarized",
        "theme-matrix",
        "theme-cyberpunk",
        "theme-leagueChampions",
        "theme-leagueEurope"
      );
      document.body.classList.add(themeName);
      
      showSaveStatus('themeStatus', 'saved');
    } else {
      throw new Error("Ошибка сохранения");
    }
  } catch (error) {
    console.error("❌ Ошибка сохранения темы на сервере:", error);
    showSaveStatus('themeStatus', 'error');
  }
}

// Изменить тему (используется при загрузке сохраненной темы)
async function changeTheme(themeName) {
  console.log(`🎨 Смена темы на: ${themeName}`);

  // Удаляем все классы тем
  document.body.classList.remove(
    "theme-default",
    "theme-hacker-green",
    "theme-solarized",
    "theme-matrix",
    "theme-cyberpunk",
    "theme-leagueChampions",
    "theme-leagueEurope"
  );

  // Добавляем новый класс темы
  document.body.classList.add(themeName);

  console.log(`✅ Тема ${themeName} применена`);
}

// Загрузить сохраненную тему при загрузке страницы
async function loadSavedTheme() {
  // Сначала загружаем из localStorage для быстрого применения
  let savedTheme = localStorage.getItem("selectedTheme") || "theme-default";
  
  console.log(`📂 Загружена тема из localStorage: ${savedTheme}`);

  // Применяем тему
  document.body.classList.add(savedTheme);

  // Устанавливаем правильное значение в select
  const themeSelect = document.getElementById("themeSelect");
  if (themeSelect) {
    themeSelect.value = savedTheme;
  }

  // Если пользователь залогинен, загружаем тему с сервера
  if (currentUser) {
    try {
      const response = await fetch(`/api/user/${currentUser.id}/notifications`);
      if (response.ok) {
        const data = await response.json();
        if (data.theme && data.theme !== savedTheme) {
          // Если тема на сервере отличается, применяем её
          savedTheme = data.theme;
          localStorage.setItem("selectedTheme", savedTheme);
          
          // Удаляем старую тему и применяем новую
          document.body.classList.remove(
            "theme-default",
            "theme-hacker-green",
            "theme-solarized",
            "theme-matrix",
            "theme-cyberpunk",
            "theme-leagueChampions",
            "theme-leagueEurope"
          );
          document.body.classList.add(savedTheme);
          
          if (themeSelect) {
            themeSelect.value = savedTheme;
          }
          
          console.log(`📂 Тема обновлена с сервера: ${savedTheme}`);
        }
      }
    } catch (error) {
      console.error("❌ Ошибка загрузки темы с сервера:", error);
    }
  }
}

// ===== УНИВЕРСАЛЬНЫЕ ФУНКЦИИ ДЛЯ МОДАЛЬНЫХ ОКОН =====

// Блокировка скролла страницы при открытии модалки
function lockBodyScroll() {
  document.body.style.overflow = 'hidden';
}

// Разблокировка скролла страницы при закрытии модалки
function unlockBodyScroll() {
  document.body.style.overflow = '';
}

// Универсальная функция закрытия модалки при клике вне контента
function closeModalOnOutsideClick(event, modalId, closeFunction) {
  if (event.target.id === modalId) {
    closeFunction();
  }
}

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
  
  // Блокируем скролл body
  document.body.style.overflow = 'hidden';
}

// Закрыть модальное окно
function closeRoundsOrderModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById("roundsOrderModal").classList.remove("active");
  
  // Разблокируем скролл body
  document.body.style.overflow = '';
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
        <button class="delete-round-btn" onclick="deleteRound('${round.replace(/'/g, "\\'")}', ${index})" title="Удалить тур и все его матчи">×</button>
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

// Удалить тур и все его матчи
async function deleteRound(roundName, index) {
  const confirmed = await showCustomConfirm(
    `Вы уверены, что хотите удалить тур "${roundName}" и все его матчи?`,
    "Подтверждение удаления",
    "⚠️"
  );
  
  if (!confirmed) {
    return;
  }

  try {
    // Удаляем тур из временного массива
    tempRoundsOrder.splice(index, 1);
    
    // Удаляем матчи этого тура из базы данных
    const response = await fetch(`/api/admin/rounds/${encodeURIComponent(roundName)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        event_id: currentEventId
      })
    });

    if (!response.ok) {
      throw new Error('Ошибка при удалении тура');
    }

    // Обновляем глобальный массив туров
    roundsOrder = [...tempRoundsOrder];
    await saveRoundsOrderToStorage();
    
    // Перезагружаем матчи
    await loadMatches();
    
    // Перерисовываем список туров в модалке
    renderRoundsOrderList();
  } catch (error) {
    console.error('Ошибка при удалении тура:', error);
    await showCustomAlert('Не удалось удалить тур', "Ошибка", "❌");
  }
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

  // Очищаем старые завершенные матчи из избранного
  cleanupOldFavorites();

  // Запускаем отслеживание позиции кубика
  startDicePositionTracking();

  // Загружаем конфиг сначала
  await loadConfig();

  // Загружаем сохраненный порядок туров из БД
  await loadRoundsOrder();

  // Проверяем, есть ли пользователь в localStorage
  const savedUser = localStorage.getItem("currentUser");
  // console.log("💾 savedUser из localStorage:", savedUser); // Отладочный лог (отключен)

  if (savedUser) {
    const user = JSON.parse(savedUser);
    currentUser = user;
    
    // Загружаем настройку show_lucky_button с сервера
    try {
      const response = await fetch(`/api/user/${user.id}/show-lucky-button`);
      if (response.ok) {
        const data = await response.json();
        currentUser.show_lucky_button = data.show_lucky_button !== undefined ? data.show_lucky_button : 1;
        localStorage.setItem("currentUser", JSON.stringify(currentUser));
      }
    } catch (err) {
      console.error("⚠️ Ошибка загрузки настройки show_lucky_button:", err);
      // По умолчанию показываем кнопку
      currentUser.show_lucky_button = 1;
    }
    
    // Загружаем настройку show_bets с сервера
    try {
      const response = await fetch(`/api/user/${user.id}/show-bets`);
      if (response.ok) {
        const data = await response.json();
        currentUser.show_bets = data.show_bets || "always";
        localStorage.setItem("currentUser", JSON.stringify(currentUser));
      }
    } catch (err) {
      console.error("⚠️ Ошибка загрузки настройки show_bets:", err);
      // По умолчанию всегда показываем
      currentUser.show_bets = "always";
    }
    
    // Обновляем видимость кнопки сразу после загрузки настройки
    updateLuckyButtonVisibility();

    // Проверяем валидность сессии
    const sessionToken = localStorage.getItem("sessionToken");
    if (sessionToken) {
      // Проверяем, существует ли сессия на сервере
      try {
        const validateResponse = await fetch(`/api/sessions/${sessionToken}/validate`);
        if (!validateResponse.ok) {
          // Сессия недействительна - разлогиниваем
          console.log("⚠️ Сессия недействительна при загрузке, выполняется выход");
          localStorage.removeItem("currentUser");
          localStorage.removeItem("sessionToken");
          location.reload();
          return;
        }
      } catch (err) {
        // При ошибке загрузки НЕ разлогиниваем, просто логируем
        console.warn("⚠️ Не удалось проверить сессию при загрузке (возможно временная проблема с БД):", err.message);
        // Продолжаем работу, периодическая проверка разберется позже
      }
    } else {
      // Если нет токена сессии, создаем новую
      const deviceData = getDeviceInfo();
      try {
        const sessionResponse = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: currentUser.id,
            device_info: deviceData.deviceInfo,
            browser: deviceData.browser,
            os: deviceData.os
          })
        });

        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json();
          localStorage.setItem("sessionToken", sessionData.session_token);
          console.log("✅ Сессия создана при загрузке:", sessionData.session_token);
        }
      } catch (err) {
        console.error("⚠️ Ошибка создания сессии при загрузке:", err);
      }
    }

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

    setAuthButtonToLogoutState();

    // Показываем админ-кнопки если это админ
    if (user.isAdmin) {
      document.getElementById("adminBtn").style.display = "inline-block";
      document.getElementById("countingBtn").style.display = "inline-block";
      document.getElementById("adminSettingsPanel").style.display = "block";
    }

    // Загружаем права модератора
    await loadModeratorPermissions();
    
    // Показываем кнопки модератора если есть права
    if (isModerator()) {
      // Кнопка создания турнира
      if (canCreateTournaments()) {
        document.getElementById("adminBtn").style.display = "inline-block";
      }
      
      // Кнопка подсчета результатов
      if (canViewCounting()) {
        document.getElementById("countingBtn").style.display = "inline-block";
      }
      
      // Панель модератора в настройках
      if (hasAdminPanelAccess()) {
        console.log("✅ Пользователь - модератор, показываем панель модератора");
        document.getElementById("moderatorSettingsPanel").style.display = "block";
        
        // Показываем кнопки в зависимости от прав
        if (canViewLogs()) {
          document.getElementById("modViewLogsBtn").style.display = "inline-block";
        }
        if (canAccessDatabasePanel()) {
          document.getElementById("modBackupDBBtn").style.display = "inline-block";
        }
        if (canManageOrphaned()) {
          document.getElementById("modOrphanedBtn").style.display = "inline-block";
        }
        if (canViewUsers()) {
          document.getElementById("modUsersBtn").style.display = "inline-block";
        }
      }
    }

    // Загружаем тему с сервера после установки currentUser
    await loadSavedTheme();

    loadEventsList();
    await loadMyBets();
    
    // Запускаем обновление индикатора LIVE
    updateLiveIndicator();
    
    // Запускаем polling избранных матчей (работает на всех вкладках и устройствах)
    startFavoriteMatchesPolling();
  } else {
    setAuthButtonToLoginState();
    loadEventsList();
    
    // Загружаем тему из localStorage для незалогиненных пользователей
    await loadSavedTheme();
    
    // Включаем гостевой режим для незалогиненных пользователей
    initGuestMode();
  }

  // Запускаем периодическую проверку сессии каждые 60 секунд (снижена частота)
  let sessionCheckFailures = 0; // Счетчик неудачных проверок
  sessionCheckInterval = setInterval(async () => {
    // Пропускаем проверку если идет переименование пользователя
    if (isRenamingUser) {
      console.log("⏸️ Проверка сессии пропущена (идет переименование)");
      return;
    }
    
    const token = localStorage.getItem("sessionToken");
    const user = localStorage.getItem("currentUser");
    if (token && user) {
      try {
        const validateResponse = await fetch(`/api/sessions/${token}/validate`);
        if (!validateResponse.ok) {
          sessionCheckFailures++;
          console.log(`⚠️ Проверка сессии не прошла (попытка ${sessionCheckFailures}/3)`);
          
          // Разлогиниваем только после 3 неудачных попыток подряд
          if (sessionCheckFailures >= 3) {
            console.log("❌ Сессия недействительна после 3 попыток, выполняется выход");
            localStorage.removeItem("currentUser");
            localStorage.removeItem("sessionToken");
            location.reload();
          }
        } else {
          // Сброс счетчика при успешной проверке
          sessionCheckFailures = 0;
        }
      } catch (err) {
        sessionCheckFailures++;
        console.error(`⚠️ Ошибка проверки сессии (попытка ${sessionCheckFailures}/3):`, err.message);
        
        // Разлогиниваем только после 3 неудачных попыток подряд
        if (sessionCheckFailures >= 3) {
          console.log("❌ Множественные ошибки проверки сессии, выполняется выход");
          localStorage.removeItem("currentUser");
          localStorage.removeItem("sessionToken");
          location.reload();
        }
      }
    }
  }, 60000); // Проверка каждые 60 секунд

  // Запускаем обновление статусов матчей каждые 30 секунд
  matchUpdateInterval = setInterval(() => {
    if (matches.length > 0 && isMatchUpdatingEnabled) {
      displayMatches();
    }
  }, 30000);

  // Обновляем настройки когда пользователь возвращается на вкладку
  // (полезно после привязки Telegram через бота)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentUser) {
      // Проверяем, открыты ли настройки
      const settingsContainer = document.getElementById("settingsContainer");
      if (settingsContainer && settingsContainer.offsetParent !== null) {
        console.log("👁️ Вкладка стала видимой, обновляем настройки");
        loadSettings();
      }
    }
  });
});

// ===== ПОЛЬЗОВАТЕЛЬ =====

// Получить информацию об устройстве
function getDeviceInfo() {
  const ua = navigator.userAgent;
  let deviceInfo = 'Desktop';
  let browser = 'Unknown';
  let os = 'Unknown';

  // Определяем устройство
  if (/mobile/i.test(ua)) {
    deviceInfo = 'Mobile';
  } else if (/tablet|ipad/i.test(ua)) {
    deviceInfo = 'Tablet';
  }

  // Определяем браузер
  if (ua.indexOf('Firefox') > -1) {
    browser = 'Firefox';
  } else if (ua.indexOf('Chrome') > -1) {
    browser = 'Chrome';
  } else if (ua.indexOf('Safari') > -1) {
    browser = 'Safari';
  } else if (ua.indexOf('Edge') > -1) {
    browser = 'Edge';
  } else if (ua.indexOf('Opera') > -1 || ua.indexOf('OPR') > -1) {
    browser = 'Opera';
  }

  // Определяем ОС
  if (ua.indexOf('Win') > -1) {
    os = 'Windows';
  } else if (ua.indexOf('Mac') > -1) {
    os = 'MacOS';
  } else if (ua.indexOf('Linux') > -1) {
    os = 'Linux';
  } else if (ua.indexOf('Android') > -1) {
    os = 'Android';
  } else if (ua.indexOf('iOS') > -1 || ua.indexOf('iPhone') > -1 || ua.indexOf('iPad') > -1) {
    os = 'iOS';
  }

  return { deviceInfo, browser, os };
}

// ===== ГОСТЕВОЙ РЕЖИМ И МОДАЛЬНОЕ ОКНО ВХОДА =====

// Открыть модальное окно входа
function openLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.classList.add('login-modal-open');
    
    // Фокус на поле ввода
    setTimeout(() => {
      const input = document.getElementById('usernameModal');
      if (input) input.focus();
    }, 100);
  }
}

// Закрыть модальное окно входа
function closeLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('login-modal-open');
  }
}

// Вход из модального окна
async function loginFromModal() {
  const username = document.getElementById('usernameModal')?.value.trim();
  
  if (!username) {
    await showCustomAlert("Пожалуйста, введите имя", "Ошибка", "⚠️");
    return;
  }
  
  // Копируем значение в основной input и вызываем initUser
  document.getElementById('username').value = username;
  
  // Закрываем модалку
  closeLoginModal();
  
  // Вызываем стандартную функцию входа
  await initUser();
}

// Инициализация гостевого режима
function initGuestMode() {
  console.log('🔓 Инициализация гостевого режима');
  
  // Добавляем класс гостевого режима
  const container = document.querySelector('.container');
  if (container) {
    container.classList.add('guest-mode');
  }
  
  // Показываем кнопку ВХОД вместо Настройки
  const settingsBtn = document.getElementById('settingsTabBtn');
  const loginBtn = document.getElementById('loginTabBtn');
  
  if (settingsBtn) settingsBtn.style.display = 'none';
  if (loginBtn) loginBtn.style.display = 'inline-block';
  
  // Скрываем кнопки Telegram (они есть только в модалке)
  hideTelegramAuthButtons();
  
  // Показываем контент (турниры и матчи)
  loadEventsList();
  
  // Блокируем взаимодействие со ставками
  blockBettingForGuests();
}

// Блокировка взаимодействия со ставками для гостей
function blockBettingForGuests() {
  // Добавляем обработчик на document для перехвата всех кликов
  document.addEventListener('click', (e) => {
    if (!document.querySelector('.container.guest-mode')) return;
    
    // Проверяем клик по вкладкам (кроме "Ставки")
    const tabBtn = e.target.closest('.tab-btn');
    if (tabBtn && !tabBtn.classList.contains('login-tab-btn')) {
      const tabs = Array.from(document.querySelectorAll('.tab-btn'));
      const index = tabs.indexOf(tabBtn);
      
      // Индексы: 0-LIVE, 1-Ставки, 2-Таблица, 3-Профиль, 4-Новости, 5-Настройки
      if (index !== 1) { // Не блокируем вкладку "Ставки"
        e.preventDefault();
        e.stopPropagation();
        openLoginModal();
        return;
      }
    }
    
    // Блокируем кнопку "Мне повезет"
    if (e.target.closest('.lucky-btn')) {
      e.preventDefault();
      e.stopPropagation();
      openLoginModal();
      return;
    }
    
    // Блокируем клики по карточкам матчей для ставок
    const matchCard = e.target.closest('.match-card');
    if (matchCard) {
      const betButton = e.target.closest('.bet-btn, .score-prediction-btn, .cards-prediction-btn');
      if (betButton) {
        e.preventDefault();
        e.stopPropagation();
        openLoginModal();
        return;
      }
    }
  }, true); // Используем capture phase для перехвата до других обработчиков
}

// Выход из гостевого режима (после успешного входа)
function exitGuestMode() {
  console.log('🔐 Выход из гостевого режима');
  
  // Убираем класс гостевого режима
  const container = document.querySelector('.container');
  if (container) {
    container.classList.remove('guest-mode');
  }
  
  // Скрываем кнопку ВХОД и показываем Настройки
  const settingsBtn = document.getElementById('settingsTabBtn');
  const loginBtn = document.getElementById('loginTabBtn');
  
  if (settingsBtn) settingsBtn.style.display = 'inline-block';
  if (loginBtn) loginBtn.style.display = 'none';
}

async function initUser() {
  // Получаем значение из обоих инпутов
  let username = document.getElementById("username").value.trim();
  const usernameMobile = document.getElementById("username-mobile")?.value.trim();
  
  // Используем значение из мобильного инпута если основной пустой
  if (!username && usernameMobile) {
    username = usernameMobile;
  }

  if (!username) {
    await showCustomAlert("Пожалуйста, введите имя", "Ошибка", "⚠️");
    return;
  }

  // Преобразуем первую букву каждого слова в заглавную
  username = username
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  // Проверяем, пытается ли кто-то логиниться под ADMIN_DB_NAME
  if (username === ADMIN_DB_NAME) {
    // Отправляем уведомление админу в Telegram
    fetch("/api/notify-admin-login-attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptedUsername: username }),
    }).catch((err) => console.error("Ошибка отправки уведомления:", err));

    await showCustomAlert("Ну, ты давай не охуевай совсем, малютка", "Доступ запрещен", "🚫");
    document.getElementById("username").value = "";
    if (document.getElementById("username-mobile")) {
      document.getElementById("username-mobile").value = "";
    }
    return;
  }

  // Если админ логинится под ADMIN_LOGIN, то отправляем ADMIN_DB_NAME на сервер
  let usernameToSend = username === ADMIN_LOGIN ? ADMIN_DB_NAME : username;
  let isAdminUser = username === ADMIN_LOGIN;

  // Обновляем оба input с правильным логином
  document.getElementById("username").value = usernameToSend;
  if (document.getElementById("username-mobile")) {
    document.getElementById("username-mobile").value = usernameToSend;
  }

  // Получаем информацию об устройстве
  const deviceData = getDeviceInfo();

  try {
    const response = await fetch("/api/user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        username: usernameToSend,
        device_info: deviceData.deviceInfo,
        browser: deviceData.browser,
        os: deviceData.os
      }),
    });

    const result = await response.json();

    // Проверяем, требуется ли подтверждение через Telegram
    if (result.requiresConfirmation) {
      // Запрашиваем код подтверждения
      const shouldContinue = await showCustomConfirm(
        'Для входа требуется подтверждение через Telegram. Вам будет отправлен код подтверждения.',
        'Подтверждение входа',
        '🔐'
      );
      
      if (!shouldContinue) {
        return;
      }

      try {
        const requestResponse = await fetch("/api/user/login/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: result.userId })
        });

        const requestResult = await requestResponse.json();

        if (requestResponse.ok) {
          // Показываем поле для ввода кода
          const code = await showCustomPrompt(
            'Код подтверждения отправлен вам в Telegram. Введите его ниже:',
            'Введите код',
            '🔐',
            '123456'
          );
          
          if (!code) return;

          // Подтверждаем вход
          const confirmResponse = await fetch("/api/user/login/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              userId: result.userId,
              confirmation_code: code 
            })
          });

          const confirmResult = await confirmResponse.json();

          if (!confirmResponse.ok) {
            await showCustomAlert(confirmResult.error, 'Ошибка', '❌');
            return;
          }

          // Код верный, продолжаем логин
          currentUser = confirmResult;
          currentUser.isAdmin = isAdminUser;
          
          // Загружаем права модератора
          await loadModeratorPermissions();
        } else {
          await showCustomAlert(requestResult.error, 'Ошибка', '❌');
          return;
        }
      } catch (error) {
        console.error("Ошибка при подтверждении входа:", error);
        await showCustomAlert("Ошибка при подтверждении входа", 'Ошибка', '❌');
        return;
      }
    } else {
      // 2FA не требуется
      currentUser = result;
      currentUser.isAdmin = isAdminUser;
      
      // Загружаем права модератора
      await loadModeratorPermissions();
    }

    // Создаем сессию на сервере (используем deviceData, объявленную выше)
    try {
      const sessionResponse = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: currentUser.id,
          device_info: deviceData.deviceInfo,
          browser: deviceData.browser,
          os: deviceData.os
        })
      });

      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        // Сохраняем session_token в localStorage
        localStorage.setItem("sessionToken", sessionData.session_token);
        console.log("✅ Сессия создана:", sessionData.session_token);
      }
    } catch (err) {
      console.error("⚠️ Ошибка создания сессии:", err);
    }

    // Сохраняем пользователя в localStorage
    localStorage.setItem("currentUser", JSON.stringify(currentUser));

    // Загружаем тему с сервера после логина
    await loadSavedTheme();

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
    document.getElementById("usernameBold").textContent = currentUser.username;
    document.getElementById("username").disabled = true;

    setAuthButtonToLogoutState();

    // Показываем админ-кнопки если это админ
    if (currentUser.isAdmin) {
      document.getElementById("adminBtn").style.display = "inline-block";
      document.getElementById("countingBtn").style.display = "inline-block";
      document.getElementById("adminSettingsPanel").style.display = "block";
    } else if (isModerator()) {
      // Показываем кнопки модератора если есть права
      if (canCreateTournaments()) {
        document.getElementById("adminBtn").style.display = "inline-block";
      }
      if (canViewCounting()) {
        document.getElementById("countingBtn").style.display = "inline-block";
      }
    }

    // Загружаем турниры, матчи и ставки пользователя
    loadEventsList();
    loadMyBets();
    
    // Выходим из гостевого режима если он был активен
    exitGuestMode();
    
    // Запускаем обновление индикатора LIVE
    updateLiveIndicator();
    // pollFavoriteMatches запускается автоматически при открытии вкладки LIVE
  } catch (error) {
    console.error("Ошибка при входе:", error);
    alert("Ошибка при входе: " + (error.message || error));
  }
}

// Функция выхода из аккаунта
async function logoutUser() {
  // НЕ удаляем сессию на сервере, чтобы сохранить статус доверенного устройства
  // Просто удаляем токен из localStorage
  const sessionToken = localStorage.getItem("sessionToken");
  if (sessionToken && currentUser) {
    console.log("✅ Разлогин (сессия сохранена на сервере для доверенных устройств)");
  }

  // Останавливаем polling избранных матчей
  stopFavoriteMatchesPolling();

  // Удаляем пользователя из localStorage
  localStorage.removeItem("currentUser");
  localStorage.removeItem("sessionToken");

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
  setAuthButtonToLoginState();

  // Переключаемся на вкладку "Все ставки"
  switchTab("allbets");

  // Очищаем ставки
  document.getElementById("myBetsList").innerHTML =
    '<div class="empty-message">У вас пока нет ставок</div>';
  
  // Включаем гостевой режим
  initGuestMode();
}

// Функция авторизации через Telegram
async function loginWithTelegram() {
  try {
    // Генерируем уникальный токен для авторизации
    const authToken = `auth_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    // Сохраняем токен в localStorage для проверки после возврата
    localStorage.setItem('telegram_auth_token', authToken);
    
    // Получаем информацию об устройстве
    const deviceData = getDeviceInfo();
    localStorage.setItem('telegram_auth_device', JSON.stringify(deviceData));
    
    // Отправляем запрос на сервер для создания токена авторизации
    const response = await fetch("/api/telegram-auth/create-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_token: authToken,
        device_info: deviceData.deviceInfo,
        browser: deviceData.browser,
        os: deviceData.os
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      await showCustomAlert(result.error || 'Ошибка создания токена', 'Ошибка', '❌');
      return;
    }

    // Открываем бота с командой авторизации
    const botUsername = result.botUsername || 'YourBotUsername'; // Замените на имя вашего бота
    const telegramUrl = `https://t.me/${botUsername}?start=auth_${authToken}`;
    window.open(telegramUrl, '_blank');

    // Запускаем проверку статуса авторизации
    checkTelegramAuthStatus(authToken);
  } catch (error) {
    console.error("Ошибка при авторизации через Telegram:", error);
    await showCustomAlert("Ошибка при авторизации через Telegram", 'Ошибка', '❌');
  }
}

// Проверка статуса авторизации через Telegram
let authCheckInterval = null;
async function checkTelegramAuthStatus(authToken) {
  let attempts = 0;
  const maxAttempts = 60; // 60 попыток по 2 секунды = 2 минуты

  authCheckInterval = setInterval(async () => {
    attempts++;

    if (attempts > maxAttempts) {
      clearInterval(authCheckInterval);
      await showCustomAlert(
        'Время ожидания авторизации истекло. Попробуйте снова.',
        'Таймаут',
        '⏱️'
      );
      localStorage.removeItem('telegram_auth_token');
      localStorage.removeItem('telegram_auth_device');
      return;
    }

    try {
      const response = await fetch(`/api/telegram-auth/check-status?auth_token=${authToken}`);
      const result = await response.json();

      if (result.status === 'completed' && result.user) {
        clearInterval(authCheckInterval);
        
        currentUser = result.user;
        currentUser.isAdmin = currentUser.username === ADMIN_DB_NAME;

        // Загружаем права модератора
        await loadModeratorPermissions();

        // Получаем сохраненные данные устройства
        const deviceDataStr = localStorage.getItem('telegram_auth_device');
        const deviceData = deviceDataStr ? JSON.parse(deviceDataStr) : getDeviceInfo();

        // Создаем сессию на сервере
        try {
          const sessionResponse = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: currentUser.id,
              device_info: deviceData.deviceInfo,
              browser: deviceData.browser,
              os: deviceData.os
            })
          });

          if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json();
            localStorage.setItem("sessionToken", sessionData.session_token);
            console.log("✅ Сессия создана:", sessionData.session_token);
          }
        } catch (err) {
          console.error("⚠️ Ошибка создания сессии:", err);
        }

        // Сохраняем пользователя в localStorage
        localStorage.setItem("currentUser", JSON.stringify(currentUser));

        // Загружаем тему с сервера после логина
        await loadSavedTheme();

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
        document.getElementById("usernameBold").textContent = currentUser.username;
        document.getElementById("username").disabled = true;

        setAuthButtonToLogoutState();

        // Показываем админ-кнопки если это админ
        if (currentUser.isAdmin) {
          document.getElementById("adminBtn").style.display = "inline-block";
          document.getElementById("countingBtn").style.display = "inline-block";
          document.getElementById("adminSettingsPanel").style.display = "block";
        } else if (isModerator()) {
          if (canCreateTournaments()) {
            document.getElementById("adminBtn").style.display = "inline-block";
          }
          if (canViewCounting()) {
            document.getElementById("countingBtn").style.display = "inline-block";
          }
        }

        // Если это новый пользователь - показываем приветственное сообщение
        if (result.isNewUser) {
          await showCustomAlert(
            `Твое имя на сайте: ${currentUser.username}\n\nИмя можно изменить в профиле, наведя или нажав на текущее имя.`,
            'Добро пожаловать! 🎉',
            '👋'
          );
        }

        // Загружаем турниры, матчи и ставки пользователя
        loadEventsList();
        loadMyBets();
        
        // Выходим из гостевого режима
        exitGuestMode();
        
        // Закрываем модалку входа если она открыта
        closeLoginModal();
        
        // Запускаем обновление индикатора LIVE
        updateLiveIndicator();

        // Очищаем временные данные
        localStorage.removeItem('telegram_auth_token');
        localStorage.removeItem('telegram_auth_device');
      }
    } catch (error) {
      console.error("Ошибка проверки статуса авторизации:", error);
    }
  }, 2000); // Проверяем каждые 2 секунды
}

// ===== ТУРНИРЫ =====

async function loadEventsList() {
  try {
    const response = await fetch("/api/events");
    events = await response.json();
    displayEvents();

    // При первой загрузке выбираем турнир (только на десктопе)
    if (!currentEventId && events.length > 0 && window.innerWidth > 768) {
      // Пытаемся восстановить последний выбранный турнир из localStorage
      const savedEventId = localStorage.getItem('selectedEventId');
      const savedEvent = savedEventId ? events.find(e => e.id === parseInt(savedEventId)) : null;
      
      // Если сохраненный турнир существует, выбираем его
      if (savedEvent) {
        selectEvent(savedEvent.id);
      } else {
        // Иначе выбираем первый активный турнир, или первый предстоящий, или первый доступный
        const now = new Date();
        const firstActiveEvent = events.find(
          (e) => !e.locked_reason && e.start_date && new Date(e.start_date) <= now
        );
        const firstUpcomingEvent = events.find(
          (e) =>
            !e.locked_reason && (!e.start_date || new Date(e.start_date) > now)
        );
        const eventToSelect =
          firstActiveEvent ||
          firstUpcomingEvent ||
          events.find((e) => !e.locked_reason) ||
          events[0];
        if (eventToSelect) {
          selectEvent(eventToSelect.id);
        }
      }
    }
    
    // Обновляем видимость кнопки "Мне повезет" после загрузки турниров
    updateLuckyButtonVisibility();
  } catch (error) {
    console.error("Ошибка при загрузке событий:", error);
    document.getElementById("eventsList").innerHTML =
      '<div class="empty-message">Ошибка при загрузке событий</div>';
  }
}

function generateEventHTML(
  event,
  positionNumber,
  isCompleted = false,
  isActive = false
) {
  // Если турнир завершен, показываем индикатор
  const lockedBadge = isCompleted
    ? `<div style="display: flex; align-items: center; justify-content: center; gap: 5px; margin-top: 8px; padding: 5px 8px; background: rgba(244, 67, 54, 0.2); border-radius: 3px; font-size: 0.85em;">
          <span style="color: #f44336; font-weight: bold; font-size: 0.8em;">🔒</span>
          <span style="color: #b0b8c8; font-size: 0.85em;">${event.locked_reason}</span>
        </div>`
    : "";

  return `
    <div style="display: flex; align-items: flex-start; gap: 10px;">
      <div style="font-size: 1em; font-weight: bold; color: #5a9fd4; min-width: 30px; text-align: center; padding-top: 5px;">#${positionNumber}</div>
      <div class="event-item ${isCompleted ? "locked" : ""} ${
    isActive ? "active-tournament" : ""
  } ${event.id === currentEventId ? "active" : ""}" data-event-id="${
    event.id
  }" style="flex: 1;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; position: relative;">
          <div onclick="selectEvent(${event.id}, '${
    event.name
  }')" style="flex: 1; cursor: ${isCompleted ? "not-allowed" : "pointer"};">
            <strong>${
              event.icon
                ? event.icon.startsWith("img/") || event.icon.startsWith("http")
                  ? `<img class="event-icon" src="${
                      event.icon
                    }" alt="иконка" title="${getIconTitle(
                      event.icon
                    )}" style="width: 35px; height: 35px; vertical-align: middle; margin-right: 8px; background: ${
                      event.background_color === "transparent" ||
                      !event.background_color
                        ? "rgba(224, 230, 240, .4)"
                        : event.background_color
                    }; padding: 2px; border-radius: 3px;">`
                  : `<span style="display: inline-block; margin-right: 8px; background: ${
                      event.background_color === "transparent" ||
                      !event.background_color
                        ? "rgba(224, 230, 240, .4)"
                        : event.background_color
                    }; padding: 2px; width: 35px; height: 35px; vertical-align: middle; text-align: center; line-height: 1.8; border-radius: 3px;" title="${getIconTitle(
                      event.icon
                    )}">${event.icon}</span>`
                : ""
            }${event.name}</strong>
            <p style="font-size: 0.9em; opacity: 0.7; margin-top: 5px;">${
              event.description || "Нет описания"
            }</p>
            ${
              event.start_date || event.end_date
                ? `<p style="font-size: 0.85em; opacity: 0.6; margin-top: 3px;">
                ${
                  event.start_date
                    ? `📅 с ${new Date(event.start_date).toLocaleDateString(
                        "ru-RU"
                      )}`
                    : ""
                }
                ${
                  event.end_date
                    ? ` по ${new Date(event.end_date).toLocaleDateString(
                        "ru-RU"
                      )}`
                    : ""
                }
              </p>`
                : ""
            }
            ${lockedBadge}
          </div>
          ${
            event.id === currentEventId
              ? '<div style="color: #4caf50; font-weight: bold; position: absolute; right: 0px; bottom: 0px;">●</div>'
              : ""
          }
        </div>
        ${
          canManageTournaments()
            ? `<div class="event-admin-actions">
          <div class="event-admin-controls" data-event-id="${event.id}">
            ${canEditTournaments() ? `<button onclick="openEditEventModal(${
              event.id
            })" style="background: transparent; padding: 5px; font-size: 0.7em; border: 1px solid #3a7bd5; color: #7ab0e0; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(33, 150, 243, 0.5)'" onmouseout="this.style.background='transparent'">✏️</button>` : ''}
            ${
              isCompleted
                ? `<button onclick="unlockEvent(${event.id})" style="background: rgba(76, 175, 80, 0.3); padding: 5px; font-size: 0.8em; border: 1px solid #4caf50; color: #7ed321; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(76, 175, 80, 0.5)'" onmouseout="this.style.background='rgba(76, 175, 80, 0.3)'">🔓</button>`
                : `<button onclick="openLockEventModal(${event.id}, '${event.name.replace(/'/g, "\\'")}')  style="background: transparent; padding: 5px; font-size: 0.7em; border: 1px solid #f57c00; color: #ffe0b2; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(255, 152, 0, 0.5)'" onmouseout="this.style.background='transparent'">🔒</button>`
            }
            ${canDeleteTournaments() ? `<button class="event-delete-btn" onclick="deleteEvent(${
              event.id
            })" style="background: transparent; padding: 5px; font-size: 0.7em; border: 1px solid #f44336; color: #ffb3b3; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(244, 67, 54, 0.5)'" onmouseout="this.style.background='transparent'">✕</button>` : ''}
          </div>
          <button class="event-admin-toggle" data-event-id="${
            event.id
          }" type="button" aria-expanded="false" title="Дополнительные действия">&lt;</button>
        </div>`
            : ""
        }
      </div>
    </div>`;
}

function displayEvents() {
  const eventsList = document.getElementById("eventsList");

  if (events.length === 0) {
    eventsList.innerHTML =
      '<div class="empty-message">Событий не найдено</div>';
    return;
  }

  // Получаем текущую дату для сравнения
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

  const completedEvents = events.filter((event) => event.locked_reason);

  let html = "";
  let activeIndex = 1;
  let upcomingIndex = 1;
  let completedIndex = 1;

  // Активные турниры
  if (activeEvents.length > 0) {
    html +=
      '<div style="text-align: center; color: #b0b8c8; font-size: 0.7em;margin: 15px 0;">━━━ АКТИВНЫЕ ТУРНИРЫ ━━━</div>';
    html += activeEvents
      .map((event) => {
        const positionNumber = activeIndex++;
        return generateEventHTML(event, positionNumber, false, true);
      })
      .join("");
  }

  // Предстоящие турниры
  if (upcomingEvents.length > 0) {
    html +=
      '<div style="text-align: center; color: #b0b8c8; font-size: 0.7em;margin: 15px 0;">━━━ ПРЕДСТОЯЩИЕ ТУРНИРЫ ━━━</div>';
    html += upcomingEvents
      .map((event) => {
        const positionNumber = upcomingIndex++;
        return generateEventHTML(event, positionNumber);
      })
      .join("");
  }

  // Завершенные турниры
  if (completedEvents.length > 0) {
    html +=
      '<div style="text-align: center; color: #b0b8c8; font-size: 0.7em;margin: 15px 0;">━━━ ЗАВЕРШЕННЫЕ ТУРНИРЫ ━━━</div>';
    html += completedEvents
      .map((event) => {
        const positionNumber = completedIndex++;
        return generateEventHTML(event, positionNumber, true);
      })
      .join("");
  }

  eventsList.innerHTML = html;
  initEventAdminToggles();
  initEventItemClickHandlers();
  restoreMobileActiveEvent();
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

  // Очищаем кнопки сетки сразу при переключении турнира
  const matchesBracketButtons = document.getElementById('matchesBracketButtons');
  if (matchesBracketButtons) {
    matchesBracketButtons.innerHTML = '';
  }

  // Обновляем видимость кнопки "Мне повезет"
  updateLuckyButtonVisibility();

  // Скрываем/показываем кнопку напоминаний в зависимости от статуса турнира
  const matchRemindersBtn = document.getElementById('matchRemindersBtn');
  if (matchRemindersBtn) {
    // Показываем только для активных турниров (не завершенных и не предстоящих)
    const isLocked = event && event.locked_reason;
    const isUpcoming = event && event.start_date && new Date(event.start_date) > new Date();
    
    if (isLocked || isUpcoming) {
      matchRemindersBtn.style.display = 'none';
      updateReminderIndicator(false);
    } else {
      // Проверяем настройку "Напоминания о матчах"
      checkMatchRemindersSettingAndUpdateButton();
    }
  }

  // Скрываем контейнер админских кнопок при переключении турнира
  const adminButtonsContainer = document.getElementById('adminButtonsContainer');
  if (adminButtonsContainer) {
    adminButtonsContainer.style.display = 'none';
  }

  // Показываем кнопку настроек админа если есть права
  const adminSettingsBtn = document.getElementById('adminSettingsBtn');
  if (adminSettingsBtn && (canCreateMatches() || canManageTournaments() || (currentUser && currentUser.isAdmin))) {
    adminSettingsBtn.style.display = 'inline-block';
    
    // Заполняем контейнер админских кнопок
    if (adminButtonsContainer) {
      let buttonsHTML = '';
      
      if (canCreateMatches()) {
        buttonsHTML += `
          <button id="addMatchBtn" onclick="openCreateMatchModal(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #3a7bd5; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Добавить матч">
            ➕
          </button>
        `;
      }
      
      if (currentUser && currentUser.isAdmin) {
        buttonsHTML += `
          <button id="addBracketBtn" onclick="openCreateBracketModal(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #3a7bd5; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Создать сетку плей-офф">
            🏆
          </button>
          <button id="autoCountingBtn" onclick="toggleAutoCounting(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #4caf50; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Автоподсчет">
            A
          </button>
          <button id="testsBtn" onclick="openTestsModal(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #ff9800; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Тесты">
            🧪
          </button>
        `;
      }
      
      if (canManageTournaments()) {
        buttonsHTML += `
          <button id="editRoundsBtn" onclick="openRoundsOrderModal(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #3a7bd5; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Изменить порядок туров">
            ✎
          </button>
        `;
      }
      
      if (canCreateMatches()) {
        buttonsHTML += `
          <button id="importMatchesBtn" onclick="openImportMatchesModal(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #4caf50; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Импортировать матчи">
            📥
          </button>
          <button id="bulkEditDatesBtn" onclick="openBulkEditDatesModal(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #4caf50; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Массовое редактирование дат">
            📅
          </button>
        `;
      }
      
      adminButtonsContainer.innerHTML = buttonsHTML;
      
      // Загружаем статус автоподсчета для обновления кнопки
      if (currentUser && currentUser.isAdmin) {
        loadAutoCountingStatus();
      }
    }
  } else if (adminSettingsBtn) {
    adminSettingsBtn.style.display = 'none';
  }

  loadMatches(eventId);
}

// Переключение видимости админских кнопок
function toggleAdminButtons(event) {
  event.stopPropagation(); // Предотвращаем всплытие события
  
  const container = document.getElementById('adminButtonsContainer');
  const btn = document.getElementById('adminSettingsBtn');
  
  if (container && btn) {
    if (container.style.display === 'none' || !container.style.display) {
      container.style.display = 'flex';
      
      // Функция для обновления позиции
      const updatePosition = () => {
        const rect = btn.getBoundingClientRect();
        const containerHeight = container.offsetHeight;
        
        // Позиционируем контейнер над кнопкой с отступом
        container.style.top = (rect.top - containerHeight - 8) + 'px';
        container.style.left = rect.left + 'px';
        
        // Корректируем позицию если контейнер выходит за пределы экрана
        const containerRect = container.getBoundingClientRect();
        if (containerRect.top < 0) {
          // Если не помещается сверху, показываем снизу
          container.style.top = (rect.bottom + 8) + 'px';
        }
      };
      
      // Обновляем позицию сразу
      updatePosition();
      
      // Добавляем анимацию появления
      setTimeout(() => {
        container.style.opacity = '1';
        container.style.transform = 'translateY(0)';
      }, 10);
      
      // Сохраняем функцию обновления для использования при скролле
      container._updatePosition = updatePosition;
      
      // Добавляем обработчик скролла
      const scrollHandler = () => {
        if (container.style.display === 'flex') {
          updatePosition();
        }
      };
      container._scrollHandler = scrollHandler;
      
      // Находим scrollable контейнер (matchesSection)
      const matchesSection = document.getElementById('matchesSection');
      if (matchesSection) {
        matchesSection.addEventListener('scroll', scrollHandler);
      }
      window.addEventListener('scroll', scrollHandler);
      
      // Добавляем обработчик клика по документу для закрытия меню
      const clickHandler = (e) => {
        // Проверяем, что клик был не по кнопке и не по контейнеру
        if (!btn.contains(e.target) && !container.contains(e.target)) {
          closeAdminButtons();
        }
      };
      container._clickHandler = clickHandler;
      setTimeout(() => {
        document.addEventListener('click', clickHandler);
      }, 0);
      
    } else {
      closeAdminButtons();
    }
  }
}

// Закрытие админских кнопок
function closeAdminButtons() {
  const container = document.getElementById('adminButtonsContainer');
  if (container) {
    // Анимация закрытия
    container.style.opacity = '0';
    container.style.transform = 'translateY(-10px)';
    
    setTimeout(() => {
      container.style.display = 'none';
      
      // Удаляем обработчики
      if (container._scrollHandler) {
        const matchesSection = document.getElementById('matchesSection');
        if (matchesSection) {
          matchesSection.removeEventListener('scroll', container._scrollHandler);
        }
        window.removeEventListener('scroll', container._scrollHandler);
        delete container._scrollHandler;
        delete container._updatePosition;
      }
      
      if (container._clickHandler) {
        document.removeEventListener('click', container._clickHandler);
        delete container._clickHandler;
      }
    }, 200); // Ждем завершения анимации
  }
}

// ===== МАТЧИ =====

// Определяем статус матча на основе даты
function getMatchStatusByDate(match) {
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

async function loadMatches(eventId) {
  try {
    // На мобильных переключаемся на секцию матчей
    if (window.innerWidth <= 768) {
      showMobileSection('matches');
    }

    // Сохраняем выбранный турнир в localStorage
    localStorage.setItem('selectedEventId', eventId);
    
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
    const username = currentUser?.username;
    const url = username 
      ? `/api/events/${eventId}/matches?username=${encodeURIComponent(username)}`
      : `/api/events/${eventId}/matches`;
    const response = await fetch(url);
    matches = await response.json();
    currentRoundFilter = "all"; // Сбрасываем фильтр при загрузке нового турнира
    displayMatches();
    
    // Обновляем видимость кнопки "Мне повезет"
    updateLuckyButtonVisibility();
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

function initMatchResultToggles() {
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

function initAdminActionToggles() {
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

function initEventAdminToggles() {
  const toggles = document.querySelectorAll(".event-admin-toggle");

  toggles.forEach((toggle) => {
    const eventId = toggle.dataset.eventId;
    const panel = document.querySelector(
      `.event-admin-controls[data-event-id="${eventId}"]`
    );
    if (!panel) return;

    toggle.addEventListener("click", () => {
      const isVisible = panel.classList.toggle("visible");
      toggle.setAttribute("aria-expanded", isVisible ? "true" : "false");
      toggle.textContent = isVisible ? "×" : "<";
    });
  });
}

const EVENT_ADMIN_MOBILE_BREAKPOINT = 768;
let eventItemClickHandlersInit = false;
let mobileActiveEventId = null;

function restoreMobileActiveEvent() {
  const eventsList = document.getElementById("eventsList");
  if (!eventsList || !mobileActiveEventId) {
    return;
  }

  eventsList
    .querySelectorAll(".event-item.hovered")
    .forEach((item) => item.classList.remove("hovered"));

  const target = eventsList.querySelector(
    `.event-item[data-event-id="${mobileActiveEventId}"]`
  );

  if (target) {
    target.classList.add("hovered");
  }
}

function initEventItemClickHandlers() {
  if (eventItemClickHandlersInit) {
    return;
  }

  const eventsList = document.getElementById("eventsList");
  if (!eventsList) {
    return;
  }

  const mobileQuery = window.matchMedia(
    `(max-width: ${EVENT_ADMIN_MOBILE_BREAKPOINT}px)`
  );

  const clearHovered = () => {
    mobileActiveEventId = null;
    eventsList
      .querySelectorAll(".event-item.hovered")
      .forEach((item) => item.classList.remove("hovered"));
  };

  const handleItemClick = (event) => {
    if (!mobileQuery.matches) {
      return;
    }

    const item = event.target.closest(".event-item");
    if (!item || event.target.closest(".event-admin-actions")) {
      return;
    }

    const eventId = item.dataset.eventId;
    if (!eventId) {
      return;
    }

    const isActive = mobileActiveEventId === eventId;
    mobileActiveEventId = isActive ? null : eventId;
    restoreMobileActiveEvent();
  };

  eventsList.addEventListener("click", handleItemClick);

  document.addEventListener("click", (event) => {
    if (!mobileQuery.matches) {
      return;
    }

    if (event.target.closest(".event-item")) {
      return;
    }

    clearHovered();
  });

  const handleMediaChange = (event) => {
    if (!event.matches) {
      clearHovered();
    }
  };

  if (typeof mobileQuery.addEventListener === "function") {
    mobileQuery.addEventListener("change", handleMediaChange);
  } else if (typeof mobileQuery.addListener === "function") {
    mobileQuery.addListener(handleMediaChange);
  }

  eventItemClickHandlersInit = true;
}

function initMatchRowClickHandlers() {
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
async function displayTournamentWinner(eventId) {
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

async function displayMatches() {
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

    // Если уже есть обычная ставка на этот матч - удаляем её и прогноз на счет
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
      
      // Удаляем прогноз на счет
      try {
        await fetch(`/api/score-predictions/${matchId}`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: currentUser.id,
          }),
        });
      } catch (error) {
        console.log("Прогноз на счет не найден или уже удален");
      }
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
      // Обновляем список ставок (это перерисует DOM)
      await loadMyBets();
      
      // Загружаем статистику с анимацией
      // НЕ очищаем кэш, чтобы сохранить старые значения для анимации
      await loadAndDisplayBetStats(matchId, true);
      
      // Если ставка на ничью, синхронизируем инпуты счета
      if (prediction === 'draw') {
        setTimeout(() => {
          const scoreTeam1Input = document.getElementById(`scoreTeam1_${matchId}`);
          const scoreTeam2Input = document.getElementById(`scoreTeam2_${matchId}`);
          
          if (scoreTeam1Input && scoreTeam2Input) {
            const maxValue = Math.max(
              parseInt(scoreTeam1Input.value) || 0,
              parseInt(scoreTeam2Input.value) || 0
            );
            scoreTeam1Input.value = maxValue || '';
            scoreTeam2Input.value = maxValue || '';
          }
        }, 100);
      }
    } else {
      alert("Ошибка при создании ставки");
    }
  } catch (error) {
    console.error("Ошибка при размещении ставки:", error);
    alert("Ошибка при размещении ставки");
  }
}

// ===== ПРОГНОЗ НА СЧЕТ =====
function showScoreAlert(message) {
  // Создаем overlay
  const overlay = document.createElement('div');
  overlay.className = 'score-alert-overlay';
  
  // Создаем алерт
  const alert = document.createElement('div');
  alert.className = 'score-alert';
  alert.innerHTML = `
    <div class="score-alert-content">
      <div class="score-alert-icon">⚠️</div>
      <div class="score-alert-message">${message}</div>
      <button class="score-alert-button" onclick="closeScoreAlert()">Понятно</button>
    </div>
  `;
  
  document.body.appendChild(overlay);
  document.body.appendChild(alert);
  
  // Закрытие по клику на overlay
  overlay.onclick = closeScoreAlert;
}

function closeScoreAlert() {
  const overlay = document.querySelector('.score-alert-overlay');
  const alert = document.querySelector('.score-alert');
  if (overlay) overlay.remove();
  if (alert) alert.remove();
}

function syncScoreInputs(matchId, prediction) {
  const scoreTeam1Input = document.getElementById(`scoreTeam1_${matchId}`);
  const scoreTeam2Input = document.getElementById(`scoreTeam2_${matchId}`);
  
  if (!scoreTeam1Input || !scoreTeam2Input) return;
  
  // Если ставка на ничью, синхронизируем инпуты
  if (prediction === 'draw') {
    // Определяем какой инпут изменился (тот который в фокусе или последний измененный)
    const activeElement = document.activeElement;
    
    if (activeElement === scoreTeam1Input) {
      scoreTeam2Input.value = scoreTeam1Input.value;
    } else if (activeElement === scoreTeam2Input) {
      scoreTeam1Input.value = scoreTeam2Input.value;
    } else {
      // Если ни один не в фокусе, синхронизируем по первому инпуту
      scoreTeam2Input.value = scoreTeam1Input.value;
    }
  }
}

async function placeScorePrediction(matchId, prediction) {
  if (!currentUser) {
    alert("Сначала введите ваше имя");
    return;
  }

  const scoreTeam1Input = document.getElementById(`scoreTeam1_${matchId}`);
  const scoreTeam2Input = document.getElementById(`scoreTeam2_${matchId}`);
  const yellowCardsInput = document.getElementById(`yellowCards_${matchId}`);
  const redCardsInput = document.getElementById(`redCards_${matchId}`);
  
  // Если поле пустое, считаем как 0
  const scoreTeam1 = scoreTeam1Input ? (scoreTeam1Input.value === '' ? 0 : parseInt(scoreTeam1Input.value)) : null;
  const scoreTeam2 = scoreTeam2Input ? (scoreTeam2Input.value === '' ? 0 : parseInt(scoreTeam2Input.value)) : null;
  
  // Для карточек: если поле существует и пустое, считаем как 0 (это валидный прогноз!)
  const yellowCards = yellowCardsInput ? (yellowCardsInput.value === '' ? 0 : parseInt(yellowCardsInput.value)) : null;
  const redCards = redCardsInput ? (redCardsInput.value === '' ? 0 : parseInt(redCardsInput.value)) : null;

  // Валидация счета если есть поля
  if (scoreTeam1 !== null && scoreTeam2 !== null) {
    if (isNaN(scoreTeam1) || isNaN(scoreTeam2) || scoreTeam1 < 0 || scoreTeam2 < 0) {
      alert("Введите корректный счет (0 или больше)");
      return;
    }

    // Валидация: прогноз на счет должен соответствовать ставке
    if (prediction === 'team1' && scoreTeam1 <= scoreTeam2) {
      showScoreAlert("Вы поставили на победу первой команды, но счет не соответствует вашей ставке");
      return;
    }
    
    if (prediction === 'team2' && scoreTeam2 <= scoreTeam1) {
      showScoreAlert("Вы поставили на победу второй команды, но счет не соответствует вашей ставке");
      return;
    }
    
    if (prediction === 'draw' && scoreTeam1 !== scoreTeam2) {
      showScoreAlert("Вы поставили на ничью, но счет не соответствует вашей ставке");
      return;
    }
  }

  // Валидация карточек если есть поля
  if (yellowCards !== null && (isNaN(yellowCards) || yellowCards < 0 || yellowCards > 20)) {
    alert("Введите корректное количество желтых карточек (0-20)");
    return;
  }
  
  if (redCards !== null && (isNaN(redCards) || redCards < 0 || redCards > 10)) {
    alert("Введите корректное количество красных карточек (0-10)");
    return;
  }

  // Проверяем статус матча
  const match = matches.find((m) => m.id === matchId);
  if (match) {
    const effectiveStatus = getMatchStatusByDate(match);
    if (effectiveStatus !== "pending") {
      alert("Матч уже начался, прогноз недоступен");
      return;
    }
  }

  try {
    // Сохраняем прогноз на счет если есть
    if (scoreTeam1 !== null && scoreTeam2 !== null) {
      const scoreResponse = await fetch("/api/score-predictions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: currentUser.id,
          match_id: matchId,
          score_team1: scoreTeam1,
          score_team2: scoreTeam2,
        }),
      });

      if (!scoreResponse.ok) {
        const error = await scoreResponse.json();
        alert(error.error || "Ошибка сохранения прогноза на счет");
        return;
      }
    }

    // Сохраняем прогноз на карточки если есть
    if (yellowCards !== null || redCards !== null) {
      const cardsResponse = await fetch("/api/cards-predictions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: currentUser.id,
          match_id: matchId,
          yellow_cards: yellowCards,
          red_cards: redCards,
        }),
      });

      if (!cardsResponse.ok) {
        const error = await cardsResponse.json();
        alert(error.error || "Ошибка сохранения прогноза на карточки");
        return;
      }
    }

    // Скрываем кнопки и блокируем инпуты
    const buttonsDiv = document.getElementById(`scoreButtons_${matchId}`);
    if (buttonsDiv) {
      buttonsDiv.style.display = 'none';
    }
    if (scoreTeam1Input) scoreTeam1Input.disabled = true;
    if (scoreTeam2Input) scoreTeam2Input.disabled = true;
    if (yellowCardsInput) yellowCardsInput.disabled = true;
    if (redCardsInput) redCardsInput.disabled = true;
    
    // Обновляем данные в объекте match чтобы при следующем рендере поля были disabled
    const match = matches.find(m => m.id === matchId);
    if (match) {
      if (scoreTeam1 !== null && scoreTeam2 !== null) {
        match.predicted_score_team1 = scoreTeam1;
        match.predicted_score_team2 = scoreTeam2;
      }
      if (yellowCards !== null) {
        match.predicted_yellow_cards = yellowCards;
      }
      if (redCards !== null) {
        match.predicted_red_cards = redCards;
      }
    }
    
    loadMyBets();
  } catch (error) {
    console.error("Ошибка при сохранении прогноза на счет:", error);
    alert("Ошибка при сохранении прогноза на счет");
  }
}

async function cancelScorePrediction(matchId) {
  if (!currentUser) {
    alert("Сначала введите ваше имя");
    return;
  }

  if (!confirm("Удалить прогноз на счет?")) {
    return;
  }

  try {
    const response = await fetch(`/api/score-predictions/${matchId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: currentUser.id,
      }),
    });

    if (response.ok) {
      // Очищаем поля ввода и разблокируем их
      const scoreTeam1Input = document.getElementById(`scoreTeam1_${matchId}`);
      const scoreTeam2Input = document.getElementById(`scoreTeam2_${matchId}`);
      if (scoreTeam1Input) {
        scoreTeam1Input.value = "";
        scoreTeam1Input.disabled = false;
      }
      if (scoreTeam2Input) {
        scoreTeam2Input.value = "";
        scoreTeam2Input.disabled = false;
      }
      
      // Показываем кнопки снова
      const buttonsDiv = document.getElementById(`scoreButtons_${matchId}`);
      if (buttonsDiv) {
        buttonsDiv.style.display = 'flex';
      }
      
      alert("Прогноз на счет удален");
      loadMyBets();
    } else {
      const error = await response.json();
      alert(error.error || "Ошибка при удалении прогноза");
    }
  } catch (error) {
    console.error("Ошибка при удалении прогноза на счет:", error);
    alert("Ошибка при удалении прогноза на счет");
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
    // Сохраняем состояние открытых тоглов перед перерисовкой
    const openToggles = [];
    document.querySelectorAll('[id$="-content"]').forEach(content => {
      if (content.style.display === 'flex') {
        openToggles.push(content.id);
      }
    });

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
    
    // Восстанавливаем состояние открытых тоглов после перерисовки
    setTimeout(() => {
      openToggles.forEach(toggleId => {
        const content = document.getElementById(toggleId);
        if (content) {
          const toggleIdBase = toggleId.replace('-content', '');
          const arrow1 = document.getElementById(`${toggleIdBase}-arrow`);
          const arrow2 = document.getElementById(`${toggleIdBase}-arrow2`);
          
          content.style.display = 'flex';
          if (arrow1) arrow1.textContent = '▲';
          if (arrow2) arrow2.textContent = '▲';
          
          // Убираем анимацию при восстановлении
          const betItems = content.querySelectorAll('.bet-item');
          betItems.forEach(item => {
            item.style.opacity = '1';
            item.style.transform = 'translateX(0)';
          });
        }
      });
    }, 0);
    
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

  // Сначала определяем статус для ВСЕХ ставок
  const betsWithStatus = bets.map((bet) => {
    let statusClass = "pending";
    let statusText = "⏳ В ожидании";
    let normalizedPrediction = bet.prediction;
    let isCancelled = false; // Флаг для отменённых матчей

    // Проверяем, отменён ли матч
    if (['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(bet.match_status)) {
      statusClass = "cancelled";
      statusText = "⚠️ Отмена";
      isCancelled = true;
    } else {
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
    } // Закрываем блок else для не отменённых матчей

        // Показываем кнопку удаления: админу/модератору всегда, остальным только для матчей со статусом "pending"
        const canDelete = canManageMatches() || bet.match_status === "pending";
        const deleteBtn = canDelete
          ? `<button class="bet-delete-btn" onclick="deleteBet(${bet.id})">✕</button>`
          : "";

        return {
          bet,
          statusClass,
          statusText,
          normalizedPrediction,
          deleteBtn,
          eventName: bet.event_name || "Турнир не указан",
          isCancelled // Добавляем флаг отменённого матча
        };
      });

  // Сортируем ВСЕ ставки: 
  // 1. Сначала "pending"
  // 2. Потом завершенные (won/lost) по дате турнира (новые первыми)
  // 3. Турниры без даты в самом низу
  const sortedBets = betsWithStatus.sort((a, b) => {
    // Сначала все pending
    if (a.statusClass === 'pending' && b.statusClass !== 'pending') return -1;
    if (a.statusClass !== 'pending' && b.statusClass === 'pending') return 1;
    
    // Если обе ставки завершены (won или lost), сортируем по дате турнира
    if (a.statusClass !== 'pending' && b.statusClass !== 'pending') {
      const dateA = a.bet.event_start_date ? new Date(a.bet.event_start_date) : null;
      const dateB = b.bet.event_start_date ? new Date(b.bet.event_start_date) : null;
      
      // Турниры без даты в конец
      if (!dateA && dateB) return 1;
      if (dateA && !dateB) return -1;
      if (!dateA && !dateB) return 0;
      
      // Сортируем по дате: новые турниры первыми
      return dateB - dateA;
    }
    
    return 0;
  });

  // Группируем ставки по турнирам
  const betsByTournament = {};
  sortedBets.forEach(betData => {
    const eventName = betData.eventName;
    if (!betsByTournament[eventName]) {
      betsByTournament[eventName] = {
        pending: [],
        finished: [],
        dates: new Set(),
        rounds: new Set()
      };
    }
    
    // Собираем даты и туры
    if (betData.bet.match_date) {
      const date = new Date(betData.bet.match_date);
      const formattedDate = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
      betsByTournament[eventName].dates.add(formattedDate);
    }
    if (betData.bet.round) {
      betsByTournament[eventName].rounds.add(betData.bet.round);
    }
    
    if (betData.statusClass === 'pending') {
      betsByTournament[eventName].pending.push(betData);
    } else {
      betsByTournament[eventName].finished.push(betData);
    }
  });

  // Определяем активный турнир (у которого есть pending ставки)
  let activeTournament = null;
  for (const eventName in betsByTournament) {
    if (betsByTournament[eventName].pending.length > 0) {
      activeTournament = eventName;
      break;
    }
  }

  // Формируем HTML с toggle по турнирам
  let html = "";

  Object.keys(betsByTournament).forEach(eventName => {
    const tournament = betsByTournament[eventName];
    const totalBets = tournament.pending.length + tournament.finished.length;
    const isOpen = false; // Все тоглы закрыты по умолчанию
    const toggleId = `tournament-${eventName.replace(/\s+/g, '-')}`;
    
    html += `
        <div 
          onclick="toggleTournamentBets('${toggleId}')" 
          id="${toggleId}-toggle"
          style="
            text-align: center; 
            color: #5a9fd4; 
            font-size: 0.95em; 
            margin: 15px 0 10px 0; 
            cursor: pointer;
            user-select: none;
            padding: 8px;
            background: rgba(90, 159, 212, 0.1);
            border-radius: 5px;
            transition: all 0.3s ease;
          "
          onmouseover="this.style.background='rgba(90, 159, 212, 0.2)'"
          onmouseout="this.style.background='rgba(90, 159, 212, 0.1)'"
        >
          <span id="${toggleId}-arrow">${isOpen ? '▲' : '▼'}</span>
          ━━━ ${eventName} (${totalBets}) ━━━
          <span id="${toggleId}-arrow2">${isOpen ? '▲' : '▼'}</span>
        </div>
        <div id="${toggleId}-content" style="display: ${isOpen ? 'flex' : 'none'}; flex-direction: column; gap: 5px;">
    `;
    
    // Группируем ставки по дате и туру
    const allBets = [...tournament.pending, ...tournament.finished];
    const betsByDateRound = {};
    
    allBets.forEach(betData => {
      const date = betData.bet.match_date ? new Date(betData.bet.match_date) : null;
      const formattedDate = date ? `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}` : 'Без даты';
      const round = betData.bet.round || 'Без тура';
      const key = `${formattedDate}_${round}`;
      
      if (!betsByDateRound[key]) {
        betsByDateRound[key] = {
          date: formattedDate,
          round: round,
          dateObj: date,
          bets: [],
          hasPending: false
        };
      }
      
      // Отмечаем если есть pending ставки
      if (betData.statusClass === 'pending') {
        betsByDateRound[key].hasPending = true;
      }
      
      betsByDateRound[key].bets.push(betData);
    });
    
    // Сортируем группы: в первую очередь по дате (от новых к старым), потом по турам
    const sortedGroups = Object.values(betsByDateRound).sort((a, b) => {
      // В первую очередь сортируем по дате (от новых к старым)
      if (a.dateObj && b.dateObj) {
        return b.dateObj - a.dateObj; // Обратная сортировка: новые даты первыми
      }
      
      // Группы с датой раньше групп без даты
      if (a.dateObj && !b.dateObj) return -1;
      if (!a.dateObj && b.dateObj) return 1;
      
      // Если у обеих нет даты, сортируем по турам (большие номера первыми)
      if (!a.dateObj && !b.dateObj) {
        // Извлекаем номер тура из строки "Тур 7" -> 7
        const extractTourNumber = (round) => {
          const match = round.match(/\d+/);
          return match ? parseInt(match[0]) : 0;
        };
        
        const tourA = extractTourNumber(a.round);
        const tourB = extractTourNumber(b.round);
        
        // Сортируем по убыванию (большие номера первыми)
        return tourB - tourA;
      }
      
      return 0;
    });
    
    // Разделяем ставки на pending и finished блоки
    const pendingGroups = [];
    const finishedGroups = [];
    
    sortedGroups.forEach(group => {
      const pendingBets = group.bets.filter(bet => bet.statusClass === 'pending');
      const finishedBets = group.bets.filter(bet => bet.statusClass !== 'pending');
      
      if (pendingBets.length > 0) {
        pendingGroups.push({
          date: group.date,
          round: group.round,
          bets: pendingBets
        });
      }
      
      if (finishedBets.length > 0) {
        finishedGroups.push({
          date: group.date,
          round: group.round,
          bets: finishedBets
        });
      }
    });
    
    // Выводим сначала все pending группы, потом все finished группы
    [...pendingGroups, ...finishedGroups].forEach(group => {
      // Разделитель даты и тура
      html += `
        <div style="
          text-align: center;
          color: #b0b8c8;
          font-size: 0.85em;
          margin: 10px 0 5px 0;
          padding: 5px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 3px;
        ">
          ${group.date} | ${group.round}
        </div>
      `;
      
      // Ставки этой группы
      group.bets.forEach(({ bet, statusClass, statusText, normalizedPrediction, deleteBtn, isCancelled }) => {
        html += generateBetHTML(bet, statusClass, statusText, normalizedPrediction, deleteBtn, isCancelled);
      });
    });
    
    html += `
        </div>
    `;
  });

  myBetsList.innerHTML = html;
}

// Вспомогательная функция для генерации HTML одной ставки
function generateBetHTML(bet, statusClass, statusText, normalizedPrediction, deleteBtn, isCancelled = false) {
  // Стили для отменённых матчей: зачёркнутый текст и чёрно-белый фильтр
  const cancelledStyle = isCancelled 
    ? 'text-decoration: line-through; filter: grayscale(100%); opacity: 0.7;' 
    : '';
  
  return `
    <div class="bet-item ${statusClass}" data-bet-id="${bet.id}" style="${cancelledStyle}">
        <div class="bet-info">
            <span class="bet-match">${bet.team1_name} vs ${bet.team2_name}</span>
            <span class="bet-status ${statusClass}">${statusText}</span>
        </div>
        <div style="font-size: 0.9em; color: #b0b8c8; margin-bottom: 5px;">
            <span class="bet-stake">Ставка: <strong>${(() => {
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
                  return `${paramName}: ${bet.team1_name} ${bet.prediction} ${bet.team2_name}`;
                } else {
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
            ${
              bet.winner
                ? ` | Результат: <strong>${
                    bet.winner === 'team1' ? bet.team1_name :
                    bet.winner === 'team2' ? bet.team2_name :
                    'Ничья'
                  }</strong>`
                : ""
            }
        </div>
        ${
          bet.score_team1 != null && bet.score_team2 != null
            ? `<div style="font-size: 0.9em; color: #b0b8c8; margin-bottom: 5px;">
                📊 Счет: <span style="${
                  bet.actual_score_team1 != null && bet.actual_score_team2 != null && bet.match_status === 'finished'
                    ? bet.score_team1 === bet.actual_score_team1 && bet.score_team2 === bet.actual_score_team2
                      ? 'border: 1px solid #4caf50; padding: 2px 5px; border-radius: 3px;'
                      : 'border: 1px solid #f44336; padding: 2px 5px; border-radius: 3px;'
                    : ''
                }">${bet.score_team1}-${bet.score_team2}</span>
                ${
                  bet.actual_score_team1 != null && bet.actual_score_team2 != null && bet.match_status === 'finished'
                    ? ` | Результат: <strong>${bet.actual_score_team1}-${bet.actual_score_team2}</strong>`
                    : ""
                }
                ${
                  bet.actual_score_team1 != null && bet.actual_score_team2 != null && bet.match_status === 'finished' && 
                  bet.score_team1 === bet.actual_score_team1 && bet.score_team2 === bet.actual_score_team2 && bet.result !== 'won'
                    ? ' <span style="color: #ff9800; font-size: 0.85em;">(не засчитано)</span>'
                    : ""
                }
              </div>`
            : ""
        }
        ${
          bet.yellow_cards != null
            ? `<div style="font-size: 0.9em; color: #b0b8c8; margin-bottom: 5px;">
                🟨 Желтые: <span style="${
                  bet.actual_yellow_cards != null && bet.match_status === 'finished'
                    ? bet.yellow_cards === bet.actual_yellow_cards
                      ? 'border: 1px solid #4caf50; padding: 2px 5px; border-radius: 3px;'
                      : 'border: 1px solid #f44336; padding: 2px 5px; border-radius: 3px;'
                    : ''
                }">${bet.yellow_cards}</span>
                ${
                  bet.actual_yellow_cards != null && bet.match_status === 'finished'
                    ? ` | Результат: <strong>${bet.actual_yellow_cards}</strong>`
                    : ""
                }
                ${
                  bet.actual_yellow_cards != null && bet.match_status === 'finished' && 
                  bet.yellow_cards === bet.actual_yellow_cards && bet.result !== 'won'
                    ? ' <span style="color: #ff9800; font-size: 0.85em;">(не засчитано)</span>'
                    : ""
                }
              </div>`
            : ""
        }
        ${
          bet.red_cards != null
            ? `<div style="font-size: 0.9em; color: #b0b8c8; margin-bottom: 5px;">
                🟥 Красные: <span style="${
                  bet.actual_red_cards != null && bet.match_status === 'finished'
                    ? bet.red_cards === bet.actual_red_cards
                      ? 'border: 1px solid #4caf50; padding: 2px 5px; border-radius: 3px;'
                      : 'border: 1px solid #f44336; padding: 2px 5px; border-radius: 3px;'
                    : ''
                }">${bet.red_cards}</span>
                ${
                  bet.actual_red_cards != null && bet.match_status === 'finished'
                    ? ` | Результат: <strong>${bet.actual_red_cards}</strong>`
                    : ""
                }
                ${
                  bet.actual_red_cards != null && bet.match_status === 'finished' && 
                  bet.red_cards === bet.actual_red_cards && bet.result !== 'won'
                    ? ' <span style="color: #ff9800; font-size: 0.85em;">(не засчитано)</span>'
                    : ""
                }
              </div>`
            : ""
        }
        <div class="bet-round" style="font-size: 0.85em; color: #b0b8c8; margin-top: 5px;">
            ${bet.is_final ? "🏆 ФИНАЛ" : bet.round ? `${bet.round}` : ""}
        </div>
        ${deleteBtn}
    </div>
  `;
}

// Функция для переключения видимости ставок турнира
function toggleTournamentBets(toggleId) {
  const content = document.getElementById(`${toggleId}-content`);
  const arrow1 = document.getElementById(`${toggleId}-arrow`);
  const arrow2 = document.getElementById(`${toggleId}-arrow2`);
  const betItems = content.querySelectorAll('.bet-item');
  
  // Определяем задержку в зависимости от количества карточек
  const delay = betItems.length > 30 ? 1 : 10;
  
  if (content.style.display === 'none' || !content.style.display) {
    // Открываем
    content.style.display = 'flex';
    arrow1.textContent = '▲';
    arrow2.textContent = '▲';
    
    // Анимация появления карточек одна за другой
    betItems.forEach((item, index) => {
      item.style.opacity = '0';
      item.style.transform = 'translateX(-20px)';
      setTimeout(() => {
        item.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        item.style.opacity = '1';
        item.style.transform = 'translateX(0)';
      }, index * delay);
    });
  } else {
    // Закрываем
    arrow1.textContent = '▼';
    arrow2.textContent = '▼';
    
    // Анимация исчезновения карточек одна за другой (в обратном порядке)
    const reversedItems = Array.from(betItems).reverse();
    reversedItems.forEach((item, index) => {
      setTimeout(() => {
        item.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        item.style.opacity = '0';
        item.style.transform = 'translateX(-20px)';
      }, index * delay);
    });
    
    // Скрываем контейнер после завершения анимации
    setTimeout(() => {
      content.style.display = 'none';
    }, reversedItems.length * delay + 300);
  }
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

    // Если это была обычная ставка (не финальная) - СНАЧАЛА удаляем прогнозы на счет и карточки
    if (!isFinalBet && matchId) {
      // Удаляем прогноз на счет
      try {
        const deleteScoreResponse = await fetch(`/api/score-predictions/${matchId}`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: currentUser.id,
          }),
        });
        
        if (deleteScoreResponse.ok) {
          console.log("✅ Прогноз на счет удален");
        } else {
          console.log("⚠️ Прогноз на счет не найден или уже удален");
        }
      } catch (error) {
        console.log("⚠️ Ошибка при удалении прогноза на счет:", error);
      }

      // Удаляем прогноз на карточки
      try {
        const deleteCardsResponse = await fetch(`/api/cards-predictions/${matchId}`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: currentUser.id,
          }),
        });
        
        if (deleteCardsResponse.ok) {
          console.log("✅ Прогноз на карточки удален");
        } else {
          console.log("⚠️ Прогноз на карточки не найден или уже удален");
        }
      } catch (error) {
        console.log("⚠️ Ошибка при удалении прогноза на карточки:", error);
      }

      // Очищаем прогнозы в объекте матча
      const match = matches.find(m => m.id === matchId);
      if (match) {
        match.predicted_score_team1 = null;
        match.predicted_score_team2 = null;
        match.predicted_yellow_cards = null;
        match.predicted_red_cards = null;
        console.log(`🧹 Очищены прогнозы для матча ${matchId}`);
      }
    }

    // ПОТОМ удаляем ставку
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

    // 🔄 Полностью перезагружаем список ставок с БД
    // loadMyBets уже вызывает displayMatches внутри, поэтому не нужно вызывать его отдельно
    await loadMyBets();
  } catch (error) {
    console.error("Ошибка при удалении ставки:", error);
    alert("Ошибка при удалении ставки");
  }
}

// ===== МОБИЛЬНОЕ МЕНЮ =====
function toggleMobileMenu() {
  const userSection = document.querySelector('.user-section');
  const toggleBtn = document.getElementById('mobileMenuToggle');
  
  userSection.classList.toggle('active');
  toggleBtn.classList.toggle('active');
  
  // Закрываем меню при клике на вкладку
  if (userSection.classList.contains('active')) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        userSection.classList.remove('active');
        toggleBtn.classList.remove('active');
      }, { once: true });
    });
  }
}

// Переключение секций на мобильных
function showMobileSection(section) {
  if (window.innerWidth > 768) return; // Работает только на мобильных

  const tournaments = document.querySelector('.bet-section-tournaments');
  const matches = document.getElementById('matchesSection');
  const bets = document.querySelector('.bet-section-bets');
  const navButtons = document.querySelectorAll('.mobile-nav-btn');

  // Убираем активный класс со всех кнопок
  navButtons.forEach(btn => btn.classList.remove('active'));

  // Скрываем все секции с fade out
  [tournaments, matches, bets].forEach(el => {
    if (el && el.style.display !== 'none') {
      el.style.opacity = '0';
      setTimeout(() => {
        el.style.display = 'none';
      }, 300);
    }
  });

  // Показываем нужную секцию с fade in
  setTimeout(() => {
    let targetSection = null;
    let activeButtonIndex = -1;

    if (section === 'tournaments') {
      targetSection = tournaments;
      activeButtonIndex = 0;
    } else if (section === 'matches') {
      targetSection = matches;
      activeButtonIndex = 1;
    } else if (section === 'bets') {
      targetSection = bets;
      activeButtonIndex = 2;
    }

    if (targetSection) {
      targetSection.style.display = 'block';
      setTimeout(() => {
        targetSection.style.opacity = '1';
      }, 10);
      if (activeButtonIndex >= 0) {
        navButtons[activeButtonIndex].classList.add('active');
      }
    }
  }, 300);
}

// Закрытие мобильного меню при клике вне его
document.addEventListener('click', (e) => {
  const userSection = document.querySelector('.user-section');
  const toggleBtn = document.getElementById('mobileMenuToggle');
  
  if (userSection && toggleBtn && 
      userSection.classList.contains('active') &&
      !userSection.contains(e.target) && 
      !toggleBtn.contains(e.target)) {
    userSection.classList.remove('active');
    toggleBtn.classList.remove('active');
  }
});

// ===== ВКЛАДКИ =====
function switchTab(tabName) {
  // Проверяем гостевой режим - разрешаем только вкладку "Ставки"
  const isGuestMode = document.querySelector('.container.guest-mode');
  if (isGuestMode && tabName !== 'allbets') {
    openLoginModal();
    return;
  }
  
  // Останавливаем автообновление LIVE матчей при переключении на другую вкладку
  if (tabName !== 'live') {
    stopLiveMatchesAutoUpdate();
  }
  
  // Управление кнопками навигации на мобильных
  if (window.innerWidth <= 768) {
    const navButtons = document.querySelector('.mobile-nav-buttons');
    if (navButtons) {
      if (tabName === 'allbets' || tabName === 'live') {
        // Показываем кнопки навигации для allbets и live
        navButtons.style.opacity = '1';
        navButtons.style.pointerEvents = 'auto';
      } else {
        // Скрываем кнопки навигации
        navButtons.style.opacity = '0';
        navButtons.style.pointerEvents = 'none';
      }
    }
  }

  // Скрываем все содержимое вкладок
  document
    .getElementById("allbets-content")
    .style.setProperty("display", "none", "important");
  document
    .getElementById("live-content")
    .style.setProperty("display", "none", "important");
  document
    .getElementById("participants-content")
    .style.setProperty("display", "none", "important");
  document
    .getElementById("profile-content")
    .style.setProperty("display", "none", "important");
  document
    .getElementById("settings-content")
    .style.setProperty("display", "none", "important");
  document
    .getElementById("news-content")
    .style.setProperty("display", "none", "important");
  document
    .getElementById("counting-content")
    .style.setProperty("display", "none", "important");

  // Удаляем активный класс со всех кнопок вкладок
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  // Показываем нужное содержимое и отмечаем кнопку как активную
  if (tabName === "allbets") {
    const content = document.getElementById("allbets-content");
    content.style.setProperty("display", "grid", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
    document.querySelectorAll(".tab-btn")[1].classList.add("active");
    loadEventsList();
    if (currentEventId) {
      loadMatches(currentEventId);
    }
    loadMyBets();
  } else if (tabName === "live") {
    const content = document.getElementById("live-content");
    content.style.setProperty("display", "flex", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
    document.querySelectorAll(".tab-btn")[0].classList.add("active");
    loadLiveMatches();
    // Запускаем автообновление LIVE матчей
    startLiveMatchesAutoUpdate();
  } else if (tabName === "participants") {
    const content = document.getElementById("participants-content");
    content.style.setProperty("display", "flex", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
    document.querySelectorAll(".tab-btn")[2].classList.add("active");
    loadTournamentsList();
  } else if (tabName === "profile") {
    const content = document.getElementById("profile-content");
    content.style.setProperty("display", "flex", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
    document.querySelectorAll(".tab-btn")[3].classList.add("active");
    loadProfile();
  } else if (tabName === "settings") {
    const content = document.getElementById("settings-content");
    content.style.setProperty("display", "flex", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
    document.querySelectorAll(".tab-btn")[5].classList.add("active");
    loadSettings();
  } else if (tabName === "news") {
    const content = document.getElementById("news-content");
    content.style.setProperty("display", "flex", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
    document.querySelectorAll(".tab-btn")[4].classList.add("active");
    loadNewsTab();
  } else if (tabName === "counting") {
    const content = document.getElementById("counting-content");
    content.style.setProperty("display", "flex", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
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

  // Обновляем заголовок с количеством участников
  const participantsHeader = document.getElementById('participantsHeader');
  if (participantsHeader) {
    participantsHeader.textContent = `👥 Всего участников: ${participants.length}`;
  }

  if (participants.length === 0) {
    participantsList.innerHTML =
      '<div class="empty-message">Участники не найдены</div>';
    return;
  }

  // Сортируем по количеству побед в турнирах, затем по имени
  const sortedParticipants = [...participants].sort((a, b) => {
    const aWins = (a.won_icons || []).length;
    const bWins = (b.won_icons || []).length;
    
    if (bWins !== aWins) {
      return bWins - aWins; // Больше побед в турнирах → выше
    }
    
    // При равном количестве побед сортируем по имени (алфавитный порядок)
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
      const currentWins = (participant.won_icons || []).length;
      const prevWins = (prev.won_icons || []).length;
      
      // Если количество побед одинаковое - то же место
      if (currentWins === prevWins) {
        placesMap.set(index, placesMap.get(index - 1));
      } else {
        // Следующее место учитывает количество участников на предыдущем месте
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
          <span>Угаданных ставок за всё время: ${participant.won_bets || 0} |</span>
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
          : event.icon || "🏆";
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
          : event.icon || "🏆";
      
      const startDateText = event.start_date 
        ? `<div class="event-card-start-date">📅 Начало: ${new Date(event.start_date).toLocaleDateString('ru-RU')}</div>`
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
          winnerInfo = `<div class="event-card-winner">👑 Победитель: <strong>${winner.username}</strong></div>`;
        }
      } catch (error) {
        console.error("Ошибка при загрузке участников турнира:", error);
      }

      const iconHtml =
        event.icon && event.icon.startsWith("img/")
          ? `<img class="event-icon" src="${event.icon}" alt="icon"/>`
          : event.icon || "🏆";

      return `
    <div class="event-card locked" onclick="loadTournamentParticipants(${
      event.id
    }, '${event.name.replace(/'/g, "\\'")}')">
      <div class="event-card-title">${iconHtml} ${event.name}</div>
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

async function loadTournamentParticipants(eventId, eventName) {
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
    document.getElementById("tournamentTitle").innerText = `📋 ${eventName}`;

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
function startTournamentParticipantsPolling() {
  stopTournamentParticipantsPolling();
  
  tournamentParticipantsInterval = setInterval(async () => {
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
  }, 30000); // Обновление каждые 30 секунд
  
  console.log('✅ Запущено автообновление рейтинга участников');
}

// Остановить автообновление рейтинга участников
function stopTournamentParticipantsPolling() {
  if (tournamentParticipantsInterval) {
    clearInterval(tournamentParticipantsInterval);
    tournamentParticipantsInterval = null;
    console.log('⏹️ Остановлено автообновление рейтинга участников');
  }
}

// Вычислить максимальную серию угаданных ставок подряд для пользователя в турнире
async function calculateMaxWinStreak(userId, eventId) {
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

async function displayTournamentParticipants(
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
      let emoji = "😐"; // нейтральное для середины

      if (place === 1) {
        emoji = "😎"; // первое место
      } else if (index === totalParticipants - 1 && totalParticipants > 1) {
        emoji = "💩"; // последнее место
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
        ${isPrivate ? '🔒 ' : ''}Сетка плей-офф
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

function backToTournaments() {
  stopTournamentParticipantsPolling(); // Останавливаем автообновление
  document.getElementById("tournamentsSection").style.display = "block";
  document.getElementById("tournamentSection").style.display = "none";
}

// Показать ставки участника турнира
async function showTournamentParticipantBets(userId, username, eventId) {
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
          console.warn(`⚠️ Не удалось загрузить словарь из ${dictionaryFile}`);
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
      alert("Не удалось загрузить ставки");
      return;
    }

    const betsData = await response.json();
    const { rounds, bets, show_bets, event_name, completed_rounds } = betsData;

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
    ).textContent = `📊 Ставки ${username}`;

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
      `<span title="Турнир: ${event_name}" style="cursor: help;">🔥 Макс. серия: <strong>${maxStreak}</strong></span>`;

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
        console.log(`📜 Прокрутка турнирных туров: scrollLeft=${tournamentRoundsContainer.scrollLeft}, maxScroll=${maxScroll}, scrollWidth=${tournamentRoundsContainer.scrollWidth}, clientWidth=${tournamentRoundsContainer.clientWidth}, активен: ${defaultActiveRound}`);
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

  // Логируем первую ставку для проверки данных
  if (bets.length > 0) {
    console.log("Загружено ставок:", bets.length);
  }

  betsList.innerHTML = bets
    .map(
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
            🔒 Скрыто
          </span>` :
          isCancelled ?
          `<span style="background: #ff5722; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85em;">
            ⚠️ Отмена
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
                ? "✅ Угадано"
                : bet.result === "lost"
                ? "❌ Неугадано"
                : "⏳ В ожидании"
            }
          </span>`
        }
      </div>
      ${shouldHideBet ?
        `<div style="color: #ffa726; font-size: 0.9em; font-style: italic;">
          🔒 Ставка скрыта до начала матча
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
                📊 Счет: <span style="${
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
              </div>`
            : ""
        }
        ${
          bet.yellow_cards !== null && bet.yellow_cards !== undefined
            ? `<div style="color: #999; font-size: 0.9em; margin-bottom: 5px; ${isCancelled ? 'text-decoration: line-through; filter: grayscale(100%); opacity: 0.7;' : ''}">
                🟨 Желтые: <span style="${
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
                🟥 Красные: <span style="${
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
function closeTournamentParticipantBetsModal() {
  document.getElementById("tournamentParticipantBetsModal").style.display =
    "none";
  window.currentTournamentBets = null;
  window.currentTournamentRounds = null;
  
  // Разблокируем прокрутку страницы
  document.body.style.overflow = '';
}

// ===== ПРОФИЛЬ =====

async function loadProfile() {
  if (!currentUser) {
    alert("Пожалуйста, сначала войдите в аккаунт");
    return;
  }

  try {
    const response = await fetch(`/api/user/${currentUser.id}/profile?viewerUsername=${encodeURIComponent(currentUser.username)}`);
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
      <div class="profile-avatar-container" onclick="this.classList.toggle('flipped')" style="
        width: 100px;
        height: 100px;
        perspective: 1000px;
        cursor: pointer;
        margin: 0 auto;
      ">
        <div class="profile-avatar-flipper" style="
          position: relative;
          width: 100%;
          height: 100%;
          transition: transform 0.6s;
          transform-style: preserve-3d;
        ">
          <!-- Передняя сторона (аватарка) -->
          <div class="profile-avatar-front" style="
            position: absolute;
            width: 100%;
            height: 100%;
            backface-visibility: hidden;
            border-radius: 30%;
            overflow: hidden;
          ">
            <img src="${avatarSrc}" style="width: 100%; height: 100%; object-fit: cover;">
          </div>
          
          <!-- Задняя сторона (кнопка редактирования) -->
          <div class="profile-avatar-back" style="
            position: absolute;
            width: 100%;
            height: 100%;
            backface-visibility: hidden;
            transform: rotateY(180deg);
            background: url('img/default-avatar.jpg') center/cover;
            border-radius: 30%;
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <button id="avatarEditBtn" onclick="event.stopPropagation(); openAvatarModal()" style="
              background: rgba(44, 50, 63, 0.9);
              border: 2px solid white;
              color: white;
              width: 60px;
              height: 60px;
              border-radius: 50%;
              cursor: pointer;
              font-size: 27px;
              display: flex;
              justify-content: center;
              transition: all 0.3s ease;
              
            " onmouseover="this.style.background='rgba(255, 255, 255, 0.3)'; this.style.transform='scale(1.1)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.2)'; this.style.transform='scale(1)'">📷</button>
          </div>
        </div>
      </div>
      <div class="profile-username" onclick="editUsername()" onmouseover="document.getElementById('editUsernameBtn').style.display='inline'" onmouseout="document.getElementById('editUsernameBtn').style.display='none'" style="cursor: pointer;">
        <span id="usernameDisplay">${profile.username}</span>
        <button id="editUsernameBtn" onclick="event.stopPropagation(); editUsername()" style="
          background: transparent;
          color: #0088cc;
          border: none;
          padding: 0;
          cursor: pointer;
          font-size: .5em;
          transition: all 0.3s ease;
          display: none;
          box-shadow: none;
          position: absolute;
          bottom: 5px;
        " title="Изменить имя">✏️</button>
      </div>
      <div class="profile-member-since">Участник с ${createdDate}</div>
    </div>

    <div class="profile-stats-grid">
      <div class="stat-card">
        <div class="stat-label">Ставок за всё время</div>
        <div class="stat-value">${profile.total_bets}</div>
      </div>
      <div class="stat-card won">
        <div class="stat-label">✅ Угаданных ставок</div>
        <div class="stat-value">${profile.won_bets}</div>
      </div>
      <div class="stat-card" style="background: rgba(76, 175, 80, 0.15); border-left: 4px solid #4caf50; cursor: help;" title="${profile.max_win_streak_event ? `Турнир: ${profile.max_win_streak_event}` : 'Нет серии'}">
        <div class="stat-label">🔥 Угаданных подряд</div>
        <div class="stat-value" style="color: #4caf50;">${
          profile.max_win_streak || 0
        }</div>
      </div>
      <div class="stat-card lost">
        <div class="stat-label">❌ Неугаданных ставок</div>
        <div class="stat-value">${profile.lost_bets}</div>
      </div>
      <div class="stat-card pending">
        <div class="stat-label">⏳ В ожидании</div>
        <div class="stat-value">${profile.pending_bets}</div>
      </div>
      <div class="stat-card won" style="background: rgba(76, 175, 80, 0.15); border-left: 4px solid #4caf50;">
        <div class="stat-label">✅ Угаданных в сетке</div>
        <div class="stat-value">${profile.bracket_correct || 0}</div>
      </div>
      <div class="stat-card lost" style="background: rgba(244, 67, 54, 0.15); border-left: 4px solid #f44336;">
        <div class="stat-label">❌ Неугаданных в сетке</div>
        <div class="stat-value">${profile.bracket_incorrect || 0}</div>
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
      const icon = award.event_icon || "🏆";
      const awardIcon = icon.startsWith("img/")
        ? `<img src="${icon}" alt="trophy" class="tournament-icon">`
        : icon;

      awardsHTML += `
        <div class="award-card">
          <div class="award-icon">${awardIcon}</div>
          <div class="award-title">Победитель в турнире "${award.event_name}"</div>
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

// Загрузить права модератора для текущего пользователя
async function loadModeratorPermissions() {
  
  if (!currentUser) {
    console.log("❌ currentUser не определен");
    return;
  }
  
  if (currentUser.isAdmin) {
    // Админу не нужны права модератора
    currentUser.isModerator = false;
    currentUser.moderatorPermissions = [];
    console.log("👑 Пользователь - админ, права модератора не нужны");
    return;
  }

  try {
    console.log("📡 Запрос списка модераторов...");
    const response = await fetch("/api/moderators");
    const moderators = await response.json();
    
    console.log("📋 Получено модераторов:", moderators);
    console.log("🔎 Ищем модератора с user_id:", currentUser.id);
    
    const moderator = moderators.find(mod => mod.user_id === currentUser.id);
    
    if (moderator) {
      currentUser.isModerator = true;
      currentUser.moderatorPermissions = moderator.permissions || [];
      console.log("✅ Права модератора загружены:", currentUser.moderatorPermissions);
      console.log("👤 currentUser после загрузки:", currentUser);
    } else {
      currentUser.isModerator = false;
      currentUser.moderatorPermissions = [];
      console.log("ℹ️ Пользователь не является модератором");
    }
  } catch (error) {
    console.error("❌ Ошибка загрузки прав модератора:", error);
    currentUser.isModerator = false;
    currentUser.moderatorPermissions = [];
  }
}

// Проверить, является ли пользователь модератором
function isModerator() {
  return currentUser && currentUser.isModerator === true;
}

// Проверить, есть ли у модератора определенное право
function hasModeratorPermission(permission) {
  if (!currentUser) return false;
  if (currentUser.isAdmin) return true; // Админ имеет все права
  if (!currentUser.isModerator) return false;
  return currentUser.moderatorPermissions && currentUser.moderatorPermissions.includes(permission);
}

// Проверить, есть ли у пользователя конкретное право
function hasPermission(permission) {
  if (isAdmin()) return true; // Админ имеет все права
  if (!isModerator()) return false;
  return currentUser.moderatorPermissions.includes(permission);
}

// Проверить, может ли пользователь управлять матчами
function canManageMatches() {
  const result = hasPermission('manage_matches');
  return result;
}

// Проверить, может ли пользователь создавать матчи
function canCreateMatches() {
  return hasPermission('create_matches');
}

// Проверить, может ли пользователь редактировать матчи
function canEditMatches() {
  return hasPermission('edit_matches');
}

// Проверить, может ли пользователь удалять матчи
function canDeleteMatches() {
  return hasPermission('delete_matches');
}

// Проверить, может ли пользователь управлять результатами
function canManageResults() {
  return hasPermission('manage_results');
}

// Проверить, может ли пользователь управлять турнирами
function canManageTournaments() {
  return hasPermission('manage_tournaments');
}

// Проверить, может ли пользователь редактировать турниры
function canEditTournaments() {
  return hasPermission('edit_tournaments');
}

// Проверить, может ли пользователь удалять турниры
function canDeleteTournaments() {
  return hasPermission('delete_tournaments');
}

// Проверить, может ли пользователь создавать турниры
function canCreateTournaments() {
  return hasPermission('create_tournaments');
}

// Проверить, может ли пользователь просматривать логи
function canViewLogs() {
  return hasPermission('view_logs');
}

// Проверить, может ли пользователь просматривать подсчет результатов
function canViewCounting() {
  return hasPermission('view_counting');
}

// Проверить, может ли пользователь создавать бэкапы
function canBackupDB() {
  return hasPermission('backup_db');
}

// Проверить, может ли пользователь скачивать бэкапы
function canDownloadBackup() {
  return hasPermission('download_backup');
}

// Проверить, может ли пользователь восстанавливать БД
function canRestoreDB() {
  return hasPermission('restore_db');
}

// Проверить, может ли пользователь удалять бэкапы
function canDeleteBackup() {
  return hasPermission('delete_backup');
}

// Проверить, есть ли у пользователя хоть какое-то право на управление БД
function canAccessDatabasePanel() {
  return canBackupDB() || canDownloadBackup() || canRestoreDB() || canDeleteBackup();
}

// Проверить, может ли пользователь управлять orphaned данными
function canManageOrphaned() {
  return hasPermission('manage_orphaned');
}

// Проверить, может ли пользователь просматривать пользователей
function canViewUsers() {
  return hasPermission('view_users');
}

// Проверить, может ли пользователь редактировать пользователей
function canEditUsers() {
  return hasPermission('edit_users');
}

// Проверить, может ли пользователь удалять пользователей
function canDeleteUsers() {
  return hasPermission('delete_users');
}

// Проверить, может ли пользователь проверять контакт с ботом
function canCheckBot() {
  return isAdmin() || hasPermission('check_bot');
}

// Проверить, может ли пользователь просматривать настройки пользователей
function canViewSettings() {
  return isAdmin() || hasPermission('view_settings');
}

// Проверить, имеет ли модератор хотя бы одно право из админ-панели
function hasAdminPanelAccess() {
  if (isAdmin()) return true;
  if (!isModerator()) return false;
  
  const adminPanelPerms = ['view_logs', 'backup_db', 'download_backup', 'restore_db', 'delete_backup', 'manage_orphaned', 'view_users'];
  return currentUser.moderatorPermissions.some(perm => adminPanelPerms.includes(perm));
}

// Проверить, имеет ли пользователь права админа или модератора
function isAdminOrModerator() {
  return isAdmin() || isModerator();
}

// Функция для создания бэкапа базы данных
async function backupDatabase() {
  if (!canBackupDB()) {
    await showCustomAlert("У вас нет прав для создания бэкапа БД", "Ошибка", "❌");
    return;
  }

  try {
    // Показываем индикатор загрузки
    const backupBtn = document.querySelector('[onclick="backupDatabase()"]');
    const originalText = backupBtn ? backupBtn.textContent : null;
    if (backupBtn) {
      backupBtn.textContent = "⏳ Создание бэкапа...";
      backupBtn.disabled = true;
    }

    const response = await fetch("/api/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        username: currentUser.username 
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && data.filename) {
      // Сохраняем имя последнего созданного бэкапа
      lastCreatedBackupFilename = data.filename;
      
      // Обновляем список бэкапов в модалке если она открыта
      const databaseModal = document.getElementById("databaseModal");
      if (databaseModal && databaseModal.style.display === "flex") {
        // Перезагружаем список бэкапов
        const response = await fetch("/api/admin/backups");
        const backups = await response.json();
        const backupsList = document.getElementById("databaseBackupsList");
        
        // Вычисляем общий размер всех бэкапов
        const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
        const totalSizeFormatted = (totalSize / 1024 / 1024).toFixed(2) + ' MB';
        
        // Обновляем заголовок с общим размером
        document.getElementById("backupsListHeader").innerHTML = `
          <h3 style="color: #5a9fd4; margin: 0;">📦 Доступные бэкапы (выберите один):</h3>
          <div style="color: #999; font-size: 0.9em;">
            Всего: <strong style="color: #5a9fd4;">${backups.length}</strong> | 
            Общий размер: <strong style="color: #5a9fd4;">${totalSizeFormatted}</strong>
          </div>
        `;
        
        if (backups.length === 0) {
          backupsList.innerHTML = '<div class="empty-message">Нет доступных бэкапов</div>';
        } else {
          backupsList.innerHTML = backups.map((backup, index) => {
            const isNew = backup.filename === lastCreatedBackupFilename;
            const isLocked = backup.isLocked || false;
            
            return `
            <div 
              class="backup-item${isNew ? ' new-backup' : ''}"
              data-filename="${backup.filename}"
              data-locked="${isLocked}"
              onclick="selectBackup('${backup.filename}', ${isLocked})"
              style="
                padding: 15px;
                margin-bottom: 10px;
                background: rgba(30, 34, 44, 0.6);
                border: 2px solid ${isNew ? 'rgba(76, 175, 80, 0.6)' : 'rgba(90, 159, 212, 0.3)'};
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.3s ease;
                position: relative;
              "
              onmouseover="if(!this.classList.contains('selected')) this.style.borderColor='${isNew ? 'rgba(76, 175, 80, 0.8)' : 'rgba(90, 159, 212, 0.6)'}'"
              onmouseout="if(!this.classList.contains('selected')) this.style.borderColor='${isNew ? 'rgba(76, 175, 80, 0.6)' : 'rgba(90, 159, 212, 0.3)'}'"
            >
              <div style="display: flex; justify-content: space-between; align-items: start; gap: 10px;">
                <div style="flex: 1;">
                  ${isNew ? '<div style="position: absolute; top: 10px; right: 10px; background: rgba(76, 175, 80, 0.9); color: #fff; padding: 4px 12px; border-radius: 12px; font-size: 0.75em; font-weight: bold; animation: pulse 2s infinite;">NEW</div>' : ''}
                  <div style="font-weight: bold; color: ${isNew ? '#4caf50' : '#5a9fd4'}; margin-bottom: 5px;">
                    ${backup.filename}
                  </div>
                  <div style="font-size: 0.9em; color: #999;">
                    📅 ${new Date(backup.created).toLocaleString('ru-RU')} | 💾 ${backup.sizeFormatted}
                  </div>
                  ${backup.createdBy !== 'unknown' ? `<div style="font-size: 0.85em; color: #888; margin-top: 3px;">👤 ${backup.createdBy}</div>` : ''}
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end; position: relative;">
                  ${isLocked ? '<div style="background: rgba(255, 193, 7, 0.2); color: #ffc107; padding: 3px 8px; border-radius: 6px; font-size: 0.75em; white-space: nowrap;">🔒 Заблокирован</div>' : ''}
                  ${isAdmin() ? `<button 
                    class="backup-lock-btn"
                    onclick="event.stopPropagation(); toggleBackupLock('${backup.filename}', ${isLocked})"
                    style="
                      background: ${isLocked ? 'rgba(76, 175, 80, 0.7)' : 'transparent'};
                      color: ${isLocked ? '#fff' : 'rgb(255, 255, 255)'};
                      border: ${isLocked ? '1px solid #4caf50' : 'medium'};
                      padding: 4px 10px;
                      border-radius: 6px;
                      cursor: pointer;
                      font-size: ${isLocked ? '0.7em' : '0.75em'};
                      transition: ${isLocked ? 'all 0.3s ease' : '0.3s'};
                      white-space: nowrap;
                      opacity: 0;
                      box-shadow: none;
                      pointer-events: none;
                      position: absolute;
                      right: 0;
                      bottom: 0;
                    "
                    title="${isLocked ? 'Разблокировать бэкап' : 'Заблокировать бэкап'}"
                  >
                    ${isLocked ? '🔓 Разблокировать' : '🔒'}
                  </button>` : ''}
                </div>
              </div>
            </div>
          `}).join('');
        }
      }
    } else {
      await showCustomAlert(
        data.error || "Неизвестная ошибка",
        "Ошибка при создании бэкапа",
        "❌"
      );
    }
  } catch (error) {
    console.error("Ошибка при создании бэкапа:", error);
    await showCustomAlert(error.message, "Ошибка при создании бэкапа БД", "❌");
  } finally {
    // Восстанавливаем кнопку
    const backupBtn = document.querySelector('[onclick="backupDatabase()"]');
    if (backupBtn) {
      backupBtn.textContent = "➕ Создать бэкап";
      backupBtn.disabled = false;
    }
  }
}

// Открыть модальное окно восстановления БД
async function openRestoreDBModal() {
  if (!isAdmin() && !hasModeratorPermission('restore_db')) {
    alert("❌ У вас нет прав для восстановления БД");
    return;
  }

  try {
    const response = await fetch("/api/admin/backups");
    const backups = await response.json();

    const backupsList = document.getElementById("backupsList");
    
    if (backups.length === 0) {
      backupsList.innerHTML = '<div class="empty-message">Нет доступных бэкапов</div>';
    } else {
      backupsList.innerHTML = backups.map(backup => `
        <div style="
          padding: 15px;
          margin-bottom: 10px;
          background: rgba(30, 34, 44, 0.6);
          border: 1px solid rgba(90, 159, 212, 0.3);
          border-radius: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <div>
            <div style="font-weight: bold; color: #5a9fd4; margin-bottom: 5px;">
              ${backup.filename}
            </div>
            <div style="font-size: 0.9em; color: #999;">
              📅 ${new Date(backup.created).toLocaleString('ru-RU')} | 💾 ${backup.sizeFormatted}
            </div>
          </div>
          <button
            onclick="restoreBackup('${backup.filename}')"
            style="
              background: rgba(255, 152, 0, 0.7);
              color: #fff;
              border: 1px solid #ff9800;
              padding: 8px 16px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 0.9em;
              transition: all 0.3s ease;
            "
            onmouseover="this.style.background='rgba(255, 152, 0, 1)'"
            onmouseout="this.style.background='rgba(255, 152, 0, 0.7)'"
          >
            📥 Восстановить
          </button>
        </div>
      `).join('');
    }

    document.getElementById("restoreDBModal").style.display = "flex";
  } catch (error) {
    console.error("Ошибка при загрузке списка бэкапов:", error);
    alert("❌ Ошибка при загрузке списка бэкапов");
  }
}

// Закрыть модальное окно восстановления БД
function closeRestoreDBModal() {
  document.getElementById("restoreDBModal").style.display = "none";
}

// Переменная для хранения выбранного бэкапа
let selectedBackupFilename = null;
// Переменная для хранения последнего созданного бэкапа
let lastCreatedBackupFilename = null;
// Переменная для хранения статуса защиты выбранного бэкапа
let selectedBackupIsProtected = false;

// Открыть модальное окно управления БД
async function openDatabaseModal() {
  if (!canAccessDatabasePanel() && !isAdmin()) {
    await showCustomAlert("У вас нет прав для управления БД", "Ошибка", "❌");
    return;
  }
  
  // Отправляем уведомление админу если модератор открыл панель управления БД
  if (currentUser && !isAdmin()) {
    try {
      await fetch('/api/admin/notify-database-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUser.username,
          userId: currentUser.id
        })
      });
    } catch (error) {
      console.error('⚠️ Не удалось отправить уведомление о доступе к БД:', error);
    }
  }

  // Блокируем скролл body
  document.body.style.overflow = 'hidden';

  // Сбрасываем выбор
  selectedBackupFilename = null;
  updateBackupButtons();

  try {
    const response = await fetch("/api/admin/backups");
    const backups = await response.json();

    const backupsList = document.getElementById("databaseBackupsList");
    
    // Вычисляем общий размер всех бэкапов
    const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
    const totalSizeFormatted = (totalSize / 1024 / 1024).toFixed(2) + ' MB';
    
    if (backups.length === 0) {
      backupsList.innerHTML = '<div class="empty-message">Нет доступных бэкапов</div>';
      // Обновляем заголовок без общего размера
      document.getElementById("backupsListHeader").innerHTML = `
        <h3 style="color: #5a9fd4; margin: 0;">📦 Доступные бэкапы (выберите один):</h3>
      `;
    } else {
      // Обновляем заголовок с общим размером
      document.getElementById("backupsListHeader").innerHTML = `
        <h3 style="color: #5a9fd4; margin: 0;">📦 Доступные бэкапы (выберите один):</h3>
        <div style="color: #999; font-size: 0.9em;">
          Всего: <strong style="color: #5a9fd4;">${backups.length}</strong> | 
          Общий размер: <strong style="color: #5a9fd4;">${totalSizeFormatted}</strong>
        </div>
      `;
      
      backupsList.innerHTML = backups.map((backup, index) => {
        const isNew = backup.filename === lastCreatedBackupFilename;
        const isLocked = backup.isLocked || false;
        
        return `
        <div 
          class="backup-item${isNew ? ' new-backup' : ''}"
          data-filename="${backup.filename}"
          data-locked="${isLocked}"
          onclick="selectBackup('${backup.filename}', ${isLocked})"
          style="
            padding: 15px;
            margin-bottom: 10px;
            background: rgba(30, 34, 44, 0.6);
            border: 2px solid ${isNew ? 'rgba(76, 175, 80, 0.6)' : 'rgba(90, 159, 212, 0.3)'};
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            position: relative;
          "
          onmouseover="if(!this.classList.contains('selected')) this.style.borderColor='${isNew ? 'rgba(76, 175, 80, 0.8)' : 'rgba(90, 159, 212, 0.6)'}'"
          onmouseout="if(!this.classList.contains('selected')) this.style.borderColor='${isNew ? 'rgba(76, 175, 80, 0.6)' : 'rgba(90, 159, 212, 0.3)'}'"
        >
          <div style="display: flex; justify-content: space-between; align-items: start; gap: 10px;">
            <div style="flex: 1;">
              ${isNew ? '<div style="position: absolute; top: 10px; right: 10px; background: rgba(76, 175, 80, 0.9); color: #fff; padding: 4px 12px; border-radius: 12px; font-size: 0.75em; font-weight: bold; animation: pulse 2s infinite;">NEW</div>' : ''}
              <div style="font-weight: bold; color: ${isNew ? '#4caf50' : '#5a9fd4'}; margin-bottom: 5px;">
                ${backup.filename}
              </div>
              <div style="font-size: 0.9em; color: #999;">
                📅 ${new Date(backup.created).toLocaleString('ru-RU')} | 💾 ${backup.sizeFormatted}
              </div>
              ${backup.createdBy !== 'unknown' ? `<div style="font-size: 0.85em; color: #888; margin-top: 3px;">👤 ${backup.createdBy}</div>` : ''}
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end; position: relative;">
              ${isLocked ? '<div style="background: rgba(255, 193, 7, 0.2); color: #ffc107; padding: 3px 8px; border-radius: 6px; font-size: 0.75em; white-space: nowrap;">🔒 Заблокирован</div>' : ''}
              ${isAdmin() ? `<button 
                class="backup-lock-btn"
                onclick="event.stopPropagation(); toggleBackupLock('${backup.filename}', ${isLocked})"
                style="
                  background: ${isLocked ? 'rgba(76, 175, 80, 0.7)' : 'transparent'};
                  color: ${isLocked ? '#fff' : 'rgb(255, 255, 255)'};
                  border: ${isLocked ? '1px solid #4caf50' : 'medium'};
                  padding: 4px 10px;
                  border-radius: 6px;
                  cursor: pointer;
                  font-size: ${isLocked ? '0.7em' : '0.9em'};
                  transition: ${isLocked ? 'all 0.3s ease' : '0.3s'};
                  white-space: nowrap;
                  opacity: 0;
                  box-shadow: none;
                  pointer-events: none;
                  position: absolute;
                  right: 0;
                  bottom: 0;
                "
                title="${isLocked ? 'Разблокировать бэкап' : 'Заблокировать бэкап'}"
              >
                ${isLocked ? '🔓 Разблокировать' : '🔒'}
              </button>` : ''}
            </div>
          </div>
        </div>
      `}).join('');
    }

    document.getElementById("databaseModal").style.display = "flex";
    
    // Скрываем кнопку "Создать бэкап" если нет прав
    const createBackupBtn = document.querySelector('[onclick="backupDatabase()"]');
    if (createBackupBtn) {
      if (!canBackupDB()) {
        createBackupBtn.style.display = 'none';
      } else {
        createBackupBtn.style.display = 'inline-block';
      }
    }
  } catch (error) {
    console.error("Ошибка при загрузке списка бэкапов:", error);
    await showCustomAlert("Ошибка при загрузке списка бэкапов", "Ошибка", "❌");
    // Разблокируем скролл при ошибке
    document.body.style.overflow = '';
  }
}

// Закрыть модальное окно управления БД
function closeDatabaseModal() {
  document.getElementById("databaseModal").style.display = "none";
  selectedBackupFilename = null;
  // Разблокируем скролл body
  document.body.style.overflow = '';
}

// Выбрать бэкап
function selectBackup(filename, isLocked = false) {
  selectedBackupFilename = filename;
  selectedBackupIsProtected = isLocked;
  
  // Убираем выделение со всех элементов и скрываем кнопки блокировки
  document.querySelectorAll('.backup-item').forEach(item => {
    item.classList.remove('selected');
    item.style.borderColor = 'rgba(90, 159, 212, 0.3)';
    item.style.background = 'rgba(30, 34, 44, 0.6)';
    
    // Скрываем кнопку блокировки
    const lockBtn = item.querySelector('.backup-lock-btn');
    if (lockBtn) {
      lockBtn.style.opacity = '0';
      lockBtn.style.pointerEvents = 'none';
    }
  });
  
  // Выделяем выбранный элемент и показываем кнопку блокировки
  const selectedItem = document.querySelector(`[data-filename="${filename}"]`);
  if (selectedItem) {
    selectedItem.classList.add('selected');
    selectedItem.style.borderColor = '#5a9fd4';
    selectedItem.style.background = 'rgba(90, 159, 212, 0.2)';
    
    // Показываем кнопку блокировки
    const lockBtn = selectedItem.querySelector('.backup-lock-btn');
    if (lockBtn) {
      lockBtn.style.opacity = '1';
      lockBtn.style.pointerEvents = 'auto';
    }
  }
  
  updateBackupButtons();
}

// Обновить состояние кнопок
function updateBackupButtons() {
  const restoreBtn = document.getElementById('restoreBackupBtn');
  const downloadBtn = document.getElementById('downloadBackupBtn');
  const deleteBtn = document.getElementById('deleteBackupBtn');
  
  // Проверяем права и скрываем кнопки если нет прав
  if (!canRestoreDB()) {
    restoreBtn.style.display = 'none';
  } else {
    restoreBtn.style.display = 'inline-block';
  }
  
  if (!canDownloadBackup()) {
    downloadBtn.style.display = 'none';
  } else {
    downloadBtn.style.display = 'inline-block';
  }
  
  if (!canDeleteBackup()) {
    deleteBtn.style.display = 'none';
  } else {
    deleteBtn.style.display = 'inline-block';
  }
  
  if (selectedBackupFilename) {
    // Активируем кнопки если есть права
    if (canRestoreDB()) {
      restoreBtn.disabled = false;
      restoreBtn.style.background = 'rgba(255, 152, 0, 0.7)';
      restoreBtn.style.color = '#fff';
      restoreBtn.style.border = '1px solid #ff9800';
      restoreBtn.style.cursor = 'pointer';
    }
    
    if (canDownloadBackup()) {
      downloadBtn.disabled = false;
      downloadBtn.style.background = 'rgba(90, 159, 212, 0.7)';
      downloadBtn.style.color = '#e0e6f0';
      downloadBtn.style.border = '1px solid #3a7bd5';
      downloadBtn.style.cursor = 'pointer';
    }
    
    // Кнопка удаления - блокируем если бэкап защищен или нет прав
    if (canDeleteBackup()) {
      if (selectedBackupIsProtected) {
        deleteBtn.disabled = true;
        deleteBtn.style.background = 'rgba(244, 67, 54, 0.3)';
        deleteBtn.style.color = '#999';
        deleteBtn.style.border = '1px solid #666';
        deleteBtn.style.cursor = 'not-allowed';
        deleteBtn.title = 'Этот бэкап защищен от удаления';
      } else {
        deleteBtn.disabled = false;
        deleteBtn.style.background = 'rgba(244, 67, 54, 0.7)';
        deleteBtn.style.color = '#ffb3b3';
        deleteBtn.style.border = '1px solid #f44336';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.title = '';
      }
    }
  } else {
    // Деактивируем кнопки
    if (canRestoreDB()) {
      restoreBtn.disabled = true;
      restoreBtn.style.background = 'rgba(255, 152, 0, 0.3)';
      restoreBtn.style.color = '#999';
      restoreBtn.style.border = '1px solid #666';
      restoreBtn.style.cursor = 'not-allowed';
    }
    
    if (canDownloadBackup()) {
      downloadBtn.disabled = true;
      downloadBtn.style.background = 'rgba(90, 159, 212, 0.3)';
      downloadBtn.style.color = '#999';
      downloadBtn.style.border = '1px solid #666';
      downloadBtn.style.cursor = 'not-allowed';
    }
    
    if (canDeleteBackup()) {
      deleteBtn.disabled = true;
      deleteBtn.style.background = 'rgba(244, 67, 54, 0.3)';
      deleteBtn.style.color = '#999';
      deleteBtn.style.border = '1px solid #666';
      deleteBtn.style.cursor = 'not-allowed';
    }
  }
}

// Восстановить выбранный бэкап
async function restoreSelectedBackup() {
  if (!selectedBackupFilename) {
    await showCustomAlert("Выберите бэкап для восстановления", "Ошибка", "❌");
    return;
  }
  
  const confirmed = await showCustomConfirm(
    `Вы уверены что хотите восстановить БД из бэкапа?\n\n<strong style="color: #5a9fd4;">${selectedBackupFilename}</strong>\n\n<div style="color: #ff9800; margin-top: 10px;">⚠️ Текущая БД будет заменена. Все текущие данные будут потеряны!</div>\n\n<div style="color: #4caf50; margin-top: 10px;">✓ Перед восстановлением будет создан бэкап текущей БД.</div>`,
    "Восстановление БД",
    "⚠️"
  );

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch("/api/admin/restore-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        filename: selectedBackupFilename,
        username: currentUser.username 
      })
    });

    const data = await response.json();

    if (data.success) {
      await showCustomAlert(
        `<div style="margin-bottom: 10px;">БД успешно восстановлена!</div>
        <div style="color: #5a9fd4;">📥 Восстановлено из: <strong>${data.restored_from}</strong></div>
        <div style="color: #4caf50; margin-top: 5px;">💾 Создан бэкап текущей БД: <strong>${data.backup_created}</strong></div>
        <div style="color: #ff9800; margin-top: 10px;">Страница будет перезагружена...</div>`,
        "Успешно",
        "✅"
      );
      closeDatabaseModal();
      
      // Полностью очищаем localStorage, чтобы все данные загрузились из восстановленной БД
      // Пользователь должен будет заново войти
      localStorage.clear();
      
      setTimeout(() => window.location.reload(), 500);
    } else {
      await showCustomAlert(data.error, "Ошибка при восстановлении БД", "❌");
    }
  } catch (error) {
    console.error("Ошибка при восстановлении БД:", error);
    await showCustomAlert(error.message, "Ошибка при восстановлении БД", "❌");
  }
}

// Скачать выбранный бэкап
function downloadSelectedBackup() {
  if (!selectedBackupFilename) {
    showCustomAlert("Выберите бэкап для скачивания", "Ошибка", "❌");
    return;
  }
  
  window.location.href = `/download-backup/${selectedBackupFilename}?username=${encodeURIComponent(currentUser.username)}`;
}

// Заблокировать/разблокировать бэкап (только для админа)
async function toggleBackupLock(filename, currentLockStatus) {
  if (!isAdmin()) {
    await showCustomAlert("Только админ может блокировать/разблокировать бэкапы", "Ошибка", "❌");
    return;
  }

  const action = currentLockStatus ? 'разблокировать' : 'заблокировать';
  const confirmed = await showCustomConfirm(
    `Вы уверены что хотите ${action} бэкап?\n\n<strong style="color: #5a9fd4;">${filename}</strong>\n\n${currentLockStatus ? '<div style="color: #4caf50; margin-top: 10px;">После разблокировки бэкап можно будет удалить.</div>' : '<div style="color: #ffc107; margin-top: 10px;">⚠️ Заблокированный бэкап нельзя будет удалить до разблокировки.</div>'}`,
    currentLockStatus ? "Разблокировка бэкапа" : "Блокировка бэкапа",
    "🔒"
  );

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch("/api/admin/toggle-backup-lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        filename: filename,
        username: currentUser.username 
      })
    });

    const data = await response.json();

    if (data.success) {
      // Перезагружаем список бэкапов
      await openDatabaseModal();
    } else {
      await showCustomAlert(data.error, "Ошибка при изменении блокировки", "❌");
    }
  } catch (error) {
    console.error("Ошибка при изменении блокировки бэкапа:", error);
    await showCustomAlert(error.message, "Ошибка при изменении блокировки бэкапа", "❌");
  }
}

// Удалить выбранный бэкап
async function deleteSelectedBackup() {
  if (!selectedBackupFilename) {
    await showCustomAlert("Выберите бэкап для удаления", "Ошибка", "❌");
    return;
  }
  
  // Проверяем права
  if (!isAdmin() && !hasPermission('delete_backup')) {
    await showCustomAlert("У вас нет прав для удаления бэкапов", "Ошибка", "❌");
    return;
  }
  
  const confirmed = await showCustomConfirm(
    `Вы уверены что хотите удалить бэкап?\n\n<strong style="color: #5a9fd4;">${selectedBackupFilename}</strong>\n\n<div style="color: #f44336; margin-top: 10px;">⚠️ Это действие нельзя отменить!</div>`,
    "Удаление бэкапа",
    "🗑️"
  );

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch("/api/admin/delete-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        filename: selectedBackupFilename,
        username: currentUser.username 
      })
    });

    const data = await response.json();

    if (data.success) {
      // Убираем алерт об успешном удалении
      selectedBackupFilename = null;
      // Перезагружаем список бэкапов
      openDatabaseModal();
    } else {
      await showCustomAlert(data.error, "Ошибка при удалении бэкапа", "❌");
    }
  } catch (error) {
    console.error("Ошибка при удалении бэкапа:", error);
    await showCustomAlert(error.message, "Ошибка при удалении бэкапа", "❌");
  }
}

// Восстановить БД из модалки управления БД (старая функция, оставляем для совместимости)
async function restoreBackupFromModal(filename) {
  selectedBackupFilename = filename;
  await restoreSelectedBackup();
}


// Восстановить БД из бэкапа
async function restoreBackup(filename) {
  const confirmed = confirm(
    `⚠️ ВНИМАНИЕ!\n\nВы уверены что хотите восстановить БД из бэкапа?\n\n${filename}\n\nТекущая БД будет заменена. Все текущие данные будут потеряны!\n\nПеред восстановлением будет создан бэкап текущей БД.`
  );

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch("/api/admin/restore-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        filename,
        username: currentUser.username 
      })
    });

    const data = await response.json();

    if (data.success) {
      alert(
        `✅ БД успешно восстановлена!\n\nВосстановлено из: ${data.restored_from}\nСоздан бэкап текущей БД: ${data.backup_created}\n\nСтраница будет перезагружена.`
      );
      closeRestoreDBModal();
      // Перезагружаем страницу чтобы обновить данные
      setTimeout(() => window.location.reload(), 1000);
    } else {
      alert(`❌ Ошибка при восстановлении БД: ${data.error}`);
    }
  } catch (error) {
    console.error("Ошибка при восстановлении БД:", error);
    alert(`❌ Ошибка при восстановлении БД:\n${error.message}`);
  }
}

// Проверить orphaned данные в БД
async function checkOrphanedData() {
  if (!canManageOrphaned()) {
    await showCustomAlert("У вас нет прав для проверки orphaned данных", "Доступ запрещён", "❌");
    return;
  }

  try {
    const btn = document.querySelector('[onclick="checkOrphanedData()"]');
    const originalText = btn ? btn.textContent : '';
    if (btn) {
      btn.textContent = "⏳ Проверка...";
      btn.disabled = true;
    }

    // Используем currentUser.username - сервер проверит права
    const response = await fetch(
      `/api/admin/orphaned-data?username=${encodeURIComponent(
        currentUser.username
      )}`
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    const totalOrphaned = data.total_orphaned;
    const totalCount =
      totalOrphaned.matches +
      totalOrphaned.bets +
      totalOrphaned.final_bets +
      totalOrphaned.reminders +
      totalOrphaned.awards +
      totalOrphaned.final_parameters;

    if (totalCount === 0) {
      await showCustomAlert(
        '<div style="text-align: center; padding: 20px;">' +
        '<div style="font-size: 3em; margin-bottom: 15px;">✅</div>' +
        '<div style="font-size: 1.2em; color: #4caf50; font-weight: 600; margin-bottom: 10px;">БД ЧИСТАЯ!</div>' +
        '<div style="color: #b0b8c8;">Orphaned данных не найдено</div>' +
        '</div>',
        "Проверка завершена",
        "✅"
      );
    } else {
      const message = 
        '<div style="padding: 10px;">' +
        '<div style="font-size: 1.1em; color: #ff9800; font-weight: 600; margin-bottom: 15px; text-align: center;">⚠️ Найдено ' + totalCount + ' orphaned записей</div>' +
        '<div style="background: rgba(255, 255, 255, 0.05); padding: 15px; border-radius: 8px; margin-bottom: 15px;">' +
        '<div style="display: grid; grid-template-columns: 1fr auto; gap: 10px; font-size: 0.95em;">' +
        '<div style="color: #e0e6f0;">🔴 Матчи без события:</div><div style="color: #f44336; font-weight: 600; text-align: right;">' + totalOrphaned.matches + '</div>' +
        '<div style="color: #e0e6f0;">🔴 Ставки на удалённые матчи:</div><div style="color: #f44336; font-weight: 600; text-align: right;">' + totalOrphaned.bets + '</div>' +
        '<div style="color: #e0e6f0;">🔴 Финальные ставки:</div><div style="color: #f44336; font-weight: 600; text-align: right;">' + totalOrphaned.final_bets + '</div>' +
        '<div style="color: #e0e6f0;">🔴 Напоминания:</div><div style="color: #f44336; font-weight: 600; text-align: right;">' + totalOrphaned.reminders + '</div>' +
        '<div style="color: #e0e6f0;">🔴 Награды:</div><div style="color: #f44336; font-weight: 600; text-align: right;">' + totalOrphaned.awards + '</div>' +
        '<div style="color: #e0e6f0;">🔴 Параметры финала:</div><div style="color: #f44336; font-weight: 600; text-align: right;">' + totalOrphaned.final_parameters + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="color: #b0b8c8; font-size: 0.9em; text-align: center; line-height: 1.5;">Очистить orphaned данные?<br/><span style="color: #888;">(Это удалит все найденные orphaned данные из БД)</span></div>' +
        '</div>';

      const confirmed = await showCustomConfirm(message, "Очистка orphaned данных", "⚠️");
      if (confirmed) {
        cleanupOrphanedData();
      }
    }
  } catch (error) {
    console.error("Ошибка при проверке orphaned данных:", error);
    await showCustomAlert(`Ошибка при проверке orphaned данных:\n${error.message}`, "Ошибка", "❌");
  } finally {
    const btn = document.querySelector('[onclick="checkOrphanedData()"]');
    if (btn) {
      btn.textContent = "🔍 Проверить orphaned";
      btn.disabled = false;
    }
  }
}

// Очистить orphaned данные в БД
async function cleanupOrphanedData() {
  if (!canManageOrphaned()) {
    alert("❌ У вас нет прав для очистки orphaned данных");
    return;
  }

  try {
    const btn = document.querySelector('[onclick="checkOrphanedData()"]');
    btn.textContent = "⏳ Очистка...";
    btn.disabled = true;

    const response = await fetch("/api/admin/cleanup-orphaned-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser.username,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    let message = `✅ ORPHANED ДАННЫЕ УДАЛЕНЫ:\n\n`;
    message += `🗑️  Матчи: ${data.deleted.matches || 0}\n`;
    message += `🗑️  Ставки: ${data.deleted.bets || 0}\n`;
    message += `🗑️  Финальные ставки: ${data.deleted.final_bets || 0}\n`;
    message += `🗑️  Напоминания: ${data.deleted.reminders || 0}\n`;
    message += `🗑️  Награды: ${data.deleted.awards || 0}\n`;
    message += `🗑️  Параметры финала: ${
      data.deleted.final_parameters || 0
    }\n\n`;
    message += `БД успешно очищена!`;

    alert(message);
  } catch (error) {
    console.error("Ошибка при очистке orphaned данных:", error);
    alert(`❌ Ошибка при очистке orphaned данных:\n${error.message}`);
  } finally {
    const btn = document.querySelector('[onclick="checkOrphanedData()"]');
    if (btn) {
      btn.textContent = "🔍 Проверить orphaned";
      btn.disabled = false;
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
        <div style="flex: 1;">
          <div style="color: #e0e0e0; font-weight: bold;">${
            mod.username
          }</div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button
            onclick="openEditModeratorModal(${mod.id}, '${mod.username}', ${JSON.stringify(mod.permissions || []).replace(/"/g, '&quot;')})"
            style="
              background: rgba(90, 159, 212, 0.7);
              color: #e0e6f0;
              border: 1px solid #3a7bd5;
              padding: 8px 16px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 0.9em;
            "
            onmouseover="this.style.transform='scale(1.05)'"
            onmouseout="this.style.transform='scale(1)'"
          >
            ✏️ Изменить
          </button>
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

      // Исключаем пользователей без telegram_username (не связали профиль с ботом)
      if (!user.telegram_username) {
        return; // Пропускаем если не привязан Telegram
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
    create_matches: "создание матчей",
    edit_matches: "редактирование матчей",
    delete_matches: "удаление матчей",
    manage_results: "результаты",
    manage_tournaments: "турниры (блокировка)",
    edit_tournaments: "редактирование турниров",
    delete_tournaments: "удаление турниров",
    create_tournaments: "создание турниров",
    view_logs: "логи",
    view_counting: "подсчет результатов",
    manage_db: "управление БД",
    backup_db: "создание бэкапов",
    download_backup: "скачивание бэкапов",
    restore_db: "восстановление БД",
    delete_backup: "удаление бэкапов",
    manage_orphaned: "orphaned данные",
    view_users: "пользователи",
    check_bot: "проверка бота",
    view_settings: "настройки пользователей",
    sync_telegram_ids: "синхронизация Telegram ID",
    edit_users: "редактирование пользователей",
    delete_users: "удаление пользователей",
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
  if (document.getElementById("permCreateMatches").checked)
    permissions.push("create_matches");
  if (document.getElementById("permEditMatches").checked)
    permissions.push("edit_matches");
  if (document.getElementById("permDeleteMatches").checked)
    permissions.push("delete_matches");
  if (document.getElementById("permManageResults").checked)
    permissions.push("manage_results");
  if (document.getElementById("permManageTournaments").checked)
    permissions.push("manage_tournaments");
  if (document.getElementById("permEditTournaments").checked)
    permissions.push("edit_tournaments");
  if (document.getElementById("permDeleteTournaments").checked)
    permissions.push("delete_tournaments");
  if (document.getElementById("permCreateTournaments").checked)
    permissions.push("create_tournaments");
  if (document.getElementById("permViewLogs").checked)
    permissions.push("view_logs");
  if (document.getElementById("permViewCounting").checked)
    permissions.push("view_counting");
  if (document.getElementById("permManageDB").checked)
    permissions.push("manage_db");
  if (document.getElementById("permBackupDB").checked)
    permissions.push("backup_db");
  if (document.getElementById("permDownloadBackup").checked)
    permissions.push("download_backup");
  if (document.getElementById("permRestoreDB").checked)
    permissions.push("restore_db");
  if (document.getElementById("permDeleteBackup").checked)
    permissions.push("delete_backup");
  if (document.getElementById("permManageOrphaned").checked)
    permissions.push("manage_orphaned");
  if (document.getElementById("permViewUsers").checked)
    permissions.push("view_users");
  if (document.getElementById("permCheckBot").checked)
    permissions.push("check_bot");
  if (document.getElementById("permViewSettings").checked)
    permissions.push("view_settings");
  if (document.getElementById("permSyncTelegramIds").checked)
    permissions.push("sync_telegram_ids");
  if (document.getElementById("permEditUsers").checked)
    permissions.push("edit_users");
  if (document.getElementById("permDeleteUsers").checked)
    permissions.push("delete_users");

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
      document.getElementById("permCreateMatches").checked = false;
      document.getElementById("permEditMatches").checked = false;
      document.getElementById("permDeleteMatches").checked = false;
      document.getElementById("permManageResults").checked = false;
      document.getElementById("permManageTournaments").checked = false;
      document.getElementById("permEditTournaments").checked = false;
      document.getElementById("permDeleteTournaments").checked = false;
      document.getElementById("permCreateTournaments").checked = false;
      document.getElementById("permViewLogs").checked = false;
      document.getElementById("permViewCounting").checked = false;
      document.getElementById("permManageDB").checked = false;
      document.getElementById("permBackupDB").checked = false;
      document.getElementById("permDownloadBackup").checked = false;
      document.getElementById("permRestoreDB").checked = false;
      document.getElementById("permDeleteBackup").checked = false;
      document.getElementById("permManageOrphaned").checked = false;
      document.getElementById("permViewUsers").checked = false;
      document.getElementById("permCheckBot").checked = false;
      document.getElementById("permViewSettings").checked = false;
      document.getElementById("permSyncTelegramIds").checked = false;
      document.getElementById("permEditUsers").checked = false;
      document.getElementById("permDeleteUsers").checked = false;
      document.getElementById("userSubPermissions").style.display = "none";
      document.getElementById("dbSubPermissions").style.display = "none";
      document.getElementById("matchesSubPermissions").style.display = "none";
      document.getElementById("tournamentsSubPermissions").style.display = "none";

      // Перезагружаем список
      loadModeratorsList();
      loadUsersList();
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
      loadUsersList(); // Обновляем селект пользователей
    } else {
      alert(`❌ Ошибка: ${data.error || "Неизвестная ошибка"}`);
    }
  } catch (error) {
    console.error("Ошибка при удалении модератора:", error);
    alert(`❌ Ошибка при удалении модератора: ${error.message}`);
  }
}

// Глобальная переменная для хранения ID редактируемого модератора
let editingModeratorId = null;

// Открыть модальное окно редактирования прав модератора
function openEditModeratorModal(moderatorId, username, permissions) {
  editingModeratorId = moderatorId;
  
  // Устанавливаем имя пользователя
  document.getElementById("editModeratorUsername").textContent = `Модератор: ${username}`;
  
  // Очищаем все чекбоксы
  document.getElementById("editPermManageMatches").checked = false;
  document.getElementById("editPermCreateMatches").checked = false;
  document.getElementById("editPermEditMatches").checked = false;
  document.getElementById("editPermDeleteMatches").checked = false;
  document.getElementById("editPermManageResults").checked = false;
  document.getElementById("editPermManageTournaments").checked = false;
  document.getElementById("editPermEditTournaments").checked = false;
  document.getElementById("editPermDeleteTournaments").checked = false;
  document.getElementById("editPermCreateTournaments").checked = false;
  document.getElementById("editPermViewLogs").checked = false;
  document.getElementById("editPermViewCounting").checked = false;
  document.getElementById("editPermManageDB").checked = false;
  document.getElementById("editPermBackupDB").checked = false;
  document.getElementById("editPermDownloadBackup").checked = false;
  document.getElementById("editPermRestoreDB").checked = false;
  document.getElementById("editPermDeleteBackup").checked = false;
  document.getElementById("editPermManageOrphaned").checked = false;
  document.getElementById("editPermViewUsers").checked = false;
  document.getElementById("editPermCheckBot").checked = false;
  document.getElementById("editPermViewSettings").checked = false;
  document.getElementById("editPermSyncTelegramIds").checked = false;
  document.getElementById("editPermEditUsers").checked = false;
  document.getElementById("editPermDeleteUsers").checked = false;
  document.getElementById("editUserSubPermissions").style.display = "none";
  document.getElementById("editDBSubPermissions").style.display = "none";
  document.getElementById("editMatchesSubPermissions").style.display = "none";
  document.getElementById("editTournamentsSubPermissions").style.display = "none";
  
  // Устанавливаем текущие права
  if (Array.isArray(permissions)) {
    if (permissions.includes("manage_matches")) {
      document.getElementById("editPermManageMatches").checked = true;
      document.getElementById("editMatchesSubPermissions").style.display = "block";
    }
    if (permissions.includes("create_matches")) {
      document.getElementById("editPermCreateMatches").checked = true;
    }
    if (permissions.includes("edit_matches")) {
      document.getElementById("editPermEditMatches").checked = true;
    }
    if (permissions.includes("delete_matches")) {
      document.getElementById("editPermDeleteMatches").checked = true;
    }
    if (permissions.includes("manage_results")) {
      document.getElementById("editPermManageResults").checked = true;
    }
    if (permissions.includes("manage_tournaments")) {
      document.getElementById("editPermManageTournaments").checked = true;
      document.getElementById("editTournamentsSubPermissions").style.display = "block";
    }
    if (permissions.includes("edit_tournaments")) {
      document.getElementById("editPermEditTournaments").checked = true;
    }
    if (permissions.includes("delete_tournaments")) {
      document.getElementById("editPermDeleteTournaments").checked = true;
    }
    if (permissions.includes("create_tournaments")) {
      document.getElementById("editPermCreateTournaments").checked = true;
    }
    if (permissions.includes("view_logs")) {
      document.getElementById("editPermViewLogs").checked = true;
    }
    if (permissions.includes("view_counting")) {
      document.getElementById("editPermViewCounting").checked = true;
    }
    if (permissions.includes("manage_db")) {
      document.getElementById("editPermManageDB").checked = true;
      document.getElementById("editDBSubPermissions").style.display = "block";
    }
    if (permissions.includes("backup_db")) {
      document.getElementById("editPermBackupDB").checked = true;
    }
    if (permissions.includes("download_backup")) {
      document.getElementById("editPermDownloadBackup").checked = true;
    }
    if (permissions.includes("restore_db")) {
      document.getElementById("editPermRestoreDB").checked = true;
    }
    if (permissions.includes("delete_backup")) {
      document.getElementById("editPermDeleteBackup").checked = true;
    }
    if (permissions.includes("manage_orphaned")) {
      document.getElementById("editPermManageOrphaned").checked = true;
    }
    if (permissions.includes("view_users")) {
      document.getElementById("editPermViewUsers").checked = true;
      document.getElementById("editUserSubPermissions").style.display = "block";
    }
    if (permissions.includes("check_bot")) {
      document.getElementById("editPermCheckBot").checked = true;
    }
    if (permissions.includes("view_settings")) {
      document.getElementById("editPermViewSettings").checked = true;
    }
    if (permissions.includes("sync_telegram_ids")) {
      document.getElementById("editPermSyncTelegramIds").checked = true;
    }
    if (permissions.includes("edit_users")) {
      document.getElementById("editPermEditUsers").checked = true;
    }
    if (permissions.includes("delete_users")) {
      document.getElementById("editPermDeleteUsers").checked = true;
    }
  }
  
  // Показываем модальное окно
  document.getElementById("editModeratorModal").style.display = "flex";
}

// Закрыть модальное окно редактирования прав модератора
function closeEditModeratorModal() {
  document.getElementById("editModeratorModal").style.display = "none";
  editingModeratorId = null;
}

// Переключить видимость подчекбоксов пользователей (форма назначения)
function toggleUserSubPermissions() {
  const viewUsersCheckbox = document.getElementById("permViewUsers");
  const subPermissionsDiv = document.getElementById("userSubPermissions");
  
  if (viewUsersCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    // Автоматически выбираем все подчекбоксы
    document.getElementById("permCheckBot").checked = true;
    document.getElementById("permViewSettings").checked = true;
    document.getElementById("permSyncTelegramIds").checked = true;
    document.getElementById("permEditUsers").checked = true;
    document.getElementById("permDeleteUsers").checked = true;
  } else {
    subPermissionsDiv.style.display = "none";
    // Снимаем все подчекбоксы
    document.getElementById("permCheckBot").checked = false;
    document.getElementById("permViewSettings").checked = false;
    document.getElementById("permSyncTelegramIds").checked = false;
    document.getElementById("permEditUsers").checked = false;
    document.getElementById("permDeleteUsers").checked = false;
  }
}

// Переключить видимость подчекбоксов БД (форма назначения)
function toggleDBSubPermissions() {
  const manageDBCheckbox = document.getElementById("permManageDB");
  const subPermissionsDiv = document.getElementById("dbSubPermissions");
  
  if (manageDBCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    // Автоматически выбираем все подчекбоксы
    document.getElementById("permBackupDB").checked = true;
    document.getElementById("permDownloadBackup").checked = true;
    document.getElementById("permRestoreDB").checked = true;
    document.getElementById("permDeleteBackup").checked = true;
  } else {
    subPermissionsDiv.style.display = "none";
    // Снимаем все подчекбоксы
    document.getElementById("permBackupDB").checked = false;
    document.getElementById("permDownloadBackup").checked = false;
    document.getElementById("permRestoreDB").checked = false;
    document.getElementById("permDeleteBackup").checked = false;
  }
}

// Переключить видимость подчекбоксов матчей (форма назначения)
function toggleMatchesSubPermissions() {
  const manageMatchesCheckbox = document.getElementById("permManageMatches");
  const subPermissionsDiv = document.getElementById("matchesSubPermissions");
  
  if (manageMatchesCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    // Автоматически выбираем все подчекбоксы
    document.getElementById("permCreateMatches").checked = true;
    document.getElementById("permEditMatches").checked = true;
    document.getElementById("permDeleteMatches").checked = true;
  } else {
    subPermissionsDiv.style.display = "none";
    // Снимаем все подчекбоксы
    document.getElementById("permCreateMatches").checked = false;
    document.getElementById("permEditMatches").checked = false;
    document.getElementById("permDeleteMatches").checked = false;
  }
}

// Переключить видимость подчекбоксов турниров (форма назначения)
function toggleTournamentsSubPermissions() {
  const manageTournamentsCheckbox = document.getElementById("permManageTournaments");
  const subPermissionsDiv = document.getElementById("tournamentsSubPermissions");
  
  if (manageTournamentsCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    // Автоматически выбираем все подчекбоксы
    document.getElementById("permEditTournaments").checked = true;
    document.getElementById("permDeleteTournaments").checked = true;
    document.getElementById("permCreateTournaments").checked = true;
  } else {
    subPermissionsDiv.style.display = "none";
    // Снимаем все подчекбоксы
    document.getElementById("permEditTournaments").checked = false;
    document.getElementById("permDeleteTournaments").checked = false;
    document.getElementById("permCreateTournaments").checked = false;
  }
}

// Переключить видимость подчекбоксов пользователей (форма редактирования)
function toggleEditUserSubPermissions() {
  const viewUsersCheckbox = document.getElementById("editPermViewUsers");
  const subPermissionsDiv = document.getElementById("editUserSubPermissions");
  
  if (viewUsersCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    // Автоматически выбираем все подчекбоксы
    document.getElementById("editPermCheckBot").checked = true;
    document.getElementById("editPermViewSettings").checked = true;
    document.getElementById("editPermSyncTelegramIds").checked = true;
    document.getElementById("editPermEditUsers").checked = true;
    document.getElementById("editPermDeleteUsers").checked = true;
  } else {
    subPermissionsDiv.style.display = "none";
    // Снимаем все подчекбоксы
    document.getElementById("editPermCheckBot").checked = false;
    document.getElementById("editPermViewSettings").checked = false;
    document.getElementById("editPermSyncTelegramIds").checked = false;
    document.getElementById("editPermEditUsers").checked = false;
    document.getElementById("editPermDeleteUsers").checked = false;
  }
}

// Переключить видимость подчекбоксов БД (форма редактирования)
function toggleEditDBSubPermissions() {
  const manageDBCheckbox = document.getElementById("editPermManageDB");
  const subPermissionsDiv = document.getElementById("editDBSubPermissions");
  
  if (manageDBCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    // Автоматически выбираем все подчекбоксы
    document.getElementById("editPermBackupDB").checked = true;
    document.getElementById("editPermDownloadBackup").checked = true;
    document.getElementById("editPermRestoreDB").checked = true;
    document.getElementById("editPermDeleteBackup").checked = true;
  } else {
    subPermissionsDiv.style.display = "none";
    // Снимаем все подчекбоксы
    document.getElementById("editPermBackupDB").checked = false;
    document.getElementById("editPermDownloadBackup").checked = false;
    document.getElementById("editPermRestoreDB").checked = false;
    document.getElementById("editPermDeleteBackup").checked = false;
  }
}

// Переключить видимость подчекбоксов матчей (форма редактирования)
function toggleEditMatchesSubPermissions() {
  const manageMatchesCheckbox = document.getElementById("editPermManageMatches");
  const subPermissionsDiv = document.getElementById("editMatchesSubPermissions");
  
  if (manageMatchesCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    // Автоматически выбираем все подчекбоксы
    document.getElementById("editPermCreateMatches").checked = true;
    document.getElementById("editPermEditMatches").checked = true;
    document.getElementById("editPermDeleteMatches").checked = true;
  } else {
    subPermissionsDiv.style.display = "none";
    // Снимаем все подчекбоксы
    document.getElementById("editPermCreateMatches").checked = false;
    document.getElementById("editPermEditMatches").checked = false;
    document.getElementById("editPermDeleteMatches").checked = false;
  }
}

// Переключить видимость подчекбоксов турниров (форма редактирования)
function toggleEditTournamentsSubPermissions() {
  const manageTournamentsCheckbox = document.getElementById("editPermManageTournaments");
  const subPermissionsDiv = document.getElementById("editTournamentsSubPermissions");
  
  if (manageTournamentsCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    // Автоматически выбираем все подчекбоксы
    document.getElementById("editPermEditTournaments").checked = true;
    document.getElementById("editPermDeleteTournaments").checked = true;
    document.getElementById("editPermCreateTournaments").checked = true;
  } else {
    subPermissionsDiv.style.display = "none";
    // Снимаем все подчекбоксы
    document.getElementById("editPermEditTournaments").checked = false;
    document.getElementById("editPermDeleteTournaments").checked = false;
    document.getElementById("editPermCreateTournaments").checked = false;
  }
}

// Сохранить изменения прав модератора
async function saveModeratorPermissions() {
  if (!editingModeratorId) {
    alert("❌ Ошибка: ID модератора не определен");
    return;
  }
  
  // Собираем разрешения
  const permissions = [];
  if (document.getElementById("editPermManageMatches").checked)
    permissions.push("manage_matches");
  if (document.getElementById("editPermCreateMatches").checked)
    permissions.push("create_matches");
  if (document.getElementById("editPermEditMatches").checked)
    permissions.push("edit_matches");
  if (document.getElementById("editPermDeleteMatches").checked)
    permissions.push("delete_matches");
  if (document.getElementById("editPermManageResults").checked)
    permissions.push("manage_results");
  if (document.getElementById("editPermManageTournaments").checked)
    permissions.push("manage_tournaments");
  if (document.getElementById("editPermEditTournaments").checked)
    permissions.push("edit_tournaments");
  if (document.getElementById("editPermDeleteTournaments").checked)
    permissions.push("delete_tournaments");
  if (document.getElementById("editPermCreateTournaments").checked)
    permissions.push("create_tournaments");
  if (document.getElementById("editPermViewLogs").checked)
    permissions.push("view_logs");
  if (document.getElementById("editPermViewCounting").checked)
    permissions.push("view_counting");
  if (document.getElementById("editPermManageDB").checked)
    permissions.push("manage_db");
  if (document.getElementById("editPermBackupDB").checked)
    permissions.push("backup_db");
  if (document.getElementById("editPermDownloadBackup").checked)
    permissions.push("download_backup");
  if (document.getElementById("editPermRestoreDB").checked)
    permissions.push("restore_db");
  if (document.getElementById("editPermDeleteBackup").checked)
    permissions.push("delete_backup");
  if (document.getElementById("editPermManageOrphaned").checked)
    permissions.push("manage_orphaned");
  if (document.getElementById("editPermViewUsers").checked)
    permissions.push("view_users");
  if (document.getElementById("editPermCheckBot").checked)
    permissions.push("check_bot");
  if (document.getElementById("editPermViewSettings").checked)
    permissions.push("view_settings");
  if (document.getElementById("editPermSyncTelegramIds").checked)
    permissions.push("sync_telegram_ids");
  if (document.getElementById("editPermEditUsers").checked)
    permissions.push("edit_users");
  if (document.getElementById("editPermDeleteUsers").checked)
    permissions.push("delete_users");

  if (permissions.length === 0) {
    alert("❌ Выберите хотя бы одно разрешение");
    return;
  }

  try {
    const response = await fetch(`/api/moderators/${editingModeratorId}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        permissions: permissions,
      }),
    });

    const data = await response.json();

    if (data.success) {
      alert("✅ Права модератора успешно обновлены");
      closeEditModeratorModal();
      loadModeratorsList();
    } else {
      alert(`❌ Ошибка: ${data.error || "Неизвестная ошибка"}`);
    }
  } catch (error) {
    console.error("Ошибка при обновлении прав модератора:", error);
    alert(`❌ Ошибка при обновлении прав: ${error.message}`);
  }
}

// ========== УПРАВЛЕНИЕ НАГРАДАМИ ==========

// Открыть панель управления наградами
async function openAwardsPanel() {
  console.log("🏆 Открытие панели управления наградами");

  if (!isAdmin()) {
    alert("❌ У вас нет прав для управления наградами");
    return;
  }

  const modal = document.getElementById("awardsModal");
  if (!modal) {
    console.error("❌ Элемент awardsModal не найден!");
    alert("❌ Ошибка: модальное окно не найдено");
    return;
  }

  modal.style.display = "flex";

  console.log("📋 Загрузка списка наград...");
  // Загружаем список наград
  loadAwardsList();

  console.log("🎪 Загрузка списка турниров...");
  // Загружаем список турниров
  loadEventsForAwards();
}

// Закрыть панель управления наградами
function closeAwardsPanel() {
  const modal = document.getElementById("awardsModal");
  if (modal) {
    modal.style.display = "none";
  }
}

// Открыть модальное окно устройств
async function openDevicesModal() {
  const modal = document.getElementById("devicesModal");
  if (modal) {
    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";
    await loadDevicesList();
  }
}

// Закрыть модальное окно устройств
function closeDevicesModal() {
  const modal = document.getElementById("devicesModal");
  if (modal) {
    // Разблокируем скролл body
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// ===== ФУНКЦИИ ДЛЯ МОДАЛКИ НОВОСТЕЙ =====

let selectedNewsType = null;

// Открыть модальное окно добавления новости
function openNewsModal() {
  const modal = document.getElementById("newsModal");
  if (modal) {
    // Сбрасываем форму
    document.getElementById("newsTitle").value = "";
    document.getElementById("newsMessage").value = "";
    selectedNewsType = null;
    
    // Сбрасываем выделение кнопок типа
    document.querySelectorAll('.news-type-btn').forEach(btn => {
      btn.style.opacity = '0.6';
      btn.style.borderWidth = '2px';
    });
    
    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";
  }
}

// Закрыть модальное окно добавления новости
function closeNewsModal() {
  const modal = document.getElementById("newsModal");
  if (modal) {
    // Разблокируем скролл body
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// Открыть модальное окно просмотра новостей на сайте
async function openNewsModalSite() {
  const modal = document.getElementById("newsViewModal");
  if (modal) {
    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";
    
    // Загружаем новости
    await loadNewsForSite();
  }
}

// Закрыть модальное окно просмотра новостей
function closeNewsViewModal() {
  const modal = document.getElementById("newsViewModal");
  if (modal) {
    // Разблокируем скролл body
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// Загрузить новости для отображения на сайте
async function loadNewsForSite() {
  const container = document.getElementById("newsViewContainer");
  
  if (!container) return;
  
  // Показываем загрузку
  container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;"><div class="spinner"></div><p>Загрузка новостей...</p></div>';
  
  try {
    const response = await fetch("/api/news?limit=20");
    
    if (!response.ok) {
      throw new Error("Ошибка загрузки новостей");
    }
    
    const data = await response.json();
    const news = data.news;
    
    if (!news || news.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;">📢 Новостей пока нет</div>';
      return;
    }
    
    // Эмодзи для типов новостей
    const typeEmojis = {
      'tournament': '🏆',
      'system': '⚙️',
      'achievement': '🏅',
      'announcement': '📣'
    };
    
    const typeNames = {
      'tournament': 'Турниры',
      'system': 'Система',
      'achievement': 'Достижения',
      'announcement': 'Анонсы'
    };
    
    const typeColors = {
      'tournament': 'rgba(255, 152, 0, 0.2)',
      'system': 'rgba(33, 150, 243, 0.2)',
      'achievement': 'rgba(76, 175, 80, 0.2)',
      'announcement': 'rgba(156, 39, 176, 0.2)'
    };
    
    const typeBorderColors = {
      'tournament': 'rgba(255, 152, 0, 0.5)',
      'system': 'rgba(33, 150, 243, 0.5)',
      'achievement': 'rgba(76, 175, 80, 0.5)',
      'announcement': 'rgba(156, 39, 176, 0.5)'
    };
    
    // Формируем HTML с новостями
    let html = '';
    
    news.forEach((item, index) => {
      // Форматируем дату
      const newsDate = new Date(item.created_at);
      const formattedDate = newsDate.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
      
      const emoji = typeEmojis[item.type] || '📰';
      const typeName = typeNames[item.type] || item.type;
      const bgColor = typeColors[item.type] || 'rgba(255, 255, 255, 0.05)';
      const borderColor = typeBorderColors[item.type] || 'rgba(255, 255, 255, 0.1)';
      
      html += `
        <div style="
          background: ${bgColor};
          border: 1px solid ${borderColor};
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 15px;
          transition: all 0.3s;
        ">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.5em;">${emoji}</span>
              <span style="
                background: rgba(255, 255, 255, 0.1);
                padding: 4px 12px;
                border-radius: 12px;
                font-size: 0.85em;
                color: #b0b8c8;
              ">${typeName}</span>
            </div>
            <span style="color: #7a8394; font-size: 0.9em;">📅 ${formattedDate}</span>
          </div>
          
          <h3 style="
            color: #e0e6f0;
            margin: 0 0 10px 0;
            font-size: 1.1em;
            font-weight: 600;
          ">${item.title}</h3>
          
          <p style="
            color: #b0b8c8;
            margin: 0;
            line-height: 1.6;
            white-space: pre-wrap;
          ">${item.message}</p>
        </div>
      `;
    });
    
    container.innerHTML = html;
  } catch (error) {
    console.error("Ошибка загрузки новостей:", error);
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: #f44336;">❌ Ошибка загрузки новостей</div>';
  }
}

// ===== НОВОСТИ НА САЙТЕ (ВКЛАДКА) =====

// Переменные для пагинации новостей
let newsOffset = 0;
let newsLimit = 50;
let currentNewsFilter = 'all';
let hasMoreNews = true;

// Загрузить вкладку новостей
async function loadNewsTab() {
  // Сбрасываем пагинацию при открытии вкладки
  newsOffset = 0;
  hasMoreNews = true;
  currentNewsFilter = 'all';
  
  // Сбрасываем активный фильтр
  document.querySelectorAll('.news-filter-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.type === 'all') {
      btn.classList.add('active');
    }
  });
  
  // Загружаем новости
  await loadNewsList(true);
}

// Загрузить список новостей
async function loadNewsList(reset = false) {
  const container = document.getElementById("newsListContainer");
  
  if (!container) return;
  
  // Если reset, очищаем контейнер и сбрасываем offset
  if (reset) {
    newsOffset = 0;
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;"><div class="spinner"></div><p>Загрузка новостей...</p></div>';
  } else {
    // Показываем загрузку в кнопке
    const loadMoreBtn = document.getElementById("loadMoreNewsBtn");
    if (loadMoreBtn) {
      loadMoreBtn.innerHTML = '<div class="spinner" style="width: 20px; height: 20px; margin: 0 auto;"></div>';
      loadMoreBtn.disabled = true;
    }
  }
  
  try {
    // Формируем URL с параметрами
    let url = `/api/news?limit=${newsLimit}&offset=${newsOffset}`;
    if (currentNewsFilter !== 'all') {
      url += `&type=${currentNewsFilter}`;
    }
    // Добавляем username для получения реакций пользователя
    if (currentUser) {
      url += `&username=${encodeURIComponent(currentUser.username)}`;
    }
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error("Ошибка загрузки новостей");
    }
    
    const data = await response.json();
    const news = data.news;
    
    // Проверяем есть ли еще новости
    hasMoreNews = news.length === newsLimit;
    
    // Обновляем offset для следующей загрузки
    newsOffset += news.length;
    
    if (reset && (!news || news.length === 0)) {
      container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;">📢 Новостей пока нет</div>';
      document.getElementById("loadMoreNewsContainer").style.display = "none";
      return;
    }
    
    // Эмодзи для типов новостей
    const typeEmojis = {
      'tournament': '🏆',
      'system': '⚙️',
      'achievement': '🏅',
      'announcement': '📣'
    };
    
    const typeNames = {
      'tournament': 'Турниры',
      'system': 'Система',
      'achievement': 'Достижения',
      'announcement': 'Анонсы'
    };
    
    const typeColors = {
      'tournament': 'rgba(255, 152, 0, 0.2)',
      'system': 'rgba(33, 150, 243, 0.2)',
      'achievement': 'rgba(76, 175, 80, 0.2)',
      'announcement': 'rgba(156, 39, 176, 0.2)'
    };
    
    const typeBorderColors = {
      'tournament': 'rgba(255, 152, 0, 0.5)',
      'system': 'rgba(33, 150, 243, 0.5)',
      'achievement': 'rgba(76, 175, 80, 0.5)',
      'announcement': 'rgba(156, 39, 176, 0.5)'
    };
    
    // Формируем HTML с новостями
    let html = reset ? '' : container.innerHTML;
    
    news.forEach((item) => {
      // Форматируем дату
      const newsDate = new Date(item.created_at);
      const formattedDate = newsDate.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
      
      const emoji = typeEmojis[item.type] || '📰';
      const typeName = typeNames[item.type] || item.type;
      const bgColor = typeColors[item.type] || 'rgba(255, 255, 255, 0.05)';
      const borderColor = typeBorderColors[item.type] || 'rgba(255, 255, 255, 0.1)';
      
      // Проверяем является ли пользователь админом
      const isAdmin = currentUser && currentUser.isAdmin === true;
      
      html += `
        <div class="news-item" style="
          background: ${bgColor};
          border: 1px solid ${borderColor};
        " data-news-id="${item.id}">
          ${isAdmin ? `<button class="news-delete-btn" onclick="deleteNews(${item.id})" title="Удалить новость">×</button>` : ''}
          
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.5em;">${emoji}</span>
              <span style="
                background: rgba(255, 255, 255, 0.1);
                padding: 4px 12px;
                border-radius: 12px;
                font-size: 0.85em;
                color: #b0b8c8;
              ">${typeName}</span>
            </div>
            <span style="color: #7a8394; font-size: 0.9em;">📅 ${formattedDate}</span>
          </div>
          
          <h3 style="
            color: #e0e6f0;
            margin: 0 0 10px 0;
            font-size: 1.1em;
            font-weight: 600;
          ">${item.title}</h3>
          
          <p style="
            color: #b0b8c8;
            margin: 0 0 15px 0;
            line-height: 1.6;
            white-space: pre-wrap;
          ">${item.message}</p>
          
          <div style="display: flex; gap: 10px; align-items: center;">
            <button 
              class="news-reaction-btn ${item.user_reaction === 'like' ? 'active' : ''}" 
              onclick="reactToNews(${item.id}, 'like')"
              onmouseenter="showReactionTooltip(${item.id}, 'like', this)"
              onmouseleave="scheduleHideTooltip()"
              data-news-id="${item.id}"
              data-reaction="like"
            >
              👍 <span class="like-count">${item.likes || 0}</span>
            </button>
            <button 
              class="news-reaction-btn dislike ${item.user_reaction === 'dislike' ? 'active' : ''}" 
              onclick="reactToNews(${item.id}, 'dislike')"
              onmouseenter="showReactionTooltip(${item.id}, 'dislike', this)"
              onmouseleave="scheduleHideTooltip()"
              data-news-id="${item.id}"
              data-reaction="dislike"
            >
              👎 <span class="dislike-count">${item.dislikes || 0}</span>
            </button>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
    
    // Показываем/скрываем кнопку "Еще ранее"
    const loadMoreContainer = document.getElementById("loadMoreNewsContainer");
    if (hasMoreNews) {
      loadMoreContainer.style.display = "block";
      const loadMoreBtn = document.getElementById("loadMoreNewsBtn");
      if (loadMoreBtn) {
        loadMoreBtn.innerHTML = '📜 Еще ранее';
        loadMoreBtn.disabled = false;
      }
    } else {
      loadMoreContainer.style.display = "none";
    }
    
  } catch (error) {
    console.error("❌ Ошибка загрузки новостей:", error);
    if (reset) {
      container.innerHTML = '<div style="text-align: center; padding: 40px; color: #f44336;">❌ Ошибка загрузки новостей</div>';
    } else {
      const loadMoreBtn = document.getElementById("loadMoreNewsBtn");
      if (loadMoreBtn) {
        loadMoreBtn.innerHTML = '❌ Ошибка';
        loadMoreBtn.disabled = false;
      }
    }
  }
}

// Загрузить еще новости
async function loadMoreNews() {
  await loadNewsList(false);
}

// Фильтр новостей по типу
async function filterNews(type) {
  currentNewsFilter = type;
  
  // Обновляем активную кнопку фильтра
  document.querySelectorAll('.news-filter-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.type === type) {
      btn.classList.add('active');
    }
  });
  
  // Перезагружаем новости
  await loadNewsList(true);
}

// Реакция на новость (лайк/дизлайк)
async function reactToNews(newsId, reaction) {
  if (!currentUser) {
    alert("Сначала войдите в аккаунт");
    return;
  }
  
  try {
    const response = await fetch(`/api/news/${newsId}/reaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: currentUser.username,
        reaction: reaction
      })
    });
    
    if (!response.ok) {
      throw new Error("Ошибка отправки реакции");
    }
    
    const data = await response.json();
    
    // Обновляем счетчики и активные кнопки
    const newsItem = document.querySelector(`.news-item[data-news-id="${newsId}"]`);
    if (newsItem) {
      const likeBtn = newsItem.querySelector('[data-reaction="like"]');
      const dislikeBtn = newsItem.querySelector('[data-reaction="dislike"]');
      const likeCount = likeBtn.querySelector('.like-count');
      const dislikeCount = dislikeBtn.querySelector('.dislike-count');
      
      // Обновляем счетчики
      likeCount.textContent = data.likes || 0;
      dislikeCount.textContent = data.dislikes || 0;
      
      // Обновляем активные кнопки
      likeBtn.classList.remove('active');
      dislikeBtn.classList.remove('active');
      
      if (data.user_reaction === 'like') {
        likeBtn.classList.add('active');
      } else if (data.user_reaction === 'dislike') {
        dislikeBtn.classList.add('active');
      }
    }
    
  } catch (error) {
    console.error("❌ Ошибка реакции на новость:", error);
    alert("Ошибка отправки реакции");
  }
}

// Показать tooltip с пользователями, поставившими реакцию
let tooltipTimeout = null;
let currentTooltip = null;
let hideTooltipTimeout = null;

async function showReactionTooltip(newsId, reactionType, buttonElement) {
  // Очищаем таймауты
  if (tooltipTimeout) {
    clearTimeout(tooltipTimeout);
  }
  if (hideTooltipTimeout) {
    clearTimeout(hideTooltipTimeout);
  }
  
  // Удаляем старый tooltip если он есть
  if (currentTooltip) {
    currentTooltip.remove();
    currentTooltip = null;
  }
  
  // Небольшая задержка перед показом tooltip
  tooltipTimeout = setTimeout(async () => {
    try {
      const response = await fetch(`/api/news/${newsId}/reactions/${reactionType}`);
      if (!response.ok) {
        throw new Error("Ошибка загрузки данных");
      }
      
      const data = await response.json();
      
      if (data.users && data.users.length > 0) {
        // Создаем tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'reaction-tooltip';
        
        // Формируем HTML с аватарками и именами
        const usersHtml = data.users.map(user => {
          const avatarUrl = user.avatar || '/img/default-avatar.jpg';
          return `
            <div class="tooltip-user" onclick="showUserProfile(${user.userId}, '${user.username.replace(/'/g, "\\'")}'); hideReactionTooltip();">
              <img src="${avatarUrl}" alt="${user.username}" class="tooltip-avatar" onerror="this.src='/img/default-avatar.jpg'">
              <span class="tooltip-username">${user.username}</span>
            </div>
          `;
        }).join('');
        
        tooltip.innerHTML = usersHtml;
        
        // Позиционируем tooltip
        const rect = buttonElement.getBoundingClientRect();
        tooltip.style.position = 'fixed';
        tooltip.style.left = rect.left + 'px';
        tooltip.style.top = (rect.top - 10) + 'px';
        tooltip.style.transform = 'translateY(-100%)';
        
        // Добавляем обработчики для tooltip
        tooltip.addEventListener('mouseenter', () => {
          if (hideTooltipTimeout) {
            clearTimeout(hideTooltipTimeout);
          }
        });
        
        tooltip.addEventListener('mouseleave', () => {
          scheduleHideTooltip();
        });
        
        document.body.appendChild(tooltip);
        currentTooltip = tooltip;
      }
    } catch (error) {
      console.error("❌ Ошибка загрузки списка пользователей:", error);
    }
  }, 300); // Задержка 300мс перед показом
}

function scheduleHideTooltip() {
  hideTooltipTimeout = setTimeout(() => {
    hideReactionTooltip();
  }, 200); // Небольшая задержка перед скрытием
}

function hideReactionTooltip() {
  // Очищаем таймауты
  if (tooltipTimeout) {
    clearTimeout(tooltipTimeout);
    tooltipTimeout = null;
  }
  if (hideTooltipTimeout) {
    clearTimeout(hideTooltipTimeout);
    hideTooltipTimeout = null;
  }
  
  // Удаляем tooltip
  if (currentTooltip) {
    currentTooltip.remove();
    currentTooltip = null;
  }
}

// Удалить новость (только админ)
async function deleteNews(newsId) {
  if (!currentUser) {
    await showCustomAlert("Сначала войдите в аккаунт", "Ошибка", "❌");
    return;
  }
  
  const confirmed = await showCustomConfirm(
    "Вы уверены, что хотите удалить эту новость?",
    "Удаление новости",
    "🗑️"
  );
  
  if (!confirmed) {
    return;
  }
  
  try {
    const response = await fetch(`/api/admin/news/${newsId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: currentUser.username
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Ошибка удаления новости");
    }
    
    // Удаляем элемент из DOM
    const newsItem = document.querySelector(`.news-item[data-news-id="${newsId}"]`);
    if (newsItem) {
      newsItem.style.opacity = '0';
      newsItem.style.transform = 'translateX(-20px)';
      setTimeout(() => {
        newsItem.remove();
        
        // Проверяем остались ли новости
        const container = document.getElementById("newsListContainer");
        if (container && container.children.length === 0) {
          container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;">📢 Новостей пока нет</div>';
          document.getElementById("loadMoreNewsContainer").style.display = "none";
        }
      }, 300);
    }
    
    await showCustomAlert("Новость успешно удалена", "Успех", "✅");
    
  } catch (error) {
    console.error("❌ Ошибка удаления новости:", error);
    await showCustomAlert(error.message || "Ошибка удаления новости", "Ошибка", "❌");
  }
}

// Выбрать тип новости
function selectNewsType(type) {
  selectedNewsType = type;
  
  // Обновляем визуальное состояние кнопок
  document.querySelectorAll('.news-type-btn').forEach(btn => {
    if (btn.getAttribute('data-type') === type) {
      btn.style.opacity = '1';
      btn.style.borderWidth = '3px';
    } else {
      btn.style.opacity = '0.6';
      btn.style.borderWidth = '2px';
    }
  });
}

// Опубликовать новость
async function publishNews() {
  const title = document.getElementById("newsTitle").value.trim();
  const message = document.getElementById("newsMessage").value.trim();
  
  // Валидация
  if (!selectedNewsType) {
    await showCustomAlert("Выберите тип новости", "Ошибка", "⚠️");
    return;
  }
  
  if (!title) {
    await showCustomAlert("Введите заголовок новости", "Ошибка", "⚠️");
    return;
  }
  
  if (!message) {
    await showCustomAlert("Введите текст новости", "Ошибка", "⚠️");
    return;
  }
  
  try {
    const response = await fetch("/api/admin/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentUser.username,
        type: selectedNewsType,
        title: title,
        message: message
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Ошибка при публикации новости");
    }
    
    const result = await response.json();
    
    await showCustomAlert(
      `Новость успешно опубликована!\n\nТип: ${selectedNewsType}\nЗаголовок: ${title}`,
      "Успех",
      "✅"
    );
    
    closeNewsModal();
  } catch (error) {
    console.error("Ошибка публикации новости:", error);
    await showCustomAlert(
      `Не удалось опубликовать новость:\n${error.message}`,
      "Ошибка",
      "❌"
    );
  }
}

// Открыть модальное окно багрепорта
function openBugReportModal() {
  if (!currentUser) {
    showCustomAlert("Войдите в систему, чтобы отправить сообщение об ошибке", "Требуется вход", "⚠️");
    return;
  }

  const modal = document.getElementById("bugReportModal");
  if (modal) {
    // Очищаем поле ввода
    document.getElementById("bugReportText").value = "";
    // Очищаем изображения
    bugReportImages = [];
    updateBugReportImagesPreview();
    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";
  }
}

// Закрыть модальное окно багрепорта
function closeBugReportModal() {
  const modal = document.getElementById("bugReportModal");
  if (modal) {
    // Очищаем изображения
    bugReportImages = [];
    updateBugReportImagesPreview();
    // Очищаем текст
    document.getElementById("bugReportText").value = "";
    // Разблокируем скролл body
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// Массив для хранения изображений багрепорта
let bugReportImages = [];

// Обработка загрузки изображений через input
async function handleBugReportImages(event) {
  const files = Array.from(event.target.files);
  await addBugReportImages(files);
  // Очищаем input для возможности повторной загрузки тех же файлов
  event.target.value = '';
}

// Добавление изображений в багрепорт
async function addBugReportImages(files) {
  const maxImages = 6;
  const maxSizeBytes = 1024 * 1024; // 1 МБ
  
  // Проверяем лимит
  if (bugReportImages.length >= maxImages) {
    await showCustomAlert(`Максимум ${maxImages} изображений`, "Ограничение", "⚠️");
    return;
  }
  
  // Фильтруем только изображения
  const imageFiles = files.filter(file => file.type.startsWith('image/'));
  
  if (imageFiles.length === 0) {
    await showCustomAlert("Выберите изображения", "Ошибка", "❌");
    return;
  }
  
  // Ограничиваем количество добавляемых файлов
  const availableSlots = maxImages - bugReportImages.length;
  const filesToProcess = imageFiles.slice(0, availableSlots);
  
  if (imageFiles.length > availableSlots) {
    await showCustomAlert(
      `Можно добавить только ${availableSlots} изображений. Остальные будут пропущены.`,
      "Ограничение",
      "⚠️"
    );
  }
  
  // Обрабатываем каждый файл
  for (const file of filesToProcess) {
    try {
      // Сжимаем изображение если нужно
      const compressedBlob = await compressImage(file, maxSizeBytes);
      
      // Конвертируем в base64
      const base64 = await blobToBase64(compressedBlob);
      
      bugReportImages.push({
        name: file.name,
        data: base64,
        size: compressedBlob.size
      });
    } catch (error) {
      console.error('Ошибка обработки изображения:', error);
      await showCustomAlert(`Ошибка обработки ${file.name}`, "Ошибка", "❌");
    }
  }
  
  updateBugReportImagesPreview();
}

// Сжатие изображения до нужного размера
async function compressImage(file, maxSizeBytes) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Начинаем с оригинального размера
        let width = img.width;
        let height = img.height;
        let quality = 0.9;
        
        // Функция для попытки сжатия
        const tryCompress = () => {
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Ошибка создания blob'));
              return;
            }
            
            // Если размер подходит или качество слишком низкое - возвращаем результат
            if (blob.size <= maxSizeBytes || quality <= 0.1) {
              resolve(blob);
              return;
            }
            
            // Уменьшаем качество или размер
            if (quality > 0.5) {
              quality -= 0.1;
            } else {
              // Уменьшаем размеры на 10%
              width = Math.floor(width * 0.9);
              height = Math.floor(height * 0.9);
              quality = 0.9;
            }
            
            // Пробуем снова
            tryCompress();
          }, file.type || 'image/jpeg', quality);
        };
        
        tryCompress();
      };
      
      img.onerror = () => reject(new Error('Ошибка загрузки изображения'));
      img.src = e.target.result;
    };
    
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsDataURL(file);
  });
}

// Конвертация Blob в Base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Обновление превью изображений
function updateBugReportImagesPreview() {
  const preview = document.getElementById('bugReportImagesPreview');
  
  if (bugReportImages.length === 0) {
    preview.style.display = 'none';
    preview.innerHTML = '';
    return;
  }
  
  preview.style.display = 'flex';
  preview.innerHTML = bugReportImages.map((img, index) => `
    <div style="
      position: relative;
      width: 100px;
      height: 100px;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.2);
    ">
      <img 
        src="${img.data}" 
        alt="${img.name}"
        style="
          width: 100%;
          height: 100%;
          object-fit: cover;
        "
      />
      <button
        onclick="removeBugReportImage(${index})"
        style="
          position: absolute;
          top: 4px;
          right: 4px;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: rgba(244, 67, 54, 0.9);
          color: white;
          border: none;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        "
        title="Удалить"
      >×</button>
      <div style="
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        font-size: 10px;
        padding: 2px 4px;
        text-align: center;
      ">
        ${(img.size / 1024).toFixed(0)} КБ
      </div>
    </div>
  `).join('');
}

// Удаление изображения из багрепорта
function removeBugReportImage(index) {
  bugReportImages.splice(index, 1);
  updateBugReportImagesPreview();
}

// Обработка вставки изображений через Ctrl+V
document.addEventListener('DOMContentLoaded', () => {
  const bugReportModal = document.getElementById('bugReportModal');
  
  if (bugReportModal) {
    bugReportModal.addEventListener('paste', async (e) => {
      // Проверяем, что модальное окно открыто
      if (bugReportModal.style.display !== 'flex') return;
      
      const items = e.clipboardData?.items;
      if (!items) return;
      
      const imageFiles = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      
      if (imageFiles.length > 0) {
        e.preventDefault();
        await addBugReportImages(imageFiles);
      }
    });
  }
});

// Открыть модальное окно с информацией о входе через Telegram (для экрана логина)
function openTelegramInfoModal() {
  console.log('openTelegramInfoModal вызвана!');
  const modal = document.getElementById("telegramInfoModal");
  const loginModal = document.getElementById("loginModal");
  console.log('telegramInfoModal:', modal);
  console.log('loginModal:', loginModal);
  if (modal) {
    // УБИРАЕМ класс login-modal-open с body чтобы убрать blur с контейнера
    document.body.classList.remove('login-modal-open');
    // Добавляем класс к body чтобы убрать backdrop-filter
    document.body.classList.add('telegram-info-open');
    // Временно закрываем модалку входа полностью
    if (loginModal) {
      console.log('Скрываем loginModal');
      loginModal.dataset.wasOpen = 'true'; // Запоминаем что она была открыта
      loginModal.style.display = 'none';
      loginModal.style.visibility = 'hidden'; // Дополнительно скрываем
      loginModal.style.opacity = '0'; // И делаем прозрачной
      loginModal.style.pointerEvents = 'none'; // Отключаем события
    }
    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";
    // Принудительно устанавливаем z-index выше всех модалок
    modal.style.zIndex = "200000";
    console.log('telegramInfoModal открыта, display:', modal.style.display, 'z-index:', modal.style.zIndex);
    
    // Проверяем через 100мс что loginModal действительно скрыта
    setTimeout(() => {
      console.log('Проверка через 100мс - loginModal display:', loginModal.style.display, 'computed:', window.getComputedStyle(loginModal).display);
    }, 100);
  }
}

// Закрыть модальное окно с информацией о входе через Telegram
function closeTelegramInfoModal() {
  const modal = document.getElementById("telegramInfoModal");
  const loginModal = document.getElementById("loginModal");
  if (modal) {
    // Убираем класс с body
    document.body.classList.remove('telegram-info-open');
    // Разблокируем скролл body
    document.body.style.overflow = '';
    modal.style.display = "none";
    // Возвращаем модалку входа если она была открыта
    if (loginModal && loginModal.dataset.wasOpen === 'true') {
      // ВОЗВРАЩАЕМ класс login-modal-open на body
      document.body.classList.add('login-modal-open');
      loginModal.style.display = 'flex';
      loginModal.style.visibility = '';
      loginModal.style.opacity = '';
      loginModal.style.pointerEvents = '';
      delete loginModal.dataset.wasOpen;
    }
  }
}

// Открыть модальное окно с информацией о привязке Telegram (для настроек залогиненных)
async function openTelegramBindInfoModal() {
  // Блокируем body
  document.body.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  // Закрытие по клику вне модалки
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      document.body.style.overflow = '';
    }
  });
  
  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 700px;
      width: 95%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      position: relative;
      color: #e0e6f0;
    ">
      <button onclick="this.closest('div[style*=fixed]').remove(); document.body.style.overflow = '';" style="
        position: absolute;
        top: 15px;
        right: 15px;
        background: transparent;
        border: none;
        color: #e0e6f0;
        font-size: 24px;
        cursor: pointer;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background 0.2s;
      " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">×</button>
      
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">📱 Зачем привязывать Telegram?</h3>
      
      <div style="line-height: 1.6;">
        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">🔔 Уведомления и напоминания</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <p style="margin: 0 0 10px 0;">Получайте важные уведомления прямо в Telegram:</p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li><strong>Напоминания о матчах</strong> — не пропустите начало матча и успейте сделать ставку</li>
            <li><strong>Результаты матчей</strong> — узнавайте о завершении матчей и своих выигрышах</li>
            <li><strong>Новые турниры</strong> — будьте в курсе новых турниров и событий</li>
            <li><strong>Важные обновления</strong> — получайте информацию об изменениях в системе</li>
          </ul>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">🔐 Безопасность</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <p style="margin: 0 0 10px 0;">Дополнительная защита вашего аккаунта:</p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li><strong>Двухфакторная аутентификация</strong> — подтверждение входа через бота для максимальной безопасности</li>
            <li><strong>Уведомления о входе</strong> — получайте оповещения о каждом входе в аккаунт</li>
            <li><strong>Контроль доступа</strong> — мгновенно узнавайте о подозрительной активности</li>
          </ul>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">🤖 Функционал бота</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <p style="margin: 0 0 10px 0;">Управляйте своим аккаунтом через Telegram:</p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li><strong>Быстрый доступ</strong> — просматривайте свою статистику и результаты</li>
            <li><strong>Управление уведомлениями</strong> — настраивайте, какие уведомления получать</li>
            <li><strong>Информация о турнирах</strong> — получайте актуальную информацию о текущих турнирах</li>
            <li><strong>Поддержка</strong> — связывайтесь с администрацией напрямую через бота</li>
          </ul>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">🔒 Конфиденциальность</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li>Ваш Telegram используется <strong>только для уведомлений</strong> и связи с вами</li>
            <li>Мы <strong>не передаем</strong> ваши данные третьим лицам</li>
            <li>Вы можете <strong>отключить уведомления</strong> в любой момент в настройках</li>
            <li>Вы можете <strong>отвязать Telegram</strong> в любое время</li>
          </ul>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">🚀 Как привязать?</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px;">
          <ol style="margin: 5px 0; padding-left: 20px;">
            <li>Нажмите кнопку <strong>"🔗 Привязать свой ТГ"</strong></li>
            <li>Откроется бот <strong>@OnexBetLineBoomBot</strong> в Telegram</li>
            <li>Нажмите <strong>/start</strong> или кнопку "Начать"</li>
            <li>Бот автоматически привяжет ваш аккаунт</li>
            <li>Готово! Теперь вы будете получать уведомления</li>
          </ol>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

// Открыть модальное окно детальных настроек уведомлений
async function openDetailedNotificationsModal() {
  if (!currentUser) {
    await showCustomAlert("Войдите в систему", "Ошибка", "❌");
    return;
  }

  // Проверяем привязку Telegram
  if (!currentUser.telegram_username) {
    await showCustomAlert(
      "Для настройки уведомлений необходимо привязать Telegram аккаунт.\n\nПерейдите в настройки профиля и свяжите свой аккаунт с ботом.",
      "Telegram не привязан",
      "📱"
    );
    return;
  }

  const modal = document.getElementById("detailedNotificationsModal");
  if (modal) {
    // Загружаем текущие настройки
    await loadDetailedNotificationSettings();
    
    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";
  }
}

// Закрыть модальное окно детальных настроек уведомлений
function closeDetailedNotificationsModal() {
  const modal = document.getElementById("detailedNotificationsModal");
  if (modal) {
    // Разблокируем скролл body
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// Загрузить детальные настройки уведомлений
async function loadDetailedNotificationSettings() {
  if (!currentUser) return;

  try {
    const response = await fetch(`/api/user/${currentUser.id}/notification-settings`);
    
    if (response.ok) {
      const settings = await response.json();
      
      // Устанавливаем значения чекбоксов
      document.getElementById("notifMatchReminders").checked = settings.match_reminders !== false;
      document.getElementById("notifThreeHourReminders").checked = settings.three_hour_reminders !== false;
      document.getElementById("notifOnlyActiveTournaments").checked = settings.only_active_tournaments === true;
      document.getElementById("notifTournamentAnnouncements").checked = settings.tournament_announcements !== false;
      document.getElementById("notifMatchResults").checked = settings.match_results !== false;
      document.getElementById("notifSystemMessages").checked = settings.system_messages !== false;
      
      // Обновляем состояние disabled для зависимой настройки
      updateOnlyActiveTournamentsState();
    }
    
    // Загружаем настройку уведомлений о просмотре
    const notifyOnViewResponse = await fetch(`/api/user/${currentUser.id}/notify-on-view`);
    if (notifyOnViewResponse.ok) {
      const notifyOnViewData = await notifyOnViewResponse.json();
      document.getElementById("notifOnView").checked = notifyOnViewData.notify_on_view !== 0;
    }
  } catch (error) {
    console.error("Ошибка загрузки настроек уведомлений:", error);
  }
}

// Обновить состояние настройки "Только по турнирам с моими ставками"
function updateOnlyActiveTournamentsState() {
  const threeHourRemindersCheckbox = document.getElementById("notifThreeHourReminders");
  const onlyActiveTournamentsCheckbox = document.getElementById("notifOnlyActiveTournaments");
  
  if (threeHourRemindersCheckbox && onlyActiveTournamentsCheckbox) {
    const isThreeHourRemindersEnabled = threeHourRemindersCheckbox.checked;
    
    // Если напоминания за 3 часа включаются - автоматически включаем фильтр
    if (isThreeHourRemindersEnabled && onlyActiveTournamentsCheckbox.disabled) {
      onlyActiveTournamentsCheckbox.checked = true;
    }
    
    // Если напоминания за 3 часа выключены - делаем настройку disabled
    onlyActiveTournamentsCheckbox.disabled = !isThreeHourRemindersEnabled;
    
    // Визуально затемняем родительский блок если disabled
    const parentDiv = onlyActiveTournamentsCheckbox.closest('.notification-setting-item');
    if (parentDiv) {
      if (!isThreeHourRemindersEnabled) {
        parentDiv.style.opacity = '0.5';
        parentDiv.style.pointerEvents = 'none';
      } else {
        parentDiv.style.opacity = '1';
        parentDiv.style.pointerEvents = 'auto';
      }
    }
  }
}

// Проверить настройку "Напоминания о матчах" и обновить видимость кнопки
async function checkMatchRemindersSettingAndUpdateButton() {
  const matchRemindersBtn = document.getElementById('matchRemindersBtn');
  
  if (!matchRemindersBtn || !currentUser) {
    if (matchRemindersBtn) matchRemindersBtn.style.display = 'none';
    return;
  }
  
  try {
    const response = await fetch(`/api/user/${currentUser.id}/notification-settings`);
    
    if (response.ok) {
      const settings = await response.json();
      
      // Если настройка "Напоминания о матчах" выключена - скрываем кнопку
      if (settings.match_reminders === false) {
        matchRemindersBtn.style.display = 'none';
        updateReminderIndicator(false);
      } else {
        matchRemindersBtn.style.display = 'flex';
        // Загружаем настройки напоминаний для обновления индикатора
        loadMatchReminders();
      }
    } else {
      // Если настроек нет - показываем кнопку (по умолчанию включено)
      matchRemindersBtn.style.display = 'flex';
      loadMatchReminders();
    }
  } catch (error) {
    console.error("Ошибка проверки настроек напоминаний:", error);
    // При ошибке показываем кнопку
    matchRemindersBtn.style.display = 'flex';
    loadMatchReminders();
  }
}

// Сохранить детальные настройки уведомлений
async function saveDetailedNotificationSettings() {
  if (!currentUser) return;

  const settings = {
    match_reminders: document.getElementById("notifMatchReminders").checked,
    three_hour_reminders: document.getElementById("notifThreeHourReminders").checked,
    only_active_tournaments: document.getElementById("notifOnlyActiveTournaments").checked,
    tournament_announcements: document.getElementById("notifTournamentAnnouncements").checked,
    match_results: document.getElementById("notifMatchResults").checked,
    system_messages: document.getElementById("notifSystemMessages").checked,
  };

  try {
    const response = await fetch(`/api/user/${currentUser.id}/notification-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("Ошибка сохранения настроек:", error);
    }
    
    // Обновляем состояние disabled для зависимой настройки
    updateOnlyActiveTournamentsState();
    
    // Обновляем видимость кнопки колокольчика если изменилась настройка напоминаний
    if (currentEventId) {
      const event = events.find((e) => e.id === currentEventId);
      const isLocked = event && event.locked_reason;
      const isUpcoming = event && event.start_date && new Date(event.start_date) > new Date();
      
      if (!isLocked && !isUpcoming) {
        checkMatchRemindersSettingAndUpdateButton();
      }
    }
  } catch (error) {
    console.error("Ошибка сохранения настроек уведомлений:", error);
  }
}

// Сохранить настройку "Уведомления о просмотре"
async function saveNotifyOnViewSettings() {
  if (!currentUser) return;

  try {
    const notifyOnView = document.getElementById("notifOnView").checked ? 1 : 0;
    await fetch(`/api/user/${currentUser.id}/notify-on-view`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notify_on_view: notifyOnView }),
    });
  } catch (error) {
    console.error("Ошибка сохранения настройки уведомлений о просмотре:", error);
  }
}

// Отправить багрепорт
async function sendBugReport() {
  if (!currentUser) {
    await showCustomAlert("Войдите в систему", "Ошибка", "❌");
    return;
  }

  const bugText = document.getElementById("bugReportText").value.trim();
  
  if (!bugText) {
    await showCustomAlert("Пожалуйста, опишите проблему", "Ошибка", "⚠️");
    return;
  }

  try {
    const response = await fetch("/api/bug-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: currentUser.id,
        username: currentUser.username,
        bugText: bugText,
        images: bugReportImages.map(img => ({
          name: img.name,
          data: img.data,
          size: img.size
        }))
      })
    });

    const result = await response.json();

    if (response.ok) {
      closeBugReportModal();
      await showCustomAlert(
        "Спасибо за сообщение! Администратор получил ваш отчет об ошибке.",
        "Отправлено",
        "✅"
      );
    } else {
      await showCustomAlert(result.error || "Ошибка при отправке", "Ошибка", "❌");
    }
  } catch (error) {
    console.error("Ошибка при отправке багрепорта:", error);
    await showCustomAlert("Ошибка при отправке сообщения", "Ошибка", "❌");
  }
}

// Открыть модальное окно багрепортов (для админа)
async function openBugReportsModal() {
  console.log("🐛 openBugReportsModal вызвана");
  console.log("currentUser:", currentUser);
  console.log("ADMIN_DB_NAME:", ADMIN_DB_NAME);
  
  if (!currentUser || currentUser.username !== ADMIN_DB_NAME) {
    await showCustomAlert("Недостаточно прав", "Ошибка", "❌");
    return;
  }

  const modal = document.getElementById("bugReportsModal");
  console.log("modal найдена:", modal);
  
  if (modal) {
    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";
    console.log("✅ Модальное окно открыто, display:", modal.style.display);
    await loadBugReports();
  } else {
    console.error("❌ Модальное окно bugReportsModal не найдено!");
  }
}

// Закрыть модальное окно багрепортов
function closeBugReportsModal() {
  const modal = document.getElementById("bugReportsModal");
  if (modal) {
    // Разблокируем скролл body
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// Загрузить список багрепортов
async function loadBugReports() {
  console.log("📋 loadBugReports вызвана");
  
  if (!currentUser || currentUser.username !== ADMIN_DB_NAME) {
    console.log("❌ Нет прав для загрузки багрепортов");
    return;
  }

  try {
    console.log("🔄 Запрос багрепортов...");
    const response = await fetch(`/api/admin/bug-reports?username=${currentUser.username}`);
    const bugReports = await response.json();
    
    console.log("📦 Получено багрепортов:", bugReports.length);

    allBugReports = bugReports;

    // Обновляем счетчики на кнопках фильтра
    updateBugReportFilterCounts();

    // Определяем фильтр по умолчанию
    const hasNew = bugReports.some(r => r.status === 'new');
    const hasInProgress = bugReports.some(r => r.status === 'in_progress');
    
    if (hasNew) {
      currentBugReportFilter = 'new';
    } else if (hasInProgress) {
      currentBugReportFilter = 'in_progress';
    } else {
      currentBugReportFilter = 'new'; // По умолчанию все равно new
    }

    // Применяем фильтр
    filterBugReports(currentBugReportFilter);
  } catch (error) {
    console.error("Ошибка при загрузке багрепортов:", error);
    document.getElementById("bugReportsList").innerHTML = 
      '<div class="empty-message">Ошибка загрузки багрепортов</div>';
  }
}

// Фильтрация багрепортов по статусу
function filterBugReports(status) {
  currentBugReportFilter = status;
  
  // Обновляем активную кнопку фильтра
  document.querySelectorAll('.bug-filter-btn').forEach(btn => {
    if (btn.dataset.status === status) {
      btn.classList.add('active');
      btn.style.background = 'rgba(90, 159, 212, 0.2)';
      btn.style.color = '#5a9fd4';
      btn.style.borderColor = '#5a9fd4';
    } else {
      btn.classList.remove('active');
      btn.style.background = 'rgba(255, 255, 255, 0.05)';
      btn.style.color = '#aaa';
      btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    }
  });

  // Фильтруем багрепорты
  const filteredReports = allBugReports.filter(r => r.status === status);
  
  const listContainer = document.getElementById("bugReportsList");

  if (filteredReports.length === 0) {
    const statusText = {
      'new': 'новых',
      'in_progress': 'в работе',
      'resolved': 'решенных',
      'rejected': 'отклоненных'
    }[status] || 'багрепортов';
    
    listContainer.innerHTML = `<div class="empty-message">Нет ${statusText} багрепортов</div>`;
    return;
  }

  listContainer.innerHTML = filteredReports.map(report => {
      const createdAt = new Date(report.created_at).toLocaleString("ru-RU");
      const statusIcon = {
        'new': '🆕',
        'in_progress': '🔄',
        'resolved': '✅',
        'rejected': '❌'
      }[report.status] || '❓';

      const statusText = {
        'new': 'Новый',
        'in_progress': 'В работе',
        'resolved': 'Решено',
        'rejected': 'Отклонено'
      }[report.status] || 'Неизвестно';

      // Генерируем HTML для миниатюр изображений
      const imagesHtml = report.images && report.images.length > 0 ? `
        <div class="bug-report-images" style="
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        ">
          <div style="color: #aaa; font-size: 12px; width: 100%; margin-bottom: 5px;">
            📎 Прикрепленные изображения (${report.images.length}):
          </div>
          ${report.images.map((img, index) => `
            <div 
              class="bug-report-image-thumb"
              onclick="openBugReportImagesModal(${report.id}, ${index})"
              style="
                width: 80px;
                height: 80px;
                border-radius: 6px;
                overflow: hidden;
                border: 2px solid rgba(90, 159, 212, 0.3);
                cursor: pointer;
                transition: all 0.3s ease;
                position: relative;
              "
              onmouseover="this.style.borderColor='rgba(90, 159, 212, 0.8)'; this.style.transform='scale(1.05)'"
              onmouseout="this.style.borderColor='rgba(90, 159, 212, 0.3)'; this.style.transform='scale(1)'"
              title="Нажмите для просмотра"
            >
              <img 
                src="${img.image_data}" 
                alt="${img.image_name || 'Изображение'}"
                style="
                  width: 100%;
                  height: 100%;
                  object-fit: cover;
                "
              />
              <div style="
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                background: rgba(0, 0, 0, 0.7);
                color: white;
                font-size: 9px;
                padding: 2px;
                text-align: center;
              ">
                ${(img.image_size / 1024).toFixed(0)} КБ
              </div>
            </div>
          `).join('')}
        </div>
      ` : '';

      return `
        <div class="bug-report-card" data-status="${report.status}">
          <div class="bug-report-header">
            <div class="bug-report-id">#${report.id}</div>
            <div class="bug-report-user">
              👤 ${report.username}
              ${report.telegram_username ? `<span class="bug-report-telegram">@${report.telegram_username}</span>` : ''}
            </div>
            <div class="bug-report-date">🕐 ${createdAt}</div>
            <button 
              class="bug-report-delete-btn"
              onclick="deleteBugReport(${report.id})"
              title="Удалить багрепорт"
              style="
                position: absolute;
                top: 10px;
                right: 10px;
                width: 28px;
                height: 28px;
                border-radius: 50%;
                background: rgba(244, 67, 54, 0.2);
                color: #f44336;
                border: 1px solid #f44336;
                cursor: pointer;
                font-size: 18px;
                line-height: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                transition: all 0.3s ease;
              "
              onmouseover="this.style.background='rgba(244, 67, 54, 0.4)'"
              onmouseout="this.style.background='rgba(244, 67, 54, 0.2)'"
            >×</button>
          </div>
          <div class="bug-report-text">${report.bug_text}</div>
          ${imagesHtml}
          <div class="bug-report-footer">
            <div class="bug-report-status">
              ${statusIcon} <span>${statusText}</span>
            </div>
            <select 
              class="bug-report-status-select" 
              onchange="changeBugStatus(${report.id}, this.value)"
            >
              <option value="new" ${report.status === 'new' ? 'selected' : ''}>🆕 Новый</option>
              <option value="in_progress" ${report.status === 'in_progress' ? 'selected' : ''}>🔄 В работе</option>
              <option value="resolved" ${report.status === 'resolved' ? 'selected' : ''}>✅ Решено</option>
              <option value="rejected" ${report.status === 'rejected' ? 'selected' : ''}>❌ Отклонено</option>
            </select>
          </div>
        </div>
      `;
    }).join('');
}

// Обновить счетчики на кнопках фильтра
function updateBugReportFilterCounts() {
  const counts = {
    new: allBugReports.filter(r => r.status === 'new').length,
    in_progress: allBugReports.filter(r => r.status === 'in_progress').length,
    resolved: allBugReports.filter(r => r.status === 'resolved').length,
    rejected: allBugReports.filter(r => r.status === 'rejected').length
  };

  document.querySelectorAll('.bug-filter-btn').forEach(btn => {
    const status = btn.dataset.status;
    const count = counts[status] || 0;
    
    const labels = {
      'new': '🆕 Новый',
      'in_progress': '🔄 В работе',
      'resolved': '✅ Решено',
      'rejected': '❌ Отклонено'
    };
    
    btn.textContent = `${labels[status]} (${count})`;
  });
}

// Изменить статус багрепорта
async function changeBugStatus(id, status) {
  if (!currentUser || currentUser.username !== ADMIN_DB_NAME) return;

  try {
    const response = await fetch(`/api/admin/bug-reports/${id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: status,
        username: currentUser.username
      })
    });

    const result = await response.json();

    if (response.ok) {
      // Перезагружаем список багрепортов
      await loadBugReports();
    } else {
      await showCustomAlert(result.error || "Ошибка при обновлении статуса", "Ошибка", "❌");
    }
  } catch (error) {
    console.error("Ошибка при изменении статуса:", error);
    await showCustomAlert("Ошибка при обновлении статуса", "Ошибка", "❌");
  }
}

// Удалить багрепорт
async function deleteBugReport(id) {
  if (!currentUser || currentUser.username !== ADMIN_DB_NAME) return;

  const confirmed = await showCustomConfirm(
    "Вы уверены, что хотите удалить этот багрепорт? Все связанные изображения также будут удалены.",
    "Подтверждение удаления",
    "⚠️"
  );

  if (!confirmed) return;

  try {
    const response = await fetch(`/api/admin/bug-reports/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentUser.username
      })
    });

    const result = await response.json();

    if (response.ok) {
      await showCustomAlert("Багрепорт успешно удален", "Успех", "✅");
      // Перезагружаем список багрепортов
      await loadBugReports();
    } else {
      await showCustomAlert(result.error || "Ошибка при удалении", "Ошибка", "❌");
    }
  } catch (error) {
    console.error("Ошибка при удалении багрепорта:", error);
    await showCustomAlert("Ошибка при удалении багрепорта", "Ошибка", "❌");
  }
}

// Переменные для просмотра изображений багрепорта
let currentBugReportImages = [];
let currentImageIndex = 0;
let allBugReports = []; // Все багрепорты
let currentBugReportFilter = 'new'; // Текущий фильтр

// Открыть модальное окно просмотра изображений багрепорта
async function openBugReportImagesModal(bugReportId, startIndex = 0) {
  try {
    // Получаем данные багрепорта с изображениями
    const response = await fetch(`/api/admin/bug-reports?username=${currentUser.username}`);
    const bugReports = await response.json();
    
    const report = bugReports.find(r => r.id === bugReportId);
    
    if (!report || !report.images || report.images.length === 0) {
      await showCustomAlert("Изображения не найдены", "Ошибка", "❌");
      return;
    }
    
    currentBugReportImages = report.images;
    currentImageIndex = startIndex;
    
    const modal = document.getElementById('bugReportImagesModal');
    const title = document.getElementById('bugReportImagesTitle');
    
    title.textContent = `📷 Изображения багрепорта #${bugReportId}`;
    
    displayCurrentBugReportImage();
    
    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    modal.style.display = 'flex';
  } catch (error) {
    console.error("Ошибка при открытии изображений:", error);
    await showCustomAlert("Ошибка при загрузке изображений", "Ошибка", "❌");
  }
}

// Отобразить текущее изображение
function displayCurrentBugReportImage() {
  const container = document.getElementById('bugReportImagesContainer');
  const counter = document.getElementById('imageCounter');
  const prevBtn = document.getElementById('prevImageBtn');
  const nextBtn = document.getElementById('nextImageBtn');
  
  if (currentBugReportImages.length === 0) return;
  
  const img = currentBugReportImages[currentImageIndex];
  
  container.innerHTML = `
    <div style="
      max-width: 100%;
      max-height: calc(90vh - 200px);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    ">
      <img 
        src="${img.image_data}" 
        alt="${img.image_name || 'Изображение'}"
        style="
          max-width: 100%;
          max-height: calc(90vh - 250px);
          object-fit: contain;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        "
      />
      <div style="
        color: #aaa;
        font-size: 14px;
        text-align: center;
      ">
        <div>${img.image_name || 'Без названия'}</div>
        <div>Размер: ${(img.image_size / 1024).toFixed(2)} КБ</div>
      </div>
    </div>
  `;
  
  // Обновляем счетчик
  counter.textContent = `${currentImageIndex + 1} / ${currentBugReportImages.length}`;
  
  // Управляем кнопками навигации
  prevBtn.disabled = currentImageIndex === 0;
  nextBtn.disabled = currentImageIndex === currentBugReportImages.length - 1;
  
  prevBtn.style.opacity = prevBtn.disabled ? '0.5' : '1';
  nextBtn.style.opacity = nextBtn.disabled ? '0.5' : '1';
  prevBtn.style.cursor = prevBtn.disabled ? 'not-allowed' : 'pointer';
  nextBtn.style.cursor = nextBtn.disabled ? 'not-allowed' : 'pointer';
}

// Навигация по изображениям
function navigateBugReportImage(direction) {
  const newIndex = currentImageIndex + direction;
  
  if (newIndex >= 0 && newIndex < currentBugReportImages.length) {
    currentImageIndex = newIndex;
    displayCurrentBugReportImage();
  }
}

// Закрыть модальное окно просмотра изображений
function closeBugReportImagesModal() {
  const modal = document.getElementById('bugReportImagesModal');
  if (modal) {
    document.body.style.overflow = '';
    modal.style.display = 'none';
    currentBugReportImages = [];
    currentImageIndex = 0;
  }
}

// Добавляем поддержку клавиш стрелок для навигации
document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('bugReportImagesModal');
  if (modal && modal.style.display === 'flex') {
    if (e.key === 'ArrowLeft') {
      navigateBugReportImage(-1);
    } else if (e.key === 'ArrowRight') {
      navigateBugReportImage(1);
    } else if (e.key === 'Escape') {
      closeBugReportImagesModal();
    }
  }
});

// Загрузить список устройств
async function loadDevicesList() {
  if (!currentUser) return;

  try {
    const response = await fetch(`/api/user/${currentUser.id}/sessions`);
    const sessions = await response.json();

    const listContainer = document.getElementById("devicesList");

    if (!Array.isArray(sessions) || sessions.length === 0) {
      listContainer.innerHTML = '<div class="empty-message">Нет активных устройств</div>';
      return;
    }

    // Получаем текущий session_token из localStorage
    const currentSessionToken = localStorage.getItem("sessionToken");

    listContainer.innerHTML = sessions.map(session => {
      const isCurrentDevice = session.session_token === currentSessionToken;
      const isTrusted = session.is_trusted === 1;
      const deviceIcon = getDeviceIcon(session.device_info, session.os);
      // Добавляем 'Z' чтобы указать что время в UTC, затем конвертируем в локальное
      const lastActivity = new Date(session.last_activity + 'Z').toLocaleString("ru-RU");
      const createdAt = new Date(session.created_at + 'Z').toLocaleString("ru-RU");

      return `
        <div class="device-item ${isCurrentDevice ? 'current-device' : ''} ${isTrusted ? 'trusted-device' : ''}">
          <div class="device-info">
            <div class="device-name">
              ${deviceIcon} ${session.device_info || 'Неизвестное устройство'}
              ${isCurrentDevice ? '<span class="device-current-badge">Текущее устройство</span>' : ''}
              ${isTrusted ? '<span class="device-trusted-badge">✓ Доверенное</span>' : ''}
            </div>
            <div class="device-details">
              <div>🌐 Браузер: ${session.browser || 'Неизвестно'}</div>
              <div>💻 ОС: ${session.os || 'Неизвестно'}</div>
              <div>🌍 IP: ${session.ip_address || 'Неизвестно'}</div>
              <div>🕐 Последняя активность: ${lastActivity}</div>
              <div>📅 Вход: ${createdAt}</div>
            </div>
          </div>
          <div class="device-actions">
            <button 
              class="device-trust-btn ${isTrusted ? 'trusted' : ''}" 
              onclick="toggleTrustedDevice('${session.session_token}', ${isTrusted})"
              title="${isTrusted ? 'Убрать из доверенных' : 'Добавить в доверенные'}"
            >
              ${isTrusted ? '✓ Доверенное' : '🔒 Доверенное'}
            </button>
            <button 
              class="device-logout-btn" 
              onclick="logoutDevice('${session.session_token}')"
              ${isCurrentDevice ? 'disabled' : ''}
            >
              ${isCurrentDevice ? '🔒 Текущее' : '❌ Выйти'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error("❌ Ошибка загрузки устройств:", error);
    document.getElementById("devicesList").innerHTML = 
      '<div class="empty-message">Ошибка загрузки устройств</div>';
  }
}

// Получить иконку устройства
function getDeviceIcon(deviceInfo, os) {
  const device = (deviceInfo || '').toLowerCase();
  const osLower = (os || '').toLowerCase();

  if (device.includes('mobile') || device.includes('phone')) return '📱';
  if (device.includes('tablet') || device.includes('ipad')) return '📱';
  if (osLower.includes('android')) return '📱';
  if (osLower.includes('ios')) return '📱';
  if (osLower.includes('windows')) return '💻';
  if (osLower.includes('mac')) return '💻';
  if (osLower.includes('linux')) return '🐧';
  
  return '🖥️';
}

// Выйти с устройства
async function logoutDevice(sessionToken) {
  if (!currentUser) return;

  // Проверяем, привязан ли Telegram
  if (!currentUser.telegram_username) {
    await showCustomAlert('Для выхода с устройства необходимо привязать Telegram в настройках', 'Требуется Telegram', '⚠️');
    return;
  }

  const shouldContinue = await showCustomConfirm(
    'Для завершения сеанса на этом устройстве требуется подтверждение. Вам будет отправлено сообщение в Telegram с кодом подтверждения.',
    'Подтверждение выхода',
    '🔐'
  );
  
  if (!shouldContinue) {
    return;
  }

  try {
    // Запрашиваем код подтверждения
    const response = await fetch(`/api/user/${currentUser.id}/sessions/${sessionToken}/request-logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await response.json();

    if (response.ok) {
      // Показываем поле для ввода кода
      const code = await showCustomPrompt(
        'Код подтверждения отправлен вам в Telegram. Введите его ниже:',
        'Введите код',
        '🔐',
        '123456'
      );
      
      if (!code) return;

      // Подтверждаем выход
      const confirmResponse = await fetch(`/api/user/${currentUser.id}/sessions/${sessionToken}/confirm-logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation_code: code })
      });

      const confirmResult = await confirmResponse.json();

      if (confirmResponse.ok) {
        await loadDevicesList();
      } else {
        await showCustomAlert(confirmResult.error, 'Ошибка', '❌');
      }
    } else {
      await showCustomAlert(result.error, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error("❌ Ошибка при выходе с устройства:", error);
    await showCustomAlert('Ошибка при выходе с устройства', 'Ошибка', '❌');
  }
}

// Переключить доверенное устройство
async function toggleTrustedDevice(sessionToken, isTrusted) {
  if (!currentUser) return;

  // Проверяем, привязан ли Telegram
  if (!currentUser.telegram_username) {
    await showCustomAlert('Для управления доверенными устройствами необходимо привязать Telegram в настройках', 'Требуется Telegram', '⚠️');
    return;
  }

  const action = isTrusted ? 'убрать из доверенных' : 'добавить в доверенные';
  
  const shouldContinue = await showCustomConfirm(
    `Для того чтобы ${action} это устройство, требуется подтверждение. Вам будет отправлено сообщение в Telegram с кодом подтверждения.`,
    isTrusted ? 'Убрать из доверенных' : 'Добавить в доверенные',
    isTrusted ? '🔓' : '🔒'
  );
  
  if (!shouldContinue) {
    return;
  }

  try {
    // Запрашиваем код подтверждения
    const response = await fetch(`/api/user/${currentUser.id}/sessions/${sessionToken}/request-trust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_trusted: !isTrusted })
    });

    const result = await response.json();

    if (response.ok) {
      // Показываем поле для ввода кода
      const code = await showCustomPrompt(
        'Код подтверждения отправлен вам в Telegram. Введите его ниже:',
        'Введите код',
        '🔐',
        '123456'
      );
      
      if (!code) return;

      // Подтверждаем изменение
      const confirmResponse = await fetch(`/api/user/${currentUser.id}/sessions/${sessionToken}/confirm-trust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          confirmation_code: code,
          is_trusted: !isTrusted
        })
      });

      const confirmResult = await confirmResponse.json();

      if (confirmResponse.ok) {
        await loadDevicesList();
        await showCustomAlert(
          `Устройство успешно ${isTrusted ? 'убрано из доверенных' : 'добавлено в доверенные'}`,
          'Успешно',
          '✅'
        );
      } else {
        await showCustomAlert(confirmResult.error, 'Ошибка', '❌');
      }
    } else {
      await showCustomAlert(result.error, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error("❌ Ошибка при изменении статуса доверенного устройства:", error);
    await showCustomAlert('Ошибка при изменении статуса доверенного устройства', 'Ошибка', '❌');
  }
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

    listContainer.innerHTML = `
      <div style="
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 12px;
      ">
        ${awards
          .map((award) => {
            // Подготавливаем стили для фона с картинкой и прозрачностью
            const awardColor = award.award_color || "#fbc02d";
            const awardEmoji = award.award_emoji || "🏆";
            let bgStyle = `rgba(255, 193, 7, 0.1)`;
            let bgHoverStyle = `rgba(255, 193, 7, 0.2)`;
            let borderColor = `rgba(251, 192, 45, 0.5)`;
            let textColor = `#fbc02d`;

            // Если указан пользовательский цвет
            if (awardColor && awardColor !== "#fbc02d") {
              // Преобразуем hex в rgba для фона
              const rgb = parseInt(awardColor.slice(1), 16);
              const r = (rgb >> 16) & 255;
              const g = (rgb >> 8) & 255;
              const b = rgb & 255;
              bgStyle = `rgba(${r}, ${g}, ${b}, 0.1)`;
              bgHoverStyle = `rgba(${r}, ${g}, ${b}, 0.2)`;
              borderColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
              textColor = awardColor;
            }

            if (award.image_url) {
              const opacity =
                award.background_opacity !== undefined
                  ? award.background_opacity
                  : 1;
              bgStyle = `linear-gradient(rgba(0, 0, 0, ${
                1 - opacity
              }), rgba(0, 0, 0, ${1 - opacity})), url('${award.image_url}')`;
              bgStyle += `; background-size: cover; background-position: center;`;
              bgHoverStyle = `linear-gradient(rgba(0, 0, 0, ${
                0.8 - opacity
              }), rgba(0, 0, 0, ${0.8 - opacity})), url('${award.image_url}')`;
              bgHoverStyle += `; background-size: cover; background-position: center;`;
            }

            return `
          <div style="
            background: ${bgStyle};
            border: 1px solid ${borderColor};
            padding: 10px;
            border-radius: 6px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            transition: all 0.3s ease;
            cursor: pointer;
            position: relative;
          "
          onmouseover="this.style.background='${bgHoverStyle}'; this.style.borderColor='${borderColor}'"
          onmouseout="this.style.background='${bgStyle}'; this.style.borderColor='${borderColor}'"
          >
            <div style="margin-bottom: 8px; flex-grow: 1;">
              <div style="color: ${textColor}; font-weight: bold; margin-bottom: 4px; font-size: 0.95em; word-break: break-word; text-shadow: 1px 1px 2px rgba(0,0,0,0.5)">${awardEmoji} ${
              award.username
            }</div>
              <div style="color: #b0b0b0; font-size: 0.8em; margin-bottom: 3px; text-shadow: 1px 1px 1px rgba(0,0,0,0.5)">
                ${awardTypeText[award.award_type] || award.award_type}
              </div>
              <div style="color: #888; font-size: 0.75em; margin-bottom: 3px; text-shadow: 1px 1px 1px rgba(0,0,0,0.5)">
                ${award.event_name ? "🏆 " + award.event_name : "Общая"}
              </div>
              ${
                award.description
                  ? `<div style="color: #ddd; font-size: 0.75em; font-style: italic; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; text-shadow: 1px 1px 1px rgba(0,0,0,0.5)">"${award.description}"</div>`
                  : ""
              }
            </div>
            <div style="display: flex; gap: 6px; margin-top: 8px;">
              <button
                onclick="openEditAwardModal(${award.id}, '${
              award.username
            }', '${award.award_type}', '${award.description || ""}', '${
              award.event_name || ""
            }')"
                style="
                  background: rgba(33, 150, 243, 0.7);
                  color: #87ceeb;
                  border: 1px solid #2196f3;
                  padding: 6px 10px;
                  border-radius: 4px;
                  cursor: pointer;
                  font-size: 0.8em;
                  flex: 1;
                  transition: all 0.2s;
                "
                onmouseover="this.style.background='rgba(33, 150, 243, 0.9)'"
                onmouseout="this.style.background='rgba(33, 150, 243, 0.7)'"
              >
                ✏️ Редакт.
              </button>
              <button
                onclick="removeAward(${award.id})"
                style="
                  background: rgba(244, 67, 54, 0.7);
                  color: #ffb3b3;
                  border: 1px solid #f44336;
                  padding: 6px 10px;
                  border-radius: 4px;
                  cursor: pointer;
                  font-size: 0.8em;
                  flex: 1;
                  transition: all 0.2s;
                "
                onmouseover="this.style.background='rgba(244, 67, 54, 0.9)'"
                onmouseout="this.style.background='rgba(244, 67, 54, 0.7)'"
              >
                🗑️ Удал.
              </button>
            </div>
          </div>
        `;
          })
          .join("")}
      </div>
    `;
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
      console.log(`🎯 Выбран турнир: ${select.value}`);
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
    console.log(`🔍 Загрузка участников для турнира ${eventId}`);
    const response = await fetch(
      `/api/events/${eventId}/tournament-participants`
    );

    if (!response.ok) {
      console.error(`❌ Ошибка ответа сервера: ${response.status}`);
      throw new Error(`Ошибка сервера: ${response.status}`);
    }

    const participants = await response.json();

    console.log("✅ Загруженные участники:", participants);
    console.log(`📊 Количество участников: ${participants.length}`);

    const select = document.getElementById("participantSelectForAward");

    if (!select) {
      console.error("❌ Элемент participantSelectForAward не найден!");
      return;
    }

    // Очищаем текущие опции
    select.innerHTML = '<option value="">-- Выбрать участника --</option>';

    if (!Array.isArray(participants) || participants.length === 0) {
      select.innerHTML =
        '<option value="">-- Участников не найдено --</option>';
      console.warn("⚠️ В турнире нет участников со ставками");
      return;
    }

    // Добавляем участников
    participants.forEach((participant) => {
      const option = document.createElement("option");
      // Используем id вместо user_id (так как API возвращает id)
      const userId = participant.id;
      option.value = String(userId);
      option.textContent = participant.username;
      select.appendChild(option);
      console.log(
        `➕ Добавлен участник: ${participant.username}, ID: ${userId}`
      );
    });

    console.log(`✅ Всего добавлено участников: ${participants.length}`);
  } catch (error) {
    console.error("❌ Ошибка при загрузке участников:", error);
    const select = document.getElementById("participantSelectForAward");
    if (select) {
      select.innerHTML = '<option value="">-- Ошибка загрузки --</option>';
    }
  }
}

async function uploadAwardImageFile(file) {
  if (!file) {
    return null;
  }

  const formData = new FormData();
  formData.append("image", file);

  try {
    const response = await fetch("/api/awards/upload-image", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      const errorMessage = data.error || "Не удалось загрузить изображение";
      throw new Error(errorMessage);
    }

    return data.url;
  } catch (error) {
    console.error("Ошибка при загрузке изображения:", error);
    alert(`❌ Не удалось загрузить изображение: ${error.message}`);
    throw error;
  }
}

// Выдать новую награду
async function assignAward() {
  const eventId = document.getElementById("eventSelectForAward").value;
  const userIdStr = document.getElementById("participantSelectForAward").value;
  const awardType = document.getElementById("awardTypeSelect").value;
  const description = document.getElementById("awardDescriptionInput").value;
  const awardColor =
    document.getElementById("awardColorInput").value || "#fbc02d";
  const awardEmoji = document.getElementById("awardEmojiInput").value || "🏆";
  const imageUrl = document.getElementById("awardImageUrlInput").value;
  const opacity = parseFloat(
    document.getElementById("awardOpacityInput").value
  );

  const imageFileInput = document.getElementById("awardImageFileInput");
  let uploadedImageUrl = null;

  if (imageFileInput && imageFileInput.files.length > 0) {
    try {
      uploadedImageUrl = await uploadAwardImageFile(imageFileInput.files[0]);
      document.getElementById("awardImageUrlInput").value = uploadedImageUrl;
    } catch (uploadError) {
      return;
    }
  }

  const finalImageUrl = uploadedImageUrl || (imageUrl ? imageUrl.trim() : null);

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
        image_url: finalImageUrl || null,
        background_opacity: opacity,
        award_color: awardColor,
        award_emoji: awardEmoji,
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
      document.getElementById("awardColorInput").value = "#fbc02d";
      document.getElementById("awardColorTextInput").value = "#fbc02d";
      document.getElementById("awardEmojiInput").value = "🏆";
      document.getElementById("awardImageUrlInput").value = "";
      if (imageFileInput) {
        imageFileInput.value = "";
      }
      document.getElementById("awardOpacityInput").value = "1";
      document.getElementById("awardOpacityValue").textContent = "1";

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
// Открыть модальное окно редактирования награды
async function openEditAwardModal(
  awardId,
  username,
  awardType,
  description,
  eventName
) {
  // Загружаем текущие данные награды
  try {
    const response = await fetch(`/api/awards/${awardId}`);
    const awardData = await response.json();

    // Используем данные с сервера если они есть
    const imageUrl = awardData.image_url || "";
    const opacity =
      awardData.background_opacity !== undefined
        ? awardData.background_opacity
        : 1;

    // Создаем или обновляем модаль для редактирования
    let editModal = document.getElementById("editAwardModal");

    if (!editModal) {
      // Создаем модаль если её нет
      editModal = document.createElement("div");
      editModal.id = "editAwardModal";
      editModal.style.cssText = `
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        z-index: 1000;
        justify-content: center;
        align-items: center;
      `;
      document.body.appendChild(editModal);
    }

    // Сохраняем ID награды как data атрибут
    editModal.dataset.awardId = awardId;

    editModal.innerHTML = `
    <div style="
      background: #1a1e28;
      border: 1px solid #444;
      padding: 30px;
      border-radius: 8px;
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="color: #5a9fd4; margin: 0;">✏️ Редактировать награду</h2>
        <button onclick="closeEditAwardModal()" style="
          background: none;
          border: none;
          color: #888;
          font-size: 28px;
          cursor: pointer;
          padding: 0;
        ">&times;</button>
      </div>
      
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 8px; color: #e0e0e0; font-weight: bold;">👤 Участник:</label>
        <div style="
          background: #2a2e3a;
          padding: 10px;
          border-radius: 4px;
          color: #fbc02d;
          border: 1px solid rgba(251, 192, 45, 0.5);
        ">${username}</div>
      </div>
      
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 8px; color: #e0e0e0; font-weight: bold;">🏆 Турнир:</label>
        <div style="
          background: #2a2e3a;
          padding: 10px;
          border-radius: 4px;
          color: #b0b0b0;
          border: 1px solid #444;
        ">${eventName || "Общая награда"}</div>
      </div>
      
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 8px; color: #e0e0e0; font-weight: bold;">📋 Тип награды:</label>
        <select id="editAwardTypeSelect" style="
          width: 100%;
          padding: 10px;
          background: #2a2e3a;
          color: #e0e0e0;
          border: 1px solid #444;
          border-radius: 4px;
        ">
          <option value="participant" ${
            awardType === "participant" ? "selected" : ""
          }>👤 Участник турнира</option>
          <option value="winner" ${
            awardType === "winner" ? "selected" : ""
          }>🥇 Победитель</option>
          <option value="best_result" ${
            awardType === "best_result" ? "selected" : ""
          }>⭐ Лучший результат</option>
          <option value="special" ${
            awardType === "special" ? "selected" : ""
          }>🎖️ Специальная награда</option>
        </select>
      </div>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; color: #e0e0e0; font-weight: bold;">📝 Описание (опционально):</label>
        <textarea id="editAwardDescriptionInput" style="
          width: 100%;
          padding: 10px;
          background: #2a2e3a;
          color: #e0e0e0;
          border: 1px solid #444;
          border-radius: 4px;
          min-height: 80px;
          font-family: Arial, sans-serif;
          resize: vertical;
        ">${description || ""}</textarea>
      </div>

      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 8px; color: #e0e0e0; font-weight: bold;">🎨 Цвет награды:</label>
        <div style="display: flex; gap: 10px; align-items: center;">
          <input type="color" id="editAwardColorInput" style="width: 60px; height: 40px; cursor: pointer; border: 1px solid #555; border-radius: 4px;" />
          <input type="text" id="editAwardColorTextInput" style="flex: 1; padding: 8px; background: #2a2e3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;" />
        </div>
      </div>

      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 8px; color: #e0e0e0; font-weight: bold;">😊 Эмодзи награды:</label>
        <input type="text" id="editAwardEmojiInput" maxlength="2" style="
          width: 100%;
          padding: 10px;
          background: #2a2e3a;
          color: #e0e0e0;
          border: 1px solid #444;
          border-radius: 4px;
          font-size: 1.2em;
        " />
        <small style="color: #999;">Выберите эмодзи для награды (максимум 1 символ)</small>
      </div>

      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 8px; color: #e0e0e0; font-weight: bold;">🖼️ Фоновое изображение (URL, опционально):</label>
        <input type="text" id="editAwardImageUrl" placeholder="https://example.com/image.jpg" style="
          width: 100%;
          padding: 10px;
          background: #2a2e3a;
          color: #e0e0e0;
          border: 1px solid #444;
          border-radius: 4px;
          font-family: Arial, sans-serif;
        " />
        <small style="color: #999; display: block; margin-top: 4px;">Укажите URL картинки для фона награды</small>
      </div>

      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 8px; color: #e0e0e0; font-weight: bold;">📁 Загрузить изображение с устройства:</label>
        <input type="file" id="editAwardImageFileInput" accept="image/*" style="
          width: 100%;
          padding: 6px;
          background: #2a2e3a;
          color: #e0e0e0;
          border: 1px solid #444;
          border-radius: 4px;
        " />
        <small style="color: #999; display: block; margin-top: 4px;">Выберите файл, чтобы загрузить новое изображение</small>
      </div>

      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; color: #e0e0e0; font-weight: bold;">
          🌓 Прозрачность фона: <span id="opacityValue" style="color: #fbc02d;">1</span>
        </label>
        <input type="range" id="editAwardOpacity" min="0" max="1" step="0.1" value="1" style="
          width: 100%;
          cursor: pointer;
        " onchange="document.getElementById('opacityValue').textContent = this.value" />
        <small style="color: #999;">0 = полностью прозрачный, 1 = полностью видимый</small>
      </div>
      
      <div style="display: flex; gap: 10px;">
        <button onclick="saveEditAward()" style="
          flex: 1;
          background: rgba(76, 175, 80, 0.7);
          color: #a8d5a8;
          border: 1px solid #4caf50;
          padding: 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 1em;
          font-weight: bold;
          transition: all 0.2s;
        "
        onmouseover="this.style.background='rgba(76, 175, 80, 0.9)'"
        onmouseout="this.style.background='rgba(76, 175, 80, 0.7)'"
        >
          ✅ Сохранить
        </button>
        <button onclick="closeEditAwardModal()" style="
          flex: 1;
          background: rgba(158, 158, 158, 0.5);
          color: #d0d0d0;
          border: 1px solid #999;
          padding: 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 1em;
          transition: all 0.2s;
        "
        onmouseover="this.style.background='rgba(158, 158, 158, 0.7)'"
        onmouseout="this.style.background='rgba(158, 158, 158, 0.5)'"
        >
          ❌ Отмена
        </button>
      </div>
    </div>
  `;

    // Устанавливаем текущие значения
    setTimeout(() => {
      const imageInput = document.getElementById("editAwardImageUrl");
      const opacityInput = document.getElementById("editAwardOpacity");
      const colorInput = document.getElementById("editAwardColorInput");
      const colorText = document.getElementById("editAwardColorTextInput");
      const emojiInput = document.getElementById("editAwardEmojiInput");

      if (imageInput) imageInput.value = imageUrl;
      if (opacityInput) {
        opacityInput.value = opacity;
        document.getElementById("opacityValue").textContent = opacity;
      }

      const awardColor = awardData.award_color || "#fbc02d";
      const awardEmoji = awardData.award_emoji || "🏆";

      if (colorInput) colorInput.value = awardColor;
      if (colorText) colorText.value = awardColor;
      if (emojiInput) emojiInput.value = awardEmoji;
    }, 0);

    editModal.style.display = "flex";
  } catch (error) {
    console.error("Ошибка при загрузке данных награды:", error);
    alert("❌ Ошибка при загрузке данных награды");
  }
}

// Закрыть модаль редактирования
function closeEditAwardModal() {
  const editModal = document.getElementById("editAwardModal");
  const editFileInput = document.getElementById("editAwardImageFileInput");
  if (editFileInput) {
    editFileInput.value = "";
  }
  if (editModal) {
    editModal.style.display = "none";
  }
}

// Сохранить изменения награды
async function saveEditAward() {
  const editModal = document.getElementById("editAwardModal");
  const awardId = editModal.dataset.awardId;
  const newAwardType = document.getElementById("editAwardTypeSelect").value;
  const newDescription = document.getElementById(
    "editAwardDescriptionInput"
  ).value;
  const newImageUrl = document.getElementById("editAwardImageUrl").value;
  const newOpacity = parseFloat(
    document.getElementById("editAwardOpacity").value
  );
  const newAwardColor =
    document.getElementById("editAwardColorInput").value || "#fbc02d";
  const newAwardEmoji =
    document.getElementById("editAwardEmojiInput").value || "🏆";

  const editImageFileInput = document.getElementById("editAwardImageFileInput");
  let uploadedEditImageUrl = null;

  if (editImageFileInput && editImageFileInput.files.length > 0) {
    try {
      uploadedEditImageUrl = await uploadAwardImageFile(
        editImageFileInput.files[0]
      );
      document.getElementById("editAwardImageUrl").value = uploadedEditImageUrl;
    } catch (uploadError) {
      return;
    }
  }

  const finalEditImageUrl =
    uploadedEditImageUrl || (newImageUrl ? newImageUrl.trim() : null);

  try {
    const response = await fetch(`/api/awards/${awardId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        award_type: newAwardType,
        description: newDescription || null,
        image_url: finalEditImageUrl || null,
        background_opacity: newOpacity,
        award_color: newAwardColor,
        award_emoji: newAwardEmoji,
      }),
    });

    const data = await response.json();

    if (data.success) {
      alert("✅ Награда успешно обновлена");
      if (editImageFileInput) {
        editImageFileInput.value = "";
      }
      closeEditAwardModal();
      loadAwardsList();
    } else {
      alert(`❌ Ошибка: ${data.error || "Неизвестная ошибка"}`);
    }
  } catch (error) {
    console.error("Ошибка при обновлении награды:", error);
    alert(`❌ Ошибка при обновлении награды: ${error.message}`);
  }
}

// Закрыть модаль при клике вне её
document.addEventListener("click", function (event) {
  const editModal = document.getElementById("editAwardModal");
  if (editModal && event.target === editModal) {
    closeEditAwardModal();
  }
});

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

// ===== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ (ДЛЯ АДМИНА) =====

let adminUsers = [];

// Загрузить список всех пользователей
async function loadAdminUsers() {
  if (!canViewUsers()) {
    alert("У вас нет прав для просмотра пользователей");
    return;
  }

  try {
    const response = await fetch(
      `/api/admin/users?username=${currentUser.username}`
    );
    adminUsers = await response.json();
    displayAdminUsersModal();
    
    // Показываем/скрываем кнопку синхронизации в зависимости от прав
    const syncBtn = document.getElementById('syncTelegramIdsBtn');
    if (syncBtn) {
      if (isAdmin() || hasModeratorPermission('sync_telegram_ids')) {
        syncBtn.style.display = 'inline-block';
      } else {
        syncBtn.style.display = 'none';
      }
    }
    
    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    document.getElementById("adminModal").style.display = "flex";
  } catch (error) {
    console.error("Ошибка при загрузке пользователей:", error);
    alert("Ошибка при загрузке пользователей");
  }
}

// Закрыть модальное окно
function closeAdminModal() {
  document.getElementById("adminModal").style.display = "none";
  // Разблокируем скролл body
  document.body.style.overflow = '';
  unlockBodyScroll();
}

// Загрузить подсчет результатов
function loadCounting() {
  if (!canViewCounting()) {
    alert("У вас нет прав");
    return;
  }

  // Здесь будет функционал для подсчета
  const countingContainer = document.getElementById("countingContainer");

  if (countingContainer) {
    countingContainer.innerHTML =
      '<div class="empty-message">Функция в разработке</div>';
  }
}

// Отправить результаты подсчета
async function sendCountingResults() {
  if (!canViewCounting()) {
    alert("У вас нет прав");
    return;
  }

  const dateFrom = document.getElementById("countingDateFrom")?.value;
  const dateTo = document.getElementById("countingDateTo")?.value;

  if (!dateFrom || !dateTo) {
    alert("Выберите период дат");
    return;
  }

  try {
    const response = await fetch('/api/admin/send-counting-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateFrom, dateTo })
    });

    if (response.ok) {
      await showCustomAlert("Результаты отправлены в группу!", "Успешно", "✅");
    } else {
      const error = await response.json();
      await showCustomAlert(error.error || "Не удалось отправить результаты", "Ошибка", "❌");
    }
  } catch (error) {
    console.error("Ошибка отправки результатов:", error);
    await showCustomAlert("Ошибка при отправке результатов", "Ошибка", "❌");
  }
}

// Открыть модалку пересчета
async function openRecountModal() {
  if (!canViewCounting()) {
    alert("У вас нет прав");
    return;
  }
  
  try {
    // Очищаем прогнозы для матчей с отключенными чекбоксами
    const cleanupResponse = await fetch('/api/admin/cleanup-disabled-predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username
      })
    });
    
    if (cleanupResponse.ok) {
      const result = await cleanupResponse.json();
      console.log('✅ Очистка прогнозов:', result);
    }
  } catch (error) {
    console.error("⚠️ Ошибка очистки прогнозов:", error);
  }
  
  // Устанавливаем текущую дату по умолчанию
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('recountDate').value = today;
  
  // Загружаем список турниров
  await loadEventsForRecount(today);
  
  document.getElementById('recountModal').style.display = 'flex';
}

// Загрузить список турниров для выбранной даты
async function loadEventsForRecount(date) {
  try {
    const response = await fetch(`/api/admin/get-events-for-date?date=${date}`);
    
    if (response.ok) {
      const data = await response.json();
      const eventSelect = document.getElementById('recountEvent');
      const roundSelect = document.getElementById('recountRound');
      
      // Очищаем списки
      eventSelect.innerHTML = '<option value="">Выберите турнир...</option>';
      roundSelect.innerHTML = '<option value="">Сначала выберите турнир...</option>';
      roundSelect.disabled = true;
      
      // Добавляем турниры
      if (data.events && data.events.length > 0) {
        data.events.forEach(event => {
          const option = document.createElement('option');
          option.value = event.event_id;
          option.textContent = `${event.event_name} (${event.matches_count} матчей)`;
          eventSelect.appendChild(option);
        });
      } else {
        eventSelect.innerHTML = '<option value="">Нет турниров для этой даты</option>';
      }
    }
  } catch (error) {
    console.error("Ошибка загрузки турниров:", error);
  }
}

// Загрузить список туров для выбранного турнира и даты
async function loadRoundsForRecount(eventId, date) {
  try {
    const response = await fetch(`/api/admin/get-rounds-for-event?eventId=${eventId}&date=${date}`);
    
    if (response.ok) {
      const data = await response.json();
      const roundSelect = document.getElementById('recountRound');
      
      // Очищаем список
      roundSelect.innerHTML = '<option value="">Выберите тур...</option>';
      roundSelect.disabled = false;
      
      // Добавляем туры
      if (data.rounds && data.rounds.length > 0) {
        data.rounds.forEach(round => {
          const option = document.createElement('option');
          option.value = round.round;
          option.textContent = `${round.round} (${round.matches_count} матчей, завершено: ${round.finished_count})`;
          roundSelect.appendChild(option);
        });
      } else {
        roundSelect.innerHTML = '<option value="">Нет туров для этого турнира</option>';
      }
    }
  } catch (error) {
    console.error("Ошибка загрузки туров:", error);
  }
}

// Обработчики изменения даты и турнира в модалке пересчета
document.addEventListener('DOMContentLoaded', () => {
  const recountDateInput = document.getElementById('recountDate');
  if (recountDateInput) {
    recountDateInput.addEventListener('change', (e) => {
      loadEventsForRecount(e.target.value);
    });
  }
  
  const recountEventSelect = document.getElementById('recountEvent');
  if (recountEventSelect) {
    recountEventSelect.addEventListener('change', (e) => {
      const eventId = e.target.value;
      const date = document.getElementById('recountDate').value;
      if (eventId && date) {
        loadRoundsForRecount(eventId, date);
      } else {
        const roundSelect = document.getElementById('recountRound');
        roundSelect.innerHTML = '<option value="">Сначала выберите турнир...</option>';
        roundSelect.disabled = true;
      }
    });
  }
});

// Закрыть модалку пересчета
function closeRecountModal() {
  document.getElementById('recountModal').style.display = 'none';
}

// Подтвердить пересчет
async function confirmRecount() {
  const date = document.getElementById('recountDate').value;
  const round = document.getElementById('recountRound').value.trim();
  const sendToGroup = document.getElementById('recountSendToGroup').checked;
  const sendToUsers = document.getElementById('recountSendToUsers').checked;

  if (!date) {
    await showCustomAlert("Выберите дату", "Ошибка", "❌");
    return;
  }

  if (!round) {
    await showCustomAlert("Выберите тур", "Ошибка", "❌");
    return;
  }

  // Форматируем дату для отображения
  const dateObj = new Date(date);
  const formattedDate = dateObj.toLocaleDateString('ru-RU');

  // Формируем сообщение подтверждения
  let confirmMessage = `<div style="text-align: left; line-height: 1.8;">
    <p style="margin-bottom: 15px;"><strong>Вы уверены что хотите пересчитать результаты?</strong></p>
    
    <div style="background: rgba(255, 152, 0, 0.1); padding: 12px; border-radius: 5px; margin-bottom: 15px;">
      <div style="margin-bottom: 8px;">📅 <strong>Дата:</strong> ${formattedDate}</div>
      <div>🏆 <strong>Тур:</strong> ${round}</div>
    </div>
    
    <p style="margin-bottom: 10px;"><strong>Это действие:</strong></p>
    <ul style="margin: 0; padding-left: 20px;">
      <li>Сбросит результаты матчей</li>
      <li>Пересчитает их заново</li>`;
  
  if (sendToGroup) {
    confirmMessage += `\n      <li style="color: rgb(76, 175, 80);">✅ Отправит результаты в группу</li>`;
  }
  
  if (sendToUsers) {
    confirmMessage += `\n      <li style="color: rgb(76, 175, 80);">✅ Отправит результаты пользователям в ЛС</li>`;
  }
  
  confirmMessage += `
    </ul>
  </div>`;

  // Подтверждение действия
  const confirmed = await showCustomConfirm(confirmMessage, "Подтверждение пересчета", "⚠️");

  if (!confirmed) {
    return;
  }

  try {
    closeRecountModal();
    
    // Показываем индикатор загрузки
    await showCustomAlert("Пересчет результатов...", "Обработка", "⏳");

    const response = await fetch('/api/admin/recount-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        date,
        round,
        sendToGroup,
        sendToUsers
      })
    });

    if (response.ok) {
      const result = await response.json();
      await showCustomAlert(
        result.message || "Результаты успешно пересчитаны!",
        "Успешно",
        "✅"
      );
      
      // Обновляем данные подсчета если они отображаются
      if (document.getElementById('counting-content').style.display !== 'none') {
        loadCounting();
      }
    } else {
      const error = await response.json();
      await showCustomAlert(
        error.error || "Не удалось пересчитать результаты",
        "Ошибка",
        "❌"
      );
    }
  } catch (error) {
    console.error("Ошибка пересчета результатов:", error);
    await showCustomAlert("Ошибка при пересчете результатов", "Ошибка", "❌");
  }
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
        ${canCheckBot() ? `
        <button class="admin-btn admin-btn-bot-check" onclick="checkUserBotContact(${
          user.id
        }, '${user.username}')" title="Проверка писал ли пользователь боту">🤖</button>
        ` : ''}
        ${canViewSettings() ? `
        <button class="admin-btn admin-btn-settings" onclick="sendUserSettingsToAdmin(${
          user.id
        }, '${user.username}')" title="Получить настройки пользователя">⚙️</button>
        ` : ''}
        ${canEditUsers() && (isAdmin() || user.username !== ADMIN_DB_NAME) ? `
        <button class="admin-btn admin-btn-rename" onclick="renameUser(${
          user.id
        }, '${user.username}')" title="Переименовать пользователя">✏️</button>
        ` : ''}
        ${canDeleteUsers() && user.username !== ADMIN_DB_NAME ? `
        <button class="admin-btn admin-btn-delete" onclick="deleteUser(${
          user.id
        }, '${user.username}')" title="Удалить пользователя">🗑️</button>
        ` : ''}
      </div>
    </div>
  `
    )
    .join("");
}

// Проверить, писал ли пользователь боту
async function checkUserBotContact(userId, username) {
  if (!canCheckBot()) {
    await showCustomAlert("У вас нет прав", "Ошибка", "❌");
    return;
  }

  try {
    const response = await fetch(`/api/admin/users/${userId}/bot-contact-check?username=${currentUser.username}`);
    const result = await response.json();

    if (!response.ok) {
      await showCustomAlert(result.error, "Ошибка", "❌");
      return;
    }

    let message = `
      <div style="text-align: left; line-height: 1.8;">
        <div style="margin-bottom: 15px; font-size: 16px; font-weight: bold; color: #fff;">
          👤 Пользователь: ${username}
        </div>
    `;

    if (result.telegram_username) {
      message += `
        <div style="margin-bottom: 15px; padding: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 6px;">
          <div style="margin-bottom: 8px;">📱 Telegram: <strong>@${result.telegram_username}</strong></div>
        </div>
      `;
      
      if (result.has_bot_contact) {
        message += `
          <div style="background: rgba(76, 175, 80, 0.1); padding: 12px; border-radius: 6px; margin-bottom: 15px; border-left: 3px solid #4caf50;">
            <div style="font-weight: bold; margin-bottom: 8px; color: #4caf50;">✅ Статус: Писал боту в личку</div>
            <div style="font-size: 14px; color: #aaa;">
              💬 Chat ID: <strong style="color: #fff;">${result.telegram_id}</strong><br>
              🔐 2FA при логине: <strong style="color: ${result.require_login_2fa ? '#4caf50' : '#ff9800'};">${result.require_login_2fa ? 'Включено' : 'Отключено'}</strong>
            </div>
          </div>
        `;
      } else {
        message += `
          <div style="background: rgba(244, 67, 54, 0.1); padding: 12px; border-radius: 6px; margin-bottom: 15px; border-left: 3px solid #f44336;">
            <div style="font-weight: bold; margin-bottom: 8px; color: #f44336;">❌ Статус: НЕ писал боту в личку</div>
            <div style="font-size: 14px; margin-bottom: 10px;">
              <strong style="color: #ff9800;">⚠️ Пользователь НЕ сможет:</strong>
            </div>
            <div style="font-size: 14px; margin-left: 15px; color: #aaa;">
              • Получать коды подтверждения при логине<br>
              • Получать коды для выхода с устройств<br>
              • Получать коды для изменения Telegram
            </div>
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(244, 67, 54, 0.3); font-size: 14px; color: #fff;">
              💡 Нужно написать боту <strong>@OnexBetLineBoomBot</strong> команду <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 3px;">/start</code> в личных сообщениях!
            </div>
          </div>
        `;
      }
    } else {
      message += `
        <div style="background: rgba(244, 67, 54, 0.1); padding: 12px; border-radius: 6px; border-left: 3px solid #f44336;">
          <div style="font-weight: bold; margin-bottom: 8px; color: #f44336;">❌ Telegram не привязан</div>
          <div style="font-size: 14px; color: #aaa;">
            Пользователь должен привязать Telegram в настройках профиля.
          </div>
        </div>
      `;
    }

    message += `</div>`;

    await showCustomAlert(message, "Проверка контакта с ботом", "🤖");
  } catch (error) {
    console.error("Ошибка при проверке контакта с ботом:", error);
    await showCustomAlert("Ошибка при проверке контакта с ботом", "Ошибка", "❌");
  }
}

// Синхронизировать telegram_id для всех пользователей
async function syncAllTelegramIds() {
  if (!isAdmin() && !hasModeratorPermission('sync_telegram_ids')) {
    await showCustomAlert("У вас нет прав", "Ошибка", "❌");
    return;
  }

  const shouldContinue = await showCustomConfirm(
    'Эта операция обновит telegram_id (chat_id) для всех пользователей с привязанным Telegram. Продолжить?',
    'Синхронизация Telegram ID',
    '🤖'
  );

  if (!shouldContinue) {
    return;
  }

  try {
    const response = await fetch('/api/admin/sync-telegram-ids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username })
    });

    const result = await response.json();

    if (!response.ok) {
      await showCustomAlert(result.error, 'Ошибка', '❌');
      return;
    }

    let message = `
      <div style="text-align: left; line-height: 1.8;">
        <div style="margin-bottom: 15px; font-size: 16px; font-weight: bold; color: #4caf50;">
          ✅ Синхронизация завершена успешно!
        </div>
        
        <div style="margin-bottom: 10px; font-size: 15px; font-weight: bold; color: #fff;">
          📊 Общая статистика:
        </div>
        <div style="border-top: 1px solid rgba(255,255,255,0.2); margin-bottom: 10px;"></div>
        
        <div style="margin-bottom: 8px;">👥 Всего пользователей с Telegram: <strong>${result.total}</strong></div>
        <div style="margin-bottom: 8px; color: #4caf50;">✅ Обновлено telegram_id: <strong>${result.updated}</strong></div>
        <div style="margin-bottom: 8px; color: #2196f3;">✓ Уже были актуальны: <strong>${result.skipped}</strong></div>
        <div style="margin-bottom: 15px; color: #ff9800;">⚠️ Не найдены в telegram_users: <strong>${result.not_found}</strong></div>
    `;

    if (result.updated > 0) {
      message += `
        <div style="background: rgba(76, 175, 80, 0.1); padding: 12px; border-radius: 6px; margin-bottom: 15px; border-left: 3px solid #4caf50;">
          <div style="font-weight: bold; margin-bottom: 5px; color: #4caf50;">💡 Что это значит:</div>
          <div style="font-size: 14px;">
            Для ${result.updated} пользовател${result.updated === 1 ? 'я' : 'ей'} был найден и сохранен chat_id из таблицы telegram_users.<br>
            Теперь они смогут получать коды подтверждения через бота.
          </div>
        </div>
      `;
    }

    if (result.not_found > 0) {
      message += `
        <div style="background: rgba(255, 152, 0, 0.1); padding: 12px; border-radius: 6px; margin-bottom: 15px; border-left: 3px solid #ff9800;">
          <div style="font-weight: bold; margin-bottom: 5px; color: #ff9800;">⚠️ Внимание:</div>
          <div style="font-size: 14px;">
            ${result.not_found} пользовател${result.not_found === 1 ? 'ь' : 'ей'} не найден${result.not_found === 1 ? '' : 'ы'} в telegram_users.<br>
            Это значит, что они:<br>
            <div style="margin-left: 15px; margin-top: 5px; margin-bottom: 10px;">
              • Привязали Telegram username в настройках<br>
              • Но НЕ писали боту /start в личку<br>
              • Не смогут получать коды подтверждения
            </div>
      `;
      
      if (result.not_found_users && result.not_found_users.length > 0) {
        message += `
          <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255, 152, 0, 0.3);">
            <div style="font-weight: bold; margin-bottom: 8px; color: #ff9800;">Список пользователей:</div>
        `;
        
        result.not_found_users.forEach(user => {
          message += `
            <div style="background: rgba(0, 0, 0, 0.2); padding: 8px; border-radius: 4px; margin-bottom: 6px;">
              <div style="font-weight: bold;">👤 ${user.username}</div>
              <div style="font-size: 13px; color: #aaa; margin-left: 20px;">
                📱 @${user.telegram_username}
              </div>
            </div>
          `;
        });
        
        message += `</div>`;
      }
      
      message += `
          </div>
        </div>
      `;
    }

    if (result.details && result.details.length > 0) {
      message += `
        <div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 15px 0 10px 0;"></div>
        <div style="font-weight: bold; margin-bottom: 10px; color: #fff;">📝 Обновленные пользователи:</div>
      `;
      
      result.details.forEach(detail => {
        message += `
          <div style="background: rgba(255, 255, 255, 0.05); padding: 10px; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid #2196f3;">
            <div style="font-weight: bold; margin-bottom: 3px;">👤 ${detail.username}</div>
            <div style="font-size: 13px; color: #aaa; margin-left: 20px;">
              📱 @${detail.telegram_username}<br>
              💬 Chat ID: ${detail.telegram_id}
            </div>
          </div>
        `;
      });
    }

    if (result.without_telegram > 0 && result.without_telegram_users) {
      message += `
        <div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 15px 0 10px 0;"></div>
        <div style="background: rgba(244, 67, 54, 0.1); padding: 12px; border-radius: 6px; margin-bottom: 15px; border-left: 3px solid #f44336;">
          <div style="font-weight: bold; margin-bottom: 5px; color: #f44336;">❌ Без Telegram:</div>
          <div style="font-size: 14px; margin-bottom: 10px;">
            ${result.without_telegram} пользовател${result.without_telegram === 1 ? 'ь' : 'ей'} не привязал${result.without_telegram === 1 ? '' : 'и'} Telegram.<br>
            Они не смогут использовать функции с подтверждением через бота.
          </div>
          <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(244, 67, 54, 0.3);">
            <div style="font-weight: bold; margin-bottom: 8px; color: #f44336;">Список пользователей:</div>
      `;
      
      result.without_telegram_users.forEach(user => {
        message += `
          <div style="background: rgba(0, 0, 0, 0.2); padding: 8px; border-radius: 4px; margin-bottom: 6px;">
            <div style="font-weight: bold;">👤 ${user.username}</div>
            <div style="font-size: 13px; color: #aaa; margin-left: 20px;">
              📱 Telegram не привязан
            </div>
          </div>
        `;
      });
      
      message += `
          </div>
        </div>
      `;
    }

    if (result.updated === 0 && result.not_found === 0 && result.without_telegram === 0) {
      message += `
        <div style="background: rgba(76, 175, 80, 0.1); padding: 12px; border-radius: 6px; border-left: 3px solid #4caf50;">
          <div style="font-size: 14px; color: #4caf50;">
            ✓ Все пользователи уже имеют актуальный telegram_id.<br>
            Дополнительных действий не требуется.
          </div>
        </div>
      `;
    }

    message += `</div>`;

    await showCustomAlert(message, 'Синхронизация завершена', '✅');
    
    // Перезагружаем список пользователей
    await loadAdminUsers();
  } catch (error) {
    console.error("Ошибка при синхронизации:", error);
    await showCustomAlert('Ошибка при синхронизации telegram_id', 'Ошибка', '❌');
  }
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
  if (!canEditUsers()) {
    alert("У вас нет прав");
    return;
  }

  // Проверяем, не пытается ли переименовать админа
  if (currentUsername === ADMIN_DB_NAME && !isAdmin()) {
    alert("❌ Модератор не может переименовать администратора!");
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

// Отправить настройки пользователя админу в Telegram
async function sendUserSettingsToAdmin(userId, username) {
  if (!canViewSettings()) {
    alert("У вас нет прав");
    return;
  }

  try {
    const response = await fetch(`/api/admin/user-settings/${userId}`, {
      method: "POST",
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

    // Настройки отправлены успешно (без алерта)
  } catch (error) {
    console.error("Ошибка при отправке настроек:", error);
    alert("Ошибка при отправке настроек");
  }
}

// Удалить пользователя
async function deleteUser(userId, username) {
  if (!canDeleteUsers()) {
    alert("У вас нет прав");
    return;
  }

  // Проверяем, не пытается ли удалить админа
  if (username === ADMIN_DB_NAME) {
    alert("❌ Нельзя удалить администратора!");
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

// Тест уведомлений в группу
async function testGroupNotification() {
  if (!isAdmin()) {
    alert("У вас нет прав");
    return;
  }

  const testRealGroup = document.getElementById('testRealGroupCheckbox')?.checked || false;

  try {
    const response = await fetch("/api/admin/test-group-notification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser.username,
        testMode: !testRealGroup // Если чекбокс выключен - тестовый режим (только админу)
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert("Ошибка: " + result.error);
      return;
    }

    await showCustomAlert(
      testRealGroup 
        ? 'Тестовое уведомление отправлено в группу' 
        : 'Тестовое уведомление отправлено только админу',
      'Успешно',
      '✅'
    );
    console.log(`✅ Тестовое уведомление отправлено ${testRealGroup ? 'в группу' : 'админу'}`);
  } catch (error) {
    console.error("Ошибка при отправке тестового уведомления:", error);
    alert("Ошибка при отправке уведомления");
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

    // Обновляем currentUser с актуальными данными
    currentUser.telegram_username = telegramUsername;

    // Загружаем все настройки уведомлений
    const notifResponse = await fetch(
      `/api/user/${currentUser.id}/notifications`
    );
    const notifData = await notifResponse.json();
    const telegramNotificationsEnabled =
      notifData.telegram_notifications_enabled ?? true;
    const telegramGroupRemindersEnabled =
      notifData.telegram_group_reminders_enabled ?? true;

    // Вставляем Telegram username настройку ПЕРЕД чекбоксом уведомлений
    const settingsContainer = document.getElementById("settingsContainer");

    // Удаляем старый элемент Telegram если он существует
    const oldTelegramElement = settingsContainer.querySelector(
      '[id="telegramSettingsElement"]'
    );
    if (oldTelegramElement) {
      oldTelegramElement.remove();
    }

    const telegramHTML = `
      <!-- Telegram -->
      <div id="telegramSettingsElement" class="setting-item" style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); position: relative;">
        <button onclick="openTelegramBindInfoModal()" style="
          position: absolute;
          top: 0;
          right: 0;
          background: transparent;
          border: none;
          border-radius: 6px;
          border-left: 1px solid rgb(58, 123, 213);
          border-bottom: 1px solid rgb(58, 123, 213);
          color: #5a9fd4;
          width: 28px;
          height: 28px;
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s ease;
        " onmouseover="this.style.background='transparent'; this.style.transform='scale(1.1)'" onmouseout="this.style.background='transparent'; this.style.transform='scale(1)'" title="Информация о Telegram">❔</button>
        <div class="setting-label">
          <span>📱 Telegram</span>
          ${
            telegramUsername
              ? `<a href="https://t.me/${telegramUsername}" target="_blank" class="setting-link">@${telegramUsername}</a>`
              : ""
          }
        </div>
        <p class="setting-hint">ТГ для уведомлений/напоминаний</p>
        ${telegramUsername ? `
        <div class="setting-control">
          <input type="text" id="telegramUsernameInput" value="${telegramUsername}" placeholder="@username" disabled style="opacity: 0.6; cursor: not-allowed;">
          <div class="setting-buttons">
            <button onclick="deleteTelegramUsername()" class="btn-delete">🗑️</button>
          </div>
        </div>
        <p class="setting-hint-small">Информацию можно узнать в <a href="https://t.me/OnexBetLineBoomBot" target="_blank">боте</a></p>
        ` : `
        <button 
          onclick="window.open('https://t.me/OnexBetLineBoomBot?start=link_${currentUser.id}', '_blank')" 
          style="
            margin-top: 10px;
            background: rgba(90, 159, 212, 0.2);
            color: #5a9fd4;
            border: 1px solid #5a9fd4;
            padding: 10px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.3s ease;
            width: 100%;
          "
          onmouseover="this.style.background='rgba(90, 159, 212, 0.3)'; this.style.transform='scale(1.02)'"
          onmouseout="this.style.background='rgba(90, 159, 212, 0.2)'; this.style.transform='scale(1)'"
        >
          🔗 Привязать свой ТГ
        </button>
        `}
      </div>
    `;

    // Вставляем Telegram настройку в начало контейнера
    settingsContainer.insertAdjacentHTML("afterbegin", telegramHTML);

    // Инициализируем оба checkbox
    const notifCheckbox = document.getElementById(
      "telegramNotificationsCheckbox"
    );
    if (notifCheckbox) {
      notifCheckbox.checked = telegramNotificationsEnabled;
    }

    const remindersCheckbox = document.getElementById("groupRemindersCheckbox");
    if (remindersCheckbox) {
      remindersCheckbox.checked = telegramGroupRemindersEnabled;
    }

    // Загружаем настройку подтверждения логина через бота
    const login2faCheckbox = document.getElementById("login2faCheckbox");
    if (login2faCheckbox) {
      login2faCheckbox.checked = currentUser.require_login_2fa !== 0; // По умолчанию включено
    }

    // Загружаем настройку звука в LIVE матчах
    const liveSoundCheckbox = document.getElementById("liveSoundCheckbox");
    if (liveSoundCheckbox) {
      liveSoundCheckbox.checked = notifData.live_sound === true; // По умолчанию выключено
    }

    // Загружаем настройку показа победителя
    await loadShowTournamentWinnerSetting();

    // Инициализируем часовые поясы
    await initTimezoneSettings();

    // Загружаем настройку показа ставок
    await loadShowBetsSettings();
    
    // Загружаем настройку кнопки "Мне повезет"
    await loadLuckyButtonSettings();
    
    // Загружаем конфигурацию админ-панели для админов
    if (currentUser.isAdmin) {
      await loadAdminPanelConfig();
    }
    
    // Загружаем настройку кнопки xG
    await loadXgButtonSettings();
    
    // Загружаем видимость карточки напоминаний в группе
    await loadGroupRemindersCardVisibility();
  } catch (error) {
    console.error("Ошибка при загрузке настроек:", error);
    // Не очищаем контейнер, чтобы статический HTML остался видимым
    console.warn("Используем статические настройки из HTML");
  }
}

// Загрузить видимость карточки напоминаний в группе
async function loadGroupRemindersCardVisibility() {
  try {
    const response = await fetch('/api/admin/group-reminders-card-visibility');
    const result = await response.json();
    
    const card = document.getElementById('groupRemindersCard');
    const btn = document.getElementById('toggleGroupRemindersCardBtn');
    
    if (card) {
      // Показываем карточку только если она НЕ скрыта
      card.style.display = result.hidden ? 'none' : 'block';
    }
    
    if (btn && currentUser && currentUser.isAdmin) {
      btn.textContent = result.hidden ? '👁️ Показать напоминания ТГ' : '🚫 Скрыть напоминания ТГ';
      btn.style.background = result.hidden ? 'rgba(76, 175, 80, 0.7)' : 'rgba(255, 87, 34, 0.7)';
      btn.style.color = result.hidden ? '#c8e6c9' : '#ffe0d6';
      btn.style.borderColor = result.hidden ? '#4caf50' : '#ff5722';
    }
  } catch (error) {
    console.error('Ошибка при загрузке видимости карточки:', error);
    // При ошибке показываем карточку (безопасное поведение по умолчанию)
    const card = document.getElementById('groupRemindersCard');
    if (card) {
      card.style.display = 'block';
    }
  }
}
// Сохранить Telegram username
async function saveTelegramUsername() {
  if (!currentUser) {
    await showCustomAlert("Сначала войдите в систему", "Ошибка", "❌");
    return;
  }

  const input = document.getElementById("telegramUsernameInput");
  const username = input.value.trim();

  // Если у пользователя уже есть привязанный Telegram, требуем подтверждение
  if (currentUser.telegram_username) {
    const confirmed = await showCustomConfirm(
      "Для изменения Telegram логина требуется подтверждение. Вам будет отправлено сообщение в Telegram с кодом подтверждения. Продолжить?",
      "Подтверждение изменения",
      "⚠️"
    );
    
    if (!confirmed) {
      return;
    }

    try {
      // Запрашиваем код подтверждения
      const response = await fetch(`/api/user/${currentUser.id}/telegram/request-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_telegram_username: username }),
      });

      const result = await response.json();

      if (response.ok) {
        // Показываем поле для ввода кода
        const code = await showCustomPrompt(
          "Введите код подтверждения, отправленный вам в Telegram:",
          "Подтверждение",
          "🔐",
          "Код из Telegram"
        );
        if (!code) return;

        // Подтверждаем изменение
        const confirmResponse = await fetch(`/api/user/${currentUser.id}/telegram/confirm-change`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            new_telegram_username: username,
            confirmation_code: code 
          }),
        });

        const confirmResult = await confirmResponse.json();

        if (confirmResponse.ok) {
          await showCustomAlert("Telegram логин успешно изменен!", "Успех", "✅");
          currentUser.telegram_username = username;
          loadSettings();
        } else {
          await showCustomAlert(confirmResult.error, "Ошибка", "❌");
        }
      } else {
        await showCustomAlert(result.error, "Ошибка", "❌");
      }
    } catch (error) {
      console.error("Ошибка при изменении:", error);
      await showCustomAlert("Ошибка при изменении", "Ошибка", "❌");
    }
  } else {
    // Первая привязка - без подтверждения
    try {
      const response = await fetch(`/api/user/${currentUser.id}/telegram`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_username: username }),
      });

      const result = await response.json();

      if (response.ok) {
        currentUser.telegram_username = username;
        loadSettings();
      } else {
        await showCustomAlert("Ошибка: " + result.error, "Ошибка", "❌");
      }
    } catch (error) {
      console.error("Ошибка при сохранении:", error);
      await showCustomAlert("Ошибка при сохранении", "Ошибка", "❌");
    }
  }
}

// Удалить Telegram username
async function deleteTelegramUsername() {
  if (!currentUser) {
    await showCustomAlert("Сначала войдите в систему", "Ошибка", "❌");
    return;
  }

  if (!currentUser.telegram_username) {
    await showCustomAlert("Telegram логин не привязан", "Ошибка", "❌");
    return;
  }

  const confirmed = await showCustomConfirm(
    "Для удаления Telegram логина требуется подтверждение. Вам будет отправлено сообщение в Telegram с кодом подтверждения. Продолжить?",
    "Подтверждение удаления",
    "⚠️"
  );
  
  if (!confirmed) {
    return;
  }

  try {
    // Запрашиваем код подтверждения
    const response = await fetch(`/api/user/${currentUser.id}/telegram/request-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const result = await response.json();

    if (response.ok) {
      // Показываем поле для ввода кода
      const code = await showCustomPrompt(
        "Введите код подтверждения, отправленный вам в Telegram:",
        "Подтверждение",
        "🔐",
        "Код из Telegram"
      );
      if (!code) return;

      // Подтверждаем удаление
      const confirmResponse = await fetch(`/api/user/${currentUser.id}/telegram/confirm-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation_code: code }),
      });

      const confirmResult = await confirmResponse.json();

      if (confirmResponse.ok) {
        await showCustomAlert("Telegram логин успешно удален!", "Успех", "✅");
        currentUser.telegram_username = null;
        loadSettings();
      } else {
        await showCustomAlert(confirmResult.error, "Ошибка", "❌");
      }
    } else {
      await showCustomAlert(result.error, "Ошибка", "❌");
    }
  } catch (error) {
    console.error("Ошибка при удалении:", error);
    await showCustomAlert("Ошибка при удалении", "Ошибка", "❌");
  }
}

// Сохранить настройку Telegram уведомлений
async function saveTelegramNotificationSettings() {
  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  try {
    const checkbox = document.getElementById("telegramNotificationsCheckbox");
    const isEnabled = checkbox.checked;

    showSaveStatus('telegramNotificationsStatus', 'saving');

    const response = await fetch(`/api/user/${currentUser.id}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_notifications_enabled: isEnabled }),
    });

    const result = await response.json();

    if (response.ok) {
      currentUser.telegram_notifications_enabled = isEnabled ? 1 : 0;
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      showSaveStatus('telegramNotificationsStatus', 'saved');
      
      // Синхронизируем детальные настройки уведомлений
      await syncDetailedNotificationSettings(isEnabled);
    } else {
      showSaveStatus('telegramNotificationsStatus', 'error');
      console.error("Ошибка:", result.error);
    }
  } catch (error) {
    console.error("Ошибка при сохранении уведомлений:", error);
    showSaveStatus('telegramNotificationsStatus', 'error');
  }
}

// Синхронизировать детальные настройки с основным переключателем
async function syncDetailedNotificationSettings(isEnabled) {
  if (!currentUser) return;

  // Обновляем чекбоксы в модалке (если она открыта)
  const notifMatchReminders = document.getElementById("notifMatchReminders");
  const notifThreeHourReminders = document.getElementById("notifThreeHourReminders");
  const notifOnlyActiveTournaments = document.getElementById("notifOnlyActiveTournaments");
  const notifTournamentAnnouncements = document.getElementById("notifTournamentAnnouncements");
  const notifMatchResults = document.getElementById("notifMatchResults");
  const notifSystemMessages = document.getElementById("notifSystemMessages");
  
  if (notifMatchReminders) notifMatchReminders.checked = isEnabled;
  if (notifThreeHourReminders) notifThreeHourReminders.checked = isEnabled;
  if (notifOnlyActiveTournaments) notifOnlyActiveTournaments.checked = isEnabled;
  if (notifTournamentAnnouncements) notifTournamentAnnouncements.checked = isEnabled;
  if (notifMatchResults) notifMatchResults.checked = isEnabled;
  if (notifSystemMessages) notifSystemMessages.checked = isEnabled;
  
  // Обновляем состояние disabled для зависимой настройки
  updateOnlyActiveTournamentsState();
  
  // Сохраняем изменения в БД
  const settings = {
    match_reminders: isEnabled,
    three_hour_reminders: isEnabled,
    only_active_tournaments: isEnabled,
    tournament_announcements: isEnabled,
    match_results: isEnabled,
    system_messages: isEnabled,
  };

  try {
    await fetch(`/api/user/${currentUser.id}/notification-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    
    // Обновляем видимость кнопки колокольчика
    if (currentEventId) {
      const event = events.find((e) => e.id === currentEventId);
      const isLocked = event && event.locked_reason;
      const isUpcoming = event && event.start_date && new Date(event.start_date) > new Date();
      
      if (!isLocked && !isUpcoming) {
        const matchRemindersBtn = document.getElementById('matchRemindersBtn');
        if (matchRemindersBtn) {
          if (isEnabled) {
            matchRemindersBtn.style.display = 'flex';
            loadMatchReminders();
          } else {
            matchRemindersBtn.style.display = 'none';
            updateReminderIndicator(false);
          }
        }
      }
    }
  } catch (error) {
    console.error("Ошибка синхронизации детальных настроек:", error);
  }
}

// Сохранить настройку напоминаний в группе
async function saveGroupRemindersSettings() {
  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  try {
    const checkbox = document.getElementById("groupRemindersCheckbox");
    const isEnabled = checkbox.checked;

    showSaveStatus('groupRemindersStatus', 'saving');

    const response = await fetch(`/api/user/${currentUser.id}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_group_reminders_enabled: isEnabled }),
    });

    const result = await response.json();

    if (response.ok) {
      showSaveStatus('groupRemindersStatus', 'saved');
    } else {
      showSaveStatus('groupRemindersStatus', 'error');
      console.error("Ошибка:", result.error);
    }
  } catch (error) {
    console.error("Ошибка при сохранении напоминаний в группе:", error);
    showSaveStatus('groupRemindersStatus', 'error');
  }
}

// Переключить видимость карточки напоминаний в группе для всех пользователей (только для админа)
async function toggleGroupRemindersCardVisibility() {
  if (!currentUser || !currentUser.isAdmin) {
    await showCustomAlert("У вас нет прав для этого действия", "Ошибка", "❌");
    return;
  }

  try {
    const card = document.getElementById('groupRemindersCard');
    const btn = document.getElementById('toggleGroupRemindersCardBtn');
    
    // Проверяем существование элементов
    if (!card) {
      console.warn('Элемент groupRemindersCard не найден на странице');
      // Всё равно отправляем запрос на сервер для изменения настройки
    }
    
    const isCurrentlyHidden = card ? card.style.display === 'none' : false;

    // Переключаем видимость
    const newVisibility = !isCurrentlyHidden;
    
    const response = await fetch('/api/admin/group-reminders-card-visibility', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        hidden: newVisibility,
        admin_username: currentUser.username 
      })
    });

    const result = await response.json();

    if (response.ok) {
      // Обновляем UI только если элементы существуют
      if (card) {
        card.style.display = newVisibility ? 'none' : 'block';
      }
      
      if (btn) {
        btn.textContent = newVisibility ? '👁️ Показать напоминания ТГ' : '🚫 Скрыть напоминания ТГ';
        btn.style.background = newVisibility ? 'rgba(76, 175, 80, 0.7)' : 'rgba(255, 87, 34, 0.7)';
        btn.style.color = newVisibility ? '#c8e6c9' : '#ffe0d6';
        btn.style.borderColor = newVisibility ? '#4caf50' : '#ff5722';
      }
      
      await showCustomAlert(
        newVisibility ? 'Карточка скрыта для всех пользователей' : 'Карточка показана для всех пользователей',
        'Успешно',
        '✅'
      );
    } else {
      await showCustomAlert(result.error || 'Не удалось изменить видимость карточки', 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка при переключении видимости карточки:', error);
    await showCustomAlert(
      'Не удалось изменить видимость карточки.\n\nПроверьте подключение к серверу.',
      'Ошибка',
      '❌'
    );
  }
}

// Сохранить настройку подтверждения логина через бота
async function saveLogin2faSettings() {
  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  try {
    const checkbox = document.getElementById("login2faCheckbox");
    const isEnabled = checkbox.checked;

    // Проверяем, привязан ли Telegram
    if (isEnabled && !currentUser.telegram_username) {
      alert("Для включения подтверждения логина необходимо сначала привязать Telegram в настройках выше");
      checkbox.checked = false;
      return;
    }

    showSaveStatus('login2faStatus', 'saving');

    const response = await fetch(`/api/user/${currentUser.id}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ require_login_2fa: isEnabled ? 1 : 0 }),
    });

    const result = await response.json();

    if (response.ok) {
      currentUser.require_login_2fa = isEnabled ? 1 : 0;
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      showSaveStatus('login2faStatus', 'saved');
    } else {
      showSaveStatus('login2faStatus', 'error');
      console.error("Ошибка:", result.error);
    }
  } catch (error) {
    console.error("Ошибка при сохранении настройки 2FA:", error);
    showSaveStatus('login2faStatus', 'error');
  }
}

// Сохранить настройку звука в LIVE матчах
async function saveLiveSoundSettings() {
  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  try {
    const checkbox = document.getElementById("liveSoundCheckbox");
    const isEnabled = checkbox.checked;

    showSaveStatus('liveSoundStatus', 'saving');

    const response = await fetch(`/api/user/${currentUser.id}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ live_sound: isEnabled ? 1 : 0 }),
    });

    const result = await response.json();

    if (response.ok) {
      currentUser.live_sound = isEnabled ? 1 : 0;
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      showSaveStatus('liveSoundStatus', 'saved');
    } else {
      showSaveStatus('liveSoundStatus', 'error');
      console.error("Ошибка:", result.error);
    }
  } catch (error) {
    console.error("Ошибка при сохранении настройки звука LIVE:", error);
    showSaveStatus('liveSoundStatus', 'error');
  }
}

// Сохранить настройку показа победителя на завершённых турнирах
async function saveShowTournamentWinnerSettings() {
  try {
    const checkbox = document.getElementById("showTournamentWinnerCheckbox");
    const showWinner = checkbox.checked;

    showSaveStatus('tournamentWinnerStatus', 'saving');

    const response = await fetch("/api/settings/show-tournament-winner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        show_tournament_winner: showWinner,
        username: currentUser?.username || "Unknown",
        telegram_username: currentUser?.telegram_username || "Not set",
      }),
    });

    const result = await response.json();

    if (response.ok) {
      showSaveStatus('tournamentWinnerStatus', 'saved');
    } else {
      showSaveStatus('tournamentWinnerStatus', 'error');
      console.error("Ошибка:", result.error);
    }
  } catch (error) {
    console.error("Ошибка при сохранении настройки показа победителя:", error);
    showSaveStatus('tournamentWinnerStatus', 'error');
  }
}

// Загрузить настройку показа победителя при загрузке вкладки настроек
async function loadShowTournamentWinnerSetting() {
  try {
    const response = await fetch("/api/settings/show-tournament-winner");
    const data = await response.json();

    const checkbox = document.getElementById("showTournamentWinnerCheckbox");
    if (checkbox) {
      checkbox.checked = data.show_tournament_winner;
      console.log(
        `✅ Настройка показа победителя загружена: ${data.show_tournament_winner}`
      );
    }
  } catch (error) {
    console.error("Ошибка при загрузке настройки показа победителя:", error);
  }
}

// ===== ЧАСОВОЙ ПОЯС =====

// Инициализация списка часовых поясов
async function initTimezoneSettings() {
  try {
    const select = document.getElementById("timezoneSelect");
    if (!select) return;

    // Получаем список поддерживаемых часовых поясов
    const timezones = Intl.supportedValuesOf("timeZone");

    // Фильтруем: оставляем только Europe, Asia и UTC
    const filteredTimezones = timezones.filter(tz => {
      return tz.startsWith('Europe/') || 
             tz.startsWith('Asia/') || 
             tz === 'UTC';
    });

    // Сортируем и добавляем в select
    filteredTimezones.sort().forEach((tz) => {
      const option = document.createElement("option");
      option.value = tz;

      // Форматируем название для лучшей читаемости
      const offset = new Date()
        .toLocaleString("en-CA", {
          timeZone: tz,
          timeZoneName: "short",
        })
        .split(" ")
        .pop();

      option.textContent = `${tz} (${offset})`;
      select.appendChild(option);
    });

    // Загружаем текущий часовой пояс пользователя
    await loadUserTimezone();
  } catch (error) {
    console.error("Ошибка при инициализации часовых поясов:", error);
  }
}

// Загрузить текущий часовой пояс пользователя
async function loadUserTimezone() {
  try {
    if (!currentUser) return;

    const response = await fetch(
      `/api/user/timezone?username=${encodeURIComponent(currentUser.username)}`
    );
    const data = await response.json();

    if (response.ok) {
      const select = document.getElementById("timezoneSelect");
      if (select) {
        select.value = data.timezone || "Europe/Moscow";
        console.log(`✅ Часовой пояс загружен: ${data.timezone}`);
      }
    }
  } catch (error) {
    console.error("Ошибка при загрузке часового пояса:", error);
  }
}

// Загрузить настройку "Показывать ставки другим"
async function loadShowBetsSettings() {
  try {
    if (!currentUser) return;

    const response = await fetch(`/api/user/${currentUser.id}/show-bets`);
    const data = await response.json();

    if (response.ok) {
      const select = document.getElementById("showBetsSelect");
      if (select) {
        const showBets = data.show_bets || "always";
        select.value = showBets;
        currentUser.show_bets = showBets;
      }
    }
  } catch (error) {
    console.error("Ошибка при загрузке настройки показа ставок:", error);
  }
}

// Загрузить настройку "Кнопка Мне повезет"
async function loadLuckyButtonSettings() {
  try {
    if (!currentUser) return;

    const response = await fetch(`/api/user/${currentUser.id}/show-lucky-button`);
    const data = await response.json();

    if (response.ok) {
      const select = document.getElementById("showLuckyButtonSelect");
      if (select) {
        const showLuckyButton = data.show_lucky_button !== undefined ? data.show_lucky_button : 1;
        select.value = showLuckyButton.toString();
        currentUser.show_lucky_button = showLuckyButton;
        
        // Обновляем видимость кнопки
        updateLuckyButtonVisibility();
      }
    }
  } catch (error) {
    console.error("Ошибка при загрузке настройки кнопки Мне повезет:", error);
  }
}

// Загрузить настройку "Кнопка xG"
async function loadXgButtonSettings() {
  try {
    if (!currentUser) return;

    const response = await fetch(`/api/user/${currentUser.id}/show-xg-button`);
    const data = await response.json();

    if (response.ok) {
      const select = document.getElementById("showXgButtonSelect");
      if (select) {
        const showXgButton = data.show_xg_button !== undefined ? data.show_xg_button : 1;
        select.value = showXgButton.toString();
        currentUser.show_xg_button = showXgButton;
        localStorage.setItem("currentUser", JSON.stringify(currentUser));
      }
    }
  } catch (error) {
    console.error("Ошибка при загрузке настройки кнопки xG:", error);
  }
}

// Сохранить часовой пояс пользователя
async function saveTimezoneSettings() {
  try {
    if (!currentUser) {
      alert("Сначала войдите в систему");
      return;
    }

    const select = document.getElementById("timezoneSelect");
    const timezone = select.value;

    if (!timezone) {
      alert("Выберите часовой пояс");
      return;
    }

    showSaveStatus('timezoneStatus', 'saving');

    const response = await fetch("/api/user/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentUser.username,
        timezone: timezone,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      currentUser.timezone = timezone;
      localStorage.setItem("currentUser", JSON.stringify(currentUser));

      showSaveStatus('timezoneStatus', 'saved');

      // Перезагружаем матчи с новым часовым поясом
      setTimeout(() => {
        displayMatches();
      }, 300);
    } else {
      showSaveStatus('timezoneStatus', 'error');
      console.error("Ошибка:", result.error);
    }
  } catch (error) {
    console.error("Ошибка при сохранении часового пояса:", error);
    showSaveStatus('timezoneStatus', 'error');
  }
}

// Показать статус сохранения настройки
function showSaveStatus(containerId, status) {
  const statusContainer = document.getElementById(containerId);
  const descriptionId = containerId.replace('Status', 'Description');
  const descriptionContainer = document.getElementById(descriptionId);
  
  if (!statusContainer) return;
  
  if (status === 'saving') {
    if (descriptionContainer) {
      // Плавно скрываем описание
      descriptionContainer.style.transition = 'opacity 0.3s ease';
      descriptionContainer.style.opacity = '0';
      
      setTimeout(() => {
        descriptionContainer.style.display = 'none';
        
        // Показываем статус сохранения с плавным появлением
        statusContainer.innerHTML = '<p style="margin: 0; color: #ff9800; font-size: 14px;">⏳ Идет сохранение...</p>';
        statusContainer.style.transition = 'opacity 0.3s ease';
        statusContainer.style.opacity = '0';
        statusContainer.style.display = 'block';
        
        setTimeout(() => {
          statusContainer.style.opacity = '1';
        }, 50);
      }, 300);
    }
    
  } else if (status === 'saved') {
    // Плавно меняем текст статуса
    statusContainer.style.opacity = '0';
    
    setTimeout(() => {
      statusContainer.innerHTML = '<p style="margin: 0; color: #4caf50; font-size: 14px;">✅ Сохранено</p>';
      statusContainer.style.opacity = '1';
    }, 300);
    
    // Через 2 секунды возвращаем описание
    setTimeout(() => {
      statusContainer.style.opacity = '0';
      
      setTimeout(() => {
        statusContainer.style.display = 'none';
        
        if (descriptionContainer) {
          descriptionContainer.style.display = 'block';
          descriptionContainer.style.opacity = '0';
          
          setTimeout(() => {
            descriptionContainer.style.opacity = '1';
          }, 50);
        }
      }, 300);
    }, 2000);
    
  } else if (status === 'error') {
    // Плавно меняем текст статуса
    statusContainer.style.opacity = '0';
    
    setTimeout(() => {
      statusContainer.innerHTML = '<p style="margin: 0; color: #f44336; font-size: 14px;">❌ Ошибка сохранения</p>';
      statusContainer.style.opacity = '1';
    }, 300);
    
    // Через 3 секунды возвращаем описание
    setTimeout(() => {
      statusContainer.style.opacity = '0';
      
      setTimeout(() => {
        statusContainer.style.display = 'none';
        
        if (descriptionContainer) {
          descriptionContainer.style.display = 'block';
          descriptionContainer.style.opacity = '0';
          
          setTimeout(() => {
            descriptionContainer.style.opacity = '1';
          }, 50);
        }
      }, 300);
    }, 3000);
  }
}

// Сохранить настройку "Показывать ставки другим"
async function saveShowBetsSettings() {
  try {
    if (!currentUser) {
      alert("Сначала войдите в систему");
      return;
    }

    const select = document.getElementById("showBetsSelect");
    const showBets = select.value;

    showSaveStatus('showBetsStatus', 'saving');

    const response = await fetch(`/api/user/${currentUser.id}/show-bets`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        show_bets: showBets,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      currentUser.show_bets = showBets;
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      showSaveStatus('showBetsStatus', 'saved');
    } else {
      showSaveStatus('showBetsStatus', 'error');
      console.error("Ошибка:", result.error);
    }
  } catch (error) {
    console.error("Ошибка при сохранении настройки:", error);
    showSaveStatus('showBetsStatus', 'error');
  }
}

// Сохранить настройку "Кнопка Мне повезет"
async function saveLuckyButtonSettings() {
  try {
    if (!currentUser) {
      alert("Сначала войдите в систему");
      return;
    }

    const select = document.getElementById("showLuckyButtonSelect");
    const showLuckyButton = parseInt(select.value);

    showSaveStatus('luckyButtonStatus', 'saving');

    const response = await fetch(`/api/user/${currentUser.id}/show-lucky-button`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        show_lucky_button: showLuckyButton,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      currentUser.show_lucky_button = showLuckyButton;
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      updateLuckyButtonVisibility();
      showSaveStatus('luckyButtonStatus', 'saved');
    } else {
      showSaveStatus('luckyButtonStatus', 'error');
      console.error("Ошибка:", result.error);
    }
  } catch (error) {
    console.error("Ошибка при сохранении настройки:", error);
    showSaveStatus('luckyButtonStatus', 'error');
  }
}

// Обновить видимость кнопки "Мне повезет"
function updateLuckyButtonVisibility() {
  const luckyBtnContainer = document.getElementById("luckyBtnContainer");
  if (luckyBtnContainer && currentUser) {
    const showLuckyButton = currentUser.show_lucky_button !== undefined ? currentUser.show_lucky_button : 1;
    
    // Если пользователь отключил кнопку - скрываем всегда
    if (showLuckyButton === 0) {
      luckyBtnContainer.style.display = "none";
      return;
    }
    
    // Если включена - проверяем статус турнира
    const event = events.find(e => e.id === currentEventId);
    if (event) {
      const isLocked = event.locked_reason;
      const isUpcoming = event.start_date && new Date(event.start_date) > new Date();
      
      if (isLocked || isUpcoming) {
        luckyBtnContainer.style.display = "none";
      } else {
        luckyBtnContainer.style.display = "block";
      }
    } else {
      // Если турнир не выбран - показываем кнопку
      luckyBtnContainer.style.display = "block";
    }
  }
}

// Сохранить настройку "Кнопка xG"
async function saveXgButtonSettings() {
  try {
    if (!currentUser) {
      alert("Сначала войдите в систему");
      return;
    }

    const select = document.getElementById("showXgButtonSelect");
    const showXgButton = parseInt(select.value);

    showSaveStatus('xgButtonStatus', 'saving');

    const response = await fetch(`/api/user/${currentUser.id}/show-xg-button`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        show_xg_button: showXgButton,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      currentUser.show_xg_button = showXgButton;
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      
      // Перезагружаем матчи чтобы обновить видимость кнопки
      if (typeof loadMatches === 'function') {
        await loadMatches();
      }
      
      showSaveStatus('xgButtonStatus', 'saved');
    } else {
      showSaveStatus('xgButtonStatus', 'error');
      console.error("Ошибка:", result.error);
    }
  } catch (error) {
    console.error("Ошибка при сохранении настройки:", error);
    showSaveStatus('xgButtonStatus', 'error');
  }
}

// Форматировать время матча в часовом поясе пользователя
function formatMatchTime(matchDate) {
  try {
    const date = new Date(matchDate);

    // Получаем часовой пояс пользователя из профиля или используем по умолчанию
    const userTimezone = currentUser?.timezone || "Europe/Moscow";

    // Форматируем дату и время в часовом поясе пользователя БЕЗ СЕКУНД
    const formatter = new Intl.DateTimeFormat("ru-RU", {
      timeZone: userTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    return formatter.format(date);
  } catch (error) {
    console.error("Ошибка при форматировании времени:", error);
    // Если ошибка, используем стандартное форматирование
    return new Date(matchDate).toLocaleString("ru-RU");
  }
}

// Получить только время матча в часовом поясе пользователя (для отображения без даты)
function formatMatchTimeOnly(matchDate) {
  try {
    const date = new Date(matchDate);
    const userTimezone = currentUser?.timezone || "Europe/Moscow";

    const formatter = new Intl.DateTimeFormat("ru-RU", {
      timeZone: userTimezone,
      hour: "2-digit",
      minute: "2-digit",
    });

    return formatter.format(date);
  } catch (error) {
    console.error("Ошибка при форматировании времени:", error);
    return date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

// ===== СОЗДАНИЕ МАТЧЕЙ =====

// Загрузить существующие туры для модального окна
async function loadRoundsForModal(modalType, eventId) {
  try {
    const response = await fetch(`/api/admin/events/${eventId}/rounds`);
    const rounds = await response.json();

    const selectId =
      modalType === "create" ? "matchRoundSelect" : "editMatchRoundSelect";
    const selectElement = document.getElementById(selectId);

    // Очищаем все опции кроме первой (заглушки)
    while (selectElement.options.length > 1) {
      selectElement.remove(1);
    }

    // Добавляем туры в выпадающий список
    rounds.forEach((round) => {
      const option = document.createElement("option");
      option.value = round;
      option.textContent = round;
      selectElement.appendChild(option);
    });
  } catch (error) {
    console.error("Ошибка при загрузке туров:", error);
  }
}

// Выбрать существующий тур из выпадающего списка
function selectExistingRound(modalType) {
  const selectId =
    modalType === "create" ? "matchRoundSelect" : "editMatchRoundSelect";
  const inputId = modalType === "create" ? "matchRound" : "editMatchRound";

  const selectElement = document.getElementById(selectId);
  const inputElement = document.getElementById(inputId);

  if (selectElement.value) {
    inputElement.value = selectElement.value;
  }
}

// Открыть модальное окно для создания матча
async function openCreateMatchModal() {
  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  if (!canCreateMatches()) {
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

  // Загружаем существующие туры
  loadRoundsForModal("create", currentEventId);
  
  // Загружаем словарь команд из текущего турнира
  const currentEvent = events.find(e => e.id === currentEventId);
  const eventTeamFile = currentEvent?.team_file || selectedMatchTeamFile;
  
  await loadMatchTeams(eventTeamFile);
  initTeamAutocomplete('matchTeam1');
  initTeamAutocomplete('matchTeam2');

  // Открываем модальное окно
  const modal = document.getElementById("createMatchModal");
  if (modal) {
    lockBodyScroll();
    modal.style.display = "flex";
  }
}

// Закрыть модальное окно для создания матча
function closeCreateMatchModal() {
  const modal = document.getElementById("createMatchModal");
  modal.style.display = "none";
  unlockBodyScroll();

  // Очищаем форму
  document.getElementById("createMatchForm").reset();
  document.getElementById("matchIsFinal").checked = false;
  document.getElementById("finalMatchParamsCreate").style.display = "none";
  document.getElementById("matchRound").disabled = false;
  
  // Очищаем автодополнение
  hideSuggestions('matchTeam1');
  hideSuggestions('matchTeam2');
}

// ===== СЛОВАРЬ КОМАНД ДЛЯ МАТЧЕЙ =====

// Глобальная переменная для хранения команд
let matchTeamsList = [];
let selectedMatchTeamFile = localStorage.getItem('selectedMatchTeamFile') || '/names/LeagueOfChampionsTeams.json';

// Загрузить команды из файла
async function loadMatchTeams(filePath) {
  try {
    const response = await fetch(filePath || selectedMatchTeamFile);
    if (!response.ok) throw new Error('Не удалось загрузить файл');
    
    const contentType = response.headers.get('content-type');
    const fileExtension = (filePath || selectedMatchTeamFile).split('.').pop().toLowerCase();
    let data;
    
    // Проверяем тип файла
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      // Если это не JSON, пробуем прочитать как текст
      const text = await response.text();
      
      // Если это JS файл, пытаемся извлечь команды из const
      if (fileExtension === 'js') {
        matchTeamsList = [];
        
        // Ищем const/let/var с объектом или массивом
        const constMatch = text.match(/(?:const|let|var)\s+\w+\s*=\s*\{([^}]+)\}/);
        if (constMatch) {
          // Извлекаем содержимое между {}
          const content = constMatch[1];
          // Разбиваем по запятым и очищаем
          matchTeamsList = content
            .split(',')
            .map(item => item.trim())
            .filter(item => item && !item.startsWith('//'));
        } else {
          // Пробуем найти массив
          const arrayMatch = text.match(/(?:const|let|var)\s+\w+\s*=\s*\[([^\]]+)\]/);
          if (arrayMatch) {
            const content = arrayMatch[1];
            matchTeamsList = content
              .split(',')
              .map(item => item.trim().replace(/['"]/g, ''))
              .filter(item => item && !item.startsWith('//'));
          }
        }
        
        if (filePath) {
          selectedMatchTeamFile = filePath;
          localStorage.setItem('selectedMatchTeamFile', filePath);
        }
        
        return matchTeamsList;
      }
      
      // Пытаемся распарсить как JSON
      try {
        data = JSON.parse(text);
      } catch (e) {
        // Если не JSON, считаем что это список команд построчно
        matchTeamsList = text.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('//') && !line.startsWith('#'));
        
        if (filePath) {
          selectedMatchTeamFile = filePath;
          localStorage.setItem('selectedMatchTeamFile', filePath);
        }
        
        return matchTeamsList;
      }
    }
    
    matchTeamsList = [];
    
    // Извлекаем команды из структуры
    if (data.teams_by_status) {
      // Формат с teams_by_status (как LeagueOfChampionsTeams.json)
      Object.values(data.teams_by_status).forEach(status => {
        if (status.teams && Array.isArray(status.teams)) {
          status.teams.forEach(team => {
            if (team.name) {
              matchTeamsList.push(team.name);
            }
          });
        }
      });
    } else if (data.teams && typeof data.teams === 'object' && !Array.isArray(data.teams)) {
      // Новый формат с маппингом (объект): { "Ювентус": "Juventus" }
      // Берем ключи (русские названия)
      matchTeamsList = Object.keys(data.teams);
    } else if (data.teams && Array.isArray(data.teams)) {
      // Старый формат с массивом teams
      matchTeamsList = data.teams.map(t => typeof t === 'string' ? t : t.name).filter(Boolean);
    } else if (Array.isArray(data)) {
      // Простой массив строк (как LeagueOfnames.json)
      matchTeamsList = data.filter(item => typeof item === 'string' && item.trim());
    }
    
    if (filePath) {
      selectedMatchTeamFile = filePath;
      localStorage.setItem('selectedMatchTeamFile', filePath);
    }
    
    return matchTeamsList;
  } catch (error) {
    console.error('Ошибка загрузки команд:', error);
    matchTeamsList = [];
    return [];
  }
}

// Открыть модалку выбора файла команд
async function openMatchTeamFileSelector(mode) {
  try {
    const response = await fetch('/api/team-files');
    if (!response.ok) throw new Error('Не удалось загрузить список файлов');
    
    const files = await response.json();
    
    if (!files || files.length === 0) {
      alert('Не найдено файлов команд в папке names');
      return;
    }
    
    const currentFile = selectedMatchTeamFile;
    
    const fileListHtml = files.map(file => {
      const isSelected = file.path === currentFile;
      const icon = file.name.endsWith('.json') ? '📄' : file.name.endsWith('.txt') ? '📝' : '📜';
      return `
        <div class="team-file-item ${isSelected ? 'selected' : ''}" 
             onclick="selectMatchTeamFile('${file.path}', '${mode}')" 
             style="padding: 12px; margin: 8px 0; background: ${isSelected ? 'rgba(90, 159, 212, 0.2)' : 'rgba(40, 44, 54, 0.5)'}; 
                    border: 1px solid ${isSelected ? 'rgba(90, 159, 212, 0.5)' : 'rgba(90, 159, 212, 0.2)'}; 
                    border-radius: 8px; cursor: pointer; transition: all 0.2s;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.5em;">${icon}</span>
            <div style="flex: 1;">
              <div style="font-weight: 500; color: #e0e6f0;">${file.name}</div>
              <div style="font-size: 0.85em; color: #b0b8c8; margin-top: 2px;">${file.path}</div>
            </div>
            ${isSelected ? '<span style="color: #4caf50; font-size: 1.2em;">✓</span>' : ''}
          </div>
        </div>
      `;
    }).join('');
    
    const modalHtml = `
      <div id="matchTeamFileSelectorModal" class="modal" style="display: flex;" onclick="closeMatchTeamFileSelector()">
        <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
          <div class="modal-header">
            <h2>📥 Выбор файла команд</h2>
            <button class="modal-close" onclick="closeMatchTeamFileSelector()">&times;</button>
          </div>
          <div style="padding: 20px;">
            <p style="color: #b0b8c8; margin-bottom: 15px;">
              Выберите файл с командами для автодополнения:
            </p>
            ${fileListHtml}
          </div>
        </div>
      </div>
    `;
    
    const existingModal = document.getElementById('matchTeamFileSelectorModal');
    if (existingModal) {
      existingModal.remove();
    }
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    lockBodyScroll();
  } catch (error) {
    console.error('Ошибка при открытии выбора файла:', error);
    alert('Не удалось загрузить список файлов');
  }
}

// Выбрать файл команд
async function selectMatchTeamFile(filePath, mode) {
  try {
    await loadMatchTeams(filePath);
    closeMatchTeamFileSelector();
    
    // Закрываем все открытые dropdown
    hideSuggestions('matchTeam1');
    hideSuggestions('matchTeam2');
    hideSuggestions('editMatchTeam1');
    hideSuggestions('editMatchTeam2');
    
    // Инициализируем автодополнение для текущей модалки
    if (mode === 'create') {
      initTeamAutocomplete('matchTeam1');
      initTeamAutocomplete('matchTeam2');
    } else if (mode === 'edit') {
      initTeamAutocomplete('editMatchTeam1');
      initTeamAutocomplete('editMatchTeam2');
    }
    
    if (matchTeamsList.length > 0) {
      alert(`Файл команд изменен на: ${filePath.split('/').pop()}\nЗагружено команд: ${matchTeamsList.length}`);
    } else {
      alert(`Файл команд изменен на: ${filePath.split('/').pop()}\n⚠️ Не удалось загрузить команды из этого файла`);
    }
  } catch (error) {
    console.error('Ошибка при выборе файла команд:', error);
    alert('Не удалось загрузить файл команд');
  }
}

// Закрыть модалку выбора файла
function closeMatchTeamFileSelector() {
  const modal = document.getElementById('matchTeamFileSelectorModal');
  if (modal) {
    modal.remove();
  }
  unlockBodyScroll();
}

// ===== СЛОВАРЬ КОМАНД ДЛЯ ТУРНИРОВ =====

// Открыть модалку выбора файла команд для турнира
async function openEventTeamFileSelector(mode) {
  try {
    const response = await fetch('/api/team-files');
    if (!response.ok) throw new Error('Не удалось загрузить список файлов');
    
    const files = await response.json();
    
    if (!files || files.length === 0) {
      alert('Не найдено файлов команд в папке names');
      return;
    }
    
    // Получаем текущий выбранный файл из формы
    const currentFile = mode === 'create' 
      ? document.getElementById('eventTeamFile').value 
      : document.getElementById('editEventTeamFile').value;
    
    const fileListHtml = files.map(file => {
      const isSelected = file.path === currentFile;
      const icon = file.name.endsWith('.json') ? '📄' : file.name.endsWith('.txt') ? '📝' : '📜';
      return `
        <div class="team-file-item ${isSelected ? 'selected' : ''}" 
             onclick="selectEventTeamFile('${file.path}', '${mode}')" 
             style="padding: 12px; margin: 8px 0; background: ${isSelected ? 'rgba(90, 159, 212, 0.2)' : 'rgba(40, 44, 54, 0.5)'}; 
                    border: 1px solid ${isSelected ? 'rgba(90, 159, 212, 0.5)' : 'rgba(90, 159, 212, 0.2)'}; 
                    border-radius: 8px; cursor: pointer; transition: all 0.2s;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.5em;">${icon}</span>
            <div style="flex: 1;">
              <div style="font-weight: 500; color: #e0e6f0;">${file.name}</div>
              <div style="font-size: 0.85em; color: #b0b8c8; margin-top: 2px;">${file.path}</div>
            </div>
            ${isSelected ? '<span style="color: #4caf50; font-size: 1.2em;">✓</span>' : ''}
          </div>
        </div>
      `;
    }).join('');
    
    const modalHtml = `
      <div id="eventTeamFileSelectorModal" class="modal" style="display: flex;" onclick="closeEventTeamFileSelector()">
        <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
          <div class="modal-header">
            <h2>📥 Выбор словаря команд для турнира</h2>
            <button class="modal-close" onclick="closeEventTeamFileSelector()">&times;</button>
          </div>
          <div style="padding: 20px;">
            <p style="color: #b0b8c8; margin-bottom: 15px;">
              Этот словарь будет использоваться по умолчанию при создании матчей в этом турнире:
            </p>
            ${fileListHtml}
          </div>
        </div>
      </div>
    `;
    
    const existingModal = document.getElementById('eventTeamFileSelectorModal');
    if (existingModal) {
      existingModal.remove();
    }
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    lockBodyScroll();
  } catch (error) {
    console.error('Ошибка при открытии выбора файла:', error);
    alert('Не удалось загрузить список файлов');
  }
}

// Выбрать файл команд для турнира
function selectEventTeamFile(filePath, mode) {
  if (mode === 'create') {
    document.getElementById('eventTeamFile').value = filePath;
  } else if (mode === 'edit') {
    document.getElementById('editEventTeamFile').value = filePath;
  }
  
  closeEventTeamFileSelector();
  alert(`Словарь команд выбран: ${filePath.split('/').pop()}\n\nОн будет использоваться по умолчанию при создании матчей в этом турнире.`);
}

// Закрыть модалку выбора файла для турнира
function closeEventTeamFileSelector() {
  const modal = document.getElementById('eventTeamFileSelectorModal');
  if (modal) {
    modal.remove();
  }
  unlockBodyScroll();
}

// Инициализация автодополнения для поля
function initTeamAutocomplete(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  
  const suggestionsId = `${inputId}Suggestions`;
  let selectedIndex = -1;
  let isMouseOverSuggestions = false;
  
  // Удаляем старые обработчики
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  
  // Получаем div с подсказками
  const suggestionsDiv = document.getElementById(suggestionsId);
  
  // Отслеживаем наведение мыши на список подсказок
  if (suggestionsDiv) {
    suggestionsDiv.addEventListener('mouseenter', () => {
      isMouseOverSuggestions = true;
    });
    suggestionsDiv.addEventListener('mouseleave', () => {
      isMouseOverSuggestions = false;
    });
  }
  
  newInput.addEventListener('input', function() {
    const value = this.value.trim().toLowerCase();
    const suggestionsDiv = document.getElementById(suggestionsId);
    
    if (!value || matchTeamsList.length === 0) {
      hideSuggestions(inputId);
      return;
    }
    
    const filtered = matchTeamsList.filter(team => 
      team.toLowerCase().includes(value)
    ).slice(0, 10);
    
    if (filtered.length === 0) {
      hideSuggestions(inputId);
      return;
    }
    
    selectedIndex = -1;
    suggestionsDiv.innerHTML = filtered.map((team, index) => 
      `<div class="team-suggestion-item" data-index="${index}" onclick="selectTeam('${inputId}', '${team.replace(/'/g, "\\'")}')">${team}</div>`
    ).join('');
    suggestionsDiv.style.display = 'block';
  });
  
  newInput.addEventListener('focus', function() {
    // При фокусе показываем подсказки если есть текст
    if (this.value.trim() && matchTeamsList.length > 0) {
      this.dispatchEvent(new Event('input'));
    }
  });
  
  newInput.addEventListener('keydown', function(e) {
    const suggestionsDiv = document.getElementById(suggestionsId);
    const items = suggestionsDiv.querySelectorAll('.team-suggestion-item');
    
    if (items.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
      updateSelectedItem(items, selectedIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
      updateSelectedItem(items, selectedIndex);
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (selectedIndex >= 0 && selectedIndex < items.length) {
        e.preventDefault();
        items[selectedIndex].click();
      } else if (items.length === 1) {
        e.preventDefault();
        items[0].click();
      }
    } else if (e.key === 'Escape') {
      hideSuggestions(inputId);
    }
  });
  
  newInput.addEventListener('blur', function() {
    // Закрываем только если мышь не над списком подсказок
    setTimeout(() => {
      if (!isMouseOverSuggestions) {
        hideSuggestions(inputId);
      }
    }, 200);
  });
}

// Обновить выделенный элемент в списке
function updateSelectedItem(items, index) {
  items.forEach((item, i) => {
    if (i === index) {
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('active');
    }
  });
}

// Выбрать команду из списка
function selectTeam(inputId, teamName) {
  const input = document.getElementById(inputId);
  if (input) {
    input.value = teamName;
    hideSuggestions(inputId);
  }
}

// Скрыть подсказки
function hideSuggestions(inputId) {
  const suggestionsDiv = document.getElementById(`${inputId}Suggestions`);
  if (suggestionsDiv) {
    suggestionsDiv.style.display = 'none';
    suggestionsDiv.innerHTML = '';
  }
}

// Показать/скрыть полный список команд (как dropdown)
function toggleTeamDropdown(inputId, event) {
  // Предотвращаем потерю фокуса с инпута
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  
  const suggestionsDiv = document.getElementById(`${inputId}Suggestions`);
  const input = document.getElementById(inputId);
  
  if (!suggestionsDiv || !input) return;
  
  // Если список уже открыт, закрываем
  if (suggestionsDiv.style.display === 'block') {
    hideSuggestions(inputId);
    return;
  }
  
  // Показываем все команды
  if (matchTeamsList.length === 0) {
    alert('Сначала загрузите файл команд через кнопку 📥');
    return;
  }
  
  suggestionsDiv.innerHTML = matchTeamsList.map((team, index) => 
    `<div class="team-suggestion-item" data-index="${index}" onclick="selectTeam('${inputId}', '${team.replace(/'/g, "\\'")}')">${team}</div>`
  ).join('');
  suggestionsDiv.style.display = 'block';
  
  // Фокусируем инпут
  input.focus();
}

// Открыть модальное окно для блокировки турнира
function openLockEventModal(eventId, eventName) {
  const modal = document.getElementById("lockEventModal");
  if (modal) {
    lockBodyScroll();
    modal.style.display = "flex";
    // Сохраняем ID турнира в скрытое поле
    document.getElementById("lockEventForm").dataset.eventId = eventId;
  }
}

// Закрыть модальное окно для блокировки турнира
function closeLockEventModal() {
  const modal = document.getElementById("lockEventModal");
  if (modal) {
    modal.style.display = "none";
    unlockBodyScroll();
  }
  // Очищаем форму
  document.getElementById("lockEventForm").reset();
}

// Отправить форму блокировки турнира
async function submitLockEvent(event) {
  event.preventDefault();
  
  const eventId = document.getElementById("lockEventForm").dataset.eventId;
  const reason = document.getElementById("eventLockReason").value.trim();
  
  if (!eventId || !reason) {
    alert("Пожалуйста, заполните все поля");
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
    
    if (response.ok) {
      closeLockEventModal();
      loadEventsList();
    } else {
      alert("Ошибка при блокировке турнира: " + (result.error || response.status));
    }
  } catch (error) {
    console.error("❌ Ошибка:", error);
    alert("Ошибка при блокировке турнира: " + error.message);
  }
}

// Разблокировать турнир
async function unlockEvent(eventId) {
  const confirmed = await showCustomConfirm(
    "Вы уверены, что хотите разблокировать этот турнир?",
    "Разблокировка турнира",
    "⚠️"
  );
  
  if (!confirmed) {
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
    
    if (response.ok) {
      loadEventsList();
    } else {
      await showCustomAlert(`Ошибка при разблокировке турнира: ${result.error || response.status}`, "Ошибка", "❌");
    }
  } catch (error) {
    console.error("❌ Ошибка:", error);
    await showCustomAlert(`Ошибка при разблокировке турнира: ${error.message}`, "Ошибка", "❌");
  }
}

// Удалить турнир
async function deleteEvent(eventId) {
  if (!canDeleteTournaments()) {
    await showCustomAlert("Только администратор или модератор с правами может удалять турниры", "Недостаточно прав", "❌");
    return;
  }

  const confirmed = await showCustomConfirm(
    "Вы уверены, что хотите удалить этот турнир?\n\nВсе матчи и ставки этого турнира также будут удалены.",
    "Удаление турнира",
    "⚠️"
  );
  
  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(`/api/admin/events/${eventId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: currentUser.username }),
    });

    const result = await response.json();

    if (response.ok) {
      // Сначала находим ID всех матчей этого турнира
      const eventMatchIds = matches
        .filter((m) => m.event_id === eventId)
        .map((m) => m.id);
      
      // Удаляем все ставки на матчи этого турнира
      userBets = userBets.filter((bet) => !eventMatchIds.includes(bet.match_id));
      
      // Удаляем все матчи этого турнира
      matches = matches.filter((m) => m.event_id !== eventId);
      
      // Удаляем турнир из локального массива
      events = events.filter((e) => e.id !== eventId);
      
      // Перезагружаем список турниров
      await loadEventsList();
      
      // Если удалённый турнир был выбран, очищаем выбор
      if (currentEventId === eventId) {
        currentEventId = null;
        displayMatches();
      }
    } else {
      await showCustomAlert(`Ошибка: ${result.error}`, "Ошибка удаления", "❌");
    }
  } catch (error) {
    console.error("❌ Ошибка при удалении турнира:", error);
    await showCustomAlert("Ошибка при удалении турнира", "Ошибка", "❌");
  }
}

// Капитализация названия команды (каждое слово с заглавной буквы)
function capitalizeTeamName(name) {
  if (!name) return name;
  return name
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// Отправить форму создания матча
async function submitCreateMatch(event) {
  event.preventDefault();

  let team1 = document.getElementById("matchTeam1").value.trim();
  let team2 = document.getElementById("matchTeam2").value.trim();
  
  // Капитализируем названия команд
  team1 = capitalizeTeamName(team1);
  team2 = capitalizeTeamName(team2);
  
  const matchDate = document.getElementById("matchDate").value;
  let round = document.getElementById("matchRound").value.trim();
  const copies = parseInt(document.getElementById("matchCopies").value) || 1;

  const isFinal = document.getElementById("matchIsFinal").checked;
  const scorePredictionEnabled = document.getElementById("matchScorePrediction").checked;
  const yellowCardsPredictionEnabled = document.getElementById("matchYellowCardsPrediction").checked;
  const redCardsPredictionEnabled = document.getElementById("matchRedCardsPrediction").checked;

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

    // Конвертируем время из часового пояса админа в UTC
    let matchDateUTC = null;
    if (matchDate) {
      // Создаем Date объект из введенной строки
      // Браузер интерпретирует это как локальное время
      const localDate = new Date(matchDate);
      
      // Конвертируем в UTC ISO строку
      matchDateUTC = localDate.toISOString();
      
      console.log(`🕐 Конвертация времени: ${matchDate} (локальное) → ${matchDateUTC} (UTC)`);
    }

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
          match_date: matchDateUTC || null,
          round: round || null,
          is_final: isFinal,
          score_prediction_enabled: scorePredictionEnabled,
          yellow_cards_prediction_enabled: yellowCardsPredictionEnabled,
          red_cards_prediction_enabled: redCardsPredictionEnabled,
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

async function openEditMatchModal(id, team1, team2, date, round) {
  if (!canEditMatches()) {
    alert("❌ Только администратор или модератор может редактировать матчи");
    return;
  }

  // Найдем матч в массиве, чтобы получить все параметры
  const match = matches.find((m) => m.id === id);

  document.getElementById("editMatchId").value = id;
  document.getElementById("editMatchTeam1").value = team1;
  document.getElementById("editMatchTeam2").value = team2;
  
  // Конвертируем UTC дату в локальный формат для input
  let localDateString = "";
  if (date) {
    const utcDate = new Date(date);
    
    // ВАЖНО: Используем локальные методы для получения времени в часовом поясе браузера
    // datetime-local input ожидает локальное время без информации о часовом поясе
    const year = utcDate.getFullYear();
    const month = String(utcDate.getMonth() + 1).padStart(2, '0');
    const day = String(utcDate.getDate()).padStart(2, '0');
    const hours = String(utcDate.getHours()).padStart(2, '0');
    const minutes = String(utcDate.getMinutes()).padStart(2, '0');
    localDateString = `${year}-${month}-${day}T${hours}:${minutes}`;
    
    console.log(`🕐 Загрузка для редактирования: ${date} (UTC в БД) → ${localDateString} (локальное время браузера для input)`);
  }
  
  document.getElementById("editMatchDate").value = localDateString;
  document.getElementById("editMatchRound").value = round || "";

  // Загружаем существующие туры
  loadRoundsForModal("edit", currentEventId);

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
    document.getElementById("editMatchScorePrediction").checked =
      match.score_prediction_enabled || false;
    document.getElementById("editMatchYellowCardsPrediction").checked =
      match.yellow_cards_prediction_enabled || false;
    document.getElementById("editMatchRedCardsPrediction").checked =
      match.red_cards_prediction_enabled || false;

    // Обновим состояние тура и параметров в зависимости от is_final
    toggleFinalMatch("edit");
  }
  
  // Загружаем словарь команд из текущего турнира
  const currentEvent = events.find(e => e.id === currentEventId);
  const eventTeamFile = currentEvent?.team_file || selectedMatchTeamFile;
  
  await loadMatchTeams(eventTeamFile);
  initTeamAutocomplete('editMatchTeam1');
  initTeamAutocomplete('editMatchTeam2');

  lockBodyScroll();
  document.getElementById("editMatchModal").style.display = "flex";
}

function closeEditMatchModal() {
  document.getElementById("editMatchModal").style.display = "none";
  unlockBodyScroll();

  // Очищаем параметры финального матча
  document.getElementById("editMatchIsFinal").checked = false;
  document.getElementById("finalMatchParamsEdit").style.display = "none";
  document.getElementById("editMatchRound").disabled = false;
  
  // Очищаем автодополнение
  hideSuggestions('editMatchTeam1');
  hideSuggestions('editMatchTeam2');
}

async function submitEditMatch(event) {
  event.preventDefault();

  const id = document.getElementById("editMatchId").value;
  let team1 = document.getElementById("editMatchTeam1").value.trim();
  let team2 = document.getElementById("editMatchTeam2").value.trim();
  
  // Капитализируем названия команд
  team1 = capitalizeTeamName(team1);
  team2 = capitalizeTeamName(team2);
  
  const date = document.getElementById("editMatchDate").value;
  let round = document.getElementById("editMatchRound").value.trim();

  const isFinal = document.getElementById("editMatchIsFinal").checked;
  const scorePredictionEnabled = document.getElementById("editMatchScorePrediction").checked;
  const yellowCardsPredictionEnabled = document.getElementById("editMatchYellowCardsPrediction").checked;
  const redCardsPredictionEnabled = document.getElementById("editMatchRedCardsPrediction").checked;

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
    // Конвертируем время из локального в UTC
    let matchDateUTC = null;
    if (date) {
      const localDate = new Date(date);
      matchDateUTC = localDate.toISOString();
      console.log(`🕐 Редактирование - конвертация времени: ${date} (локальное) → ${matchDateUTC} (UTC)`);
    }

    const response = await fetch(`/api/admin/matches/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentUser.username,
        team1_name: team1,
        team2_name: team2,
        match_date: matchDateUTC,
        round: round || null,
        is_final: isFinal,
        score_prediction_enabled: scorePredictionEnabled,
        yellow_cards_prediction_enabled: yellowCardsPredictionEnabled,
        red_cards_prediction_enabled: redCardsPredictionEnabled,
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
          score_prediction_enabled: scorePredictionEnabled,
          yellow_cards_prediction_enabled: yellowCardsPredictionEnabled,
          red_cards_prediction_enabled: redCardsPredictionEnabled,
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
  if (!canManageMatches()) {
    await showCustomAlert("Только администратор или модератор может удалять матчи", "Недостаточно прав", "❌");
    return;
  }

  const confirmed = await showCustomConfirm(
    "Вы уверены, что хотите удалить этот матч?\n\nВсе ставки на этот матч также будут удалены.",
    "Удаление матча",
    "⚠️"
  );
  
  if (!confirmed) {
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
      await showCustomAlert(`Ошибка: ${result.error}`, "Ошибка удаления", "❌");
    }
  } catch (error) {
    console.error("Ошибка при удалении матча:", error);
    await showCustomAlert("Ошибка при удалении матча", "Ошибка", "❌");
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
  lockBodyScroll(); // Блокируем скролл страницы
}

/**
 * Закрыть модальное окно результата финала
 */
function closeFinalMatchResultModal(event) {
  if (event && event.target.id !== "finalMatchResultModal") return;

  const modal = document.getElementById("finalMatchResultModal");
  modal.style.display = "none";
  unlockBodyScroll(); // Разблокируем скролл страницы
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

// ===== МОДАЛКА РЕЗУЛЬТАТА МАТЧА С ПРОГНОЗОМ НА СЧЕТ =====
let currentScoreMatchId = null;
let currentScoreMatchResult = null;

function openScoreMatchResultModal(matchId, team1Name, team2Name) {
  currentScoreMatchId = matchId;
  currentScoreMatchResult = null;
  
  // Устанавливаем названия команд
  document.getElementById('scoreModalTeam1Name').textContent = team1Name;
  document.getElementById('scoreModalTeam2Name').textContent = team2Name;
  
  // Создаем кнопки выбора победителя
  const buttonsContainer = document.getElementById('scoreResultButtonsContainer');
  buttonsContainer.innerHTML = `
    <button id="scoreResult_team1" onclick="setScoreResult('team1')" 
      style="flex: 1; padding: 12px; background: transparent; border: 2px solid #5a9fd4; color: #5a9fd4; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.3s;">
      ${team1Name}
    </button>
    <button id="scoreResult_draw" onclick="setScoreResult('draw')" 
      style="flex: 1; padding: 12px; background: transparent; border: 2px solid #ff9800; color: #ff9800; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.3s;">
      Ничья
    </button>
    <button id="scoreResult_team2" onclick="setScoreResult('team2')" 
      style="flex: 1; padding: 12px; background: transparent; border: 2px solid #4caf50; color: #4caf50; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.3s;">
      ${team2Name}
    </button>
  `;
  
  // Сбрасываем значения
  document.getElementById('scoreModalTeam1').value = '0';
  document.getElementById('scoreModalTeam2').value = '0';
  
  // Добавляем обработчики синхронизации для инпутов
  const input1 = document.getElementById('scoreModalTeam1');
  const input2 = document.getElementById('scoreModalTeam2');
  
  input1.addEventListener('input', syncScoreModalInputs);
  input2.addEventListener('input', syncScoreModalInputs);
  
  // Показываем модалку
  const modal = document.getElementById('scoreMatchResultModal');
  modal.style.display = 'flex';
  lockBodyScroll();
}

function syncScoreModalInputs(event) {
  // Синхронизируем инпуты только если выбрана ничья
  if (currentScoreMatchResult !== 'draw') return;
  
  const input1 = document.getElementById('scoreModalTeam1');
  const input2 = document.getElementById('scoreModalTeam2');
  
  if (event.target === input1) {
    input2.value = input1.value;
  } else if (event.target === input2) {
    input1.value = input2.value;
  }
}

function setScoreResult(result) {
  currentScoreMatchResult = result;
  
  // Обновляем визуальное отображение
  const btn1 = document.getElementById('scoreResult_team1');
  const btnDraw = document.getElementById('scoreResult_draw');
  const btn2 = document.getElementById('scoreResult_team2');
  
  if (btn1) btn1.style.background = result === 'team1' ? 'rgba(90, 159, 212, 0.6)' : 'transparent';
  if (btnDraw) btnDraw.style.background = result === 'draw' ? 'rgba(255, 152, 0, 0.6)' : 'transparent';
  if (btn2) btn2.style.background = result === 'team2' ? 'rgba(76, 175, 80, 0.6)' : 'transparent';
  
  // Если выбрана ничья, синхронизируем инпуты
  if (result === 'draw') {
    const input1 = document.getElementById('scoreModalTeam1');
    const input2 = document.getElementById('scoreModalTeam2');
    // Синхронизируем значения (берем большее)
    const maxValue = Math.max(parseInt(input1.value) || 0, parseInt(input2.value) || 0);
    input1.value = maxValue;
    input2.value = maxValue;
  }
}

function closeScoreMatchResultModal() {
  const modal = document.getElementById('scoreMatchResultModal');
  modal.style.display = 'none';
  unlockBodyScroll();
  currentScoreMatchId = null;
  currentScoreMatchResult = null;
}

async function saveScoreMatchResult() {
  if (!currentScoreMatchId) return;
  
  if (!currentScoreMatchResult) {
    await showCustomAlert('Выберите победителя', 'Ошибка', '⚠️');
    return;
  }
  
  const scoreTeam1 = parseInt(document.getElementById('scoreModalTeam1').value) || 0;
  const scoreTeam2 = parseInt(document.getElementById('scoreModalTeam2').value) || 0;
  
  // Валидация: проверяем соответствие счета и выбранного победителя
  if (currentScoreMatchResult === 'team1' && scoreTeam1 <= scoreTeam2) {
    await showCustomAlert(
      `Счет не соответствует выбранному победителю!\n\nВы выбрали победу первой команды, но счет ${scoreTeam1}:${scoreTeam2}`,
      'Ошибка валидации',
      '❌'
    );
    return;
  }
  
  if (currentScoreMatchResult === 'team2' && scoreTeam2 <= scoreTeam1) {
    await showCustomAlert(
      `Счет не соответствует выбранному победителю!\n\nВы выбрали победу второй команды, но счет ${scoreTeam1}:${scoreTeam2}`,
      'Ошибка валидации',
      '❌'
    );
    return;
  }
  
  if (currentScoreMatchResult === 'draw' && scoreTeam1 !== scoreTeam2) {
    await showCustomAlert(
      `Счет не соответствует ничьей!\n\nВы выбрали ничью, но счет ${scoreTeam1}:${scoreTeam2}`,
      'Ошибка валидации',
      '❌'
    );
    return;
  }
  
  try {
    const response = await fetch(`/api/admin/matches/${currentScoreMatchId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'finished',
        winner: currentScoreMatchResult,
        username: currentUser?.username,
        score_team1: scoreTeam1,
        score_team2: scoreTeam2,
      }),
    });
    
    if (response.ok) {
      // Обновляем матч локально для мгновенного обновления UI
      const match = matches.find((m) => m.id === currentScoreMatchId);
      if (match) {
        match.status = "finished";
        match.winner = currentScoreMatchResult; // team1, draw, team2
        
        // Также обновляем result для совместимости
        const resultMap = {
          team1: "team1_win",
          draw: "draw",
          team2: "team2_win",
        };
        match.result = resultMap[currentScoreMatchResult];
        
        console.log(`✓ Матч ${match.team1_name} vs ${match.team2_name} завершен с результатом: ${currentScoreMatchResult} (${scoreTeam1}:${scoreTeam2})`);
      }
      
      closeScoreMatchResultModal();
      displayMatches();
      
      // Обновляем ставки чтобы показать новые цвета (с небольшой задержкой для синхронизации с БД)
      setTimeout(() => {
        loadMyBets();
      }, 300);
    } else {
      const errorText = await response.text();
      console.error('Ошибка ответа сервера:', errorText);
      await showCustomAlert('Ошибка при сохранении результата: ' + errorText, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка при сохранении результата матча:', error);
    await showCustomAlert('Ошибка при сохранении результата матча: ' + error.message, 'Ошибка', '❌');
  }
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

// Обновить файл логов без удаления содержимого (миграция)
async function migrateLogs() {
  if (!isAdmin()) {
    await showCustomAlert("Недостаточно прав", "Доступ запрещён", "❌");
    return;
  }

  const confirmed = await showCustomConfirm(
    "Обновить файл логов, добавив код отображения размера файла?\n\nСодержимое логов НЕ будет удалено.",
    "Обновление логов",
    "🔄"
  );
  
  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch("/api/admin/migrate-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: currentUser.username }),
    });

    const result = await response.json();

    if (response.ok) {
      if (result.alreadyMigrated) {
        await showCustomAlert(result.message, "Информация", "ℹ️");
      } else {
        await showCustomAlert(
          result.message + "\n\nОбновите страницу логов чтобы увидеть изменения.",
          "Успешно",
          "✅"
        );
      }
    } else {
      await showCustomAlert(result.error, "Ошибка", "❌");
    }
  } catch (error) {
    console.error("Ошибка при обновлении логов:", error);
    await showCustomAlert("Ошибка при обновлении логов", "Ошибка", "❌");
  }
}

// Очистка логов
async function clearLogs() {
  if (!canViewLogs()) {
    await showCustomAlert("Недостаточно прав", "Доступ запрещён", "❌");
    return;
  }

  const confirmed = await showCustomConfirm(
    "Вы уверены, что хотите очистить все логи ставок?",
    "Очистка логов",
    "⚠️"
  );
  
  if (!confirmed) {
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
      await showCustomAlert("Логи успешно очищены!", "Успешно", "✅");
    } else {
      await showCustomAlert(result.error, "Ошибка", "❌");
    }
  } catch (error) {
    console.error("Ошибка при очистке логов:", error);
    await showCustomAlert("Ошибка при очистке логов", "Ошибка", "❌");
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

  // Инициализируем превью разделителя при открытии модального окна
  updateImportSeparatorPreview();

  lockBodyScroll();
  document.getElementById("importMatchesModal").style.display = "flex";
}

function closeImportMatchesModal() {
  document.getElementById("importMatchesModal").style.display = "none";
  unlockBodyScroll();
  document.getElementById("importMatchesData").value = "";
  document.getElementById("importEventId").value = "";
}

// ===== ПАРСИНГ МАТЧЕЙ =====

let parsedMatches = [];

// Маппинг иконок турниров на коды для API
const ICON_TO_COMPETITION = {
  'img/cups/champions-league.png': 'CL',
  'img/cups/european-league.png': 'EL',
  'img/cups/conference-league.png': 'ECL',
  'img/cups/england-premier-league.png': 'PL',
  'img/cups/bundesliga.png': 'BL1',
  'img/cups/spain-la-liga.png': 'PD',
  'img/cups/serie-a.png': 'SA',
  'img/cups/france-league-ligue-1.png': 'FL1',
  'img/cups/rpl.png': 'RPL',
  'img/cups/world-cup.png': 'WC',
  'img/cups/uefa-euro.png': 'EC',
  '🇳🇱': 'DED'  // Eredivisie (эмодзи флага Нидерландов)
};

// Открыть модальное окно парсинга матчей
function openBulkParseModal() {
  if (!currentEventId) {
    alert("❌ Сначала выберите турнир");
    return;
  }
  
  // Получаем текущий турнир
  const currentEvent = events.find(e => e.id === currentEventId);
  if (!currentEvent) {
    alert("❌ Не удалось определить текущий турнир");
    return;
  }
  
  // Определяем код турнира по иконке
  const tournamentCode = ICON_TO_COMPETITION[currentEvent.icon];
  if (!tournamentCode) {
    alert(`❌ Парсинг не поддерживается для турнира "${currentEvent.name}". Поддерживаются только турниры с иконками: Champions League, Europa League, Conference League, Premier League, Bundesliga, La Liga, Serie A, Ligue 1, RPL`);
    return;
  }
  
  document.getElementById("bulkParseModal").style.display = "flex";
  lockBodyScroll();
  
  // Устанавливаем код турнира
  document.getElementById("parseCompetition").value = tournamentCode;
  
  // Сбрасываем форму
  document.getElementById("parseDateFrom").value = "";
  document.getElementById("parseDateTo").value = "";
  document.getElementById("parseRound").value = "";
  document.getElementById("parsePreviewContainer").style.display = "none";
  document.getElementById("bulkParseSubmitBtn").disabled = true;
  parsedMatches = [];
}

// Закрыть модальное окно парсинга
function closeBulkParseModal() {
  document.getElementById("bulkParseModal").style.display = "none";
  unlockBodyScroll();
  parsedMatches = [];
}

// ===== МАССОВОЕ РЕДАКТИРОВАНИЕ ДАТ МАТЧЕЙ =====

// Открыть модальное окно массового редактирования дат
async function openBulkEditDatesModal() {
  if (!currentEventId) {
    await showCustomAlert("Выберите турнир", "Ошибка", "❌");
    return;
  }

  document.getElementById("bulkEditDatesModal").style.display = "flex";
  lockBodyScroll();

  // Загружаем список туров для фильтра
  const uniqueRounds = [...new Set(matches.map(m => m.round).filter(r => r && r.trim()))];
  const roundSelect = document.getElementById("bulkEditRoundFilter");
  
  roundSelect.innerHTML = '<option value="">Все матчи</option>';
  uniqueRounds.forEach(round => {
    roundSelect.innerHTML += `<option value="${round}">${round}</option>`;
  });

  // Загружаем матчи
  await loadBulkEditMatches();
}

// Закрыть модальное окно массового редактирования дат
function closeBulkEditDatesModal() {
  document.getElementById("bulkEditDatesModal").style.display = "none";
  unlockBodyScroll();
}

// Загрузить матчи для редактирования
async function loadBulkEditMatches() {
  const container = document.getElementById("bulkEditMatchesList");
  const roundFilter = document.getElementById("bulkEditRoundFilter").value;

  // Фильтруем матчи
  let filteredMatches = matches;
  if (roundFilter) {
    filteredMatches = matches.filter(m => m.round === roundFilter);
  }

  if (filteredMatches.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #b0b8c8;">Нет матчей для отображения</div>';
    return;
  }

  // Сортируем по дате
  const sortedMatches = [...filteredMatches].sort((a, b) => {
    if (!a.match_date) return 1;
    if (!b.match_date) return -1;
    return new Date(a.match_date) - new Date(b.match_date);
  });

  // Формируем HTML таблицу
  let html = `
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: rgba(56, 118, 235, 0.2); border-bottom: 2px solid rgba(56, 118, 235, 0.5);">
          <th style="padding: 12px; text-align: left; color: #e0e6f0; font-weight: 600;">Матч</th>
          <th style="padding: 12px; text-align: left; color: #e0e6f0; font-weight: 600; min-width: 220px;">Дата и время</th>
        </tr>
      </thead>
      <tbody>
  `;

  sortedMatches.forEach(match => {
    // Преобразуем дату в формат для datetime-local
    let dateValue = '';
    if (match.match_date) {
      const date = new Date(match.match_date);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      dateValue = `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    html += `
      <tr style="border-bottom: 1px solid rgba(90, 159, 212, 0.2);">
        <td style="padding: 12px; color: #e0e6f0;">
          <div style="font-weight: 500;">${match.team1_name} vs ${match.team2_name}</div>
          ${match.round ? `<div style="font-size: 0.85em; color: #b0b8c8; margin-top: 4px;">${match.round}</div>` : ''}
        </td>
        <td style="padding: 12px;">
          <input 
            type="datetime-local" 
            class="bulk-edit-date-input" 
            data-match-id="${match.id}"
            value="${dateValue}"
            style="
              width: 100%;
              padding: 8px;
              font-size: 0.9em;
              background: rgba(40, 44, 54, 0.8);
              border: 1px solid rgba(90, 159, 212, 0.3);
              border-radius: 4px;
              color: #e0e6f0;
            "
          />
        </td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}

// Сохранить массовое редактирование дат
async function saveBulkEditDates() {
  const inputs = document.querySelectorAll('.bulk-edit-date-input');
  const updates = [];

  inputs.forEach(input => {
    const matchId = parseInt(input.dataset.matchId);
    const dateValue = input.value;

    if (dateValue) {
      updates.push({
        match_id: matchId,
        match_date: dateValue
      });
    }
  });

  if (updates.length === 0) {
    await showCustomAlert("Нет дат для сохранения", "Ошибка", "❌");
    return;
  }

  const saveBtn = document.getElementById("bulkEditSaveBtn");
  const originalText = saveBtn.textContent;

  try {
    saveBtn.disabled = true;
    saveBtn.textContent = "⏳ Сохранение...";

    const response = await fetch("/api/matches/bulk-update-dates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        updates,
        username: currentUser.username
      }),
    });

    // Проверяем тип контента ответа
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const text = await response.text();
      console.error("Сервер вернул не JSON:", text);
      throw new Error("Сервер вернул некорректный ответ");
    }

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Ошибка при сохранении");
    }

    await showCustomAlert(
      `Успешно обновлено дат: ${result.updatedCount}`,
      "Успех",
      "✅"
    );

    closeBulkEditDatesModal();

    // Перезагружаем матчи
    await loadMatches(currentEventId);
  } catch (error) {
    console.error("Ошибка при сохранении дат:", error);
    await showCustomAlert(
      `Ошибка при сохранении: ${error.message}`,
      "Ошибка",
      "❌"
    );
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

// Обновить превью при изменении параметров
function updateParsePreview() {
  const competition = document.getElementById("parseCompetition").value;
  const dateFrom = document.getElementById("parseDateFrom").value;
  const dateTo = document.getElementById("parseDateTo").value;
  
  if (competition && dateFrom && dateTo) {
    document.getElementById("parsePreviewContainer").style.display = "block";
    // Автоматически загружаем превью
    loadParsePreview();
  } else {
    document.getElementById("parsePreviewContainer").style.display = "none";
  }
}

// Загрузить превью спарсенных матчей
async function loadParsePreview() {
  const competition = document.getElementById("parseCompetition").value;
  const dateFrom = document.getElementById("parseDateFrom").value;
  const dateTo = document.getElementById("parseDateTo").value;
  const includeFuture = document.getElementById("parseIncludeFuture").checked;
  
  if (!competition || !dateFrom || !dateTo) {
    await showCustomAlert("Заполните все обязательные поля", "Ошибка", "❌");
    return;
  }
  
  // Проверяем что dateFrom <= dateTo
  if (new Date(dateFrom) > new Date(dateTo)) {
    await showCustomAlert("Дата начала не может быть позже даты окончания", "Ошибка", "❌");
    return;
  }
  
  const previewList = document.getElementById("parsePreviewList");
  const updateBtn = previewList.previousElementSibling.querySelector('button');
  
  // Блокируем кнопку обновления
  updateBtn.disabled = true;
  updateBtn.textContent = "⏳ Загрузка...";
  
  previewList.innerHTML = '<div style="text-align: center; color: #b0b8c8; padding: 20px;">⏳ Загрузка матчей...</div>';
  
  try {
    // Загружаем словарь для перевода названий команд
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
    
    let teamTranslations = {};
    const dictionaryFile = dictionaryMapping[competition];
    
    if (dictionaryFile) {
      try {
        const dictResponse = await fetch(dictionaryFile);
        if (dictResponse.ok) {
          const dictData = await dictResponse.json();
          const teams = dictData.teams || {};
          
          // Создаем обратный маппинг: Английское -> Русское (выбираем самое короткое)
          for (const [russian, english] of Object.entries(teams)) {
            const englishLower = english.toLowerCase();
            if (!teamTranslations[englishLower] || russian.length < teamTranslations[englishLower].length) {
              teamTranslations[englishLower] = russian;
            }
          }
          
          console.log(`✅ Загружен словарь для ${competition}: ${Object.keys(teamTranslations).length} команд`);
        }
      } catch (err) {
        console.warn(`⚠️ Не удалось загрузить словарь из ${dictionaryFile}`);
      }
    }
    
    // Функция для перевода названия команды
    const translateTeamName = (englishName) => {
      return teamTranslations[englishName.toLowerCase()] || englishName;
    };
    
    const response = await fetch(
      `/api/fd-matches?competition=${encodeURIComponent(competition)}&dateFrom=${dateFrom}&dateTo=${dateTo}&includeFuture=${includeFuture}`
    );
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Ошибка при загрузке матчей");
    }
    
    const data = await response.json();
    parsedMatches = data.matches || [];
    
    if (parsedMatches.length === 0) {
      const statusText = includeFuture ? 'матчей' : 'завершенных матчей';
      previewList.innerHTML = `<div style="text-align: center; color: #ffc107; padding: 20px;">⚠️ Не найдено ${statusText} в указанном диапазоне</div>`;
      document.getElementById("bulkParseSubmitBtn").disabled = true;
      return;
    }
    
    // Группируем матчи по турам
    const matchesByRound = {};
    parsedMatches.forEach(match => {
      const roundName = match.round || 'Без тура';
      if (!matchesByRound[roundName]) {
        matchesByRound[roundName] = [];
      }
      matchesByRound[roundName].push(match);
    });
    
    // Отображаем превью матчей сгруппированных по турам
    let matchesHtml = '';
    
    Object.keys(matchesByRound).sort().forEach(roundName => {
      const roundMatches = matchesByRound[roundName];
      const roundId = roundName.replace(/[^a-zA-Z0-9]/g, '_');
      
      matchesHtml += `
        <div style="margin-bottom: 20px;">
          <div style="
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px;
            background: rgba(58, 123, 213, 0.2);
            border: 1px solid rgba(90, 159, 212, 0.5);
            border-radius: 6px;
            margin-bottom: 10px;
          ">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1;">
              <input
                type="checkbox"
                id="round_${roundId}"
                onchange="toggleRoundSelection('${roundName}')"
                style="cursor: pointer; width: 18px; height: 18px;"
              />
              <span style="font-weight: 500; color: #e0e6f0; font-size: 1.05em;">
                ${roundName} (${roundMatches.length} ${roundMatches.length === 1 ? 'матч' : 'матчей'})
              </span>
            </label>
          </div>
          <div id="matches_${roundId}">
      `;
      
      roundMatches.forEach(match => {
        const date = new Date(match.utcDate);
        const formattedDate = date.toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
        
        // Переводим названия команд
        const homeTeamRu = translateTeamName(match.homeTeam.name);
        const awayTeamRu = translateTeamName(match.awayTeam.name);
        
        const isFinished = match.status === 'FINISHED';
        const scoreHtml = isFinished ? `
          <div style="
            background: rgba(76, 175, 80, 0.2);
            border: 1px solid rgba(76, 175, 80, 0.5);
            border-radius: 4px;
            padding: 6px 12px;
            font-weight: 500;
            color: #4caf50;
          ">
            ${match.score.fullTime.home ?? 0} : ${match.score.fullTime.away ?? 0}
          </div>
        ` : `
          <div style="
            background: rgba(255, 152, 0, 0.2);
            border: 1px solid rgba(255, 152, 0, 0.5);
            border-radius: 4px;
            padding: 6px 12px;
            font-weight: 500;
            color: #ff9800;
          ">
            Предстоящий
          </div>
        `;
        
        matchesHtml += `
          <div style="
            background: rgba(58, 123, 213, 0.1);
            border: 1px solid rgba(90, 159, 212, 0.3);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 10px;
            margin-left: 30px;
          ">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="flex: 1;">
                <div style="font-weight: 500; color: #e0e6f0; margin-bottom: 4px;">
                  ${homeTeamRu} vs ${awayTeamRu}
                </div>
                <div style="font-size: 0.85em; color: #b0b8c8;">
                  📅 ${formattedDate}
                </div>
              </div>
              ${scoreHtml}
            </div>
          </div>
        `;
      });
      
      matchesHtml += `
          </div>
        </div>
      `;
    });
    
    const finishedCount = parsedMatches.filter(m => m.status === 'FINISHED').length;
    const futureCount = parsedMatches.length - finishedCount;
    
    previewList.innerHTML = `
      <div style="margin-bottom: 15px; padding: 10px; background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 6px;">
        <div style="color: #4caf50; font-weight: 500;">✅ Найдено матчей: ${parsedMatches.length}</div>
        ${finishedCount > 0 ? `<div style="color: #4caf50; font-size: 0.9em; margin-top: 4px;">🏁 Завершенных: ${finishedCount}</div>` : ''}
        ${futureCount > 0 ? `<div style="color: #ff9800; font-size: 0.9em; margin-top: 4px;">📅 Предстоящих: ${futureCount}</div>` : ''}
      </div>
      ${matchesHtml}
    `;
    
    document.getElementById("bulkParseSubmitBtn").disabled = false;
    
  } catch (error) {
    console.error("Ошибка при загрузке превью:", error);
    previewList.innerHTML = `<div style="text-align: center; color: #f44336; padding: 20px;">❌ Ошибка: ${error.message}</div>`;
    document.getElementById("bulkParseSubmitBtn").disabled = true;
  } finally {
    // Разблокируем кнопку обновления
    updateBtn.disabled = false;
    updateBtn.textContent = "🔄 Обновить";
  }
}

// Переключить выбор тура
function toggleRoundSelection(roundName) {
  const roundId = roundName.replace(/[^a-zA-Z0-9]/g, '_');
  const roundInput = document.getElementById("parseRound");
  
  // Получаем все выбранные чекбоксы
  const selectedCheckboxes = Array.from(document.querySelectorAll('[id^="round_"]:checked'));
  
  if (selectedCheckboxes.length === 0) {
    // Если ничего не выбрано - очищаем поле и показываем все матчи
    roundInput.value = '';
    roundInput.disabled = false;
    loadParsePreview();
  } else if (selectedCheckboxes.length === 1) {
    // Если выбран один тур - вписываем его название и можно редактировать
    const selectedRound = selectedCheckboxes[0].id.replace('round_', '').replace(/_/g, ' ');
    // Находим оригинальное название тура
    const originalRound = parsedMatches.find(m => m.round && m.round.replace(/[^a-zA-Z0-9]/g, '_') === selectedCheckboxes[0].id.replace('round_', ''))?.round || roundName;
    roundInput.value = originalRound === 'Без тура' ? '' : originalRound;
    roundInput.disabled = false;
  } else {
    // Если выбрано больше одного тура - блокируем инпут и очищаем
    roundInput.value = '';
    roundInput.disabled = true;
  }
}

// Отправить форму парсинга
async function submitBulkParse(event) {
  event.preventDefault();
  
  if (parsedMatches.length === 0) {
    await showCustomAlert("Сначала загрузите превью матчей", "Ошибка", "❌");
    return;
  }
  
  // Получаем выбранные туры
  const selectedCheckboxes = Array.from(document.querySelectorAll('[id^="round_"]:checked'));
  const roundInput = document.getElementById("parseRound");
  const scorePredictionEnabled = document.getElementById("parseScorePrediction").checked;
  const yellowCardsPredictionEnabled = document.getElementById("parseYellowCardsPrediction").checked;
  const redCardsPredictionEnabled = document.getElementById("parseRedCardsPrediction").checked;
  
  // Определяем какие матчи нужно создать
  let matchesToProcess = [];
  
  if (selectedCheckboxes.length === 0) {
    // Если ничего не выбрано - создаем все матчи
    matchesToProcess = parsedMatches;
  } else {
    // Если выбраны туры - фильтруем матчи по выбранным турам
    const selectedRounds = selectedCheckboxes.map(cb => {
      const roundId = cb.id.replace('round_', '');
      // Находим оригинальное название тура
      return parsedMatches.find(m => m.round && m.round.replace(/[^a-zA-Z0-9]/g, '_') === roundId)?.round;
    }).filter(Boolean);
    
    matchesToProcess = parsedMatches.filter(m => selectedRounds.includes(m.round));
  }
  
  if (matchesToProcess.length === 0) {
    await showCustomAlert("Нет матчей для создания", "Ошибка", "❌");
    return;
  }
  
  // Если выбран один тур и указано название - используем его
  const customRoundName = selectedCheckboxes.length === 1 && roundInput.value.trim() ? roundInput.value.trim() : null;
  
  if (selectedCheckboxes.length === 0 && !roundInput.value.trim()) {
    const confirmed = await showCustomConfirm(
      "Вы не указали тур. Матчи будут созданы без указания тура. Продолжить?",
      "Подтверждение",
      "⚠️"
    );
    
    if (!confirmed) {
      return;
    }
  }
  
  const submitBtn = document.getElementById("bulkParseSubmitBtn");
  const originalText = submitBtn.textContent;
  
  try {
    // Блокируем кнопку и показываем индикатор загрузки
    submitBtn.disabled = true;
    submitBtn.textContent = "⏳ Создание матчей...";
    
    // Преобразуем спарсенные матчи в формат для создания
    const matchesToCreate = matchesToProcess.map(match => {
      const isFinished = match.status === 'FINISHED';
      
      // Определяем название тура
      let roundName;
      if (customRoundName) {
        // Если указано кастомное название (один тур выбран)
        roundName = customRoundName;
      } else if (selectedCheckboxes.length > 1) {
        // Если выбрано несколько туров - используем оригинальное название
        roundName = match.round || null;
      } else {
        // Если ничего не выбрано - используем значение из инпута или null
        roundName = roundInput.value.trim() || null;
      }
      
      const baseMatch = {
        team1_name: match.homeTeam.name,
        team2_name: match.awayTeam.name,
        match_date: match.utcDate,
        round: roundName,
        event_id: currentEventId,
        score_prediction_enabled: scorePredictionEnabled ? 1 : 0,
        yellow_cards_prediction_enabled: yellowCardsPredictionEnabled ? 1 : 0,
        red_cards_prediction_enabled: redCardsPredictionEnabled ? 1 : 0
      };
      
      // Если матч завершен - добавляем результаты
      if (isFinished && match.score.fullTime.home !== null && match.score.fullTime.away !== null) {
        baseMatch.team1_score = match.score.fullTime.home;
        baseMatch.team2_score = match.score.fullTime.away;
        baseMatch.winner = match.score.fullTime.home > match.score.fullTime.away ? 'team1' :
                          match.score.fullTime.home < match.score.fullTime.away ? 'team2' : 'draw';
      }
      
      return baseMatch;
    });
    
    // Отправляем на сервер
    const response = await fetch("/api/matches/bulk-create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ matches: matchesToCreate }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Ошибка при создании матчей");
    }
    
    const finishedCount = matchesToProcess.filter(m => m.status === 'FINISHED').length;
    const futureCount = matchesToProcess.length - finishedCount;
    
    let message = `Успешно создано ${matchesToCreate.length} матчей`;
    if (finishedCount > 0 && futureCount > 0) {
      message += `\n\n🏁 С результатами: ${finishedCount}\n📅 Без результатов: ${futureCount}`;
    } else if (finishedCount > 0) {
      message += ` с результатами`;
    }
    
    if (scorePredictionEnabled) {
      message += `\n\n📊 Прогноз на счет включен`;
    }
    
    // Предупреждение для RPL о проблеме с датами
    const competition = document.getElementById("parseCompetition").value;
    if (competition === 'RPL') {
      message += `\n\n⚠️ ВНИМАНИЕ: Даты матчей RPL могут быть неточными из-за ограничений API. Проверьте и скорректируйте даты вручную через редактирование матчей.`;
    }
    
    await showCustomAlert(message, "Успех", "✅");
    
    closeBulkParseModal();
    
    // Перезагружаем матчи
    await loadMatches(currentEventId);
    
  } catch (error) {
    console.error("Ошибка при создании матчей:", error);
    await showCustomAlert(
      `Ошибка при создании матчей: ${error.message}`,
      "Ошибка",
      "❌"
    );
  } finally {
    // Разблокируем кнопку
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// Обновляем плейсхолдер и инструкции при изменении разделителя
function updateImportSeparatorPreview() {
  const separatorSelect = document.getElementById("importSeparator");
  const separator = separatorSelect.value;
  const selectedOption = separatorSelect.options[separatorSelect.selectedIndex];
  const separatorDescription =
    selectedOption.getAttribute("data-description") || "обратный слэш";

  const textarea = document.getElementById("importMatchesData");
  const separatorPreview = document.getElementById("separatorPreview");
  const instructionFormat = document.getElementById("instructionFormat");

  let separatorLabel = "\\";
  let separatorDisplay = "\\";
  let example1 = "Manchester \\ Liverpool | 20.12.2025 18:00 | Тур 1";
  let example2 = "Real Madrid \\ Barcelona | 21.12.2025 20:00 | Тур 1";
  let formatExample = "Команда1 \\ Команда2 | Дата | Тур";

  if (separator === "-") {
    separatorLabel = "-";
    separatorDisplay = "-";
    example1 = "Manchester - Liverpool | 20.12.2025 18:00 | Тур 1";
    example2 = "Real Madrid - Barcelona | 21.12.2025 20:00 | Тур 1";
    formatExample = "Команда1 - Команда2 | Дата | Тур";
  } else if (separator === "vs") {
    separatorLabel = "vs";
    separatorDisplay = "vs";
    example1 = "Manchester vs Liverpool | 20.12.2025 18:00 | Тур 1";
    example2 = "Real Madrid vs Barcelona | 21.12.2025 20:00 | Тур 1";
    formatExample = "Команда1 vs Команда2 | Дата | Тур";
  }

  // Обновляем плейсхолдер в textarea
  textarea.placeholder = `Вставьте матчи в формате:\nКоманда1 ${separatorLabel} Команда2 | Дата (ДД.ММ.YYYY ЧЧ:MM) | Тур\n\nПример:\n${example1}\n${example2}`;

  // Обновляем превью разделителя рядом с лейблом
  if (separatorPreview) {
    separatorPreview.textContent = separatorDisplay;
  }

  // Обновляем описание разделителя рядом с селектом (берём из data-атрибута)
  const separatorDescriptionLabel = document.getElementById(
    "separatorDescription"
  );
  if (separatorDescriptionLabel) {
    separatorDescriptionLabel.textContent = `(${separatorDescription})`;
  }

  // Обновляем формат в инструкциях
  if (instructionFormat) {
    instructionFormat.textContent = formatExample;
  }

  // Обновляем описание разделителя в инструкциях (весь текст li)
  const instructionSeparatorText = document.getElementById(
    "instructionSeparatorText"
  );
  if (instructionSeparatorText) {
    instructionSeparatorText.innerHTML = `Разделитель команд: <strong>${separatorDisplay}</strong> (${separatorDescription})`;
  }
}

// Добавляем слушатель при загрузке страницы
document.addEventListener("DOMContentLoaded", function () {
  const separatorSelect = document.getElementById("importSeparator");
  if (separatorSelect) {
    separatorSelect.addEventListener("change", updateImportSeparatorPreview);
  }
});

async function submitImportMatches(event) {
  event.preventDefault();

  const importData = document.getElementById("importMatchesData").value.trim();
  const eventId = document.getElementById("importEventId").value;

  const includeDates = document.getElementById("importIncludeDate").checked;
  const separator = document.getElementById("importSeparator").value;

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

    // Парсим команды (разделитель выбирается из селекта)
    let teams;
    if (separator === "\\") {
      teams = teamsPart.split(/\s*\\\s*/);
    } else if (separator === "-") {
      teams = teamsPart.split(/\s*-\s*/);
    } else if (separator === "vs") {
      teams = teamsPart.split(/\s+vs\s+/i);
    } else {
      teams = teamsPart.split(/\s*\\\s*/); // по умолчанию
    }

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
    const response = await fetch(`/api/user/${userId}/profile?viewerUsername=${encodeURIComponent(currentUser.username)}`);
    const userData = await response.json();

    if (!response.ok) {
      alert("Не удалось загрузить профиль");
      return;
    }

    // Загружаем награды за турниры (автоматические)
    const awardsResponse = await fetch(`/api/user/${userId}/awards`);
    const tournamentAwards = await awardsResponse.json();

    // Загружаем пользовательские награды (выданные админом)
    const customAwardsResponse = await fetch(
      `/api/user/${userId}/custom-awards`
    );
    const customAwards = await customAwardsResponse.json();

    // Объединяем обе массива
    const allAwards = [...(tournamentAwards || []), ...(customAwards || [])];

    // Функция для получения иконки награды
    const getAwardIcon = (awardType) => {
      const icons = {
        participant: "👤",
        winner: "🥇",
        best_result: "⭐",
        special: "🎖️",
      };
      return icons[awardType] || "🏆";
    };

    // Функция для получения текста типа награды
    const getAwardTypeText = (awardType) => {
      const text = {
        participant: "Участник турнира",
        winner: "Победитель",
        best_result: "Лучший результат",
        special: "Специальная награда",
      };
      return text[awardType] || awardType;
    };

    // Формируем модальное окно
    const profileHTML = `
      <div style="background: #0a0e27; padding: 15px; border-radius: 12px; max-width: 500px; margin: 0 auto;">
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
          <div 
            style="background: rgba(76, 175, 80, 0.15); padding: 15px; border-radius: 8px; border-left: 4px solid #4caf50; cursor: help;" 
            title="${userData.max_win_streak_event ? `Турнир: ${userData.max_win_streak_event}` : 'Нет серии'}">
            <div style="font-size: 0.85em; color: #999; margin-bottom: 5px;">🔥 Угаданных подряд</div>
            <div style="font-size: 1.6em; font-weight: bold; color: #4caf50;">${
              userData.max_win_streak || 0
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
          <div style="background: rgba(76, 175, 80, 0.15); padding: 15px; border-radius: 8px; border-left: 4px solid #4caf50;">
            <div style="font-size: 0.85em; color: #999; margin-bottom: 5px;">✅ Угаданных в сетке</div>
            <div style="font-size: 1.6em; font-weight: bold; color: #4caf50;">${
              userData.bracket_correct || 0
            }</div>
          </div>
          <div style="background: rgba(244, 67, 54, 0.15); padding: 15px; border-radius: 8px; border-left: 4px solid #f44336;">
            <div style="font-size: 0.85em; color: #999; margin-bottom: 5px;">❌ Неугаданных в сетке</div>
            <div style="font-size: 1.6em; font-weight: bold; color: #f44336;">${
              userData.bracket_incorrect || 0
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
          <div class="award-icon-container" style="background: #2a1a0a; padding: 15px; border-radius: 8px;">
            <div style="font-size: 0.85em; color: #999; margin-bottom: 5px;">Победы в турнирах</div>
            <div class="award-icons" style="font-size: 1em; font-weight: bold; color: #ffc107;">
              ${(() => {
                // Подсчитываем иконки турниров
                const iconCounts = {};
                tournamentAwards.forEach((award) => {
                  const icon = award.event_icon || "🏆";
                  iconCounts[icon] = (iconCounts[icon] || 0) + 1;
                });

                // Формируем отображение иконок
                const iconsDisplay = Object.entries(iconCounts)
                  .map(([icon, count]) => {
                    const displayIcon = icon.startsWith("img/")
                      ? `<img src="${icon}" alt="trophy" class="tournament-icon" style="width: 1.2em; height: 1.2em; vertical-align: middle;">`
                      : icon;
                    return count > 1 ? `${displayIcon}×${count}` : displayIcon;
                  })
                  .join(" ");

                return iconsDisplay;
              })()}
            </div>
          </div>
        `
            : ""
        }

        ${
          allAwards && allAwards.length > 0
            ? `
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #333;">
            <h3 style="color: #d4af37; margin-bottom: 15px; font-size: 1.1em;text-align: center;">🏆 НАГРАДЫ</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              ${allAwards
                .map((award) => {
                  // Определяем тип награды и дату
                  const isTournamentAward = award.awarded_at; // tournament_awards имеют awarded_at
                  const awardDate = new Date(
                    isTournamentAward ? award.awarded_at : award.created_at
                  ).toLocaleDateString("ru-RU");

                  if (isTournamentAward) {
                    // Это награда за победу в турнире
                    const icon = award.event_icon || "🏆";
                    const awardIcon = icon.startsWith("img/")
                      ? `<img src="${icon}" alt="trophy" class="tournament-icon">`
                      : icon;

                    return `
                    <div style="background: linear-gradient(135deg, rgba(212, 175, 55, 0.6) 0%, rgba(212, 175, 55, 0.5) 100%), url('img/winner.jpg') center / cover; border: 2px solid rgba(212, 175, 55, 0.7); border-radius: 8px; padding: 10px; text-align: center;height: 200px;display: flex;flex-direction: column;justify-content: space-between;">
                    <div class="award-icon">${awardIcon}</div>
                      <div style="color: #fff; font-weight: 600; margin-bottom: 4px; font-size: 0.9em; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.7);">Победитель в турнире "${award.event_name}"</div>
                      <div style="color: #ffe0b2; font-size: 0.75em; margin-top: 4px; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);">${awardDate}</div>
                    </div>
                  `;
                  } else {
                    // Это пользовательская награда
                    const icon = getAwardIcon(award.award_type);
                    const typeText = getAwardTypeText(award.award_type);
                    const eventText = award.event_name
                      ? ` в турнире "${award.event_name}"`
                      : "";
                    const descText = award.description
                      ? `<div style="color: #e0b0ff; font-size: 0.8em; margin-top: 4px; font-style: italic; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);">"${award.description}"</div>`
                      : "";

                    return `
                    <div style="background: linear-gradient(135deg, rgba(255, 193, 7, 0.3) 0%, rgba(255, 152, 0, 0.2) 100%); border: 2px solid rgba(255, 193, 7, 0.5); border-radius: 8px; padding: 12px; text-align: center;">
                      <div style="font-size: 1.5em; margin-bottom: 4px;">${icon}</div>
                      <div style="color: #fff; font-weight: 600; font-size: 0.95em; margin-bottom: 3px;">${typeText}${eventText}</div>
                      ${descText}
                      <div style="color: #ffb74d; font-size: 0.75em; margin-top: 4px;">${awardDate}</div>
                    </div>
                  `;
                  }
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
    overlay.className = "user-profile-overlay modal";
    overlay.style.cssText =
      "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;";
    overlay.innerHTML = `
      <div class="user-profile-modal" style="position: relative; padding: 5px; border-radius: 12px; max-width: 500px; width: 90%; max-height: 90vh; overflow-y: auto; scrollbar-width: none;">
        <button class="close-profile-btn" onclick="this.parentElement.parentElement.remove(); document.body.style.overflow = '';" style="position: absolute; top: 0; right: 0; background: none; border: none; color: #999; font-size: 24px; cursor: pointer;">×</button>
        ${profileHTML}
      </div>
    `;
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        document.body.style.overflow = '';
      }
    };
    
    // Блокируем прокрутку страницы
    document.body.style.overflow = 'hidden';
    
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
  document.getElementById("gifPreviewColumn").style.display = "none"; // Скрываем GIF preview при открытии
  document.querySelector(".avatar-result-container").style.display = "none"; // Скрываем контейнер результата при открытии
  document.getElementById("gifResultPreview").style.display = "none"; // Скрываем GIF результат при открытии
  saveBtn.style.display = "none";
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }

  // Инициализируем обработчик выбора файла если еще не инициализирован
  initAvatarInput();

  // Блокируем скролл страницы при открытии модального окна
  document.body.style.overflow = "hidden";
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

      // Проверяем, что файл не является GIF
      if (isGif) {
        alert(
          "GIF файлы не поддерживаются. Пожалуйста, выберите изображение в формате PNG, JPG или JPEG."
        );
        // Очищаем input
        e.target.value = "";
        return;
      }

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

        console.log("Создаю Cropper для обычного изображения...");
        console.log("Cropper доступен:", typeof Cropper);

        // Скрываем GIF контейнер и показываем Cropper для PNG/JPG
        document.getElementById("gifPreviewColumn").style.display = "none";
        document.getElementById("cropperContainer").style.display = "block";
        document.getElementById("pngPreviewContainer").style.display = "block";
        document.getElementById("gifResultPreview").style.display = "none";
        document.querySelector(".avatar-result-container").style.display =
          "none";
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
  document.getElementById("gifResultPreview").style.display = "none"; // Скрываем по умолчанию
  document.getElementById("pngPreviewContainer").style.display = "none";
  document.getElementById("cropperContainer").style.display = "none";
  document.querySelector(".avatar-result-container").style.display = "none"; // Скрываем по умолчанию
  document.getElementById("avatarImage").src = "";

  // Разблокируем скролл страницы при закрытии модального окна
  document.body.style.overflow = "";
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

// Редактирование имени пользователя
function editUsername() {
  const currentUsername =
    document.getElementById("usernameDisplay").textContent;
  const newUsername = prompt(
    "Введите новое имя пользователя:",
    currentUsername
  );

  if (!newUsername) return;
  if (newUsername === currentUsername) return;
  if (newUsername.trim().length === 0) {
    alert("Имя не может быть пустым");
    return;
  }
  if (newUsername.length > 30) {
    alert("Имя не может быть длиннее 30 символов");
    return;
  }

  // Автоматически делаем первую букву заглавной
  const capitalizedUsername = newUsername.charAt(0).toUpperCase() + newUsername.slice(1);

  saveUsername(capitalizedUsername);
}

// Сохранить новое имя пользователя
async function saveUsername(newUsername) {
  try {
    // Проверка на запрещенные имена
    const forbiddenBase = newUsername.toLowerCase().replace(/[\s\d\.\-]/g, ''); // Убираем пробелы, цифры, точки, дефисы
    if (forbiddenBase === 'мемослав' || forbiddenBase === 'memoslav' || forbiddenBase === 'memoslave') {
      await showCustomAlert(
        "Are you ohuel tam?",
        "Ошибка",
        "🚫"
      );
      return;
    }
    
    // Устанавливаем флаг что идет переименование
    isRenamingUser = true;
    console.log("🔄 Начало переименования пользователя");
    
    const response = await fetch(`/api/user/${currentUser.id}/username`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUsername }),
    });

    const result = await response.json();

    if (!response.ok) {
      isRenamingUser = false; // Сбрасываем флаг при ошибке
      await showCustomAlert(
        result.error || "Не удалось изменить имя",
        "Ошибка",
        "❌"
      );
      return;
    }

    console.log("✅ Имя изменено на сервере, показываем алерт");

    // Показываем сообщение об успешном изменении и ждем подтверждения
    await showCustomAlert(
      `Имя успешно изменено на "${newUsername}".\n\nВы будете разлогинены со всех устройств.\nВойдите заново с новым именем.`,
      "Имя изменено",
      "✅"
    );

    console.log("👍 Пользователь нажал OK, выполняется выход");

    // После того как пользователь нажал OK, очищаем данные и разлогиниваем
    localStorage.removeItem("currentUser");
    localStorage.removeItem("sessionToken");
    
    // Перезагружаем страницу (вернет на страницу логина)
    window.location.reload();
  } catch (error) {
    isRenamingUser = false; // Сбрасываем флаг при ошибке
    console.error("❌ Ошибка при изменении имени:", error);
    await showCustomAlert(
      "Ошибка при изменении имени",
      "Ошибка",
      "❌"
    );
  }
}

// ===== DRAG-TO-SCROLL ФУНКЦИОНАЛЬНОСТЬ =====
// Позволяет перетаскивать sticky divs для скролла страницы

class DragToScroll {
  constructor() {
    this.isDragging = false;
    this.startY = 0;
    this.scrollTop = 0;
    this.draggedElement = null;

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
  }

  initElement(element) {
    if (!element) return;

    // Указываем, что элемент можно перетаскивать
    element.style.cursor = "grab";
    element.style.userSelect = "none";
    element.style.webkitUserSelect = "none";
    element.style.touchAction = "manipulation";

    // Mouse events
    element.addEventListener("mousedown", this.onMouseDown);

    // Touch events
    element.addEventListener("touchstart", this.onTouchStart, {
      passive: true,
    });
  }

  onMouseDown(e) {
    if (e.button !== 0) return; // Только левая кнопка мыши

    // Если клик был на интерактивном элементе (кнопка, ссылка, инпут и т.д.), игнорируем
    const target = e.target;
    if (
      target.tagName === "BUTTON" ||
      target.tagName === "A" ||
      target.tagName === "INPUT" ||
      target.closest("button") ||
      target.closest("a") ||
      target.closest("input") ||
      target.closest(".match-row") ||
      target.closest(".event") ||
      target.closest(".my-bets-item")
    ) {
      return;
    }

    // Предотвращаем выделение текста и другие стандартные действия
    e.preventDefault();

    this.isDragging = true;
    this.draggedElement = e.currentTarget;
    this.startY = e.clientY;
    this.scrollTop = window.scrollY;

    this.draggedElement.style.cursor = "grabbing";

    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);
  }

  onMouseMove = (e) => {
    if (!this.isDragging) return;

    e.preventDefault();

    const delta = e.clientY - this.startY;
    window.scrollTo(0, this.scrollTop - delta);
  };

  onMouseUp = (e) => {
    if (!this.isDragging) return;

    e.preventDefault();

    this.isDragging = false;
    if (this.draggedElement) {
      this.draggedElement.style.cursor = "grab";
    }

    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);
  };

  onTouchStart(e) {
    if (e.touches.length !== 1) return;

    // Если touch был на интерактивном элементе, игнорируем
    const target = e.target;
    if (
      target.tagName === "BUTTON" ||
      target.tagName === "A" ||
      target.tagName === "INPUT" ||
      target.closest("button") ||
      target.closest("a") ||
      target.closest("input")
    ) {
      return;
    }

    // Предотвращаем стандартное поведение для touch
    e.preventDefault();

    this.isDragging = true;
    this.draggedElement = e.currentTarget;
    this.startY = e.touches[0].clientY;
    this.scrollTop = window.scrollY;

    document.addEventListener("touchmove", this.onTouchMove, {
      passive: false,
    });
    document.addEventListener("touchend", this.onTouchEnd);
  }

  onTouchMove = (e) => {
    if (!this.isDragging) return;

    e.preventDefault();

    const delta = e.touches[0].clientY - this.startY;
    window.scrollTo(0, this.scrollTop - delta);
  };

  onTouchEnd = (e) => {
    if (!this.isDragging) return;

    e.preventDefault();

    this.isDragging = false;

    document.removeEventListener("touchmove", this.onTouchMove);
    document.removeEventListener("touchend", this.onTouchEnd);
  };
}

// Инициализируем drag-to-scroll при загрузке страницы
const dragToScroll = new DragToScroll();

// Инициализация элементов для перетаскивания
function initDragToScroll() {
  // Ищем все sticky заголовки (но исключаем roundsFilterContainer)
  const stickyHeaders = document.querySelectorAll(
    'div[style*="position: sticky"]:not(#roundsFilterContainer)'
  );
  stickyHeaders.forEach((header) => {
    dragToScroll.initElement(header);
  });

  // Инициализируем drag-to-scroll для левой колонки
  const leftColumn = document.getElementById("leftColumn");
  if (leftColumn) {
    dragToScroll.initElement(leftColumn);
  }
}

// Класс для горизонтального drag-to-scroll (для туров)
class HorizontalDragScroll {
  constructor() {
    this.isDragging = false;
    this.startX = 0;
    this.scrollLeft = 0;
    this.draggedElement = null;

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.onWheel = this.onWheel.bind(this);
  }

  initElement(element) {
    if (!element) return;

    element.style.cursor = "grab";
    element.style.userSelect = "none";
    element.style.webkitUserSelect = "none";
    element.style.touchAction = "manipulation";

    element.addEventListener("mousedown", this.onMouseDown);
    element.addEventListener("touchstart", this.onTouchStart, {
      passive: true,
    });
    element.addEventListener("wheel", this.onWheel, { passive: false });
  }

  onWheel(e) {
    // Предотвращаем вертикальную прокрутку страницы
    e.preventDefault();
    
    // Прокручиваем горизонтально
    e.currentTarget.scrollLeft += e.deltaY;
  }

  onMouseDown(e) {
    // НЕ игнорируем клики на кнопках - это важно!
    // Мы хотим перетаскивать ЗА кнопки

    this.isDragging = true;
    this.draggedElement = e.currentTarget;
    this.startX = e.clientX;
    this.scrollLeft = this.draggedElement.scrollLeft;

    this.draggedElement.style.cursor = "grabbing";

    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);
  }

  onMouseMove = (e) => {
    if (!this.isDragging) return;

    e.preventDefault();

    const delta = e.clientX - this.startX;
    this.draggedElement.scrollLeft = this.scrollLeft - delta;
  };

  onMouseUp = (e) => {
    if (!this.isDragging) return;

    this.isDragging = false;
    this.draggedElement.style.cursor = "grab";

    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);
  };

  onTouchStart(e) {
    this.isDragging = true;
    this.draggedElement = e.currentTarget;
    this.startX = e.touches[0].clientX;
    this.scrollLeft = this.draggedElement.scrollLeft;
  }

  onTouchMove = (e) => {
    if (!this.isDragging) return;

    const delta = e.touches[0].clientX - this.startX;
    this.draggedElement.scrollLeft = this.scrollLeft - delta;
  };

  onTouchEnd = (e) => {
    this.isDragging = false;
  };
}

// Инициализация горизонтального drag-to-scroll для туров
function initHorizontalDragScroll() {
  const horizontalDragScroll = new HorizontalDragScroll();
  const roundsContainer = document.getElementById("roundsFilterContainer");
  if (roundsContainer) {
    horizontalDragScroll.initElement(roundsContainer);
  }
  
  // Инициализируем также для tournamentRoundsFilter
  const tournamentRoundsFilter = document.getElementById("tournamentRoundsFilter");
  if (tournamentRoundsFilter) {
    horizontalDragScroll.initElement(tournamentRoundsFilter);
  }
}

// Вызываем инициализацию при загрузке DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initHorizontalDragScroll);
} else {
  initHorizontalDragScroll();
}

// Также инициализируем при каждом обновлении контента
const originalDisplayMatches = displayMatches;
displayMatches = function (...args) {
  const result = originalDisplayMatches.apply(this, args);
  setTimeout(initHorizontalDragScroll, 100);
  return result;
};

// ===== ОБРАБОТКА TOUCH СОБЫТИЙ ДЛЯ СКРОЛЛА СТРАНИЦЫ =====

function initPageScrollOnHeaders() {
  const elements = [
    document.querySelector('.tournaments-header'),
    document.querySelector('.matches-container'), // Весь контейнер, а не только h2
    document.querySelector('.my-bets-title')
  ];

  elements.forEach(element => {
    if (!element) return;

    let startY = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let isDragging = false;
    let momentumAnimation = null;

    element.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      lastY = startY;
      lastTime = Date.now();
      velocity = 0;
      isDragging = true;
      
      // Останавливаем предыдущую анимацию инерции
      if (momentumAnimation) {
        cancelAnimationFrame(momentumAnimation);
        momentumAnimation = null;
      }
    }, { passive: false });

    element.addEventListener('touchmove', (e) => {
      if (!isDragging) return;

      // Предотвращаем стандартный скролл контейнера
      e.preventDefault();
      e.stopPropagation();

      const currentY = e.touches[0].clientY;
      const currentTime = Date.now();
      const deltaY = lastY - currentY;
      const deltaTime = currentTime - lastTime;

      // Вычисляем скорость (пиксели в миллисекунду)
      if (deltaTime > 0) {
        velocity = deltaY / deltaTime;
      }

      // Скроллим страницу
      window.scrollBy(0, deltaY);
      
      lastY = currentY;
      lastTime = currentTime;
    }, { passive: false });

    element.addEventListener('touchend', () => {
      isDragging = false;
      
      // Запускаем инерционный скролл если скорость достаточная
      if (Math.abs(velocity) > 0.1) {
        startMomentumScroll(velocity);
      }
    }, { passive: false });

    // Инерционный скролл
    function startMomentumScroll(initialVelocity) {
      let currentVelocity = initialVelocity;
      const deceleration = 0.95; // Коэффициент замедления (0.95 = 5% замедление за кадр)
      const minVelocity = 0.1; // Минимальная скорость для продолжения анимации

      function animate() {
        if (Math.abs(currentVelocity) < minVelocity) {
          momentumAnimation = null;
          return;
        }

        // Скроллим с текущей скоростью
        window.scrollBy(0, currentVelocity * 16); // 16ms ≈ 1 кадр при 60fps
        
        // Замедляем
        currentVelocity *= deceleration;

        // Продолжаем анимацию
        momentumAnimation = requestAnimationFrame(animate);
      }

      animate();
    }
  });
}

// Инициализируем при загрузке
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPageScrollOnHeaders);
} else {
  initPageScrollOnHeaders();
}

// ===== ФУНКЦИИ ДЛЯ ТЕРМИНАЛА =====

let terminalAutoScroll = true;
let terminalRefreshInterval = null;

// Открыть модальное окно терминала
function openTerminalModal() {
  const modal = document.getElementById("terminalModal");
  if (modal) {
    modal.classList.add("active");
    console.log("✅ Терминал открыт");
    refreshTerminalLogs();
    if (terminalRefreshInterval) clearInterval(terminalRefreshInterval);
    terminalRefreshInterval = setInterval(refreshTerminalLogs, 1000);
  }
}

// Закрыть модальное окно терминала
function closeTerminalModal(event) {
  const modal = document.getElementById("terminalModal");
  if (modal) {
    modal.classList.remove("active");
    if (terminalRefreshInterval) {
      clearInterval(terminalRefreshInterval);
      terminalRefreshInterval = null;
    }
  }
}

// Получить логи терминала с сервера
async function refreshTerminalLogs() {
  try {
    const response = await fetch("/api/terminal-logs");

    if (!response.ok) throw new Error("Ошибка загрузки логов");

    const data = await response.json();

    const content = document.getElementById("terminalContent");

    if (content) {
      // Если это HTML контент или чистый текст
      if (data.logs) {
        const lines = data.logs.split("\n");

        // Создаем HTML разноцветный вывод
        const htmlContent = lines
          .map((line) => {
            let color = "#00ff00"; // зелёный по умолчанию
            let className = "";

            // Определяем цвет в зависимости от типа лога
            if (line.includes("❌") || line.includes("ERROR")) {
              color = "#ff3333"; // красный для ошибок
              className = "error";
            } else if (line.includes("⚠️") || line.includes("WARN")) {
              color = "#ffff00"; // жёлтый для предупреждений
              className = "warn";
            } else if (line.includes("✅") || line.includes("успешно")) {
              color = "#00ff00"; // зелёный для успеха
              className = "success";
            } else if (line.includes("📧") || line.includes("сообщение")) {
              color = "#00ffff"; // голубой для сообщений
              className = "info";
            } else if (line.includes("🔗") || line.includes("Telegram")) {
              color = "#00bfff"; // синий для телеграма
              className = "telegram";
            } else if (line.includes("[")) {
              color = "#888888"; // серый для времени
              className = "time";
            }

            return `<div style="color: ${color}" class="log-line ${className}">${escapeHtml(
              line
            )}</div>`;
          })
          .join("");

        content.innerHTML = htmlContent || "[Логи пусты]";

        // Автоскролл в конец если включен
        if (terminalAutoScroll) {
          content.scrollTop = content.scrollHeight;
        }
      }
    }
  } catch (error) {
    const content = document.getElementById("terminalContent");
    if (content) {
      content.innerHTML = `<div style="color: #ff3333">❌ Ошибка загрузки логов: ${escapeHtml(
        error.message
      )}</div>`;
    }
  }
}

// Функция для экранирования HTML
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Очистить логи терминала
async function clearTerminalLogs() {
  if (!confirm("Вы уверены, что хотите очистить логи?")) return;

  try {
    const response = await fetch("/api/terminal-logs", {
      method: "DELETE",
    });

    if (!response.ok) throw new Error("Ошибка очистки логов");

    const content = document.getElementById("terminalContent");
    if (content) {
      content.textContent = "[✅ Логи очищены]";
    }

    // Обновляем логи через 500мс
    setTimeout(refreshTerminalLogs, 500);
  } catch (error) {
    console.error("Ошибка при очистке логов:", error);
    alert("Ошибка при очистке логов: " + error.message);
  }
}

// Сохранить логи терминала на ПК
async function saveTerminalLogs() {
  try {
    const response = await fetch("/api/terminal-logs");
    if (!response.ok) throw new Error("Ошибка загрузки логов");
    
    const data = await response.json();
    if (!data.logs) {
      alert("❌ Нет логов для сохранения");
      return;
    }

    const blob = new Blob([data.logs], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, -5);
    a.download = `terminal-logs-${timestamp}.txt`;
    
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    console.log("✅ Логи сохранены на ПК");
  } catch (error) {
    console.error("Ошибка при сохранении логов:", error);
    alert("❌ Ошибка при сохранении логов: " + error.message);
  }
}

// Переключить автоскролл
function toggleTerminalAutoScroll() {
  terminalAutoScroll = !terminalAutoScroll;
  const btn = document.getElementById("terminalAutoScrollBtn");
  if (btn) {
    if (terminalAutoScroll) {
      btn.style.background = "rgba(76, 175, 80, 0.7)";
      btn.style.borderColor = "#4caf50";
      btn.textContent = "⬇️ Auto";
      // Сразу скроллим вниз
      const content = document.getElementById("terminalContent");
      if (content) content.scrollTop = content.scrollHeight;
    } else {
      btn.style.background = "rgba(255, 87, 34, 0.7)";
      btn.style.borderColor = "#ff5722";
      btn.textContent = "⏸️ Стоп";
    }
  }
}

// ===== МОДАЛЬНЫЕ ОКНА ТУРНИРОВ =====

// Открыть модальное окно создания турнира
function openCreateEventModal() {
  console.log("🔧 openCreateEventModal called");
  const modal = document.getElementById("createEventModal");
  console.log("🔧 modal element:", modal);
  if (modal) {
    lockBodyScroll();
    modal.style.display = "flex";
    document
      .getElementById("customIconCheckbox")
      .addEventListener("change", handleCreateEventIconChange);
    initCustomSelect("eventIconSelect");
    console.log("🔧 modal opened successfully");
  } else {
    console.error("🔧 createEventModal not found!");
  }
}

// Закрыть модальное окно создания турнира
function closeCreateEventModal() {
  document.getElementById("createEventModal").style.display = "none";
  unlockBodyScroll();
  document.getElementById("createEventForm").reset();
  document.getElementById("customIconGroup").style.display = "none";
  document
    .getElementById("customIconCheckbox")
    .removeEventListener("change", handleCreateEventIconChange);
}

// Предпросмотр объявления о турнире
function previewTournamentAnnouncement(event) {
  event.preventDefault();
  
  // Собираем данные турнира
  const name = document.getElementById("eventName").value.trim();
  const description = document.getElementById("eventDescription").value.trim();
  const startDate = document.getElementById("eventDate").value;
  const endDate = document.getElementById("eventEndDate").value;
  
  if (!name) {
    alert('Введите название турнира');
    return;
  }
  
  // Форматируем даты
  let dateText = '';
  if (startDate && endDate) {
    const start = new Date(startDate).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const end = new Date(endDate).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    dateText = `📅 Даты: ${start} - ${end}`;
  } else if (startDate) {
    const start = new Date(startDate).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    dateText = `📅 Начало: ${start}`;
  }
  
  // Формируем сообщение
  let message = `🏆 <b>НОВЫЙ ТУРНИР!</b>\n\n`;
  message += `<b>${name}</b>\n\n`;
  
  if (description) {
    message += `📝 ${description}\n\n`;
  }
  
  if (dateText) {
    message += `${dateText}\n\n`;
  }
  
  message += `Приготовьтесь делать прогнозы! 🎯\n\n`;
  message += `🔗 <a href="http://${window.location.hostname}:${window.location.port}">Открыть сайт</a>`;
  
  // Показываем предпросмотр (конвертируем HTML в читаемый текст)
  const previewText = message
    .replace(/<b>/g, '**')
    .replace(/<\/b>/g, '**')
    .replace(/<a href="[^"]*">/g, '')
    .replace(/<\/a>/g, '')
    .replace(/\n/g, '\n');
  
  document.getElementById('announcementPreview').innerHTML = previewText.replace(/\n/g, '<br>');
  
  // Сохраняем данные для отправки
  window.tournamentAnnouncementData = {
    name,
    description,
    startDate,
    endDate,
    message
  };
  
  // Открываем модальное окно предпросмотра
  document.getElementById('tournamentAnnouncementModal').style.display = 'flex';
  lockBodyScroll();
}

// Закрыть модальное окно предпросмотра объявления
function closeTournamentAnnouncementModal() {
  document.getElementById('tournamentAnnouncementModal').style.display = 'none';
  unlockBodyScroll();
}

// Форматирование текста в textarea
function formatText(type) {
  const textarea = document.getElementById('announcementText');
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = textarea.value.substring(start, end);
  
  if (!selectedText && (type === 'bold' || type === 'italic' || type === 'code')) {
    alert('Выделите текст для форматирования');
    return;
  }
  
  let formattedText = '';
  let cursorOffset = 0;
  
  switch(type) {
    case 'bold':
      formattedText = `*${selectedText}*`;
      cursorOffset = selectedText.length + 2;
      break;
    case 'italic':
      formattedText = `_${selectedText}_`;
      cursorOffset = selectedText.length + 2;
      break;
    case 'code':
      formattedText = `\`${selectedText}\``;
      cursorOffset = selectedText.length + 2;
      break;
    case 'bullet':
      // Если текст выделен - добавляем маркер к каждой строке
      if (selectedText) {
        formattedText = selectedText.split('\n').map(line => line.trim() ? `• ${line}` : line).join('\n');
        cursorOffset = formattedText.length;
      } else {
        // Если ничего не выделено - вставляем шаблон
        formattedText = '• ';
        cursorOffset = 2;
      }
      break;
    case 'number':
      // Если текст выделен - добавляем нумерацию к каждой строке
      if (selectedText) {
        let counter = 1;
        formattedText = selectedText.split('\n').map(line => line.trim() ? `${counter++}. ${line}` : line).join('\n');
        cursorOffset = formattedText.length;
      } else {
        // Если ничего не выделено - вставляем шаблон
        formattedText = '1. ';
        cursorOffset = 3;
      }
      break;
  }
  
  // Заменяем выделенный текст на отформатированный
  textarea.value = textarea.value.substring(0, start) + formattedText + textarea.value.substring(end);
  
  // Устанавливаем курсор в конец отформатированного текста
  textarea.focus();
  textarea.setSelectionRange(start + cursorOffset, start + cursorOffset);
  
  // Обновляем предпросмотр
  textarea.dispatchEvent(new Event('input'));
}

// Вставка эмодзи в позицию курсора
function insertEmoji(emoji) {
  const textarea = document.getElementById('announcementText');
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  
  // Вставляем эмодзи в позицию курсора
  textarea.value = textarea.value.substring(0, start) + emoji + textarea.value.substring(end);
  
  // Устанавливаем курсор после эмодзи
  const newPosition = start + emoji.length;
  textarea.focus();
  textarea.setSelectionRange(newPosition, newPosition);
  
  // Обновляем предпросмотр
  textarea.dispatchEvent(new Event('input'));
}

// Открыть модальное окно объявления о новых функциях
function openAnnouncementModal() {
  document.getElementById('featureAnnouncementModal').style.display = 'flex';
  lockBodyScroll();
  
  // Добавляем обработчик для предпросмотра
  const titleInput = document.getElementById('announcementTitle');
  const textInput = document.getElementById('announcementText');
  const preview = document.getElementById('announcementPreviewText');
  
  function updatePreview() {
    const title = titleInput.value.trim();
    const text = textInput.value.trim();
    
    if (!title && !text) {
      preview.innerHTML = 'Введите текст чтобы увидеть предпросмотр...';
      return;
    }
    
    let previewText = '';
    if (title) {
      previewText += `<b>${title}</b>\n\n`;
    }
    if (text) {
      // Применяем то же форматирование что и на сервере
      let formatted = text;
      
      // *текст* → жирный
      formatted = formatted.replace(/\*([^*]+)\*/g, '<b>$1</b>');
      
      // _текст_ → курсив
      formatted = formatted.replace(/_([^_]+)_/g, '<i>$1</i>');
      
      // `текст` → моноширинный
      formatted = formatted.replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 3px;">$1</code>');
      
      // Списки с • или -
      formatted = formatted.replace(/^[•\-]\s+(.+)$/gm, '  ▪️ $1');
      
      // Цифровые списки
      formatted = formatted.replace(/^(\d+)\.\s+(.+)$/gm, '  <b>$1.</b> $2');
      
      // Подпункты
      formatted = formatted.replace(/^\s{2,}([•\-])\s+(.+)$/gm, '     ◦ $2');
      
      previewText += formatted;
    }
    
    preview.innerHTML = previewText.replace(/\n/g, '<br>');
  }
  
  titleInput.addEventListener('input', updatePreview);
  textInput.addEventListener('input', updatePreview);
  
  updatePreview();
}

// Закрыть модальное окно объявления
function closeAnnouncementModal() {
  document.getElementById('featureAnnouncementModal').style.display = 'none';
  unlockBodyScroll();
  document.getElementById('featureAnnouncementForm').reset();
  document.getElementById('announcementPreviewText').innerHTML = 'Введите текст чтобы увидеть предпросмотр...';
}

// Отправить объявление себе для проверки
async function sendAnnouncementToSelf() {
  const title = document.getElementById('announcementTitle').value.trim();
  const text = document.getElementById('announcementText').value.trim();
  
  if (!title || !text) {
    alert('Заполните все поля');
    return;
  }
  
  try {
    const response = await fetch('/api/admin/send-feature-announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        title,
        text,
        testMode: true
      })
    });
    
    const result = await response.json();
    
    if (response.ok) {
      if (typeof showCustomAlert === 'function') {
        showCustomAlert('Тестовое сообщение отправлено вам в Telegram', 'Успешно', '✅');
      } else {
        alert('Тестовое сообщение отправлено вам в Telegram');
      }
    } else {
      alert(result.error || 'Ошибка при отправке');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    alert('Ошибка при отправке');
  }
}

// Отправить объявление всем пользователям
async function sendAnnouncementToAll() {
  const title = document.getElementById('announcementTitle').value.trim();
  const text = document.getElementById('announcementText').value.trim();
  
  if (!title || !text) {
    await showCustomAlert('Заполните все поля');
    return;
  }
  
  const confirmed = await showCustomConfirm('Отправить объявление всем пользователям с включенными уведомлениями?');
  if (!confirmed) {
    return;
  }
  
  try {
    const response = await fetch('/api/admin/send-feature-announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        title,
        text,
        testMode: false
      })
    });
    
    const result = await response.json();
    
    if (response.ok) {
      closeAnnouncementModal();
      if (typeof showCustomAlert === 'function') {
        showCustomAlert(
          `Объявление отправлено: ${result.successCount} успешно, ${result.errorCount} ошибок`,
          'Успешно',
          '✅'
        );
      } else {
        alert(`Объявление отправлено: ${result.successCount} успешно, ${result.errorCount} ошибок`);
      }
    } else {
      alert(result.error || 'Ошибка при отправке');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    alert('Ошибка при отправке');
  }
}

// Отправить объявление о турнире админу
async function sendTournamentAnnouncementToAdmin() {
  if (!window.tournamentAnnouncementData) {
    alert('Ошибка: данные турнира не найдены');
    return;
  }
  
  try {
    const response = await fetch('/api/admin/send-tournament-announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        ...window.tournamentAnnouncementData
      })
    });
    
    const result = await response.json();
    
    if (response.ok) {
      closeTournamentAnnouncementModal();
      if (typeof showCustomAlert === 'function') {
        showCustomAlert('Объявление отправлено админу на проверку', 'Успешно', '✅');
      } else {
        alert('Объявление отправлено админу на проверку');
      }
    } else {
      alert(result.error || 'Ошибка при отправке объявления');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    alert('Ошибка при отправке объявления');
  }
}

// Открыть модальное окно редактирования турнира
function openEditEventModal(eventId) {
  console.log("🔧 openEditEventModal called with eventId:", eventId);
  // Загружаем данные о турнире
  fetch(`/api/events/${eventId}`)
    .then((response) => {
      console.log("🔧 fetch response status:", response.status);
      return response.json();
    })
    .then((event) => {
      console.log("🔧 fetched event data:", event);
      // Заполняем форму данными
      document.getElementById("editEventId").value = event.id;
      document.getElementById("editEventName").value = event.name;
      document.getElementById("editEventDescription").value =
        event.description || "";
      document.getElementById("editEventDate").value = event.start_date
        ? event.start_date.split("T")[0]
        : "";
      document.getElementById("editEventEndDate").value = event.end_date
        ? event.end_date.split("T")[0]
        : "";

      // Устанавливаем иконку
      const customIconCheckbox = document.getElementById(
        "editCustomIconCheckbox"
      );
      const customIconGroup = document.getElementById("editCustomIconGroup");
      const customIconInput = document.getElementById("editEventCustomIcon");

      if (event.icon) {
        // Проверяем, есть ли такая опция в кастомном select
        const item = document.querySelector(
          `#editEventIconSelect div[data-value="${event.icon}"]`
        );
        if (item) {
          setCustomSelectValue("editEventIconSelect", event.icon);
          customIconCheckbox.checked = false;
          customIconGroup.style.display = "none";
        } else {
          // Это кастомная иконка
          customIconCheckbox.checked = true;
          customIconInput.value = event.icon;
          customIconGroup.style.display = "block";
        }
      } else {
        setCustomSelectValue("editEventIconSelect", "🏆");
        customIconCheckbox.checked = false;
        customIconGroup.style.display = "none";
      }

      // Устанавливаем цвет фона
      document.getElementById("editEventBackgroundColor").value =
        event.background_color || "transparent";
      
      // Устанавливаем team_file
      document.getElementById("editEventTeamFile").value = event.team_file || "";

      // Показываем модальное окно
      const modal = document.getElementById("editEventModal");
      console.log("🔧 editEventModal element:", modal);
      if (modal) {
        lockBodyScroll();
        modal.style.display = "flex";
        document
          .getElementById("editCustomIconCheckbox")
          .addEventListener("change", handleEditEventIconChange);
        initCustomSelect("editEventIconSelect");
        console.log("🔧 edit modal opened successfully");
      } else {
        console.error("🔧 editEventModal not found!");
      }
    })
    .catch((error) => {
      console.error("❌ Ошибка при загрузке данных турнира:", error);
      alert("Ошибка при загрузке данных турнира: " + error.message);
    });
}

// Закрыть модальное окно редактирования турнира
function closeEditEventModal() {
  document.getElementById("editEventModal").style.display = "none";
  unlockBodyScroll();
  document.getElementById("editEventForm").reset();
  document.getElementById("editCustomIconGroup").style.display = "none";
  document
    .getElementById("editCustomIconCheckbox")
    .removeEventListener("change", handleEditEventIconChange);
}

// Обработчик изменения иконки для создания турнира
function handleEventIconChange() {
  const select = document.getElementById("eventIcon");
  const customGroup = document.getElementById("customIconGroup");
  customGroup.style.display = select.value === "custom" ? "block" : "none";
}

// Обработчик изменения чекбокса кастомной иконки для редактирования турнира
function handleEditEventIconChange() {
  console.log("handleEditEventIconChange called");
  const customIconGroup = document.getElementById("editCustomIconGroup");
  console.log("edit customIconGroup:", customIconGroup);
  if (customIconGroup) {
    customIconGroup.style.display = this.checked ? "block" : "none";
    console.log("Set edit display to:", customIconGroup.style.display);
  }
}

// Обработчик изменения чекбокса кастомной иконки для создания турнира
function handleCreateEventIconChange() {
  console.log("handleCreateEventIconChange called");
  const customIconGroup = document.getElementById("customIconGroup");
  console.log("create customIconGroup:", customIconGroup);
  if (customIconGroup) {
    customIconGroup.style.display = this.checked ? "block" : "none";
    console.log("Set create display to:", customIconGroup.style.display);
  }
}

// Отправить форму создания турнира
async function submitCreateEvent(event) {
  event.preventDefault();

  const eventData = {
    username: currentUser.username,
    name: document.getElementById("eventName").value,
    description: document.getElementById("eventDescription").value,
    start_date: document.getElementById("eventDate").value || null,
    end_date: document.getElementById("eventEndDate").value || null,
    team_file: document.getElementById("eventTeamFile").value || null,
    sendToUsers: document.getElementById("sendToUsersCheckbox").checked,
    sendToGroup: document.getElementById("sendToGroupCheckbox").checked,
  };

  // Определяем иконку
  const iconSelect = document.getElementById("eventIcon");
  if (iconSelect.value === "custom") {
    eventData.icon = document.getElementById("eventCustomIcon").value;
  } else {
    eventData.icon = iconSelect.value;
  }

  // Определяем цвет фона
  eventData.background_color = document.getElementById(
    "eventBackgroundColor"
  ).value;

  try {
    const response = await fetch("/api/admin/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventData),
    });

    const result = await response.json();

    if (response.ok) {
      closeCreateEventModal();
      loadEventsList();
    } else {
      alert(result.error || "Ошибка при создании турнира");
    }
  } catch (error) {
    console.error("Ошибка:", error);
    alert("Ошибка при создании турнира");
  }
}

// Отправить форму редактирования турнира
async function submitEditEvent(event) {
  event.preventDefault();

  const eventId = document.getElementById("editEventId").value;
  const eventData = {
    username: currentUser.username,
    name: document.getElementById("editEventName").value.trim(),
    description: document.getElementById("editEventDescription").value.trim(),
    start_date: document.getElementById("editEventDate").value || null,
    end_date: document.getElementById("editEventEndDate").value || null,
    team_file: document.getElementById("editEventTeamFile").value || null,
  };

  // Проверяем обязательные поля
  if (!eventData.name) {
    alert("Название турнира обязательно");
    return;
  }

  // Определяем иконку
  const iconSelect = document.getElementById("editEventIcon");
  const customIconCheckbox = document.getElementById("editCustomIconCheckbox");
  if (customIconCheckbox.checked) {
    eventData.icon = document.getElementById("editEventCustomIcon").value;
  } else {
    eventData.icon = iconSelect.value;
  }

  // Определяем цвет фона
  eventData.background_color = document.getElementById(
    "editEventBackgroundColor"
  ).value;

  try {
    const response = await fetch(`/api/admin/events/${eventId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventData),
    });

    const result = await response.json();

    if (response.ok) {
      closeEditEventModal();
      loadEventsList();
    } else {
      alert(result.error || "Ошибка при обновлении турнира");
    }
  } catch (error) {
    console.error("Ошибка:", error);
    alert("Ошибка при обновлении турнира");
  }
}

// Инициализация кастомного select
function initCustomSelect(selectId) {
  const customSelect = document.getElementById(selectId);
  if (!customSelect || customSelect.dataset.initialized) return;

  customSelect.dataset.initialized = "true";

  const selectSelected = customSelect.querySelector(".select-selected");
  const selectItems = customSelect.querySelector(".select-items");
  const hiddenInput = customSelect.querySelector('input[type="hidden"]');

  // Открытие/закрытие списка
  selectSelected.addEventListener("click", function () {
    selectItems.classList.toggle("select-hide");
    // Закрыть другие открытые select
    document.querySelectorAll(".select-items").forEach((item) => {
      if (item !== selectItems) {
        item.classList.add("select-hide");
      }
    });
  });

  // Выбор опции
  selectItems.querySelectorAll("div").forEach((item) => {
    item.addEventListener("click", function () {
      const value = this.getAttribute("data-value");
      const text = this.innerHTML;

      hiddenInput.value = value;
      selectSelected.innerHTML = text;
      selectItems.classList.add("select-hide");

      // Вызвать обработчик изменения, если есть
      if (selectId === "eventIconSelect") {
        // Для create, ничего, так как custom через чекбокс
      } else if (selectId === "editEventIconSelect") {
        // Аналогично
      }
    });
  });
}

// Глобальный listener для закрытия select при клике вне
document.addEventListener("click", function (e) {
  if (!e.target.closest(".custom-select")) {
    document.querySelectorAll(".select-items").forEach((item) => {
      item.classList.add("select-hide");
    });
  }
});

// Установка значения для кастомного select
function setCustomSelectValue(selectId, value) {
  const customSelect = document.getElementById(selectId);
  if (!customSelect) return;

  const selectSelected = customSelect.querySelector(".select-selected");
  const hiddenInput = customSelect.querySelector('input[type="hidden"]');
  const item = customSelect.querySelector(`div[data-value="${value}"]`);

  if (item) {
    hiddenInput.value = value;
    selectSelected.innerHTML = item.innerHTML;
  }
}


// Показать прогнозы пользователя в сетке плей-офф
async function showUserBracketPredictions(bracketId, userId) {
  try {
    // Загружаем прогнозы пользователя с передачей viewerId
    const currentUserId = currentUser ? currentUser.id : null;
    const url = `/api/brackets/${bracketId}/predictions/${userId}${currentUserId ? `?viewerId=${currentUserId}` : ''}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error('Ошибка загрузки прогнозов');
    }
    
    const data = await response.json();
    
    // Проверяем, скрыты ли прогнозы
    if (data.hidden) {
      const betsContainer = document.getElementById('tournamentParticipantBetsContainer');
      if (betsContainer) {
        betsContainer.innerHTML = `
          <div style="padding: 40px; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 20px;">🔒</div>
            <div style="font-size: 18px; color: #b0b8c8; margin-bottom: 10px;">Прогнозы скрыты</div>
            <div style="font-size: 14px; color: #888;">${data.message || 'Пользователь скрыл свои прогнозы до начала плей-офф'}</div>
          </div>
        `;
      }
      return;
    }
    
    const predictions = data.predictions || data; // Поддержка старого формата
    
    // Формируем HTML для отображения прогнозов
    let html = '<div style="padding: 20px;">';
    
    if (predictions.length === 0) {
      html += '<div class="empty-message">Пользователь не сделал прогнозов в этой сетке</div>';
    } else {
      // Группируем прогнозы по стадиям
      const stageNames = {
        'round_of_16': '1/16 финала',
        'round_of_8': '1/8 финала',
        'quarter_finals': '1/4 финала',
        'semi_finals': '1/2 финала',
        'final': 'Финал'
      };
      
      const groupedPredictions = {};
      predictions.forEach(p => {
        if (!groupedPredictions[p.stage]) {
          groupedPredictions[p.stage] = [];
        }
        groupedPredictions[p.stage].push(p);
      });
      
      // Отображаем прогнозы по стадиям
      const stageOrder = ['round_of_16', 'round_of_8', 'quarter_finals', 'semi_finals', 'final'];
      stageOrder.forEach(stage => {
        if (groupedPredictions[stage]) {
          html += `<h3 style="color: #5a9fd4; margin-top: 20px; margin-bottom: 10px;">${stageNames[stage]}</h3>`;
          html += '<div style="display: flex; flex-direction: column; gap: 8px;">';
          
          groupedPredictions[stage].forEach(p => {
            html += `
              <div style="background: rgba(40, 44, 54, 0.6); border: 1px solid rgba(90, 159, 212, 0.3); border-radius: 5px; padding: 10px;">
                <div style="color: #5a9fd4; font-weight: 600;">Матч ${p.match_index + 1}</div>
                <div style="color: #e0e6f0; margin-top: 5px;">Прогноз: <strong>${p.predicted_winner}</strong></div>
              </div>
            `;
          });
          
          html += '</div>';
        }
      });
    }
    
    html += '</div>';
    
    // Отображаем в контейнере ставок
    const betsContainer = document.getElementById('tournamentParticipantBetsContainer');
    if (betsContainer) {
      betsContainer.innerHTML = html;
    }
    
    // Обновляем активную кнопку
    document.querySelectorAll("#tournamentRoundsFilterScroll .round-filter-btn").forEach(btn => {
      btn.classList.remove("active");
    });
    document.querySelectorAll("#tournamentRoundsFilterScroll .bracket-filter-btn").forEach(btn => {
      if (btn.onclick && btn.onclick.toString().includes(`showUserBracketPredictions(${bracketId}`)) {
        btn.classList.add("active");
      }
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке прогнозов пользователя:', error);
    const betsContainer = document.getElementById('tournamentParticipantBetsContainer');
    if (betsContainer) {
      betsContainer.innerHTML = '<div class="empty-message">Ошибка загрузки прогнозов</div>';
    }
  }
}


// Показать прогнозы пользователя в сетке (открыть модалку)
async function showUserBracketPredictionsInline(userId, username = 'Пользователь') {
  try {
    // Находим сетку для текущего турнира (используем window.currentEventId или currentEventId)
    const eventId = window.currentEventId || currentEventId;
    
    if (!eventId) {
      if (typeof showCustomAlert === 'function') {
        await showCustomAlert('Сначала выберите турнир', 'Ошибка', '❌');
      } else {
        alert('Сначала выберите турнир');
      }
      return;
    }
    
    const brackets = await loadBracketsForEvent(eventId);
    if (!brackets || brackets.length === 0) {
      if (typeof showCustomAlert === 'function') {
        await showCustomAlert('Для этого турнира нет сетки плей-офф', 'Ошибка', '❌');
      } else {
        alert('Для этого турнира нет сетки плей-офф');
      }
      return;
    }
    
    const bracket = brackets[0];
    
    // Отправляем уведомление о просмотре сетки (если смотрит не владелец)
    if (currentUser && currentUser.id !== userId) {
      fetch('/api/notify-view-bracket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewedUserId: userId,
          eventId: eventId
        })
      }).catch(err => console.error('Ошибка отправки уведомления о просмотре сетки:', err));
    }
    
    // Сохраняем username для использования в модалке
    window.viewingUserBracketName = username;
    
    // Напрямую открываем модалку сетки с прогнозами пользователя
    await openBracketModal(bracket.id, userId);
  } catch (error) {
    console.error('Ошибка при открытии прогнозов сетки:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Не удалось загрузить прогнозы сетки', 'Ошибка', '❌');
    } else {
      alert('Не удалось загрузить прогнозы сетки');
    }
  }
}


// Универсальная функция для открытия модалки с анимацией
function openModalWithAnimation(modalId, triggerElement = null) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  
  // Если передан элемент-триггер, вычисляем откуда анимировать
  if (triggerElement) {
    const rect = triggerElement.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();
    
    // Вычисляем смещение от центра модалки до триггера
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const triggerCenterX = rect.left + rect.width / 2;
    const triggerCenterY = rect.top + rect.height / 2;
    
    const translateX = (triggerCenterX - centerX) / centerX * 100;
    const translateY = (triggerCenterY - centerY) / centerY * 100;
    
    modal.style.setProperty('--modal-translate-x', `${translateX}%`);
    modal.style.setProperty('--modal-translate-y', `${translateY}%`);
    modal.style.setProperty('--modal-origin-x', `${(triggerCenterX / window.innerWidth) * 100}%`);
    modal.style.setProperty('--modal-origin-y', `${(triggerCenterY / window.innerHeight) * 100}%`);
  }
  
  modal.style.display = 'flex';
  modal.classList.remove('closing');
}

// Универсальная функция для закрытия модалки с анимацией
function closeModalWithAnimation(modalId, callback = null) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  
  modal.classList.add('closing');
  
  setTimeout(() => {
    modal.style.display = 'none';
    modal.classList.remove('closing');
    if (callback) callback();
  }, 200);
}

// Автоматическая анимация для всех модалок
document.addEventListener('DOMContentLoaded', () => {
  // Наблюдаем за изменениями display у всех модалок
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
        const target = mutation.target;
        if (target.classList.contains('modal') && target.style.display === 'flex') {
          // Модалка открывается - убираем класс closing если есть
          target.classList.remove('closing');
        }
      }
    });
  });
  
  // Наблюдаем за всеми элементами с классом modal
  document.querySelectorAll('.modal').forEach((modal) => {
    observer.observe(modal, { attributes: true, attributeFilter: ['style'] });
  });
});



// Wrapper для fetch с автоматической отправкой session_token
const originalFetch = window.fetch;
window.fetch = function(...args) {
  let [url, options] = args;
  
  // Если options не передан или это не объект, создаем пустой объект
  if (!options || typeof options !== 'object') {
    options = {};
  }
  
  // Добавляем session_token в заголовки если он есть
  const sessionToken = localStorage.getItem("sessionToken");
  if (sessionToken) {
    // Создаем новый объект headers чтобы не мутировать оригинальный
    options.headers = {
      ...(options.headers || {}),
      'x-session-token': sessionToken
    };
  }
  
  return originalFetch(url, options);
};



// ===== НАПОМИНАНИЯ О МАТЧАХ =====

// Переменная для хранения выбранного времени напоминания
let selectedReminderHours = null;

// Показать модалку напоминаний о матчах
async function showMatchRemindersModal(event) {
  if (event) event.stopPropagation();
  
  // Проверяем авторизацию
  if (!currentUser) {
    if (typeof showCustomAlert === 'function') {
      showCustomAlert('Войдите в систему чтобы настроить напоминания', 'Требуется авторизация', '🔒');
    }
    return;
  }
  
  // Проверяем выбран ли турнир
  if (!currentEventId) {
    if (typeof showCustomAlert === 'function') {
      showCustomAlert('Выберите турнир чтобы настроить напоминания', 'Турнир не выбран', '⚠️');
    }
    return;
  }
  
  const modal = document.getElementById('matchRemindersModal');
  if (modal) {
    modal.style.display = 'flex';
    selectedReminderHours = null;
    
    // Сбрасываем выбор
    document.querySelectorAll('.reminder-time-btn').forEach(btn => {
      btn.classList.remove('selected');
    });
    
    // Загружаем текущие настройки
    await loadMatchReminders();
  }
}

// Закрыть модалку напоминаний
function closeMatchRemindersModal() {
  const modal = document.getElementById('matchRemindersModal');
  if (modal) {
    modal.style.display = 'none';
    selectedReminderHours = null;
  }
}

// Выбрать время напоминания
function selectReminderTime(hours) {
  selectedReminderHours = hours;
  
  // Обновляем визуальное состояние кнопок
  document.querySelectorAll('.reminder-time-btn').forEach(btn => {
    if (parseInt(btn.dataset.hours) === hours) {
      btn.classList.add('selected');
    } else {
      btn.classList.remove('selected');
    }
  });
}

// Обновить индикатор напоминаний
function updateReminderIndicator(hasReminder) {
  const indicator = document.getElementById('reminderIndicator');
  if (indicator) {
    indicator.style.display = hasReminder ? 'block' : 'none';
  }
}

// Загрузить текущие настройки напоминаний
async function loadMatchReminders() {
  if (!currentUser || !currentEventId) return;
  
  try {
    const response = await fetch(`/api/user/${currentUser.id}/event/${currentEventId}/reminders`);
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.hours_before) {
        selectedReminderHours = data.hours_before;
        
        // Выделяем соответствующую кнопку
        document.querySelectorAll('.reminder-time-btn').forEach(btn => {
          if (parseInt(btn.dataset.hours) === data.hours_before) {
            btn.classList.add('selected');
          }
        });
        
        // Показываем кнопку удаления
        const deleteBtn = document.getElementById('deleteReminderBtn');
        if (deleteBtn) {
          deleteBtn.style.display = 'block';
        }
        
        // Показываем индикатор
        updateReminderIndicator(true);
      } else {
        // Скрываем кнопку удаления если напоминаний нет
        const deleteBtn = document.getElementById('deleteReminderBtn');
        if (deleteBtn) {
          deleteBtn.style.display = 'none';
        }
        
        // Скрываем индикатор
        updateReminderIndicator(false);
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки настроек напоминаний:', error);
  }
}

// Сохранить настройки напоминаний
async function saveMatchReminders() {
  if (!currentUser || !currentEventId) return;
  
  if (!selectedReminderHours) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Выберите время напоминания', 'Ошибка', '⚠️');
    }
    return;
  }
  
  // Проверяем привязку Telegram
  if (!currentUser.telegram_username) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(
        'Для получения напоминаний необходимо привязать Telegram аккаунт.\n\nПерейдите в настройки профиля и свяжите свой аккаунт с ботом.',
        'Telegram не привязан',
        '📱'
      );
    }
    closeMatchRemindersModal();
    return;
  }
  
  // Проверяем включены ли уведомления
  if (currentUser.telegram_notifications_enabled !== 1) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(
        'У вас отключено получение личных сообщений от бота.\n\nВключите уведомления в настройках профиля чтобы получать напоминания.',
        'Уведомления отключены',
        '🔕'
      );
    }
    closeMatchRemindersModal();
    return;
  }
  
  try {
    const response = await fetch(`/api/user/${currentUser.id}/event/${currentEventId}/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours_before: selectedReminderHours })
    });
    
    if (response.ok) {
      // Показываем индикатор
      updateReminderIndicator(true);
      
      if (typeof showCustomAlert === 'function') {
        await showCustomAlert(
          `Напоминания настроены! Вы будете получать уведомления за ${selectedReminderHours} ${selectedReminderHours === 1 ? 'час' : selectedReminderHours < 5 ? 'часа' : 'часов'} до начала матчей турнира.`,
          'Успешно',
          '✅'
        );
      }
      closeMatchRemindersModal();
    } else {
      const error = await response.json();
      if (typeof showCustomAlert === 'function') {
        await showCustomAlert(
          error.error || 'Не удалось сохранить настройки напоминаний',
          'Ошибка',
          '❌'
        );
      }
    }
  } catch (error) {
    console.error('Ошибка сохранения настроек напоминаний:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(
        'Произошла ошибка при сохранении настроек',
        'Ошибка',
        '❌'
      );
    }
  }
}

// Удалить настройки напоминаний
async function deleteMatchReminders() {
  if (!currentUser || !currentEventId) return;
  
  try {
    const response = await fetch(`/api/user/${currentUser.id}/event/${currentEventId}/reminders`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      // Скрываем индикатор
      updateReminderIndicator(false);
      
      if (typeof showCustomAlert === 'function') {
        await showCustomAlert(
          'Напоминания для этого турнира отключены',
          'Успешно',
          '✅'
        );
      }
      closeMatchRemindersModal();
    } else {
      if (typeof showCustomAlert === 'function') {
        await showCustomAlert(
          'Не удалось удалить настройки напоминаний',
          'Ошибка',
          '❌'
        );
      }
    }
  } catch (error) {
    console.error('Ошибка удаления настроек напоминаний:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(
        'Произошла ошибка при удалении настроек',
        'Ошибка',
        '❌'
      );
    }
  }
}

// ===== СТАТИСТИКА СТАВОК =====

// Кэш для хранения уже показанных процентов (чтобы не анимировать повторно)
const displayedBetStats = new Map();

// Флаг для блокировки автозагрузки статистики из displayMatches
let blockAutoLoadStats = false;

// Функция анимации счетчика
function animateCounter(element, start, end, duration) {
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing function (ease-out)
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (end - start) * easeOut);
    
    element.textContent = `${current}%`;
    
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

// Загрузить и отобразить статистику ставок по матчу
async function loadAndDisplayBetStats(matchId, forceAnimate = false) {
  try {
    const response = await fetch(`/api/match-bet-stats/${matchId}`);
    if (!response.ok) {
      console.error('Ошибка загрузки статистики ставок');
      return;
    }
    
    const stats = await response.json();
    
    // Если нет ставок, не показываем статистику
    if (stats.total === 0) {
      return;
    }
    
    // Находим кнопки ставок для этого матча
    const matchRow = document.querySelector(`.match-row[data-match-id="${matchId}"]`);
    if (!matchRow) return;
    
    const team1Btn = matchRow.querySelector('.bet-btn.team1');
    const drawBtn = matchRow.querySelector('.bet-btn.draw');
    const team2Btn = matchRow.querySelector('.bet-btn.team2');
    
    // Проверяем, есть ли у пользователя ставка на этот матч
    const userBet = userBets.find(bet => bet.match_id === matchId && (!bet.is_final_bet || bet.is_final_bet === 0));
    
    // Если у пользователя нет ставки, не показываем проценты
    if (!userBet) {
      return;
    }
    
    // Проверяем, были ли уже показаны проценты для этого матча
    const wasDisplayed = displayedBetStats.has(matchId);
    
    // Если forceAnimate = true, всегда анимируем
    // Если forceAnimate = false и уже было показано, не анимируем
    const shouldAnimate = forceAnimate;
    
    // Функция для обновления кнопки с процентами
    function updateButtonWithPercent(button, percent, animate) {
      if (!button) return;
      
      // Сохраняем оригинальный текст если его еще нет
      if (!button.dataset.originalText) {
        button.dataset.originalText = button.textContent.trim();
      }
      
      // Проверяем, есть ли уже обертка для процентов
      let percentWrapper = button.querySelector('.bet-percent-wrapper');
      
      if (!percentWrapper) {
        // Создаем новую обертку
        percentWrapper = document.createElement('div');
        percentWrapper.className = 'bet-percent-wrapper visible';
        
        // Определяем начальное значение для анимации
        let startValue = 0;
        if (animate && wasDisplayed) {
          // Если анимируем и уже были данные в кэше, берем старое значение
          const cachedStats = displayedBetStats.get(matchId);
          if (cachedStats) {
            // Определяем, какой процент был у этой кнопки
            if (button.classList.contains('team1')) {
              startValue = cachedStats.team1Percent || 0;
            } else if (button.classList.contains('draw')) {
              startValue = cachedStats.drawPercent || 0;
            } else if (button.classList.contains('team2')) {
              startValue = cachedStats.team2Percent || 0;
            }
          }
        }
        
        percentWrapper.textContent = `${startValue}%`;
        
        // Очищаем содержимое кнопки и добавляем обертку
        button.textContent = '';
        button.appendChild(percentWrapper);
        
        // Запускаем анимацию или сразу показываем значение
        if (animate) {
          setTimeout(() => {
            animateCounter(percentWrapper, startValue, percent, 1000);
          }, 100);
        } else {
          percentWrapper.textContent = `${percent}%`;
        }
      } else {
        // Обертка уже существует
        if (animate) {
          const currentValue = parseInt(percentWrapper.textContent) || 0;
          if (currentValue !== percent) {
            animateCounter(percentWrapper, currentValue, percent, 1000);
          }
        } else {
          percentWrapper.textContent = `${percent}%`;
        }
      }
    }
    
    // Обновляем кнопки с процентами
    updateButtonWithPercent(team1Btn, stats.team1Percent, shouldAnimate);
    updateButtonWithPercent(drawBtn, stats.drawPercent, shouldAnimate);
    updateButtonWithPercent(team2Btn, stats.team2Percent, shouldAnimate);
    
    // Сохраняем в кэш ПОСЛЕ обновления кнопок
    displayedBetStats.set(matchId, {
      team1Percent: stats.team1Percent,
      drawPercent: stats.drawPercent,
      team2Percent: stats.team2Percent
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке статистики ставок:', error);
  }
}


// ===== LIVE МАТЧИ =====

let currentLiveEventId = null;

async function loadLiveMatches() {
  const container = document.getElementById('liveMatchesContainer');
  
  // Восстанавливаем выбранный турнир из localStorage
  const savedLiveEventId = localStorage.getItem('currentLiveEventId');
  if (savedLiveEventId && !currentLiveEventId) {
    currentLiveEventId = parseInt(savedLiveEventId);
  }
  
  // Если выбран турнир, показываем его матчи
  if (currentLiveEventId) {
    await showLiveEventMatches(currentLiveEventId);
    return;
  }
  
  // Иначе показываем список турниров
  try {
    // Получаем все турниры
    const eventsResponse = await fetch('/api/events');
    const allEvents = await eventsResponse.json();
    
    // Получаем текущую дату
    const now = new Date();
    
    // Фильтруем ТОЛЬКО АКТИВНЫЕ турниры (из раздела "📅 Турниры" → "АКТИВНЫЕ ТУРНИРЫ")
    // Это турниры которые:
    // 1. Не завершены (нет locked_reason)
    // 2. Имеют дату начала
    // 3. Уже начались (start_date <= now)
    const activeEvents = allEvents.filter((event) => {
      if (event.locked_reason) return false; // Завершенные турниры не показываем
      if (!event.start_date) return false;   // Без даты начала не показываем
      return new Date(event.start_date) <= now; // Только начавшиеся
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
    
    // Отображаем карточки турниров в виде сетки
    let html = '<div class="live-events-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 15px;">';
    
    // Проверяем каждый турнир на наличие live матчей
    for (const event of activeEvents) {
      // Проверяем есть ли live матчи в этом турнире
      let hasLiveMatches = false;
      try {
        const matchesResponse = await fetch(`/api/live-matches?eventId=${event.id}`);
        if (matchesResponse.ok) {
          const matchesData = await matchesResponse.json();
          const matches = matchesData.matches || [];
          // Проверяем есть ли хотя бы один live матч
          hasLiveMatches = matches.some(m => m.status === 'live' || m.status === 'in_progress');
        }
      } catch (e) {
        // Тихо игнорируем ошибки - турнир может не поддерживаться SStats API
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
                ${event.start_date ? `📅 с ${new Date(event.start_date).toLocaleDateString('ru-RU')}` : ''}
                ${event.end_date ? ` по ${new Date(event.end_date).toLocaleDateString('ru-RU')}` : ''}
              </p>
            ` : ''}
          </div>
          
          <button onclick="event.stopPropagation(); selectEvent(${event.id}); switchTab('allbets');" style="width: 100%; text-align: center; padding: 10px; background: rgba(90, 159, 212, 0.1); border-radius: 5px; border: 1px solid rgba(90, 159, 212, 0.3); cursor: pointer; transition: all 0.3s ease;" onmouseover="this.style.background='rgba(90, 159, 212, 0.3)'" onmouseout="this.style.background='rgba(90, 159, 212, 0.1)'">
            <span style="color: #7ab0e0; font-weight: 600; font-size: 0.95em;">
              ⚽ К ставкам
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
  currentLiveEventId = eventId;
  // Сохраняем выбранный турнир в localStorage
  localStorage.setItem('currentLiveEventId', eventId);
  const container = document.getElementById('liveMatchesContainer');
  
  try {
    // Получаем информацию о турнире
    const eventsResponse = await fetch('/api/events');
    const allEvents = await eventsResponse.json();
    const event = allEvents.find(e => e.id === eventId);
    
    if (!event) {
      container.innerHTML = '<div class="empty-message">Турнир не найден</div>';
      return;
    }
    
    // Получаем матчи турнира на сегодня через новый API
    const matchesResponse = await fetch(`/api/live-matches?eventId=${eventId}`);
    if (!matchesResponse.ok) {
      throw new Error(`Ошибка загрузки матчей: ${matchesResponse.status} ${matchesResponse.statusText}`);
    }
    
    const matchesData = await matchesResponse.json();
    const todayMatches = matchesData.matches || [];
    
    // Заголовок
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
        📅 Матчи на сегодня: ${today.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })}
      </p>
    `;
    
    if (todayMatches.length === 0) {
      html += `
        <div class="empty-message">
          <p>Сегодня ничего нет, уходи</p>
        </div>
      `;
    } else {
      // Сортируем матчи: сначала live, потом предстоящие, в конце завершенные
      const sortedMatches = todayMatches.sort((a, b) => {
        const aIsLive = a.status === 'live' || a.status === 'in_progress';
        const bIsLive = b.status === 'live' || b.status === 'in_progress';
        const aIsFinished = a.status === 'finished' || a.status === 'completed';
        const bIsFinished = b.status === 'finished' || b.status === 'completed';
        
        // Live матчи в самом начале
        if (aIsLive && !bIsLive) return -1;
        if (!aIsLive && bIsLive) return 1;
        
        // Завершенные в самом конце
        if (aIsFinished && !bIsFinished) return 1;
        if (!aIsFinished && bIsFinished) return -1;
        
        // Остальные (предстоящие) по времени
        return new Date(a.match_time) - new Date(b.match_time);
      });
      
      // Отображаем матчи в виде квадратных карточек
      html += '<div class="live-matches-grid">';
      
      for (const match of sortedMatches) {
        const matchTime = new Date(match.match_time);
        const timeStr = formatMatchTimeOnly(match.match_time);
        const isLive = match.status === 'live' || match.status === 'in_progress' || match.status === 'LIVE';
        const isFinished = match.status === 'finished' || match.status === 'completed';
        const isCancelled = ['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(match.status);
        const hasStarted = isLive || isFinished;
        
        // Проверяем есть ли ставка на этот матч и на какую команду
        let betTeam = null;
        if (currentUser && currentUser.bets) {
          const bet = currentUser.bets.find(b => b.match_id === match.id);
          if (bet) {
            betTeam = bet.prediction; // Название команды на которую поставили или "Ничья"
          }
        }
        
        // Определяем нужно ли подчеркивать команды
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
              <span class="favorite-star" data-match-id="${match.id}" onclick="toggleFavoriteMatch(${match.id}, event)">☆</span>
              <div style="position: absolute; top: 10px; right: 10px;">
                <span class="live-indicator" style="position: static; transform: none;"></span>
              </div>
            ` : ''}
            
            <div style="text-align: center; margin-bottom: 10px;">
              <div style="color: ${isCancelled ? '#ff5722' : isLive ? '#f44336' : '#b0b8c8'}; font-size: 0.85em; font-weight: 600;">
                ${isCancelled ? '⚠️ ОТМЕНА' : isLive ? '🔴 LIVE' : isFinished ? '✅ Завершен' : '🕐 ' + timeStr}
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
    
    // Контейнер для завершенных матчей (не обновляется автоматически)
    html += `
      <div id="completedDaysContainer" style="margin-top: 30px; border-top: 2px solid rgba(255, 255, 255, 0.1); padding-top: 20px;">
        <!-- Завершенные матчи загружаются отдельно -->
      </div>
    `;
    
    // Кнопка назад внизу
    html += `
      <div style="margin-top: 30px; text-align: center;">
        <button onclick="backToLiveEvents()" style="padding: 10px 20px; background: rgba(90, 159, 212, 0.2); color: #7ab0e0; border: 1px solid rgba(90, 159, 212, 0.5); border-radius: 5px; cursor: pointer; font-size: 1em; transition: all 0.3s ease;" onmouseover="this.style.background='rgba(90, 159, 212, 0.3)'" onmouseout="this.style.background='rgba(90, 159, 212, 0.2)'">
          ← Назад к LIVE турнирам
        </button>
      </div>
    `;
    
    // Сохраняем содержимое контейнера завершенных матчей перед обновлением
    const existingCompletedDaysContainer = document.getElementById('completedDaysContainer');
    const savedCompletedDaysHTML = existingCompletedDaysContainer ? existingCompletedDaysContainer.innerHTML : null;
    
    container.innerHTML = html;
    
    // Восстанавливаем содержимое контейнера завершенных матчей после обновления
    if (savedCompletedDaysHTML) {
      const newCompletedDaysContainer = document.getElementById('completedDaysContainer');
      if (newCompletedDaysContainer) {
        newCompletedDaysContainer.innerHTML = savedCompletedDaysHTML;
        console.log('✅ Восстановлено содержимое completedDaysContainer');
      }
    }
    
    // Загружаем завершенные матчи отдельно
    // При первой загрузке - с принудительной перезагрузкой
    // При автообновлении - не перезагружаем, если уже есть данные
    const isFirstLoad = !completedDaysData || !savedCompletedDaysHTML;
    if (isFirstLoad) {
      completedDaysData = null; // Очищаем кэш только при первой загрузке
      loadCompletedDays(eventId, true);
    }
    
    // Обновляем звездочки после отрисовки
    updateFavoriteStars();
    
    // Обновляем сохраненные данные избранных матчей из загруженных карточек
    updateFavoriteMatchesData(todayMatches);
    
    // Запускаем polling избранных матчей после загрузки карточек
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
  currentLiveEventId = null;
  // Очищаем сохраненный турнир из localStorage
  localStorage.removeItem('currentLiveEventId');
  loadLiveMatches();
}

// Загрузить и отобразить завершенные дни
let completedDaysLoaded = {};
let completedDaysData = null; // Сохраняем данные с сервера

async function loadCompletedDays(eventId, forceReload = false) {
  try {
    // Сохраняем состояние открытых секций перед перезагрузкой
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
    
    // Принудительная перезагрузка или первая загрузка
    if (forceReload || !completedDaysData) {
      const response = await fetch(`/api/yesterday-matches?eventId=${eventId}`);
      if (!response.ok) {
        throw new Error(`Ошибка: ${response.status}`);
      }
      
      const data = await response.json();
      completedDaysData = data; // Сохраняем данные
      
      console.log('📥 Загружены завершенные дни:', completedDaysData.completedDays?.length || 0);
    }
    
    renderCompletedDays(eventId, openSections);
    
  } catch (error) {
    console.error('Ошибка загрузки завершенных дней:', error);
  }
}

// Отрисовать завершенные дни
function renderCompletedDays(eventId, savedOpenSections = null) {
  if (!completedDaysData) return;
  
  const completedDays = completedDaysData.completedDays || [];
  const container = document.getElementById('completedDaysContainer');
  if (!container) return;
  
  if (completedDays.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  // Используем переданное состояние или пытаемся определить текущее
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
  
  let html = '';
  
  for (const day of completedDays) {
    const dayDate = new Date(day.date + 'T00:00:00');
    const dateStr = dayDate.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
    const dayId = `day-${day.date}`;
    const matchCount = day.matches?.length || 0;
    
    // Проверяем была ли секция открыта
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
          📅 Завершенные матчи: ${dateStr} 
          <span style="color: #7ab0e0; font-size: 0.85em;">(${matchCount})</span>
        </p>
        <div id="${dayId}Container" style="display: ${displayStyle};" data-date="${day.date}"></div>
      </div>
    `;
  }
  
  container.innerHTML = html;
  
  // Если были открытые секции, заново загружаем их контент
  openSections.forEach(dayId => {
    // Сбрасываем флаг загрузки чтобы контент загрузился заново
    completedDaysLoaded[dayId] = false;
    // Загружаем контент
    const dayContainer = document.getElementById(`${dayId}Container`);
    if (dayContainer) {
      renderCompletedDayMatches(dayId);
    }
  });
}

// Отрисовать матчи конкретного дня
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
    
    // Проверяем есть ли ставка на этот матч
    let betTeam = null;
    if (currentUser && currentUser.bets) {
      const bet = currentUser.bets.find(b => b.match_id === match.id);
      if (bet) {
        betTeam = bet.prediction;
      }
    }
    
    const isDraw = betTeam && (betTeam.toLowerCase() === 'ничья' || betTeam.toLowerCase() === 'draw');
    const shouldUnderlineTeam1 = (betTeam === match.team1_name || isDraw);
    const shouldUnderlineTeam2 = (betTeam === match.team2_name || isDraw);
    
    // Формируем отображение результата
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
    
    // Преобразуем данные матча в формат для showLiveTeamStats
    // ВАЖНО: Используем sstats_match_id для загрузки правильной статистики из SStats API
    const matchData = {
      id: match.sstats_match_id, // Используем только sstats_match_id, если его нет - будет null
      dbId: match.id, // Сохраняем локальный ID для справки
      team1: match.team1_name,
      team2: match.team2_name,
      score: hasScore ? `${match.team1_score}:${match.team2_score}` : null,
      status: 'finished',
      match_time: match.match_date,
      elapsed: 90
    };
    
    console.log('🎯 Завершенный матч:', { 
      dbId: match.id, 
      sstatsId: match.sstats_match_id,
      usedId: matchData.id,
      teams: `${matchData.team1} vs ${matchData.team2}`,
      score: matchData.score
    });
    
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
            ✅ Завершен • ${dateStr} ${timeStr}
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

// Показать/скрыть завершенные матчи конкретного дня
async function toggleCompletedDay(dayId, eventId) {
  const container = document.getElementById(`${dayId}Container`);
  const icon = document.getElementById(`${dayId}Icon`);
  
  if (!container || !icon) return;
  
  if (container.style.display === 'none') {
    // Показываем
    container.style.display = 'block';
    icon.textContent = '▲';
    icon.style.transform = 'rotate(180deg)';
    
    // Загружаем матчи если еще не загружены
    if (!completedDaysLoaded[dayId]) {
      container.innerHTML = '<div style="text-align: center; padding: 20px; color: #b0b8c8;">Загрузка...</div>';
      renderCompletedDayMatches(dayId);
    }
  } else {
    // Скрываем
    container.style.display = 'none';
    icon.textContent = '▼';
    icon.style.transform = 'rotate(0deg)';
  }
}

// Показать/скрыть завершенные матчи предыдущего дня (старая функция - оставляем для совместимости)
let yesterdayMatchesLoaded = false;
async function toggleYesterdayMatches(eventId) {
  const container = document.getElementById('yesterdayMatchesContainer');
  const btn = document.getElementById('toggleYesterdayBtn');
  const icon = document.getElementById('yesterdayBtnIcon');
  
  if (container.style.display === 'none') {
    // Показываем
    container.style.display = 'block';
    icon.textContent = '▲';
    
    // Загружаем матчи если еще не загружены
    if (!yesterdayMatchesLoaded) {
      container.innerHTML = '<div style="text-align: center; padding: 20px; color: #b0b8c8;">Загрузка...</div>';
      
      try {
        const response = await fetch(`/api/yesterday-matches?eventId=${eventId}`);
        if (!response.ok) {
          throw new Error(`Ошибка: ${response.status}`);
        }
        
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
            
            // Проверяем есть ли ставка на этот матч
            let betTeam = null;
            if (currentUser && currentUser.bets) {
              const bet = currentUser.bets.find(b => b.match_id === match.id);
              if (bet) {
                betTeam = bet.prediction;
              }
            }
            
            const isDraw = betTeam && (betTeam.toLowerCase() === 'ничья' || betTeam.toLowerCase() === 'draw');
            const shouldUnderlineTeam1 = (betTeam === match.team1_name || isDraw);
            const shouldUnderlineTeam2 = (betTeam === match.team2_name || isDraw);
            
            // Формируем отображение результата
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
            
            // Преобразуем данные матча в формат для showLiveTeamStats
            // ВАЖНО: Используем sstats_match_id для загрузки правильной статистики из SStats API
            const matchData = {
              id: match.sstats_match_id, // Используем только sstats_match_id, если его нет - будет null
              dbId: match.id, // Сохраняем локальный ID для справки
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
                    ✅ Завершен • ${dateStr} ${timeStr}
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
    // Скрываем
    container.style.display = 'none';
    icon.textContent = '▼';
  }
}

// ===== АВТООБНОВЛЕНИЕ LIVE МАТЧЕЙ =====
let liveMatchesUpdateInterval = null;
let favoriteMatchesInterval = null; // Глобальный интервал для избранных матчей

// Запустить автообновление live матчей
function startLiveMatchesAutoUpdate() {
  // Очищаем предыдущий интервал если есть
  if (liveMatchesUpdateInterval) {
    clearInterval(liveMatchesUpdateInterval);
  }
  
  // Обновляем каждые 30 секунд
  liveMatchesUpdateInterval = setInterval(() => {
    // Проверяем что мы все еще на вкладке LIVE
    const activeTab = document.querySelector('.tab-btn.active');
    if (!activeTab || !activeTab.textContent.includes('LIVE')) {
      stopLiveMatchesAutoUpdate();
      return;
    }
    
    // Если открыт конкретный турнир - обновляем его матчи
    if (currentLiveEventId) {
      console.log('🔄 Автообновление матчей турнира:', currentLiveEventId);
      showLiveEventMatches(currentLiveEventId);
    } else {
      // Иначе обновляем список турниров
      console.log('🔄 Автообновление списка LIVE турниров');
      loadLiveMatches();
    }
    
    // Также обновляем избранные матчи
    if (currentUser) {
      pollFavoriteMatches();
    }
  }, 30000); // 30 секунд
  
  console.log('✅ Автообновление LIVE матчей запущено');
}

// Остановить автообновление live матчей
function stopLiveMatchesAutoUpdate() {
  if (liveMatchesUpdateInterval) {
    clearInterval(liveMatchesUpdateInterval);
    liveMatchesUpdateInterval = null;
    console.log('⏹️ Автообновление LIVE матчей остановлено');
  }
}

// Запустить polling избранных матчей (работает на всех вкладках)
function startFavoriteMatchesPolling() {
  // Очищаем предыдущий интервал если есть
  if (favoriteMatchesInterval) {
    clearInterval(favoriteMatchesInterval);
  }
  
  // Запускаем сразу
  pollFavoriteMatches();
  
  // И каждые 30 секунд
  favoriteMatchesInterval = setInterval(() => {
    if (currentUser) {
      pollFavoriteMatches();
    }
  }, 30000);
  
  console.log('✅ Polling избранных матчей запущен (глобально)');
}

// Остановить polling избранных матчей
function stopFavoriteMatchesPolling() {
  if (favoriteMatchesInterval) {
    clearInterval(favoriteMatchesInterval);
    favoriteMatchesInterval = null;
    console.log('⏹️ Polling избранных матчей остановлен');
  }
}

// ===== ИЗБРАННЫЕ LIVE МАТЧИ =====

// Получить список избранных матчей из localStorage
function getFavoriteMatches() {
  const favorites = localStorage.getItem('favoriteMatches');
  return favorites ? JSON.parse(favorites) : [];
}

// Сохранить список избранных матчей в localStorage
function saveFavoriteMatches(favorites) {
  localStorage.setItem('favoriteMatches', JSON.stringify(favorites));
}

// Получить данные избранного матча из localStorage
function getFavoriteMatchData(matchId) {
  const data = localStorage.getItem(`favoriteMatch_${matchId}`);
  return data ? JSON.parse(data) : null;
}

// Сохранить данные избранного матча в localStorage
function saveFavoriteMatchData(matchId, matchData) {
  localStorage.setItem(`favoriteMatch_${matchId}`, JSON.stringify(matchData));
}

// Удалить данные избранного матча из localStorage
function removeFavoriteMatchData(matchId) {
  localStorage.removeItem(`favoriteMatch_${matchId}`);
}

// Обновить данные избранных матчей из загруженных LIVE матчей
function updateFavoriteMatchesData(liveMatches) {
  const favorites = getFavoriteMatches();
  
  favorites.forEach(matchId => {
    const match = liveMatches.find(m => m.id === matchId);
    if (match) {
      // Проверяем есть ли ставка на этот матч
      let betTeam = null;
      if (currentUser && currentUser.bets) {
        const bet = currentUser.bets.find(b => b.match_id === matchId);
        if (bet) {
          betTeam = bet.prediction;
        }
      }
      
      const matchData = {
        id: match.id,
        team1: match.team1,
        team2: match.team2,
        score: match.score || '0:0',
        status: match.status,
        betTeam: betTeam, // Добавляем информацию о ставке
        updatedAt: new Date().toISOString()
      };
      
      saveFavoriteMatchData(matchId, matchData);
      console.log(`💾 Обновлены данные матча ${matchId}:`, matchData);
    }
  });
}

// Переключить статус избранного для матча
function toggleFavoriteMatch(matchId, event) {
  event.stopPropagation(); // Предотвращаем клик по карточке - НЕ открываем статистику
  event.preventDefault(); // Предотвращаем действие по умолчанию
  
  let favorites = getFavoriteMatches();
  const index = favorites.indexOf(matchId);
  
  // Получаем данные матча для уведомления
  const matchCard = event.target.closest('.live-match-card');
  let matchInfo = { match: 'Неизвестный матч', tournamentName: 'Неизвестный турнир' };
  
  if (matchCard) {
    const teamDivs = matchCard.querySelectorAll('div[style*="font-size: 0.95em"][style*="font-weight: 600"]');
    const team1 = teamDivs[0]?.textContent.trim() || 'Команда 1';
    const team2 = teamDivs[1]?.textContent.trim() || 'Команда 2';
    matchInfo.match = `${team1} vs ${team2}`;
    
    // Получаем название турнира из текущего события
    if (currentLiveEventId) {
      fetch('/api/events')
        .then(res => res.json())
        .then(events => {
          const event = events.find(e => e.id === currentLiveEventId);
          if (event) matchInfo.tournamentName = event.name;
        })
        .catch(() => {});
    }
  }
  
  if (index > -1) {
    // Убрать из избранного
    favorites.splice(index, 1);
    removeFavoriteMatchData(matchId); // Удаляем данные матча
    
    // Очищаем флаг удаленного завершенного матча (если пользователь снова добавит - покажем)
    deletedFinishedMatches.delete(matchId);
    saveDeletedFinishedMatches(); // Сохраняем в localStorage
    
    // Уведомляем админа об удалении из избранного
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
    // Добавить в избранное (максимум 20)
    if (favorites.length >= 20) {
      showCustomAlert('Максимум 20 избранных матчей одновременно', 'Ограничение', '⚠️');
      return;
    }
    favorites.push(matchId);
    
    // Сохраняем данные матча из карточки
    if (matchCard) {
      const teamDivs = matchCard.querySelectorAll('div[style*="font-size: 0.95em"][style*="font-weight: 600"]');
      const scoreDiv = matchCard.querySelector('div[style*="font-size: 1.3em"][style*="color: #4caf50"]');
      const statusDiv = matchCard.querySelector('div[style*="color: #ff9800"]');
      
      // Проверяем есть ли ставка на этот матч
      let betTeam = null;
      if (currentUser && currentUser.bets) {
        const bet = currentUser.bets.find(b => b.match_id === matchId);
        if (bet) {
          betTeam = bet.prediction;
        }
      }
      
      const matchData = {
        id: matchId,
        team1: teamDivs[0]?.textContent.trim() || 'Команда 1',
        team2: teamDivs[1]?.textContent.trim() || 'Команда 2',
        score: scoreDiv?.textContent.trim() || '0:0',
        status: statusDiv?.textContent.trim() || 'live',
        betTeam: betTeam, // Добавляем информацию о ставке
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      saveFavoriteMatchData(matchId, matchData);
      console.log('💾 Сохранены данные матча:', matchData);
      
      // Сразу создаем карточку на десктопе
      const isDesktop = window.innerWidth > 1400;
      if (isDesktop) {
        console.log('🖥️ ДЕСКТОП: Создаем карточку сразу после добавления в избранное');
        updateDesktopNotification(matchData);
      }
    }
    
    // Уведомляем админа о добавлении в избранное
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
  console.log('💾 localStorage favoriteMatches:', localStorage.getItem('favoriteMatches'));
  updateFavoriteStars();
  
  // Сразу обновляем карточки уведомлений
  if (index > -1) {
    // Если убрали из избранного - сразу запускаем polling для удаления карточки
    pollFavoriteMatches();
  }
}

// Обновить отображение звездочек на всех карточках
function updateFavoriteStars() {
  const favorites = getFavoriteMatches();
  document.querySelectorAll('.favorite-star').forEach(star => {
    const matchId = parseInt(star.getAttribute('data-match-id'));
    if (favorites.includes(matchId)) {
      star.textContent = '⭐';
      star.classList.add('active');
    } else {
      star.textContent = '☆';
      star.classList.remove('active');
    }
  });
}

// Проверка наличия live матчей и обновление индикатора на кнопке LIVE
async function updateLiveIndicator() {
  const indicator = document.getElementById('liveTabIndicator');
  if (!indicator) {
    console.warn('⚠️ Индикатор LIVE не найден');
    return;
  }
  
  try {
    console.log('🔄 Обновление индикатора LIVE...');
    
    // Получаем все активные турниры
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
    
    // Проверяем есть ли хотя бы один live матч в любом турнире
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
        // Игнорируем ошибки отдельных турниров
        console.warn(`⚠️ Ошибка проверки турнира ${event.name}:`, e.message);
      }
    }
    
    // Обновляем индикатор
    if (hasAnyLiveMatches) {
      console.log('🔴 Индикатор: КРАСНЫЙ (есть live матчи)');
      indicator.classList.remove('static');
    } else {
      console.log('🔵 Индикатор: СИНИЙ (нет live матчей)');
      indicator.classList.add('static');
    }
  } catch (error) {
    console.error('❌ Ошибка обновления live индикатора:', error);
    // При ошибке показываем статичный индикатор
    indicator.classList.add('static');
  }
}

// Вызываем обновление индикатора при загрузке страницы и каждые 30 секунд
// Только для залогиненных пользователей
if (currentUser) {
  updateLiveIndicator();
  setInterval(updateLiveIndicator, 30000);
}


// ===== СИСТЕМА УВЕДОМЛЕНИЙ О ГОЛАХ =====

// Хранилище текущих счетов матчей
const matchScores = {};

// Хранилище времени окончания матчей (для автоудаления через 1 минуту)
const matchFinishTimes = {};

// Список матчей, которые были завершены и удалены (не показывать их снова)
// Загружаем из localStorage при инициализации
const deletedFinishedMatches = new Set(
  JSON.parse(localStorage.getItem('deletedFinishedMatches') || '[]')
);

// Функция для сохранения deletedFinishedMatches в localStorage
function saveDeletedFinishedMatches() {
  localStorage.setItem('deletedFinishedMatches', JSON.stringify([...deletedFinishedMatches]));
}

// Закрыть карточку уведомления вручную
function closeGoalNotification(matchId) {
  const container = document.getElementById('goalNotifications');
  if (!container) return;
  
  const notification = container.querySelector(`[data-match-id="${matchId}"]`);
  if (notification) {
    console.log(`🗑️ Ручное закрытие карточки матча ${matchId}`);
    notification.classList.add('removing');
    setTimeout(() => notification.remove(), 300);
    
    // Помечаем как удаленный
    deletedFinishedMatches.add(matchId);
    saveDeletedFinishedMatches();
    
    // Очищаем данные
    delete matchFinishTimes[matchId];
    delete matchScores[matchId];
  }
}

// Очередь уведомлений
const notificationQueue = [];
let isShowingNotification = false;

// Показать уведомление о голе
function showGoalNotification(match) {
  console.log('🎨 showGoalNotification вызвана для матча:', match);
  
  const container = document.getElementById('goalNotifications');
  if (!container) {
    console.error('❌ Контейнер goalNotifications не найден!');
    return;
  }
  
  // Проверяем не существует ли уже карточка
  const existingNotification = container.querySelector(`[data-match-id="${match.id}"]`);
  if (existingNotification) {
    console.log('⚠️ Карточка уже существует, пропускаем создание');
    return;
  }
  
  const notification = document.createElement('div');
  notification.className = 'goal-notification';
  notification.setAttribute('data-match-id', match.id);
  
  // Определяем нужно ли подчеркивать команды
  const isDraw = match.betTeam && (match.betTeam.toLowerCase() === 'ничья' || match.betTeam.toLowerCase() === 'draw');
  const shouldUnderlineTeam1 = (match.betTeam === match.team1 || isDraw);
  const shouldUnderlineTeam2 = (match.betTeam === match.team2 || isDraw);
  
  const team1Html = shouldUnderlineTeam1 
    ? `<span style="position: relative; display: inline-block;">${match.team1}<span style="position: absolute; bottom: -2px; left: 0; right: 0; height: 2px; background: #fff;"></span></span>`
    : match.team1;
  const team2Html = shouldUnderlineTeam2 
    ? `<span style="position: relative; display: inline-block;">${match.team2}<span style="position: absolute; bottom: -2px; left: 0; right: 0; height: 2px; background: #fff;"></span></span>`
    : match.team2;
  
  // Определяем статус для отображения
  const isFinished = match.status === 'Finished' || 
                    match.status === 'finished' || 
                    match.status === 'Full Time' || 
                    match.status === 'FT' ||
                    match.status === 'Completed' ||
                    match.status === 'completed';
  
  const statusText = isFinished ? 'ЗАВЕРШЕН' : 'LIVE';
  const statusColor = isFinished ? '#ff9800' : '#4caf50';
  
  notification.innerHTML = `
    <div class="goal-notification-header">
      <span class="goal-notification-icon">⚽</span>
      <span class="goal-notification-title" style="color: ${statusColor};">${statusText}</span>
      <button onclick="closeGoalNotification(${match.id})" style="margin-left: auto; background: transparent; border: none; color: rgba(255,255,255,0.7); cursor: pointer; font-size: 16px; padding: 0; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;" title="Закрыть">✕</button>
    </div>
    <div class="goal-notification-teams">
      ${team1Html} - ${team2Html}
    </div>
    <div class="goal-notification-score">${match.score}</div>
  `;
  
  // Добавляем обработчик клика на карточку для открытия статистики
  notification.style.cursor = 'pointer';
  notification.addEventListener('click', (e) => {
    // Проверяем что клик не по кнопке закрытия
    if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
      console.log('🖱️ Клик по карточке избранного, открываем статистику для матча:', match.id);
      // Формируем данные матча для showLiveTeamStats
      const matchData = {
        id: match.id,
        team1: match.team1,
        team2: match.team2,
        score: match.score,
        status: match.status,
        elapsed: match.elapsed
      };
      showLiveTeamStats(matchData);
    }
  });
  
  console.log('➕ Добавляем карточку в контейнер');
  container.appendChild(notification);
  console.log('✅ Карточка добавлена, всего карточек:', container.children.length);
  
  // Воспроизводим звук если включено
  if (currentUser && currentUser.live_sound === 1) {
    playGoalSound();
  }
  
  // Проверяем размер экрана
  const isDesktop = window.innerWidth > 1400;
  
  if (isDesktop) {
    // На десктопе уведомления остаются постоянно
    isShowingNotification = false;
    processNotificationQueue();
  } else {
    // На мобильной удаляем через 6 секунд
    setTimeout(() => {
      notification.classList.add('removing');
      setTimeout(() => {
        notification.remove();
        isShowingNotification = false;
        processNotificationQueue();
      }, 300);
    }, 6000);
  }
}

// Обработать очередь уведомлений
function processNotificationQueue() {
  if (isShowingNotification || notificationQueue.length === 0) return;
  
  isShowingNotification = true;
  const match = notificationQueue.shift();
  showGoalNotification(match);
}

// Добавить уведомление в очередь
function addNotificationToQueue(match) {
  notificationQueue.push(match);
  if (!isShowingNotification) {
    processNotificationQueue();
  }
}

// Воспроизвести звук гола
function playGoalSound() {
  try {
    // Создаем простой звуковой сигнал через Web Audio API
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
  } catch (error) {
    console.error('Ошибка воспроизведения звука:', error);
  }
}

// Polling избранных матчей
async function pollFavoriteMatches() {
  if (!currentUser) {
    console.log('⏸️ Polling избранных: пользователь не залогинен');
    return;
  }
  
  const favorites = getFavoriteMatches();
  console.log(`🔄 Polling избранных матчей: ${favorites.length} в списке`, favorites);
  
  // Очищаем deletedFinishedMatches от матчей, которых больше нет в избранном
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
    // Очищаем контейнер если нет избранных
    const container = document.getElementById('goalNotifications');
    if (container) container.innerHTML = '';
    console.log('📭 Нет избранных матчей, контейнер очищен');
    return;
  }
  
  const isDesktop = window.innerWidth > 1400;
  console.log(`💻 Режим: ${isDesktop ? 'ДЕСКТОП' : 'МОБИЛЬНАЯ'} (ширина: ${window.innerWidth}px)`);
  
  // Загружаем актуальные данные через API для обновления localStorage
  try {
    const response = await fetch(`/api/live-matches-by-ids`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ matchIds: favorites })
    });
    
    if (response.ok) {
      const apiMatches = await response.json();
      console.log(`📡 Получено ${apiMatches.length} матчей через API`);
      console.log('📦 Данные матчей:', apiMatches);
      
      // Обновляем данные в localStorage
      apiMatches.forEach(match => {
        // Проверяем есть ли ставка на этот матч
        let betTeam = null;
        if (currentUser && currentUser.bets) {
          const bet = currentUser.bets.find(b => b.match_id === match.id);
          if (bet) {
            betTeam = bet.prediction;
          }
        }
        
        const matchData = {
          id: match.id,
          team1: match.team1 || match.homeTeam,
          team2: match.team2 || match.awayTeam,
          score: match.score || `${match.homeResult || 0}:${match.awayResult || 0}`,
          status: match.status || match.statusName || 'live',
          elapsed: match.elapsed || null,
          betTeam: betTeam, // Добавляем информацию о ставке
          updatedAt: new Date().toISOString()
        };
        saveFavoriteMatchData(match.id, matchData);
      });
      
      console.log('✅ Данные в localStorage обновлены');
      
      // Проверяем события матчей для отправки уведомлений в Telegram
      if (currentUser && currentUser.id && favorites.length > 0) {
        checkMatchEventsForNotifications(favorites, currentUser.id);
      }
    }
  } catch (error) {
    console.log('⚠️ Не удалось обновить через API, используем данные из localStorage:', error.message);
  }
  
  // Загружаем данные из localStorage для отображения
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
        betTeam: matchData.betTeam || null // Добавляем информацию о ставке
      });
    }
  });
  
  console.log(`📦 Загружено ${matches.length} матчей из localStorage`);
  
  if (matches.length > 0) {
    // Обрабатываем матчи
    processMatches(matches, favorites, isDesktop);
  }
}

// Обработка матчей (вынесено в отдельную функцию)
function processMatches(matches, favorites, isDesktop) {
  const foundMatchIds = matches.map(m => m.id);
  
  // На десктопе показываем все избранные матчи постоянно
  if (isDesktop) {
    console.log('🖥️ ДЕСКТОП: Обработка матчей...');
    matches.forEach(match => {
      const previousScore = matchScores[match.id];
      const currentScore = match.score || '0:0';
      
      // Проверяем статус матча (расширенный список возможных статусов)
      const isFinished = match.status === 'Finished' || 
                        match.status === 'finished' || 
                        match.status === 'Full Time' || 
                        match.status === 'FT' ||
                        match.status === 'Completed' ||
                        match.status === 'completed' ||
                        match.status === 'FINISHED' ||
                        match.status === 'COMPLETED';
      
      // Логируем статус для отладки
      if (match.status && match.status !== 'live' && match.status !== 'LIVE' && match.status !== 'in_progress') {
        console.log(`🔍 Матч ${match.id} (${match.team1} - ${match.team2}): статус = "${match.status}", isFinished = ${isFinished}`);
      }
      
      // Если матч был завершен и удален - не показываем его снова
      if (deletedFinishedMatches.has(match.id)) {
        console.log(`⏭️ Пропускаем матч ${match.id} - уже был удален после завершения`);
        return;
      }
      
      // Если матч только что завершился - запоминаем время
      if (isFinished && !matchFinishTimes[match.id]) {
        matchFinishTimes[match.id] = Date.now();
        console.log(`⏱️ Матч ${match.id} завершен, запускаем таймер на 1 минуту`);
        
        // Удаляем карточку через 1 минуту
        setTimeout(() => {
          const container = document.getElementById('goalNotifications');
          if (container) {
            const notification = container.querySelector(`[data-match-id="${match.id}"]`);
            if (notification) {
              console.log(`⏰ 1 минута прошла, удаляем карточку матча ${match.id}`);
              notification.classList.add('removing');
              setTimeout(() => notification.remove(), 300);
            }
          }
          
          // Удаляем матч из избранного
          let favorites = getFavoriteMatches();
          const index = favorites.indexOf(match.id);
          if (index > -1) {
            favorites.splice(index, 1);
            saveFavoriteMatches(favorites);
            removeFavoriteMatchData(match.id);
            console.log(`🗑️ Матч ${match.id} удален из избранного (завершен)`);
          }
          
          // Помечаем матч как удаленный (не показывать снова)
          deletedFinishedMatches.add(match.id);
          saveDeletedFinishedMatches(); // Сохраняем в localStorage
          // Очищаем данные
          delete matchFinishTimes[match.id];
          delete matchScores[match.id];
        }, 60000); // 60 секунд = 1 минута
      }
      
      // Показываем/обновляем карточку на десктопе
      updateDesktopNotification({
        id: match.id,
        team1: match.team1,
        team2: match.team2,
        score: currentScore,
        status: match.status,
        elapsed: match.elapsed
      });
      
      // Если счет изменился - воспроизводим звук
      if (previousScore && previousScore !== currentScore) {
        console.log('🔊 Счет изменился! Воспроизведение звука...');
        if (currentUser && currentUser.live_sound === 1) {
          playGoalSound();
        }
      }
      
      // Сохраняем текущий счет
      matchScores[match.id] = currentScore;
    });
    
    // Удаляем карточки матчей, которых больше нет в избранном
    const container = document.getElementById('goalNotifications');
    if (container) {
      const existingNotifications = container.querySelectorAll('.goal-notification');
      existingNotifications.forEach(notification => {
        const matchId = parseInt(notification.getAttribute('data-match-id'));
        if (!foundMatchIds.includes(matchId)) {
          console.log(`🗑️ Удаляем карточку уведомления для матча ${matchId} (убран из избранного)`);
          notification.classList.add('removing');
          setTimeout(() => notification.remove(), 300);
          // Очищаем данные
          delete matchFinishTimes[matchId];
          delete matchScores[matchId];
          // НЕ очищаем deletedFinishedMatches - это делается в toggleFavoriteMatch
        }
      });
    }
  } else {
    // На мобильной показываем только при изменении счета
    console.log('📱 МОБИЛЬНАЯ: Проверка изменений счета...');
    matches.forEach(match => {
      if (match.score) {
        const previousScore = matchScores[match.id];
        
        if (previousScore && previousScore !== match.score) {
          console.log(`🎯 Счет изменился для матча ${match.id}: ${previousScore} → ${match.score}`);
          addNotificationToQueue(match);
        }
        
        matchScores[match.id] = match.score;
      }
    });
  }
}

// Обновить или создать уведомление на десктопе
function updateDesktopNotification(match) {
  console.log('🎯 updateDesktopNotification вызвана для матча:', match);
  
  const container = document.getElementById('goalNotifications');
  if (!container) {
    console.error('❌ Контейнер goalNotifications не найден!');
    return;
  }
  
  console.log('✅ Контейнер найден, ищем карточку для матча', match.id);
  
  // Ищем существующую карточку
  let notification = container.querySelector(`[data-match-id="${match.id}"]`);
  
  if (notification) {
    console.log('♻️ Обновляем существующую карточку');
    
    // Обновляем счет в существующей карточке
    const scoreElement = notification.querySelector('.goal-notification-score');
    const currentScore = scoreElement?.textContent || '';
    const newScore = match.score || '0:0';
    
    if (currentScore !== newScore) {
      console.log(`📊 Обновление счета: ${currentScore} → ${newScore}`);
      if (scoreElement) {
        scoreElement.textContent = newScore;
        
        // Добавляем анимацию обновления счета
        scoreElement.style.animation = 'none';
        setTimeout(() => {
          scoreElement.style.animation = 'goalBounce 0.6s ease-out';
        }, 10);
        
        // Добавляем анимацию тряски карточки на 6 секунд (только на десктопе)
        const isDesktop = window.innerWidth > 1400;
        if (isDesktop) {
          notification.classList.add('shake');
          // Убираем класс через 6 секунд
          setTimeout(() => {
            notification.classList.remove('shake');
          }, 6000);
        }
      }
    }
    
    // Обновляем статус (если изменился)
    const titleElement = notification.querySelector('.goal-notification-title');
    if (titleElement && match.status) {
      const isFinished = match.status === 'Finished' || 
                        match.status === 'finished' || 
                        match.status === 'Full Time' || 
                        match.status === 'FT' ||
                        match.status === 'Completed' ||
                        match.status === 'completed';
      
      if (isFinished && titleElement.textContent === 'LIVE') {
        console.log('🏁 Матч завершен, обновляем статус');
        titleElement.textContent = 'ЗАВЕРШЕН';
        titleElement.style.color = '#ff9800';
      }
    }
  } else {
    console.log('🆕 Создаем новую карточку');
    // Создаем новую карточку
    showGoalNotification(match);
  }
}

// Polling избранных матчей запускается автоматически:
// 1. При открытии вкладки LIVE (в showLiveEventMatches)
// 2. Каждые 30 секунд через setInterval (запускается в startLiveMatchesAutoUpdate)

// ===== ПЛАВНОЕ СЛЕДОВАНИЕ ИЗБРАННЫХ ЗА СКРОЛЛОМ (ДЕСКТОП) =====
let scrollTimeout;
let targetScrollY = 0;
let currentScrollY = 0;

function smoothScrollNotifications() {
  const isDesktop = window.innerWidth > 1400;
  if (!isDesktop) return;
  
  const container = document.getElementById('goalNotifications');
  if (!container) return;
  
  // Плавная интерполяция к целевой позиции
  const diff = targetScrollY - currentScrollY;
  if (Math.abs(diff) > 0.5) {
    currentScrollY += diff * 0.15; // Коэффициент плавности (0.15 = медленное следование)
    container.style.transform = `translateY(${currentScrollY}px)`;
    requestAnimationFrame(smoothScrollNotifications);
  } else {
    currentScrollY = targetScrollY;
    container.style.transform = `translateY(${currentScrollY}px)`;
  }
}

function handleScroll() {
  const isDesktop = window.innerWidth > 1400;
  if (!isDesktop) return;
  
  targetScrollY = window.scrollY;
  
  // Запускаем плавную анимацию
  requestAnimationFrame(smoothScrollNotifications);
  
  // Сбрасываем таймаут для возврата в исходную позицию
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    // Возвращаем в viewport после остановки скролла
    const viewportHeight = window.innerHeight;
    const containerHeight = document.getElementById('goalNotifications')?.offsetHeight || 0;
    
    // Если контейнер вышел за пределы viewport, возвращаем его
    if (targetScrollY > 0 && containerHeight > 0) {
      const maxScroll = Math.max(0, targetScrollY - (viewportHeight - containerHeight - 100));
      targetScrollY = Math.min(targetScrollY, maxScroll);
      requestAnimationFrame(smoothScrollNotifications);
    }
  }, 1000); // Задержка 1 секунда после остановки скролла
}

// Добавляем обработчик скролла только на десктопе
if (window.innerWidth > 1400) {
  window.addEventListener('scroll', handleScroll, { passive: true });
  
  // Обновляем при изменении размера окна
  window.addEventListener('resize', () => {
    const isDesktop = window.innerWidth > 1400;
    const container = document.getElementById('goalNotifications');
    if (!isDesktop && container) {
      container.style.transform = 'translateY(0)';
      currentScrollY = 0;
      targetScrollY = 0;
    }
  });
}

// ===== МОДАЛЬНОЕ ОКНО СТАТИСТИКИ LIVE МАТЧА =====

// Кэш для словаря имен игроков
let playerNamesDict = null;
let currentPlayersDictTournament = null; // Код турнира для которого загружен словарь

// Определить код турнира по иконке
function determineTournamentCode(icon) {
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
  
  return iconMapping[icon] || 'CL'; // По умолчанию CL
}

// Маппинг кодов турниров на файлы словарей игроков
const PLAYERS_DICT_FILES = {
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

// Загрузить словарь имен игроков для конкретного турнира
async function loadPlayerNamesDict(tournamentCode) {
  // Если уже загружен словарь для этого турнира, возвращаем его
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
    console.warn('⚠️ Не удалось загрузить словарь имен игроков:', error);
    playerNamesDict = {};
    currentPlayersDictTournament = null;
  }
  
  return playerNamesDict;
}

// Перевести имя игрока (возвращает "Русское имя (Original Name)")
function translatePlayerName(englishName) {
  if (!playerNamesDict || !englishName) {
    console.log(`⚠️ Перевод невозможен: dict=${!!playerNamesDict}, name=${englishName}`);
    return englishName;
  }
  
  // Ищем русское имя по английскому значению в словаре
  for (const [russian, english] of Object.entries(playerNamesDict)) {
    if (english === englishName) {
      console.log(`✅ Переведено: ${englishName} → ${russian}`);
      return `${russian} (${englishName})`;
    }
  }
  
  console.log(`❌ Не найдено в словаре: ${englishName}`);
  return englishName; // Если не найдено, возвращаем оригинал
}

async function showLiveTeamStats(matchData) {
  const modal = document.getElementById('liveTeamStatsModal');
  const title = document.getElementById('liveTeamStatsTitle');
  const content = document.getElementById('liveTeamStatsContent');
  
  // Показываем модальное окно с flex для центрирования
  modal.style.display = 'flex';
  title.textContent = `📊 ${matchData.team1} vs ${matchData.team2}`;
  content.innerHTML = '<div class="empty-message">⏳ Загрузка статистики...</div>';
  
  // Загружаем словарь игроков для текущего турнира
  if (currentLiveEventId) {
    try {
      const events = await fetch('/api/events').then(r => r.json());
      const event = events.find(e => e.id === currentLiveEventId);
      if (event && event.icon) {
        // Определяем код турнира по иконке (аналогично как в server.js)
        const tournamentCode = determineTournamentCode(event.icon);
        await loadPlayerNamesDict(tournamentCode);
      }
    } catch (err) {
      console.warn('⚠️ Не удалось загрузить словарь игроков:', err);
    }
  }
  
  // Уведомляем админа об открытии статистики
  if (currentUser && currentUser.username && currentLiveEventId) {
    fetch('/api/events')
      .then(res => res.json())
      .then(events => {
        const event = events.find(e => e.id === currentLiveEventId);
        const isLive = matchData.status === 'live' || matchData.status === 'in_progress';
        const isFinished = matchData.status === 'finished' || matchData.status === 'completed';
        const statusText = isLive ? '🔴 LIVE' : isFinished ? '✅ Завершен' : 'Предстоящий';
        
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
    // Если есть matchId - загружаем детальную статистику из SStats
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
        console.warn('⚠️ Не удалось загрузить детали:', {
          status: detailsResponse.status,
          statusText: detailsResponse.statusText,
          matchId: matchData.id
        });
      }
    } else {
      console.log('ℹ️ У матча нет SStats ID (sstats_match_id), показываем базовую статистику');
      console.log('💡 Подсказка: Запустите скрипт update-sstats-ids.cjs для обновления ID матчей');
    }
    
    // Fallback: показываем базовую статистику
    displayBasicStats(matchData);
    
  } catch (error) {
    console.error('Ошибка загрузки статистики:', error);
    displayBasicStats(matchData);
  }
}

function displayBasicStats(matchData) {
  const content = document.getElementById('liveTeamStatsContent');
  
  const isLive = matchData.status === 'live' || matchData.status === 'in_progress';
  const isFinished = matchData.status === 'finished' || matchData.status === 'completed';
  const statusText = isLive ? '🔴 LIVE' : isFinished ? '✅ Завершен' : 'Предстоящий';
  
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
          🕐 ${new Date(matchData.match_time).toLocaleString('ru-RU', { 
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
        <p>📅 Матч еще не начался</p>
        <p style="font-size: 0.9em; color: #b0b8c8; margin-top: 10px;">Статистика появится после начала матча</p>
      </div>
    `;
  } else if (!matchData.id) {
    // Если нет SStats ID - показываем сообщение об этом
    html += `
      <div class="empty-message">
        <p>📊 Детальная статистика недоступна</p>
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
        <p>📊 Детальная статистика</p>
        <p style="font-size: 0.9em; color: #b0b8c8; margin-top: 10px;">
          ${isLive ? 'Матч идет в данный момент' : 'Матч завершен'}
        </p>
      </div>
    `;
  }
  
  content.innerHTML = html;
}

async function displayDetailedStats(details, matchData) {
  const content = document.getElementById('liveTeamStatsContent');
  const game = details.game;
  const stats = details.statistics;
  const events = details.events || [];
  const lineupPlayers = details.lineupPlayers || [];
  
  // Логируем статус для отладки
  console.log('🔍 Статус матча:', {
    status: game.status,
    statusName: game.statusName,
    elapsed: game.elapsed,
    homeResult: game.homeResult,
    awayResult: game.awayResult
  });
  
  // Более гибкая проверка статуса
  const isLive = game.statusName === 'Live' || 
                 game.status === 4 || 
                 game.status === 3 || // In Play
                 (game.elapsed && game.elapsed > 0) ||
                 (game.statusName && game.statusName.toLowerCase().includes('live'));
                 
  const isFinished = game.statusName === 'Finished' || 
                     [7, 8, 9, 10].includes(game.status) || // 7=Full Time, 8=Finished, 9=After ET, 10=After Penalties
                     (game.statusName && (game.statusName.toLowerCase().includes('finished') || game.statusName.toLowerCase().includes('ft')));
                     
  const hasStarted = isLive || isFinished || (game.homeResult !== null && game.homeResult !== undefined);
  
  console.log('📊 Определение статуса:', { isLive, isFinished, hasStarted });
  
  const statusText = isLive ? '🔴 LIVE' : isFinished ? '✅ Завершен' : '📅 Предстоящий';
  
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
          🕐 ${new Date(game.date).toLocaleString('ru-RU', { 
            day: '2-digit', 
            month: 'long', 
            hour: '2-digit', 
            minute: '2-digit' 
          })}
        </div>
      ` : ''}
    </div>
  `;
  
  // Если матч не начался - показываем сообщение
  if (!hasStarted) {
    html += `
      <div class="empty-message">
        <p>📅 Матч еще не начался</p>
        <p style="font-size: 0.9em; color: #b0b8c8; margin-top: 10px;">Статистика появится после начала матча</p>
      </div>
    `;
    content.innerHTML = html;
    return;
  }
  
  // Вкладки
  html += `
    <div style="display: flex; gap: 10px; margin-bottom: 15px; border-bottom: 2px solid rgba(255, 255, 255, 0.1);">
      <button onclick="switchLiveStatsTab('statistics')" id="liveStatsTab-statistics" style="flex: 1; padding: 10px; background: rgba(90, 159, 212, 0.3); border: none; border-bottom: 3px solid #5a9fd4; color: #e0e6f0; cursor: pointer; font-size: 0.9em; transition: all 0.3s;">
        📈 Статистика
      </button>
      <button onclick="switchLiveStatsTab('lineups')" id="liveStatsTab-lineups" style="flex: 1; padding: 10px; background: transparent; border: none; border-bottom: 3px solid transparent; color: #b0b8c8; cursor: pointer; font-size: 0.9em; transition: all 0.3s;">
        👥 Составы
      </button>
      <button onclick="switchLiveStatsTab('events')" id="liveStatsTab-events" style="flex: 1; padding: 10px; background: transparent; border: none; border-bottom: 3px solid transparent; color: #b0b8c8; cursor: pointer; font-size: 0.9em; transition: all 0.3s;">
        ⚽ События
      </button>
    </div>
    <div id="liveStatsTabContent"></div>
  `;
  
  content.innerHTML = html;
  
  // Сохраняем данные для переключения вкладок
  window.currentLiveStatsData = { details, matchData, stats, events, lineupPlayers, game };
  
  // Загружаем сохраненные имена игроков (используем ID из БД, а не из SStats)
  await loadSavedEventPlayers(matchData.id);
  
  // Показываем статистику по умолчанию
  switchLiveStatsTab('statistics');
}

function switchLiveStatsTab(tab) {
  const data = window.currentLiveStatsData;
  if (!data) return;
  
  // Обновляем стили кнопок
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

function renderStatistics(stats) {
  if (!stats) {
    return `
      <div class="empty-message">
        <p>📊 Статистика пока недоступна</p>
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

function renderLineups(lineupPlayers, game) {
  if (!lineupPlayers || lineupPlayers.length === 0) {
    return `
      <div class="empty-message">
        <p>👥 Составы пока недоступны</p>
        <p style="font-size: 0.9em; color: #b0b8c8; margin-top: 10px;">Данные появятся перед началом матча</p>
      </div>
    `;
  }
  
  const homePlayers = lineupPlayers.filter(p => p.teamId === game.homeTeam.id);
  const awayPlayers = lineupPlayers.filter(p => p.teamId === game.awayTeam.id);
  
  let html = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
  `;
  
  // Домашняя команда
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
  
  html += `
      </div>
    </div>
  `;
  
  // Гостевая команда
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
  
  html += `
      </div>
    </div>
  `;
  
  html += `</div>`;
  
  return html;
}

function renderEvents(events, game) {
  if (!events || events.length === 0) {
    return `
      <div class="empty-message">
        <p>⚽ События пока отсутствуют</p>
        <p style="font-size: 0.9em; color: #b0b8c8; margin-top: 10px;">События появятся в ходе матча</p>
      </div>
    `;
  }
  
  // Типы событий: 1 = гол, 2 = желтая карточка, 3 = замена, 4 = красная карточка
  const eventIcons = {
    1: '⚽',
    2: '🟨',
    3: '🔄',
    4: '🟥'
  };
  
  const eventNames = {
    1: 'Гол',
    2: 'Желтая карточка',
    3: 'Замена',
    4: 'Красная карточка'
  };
  
  // Разделяем события по командам
  const homeEvents = events.filter(e => e.teamId === game.homeTeam.id).sort((a, b) => (a.elapsed || 0) - (b.elapsed || 0));
  const awayEvents = events.filter(e => e.teamId === game.awayTeam.id).sort((a, b) => (a.elapsed || 0) - (b.elapsed || 0));
  
  // Функция для рендеринга событий команды
  const renderTeamEvents = (teamEvents, isHome) => {
    if (teamEvents.length === 0) {
      return `
        <div style="text-align: center; padding: 20px; color: #888; font-size: 0.9em;">
          Нет событий
        </div>
      `;
    }
    
    let html = '';
    teamEvents.forEach(event => {
      const icon = eventIcons[event.type] || '📌';
      const eventName = eventNames[event.type] || event.name;
      const isGoal = event.type === 1;
      const isYellowCard = event.type === 2;
      const isRedCard = event.type === 4;
      const isSubstitution = event.type === 3;
      
      // Переводим имена игроков
      // Если имя игрока не указано, пытаемся найти его по ID в списке игроков
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
      
      // Проверяем есть ли сохраненное имя игрока в БД
      if (window.savedEventPlayers && window.savedEventPlayers[event.id]) {
        playerName = window.savedEventPlayers[event.id].player_name;
      } else if (playerName === 'N/A' && (isGoal || isYellowCard || isRedCard)) {
        isPlayerNameMissing = true;
      }
      
      const assistName = event.assistPlayer ? translatePlayerName(event.assistPlayer.name) : null;
      
      // Определяем цвет фона и границы в зависимости от типа события
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
          <div style="font-size: 1.1em;">
            ${icon}
          </div>
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
  
  let html = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
      <!-- Домашняя команда -->
      <div style="background: rgba(90, 159, 212, 0.05); padding: 15px; border-radius: 8px;">
        <h4 style="color: #5a9fd4; margin: 0 0 15px 0; font-size: 0.95em; text-align: center;">
          ${game.homeTeam.name}
        </h4>
        ${renderTeamEvents(homeEvents, true)}
      </div>
      
      <!-- Гостевая команда -->
      <div style="background: rgba(244, 67, 54, 0.05); padding: 15px; border-radius: 8px;">
        <h4 style="color: #f44336; margin: 0 0 15px 0; font-size: 0.95em; text-align: center;">
          ${game.awayTeam.name}
        </h4>
        ${renderTeamEvents(awayEvents, false)}
      </div>
    </div>
  `;
  
  return html;
}

function closeLiveTeamStatsModal() {
  const modal = document.getElementById('liveTeamStatsModal');
  modal.style.display = 'none';
}

// ============================================
// УПРАВЛЕНИЕ АВТОПОДСЧЕТОМ
// ============================================

/**
 * Переключить автоподсчет (включить/выключить)
 */
async function toggleAutoCounting() {
  if (!currentUser || !currentUser.isAdmin) {
    alert('Недостаточно прав');
    return;
  }
  
  try {
    // Получаем текущий статус
    const statusResponse = await fetch('/api/admin/auto-counting-status');
    const statusData = await statusResponse.json();
    const currentStatus = statusData.enabled;
    
    // Переключаем
    const response = await fetch('/api/admin/toggle-auto-counting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username })
    });
    
    if (response.ok) {
      const data = await response.json();
      const newStatus = data.enabled;
      
      // Обновляем кнопку
      const btn = document.getElementById('autoCountingBtn');
      if (btn) {
        btn.style.borderColor = newStatus ? '#4caf50' : '#f44336';
        btn.style.color = newStatus ? '#4caf50' : '#f44336';
        btn.title = `Автоподсчет: ${newStatus ? 'включен' : 'выключен'}`;
      }
      
      await showCustomAlert(
        data.message,
        newStatus ? '✅ Включено' : '⏸️ Выключено',
        newStatus ? '✅' : '⏸️'
      );
    } else {
      const error = await response.json();
      await showCustomAlert(error.error || 'Ошибка переключения', 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка переключения автоподсчета:', error);
    await showCustomAlert('Ошибка переключения автоподсчета', 'Ошибка', '❌');
  }
}

/**
 * Загрузить статус автоподсчета при загрузке страницы
 */
async function loadAutoCountingStatus() {
  if (!currentUser || !currentUser.isAdmin) {
    return;
  }
  
  try {
    const response = await fetch('/api/admin/auto-counting-status');
    const data = await response.json();
    
    const btn = document.getElementById('autoCountingBtn');
    if (btn) {
      btn.style.borderColor = data.enabled ? '#4caf50' : '#f44336';
      btn.style.color = data.enabled ? '#4caf50' : '#f44336';
      btn.title = `Автоподсчет: ${data.enabled ? 'включен' : 'выключен'}`;
    }
  } catch (error) {
    console.error('Ошибка загрузки статуса автоподсчета:', error);
  }
}

// ============================================
// МОДАЛКА ТЕСТОВ
// ============================================

/**
 * Открыть модалку тестов
 */
async function openTestsModal() {
  const modal = document.getElementById('testsModal');
  if (modal) {
    modal.style.display = 'flex';
    
    // Загружаем настройку из localStorage
    const testRealGroup = localStorage.getItem('testRealGroup') === 'true';
    const checkbox = document.getElementById('testRealGroupCheckbox');
    if (checkbox) {
      checkbox.checked = testRealGroup;
    }
    
    // Загружаем список турниров
    try {
      const response = await fetch('/api/events');
      const events = await response.json();
      
      const select = document.getElementById('testEventSelect');
      if (select) {
        select.innerHTML = '<option value="">Выберите турнир...</option>';
        
        events.forEach(event => {
          const option = document.createElement('option');
          option.value = event.id;
          option.textContent = event.name;
          select.appendChild(option);
        });
        
        // Если есть выбранный турнир, выбираем его (проверяем что переменная определена)
        if (typeof selectedEventId !== 'undefined' && selectedEventId) {
          select.value = selectedEventId;
        }
      }
    } catch (error) {
      console.error('Ошибка загрузки турниров:', error);
    }
  }
}

/**
 * Закрыть модалку тестов
 */
function closeTestsModal() {
  const modal = document.getElementById('testsModal');
  if (modal) {
    modal.style.display = 'none';
    
    // Сохраняем настройку в localStorage
    const checkbox = document.getElementById('testRealGroupCheckbox');
    if (checkbox) {
      localStorage.setItem('testRealGroup', checkbox.checked);
    }
  }
}

/**
 * Тест автоподсчета
 */
async function testAutoCounting() {
  if (!currentUser || !currentUser.isAdmin) {
    await showCustomAlert('Недостаточно прав', 'Ошибка', '❌');
    return;
  }
  
  // Берем турнир из селекта в модалке
  const select = document.getElementById('testEventSelect');
  const eventId = select ? parseInt(select.value) : null;
  
  if (!eventId) {
    await showCustomAlert('Выберите турнир из списка', 'Ошибка', '❌');
    return;
  }
  
  const testRealGroup = document.getElementById('testRealGroupCheckbox')?.checked || false;
  
  const confirmed = await showCustomConfirm(
    `Запустить тест автоподсчета для выбранного турнира?\n\n` +
    `Режим: ${testRealGroup ? '📢 Отправка в реальную группу' : '👤 Только админу'}\n\n` +
    `Это симулирует завершение всех матчей и запустит автоподсчет.`,
    'Подтверждение',
    '🧪'
  );
  
  if (!confirmed) return;
  
  try {
    const response = await fetch('/api/admin/test-auto-counting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        eventId: eventId,
        testMode: !testRealGroup
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      await showCustomAlert(
        data.message || 'Тест автоподсчета запущен',
        'Успешно',
        '✅'
      );
      
      // Закрываем модалку
      closeTestsModal();
      
      // Если это текущий турнир, перезагружаем матчи (проверяем что переменная определена)
      if (typeof selectedEventId !== 'undefined' && selectedEventId === eventId) {
        setTimeout(() => {
          loadMatches(eventId);
        }, 2000);
      }
    } else {
      const error = await response.json();
      await showCustomAlert(error.error || 'Ошибка теста', 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка теста автоподсчета:', error);
    await showCustomAlert('Ошибка теста автоподсчета', 'Ошибка', '❌');
  }
}


// ===== ПРОВЕРКА СОБЫТИЙ МАТЧЕЙ ДЛЯ УВЕДОМЛЕНИЙ В TELEGRAM =====
async function checkMatchEventsForNotifications(matchIds, userId) {
  try {
    console.log(`📬 Проверка событий для ${matchIds.length} матчей`);
    
    const response = await fetch('/api/check-match-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        matchIds: matchIds,
        userId: userId
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      if (result.notifications > 0) {
        console.log(`✅ Отправлено ${result.notifications} уведомлений в Telegram`);
      }
    }
  } catch (error) {
    console.error('❌ Ошибка проверки событий:', error);
  }
}


// ===== ОЧИСТКА СТАРЫХ ИЗБРАННЫХ МАТЧЕЙ =====
function cleanupOldFavorites() {
  const favorites = getFavoriteMatches();
  if (favorites.length === 0) return;
  
  console.log(`🧹 Проверка ${favorites.length} избранных матчей на актуальность...`);
  
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 часа назад
  
  let cleaned = 0;
  const updatedFavorites = favorites.filter(matchId => {
    const matchData = getFavoriteMatchData(matchId);
    
    // Если нет данных - удаляем
    if (!matchData) {
      console.log(`🗑️ Удаляем матч ${matchId} - нет данных`);
      removeFavoriteMatchData(matchId);
      cleaned++;
      return false;
    }
    
    // Если матч завершен - удаляем
    const isFinished = matchData.status === 'Finished' || 
                      matchData.status === 'finished' || 
                      matchData.status === 'Full Time' || 
                      matchData.status === 'FT' ||
                      matchData.status === 'Completed' ||
                      matchData.status === 'completed' ||
                      matchData.status === 'FINISHED' ||
                      matchData.status === 'COMPLETED';
    
    if (isFinished) {
      console.log(`🗑️ Удаляем матч ${matchId} - завершен`);
      removeFavoriteMatchData(matchId);
      cleaned++;
      return false;
    }
    
    // Если данные старше 24 часов - удаляем
    const timestamp = matchData.updatedAt || matchData.addedAt;
    if (timestamp) {
      const updatedAt = new Date(timestamp);
      if (updatedAt < oneDayAgo) {
        console.log(`🗑️ Удаляем матч ${matchId} - данные старше 24 часов`);
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
    console.log(`✅ Все избранные матчи актуальны`);
  }
}


// ===== УТИЛИТЫ АДМИН-ПАНЕЛИ =====

// Запустить утилитный скрипт
async function runUtilityScript(scriptName) {
  // Опасные операции требуют подтверждения
  const dangerousScripts = {
    'clear-processed-dates': {
      title: 'Очистка обработанных дат',
      message: 'Вы уверены что хотите очистить все обработанные даты?\n\nЭто позволит автоподсчету запуститься повторно для уже подсчитанных дат.',
      icon: '⚠️'
    }
  };
  
  // Если это опасная операция - запрашиваем подтверждение
  if (dangerousScripts[scriptName]) {
    const config = dangerousScripts[scriptName];
    const confirmed = await showCustomConfirm(config.message, config.title, config.icon);
    
    if (!confirmed) {
      return; // Пользователь отменил
    }
  }
  
  try {
    const response = await fetch(`/api/admin/run-utility`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        script: scriptName,
        username: currentUser?.username
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success) {
      // Форматируем вывод для читаемости
      const formattedOutput = formatUtilityOutput(data.output);
      await showCustomAlert(formattedOutput, data.title, "✅");
    } else {
      await showCustomAlert(`${data.error}`, "Ошибка", "❌");
    }
  } catch (error) {
    console.error('Ошибка запуска утилиты:', error);
    await showCustomAlert(`${error.message}`, "Ошибка запуска утилиты", "❌");
  }
}

// Форматировать вывод утилит для читаемости
function formatUtilityOutput(text) {
  if (!text) return '';
  
  // Заменяем переносы строк на <br>
  let formatted = text.replace(/\n/g, '<br>');
  
  // Добавляем отступы для строк начинающихся с пробелов
  formatted = formatted.replace(/^(\s+)/gm, (match) => {
    return '&nbsp;'.repeat(match.length);
  });
  
  return formatted;
}

// Открыть модальное окно управления датами
async function openDatesManagementModal() {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 700px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">📅 Управление датами автоподсчета</h3>
      
      <div id="datesContentContainer" style="
        margin-bottom: 20px;
        padding: 15px;
        background: #2a3a4a;
        border-radius: 8px;
        max-height: 50vh;
        overflow-y: auto;
        font-family: 'Courier New', monospace;
        line-height: 1.6;
        color: #e0e6f0;
      ">
        <div style="color: #999; text-align: center; padding: 10px;">Загрузка...</div>
      </div>
      
      <div style="display: flex; gap: 10px; margin-bottom: 15px;">
        <button onclick="loadDatesData('processed')" style="
          flex: 1;
          background: #2196f3;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">📋 Обработанные даты</button>
        <button onclick="loadDatesData('matches')" style="
          flex: 1;
          background: #673ab7;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">📅 Даты матчей</button>
      </div>
      
      <div style="display: flex; gap: 10px;">
        <button onclick="clearProcessedDates()" style="
          flex: 1;
          background: #f44336;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">🗑️ Очистить даты</button>
        <button onclick="this.closest('div[style*=fixed]').remove()" style="
          flex: 1;
          background: #607d8b;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Закрыть</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Загружаем обработанные даты по умолчанию
  loadDatesData('processed');
}

// Загрузить данные о датах
async function loadDatesData(type) {
  const container = document.getElementById('datesContentContainer');
  if (!container) return;
  
  container.innerHTML = '<div style="color: #999; text-align: center; padding: 10px;">Загрузка...</div>';
  
  const scriptName = type === 'processed' ? 'check-processed-dates' : 'check-match-dates';
  
  try {
    const response = await fetch(`/api/admin/run-utility`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        script: scriptName,
        username: currentUser?.username
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success) {
      const formatted = formatUtilityOutput(data.output);
      container.innerHTML = formatted;
    } else {
      container.innerHTML = `<div style="color: #f44336;">${data.error}</div>`;
    }
  } catch (error) {
    console.error('Ошибка загрузки данных:', error);
    container.innerHTML = `<div style="color: #f44336;">Ошибка загрузки: ${error.message}</div>`;
  }
}

// Очистить обработанные даты
async function clearProcessedDates() {
  try {
    // Получаем список обработанных дат
    const response = await fetch('/api/admin/processed-dates');
    if (!response.ok) {
      throw new Error('Не удалось загрузить список дат');
    }
    
    const data = await response.json();
    const dates = data.dates || [];
    
    if (dates.length === 0) {
      await showCustomAlert('Нет обработанных дат для очистки', 'Информация', 'ℹ️');
      return;
    }
    
    // Создаем модальное окно с выбором дат
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
      background: #1e1e1e;
      padding: 30px;
      border-radius: 12px;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    `;
    
    content.innerHTML = `
      <h2 style="margin: 0 0 20px 0; color: #fff;">🧹 Очистка обработанных дат</h2>
      <p style="color: #b0b8c8; margin-bottom: 20px;">
        Выберите даты которые нужно очистить. Автоподсчет пересчитает их при следующей проверке (каждые 5 минут).
      </p>
      
      <div style="margin-bottom: 20px;">
        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; background: rgba(90, 159, 212, 0.1); border-radius: 6px; cursor: pointer; margin-bottom: 10px;">
          <input type="checkbox" id="selectAll" style="width: 18px; height: 18px; cursor: pointer;">
          <span style="color: #5a9fd4; font-weight: bold;">Выбрать все (${dates.length})</span>
        </label>
      </div>
      
      <div id="datesList" style="max-height: 400px; overflow-y: auto; margin-bottom: 20px;">
        ${dates.map((d, index) => `
          <label style="display: flex; align-items: center; gap: 10px; padding: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 6px; cursor: pointer; margin-bottom: 8px;">
            <input type="checkbox" class="date-checkbox" value="${d.date_key}" style="width: 18px; height: 18px; cursor: pointer;">
            <div style="flex: 1;">
              <div style="color: #fff; font-weight: 500;">${d.date_key}</div>
              <div style="color: #888; font-size: 0.85em;">Обработано: ${new Date(d.processed_at).toLocaleString('ru-RU')}</div>
            </div>
          </label>
        `).join('')}
      </div>
      
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button id="cancelBtn" style="
          padding: 12px 24px;
          background: #444;
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1em;
        ">Отмена</button>
        
        <button id="clearAllBtn" style="
          padding: 12px 24px;
          background: #f44336;
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1em;
        ">Очистить все</button>
        
        <button id="clearSelectedBtn" style="
          padding: 12px 24px;
          background: #5a9fd4;
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1em;
        ">Очистить выбранные</button>
      </div>
    `;
    
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // Обработчик "Выбрать все"
    const selectAllCheckbox = content.querySelector('#selectAll');
    const dateCheckboxes = content.querySelectorAll('.date-checkbox');
    
    selectAllCheckbox.addEventListener('change', (e) => {
      dateCheckboxes.forEach(cb => cb.checked = e.target.checked);
    });
    
    // Обновляем "Выбрать все" при изменении отдельных чекбоксов
    dateCheckboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        const allChecked = Array.from(dateCheckboxes).every(c => c.checked);
        const someChecked = Array.from(dateCheckboxes).some(c => c.checked);
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = someChecked && !allChecked;
      });
    });
    
    // Закрытие модального окна
    const closeModal = () => {
      document.body.removeChild(modal);
    };
    
    content.querySelector('#cancelBtn').addEventListener('click', closeModal);
    
    // Очистить все
    content.querySelector('#clearAllBtn').addEventListener('click', async () => {
      const confirmed = await showCustomConfirm(
        'Вы уверены что хотите очистить ВСЕ обработанные даты?\n\nЭто позволит автоподсчету запуститься повторно для всех дат.',
        'Очистка всех дат',
        '⚠️'
      );
      
      if (!confirmed) return;
      
      try {
        const response = await fetch('/api/admin/clear-processed-dates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            username: currentUser?.username,
            dateKeys: [] // Пустой массив = очистить все
          })
        });
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const result = await response.json();
        
        if (result.success) {
          await showCustomAlert(result.message, 'Успех', '✅');
          closeModal();
          loadDatesData('processed');
        } else {
          await showCustomAlert(result.error, 'Ошибка', '❌');
        }
      } catch (error) {
        console.error('Ошибка:', error);
        await showCustomAlert('Ошибка при очистке дат', 'Ошибка', '❌');
      }
    });
    
    // Очистить выбранные
    content.querySelector('#clearSelectedBtn').addEventListener('click', async () => {
      const selectedDates = Array.from(dateCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      
      if (selectedDates.length === 0) {
        await showCustomAlert('Выберите хотя бы одну дату', 'Внимание', '⚠️');
        return;
      }
      
      const confirmed = await showCustomConfirm(
        `Вы уверены что хотите очистить ${selectedDates.length} дат?\n\nАвтоподсчет пересчитает их при следующей проверке.`,
        'Очистка выбранных дат',
        '⚠️'
      );
      
      if (!confirmed) return;
      
      try {
        const response = await fetch('/api/admin/clear-processed-dates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            username: currentUser?.username,
            dateKeys: selectedDates
          })
        });
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const result = await response.json();
        
        if (result.success) {
          await showCustomAlert(result.message, 'Успех', '✅');
          closeModal();
          loadDatesData('processed');
        } else {
          await showCustomAlert(result.error, 'Ошибка', '❌');
        }
      } catch (error) {
        console.error('Ошибка:', error);
        await showCustomAlert('Ошибка при очистке дат', 'Ошибка', '❌');
      }
    });
    
  } catch (error) {
    console.error('Ошибка:', error);
    await showCustomAlert('Ошибка при загрузке списка дат', 'Ошибка', '❌');
  }
}

// Открыть модальное окно сравнения участников
async function openComparisonModal() {
  if (!window.currentEventId) {
    await showCustomAlert('Ошибка: турнир не выбран', 'Ошибка', '❌');
    return;
  }

  // Блокируем body
  document.body.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  // Закрытие по клику вне модалки
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      document.body.style.overflow = '';
    }
  });
  
  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">⚖️ Сравнение участников</h3>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; color: #e0e6f0; margin-bottom: 8px;">Первый участник:</label>
        <select id="compareUser1" style="
          width: 100%;
          padding: 12px;
          border: 1px solid #3a7bd5;
          border-radius: 8px;
          background: #2a3a4a;
          color: #e0e6f0;
          font-size: 16px;
        ">
          <option value="">Выберите участника...</option>
        </select>
      </div>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; color: #e0e6f0; margin-bottom: 8px;">Второй участник:</label>
        <select id="compareUser2" style="
          width: 100%;
          padding: 12px;
          border: 1px solid #3a7bd5;
          border-radius: 8px;
          background: #2a3a4a;
          color: #e0e6f0;
          font-size: 16px;
        ">
          <option value="">Выберите участника...</option>
        </select>
      </div>
      
      <div style="display: flex; gap: 10px;">
        <button onclick="showComparison()" style="
          flex: 1;
          background: #4caf50;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Сравнить</button>
        <button onclick="this.closest('div[style*=fixed]').remove(); document.body.style.overflow = '';" style="
          flex: 1;
          background: #f44336;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Отмена</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Загружаем список участников
  try {
    const response = await fetch(`/api/events/${window.currentEventId}/tournament-participants`);
    const participants = await response.json();
    
    const select1 = document.getElementById('compareUser1');
    const select2 = document.getElementById('compareUser2');
    
    participants.forEach(p => {
      const option1 = document.createElement('option');
      option1.value = p.id;
      option1.textContent = `${p.username} (${p.event_won || 0} очков)`;
      select1.appendChild(option1);
      
      const option2 = document.createElement('option');
      option2.value = p.id;
      option2.textContent = `${p.username} (${p.event_won || 0} очков)`;
      select2.appendChild(option2);
    });
  } catch (error) {
    console.error('Ошибка загрузки участников:', error);
  }
}

// Показать сравнение двух участников
async function showComparison() {
  const user1Id = document.getElementById('compareUser1').value;
  const user2Id = document.getElementById('compareUser2').value;
  
  if (!user1Id || !user2Id) {
    await showCustomAlert('Выберите обоих участников', 'Ошибка', '❌');
    return;
  }
  
  if (user1Id === user2Id) {
    await showCustomAlert('Выберите разных участников', 'Ошибка', '❌');
    return;
  }
  
  // Закрываем модалку выбора
  document.querySelector('div[style*="z-index: 10000"]').remove();
  
  // Загружаем данные для сравнения
  try {
    const [bets1Response, bets2Response] = await Promise.all([
      fetch(`/api/events/${window.currentEventId}/user-bets/${user1Id}`),
      fetch(`/api/events/${window.currentEventId}/user-bets/${user2Id}`)
    ]);
    
    const bets1 = await bets1Response.json();
    const bets2 = await bets2Response.json();
    
    // Отправляем уведомление админу
    try {
      await fetch('/api/notify-comparison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewerUsername: currentUser?.username || 'Неизвестный',
          user1Username: bets1.user.username,
          user2Username: bets2.user.username,
          eventName: window.currentEventName || null
        })
      });
    } catch (notifyError) {
      console.error('Ошибка отправки уведомления:', notifyError);
    }
    
    displayComparisonModal(bets1, bets2);
  } catch (error) {
    console.error('Ошибка загрузки данных:', error);
    await showCustomAlert('Ошибка загрузки данных для сравнения', 'Ошибка', '❌');
  }
}

// Отобразить модалку сравнения
function displayComparisonModal(data1, data2) {
  // Блокируем body
  document.body.style.overflow = 'hidden';
  
  const modal = document.createElement('div');
  modal.className = 'comparison-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  // Закрытие по клику вне модалки
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeComparisonModal();
    }
  });
  
  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 900px;
      width: 95%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      position: relative;
    ">
      <button class="modal-close" onclick="closeComparisonModal()" style="
        position: absolute;
        top: 15px;
        right: 15px;
        background: transparent;
        border: none;
        color: #e0e6f0;
        font-size: 24px;
        cursor: pointer;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background 0.2s;
      " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">×</button>
      
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4; padding-right: 30px;">⚖️ ${data1.user.username} vs ${data2.user.username}</h3>
      
      <div style="display: flex; gap: 10px; margin-bottom: 20px;">
        <button onclick="switchComparisonTab('bets')" id="comparisonTabBets" style="
          flex: 1;
          background: #2196f3;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Ставки</button>
        <button onclick="switchComparisonTab('stats')" id="comparisonTabStats" style="
          flex: 1;
          background: #607d8b;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Статистика</button>
      </div>
      
      <div id="comparisonContent"></div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Сохраняем данные для переключения вкладок
  window.comparisonData = { data1, data2 };
  
  // Показываем вкладку ставок по умолчанию
  switchComparisonTab('bets');
}

// Закрыть модалку сравнения
function closeComparisonModal() {
  const modal = document.querySelector('.comparison-modal');
  if (modal) {
    modal.remove();
  }
  // Разблокируем body
  document.body.style.overflow = '';
}

// Переключить вкладку сравнения
function switchComparisonTab(tab) {
  const { data1, data2 } = window.comparisonData;
  
  // Обновляем стили кнопок
  document.getElementById('comparisonTabBets').style.background = tab === 'bets' ? '#2196f3' : '#607d8b';
  document.getElementById('comparisonTabStats').style.background = tab === 'stats' ? '#2196f3' : '#607d8b';
  
  const content = document.getElementById('comparisonContent');
  
  if (tab === 'bets') {
    const selectedRound = window.comparisonSelectedRound || 'all';
    content.innerHTML = generateBetsComparison(data1, data2, selectedRound);
  } else {
    content.innerHTML = generateStatsComparison(data1, data2);
  }
}

// Генерировать сравнение ставок
function generateBetsComparison(data1, data2, selectedRound = 'all') {
  const bets1Map = new Map(data1.bets.map(b => [b.match_id, b]));
  const bets2Map = new Map(data2.bets.map(b => [b.match_id, b]));
  
  // Функция для форматирования прогноза
  const formatPrediction = (prediction, match) => {
    if (!prediction) return '❌ Нет ставки';
    if (prediction === 'team1') return match?.team1_name || 'Команда 1';
    if (prediction === 'team2') return match?.team2_name || 'Команда 2';
    if (prediction === 'draw') return 'Ничья';
    return prediction;
  };
  
  // Находим различия
  const differences = [];
  const allMatchIds = new Set([...bets1Map.keys(), ...bets2Map.keys()]);
  
  allMatchIds.forEach(matchId => {
    const bet1 = bets1Map.get(matchId);
    const bet2 = bets2Map.get(matchId);
    
    if (!bet1 || !bet2 || bet1.prediction !== bet2.prediction) {
      differences.push({
        match: bet1?.match || bet2?.match,
        round: bet1?.round || bet2?.round,
        bet1: bet1,
        bet2: bet2
      });
    }
  });
  
  // Получаем уникальные туры только из различий
  const rounds = [...new Set(differences.map(d => d.round).filter(r => r))].sort();
  
  // Фильтруем по выбранному туру
  const filteredDifferences = selectedRound === 'all' 
    ? differences 
    : differences.filter(d => d.round === selectedRound);
  
  if (differences.length === 0) {
    return '<div style="color: #4caf50; text-align: center; padding: 20px;">✅ Все ставки одинаковые</div>';
  }
  
  return `
    <div style="color: #e0e6f0;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
        <h4 style="color: #ff9800; margin: 0;">⚠️ Различия в ставках (${filteredDifferences.length})</h4>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button onclick="filterComparisonByRound('all')" style="
            background: ${selectedRound === 'all' ? '#2196f3' : '#607d8b'};
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9em;
          ">Все туры</button>
          ${rounds.map(round => {
            const escapedRound = round.replace(/'/g, "\\'");
            return `
            <button onclick="filterComparisonByRound('${escapedRound}')" style="
              background: ${selectedRound === round ? '#2196f3' : '#607d8b'};
              color: white;
              border: none;
              padding: 8px 16px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 0.9em;
            ">${round}</button>
          `;
          }).join('')}
        </div>
      </div>
      ${filteredDifferences.map(diff => `
        <div style="
          background: #2a3a4a;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 10px;
        ">
          <div style="font-weight: bold; margin-bottom: 10px;">
            ${diff.round ? `<span style="color: #999; font-size: 0.85em;">${diff.round}</span><br/>` : ''}
            ${diff.match?.team1_name || 'Матч'} vs ${diff.match?.team2_name || ''}
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div style="background: #1e2a3a; padding: 10px; border-radius: 6px;">
              <div style="color: #5a9fd4; font-size: 0.9em; margin-bottom: 5px;">${data1.user.username}</div>
              <div>${formatPrediction(diff.bet1?.prediction, diff.match)}</div>
              ${diff.bet1 ? `<div style="color: ${diff.bet1.is_won ? '#4caf50' : diff.bet1.is_lost ? '#f44336' : '#999'}; font-size: 0.85em; margin-top: 5px;">
                ${diff.bet1.is_won ? '✅ Выиграл' : diff.bet1.is_lost ? '❌ Проиграл' : '⏳ Ожидание'}
              </div>` : ''}
            </div>
            <div style="background: #1e2a3a; padding: 10px; border-radius: 6px;">
              <div style="color: #5a9fd4; font-size: 0.9em; margin-bottom: 5px;">${data2.user.username}</div>
              <div>${formatPrediction(diff.bet2?.prediction, diff.match)}</div>
              ${diff.bet2 ? `<div style="color: ${diff.bet2.is_won ? '#4caf50' : diff.bet2.is_lost ? '#f44336' : '#999'}; font-size: 0.85em; margin-top: 5px;">
                ${diff.bet2.is_won ? '✅ Выиграл' : diff.bet2.is_lost ? '❌ Проиграл' : '⏳ Ожидание'}
              </div>` : ''}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// Фильтровать сравнение по туру
function filterComparisonByRound(round) {
  const { data1, data2 } = window.comparisonData;
  window.comparisonSelectedRound = round;
  const content = document.getElementById('comparisonContent');
  content.innerHTML = generateBetsComparison(data1, data2, round);
}

// Генерировать сравнение статистики
function generateStatsComparison(data1, data2) {
  const stats = [
    { label: 'Очки', key: 'event_won', better: 'higher' },
    { label: 'Всего ставок', key: 'event_bets', better: 'higher' },
    { label: 'Выиграно', key: 'event_won_count', better: 'higher' },
    { label: 'Проиграно', key: 'event_lost', better: 'lower' },
    { label: 'Ожидание', key: 'event_pending', better: 'none' }
  ];
  
  return `
    <div style="color: #e0e6f0;">
      <h4 style="color: #5a9fd4; margin-bottom: 15px;">📊 Статистика турнира</h4>
      <div style="background: #2a3a4a; padding: 15px; border-radius: 8px;">
        ${stats.map(stat => {
          const val1 = data1.stats[stat.key] || 0;
          const val2 = data2.stats[stat.key] || 0;
          const isDiff = val1 !== val2;
          const winner = stat.better === 'higher' ? (val1 > val2 ? 1 : val1 < val2 ? 2 : 0) :
                        stat.better === 'lower' ? (val1 < val2 ? 1 : val1 > val2 ? 2 : 0) : 0;
          
          return `
            <div style="
              display: grid;
              grid-template-columns: 1fr auto auto;
              gap: 15px;
              padding: 10px 0;
              border-bottom: 1px solid #1e2a3a;
              align-items: center;
            ">
              <div style="font-weight: ${isDiff ? 'bold' : 'normal'}; color: ${isDiff ? '#ff9800' : '#e0e6f0'};">
                ${stat.label}
              </div>
              <div style="
                text-align: center;
                padding: 5px 15px;
                background: ${winner === 1 ? '#4caf50' : '#1e2a3a'};
                border-radius: 6px;
                font-weight: ${winner === 1 ? 'bold' : 'normal'};
                min-width: 60px;
              ">
                ${val1}
              </div>
              <div style="
                text-align: center;
                padding: 5px 15px;
                background: ${winner === 2 ? '#4caf50' : '#1e2a3a'};
                border-radius: 6px;
                font-weight: ${winner === 2 ? 'bold' : 'normal'};
                min-width: 60px;
              ">
                ${val2}
              </div>
            </div>
          `;
        }).join('')}
        
        <div style="
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 15px;
          padding-top: 10px;
          align-items: center;
          font-size: 0.9em;
          color: #999;
        ">
          <div></div>
          <div style="text-align: center; min-width: 60px;">${data1.user.username}</div>
          <div style="text-align: center; min-width: 60px;">${data2.user.username}</div>
        </div>
      </div>
    </div>
  `;
}

// Открыть модальное окно информации о турнире
async function openTournamentInfoModal() {
  // Отправляем уведомление админу
  try {
    await fetch('/api/notify-tournament-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser?.username || 'Неизвестный',
        eventName: window.currentEventName || null
      })
    });
  } catch (notifyError) {
    console.error('Ошибка отправки уведомления:', notifyError);
  }

  // Блокируем body
  document.body.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  // Закрытие по клику вне модалки
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      document.body.style.overflow = '';
    }
  });
  
  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 700px;
      width: 95%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      position: relative;
      color: #e0e6f0;
    ">
      <button onclick="this.closest('div[style*=fixed]').remove(); document.body.style.overflow = '';" style="
        position: absolute;
        top: 15px;
        right: 15px;
        background: transparent;
        border: none;
        color: #e0e6f0;
        font-size: 24px;
        cursor: pointer;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background 0.2s;
      " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">×</button>
      
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">ℹ️ Информация о турнире</h3>
      
      <div style="line-height: 1.6;">
        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">🎯 Система начисления очков</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <div style="margin-bottom: 10px;">
            <strong style="color: #4caf50;">Обычные матчи:</strong>
            <ul style="margin: 5px 0; padding-left: 20px;">
              <li><strong>1 очко</strong> — за угаданный результат (победа команды 1, победа команды 2 или ничья)</li>
              <li><strong>+1 очко</strong> — дополнительно за точный счет (если угадан результат)</li>
            </ul>
          </div>
          <div style="margin-bottom: 10px;">
            <strong style="color: #4caf50;">Финальные матчи:</strong>
            <ul style="margin: 5px 0; padding-left: 20px;">
              <li><strong>3 очка</strong> — за угаданный результат</li>
              <li><strong>+1 очко</strong> — дополнительно за точный счет</li>
            </ul>
          </div>
          <div>
            <strong style="color: #4caf50;">Финальные параметры:</strong>
            <ul style="margin: 5px 0; padding-left: 20px;">
              <li><strong>1 очко</strong> — за каждый угаданный параметр (желтые карточки, красные карточки, угловые, точный счет, пенальти в игре, дополнительное время, серия пенальти)</li>
            </ul>
          </div>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">📊 Сортировка участников</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <p style="margin: 0 0 10px 0;">Участники сортируются по следующим критериям (в порядке приоритета):</p>
          <ol style="margin: 5px 0; padding-left: 20px;">
            <li><strong>Больше очков</strong> — чем больше очков набрано, тем выше место</li>
            <li><strong>Больше выигранных ставок</strong> — при равных очках учитывается количество угаданных результатов</li>
            <li><strong>Меньше проигранных ставок</strong> — при равных очках и выигрышах учитывается количество проигранных ставок</li>
            <li><strong>Больше всего ставок</strong> — при полностью одинаковых показателях учитывается общее количество сделанных ставок</li>
          </ol>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">🏆 Одинаковые показатели</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <p style="margin: 0 0 10px 0;">Если у нескольких участников <strong>полностью одинаковые</strong> показатели по всем критериям:</p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li>Все участники получают <strong>одинаковое место</strong></li>
            <li>Следующее место рассчитывается с учетом количества участников на предыдущем месте</li>
            <li><strong>Пример:</strong> если два участника на 1-м месте, следующий будет на 2-м месте (не на 3-м)</li>
          </ul>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">📈 Отображение статистики</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px;">
          <p style="margin: 0;">В карточке каждого участника отображается:</p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li><strong>Место</strong> — позиция в рейтинге турнира</li>
            <li><strong>Очки</strong> — общее количество набранных очков</li>
            <li><strong>Всего ставок</strong> — количество сделанных ставок</li>
            <li><strong>Выиграно</strong> — количество угаданных результатов</li>
            <li><strong>Проиграно</strong> — количество неугаданных результатов</li>
            <li><strong>Ожидание</strong> — количество ставок, результаты которых еще не известны</li>
          </ul>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

// Открыть модальное окно сравнения участников (глобальное)
async function openGlobalComparisonModal() {
  // Блокируем body
  document.body.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  // Закрытие по клику вне модалки
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      document.body.style.overflow = '';
    }
  });
  
  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">⚖️ Сравнение участников</h3>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; color: #e0e6f0; margin-bottom: 8px;">Первый участник:</label>
        <select id="globalCompareUser1" style="
          width: 100%;
          padding: 12px;
          border: 1px solid #3a7bd5;
          border-radius: 8px;
          background: #2a3a4a;
          color: #e0e6f0;
          font-size: 16px;
        ">
          <option value="">Выберите участника...</option>
        </select>
      </div>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; color: #e0e6f0; margin-bottom: 8px;">Второй участник:</label>
        <select id="globalCompareUser2" style="
          width: 100%;
          padding: 12px;
          border: 1px solid #3a7bd5;
          border-radius: 8px;
          background: #2a3a4a;
          color: #e0e6f0;
          font-size: 16px;
        ">
          <option value="">Выберите участника...</option>
        </select>
      </div>
      
      <div style="display: flex; gap: 10px;">
        <button onclick="showGlobalComparison()" style="
          flex: 1;
          background: #4caf50;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Сравнить</button>
        <button onclick="this.closest('div[style*=fixed]').remove(); document.body.style.overflow = '';" style="
          flex: 1;
          background: #f44336;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Отмена</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Загружаем список всех участников
  try {
    const response = await fetch('/api/participants');
    const participants = await response.json();
    
    const select1 = document.getElementById('globalCompareUser1');
    const select2 = document.getElementById('globalCompareUser2');
    
    participants.forEach(p => {
      const option1 = document.createElement('option');
      option1.value = p.id;
      option1.textContent = p.username;
      select1.appendChild(option1);
      
      const option2 = document.createElement('option');
      option2.value = p.id;
      option2.textContent = p.username;
      select2.appendChild(option2);
    });
  } catch (error) {
    console.error('Ошибка загрузки участников:', error);
  }
}

// Показать глобальное сравнение
async function showGlobalComparison() {
  const user1Id = document.getElementById('globalCompareUser1').value;
  const user2Id = document.getElementById('globalCompareUser2').value;
  
  if (!user1Id || !user2Id) {
    await showCustomAlert('Выберите обоих участников', 'Ошибка', '❌');
    return;
  }
  
  if (user1Id === user2Id) {
    await showCustomAlert('Выберите разных участников', 'Ошибка', '❌');
    return;
  }
  
  // Закрываем модалку выбора
  document.querySelector('div[style*="z-index: 10000"]').remove();
  
  // Загружаем глобальную статистику
  try {
    const [stats1Response, stats2Response] = await Promise.all([
      fetch(`/api/users/${user1Id}/global-stats`),
      fetch(`/api/users/${user2Id}/global-stats`)
    ]);
    
    const stats1 = await stats1Response.json();
    const stats2 = await stats2Response.json();
    
    // Отправляем уведомление админу
    try {
      await fetch('/api/notify-comparison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewerUsername: currentUser?.username || 'Неизвестный',
          user1Username: stats1.user.username,
          user2Username: stats2.user.username,
          eventName: null
        })
      });
    } catch (notifyError) {
      console.error('Ошибка отправки уведомления:', notifyError);
    }
    
    displayGlobalComparisonModal(stats1, stats2);
  } catch (error) {
    console.error('Ошибка загрузки данных:', error);
    await showCustomAlert('Ошибка загрузки данных для сравнения', 'Ошибка', '❌');
  }
}

// Отобразить модалку глобального сравнения
function displayGlobalComparisonModal(data1, data2) {
  // Блокируем body
  document.body.style.overflow = 'hidden';
  
  const modal = document.createElement('div');
  modal.className = 'comparison-modal global-comparison-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  // Закрытие по клику вне модалки
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeGlobalComparisonModal();
    }
  });
  
  const stats = [
    { label: 'Всего очков', key: 'won_bets', better: 'higher' },
    { label: 'Побед в турнирах', key: 'tournament_wins', better: 'higher' },
    { label: 'Точность угадывания', key: 'win_accuracy', better: 'higher', suffix: '%' },
    { label: 'Турниров', key: 'tournaments_count', better: 'higher' },
    { label: 'Всего ставок', key: 'total_bets', better: 'higher' },
    { label: 'Выиграно ставок', key: 'won_count', better: 'higher' },
    { label: 'Проиграно ставок', key: 'lost_bets', better: 'lower' },
    { label: 'Ожидание', key: 'pending_bets', better: 'none' },
    { label: 'Плей-офф угадано', key: 'bracket_correct', better: 'higher' },
    { label: 'Плей-офф не угадано', key: 'bracket_incorrect', better: 'lower' }
  ];
  
  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 700px;
      width: 95%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      position: relative;
    ">
      <button class="modal-close" onclick="closeGlobalComparisonModal()" style="
        position: absolute;
        top: 15px;
        right: 15px;
        background: transparent;
        border: none;
        color: #e0e6f0;
        font-size: 24px;
        cursor: pointer;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background 0.2s;
      " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">×</button>
      
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4; padding-right: 30px;">⚖️ ${data1.user.username} vs ${data2.user.username}</h3>
      
      <div style="color: #e0e6f0;">
        <h4 style="color: #5a9fd4; margin-bottom: 15px;">📊 Статистика профиля</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px;">
          ${stats.map(stat => {
            const val1 = data1.stats[stat.key] || 0;
            const val2 = data2.stats[stat.key] || 0;
            const isDiff = val1 !== val2;
            const winner = stat.better === 'higher' ? (val1 > val2 ? 1 : val1 < val2 ? 2 : 0) :
                          stat.better === 'lower' ? (val1 < val2 ? 1 : val1 > val2 ? 2 : 0) : 0;
            
            return `
              <div style="
                display: grid;
                grid-template-columns: 1fr auto auto;
                gap: 15px;
                padding: 10px 0;
                border-bottom: 1px solid #1e2a3a;
                align-items: center;
              ">
                <div style="font-weight: ${isDiff ? 'bold' : 'normal'}; color: ${isDiff ? '#ff9800' : '#e0e6f0'};">
                  ${stat.label}
                </div>
                <div style="
                  text-align: center;
                  padding: 5px 15px;
                  background: ${winner === 1 ? '#4caf50' : '#1e2a3a'};
                  border-radius: 6px;
                  font-weight: ${winner === 1 ? 'bold' : 'normal'};
                  min-width: 60px;
                ">
                  ${val1}${stat.suffix || ''}
                </div>
                <div style="
                  text-align: center;
                  padding: 5px 15px;
                  background: ${winner === 2 ? '#4caf50' : '#1e2a3a'};
                  border-radius: 6px;
                  font-weight: ${winner === 2 ? 'bold' : 'normal'};
                  min-width: 60px;
                ">
                  ${val2}${stat.suffix || ''}
                </div>
              </div>
            `;
          }).join('')}
          
          <div style="
            display: grid;
            grid-template-columns: 1fr auto auto;
            gap: 15px;
            padding-top: 10px;
            align-items: center;
            font-size: 0.9em;
            color: #999;
          ">
            <div></div>
            <div style="text-align: center; min-width: 60px;">${data1.user.username}</div>
            <div style="text-align: center; min-width: 60px;">${data2.user.username}</div>
          </div>
        </div>
        
        ${data1.awards.length > 0 || data2.awards.length > 0 ? `
          <h4 style="color: #5a9fd4; margin: 20px 0 15px 0;">🏆 Награды</h4>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
            <div style="background: #2a3a4a; padding: 15px; border-radius: 8px;">
              <div style="color: #5a9fd4; font-weight: bold; margin-bottom: 10px;">${data1.user.username}</div>
              ${data1.awards.length > 0 ? data1.awards.map(award => `
                <div style="
                  background: #1e2a3a;
                  padding: 10px;
                  border-radius: 6px;
                  margin-bottom: 8px;
                  display: flex;
                  align-items: center;
                  gap: 10px;
                ">
                  ${award.event_icon ? (award.event_icon.startsWith('img/') || award.event_icon.startsWith('/img/') ? 
                    `<img src="${award.event_icon.startsWith('/') ? award.event_icon : '/' + award.event_icon}" style="width: 30px; height: 30px; object-fit: contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';" /><span style="display: none; font-size: 1.5em;">🏆</span>` : 
                    `<span style="font-size: 1.5em;">${award.event_icon}</span>`) : '🏆'}
                  <div style="flex: 1;">
                    <div style="font-weight: bold; font-size: 0.9em;">${award.event_name}</div>
                    <div style="color: #999; font-size: 0.85em;">${award.won_bets} очков</div>
                  </div>
                </div>
              `).join('') : '<div style="color: #999; text-align: center; padding: 20px;">Нет наград</div>'}
            </div>
            <div style="background: #2a3a4a; padding: 15px; border-radius: 8px;">
              <div style="color: #5a9fd4; font-weight: bold; margin-bottom: 10px;">${data2.user.username}</div>
              ${data2.awards.length > 0 ? data2.awards.map(award => `
                <div style="
                  background: #1e2a3a;
                  padding: 10px;
                  border-radius: 6px;
                  margin-bottom: 8px;
                  display: flex;
                  align-items: center;
                  gap: 10px;
                ">
                  ${award.event_icon ? (award.event_icon.startsWith('img/') || award.event_icon.startsWith('/img/') ? 
                    `<img src="${award.event_icon.startsWith('/') ? award.event_icon : '/' + award.event_icon}" style="width: 30px; height: 30px; object-fit: contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';" /><span style="display: none; font-size: 1.5em;">🏆</span>` : 
                    `<span style="font-size: 1.5em;">${award.event_icon}</span>`) : '🏆'}
                  <div style="flex: 1;">
                    <div style="font-weight: bold; font-size: 0.9em;">${award.event_name}</div>
                    <div style="color: #999; font-size: 0.85em;">${award.won_bets} очков</div>
                  </div>
                </div>
              `).join('') : '<div style="color: #999; text-align: center; padding: 20px;">Нет наград</div>'}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

// Закрыть модалку глобального сравнения
function closeGlobalComparisonModal() {
  const modal = document.querySelector('.global-comparison-modal');
  if (modal) {
    modal.remove();
    document.body.style.overflow = '';
  }
}

// Открыть модальное окно управления уведомлениями
async function openNotificationsModal() {
  // Загружаем список пользователей
  let usersListHTML = '<div style="color: #999; text-align: center; padding: 10px;">Загрузка...</div>';
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">🔔 Управление уведомлениями</h3>
      
      <div id="usersListContainer" style="
        margin-bottom: 20px;
        padding: 15px;
        background: #2a3a4a;
        border-radius: 8px;
        max-height: 400px;
        overflow-y: auto;
      ">
        ${usersListHTML}
      </div>
      
      <div style="display: flex; gap: 10px;">
        <button onclick="enableNotificationsForAll()" style="
          flex: 1;
          background: #4caf50;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">✅ Включить для всех</button>
        <button onclick="this.closest('div[style*=fixed]').remove()" style="
          flex: 1;
          background: #f44336;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Закрыть</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Загружаем пользователей
  try {
    const response = await fetch('/api/users');
    if (response.ok) {
      const users = await response.json();
      
      usersListHTML = users.map(user => {
        const notifStatus = user.telegram_notifications_enabled ? '✅ Вкл' : '❌ Выкл';
        const telegramStatus = user.telegram_username ? `@${user.telegram_username}` : '❌ Нет TG';
        
        return `
          <div style="
            padding: 12px;
            margin-bottom: 8px;
            background: #1e2a3a;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.2s;
          " 
          onmouseover="this.style.background='#2a3a4a'"
          onmouseout="this.style.background='#1e2a3a'"
          onclick="showUserDetails(${user.id}, '${user.username.replace(/'/g, "\\'")}', '${user.telegram_username || ''}', ${user.telegram_notifications_enabled})">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="color: #e0e6f0; font-weight: bold; margin-bottom: 4px;">
                  ${user.username}
                </div>
                <div style="color: #999; font-size: 0.85em;">
                  ${telegramStatus}
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="color: #5a9fd4; font-weight: bold;">ID: ${user.id}</span>
                <span style="font-size: 0.9em;">${notifStatus}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
      
      if (users.length === 0) {
        usersListHTML = '<div style="color: #999; text-align: center; padding: 10px;">Нет пользователей</div>';
      }
      
      document.getElementById('usersListContainer').innerHTML = usersListHTML;
    }
  } catch (error) {
    console.error('Ошибка загрузки пользователей:', error);
    document.getElementById('usersListContainer').innerHTML = 
      '<div style="color: #f44336; text-align: center; padding: 10px;">Ошибка загрузки</div>';
  }
}

// Показать детали пользователя
async function showUserDetails(userId, username, telegramUsername, notificationsEnabled) {
  // Загружаем детальную информацию о пользователе
  try {
    const response = await fetch(`/api/admin/user-details/${userId}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    const telegramInfo = data.telegramUser 
      ? `<div style="color: #4caf50; margin-top: 10px;">
           📱 <strong>Telegram привязка:</strong><br/>
           Chat ID: ${data.telegramUser.chat_id}<br/>
           Имя: ${data.telegramUser.first_name}
         </div>`
      : `<div style="color: #ff9800; margin-top: 10px;">
           ⚠️ Нет записи в telegram_users
         </div>`;
    
    const notifStatusText = notificationsEnabled ? '✅ Включены' : '❌ Отключены';
    
    const detailsModal = document.createElement('div');
    detailsModal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10001;
    `;
    
    detailsModal.innerHTML = `
      <div style="
        background: #1e2a3a;
        padding: 30px;
        border-radius: 12px;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      ">
        <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">👤 ${username}</h3>
        
        <div style="
          padding: 15px;
          background: #2a3a4a;
          border-radius: 8px;
          margin-bottom: 20px;
          color: #e0e6f0;
          line-height: 1.8;
        ">
          <div><strong>ID:</strong> ${userId}</div>
          <div><strong>Username:</strong> ${username}</div>
          <div><strong>Telegram:</strong> ${telegramUsername || 'не привязан'}</div>
          <div><strong>Уведомления:</strong> ${notifStatusText}</div>
          ${telegramInfo}
        </div>
        
        <div style="display: flex; gap: 10px;">
          ${!notificationsEnabled ? `
            <button onclick="toggleUserNotifications(${userId}, true)" style="
              flex: 1;
              background: #4caf50;
              color: white;
              border: none;
              padding: 12px;
              border-radius: 8px;
              cursor: pointer;
              font-size: 16px;
            ">✅ Включить уведомления</button>
          ` : `
            <button onclick="toggleUserNotifications(${userId}, false)" style="
              flex: 1;
              background: #ff9800;
              color: white;
              border: none;
              padding: 12px;
              border-radius: 8px;
              cursor: pointer;
              font-size: 16px;
            ">❌ Отключить уведомления</button>
          `}
          <button onclick="this.closest('div[style*=fixed]').remove()" style="
            flex: 1;
            background: #f44336;
            color: white;
            border: none;
            padding: 12px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
          ">Закрыть</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(detailsModal);
  } catch (error) {
    console.error('Ошибка загрузки деталей пользователя:', error);
    await showCustomAlert('Ошибка загрузки деталей пользователя', 'Ошибка', '❌');
  }
}

// Переключить уведомления для пользователя
async function toggleUserNotifications(userId, enable) {
  try {
    const response = await fetch(`/api/admin/run-utility`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        script: 'enable-notifications',
        username: currentUser?.username,
        args: [userId, enable ? '1' : '0']
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success) {
      // Закрываем оба модальных окна
      const modals = document.querySelectorAll('div[style*="z-index: 10001"], div[style*="z-index: 10000"]');
      modals.forEach(m => m.remove());
      // Открываем заново главное окно
      openNotificationsModal();
    } else {
      await showCustomAlert(`${data.error}`, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await showCustomAlert('Ошибка при изменении настроек', 'Ошибка', '❌');
  }
}

// Включить уведомления для всех пользователей
async function enableNotificationsForAll() {
  const confirmed = await showCustomConfirm(
    'Включить уведомления для всех пользователей с привязанным Telegram?',
    'Подтверждение',
    '🔔'
  );
  
  if (!confirmed) return;
  
  try {
    const response = await fetch(`/api/admin/run-utility`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        script: 'enable-notifications-for-all',
        username: currentUser?.username,
        args: []
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success) {
      await showCustomAlert(`${data.output}`, data.title, '✅');
      // Закрываем модальное окно
      document.querySelector('div[style*="z-index: 10000"]').remove();
      // Открываем заново
      openNotificationsModal();
    } else {
      await showCustomAlert(`${data.error}`, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await showCustomAlert('Ошибка при включении уведомлений', 'Ошибка', '❌');
  }
}

// Открыть модальное окно для обновления SStats ID
async function openUpdateSstatsModal() {
  let eventsListHTML = '<div style="color: #999; text-align: center; padding: 10px;">Загрузка...</div>';
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">🔄 Обновить SStats ID</h3>
      
      <div id="eventsListForSstats" style="
        margin-bottom: 20px;
        padding: 15px;
        background: #2a3a4a;
        border-radius: 8px;
        max-height: 300px;
        overflow-y: auto;
      ">
        ${eventsListHTML}
      </div>
      
      <input 
        type="number" 
        id="eventIdInput" 
        placeholder="ID турнира" 
        style="
          width: 100%;
          padding: 12px;
          border: 1px solid #3a7bd5;
          border-radius: 8px;
          background: #2a3a4a;
          color: #e0e6f0;
          font-size: 16px;
          margin-bottom: 20px;
        "
      />
      <div style="display: flex; gap: 10px;">
        <button onclick="updateSstatsIds()" style="
          flex: 1;
          background: #e91e63;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Обновить</button>
        <button onclick="this.closest('div[style*=fixed]').remove()" style="
          flex: 1;
          background: #f44336;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Отмена</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Загружаем список турниров
  try {
    const response = await fetch('/api/admin/all-events');
    if (response.ok) {
      const events = await response.json();
      
      if (events.length === 0) {
        eventsListHTML = '<div style="color: #999; text-align: center; padding: 10px;">Нет турниров</div>';
      } else {
        // Сортируем: активные сверху, потом по дате начала
        events.sort((a, b) => {
          if (a.status === 'active' && b.status !== 'active') return -1;
          if (a.status !== 'active' && b.status === 'active') return 1;
          return new Date(b.start_date) - new Date(a.start_date);
        });
        
        eventsListHTML = events.map(event => {
          const startDate = event.start_date ? new Date(event.start_date).toLocaleDateString('ru-RU') : 'Не указана';
          const statusBadge = event.status === 'active' 
            ? '<span style="color: #4caf50;">●</span>' 
            : '<span style="color: #999;">○</span>';
          
          return `
            <div style="
              padding: 8px 12px;
              margin-bottom: 8px;
              background: #1e2a3a;
              border-radius: 6px;
              cursor: pointer;
              transition: background 0.2s;
            " 
            onmouseover="this.style.background='#2a3a4a'"
            onmouseout="this.style.background='#1e2a3a'"
            onclick="document.getElementById('eventIdInput').value='${event.id}'">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="color: #e0e6f0; font-weight: bold; margin-bottom: 4px;">
                    ${statusBadge} ${event.name}
                  </div>
                  <div style="color: #999; font-size: 0.85em;">
                    Начало: ${startDate}
                  </div>
                </div>
                <div style="color: #5a9fd4; font-weight: bold;">
                  ID: ${event.id}
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
      
      document.getElementById('eventsListForSstats').innerHTML = eventsListHTML;
    }
  } catch (error) {
    console.error('Ошибка загрузки турниров:', error);
    document.getElementById('eventsListForSstats').innerHTML = 
      '<div style="color: #f44336; text-align: center; padding: 10px;">Ошибка загрузки</div>';
  }
  
  document.getElementById('eventIdInput').focus();
}

// Обновить SStats ID для турнира
async function updateSstatsIds() {
  const eventId = document.getElementById('eventIdInput').value;
  
  if (!eventId) {
    await showCustomAlert('Введите ID турнира', 'Ошибка', '❌');
    return;
  }
  
  try {
    const response = await fetch(`/api/admin/run-utility`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        script: 'update-sstats-ids',
        username: currentUser?.username,
        args: [eventId]
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success) {
      await showCustomAlert(`${data.output}`, data.title, '✅');
      document.querySelector('div[style*=fixed]').remove();
    } else {
      await showCustomAlert(`${data.error}`, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await showCustomAlert(`${error.message}`, 'Ошибка', '❌');
  }
}


// Открыть модальное окно для деактивации турниров
async function openDeactivateEventsModal() {
  // Загружаем список активных турниров
  let eventsListHTML = '<div style="color: #999; text-align: center; padding: 10px;">Загрузка...</div>';
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">🔒 Деактивировать турниры</h3>
      
      <div style="
        margin-bottom: 20px;
        padding: 15px;
        background: rgba(255, 152, 0, 0.2);
        border-left: 4px solid #ff9800;
        border-radius: 4px;
        color: #ffe0b2;
      ">
        ⚠️ Выберите турниры для деактивации. Их статус будет изменен на "completed".
      </div>
      
      <div id="eventsListContainer" style="
        margin-bottom: 20px;
        padding: 15px;
        background: #2a3a4a;
        border-radius: 8px;
        max-height: 400px;
        overflow-y: auto;
      ">
        ${eventsListHTML}
      </div>
      
      <div style="display: flex; gap: 10px;">
        <button onclick="deactivateSelectedEvents()" style="
          flex: 1;
          background: #ff9800;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Деактивировать выбранные</button>
        <button onclick="this.closest('div[style*=fixed]').remove()" style="
          flex: 1;
          background: #f44336;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Отмена</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Загружаем турниры
  try {
    const response = await fetch('/api/admin/all-events');
    if (response.ok) {
      const events = await response.json();
      
      // Фильтруем только активные турниры
      const activeEvents = events.filter(e => e.status === 'active');
      
      if (activeEvents.length === 0) {
        eventsListHTML = '<div style="color: #999; text-align: center; padding: 10px;">Нет активных турниров</div>';
      } else {
        eventsListHTML = activeEvents.map(event => {
          const startDate = event.start_date ? new Date(event.start_date).toLocaleDateString('ru-RU') : 'Не указана';
          
          return `
            <label style="
              display: flex;
              align-items: center;
              padding: 12px;
              margin-bottom: 8px;
              background: #1e2a3a;
              border-radius: 6px;
              cursor: pointer;
              transition: background 0.2s;
            " 
            onmouseover="this.style.background='#2a3a4a'"
            onmouseout="this.style.background='#1e2a3a'">
              <input 
                type="checkbox" 
                class="event-checkbox" 
                data-event-id="${event.id}"
                style="
                  width: 20px;
                  height: 20px;
                  margin-right: 15px;
                  cursor: pointer;
                "
              />
              <div style="flex: 1;">
                <div style="color: #e0e6f0; font-weight: bold; margin-bottom: 4px;">
                  ${event.name}
                </div>
                <div style="color: #999; font-size: 0.85em;">
                  ID: ${event.id} | Начало: ${startDate}
                </div>
              </div>
            </label>
          `;
        }).join('');
      }
      
      document.getElementById('eventsListContainer').innerHTML = eventsListHTML;
    }
  } catch (error) {
    console.error('Ошибка загрузки турниров:', error);
    document.getElementById('eventsListContainer').innerHTML = 
      '<div style="color: #f44336; text-align: center; padding: 10px;">Ошибка загрузки</div>';
  }
}

// Деактивировать выбранные турниры
async function deactivateSelectedEvents() {
  const checkboxes = document.querySelectorAll('.event-checkbox:checked');
  
  if (checkboxes.length === 0) {
    await showCustomAlert('Выберите хотя бы один турнир', 'Ошибка', '❌');
    return;
  }
  
  const eventIds = Array.from(checkboxes).map(cb => cb.dataset.eventId);
  
  const confirmed = await showCustomConfirm(
    `Вы уверены что хотите деактивировать ${eventIds.length} турнир(ов)?\n\nИх статус будет изменен на "completed".`,
    'Подтверждение деактивации',
    '⚠️'
  );
  
  if (!confirmed) {
    return;
  }
  
  try {
    const response = await fetch('/api/admin/deactivate-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        eventIds: eventIds,
        username: currentUser?.username
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success) {
      await showCustomAlert(
        `Деактивировано турниров: ${data.deactivated}\n\n${data.events.map(e => `✓ ${e.name}`).join('\n')}`,
        'Турниры деактивированы',
        '✅'
      );
      document.querySelector('div[style*=fixed]').remove();
      
      // Перезагружаем список событий если он открыт
      if (typeof loadEvents === 'function') {
        loadEvents();
      }
    } else {
      await showCustomAlert(`${data.error}`, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await showCustomAlert(`${error.message}`, 'Ошибка', '❌');
  }
}


// ===== RSS НОВОСТИ =====

let currentRssTournament = 'all';

// Открыть модалку RSS новостей
async function openRssNewsModal() {
  const modal = document.getElementById("rssNewsModal");
  if (modal) {
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";
    
    // Отправляем уведомление админу о просмотре RSS новостей
    if (currentUser && currentUser.username) {
      fetch("/api/notify-news-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: currentUser.username,
          type: 'rss'
        })
      }).catch(err => {
        console.error("⚠️ Ошибка отправки уведомления:", err);
      });
    }
    
    // Загружаем новости
    await loadRssNews('all');
  }
}

// Закрыть модалку RSS новостей
function closeRssNewsModal() {
  const modal = document.getElementById("rssNewsModal");
  if (modal) {
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// Загрузить RSS новости
async function loadRssNews(tournament) {
  currentRssTournament = tournament;
  const container = document.getElementById("rssNewsContainer");
  
  if (!container) return;
  
  // Показываем загрузку
  container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;"><div class="spinner"></div><p>Загрузка новостей...</p></div>';
  
  try {
    const response = await fetch(`/api/rss-news?tournament=${tournament}`);
    
    if (!response.ok) {
      throw new Error("Ошибка загрузки RSS новостей");
    }
    
    const data = await response.json();
    const news = data.news;
    
    if (!news || news.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;">📰 Новостей не найдено</div>';
      return;
    }
    
    // Формируем HTML с новостями
    let html = '';
    
    news.forEach((item) => {
      // Форматируем дату
      const newsDate = new Date(item.pubDate);
      const formattedDate = newsDate.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
      
      // Обрезаем описание до 200 символов
      let description = item.description || '';
      if (description.length > 200) {
        description = description.substring(0, 200) + '...';
      }
      
      html += `
        <div class="rss-news-item">
          <div>
            <a href="${item.link}" target="_blank" rel="noopener noreferrer">
              ${item.title}
            </a>
            <span class="rss-news-source">${item.source}</span>
          </div>
          ${description ? `<div class="rss-news-description">${description}</div>` : ''}
          <div class="rss-news-date">📅 ${formattedDate}</div>
        </div>
      `;
    });
    
    container.innerHTML = html;
    
    // Показываем информацию о кэше
    if (data.cached) {
      console.log("📰 RSS новости загружены из кэша");
    } else {
      console.log(`📰 Загружено ${news.length} свежих RSS новостей`);
    }
    
  } catch (error) {
    console.error("❌ Ошибка загрузки RSS новостей:", error);
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: #f44336;">❌ Ошибка загрузки новостей</div>';
  }
}

// Фильтр RSS новостей по турниру
async function filterRssNews(tournament) {
  currentRssTournament = tournament;
  
  // Обновляем активную кнопку фильтра
  document.querySelectorAll('.rss-filter-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.tournament === tournament) {
      btn.classList.add('active');
    }
  });
  
  // Загружаем новости
  await loadRssNews(tournament);
}


// ============================================
// УПРАВЛЕНИЕ КЛЮЧЕВЫМИ СЛОВАМИ RSS
// ============================================

let allRssKeywords = [];

// Открыть модалку управления ключевыми словами
async function openRssKeywordsModal() {
  const modal = document.getElementById("rssKeywordsModal");
  if (modal) {
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";
    
    // Загружаем ключевые слова
    await loadRssKeywords();
  }
}

// Закрыть модалку управления ключевыми словами
function closeRssKeywordsModal() {
  const modal = document.getElementById("rssKeywordsModal");
  if (modal) {
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// Загрузить все ключевые слова
async function loadRssKeywords() {
  const container = document.getElementById("rssKeywordsList");
  
  if (!container) return;
  
  // Показываем загрузку
  container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;"><div class="spinner"></div><p>Загрузка ключевых слов...</p></div>';
  
  try {
    const response = await fetch("/api/rss-keywords");
    
    if (!response.ok) {
      throw new Error("Ошибка загрузки ключевых слов");
    }
    
    const data = await response.json();
    allRssKeywords = data.keywords;
    
    // Применяем фильтр
    filterKeywordsByTournament();
    
  } catch (error) {
    console.error("❌ Ошибка загрузки ключевых слов:", error);
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: #f44336;">❌ Ошибка загрузки ключевых слов</div>';
  }
}

// Фильтровать ключевые слова по турниру
function filterKeywordsByTournament() {
  const container = document.getElementById("rssKeywordsList");
  const filterSelect = document.getElementById("keywordsFilterTournament");
  
  if (!container || !filterSelect) return;
  
  const selectedTournament = filterSelect.value;
  
  // Фильтруем ключевые слова
  let filteredKeywords = allRssKeywords;
  if (selectedTournament !== 'all_view') {
    filteredKeywords = allRssKeywords.filter(kw => kw.tournament === selectedTournament);
  }
  
  if (filteredKeywords.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;">📝 Ключевых слов не найдено</div>';
    return;
  }
  
  // Группируем по турнирам
  const grouped = {};
  filteredKeywords.forEach(kw => {
    if (!grouped[kw.tournament]) {
      grouped[kw.tournament] = [];
    }
    grouped[kw.tournament].push(kw);
  });
  
  // Названия турниров
  const tournamentNames = {
    'all': '🌐 Глобальные (все турниры)',
    'ucl': '🏆 Лига чемпионов',
    'uel': '🥈 Лига Европы',
    'uecl': '🥉 Лига конференций',
    'supercup': '🏅 Суперкубок УЕФА',
    'worldcup': '🌍 Чемпионат мира',
    'euro': '🇪🇺 Евро',
    'epl': '🏴󠁧󠁢󠁥󠁮󠁧󠁿 АПЛ',
    'rpl': '🇷🇺 РПЛ',
    'seriea': '🇮🇹 Серия А',
    'bundesliga': '🇩🇪 Бундеслига',
    'ligue1': '🇫🇷 Лига 1'
  };
  
  // Формируем HTML
  let html = '';
  
  Object.keys(grouped).sort().forEach(tournament => {
    const keywords = grouped[tournament];
    const tournamentName = tournamentNames[tournament] || tournament;
    
    html += `
      <div style="
        background: rgba(30, 35, 45, 0.5);
        border: 1px solid rgba(90, 159, 212, 0.3);
        border-radius: 8px;
        padding: 15px;
      ">
        <h4 style="margin: 0 0 10px 0; color: #5a9fd4;">${tournamentName}</h4>
        <div style="display: flex; flex-direction: column; gap: 8px;">
    `;
    
    keywords.forEach(kw => {
      const typeEmoji = kw.type === 'include' ? '✅' : '❌';
      const typeColor = kw.type === 'include' ? '#4caf50' : '#f44336';
      
      html += `
        <div class="keyword-item" style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px;
          background: rgba(20, 25, 35, 0.5);
          border: 1px solid rgba(90, 159, 212, 0.2);
          border-radius: 4px;
        ">
          <div class="keyword-info" style="display: flex; align-items: center; gap: 10px; flex: 1;">
            <span style="font-size: 1.2em;">${typeEmoji}</span>
            <span style="color: #e0e6f0; font-size: 0.95em;">${kw.keyword}</span>
            <span style="
              padding: 2px 8px;
              background: ${typeColor}33;
              color: ${typeColor};
              border-radius: 4px;
              font-size: 0.85em;
            ">${kw.type === 'include' ? 'Включить' : 'Исключить'}</span>
            <span style="
              padding: 2px 8px;
              background: rgba(255, 152, 0, 0.2);
              color: #ff9800;
              border-radius: 4px;
              font-size: 0.85em;
            ">⭐ ${kw.priority}</span>
          </div>
          <button class="keyword-delete-btn" onclick="deleteRssKeyword(${kw.id})" style="
            padding: 6px 12px;
            background: rgba(244, 67, 54, 0.7);
            color: #ffb3b3;
            border: 1px solid #f44336;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.3s ease;
          ">
            🗑️ Удалить
          </button>
        </div>
      `;
    });
    
    html += `
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

// Добавить новое ключевое слово
async function addRssKeyword() {
  const tournament = document.getElementById("newKeywordTournament").value;
  const keyword = document.getElementById("newKeywordText").value.trim();
  const type = document.getElementById("newKeywordType").value;
  const priority = parseInt(document.getElementById("newKeywordPriority").value);
  
  if (!keyword) {
    await showCustomAlert("Введите ключевое слово");
    return;
  }
  
  if (!currentUser || !currentUser.username) {
    await showCustomAlert("Ошибка: пользователь не авторизован");
    return;
  }
  
  try {
    const response = await fetch("/api/admin/rss-keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentUser.username,
        tournament,
        keyword,
        type,
        priority
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || "Ошибка добавления ключевого слова");
    }
    
    // Очищаем форму
    document.getElementById("newKeywordText").value = "";
    document.getElementById("newKeywordPriority").value = "5";
    
    // Перезагружаем список
    await loadRssKeywords();
    
    await showCustomAlert("✅ Ключевое слово добавлено");
    
  } catch (error) {
    console.error("❌ Ошибка добавления ключевого слова:", error);
    await showCustomAlert(`❌ Ошибка: ${error.message}`);
  }
}

// Удалить ключевое слово
async function deleteRssKeyword(id) {
  const confirmed = await showCustomConfirm("Вы уверены, что хотите удалить это ключевое слово?");
  
  if (!confirmed) return;
  
  if (!currentUser || !currentUser.username) {
    await showCustomAlert("Ошибка: пользователь не авторизован");
    return;
  }
  
  try {
    const response = await fetch(`/api/admin/rss-keywords/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentUser.username
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || "Ошибка удаления ключевого слова");
    }
    
    // Перезагружаем список
    await loadRssKeywords();
    
    await showCustomAlert("✅ Ключевое слово удалено");
    
  } catch (error) {
    console.error("❌ Ошибка удаления ключевого слова:", error);
    await showCustomAlert(`❌ Ошибка: ${error.message}`);
  }
}


// ============================================
// АККОРДЕОН АДМИН-ПАНЕЛИ
// ============================================

// Загрузить конфигурацию админ-панели
async function loadAdminPanelConfig() {
  const container = document.getElementById('adminPanelAccordion');
  
  if (!container) return;
  
  try {
    const response = await fetch('/api/admin/panel-config');
    
    if (!response.ok) {
      throw new Error('Ошибка загрузки конфигурации');
    }
    
    const data = await response.json();
    renderAdminPanelAccordion(data.config);
    
  } catch (error) {
    console.error('❌ Ошибка загрузки конфигурации админ-панели:', error);
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #f44336;">❌ Ошибка загрузки админ-панели</div>';
  }
}

// Отрисовать аккордеон админ-панели
function renderAdminPanelAccordion(config) {
  const container = document.getElementById('adminPanelAccordion');
  
  if (!container || !config || !config.categories) return;
  
  let html = '';
  
  config.categories.forEach(category => {
    const isCollapsed = category.collapsed !== false;
    
    html += `
      <div class="admin-category" style="
        background: rgba(30, 35, 45, 0.5);
        border: 1px solid rgba(90, 159, 212, 0.3);
        border-radius: 8px;
        overflow: hidden;
      ">
        <div 
          class="admin-category-header" 
          onclick="toggleCategory('${category.id}')"
          style="
            padding: 5px 15px;
            background: rgba(90, 159, 212, 0.1);
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: background 0.3s ease;
          "
          onmouseover="this.style.background='rgba(90, 159, 212, 0.2)'"
          onmouseout="this.style.background='rgba(90, 159, 212, 0.1)'"
        >
          <span style="color: #5a9fd4; font-weight: 600; font-size: 1em;">
            ${category.name}
          </span>
          <span id="category-arrow-${category.id}" style="
            color: #5a9fd4;
            font-size: 1.2em;
            transition: transform 0.3s ease;
            ${isCollapsed ? '' : 'transform: rotate(180deg);'}
          ">▼</span>
        </div>
        
        <div 
          id="category-content-${category.id}" 
          class="admin-category-content"
          style="
            display: ${isCollapsed ? 'none' : 'flex'};
            flex-direction: row;
            flex-wrap: wrap;
            gap: 10px;
            padding: 15px;
          "
        >
          ${category.buttons.map(button => renderButton(button)).join('')}
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

// Отрисовать кнопку
function renderButton(button) {
  // Определяем цвет строго по типу кнопки
  let bgColor, borderColor, textColor;
  
  if (button.type === 'toggle') {
    // Зелёный для тоглов
    bgColor = 'rgba(76, 175, 80, 0.7)';
    borderColor = '#4caf50';
    textColor = '#c8e6c9';
  } else if (button.type === 'external') {
    // Серый для внешних ссылок
    bgColor = 'rgba(120, 120, 120, 0.7)';
    borderColor = '#888';
    textColor = '#e0e0e0';
  } else {
    // Синий для модалок (по умолчанию)
    bgColor = 'rgba(90, 159, 212, 0.7)';
    borderColor = '#3a7bd5';
    textColor = '#e0e6f0';
  }
  
  // Добавляем иконку справа в зависимости от типа
  let buttonText = button.text;
  if (button.type === 'toggle' && !buttonText.includes('🔀')) {
    buttonText = buttonText + ' 🔀';
  } else if (button.type === 'external' && !buttonText.includes('🔗')) {
    buttonText = buttonText + ' 🔗';
  }
  
  // Если это внешняя ссылка
  if (button.type === 'external') {
    return `
      <a
        href="#"
        onclick='${button.action}; return false;'
        style="
          display: flex;
          align-items: center;
          justify-content: center;
          background: ${bgColor};
          color: ${textColor};
          text-decoration: none;
          padding: 12px 20px;
          border-radius: 8px;
          font-size: 0.95em;
          transition: all 0.3s ease;
          border: 1px solid ${borderColor};
          white-space: nowrap;
        "
        onmouseover="this.style.transform='scale(1.05)'"
        onmouseout="this.style.transform='scale(1)'"
      >
        ${buttonText}
      </a>
    `;
  }
  
  // Обычная кнопка (модалка или тогл)
  return `
    <button
      onclick='${button.action}'
      style="
        background: ${bgColor};
        color: ${textColor};
        border: 1px solid ${borderColor};
        padding: 12px 20px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.95em;
        transition: all 0.3s ease;
        white-space: nowrap;
      "
      onmouseover="this.style.transform='scale(1.05)'"
      onmouseout="this.style.transform='scale(1)'"
    >
      ${buttonText}
    </button>
  `;
}

// Переключить категорию (свернуть/развернуть)
function toggleCategory(categoryId) {
  const content = document.getElementById(`category-content-${categoryId}`);
  const arrow = document.getElementById(`category-arrow-${categoryId}`);
  
  if (!content || !arrow) return;
  
  const isCollapsed = content.style.display === 'none';
  
  if (isCollapsed) {
    content.style.display = 'flex';
    arrow.style.transform = 'rotate(180deg)';
  } else {
    content.style.display = 'none';
    arrow.style.transform = 'rotate(0deg)';
  }
}

// Глобальная переменная для хранения текущей конфигурации в редакторе
let currentEditingConfig = null;

// Открыть модалку настройки категорий
async function openConfigureCategoriesModal() {
  // Загружаем текущую конфигурацию
  try {
    const response = await fetch('/api/admin/panel-config');
    if (!response.ok) throw new Error('Ошибка загрузки конфигурации');
    
    const data = await response.json();
    currentEditingConfig = JSON.parse(JSON.stringify(data.config)); // Глубокая копия
    
  } catch (error) {
    console.error('❌ Ошибка загрузки конфигурации:', error);
    await showCustomAlert('Ошибка загрузки конфигурации', 'Ошибка', '❌');
    return;
  }
  
  const modal = document.createElement('div');
  modal.id = 'configureCategoriesModal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 900px;
      width: 95%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">⚙️ Настройка категорий админ-панели</h3>
      
      <!-- Вкладки -->
      <div style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 2px solid rgba(255, 255, 255, 0.1);">
        <button onclick="switchConfigTab('categories')" id="configTab-categories" style="
          flex: 1;
          padding: 5px 15px;
          background: rgba(90, 159, 212, 0.3);
          border: none;
          border-bottom: 3px solid #5a9fd4;
          color: #e0e6f0;
          cursor: pointer;
          font-size: 0.95em;
          transition: all 0.3s;
        ">📁 Категории</button>
        <button onclick="switchConfigTab('buttons')" id="configTab-buttons" style="
          flex: 1;
          padding: 5px 15px;
          background: transparent;
          border: none;
          border-bottom: 3px solid transparent;
          color: #b0b8c8;
          cursor: pointer;
          font-size: 0.95em;
          transition: all 0.3s;
        ">🔘 Кнопки</button>
        <button onclick="switchConfigTab('reset')" id="configTab-reset" style="
          flex: 1;
          padding: 5px 15px;
          background: transparent;
          border: none;
          border-bottom: 3px solid transparent;
          color: #b0b8c8;
          cursor: pointer;
          font-size: 0.95em;
          transition: all 0.3s;
        ">🔄 Сброс</button>
      </div>
      
      <!-- Контент вкладок -->
      <div id="configTabContent" style="min-height: 300px; margin-bottom: 20px;"></div>
      
      <!-- Кнопки действий -->
      <div style="display: flex; gap: 10px;">
        <button onclick="saveConfigChanges()" style="
          flex: 1;
          background: #4caf50;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">💾 Сохранить</button>
        <button onclick="closeConfigureCategoriesModal()" style="
          flex: 1;
          background: #f44336;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">❌ Отмена</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Показываем вкладку категорий по умолчанию
  switchConfigTab('categories');
}

// Закрыть модалку настройки категорий
function closeConfigureCategoriesModal() {
  const modal = document.getElementById('configureCategoriesModal');
  if (modal) {
    modal.remove();
  }
  currentEditingConfig = null;
}

// Переключить вкладку в модалке настройки
function switchConfigTab(tab) {
  // Обновляем стили кнопок
  ['categories', 'buttons', 'reset'].forEach(t => {
    const btn = document.getElementById(`configTab-${t}`);
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
  
  const content = document.getElementById('configTabContent');
  if (!content) return;
  
  if (tab === 'categories') {
    content.innerHTML = renderCategoriesTab();
  } else if (tab === 'buttons') {
    content.innerHTML = renderButtonsTab();
  } else if (tab === 'reset') {
    content.innerHTML = renderResetTab();
  }
}

// Отрисовать вкладку категорий
function renderCategoriesTab() {
  if (!currentEditingConfig || !currentEditingConfig.categories) {
    return '<div style="text-align: center; padding: 40px; color: #f44336;">Ошибка загрузки конфигурации</div>';
  }
  
  let html = `
    <div style="margin-bottom: 15px;">
      <button onclick="addNewCategory()" style="
        width: 100%;
        padding: 12px;
        background: rgba(76, 175, 80, 0.7);
        color: #c8e6c9;
        border: 1px solid #4caf50;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.95em;
        transition: all 0.3s ease;
      " onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
        ➕ Добавить категорию
      </button>
    </div>
    
    <div style="display: flex; flex-direction: column; gap: 10px;">
  `;
  
  currentEditingConfig.categories.forEach((category, index) => {
    const buttonCount = category.buttons ? category.buttons.length : 0;
    
    html += `
      <div style="
        background: rgba(30, 35, 45, 0.5);
        border: 1px solid rgba(90, 159, 212, 0.3);
        border-radius: 8px;
        padding: 15px;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div style="flex: 1;">
            <input 
              type="text" 
              value="${category.name}" 
              onchange="updateCategoryName(${index}, this.value)"
              style="
                width: 100%;
                padding: 8px;
                background: rgba(20, 25, 35, 0.5);
                border: 1px solid rgba(90, 159, 212, 0.3);
                border-radius: 4px;
                color: #e0e6f0;
                font-size: 0.95em;
              "
            />
            <div style="color: #b0b8c8; font-size: 0.85em; margin-top: 5px;">
              ID: ${category.id} | Кнопок: ${buttonCount}
            </div>
          </div>
          
          <div style="display: flex; gap: 5px; margin-left: 10px;">
            ${index > 0 ? `
              <button onclick="moveCategoryUp(${index})" style="
                padding: 8px 12px;
                background: rgba(90, 159, 212, 0.7);
                color: #e0e6f0;
                border: 1px solid #3a7bd5;
                border-radius: 4px;
                cursor: pointer;
                font-size: 0.9em;
              " title="Переместить вверх">⬆️</button>
            ` : ''}
            
            ${index < currentEditingConfig.categories.length - 1 ? `
              <button onclick="moveCategoryDown(${index})" style="
                padding: 8px 12px;
                background: rgba(90, 159, 212, 0.7);
                color: #e0e6f0;
                border: 1px solid #3a7bd5;
                border-radius: 4px;
                cursor: pointer;
                font-size: 0.9em;
              " title="Переместить вниз">⬇️</button>
            ` : ''}
            
            <button onclick="deleteCategory(${index})" style="
              padding: 8px 12px;
              background: rgba(244, 67, 54, 0.7);
              color: #ffb3b3;
              border: 1px solid #f44336;
              border-radius: 4px;
              cursor: pointer;
              font-size: 0.9em;
            " title="Удалить категорию">🗑️</button>
          </div>
        </div>
        
        <div style="
          background: rgba(20, 25, 35, 0.5);
          padding: 10px;
          border-radius: 4px;
          border: 1px solid rgba(90, 159, 212, 0.2);
        ">
          <label style="display: flex; align-items: center; gap: 8px; color: #b0b8c8; font-size: 0.9em;">
            <input 
              type="checkbox" 
              ${category.collapsed !== false ? 'checked' : ''}
              onchange="toggleCategoryCollapsed(${index}, this.checked)"
              style="width: 18px; height: 18px; cursor: pointer;"
            />
            Свернута по умолчанию
          </label>
        </div>
      </div>
    `;
  });
  
  html += `</div>`;
  
  return html;
}

// Отрисовать вкладку кнопок
function renderButtonsTab() {
  if (!currentEditingConfig || !currentEditingConfig.categories) {
    return '<div style="text-align: center; padding: 40px; color: #f44336;">Ошибка загрузки конфигурации</div>';
  }
  
  let html = `
    <div style="
      background: rgba(255, 152, 0, 0.2);
      border-left: 4px solid #ff9800;
      padding: 15px;
      border-radius: 4px;
      margin-bottom: 15px;
      color: #ffe0b2;
      font-size: 0.9em;
    ">
      💡 Выберите категорию для каждой кнопки. Кнопки будут отображаться в выбранной категории.
    </div>
    
    <div style="display: flex; flex-direction: column; gap: 10px;">
  `;
  
  // Собираем все кнопки из всех категорий
  currentEditingConfig.categories.forEach((category, catIndex) => {
    if (!category.buttons || category.buttons.length === 0) return;
    
    category.buttons.forEach((button, btnIndex) => {
      html += `
        <div style="
          background: rgba(30, 35, 45, 0.5);
          border: 1px solid rgba(90, 159, 212, 0.3);
          border-radius: 8px;
          padding: 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <div style="flex: 1;">
            <div style="color: #e0e6f0; font-weight: 600; margin-bottom: 5px;">
              ${button.text}
            </div>
            <div style="color: #b0b8c8; font-size: 0.85em;">
              ID: ${button.id}
            </div>
          </div>
          
          <select 
            onchange="moveButtonToCategory(${catIndex}, ${btnIndex}, this.value)"
            style="
              padding: 8px 12px;
              background: rgba(20, 25, 35, 0.5);
              border: 1px solid rgba(90, 159, 212, 0.3);
              border-radius: 4px;
              color: #e0e6f0;
              font-size: 0.9em;
              cursor: pointer;
              min-width: 200px;
            "
          >
            ${currentEditingConfig.categories.map((cat, idx) => `
              <option value="${idx}" ${idx === catIndex ? 'selected' : ''}>
                ${cat.name}
              </option>
            `).join('')}
          </select>
        </div>
      `;
    });
  });
  
  html += `</div>`;
  
  return html;
}

// Отрисовать вкладку сброса
function renderResetTab() {
  return `
    <div style="text-align: center; padding: 40px;">
      <div style="
        background: rgba(244, 67, 54, 0.2);
        border: 2px solid #f44336;
        border-radius: 12px;
        padding: 30px;
        margin-bottom: 20px;
      ">
        <div style="font-size: 3em; margin-bottom: 15px;">⚠️</div>
        <h4 style="margin: 0 0 15px 0; color: #f44336; font-size: 1.2em;">
          Сброс к дефолтным настройкам
        </h4>
        <p style="color: #ffb3b3; margin: 0 0 20px 0; line-height: 1.6;">
          Это действие вернёт конфигурацию админ-панели к исходному состоянию.<br/>
          Все ваши изменения (категории, порядок кнопок) будут потеряны.
        </p>
        <button onclick="resetToDefaultConfig()" style="
          padding: 15px 30px;
          background: #f44336;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 1em;
          font-weight: 600;
          transition: all 0.3s ease;
        " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
          🔄 Сбросить к дефолту
        </button>
      </div>
      
      <div style="color: #b0b8c8; font-size: 0.9em; line-height: 1.6;">
        <p style="margin: 0;">
          Дефолтная конфигурация включает 6 категорий:<br/>
          📊 Система и логи, 👥 Пользователи и модерация,<br/>
          📢 Контент и новости, ⚙️ Настройки интерфейса,<br/>
          🔔 Уведомления, 🛠️ Утилиты и инструменты
        </p>
      </div>
    </div>
  `;
}

// Обновить название категории
function updateCategoryName(index, newName) {
  if (!currentEditingConfig || !currentEditingConfig.categories[index]) return;
  currentEditingConfig.categories[index].name = newName;
}

// Переключить свернутость категории
function toggleCategoryCollapsed(index, collapsed) {
  if (!currentEditingConfig || !currentEditingConfig.categories[index]) return;
  currentEditingConfig.categories[index].collapsed = collapsed;
}

// Переместить категорию вверх
function moveCategoryUp(index) {
  if (!currentEditingConfig || index <= 0) return;
  
  const categories = currentEditingConfig.categories;
  [categories[index - 1], categories[index]] = [categories[index], categories[index - 1]];
  
  switchConfigTab('categories');
}

// Переместить категорию вниз
function moveCategoryDown(index) {
  if (!currentEditingConfig || index >= currentEditingConfig.categories.length - 1) return;
  
  const categories = currentEditingConfig.categories;
  [categories[index], categories[index + 1]] = [categories[index + 1], categories[index]];
  
  switchConfigTab('categories');
}

// Удалить категорию
async function deleteCategory(index) {
  if (!currentEditingConfig || !currentEditingConfig.categories[index]) return;
  
  const category = currentEditingConfig.categories[index];
  const buttonCount = category.buttons ? category.buttons.length : 0;
  
  if (buttonCount > 0) {
    const confirmed = await showCustomConfirm(
      `В категории "${category.name}" есть ${buttonCount} кнопок.\n\nКуда переместить кнопки?`,
      'Удаление категории',
      '⚠️'
    );
    
    if (!confirmed) return;
    
    // Перемещаем кнопки в первую доступную категорию
    if (currentEditingConfig.categories.length > 1) {
      const targetIndex = index === 0 ? 1 : 0;
      currentEditingConfig.categories[targetIndex].buttons.push(...category.buttons);
    }
  }
  
  currentEditingConfig.categories.splice(index, 1);
  switchConfigTab('categories');
}

// Добавить новую категорию
function addNewCategory() {
  if (!currentEditingConfig) return;
  
  const newId = 'custom_' + Date.now();
  const newCategory = {
    id: newId,
    name: '📁 Новая категория',
    icon: '📁',
    collapsed: false,
    buttons: []
  };
  
  currentEditingConfig.categories.push(newCategory);
  switchConfigTab('categories');
}

// Переместить кнопку в другую категорию
function moveButtonToCategory(fromCatIndex, btnIndex, toCatIndex) {
  if (!currentEditingConfig) return;
  
  toCatIndex = parseInt(toCatIndex);
  if (fromCatIndex === toCatIndex) return;
  
  const button = currentEditingConfig.categories[fromCatIndex].buttons[btnIndex];
  currentEditingConfig.categories[fromCatIndex].buttons.splice(btnIndex, 1);
  currentEditingConfig.categories[toCatIndex].buttons.push(button);
  
  switchConfigTab('buttons');
}

// Сбросить к дефолтной конфигурации
async function resetToDefaultConfig() {
  const confirmed = await showCustomConfirm(
    'Вы уверены что хотите сбросить конфигурацию к дефолтным настройкам?\n\nВсе ваши изменения будут потеряны.',
    'Подтверждение сброса',
    '⚠️'
  );
  
  if (!confirmed) return;
  
  try {
    const response = await fetch('/api/admin/panel-config/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser?.username
      })
    });
    
    if (!response.ok) {
      throw new Error('Ошибка сброса конфигурации');
    }
    
    await showCustomAlert('Конфигурация сброшена к дефолтным настройкам', 'Успешно', '✅');
    
    // Закрываем модалку и перезагружаем админ-панель
    closeConfigureCategoriesModal();
    await loadAdminPanelConfig();
    
  } catch (error) {
    console.error('❌ Ошибка сброса конфигурации:', error);
    await showCustomAlert('Ошибка сброса конфигурации', 'Ошибка', '❌');
  }
}

// Сохранить изменения конфигурации
async function saveConfigChanges() {
  if (!currentEditingConfig || !currentUser) return;
  
  try {
    const response = await fetch('/api/admin/panel-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        config: currentEditingConfig
      })
    });
    
    if (!response.ok) {
      throw new Error('Ошибка сохранения конфигурации');
    }
    
    await showCustomAlert('Конфигурация успешно сохранена', 'Успешно', '✅');
    
    // Закрываем модалку и перезагружаем админ-панель
    closeConfigureCategoriesModal();
    await loadAdminPanelConfig();
    
  } catch (error) {
    console.error('❌ Ошибка сохранения конфигурации:', error);
    await showCustomAlert('Ошибка сохранения конфигурации', 'Ошибка', '❌');
  }
}

// Закрытие модалки входа по клику вне её
document.addEventListener('click', (e) => {
  const modal = document.getElementById('loginModal');
  if (modal && e.target === modal) {
    closeLoginModal();
  }
});

// Закрытие модалки входа по Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('loginModal');
    if (modal && modal.style.display === 'flex') {
      closeLoginModal();
    }
  }
});

// ============================================
// Редактирование имен игроков в событиях
// ============================================

// Глобальная переменная для хранения сохраненных имен игроков
window.savedEventPlayers = {};

// Загрузка сохраненных имен игроков для матча
async function loadSavedEventPlayers(matchId) {
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

// Открытие редактора имени игрока
function openPlayerNameEditor(element) {
  const eventId = element.dataset.eventId;
  const eventType = element.dataset.eventType;
  const minute = element.dataset.minute;
  const extraMinute = element.dataset.extraMinute;
  const teamId = element.dataset.teamId;
  
  // Создаем поле ввода с автодополнением
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
  
  // Создаем список автодополнения
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
  
  // Заменяем элемент на поле ввода
  element.replaceWith(input);
  input.parentElement.style.position = 'relative';
  input.parentElement.appendChild(suggestionsList);
  input.focus();
  
  // Загружаем словарь игроков
  let playersDictionary = [];
  const matchData = window.currentLiveStatsData;
  
  if (matchData && matchData.game && matchData.game.season && matchData.game.season.league) {
    const leagueId = matchData.game.season.league.id;
    // Маппинг League ID на код турнира
    const leagueCodeMap = {
      2: 'CL',    // Champions League
      3: 'EL',    // Europa League
      848: 'ECL', // Conference League
      39: 'PL',   // Premier League
      78: 'BL1',  // Bundesliga
      140: 'PD',  // La Liga
      135: 'SA',  // Serie A
      61: 'FL1',  // Ligue 1
      88: 'DED',  // Eredivisie
      235: 'RPL', // Russian Premier League
      1: 'WC',    // World Cup
      4: 'EC'     // Euro Championship
    };
    const competitionCode = leagueCodeMap[leagueId] || 'RPL';
    
    loadPlayersDictionary(competitionCode).then(players => {
      playersDictionary = players;
    });
  }
  
  // Обработка ввода с автодополнением
  input.addEventListener('input', () => {
    const query = input.value.toLowerCase().trim();
    
    if (query.length < 2) {
      suggestionsList.style.display = 'none';
      return;
    }
    
    // Фильтруем игроков
    const matches = playersDictionary.filter(player => 
      player.toLowerCase().includes(query)
    ).slice(0, 10);
    
    if (matches.length === 0) {
      suggestionsList.style.display = 'none';
      return;
    }
    
    // Отображаем подсказки
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
  
  // Обработка Enter
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const playerName = input.value.trim();
      if (playerName) {
        await savePlayerName(playerName, eventId, eventType, minute, extraMinute, teamId);
      }
    } else if (e.key === 'Escape') {
      // Возвращаем N/A
      input.replaceWith(element);
      suggestionsList.remove();
    }
  });
  
  // Обработка потери фокуса
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (input.parentElement) {
        input.replaceWith(element);
        suggestionsList.remove();
      }
    }, 200);
  });
}

// Выбор игрока из списка
async function selectPlayer(playerName, eventId, eventType, minute, extraMinute, teamId) {
  await savePlayerName(playerName, eventId, eventType, minute, extraMinute, teamId);
}

// Сохранение имени игрока
async function savePlayerName(playerName, eventId, eventType, minute, extraMinute, teamId) {
  try {
    // Ищем ID матча в разных местах
    const matchId = window.currentLiveStatsData?.matchData?.id || 
                    window.currentLiveStatsData?.details?.id;
    
    if (!matchId) {
      console.error('❌ ID матча не найден', window.currentLiveStatsData);
      await showCustomAlert('ID матча не найден. Попробуйте перезагрузить статистику.', 'Ошибка', '❌');
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
      
      // Обновляем кэш
      window.savedEventPlayers[eventId] = { player_name: playerName };
      
      // Перезагружаем вкладку событий
      switchLiveStatsTab('events');
    } else {
      console.error('❌ Ошибка сохранения:', data.error);
      await showCustomAlert('Ошибка сохранения имени игрока', 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('❌ Ошибка сохранения имени игрока:', error);
    await showCustomAlert('Ошибка сохранения имени игрока', 'Ошибка', '❌');
  }
}

// Загрузка словаря игроков для турнира
async function loadPlayersDictionary(competitionCode) {
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
    // Возвращаем массив русских имен (ключи объекта)
    return Object.keys(data);
  } catch (error) {
    console.error('❌ Ошибка загрузки словаря игроков:', error);
    return [];
  }
}
