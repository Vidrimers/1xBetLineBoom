// Случайная ставка по всем матчам выбранного тура

import {
  currentUser,
  currentRoundFilter,
  matches,
  userBets,
  events,
  currentEventId,
  iconTitles,
} from './state.js';
import { showCustomAlert } from './ui.js';

// TODO (таск 19): добавить импорт после создания matches.js:
import { getMatchStatusByDate } from './matches.js';
// TODO (таск 20): добавить импорт после создания bets.js:
import { loadMyBets } from './bets.js';

// Позиционирование кубика относительно кнопки
export function updateDicePosition() {
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

export function startDicePositionTracking() {
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

export function stopDicePositionTracking() {
  if (dicePositionInterval) {
    clearInterval(dicePositionInterval);
    dicePositionInterval = null;
  }
}

// Функция для получения title иконки
export function getIconTitle(icon) {
  return (
    iconTitles[icon] ||
    (icon.startsWith("http") || icon.length > 10 ? "Кастомная иконка" : icon)
  );
}

export { iconTitles };

// ⚠️ ДУБЛИКАТ: аналогичная логика есть в ТГ-боте OnexBetLineBoombot.js
// При изменении алгоритма генерации — синхронизировать оба файла

// Пуассон-распределение для реалистичного счёта (λ = 1.3, среднее ~2.6 голов за матч)
function poissonRandom(lambda) {
  let L = Math.exp(-lambda), k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

// Взвешенный рандом для красных карточек (0 — ~75%, 1 — ~20%, 2 — ~4%, 3 — ~1%)
function weightedRedCards() {
  const r = Math.random();
  if (r < 0.75) return 0;
  if (r < 0.95) return 1;
  if (r < 0.99) return 2;
  return 3;
}

export async function luckyBetForCurrentRound() {
  if (!currentUser) {
    await showCustomAlert("Сначала войдите в аккаунт", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }
  if (!currentRoundFilter || currentRoundFilter === "all") {
    await showCustomAlert("Сначала выберите тур", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
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
    await showCustomAlert("Нет доступных матчей для случайной ставки в этом туре", "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>');
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
  
  // Генерируем все ставки и собираем промисы для параллельной отправки
  const allPromises = [];
  let scorePredictionsCount = 0;
  let cardsPredictionsCount = 0;
  
  for (const match of matchesToBet) {
    // Генерируем счёт через Пуассон-распределение (λ = 1.3)
    const team1Score = poissonRandom(1.3);
    const team2Score = poissonRandom(1.3);
    
    // Определяем результат на основе счёта
    let prediction;
    if (team1Score > team2Score) {
      prediction = "team1";
    } else if (team2Score > team1Score) {
      prediction = "team2";
    } else {
      prediction = "draw";
    }
    
    // Генерируем карточки
    const yellowCards = poissonRandom(3.5);
    const redCards = weightedRedCards();
    
    // Ставка на результат
    allPromises.push(
      fetch("/api/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: currentUser.id,
          match_id: match.id,
          prediction: prediction,
          amount: 0,
        }),
      })
    );
    
    // Прогноз на счёт
    if (match.score_prediction_enabled) {
      allPromises.push(
        fetch("/api/score-predictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: currentUser.id,
            match_id: match.id,
            score_team1: team1Score,
            score_team2: team2Score,
          }),
        })
      );
      scorePredictionsCount++;
    }
    
    // Прогноз на карточки
    if (match.yellow_cards_prediction_enabled || match.red_cards_prediction_enabled) {
      allPromises.push(
        fetch("/api/cards-predictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: currentUser.id,
            match_id: match.id,
            yellow_cards: match.yellow_cards_prediction_enabled ? yellowCards : null,
            red_cards: match.red_cards_prediction_enabled ? redCards : null,
          }),
        })
      );
      cardsPredictionsCount++;
    }
  }
  
  // Отправляем все запросы параллельно
  try {
    await Promise.all(allPromises);
  } catch (e) {
    console.error("Ошибка при отправке случайных ставок:", e);
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
