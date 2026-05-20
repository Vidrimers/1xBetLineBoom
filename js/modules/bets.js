import * as state from './state.js';
import { setUserBets } from './state.js';
import { getMatchStatusByDate, displayMatches, initToggleStates } from './matches.js';
import { showCustomAlert } from './ui.js';

// ===== СТАВКИ =====

export async function placeBet(matchId, teamName, prediction) {
  if (!state.currentUser) {
    await showCustomAlert("Сначала введите ваше имя", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  // Сразу делаем кнопку disabled и курсор wait
  const button = event.target;
  if (button) {
    button.disabled = true;
    button.style.cursor = "wait";
  }

  // Проверяем статус матча на основе даты
  const match = state.matches.find((m) => m.id === matchId);
  if (match) {
    const effectiveStatus = getMatchStatusByDate(match);
    if (effectiveStatus !== "pending") {
      await showCustomAlert("Ну, куда ты, малютка, матч уже начался", "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>');

      // Отправляем уведомление админу о попытке запретной ставки
      try {
        await fetch("/api/admin/notify-illegal-bet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: state.currentUser.username,
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
    const checkResponse = await fetch(`/api/user/${state.currentUser.id}/bets`);
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
          user_id: state.currentUser.id,
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
            user_id: state.currentUser.id,
          }),
        });
      } catch (error) {
      }
    }

    // Создаём новую ставку
    const response = await fetch("/api/bets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: state.currentUser.id,
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
      if (typeof loadAndDisplayBetStats === 'function') await loadAndDisplayBetStats(matchId, true);
      
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
      await showCustomAlert("Ошибка при создании ставки", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error("Ошибка при размещении ставки:", error);
    await showCustomAlert("Ошибка при размещении ставки", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// ===== ПРОГНОЗ НА СЧЕТ =====
export function showScoreAlert(message) {
  // Создаем overlay
  const overlay = document.createElement('div');
  overlay.className = 'score-alert-overlay';
  
  // Создаем алерт
  const alert = document.createElement('div');
  alert.className = 'score-alert';
  alert.innerHTML = `
    <div class="score-alert-content">
      <div class="score-alert-icon"><svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg></div>
      <div class="score-alert-message">${message}</div>
      <button class="score-alert-button" onclick="closeScoreAlert()">Понятно</button>
    </div>
  `;
  
  document.body.appendChild(overlay);
  document.body.appendChild(alert);
  
  // Закрытие по клику на overlay
  overlay.onclick = closeScoreAlert;
}

export function closeScoreAlert() {
  const overlay = document.querySelector('.score-alert-overlay');
  const alert = document.querySelector('.score-alert');
  if (overlay) overlay.remove();
  if (alert) alert.remove();
}

export function syncScoreInputs(matchId, prediction) {
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

export async function placeScorePrediction(matchId, prediction) {
  if (!state.currentUser) {
    await showCustomAlert("Сначала введите ваше имя", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
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
      await showCustomAlert("Введите корректный счет (0 или больше)", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
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
    await showCustomAlert("Введите корректное количество желтых карточек (0-20)", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }
  
  if (redCards !== null && (isNaN(redCards) || redCards < 0 || redCards > 10)) {
    await showCustomAlert("Введите корректное количество красных карточек (0-10)", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  // Проверяем статус матча
  const match = state.matches.find((m) => m.id === matchId);
  if (match) {
    const effectiveStatus = getMatchStatusByDate(match);
    if (effectiveStatus !== "pending") {
      await showCustomAlert("Матч уже начался, прогноз недоступен", "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>');
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
          user_id: state.currentUser.id,
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
          user_id: state.currentUser.id,
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
    const match = state.matches.find(m => m.id === matchId);
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
    await showCustomAlert("Ошибка при сохранении прогноза на счет", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

export async function cancelScorePrediction(matchId) {
  if (!state.currentUser) {
    await showCustomAlert("Сначала введите ваше имя", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
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
        user_id: state.currentUser.id,
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
      
      await showCustomAlert("Прогноз на счет удален", "Успех", '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');
      loadMyBets();
    } else {
      const error = await response.json();
      alert(error.error || "Ошибка при удалении прогноза");
    }
  } catch (error) {
    console.error("Ошибка при удалении прогноза на счет:", error);
    await showCustomAlert("Ошибка при удалении прогноза на счет", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Функция для разблокировки параметра при удалении ставки
export function unlockFinalParameter(matchId, parameterType) {
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
      span.style.pointerEvents = "auto"; // <svg class="icon" aria-hidden="true"><use href="#icon-login"></use></svg> Восстанавливаем возможность клика
    }
  });

  // Разблокируем checkbox'ы
  const checkboxes = paramMainContainer.querySelectorAll(
    'input[type="checkbox"]'
  );
  checkboxes.forEach((checkbox) => {
    checkbox.disabled = false;
  });

  // Показываем кнопку '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
  const button = paramMainContainer.querySelector("button");
  if (button) {
    button.style.display = "inline-block";
  }
}

// Функция для блокировки параметра после сохранения ставки
export function lockFinalParameter(matchId, parameterType) {
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
      span.style.pointerEvents = "none"; // <svg class="icon" aria-hidden="true"><use href="#icon-hidden"></use></svg> Делаем элемент неклабиваемым
    }
  });

  // Блокируем checkbox'ы
  const checkboxes = paramMainContainer.querySelectorAll(
    'input[type="checkbox"]'
  );
  checkboxes.forEach((checkbox) => {
    checkbox.disabled = true;
  });

  // Скрываем кнопку '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
  const button = paramMainContainer.querySelector("button");
  if (button) {
    button.style.display = "none";
  }
}

export async function placeAllFinalBets(matchId) {
  if (!state.currentUser) {
    await showCustomAlert("Сначала введите ваше имя", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  const match = state.matches.find(m => m.id === matchId);
  if (!match) return;

  let placed = 0;
  let errors = 0;

  // Точный счёт
  if (match.show_exact_score) {
    const s1 = document.getElementById(`exactScore1_${matchId}`);
    const s2 = document.getElementById(`exactScore2_${matchId}`);
    if (s1 && s2 && (s1.value !== '' || s2.value !== '')) {
      try { await placeFinalBet(matchId, 'exact_score', true); placed++; } catch(e) { errors++; }
    }
  }

  // Жёлтые
  if (match.show_yellow_cards) {
    const input = document.getElementById(`yellowCards_${matchId}`);
    if (input && input.value !== '') {
      try { await placeFinalBet(matchId, 'yellow_cards', true); placed++; } catch(e) { errors++; }
    }
  }

  // Красные
  if (match.show_red_cards) {
    const input = document.getElementById(`redCards_${matchId}`);
    if (input && input.value !== '') {
      try { await placeFinalBet(matchId, 'red_cards', true); placed++; } catch(e) { errors++; }
    }
  }

  // Угловые
  if (match.show_corners) {
    const input = document.getElementById(`corners_${matchId}`);
    if (input && input.value !== '') {
      try { await placeFinalBet(matchId, 'corners', true); placed++; } catch(e) { errors++; }
    }
  }

  // Пенальти в игре
  if (match.show_penalties_in_game) {
    const checkbox = document.getElementById(`penaltiesInGame_${matchId}`);
    if (checkbox && checkbox.getAttribute('data-toggle-state') !== 'neutral') {
      try { await placeFinalBet(matchId, 'penalties_in_game', true); placed++; } catch(e) { errors++; }
    }
  }

  // Доп. время
  if (match.show_extra_time) {
    const checkbox = document.getElementById(`extraTime_${matchId}`);
    if (checkbox && checkbox.getAttribute('data-toggle-state') !== 'neutral') {
      try { await placeFinalBet(matchId, 'extra_time', true); placed++; } catch(e) { errors++; }
    }
  }

  // Пенальти в конце
  if (match.show_penalties_at_end) {
    const checkbox = document.getElementById(`penaltiesAtEnd_${matchId}`);
    if (checkbox && checkbox.getAttribute('data-toggle-state') !== 'neutral') {
      try { await placeFinalBet(matchId, 'penalties_at_end', true); placed++; } catch(e) { errors++; }
    }
  }

  // Перерисовываем один раз в конце
  if (placed > 0) {
    const { displayMatches } = await import('./matches.js');
    displayMatches();
    initToggleStates();
  }

  if (placed > 0 && errors === 0) {
    // Собираем информацию о сохранённых параметрах
    let summary = '';
    if (match.show_exact_score) {
      const s1 = document.getElementById(`exactScore1_${matchId}`);
      const s2 = document.getElementById(`exactScore2_${matchId}`);
      if (s1 && s2) summary += `📊 Точный счёт: ${s1.value || 0}:${s2.value || 0}\n`;
    }
    if (match.show_yellow_cards) {
      const input = document.getElementById(`yellowCards_${matchId}`);
      if (input) summary += `🟨 Жёлтые: ${input.value || 0}\n`;
    }
    if (match.show_red_cards) {
      const input = document.getElementById(`redCards_${matchId}`);
      if (input) summary += `🟥 Красные: ${input.value || 0}\n`;
    }
    if (match.show_corners) {
      const input = document.getElementById(`corners_${matchId}`);
      if (input) summary += `⚽ Угловые: ${input.value || 0}\n`;
    }
    if (match.show_penalties_in_game) {
      const cb = document.getElementById(`penaltiesInGame_${matchId}`);
      if (cb && cb.getAttribute('data-toggle-state') !== 'neutral') {
        summary += `⚽ Пенальти в игре: ${cb.getAttribute('data-toggle-state') === 'true' ? 'ДА' : 'НЕТ'}\n`;
      }
    }
    if (match.show_extra_time) {
      const cb = document.getElementById(`extraTime_${matchId}`);
      if (cb && cb.getAttribute('data-toggle-state') !== 'neutral') {
        summary += `⏱ Доп. время: ${cb.getAttribute('data-toggle-state') === 'true' ? 'ДА' : 'НЕТ'}\n`;
      }
    }
    if (match.show_penalties_at_end) {
      const cb = document.getElementById(`penaltiesAtEnd_${matchId}`);
      if (cb && cb.getAttribute('data-toggle-state') !== 'neutral') {
        summary += `⚽ Пенальти в конце: ${cb.getAttribute('data-toggle-state') === 'true' ? 'ДА' : 'НЕТ'}\n`;
      }
    }
    await showCustomAlert(`Параметры сохранены:\n\n${summary}`, "Успех", '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');
  } else if (placed === 0) {
    await showCustomAlert("Заполните хотя бы один параметр", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
  }
}

export async function placeFinalBet(matchId, parameterType, skipRefresh = false) {
  if (!state.currentUser) {
    await showCustomAlert("Сначала введите ваше имя", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
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
      await showCustomAlert("Ошибка: поле ввода не найдено", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
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
      await showCustomAlert("Ошибка: поле переключателя не найдено", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      return;
    }

    // Проверяем, что toggle не в нейтральном состоянии
    const toggleState = checkbox.getAttribute("data-toggle-state");
    if (toggleState === "neutral") {
      await showCustomAlert('Пожалуйста, выберите значение: ДА или НЕТ', "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
      return;
    }

    // Читаем значение из data-toggle-state, а не из checkbox.checked!
    betValue = toggleState === "true" ? "ДА" : "НЕТ";
  }

  const match = state.matches.find((m) => m.id === matchId);
  if (match) {
    const effectiveStatus = getMatchStatusByDate(match);
    if (effectiveStatus !== "pending") {
      await showCustomAlert("Ну, куда ты, малютка, матч уже начался", "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>');
      return;
    }
  } else {
    await showCustomAlert("Матч не найден", "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>');
    return;
  }

  try {
    // Проверяем, есть ли уже ставка на этот параметр
    const checkResponse = await fetch(`/api/user/${state.currentUser.id}/bets`);
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
          user_id: state.currentUser.id,
        }),
      });
    }

    // Создаём новую ставку на финальный параметр
    const response = await fetch("/api/bets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: state.currentUser.id,
        match_id: matchId,
        prediction: betValue,
        amount: 1,
        is_final_bet: 1,
        parameter_type: parameterType,
      }),
    });

    if (response.ok) {

      // Обновляем список ставок
      const checkResponse = await fetch(`/api/user/${state.currentUser.id}/bets`);
      const bets = await checkResponse.json();
      setUserBets(bets);

      // Загружаем параметры финала для корректного отображения статуса
      let finalParameters = {};
      try {
        const paramsResponse = await fetch("/api/final-parameters-results");
        if (paramsResponse.ok) {
          finalParameters = await paramsResponse.json();
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

      // Перерисовываем матчи чтобы кнопки команд обновились (если не пропускаем)
      if (!skipRefresh) {
        displayMatches();

        // Восстанавливаем состояние всех тоглов (displayMatches их сбрасывает)
        initToggleStates();
      }

      // Блокируем параметр после успешного сохранения ставки
      lockFinalParameter(matchId, parameterType);
    } else {
      await showCustomAlert("Ошибка при создании ставки", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error("Ошибка при размещении ставки на финальный параметр:", error);
    await showCustomAlert("Ошибка при размещении ставки", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

export async function loadMyBets() {
  if (!state.currentUser) {
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

    const response = await fetch(`/api/user/${state.currentUser.id}/bets`);
    const bets = await response.json();
    setUserBets(bets);

    // Загружаем параметры финала для проверки ставок
    let finalParameters = {};
    try {
      const paramsResponse = await fetch("/api/final-parameters-results");
      if (paramsResponse.ok) {
        finalParameters = await paramsResponse.json();
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
    
    if (state.isMatchUpdatingEnabled) {
      displayMatches(); // Перерисовываем матчи чтобы выделить с ставками
      // initToggleStates вызовется в конце displayMatches
    }
  } catch (error) {
    console.error("Ошибка при загрузке ставок:", error);
  }
}

export function displayMyBets(bets) {
  const myBetsList = document.getElementById("myBetsList");

  if (bets.length === 0) {
    myBetsList.innerHTML =
      '<div class="empty-message">У вас пока нет ставок</div>';
    return;
  }

  // Сначала определяем статус для ВСЕХ ставок
  const betsWithStatus = bets.map((bet) => {
    let statusClass = "pending";
    let statusText = '<svg class="icon" aria-hidden="true"><use href="#icon-pending"></use></svg> В ожидании';
    let normalizedPrediction = bet.prediction;
    let isCancelled = false; // Флаг для отменённых матчей

    // Проверяем, отменён ли матч
    if (['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(bet.match_status)) {
      statusClass = "cancelled";
      statusText = '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>' + ' Отмена';
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
            statusText = '<svg class="icon" aria-hidden="true"><use href="#icon-pending"></use></svg> В ожидании';
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
              statusText = '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>' + ' Выиграла';
            } else {
              statusClass = "lost";
              statusText = '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>' + ' Проиграла';
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
              statusText = '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>' + ' Выиграла';
            } else {
              statusClass = "lost";
              statusText = '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>' + ' Проиграла';
            }
          }
        }
    } // Закрываем блок else для не отменённых матчей

        // Показываем кнопку удаления: админу/модератору всегда, остальным только для матчей со статусом "pending"
        const canDelete = (typeof canManageMatches === 'function' && canManageMatches()) || bet.match_status === "pending";
        const deleteBtn = canDelete
          ? `<button class="bet-delete-btn" onclick="deleteBet(${bet.id})"><svg class="icon" aria-label="Неправильно"><use href="#icon-wrong"></use></svg></button>`
          : "";

        return {
          bet: { ...bet, result: statusClass }, // Добавляем result в объект bet
          statusClass,
          statusText,
          normalizedPrediction,
          deleteBtn,
          eventName: bet.event_name || "Турнир не указан",
          isCancelled // Добавляем флаг отменённого матча
        };
      });

  // Объединяем финальные ставки одного матча в одну карточку
  const mergedBets = [];
  const finalBetsByMatch = {};

  betsWithStatus.forEach(betData => {
    if (betData.bet.is_final_bet) {
      const key = betData.bet.match_id;
      if (!finalBetsByMatch[key]) {
        finalBetsByMatch[key] = [];
      }
      finalBetsByMatch[key].push(betData);
    } else {
      mergedBets.push(betData);
    }
  });

  // Для каждого финального матча — находим основную ставку и прикрепляем параметры
  Object.entries(finalBetsByMatch).forEach(([matchId, finalBets]) => {
    // Ищем основную ставку на этот матч (is_final_bet = 0)
    const mainBetIndex = mergedBets.findIndex(b => b.bet.match_id === parseInt(matchId) && !b.bet.is_final_bet);
    
    if (mainBetIndex !== -1) {
      // Прикрепляем финальные параметры к основной ставке
      mergedBets[mainBetIndex].finalParams = finalBets;
    } else {
      // Нет основной ставки — создаём виртуальную карточку из первого параметра
      const first = finalBets[0];
      mergedBets.push({
        ...first,
        finalParams: finalBets,
        statusClass: first.statusClass,
        statusText: first.statusText,
      });
    }
  });

  // Сортируем ВСЕ ставки: 
  // 1. Сначала "pending"
  // 2. Потом завершенные (won/lost) по дате турнира (новые первыми)
  // 3. Турниры без даты в самом низу
  const sortedBets = mergedBets.sort((a, b) => {
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
      group.bets.forEach(({ bet, statusClass, statusText, normalizedPrediction, deleteBtn, isCancelled, finalParams }) => {
        html += generateBetHTML(bet, statusClass, statusText, normalizedPrediction, deleteBtn, isCancelled, finalParams || null);
      });
    });
    
    html += `
        </div>
    `;
  });

  myBetsList.innerHTML = html;
}

// Вспомогательная функция для генерации HTML одной ставки
export function generateBetHTML(bet, statusClass, statusText, normalizedPrediction, deleteBtn, isCancelled = false, finalParams = null) {
  // Стили для отменённых матчей: зачёркнутый текст и чёрно-белый фильтр
  const cancelledStyle = isCancelled 
    ? 'text-decoration: line-through; filter: grayscale(100%); opacity: 0.7;' 
    : '';

  // Генерируем HTML для финальных параметров (если есть)
  let finalParamsHTML = '';
  if (finalParams && finalParams.length > 0) {
    const paramNames = {
      exact_score: "Точный счет",
      yellow_cards: "Желтые",
      red_cards: "Красные",
      corners: "Угловые",
      penalties_in_game: "Пенальти в игре",
      extra_time: "Доп. время",
      penalties_at_end: "Пенальти в конце",
    };
    const paramIcons = {
      exact_score: '<svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg>',
      yellow_cards: '<svg class="icon" aria-hidden="true"><use href="#icon-yellow-card"></use></svg>',
      red_cards: '<svg class="icon" aria-hidden="true"><use href="#icon-red-card"></use></svg>',
      corners: '<svg class="icon" aria-hidden="true"><use href="#icon-matches"></use></svg>',
      penalties_in_game: '<svg class="icon" aria-hidden="true"><use href="#icon-matches"></use></svg>',
      extra_time: '<svg class="icon" aria-hidden="true"><use href="#icon-clock"></use></svg>',
      penalties_at_end: '<svg class="icon" aria-hidden="true"><use href="#icon-matches"></use></svg>',
    };

    finalParams.forEach(fp => {
      const paramName = paramNames[fp.bet.parameter_type] || fp.bet.parameter_type;
      const paramIcon = paramIcons[fp.bet.parameter_type] || '';
      let predictionDisplay = fp.bet.prediction;
      if (fp.bet.parameter_type === 'exact_score') {
        predictionDisplay = `${fp.bet.team1_name} ${fp.bet.prediction} ${fp.bet.team2_name}`;
      }

      // Определяем стиль результата
      let resultHTML = '';
      if (fp.statusClass === 'won') {
        resultHTML = ' <span style="color: #4caf50; font-size: 0.85em;">✓</span>';
      } else if (fp.statusClass === 'lost') {
        resultHTML = ' <span style="color: #f44336; font-size: 0.85em;">✗</span>';
      }

      finalParamsHTML += `<div style="font-size: 0.85em; color: #b0b8c8; margin-bottom: 3px; padding-left: 4px;">
        ${paramIcon} ${paramName}: <strong>${predictionDisplay}</strong>${resultHTML}
      </div>`;
    });

    finalParamsHTML = `<div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.08);">${finalParamsHTML}</div>`;
  }
  
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
                <svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Счет: <span style="${
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
                <svg class="icon" aria-hidden="true"><use href="#icon-yellow-card"></use></svg> Желтые: <span style="${
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
                <svg class="icon" aria-hidden="true"><use href="#icon-red-card"></use></svg> Красные: <span style="${
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
            ${bet.is_final ? '<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg>' + ' ФИНАЛ' : bet.round ? `${bet.round}` : ""}
        </div>
        ${finalParamsHTML}
        ${deleteBtn}
    </div>
  `;
}

// Функция для переключения видимости ставок турнира
export function toggleTournamentBets(toggleId) {
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
export async function deleteBet(betId) {
  if (!state.currentUser) {
    await showCustomAlert("Сначала войдите в систему", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  try {
    // Находим информацию о ставке перед удалением
    const bet = state.userBets.find((b) => b.id === betId);
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
            user_id: state.currentUser.id,
          }),
        });
        
        if (deleteScoreResponse.ok) {
        } else {
        }
      } catch (error) {
      }

      // Удаляем прогноз на карточки
      try {
        const deleteCardsResponse = await fetch(`/api/cards-predictions/${matchId}`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: state.currentUser.id,
          }),
        });
        
        if (deleteCardsResponse.ok) {
        } else {
        }
      } catch (error) {
      }

      // Очищаем прогнозы в объекте матча
      const match = state.matches.find(m => m.id === matchId);
      if (match) {
        match.predicted_score_team1 = null;
        match.predicted_score_team2 = null;
        match.predicted_yellow_cards = null;
        match.predicted_red_cards = null;
      }
    }

    // ПОТОМ удаляем ставку
    const response = await fetch(`/api/bets/${betId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: state.currentUser.id,
        username: state.currentUser.username,
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

    // <svg class="icon" aria-hidden="true"><use href="#icon-refresh"></use></svg> Полностью перезагружаем список ставок с БД
    // loadMyBets уже вызывает displayMatches внутри, поэтому не нужно вызывать его отдельно
    await loadMyBets();
  } catch (error) {
    console.error("Ошибка при удалении ставки:", error);
    await showCustomAlert("Ошибка при удалении ставки", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}
