// ===== СЕТКА ПЛЕЙ-ОФФ =====

let currentBracket = null;
let bracketPredictions = {};
let bracketResults = {}; // Фактические результаты матчей (для админа)
let bracketResultsInterval = null; // Интервал для обновления результатов
let isEditingBracket = false;
let hasUnsavedChanges = false; // Флаг несохраненных изменений
let originalBracketMatches = null; // Сохраненное состояние для отката
let isViewingOtherUserBracket = false; // Флаг просмотра чужих прогнозов
let viewingUserId = null; // ID пользователя, чьи прогнозы просматриваем
let allTeams = [];

// Структура сетки плей-офф
const BRACKET_STAGES = [
  { id: 'round_of_16', name: '1/16', matches: 16 },
  { id: 'round_of_8', name: '1/8', matches: 8 },
  { id: 'quarter_finals', name: '1/4', matches: 4 },
  { id: 'semi_finals', name: '1/2', matches: 2 },
  { id: 'final', name: '🏆 Финал', matches: 1 }
];

// Получить первую заполненную стадию сетки
function getFirstFilledStage(matches) {
  if (!matches) return null;
  
  const stageOrder = ['round_of_16', 'round_of_8', 'quarter_finals', 'semi_finals', 'final'];
  
  for (const stageId of stageOrder) {
    if (matches[stageId] && Object.keys(matches[stageId]).length > 0) {
      console.log(`🔍 Первая заполненная стадия: ${stageId}`);
      return stageId;
    }
  }
  
  return null;
}

// Получить список редактируемых стадий (только начальная стадия из БД)
function getEditableStages(bracket) {
  // Используем start_stage из БД, если есть
  if (bracket && bracket.start_stage) {
    console.log(`✏️ Редактируемая стадия из БД: ${bracket.start_stage}`);
    return [bracket.start_stage];
  }
  
  // Если start_stage не указана, определяем по первой заполненной стадии
  const firstStage = getFirstFilledStage(bracket?.matches);
  const result = firstStage ? [firstStage] : ['round_of_16']; // По умолчанию только 1/16
  console.log(`✏️ Редактируемые стадии (определено автоматически):`, result);
  return result;
}

// Восстановить команды в последующих стадиях на основе прогнозов пользователя
async function rebuildBracketFromPredictions() {
  const stageOrder = ['round_of_16', 'round_of_8', 'quarter_finals', 'semi_finals', 'final'];
  
  // Проходим по всем стадиям в порядке
  for (let i = 0; i < stageOrder.length - 1; i++) {
    const currentStageId = stageOrder[i];
    const nextStageId = stageOrder[i + 1];
    
    // Если есть прогнозы для текущей стадии
    if (bracketPredictions[currentStageId]) {
      Object.keys(bracketPredictions[currentStageId]).forEach(matchIndex => {
        const winner = bracketPredictions[currentStageId][matchIndex];
        const nextMatchIndex = Math.floor(matchIndex / 2);
        const teamPosition = matchIndex % 2;
        
        // Создаем структуру если её нет
        if (!currentBracket.matches) {
          currentBracket.matches = {};
        }
        if (!currentBracket.matches[nextStageId]) {
          currentBracket.matches[nextStageId] = {};
        }
        if (!currentBracket.matches[nextStageId][nextMatchIndex]) {
          currentBracket.matches[nextStageId][nextMatchIndex] = {};
        }
        
        // Добавляем победителя в следующую стадию
        if (teamPosition === 0) {
          currentBracket.matches[nextStageId][nextMatchIndex].team1 = winner;
        } else {
          currentBracket.matches[nextStageId][nextMatchIndex].team2 = winner;
        }
      });
    }
  }
  
  console.log('✅ Команды в последующих стадиях восстановлены на основе прогнозов');
}

// Загрузить команды из выбранного файла
async function loadTeams(filePath = null) {
  try {
    // Если путь не указан, используем сохраненный для текущей сетки или дефолтный
    if (!filePath) {
      const bracketId = currentBracket ? currentBracket.id : null;
      if (bracketId) {
        filePath = localStorage.getItem(`selectedTeamFile_${bracketId}`) || '/names/LeagueOfChampionsTeams.json';
      } else {
        filePath = '/names/LeagueOfChampionsTeams.json';
      }
    }
    
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error('Ошибка загрузки команд');
    }
    
    // Определяем формат файла по расширению
    const ext = filePath.split('.').pop().toLowerCase();
    
    allTeams = [];
    
    if (ext === 'json') {
      // JSON формат
      const data = await response.json();
      
      // Собираем все команды из всех категорий
      if (data.teams_by_status) {
        Object.values(data.teams_by_status).forEach(category => {
          if (category.teams && Array.isArray(category.teams)) {
            category.teams.forEach(team => {
              allTeams.push(team.name);
            });
          }
        });
      }
    } else if (ext === 'txt') {
      // TXT формат - команды с новой строки
      const text = await response.text();
      allTeams = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    } else if (ext === 'js') {
      // JS формат - const с командами через запятую
      const text = await response.text();
      
      // Ищем содержимое между фигурными скобками
      const match = text.match(/\{([^}]+)\}/);
      if (match) {
        allTeams = match[1].split(',')
          .map(team => team.trim())
          .filter(team => team.length > 0);
      }
    }
    
    // Сортируем команды по алфавиту
    allTeams.sort((a, b) => a.localeCompare(b, 'ru'));
    
    console.log(`✅ Загружено ${allTeams.length} команд из ${filePath}`);
    return allTeams;
  } catch (error) {
    console.error('Ошибка загрузки команд:', error);
    return [];
  }
}

// Получить список доступных файлов команд
async function getTeamFiles() {
  try {
    const response = await fetch('/api/team-files');
    if (!response.ok) {
      throw new Error('Ошибка загрузки списка файлов');
    }
    return await response.json();
  } catch (error) {
    console.error('Ошибка получения списка файлов команд:', error);
    return [];
  }
}

