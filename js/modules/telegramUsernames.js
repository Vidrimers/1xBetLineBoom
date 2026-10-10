// ========== МОДУЛЬ TELEGRAM USERNAMES ==========
// Ручное обновление TG-ников + история смен (пагинация, поиск)

import { currentUser } from './state.js';
import { showCustomAlert } from './ui.js';
import { isAdmin } from './admin.js';

const HISTORY_LIMIT = 15;
const SEARCH_DEBOUNCE_MS = 250;

let historyPage = 1;
let historyQuery = '';
let historySearchOpen = false;
let searchDebounceTimer = null;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatHistoryDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
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

  historyPage = 1;
  historyQuery = '';
  historySearchOpen = false;

  const overlay = document.createElement('div');
  overlay.className = 'custom-modal-overlay';
  overlay.id = 'telegramUsernamesOverlay';

  overlay.innerHTML = `
    <div class="custom-modal" style="max-width: 620px; width: 92%;">
      <div class="custom-modal-title">
        🔄 Обновление Telegram-ников
      </div>

      <div style="
        background: rgba(90, 159, 212, 0.1);
        border-left: 4px solid #5a9fd4;
        border-radius: 4px;
        padding: 12px 14px;
        margin-bottom: 14px;
        font-size: 0.86em;
        color: #b0c8e0;
        line-height: 1.55;
      ">
        Проверяет актуальные <b>@ники</b> в Telegram и обновляет их в базе
        (сайт + привязка бота). После прогона придёт <b>одна сводка</b> в ТГ.
      </div>

      <div id="telegramUsernamesStats" style="
        padding: 4px 2px;
        margin-bottom: 10px;
      ">
        <div style="color: #b0b8c8; font-size: 0.9em; line-height: 1.7;">
          <div>✅ Проверено: <strong id="tgUsernamesChecked" style="color:#e0e6f0;">—</strong></div>
          <div>🔁 Изменено: <strong id="tgUsernamesChanged" style="color:#e0e6f0;">—</strong></div>
          <div>⚠️ Без ответа API: <strong id="tgUsernamesFailed" style="color:#e0e6f0;">—</strong></div>
        </div>
        <div id="tgUsernamesList" style="margin-top: 8px; max-height: 110px; overflow-y: auto; font-size: 0.84em; color: #b0c8e0; line-height: 1.6;"></div>
      </div>

      <div id="telegramUsernamesStatus" style="min-height: 20px; font-size: 0.84em; margin-bottom: 10px;"></div>

      <!-- История смен -->
      <div style="
        padding: 4px 2px;
        margin-bottom: 12px;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
          <div style="color:#5a9fd4;font-weight:600;font-size:0.95em;">📜 История смены ников</div>
          <div id="tgHistorySearchWrap" style="
            position:relative;
            display:flex;
            align-items:center;
            overflow:hidden;
            width:36px;
            max-width:240px;
            transition:width 0.35s ease;
            background:transparent;
            border:1px solid transparent;
            border-radius:8px;
            height:34px;
          ">
            <button onclick="toggleTelegramHistorySearch()" title="Поиск" style="
              width:34px;height:32px;flex-shrink:0;
              background:transparent;border:none;cursor:pointer;
              color:#5a9fd4;display:flex;align-items:center;justify-content:center;
              padding:0;
            ">
              <!-- icon-search из icons/icons-sprite.svg -->
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
            <input
              id="tgHistorySearchInput"
              type="text"
              placeholder="Поиск по нику…"
              autocomplete="off"
              style="
                flex:1;min-width:0;
                background:transparent;border:none;outline:none;
                color:#e0e6f0;font-size:0.88em;
                padding:0 30px 0 2px;
                opacity:0;
                transition:opacity 0.25s ease;
                height:32px;
              "
            />
            <button
              id="tgHistorySearchClear"
              onclick="clearTelegramHistorySearch()"
              title="Очистить"
              style="
                position:absolute;
                right:4px;
                top:50%;
                transform:translateY(-50%);
                width:26px;height:26px;
                background:transparent;border:none;cursor:pointer;
                color:#8aa0b8;display:none;align-items:center;justify-content:center;
                padding:0;
                border-radius:50%;
              "
            >
              <!-- icon-clear из icons/icons-sprite.svg -->
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div id="tgHistoryList" style="max-height:240px;overflow-y:auto;font-size:0.84em;line-height:1.55;"></div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;">
          <button id="tgHistoryPrev" onclick="telegramHistoryPrev()" style="
            padding:6px 12px;border-radius:6px;cursor:pointer;font-size:0.84em;
            background:rgba(90,159,212,0.25);border:1px solid rgba(90,159,212,0.45);color:#e0e6f0;
          ">◀ Назад</button>
          <div id="tgHistoryPageInfo" style="color:#b0b8c8;font-size:0.82em;"></div>
          <button id="tgHistoryNext" onclick="telegramHistoryNext()" style="
            padding:6px 12px;border-radius:6px;cursor:pointer;font-size:0.84em;
            background:rgba(90,159,212,0.25);border:1px solid rgba(90,159,212,0.45);color:#e0e6f0;
          ">Вперёд ▶</button>
        </div>
      </div>

      <div class="custom-modal-buttons" style="margin-top: 4px;">
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

  const searchInput = document.getElementById('tgHistorySearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', onTelegramHistorySearchInput);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') clearTelegramHistorySearch();
    });
  }

  await loadTelegramHistory();
}

function setHistorySearchExpanded(expanded) {
  const wrap = document.getElementById('tgHistorySearchWrap');
  const input = document.getElementById('tgHistorySearchInput');
  if (!wrap) return;

  historySearchOpen = expanded;
  wrap.style.width = expanded ? '240px' : '36px';
  wrap.style.borderColor = expanded ? 'rgba(90,159,212,0.35)' : 'transparent';
  if (input) {
    input.style.opacity = expanded ? '1' : '0';
    if (expanded) {
      setTimeout(() => input.focus(), 180);
    }
  }
  updateHistoryClearButton();
}

function updateHistoryClearButton() {
  const clearBtn = document.getElementById('tgHistorySearchClear');
  const input = document.getElementById('tgHistorySearchInput');
  if (!clearBtn) return;
  const hasText = input && input.value.length > 0;
  clearBtn.style.display = hasText ? 'flex' : 'none';
}

export function toggleTelegramHistorySearch() {
  if (historySearchOpen) {
    // Повторный клик — свернуть только если пусто
    const input = document.getElementById('tgHistorySearchInput');
    if (input && input.value.length > 0) {
      input.focus();
      return;
    }
    setHistorySearchExpanded(false);
  } else {
    setHistorySearchExpanded(true);
  }
}

export function clearTelegramHistorySearch() {
  const input = document.getElementById('tgHistorySearchInput');
  if (input) {
    input.value = '';
    input.focus();
  }
  historyQuery = '';
  historyPage = 1;
  updateHistoryClearButton();
  loadTelegramHistory();
}

function onTelegramHistorySearchInput(e) {
  updateHistoryClearButton();
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    historyQuery = e.target.value.trim().toLowerCase();
    historyPage = 1;
    loadTelegramHistory();
  }, SEARCH_DEBOUNCE_MS);
}

export async function loadTelegramHistory() {
  const listEl = document.getElementById('tgHistoryList');
  const pageInfo = document.getElementById('tgHistoryPageInfo');
  const prevBtn = document.getElementById('tgHistoryPrev');
  const nextBtn = document.getElementById('tgHistoryNext');
  if (!listEl) return;

  listEl.innerHTML = '<div style="color:#8aa0b8;padding:8px 0;">Загрузка…</div>';

  try {
    const params = new URLSearchParams({
      page: String(historyPage),
      limit: String(HISTORY_LIMIT),
    });
    if (historyQuery) params.set('q', historyQuery);

    const res = await fetch(`/api/admin/telegram-username-changes?${params}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Ошибка сервера');
    }

    historyPage = data.page;

    if (!data.items || data.items.length === 0) {
      listEl.innerHTML = historyQuery
        ? `<div style="color:#8aa0b8;padding:8px 0;">Ничего не найдено по «${escapeHtml(historyQuery)}»</div>`
        : '<div style="color:#8aa0b8;padding:8px 0;">История пуста</div>';
    } else {
      listEl.innerHTML = data.items
        .map((item) => {
          const oldN = item.old_username ? `@${escapeHtml(item.old_username)}` : '—';
          const newN = item.new_username ? `@${escapeHtml(item.new_username)}` : '—';
          return `
            <div style="padding:6px 0;border-bottom:1px solid rgba(90,159,212,0.12);">
              <div style="color:#e0e6f0;">
                ${escapeHtml(item.site_username || '—')}
                <span style="color:#8aa0b8;font-size:0.92em;">: ${oldN} → ${newN}</span>
              </div>
              <div style="color:#8aa0b8;font-size:0.86em;">
                ${formatHistoryDate(item.changed_at)}
                ${item.source ? ` · ${escapeHtml(item.source)}` : ''}
              </div>
            </div>
          `;
        })
        .join('');
    }

    if (pageInfo) {
      pageInfo.textContent = `Страница ${data.page} из ${data.totalPages} · всего ${data.total}`;
    }
    if (prevBtn) prevBtn.disabled = data.page <= 1;
    if (nextBtn) nextBtn.disabled = data.page >= data.totalPages;
    if (prevBtn) prevBtn.style.opacity = data.page <= 1 ? '0.45' : '1';
    if (nextBtn) nextBtn.style.opacity = data.page >= data.totalPages ? '0.45' : '1';
  } catch (e) {
    listEl.innerHTML = `<div style="color:#f44336;padding:8px 0;">❌ ${escapeHtml(e.message)}</div>`;
  }
}

