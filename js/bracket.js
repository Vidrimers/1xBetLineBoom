// ===== СЕТКА ПЛЕЙ-ОФФ =====

let currentBracket = null;
let bracketPredictions = {};

// Структура сетки плей-офф
const BRACKET_STAGES = [
  { id: 'round_of_16', name: '1/16', matches: 8 },
  { id: 'round_of_8', name: '1/8', matches: 4 },
  { id: 'quarter_finals', name: '1/4', matches: 4 },
  { id: 'semi_finals', name: '1/2', matches: 2 },
  { id: 'final', name: 'Финал', matches: 1 }
];

// Загрузить сетки для турнира
async function loadBracketsForEvent(eventId) {
  try {
    const response = await fetch(`/api/events/${eventId}/brackets`);
    if (!response.ok) {
      return [];
    }
    return await response.json();
  } catch (error) {
    console.error('Ошибка загрузки сеток:', error);
    return [];
  }
}

// Открыть модальное окно сетки
async function openBracketModal(bracketId) {
  if (!currentUser) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Сначала войдите в аккаунт', 'Требуется авторизация', '🔒');
    } else {
      alert('Сначала войдите в аккаунт');
    }
    return;
  }

  try {
    // Загружаем данные сетки
    const response = await fetch(`/api/brackets/${bracketId}`);
    if (!response.ok) {
      throw new Error('Ошибка загрузки сетки');
    }
    
    currentBracket = await response.json();
    
    // Загружаем прогнозы пользователя
    const predictionsResponse = await fetch(`/api/brackets/${bracketId}/predictions/${currentUser.id}`);
    if (predictionsResponse.ok) {
      const predictions = await predictionsResponse.json();
      bracketPredictions = {};
      predictions.forEach(p => {
        bracketPredictions[p.stage] = bracketPredictions[p.stage] || {};
        bracketPredictions[p.stage][p.match_index] = p.predicted_winner;
      });
    } else {
      bracketPredictions = {};
    }
    
    // Проверяем, закрыта ли сетка для ставок
    const isClosed = isBracketClosed(currentBracket);
    
    renderBracketModal(isClosed);
    const modal = document.getElementById('bracketModal');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
    }
    
    if (typeof lockBodyScroll === 'function') {
      lockBodyScroll();
    } else {
      document.body.style.overflow = 'hidden';
    }
  } catch (error) {
    console.error('Ошибка при открытии сетки:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Не удалось загрузить сетку', 'Ошибка', '❌');
    } else {
      alert('Не удалось загрузить сетку');
    }
  }
}

// Проверить, закрыта ли сетка для ставок
function isBracketClosed(bracket) {
  if (!bracket.start_date) return false;
  
  const startDate = new Date(bracket.start_date);
  const now = new Date();
  
  return now >= startDate;
}

// Отрисовать модальное окно сетки
function renderBracketModal(isClosed) {
  const modal = document.getElementById('bracketModal');
  if (!modal) return;
  
  const closedBadge = isClosed 
    ? '<span style="color: #f44336; font-size: 0.9em; margin-left: 10px;">🔒 Ставки закрыты</span>'
    : '<span style="color: #4caf50; font-size: 0.9em; margin-left: 10px;">✅ Ставки открыты</span>';
  
  modal.innerHTML = `
    <div class="modal-content bracket-modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h2>🏆 Сетка плей-офф${closedBadge}</h2>
        <div style="display: flex; gap: 10px; align-items: center;">
          ${!isClosed ? `
            <button class="btn-primary" onclick="saveBracketPredictions()" style="padding: 8px 16px; font-size: 0.9em;">
              💾 Сохранить прогнозы
            </button>
          ` : ''}
          <button class="modal-close" onclick="closeBracketModal()">&times;</button>
        </div>
      </div>
      
      <div class="bracket-container">
        ${renderBracketStages(isClosed)}
      </div>
    </div>
  `;
}

