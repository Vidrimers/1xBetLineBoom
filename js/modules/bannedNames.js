// ========== МОДУЛЬ BANNED NAMES (Запретные имена) ==========
// Управление списком запретных имён из админ-панели

import { currentUser } from './state.js';
import { showCustomAlert, showCustomPrompt } from './ui.js';
import { isAdmin } from './admin.js';

// Открыть модалку управления запретными именами
export async function openBannedNamesModal() {
  if (!isAdmin()) {
    await showCustomAlert('Недостаточно прав', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'custom-modal-overlay';
  overlay.id = 'bannedNamesOverlay';

  overlay.innerHTML = `
    <div class="custom-modal" style="max-width: 550px; width: 90%;">
      <div class="custom-modal-title">
        🚫 Запретные имена
      </div>
      <div style="margin-bottom: 15px;">
        <div style="display: flex; gap: 8px; align-items: center;">
          <input type="text" id="bannedNameInput" placeholder="Введите запретное имя..." style="
            flex: 1;
            padding: 10px 14px;
            background: rgba(30, 35, 45, 0.8);
            border: 1px solid rgba(90, 159, 212, 0.4);
            border-radius: 6px;
            color: #e0e6f0;
            font-size: 0.95em;
            outline: none;
          ">
          <label style="display: flex; align-items: center; gap: 5px; color: #b0b8c8; font-size: 0.85em; white-space: nowrap; cursor: pointer;" title="Если включено — запрещает любое имя, содержащее эту подстроку">
            <input type="checkbox" id="bannedNamePartialCheckbox" style="cursor: pointer;">
            Частичное
          </label>
          <button onclick="addBannedName()" style="
            padding: 10px 16px;
            background: rgba(76, 175, 80, 0.8);
            color: white;
            border: 1px solid #4caf50;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.95em;
            white-space: nowrap;
            transition: all 0.3s ease;
          " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">Добавить</button>
        </div>
      </div>
      <div id="bannedNamesList" style="
        max-height: 350px;
        overflow-y: auto;
        border: 1px solid rgba(90, 159, 212, 0.2);
        border-radius: 6px;
        background: rgba(20, 25, 35, 0.5);
      ">
        <div style="text-align: center; padding: 20px; color: #b0b8c8;">
          <div class="spinner"></div> Загрузка...
        </div>
      </div>
      <div style="margin-top: 12px; font-size: 0.8em; color: #888; line-height: 1.4;">
        💡 <b>Точное совпадение</b> — блокирует только это имя (регистронезависимо).<br>
        💡 <b>Частичное совпадение</b> — блокирует любое имя, содержащее эту подстроку.
      </div>
      <div class="custom-modal-buttons" style="margin-top: 15px;">
        <button class="custom-modal-btn custom-modal-btn-secondary" onclick="closeBannedNamesModal()">Закрыть</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Закрытие по клику на оверлей
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeBannedNamesModal();
  });

  // Enter для добавления
  document.getElementById('bannedNameInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addBannedName();
  });

  // Загружаем список
  await loadBannedNames();
}

// Закрыть модалку
export function closeBannedNamesModal() {
  const overlay = document.getElementById('bannedNamesOverlay');
  if (overlay) overlay.remove();
}

// Загрузить список запретных имён
export async function loadBannedNames() {
  const container = document.getElementById('bannedNamesList');
  if (!container) return;

  try {
    const response = await fetch('/api/admin/banned-names');
    if (!response.ok) throw new Error('Ошибка загрузки');

    const data = await response.json();
    const names = data.names || [];

    if (names.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 20px; color: #888;">Список пуст</div>';
      return;
    }

    let html = '';
    names.forEach(item => {
      html += `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid rgba(90, 159, 212, 0.1);" id="banned-name-${item.id}">
          <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
            <span style="color: #e0e6f0; font-size: 0.95em; font-weight: 500;">${escapeHtml(item.name)}</span>
            <label style="display: flex; align-items: center; gap: 4px; color: #b0b8c8; font-size: 0.8em; cursor: pointer;" title="Частичное совпадение">
              <input type="checkbox" ${item.is_partial ? 'checked' : ''} onchange="toggleBannedNamePartial(${item.id}, this.checked)" style="cursor: pointer;">
              частичное
            </label>
          </div>
          <button onclick="deleteBannedName(${item.id})" style="
            padding: 5px 10px;
            background: rgba(244, 67, 54, 0.7);
            color: white;
            border: 1px solid #f44336;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8em;
            transition: all 0.3s ease;
          " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'" title="Удалить">✕</button>
        </div>
      `;
    });

    container.innerHTML = html;
  } catch (error) {
    console.error('❌ Ошибка загрузки запретных имён:', error);
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #f44336;">Ошибка загрузки</div>';
  }
}

// Добавить запретное имя
export async function addBannedName() {
  const input = document.getElementById('bannedNameInput');
  const partialCheckbox = document.getElementById('bannedNamePartialCheckbox');
  if (!input) return;

  const name = input.value.trim();
  if (!name) {
    await showCustomAlert('Введите имя', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  try {
    const response = await fetch('/api/admin/banned-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        name: name,
        is_partial: partialCheckbox ? partialCheckbox.checked : false
      })
    });

    const result = await response.json();

    if (!response.ok) {
      await showCustomAlert(result.error || 'Ошибка добавления', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      return;
    }

    input.value = '';
    if (partialCheckbox) partialCheckbox.checked = false;
    await loadBannedNames();
  } catch (error) {
    console.error('❌ Ошибка добавления запретного имени:', error);
    await showCustomAlert('Ошибка добавления', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Переключить частичное совпадение
export async function toggleBannedNamePartial(id, isPartial) {
  try {
    const response = await fetch(`/api/admin/banned-names/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        is_partial: isPartial
      })
    });

    if (!response.ok) {
      const result = await response.json();
      await showCustomAlert(result.error || 'Ошибка обновления', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      await loadBannedNames(); // Перезагружаем чтобы вернуть состояние
    }
  } catch (error) {
    console.error('❌ Ошибка обновления запретного имени:', error);
    await loadBannedNames();
  }
}