// Открыть модальное окно выбора файла команд
async function openTeamFileSelector() {
  const files = await getTeamFiles();
  
  if (files.length === 0) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Не найдено файлов команд в папке names', 'Ошибка', '❌');
    } else {
      alert('Не найдено файлов команд в папке names');
    }
    return;
  }
  
  const currentFile = localStorage.getItem(`selectedTeamFile_${currentBracket.id}`) || '/names/LeagueOfChampionsTeams.json';
  
  // Создаем HTML для списка файлов
  const fileListHtml = files.map(file => {
    const isSelected = file.path === currentFile;
    const icon = file.name.endsWith('.json') ? '📄' : file.name.endsWith('.txt') ? '📝' : '📜';
    return `
      <div class="team-file-item ${isSelected ? 'selected' : ''}" 
           onclick="selectTeamFile('${file.path}')" 
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
  
  // Создаем модальное окно
  const modalHtml = `
    <div id="teamFileSelectorModal" class="modal" style="display: flex;" onclick="closeTeamFileSelector()">
      <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
        <div class="modal-header">
          <h2>📥 Выбор файла команд</h2>
          <button class="modal-close" onclick="closeTeamFileSelector()">&times;</button>
        </div>
        <div style="padding: 20px;">
          <p style="color: #b0b8c8; margin-bottom: 15px;">
            Выберите файл с командами для редактирования сетки:
          </p>
          ${fileListHtml}
        </div>
      </div>
    </div>
  `;
  
  // Добавляем модалку в DOM
  const existingModal = document.getElementById('teamFileSelectorModal');
  if (existingModal) {
    existingModal.remove();
  }
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  if (typeof lockBodyScroll === 'function') {
    lockBodyScroll();
  }
}

// Выбрать файл команд
async function selectTeamFile(filePath) {
  try {
    // Сохраняем выбор для текущей сетки
    if (currentBracket && currentBracket.id) {
      localStorage.setItem(`selectedTeamFile_${currentBracket.id}`, filePath);
    }
    
    // Перезагружаем команды
    await loadTeams(filePath);
    
    // Закрываем модалку выбора файла
    closeTeamFileSelector();
    
    // Если мы в режиме редактирования, перерисовываем сетку
    if (isEditingBracket && currentBracket) {
      const isClosed = isBracketClosed(currentBracket);
      renderBracketModal(isClosed);
    }
    
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(`Файл команд изменен на:\n${filePath.split('/').pop()}`, 'Успех', '✅');
    } else {
      alert(`Файл команд изменен на: ${filePath.split('/').pop()}`);
    }
  } catch (error) {
    console.error('Ошибка при выборе файла команд:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Не удалось загрузить файл команд', 'Ошибка', '❌');
    } else {
      alert('Не удалось загрузить файл команд');
    }
  }
}

// Закрыть модальное окно выбора файла команд
function closeTeamFileSelector() {
  const modal = document.getElementById('teamFileSelectorModal');
  if (modal) {
    modal.remove();
  }
  
  if (typeof unlockBodyScroll === 'function') {
    unlockBodyScroll();
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
  console.log('🔍 openBracketModal вызвана:', { bracketId, viewUserId });
  
  // viewUserId - ID пользователя, чьи прогнозы нужно показать (если null - показываем текущего пользователя)
  const targetUserId = viewUserId || (currentUser ? currentUser.id : null);
  
  if (!currentUser && !viewUserId) {
    console.error('❌ Нет авторизации');
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Сначала войдите в аккаунт', 'Требуется авторизация', '🔒');
    } else {
      alert('Сначала войдите в аккаунт');
    }
    return;
  }

  try {
    console.log('📡 Загружаем команды...');
    // Загружаем команды
    await loadTeams();
    
    console.log('📡 Загружаем данные сетки:', bracketId);
    // Загружаем данные сетки
    const response = await fetch(`/api/brackets/${bracketId}`);
    if (!response.ok) {
      console.error('❌ Ошибка загрузки сетки, статус:', response.status);
      throw new Error('Ошибка загрузки сетки');
    }
    
    console.log('✅ Сетка загружена');
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
      // Передаем viewerId для проверки настроек приватности
      const currentUserId = currentUser ? currentUser.id : null;
      const url = `/api/brackets/${bracketId}/predictions/${targetUserId}${currentUserId ? `?viewerId=${currentUserId}` : ''}`;
      const predictionsResponse = await fetch(url);
      
      if (predictionsResponse.ok) {
        const data = await predictionsResponse.json();
        
        // Проверяем, скрыты ли прогнозы
        if (data.hidden) {
          // Показываем сообщение и закрываем модалку
          if (typeof showCustomAlert === 'function') {
            await showCustomAlert(
              data.message || 'Пользователь скрыл свои прогнозы',
              'Прогнозы скрыты',
              '🔒'
            );
          } else {
            alert(data.message || 'Пользователь скрыл свои прогнозы');
          }
          return;
        }
        
        const predictions = data.predictions || data; // Поддержка старого формата
        bracketPredictions = {};
        predictions.forEach(p => {
          bracketPredictions[p.stage] = bracketPredictions[p.stage] || {};
          bracketPredictions[p.stage][p.match_index] = p.predicted_winner;
        });
        
        // Восстанавливаем команды в последующих стадиях на основе прогнозов
        await rebuildBracketFromPredictions();
      } else {
        bracketPredictions = {};
      }
    } else {
      bracketPredictions = {};
    }
    
    // Загружаем результаты матчей (для всех пользователей, чтобы показать правильность прогнозов)
    try {
      const resultsResponse = await fetch(`/api/brackets/${bracketId}/results`);
      if (resultsResponse.ok) {
        const results = await resultsResponse.json();
        bracketResults = {};
        results.forEach(r => {
          bracketResults[r.stage] = bracketResults[r.stage] || {};
          bracketResults[r.stage][r.match_index] = r.actual_winner;
        });
      } else {
        bracketResults = {};
      }
    } catch (error) {
      console.error('Ошибка загрузки результатов:', error);
      bracketResults = {};
    }
    
    // Проверяем, закрыта ли сетка для ставок
    const isClosed = isBracketClosed(currentBracket);
    
    // Если смотрим прогнозы другого пользователя - всегда режим просмотра
    const isViewMode = viewUserId && viewUserId !== (currentUser ? currentUser.id : null);
    isViewingOtherUserBracket = isViewMode; // Устанавливаем глобальный флаг
    viewingUserId = viewUserId; // Сохраняем ID просматриваемого пользователя
    
    // Передаем только реальный статус закрытия, режим просмотра определяется через флаг
    renderBracketModal(isClosed);
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
      
      // Запускаем периодическое обновление результатов
      startBracketResultsPolling();
      
      // Добавляем обработчик изменения размера окна для перерисовки линий
      window.addEventListener('resize', handleBracketResize);
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

// Обработчик изменения размера окна для сетки
let bracketResizeTimeout;
function handleBracketResize() {
  clearTimeout(bracketResizeTimeout);
  bracketResizeTimeout = setTimeout(() => {
    if (window.innerWidth >= 600) {
      drawBracketConnections();
      positionBracketTitles();
    }
  }, 250);
}

// Проверить, закрыта ли сетка для ставок
function isBracketClosed(bracket) {
  if (!bracket.start_date) return false;
  
  const startDate = new Date(bracket.start_date);
  const now = new Date();
  
  return now >= startDate;
}

// Подсчитать статистику прогнозов в сетке
function calculateBracketStats(userId) {
  const stats = {
    total: 0,
    correct: 0,
    incorrect: 0,
    pending: 0,
    points: 0
  };
  
  if (!currentBracket || !bracketPredictions) return stats;
  
  // Проходим по всем стадиям
  Object.keys(bracketPredictions).forEach(stageId => {
    Object.keys(bracketPredictions[stageId]).forEach(matchIndex => {
      const prediction = bracketPredictions[stageId][matchIndex];
      if (!prediction) return;
      
      stats.total++;
      
      // Проверяем есть ли результат для этого матча
      const actualWinner = bracketResults[stageId]?.[matchIndex];
      
      if (actualWinner) {
        // Результат установлен
        if (prediction === actualWinner) {
          stats.correct++;
          // Начисляем очки: 3 за финал, 1 за остальные
          stats.points += (stageId === 'final') ? 3 : 1;
        } else {
          stats.incorrect++;
        }
      } else {
        // Результат еще не установлен
        stats.pending++;
      }
    });
  });
  
  return stats;
}

// Отрисовать модальное окно сетки
function renderBracketModal(isClosed) {
  // Закрываем админское меню если оно открыто (перед перерисовкой)
  if (typeof closeBracketAdminButtons === 'function') {
    closeBracketAdminButtons();
  }
  
  const modal = document.getElementById('bracketModal');
  if (!modal) return;
  
  const isManuallyLocked = currentBracket.is_locked === 1;
  const isAutoLocked = isClosed && !isManuallyLocked && !isViewingOtherUserBracket;
  const isLocked = isClosed || isManuallyLocked || isViewingOtherUserBracket; // Блокируем при просмотре чужих прогнозов
  
  let statusBadge = '';
  let lockDateText = '';
  let lockReasonText = '';
  
  // Не показываем статус ставок при просмотре чужих прогнозов
  if (!isViewingOtherUserBracket) {
    if (isManuallyLocked) {
      statusBadge = '<div style="color: #ff9800; font-size: 0.9em;">🔒 Ставки закрыты</div>';
      lockReasonText = '<div style="color: #ff9800; font-size: 0.75em; margin-top: 2px;">Причина: Заблокировано администратором</div>';
    } else if (isAutoLocked) {
      statusBadge = '<div style="color: #f44336; font-size: 0.9em;">🔒 Ставки закрыты</div>';
      lockReasonText = '<div style="color: #f44336; font-size: 0.75em; margin-top: 2px;">Причина: Плей-офф начался или закончен, ставки больше не принимаются</div>';
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
  } else {
    // В режиме просмотра чужих прогнозов показываем соответствующий статус
    statusBadge = '<div style="color: #5a9fd4; font-size: 0.9em;">👁️ Режим просмотра</div>';
  }
  
  // Подсчитываем статистику прогнозов (только если сетка заблокирована)
  let statsHtml = '';
  if (currentUser && isLocked) {
    const userId = isViewingOtherUserBracket ? viewingUserId : currentUser.id;
    const stats = calculateBracketStats(userId);
    
    if (stats.total > 0) {
      statsHtml = `
        <div style="color: #b0b8c8; font-size: 0.85em; margin-top: 8px; padding: 8px; background: rgba(40, 44, 54, 0.5); border-radius: 4px;">
          <div style="display: flex; gap: 15px; justify-content: center;">
            <span>✅ Угадано: <strong style="color: #4caf50;">${stats.correct}</strong></span>
            <span>❌ Не угадано: <strong style="color: #f44336;">${stats.incorrect}</strong></span>
            <span>⏳ В ожидании: <strong style="color: #ff9800;">${stats.pending}</strong></span>
            <span>🏆 Очки: <strong style="color: #ffd700;">${stats.points}</strong></span>
          </div>
        </div>
      `;
    }
  }
  
  const isAdmin = currentUser && currentUser.isAdmin;
  
  // Скрываем кнопки админа если просматриваем чужие прогнозы
  const showAdminButtons = isAdmin && !isViewingOtherUserBracket;
  
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
    <div class="modal-content bracket-modal-content ${isEditingBracket ? 'editing-mode' : ''}" onclick="event.stopPropagation()" style="${isEditingBracket ? 'border: 3px solid #f44336; box-shadow: 0 0 20px rgba(244, 67, 54, 0.5);' : ''}">
      <div class="modal-header" style="position: relative;">
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div id="bracket-title" class="bracket-title">
            <h2 style="margin: 0;">${eventIconHtml}Окончательная сетка плей-офф</h2>
            <button onclick="showBracketHelp(event)" style="background: transparent; border: none; border-radius: 50%; width: 28px; height: 28px; font-size: 1em; cursor: pointer; color: #b0b8c8; display: flex; align-items: center; justify-content: center; padding: 0;" title="Справка о сетке плей-офф">
              ❓
            </button>
          </div>
          ${isEditingBracket ? '<div style="color: #f44336; font-size: 0.9em; font-weight: 600;">✏️ РЕЖИМ РЕДАКТИРОВАНИЯ</div>' : ''}
          ${statusBadge}
          ${lockReasonText}
          ${lockDateText}
          ${statsHtml}
        </div>
        <div class="bracket-admin button" style="position: absolute; top: 60px; right: 10px; display: flex; gap: 10px; align-items: end; flex-direction: column-reverse;">
          ${showAdminButtons ? `
            <div style="position: relative;">
              <div id="bracketAdminButtonsContainer" style="display: none; position: fixed; top: auto; left: auto; background: rgba(26, 32, 44, 0.95); border: 1px solid #3a7bd5; border-radius: 5px; padding: 8px; gap: 8px; flex-direction: column; z-index: 9999; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,0.5); opacity: 0; transform: translateY(-10px); transition: opacity 0.2s ease, transform 0.2s ease;"></div>
              <button id="bracketAdminSettingsBtn" class="btn-secondary" onclick="toggleBracketAdminButtons(event)" style="padding: 5px; font-size: 1.1em;background: transparent;border: none;" title="Настройки администратора">
                ⚙️
              </button>
            </div>
          ` : ''}
          ${!isLocked && !isEditingBracket ? `
            
          ` : ''}
          ${isEditingBracket ? `
            <button class="btn-primary" onclick="saveBracketTeams()" style="padding: 8px 16px; font-size: 0.9em;">
              💾
            </button>
          ` : ''}
          
        </div>
        <button class="modal-close" style="position: absolute; top: 10px; right: 10px;" onclick="closeBracketModal()">&times;</button>
      </div>
      
      <div class="bracket-container">
        ${renderBracketStages(isLocked, showAdminButtons)}
      </div>
    </div>
  `;
}

// Отрисовать стадии сетки
function renderBracketStages(isClosed, showAdminButtons = false) {
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
  
  let html = `<div class="bracket-stages-wrapper" data-start-stage="${startStage}">`;
  
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
          ${renderStageMatchesVertical(stage, isClosed, 0, stage.matches, showAdminButtons)}
        </div>
        ${!isLastStage ? '<svg class="bracket-connections-svg"></svg>' : ''}
      </div>
    `;
  });
  
  html += '</div>'; // bracket-stages-wrapper
  
  // После рендера нужно нарисовать линии и позиционировать заголовки
  // Только для экранов от 600px и выше
  // Увеличиваем задержку чтобы дождаться завершения анимации модалки
  setTimeout(() => {
    if (window.innerWidth >= 600) {
      drawBracketConnections();
      positionBracketTitles();
    }
  }, 350); // 300ms анимация + 50ms запас
  
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
function renderStageMatchesVertical(stage, isClosed, startIndex, endIndex, showAdminButtons = false) {
  let html = '';
  
  for (let i = startIndex; i < endIndex; i++) {
    const matchData = currentBracket.matches?.[stage.id]?.[i];
    const prediction = bracketPredictions[stage.id]?.[i];
    const actualWinner = bracketResults[stage.id]?.[i];
    
    // Определяем цвет карточки на основе правильности прогноза
    let matchClass = '';
    if (actualWinner && prediction) {
      matchClass = prediction === actualWinner ? 'bracket-match-correct' : 'bracket-match-incorrect';
    }
    
    html += `
      <div class="bracket-match-vertical ${matchClass}" data-stage="${stage.id}" data-match="${i}">
        <div class="bracket-match-teams-vertical">
          ${renderTeamSlotWithRadio(stage.id, i, 0, matchData?.team1, prediction, isClosed, actualWinner, showAdminButtons)}
          ${renderTeamSlotWithRadio(stage.id, i, 1, matchData?.team2, prediction, isClosed, actualWinner, showAdminButtons)}
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

// Отрисовать слот команды с радиокнопкой (если админ)
function renderTeamSlotWithRadio(stageId, matchIndex, teamIndex, teamName, prediction, isClosed, actualWinner, isAdmin) {
  const slot = renderTeamSlot(stageId, matchIndex, teamIndex, teamName, prediction, isClosed);
  
  // Если админ и команда есть, добавляем радиокнопку
  if (isAdmin && teamName) {
    return `
      <div class="bracket-team-slot-wrapper">
        <div class="bracket-result-selector">
          <label class="bracket-radio-label">
            <input type="radio" 
                   name="result_${stageId}_${matchIndex}" 
                   value="${teamName}"
                   ${actualWinner === teamName ? 'checked' : ''}
                   onchange="setBracketMatchResult('${stageId}', ${matchIndex}, '${teamName.replace(/'/g, "\\'")}')"
                   class="bracket-radio">
            <span class="bracket-radio-custom"></span>
          </label>
        </div>
        ${slot}
      </div>
    `;
  }
  
  return slot;
}

// Отрисовать слот команды
function renderTeamSlot(stageId, matchIndex, teamIndex, teamName, prediction, isClosed) {
  const isWinner = prediction && prediction === teamName;
  const highlightClass = isWinner ? 'bracket-team-winner' : '';
  
  // Режим редактирования для админа - только для начальной стадии из БД
  const editableStages = getEditableStages(currentBracket);
  const isEditableStage = editableStages.includes(stageId);
  
  if (isEditingBracket && isEditableStage) {
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
    
    // Удаляем прогноз из БД для текущей стадии
    await deleteBracketPrediction(stageId, matchIndex);
    
    // Очищаем все последующие стадии (с удалением из БД и очисткой слотов команд)
    // Передаем название удаленной команды для поиска и удаления во всех последующих стадиях
    const stageOrder = ['round_of_16', 'round_of_8', 'quarter_finals', 'semi_finals', 'final'];
    const currentStageIndex = stageOrder.indexOf(stageId);
    if (currentStageIndex < stageOrder.length - 1) {
      const nextStageId = stageOrder[currentStageIndex + 1];
      const nextMatchIndex = Math.floor(matchIndex / 2);
      await clearPredictionsFromStage(nextStageId, nextMatchIndex, true, true, teamName);
    }
    
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

// Продвинуть команду в следующую стадию (только локально, не сохраняя в общую структуру)
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
  
  // Обновляем данные сетки для следующей стадии ТОЛЬКО ЛОКАЛЬНО
  // НЕ сохраняем в БД для последующих стадий (только для начальной стадии)
  const editableStages = getEditableStages(currentBracket);
  const shouldSaveToServer = editableStages.includes(nextStageId);
  
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
      await clearPredictionsFromStage(nextStageId, nextMatchIndex, false, false, null);
    }
  }
  
  // Сохраняем обновленную структуру сетки на сервер ТОЛЬКО для начальных стадий
  if (shouldSaveToServer) {
    await saveBracketStructure();
  }
}

// Очистить прогнозы начиная с указанной стадии и матча (каскадное удаление)
async function clearPredictionsFromStage(stageId, matchIndex, deleteFromDB = false, clearTeamSlots = false, deletedTeamName = null) {
  const stageOrder = ['round_of_16', 'round_of_8', 'quarter_finals', 'semi_finals', 'final'];
  const currentStageIndex = stageOrder.indexOf(stageId);
  
  // Очищаем прогноз в текущей стадии
  if (bracketPredictions[stageId]) {
    delete bracketPredictions[stageId][matchIndex];
  }
  
  // Очищаем слоты команд в следующих стадиях
  if (clearTeamSlots && currentBracket.matches && currentBracket.matches[stageId] && currentBracket.matches[stageId][matchIndex]) {
    const matchData = currentBracket.matches[stageId][matchIndex];
    
    // Если передано название удаленной команды, ищем и удаляем именно её
    if (deletedTeamName) {
      if (matchData.team1 === deletedTeamName) {
        currentBracket.matches[stageId][matchIndex].team1 = null;
      }
      if (matchData.team2 === deletedTeamName) {
        currentBracket.matches[stageId][matchIndex].team2 = null;
      }
    } else {
      // Если название не передано, используем старую логику (по позиции)
      const teamPosition = matchIndex % 2;
      if (teamPosition === 0) {
        currentBracket.matches[stageId][matchIndex].team1 = null;
      } else {
        currentBracket.matches[stageId][matchIndex].team2 = null;
      }
    }
    
    // Обновляем визуальное отображение слотов команд
    updateNextStageDisplay(stageId, matchIndex);
  }
  
  // Обновляем визуальное отображение прогноза
  updateBracketMatchDisplay(stageId, matchIndex, null);
  
  // Удаляем прогноз из БД (только для последующих стадий, не для начальной)
  if (deleteFromDB) {
    await deleteBracketPrediction(stageId, matchIndex);
  }
  
  // Если это не финал, очищаем следующую стадию
  if (currentStageIndex < stageOrder.length - 1) {
    const nextStageId = stageOrder[currentStageIndex + 1];
    const nextMatchIndex = Math.floor(matchIndex / 2);
    
    // Для всех последующих стадий включаем удаление из БД и очистку слотов команд
    // Передаем название удаленной команды дальше
    await clearPredictionsFromStage(nextStageId, nextMatchIndex, true, true, deletedTeamName);
  }
  
  // Сохраняем обновленную структуру сетки на сервер (если очищали слоты)
  if (clearTeamSlots) {
    await saveBracketStructure();
  }
}

// Сохранить структуру сетки (команды в матчах) на сервер
async function saveBracketStructure() {
  if (!currentUser || !currentBracket) return;
  
  try {
    // Фильтруем только начальную стадию из БД для сохранения
    const editableStages = getEditableStages(currentBracket);
    const filteredMatches = {};
    
    if (currentBracket.matches) {
      Object.keys(currentBracket.matches).forEach(stageId => {
        if (editableStages.includes(stageId)) {
          filteredMatches[stageId] = currentBracket.matches[stageId];
        }
      });
    }
    
    const response = await fetch(`/api/brackets/${currentBracket.id}/structure`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.id,
        matches: filteredMatches // Сохраняем только начальные стадии
      })
    });
    
    if (!response.ok) {
      throw new Error('Ошибка сохранения структуры сетки');
    }
    
    console.log('✅ Структура сетки (начальные стадии) автоматически сохранена');
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
  
  // Находим контейнер матча в следующей стадии
  const matchContainer = document.querySelector(
    `.bracket-match-vertical[data-stage="${nextStageId}"][data-match="${nextMatchIndex}"]`
  );
  
  if (!matchContainer) return;
  
  // Обновляем названия команд в слотах
  const teamSlots = matchContainer.querySelectorAll('.bracket-team-slot');
  
  teamSlots.forEach((slot, index) => {
    const teamName = matchData ? (index === 0 ? matchData.team1 : matchData.team2) : null;
    const teamNameElement = slot.querySelector('.bracket-team-name');
    
    if (teamNameElement) {
      if (teamName) {
        // Устанавливаем название команды
        teamNameElement.textContent = teamName;
        slot.dataset.team = teamName;
        
        // Обновляем обработчик клика
        const isClosed = isBracketClosed(currentBracket);
        if (!isClosed) {
          slot.onclick = () => selectBracketWinner(nextStageId, nextMatchIndex, teamName);
          slot.style.cursor = 'pointer';
        }
      } else {
        // Очищаем слот
        teamNameElement.textContent = '';
        delete slot.dataset.team;
        slot.onclick = null;
        slot.style.cursor = 'default';
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
async function closeBracketModal() {
  // Проверяем несохраненные изменения
  if (hasUnsavedChanges && isEditingBracket) {
    const action = await showCustomSaveConfirm(
      'У вас есть несохраненные изменения!\n\nЧто вы хотите сделать?',
      'Несохраненные изменения',
      '⚠️'
    );
    
    if (action === 'cancel') {
      return; // Не закрываем модалку
    } else if (action === 'save') {
      // Сохраняем изменения
      await saveBracketTeams();
      // После сохранения закрываем модалку (флаг hasUnsavedChanges уже сброшен в saveBracketTeams)
    } else if (action === 'discard') {
      // Откатываем изменения к оригинальному состоянию
      if (originalBracketMatches) {
        currentBracket.matches = JSON.parse(JSON.stringify(originalBracketMatches));
      }
    }
    // Если action === 'discard', просто продолжаем закрытие
  }
  
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
  
  // Останавливаем обновление результатов
  stopBracketResultsPolling();
  
  // Удаляем обработчик изменения размера окна
  window.removeEventListener('resize', handleBracketResize);
  
  currentBracket = null;
  bracketPredictions = {};
  bracketResults = {};
  isEditingBracket = false;
  hasUnsavedChanges = false; // Сбрасываем флаг
  originalBracketMatches = null; // Очищаем сохраненное состояние
  isViewingOtherUserBracket = false; // Сбрасываем флаг просмотра чужих прогнозов
  viewingUserId = null; // Сбрасываем ID просматриваемого пользователя
}

// Переключить режим редактирования сетки
async function toggleBracketEditMode() {
  // Если выходим из режима редактирования и есть несохраненные изменения
  if (isEditingBracket && hasUnsavedChanges) {
    const action = await showCustomSaveConfirm(
      'У вас есть несохраненные изменения!\n\nЧто вы хотите сделать?',
      'Несохраненные изменения',
      '⚠️'
    );
    
    if (action === 'cancel') {
      return; // Не выходим из режима редактирования
    } else if (action === 'save') {
      // Сохраняем изменения
      await saveBracketTeams();
      // После сохранения выходим из режима (флаг hasUnsavedChanges уже сброшен в saveBracketTeams)
      // isEditingBracket уже установлен в false в saveBracketTeams
      return; // Выходим, т.к. saveBracketTeams уже перерисовал модалку
    } else if (action === 'discard') {
      // Откатываем изменения к оригинальному состоянию
      if (originalBracketMatches) {
        currentBracket.matches = JSON.parse(JSON.stringify(originalBracketMatches));
      }
      hasUnsavedChanges = false;
    }
  }
  
  // Если входим в режим редактирования - сохраняем текущее состояние
  if (!isEditingBracket) {
    originalBracketMatches = JSON.parse(JSON.stringify(currentBracket.matches || {}));
  } else {
    // Если выходим - очищаем сохраненное состояние
    originalBracketMatches = null;
  }
  
  isEditingBracket = !isEditingBracket;
  const isClosed = isBracketClosed(currentBracket);
  renderBracketModal(isClosed);
}

// Переключить блокировку сетки (для админа)
async function toggleBracketLock() {
  if (!currentUser || !currentUser.isAdmin || !currentBracket) return;
  
  // Проверяем, не началась ли сетка автоматически
  const isClosed = isBracketClosed(currentBracket);
  const isManuallyLocked = currentBracket.is_locked === 1;
  const isAutoLocked = isClosed && !isManuallyLocked;
  
  // Если сетка автоматически заблокирована (плей-офф начался), не позволяем разблокировать
  if (isAutoLocked) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(
        'Невозможно изменить блокировку: плей-офф уже начался. Ставки автоматически закрыты.',
        'Блокировка недоступна',
        '🔒'
      );
    } else {
      alert('Невозможно изменить блокировку: плей-офф уже начался.');
    }
    return;
  }
  
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
    hasUnsavedChanges = false; // Сбрасываем флаг после успешного сохранения
    
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
  
  // Отмечаем, что есть несохраненные изменения
  hasUnsavedChanges = true;
  
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

// Очистить последующие стадии сетки (для админа)
async function cleanupBracketStages() {
  if (!currentUser || !currentUser.isAdmin || !currentBracket) return;
  
  // Определяем первую заполненную стадию
  const stageOrder = ['round_of_16', 'round_of_8', 'quarter_finals', 'semi_finals', 'final'];
  let firstStage = null;
  
  if (currentBracket.matches) {
    for (const stageId of stageOrder) {
      if (currentBracket.matches[stageId] && Object.keys(currentBracket.matches[stageId]).length > 0) {
        firstStage = stageId;
        break;
      }
    }
  }
  
  if (!firstStage) {
    await showCustomAlert(
      'Не найдено заполненных стадий для очистки.',
      'Нечего очищать',
      'ℹ️'
    );
    return;
  }
  
  // Определяем название первой стадии для сообщения
  const stageNames = {
    'round_of_16': '1/16 финала',
    'round_of_8': '1/8 финала',
    'quarter_finals': '1/4 финала',
    'semi_finals': '1/2 финала',
    'final': 'Финал'
  };
  
  const confirmCleanup = await showCustomConfirm(
    `Эта операция удалит команды из всех последующих стадий после "${stageNames[firstStage]}".\n\nОстанется только первая стадия: ${stageNames[firstStage]}.\n\n⚠️ ВНИМАНИЕ: Также будут удалены ВСЕ прогнозы пользователей (включая первую стадию)!\n\nПродолжить?`,
    'Очистка последующих стадий',
    '🧹'
  );
  
  if (!confirmCleanup) return;
  
  try {
    // Очищаем локально - оставляем только первую стадию
    const firstStageIndex = stageOrder.indexOf(firstStage);
    const stagesToDelete = [];
    
    if (currentBracket.matches) {
      Object.keys(currentBracket.matches).forEach(stageId => {
        const currentStageIndex = stageOrder.indexOf(stageId);
        // Удаляем все стадии после первой
        if (currentStageIndex > firstStageIndex) {
          delete currentBracket.matches[stageId];
          stagesToDelete.push(stageId);
        }
      });
    }
    
    // Добавляем первую стадию в список для удаления прогнозов
    stagesToDelete.push(firstStage);
    
    // Удаляем прогнозы пользователей на ВСЕ стадии (включая первую) из БД
    if (stagesToDelete.length > 0) {
      const deleteResponse = await fetch(`/api/brackets/${currentBracket.id}/predictions/cleanup`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUser.username,
          stages: stagesToDelete
        })
      });
      
      if (!deleteResponse.ok) {
        throw new Error('Ошибка удаления прогнозов пользователей');
      }
      
      const deleteResult = await deleteResponse.json();
      console.log(`🗑️ Удалено ${deleteResult.deletedCount} прогнозов пользователей`);
      
      // Очищаем ВСЕ локальные прогнозы (включая первую стадию)
      stagesToDelete.forEach(stageId => {
        if (bracketPredictions[stageId]) {
          delete bracketPredictions[stageId];
        }
      });
    }
    
    // Сохраняем на сервер
    await saveBracketStructure();
    
    // Перерисовываем модалку
    const isClosed = isBracketClosed(currentBracket);
    renderBracketModal(isClosed);
    
    await showCustomAlert(
      `Последующие стадии успешно очищены!\n\nОсталась только первая стадия: ${stageNames[firstStage]}.\n\nОстальные стадии будут заполняться индивидуально для каждого пользователя на основе их прогнозов.`,
      'Очистка завершена',
      '✅'
    );
    
  } catch (error) {
    console.error('Ошибка при очистке стадий:', error);
    await showCustomAlert(
      'Не удалось очистить последующие стадии: ' + error.message,
      'Ошибка',
      '❌'
    );
  }
}