export function telegramHistoryPrev() {
  if (historyPage > 1) {
    historyPage--;
    loadTelegramHistory();
  }
}

export function telegramHistoryNext() {
  historyPage++;
  loadTelegramHistory();
}

export async function runTelegramUsernamesSync() {
  const status = document.getElementById('telegramUsernamesStatus');
  const runBtn = document.getElementById('tgUsernamesRunBtn');
  const checkedEl = document.getElementById('tgUsernamesChecked');
  const changedEl = document.getElementById('tgUsernamesChanged');
  const failedEl = document.getElementById('tgUsernamesFailed');
  const listEl = document.getElementById('tgUsernamesList');

  if (!currentUser) {
    if (status) {
      status.style.color = '#f44336';
      status.textContent = '❌ Не удалось определить пользователя';
    }
    return;
  }

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
        listEl.innerHTML = '<div style="color:#8aa0b8;">Ник не изменилось. Все ники уже актуальны (cron мог обновить только что).</div>';
      }
    }

    if (status) {
      status.style.color = '#4caf50';
      status.textContent = `✅ Готово: проверено ${data.checked}, изменено ${data.changed}. Сводка отправлена в ТГ.`;
    }

    historyPage = 1;
    await loadTelegramHistory();
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
  clearTimeout(searchDebounceTimer);
  const overlay = document.getElementById('telegramUsernamesOverlay');
  if (overlay) overlay.remove();
}
