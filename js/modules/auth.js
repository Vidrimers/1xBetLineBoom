// Модуль аутентификации

import {
  currentUser,
  ADMIN_LOGIN,
  ADMIN_DB_NAME,
  authCheckInterval,
} from './state.js';
import { setCurrentUser, setAuthCheckInterval } from './state.js';
import { showCustomAlert, showCustomConfirm, showCustomPrompt } from './ui.js';
import { loadSavedTheme } from './themes.js';
import { loadEventsList } from './events.js';
import { loadMyBets } from './bets.js';
import { switchTab } from './tabs.js';
import { updateLiveIndicator, stopFavoriteMatchesPolling } from './liveFavorites.js';
import { isModerator, canCreateTournaments, canViewCounting, loadModeratorPermissions } from './admin.js';


// ===== КНОПКА АВТОРИЗАЦИИ =====

export function moveAuthButtonToProfile() {
  const authBtn = document.getElementById("authBtn");
  const placeholder = document.getElementById("profileAuthPlaceholder");
  if (!authBtn || !placeholder) return;
  if (!placeholder.contains(authBtn)) {
    // Показываем кнопку и убираем все скрывающие стили
    authBtn.style.display = '';
    authBtn.style.position = '';
    authBtn.style.left = '';
    placeholder.appendChild(authBtn);
  }
}

export function moveAuthButtonToLoginForm() {
  const authBtn = document.getElementById("authBtn");
  const userInput = document.querySelector(".user-input");

  // Проверяем что элементы существуют
  if (!authBtn || !userInput) return;

  // Проверяем видимость через getComputedStyle
  const computedStyle = window.getComputedStyle(userInput);
  if (computedStyle.display === 'none') return; // Не перемещаем если форма скрыта

  const countingBtn = document.getElementById("countingBtn");
  if (userInput.contains(authBtn)) return;

  try {
    if (countingBtn && countingBtn.parentNode === userInput) {
      userInput.insertBefore(authBtn, countingBtn);
    } else {
      userInput.appendChild(authBtn);
    }
  } catch (e) {
    console.warn('⚠️ Не удалось переместить кнопку авторизации:', e);
  }
}

export function setAuthButtonToLogoutState() {
  const authBtn = document.getElementById("authBtn");
  if (!authBtn) return;
  authBtn.classList.add("logout-mode");
  authBtn.innerHTML =
    '<span class="logout-text logout-text-before">ВЫ</span><span class="logout-cross">X</span><span class="logout-text logout-text-after">ОД</span>';
  authBtn.onclick = () => logoutUser();
  moveAuthButtonToProfile();
  hideTelegramAuthButtons();
}

export function setAuthButtonToLoginState() {
  const authBtn = document.getElementById("authBtn");
  if (!authBtn) return;
  authBtn.classList.remove("logout-mode");
  authBtn.innerHTML = "Войти";
  authBtn.onclick = () => initUser();
  moveAuthButtonToLoginForm();
  // НЕ показываем кнопки Telegram в гостевом режиме
  // showTelegramAuthButtons();
}

// Скрыть кнопки Telegram авторизации
export function hideTelegramAuthButtons() {
  const telegramAuthBtn = document.getElementById("telegramAuthBtn");
  const telegramAuthBtnMobile = document.getElementById("telegramAuthBtnMobile");
  if (telegramAuthBtn) telegramAuthBtn.style.display = "none";
  if (telegramAuthBtnMobile) telegramAuthBtnMobile.style.display = "none";
}

// Показать кнопки Telegram авторизации
export function showTelegramAuthButtons() {
  const telegramAuthBtn = document.getElementById("telegramAuthBtn");
  const telegramAuthBtnMobile = document.getElementById("telegramAuthBtnMobile");
  if (telegramAuthBtn) telegramAuthBtn.style.display = "flex";
  if (telegramAuthBtnMobile) telegramAuthBtnMobile.style.display = "flex";
}