// Установить результат матча (для админа)
async function setBracketMatchResult(stageId, matchIndex, actualWinner) {
  if (!currentUser || !currentUser.isAdmin || !currentBracket) return;
  
  try {
    const response = await fetch(`/api/admin/brackets/${currentBracket.id}/results`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        stage: stageId,
        match_index: matchIndex,
        actual_winner: actualWinner
      })
    });
    
    if (!response.ok) {
      throw new Error('Ошибка установки результата');
    }
    
    // Обновляем локальные результаты
    if (!bracketResults[stageId]) {
      bracketResults[stageId] = {};
    }
    bracketResults[stageId][matchIndex] = actualWinner;
    
    // Обновляем цвет карточки без перерисовки всей модалки
    const matchCard = document.querySelector(`.bracket-match-vertical[data-stage="${stageId}"][data-match="${matchIndex}"]`);
    if (matchCard) {
      const prediction = bracketPredictions[stageId]?.[matchIndex];
      
      // Удаляем старые классы
      matchCard.classList.remove('bracket-match-correct', 'bracket-match-incorrect');
      
      // Добавляем новый класс если есть прогноз
      if (prediction) {
        if (prediction === actualWinner) {
          matchCard.classList.add('bracket-match-correct');
        } else {
          matchCard.classList.add('bracket-match-incorrect');
        }
      }
    }
    
    console.log(`✅ Результат установлен: ${stageId}, матч ${matchIndex}, победитель: ${actualWinner}`);
  } catch (error) {
    console.error('Ошибка при установке результата:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Не удалось установить результат', 'Ошибка', '❌');
    }
  }
}

