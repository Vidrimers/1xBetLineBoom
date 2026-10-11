// ===== СИСТЕМА УВЕДОМЛЕНИЙ О ГОЛАХ =====
// Перенесено из js/index.js

import { currentUser, matchScores, matchFinishTimes, deletedFinishedMatches } from './state.js';
import { showLiveTeamStats } from './liveStats.js';

export { matchScores, matchFinishTimes, deletedFinishedMatches } from './state.js';

export function saveDeletedFinishedMatches() {
  localStorage.setItem('deletedFinishedMatches', JSON.stringify([...deletedFinishedMatches]));
}

// ===== ПОЗИЦИИ СВОБОДНЫХ КАРТОЧЕК (десктоп) =====
function isDesktopNotifications() {
  return window.innerWidth > 1400;
}

function getSavedNotificationPosition(matchId) {
  try {
    const raw = localStorage.getItem(`favoriteMatchPos_${matchId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveNotificationPosition(matchId, x, y) {
  localStorage.setItem(`favoriteMatchPos_${matchId}`, JSON.stringify({ x, y }));
}

function clearNotificationPosition(matchId) {
  localStorage.removeItem(`favoriteMatchPos_${matchId}`);
}

function findNotificationCard(matchId) {
  return findNotificationCards(matchId)[0] || null;
}

function findNotificationCards(matchId) {
  return Array.from(document.querySelectorAll(`.goal-notification[data-match-id="${matchId}"]`));
}

function formatTeamHtml(name, underlined) {
  if (!underlined) return name || '';
  return `<span style="position: relative; display: inline-block;">${name}<span style="position: absolute; bottom: -2px; left: 0; right: 0; height: 2px; background: #fff;"></span></span>`;
}

function buildTeamsHtml(team1, team2, betTeam) {
  const isDraw = betTeam && (String(betTeam).toLowerCase() === 'ничья' || String(betTeam).toLowerCase() === 'draw');
  const shouldUnderlineTeam1 = (betTeam === team1 || isDraw);
  const shouldUnderlineTeam2 = (betTeam === team2 || isDraw);
  return `${formatTeamHtml(team1, shouldUnderlineTeam1)} - ${formatTeamHtml(team2, shouldUnderlineTeam2)}`;
}

function clampToViewport(x, y, card) {
  // Ширина карточки — та, что уже выставлена / измерена, без раздувания
  const w = card.getBoundingClientRect().width || 320;
  const h = card.getBoundingClientRect().height || 120;
  const maxX = Math.max(8, window.innerWidth - w - 8);
  const maxY = Math.max(8, window.innerHeight - h - 8);
  return {
    x: Math.min(Math.max(8, x), maxX),
    y: Math.min(Math.max(8, y), maxY)
  };
}

// Выносим карточку в body (fixed в контейнере с transform не работает)
function makeCardFree(card, x, y) {
  // Запоминаем ТЕКУЩИЙ размер — без min-width, чтобы карточка не раздувалась
  const width = card.getBoundingClientRect().width || 200;

  if (card.parentElement !== document.body) {
    document.body.appendChild(card);
  }
  card.classList.add('is-free');
  card.style.position = 'fixed';
  card.style.width = `${width}px`;
  card.style.maxWidth = 'none';
  card.style.minWidth = '0';
  card.style.margin = '0';
  card.style.zIndex = '10001';

  const pos = clampToViewport(x, y, card);
  card.style.left = `${pos.x}px`;
  card.style.top = `${pos.y}px`;
  return pos;
}

function makeCardDocked(card) {
  const container = document.getElementById('goalNotifications');
  card.classList.remove('is-free', 'is-dragging');
  card.style.position = '';
  card.style.left = '';
  card.style.top = '';
  card.style.zIndex = '';
  card.style.width = '';
  card.style.maxWidth = '';
  card.style.minWidth = '';
  card.style.margin = '';
  if (container && card.parentElement !== container) {
    container.appendChild(card);
  }
}

// Вернуть карточку в дефолтную колонку
export function resetGoalNotificationPosition(matchId, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  clearNotificationPosition(matchId);
  const card = findNotificationCard(matchId);
  if (card) makeCardDocked(card);
}

// Drag только на десктопе; клик < 5px — открытие статистики
function attachNotificationDrag(card, matchId) {
  if (!isDesktopNotifications()) return;

  let startX = 0, startY = 0, origX = 0, origY = 0;
  let dragging = false, moved = false;

  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button')) return;

    const rect = card.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    origX = rect.left;
    origY = rect.top;
    dragging = true;
    moved = false;
    card.setPointerCapture(e.pointerId);
    card.style.cursor = 'grabbing';
  });

  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!moved && Math.hypot(dx, dy) < 5) return;

    if (!moved) {
      moved = true;
      // Запрет выделения текста на карточке и на сайте под ней
      e.preventDefault();
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      makeCardFree(card, origX, origY);
      card.classList.add('is-dragging');
    }

    const pos = clampToViewport(origX + dx, origY + dy, card);
    card.style.left = `${pos.x}px`;
    card.style.top = `${pos.y}px`;
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try { card.releasePointerCapture(e.pointerId); } catch (_) {}
    card.style.cursor = '';
    card.classList.remove('is-dragging');
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';

    if (moved) {
      const x = parseFloat(card.style.left) || origX;
      const y = parseFloat(card.style.top) || origY;
      saveNotificationPosition(matchId, x, y);
      // гасим click открытия статистики после drag
      card.dataset.justDragged = '1';
      setTimeout(() => { delete card.dataset.justDragged; }, 0);
    }
  };

  card.addEventListener('pointerup', endDrag);
  card.addEventListener('pointercancel', endDrag);
}

// Закрыть карточку уведомления вручную
export function closeGoalNotification(matchId) {
  const notification = findNotificationCard(matchId);
  if (!notification) return;

  console.log(`🗑 Ручное закрытие карточки матча ${matchId}`);
  notification.classList.add('removing');
  setTimeout(() => notification.remove(), 300);

  deletedFinishedMatches.add(matchId);
  saveDeletedFinishedMatches();
  clearNotificationPosition(matchId);

  delete matchFinishTimes[matchId];
  delete matchScores[matchId];
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

  const existingNotification = findNotificationCard(match.id);
  if (existingNotification) {
    console.log('⚠ Карточка уже существует, пропускаем создание');
    return;
  }

  const notification = document.createElement('div');
  notification.className = 'goal-notification';
  notification.setAttribute('data-match-id', match.id);

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
      <div class="goal-notification-actions">
        <button type="button" class="goal-notification-btn" onclick="resetGoalNotificationPosition(${match.id}, event)" title="Вернуть на место"><svg class="icon" aria-hidden="true"><use href="#icon-reset-position"></use></svg></button>
        <button type="button" class="goal-notification-btn" onclick="closeGoalNotification(${match.id})" title="Закрыть"><svg class="icon" aria-label="Неправильно"><use href="#icon-wrong"></use></svg></button>
      </div>
    </div>
    <div class="goal-notification-teams">
      ${buildTeamsHtml(match.team1, match.team2, match.betTeam)}
    </div>
    <div class="goal-notification-score">${match.score}</div>
  `;

  notification.style.cursor = 'pointer';
  notification.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (notification.dataset.justDragged) return;
    console.log('🖱 Клик по карточке избранного, открываем статистику для матча:', match.id);
    const matchData = {
      id: match.id,
      team1: match.team1,
      team2: match.team2,
      score: match.score,
      status: match.status,
      elapsed: match.elapsed
    };
    showLiveTeamStats(matchData);
  });

  console.log('➕ Добавляем карточку в контейнер');
  container.appendChild(notification);
  console.log('✅ Карточка добавлена, всего карточек:', container.children.length);

  // Восстановление свободной позиции после F5 / повторного создания
  const savedPos = getSavedNotificationPosition(match.id);
  if (savedPos && isDesktopNotifications()) {
    makeCardFree(notification, savedPos.x, savedPos.y);
  }

  attachNotificationDrag(notification, match.id);

  if (currentUser && currentUser.live_sound === 1) {
    playGoalSound();
  }

  const isDesktop = isDesktopNotifications();

  if (isDesktop) {
    isShowingNotification = false;
    processNotificationQueue();
  } else {
    setTimeout(() => {
      notification.classList.add('removing');
      setTimeout(() => {
        notification.remove();
        clearNotificationPosition(match.id);
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

// ===== ЗВУК (Web Audio + unlock по первому жесту) =====
// Браузеры блокируют звук без user-gesture — держим один AudioContext
// и разблокируем его при первом клике/тапе/клавише.
let sharedAudioContext = null;
let audioUnlocked = false;

function getAudioContext() {
  if (!sharedAudioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    sharedAudioContext = new Ctx();
  }
  return sharedAudioContext;
}

function unlockAudio() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => {
      audioUnlocked = true;
    }).catch(() => {});
  } else {
    audioUnlocked = true;
  }
}

if (typeof window !== 'undefined') {
  const unlockEvents = ['pointerdown', 'touchstart', 'click', 'keydown'];
  const onFirstGesture = () => {
    unlockAudio();
    unlockEvents.forEach((evt) => window.removeEventListener(evt, onFirstGesture, true));
  };
  unlockEvents.forEach((evt) => window.addEventListener(evt, onFirstGesture, true));
}

export async function playGoalSound() {
  try {
    const audioContext = getAudioContext();
    if (!audioContext) return;

    // Если аудио спит — пробуем разбудить (клик по кнопке = жест)
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch (_) {}
      if (audioContext.state === 'suspended') return;
    }

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
  console.log(`⭐ processMatches: ${matches.length} матчей, isDesktop=${isDesktop}, вкладка: ${document.querySelector('.tab-btn.active')?.textContent?.trim() || 'неизвестно'}`);
  const foundMatchIds = matches.map(m => String(m.id));

  if (isDesktop) {
    console.log('🖥 ДЕСКТОП: Обработка матчей...');
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
        console.log(`⏭ Пропускаем матч ${match.id} - уже был удален после завершения`);
        return;
      }

      if (isFinished && !matchFinishTimes[match.id]) {
        matchFinishTimes[match.id] = Date.now();
        console.log(`⏱ Матч ${match.id} завершен, запускаем таймер на 1 минуту`);

        setTimeout(() => {
          const notification = findNotificationCard(match.id);
          if (notification) {
            console.log(`⏰ 1 минута прошла, удаляем карточку матча ${match.id}`);
            notification.classList.add('removing');
            setTimeout(() => notification.remove(), 300);
          }

          // Удаляем матч из избранного напрямую через localStorage
          const storedFavs = localStorage.getItem('favoriteMatches');
          let favs = storedFavs ? JSON.parse(storedFavs) : [];
          const idx = favs.indexOf(match.id);
          if (idx > -1) {
            favs.splice(idx, 1);
            localStorage.setItem('favoriteMatches', JSON.stringify(favs));
            localStorage.removeItem(`favoriteMatch_${match.id}`);
            console.log(`🗑 Матч ${match.id} удален из избранного (завершен)`);
          }

          clearNotificationPosition(match.id);
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
        elapsed: match.elapsed,
        betTeam: match.betTeam
      });

      if (previousScore && previousScore !== currentScore) {
        console.log('🔊 Счет изменился! Воспроизведение звука...');
        if (currentUser && currentUser.live_sound === 1) {
          playGoalSound();
        }
      }

      matchScores[match.id] = currentScore;
    });

    // Ищем и в колонке, и свободные (body)
    document.querySelectorAll('.goal-notification').forEach(notification => {
      const matchId = String(notification.getAttribute('data-match-id'));
      if (!foundMatchIds.includes(matchId)) {
        console.log(`🗑 Удаляем карточку уведомления для матча ${matchId} (убран из избранного)`);
        notification.classList.add('removing');
        setTimeout(() => notification.remove(), 300);
        clearNotificationPosition(matchId);
        delete matchFinishTimes[matchId];
        delete matchScores[matchId];
      }
    });
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

  const notifications = findNotificationCards(match.id);

  if (notifications.length > 0) {
    console.log(`♻ Обновляем существующие карточки (${notifications.length})`);

    notifications.forEach(notification => {
      // Имена команд: обновляем, если пришли новые (в т.ч. RU вместо EN)
      const teamsElement = notification.querySelector('.goal-notification-teams');
      if (teamsElement && match.team1 && match.team2) {
        const newTeamsHtml = buildTeamsHtml(match.team1, match.team2, match.betTeam);
        if (teamsElement.innerHTML.trim() !== newTeamsHtml.trim()) {
          teamsElement.innerHTML = newTeamsHtml;
          console.log('🔤 Обновлены названия команд на карточке');
        }
      }

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
    });
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
