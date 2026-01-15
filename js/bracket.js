// ===== СЕТКА ПЛЕЙ-ОФФ =====

let currentBracket = null;
let bracketPredictions = {};
let isEditingBracket = false;
let allTeams = [];

// Структура сетки плей-офф
const BRACKET_STAGES = [
  { id: 'round_of_16', name: '1/16', matches: 16 },
  { id: 'round_of_8', name: '1/8', matches: 8 },
  { id: 'quarter_finals', name: '1/4', matches: 4 },
  { id: 'semi_finals', name: '1/2', matches: 2 },
  { id: 'final', name: '🏆 Финал', matches: 1 }
];

// Загрузить команды из teams.json
async function loadTeams() {
  try {
    const response = await fetch('/teams.json');
    if (!response.ok) {
      throw new Error('Ошибка загрузки команд');
    }
    const data = await response.json();
    
    // Собираем все команды из всех категорий
    allTeams = [];
    if (data.teams_by_status) {
      Object.values(data.teams_by_status).forEach(category => {
        if (category.teams && Array.isArray(category.teams)) {
          category.teams.forEach(team => {
            allTeams.push(team.name);
          });
        }
      });
    }
    
    // Сортируем команды по алфавиту
    allTeams.sort((a, b) => a.localeCompare(b, 'ru'));
    
    return allTeams;
  } catch (error) {
    console.error('Ошибка загрузки команд:', error);
    return [];
  }
}

// Получить стадии для отображения в зависимости от начальной стадии
function getStagesForBracket(startStage) {
  const startIndex = BRACKET_STAGES.findIndex(s => s.id === startStage);
  if (startIndex === -1) return BRACKET_STAGES;
  return BRACKET_STAGES.slice(startIndex);
}

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
async function openBracketModal(bracketId, viewUserId = null) {
  // viewUserId - ID пользователя, чьи прогнозы нужно показать (если null - показываем текущего пользователя)
  const targetUserId = viewUserId || (currentUser ? currentUser.id : null);
  
  if (!currentUser && !viewUserId) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Сначала войдите в аккаунт', 'Требуется авторизация', '🔒');
    } else {
      alert('Сначала войдите в аккаунт');
    }
    return;
  }

  try {
    // Загружаем команды
    await loadTeams();
    
    // Загружаем данные сетки
    const response = await fetch(`/api/brackets/${bracketId}`);
    if (!response.ok) {
      throw new Error('Ошибка загрузки сетки');
    }
    
    currentBracket = await response.json();
    isEditingBracket = false;
    
    // Получаем иконку турнира
    let eventIcon = '🏆';
    if (currentBracket.event_id && events && events.length > 0) {
      const event = events.find(e => e.id === currentBracket.event_id);
      if (event && event.icon) {
        eventIcon = event.icon;
      }
    }
    currentBracket.eventIcon = eventIcon;
    
    // Загружаем прогнозы пользователя (целевого или текущего)
    if (targetUserId) {
      const predictionsResponse = await fetch(`/api/brackets/${bracketId}/predictions/${targetUserId}`);
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
    } else {
      bracketPredictions = {};
    }
    
    // Проверяем, закрыта ли сетка для ставок
    const isClosed = isBracketClosed(currentBracket);
    
    // Если смотрим прогнозы другого пользователя - всегда режим просмотра
    const isViewMode = viewUserId && viewUserId !== (currentUser ? currentUser.id : null);
    
    renderBracketModal(isClosed || isViewMode);
    const modal = document.getElementById('bracketModal');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
      
      // Если режим просмотра чужих прогнозов - добавляем заголовок
      if (isViewMode) {
        const modalTitle = modal.querySelector('.modal-header h2');
        if (modalTitle) {
          // Используем сохраненное имя пользователя
          const username = window.viewingUserBracketName || 'Пользователь';
          
          // Формируем иконку турнира для заголовка
          let eventIconHtml = '🏆';
          if (currentBracket.eventIcon) {
            if (currentBracket.eventIcon.startsWith('img/') || currentBracket.eventIcon.startsWith('http')) {
              eventIconHtml = `<img src="${currentBracket.eventIcon}" alt="icon" style="width: 24px; height: 24px; vertical-align: middle; margin-right: 8px;" />`;
            } else {
              eventIconHtml = currentBracket.eventIcon + ' ';
            }
          }
          
          modalTitle.innerHTML = `${eventIconHtml}Прогнозы: ${username}`;
          // Очищаем после использования
          window.viewingUserBracketName = null;
        }
      }
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
  
  const isManuallyLocked = currentBracket.is_locked === 1;
  const isAutoLocked = isClosed && !isManuallyLocked;
  const isLocked = isClosed || isManuallyLocked;
  
  let statusBadge = '';
  let lockDateText = '';
  
  if (isManuallyLocked) {
    statusBadge = '<div style="color: #ff9800; font-size: 0.9em;">🔒 Заблокировано админом</div>';
  } else if (isAutoLocked) {
    statusBadge = '<div style="color: #f44336; font-size: 0.9em;">🔒 Ставки закрыты</div>';
  } else {
    statusBadge = '<div style="color: #4caf50; font-size: 0.9em;">✅ Ставки открыты</div>';
    
    // Форматируем дату и время блокировки
    if (currentBracket.start_date) {
      const lockDate = new Date(currentBracket.start_date);
      const dateStr = lockDate.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
      const timeStr = lockDate.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
      });
      lockDateText = `<div style="color: #b0b8c8; font-size: 0.75em; margin-top: 2px;">(будет заблокировано ${dateStr} в ${timeStr})</div>`;
    }
  }
  
  const isAdmin = currentUser && currentUser.isAdmin;
  
  // Формируем иконку турнира для заголовка
  let eventIconHtml = '🏆';
  if (currentBracket.eventIcon) {
    if (currentBracket.eventIcon.startsWith('img/') || currentBracket.eventIcon.startsWith('http')) {
      eventIconHtml = `<img src="${currentBracket.eventIcon}" alt="icon" style="width: 24px; height: 24px; vertical-align: middle; margin-right: 8px;" />`;
    } else {
      eventIconHtml = currentBracket.eventIcon + ' ';
    }
  }
  
  modal.innerHTML = `
    <div class="modal-content bracket-modal-content" onclick="event.stopPropagation()">
      <div class="modal-header" style="position: relative;">
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <h2 style="margin: 0;">${eventIconHtml}Окончательная сетка плей-офф</h2>
          ${statusBadge}
          ${lockDateText}
        </div>
        <div style="position: absolute; top: 10px; right: 10px; display: flex; gap: 10px; align-items: center;">
          ${isAdmin ? `
            <button class="btn-secondary" onclick="toggleBracketEditMode()" style="padding: 8px 16px; font-size: 0.9em;" title="Редактировать команды">
              ✏️
            </button>
            <button class="btn-secondary" onclick="toggleBracketLock()" style="padding: 8px 16px; font-size: 0.9em;" title="${isManuallyLocked ? 'Разблокировать сетку' : 'Заблокировать сетку'}">
              ${isManuallyLocked ? '🔓' : '🔒'}
            </button>
            <button class="btn-danger" onclick="deleteBracket()" style="padding: 8px 16px; font-size: 0.9em;" title="Удалить сетку">
              🗑️
            </button>
          ` : ''}
          ${!isLocked && !isEditingBracket ? `
            
          ` : ''}
          ${isEditingBracket ? `
            <button class="btn-primary" onclick="saveBracketTeams()" style="padding: 8px 16px; font-size: 0.9em;">
              💾 Сохранить команды
            </button>
          ` : ''}
          <button class="modal-close" onclick="closeBracketModal()">&times;</button>
        </div>
      </div>
      
      <div class="bracket-container">
        ${renderBracketStages(isLocked)}
      </div>
    </div>
  `;
}

