import * as state from './state.js';
import { lockBodyScroll, unlockBodyScroll, showCustomAlert, showCustomConfirm } from './ui.js';
import { loadMatches, displayMatches } from './matches.js';

// ===== СЛОВАРЬ КОМАНД ДЛЯ МАТЧЕЙ =====

export let matchTeamsList = [];
export let selectedMatchTeamFile = localStorage.getItem('selectedMatchTeamFile') || '/names/LeagueOfChampionsTeams.json';

export async function loadMatchTeams(filePath) {
  try {
    const response = await fetch(filePath || selectedMatchTeamFile);
    if (!response.ok) throw new Error('Не удалось загрузить файл');
    const contentType = response.headers.get('content-type');
    const fileExtension = (filePath || selectedMatchTeamFile).split('.').pop().toLowerCase();
    let data;
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      if (fileExtension === 'js') {
        matchTeamsList = [];
        const constMatch = text.match(/(?:const|let|var)\s+\w+\s*=\s*\{([^}]+)\}/);
        if (constMatch) {
          const content = constMatch[1];
          matchTeamsList = content.split(',').map(item => item.trim()).filter(item => item && !item.startsWith('//'));
        } else {
          const arrayMatch = text.match(/(?:const|let|var)\s+\w+\s*=\s*\[([^\]]+)\]/);
          if (arrayMatch) {
            const content = arrayMatch[1];
            matchTeamsList = content.split(',').map(item => item.trim().replace(/['"]/g, '')).filter(item => item && !item.startsWith('//'));
          }
        }
        if (filePath) { selectedMatchTeamFile = filePath; localStorage.setItem('selectedMatchTeamFile', filePath); }
        return matchTeamsList;
      }
      try { data = JSON.parse(text); } catch (e) {
        matchTeamsList = text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//') && !line.startsWith('#'));
        if (filePath) { selectedMatchTeamFile = filePath; localStorage.setItem('selectedMatchTeamFile', filePath); }
        return matchTeamsList;
      }
    }
    matchTeamsList = [];
    if (data.teams_by_status) {
      Object.values(data.teams_by_status).forEach(status => {
        if (status.teams && Array.isArray(status.teams)) {
          status.teams.forEach(team => { if (team.name) matchTeamsList.push(team.name); });
        }
      });
    } else if (data.teams && typeof data.teams === 'object' && !Array.isArray(data.teams)) {
      matchTeamsList = Object.keys(data.teams);
    } else if (data.teams && Array.isArray(data.teams)) {
      matchTeamsList = data.teams.map(t => typeof t === 'string' ? t : t.name).filter(Boolean);
    } else if (Array.isArray(data)) {
      matchTeamsList = data.filter(item => typeof item === 'string' && item.trim());
    }
    if (filePath) { selectedMatchTeamFile = filePath; localStorage.setItem('selectedMatchTeamFile', filePath); }
    return matchTeamsList;
  } catch (error) {
    console.error('Ошибка загрузки команд:', error);
    matchTeamsList = [];
    return [];
  }
}

