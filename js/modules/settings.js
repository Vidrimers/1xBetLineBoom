import * as state from './state.js';
import { showCustomAlert, showCustomConfirm } from './ui.js';

// ===== ЧАСОВЫЕ ПОЯСА =====

// Инициализация списка часовых поясов
export async function initTimezoneSettings() {
  try {
    const select = document.getElementById("timezoneSelect");
    if (!select) return;

    // Получаем список поддерживаемых часовых поясов
    const timezones = Intl.supportedValuesOf("timeZone");

    // Фильтруем: оставляем только Europe, Asia и UTC
    const filteredTimezones = timezones.filter(tz => {
      return tz.startsWith('Europe/') ||
             tz.startsWith('Asia/') ||
             tz === 'UTC';
    });

    // Сортируем и добавляем в select
    filteredTimezones.sort().forEach((tz) => {
      const option = document.createElement("option");
      option.value = tz;

      // Форматируем название для лучшей читаемости
      const offset = new Date()
        .toLocaleString("en-CA", {
          timeZone: tz,
          timeZoneName: "short",
        })
        .split(" ")
        .pop();

      option.textContent = `${tz} (${offset})`;
      select.appendChild(option);
    });

    // Загружаем текущий часовой пояс пользователя
    await loadUserTimezone();
  } catch (error) {
    console.error("Ошибка при инициализации часовых поясов:", error);
  }
}

// Загрузить текущий часовой пояс пользователя
export async function loadUserTimezone() {
  try {
    if (!state.currentUser) return;

    const response = await fetch(
      `/api/user/timezone?username=${encodeURIComponent(state.currentUser.username)}`
    );
    const data = await response.json();

    if (response.ok) {
      const select = document.getElementById("timezoneSelect");
      if (select) {
        select.value = data.timezone || "Europe/Moscow";
        console.log(`✅ Часовой пояс загружен: ${data.timezone}`);
      }
    }
  } catch (error) {
    console.error("Ошибка при загрузке часового пояса:", error);
  }
}

// Сохранить часовой пояс пользователя
export async function saveTimezoneSettings() {
  try {
    if (!state.currentUser) {
      alert("Сначала войдите в систему");
      return;
    }

    const select = document.getElementById("timezoneSelect");
    const timezone = select.value;

    if (!timezone) {
      alert("Выберите часовой пояс");
      return;
    }

    showSaveStatus('timezoneStatus', 'saving');

    const response = await fetch("/api/user/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: state.currentUser.username,
        timezone: timezone,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      state.currentUser.timezone = timezone;
      localStorage.setItem("currentUser", JSON.stringify(state.currentUser));

      showSaveStatus('timezoneStatus', 'saved');

      // Перезагружаем матчи с новым часовым поясом
      setTimeout(async () => {
        const { displayMatches } = await import('./matches.js');
        displayMatches();
      }, 300);
    } else {
      showSaveStatus('timezoneStatus', 'error');
      console.error("Ошибка:", result.error);
    }
  } catch (error) {
    console.error("Ошибка при сохранении часового пояса:", error);
    showSaveStatus('timezoneStatus', 'error');
  }
}

// ===== ОБНОВЛЕНИЕ SSTATS ID =====

// Открыть модальное окно для обновления SStats ID
export async function openUpdateSstatsModal() {
  let eventsListHTML = '<div style="color: #999; text-align: center; padding: 10px;">Загрузка...</div>';

  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">🔄 Обновить SStats ID</h3>
      
      <div id="eventsListForSstats" style="
        margin-bottom: 20px;
        padding: 15px;
        background: #2a3a4a;
        border-radius: 8px;
        max-height: 300px;
        overflow-y: auto;
      ">
        ${eventsListHTML}
      </div>
      
      <input 
        type="number" 
        id="eventIdInput" 
        placeholder="ID турнира" 
        style="
          width: 100%;
          padding: 12px;
          border: 1px solid #3a7bd5;
          border-radius: 8px;
          background: #2a3a4a;
          color: #e0e6f0;
          font-size: 16px;
          margin-bottom: 20px;
        "
      />
      <div style="display: flex; gap: 10px;">
        <button onclick="updateSstatsIds()" style="
          flex: 1;
          background: #e91e63;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Обновить</button>
        <button onclick="this.closest('div[style*=fixed]').remove()" style="
          flex: 1;
          background: #f44336;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Отмена</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Загружаем список турниров
  try {
    const response = await fetch('/api/admin/all-events');
    if (response.ok) {
      const events = await response.json();

      if (events.length === 0) {
        eventsListHTML = '<div style="color: #999; text-align: center; padding: 10px;">Нет турниров</div>';
      } else {
        // Сортируем: активные сверху, потом по дате начала
        events.sort((a, b) => {
          if (a.status === 'active' && b.status !== 'active') return -1;
          if (a.status !== 'active' && b.status === 'active') return 1;
          return new Date(b.start_date) - new Date(a.start_date);
        });

        eventsListHTML = events.map(event => {
          const startDate = event.start_date ? new Date(event.start_date).toLocaleDateString('ru-RU') : 'Не указана';
          const statusBadge = event.status === 'active'
            ? '<span style="color: #4caf50;">●</span>'
            : '<span style="color: #999;">○</span>';

          return `
            <div style="
              padding: 8px 12px;
              margin-bottom: 8px;
              background: #1e2a3a;
              border-radius: 6px;
              cursor: pointer;
              transition: background 0.2s;
            " 
            onmouseover="this.style.background='#2a3a4a'"
            onmouseout="this.style.background='#1e2a3a'"
            onclick="document.getElementById('eventIdInput').value='${event.id}'">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="color: #e0e6f0; font-weight: bold; margin-bottom: 4px;">
                    ${statusBadge} ${event.name}
                  </div>
                  <div style="color: #999; font-size: 0.85em;">
                    Начало: ${startDate}
                  </div>
                </div>
                <div style="color: #5a9fd4; font-weight: bold;">
                  ID: ${event.id}
                </div>
              </div>
            </div>
          `;
        }).join('');
      }

      document.getElementById('eventsListForSstats').innerHTML = eventsListHTML;
    }
  } catch (error) {
    console.error('Ошибка загрузки турниров:', error);
    document.getElementById('eventsListForSstats').innerHTML =
      '<div style="color: #f44336; text-align: center; padding: 10px;">Ошибка загрузки</div>';
  }

  document.getElementById('eventIdInput').focus();
}

