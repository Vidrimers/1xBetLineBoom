import * as state from './state.js';
import { openLoginModal } from './auth.js';
import { stopLiveMatchesAutoUpdate, startLiveMatchesAutoUpdate, loadLiveMatches } from './live.js';
import { loadEventsList } from './events.js';
import { loadMatches } from './matches.js';
import { loadMyBets } from './bets.js';
import { loadTournamentsList } from './participants.js';
import { loadProfile } from './profile.js';
import { loadNewsTab } from './newsTab.js';
import { initTimezoneSettings } from './settings.js';
import { loadAutoCountingStatus } from './autocounting.js';

// ===== МОБИЛЬНОЕ МЕНЮ =====
export function toggleMobileMenu() {
  const userSection = document.querySelector('.user-section');
  const toggleBtn = document.getElementById('mobileMenuToggle');
  
  userSection.classList.toggle('active');
  toggleBtn.classList.toggle('active');
  
  // Закрываем меню при клике на вкладку
  if (userSection.classList.contains('active')) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        userSection.classList.remove('active');
        toggleBtn.classList.remove('active');
      }, { once: true });
    });
  }
}

// Переключение секций на мобильных
export function showMobileSection(section) {
  if (window.innerWidth > 768) return; // Работает только на мобильных

  const tournaments = document.querySelector('.bet-section-tournaments');
  const matches = document.getElementById('matchesSection');
  const bets = document.querySelector('.bet-section-bets');
  const navButtons = document.querySelectorAll('.mobile-nav-btn');

  // Убираем активный класс со всех кнопок
  navButtons.forEach(btn => btn.classList.remove('active'));

  // Скрываем все секции с fade out
  [tournaments, matches, bets].forEach(el => {
    if (el && el.style.display !== 'none') {
      el.style.opacity = '0';
      setTimeout(() => {
        el.style.display = 'none';
      }, 300);
    }
  });

  // Показываем нужную секцию с fade in
  setTimeout(() => {
    let targetSection = null;
    let activeButtonIndex = -1;

    if (section === 'tournaments') {
      targetSection = tournaments;
      activeButtonIndex = 0;
    } else if (section === 'matches') {
      targetSection = matches;
      activeButtonIndex = 1;
    } else if (section === 'bets') {
      targetSection = bets;
      activeButtonIndex = 2;
    }

    if (targetSection) {
      targetSection.style.display = 'block';
      setTimeout(() => {
        targetSection.style.opacity = '1';
      }, 10);
      if (activeButtonIndex >= 0) {
        navButtons[activeButtonIndex].classList.add('active');
      }
    }
  }, 300);
}

// ===== ВКЛАДКИ =====
export function switchTab(tabName) {
  // Проверяем гостевой режим - разрешаем только вкладку "Ставки"
  const isGuestMode = document.querySelector('.container.guest-mode');
  if (isGuestMode && tabName !== 'allbets') {
    openLoginModal();
    return;
  }
  
  // Останавливаем автообновление LIVE матчей при переключении на другую вкладку
  if (tabName !== 'live') {
    stopLiveMatchesAutoUpdate();
  }
  
  // Управление кнопками навигации на мобильных
  if (window.innerWidth <= 768) {
    const navButtons = document.querySelector('.mobile-nav-buttons');
    if (navButtons) {
      if (tabName === 'allbets' || tabName === 'live') {
        // Показываем кнопки навигации для allbets и live
        navButtons.style.opacity = '1';
        navButtons.style.pointerEvents = 'auto';
      } else {
        // Скрываем кнопки навигации
        navButtons.style.opacity = '0';
        navButtons.style.pointerEvents = 'none';
      }
    }
  }

  // Скрываем все содержимое вкладок
  document
    .getElementById("allbets-content")
    .style.setProperty("display", "none", "important");
  document
    .getElementById("live-content")
    .style.setProperty("display", "none", "important");
  document
    .getElementById("participants-content")
    .style.setProperty("display", "none", "important");
  document
    .getElementById("profile-content")
    .style.setProperty("display", "none", "important");
  document
    .getElementById("settings-content")
    .style.setProperty("display", "none", "important");
  document
    .getElementById("news-content")
    .style.setProperty("display", "none", "important");
  document
    .getElementById("counting-content")
    .style.setProperty("display", "none", "important");

  // Удаляем активный класс со всех кнопок вкладок
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  // Показываем нужное содержимое и отмечаем кнопку как активную
  if (tabName === "allbets") {
    const content = document.getElementById("allbets-content");
    content.style.setProperty("display", "grid", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
    document.querySelectorAll(".tab-btn")[1].classList.add("active");
    loadEventsList();
    if (state.currentEventId) {
      loadMatches(state.currentEventId);
    }
    loadMyBets();
  } else if (tabName === "live") {
    const content = document.getElementById("live-content");
    content.style.setProperty("display", "flex", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
    document.querySelectorAll(".tab-btn")[0].classList.add("active");
    loadLiveMatches();
    // Запускаем автообновление LIVE матчей
    startLiveMatchesAutoUpdate();
  } else if (tabName === "participants") {
    const content = document.getElementById("participants-content");
    content.style.setProperty("display", "flex", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
    document.querySelectorAll(".tab-btn")[2].classList.add("active");
    loadTournamentsList();
  } else if (tabName === "profile") {
    const content = document.getElementById("profile-content");
    content.style.setProperty("display", "flex", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
    document.querySelectorAll(".tab-btn")[3].classList.add("active");
    loadProfile();
  } else if (tabName === "settings") {
    const content = document.getElementById("settings-content");
    content.style.setProperty("display", "flex", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
    document.querySelectorAll(".tab-btn")[5].classList.add("active");
    initTimezoneSettings();
  } else if (tabName === "news") {
    const content = document.getElementById("news-content");
    content.style.setProperty("display", "flex", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
    document.querySelectorAll(".tab-btn")[4].classList.add("active");
    loadNewsTab();
  } else if (tabName === "counting") {
    const content = document.getElementById("counting-content");
    content.style.setProperty("display", "flex", "important");
    content.style.opacity = "0";
    setTimeout(() => {
      content.style.opacity = "1";
    }, 10);
    loadAutoCountingStatus();
  }
}
