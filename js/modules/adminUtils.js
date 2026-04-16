// ========== МОДУЛЬ ADMIN UTILS ==========
// Утилитные скрипты и управление датами автоподсчета

import { currentUser } from './state.js';
import { showCustomAlert, showCustomConfirm } from './ui.js';

// Запустить утилитный скрипт
export async function runUtilityScript(scriptName) {
  const dangerousScripts = {
    'clear-processed-dates': {
      title: 'Очистка обработанных дат',
      message: 'Вы уверены что хотите очистить все обработанные даты?\n\nЭто позволит автоподсчету запуститься повторно для уже подсчитанных дат.',
      icon: '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>️'
    }
  };

  if (dangerousScripts[scriptName]) {
    const config = dangerousScripts[scriptName];
    const confirmed = await showCustomConfirm(config.message, config.title, config.icon);
    if (!confirmed) return;
  }

  try {
    const response = await fetch('/api/admin/run-utility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: scriptName, username: currentUser?.username })
    });

    if (!response.ok) throw new Error('HTTP error! status: ' + response.status);

    const data = await response.json();

    if (data.success) {
      const formattedOutput = formatUtilityOutput(data.output);
      await showCustomAlert(formattedOutput, data.title, "<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>");
    } else {
      await showCustomAlert(data.error, "Ошибка", "<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>");
    }
  } catch (error) {
    console.error('Ошибка запуска утилиты:', error);
    await showCustomAlert(error.message, "Ошибка запуска утилиты", "<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>");
  }
}

// Форматировать вывод утилит для читаемости
export function formatUtilityOutput(text) {
  if (!text) return '';

  let formatted = text.replace(/\n/g, '<br>');
  formatted = formatted.replace(/^(\s+)/gm, (match) => {
    return '&nbsp;'.repeat(match.length);
  });

  return formatted;
}