// Отрисовать стадии сетки
function renderBracketStages(isClosed) {
  const startStage = currentBracket.start_stage || 'round_of_16';
  const stages = getStagesForBracket(startStage);
  
  // Маппинг для текста "Кто проходит в..."
  const nextStageText = {
    'round_of_16': 'Кто проходит в 1/8',
    'round_of_8': 'Кто проходит в 1/4',
    'quarter_finals': 'Кто проходит в 1/2',
    'semi_finals': 'Кто проходит в финал',
    'final': '' // Для финала текст не нужен
  };
  
  let html = '<div class="bracket-stages-wrapper">';
  
  stages.forEach((stage, stageIndex) => {
    const headerText = nextStageText[stage.id] || '';
    const isLastStage = stageIndex === stages.length - 1;
    
    html += `
      <div class="bracket-stage-column${stage.id === 'final' ? ' bracket-final' : ''}" data-stage-index="${stageIndex}">
        ${headerText ? `
          <div class="bracket-header-text" style="text-align: center; color: #b0b8c8; font-size: 0.85em; position: absolute; left: 0; right: 0;">
            ${headerText}
          </div>
        ` : `
          <div class="bracket-header-text" style="text-align: center; color: transparent; font-size: 0.85em; visibility: hidden; position: absolute; left: 0; right: 0;">
            &nbsp;
          </div>
        `}
        <h3 class="bracket-stage-title">${stage.name}</h3>
        <div class="bracket-matches-column">
          ${renderStageMatchesVertical(stage, isClosed, 0, stage.matches)}
        </div>
        ${!isLastStage ? '<svg class="bracket-connections-svg"></svg>' : ''}
      </div>
    `;
  });
  
  html += '</div>'; // bracket-stages-wrapper
  
  // После рендера нужно нарисовать линии и позиционировать заголовки
  setTimeout(() => {
    drawBracketConnections();
    positionBracketTitles();
  }, 0);
  
  return html;
}

