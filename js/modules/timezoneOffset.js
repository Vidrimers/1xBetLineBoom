// ========== МОДУЛЬ TIMEZONE OFFSET (Смещение часового пояса для авто-подсчёта) ==========

import { currentUser } from './state.js';
import { showCustomAlert } from './ui.js';
import { isAdmin } from './admin.js';

// Открыть модалку настройки смещения часового пояса
export async function openTimezoneOffsetModal() {
  if (!isAdmin()) {
    await showCustomAlert('Недостаточно прав', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'custom-modal-overlay';
  overlay.id = 'timezoneOffsetOverlay';

  overlay.innerHTML = `
    <div class="custom-modal" style="max-width: 520px; width: 90%;">
      <div class="custom-modal-title">
        🕐 Смещение часового пояса для авто-подсчёта
      </div>

      <div style="
        background: rgba(90, 159, 212, 0.1);
        border-left: 4px solid #5a9fd4;
        border-radius: 4px;
        padding: 14px 16px;
        margin-bottom: 18px;
        font-size: 0.88em;
        color: #b0c8e0;
        line-height: 1.6;
      ">
        <strong style="color: #5a9fd4;">Зачем это нужно?</strong><br>
        Сервер работает по UTC. Матч в <b>22:00 UTC</b> — это уже <b>01:00 следующего дня</b> по Москве (UTC+3).
        Если смещение <b>= 0</b>, сервер считает этот матч частью одного дня с матчами в 01:00 UTC и 19:00 UTC того же числа,
        и ждёт завершения всех трёх прежде чем считать очки.<br><br>
        Если смещение <b>= 3</b>, сервер группирует матчи так же, как видят пользователи — матч в 22:00 UTC
        относится к следующему дню, и подсчёт за предыдущий день срабатывает раньше.<br><br>
        <strong style="color: #5a9fd4;">Значения:</strong>
        <b>0</b> — UTC (старое поведение) &nbsp;|&nbsp;
        <b>3</b> — Москва/Europe/Moscow &nbsp;|&nbsp;
        <b>4</b> — Тбилиси/Asia/Tbilisi
      </div>

      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
        <label style="color: #e0e6f0; white-space: nowrap;">Смещение (часы):</label>
        <input
          type="number"
          id="timezoneOffsetInput"
          min="-12"
          max="14"
          step="1"
          value="0"
          style="
            width: 90px;
            padding: 10px 14px;
            background: rgba(30, 35, 45, 0.8);
            border: 1px solid rgba(90, 159, 212, 0.4);
            border-radius: 6px;
            color: #e0e6f0;
            font-size: 1.1em;
            outline: none;
            text-align: center;
          "
        >
        <span id="timezoneOffsetPreview" style="color: #b0b8c8; font-size: 0.9em;"></span>
      </div>

      <div id="timezoneOffsetStatus" style="min-height: 20px; font-size: 0.85em; margin-bottom: 8px;"></div>

      <div class="custom-modal-buttons" style="margin-top: 8px;">
        <button class="custom-modal-btn" onclick="saveTimezoneOffset()" style="
          background: rgba(76, 175, 80, 0.8);
          border-color: #4caf50;
          color: #c8e6c9;
        ">
          💾 Сохранить
        </button>
        <button class="custom-modal-btn custom-modal-btn-secondary" onclick="closeTimezoneOffsetModal()">
          Закрыть
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Закрытие по клику на фон
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeTimezoneOffsetModal();
  });

  // Обновляем превью при изменении
  const input = document.getElementById('timezoneOffsetInput');
  if (input) {
    input.addEventListener('input', updateTimezonePreview);
  }

  // Загружаем текущее значение
  await loadTimezoneOffset();
}

// Обновить текст превью
function updateTimezonePreview() {
  const input = document.getElementById('timezoneOffsetInput');
  const preview = document.getElementById('timezoneOffsetPreview');
  if (!input || !preview) return;

  const val = parseInt(input.value, 10);
  if (isNaN(val)) {
    preview.textContent = '';
    return;
  }
  preview.textContent = val === 0 ? '(UTC — старое поведение)' : `(UTC${val > 0 ? '+' : ''}${val})`;
}

// Загрузить текущее значение из сервера
async function loadTimezoneOffset() {
  const input = document.getElementById('timezoneOffsetInput');
  const status = document.getElementById('timezoneOffsetStatus');
  if (!input) return;

  try {
    const res = await fetch('/api/admin/timezone-offset');
    const data = await res.json();
    if (data.success) {
      input.value = data.offset;
      updateTimezonePreview();
    }
  } catch (e) {
    if (status) {
      status.style.color = '#f44336';
      status.textContent = '⚠️ Не удалось загрузить текущее значение';
    }
  }
}

// Сохранить значение
export async function saveTimezoneOffset() {
  const input = document.getElementById('timezoneOffsetInput');
  const status = document.getElementById('timezoneOffsetStatus');
  if (!input || !currentUser) return;

  const val = parseInt(input.value, 10);
  if (isNaN(val) || val < -12 || val > 14) {
    if (status) {
      status.style.color = '#f44336';
      status.textContent = '❌ Введите число от -12 до +14';
    }
    return;
  }

  try {
    const res = await fetch('/api/admin/timezone-offset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username, offset: val }),
    });
    const data = await res.json();
    if (data.success) {
      if (status) {
        status.style.color = '#4caf50';
        status.textContent = `✅ Сохранено: UTC${val >= 0 ? '+' : ''}${val}`;
      }
    } else {
      throw new Error(data.error || 'Ошибка сервера');
    }
  } catch (e) {
    if (status) {
      status.style.color = '#f44336';
      status.textContent = '❌ Ошибка: ' + e.message;
    }
  }
}

// Закрыть модалку
export function closeTimezoneOffsetModal() {
  const overlay = document.getElementById('timezoneOffsetOverlay');
  if (overlay) overlay.remove();
}