// ===== ИНФОРМАЦИЯ ОБ УСТРОЙСТВЕ =====

export function getDeviceInfo() {
  const ua = navigator.userAgent;
  let deviceInfo = 'Desktop';
  let browser = 'Unknown';
  let os = 'Unknown';

  // Определяем устройство
  if (/mobile/i.test(ua)) {
    deviceInfo = 'Mobile';
  } else if (/tablet|ipad/i.test(ua)) {
    deviceInfo = 'Tablet';
  }

  // Определяем браузер
  if (ua.indexOf('Firefox') > -1) {
    browser = 'Firefox';
  } else if (ua.indexOf('Chrome') > -1) {
    browser = 'Chrome';
  } else if (ua.indexOf('Safari') > -1) {
    browser = 'Safari';
  } else if (ua.indexOf('Edge') > -1) {
    browser = 'Edge';
  } else if (ua.indexOf('Opera') > -1 || ua.indexOf('OPR') > -1) {
    browser = 'Opera';
  }

  // Определяем ОС
  if (ua.indexOf('Win') > -1) {
    os = 'Windows';
  } else if (ua.indexOf('Mac') > -1) {
    os = 'MacOS';
  } else if (ua.indexOf('Linux') > -1) {
    os = 'Linux';
  } else if (ua.indexOf('Android') > -1) {
    os = 'Android';
  } else if (ua.indexOf('iOS') > -1 || ua.indexOf('iPhone') > -1 || ua.indexOf('iPad') > -1) {
    os = 'iOS';
  }

  return { deviceInfo, browser, os };
}

// ===== ГОСТЕВОЙ РЕЖИМ И МОДАЛЬНОЕ ОКНО ВХОДА =====

// Открыть модальное окно входа
export function openLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.classList.add('login-modal-open');

    // Фокус на поле ввода
    setTimeout(() => {
      const input = document.getElementById('usernameModal');
      if (input) input.focus();
    }, 100);
  }
}

// Закрыть модальное окно входа
export function closeLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('login-modal-open');
  }
}

// Вход из модального окна
export async function loginFromModal() {
  const username = document.getElementById('usernameModal')?.value.trim();

  if (!username) {
    await showCustomAlert("Пожалуйста, введите имя", "Ошибка", "⚠️");
    return;
  }

  // Копируем значение в основной input и вызываем initUser
  document.getElementById('username').value = username;

  // Закрываем модалку
  closeLoginModal();

  // Вызываем стандартную функцию входа
  await initUser();
}

// Инициализация гостевого режима
export function initGuestMode() {
  console.log('🔓 Инициализация гостевого режима');

  // Добавляем класс гостевого режима
  const container = document.querySelector('.container');
  if (container) {
    container.classList.add('guest-mode');
  }

  // Показываем кнопку ВХОД вместо Настройки
  const settingsBtn = document.getElementById('settingsTabBtn');
  const loginBtn = document.getElementById('loginTabBtn');

  if (settingsBtn) settingsBtn.style.display = 'none';
  if (loginBtn) loginBtn.style.display = 'inline-block';

  // Скрываем кнопки Telegram (они есть только в модалке)
  hideTelegramAuthButtons();

  // Показываем контент (турниры и матчи)
  loadEventsList();

  // Блокируем взаимодействие со ставками
  blockBettingForGuests();
}

