// Случайная ставка по всем матчам выбранного тура

import * as state from './state.js';
import {
  iconTitles,
} from './state.js';
import { getMatchStatusByDate } from './matches.js';
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

export async function luckyBetForCurrentRound() {
  if (!state.currentUser) {
    alert("Сначала войдите в аккаунт");
    return;
  }
  if (!state.currentRoundFilter || state.currentRoundFilter === "all") {
    alert("Сначала выберите тур");
    return;
  }
  // Находим все матчи выбранного тура, которые еще не завершены/отменены и на которые пользователь не ставил
  const matchesToBet = matches.filter(
    (m) =>
      m.round === state.currentRoundFilter &&
      getMatchStatusByDate(m) !== "finished" &&
      !['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(getMatchStatusByDate(m)) &&
      !state.userBets.some((b) => b.match_id === m.id)
  );
  if (matchesToBet.length === 0) {
    alert("Нет доступных матчей для случайной ставки в этом туре");
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
  
  // Подсчитываем сколько матчей с прогнозами на счёт и карточки
  let scorePredictionsCount = 0;
  let cardsPredictionsCount = 0;
  
  // Для каждого такого матча делаем случайную ставку
  for (const match of matchesToBet) {
    // Генерируем рандомный счет (0-5 голов для каждой команды)
    const team1Score = Math.floor(Math.random() * 6);
    const team2Score = Math.floor(Math.random() * 6);
    
    // Определяем результат на основе счета
    let prediction;
    if (team1Score > team2Score) {
      prediction = "team1";
    } else if (team2Score > team1Score) {
      prediction = "team2";
    } else {
      prediction = "draw";
    }
    
    // Генерируем рандомные карточки (общее количество в матче)
    const yellowCards = Math.floor(Math.random() * 9); // 0-8 желтых карточек
    const redCards = Math.floor(Math.random() * 4); // 0-3 красных карточек
    
    try {
      // Отправляем ставку на результат
      await fetch("/api/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: state.currentUser.id,
          match_id: match.id,
          prediction: prediction,
          amount: 0,
        }),
      });
      
      // Отправляем прогноз на счет если включен для матча
      if (match.score_prediction_enabled) {
        await fetch("/api/score-predictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: state.currentUser.id,
            match_id: match.id,
            score_team1: team1Score,
            score_team2: team2Score,
          }),
        });
        scorePredictionsCount++;
      }
      
      // Отправляем прогноз на карточки если включен для матча
      if (match.yellow_cards_prediction_enabled || match.red_cards_prediction_enabled) {
        await fetch("/api/cards-predictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: state.currentUser.id,
            match_id: match.id,
            yellow_cards: match.yellow_cards_prediction_enabled ? yellowCards : null,
            red_cards: match.red_cards_prediction_enabled ? redCards : null,
          }),
        });
        cardsPredictionsCount++;
      }
      
    } catch (e) {
      console.error("Ошибка при отправке случайной ставки:", e);
    }
  }
  
  // Отправляем уведомление админу
  try {
    const currentEvent = state.events.find(e => e.id === state.currentEventId);
    await fetch("/api/admin/notify-lucky-bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: state.currentUser.id,
        eventName: currentEvent ? currentEvent.name : "Неизвестный турнир",
        round: state.currentRoundFilter,
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
