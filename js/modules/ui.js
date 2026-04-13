// Кастомные модальные окна

export function showCustomAlert(message, title = "Уведомление", icon = "ℹ️") {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay';
    
    overlay.innerHTML = `
      <div class="custom-modal">
        <div class="custom-modal-title">${icon} ${title}</div>
        <div class="custom-modal-message" style="
          text-align: left;
          white-space: pre-wrap;
          font-family: 'Courier New', monospace;
          line-height: 1.6;
          max-height: 60vh;
          overflow-y: auto;
        ">${message}</div>
        <div class="custom-modal-buttons">
          <button class="custom-modal-btn custom-modal-btn-primary">OK</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelector('.custom-modal-btn').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(true);
      }
    });
  });
}

export function showCustomConfirm(message, title = "Подтверждение", icon = "❓") {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay';
    
    overlay.innerHTML = `
      <div class="custom-modal">
        <div class="custom-modal-title">${icon} ${title}</div>
        <div class="custom-modal-message">${message}</div>
        <div class="custom-modal-buttons">
          <button class="custom-modal-btn custom-modal-btn-secondary" data-action="cancel">Отмена</button>
          <button class="custom-modal-btn custom-modal-btn-primary" data-action="confirm">Продолжить</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelectorAll('.custom-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        overlay.remove();
        resolve(action === 'confirm');
      });
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

export function showCustomSaveConfirm(message, title = "Несохраненные изменения", icon = "⚠️") {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay';
    
    overlay.innerHTML = `
      <div class="custom-modal">
        <div class="custom-modal-title">${icon} ${title}</div>
        <div class="custom-modal-message">${message}</div>
        <div class="custom-modal-buttons" style="display: flex; gap: 10px; justify-content: center;">
          <button class="custom-modal-btn custom-modal-btn-secondary" data-action="cancel">Отмена</button>
          <button class="custom-modal-btn custom-modal-btn-danger" data-action="discard">Не сохранять</button>
          <button class="custom-modal-btn custom-modal-btn-primary" data-action="save">Сохранить</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelectorAll('.custom-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        overlay.remove();
        resolve(action); // Возвращаем 'save', 'discard' или 'cancel'
      });
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve('cancel');
      }
    });
  });
}

export function showCustomPrompt(message, title = "Ввод данных", icon = "✏️", placeholder = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay';
    
    overlay.innerHTML = `
      <div class="custom-modal">
        <div class="custom-modal-title">${icon} ${title}</div>
        <div class="custom-modal-message">${message}</div>
        <input type="text" class="custom-modal-input" placeholder="${placeholder}" autofocus>
        <div class="custom-modal-buttons">
          <button class="custom-modal-btn custom-modal-btn-secondary" data-action="cancel">Отмена</button>
          <button class="custom-modal-btn custom-modal-btn-primary" data-action="confirm">OK</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    const input = overlay.querySelector('.custom-modal-input');
    
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        overlay.remove();
        resolve(input.value.trim() || null);
      }
    });
    
    overlay.querySelectorAll('.custom-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        overlay.remove();
        resolve(action === 'confirm' ? (input.value.trim() || null) : null);
      });
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });
    
    setTimeout(() => input.focus(), 100);
  });
}

// ===== УНИВЕРСАЛЬНЫЕ ФУНКЦИИ ДЛЯ МОДАЛЬНЫХ ОКОН =====

// Блокировка скролла страницы при открытии модалки
export function lockBodyScroll() {
  document.body.style.overflow = 'hidden';
}

// Разблокировка скролла страницы при закрытии модалки
export function unlockBodyScroll() {
  document.body.style.overflow = '';
}

// Универсальная функция закрытия модалки при клике вне контента
export function closeModalOnOutsideClick(event, modalId, closeFunction) {
  if (event.target.id === modalId) {
    closeFunction();
  }
}

// Универсальная функция для открытия модалки с анимацией
export function openModalWithAnimation(modalId, triggerElement = null) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  
  // Если передан элемент-триггер, вычисляем откуда анимировать
  if (triggerElement) {
    const rect = triggerElement.getBoundingClientRect();
    
    // Вычисляем смещение от центра модалки до триггера
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const triggerCenterX = rect.left + rect.width / 2;
    const triggerCenterY = rect.top + rect.height / 2;
    
    const translateX = (triggerCenterX - centerX) / centerX * 100;
    const translateY = (triggerCenterY - centerY) / centerY * 100;
    
    modal.style.setProperty('--modal-translate-x', `${translateX}%`);
    modal.style.setProperty('--modal-translate-y', `${translateY}%`);
    modal.style.setProperty('--modal-origin-x', `${(triggerCenterX / window.innerWidth) * 100}%`);
    modal.style.setProperty('--modal-origin-y', `${(triggerCenterY / window.innerHeight) * 100}%`);
  }
  
  modal.style.display = 'flex';
  modal.classList.remove('closing');
}

// Универсальная функция для закрытия модалки с анимацией
export function closeModalWithAnimation(modalId, callback = null) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  
  modal.classList.add('closing');
  
  setTimeout(() => {
    modal.style.display = 'none';
    modal.classList.remove('closing');
    if (callback) callback();
  }, 200);
}

// Автоматическая анимация для всех модалок
document.addEventListener('DOMContentLoaded', () => {
  // Наблюдаем за изменениями display у всех модалок
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
        const target = mutation.target;
        if (target.classList.contains('modal') && target.style.display === 'flex') {
          // Модалка открывается - убираем класс closing если есть
          target.classList.remove('closing');
        }
      }
    });
  });
  
  // Наблюдаем за всеми элементами с классом modal
  document.querySelectorAll('.modal').forEach((modal) => {
    observer.observe(modal, { attributes: true, attributeFilter: ['style'] });
  });
});
