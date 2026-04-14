import * as state from './state.js';
import { setUserBets, setMatches } from './state.js';
import { lockBodyScroll, unlockBodyScroll, showCustomAlert, showCustomConfirm } from './ui.js';
import { loadMatches, displayMatches } from './matches.js';
import { loadMyBets } from './bets.js';
import { loadRoundsForModal, loadMatchTeams, initTeamAutocomplete, hideSuggestions, selectedMatchTeamFile } from './matchCreate.js';

// ===== ПЕРЕКЛЮЧАТЕЛЬ ФИНАЛЬНОГО МАТЧА =====

export function toggleFinalMatch(modal) {
  const prefix = modal === 'edit' ? 'edit' : '';
  const isFinalCheckbox = document.getElementById(
    prefix ? 'editMatchIsFinal' : 'matchIsFinal'
  );
  const finalParams = document.getElementById(
    prefix ? 'finalMatchParamsEdit' : 'finalMatchParamsCreate'
  );
  const roundInput = document.getElementById(
    prefix ? 'editMatchRound' : 'matchRound'
  );
  if (!isFinalCheckbox || !finalParams || !roundInput) return;
  if (isFinalCheckbox.checked) {
    finalParams.style.display = 'block';
    roundInput.value = '��� Финал';
    roundInput.disabled = true;
  } else {
    finalParams.style.display = 'none';
    roundInput.disabled = false;
    if (roundInput.value === '��� Финал') roundInput.value = '';
  }
}

// ===== РЕДАКТИРОВАНИЕ МАТЧА =====

export async function openEditMatchModal(id, team1, team2, date, round) {
  if (!canEditMatches()) { alert('❌ Только администратор или модератор может редактировать матчи'); return; }
  const match = state.matches.find(m => m.id === id);
  document.getElementById('editMatchId').value = id;
  document.getElementById('editMatchTeam1').value = team1;
  document.getElementById('editMatchTeam2').value = team2;
  let localDateString = '';
  if (date) {
    const utcDate = new Date(date);
    const year = utcDate.getFullYear();
    const month = String(utcDate.getMonth() + 1).padStart(2, '0');
    const day = String(utcDate.getDate()).padStart(2, '0');
    const hours = String(utcDate.getHours()).padStart(2, '0');
    const minutes = String(utcDate.getMinutes()).padStart(2, '0');
    localDateString = `${year}-${month}-${day}T${hours}:${minutes}`;
    console.log(`��� Загрузка для редактирования: ${date} (UTC в БД) → ${localDateString} (локальное время браузера для input)`);
  }
  document.getElementById('editMatchDate').value = localDateString;
  document.getElementById('editMatchRound').value = round || '';
  loadRoundsForModal('edit', state.currentEventId);
  if (match) {
    document.getElementById('editMatchIsFinal').checked = match.is_final || false;
    document.getElementById('editShowExactScore').checked = match.show_exact_score || false;
    document.getElementById('editShowYellowCards').checked = match.show_yellow_cards || false;
    document.getElementById('editShowRedCards').checked = match.show_red_cards || false;
    document.getElementById('editShowCorners').checked = match.show_corners || false;
    document.getElementById('editShowPenaltiesInGame').checked = match.show_penalties_in_game || false;
    document.getElementById('editShowExtraTime').checked = match.show_extra_time || false;
    document.getElementById('editShowPenaltiesAtEnd').checked = match.show_penalties_at_end || false;
    document.getElementById('editMatchScorePrediction').checked = match.score_prediction_enabled || false;
    document.getElementById('editMatchYellowCardsPrediction').checked = match.yellow_cards_prediction_enabled || false;
    document.getElementById('editMatchRedCardsPrediction').checked = match.red_cards_prediction_enabled || false;
    toggleFinalMatch('edit');
  }
  const currentEvent = state.events.find(e => e.id === state.currentEventId);
  const eventTeamFile = currentEvent?.team_file || selectedMatchTeamFile;
  await loadMatchTeams(eventTeamFile);
  initTeamAutocomplete('editMatchTeam1');
  initTeamAutocomplete('editMatchTeam2');
  lockBodyScroll();
  document.getElementById('editMatchModal').style.display = 'flex';
}

export function closeEditMatchModal() {
  document.getElementById('editMatchModal').style.display = 'none';
  unlockBodyScroll();
  document.getElementById('editMatchIsFinal').checked = false;
  document.getElementById('finalMatchParamsEdit').style.display = 'none';
  document.getElementById('editMatchRound').disabled = false;
  hideSuggestions('editMatchTeam1');
  hideSuggestions('editMatchTeam2');
}