// Позиционировать заголовки стадий на уровне первых карточек
function positionBracketTitles() {
  const stageColumns = document.querySelectorAll('.bracket-stage-column');
  
  stageColumns.forEach(column => {
    const headerText = column.querySelector('.bracket-header-text');
    const title = column.querySelector('.bracket-stage-title');
    const firstMatch = column.querySelector('.bracket-match-vertical');
    
    if (!title || !firstMatch) return;
    
    const columnRect = column.getBoundingClientRect();
    const matchRect = firstMatch.getBoundingClientRect();
    const titleHeight = title.offsetHeight;
    
    // Позиционируем заголовок на 20px выше первой карточки
    const titleTop = matchRect.top - columnRect.top - titleHeight - 20;
    title.style.top = `${titleTop}px`;
    
    // Позиционируем текст "Кто проходит" на 15px выше заголовка
    if (headerText) {
      const headerHeight = headerText.offsetHeight;
      const headerTop = titleTop - headerHeight - 15;
      headerText.style.top = `${headerTop}px`;
    }
  });
}

// Нарисовать соединительные линии между карточками
function drawBracketConnections() {
  const stageColumns = document.querySelectorAll('.bracket-stage-column');
  
  stageColumns.forEach((column, columnIndex) => {
    const svg = column.querySelector('.bracket-connections-svg');
    if (!svg) return;
    
    const matches = column.querySelectorAll('.bracket-match-vertical');
    if (matches.length === 0) return;
    
    // Находим следующую колонку и её карточки
    const nextColumn = stageColumns[columnIndex + 1];
    if (!nextColumn) return;
    
    const nextMatches = nextColumn.querySelectorAll('.bracket-match-vertical');
    
    // Очищаем SVG
    svg.innerHTML = '';
    
    const svgRect = svg.getBoundingClientRect();
    
    // Рисуем линии для каждой пары матчей
    for (let i = 0; i < matches.length; i += 2) {
      const match1 = matches[i];
      const match2 = matches[i + 1];
      const nextMatch = nextMatches[Math.floor(i / 2)];
      
      if (!match1 || !nextMatch) continue;
      
      const rect1 = match1.getBoundingClientRect();
      const nextRect = nextMatch.getBoundingClientRect();
      
      const y1 = rect1.top + rect1.height / 2 - svgRect.top;
      const yNext = nextRect.top + nextRect.height / 2 - svgRect.top;
      const x1 = 0;
      const x2 = 8;
      const xEnd = nextRect.left - svgRect.left;
      
      // Горизонтальная линия от первого матча
      const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line1.setAttribute('x1', x1);
      line1.setAttribute('y1', y1);
      line1.setAttribute('x2', x2);
      line1.setAttribute('y2', y1);
      line1.setAttribute('stroke', 'rgba(90, 159, 212, 0.3)');
      line1.setAttribute('stroke-width', '2');
      svg.appendChild(line1);
      
      if (match2) {
        const rect2 = match2.getBoundingClientRect();
        const y2 = rect2.top + rect2.height / 2 - svgRect.top;
        
        // Горизонтальная линия от второго матча
        const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line2.setAttribute('x1', x1);
        line2.setAttribute('y1', y2);
        line2.setAttribute('x2', x2);
        line2.setAttribute('y2', y2);
        line2.setAttribute('stroke', 'rgba(90, 159, 212, 0.3)');
        line2.setAttribute('stroke-width', '2');
        svg.appendChild(line2);
        
        // Вертикальная линия соединяющая две горизонтальные
        const lineV = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        lineV.setAttribute('x1', x2);
        lineV.setAttribute('y1', y1);
        lineV.setAttribute('x2', x2);
        lineV.setAttribute('y2', y2);
        lineV.setAttribute('stroke', 'rgba(90, 159, 212, 0.3)');
        lineV.setAttribute('stroke-width', '2');
        svg.appendChild(lineV);
        
        // Горизонтальная линия к следующей карточке (от середины между y1 и y2 к левому краю следующей карточки)
        const yMiddle = (y1 + y2) / 2;
        const lineToNext = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        lineToNext.setAttribute('x1', x2);
        lineToNext.setAttribute('y1', yMiddle);
        lineToNext.setAttribute('x2', xEnd);
        lineToNext.setAttribute('y2', yNext);
        lineToNext.setAttribute('stroke', 'rgba(90, 159, 212, 0.3)');
        lineToNext.setAttribute('stroke-width', '2');
        svg.appendChild(lineToNext);
      } else {
        // Если нет второго матча (один матч в стадии), линия идет напрямую к следующей карточке
        const lineToNext = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        lineToNext.setAttribute('x1', x2);
        lineToNext.setAttribute('y1', y1);
        lineToNext.setAttribute('x2', xEnd);
        lineToNext.setAttribute('y2', yNext);
        lineToNext.setAttribute('stroke', 'rgba(90, 159, 212, 0.3)');
        lineToNext.setAttribute('stroke-width', '2');
        svg.appendChild(lineToNext);
      }
    }
  });
}

