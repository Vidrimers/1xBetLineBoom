// ===== СИСТЕМА УВЕДОМЛЕНИЙ О ГОЛАХ =====
// Перенесено из js/index.js

import { currentUser, matchScores, matchFinishTimes, deletedFinishedMatches } from './state.js';
import { showLiveTeamStats } from './liveStats.js';

export { matchScores, matchFinishTimes, deletedFinishedMatches } from './state.js';

export function saveDeletedFinishedMatches() {
  localStorage.setItem('deletedFinishedMatches', JSON.stringify([...deletedFinishedMatches]));
}

// Закрыть карточку уведомления вручную
export function closeGoalNotification(matchId) {
  const container = document.getElementById('goalNotifications');
  if (!container) return;

  const notification = container.querySelector(`[data-match-id="${matchId}"]`);
  if (notification) {
    console.log(`🗑️ Ручное закрытие карточки матча ${matchId}`);
    notification.classList.add('removing');
    setTimeout(() => notification.remove(), 300);

    deletedFinishedMatches.add(matchId);
    saveDeletedFinishedMatches();

    delete matchFinishTimes[matchId];
    delete matchScores[matchId];
  }
}

// Очередь уведомлений
const notificationQueue = [];
let isShowingNotification = false;

// Показать уведомление о голе
export function showGoalNotification(match) {
  console.log('🎨 showGoalNotification вызвана для матча:', match);

  const container = document.getElementById('goalNotifications');
  if (!container) {
    console.error('❌ Контейнер goalNotifications не найден!');
    return;
  }

  const existingNotification = container.querySelector(`[data-match-id="${match.id}"]`);
  if (existingNotification) {
    console.log('⚠️ Карточка уже существует, пропускаем создание');
    return;
  }

  const notification = document.createElement('div');
  notification.className = 'goal-notification';
  notification.setAttribute('data-match-id', match.id);

  const isDraw = match.betTeam && (match.betTeam.toLowerCase() === 'ничья' || match.betTeam.toLowerCase() === 'draw');
  const shouldUnderlineTeam1 = (match.betTeam === match.team1 || isDraw);
  const shouldUnderlineTeam2 = (match.betTeam === match.team2 || isDraw);

  const team1Html = shouldUnderlineTeam1
    ? `<span style="position: relative; display: inline-block;">${match.team1}<span style="position: absolute; bottom: -2px; left: 0; right: 0; height: 2px; background: #fff;"></span></span>`
    : match.team1;
  const team2Html = shouldUnderlineTeam2
    ? `<span style="position: relative; display: inline-block;">${match.team2}<span style="position: absolute; bottom: -2px; left: 0; right: 0; height: 2px; background: #fff;"></span></span>`
    : match.team2;

  const isFinished = match.status === 'Finished' ||
                    match.status === 'finished' ||
                    match.status === 'Full Time' ||
                    match.status === 'FT' ||
                    match.status === 'Completed' ||
                    match.status === 'completed';

  const statusText = isFinished ? 'ЗАВЕРШЕН' : 'LIVE';
  const statusColor = isFinished ? '#ff9800' : '#4caf50';

  notification.innerHTML = `
    <div class="goal-notification-header">
      <span class="goal-notification-icon"><svg class="icon" aria-hidden="true"><use href="#icon-matches"></use></svg></span>
      <span class="goal-notification-title" style="color: ${statusColor};">${statusText}</span>
      <button onclick="closeGoalNotification(${match.id})" style="margin-left: auto; background: transparent; border: none; color: rgba(255,255,255,0.7); cursor: pointer; font-size: 16px; padding: 0; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;" title="Закрыть"><svg class="icon" aria-label="Неправильно"><use href="#icon-wrong"></use></svg></button>
    </div>
    <div class="goal-notification-teams">
      ${team1Html} - ${team2Html}
    </div>
    <div class="goal-notification-score">${match.score}</div>
  `;

  notification.style.cursor = 'pointer';
  notification.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
      console.log('🖱️ Клик по карточке избранного, открываем статистику для матча:', match.id);
      const matchData = {
        id: match.id,
        team1: match.team1,
        team2: match.team2,
        score: match.score,
        status: match.status,
        elapsed: match.elapsed
      };
      showLiveTeamStats(matchData);
    }
  });

  console.log('➕ Добавляем карточку в контейнер');
  container.appendChild(notification);
  console.log('✅ Карточка добавлена, всего карточек:', container.children.length);

  if (currentUser && currentUser.live_sound === 1) {
    playGoalSound();
  }

  const isDesktop = window.innerWidth > 1400;

  if (isDesktop) {
    isShowingNotification = false;
    processNotificationQueue();
  } else {
    setTimeout(() => {
      notification.classList.add('removing');
      setTimeout(() => {
        notification.remove();
        isShowingNotification = false;
        processNotificationQueue();
      }, 300);
    }, 6000);
  }
}