// Блокировка взаимодействия со ставками для гостей
export function blockBettingForGuests() {
  // Добавляем обработчик на document для перехвата всех кликов
  document.addEventListener('click', (e) => {
    if (!document.querySelector('.container.guest-mode')) return;

    // Проверяем клик по вкладкам (кроме "Ставки")
    const tabBtn = e.target.closest('.tab-btn');
    if (tabBtn && !tabBtn.classList.contains('login-tab-btn')) {
      const tabs = Array.from(document.querySelectorAll('.tab-btn'));
      const index = tabs.indexOf(tabBtn);

      // Индексы: 0-LIVE, 1-Ставки, 2-Таблица, 3-Профиль, 4-Новости, 5-Настройки
      if (index !== 1) { // Не блокируем вкладку "Ставки"
        e.preventDefault();
        e.stopPropagation();
        openLoginModal();
        return;
      }
    }

    // Блокируем кнопку "Мне повезет"
    if (e.target.closest('.lucky-btn')) {
      e.preventDefault();
      e.stopPropagation();
      openLoginModal();
      return;
    }

    // Блокируем клики по карточкам матчей для ставок
    const matchCard = e.target.closest('.match-card');
    if (matchCard) {
      const betButton = e.target.closest('.bet-btn, .score-prediction-btn, .cards-prediction-btn');
      if (betButton) {
        e.preventDefault();
        e.stopPropagation();
        openLoginModal();
        return;
      }
    }
  }, true); // Используем capture phase для перехвата до других обработчиков
}

// Выход из гостевого режима (после успешного входа)
export function exitGuestMode() {
  console.log('🔐 Выход из гостевого режима');

  // Убираем класс гостевого режима
  const container = document.querySelector('.container');
  if (container) {
    container.classList.remove('guest-mode');
  }

  // Скрываем кнопку ВХОД и показываем Настройки
  const settingsBtn = document.getElementById('settingsTabBtn');
  const loginBtn = document.getElementById('loginTabBtn');

  if (settingsBtn) settingsBtn.style.display = 'inline-block';
  if (loginBtn) loginBtn.style.display = 'none';
}

// ===== ОСНОВНЫЕ ФУНКЦИИ ВХОДА =====