// Отрисовать матчи стадии вертикально
function renderStageMatchesVertical(stage, isClosed, startIndex, endIndex) {
  let html = '';
  
  for (let i = startIndex; i < endIndex; i++) {
    const matchData = currentBracket.matches?.[stage.id]?.[i];
    const prediction = bracketPredictions[stage.id]?.[i];
    
    html += `
      <div class="bracket-match-vertical" data-stage="${stage.id}" data-match="${i}">
        <div class="bracket-match-teams-vertical">
          ${renderTeamSlot(stage.id, i, 0, matchData?.team1, prediction, isClosed)}
          ${renderTeamSlot(stage.id, i, 1, matchData?.team2, prediction, isClosed)}
        </div>
      </div>
    `;
  }
  
  return html;
}

// Получить список уже выбранных команд в сетке
function getSelectedTeams() {
  const selectedTeams = new Set();
  
  if (!currentBracket.matches) return selectedTeams;
  
  // Проходим по всем стадиям и матчам
  Object.values(currentBracket.matches).forEach(stageMatches => {
    Object.values(stageMatches).forEach(match => {
      if (match.team1) selectedTeams.add(match.team1);
      if (match.team2) selectedTeams.add(match.team2);
    });
  });
  
  return selectedTeams;
}

// Отрисовать слот команды
function renderTeamSlot(stageId, matchIndex, teamIndex, teamName, prediction, isClosed) {
  const isWinner = prediction && prediction === teamName;
  const highlightClass = isWinner ? 'bracket-team-winner' : '';
  
  // Режим редактирования для админа
  if (isEditingBracket) {
    // Получаем список уже выбранных команд
    const selectedTeams = getSelectedTeams();
    
    // Фильтруем команды: исключаем уже выбранные, но оставляем текущую команду
    const availableTeams = allTeams.filter(team => 
      !selectedTeams.has(team) || team === teamName
    );
    
    const teamOptions = availableTeams.map(team => 
      `<option value="${team}" ${team === teamName ? 'selected' : ''}>${team}</option>`
    ).join('');
    
    return `
      <div class="bracket-team-slot ${highlightClass}">
        <select 
          class="bracket-team-select" 
          data-stage="${stageId}" 
          data-match="${matchIndex}" 
          data-team="${teamIndex}"
          onchange="updateBracketTeamSelection()"
          style="width: 100%; padding: 5px; background: rgba(40, 44, 54, 0.9); border: 1px solid rgba(90, 159, 212, 0.5); border-radius: 4px; color: #e0e6f0; font-size: 0.9em;"
        >
          <option value="">— Выберите команду —</option>
          ${teamOptions}
        </select>
      </div>
    `;
  }
  
  // Обычный режим - кликабельные слоты для выбора победителя
  const isClickable = !isClosed && teamName;
  const clickHandler = isClickable ? `onclick="selectBracketWinner('${stageId}', ${matchIndex}, '${teamName.replace(/'/g, "\\'")}')"` : '';
  const cursorStyle = isClickable ? 'cursor: pointer;' : '';
  
  return `
    <div class="bracket-team-slot ${highlightClass}" 
         data-stage="${stageId}" 
         data-match="${matchIndex}" 
         data-team="${teamName || ''}"
         ${clickHandler} 
         style="${cursorStyle}">
      <div class="bracket-team-name">${teamName || `—`}</div>
    </div>
  `;
}

// Выбрать победителя матча (клик по команде)
async function selectBracketWinner(stageId, matchIndex, teamName) {
  if (!currentUser || !currentBracket) return;
  
  // Проверяем, закрыта ли сетка
  const isClosed = isBracketClosed(currentBracket);
  if (isClosed) {
    if (typeof showCustomAlert === 'function') {
      showCustomAlert('Ставки в сетке закрыты', 'Внимание', '🔒');
    }
    return;
  }
  
  // Проверяем, выбрана ли уже эта команда
  const currentPrediction = bracketPredictions[stageId]?.[matchIndex];
  
  if (currentPrediction === teamName) {
    // Повторный клик на ту же команду - удаляем ставку
    if (!bracketPredictions[stageId]) {
      bracketPredictions[stageId] = {};
    }
    delete bracketPredictions[stageId][matchIndex];
    
    // Обновляем визуальное отображение (убираем подсветку)
    updateBracketMatchDisplay(stageId, matchIndex, null);
    
    // Очищаем все последующие стадии
    clearPredictionsFromStage(stageId, matchIndex);
    
    // Удаляем прогноз из БД
    await deleteBracketPrediction(stageId, matchIndex);
    
    return;
  }
  
  // Сохраняем выбор в локальном объекте
  if (!bracketPredictions[stageId]) {
    bracketPredictions[stageId] = {};
  }
  bracketPredictions[stageId][matchIndex] = teamName;
  
  // Обновляем только визуальное отображение без перерисовки всей модалки
  updateBracketMatchDisplay(stageId, matchIndex, teamName);
  
  // Продвигаем команду в следующую стадию
  promoteTeamToNextStage(stageId, matchIndex, teamName);
  
  // Автоматически сохраняем прогноз на сервер
  await saveSingleBracketPrediction(stageId, matchIndex, teamName);
}