// Запустить периодическое обновление результатов
function startBracketResultsPolling() {
  // Останавливаем предыдущий интервал если есть
  stopBracketResultsPolling();
  
  // Обновляем результаты каждые 5 секунд
  bracketResultsInterval = setInterval(async () => {
    if (!currentBracket) {
      stopBracketResultsPolling();
      return;
    }
    
    await updateBracketResults();
  }, 5000);
  
  console.log('✅ Запущено обновление результатов сетки');
}

// Остановить периодическое обновление результатов
function stopBracketResultsPolling() {
  if (bracketResultsInterval) {
    clearInterval(bracketResultsInterval);
    bracketResultsInterval = null;
    console.log('⏹️ Остановлено обновление результатов сетки');
  }
}

// Обновить результаты матчей
async function updateBracketResults() {
  if (!currentBracket) return;
  
  try {
    const resultsResponse = await fetch(`/api/brackets/${currentBracket.id}/results`);
    if (resultsResponse.ok) {
      const results = await resultsResponse.json();
      const newResults = {};
      results.forEach(r => {
        newResults[r.stage] = newResults[r.stage] || {};
        newResults[r.stage][r.match_index] = r.actual_winner;
      });
      
      // Проверяем, изменились ли результаты
      const hasChanges = JSON.stringify(bracketResults) !== JSON.stringify(newResults);
      
      if (hasChanges) {
        console.log('🔄 Обнаружены новые результаты, обновляем отображение');
        bracketResults = newResults;
        
        // Обновляем только окраску карточек без полной перерисовки
        updateMatchColors();
      }
    }
  } catch (error) {
    console.error('Ошибка обновления результатов:', error);
  }
}