export async function initUser() {
  // Получаем значение из обоих инпутов
  let username = document.getElementById("username").value.trim();
  const usernameMobile = document.getElementById("username-mobile")?.value.trim();

  // Используем значение из мобильного инпута если основной пустой
  if (!username && usernameMobile) {
    username = usernameMobile;
  }

  if (!username) {
    await showCustomAlert("Пожалуйста, введите имя", "Ошибка", "⚠️");
    return;
  }

  // Преобразуем первую букву каждого слова в заглавную
  username = username
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  // Проверяем, пытается ли кто-то логиниться под ADMIN_DB_NAME
  if (username === ADMIN_DB_NAME) {
    // Отправляем уведомление админу в Telegram
    fetch("/api/notify-admin-login-attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptedUsername: username }),
    }).catch((err) => console.error("Ошибка отправки уведомления:", err));

    await showCustomAlert("Ну, ты давай не охуевай совсем, малютка", "Доступ запрещен", "🚫");
    document.getElementById("username").value = "";
    if (document.getElementById("username-mobile")) {
      document.getElementById("username-mobile").value = "";
    }
    return;
  }

  // Если админ логинится под ADMIN_LOGIN, то отправляем ADMIN_DB_NAME на сервер
  let usernameToSend = username === ADMIN_LOGIN ? ADMIN_DB_NAME : username;
  let isAdminUser = username === ADMIN_LOGIN;

  // Обновляем оба input с правильным логином
  document.getElementById("username").value = usernameToSend;
  if (document.getElementById("username-mobile")) {
    document.getElementById("username-mobile").value = usernameToSend;
  }

  // Получаем информацию об устройстве
  const deviceData = getDeviceInfo();

  try {
    const response = await fetch("/api/user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: usernameToSend,
        device_info: deviceData.deviceInfo,
        browser: deviceData.browser,
        os: deviceData.os
      }),
    });

    const result = await response.json();

    // Проверяем, требуется ли подтверждение через Telegram
    if (result.requiresConfirmation) {
      // Запрашиваем код подтверждения
      const shouldContinue = await showCustomConfirm(
        'Для входа требуется подтверждение через Telegram. Вам будет отправлен код подтверждения.',
        'Подтверждение входа',
        '🔐'
      );

      if (!shouldContinue) {
        return;
      }

      try {
        const requestResponse = await fetch("/api/user/login/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: result.userId })
        });

        const requestResult = await requestResponse.json();

        if (requestResponse.ok) {
          // Показываем поле для ввода кода
          const code = await showCustomPrompt(
            'Код подтверждения отправлен вам в Telegram. Введите его ниже:',
            'Введите код',
            '🔐',
            '123456'
          );

          if (!code) return;

          // Подтверждаем вход
          const confirmResponse = await fetch("/api/user/login/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: result.userId,
              confirmation_code: code
            })
          });

          const confirmResult = await confirmResponse.json();

          if (!confirmResponse.ok) {
            await showCustomAlert(confirmResult.error, 'Ошибка', '❌');
            return;
          }

          // Код верный, продолжаем логин
          // eslint-disable-next-line no-global-assign
          setCurrentUser(confirmResult);
          currentUser.isAdmin = isAdminUser;

          // Загружаем права модератора
          await loadModeratorPermissions();
        } else {
          await showCustomAlert(requestResult.error, 'Ошибка', '❌');
          return;
        }
      } catch (error) {
        console.error("Ошибка при подтверждении входа:", error);
        await showCustomAlert("Ошибка при подтверждении входа", 'Ошибка', '❌');
        return;
      }
    } else {
      // 2FA не требуется
      // eslint-disable-next-line no-global-assign
      setCurrentUser(result);
      currentUser.isAdmin = isAdminUser;

      // Загружаем права модератора
      await loadModeratorPermissions();
    }

    // Создаем сессию на сервере (используем deviceData, объявленную выше)
    try {
      const sessionResponse = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: currentUser.id,
          device_info: deviceData.deviceInfo,
          browser: deviceData.browser,
          os: deviceData.os
        })
      });

      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        // Сохраняем session_token в localStorage
        localStorage.setItem("sessionToken", sessionData.session_token);
        console.log("✅ Сессия создана:", sessionData.session_token);
      }
    } catch (err) {
      console.error("⚠️ Ошибка создания сессии:", err);
    }

    // Сохраняем пользователя в localStorage
    localStorage.setItem("currentUser", JSON.stringify(currentUser));

    // Загружаем тему с сервера после логина
    await loadSavedTheme();

    // Обновляем классы контейнера для показа контента
    const container = document.querySelector(".container");
    container.classList.remove("not-logged-in");
    container.classList.add("logged-in");

    // Меняем логотип с анимированного на обычный
    document.getElementById("headerLogo").src = "img/logo_nobg.png";

    // Показываем ссылку на Google Sheets когда залогинен
    document.getElementById("headerLogoLink").style.display = "block";
    document.getElementById("headerLogoDefault").style.display = "none";

    // Показываем информацию о пользователе
    document.getElementById("userStatus").style.display = "block";
    document.getElementById("usernameBold").textContent = currentUser.username;
    document.getElementById("username").disabled = true;

    setAuthButtonToLogoutState();

    // Показываем админ-кнопки если это админ
    if (currentUser.isAdmin) {
      document.getElementById("adminBtn").style.display = "inline-block";
      document.getElementById("countingBtn").style.display = "inline-block";
      document.getElementById("adminSettingsPanel").style.display = "block";
    } else if (isModerator()) {
      // Показываем кнопки модератора если есть права
      if (canCreateTournaments()) {
        document.getElementById("adminBtn").style.display = "inline-block";
      }
      if (canViewCounting()) {
        document.getElementById("countingBtn").style.display = "inline-block";
      }
    }

    // Загружаем турниры, матчи и ставки пользователя
    loadEventsList();
    loadMyBets();

    // Выходим из гостевого режима если он был активен
    exitGuestMode();

    // Запускаем обновление индикатора LIVE
    updateLiveIndicator();
    // pollFavoriteMatches запускается автоматически при открытии вкладки LIVE
  } catch (error) {
    console.error("Ошибка при входе:", error);
    alert("Ошибка при входе: " + (error.message || error));
  }
}