// Удалить прогноз из БД
async function deleteBracketPrediction(stageId, matchIndex) {
  if (!currentUser || !currentBracket) return;
  
  try {
    const response = await fetch(`/api/brackets/${currentBracket.id}/predictions/${currentUser.id}/${stageId}/${matchIndex}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Ошибка удаления прогноза');
    }
    
    console.log('✅ Прогноз удален');
  } catch (error) {
    console.error('Ошибка при удалении прогноза:', error);
  }
}

// Продвинуть команду в следующую стадию
async function promoteTeamToNextStage(currentStageId, currentMatchIndex, teamName) {
  // Определяем следующую стадию
  const stageOrder = ['round_of_16', 'round_of_8', 'quarter_finals', 'semi_finals', 'final'];
  const currentStageIndex = stageOrder.indexOf(currentStageId);
  
  if (currentStageIndex === -1 || currentStageIndex === stageOrder.length - 1) {
    // Это финал или неизвестная стадия, дальше продвигать некуда
    return;
  }
  
  const nextStageId = stageOrder[currentStageIndex + 1];
  
  // Вычисляем индекс матча в следующей стадии
  // Каждые 2 матча текущей стадии дают 1 матч следующей стадии
  const nextMatchIndex = Math.floor(currentMatchIndex / 2);
  
  // Определяем позицию команды в следующем матче (0 или 1)
  const teamPosition = currentMatchIndex % 2;
  
  // Обновляем данные сетки для следующей стадии
  if (!currentBracket.matches) {
    currentBracket.matches = {};
  }
  if (!currentBracket.matches[nextStageId]) {
    currentBracket.matches[nextStageId] = {};
  }
  if (!currentBracket.matches[nextStageId][nextMatchIndex]) {
    currentBracket.matches[nextStageId][nextMatchIndex] = {};
  }
  
  if (teamPosition === 0) {
    currentBracket.matches[nextStageId][nextMatchIndex].team1 = teamName;
  } else {
    currentBracket.matches[nextStageId][nextMatchIndex].team2 = teamName;
  }
  
  // Обновляем отображение следующей стадии
  updateNextStageDisplay(nextStageId, nextMatchIndex);
  
  // КАСКАДНОЕ ОБНОВЛЕНИЕ: если в следующей стадии был выбран победитель этого матча,
  // проверяем, нужно ли продвинуть его дальше
  if (bracketPredictions[nextStageId] && bracketPredictions[nextStageId][nextMatchIndex]) {
    const nextStageWinner = bracketPredictions[nextStageId][nextMatchIndex];
    
    // Проверяем, есть ли победитель среди обновленных команд
    const team1 = currentBracket.matches[nextStageId][nextMatchIndex].team1;
    const team2 = currentBracket.matches[nextStageId][nextMatchIndex].team2;
    
    if (nextStageWinner === team1 || nextStageWinner === team2) {
      // Победитель все еще участвует - продвигаем его дальше
      await promoteTeamToNextStage(nextStageId, nextMatchIndex, nextStageWinner);
      await saveSingleBracketPrediction(nextStageId, nextMatchIndex, nextStageWinner);
    } else {
      // Победитель больше не участвует - очищаем прогноз и все последующие
      clearPredictionsFromStage(nextStageId, nextMatchIndex);
    }
  }
  
  // Сохраняем обновленную структуру сетки на сервер
  await saveBracketStructure();
}

// Очистить прогнозы начиная с указанной стадии и матча
function clearPredictionsFromStage(stageId, matchIndex) {
  const stageOrder = ['round_of_16', 'round_of_8', 'quarter_finals', 'semi_finals', 'final'];
  const currentStageIndex = stageOrder.indexOf(stageId);
  
  // Очищаем прогноз в текущей стадии
  if (bracketPredictions[stageId]) {
    delete bracketPredictions[stageId][matchIndex];
  }
  
  // Обновляем визуальное отображение
  updateBracketMatchDisplay(stageId, matchIndex, null);
  
  // Если это не финал, очищаем следующую стадию
  if (currentStageIndex < stageOrder.length - 1) {
    const nextStageId = stageOrder[currentStageIndex + 1];
    const nextMatchIndex = Math.floor(matchIndex / 2);
    
    clearPredictionsFromStage(nextStageId, nextMatchIndex);
  }
}

// Сохранить структуру сетки (команды в матчах) на сервер
async function saveBracketStructure() {
  if (!currentUser || !currentBracket) return;
  
  try {
    const response = await fetch(`/api/brackets/${currentBracket.id}/structure`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.id,
        matches: currentBracket.matches
      })
    });
    
    if (!response.ok) {
      throw new Error('Ошибка сохранения структуры сетки');
    }
    
    console.log('✅ Структура сетки автоматически сохранена');
  } catch (error) {
    console.error('Ошибка при сохранении структуры сетки:', error);
  }
}

// Сохранить один прогноз на сервер
async function saveSingleBracketPrediction(stageId, matchIndex, teamName) {
  if (!currentUser || !currentBracket) return;
  
  try {
    const predictions = [{
      stage: stageId,
      match_index: matchIndex,
      predicted_winner: teamName
    }];
    
    const response = await fetch(`/api/brackets/${currentBracket.id}/predictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.id,
        predictions
      })
    });
    
    if (!response.ok) {
      throw new Error('Ошибка сохранения прогноза');
    }
    
    console.log('✅ Прогноз автоматически сохранен');
  } catch (error) {
    console.error('Ошибка при автосохранении прогноза:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Не удалось сохранить прогноз', 'Ошибка', '❌');
    }
  }
}

