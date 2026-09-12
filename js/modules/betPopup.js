import * as state from './state.js';
import { showTournamentParticipantBets } from './participants.js';

const POPUP_MAX_USERS = 10;
let popupEl = null;
let hideTimeout = null;
let activeButton = null;
let isTouchDevice = false;
let clickOutsideHandler = null;
let cachedData = {};

// Проверить, нужно ли показывать popup (match уже начался)
function isMatchStarted(match) {
  if (['cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover'].includes(match.status)) return true;
  if (match.status === 'finished' || match.winner) return true;
  if (!match.match_date) return (match.status || 'pending') !== 'pending';
  return new Date(match.match_date) <= new Date();
}

// Создать popup элемент при первом использовании
function ensurePopup() {
  if (popupEl) return;
  popupEl = document.createElement('div');
  popupEl.className = 'bet-popup';
  document.body.appendChild(popupEl);
  // Popup тоже может "поймать" курсор — не закрывать
  popupEl.addEventListener('mouseenter', () => {
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  });
  popupEl.addEventListener('mouseleave', () => {
    hideTimeout = setTimeout(closeBetPopup, 150);
  });
  // Клик на пользователя — открыть модалку ставок
  popupEl.addEventListener('click', (e) => {
    const userRow = e.target.closest('.bet-popup-user.clickable');
    if (!userRow) return;
    const userId = parseInt(userRow.dataset.userId, 10);
    const username = userRow.dataset.username;
    if (!userId || !state.currentEventId) return;
    closeBetPopup();
    showTournamentParticipantBets(userId, username, state.currentEventId);
  });
}

// Закрыть popup
export function closeBetPopup() {
  if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  if (popupEl) { popupEl.classList.remove('visible'); popupEl.innerHTML = ''; }
  activeButton = null;
  if (clickOutsideHandler) { document.removeEventListener('click', clickOutsideHandler); clickOutsideHandler = null; }
}

// Загрузить аватар с кэшированием в localStorage
function getAvatarSrc(userId, avatar) {
  const cacheKey = `avatar_${userId}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;
  if (avatar) {
    localStorage.setItem(cacheKey, avatar);
    return avatar;
  }
  return 'img/default-avatar.jpg';
}

// Загрузить пользователей с сервера
async function loadUsers(matchId, prediction) {
  const cacheKey = `${matchId}_${prediction}`;
  if (cachedData[cacheKey]) return cachedData[cacheKey];
  try {
    const resp = await fetch(`/api/match-bet-users/${matchId}?prediction=${prediction}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    cachedData[cacheKey] = data.users;
    return data.users;
  } catch { return []; }
}

// Рендер popup содержимого
function renderUsers(users) {
  if (!users.length) return '<div class="bet-popup-empty">Нет ставок</div>';

  const shown = users.slice(0, POPUP_MAX_USERS);
  const rest = users.length - POPUP_MAX_USERS;

  let html = shown.map(u => {
    const avatarSrc = getAvatarSrc(u.id, u.avatar);
    const hasScore = u.score_team1 != null && u.score_team2 != null;
    const hasYellow = u.yellow_cards != null;
    const hasRed = u.red_cards != null;

    return `
      <div class="bet-popup-user clickable" data-user-id="${u.id}" data-username="${u.username.replace(/"/g, '&quot;')}">
        <img class="bet-popup-avatar" src="${avatarSrc}" alt="" loading="lazy">
        <span class="bet-popup-name">${u.username}</span>
        <span class="bet-popup-details">
          ${hasScore ? `<span class="bet-popup-score">${u.score_team1}:${u.score_team2}</span>` : ''}
          ${hasYellow ? `<span class="bet-popup-card yellow"><svg class="icon" aria-hidden="true"><use href="#icon-yellow-card"></use></svg><span class="bet-popup-card-num">${u.yellow_cards}</span></span>` : ''}
          ${hasRed ? `<span class="bet-popup-card red"><svg class="icon" aria-hidden="true"><use href="#icon-red-card"></use></svg><span class="bet-popup-card-num">${u.red_cards}</span></span>` : ''}
        </span>
      </div>`;
  }).join('');

  if (rest > 0) {
    html += `<div class="bet-popup-more">+ ещё ${rest}</div>`;
  }
  return html;
}

// Позиционировать popup относительно кнопки (absolute на body)
function positionPopup(btn) {
  const rect = btn.getBoundingClientRect();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  popupEl.style.top = '';
  popupEl.style.bottom = '';
  popupEl.style.left = '';
  popupEl.style.right = '';

  // Показываем невидимым для измерения
  popupEl.style.visibility = 'hidden';
  popupEl.classList.add('visible');
  const popupRect = popupEl.getBoundingClientRect();

  let top = rect.top + scrollY - popupRect.height - 8;
  let left = rect.left + scrollX + (rect.width - popupRect.width) / 2;

  // Если не влезает сверху — показываем снизу
  if (top - scrollY < 4) {
    top = rect.bottom + scrollY + 8;
    popupEl.classList.add('below');
  } else {
    popupEl.classList.remove('below');
  }

  // Не вылезать за левый/правый край
  if (left < 4) left = 4;
  if (left + popupRect.width > window.innerWidth + scrollX - 4) left = window.innerWidth + scrollX - popupRect.width - 4;

  popupEl.style.top = `${top}px`;
  popupEl.style.left = `${left}px`;
  popupEl.style.visibility = '';
}

// Показать popup
async function showPopup(btn, matchId, prediction) {
  ensurePopup();
  activeButton = btn;

  popupEl.innerHTML = '<div class="bet-popup-loading">Загрузка...</div>';
  positionPopup(btn);

  const users = await loadUsers(matchId, prediction);
  if (activeButton !== btn) return; // курсор уже на другой кнопке

  popupEl.innerHTML = renderUsers(users);
  positionPopup(btn); // пересчитать после контента
}

// Проверить, нужно ли показывать popup
function shouldShowPopup(matchId) {
  const match = state.matches.find(m => m.id === matchId);
  if (!match) return false;
  return isMatchStarted(match);
}

// Привязать события к кнопкам ставок
export function initBetPopup(matchRow) {
  const matchId = parseInt(matchRow.dataset.matchId, 10);
  if (!matchId || !shouldShowPopup(matchId)) return;

  const buttons = matchRow.querySelectorAll('.bet-btn');
  buttons.forEach(btn => {
    const prediction = btn.classList.contains('team1') ? 'team1'
      : btn.classList.contains('draw') ? 'draw'
      : 'team2';

    if (isTouchDevice) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation(); // блокируем onclick disabled кнопки (алерт)
        if (activeButton === btn) { closeBetPopup(); return; }
        showPopup(btn, matchId, prediction);
        clickOutsideHandler = (ev) => {
          if (!popupEl.contains(ev.target) && !btn.contains(ev.target)) closeBetPopup();
        };
        setTimeout(() => document.addEventListener('click', clickOutsideHandler), 0);
      }, true); // capture phase — раньше onclick
    } else {
      btn.addEventListener('mouseenter', () => {
        if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
        showPopup(btn, matchId, prediction);
      });
      btn.addEventListener('mouseleave', () => {
        hideTimeout = setTimeout(closeBetPopup, 150);
      });
    }
  });
}

// Инициализация — определяем touch устройство
export function initBetPopupSystem() {
  isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

// Очистить кэш данных (вызывать при обновлении матчей)
export function clearBetPopupCache() {
  cachedData = {};
}