// Удалить запретное имя
export async function deleteBannedName(id) {
  try {
    const response = await fetch(`/api/admin/banned-names/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username })
    });

    if (!response.ok) {
      const result = await response.json();
      await showCustomAlert(result.error || 'Ошибка удаления', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      return;
    }

    await loadBannedNames();
  } catch (error) {
    console.error('❌ Ошибка удаления запретного имени:', error);
    await showCustomAlert('Ошибка удаления', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Проверить имя на запретность и показать кастомный алерт с возможностью ввести другое
export async function checkAndHandleBannedName(name) {
  try {
    const response = await fetch(`/api/check-banned-name?name=${encodeURIComponent(name)}`);
    const data = await response.json();

    if (data.banned) {
      return await showBannedNameAlert(data.reason || 'Это имя запрещено к использованию на сайте');
    }

    return { banned: false, newName: null };
  } catch (error) {
    console.error('❌ Ошибка проверки запретного имени:', error);
    return { banned: false, newName: null };
  }
}

// Кастомный алерт для запретного имени с возможностью ввести другое
export function showBannedNameAlert(reason) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay';

    overlay.innerHTML = `
      <div class="custom-modal" style="max-width: 450px;">
        <div class="custom-modal-title">🚫 Запрещённое имя</div>
        <div class="custom-modal-message" style="text-align: center; margin-bottom: 15px;">
          <p style="color: #f44336; font-weight: 500; margin-bottom: 10px;">${reason}</p>
          <p style="color: #b0b8c8; font-size: 0.9em;">Пожалуйста, выберите другое имя:</p>
        </div>
        <input type="text" class="custom-modal-input" id="bannedNameNewInput" placeholder="Введите новое имя..." autofocus style="
          width: 100%;
          padding: 10px 14px;
          background: rgba(30, 35, 45, 0.8);
          border: 1px solid rgba(90, 159, 212, 0.4);
          border-radius: 6px;
          color: #e0e6f0;
          font-size: 0.95em;
          outline: none;
          box-sizing: border-box;
          margin-bottom: 10px;
        ">
        <div class="custom-modal-buttons">
          <button class="custom-modal-btn custom-modal-btn-secondary" data-action="cancel">Отмена</button>
          <button class="custom-modal-btn custom-modal-btn-primary" data-action="confirm">Изменить</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector('#bannedNameNewInput');

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const value = input.value.trim();
        overlay.remove();
        resolve({ banned: true, newName: value || null });
      }
    });

    overlay.querySelectorAll('.custom-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        const value = input.value.trim();
        overlay.remove();
        if (action === 'confirm') {
          resolve({ banned: true, newName: value || null });
        } else {
          resolve({ banned: true, newName: null });
        }
      });
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve({ banned: true, newName: null });
      }
    });

    setTimeout(() => input.focus(), 100);
  });
}

// Утилита для экранирования HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
