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
    if (!files || files.length === 0) { alert('Не найдено файлов команд в папке names'); return; }
    const currentFile = selectedMatchTeamFile;
    const fileListHtml = files.map(file => {
      const isSelected = file.path === currentFile;
      const icon = file.name.endsWith('.json') ? '���' : file.name.endsWith('.txt') ? '���' : '���';
      return `<div class="team-file-item ${isSelected ? 'selected' : ''}" onclick="selectMatchTeamFile('${file.path}', '${mode}')" style="padding: 12px; margin: 8px 0; background: ${isSelected ? 'rgba(90, 159, 212, 0.2)' : 'rgba(40, 44, 54, 0.5)'}; border: 1px solid ${isSelected ? 'rgba(90, 159, 212, 0.5)' : 'rgba(90, 159, 212, 0.2)'}; border-radius: 8px; cursor: pointer; transition: all 0.2s;"><div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 1.5em;">${icon}</span><div style="flex: 1;"><div style="font-weight: 500; color: #e0e6f0;">${file.name}</div><div style="font-size: 0.85em; color: #b0b8c8; margin-top: 2px;">${file.path}</div></div>${isSelected ? '<span style="color: #4caf50; font-size: 1.2em;">✓</span>' : ''}</div></div>`;
    }).join('');
    const modalHtml = `<div id="matchTeamFileSelectorModal" class="modal" style="display: flex;" onclick="closeMatchTeamFileSelector()"><div class="modal-content" onclick="event.stopPropagation()" style="max-width: 600px; max-height: 80vh; overflow-y: auto;"><div class="modal-header"><h2>��� Выбор файла команд</h2><button class="modal-close" onclick="closeMatchTeamFileSelector()">&times;</button></div><div style="padding: 20px;"><p style="color: #b0b8c8; margin-bottom: 15px;">Выберите файл с командами для автодополнения:</p>${fileListHtml}</div></div></div>`;
    const existingModal = document.getElementById('matchTeamFileSelectorModal');
    if (existingModal) existingModal.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    lockBodyScroll();
  } catch (error) {
    console.error('Ошибка при открытии выбора файла:', error);
    alert('Не удалось загрузить список файлов');
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
      alert(`Файл команд изменен на: ${filePath.split('/').pop()}\nЗагружено команд: ${matchTeamsList.length}`);
    } else {
      alert(`Файл команд изменен на: ${filePath.split('/').pop()}\n⚠️ Не удалось загрузить команды из этого файла`);
    }
  } catch (error) {
    console.error('Ошибка при выборе файла команд:', error);
    alert('Не удалось загрузить файл команд');
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

export function toggleTeamDropdown(inputId, event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const suggestionsDiv = document.getElementById(`${inputId}Suggestions`);
  const input = document.getElementById(inputId);
  if (!suggestionsDiv || !input) return;
  if (suggestionsDiv.style.display === 'block') { hideSuggestions(inputId); return; }
  if (matchTeamsList.length === 0) { alert('Сначала загрузите файл команд через кнопку ���'); return; }
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
  if (!state.currentUser) { alert('Сначала войдите в систему'); return; }
  if (!canCreateMatches()) { alert('У вас нет прав для создания матчей'); return; }
  if (!state.currentEventId) { alert('Пожалуйста, сначала выберите турнир'); return; }

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
  if (isFinal) round = '��� Финал';
  const showExactScore = document.getElementById('showExactScore').checked;
  const showYellowCards = document.getElementById('showYellowCards').checked;
  const showRedCards = document.getElementById('showRedCards').checked;
  const showCorners = document.getElementById('showCorners').checked;
  const showPenaltiesInGame = document.getElementById('showPenaltiesInGame').checked;
  const showExtraTime = document.getElementById('showExtraTime').checked;
  const showPenaltiesAtEnd = document.getElementById('showPenaltiesAtEnd').checked;
  if (!team1 || !team2) { alert('Пожалуйста, введите обе команды'); return; }
  if (!state.currentEventId) { alert('Турнир не выбран'); return; }
  const copiesCount = Math.min(Math.max(copies, 1), 20);
  try {
    let created = 0;
    let lastError = null;
    let matchDateUTC = null;
    if (matchDate) {
      const localDate = new Date(matchDate);
      matchDateUTC = localDate.toISOString();
      console.log(`��� Конвертация времени: ${matchDate} (локальное) → ${matchDateUTC} (UTC)`);
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
  if (!eventId) { alert('❌ Выберите турнир'); return; }
  if (!importData) { alert('❌ Введите данные матчей'); return; }
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
  if (errors.length > 0) { alert('❌ Ошибки при импорте:\n\n' + errors.join('\n')); return; }
  if (matches.length === 0) { alert('❌ Не найдено ни одного матча для импорта'); return; }
  try {
    const response = await fetch('/api/matches/bulk-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matches }),
    });
    if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'Ошибка при импорте'); }
    alert(`✅ Успешно импортировано ${matches.length} матчей`);
    closeImportMatchesModal();
    if (state.currentEventId) loadMatches(state.currentEventId);
  } catch (error) {
    console.error('Ошибка при импорте матчей:', error);
    alert(`❌ Ошибка при импорте: ${error.message}`);
  }
}

// ===== МАССОВОЕ РЕДАКТИРОВАНИЕ ДАТ =====

export async function openBulkEditDatesModal() {
  if (!state.currentEventId) { await showCustomAlert('Выберите турнир', 'Ошибка', '❌'); return; }
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
  if (updates.length === 0) { await showCustomAlert('Нет дат для сохранения', 'Ошибка', '❌'); return; }
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
    await showCustomAlert(`Успешно обновлено дат: ${result.updatedCount}`, 'Успех', '✅');
    closeBulkEditDatesModal();
    await loadMatches(state.currentEventId);
  } catch (error) {
    console.error('Ошибка при сохранении дат:', error);
    await showCustomAlert(`Ошибка при сохранении: ${error.message}`, 'Ошибка', '❌');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}