// Обновить окраску карточек на основе результатов
function updateMatchColors() {
  const matches = document.querySelectorAll('.bracket-match-vertical');
  
  matches.forEach(match => {
    const stageId = match.dataset.stage;
    const matchIndex = parseInt(match.dataset.match);
    const prediction = bracketPredictions[stageId]?.[matchIndex];
    const actualWinner = bracketResults[stageId]?.[matchIndex];
    
    // Убираем старые классы
    match.classList.remove('bracket-match-correct', 'bracket-match-incorrect');
    
    // Добавляем новый класс если есть результат и прогноз
    if (actualWinner && prediction) {
      if (prediction === actualWinner) {
        match.classList.add('bracket-match-correct');
      } else {
        match.classList.add('bracket-match-incorrect');
      }
    }
  });
}


// Переключение видимости админских кнопок в сетке
function toggleBracketAdminButtons(event) {
  const container = document.getElementById('bracketAdminButtonsContainer');
  const btn = document.getElementById('bracketAdminSettingsBtn');
  
  if (container && btn) {
    const isOpen = container.style.display === 'flex';
    
    if (isOpen) {
      // Закрываем меню
      closeBracketAdminButtons();
      return;
    }
    
    // Открываем меню
    event.stopPropagation();
    
    // Сначала заполняем контейнер кнопками
    const isAutoLocked = isBracketClosed(currentBracket) && currentBracket.is_locked !== 1;
    const isManuallyLocked = currentBracket.is_locked === 1;
      
      let buttonsHTML = `
        <button class="btn-secondary" onclick="toggleBracketEditMode(); closeBracketAdminButtons();" style="padding: 8px; font-size: .9em;" title="Редактировать команды">
          ✏️
        </button>
      `;
      
      if (isEditingBracket) {
        buttonsHTML += `
          <button class="btn-secondary" onclick="openTeamFileSelector(); closeBracketAdminButtons();" style="padding: 8px; font-size: 1.2em;" title="Выбрать файл команд">
            📥
          </button>
          <button class="btn-secondary" onclick="cleanupBracketStages(); closeBracketAdminButtons();" style="padding: 8px; font-size: 1.2em;" title="Очистить последующие стадии">
            🧹
          </button>
        `;
      }
      
      buttonsHTML += `
        <button class="btn-secondary ${isAutoLocked ? 'disabled-look' : ''}" onclick="toggleBracketLock(); closeBracketAdminButtons();" style="padding: 8px; font-size: 1.2em; ${isAutoLocked ? 'opacity: 0.5; cursor: not-allowed;' : ''}" title="${isAutoLocked ? 'Нельзя разблокировать: плей-офф начался' : (isManuallyLocked ? 'Разблокировать сетку' : 'Заблокировать сетку')}">
          ${isManuallyLocked ? '🔓' : '🔒'}
        </button>
        <button class="btn-danger" onclick="deleteBracket(); closeBracketAdminButtons();" style="padding: 8px; font-size: 1.2em;" title="Удалить сетку">
          🗑️
        </button>
      `;
      
      container.innerHTML = buttonsHTML;
      container.style.display = 'flex';
      
      // Теперь вычисляем позицию после того как контейнер отрендерился
      const updatePosition = () => {
        const rect = btn.getBoundingClientRect();
        const containerHeight = container.offsetHeight;
        container.style.top = (rect.top - containerHeight - 8) + 'px';
        container.style.left = rect.left + 'px';
        
        const containerRect = container.getBoundingClientRect();
        if (containerRect.top < 0) {
          container.style.top = (rect.bottom + 8) + 'px';
        }
      };
      
      // Используем requestAnimationFrame чтобы дождаться рендеринга
      requestAnimationFrame(() => {
        updatePosition();
        // Добавляем анимацию появления
        setTimeout(() => {
          container.style.opacity = '1';
          container.style.transform = 'translateY(0)';
        }, 10);
      });
      
      container._updatePosition = updatePosition;
      
      const scrollHandler = () => {
        if (container.style.display === 'flex') {
          updatePosition();
        }
      };
      container._scrollHandler = scrollHandler;
      
      const bracketModal = document.getElementById('bracketModal');
      if (bracketModal) {
        bracketModal.addEventListener('scroll', scrollHandler);
      }
      window.addEventListener('scroll', scrollHandler);
      
      const clickHandler = (e) => {
        // Проверяем, что клик был не по кнопке настроек и не внутри контейнера
        if (!btn.contains(e.target) && !container.contains(e.target)) {
          closeBracketAdminButtons();
        }
      };
      container._clickHandler = clickHandler;
      // Добавляем обработчик с небольшой задержкой, чтобы не закрыть сразу после открытия
      setTimeout(() => {
        document.addEventListener('click', clickHandler, true); // true для capture phase
      }, 100);
  }
}