export function processNotificationQueue() {
  if (isShowingNotification || notificationQueue.length === 0) return;

  isShowingNotification = true;
  const match = notificationQueue.shift();
  showGoalNotification(match);
}

export function addNotificationToQueue(match) {
  notificationQueue.push(match);
  if (!isShowingNotification) {
    processNotificationQueue();
  }
}

export function playGoalSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
  } catch (error) {
    console.error('Ошибка воспроизведения звука:', error);
  }
}

export function processMatches(matches, favorites, isDesktop) {
  const foundMatchIds = matches.map(m => m.id);

  if (isDesktop) {
    console.log('🖥️ ДЕСКТОП: Обработка матчей...');
    matches.forEach(match => {
      const previousScore = matchScores[match.id];
      const currentScore = match.score || '0:0';

      const isFinished = match.status === 'Finished' ||
                        match.status === 'finished' ||
                        match.status === 'Full Time' ||
                        match.status === 'FT' ||
                        match.status === 'Completed' ||
                        match.status === 'completed' ||
                        match.status === 'FINISHED' ||
                        match.status === 'COMPLETED';

      if (match.status && match.status !== 'live' && match.status !== 'LIVE' && match.status !== 'in_progress') {
        console.log(`🔍 Матч ${match.id} (${match.team1} - ${match.team2}): статус = "${match.status}", isFinished = ${isFinished}`);
      }

      if (deletedFinishedMatches.has(match.id)) {
        console.log(`⏭️ Пропускаем матч ${match.id} - уже был удален после завершения`);
        return;
      }

      if (isFinished && !matchFinishTimes[match.id]) {
        matchFinishTimes[match.id] = Date.now();
        console.log(`⏱️ Матч ${match.id} завершен, запускаем таймер на 1 минуту`);

        setTimeout(() => {
          const container = document.getElementById('goalNotifications');
          if (container) {
            const notification = container.querySelector(`[data-match-id="${match.id}"]`);
            if (notification) {
              console.log(`⏰ 1 минута прошла, удаляем карточку матча ${match.id}`);
              notification.classList.add('removing');
              setTimeout(() => notification.remove(), 300);
            }
          }

          // Удаляем матч из избранного напрямую через localStorage
          const storedFavs = localStorage.getItem('favoriteMatches');
          let favs = storedFavs ? JSON.parse(storedFavs) : [];
          const idx = favs.indexOf(match.id);
          if (idx > -1) {
            favs.splice(idx, 1);
            localStorage.setItem('favoriteMatches', JSON.stringify(favs));
            localStorage.removeItem(`favoriteMatch_${match.id}`);
            console.log(`🗑️ Матч ${match.id} удален из избранного (завершен)`);
          }

          deletedFinishedMatches.add(match.id);
          saveDeletedFinishedMatches();
          delete matchFinishTimes[match.id];
          delete matchScores[match.id];
        }, 60000);
      }

      updateDesktopNotification({
        id: match.id,
        team1: match.team1,
        team2: match.team2,
        score: currentScore,
        status: match.status,
        elapsed: match.elapsed
      });

      if (previousScore && previousScore !== currentScore) {
        console.log('🔊 Счет изменился! Воспроизведение звука...');
        if (currentUser && currentUser.live_sound === 1) {
          playGoalSound();
        }
      }

      matchScores[match.id] = currentScore;
    });

    const container = document.getElementById('goalNotifications');
    if (container) {
      const existingNotifications = container.querySelectorAll('.goal-notification');
      existingNotifications.forEach(notification => {
        const matchId = parseInt(notification.getAttribute('data-match-id'));
        if (!foundMatchIds.includes(matchId)) {
          console.log(`🗑️ Удаляем карточку уведомления для матча ${matchId} (убран из избранного)`);
          notification.classList.add('removing');
          setTimeout(() => notification.remove(), 300);
          delete matchFinishTimes[matchId];
          delete matchScores[matchId];
        }
      });
    }
  } else {
    console.log('📱 МОБИЛЬНАЯ: Проверка изменений счета...');
    matches.forEach(match => {
      if (match.score) {
        const previousScore = matchScores[match.id];

        if (previousScore && previousScore !== match.score) {
          console.log(`🎯 Счет изменился для матча ${match.id}: ${previousScore} → ${match.score}`);
          addNotificationToQueue(match);
        }

        matchScores[match.id] = match.score;
      }
    });
  }
}