function capitalizeTeamName(name) {
  if (!name) return name;
  return name.trim().split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

export async function submitEditMatch(event) {
  event.preventDefault();
  const id = document.getElementById('editMatchId').value;
  let team1 = capitalizeTeamName(document.getElementById('editMatchTeam1').value.trim());
  let team2 = capitalizeTeamName(document.getElementById('editMatchTeam2').value.trim());
  const date = document.getElementById('editMatchDate').value;
  let round = document.getElementById('editMatchRound').value.trim();
  const isFinal = document.getElementById('editMatchIsFinal').checked;
  const scorePredictionEnabled = document.getElementById('editMatchScorePrediction').checked;
  const yellowCardsPredictionEnabled = document.getElementById('editMatchYellowCardsPrediction').checked;
  const redCardsPredictionEnabled = document.getElementById('editMatchRedCardsPrediction').checked;
  if (isFinal) round = '��� Финал';
  const showExactScore = document.getElementById('editShowExactScore').checked;
  const showYellowCards = document.getElementById('editShowYellowCards').checked;
  const showRedCards = document.getElementById('editShowRedCards').checked;
  const showCorners = document.getElementById('editShowCorners').checked;
  const showPenaltiesInGame = document.getElementById('editShowPenaltiesInGame').checked;
  const showExtraTime = document.getElementById('editShowExtraTime').checked;
  const showPenaltiesAtEnd = document.getElementById('editShowPenaltiesAtEnd').checked;
  if (!team1 || !team2) { alert('❌ Заполните названия обеих команд'); return; }
  try {
    let matchDateUTC = null;
    if (date) {
      const localDate = new Date(date);
      matchDateUTC = localDate.toISOString();
      console.log(`��� Редактирование - конвертация времени: ${date} (локальное) → ${matchDateUTC} (UTC)`);
    }
    const response = await fetch(`/api/admin/matches/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser.username,
        team1_name: team1, team2_name: team2,
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
      const matchIndex = state.matches.findIndex(m => m.id === parseInt(id));
      if (matchIndex !== -1) {
        state.matches[matchIndex] = {
          ...state.matches[matchIndex],
          team1_name: team1, team2_name: team2, match_date: date, round,
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
      await loadMyBets();
      displayMatches();
    } else {
      alert(`❌ Ошибка: ${result.error}`);
    }
  } catch (error) {
    console.error('Ошибка при редактировании матча:', error);
    alert('❌ Ошибка при редактировании матча');
  }
}

export async function deleteMatch(id) {
  if (!canManageMatches()) { await showCustomAlert('Только администратор или модератор может удалять матчи', 'Недостаточно прав', '❌'); return; }
  const confirmed = await showCustomConfirm('Вы уверены, что хотите удалить этот матч?\n\nВсе ставки на этот матч также будут удалены.', 'Удаление матча', '⚠️');
  if (!confirmed) return;
  try {
    const response = await fetch(`/api/admin/matches/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: state.currentUser.username }),
    });
    const result = await response.json();
    if (response.ok) {
      const deletedMatch = state.matches.find(m => m.id === id);
      if (deletedMatch) {
        const deletedBetIds = state.userBets.filter(bet => bet.match_id === id).map(bet => bet.id);
        deletedBetIds.forEach(betId => {
          const betElement = document.querySelector(`[data-bet-id="${betId}"]`);
          if (betElement) {
            betElement.style.opacity = '0.5';
            betElement.style.transform = 'scale(0.95)';
            betElement.style.transition = 'all 0.3s ease';
            setTimeout(() => {
              betElement.remove();
              const myBetsList = document.getElementById('myBetsList');
              if (myBetsList.children.length === 0) myBetsList.innerHTML = '<div class="empty-message">У вас пока нет ставок</div>';
            }, 300);
          }
        });
        setUserBets(state.userBets.filter(bet => bet.match_id !== id));
        setMatches(state.matches.filter(m => m.id !== id));
        displayMatches();
      }
    } else {
      await showCustomAlert(`Ошибка: ${result.error}`, 'Ошибка удаления', '❌');
    }
  } catch (error) {
    console.error('Ошибка при удалении матча:', error);
    await showCustomAlert('Ошибка при удалении матча', 'Ошибка', '❌');
  }
}

// ===== РЕЗУЛЬТАТ ФИНАЛЬНОГО МАТЧА =====

export let currentFinalMatchId = null;
export let currentFinalResult = null;

