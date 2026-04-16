// ===== МОДУЛЬ СЕТКИ ПЛЕЙ-ОФФ =====

import * as state from './state.js';
import {
  showCustomAlert,
  showCustomSaveConfirm,
  lockBodyScroll,
  unlockBodyScroll,
} from './ui.js';

// ===== ЛОКАЛЬНОЕ СОСТОЯНИЕ МОДУЛЯ =====
let currentBracket = null;
let bracketPredictions = {};
let bracketResults = {};
let bracketResultsInterval = null;
let isEditingBracket = false;
let hasUnsavedChanges = false;
let originalBracketMatches = null;
let isViewingOtherUserBracket = false;
let viewingUserId = null;
let shouldHideFutureStages = false;
let allTeams = [];
let bracketResizeTimeout;

// Структура стадий плей-офф
const BRACKET_STAGES = [
  { id: 'round_of_16', name: '1/16', matches: 16 },
  { id: 'round_of_8', name: '1/8', matches: 8 },
  { id: 'quarter_finals', name: '1/4', matches: 4 },
  { id: 'semi_finals', name: '1/2', matches: 2 },
  { id: 'final', name: '🏆 Финал', matches: 1 },
];

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====

function getFirstFilledStage(matches) {
  if (!matches) return null;
  const stageOrder = ['round_of_16', 'round_of_8', 'quarter_finals', 'semi_finals', 'final'];
  for (const stageId of stageOrder) {
    if (matches[stageId] && Object.keys(matches[stageId]).length > 0) {
      return stageId;
    }
  }
  return null;
}

function getStagesForBracket(startStage) {
  const startIndex = BRACKET_STAGES.findIndex(s => s.id === startStage);
  if (startIndex === -1) return BRACKET_STAGES;
  return BRACKET_STAGES.slice(startIndex);
}

function isBracketClosed(bracket, stageId = null) {
  if (!bracket) return false;
  const now = new Date();

  if (stageId && bracket.lock_dates && bracket.lock_dates[stageId]) {
    return now >= new Date(bracket.lock_dates[stageId]);
  }

  if (bracket.lock_dates) {
    const startStage = bracket.start_stage || 'round_of_16';
    const lockDate = bracket.lock_dates[startStage];
    if (lockDate) return now >= new Date(lockDate);
  }

  if (bracket.start_date) {
    return now >= new Date(bracket.start_date);
  }

  return false;
}

async function loadTeams(filePath = null) {
  try {
    const teamFilePath = filePath || currentBracket?.team_file || 'names/LeagueOfChampionsTeams.json';
    const response = await fetch(`/${teamFilePath}`);
    if (!response.ok) throw new Error('Ошибка загрузки команд');
    const data = await response.json();
    allTeams = Array.isArray(data) ? data : (data.teams || []);
    return allTeams;
  } catch (error) {
    console.error('Ошибка загрузки команд:', error);
    allTeams = [];
    return [];
  }
}

async function loadBracketsForEvent(eventId) {
  try {
    const response = await fetch(`/api/events/${eventId}/brackets`);
    if (!response.ok) throw new Error('Ошибка загрузки сеток');
    return await response.json();
  } catch (error) {
    console.error('Ошибка загрузки сеток:', error);
    return [];
  }
}

async function rebuildBracketFromPredictions() {
  const stageOrder = ['round_of_16', 'round_of_8', 'quarter_finals', 'semi_finals', 'final'];
  const lockDates = currentBracket?.lock_dates || {};
  const now = new Date();

  for (let i = 0; i < stageOrder.length - 1; i++) {
    const currentStageId = stageOrder[i];
    const nextStageId = stageOrder[i + 1];

    if (isViewingOtherUserBracket && lockDates[nextStageId]) {
      const stageLockDate = new Date(lockDates[nextStageId]);
      if (now < stageLockDate) continue;
    }

    if (bracketPredictions[currentStageId]) {
      Object.keys(bracketPredictions[currentStageId]).forEach(matchIndex => {
        const winner = bracketPredictions[currentStageId][matchIndex];
        const nextMatchIndex = Math.floor(matchIndex / 2);
        const teamPosition = matchIndex % 2;

        if (!currentBracket.matches) currentBracket.matches = {};
        if (!currentBracket.matches[nextStageId]) currentBracket.matches[nextStageId] = {};
        if (!currentBracket.matches[nextStageId][nextMatchIndex]) {
          currentBracket.matches[nextStageId][nextMatchIndex] = { team1: '', team2: '' };
        }

        const adminTeam1 = currentBracket.matches[nextStageId][nextMatchIndex]?.team1;
        const adminTeam2 = currentBracket.matches[nextStageId][nextMatchIndex]?.team2;

        if (teamPosition === 0 && !adminTeam1) {
          currentBracket.matches[nextStageId][nextMatchIndex].team1 = winner;
        } else if (teamPosition === 1 && !adminTeam2) {
          currentBracket.matches[nextStageId][nextMatchIndex].team2 = winner;
        }
      });
    }
  }
}