// Обновить отображение конкретного матча
function updateBracketMatchDisplay(stageId, matchIndex, selectedTeam) {
  // Находим все слоты команд в этом матче
  const teamSlots = document.querySelectorAll(
    `.bracket-team-slot[data-stage="${stageId}"][data-match="${matchIndex}"]`
  );
  
  // Обновляем подсветку команд
  teamSlots.forEach(slot => {
    const teamName = slot.dataset.team;
    if (selectedTeam && teamName === selectedTeam) {
      slot.classList.add('bracket-team-winner');
    } else {
      slot.classList.remove('bracket-team-winner');
    }
  });
}

// Обновить отображение следующей стадии
function updateNextStageDisplay(nextStageId, nextMatchIndex) {
  const matchData = currentBracket.matches?.[nextStageId]?.[nextMatchIndex];
  if (!matchData) return;
  
  // Находим контейнер матча в следующей стадии
  const matchContainer = document.querySelector(
    `.bracket-match-vertical[data-stage="${nextStageId}"][data-match="${nextMatchIndex}"]`
  );
  
  if (!matchContainer) return;
  
  // Обновляем названия команд в слотах
  const teamSlots = matchContainer.querySelectorAll('.bracket-team-slot');
  
  teamSlots.forEach((slot, index) => {
    const teamName = index === 0 ? matchData.team1 : matchData.team2;
    const teamNameElement = slot.querySelector('.bracket-team-name');
    
    if (teamNameElement && teamName) {
      teamNameElement.textContent = teamName;
      slot.dataset.team = teamName;
      
      // Обновляем обработчик клика
      const isClosed = isBracketClosed(currentBracket);
      if (!isClosed) {
        slot.onclick = () => selectBracketWinner(nextStageId, nextMatchIndex, teamName);
        slot.style.cursor = 'pointer';
      }
    }
  });
}

// Сохранить прогнозы
async function saveBracketPredictions() {
  if (!currentUser || !currentBracket) return;
  
  // Собираем все прогнозы из объекта bracketPredictions
  const predictions = [];
  
  Object.keys(bracketPredictions).forEach(stage => {
    Object.keys(bracketPredictions[stage]).forEach(matchIndex => {
      const winner = bracketPredictions[stage][matchIndex];
      if (winner) {
        predictions.push({
          stage,
          match_index: parseInt(matchIndex),
          predicted_winner: winner
        });
      }
    });
  });
  
  if (predictions.length === 0) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Выберите хотя бы одного победителя', 'Внимание', '⚠️');
    } else {
      alert('Выберите хотя бы одного победителя');
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
  isEditingBracket = false;
}

// Переключить режим редактирования сетки
function toggleBracketEditMode() {
  isEditingBracket = !isEditingBracket;
  const isClosed = isBracketClosed(currentBracket);
  renderBracketModal(isClosed);
}

// Переключить блокировку сетки (для админа)
async function toggleBracketLock() {
  if (!currentUser || !currentUser.isAdmin || !currentBracket) return;
  
  const isCurrentlyLocked = currentBracket.is_locked === 1;
  const newLockState = isCurrentlyLocked ? 0 : 1;
  
  try {
    const response = await fetch(`/api/admin/brackets/${currentBracket.id}/lock`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        is_locked: newLockState
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Ошибка изменения блокировки');
    }
    
    // Обновляем состояние
    currentBracket.is_locked = newLockState;
    
    const message = newLockState === 1 
      ? 'Сетка заблокирована. Пользователи не смогут делать прогнозы.' 
      : 'Сетка разблокирована. Пользователи могут делать прогнозы.';
    
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(message, 'Успех', '✅');
    } else {
      alert(message);
    }
    
    // Перерисовываем модальное окно
    const isClosed = isBracketClosed(currentBracket);
    renderBracketModal(isClosed);
    
  } catch (error) {
    console.error('Ошибка при изменении блокировки:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(error.message, 'Ошибка', '❌');
    } else {
      alert(error.message);
    }
  }
}