export function openFinalMatchResultModal(matchId) {
  currentFinalMatchId = matchId;
  currentFinalResult = null;
  const match = state.matches.find(m => m.id === matchId);
  if (!match) return;
  const modal = document.getElementById('finalMatchResultModal');
  const container = document.getElementById('finalParametersContainer');
  const buttonsContainer = document.getElementById('finalResultButtonsContainer');
  if (!modal || !container || !buttonsContainer) { console.error('Modal elements not found!'); return; }
  container.innerHTML = '';
  buttonsContainer.innerHTML = '';
  buttonsContainer.innerHTML = `
    <button id="finalResult_team1" class="result-btn" onclick="setFinalResult('team1')" style="flex: 1">${match.team1_name || 'Team 1'}</button>
    <button id="finalResult_draw" class="result-btn" onclick="setFinalResult('draw')" style="flex: 1">Ничья</button>
    <button id="finalResult_team2" class="result-btn" onclick="setFinalResult('team2')" style="flex: 1">${match.team2_name || 'Team 2'}</button>
  `;
  if (match.is_final) {
    let parametersHTML = '<h4 style="margin-bottom: 15px; color: #7ab0e0;">��� Результаты параметров</h4><div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">';
    if (match.show_exact_score) parametersHTML += `<div style="padding: 10px; background: rgba(77, 184, 168, 0.1); border: 1px solid rgba(77, 184, 168, 0.3); border-radius: 6px;"><label style="color: #4db8a8; font-size: 0.85em; display: block; margin-bottom: 6px;">��� Точный счет</label><input type="text" id="param_exact_score" placeholder="2:1" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;"></div>`;
    if (match.show_yellow_cards) parametersHTML += `<div style="padding: 10px; background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 6px;"><label style="color: #ffc107; font-size: 0.85em; display: block; margin-bottom: 6px;">��� Жёлтые</label><input type="number" id="param_yellow_cards" min="0" max="20" placeholder="5" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;"></div>`;
    if (match.show_red_cards) parametersHTML += `<div style="padding: 10px; background: rgba(244, 67, 54, 0.1); border: 1px solid rgba(244, 67, 54, 0.3); border-radius: 6px;"><label style="color: #f44336; font-size: 0.85em; display: block; margin-bottom: 6px;">��� Красные</label><input type="number" id="param_red_cards" min="0" max="10" placeholder="0" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;"></div>`;
    if (match.show_corners) parametersHTML += `<div style="padding: 10px; background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 6px;"><label style="color: #4caf50; font-size: 0.85em; display: block; margin-bottom: 6px;">⚽ Угловые</label><input type="number" id="param_corners" min="0" max="30" placeholder="8" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;"></div>`;
    if (match.show_penalties_in_game) parametersHTML += `<div style="padding: 10px; background: rgba(156, 39, 176, 0.1); border: 1px solid rgba(156, 39, 176, 0.3); border-radius: 6px;"><label style="color: #9c27b0; font-size: 0.85em; display: block; margin-bottom: 6px;">⚽ Пенальти в игре</label><select id="param_penalties_in_game" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;"><option value="">-- Выбрать --</option><option value="ДА">ДА</option><option value="НЕТ">НЕТ</option></select></div>`;
    if (match.show_extra_time) parametersHTML += `<div style="padding: 10px; background: rgba(33, 150, 243, 0.1); border: 1px solid rgba(33, 150, 243, 0.3); border-radius: 6px;"><label style="color: #2196f3; font-size: 0.85em; display: block; margin-bottom: 6px;">⏱️ Доп. время</label><select id="param_extra_time" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;"><option value="">-- Выбрать --</option><option value="ДА">ДА</option><option value="НЕТ">НЕТ</option></select></div>`;
    if (match.show_penalties_at_end) parametersHTML += `<div style="padding: 10px; background: rgba(255, 87, 34, 0.1); border: 1px solid rgba(255, 87, 34, 0.3); border-radius: 6px;"><label style="color: #ff5722; font-size: 0.85em; display: block; margin-bottom: 6px;">��� Пенальти в конце</label><select id="param_penalties_at_end" style="width: 100%; padding: 6px; background: #2a3f5f; border: 1px solid #5a9fd4; color: #fff; border-radius: 3px; font-size: 0.9em;"><option value="">-- Выбрать --</option><option value="ДА">ДА</option><option value="НЕТ">НЕТ</option></select></div>`;
    parametersHTML += '</div>';
    container.innerHTML = parametersHTML;
  }
  modal.style.display = 'flex';
  lockBodyScroll();
}