// Открыть модальное окно управления датами
export async function openDatesManagementModal() {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;';

  modal.innerHTML = `
    <div style="background:#1e2a3a;padding:30px;border-radius:12px;max-width:700px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 20px 0;color:#5a9fd4;"><svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> Управление датами автоподсчета</h3>
      <div id="datesContentContainer" style="margin-bottom:20px;padding:15px;background:#2a3a4a;border-radius:8px;max-height:50vh;overflow-y:auto;font-family:'Courier New',monospace;line-height:1.6;color:#e0e6f0;">
        <div style="color:#999;text-align:center;padding:10px;">Загрузка...</div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:15px;">
        <button onclick="loadDatesData('processed')" style="flex:1;background:#2196f3;color:white;border:none;padding:12px;border-radius:8px;cursor:pointer;font-size:16px;"><svg class="icon" aria-label="Иконка"><use href="#icon-stats"></use></svg> Обработанные даты</button>
        <button onclick="loadDatesData('matches')" style="flex:1;background:#673ab7;color:white;border:none;padding:12px;border-radius:8px;cursor:pointer;font-size:16px;"><svg class="icon" aria-label="Иконка"><use href="#icon-matches"></use></svg> Даты матчей</button>
      </div>
      <div style="display:flex;gap:10px;">
        <button onclick="clearProcessedDates()" style="flex:1;background:#f44336;color:white;border:none;padding:12px;border-radius:8px;cursor:pointer;font-size:16px;"><svg class="icon" aria-label="Удалить"><use href="#icon-delete"></use></svg>️ Очистить даты</button>
        <button onclick="this.closest('div[style*=fixed]').remove()" style="flex:1;background:#607d8b;color:white;border:none;padding:12px;border-radius:8px;cursor:pointer;font-size:16px;">Закрыть</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  loadDatesData('processed');
}

// Загрузить данные о датах
export async function loadDatesData(type) {
  const container = document.getElementById('datesContentContainer');
  if (!container) return;

  container.innerHTML = '<div style="color:#999;text-align:center;padding:10px;">Загрузка...</div>';

  const scriptName = type === 'processed' ? 'check-processed-dates' : 'check-match-dates';

  try {
    const response = await fetch('/api/admin/run-utility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: scriptName, username: currentUser?.username })
    });

    if (!response.ok) throw new Error('HTTP error! status: ' + response.status);

    const data = await response.json();

    if (data.success) {
      const formatted = formatUtilityOutput(data.output);
      container.innerHTML = formatted;
    } else {
      container.innerHTML = '<div style="color:#f44336;">' + data.error + '</div>';
    }
  } catch (error) {
    console.error('Ошибка загрузки данных:', error);
    container.innerHTML = '<div style="color:#f44336;">Ошибка загрузки: ' + error.message + '</div>';
  }
}

// Очистить обработанные даты
export async function clearProcessedDates() {
  try {
    const response = await fetch('/api/admin/processed-dates');
    if (!response.ok) throw new Error('Не удалось загрузить список дат');

    const data = await response.json();
    const dates = data.dates || [];

    if (dates.length === 0) {
      await showCustomAlert('Нет обработанных дат для очистки', 'Информация', 'ℹ️');
      return;
    }

    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;justify-content:center;align-items:center;z-index:10000;';

    const content = document.createElement('div');
    content.style.cssText = 'background:#1e1e1e;padding:30px;border-radius:12px;max-width:600px;max-height:80vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.5);';

    content.innerHTML = `
      <h2 style="margin:0 0 20px 0;color:#fff;"><svg class="icon" aria-hidden="true"><use href="#icon-delete"></use></svg>️ Очистка обработанных дат</h2>
      <p style="color:#b0b8c8;margin-bottom:20px;">Выберите даты которые нужно очистить. Автоподсчет пересчитает их при следующей проверке (каждые 5 минут).</p>
      <div style="margin-bottom:20px;">
        <label style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(90,159,212,0.1);border-radius:6px;cursor:pointer;margin-bottom:10px;">
          <input type="checkbox" id="selectAll" style="width:18px;height:18px;cursor:pointer;">
          <span style="color:#5a9fd4;font-weight:bold;">Выбрать все (${dates.length})</span>
        </label>
      </div>
      <div id="datesList" style="max-height:400px;overflow-y:auto;margin-bottom:20px;">
        ${dates.map(d => `
          <label style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,0.05);border-radius:6px;cursor:pointer;margin-bottom:8px;">
            <input type="checkbox" class="date-checkbox" value="${d.date_key}" style="width:18px;height:18px;cursor:pointer;">
            <div style="flex:1;">
              <div style="color:#fff;font-weight:500;">${d.date_key}</div>
              <div style="color:#888;font-size:0.85em;">Обработано: ${new Date(d.processed_at).toLocaleString('ru-RU')}</div>
            </div>
          </label>
        `).join('')}
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="cancelBtn" style="padding:12px 24px;background:#444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:1em;">Отмена</button>
        <button id="clearAllBtn" style="padding:12px 24px;background:#f44336;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:1em;">Очистить все</button>
        <button id="clearSelectedBtn" style="padding:12px 24px;background:#5a9fd4;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:1em;">Очистить выбранные</button>
      </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    const selectAllCheckbox = content.querySelector('#selectAll');
    const dateCheckboxes = content.querySelectorAll('.date-checkbox');

    selectAllCheckbox.addEventListener('change', (e) => {
      dateCheckboxes.forEach(cb => cb.checked = e.target.checked);
    });

    dateCheckboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        const allChecked = Array.from(dateCheckboxes).every(c => c.checked);
        const someChecked = Array.from(dateCheckboxes).some(c => c.checked);
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = someChecked && !allChecked;
      });
    });

    const closeModal = () => { document.body.removeChild(modal); };

    content.querySelector('#cancelBtn').addEventListener('click', closeModal);

    content.querySelector('#clearAllBtn').addEventListener('click', async () => {
      const confirmed = await showCustomConfirm(
        'Вы уверены что хотите очистить ВСЕ обработанные даты?\n\nЭто позволит автоподсчету запуститься повторно для всех дат.',
        'Очистка всех дат', '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>️'
      );

      if (!confirmed) return;

      try {
        const response = await fetch('/api/admin/clear-processed-dates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser?.username, dateKeys: [] })
        });

        if (!response.ok) throw new Error('HTTP error! status: ' + response.status);

        const result = await response.json();

        if (result.success) {
          await showCustomAlert(result.message, 'Успех', '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');
          closeModal();
          loadDatesData('processed');
        } else {
          await showCustomAlert(result.error, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
        }
      } catch (error) {
        console.error('Ошибка:', error);
        await showCustomAlert('Ошибка при очистке дат', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      }
    });

    content.querySelector('#clearSelectedBtn').addEventListener('click', async () => {
      const selectedDates = Array.from(dateCheckboxes).filter(cb => cb.checked).map(cb => cb.value);

      if (selectedDates.length === 0) {
        await showCustomAlert('Выберите хотя бы одну дату', 'Внимание', '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>️');
        return;
      }

      const confirmed = await showCustomConfirm(
        'Вы уверены что хотите очистить ' + selectedDates.length + ' дат?\n\nАвтоподсчет пересчитает их при следующей проверке.',
        'Очистка выбранных дат', '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>️'
      );

      if (!confirmed) return;

      try {
        const response = await fetch('/api/admin/clear-processed-dates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser?.username, dateKeys: selectedDates })
        });

        if (!response.ok) throw new Error('HTTP error! status: ' + response.status);

        const result = await response.json();

        if (result.success) {
          await showCustomAlert(result.message, 'Успех', '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');
          closeModal();
          loadDatesData('processed');
        } else {
          await showCustomAlert(result.error, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
        }
      } catch (error) {
        console.error('Ошибка:', error);
        await showCustomAlert('Ошибка при очистке дат', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      }
    });

  } catch (error) {
    console.error('Ошибка:', error);
    await showCustomAlert('Ошибка при загрузке списка дат', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}