function startBracketResultsPolling() {
  stopBracketResultsPolling();
  bracketResultsInterval = setInterval(async () => {
    if (!currentBracket) return;
    try {
      const response = await fetch(`/api/brackets/${currentBracket.id}/results`);
      if (response.ok) {
        const results = await response.json();
        bracketResults = {};
        results.forEach(r => {
          bracketResults[r.stage] = bracketResults[r.stage] || {};
          bracketResults[r.stage][r.match_index] = r.actual_winner;
        });
      }
    } catch (error) {
      console.error('Ошибка обновления результатов сетки:', error);
    }
  }, 30000);
}

function stopBracketResultsPolling() {
  if (bracketResultsInterval) {
    clearInterval(bracketResultsInterval);
    bracketResultsInterval = null;
  }
}

function handleBracketResize() {
  clearTimeout(bracketResizeTimeout);
  bracketResizeTimeout = setTimeout(() => {
    if (window.innerWidth >= 600) {
      if (typeof drawBracketConnections === 'function') drawBracketConnections();
      if (typeof positionBracketTitles === 'function') positionBracketTitles();
    }
  }, 250);
}

function renderLockDatesFields(existingLockDates = {}) {
  const stageSelect = document.getElementById('bracketStartStage');
  const container = document.getElementById('lockDatesContainer');
  if (!stageSelect || !container) return;

  const startStage = stageSelect.value;
  const allStages = [
    { id: 'round_of_16', name: '1/16' },
    { id: 'round_of_8', name: '1/8' },
    { id: 'quarter_finals', name: '1/4' },
    { id: 'semi_finals', name: '1/2' },
    { id: 'final', name: '🏆 Финал' },
  ];

  const startIndex = allStages.findIndex(s => s.id === startStage);
  const stagesToShow = allStages.slice(startIndex);
  container.innerHTML = '';

  stagesToShow.forEach((stage, index) => {
    const isFirst = index === 0;
    const value = existingLockDates[stage.id] || '';
    container.insertAdjacentHTML('beforeend', `
      <div style="display: flex; align-items: center; gap: 10px;">
        <label style="min-width: 80px; font-weight: 500; color: ${isFirst ? '#5a9fd4' : '#b0b8c8'};">
          ${stage.name}:
        </label>
        <input
          type="datetime-local"
          id="lockDate_${stage.id}"
          data-stage="${stage.id}"
          value="${value}"
          ${isFirst ? 'required' : ''}
          style="flex: 1; padding: 8px; background: rgba(40, 44, 54, 0.9); border: 1px solid ${isFirst ? '#5a9fd4' : 'rgba(90, 159, 212, 0.3)'}; border-radius: 6px; color: #e0e6f0;"
          placeholder="${isFirst ? 'Обязательно' : 'Наследует от предыдущей'}"
        />
      </div>
    `);
  });
}

function openEditBracketModal(bracket) {
  const modal = document.getElementById('createBracketModal');
  if (!modal) {
    console.error('Модальное окно createBracketModal не найдено');
    return;
  }

  const nameInput = document.getElementById('bracketName');
  const stageSelect = document.getElementById('bracketStartStage');

  if (nameInput) nameInput.value = bracket.name;
  if (stageSelect) stageSelect.value = bracket.start_stage || 'round_of_16';

  const modalTitle = modal.querySelector('.modal-header h2');
  if (modalTitle) modalTitle.textContent = '✏️ Редактировать сетку плей-офф';

  if (stageSelect) {
    stageSelect.onchange = () => renderLockDatesFields(bracket.lock_dates || {});
    renderLockDatesFields(bracket.lock_dates || {});
  }

  modal.dataset.bracketId = bracket.id;
  modal.style.display = 'flex';
  modal.classList.add('active');
  lockBodyScroll();
}

// ===== ЭКСПОРТИРУЕМЫЕ ФУНКЦИИ =====