// Функция выхода из аккаунта
export async function logoutUser() {
  // НЕ удаляем сессию на сервере, чтобы сохранить статус доверенного устройства
  // Просто удаляем токен из localStorage
  const sessionToken = localStorage.getItem("sessionToken");
  if (sessionToken && currentUser) {
    console.log("✅ Разлогин (сессия сохранена на сервере для доверенных устройств)");
  }

  // Останавливаем polling избранных матчей
  stopFavoriteMatchesPolling();

  // Удаляем пользователя из localStorage
  localStorage.removeItem("currentUser");
  localStorage.removeItem("sessionToken");

  // Очищаем переменную
  // eslint-disable-next-line no-global-assign
  setCurrentUser(null);

  // Обновляем классы контейнера для скрытия контента
  const container = document.querySelector(".container");
  container.classList.remove("logged-in");
  container.classList.add("not-logged-in");

  // Меняем логотип обратно на анимированный
  document.getElementById("headerLogo").src = "img/logo_anim.gif";

  // Скрываем ссылку на Google Sheets когда вышли
  document.getElementById("headerLogoLink").style.display = "none";
  document.getElementById("headerLogoDefault").style.display = "block";

  // Скрываем информацию о пользователе
  document.getElementById("userStatus").style.display = "none";
  document.getElementById("username").value = "";
  document.getElementById("username").disabled = false;

  // Скрываем админ-кнопки
  document.getElementById("adminBtn").style.display = "none";
  document.getElementById("countingBtn").style.display = "none";
  document.getElementById("adminSettingsPanel").style.display = "none";

  // Меняем кнопку обратно на "Начать"
  setAuthButtonToLoginState();

  // Переключаемся на вкладку "Все ставки"
  switchTab("allbets");

  // Очищаем ставки
  document.getElementById("myBetsList").innerHTML =
    '<div class="empty-message">У вас пока нет ставок</div>';

  // Включаем гостевой режим
  initGuestMode();
}

// ===== АВТОРИЗАЦИЯ ЧЕРЕЗ TELEGRAM =====

// Функция авторизации через Telegram
export async function loginWithTelegram() {
  try {
    // Генерируем уникальный токен для авторизации
    const authToken = `auth_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Сохраняем токен в localStorage для проверки после возврата
    localStorage.setItem('telegram_auth_token', authToken);

    // Получаем информацию об устройстве
    const deviceData = getDeviceInfo();
    localStorage.setItem('telegram_auth_device', JSON.stringify(deviceData));

    // Отправляем запрос на сервер для создания токена авторизации
    const response = await fetch("/api/telegram-auth/create-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_token: authToken,
        device_info: deviceData.deviceInfo,
        browser: deviceData.browser,
        os: deviceData.os
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      await showCustomAlert(result.error || 'Ошибка создания токена', 'Ошибка', '❌');
      return;
    }

    // Открываем бота с командой авторизации
    const botUsername = result.botUsername || 'YourBotUsername'; // Замените на имя вашего бота
    const telegramUrl = `https://t.me/${botUsername}?start=auth_${authToken}`;
    window.open(telegramUrl, '_blank');

    // Запускаем проверку статуса авторизации
    checkTelegramAuthStatus(authToken);
  } catch (error) {
    console.error("Ошибка при авторизации через Telegram:", error);
    await showCustomAlert("Ошибка при авторизации через Telegram", 'Ошибка', '❌');
  }
}

