// ========== МОДУЛЬ TELEGRAM USERNAMES ==========
// Ручное обновление TG-ников из админки (одна сводка, без per-user уведомлений)

import { currentUser } from './state.js';
import { showCustomAlert } from './ui.js';
import { isAdmin } from './admin.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function openTelegramUsernamesModal() {
  if (!isAdmin()) {
    await showCustomAlert(
      'Недостаточно прав',
      'Ошибка',
      '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'
    );
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'custom-modal-overlay';
  overlay.id = 'telegramUsernamesOverlay';

  overlay.innerHTML = `
    <div class="custom-modal" style="max-width: 560px; width: 90%;">
      <div class="custom-modal-title">
        🔄 Обновление Telegram-ников
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
        Проверяет актуальные <b>@ники</b> в Telegram и обновляет их в базе
        (сайт + привязка бота).<br>
        Если ник сменился — запись идёт через общий механизм смены ников,
        <b>без дублей</b> уведомлений. После прогона придёт <b>одна сводка</b> в ТГ.
      </div>

      <div id="telegramUsernamesStats" style="
        background: rgba(30, 35, 45, 0.55);
        border: 1px solid rgba(90, 159, 212, 0.25);
        border-radius: 8px;
        padding: 14px 16px;
        margin-bottom: 14px;
        min-height: 92px;
      ">
        <div style="color: #b0b8c8; font-size: 0.92em; line-height: 1.8;">
          <div>✅ Проверено: <strong id="tgUsernamesChecked" style="color:#e0e6f0;">—</strong></div>
          <div>🔁 Изменено: <strong id="tgUsernamesChanged" style="color:#e0e6f0;">—</strong></div>
          <div>⚠️ Без ответа API: <strong id="tgUsernamesFailed" style="color:#e0e6f0;">—</strong></div>
        </div>
        <div id="tgUsernamesList" style="margin-top: 10px; max-height: 160px; overflow-y: auto; font-size: 0.86em; color: #b0c8e0; line-height: 1.7;"></div>
      </div>

      <div id="telegramUsernamesStatus" style="min-height: 22px; font-size: 0.85em; margin-bottom: 10px;"></div>

      <div class="custom-modal-buttons" style="margin-top: 8px;">
        <button class="custom-modal-btn" id="tgUsernamesRunBtn" onclick="runTelegramUsernamesSync()" style="
          background: rgba(76, 175, 80, 0.8);
          border-color: #4caf50;
          color: #c8e6c9;
        ">
          🔄 Запустить обновление
        </button>
        <button class="custom-modal-btn custom-modal-btn-secondary" onclick="closeTelegramUsernamesModal()">
          Закрыть
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeTelegramUsernamesModal();
  });
}

export async function runTelegramUsernamesSync() {
  const status = document.getElementById('telegramUsernamesStatus');
  const runBtn = document.getElementById('tgUsernamesRunBtn');
  const checkedEl = document.getElementById('tgUsernamesChecked');
  const changedEl = document.getElementById('tgUsernamesChanged');
  const failedEl = document.getElementById('tgUsernamesFailed');
  const listEl = document.getElementById('tgUsernamesList');

  if (!currentUser) return;

  if (runBtn) {
    runBtn.disabled = true;
    runBtn.textContent = '⏳ Выполняется…';
  }
  if (status) {
    status.style.color = '#5a9fd4';
    status.textContent = '⏳ Проверяем ники в Telegram…';
  }
  if (checkedEl) checkedEl.textContent = '…';
  if (changedEl) changedEl.textContent = '…';
  if (failedEl) failedEl.textContent = '…';
  if (listEl) listEl.innerHTML = '';

  try {
    const res = await fetch('/api/admin/sync-telegram-usernames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Ошибка сервера');
    }

    if (checkedEl) checkedEl.textContent = String(data.checked);
    if (changedEl) changedEl.textContent = String(data.changed);
    if (failedEl) failedEl.textContent = String(data.failed ?? 0);

    if (listEl) {
      if (data.changes && data.changes.length > 0) {
        listEl.innerHTML = data.changes
          .map(
            (c) =>
              `<div>• ${escapeHtml(c.siteUsername)}: ${c.oldUsername ? '@' + escapeHtml(c.oldUsername) : '—'} → ${c.newUsername ? '@' + escapeHtml(c.newUsername) : '—'}</div>`
          )
          .join('');
      } else {
        listEl.innerHTML = '<div style="color:#8aa0b8;">Ник не изменилось.</div>';
      }
    }

    if (status) {
      status.style.color = '#4caf50';
      status.textContent = `✅ Готово: проверено ${data.checked}, изменено ${data.changed}. Сводка отправлена в ТГ.`;
    }
  } catch (e) {
    if (status) {
      status.style.color = '#f44336';
      status.textContent = '❌ Ошибка: ' + e.message;
    }
    if (checkedEl) checkedEl.textContent = '—';
    if (changedEl) changedEl.textContent = '—';
    if (failedEl) failedEl.textContent = '—';
  } finally {
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = '🔄 Запустить обновление';
    }
  }
}

export function closeTelegramUsernamesModal() {
  const overlay = document.getElementById('telegramUsernamesOverlay');
  if (overlay) overlay.remove();
}