export async function openBracketModal(bracketId, viewUserId = null) {
  console.log('🔍 openBracketModal вызвана:', { bracketId, viewUserId });

  const targetUserId = viewUserId || (state.currentUser ? state.currentUser.id : null);

  if (!state.currentUser && !viewUserId) {
    console.error('❌ Нет авторизации');
    await showCustomAlert('Сначала войдите в аккаунт', 'Требуется авторизация', '🔒');
    return;
  }

  try {
    await loadTeams();

    const response = await fetch(`/api/brackets/${bracketId}`);
    if (!response.ok) throw new Error('Ошибка загрузки сетки');

    currentBracket = await response.json();
    isEditingBracket = false;

    // Синхронизируем с глобальным скоупом для js/bracket.js
    window.currentBracket = currentBracket;

    // Получаем иконку турнира
    let eventIcon = '🏆';
    if (currentBracket.event_id && state.events && state.events.length > 0) {
      const event = state.events.find(e => e.id === currentBracket.event_id);
      if (event && event.icon) eventIcon = event.icon;
    }
    currentBracket.eventIcon = eventIcon;

    // Загружаем прогнозы
    if (targetUserId) {
      const currentUserId = state.currentUser ? state.currentUser.id : null;
      const currentUsername = state.currentUser ? state.currentUser.username : null;
      const params = new URLSearchParams();
      if (currentUserId) params.append('viewerId', currentUserId);
      if (currentUsername) params.append('viewerUsername', currentUsername);
      const url = `/api/brackets/${bracketId}/predictions/${targetUserId}${params.toString() ? `?${params.toString()}` : ''}`;
      const predictionsResponse = await fetch(url);

      if (predictionsResponse.ok) {
        const data = await predictionsResponse.json();

        if (data.hidden) {
          await showCustomAlert(
            data.message || 'Пользователь скрыл свои прогнозы',
            'Прогнозы скрыты',
            '🔒'
          );
          return;
        }

        const predictions = data.predictions || data;
        shouldHideFutureStages = data.hideUnstartedStages || false;
        bracketPredictions = {};
        predictions.forEach(p => {
          bracketPredictions[p.stage] = bracketPredictions[p.stage] || {};
          bracketPredictions[p.stage][p.match_index] = p.predicted_winner;
        });

        await rebuildBracketFromPredictions();
      } else {
        bracketPredictions = {};
      }
    } else {
      bracketPredictions = {};
    }

    // Загружаем результаты матчей
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

    const isClosed = isBracketClosed(currentBracket);
    const isViewMode = viewUserId && viewUserId !== (state.currentUser ? state.currentUser.id : null);
    isViewingOtherUserBracket = isViewMode;
    window.isViewingOtherUserBracket = isViewMode;
    viewingUserId = viewUserId;
    window.viewingUserId = viewUserId;

    // Синхронизируем данные с js/bracket.js
    window.bracketPredictions = bracketPredictions;
    window.bracketResults = bracketResults;
    window.shouldHideFutureStages = shouldHideFutureStages;

    if (typeof renderBracketModal === 'function') {
      renderBracketModal(isClosed);
    }

    const modal = document.getElementById('bracketModal');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');

      if (isViewMode) {
        const modalTitle = modal.querySelector('.modal-header h2');
        if (modalTitle) {
          const username = window.viewingUserBracketName || 'Пользователь';
          let eventIconHtml = '🏆';
          if (currentBracket.eventIcon) {
            if (currentBracket.eventIcon.startsWith('img/') || currentBracket.eventIcon.startsWith('http')) {
              eventIconHtml = `<img src="${currentBracket.eventIcon}" alt="icon" style="width: 24px; height: 24px; vertical-align: middle; margin-right: 8px;" />`;
            } else {
              eventIconHtml = currentBracket.eventIcon + ' ';
            }
          }
          modalTitle.innerHTML = `${eventIconHtml}Прогнозы: ${username}`;
          window.viewingUserBracketName = null;
        }
      }

      startBracketResultsPolling();
      window.addEventListener('resize', handleBracketResize);
    }

    lockBodyScroll();
  } catch (error) {
    console.error('Ошибка при открытии сетки:', error);
    await showCustomAlert('Не удалось загрузить сетку', 'Ошибка', '❌');
  }
}