export async function openMatchTeamFileSelector(mode) {
  try {
    const response = await fetch('/api/team-files');
    if (!response.ok) throw new Error('Не удалось загрузить список файлов');
    const files = await response.json();
    if (!files || files.length === 0) { await showCustomAlert('Не найдено файлов команд в папке names', "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>'); return; }
    const currentFile = selectedMatchTeamFile;
    const fileListHtml = files.map(file => {
      const isSelected = file.path === currentFile;
      const icon = file.name.endsWith('.json') ? '<svg class="icon" aria-hidden="true"><use href="#icon-manual"></use></svg>' : file.name.endsWith('.txt') ? '<svg class="icon" aria-hidden="true"><use href="#icon-manual"></use></svg>' : '<svg class="icon" aria-hidden="true"><use href="#icon-earlier"></use></svg>';
      return `<div class="team-file-item ${isSelected ? 'selected' : ''}" onclick="selectMatchTeamFile('${file.path}', '${mode}')" style="padding: 12px; margin: 8px 0; background: ${isSelected ? 'rgba(90, 159, 212, 0.2)' : 'rgba(40, 44, 54, 0.5)'}; border: 1px solid ${isSelected ? 'rgba(90, 159, 212, 0.5)' : 'rgba(90, 159, 212, 0.2)'}; border-radius: 8px; cursor: pointer; transition: all 0.2s;"><div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 1.5em;">${icon}</span><div style="flex: 1;"><div style="font-weight: 500; color: #e0e6f0;">${file.name}</div><div style="font-size: 0.85em; color: #b0b8c8; margin-top: 2px;">${file.path}</div></div>${isSelected ? '<span style="color: #4caf50; font-size: 1.2em;"><svg class="icon" aria-label="Правильно"><use href="#icon-correct"></use></svg></span>' : ''}</div></div>`;
    }).join('');
    const modalHtml = `<div id="matchTeamFileSelectorModal" class="modal" style="display: flex;" onclick="closeMatchTeamFileSelector()"><div class="modal-content" onclick="event.stopPropagation()" style="max-width: 600px; max-height: 80vh; overflow-y: auto;"><div class="modal-header"><h2><svg class="icon" aria-label="Импорт"><use href="#icon-import"></use></svg> Выбор файла команд</h2><button class="modal-close" onclick="closeMatchTeamFileSelector()">&times;</button></div><div style="padding: 20px;"><p style="color: #b0b8c8; margin-bottom: 15px;">Выберите файл с командами для автодополнения:</p>${fileListHtml}</div></div></div>`;
    const existingModal = document.getElementById('matchTeamFileSelectorModal');
    if (existingModal) existingModal.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    lockBodyScroll();
  } catch (error) {
    console.error('Ошибка при открытии выбора файла:', error);
    await showCustomAlert('Не удалось загрузить список файлов', "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

export async function selectMatchTeamFile(filePath, mode) {
  try {
    await loadMatchTeams(filePath);
    closeMatchTeamFileSelector();
    hideSuggestions('matchTeam1');
    hideSuggestions('matchTeam2');
    hideSuggestions('editMatchTeam1');
    hideSuggestions('editMatchTeam2');
    if (mode === 'create') {
      initTeamAutocomplete('matchTeam1');
      initTeamAutocomplete('matchTeam2');
    } else if (mode === 'edit') {
      initTeamAutocomplete('editMatchTeam1');
      initTeamAutocomplete('editMatchTeam2');
    }
    if (matchTeamsList.length > 0) {
      await showCustomAlert(`Файл команд изменен на: ${filePath.split('/').pop()}\nЗагружено команд: ${matchTeamsList.length}`, "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>');
    } else {
      await showCustomAlert(`Файл команд изменен на: ${filePath.split('/').pop()}\nНе удалось загрузить команды из этого файла`, "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error('Ошибка при выборе файла команд:', error);
    await showCustomAlert('Не удалось загрузить файл команд', "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

export function closeMatchTeamFileSelector() {
  const modal = document.getElementById('matchTeamFileSelectorModal');
  if (modal) modal.remove();
  unlockBodyScroll();
}

export function initTeamAutocomplete(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const suggestionsId = `${inputId}Suggestions`;
  let selectedIndex = -1;
  let isMouseOverSuggestions = false;
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  const suggestionsDiv = document.getElementById(suggestionsId);
  if (suggestionsDiv) {
    suggestionsDiv.addEventListener('mouseenter', () => { isMouseOverSuggestions = true; });
    suggestionsDiv.addEventListener('mouseleave', () => { isMouseOverSuggestions = false; });
  }
  newInput.addEventListener('input', function() {
    const value = this.value.trim().toLowerCase();
    const suggestionsDiv = document.getElementById(suggestionsId);
    if (!value || matchTeamsList.length === 0) { hideSuggestions(inputId); return; }
    const filtered = matchTeamsList.filter(team => team.toLowerCase().includes(value)).slice(0, 10);
    if (filtered.length === 0) { hideSuggestions(inputId); return; }
    selectedIndex = -1;
    suggestionsDiv.innerHTML = filtered.map((team, index) =>
      `<div class="team-suggestion-item" data-index="${index}" onclick="selectTeam('${inputId}', '${team.replace(/'/g, "\\'")}')">${team}</div>`
    ).join('');
    suggestionsDiv.style.display = 'block';
  });
  newInput.addEventListener('focus', function() {
    if (this.value.trim() && matchTeamsList.length > 0) this.dispatchEvent(new Event('input'));
  });
  newInput.addEventListener('keydown', function(e) {
    const suggestionsDiv = document.getElementById(suggestionsId);
    const items = suggestionsDiv.querySelectorAll('.team-suggestion-item');
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = Math.min(selectedIndex + 1, items.length - 1); updateSelectedItem(items, selectedIndex); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = Math.max(selectedIndex - 1, -1); updateSelectedItem(items, selectedIndex); }
    else if (e.key === 'Tab' || e.key === 'Enter') {
      if (selectedIndex >= 0 && selectedIndex < items.length) { e.preventDefault(); items[selectedIndex].click(); }
      else if (items.length === 1) { e.preventDefault(); items[0].click(); }
    } else if (e.key === 'Escape') { hideSuggestions(inputId); }
  });
  newInput.addEventListener('blur', function() {
    setTimeout(() => { if (!isMouseOverSuggestions) hideSuggestions(inputId); }, 200);
  });
}

export function updateSelectedItem(items, index) {
  items.forEach((item, i) => {
    if (i === index) { item.classList.add('active'); item.scrollIntoView({ block: 'nearest' }); }
    else item.classList.remove('active');
  });
}

export function selectTeam(inputId, teamName) {
  const input = document.getElementById(inputId);
  if (input) { input.value = teamName; hideSuggestions(inputId); }
}

export function hideSuggestions(inputId) {
  const suggestionsDiv = document.getElementById(`${inputId}Suggestions`);
  if (suggestionsDiv) { suggestionsDiv.style.display = 'none'; suggestionsDiv.innerHTML = ''; }
}

export async function toggleTeamDropdown(inputId, event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const suggestionsDiv = document.getElementById(`${inputId}Suggestions`);
  const input = document.getElementById(inputId);
  if (!suggestionsDiv || !input) return;
  if (suggestionsDiv.style.display === 'block') { hideSuggestions(inputId); return; }
  if (matchTeamsList.length === 0) { await showCustomAlert('Сначала загрузите файл команд', "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'); return; }
  suggestionsDiv.innerHTML = matchTeamsList.map((team, index) =>
    `<div class="team-suggestion-item" data-index="${index}" onclick="selectTeam('${inputId}', '${team.replace(/'/g, "\\'")}')">${team}</div>`
  ).join('');
  suggestionsDiv.style.display = 'block';
  input.focus();
}

// ===== ЗАГРУЗКА ТУРОВ ДЛЯ МОДАЛЬНОГО ОКНА =====

export async function loadRoundsForModal(modalType, eventId) {
  try {
    const response = await fetch(`/api/admin/events/${eventId}/rounds`);
    const rounds = await response.json();
    const selectId = modalType === 'create' ? 'matchRoundSelect' : 'editMatchRoundSelect';
    const selectElement = document.getElementById(selectId);
    while (selectElement.options.length > 1) selectElement.remove(1);
    rounds.forEach(round => {
      const option = document.createElement('option');
      option.value = round;
      option.textContent = round;
      selectElement.appendChild(option);
    });
  } catch (error) {
    console.error('Ошибка при загрузке туров:', error);
  }
}

export function selectExistingRound(modalType) {
  const selectId = modalType === 'create' ? 'matchRoundSelect' : 'editMatchRoundSelect';
  const inputId = modalType === 'create' ? 'matchRound' : 'editMatchRound';
  const selectElement = document.getElementById(selectId);
  const inputElement = document.getElementById(inputId);
  if (selectElement.value) inputElement.value = selectElement.value;
}

// ===== СОЗДАНИЕ МАТЧА =====

export async function openCreateMatchModal() {
  if (!state.currentUser) { await showCustomAlert('Сначала войдите в систему', "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'); return; }
  if (!canCreateMatches()) { await showCustomAlert('У вас нет прав для создания матчей', "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'); return; }
  if (!state.currentEventId) { await showCustomAlert('Пожалуйста, сначала выберите турнир', "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'); return; }

  document.getElementById('createMatchForm').reset();
  document.getElementById('matchIsFinal').checked = false;
  document.getElementById('finalMatchParamsCreate').style.display = 'none';
  document.getElementById('matchRound').disabled = false;
  document.getElementById('showExactScore').checked = false;
  document.getElementById('showYellowCards').checked = false;
  document.getElementById('showRedCards').checked = false;
  document.getElementById('showCorners').checked = false;
  document.getElementById('showPenaltiesInGame').checked = false;
  document.getElementById('showExtraTime').checked = false;
  document.getElementById('showPenaltiesAtEnd').checked = false;
  document.getElementById('showGoalDifference').checked = false;

  loadRoundsForModal('create', state.currentEventId);

  const currentEvent = state.events.find(e => e.id === state.currentEventId);
  const eventTeamFile = currentEvent?.team_file || selectedMatchTeamFile;
  await loadMatchTeams(eventTeamFile);
  initTeamAutocomplete('matchTeam1');
  initTeamAutocomplete('matchTeam2');

  const modal = document.getElementById('createMatchModal');
  if (modal) { lockBodyScroll(); modal.style.display = 'flex'; }
}

export function closeCreateMatchModal() {
  const modal = document.getElementById('createMatchModal');
  modal.style.display = 'none';
  unlockBodyScroll();
  document.getElementById('createMatchForm').reset();
  document.getElementById('matchIsFinal').checked = false;
  document.getElementById('finalMatchParamsCreate').style.display = 'none';
  document.getElementById('matchRound').disabled = false;
  hideSuggestions('matchTeam1');
  hideSuggestions('matchTeam2');
}

function capitalizeTeamName(name) {
  if (!name) return name;
  return name.trim().split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

export async function submitCreateMatch(event) {
  event.preventDefault();
  let team1 = capitalizeTeamName(document.getElementById('matchTeam1').value.trim());
  let team2 = capitalizeTeamName(document.getElementById('matchTeam2').value.trim());
  const matchDate = document.getElementById('matchDate').value;
  let round = document.getElementById('matchRound').value.trim();
  const copies = parseInt(document.getElementById('matchCopies').value) || 1;
  const isFinal = document.getElementById('matchIsFinal').checked;
  const scorePredictionEnabled = document.getElementById('matchScorePrediction').checked;
  const yellowCardsPredictionEnabled = document.getElementById('matchYellowCardsPrediction').checked;
  const redCardsPredictionEnabled = document.getElementById('matchRedCardsPrediction').checked;
  if (isFinal) round = '🏆 Финал';
  const showExactScore = document.getElementById('showExactScore').checked;
  const showYellowCards = document.getElementById('showYellowCards').checked;
  const showRedCards = document.getElementById('showRedCards').checked;
  const showCorners = document.getElementById('showCorners').checked;
  const showPenaltiesInGame = document.getElementById('showPenaltiesInGame').checked;
  const showExtraTime = document.getElementById('showExtraTime').checked;
  const showPenaltiesAtEnd = document.getElementById('showPenaltiesAtEnd').checked;
  const showGoalDifference = document.getElementById('showGoalDifference').checked;
  if (!team1 || !team2) { await showCustomAlert('Пожалуйста, введите обе команды', "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'); return; }
  if (!state.currentEventId) { await showCustomAlert('Турнир не выбран', "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>'); return; }
  const copiesCount = Math.min(Math.max(copies, 1), 20);
  try {
    let created = 0;
    let lastError = null;
    let matchDateUTC = null;
    if (matchDate) {
      const localDate = new Date(matchDate);
      matchDateUTC = localDate.toISOString();
      console.log(`✅ Конвертация времени: ${matchDate} (локальное) → ${matchDateUTC} (UTC)`);
    }
    for (let i = 0; i < copiesCount; i++) {
      const response = await fetch('/api/admin/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: state.currentUser.username,
          event_id: state.currentEventId,
          team1, team2,
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
          show_goal_difference: showGoalDifference,
        }),
      });
      const result = await response.json();
      if (!response.ok) lastError = result.error;
      else created++;
    }
    if (created === 0 && lastError) { alert('Ошибка: ' + lastError); return; }
    closeCreateMatchModal();
    loadMatches(state.currentEventId);
  } catch (error) {
    console.error('Ошибка при создании матча:', error);
    alert('Ошибка при создании матча: ' + error.message);
  }
}

// ===== ИМПОРТ МАТЧЕЙ =====

export function openImportMatchesModal() {
  const importEventSelect = document.getElementById('importEventId');
  importEventSelect.innerHTML = '<option value="">-- Выберите турнир --</option>';
  state.events.forEach(event => {
    const option = document.createElement('option');
    option.value = event.id;
    option.textContent = event.name;
    importEventSelect.appendChild(option);
  });
  updateImportSeparatorPreview();
  lockBodyScroll();
  document.getElementById('importMatchesModal').style.display = 'flex';
}

export function closeImportMatchesModal() {
  document.getElementById('importMatchesModal').style.display = 'none';
  unlockBodyScroll();
  document.getElementById('importMatchesData').value = '';
  document.getElementById('importEventId').value = '';
}

export function updateImportSeparatorPreview() {
  const separatorSelect = document.getElementById('importSeparator');
  const separator = separatorSelect.value;
  const selectedOption = separatorSelect.options[separatorSelect.selectedIndex];
  const separatorDescription = selectedOption.getAttribute('data-description') || 'обратный слэш';
  const textarea = document.getElementById('importMatchesData');
  const separatorPreview = document.getElementById('separatorPreview');
  const instructionFormat = document.getElementById('instructionFormat');
  let separatorLabel = '\\';
  let example1 = 'Manchester \\ Liverpool | 20.12.2025 18:00 | Тур 1';
  let example2 = 'Real Madrid \\ Barcelona | 21.12.2025 20:00 | Тур 1';
  let formatExample = 'Команда1 \\ Команда2 | Дата | Тур';
  if (separator === '-') {
    separatorLabel = '-';
    example1 = 'Manchester - Liverpool | 20.12.2025 18:00 | Тур 1';
    example2 = 'Real Madrid - Barcelona | 21.12.2025 20:00 | Тур 1';
    formatExample = 'Команда1 - Команда2 | Дата | Тур';
  } else if (separator === 'vs') {
    separatorLabel = 'vs';
    example1 = 'Manchester vs Liverpool | 20.12.2025 18:00 | Тур 1';
    example2 = 'Real Madrid vs Barcelona | 21.12.2025 20:00 | Тур 1';
    formatExample = 'Команда1 vs Команда2 | Дата | Тур';
  }
  if (separatorPreview) separatorPreview.textContent = separatorLabel;
  if (instructionFormat) instructionFormat.textContent = formatExample;
  if (textarea) textarea.placeholder = `${example1}\n${example2}`;
}

export async function submitImportMatches(event) {
  event.preventDefault();
  const importData = document.getElementById('importMatchesData').value.trim();
  const eventId = document.getElementById('importEventId').value;
  const includeDates = document.getElementById('importIncludeDate').checked;
  const separator = document.getElementById('importSeparator').value;
  if (!eventId) { await showCustomAlert('Выберите турнир', "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'); return; }
  if (!importData) { await showCustomAlert('Введите данные матчей', "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'); return; }
  const lines = importData.split('\n').filter(line => line.trim());
  const matches = [];
  const errors = [];
  lines.forEach((line, index) => {
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 1 || !parts[0]) { errors.push(`Строка ${index + 1}: Не указаны команды`); return; }
    const teamsPart = parts[0];
    const datePart = includeDates ? parts[1] || '' : '';
    const roundPart = includeDates ? parts[2] || '' : parts[1] || '';
    let teams;
    if (separator === '\\') teams = teamsPart.split(/\s*\\\s*/);
    else if (separator === '-') teams = teamsPart.split(/\s*-\s*/);
    else if (separator === 'vs') teams = teamsPart.split(/\s+vs\s+/i);
    else teams = teamsPart.split(/\s*\\\s*/);
    if (teams.length < 1 || !teams[0].trim()) { errors.push(`Строка ${index + 1}: Не указана первая команда`); return; }
    const team1 = teams[0].trim();
    const team2 = teams.length > 1 ? teams[1].trim() : null;
    if (!team2) { errors.push(`Строка ${index + 1}: Не указана вторая команда`); return; }
    let matchDate = null;
    if (includeDates && datePart) {
      const dateRegex = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/;
      const dateMatch = datePart.match(dateRegex);
      if (dateMatch) {
        const [, day, month, year, hour, minute] = dateMatch;
        matchDate = `${year}-${month}-${day}T${hour}:${minute}`;
      } else {
        errors.push(`Строка ${index + 1}: Неправильный формат даты (используйте ДД.ММ.YYYY ЧЧ:MM)`);
        return;
      }
    }
    matches.push({ team1_name: team1, team2_name: team2, match_date: matchDate, round: roundPart || null, event_id: parseInt(eventId) });
  });
  if (errors.length > 0) { alert('Ошибки при импорте:\n\n' + errors.join('\n')); return; }
  if (matches.length === 0) { await showCustomAlert('Не найдено ни одного матча для импорта', "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>'); return; }
  try {
    const response = await fetch('/api/matches/bulk-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matches }),
    });
    if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'Ошибка при импорте'); }
    await showCustomAlert(`Успешно импортировано ${matches.length} матчей`, "Успех", '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');
    closeImportMatchesModal();
    if (state.currentEventId) loadMatches(state.currentEventId);
  } catch (error) {
    console.error('Ошибка при импорте матчей:', error);
    await showCustomAlert(`Ошибка при импорте: ${error.message}`, "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// ===== ПАРСИНГ МАТЧЕЙ =====

// Открыть модальное окно парсинга матчей
export async function openBulkParseModal() {
  if (!state.currentEventId) {
    await showCustomAlert('Сначала выберите турнир', "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  // Получаем текущий турнир
  const currentEvent = state.events.find(e => e.id === state.currentEventId);
  if (!currentEvent) {
    await showCustomAlert('Не удалось определить текущий турнир', "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  // Определяем код турнира по иконке
  const tournamentCode = ICON_TO_COMPETITION[currentEvent.icon];
  if (!tournamentCode) {
    await showCustomAlert(`Парсинг не поддерживается для турнира "${currentEvent.name}". Поддерживаются только турниры с иконками: Champions League, Europa League, Conference League, Premier League, Bundesliga, La Liga, Serie A, Ligue 1, RPL`, "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>');
    return;
  }

  document.getElementById('bulkParseModal').style.display = 'flex';
  lockBodyScroll();

  // Устанавливаем код турнира по иконке
  document.getElementById('parseCompetition').value = tournamentCode;

  // Сбрасываем форму
  document.getElementById('parseDateFrom').value = '';
  document.getElementById('parseDateTo').value = '';
  document.getElementById('parseRound').value = '';
  document.getElementById('parsePreviewContainer').style.display = 'none';
  document.getElementById('bulkParseSubmitBtn').disabled = true;
  parsedMatches = [];
}

// Закрыть модальное окно парсинга
export function closeBulkParseModal() {
  document.getElementById('bulkParseModal').style.display = 'none';
  unlockBodyScroll();
  parsedMatches = [];
}

// ===== МАССОВОЕ РЕДАКТИРОВАНИЕ ДАТ =====

export async function openBulkEditDatesModal() {
  if (!state.currentEventId) { await showCustomAlert('Выберите турнир', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'); return; }
  document.getElementById('bulkEditDatesModal').style.display = 'flex';
  lockBodyScroll();
  const uniqueRounds = [...new Set(state.matches.map(m => m.round).filter(r => r && r.trim()))];
  const roundSelect = document.getElementById('bulkEditRoundFilter');
  roundSelect.innerHTML = '<option value="">Все матчи</option>';
  uniqueRounds.forEach(round => { roundSelect.innerHTML += `<option value="${round}">${round}</option>`; });
  await loadBulkEditMatches();
}

export function closeBulkEditDatesModal() {
  document.getElementById('bulkEditDatesModal').style.display = 'none';
  unlockBodyScroll();
}

export async function loadBulkEditMatches() {
  const container = document.getElementById('bulkEditMatchesList');
  const roundFilter = document.getElementById('bulkEditRoundFilter').value;
  let filteredMatches = state.matches;
  if (roundFilter) filteredMatches = state.matches.filter(m => m.round === roundFilter);
  if (filteredMatches.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #b0b8c8;">Нет матчей для отображения</div>';
    return;
  }
  const sortedMatches = [...filteredMatches].sort((a, b) => {
    if (!a.match_date) return 1;
    if (!b.match_date) return -1;
    return new Date(a.match_date) - new Date(b.match_date);
  });
  let html = `<table style="width: 100%; border-collapse: collapse;"><thead><tr style="background: rgba(56, 118, 235, 0.2); border-bottom: 2px solid rgba(56, 118, 235, 0.5);"><th style="padding: 12px; text-align: left; color: #e0e6f0; font-weight: 600;">Матч</th><th style="padding: 12px; text-align: left; color: #e0e6f0; font-weight: 600; min-width: 220px;">Дата и время</th></tr></thead><tbody>`;
  sortedMatches.forEach(match => {
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
    html += `<tr style="border-bottom: 1px solid rgba(90, 159, 212, 0.2);"><td style="padding: 12px; color: #e0e6f0;"><div style="font-weight: 500;">${match.team1_name} vs ${match.team2_name}</div>${match.round ? `<div style="font-size: 0.85em; color: #b0b8c8; margin-top: 4px;">${match.round}</div>` : ''}</td><td style="padding: 12px;"><input type="datetime-local" class="bulk-edit-date-input" data-match-id="${match.id}" value="${dateValue}" style="width: 100%; padding: 8px; font-size: 0.9em; background: rgba(40, 44, 54, 0.8); border: 1px solid rgba(90, 159, 212, 0.3); border-radius: 4px; color: #e0e6f0;" /></td></tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

export async function saveBulkEditDates() {
  const inputs = document.querySelectorAll('.bulk-edit-date-input');
  const updates = [];
  inputs.forEach(input => {
    const matchId = parseInt(input.dataset.matchId);
    const dateValue = input.value;
    if (dateValue) updates.push({ match_id: matchId, match_date: dateValue });
  });
  if (updates.length === 0) { await showCustomAlert('Нет дат для сохранения', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'); return; }
  const saveBtn = document.getElementById('bulkEditSaveBtn');
  const originalText = saveBtn.textContent;
  try {
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ Сохранение...';
    const response = await fetch('/api/matches/bulk-update-dates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates, username: state.currentUser.username }),
    });
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('Сервер вернул не JSON:', text);
      throw new Error('Сервер вернул некорректный ответ');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Ошибка при сохранении');
    await showCustomAlert(`Успешно обновлено дат: ${result.updatedCount}`, 'Успех', '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');
    closeBulkEditDatesModal();
    await loadMatches(state.currentEventId);
  } catch (error) {
    console.error('Ошибка при сохранении дат:', error);
    await showCustomAlert(`Ошибка при сохранении: ${error.message}`, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

// ===== ПАРСИНГ МАТЧЕЙ =====

export let parsedMatches = [];
let moduleTeamTranslations = {};

// Маппинг иконок турниров на коды для API
export const ICON_TO_COMPETITION = {
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
  '🇳🇱': 'DED'
};

// Загрузить превью спарсенных матчей
export async function loadParsePreview() {
  const competition = document.getElementById('parseCompetition').value;
  const dateFrom = document.getElementById('parseDateFrom').value;
  const dateTo = document.getElementById('parseDateTo').value;
  const includeFuture = document.getElementById('parseIncludeFuture').checked;

  if (!competition || !dateFrom || !dateTo) {
    await showCustomAlert('Заполните все обязательные поля', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  if (new Date(dateFrom) > new Date(dateTo)) {
    await showCustomAlert('Дата начала не может быть позже даты окончания', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const previewList = document.getElementById('parsePreviewList');
  const updateBtn = previewList.previousElementSibling.querySelector('button');

  updateBtn.disabled = true;
  updateBtn.textContent = '⏳ Загрузка...';

  previewList.innerHTML = '<div style="text-align: center; color: #b0b8c8; padding: 20px;">⏳ Загрузка матчей...</div>';

  try {
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
          for (const [russian, english] of Object.entries(teams)) {
            const englishLower = english.toLowerCase();
            if (!teamTranslations[englishLower] || russian.length < teamTranslations[englishLower].length) {
              teamTranslations[englishLower] = russian;
            }
          }
          console.log(`✅ Загружен словарь для ${competition}: ${Object.keys(teamTranslations).length} команд`);
        }
      } catch (err) {
        console.warn(`⚠ Не удалось загрузить словарь из ${dictionaryFile}`);
      }
    }

    // Сохраняем переводы на уровне модуля для использования в submitBulkParse
    moduleTeamTranslations = teamTranslations;

    const translateTeamName = (englishName) => {
      return teamTranslations[englishName.toLowerCase()] || englishName;
    };

    const response = await fetch(
      `/api/fd-matches?competition=${encodeURIComponent(competition)}&dateFrom=${dateFrom}&dateTo=${dateTo}&includeFuture=${includeFuture}`
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Ошибка при загрузке матчей');
    }

    const data = await response.json();
    parsedMatches = data.matches || [];

    if (parsedMatches.length === 0) {
      const statusText = includeFuture ? 'матчей' : 'завершенных матчей';
      previewList.innerHTML = `<div style="text-align: center; color: #ffc107; padding: 20px;"><svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg> Не найдено ${statusText} в указанном диапазоне</div>`;
      document.getElementById('bulkParseSubmitBtn').disabled = true;
      return;
    }

    const matchesByRound = {};
    parsedMatches.forEach(match => {
      const roundName = match.round || 'Без тура';
      if (!matchesByRound[roundName]) matchesByRound[roundName] = [];
      matchesByRound[roundName].push(match);
    });

    let matchesHtml = '';

    Object.keys(matchesByRound).sort().forEach(roundName => {
      const roundMatches = matchesByRound[roundName];
      const roundId = roundName.replace(/[^a-zA-Z0-9]/g, '_');

      matchesHtml += `
        <div style="margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: rgba(58, 123, 213, 0.2); border: 1px solid rgba(90, 159, 212, 0.5); border-radius: 6px; margin-bottom: 10px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1;">
              <input type="checkbox" id="round_${roundId}" onchange="toggleRoundSelection('${roundName}')" style="cursor: pointer; width: 18px; height: 18px;" />
              <span style="font-weight: 500; color: #e0e6f0; font-size: 1.05em;">${roundName} (${roundMatches.length} ${roundMatches.length === 1 ? 'матч' : 'матчей'})</span>
            </label>
          </div>
          <div id="matches_${roundId}">
      `;

      roundMatches.forEach(match => {
        const date = new Date(match.utcDate);
        const formattedDate = date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const homeTeamRu = translateTeamName(match.homeTeam.name);
        const awayTeamRu = translateTeamName(match.awayTeam.name);
        const isFinished = match.status === 'FINISHED';
        const scoreHtml = isFinished
          ? `<div style="background: rgba(76, 175, 80, 0.2); border: 1px solid rgba(76, 175, 80, 0.5); border-radius: 4px; padding: 6px 12px; font-weight: 500; color: #4caf50;">${match.score.fullTime.home ?? 0} : ${match.score.fullTime.away ?? 0}</div>`
          : `<div style="background: rgba(255, 152, 0, 0.2); border: 1px solid rgba(255, 152, 0, 0.5); border-radius: 4px; padding: 6px 12px; font-weight: 500; color: #ff9800;">Предстоящий</div>`;

        matchesHtml += `
          <div style="background: rgba(58, 123, 213, 0.1); border: 1px solid rgba(90, 159, 212, 0.3); border-radius: 6px; padding: 12px; margin-bottom: 10px; margin-left: 30px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="flex: 1;">
                <div style="font-weight: 500; color: #e0e6f0; margin-bottom: 4px;">${homeTeamRu} vs ${awayTeamRu}</div>
                <div style="font-size: 0.85em; color: #b0b8c8;"><svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> ${formattedDate}</div>
              </div>
              ${scoreHtml}
            </div>
          </div>
        `;
      });

      matchesHtml += `</div></div>`;
    });

    const finishedCount = parsedMatches.filter(m => m.status === 'FINISHED').length;
    const futureCount = parsedMatches.length - finishedCount;

    previewList.innerHTML = `
      <div style="margin-bottom: 15px; padding: 10px; background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 6px;">
        <div style="color: #4caf50; font-weight: 500;"><svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Найдено матчей: ${parsedMatches.length}</div>
        ${finishedCount > 0 ? `<div style="color: #4caf50; font-size: 0.9em; margin-top: 4px;"><svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> Завершенных: ${finishedCount}</div>` : ''}
        ${futureCount > 0 ? `<div style="color: #ff9800; font-size: 0.9em; margin-top: 4px;"><svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> Предстоящих: ${futureCount}</div>` : ''}
      </div>
      ${matchesHtml}
    `;

    document.getElementById('bulkParseSubmitBtn').disabled = false;

  } catch (error) {
    console.error('Ошибка при загрузке превью:', error);
    previewList.innerHTML = `<div style="text-align: center; color: #f44336; padding: 20px;"><svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка: ${error.message}</div>`;
    document.getElementById('bulkParseSubmitBtn').disabled = true;
  } finally {
    updateBtn.disabled = false;
    updateBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-refresh"></use></svg> Обновить';
  }
}

// Переключить выбор тура
export function toggleRoundSelection(roundName) {
  const roundInput = document.getElementById('parseRound');
  const selectedCheckboxes = Array.from(document.querySelectorAll('[id^="round_"]:checked'));

  if (selectedCheckboxes.length === 0) {
    roundInput.value = '';
    roundInput.disabled = false;
    loadParsePreview();
  } else if (selectedCheckboxes.length === 1) {
    const originalRound = parsedMatches.find(m => m.round && m.round.replace(/[^a-zA-Z0-9]/g, '_') === selectedCheckboxes[0].id.replace('round_', ''))?.round || roundName;
    roundInput.value = originalRound === 'Без тура' ? '' : originalRound;
    roundInput.disabled = false;
  } else {
    roundInput.value = '';
    roundInput.disabled = true;
  }
}

// Отправить форму парсинга
export async function submitBulkParse(event) {
  event.preventDefault();

  if (parsedMatches.length === 0) {
    await showCustomAlert('Сначала загрузите превью матчей', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const selectedCheckboxes = Array.from(document.querySelectorAll('[id^="round_"]:checked'));
  const roundInput = document.getElementById('parseRound');
  const scorePredictionEnabled = document.getElementById('parseScorePrediction').checked;
  const yellowCardsPredictionEnabled = document.getElementById('parseYellowCardsPrediction').checked;
  const redCardsPredictionEnabled = document.getElementById('parseRedCardsPrediction').checked;

  let matchesToProcess = [];

  if (selectedCheckboxes.length === 0) {
    matchesToProcess = parsedMatches;
  } else {
    const selectedRounds = selectedCheckboxes.map(cb => {
      const roundId = cb.id.replace('round_', '');
      return parsedMatches.find(m => m.round && m.round.replace(/[^a-zA-Z0-9]/g, '_') === roundId)?.round;
    }).filter(Boolean);
    matchesToProcess = parsedMatches.filter(m => selectedRounds.includes(m.round));
  }

  if (matchesToProcess.length === 0) {
    await showCustomAlert('Нет матчей для создания', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const customRoundName = selectedCheckboxes.length === 1 && roundInput.value.trim() ? roundInput.value.trim() : null;

  if (selectedCheckboxes.length === 0 && !roundInput.value.trim()) {
    const confirmed = await showCustomConfirm(
      'Вы не указали тур. Матчи будут созданы без указания тура. Продолжить?',
      'Подтверждение',
      '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'
    );
    if (!confirmed) return;
  }

  const submitBtn = document.getElementById('bulkParseSubmitBtn');
  const originalText = submitBtn.textContent;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Создание матчей...';

    const matchesToCreate = matchesToProcess.map(match => {
      const isFinished = match.status === 'FINISHED';

      let roundName;
      if (customRoundName) {
        roundName = customRoundName;
      } else if (selectedCheckboxes.length > 1) {
        roundName = match.round || null;
      } else {
        roundName = roundInput.value.trim() || null;
      }

      const baseMatch = {
        team1_name: moduleTeamTranslations[match.homeTeam.name.toLowerCase()] || match.homeTeam.name,
        team2_name: moduleTeamTranslations[match.awayTeam.name.toLowerCase()] || match.awayTeam.name,
        match_date: match.utcDate,
        round: roundName,
        event_id: state.currentEventId,
        score_prediction_enabled: scorePredictionEnabled ? 1 : 0,
        yellow_cards_prediction_enabled: yellowCardsPredictionEnabled ? 1 : 0,
        red_cards_prediction_enabled: redCardsPredictionEnabled ? 1 : 0
      };

      if (isFinished && match.score.fullTime.home !== null && match.score.fullTime.away !== null) {
        baseMatch.team1_score = match.score.fullTime.home;
        baseMatch.team2_score = match.score.fullTime.away;
        baseMatch.winner = match.score.fullTime.home > match.score.fullTime.away ? 'team1' :
                           match.score.fullTime.home < match.score.fullTime.away ? 'team2' : 'draw';
      }

      return baseMatch;
    });

    const response = await fetch('/api/matches/bulk-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matches: matchesToCreate }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Ошибка при создании матчей');
    }

    const finishedCount = matchesToProcess.filter(m => m.status === 'FINISHED').length;
    const futureCount = matchesToProcess.length - finishedCount;

    let message = `Успешно создано ${matchesToCreate.length} матчей`;
    if (finishedCount > 0 && futureCount > 0) {
      message += `\n\n<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> С результатами: ${finishedCount}\n<svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> Без результатов: ${futureCount}`;
    } else if (finishedCount > 0) {
      message += ` с результатами`;
    }

    if (scorePredictionEnabled) {
      message += `\n\n<svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Прогноз на счет включен`;
    }

    const competition = document.getElementById('parseCompetition').value;
    if (competition === 'RPL') {
      message += `\n\n<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg> ВНИМАНИЕ: Даты матчей RPL могут быть неточными из-за ограничений API. Проверьте и скорректируйте даты вручную через редактирование матчей.`;
    }

    await showCustomAlert(message, 'Успех', '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');

    closeBulkParseModal();
    await loadMatches(state.currentEventId);

  } catch (error) {
    console.error('Ошибка при создании матчей:', error);
    await showCustomAlert(`Ошибка при создании матчей: ${error.message}`, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// Обновить превью парсинга при изменении полей
export function updateParsePreview() {
  const competition = document.getElementById('parseCompetition').value;
  const dateFrom = document.getElementById('parseDateFrom').value;
  const dateTo = document.getElementById('parseDateTo').value;
  if (competition && dateFrom && dateTo) {
    document.getElementById('parsePreviewContainer').style.display = 'block';
    loadParsePreview();
  } else {
    document.getElementById('parsePreviewContainer').style.display = 'none';
  }
}