// Отрисовать стадии сетки
function renderBracketStages(isClosed) {
  let html = '<div class="bracket-stages">';
  
  BRACKET_STAGES.forEach(stage => {
    html += `
      <div class="bracket-stage">
        <h3 class="bracket-stage-title">${stage.name}</h3>
        <div class="bracket-matches">
          ${renderStageMatches(stage, isClosed)}
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  return html;
}

// Отрисовать матчи стадии
function renderStageMatches(stage, isClosed) {
  let html = '';
  
  for (let i = 0; i < stage.matches; i++) {
    const matchData = currentBracket.matches?.[stage.id]?.[i];
    const prediction = bracketPredictions[stage.id]?.[i];
    
    html += `
      <div class="bracket-match">
        <div class="bracket-match-teams">
          ${renderTeamInput(stage.id, i, 0, matchData?.team1, prediction, isClosed)}
          <div class="bracket-match-vs">vs</div>
          ${renderTeamInput(stage.id, i, 1, matchData?.team2, prediction, isClosed)}
        </div>
        ${!isClosed ? `
          <div class="bracket-match-winner">
            <label style="font-size: 0.85em; color: #b0b8c8; margin-bottom: 5px; display: block;">
              Кто пройдет?
            </label>
            <input 
              type="text" 
              class="bracket-winner-input" 
              data-stage="${stage.id}" 
              data-match="${i}"
              value="${prediction || ''}"
              placeholder="Введите команду"
              ${isClosed ? 'disabled' : ''}
            />
          </div>
        ` : prediction ? `
          <div class="bracket-match-prediction">
            <strong>Ваш прогноз:</strong> ${prediction}
          </div>
        ` : ''}
      </div>
    `;
  }
  
  return html;
}

// Отрисовать поле ввода команды
function renderTeamInput(stageId, matchIndex, teamIndex, teamName, prediction, isClosed) {
  const isWinner = prediction && prediction === teamName;
  const highlightClass = isWinner ? 'bracket-team-winner' : '';
  
  return `
    <div class="bracket-team ${highlightClass}">
      ${teamName || `Команда ${teamIndex + 1}`}
    </div>
  `;
}

// Сохранить прогнозы
async function saveBracketPredictions() {
  if (!currentUser || !currentBracket) return;
  
  // Собираем все прогнозы из полей ввода
  const inputs = document.querySelectorAll('.bracket-winner-input');
  const predictions = [];
  
  inputs.forEach(input => {
    const stage = input.dataset.stage;
    const matchIndex = parseInt(input.dataset.match);
    const winner = input.value.trim();
    
    if (winner) {
      predictions.push({
        stage,
        match_index: matchIndex,
        predicted_winner: winner
      });
    }
  });
  
  if (predictions.length === 0) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Введите хотя бы один прогноз', 'Внимание', '⚠️');
    } else {
      alert('Введите хотя бы один прогноз');
    }
    return;
  }
  
  try {
    const response = await fetch(`/api/brackets/${currentBracket.id}/predictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.id,
        predictions
      })
    });
    
    if (!response.ok) {
      throw new Error('Ошибка сохранения прогнозов');
    }
    
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Прогнозы успешно сохранены!', 'Успех', '✅');
    } else {
      alert('Прогнозы успешно сохранены!');
    }
    closeBracketModal();
    
    // Обновляем отображение матчей
    if (typeof displayMatches === 'function') {
      displayMatches();
    }
  } catch (error) {
    console.error('Ошибка при сохранении прогнозов:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Не удалось сохранить прогнозы', 'Ошибка', '❌');
    } else {
      alert('Не удалось сохранить прогнозы');
    }
  }
}

// Закрыть модальное окно сетки
function closeBracketModal() {
  const modal = document.getElementById('bracketModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
    if (typeof unlockBodyScroll === 'function') {
      unlockBodyScroll();
    } else {
      document.body.style.overflow = '';
    }
  }
  currentBracket = null;
  bracketPredictions = {};
}

// Открыть модальное окно создания сетки (для админа)
function openCreateBracketModal() {
  console.log('openCreateBracketModal вызвана');
  console.log('currentUser:', currentUser);
  console.log('currentEventId:', currentEventId);
  
  if (!currentUser) {
    alert('Сначала войдите в аккаунт');
    return;
  }
  
  if (!currentUser.isAdmin) {
    alert('Доступ запрещен');
    return;
  }
  
  if (!currentEventId) {
    alert('Сначала выберите турнир');
    return;
  }
  
  const modal = document.getElementById('createBracketModal');
  console.log('modal:', modal);
  
  if (!modal) {
    console.error('Модальное окно createBracketModal не найдено');
    return;
  }
  
  // Очищаем форму
  const nameInput = document.getElementById('bracketName');
  const dateInput = document.getElementById('bracketStartDate');
  
  if (nameInput) nameInput.value = '';
  if (dateInput) dateInput.value = '';
  
  modal.style.display = 'flex';
  modal.classList.add('active');
  
  if (typeof lockBodyScroll === 'function') {
    lockBodyScroll();
  } else {
    document.body.style.overflow = 'hidden';
  }
}

// Закрыть модальное окно создания сетки
function closeCreateBracketModal() {
  const modal = document.getElementById('createBracketModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
    if (typeof unlockBodyScroll === 'function') {
      unlockBodyScroll();
    } else {
      document.body.style.overflow = '';
    }
  }
}

// Создать сетку
async function createBracket() {
  if (!currentUser || !currentUser.isAdmin) return;
  
  const name = document.getElementById('bracketName').value.trim();
  const startDate = document.getElementById('bracketStartDate').value;
  
  if (!name) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Введите название сетки', 'Ошибка', '❌');
    } else {
      alert('Введите название сетки');
    }
    return;
  }
  
  if (!startDate) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Выберите дату начала 1/16', 'Ошибка', '❌');
    } else {
      alert('Выберите дату начала 1/16');
    }
    return;
  }
  
  try {
    console.log('Отправка запроса на создание сетки:', {
      event_id: currentEventId,
      name,
      start_date: startDate,
      username: currentUser.username
    });
    
    const response = await fetch('/api/admin/brackets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: currentEventId,
        name,
        start_date: startDate,
        username: currentUser.username
      })
    });
    
    console.log('Ответ сервера:', response.status, response.statusText);
    
    // Получаем текст ответа для отладки
    const responseText = await response.text();
    console.log('Текст ответа:', responseText);
    
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Ошибка парсинга JSON:', parseError);
      console.error('Полученный текст:', responseText);
      throw new Error('Сервер вернул некорректный ответ: ' + responseText.substring(0, 100));
    }
    
    if (!response.ok) {
      throw new Error(result.error || 'Ошибка создания сетки');
    }
    
    console.log('Сетка успешно создана:', result);
    
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Сетка успешно создана!', 'Успех', '✅');
    } else {
      alert('Сетка успешно создана!');
    }
    closeCreateBracketModal();
    
    // Обновляем отображение матчей
    if (typeof displayMatches === 'function') {
      displayMatches();
    }
  } catch (error) {
    console.error('Ошибка при создании сетки:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(error.message, 'Ошибка', '❌');
    } else {
      alert(error.message);
    }
  }
}