export async function closeBracketModal() {
  if (hasUnsavedChanges && isEditingBracket) {
    const action = await showCustomSaveConfirm(
      'У вас есть несохраненные изменения!\n\nЧто вы хотите сделать?',
      'Несохраненные изменения',
      '⚠️'
    );

    if (action === 'cancel') return;

    if (action === 'save') {
      if (typeof saveBracketTeams === 'function') await saveBracketTeams();
    } else if (action === 'discard') {
      if (originalBracketMatches) {
        currentBracket.matches = JSON.parse(JSON.stringify(originalBracketMatches));
      }
    }
  }

  const modal = document.getElementById('bracketModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
    unlockBodyScroll();
  }

  stopBracketResultsPolling();
  window.removeEventListener('resize', handleBracketResize);

  currentBracket = null;
  window.currentBracket = null;
  bracketPredictions = {};
  bracketResults = {};
  isEditingBracket = false;
  hasUnsavedChanges = false;
  originalBracketMatches = null;
  isViewingOtherUserBracket = false;
  viewingUserId = null;
  shouldHideFutureStages = false;
}

export async function openCreateBracketModal() {
  console.log('openCreateBracketModal вызвана');

  if (!state.currentUser) {
    await showCustomAlert('Сначала войдите в аккаунт', 'Требуется авторизация', '🔒');
    return;
  }

  if (!state.currentUser.isAdmin) {
    await showCustomAlert('Доступ запрещен', 'Ошибка', '🚫');
    return;
  }

  if (!state.currentEventId) {
    await showCustomAlert('Сначала выберите турнир', 'Ошибка', '⚠️');
    return;
  }

  // Проверяем, есть ли уже сетка для этого турнира
  try {
    const brackets = await loadBracketsForEvent(state.currentEventId);
    if (brackets && brackets.length > 0) {
      openEditBracketModal(brackets[0]);
      return;
    }
  } catch (err) {
    console.error('Ошибка проверки существующих сеток:', err);
  }

  const modal = document.getElementById('createBracketModal');
  if (!modal) {
    console.error('Модальное окно createBracketModal не найдено');
    return;
  }

  const nameInput = document.getElementById('bracketName');
  const stageSelect = document.getElementById('bracketStartStage');

  if (nameInput) nameInput.value = '';
  if (stageSelect) stageSelect.value = 'round_of_16';

  const modalTitle = modal.querySelector('.modal-header h2');
  if (modalTitle) modalTitle.textContent = '➕ Создать сетку плей-офф';

  if (stageSelect) {
    stageSelect.onchange = renderLockDatesFields;
    renderLockDatesFields();
  }

  modal.style.display = 'flex';
  modal.classList.add('active');
  lockBodyScroll();
}

export function closeCreateBracketModal() {
  const modal = document.getElementById('createBracketModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
    unlockBodyScroll();
  }
}

export async function createBracket() {
  if (!state.currentUser || !state.currentUser.isAdmin) return;

  const modal = document.getElementById('createBracketModal');
  const bracketId = modal?.dataset.bracketId;
  const isEdit = !!bracketId;

  const name = document.getElementById('bracketName')?.value.trim();
  const startStage = document.getElementById('bracketStartStage')?.value;

  // Собираем даты блокировки
  const lockDates = {};
  const lockDateInputs = document.querySelectorAll('[id^="lockDate_"]');
  lockDateInputs.forEach(input => {
    const stage = input.dataset.stage;
    const value = input.value;
    if (value) lockDates[stage] = value;
  });

  // Проверяем первую дату
  const firstStageInput = document.querySelector(`#lockDate_${startStage}`);
  if (!firstStageInput || !firstStageInput.value) {
    await showCustomAlert('Укажите дату блокировки для первой колонки', 'Ошибка', '❌');
    return;
  }

  const startDate = firstStageInput.value;

  if (!name) {
    await showCustomAlert('Введите название сетки', 'Ошибка', '❌');
    return;
  }

  try {
    const url = isEdit ? `/api/admin/brackets/${bracketId}` : '/api/admin/brackets';
    const method = isEdit ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: state.currentEventId,
        name,
        start_date: startDate,
        start_stage: startStage,
        lock_dates: lockDates,
        username: state.currentUser.username,
      }),
    });

    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error('Сервер вернул некорректный ответ: ' + responseText.substring(0, 100));
    }

    if (!response.ok) {
      throw new Error(result.error || `Ошибка ${isEdit ? 'обновления' : 'создания'} сетки`);
    }

    await showCustomAlert(
      `Сетка успешно ${isEdit ? 'обновлена' : 'создана'}!`,
      'Успех',
      '✅'
    );

    if (modal) delete modal.dataset.bracketId;
    closeCreateBracketModal();

    if (typeof displayMatches === 'function') displayMatches();
  } catch (error) {
    console.error(`Ошибка при ${isEdit ? 'обновлении' : 'создании'} сетки:`, error);
    await showCustomAlert(error.message, 'Ошибка', '❌');
  }
}