// Обновить SStats ID для турнира
export async function updateSstatsIds() {
  const eventId = document.getElementById('eventIdInput').value;

  if (!eventId) {
    await showCustomAlert('Введите ID турнира', 'Ошибка', '❌');
    return;
  }

  try {
    const response = await fetch(`/api/admin/run-utility`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        script: 'update-sstats-ids',
        username: state.currentUser?.username,
        args: [eventId],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      await showCustomAlert(`${data.output}`, data.title, '✅');
      document.querySelector('div[style*=fixed]').remove();
    } else {
      await showCustomAlert(`${data.error}`, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await showCustomAlert(`${error.message}`, 'Ошибка', '❌');
  }
}

// ===== ДЕАКТИВАЦИЯ ТУРНИРОВ =====

// Открыть модальное окно для деактивации турниров
export async function openDeactivateEventsModal() {
  // Загружаем список активных турниров
  let eventsListHTML = '<div style="color: #999; text-align: center; padding: 10px;">Загрузка...</div>';

  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">🔒 Деактивировать турниры</h3>
      
      <div style="
        margin-bottom: 20px;
        padding: 15px;
        background: rgba(255, 152, 0, 0.2);
        border-left: 4px solid #ff9800;
        border-radius: 4px;
        color: #ffe0b2;
      ">
        ⚠️ Выберите турниры для деактивации. Их статус будет изменен на "completed".
      </div>
      
      <div id="eventsListContainer" style="
        margin-bottom: 20px;
        padding: 15px;
        background: #2a3a4a;
        border-radius: 8px;
        max-height: 400px;
        overflow-y: auto;
      ">
        ${eventsListHTML}
      </div>
      
      <div style="display: flex; gap: 10px;">
        <button onclick="deactivateSelectedEvents()" style="
          flex: 1;
          background: #ff9800;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Деактивировать выбранные</button>
        <button onclick="this.closest('div[style*=fixed]').remove()" style="
          flex: 1;
          background: #f44336;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Отмена</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Загружаем турниры
  try {
    const response = await fetch('/api/admin/all-events');
    if (response.ok) {
      const events = await response.json();

      // Фильтруем только активные турниры
      const activeEvents = events.filter(e => e.status === 'active');

      if (activeEvents.length === 0) {
        eventsListHTML = '<div style="color: #999; text-align: center; padding: 10px;">Нет активных турниров</div>';
      } else {
        eventsListHTML = activeEvents.map(event => {
          const startDate = event.start_date ? new Date(event.start_date).toLocaleDateString('ru-RU') : 'Не указана';

          return `
            <label style="
              display: flex;
              align-items: center;
              padding: 12px;
              margin-bottom: 8px;
              background: #1e2a3a;
              border-radius: 6px;
              cursor: pointer;
              transition: background 0.2s;
            " 
            onmouseover="this.style.background='#2a3a4a'"
            onmouseout="this.style.background='#1e2a3a'">
              <input 
                type="checkbox" 
                class="event-checkbox" 
                data-event-id="${event.id}"
                style="
                  width: 20px;
                  height: 20px;
                  margin-right: 15px;
                  cursor: pointer;
                "
              />
              <div style="flex: 1;">
                <div style="color: #e0e6f0; font-weight: bold; margin-bottom: 4px;">
                  ${event.name}
                </div>
                <div style="color: #999; font-size: 0.85em;">
                  ID: ${event.id} | Начало: ${startDate}
                </div>
              </div>
            </label>
          `;
        }).join('');
      }

      document.getElementById('eventsListContainer').innerHTML = eventsListHTML;
    }
  } catch (error) {
    console.error('Ошибка загрузки турниров:', error);
    document.getElementById('eventsListContainer').innerHTML =
      '<div style="color: #f44336; text-align: center; padding: 10px;">Ошибка загрузки</div>';
  }
}

// Деактивировать выбранные турниры
export async function deactivateSelectedEvents() {
  const checkboxes = document.querySelectorAll('.event-checkbox:checked');

  if (checkboxes.length === 0) {
    await showCustomAlert('Выберите хотя бы один турнир', 'Ошибка', '❌');
    return;
  }

  const eventIds = Array.from(checkboxes).map(cb => cb.dataset.eventId);

  const confirmed = await showCustomConfirm(
    `Вы уверены что хотите деактивировать ${eventIds.length} турнир(ов)?\n\nИх статус будет изменен на "completed".`,
    'Подтверждение деактивации',
    '⚠️'
  );

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch('/api/admin/deactivate-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventIds: eventIds,
        username: state.currentUser?.username,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      await showCustomAlert(
        `Деактивировано турниров: ${data.deactivated}\n\n${data.events.map(e => `✓ ${e.name}`).join('\n')}`,
        'Турниры деактивированы',
        '✅'
      );
      document.querySelector('div[style*=fixed]').remove();

      // Перезагружаем список событий если он открыт
      if (typeof loadEvents === 'function') {
        loadEvents();
      }
    } else {
      await showCustomAlert(`${data.error}`, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await showCustomAlert(`${error.message}`, 'Ошибка', '❌');
  }
}