// Сохранить команды в сетке (для админа)
async function saveBracketTeams() {
  if (!currentUser || !currentUser.isAdmin || !currentBracket) return;
  
  try {
    // Собираем данные о командах из селектов
    const selects = document.querySelectorAll('.bracket-team-select');
    const matches = {};
    
    selects.forEach(select => {
      const stage = select.dataset.stage;
      const matchIndex = parseInt(select.dataset.match);
      const teamIndex = parseInt(select.dataset.team);
      const teamName = select.value;
      
      if (!matches[stage]) {
        matches[stage] = {};
      }
      
      if (!matches[stage][matchIndex]) {
        matches[stage][matchIndex] = {};
      }
      
      if (teamIndex === 0) {
        matches[stage][matchIndex].team1 = teamName;
      } else {
        matches[stage][matchIndex].team2 = teamName;
      }
    });
    
    // Отправляем данные на сервер
    const response = await fetch(`/api/admin/brackets/${currentBracket.id}/teams`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        matches: matches
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Ошибка сохранения команд');
    }
    
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Команды успешно сохранены!', 'Успех', '✅');
    } else {
      alert('Команды успешно сохранены!');
    }
    
    // Обновляем данные сетки
    currentBracket.matches = matches;
    isEditingBracket = false;
    
    const isClosed = isBracketClosed(currentBracket);
    renderBracketModal(isClosed);
    
  } catch (error) {
    console.error('Ошибка при сохранении команд:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(error.message, 'Ошибка', '❌');
    } else {
      alert(error.message);
    }
  }
}

// Обновить выбор команд в селектах (перерисовать после изменения)
function updateBracketTeamSelection() {
  // Собираем текущие выборы из селектов
  const selects = document.querySelectorAll('.bracket-team-select');
  const currentSelections = {};
  
  selects.forEach(select => {
    const stage = select.dataset.stage;
    const matchIndex = parseInt(select.dataset.match);
    const teamIndex = parseInt(select.dataset.team);
    const teamName = select.value;
    
    if (!currentSelections[stage]) {
      currentSelections[stage] = {};
    }
    
    if (!currentSelections[stage][matchIndex]) {
      currentSelections[stage][matchIndex] = {};
    }
    
    if (teamIndex === 0) {
      currentSelections[stage][matchIndex].team1 = teamName;
    } else {
      currentSelections[stage][matchIndex].team2 = teamName;
    }
  });
  
  // Обновляем данные сетки
  currentBracket.matches = currentSelections;
  
  // Перерисовываем модальное окно
  const isClosed = isBracketClosed(currentBracket);
  renderBracketModal(isClosed);
}

// Открыть модальное окно создания/редактирования сетки (для админа)
async function openCreateBracketModal() {
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
  
  // Проверяем, есть ли уже сетка для этого турнира
  try {
    const brackets = await loadBracketsForEvent(currentEventId);
    
    if (brackets && brackets.length > 0) {
      // Сетка уже существует - открываем редактирование
      const bracket = brackets[0];
      openEditBracketModal(bracket);
      return;
    }
  } catch (err) {
    console.error('Ошибка проверки существующих сеток:', err);
  }
  
  // Сетки нет - открываем создание
  const modal = document.getElementById('createBracketModal');
  console.log('modal:', modal);
  
  if (!modal) {
    console.error('Модальное окно createBracketModal не найдено');
    return;
  }
  
  // Очищаем форму
  const nameInput = document.getElementById('bracketName');
  const dateInput = document.getElementById('bracketStartDate');
  const stageSelect = document.getElementById('bracketStartStage');
  
  if (nameInput) nameInput.value = '';
  if (dateInput) dateInput.value = '';
  if (stageSelect) stageSelect.value = 'round_of_16';
  
  // Меняем заголовок на "Создать"
  const modalTitle = modal.querySelector('.modal-header h2');
  if (modalTitle) modalTitle.textContent = '➕ Создать сетку плей-офф';
  
  // Добавляем обработчик изменения стадии
  if (stageSelect) {
    stageSelect.onchange = updateStartDateLabel;
    updateStartDateLabel();
  }
  
  modal.style.display = 'flex';
  modal.classList.add('active');
  
  if (typeof lockBodyScroll === 'function') {
    lockBodyScroll();
  } else {
    document.body.style.overflow = 'hidden';
  }
}

