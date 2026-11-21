// ========== МОДУЛЬ ПРОВЕРКИ ДАТ МАТЧЕЙ ==========
// Модалка: выбор турнира/тура, сверка с SStats, исправление дат,
// чекбокс автопроверки (раз в сутки в 05:00, уведомление в ТГ)

import { currentUser } from './state.js';
import { showCustomAlert, showCustomConfirm } from './ui.js';

// Открыть модалку проверки дат матчей
export async function openMatchDateCheckModal() {
  const modal = document.createElement('div');
  modal.id = 'matchDatesCheckModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;';

  modal.innerHTML = `
    <div style="background:#1e2a3a;padding:30px;border-radius:12px;max-width:820px;width:92%;max-height:85vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 20px 0;color:#5a9fd4;"><svg class="icon" aria-hidden="true"><use href="#icon-matches"></use></svg> Проверка дат матчей</h3>

      <div style="display:flex;gap:10px;margin-bottom:15px;flex-wrap:wrap;">
        <select id="mdcEventSelect" style="flex:2;min-width:220px;padding:10px;background:#2a3a4a;color:#e0e6f0;border:1px solid rgba(90,159,212,0.3);border-radius:8px;font-size:15px;">
          <option value="">Загрузка турниров...</option>
        </select>
        <select id="mdcRoundSelect" disabled style="flex:1;min-width:150px;padding:10px;background:#2a3a4a;color:#e0e6f0;border:1px solid rgba(90,159,212,0.3);border-radius:8px;font-size:15px;">
          <option value="">Сначала выберите турнир...</option>
        </select>
        <button id="mdcCheckBtn" style="padding:10px 22px;background:#2196f3;color:white;border:none;border-radius:8px;cursor:pointer;font-size:15px;white-space:nowrap;"><svg class="icon" aria-hidden="true"><use href="#icon-search"></use></svg> Проверить</button>
      </div>

      <div id="mdcResults" style="margin-bottom:15px;padding:15px;background:#2a3a4a;border-radius:8px;min-height:80px;max-height:42vh;overflow-y:auto;font-size:14px;line-height:1.7;color:#e0e6f0;">
        <div style="color:#999;text-align:center;padding:10px;">Выберите турнир и нажмите «Проверить»</div>
      </div>

      <div id="mdcFixBar" style="display:none;margin-bottom:15px;">
        <button id="mdcFixBtn" style="width:100%;padding:13px;background:#f44336;color:white;border:none;border-radius:8px;cursor:pointer;font-size:16px;font-weight:600;"><svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Исправить даты</button>
      </div>

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:15px;padding:12px 15px;background:rgba(90,159,212,0.1);border:1px solid rgba(90,159,212,0.3);border-radius:8px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#e0e6f0;font-size:15px;">
          <input type="checkbox" id="mdcAutoCheck" style="width:18px;height:18px;cursor:pointer;">
          <span>Автопроверка (раз в сутки в 05:00)</span>
        </label>
        <span id="mdcLastCheck" style="color:#b0b8c8;font-size:13px;"></span>
      </div>

      <button id="mdcCloseBtn" style="width:100%;padding:12px;background:#607d8b;color:white;border:none;border-radius:8px;cursor:pointer;font-size:15px;">Закрыть</button>
    </div>
  `;

  document.body.appendChild(modal);

  // Обработчики
  modal.querySelector('#mdcCloseBtn').addEventListener('click', closeMatchDateCheckModal);
  modal.querySelector('#mdcEventSelect').addEventListener('change', () => loadRoundsForCheck());
  modal.querySelector('#mdcCheckBtn').addEventListener('click', runMatchDatesCheck);
  modal.querySelector('#mdcFixBtn').addEventListener('click', fixMatchDatesFromModal);
  modal.querySelector('#mdcAutoCheck').addEventListener('change', (e) => toggleMatchDatesAutoCheck(e.target.checked));

  await loadEventsForCheck();
  await loadAutoCheckSettings();
}

// Закрыть модалку
export function closeMatchDateCheckModal() {
  const modal = document.getElementById('matchDatesCheckModal');
  if (modal) modal.remove();
}

// Загрузить турниры (активные и завершившиеся — отдельными группами)
async function loadEventsForCheck() {
  const select = document.getElementById('mdcEventSelect');
  if (!select) return;

  try {
    const response = await fetch('/api/events');
    if (!response.ok) throw new Error('Ошибка загрузки турниров');
    const events = await response.json();

    const active = (events || []).filter(e => e.status === 'active');
    const finished = (events || []).filter(e => e.status !== 'active');

    select.innerHTML = '<option value="">Выберите турнир...</option>';

    const addGroup = (label, list) => {
      if (list.length === 0) return;
      const group = document.createElement('optgroup');
      group.label = label;
      list.forEach(event => {
        const option = document.createElement('option');
        option.value = event.id;
        option.textContent = event.name;
        group.appendChild(option);
      });
      select.appendChild(group);
    };

    addGroup('Активные турниры', active);
    addGroup('Завершившиеся', finished);
  } catch (error) {
    console.error('Ошибка загрузки турниров:', error);
    select.innerHTML = '<option value="">Ошибка загрузки турниров</option>';
  }
}

