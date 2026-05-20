import { userBets, displayedBetStats } from './state.js';

// ===== СТАТИСТИКА СТАВОК =====

// Функция анимации счетчика
export function animateCounter(element, start, end, duration) {
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
export async function loadAndDisplayBetStats(matchId, forceAnimate = false) {
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

    // Показываем проценты только после начала матча
    const matchDateAttr = matchRow.dataset.matchDate;
    if (matchDateAttr) {
      const matchDate = new Date(matchDateAttr);
      if (matchDate > new Date()) {
        return; // Матч ещё не начался
      }
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
