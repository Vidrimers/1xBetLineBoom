// Модуль: информационное модальное окно Telegram (для экрана логина)

// Открыть модальное окно с информацией о входе через Telegram (для экрана логина)
export function openTelegramInfoModal() {
  console.log('openTelegramInfoModal вызвана!');
  const modal = document.getElementById("telegramInfoModal");
  const loginModal = document.getElementById("loginModal");
  console.log('telegramInfoModal:', modal);
  console.log('loginModal:', loginModal);
  if (modal) {
    // Убираем класс login-modal-open с body чтобы убрать blur с контейнера
    document.body.classList.remove('login-modal-open');
    // Добавляем класс к body чтобы убрать backdrop-filter
    document.body.classList.add('telegram-info-open');
    // Временно закрываем модалку входа полностью
    if (loginModal) {
      console.log('Скрываем loginModal');
      loginModal.dataset.wasOpen = 'true'; // Запоминаем что она была открыта
      loginModal.style.display = 'none';
      loginModal.style.visibility = 'hidden';
      loginModal.style.opacity = '0';
      loginModal.style.pointerEvents = 'none';
    }
    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";
    // Принудительно устанавливаем z-index выше всех модалок
    modal.style.zIndex = "200000";
    console.log('telegramInfoModal открыта, display:', modal.style.display, 'z-index:', modal.style.zIndex);

    // Проверяем через 100мс что loginModal действительно скрыта
    setTimeout(() => {
      console.log('Проверка через 100мс - loginModal display:', loginModal.style.display, 'computed:', window.getComputedStyle(loginModal).display);
    }, 100);
  }
}

// Закрыть модальное окно с информацией о входе через Telegram
export function closeTelegramInfoModal() {
  const modal = document.getElementById("telegramInfoModal");
  const loginModal = document.getElementById("loginModal");
  if (modal) {
    // Убираем класс с body
    document.body.classList.remove('telegram-info-open');
    // Разблокируем скролл body
    document.body.style.overflow = '';
    modal.style.display = "none";
    // Возвращаем модалку входа если она была открыта
    if (loginModal && loginModal.dataset.wasOpen === 'true') {
      // Возвращаем класс login-modal-open на body
      document.body.classList.add('login-modal-open');
      loginModal.style.display = 'flex';
      loginModal.style.visibility = '';
      loginModal.style.opacity = '';
      loginModal.style.pointerEvents = '';
      delete loginModal.dataset.wasOpen;
    }
  }
}