// Проверка статуса авторизации через Telegram
export async function checkTelegramAuthStatus(authToken) {
  let attempts = 0;
  const maxAttempts = 60; // 60 попыток по 2 секунды = 2 минуты

  // eslint-disable-next-line no-global-assign
  authCheckInterval = setInterval(async () => {
    attempts++;

    if (attempts > maxAttempts) {
      clearInterval(authCheckInterval);
      await showCustomAlert(
        'Время ожидания авторизации истекло. Попробуйте снова.',
        'Таймаут',
        '⏱️'
      );
      localStorage.removeItem('telegram_auth_token');
      localStorage.removeItem('telegram_auth_device');
      return;
    }

    try {
      const response = await fetch(`/api/telegram-auth/check-status?auth_token=${authToken}`);
      const result = await response.json();

      if (result.status === 'completed' && result.user) {
        clearInterval(authCheckInterval);

        // eslint-disable-next-line no-global-assign
        setCurrentUser(result.user);
        currentUser.isAdmin = currentUser.username === ADMIN_DB_NAME;

        // Загружаем права модератора
        await loadModeratorPermissions();

        // Получаем сохраненные данные устройства
        const deviceDataStr = localStorage.getItem('telegram_auth_device');
        const deviceData = deviceDataStr ? JSON.parse(deviceDataStr) : getDeviceInfo();

        // Создаем сессию на сервере
        try {
          const sessionResponse = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: currentUser.id,
              device_info: deviceData.deviceInfo,
              browser: deviceData.browser,
              os: deviceData.os
            })
          });

          if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json();
            localStorage.setItem("sessionToken", sessionData.session_token);
            console.log("✅ Сессия создана:", sessionData.session_token);
          }
        } catch (err) {
          console.error("⚠️ Ошибка создания сессии:", err);
        }

        // Сохраняем пользователя в localStorage
        localStorage.setItem("currentUser", JSON.stringify(currentUser));

        // Загружаем тему с сервера после логина
        await loadSavedTheme();

        // Обновляем классы контейнера для показа контента
        const container = document.querySelector(".container");
        container.classList.remove("not-logged-in");
        container.classList.add("logged-in");

        // Меняем логотип с анимированного на обычный
        document.getElementById("headerLogo").src = "img/logo_nobg.png";

        // Показываем ссылку на Google Sheets когда залогинен
        document.getElementById("headerLogoLink").style.display = "block";
        document.getElementById("headerLogoDefault").style.display = "none";

        // Показываем информацию о пользователе
        document.getElementById("userStatus").style.display = "block";
        document.getElementById("usernameBold").textContent = currentUser.username;
        document.getElementById("username").disabled = true;

        setAuthButtonToLogoutState();

        // Показываем админ-кнопки если это админ
        if (currentUser.isAdmin) {
          document.getElementById("adminBtn").style.display = "inline-block";
          document.getElementById("countingBtn").style.display = "inline-block";
          document.getElementById("adminSettingsPanel").style.display = "block";
        } else if (isModerator()) {
          if (canCreateTournaments()) {
            document.getElementById("adminBtn").style.display = "inline-block";
          }
          if (canViewCounting()) {
            document.getElementById("countingBtn").style.display = "inline-block";
          }
        }

        // Если это новый пользователь - показываем приветственное сообщение
        if (result.isNewUser) {
          await showCustomAlert(
            `Твое имя на сайте: ${currentUser.username}\n\nИмя можно изменить в профиле, наведя или нажав на текущее имя.`,
            'Добро пожаловать! 🎉',
            '👋'
          );
        }

        // Загружаем турниры, матчи и ставки пользователя
        loadEventsList();
        loadMyBets();

        // Выходим из гостевого режима
        exitGuestMode();

        // Закрываем модалку входа если она открыта
        closeLoginModal();

        // Запускаем обновление индикатора LIVE
        updateLiveIndicator();

        // Очищаем временные данные
        localStorage.removeItem('telegram_auth_token');
        localStorage.removeItem('telegram_auth_device');
      }
    } catch (error) {
      console.error("Ошибка проверки статуса авторизации:", error);
    }
  }, 2000); // Проверяем каждые 2 секунды
}