export function updateDesktopNotification(match) {
  console.log('🎯 updateDesktopNotification вызвана для матча:', match);

  const container = document.getElementById('goalNotifications');
  if (!container) {
    console.error('❌ Контейнер goalNotifications не найден!');
    return;
  }

  let notification = container.querySelector(`[data-match-id="${match.id}"]`);

  if (notification) {
    console.log('♻️ Обновляем существующую карточку');

    const scoreElement = notification.querySelector('.goal-notification-score');
    const currentScore = scoreElement?.textContent || '';
    const newScore = match.score || '0:0';

    if (currentScore !== newScore) {
      console.log(`📊 Обновление счета: ${currentScore} → ${newScore}`);
      if (scoreElement) {
        scoreElement.textContent = newScore;

        scoreElement.style.animation = 'none';
        setTimeout(() => {
          scoreElement.style.animation = 'goalBounce 0.6s ease-out';
        }, 10);

        const isDesktop = window.innerWidth > 1400;
        if (isDesktop) {
          notification.classList.add('shake');
          setTimeout(() => {
            notification.classList.remove('shake');
          }, 6000);
        }
      }
    }

    const titleElement = notification.querySelector('.goal-notification-title');
    if (titleElement && match.status) {
      const isFinished = match.status === 'Finished' ||
                        match.status === 'finished' ||
                        match.status === 'Full Time' ||
                        match.status === 'FT' ||
                        match.status === 'Completed' ||
                        match.status === 'completed';

      if (isFinished && titleElement.textContent === 'LIVE') {
        console.log('🏁 Матч завершен, обновляем статус');
        titleElement.textContent = 'ЗАВЕРШЕН';
        titleElement.style.color = '#ff9800';
      }
    }
  } else {
    console.log('🆕 Создаем новую карточку');
    showGoalNotification(match);
  }
}

// ===== ПЛАВНОЕ СЛЕДОВАНИЕ ИЗБРАННЫХ ЗА СКРОЛЛОМ (ДЕСКТОП) =====
let scrollTimeout;
let targetScrollY = 0;
let currentScrollY = 0;

export function smoothScrollNotifications() {
  const isDesktop = window.innerWidth > 1400;
  if (!isDesktop) return;

  const container = document.getElementById('goalNotifications');
  if (!container) return;

  const diff = targetScrollY - currentScrollY;
  if (Math.abs(diff) > 0.5) {
    currentScrollY += diff * 0.15;
    container.style.transform = `translateY(${currentScrollY}px)`;
    requestAnimationFrame(smoothScrollNotifications);
  } else {
    currentScrollY = targetScrollY;
    container.style.transform = `translateY(${currentScrollY}px)`;
  }
}

export function handleScroll() {
  const isDesktop = window.innerWidth > 1400;
  if (!isDesktop) return;

  targetScrollY = window.scrollY;

  requestAnimationFrame(smoothScrollNotifications);

  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    const viewportHeight = window.innerHeight;
    const containerHeight = document.getElementById('goalNotifications')?.offsetHeight || 0;

    if (targetScrollY > 0 && containerHeight > 0) {
      const maxScroll = Math.max(0, targetScrollY - (viewportHeight - containerHeight - 100));
      targetScrollY = Math.min(targetScrollY, maxScroll);
      requestAnimationFrame(smoothScrollNotifications);
    }
  }, 1000);
}

// Добавляем обработчик скролла только на десктопе
if (window.innerWidth > 1400) {
  window.addEventListener('scroll', handleScroll, { passive: true });

  window.addEventListener('resize', () => {
    const isDesktop = window.innerWidth > 1400;
    const container = document.getElementById('goalNotifications');
    if (!isDesktop && container) {
      container.style.transform = 'translateY(0)';
      currentScrollY = 0;
      targetScrollY = 0;
    }
  });
}

export async function checkMatchEventsForNotifications(matchIds, userId) {
  try {
    console.log(`📬 Проверка событий для ${matchIds.length} матчей`);

    const response = await fetch('/api/check-match-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchIds: matchIds,
        userId: userId
      })
    });

    if (response.ok) {
      const result = await response.json();
      if (result.notifications > 0) {
        console.log(`✅ Отправлено ${result.notifications} уведомлений в Telegram`);
      }
    }
  } catch (error) {
    console.error('❌ Ошибка проверки событий:', error);
  }
}