export function closeFinalMatchResultModal(event) {
  if (event && event.target.id !== 'finalMatchResultModal') return;
  const modal = document.getElementById('finalMatchResultModal');
  modal.style.display = 'none';
  unlockBodyScroll();
  currentFinalMatchId = null;
  currentFinalResult = null;
  const btn1 = document.getElementById('finalResult_team1');
  const btnDraw = document.getElementById('finalResult_draw');
  const btn2 = document.getElementById('finalResult_team2');
  if (btn1) btn1.style.background = 'transparent';
  if (btnDraw) btnDraw.style.background = 'transparent';
  if (btn2) btn2.style.background = 'transparent';
}

export function setFinalResult(result) {
  currentFinalResult = result;
  const btn1 = document.getElementById('finalResult_team1');
  const btnDraw = document.getElementById('finalResult_draw');
  const btn2 = document.getElementById('finalResult_team2');
  if (btn1) btn1.style.background = result === 'team1' ? 'rgba(58, 123, 213, 0.6)' : 'transparent';
  if (btnDraw) btnDraw.style.background = result === 'draw' ? 'rgba(255, 152, 0, 0.6)' : 'transparent';
  if (btn2) btn2.style.background = result === 'team2' ? 'rgba(76, 175, 80, 0.6)' : 'transparent';
}