// Обновить метку даты в зависимости от выбранной стадии
function updateStartDateLabel() {
  const stageSelect = document.getElementById('bracketStartStage');
  const dateLabel = document.getElementById('bracketStartDateLabel');
  
  if (!stageSelect || !dateLabel) return;
  
  const stage = stageSelect.value;
  const stageNames = {
    'round_of_16': '1/16',
    'round_of_8': '1/8'
  };
  
  dateLabel.textContent = `Дата начала ${stageNames[stage] || '1/16'}:`;
}

// Открыть модальное окно редактирования сетки
function openEditBracketModal(bracket) {
  const modal = document.getElementById('createBracketModal');
  
  if (!modal) {
    console.error('Модальное окно createBracketModal не найдено');
    return;
  }
  
  // Заполняем форму данными сетки
  const nameInput = document.getElementById('bracketName');
  const dateInput = document.getElementById('bracketStartDate');
  const stageSelect = document.getElementById('bracketStartStage');
  
  if (nameInput) nameInput.value = bracket.name;
  if (stageSelect) stageSelect.value = bracket.start_stage || 'round_of_16';
  
  if (dateInput) {
    // Преобразуем дату в формат datetime-local
    const date = new Date(bracket.start_date);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    dateInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
  }
  
  // Меняем заголовок на "Редактировать"
  const modalTitle = modal.querySelector('.modal-header h2');
  if (modalTitle) modalTitle.textContent = '✏️ Редактировать сетку плей-офф';
  
  // Добавляем обработчик изменения стадии
  if (stageSelect) {
    stageSelect.onchange = updateStartDateLabel;
    updateStartDateLabel();
  }
  
  // Сохраняем ID сетки для обновления
  modal.dataset.bracketId = bracket.id;
  
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

// Создать или обновить сетку
async function createBracket() {
  if (!currentUser || !currentUser.isAdmin) return;
  
  const modal = document.getElementById('createBracketModal');
  const bracketId = modal?.dataset.bracketId;
  const isEdit = !!bracketId;
  
  const name = document.getElementById('bracketName').value.trim();
  const startDate = document.getElementById('bracketStartDate').value;
  const startStage = document.getElementById('bracketStartStage').value;
  
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
      await showCustomAlert('Выберите дату начала', 'Ошибка', '❌');
    } else {
      alert('Выберите дату начала');
    }
    return;
  }
  
  try {
    const url = isEdit ? `/api/admin/brackets/${bracketId}` : '/api/admin/brackets';
    const method = isEdit ? 'PUT' : 'POST';
    
    console.log(`${isEdit ? 'Обновление' : 'Создание'} сетки:`, {
      event_id: currentEventId,
      name,
      start_date: startDate,
      start_stage: startStage,
      username: currentUser.username
    });
    
    const response = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: currentEventId,
        name,
        start_date: startDate,
        start_stage: startStage,
        username: currentUser.username
      })
    });
    
    console.log('Ответ сервера:', response.status, response.statusText);
    
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
      throw new Error(result.error || `Ошибка ${isEdit ? 'обновления' : 'создания'} сетки`);
    }
    
    console.log(`Сетка успешно ${isEdit ? 'обновлена' : 'создана'}:`, result);
    
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(`Сетка успешно ${isEdit ? 'обновлена' : 'создана'}!`, 'Успех', '✅');
    } else {
      alert(`Сетка успешно ${isEdit ? 'обновлена' : 'создана'}!`);
    }
    
    // Очищаем dataset
    if (modal) delete modal.dataset.bracketId;
    
    closeCreateBracketModal();
    
    // Обновляем отображение матчей
    if (typeof displayMatches === 'function') {
      displayMatches();
    }
  } catch (error) {
    console.error(`Ошибка при ${isEdit ? 'обновлении' : 'создании'} сетки:`, error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(error.message, 'Ошибка', '❌');
    } else {
      alert(error.message);
    }
  }
}


// Удалить сетку (для админа)
async function deleteBracket() {
  if (!currentUser || !currentUser.isAdmin || !currentBracket) return;
  
  const confirmDelete = confirm(`Вы уверены, что хотите удалить сетку "${currentBracket.name}"?\n\nЭто действие удалит:\n- Саму сетку\n- Все прогнозы пользователей\n\nЭто действие необратимо!`);
  
  if (!confirmDelete) return;
  
  try {
    const response = await fetch(`/api/admin/brackets/${currentBracket.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Ошибка удаления сетки');
    }
    
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Сетка успешно удалена!', 'Успех', '✅');
    } else {
      alert('Сетка успешно удалена!');
    }
    
    closeBracketModal();
    
    // Обновляем отображение матчей чтобы убрать кнопку сетки
    if (typeof displayMatches === 'function') {
      displayMatches();
    }
    
  } catch (error) {
    console.error('Ошибка при удалении сетки:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(error.message, 'Ошибка', '❌');
    } else {
      alert(error.message);
    }
  }
}