// Закрытие админских кнопок в сетке
function closeBracketAdminButtons() {
  const container = document.getElementById('bracketAdminButtonsContainer');
  if (container) {
    // Анимация закрытия
    container.style.opacity = '0';
    container.style.transform = 'translateY(-10px)';
    
    setTimeout(() => {
      container.style.display = 'none';
      
      if (container._scrollHandler) {
        const bracketModal = document.getElementById('bracketModal');
        if (bracketModal) {
          bracketModal.removeEventListener('scroll', container._scrollHandler);
        }
        window.removeEventListener('scroll', container._scrollHandler);
        delete container._scrollHandler;
        delete container._updatePosition;
      }
      
      if (container._clickHandler) {
        document.removeEventListener('click', container._clickHandler, true);
        delete container._clickHandler;
      }
    }, 200); // Ждем завершения анимации
  }
}


// Показать справку о сетке плей-офф
function showBracketHelp(event) {
  event.stopPropagation();
  
  const helpText = `
    <div style="text-align: left; line-height: 1.6;">
      <h3 style="margin-top: 0; color: #5a9fd4;">Что такое сетка плей-офф?</h3>
      <p>Сетка плей-офф нужна для того чтобы попытаться угадать какая команда пройдет до финала и победит, также для получения дополнительных очков</p>
      
      <h3 style="color: #5a9fd4;">Как это работает?</h3>
      <ul style="padding-left: 20px;">
        <li><strong>Прогнозируйте победителей</strong> — выберите команду, которая, по вашему мнению, выиграет матч и турнир</li>
        <li><strong>Следите за результатами</strong> — после завершения реальных матчей система автоматически проверит ваши прогнозы</li>
        <li><strong>Зарабатывайте очки</strong> — за каждый правильный прогноз вы получаете очки в турнире</li>
      </ul>
      
      <h3 style="color: #5a9fd4;">Важно знать:</h3>
      <ul style="padding-left: 20px;">
        <li>Прогнозы можно делать только до начала плей-офф</li>
        <li>После наступления даты сетка блокируется автоматически</li>
        <li>Чем дальше команда проходит по прогнозу, тем больше очков можно получить</li>
      </ul>
    </div>
  `;
  
  if (typeof showCustomAlert === 'function') {
    showCustomAlert(helpText, 'Сетка плей-офф', '❓');
  } else {
    alert('Сетка плей-офф — это турнирная таблица на выбывание. Прогнозируйте победителей матчей и зарабатывайте очки!');
  }
}