export async function saveFinalMatchResult() {
  if (!currentFinalMatchId || !currentFinalResult) { alert('Выберите результат матча'); return; }
  const match = state.matches.find(m => m.id === currentFinalMatchId);
  if (!match) return;
  try {
    const resultMap = { team1: 'team1_win', draw: 'draw', team2: 'team2_win' };
    const matchResponse = await fetch(`/api/admin/matches/${currentFinalMatchId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: state.currentUser?.username, status: 'finished', result: resultMap[currentFinalResult] }),
    });
    if (!matchResponse.ok) { const error = await matchResponse.json(); alert('Ошибка при установке результата матча: ' + error.error); return; }
    match.status = 'finished';
    match.result = resultMap[currentFinalResult];
    match.winner = currentFinalResult;
    const parametersData = { matchId: currentFinalMatchId, username: state.currentUser?.username };
    if (match.show_exact_score) { const v = document.getElementById('param_exact_score').value; if (v) parametersData.exact_score = v; }
    if (match.show_yellow_cards) { const v = document.getElementById('param_yellow_cards').value; if (v) parametersData.yellow_cards = parseInt(v); }
    if (match.show_red_cards) { const v = document.getElementById('param_red_cards').value; if (v) parametersData.red_cards = parseInt(v); }
    if (match.show_corners) { const v = document.getElementById('param_corners').value; if (v) parametersData.corners = parseInt(v); }
    if (match.show_penalties_in_game) { const v = document.getElementById('param_penalties_in_game').value; if (v) parametersData.penalties_in_game = v; }
    if (match.show_extra_time) { const v = document.getElementById('param_extra_time').value; if (v) parametersData.extra_time = v; }
    if (match.show_penalties_at_end) { const v = document.getElementById('param_penalties_at_end').value; if (v) parametersData.penalties_at_end = v; }
    const paramsResponse = await fetch('/api/admin/final-parameters-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parametersData),
    });
    if (!paramsResponse.ok) console.error('Ошибка при установке параметров');
    console.log('✓ Результат финала и параметры успешно установлены');
    closeFinalMatchResultModal();
    displayMatches();
    setTimeout(() => { loadMyBets(); }, 300);
  } catch (error) {
    console.error('Ошибка при сохранении результата:', error);
    alert('Ошибка при сохранении результата');
  }
}

// ===== РЕЗУЛЬТАТ МАТЧА С ПРОГНОЗОМ НА СЧЕТ =====

export let currentScoreMatchId = null;
export let currentScoreMatchResult = null;

export function openScoreMatchResultModal(matchId, team1Name, team2Name) {
  currentScoreMatchId = matchId;
  currentScoreMatchResult = null;
  document.getElementById('scoreModalTeam1Name').textContent = team1Name;
  document.getElementById('scoreModalTeam2Name').textContent = team2Name;
  const buttonsContainer = document.getElementById('scoreResultButtonsContainer');
  buttonsContainer.innerHTML = `
    <button id="scoreResult_team1" onclick="setScoreResult('team1')" style="flex: 1; padding: 12px; background: transparent; border: 2px solid #5a9fd4; color: #5a9fd4; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.3s;">${team1Name}</button>
    <button id="scoreResult_draw" onclick="setScoreResult('draw')" style="flex: 1; padding: 12px; background: transparent; border: 2px solid #ff9800; color: #ff9800; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.3s;">Ничья</button>
    <button id="scoreResult_team2" onclick="setScoreResult('team2')" style="flex: 1; padding: 12px; background: transparent; border: 2px solid #4caf50; color: #4caf50; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.3s;">${team2Name}</button>
  `;
  document.getElementById('scoreModalTeam1').value = '0';
  document.getElementById('scoreModalTeam2').value = '0';
  const input1 = document.getElementById('scoreModalTeam1');
  const input2 = document.getElementById('scoreModalTeam2');
  input1.addEventListener('input', syncScoreModalInputs);
  input2.addEventListener('input', syncScoreModalInputs);
  const modal = document.getElementById('scoreMatchResultModal');
  modal.style.display = 'flex';
  lockBodyScroll();
}

export function syncScoreModalInputs(event) {
  if (currentScoreMatchResult !== 'draw') return;
  const input1 = document.getElementById('scoreModalTeam1');
  const input2 = document.getElementById('scoreModalTeam2');
  if (event.target === input1) input2.value = input1.value;
  else if (event.target === input2) input1.value = input2.value;
}

export function setScoreResult(result) {
  currentScoreMatchResult = result;
  const btn1 = document.getElementById('scoreResult_team1');
  const btnDraw = document.getElementById('scoreResult_draw');
  const btn2 = document.getElementById('scoreResult_team2');
  if (btn1) btn1.style.background = result === 'team1' ? 'rgba(90, 159, 212, 0.6)' : 'transparent';
  if (btnDraw) btnDraw.style.background = result === 'draw' ? 'rgba(255, 152, 0, 0.6)' : 'transparent';
  if (btn2) btn2.style.background = result === 'team2' ? 'rgba(76, 175, 80, 0.6)' : 'transparent';
  if (result === 'draw') {
    const input1 = document.getElementById('scoreModalTeam1');
    const input2 = document.getElementById('scoreModalTeam2');
    const maxValue = Math.max(parseInt(input1.value) || 0, parseInt(input2.value) || 0);
    input1.value = maxValue;
    input2.value = maxValue;
  }
}

export function closeScoreMatchResultModal() {
  const modal = document.getElementById('scoreMatchResultModal');
  modal.style.display = 'none';
  unlockBodyScroll();
  currentScoreMatchId = null;
  currentScoreMatchResult = null;
}

export async function saveScoreMatchResult() {
  if (!currentScoreMatchId) return;
  if (!currentScoreMatchResult) { await showCustomAlert('Выберите победителя', 'Ошибка', '⚠️'); return; }
  const scoreTeam1 = parseInt(document.getElementById('scoreModalTeam1').value) || 0;
  const scoreTeam2 = parseInt(document.getElementById('scoreModalTeam2').value) || 0;
  if (currentScoreMatchResult === 'team1' && scoreTeam1 <= scoreTeam2) {
    await showCustomAlert(`Счет не соответствует выбранному победителю!\n\nВы выбрали победу первой команды, но счет ${scoreTeam1}:${scoreTeam2}`, 'Ошибка валидации', '❌');
    return;
  }
  if (currentScoreMatchResult === 'team2' && scoreTeam2 <= scoreTeam1) {
    await showCustomAlert(`Счет не соответствует выбранному победителю!\n\nВы выбрали победу второй команды, но счет ${scoreTeam1}:${scoreTeam2}`, 'Ошибка валидации', '❌');
    return;
  }
  if (currentScoreMatchResult === 'draw' && scoreTeam1 !== scoreTeam2) {
    await showCustomAlert(`Счет не соответствует ничьей!\n\nВы выбрали ничью, но счет ${scoreTeam1}:${scoreTeam2}`, 'Ошибка валидации', '❌');
    return;
  }
  try {
    const response = await fetch(`/api/admin/matches/${currentScoreMatchId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'finished', winner: currentScoreMatchResult, username: state.currentUser?.username, score_team1: scoreTeam1, score_team2: scoreTeam2 }),
    });
    if (response.ok) {
      const match = state.matches.find(m => m.id === currentScoreMatchId);
      if (match) {
        match.status = 'finished';
        match.winner = currentScoreMatchResult;
        const resultMap = { team1: 'team1_win', draw: 'draw', team2: 'team2_win' };
        match.result = resultMap[currentScoreMatchResult];
        console.log(`✓ Матч ${match.team1_name} vs ${match.team2_name} завершен с результатом: ${currentScoreMatchResult} (${scoreTeam1}:${scoreTeam2})`);
      }
      closeScoreMatchResultModal();
      displayMatches();
      setTimeout(() => { loadMyBets(); }, 300);
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