// Загрузить туры для выбранного турнира
async function loadRoundsForCheck() {
  const eventSelect = document.getElementById('mdcEventSelect');
  const roundSelect = document.getElementById('mdcRoundSelect');
  if (!eventSelect || !roundSelect) return;

  const eventId = eventSelect.value;
  roundSelect.innerHTML = '<option value="">Все туры</option>';

  if (!eventId) {
    roundSelect.disabled = true;
    roundSelect.innerHTML = '<option value="">Сначала выберите турнир...</option>';
    return;
  }

  try {
    const response = await fetch(`/api/admin/events/${eventId}/rounds`);
    if (!response.ok) throw new Error('Ошибка загрузки туров');
    const rounds = await response.json();

    // Бэкенд уже отдаёт туры в правильном порядке ("Тур 2" раньше "Тур 10")
    roundSelect.disabled = false;
    roundSelect.innerHTML = '<option value="">Все туры</option>';
    (rounds || []).forEach(round => {
      const option = document.createElement('option');
      option.value = round;
      option.textContent = round;
      roundSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Ошибка загрузки туров:', error);
    roundSelect.disabled = false;
    roundSelect.innerHTML = '<option value="">Все туры</option>';
  }
}

// Форматирование даты
function formatDateTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// Запустить проверку
export async function runMatchDatesCheck() {
  const eventSelect = document.getElementById('mdcEventSelect');
  const roundSelect = document.getElementById('mdcRoundSelect');
  const resultsDiv = document.getElementById('mdcResults');
  const fixBar = document.getElementById('mdcFixBar');
  if (!eventSelect || !resultsDiv) return;

  const eventId = eventSelect.value;
  if (!eventId) {
    await showCustomAlert('Выберите турнир', 'Внимание', '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  const round = roundSelect?.value || null;
  resultsDiv.innerHTML = '<div style="color:#999;text-align:center;padding:10px;">Проверяем даты...</div>';
  if (fixBar) fixBar.style.display = 'none';

  try {
    const response = await fetch('/api/admin/match-dates/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser?.username, eventId, round })
    });

    const data = await response.json();
    if (!response.ok || data.error) {
      resultsDiv.innerHTML = `<div style="color:#f44336;">${data.error || 'Ошибка проверки'}</div>`;
      return;
    }

    renderCheckResults(data);
  } catch (error) {
    console.error('Ошибка проверки дат:', error);
    resultsDiv.innerHTML = `<div style="color:#f44336;">Ошибка проверки: ${error.message}</div>`;
  }
}

// Отрисовать результаты проверки
function renderCheckResults(data) {
  const resultsDiv = document.getElementById('mdcResults');
  const fixBar = document.getElementById('mdcFixBar');
  if (!resultsDiv) return;

  const { mismatches = [], notInSstats = [], notInDb = [] } = data;

  if (mismatches.length === 0 && notInSstats.length === 0 && notInDb.length === 0) {
    resultsDiv.innerHTML = `
      <div style="color:#4caf50;text-align:center;padding:15px;font-size:15px;">
        <svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Расхождений не найдено — все даты совпадают с SStats
      </div>`;
    if (fixBar) fixBar.style.display = 'none';
    return;
  }

  let html = '';

  if (mismatches.length > 0) {
    html += `<div style="color:#5a9fd4;font-weight:600;margin-bottom:8px;">📅 Расхождения дат (${mismatches.length}):</div>`;
    for (const m of mismatches) {
      const fixNote = m.fixable ? '' : ' <span style="color:#ff9800;">(статус: ' + m.status + ' — не будет исправлен)</span>';
      html += `
        <div style="background:rgba(255,255,255,0.05);border-radius:6px;padding:10px;margin-bottom:8px;border-left:3px solid ${m.fixable ? '#f44336' : '#ff9800'};">
          <div style="font-weight:600;color:#fff;">⚽ ${m.team1_name} - ${m.team2_name} <span style="color:#b0b8c8;font-weight:400;">(${m.round})</span>${fixNote}</div>
          <div style="color:#b0b8c8;margin-top:3px;">
            📅 В БД: <span style="color:#f44336;">${formatDateTime(m.db_date)}</span>
            &nbsp;→&nbsp;
            Факт: <span style="color:#4caf50;">${formatDateTime(m.real_date)}</span>
          </div>
        </div>`;
    }
  }

  if (notInSstats.length > 0) {
    html += `<div style="color:#ff9800;font-weight:600;margin:12px 0 8px 0;">⚠️ Есть в БД, нет в sstats (${notInSstats.length}):</div>`;
    for (const m of notInSstats) {
      html += `
        <div style="background:rgba(255,152,0,0.1);border-radius:6px;padding:10px;margin-bottom:8px;border-left:3px solid #ff9800;">
          <div style="font-weight:600;color:#fff;">⚽ ${m.team1_name} - ${m.team2_name}</div>
          <div style="color:#b0b8c8;margin-top:3px;">📅 Дата в БД: ${formatDateTime(m.db_date)} (статус: ${m.status})</div>
        </div>`;
    }
  }

  if (notInDb.length > 0) {
    html += `<div style="color:#ff9800;font-weight:600;margin:12px 0 8px 0;">⚠️ Есть в sstats, нет в БД (${notInDb.length}):</div>`;
    for (const m of notInDb) {
      html += `
        <div style="background:rgba(255,152,0,0.1);border-radius:6px;padding:10px;margin-bottom:8px;border-left:3px solid #ff9800;">
          <div style="font-weight:600;color:#fff;">⚽ ${m.team1_name} - ${m.team2_name} <span style="color:#b0b8c8;font-weight:400;">(${m.round})</span></div>
          <div style="color:#b0b8c8;margin-top:3px;">📅 Дата: ${formatDateTime(m.real_date)}</div>
        </div>`;
    }
  }

  resultsDiv.innerHTML = html;

  // Кнопка исправления — только если есть что править (pending)
  const fixableCount = mismatches.filter(m => m.fixable).length;
  if (fixBar) {
    if (fixableCount > 0) {
      fixBar.style.display = 'block';
      fixBar.dataset.fixable = String(fixableCount);
    } else {
      fixBar.style.display = 'none';
    }
  }
}

// Исправить даты из модалки
export async function fixMatchDatesFromModal() {
  const eventSelect = document.getElementById('mdcEventSelect');
  const roundSelect = document.getElementById('mdcRoundSelect');
  const fixBar = document.getElementById('mdcFixBar');
  if (!eventSelect) return;

  const confirmed = await showCustomConfirm(
    'Исправить даты всех pending-матчей с расхождениями?\n\nСтавки пользователей не пострадают — они привязаны к матчам, а не к датам.',
    'Исправление дат', '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'
  );
  if (!confirmed) return;

  if (fixBar) fixBar.style.display = 'none';

  // Повторная проверка, чтобы взять актуальный список расхождений
  const eventId = eventSelect.value;
  const round = roundSelect?.value || null;

  try {
    const checkResponse = await fetch('/api/admin/match-dates/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser?.username, eventId, round })
    });
    const checkData = await checkResponse.json();
    if (!checkResponse.ok || checkData.error) {
      await showCustomAlert(checkData.error || 'Ошибка проверки', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      return;
    }

    const fixes = (checkData.mismatches || [])
      .filter(m => m.fixable)
      .map(m => ({ match_id: m.match_id, match_date: m.real_date }));

    if (fixes.length === 0) {
      await showCustomAlert('Нет pending-матчей для исправления', 'Информация', 'ℹ');
      return;
    }

    const fixResponse = await fetch('/api/admin/match-dates/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser?.username, fixes })
    });
    const fixResult = await fixResponse.json();
    if (!fixResponse.ok || fixResult.error) {
      await showCustomAlert(fixResult.error || 'Ошибка исправления', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      return;
    }

    let message = `✅ Исправлено дат: ${fixResult.applied.length}`;
    if (fixResult.skipped?.length > 0) {
      message += `\n⏭ Пропущено: ${fixResult.skipped.length}`;
    }
    await showCustomAlert(message, 'Успех', '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');

    // Обновляем результаты после исправления
    await runMatchDatesCheck();
  } catch (error) {
    console.error('Ошибка исправления дат:', error);
    await showCustomAlert('Ошибка исправления: ' + error.message, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Загрузить настройки автопроверки
export async function loadAutoCheckSettings() {
  const checkbox = document.getElementById('mdcAutoCheck');
  const lastCheckEl = document.getElementById('mdcLastCheck');
  if (!checkbox) return;

  try {
    const response = await fetch('/api/admin/match-dates/settings');
    if (!response.ok) throw new Error('Ошибка загрузки настроек');
    const data = await response.json();

    checkbox.checked = !!data.autocheck_enabled;
    if (lastCheckEl) {
      lastCheckEl.textContent = data.last_check
        ? `Последняя автопроверка: ${data.last_check}`
        : 'Автопроверка ещё не запускалась';
    }
  } catch (error) {
    console.error('Ошибка загрузки настроек проверки дат:', error);
  }
}

// Переключить автопроверку
export async function toggleMatchDatesAutoCheck(enabled) {
  try {
    const response = await fetch('/api/admin/match-dates/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser?.username, enabled })
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      await showCustomAlert(data.error || 'Ошибка сохранения настройки', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      await loadAutoCheckSettings();
      return;
    }
    await showCustomAlert(
      enabled
        ? 'Автопроверка включена. Проверка — каждый день в 05:00, результат придёт в ТГ.'
        : 'Автопроверка выключена.',
      'Настройка сохранена', '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
    );
  } catch (error) {
    console.error('Ошибка переключения автопроверки:', error);
    await loadAutoCheckSettings();
  }
}
