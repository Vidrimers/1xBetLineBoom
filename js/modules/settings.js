import * as state from './state.js';
import { showCustomAlert, showCustomConfirm, showSaveStatus } from './ui.js';
import { isAdmin, canViewLogs } from './admin.js';
import { loadMatches } from './matches.js';

// ===== ЗАГРУЗКА НАСТРОЕК =====

// Загрузить настройки
export async function loadSettings() {
  if (!state.currentUser) {
    document.getElementById('settingsContainer').innerHTML =
      '<div class="empty-message">Войдите в систему для доступа к настройкам</div>';
    return;
  }

  try {
    // Загружаем текущий Telegram username
    const response = await fetch(`/api/user/${state.currentUser.id}/telegram`);
    const data = await response.json();
    const telegramUsername = data.telegram_username || '';

    // Обновляем currentUser с актуальными данными
    state.currentUser.telegram_username = telegramUsername;

    // Загружаем все настройки уведомлений
    const notifResponse = await fetch(
      `/api/user/${state.currentUser.id}/notifications`
    );
    const notifData = await notifResponse.json();
    const telegramNotificationsEnabled =
      notifData.telegram_notifications_enabled ?? true;
    const telegramGroupRemindersEnabled =
      notifData.telegram_group_reminders_enabled ?? true;

    // Вставляем Telegram username настройку ПЕРЕД чекбоксом уведомлений
    const settingsContainer = document.getElementById('settingsContainer');

    // Удаляем старый элемент Telegram если он существует
    const oldTelegramElement = settingsContainer.querySelector(
      '[id="telegramSettingsElement"]'
    );
    if (oldTelegramElement) {
      oldTelegramElement.remove();
    }

    const telegramHTML = `
      <!-- Telegram -->
      <div id="telegramSettingsElement" class="setting-item" style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); position: relative;">
        <button onclick="openTelegramBindInfoModal()" style="
          position: absolute;
          top: 0;
          right: 0;
          background: transparent;
          border: none;
          border-radius: 6px;
          border-left: 1px solid rgb(58, 123, 213);
          border-bottom: 1px solid rgb(58, 123, 213);
          color: #5a9fd4;
          width: 28px;
          height: 28px;
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s ease;
        " onmouseover="this.style.background='transparent'; this.style.transform='scale(1.1)'" onmouseout="this.style.background='transparent'; this.style.transform='scale(1)'" title="Информация о Telegram">❔</button>
        <div class="setting-label">
          <span>📱 Telegram</span>
          ${
            telegramUsername
              ? `<a href="https://t.me/${telegramUsername}" target="_blank" class="setting-link">@${telegramUsername}</a>`
              : ""
          }
        </div>
        <p class="setting-hint">ТГ для уведомлений/напоминаний</p>
        ${telegramUsername ? `
        <div class="setting-control">
          <input type="text" id="telegramUsernameInput" value="${telegramUsername}" placeholder="@username" disabled style="opacity: 0.6; cursor: not-allowed;">
          <div class="setting-buttons">
            <button onclick="deleteTelegramUsername()" class="btn-delete">🗑️</button>
          </div>
        </div>
        <p class="setting-hint-small">Информацию можно узнать в <a href="https://t.me/OnexBetLineBoomBot" target="_blank">боте</a></p>
        ` : `
        <button 
          onclick="window.open('https://t.me/OnexBetLineBoomBot?start=link_${state.currentUser.id}', '_blank')" 
          style="
            margin-top: 10px;
            background: rgba(90, 159, 212, 0.2);
            color: #5a9fd4;
            border: 1px solid #5a9fd4;
            padding: 10px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.3s ease;
            width: 100%;
          "
          onmouseover="this.style.background='rgba(90, 159, 212, 0.3)'; this.style.transform='scale(1.02)'"
          onmouseout="this.style.background='rgba(90, 159, 212, 0.2)'; this.style.transform='scale(1)'"
        >
          🔗 Привязать свой ТГ
        </button>
        `}
      </div>
    `;

    // Вставляем Telegram настройку в начало контейнера
    settingsContainer.insertAdjacentHTML('afterbegin', telegramHTML);

    // Инициализируем оба checkbox
    const notifCheckbox = document.getElementById(
      'telegramNotificationsCheckbox'
    );
    if (notifCheckbox) {
      notifCheckbox.checked = telegramNotificationsEnabled;
    }

    const remindersCheckbox = document.getElementById('groupRemindersCheckbox');
    if (remindersCheckbox) {
      remindersCheckbox.checked = telegramGroupRemindersEnabled;
    }

    // Загружаем настройку подтверждения логина через бота
    const login2faCheckbox = document.getElementById('login2faCheckbox');
    if (login2faCheckbox) {
      login2faCheckbox.checked = state.currentUser.require_login_2fa !== 0; // По умолчанию включено
    }

    // Загружаем настройку звука в LIVE матчах
    const liveSoundCheckbox = document.getElementById('liveSoundCheckbox');
    if (liveSoundCheckbox) {
      liveSoundCheckbox.checked = notifData.live_sound === true; // По умолчанию выключено
    }

    // Инициализируем часовые поясы
    await initTimezoneSettings();

    // Загружаем конфигурацию админ-панели для админов
    if (state.currentUser.isAdmin) {
      const { loadAdminPanelConfig } = await import('./adminPanel.js');
      await loadAdminPanelConfig();
    }
  } catch (error) {
    console.error('Ошибка при загрузке настроек:', error);
    // Не очищаем контейнер, чтобы статический HTML остался видимым
    console.warn('Используем статические настройки из HTML');
  }
}

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

// Открыть модальное окно с информацией о привязке Telegram (для настроек залогиненных)
export async function openTelegramBindInfoModal() {
  // Блокируем body
  document.body.style.overflow = 'hidden';

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
  
  // Закрытие по клику вне модалки
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      document.body.style.overflow = '';
    }
  });
  
  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 700px;
      width: 95%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      position: relative;
      color: #e0e6f0;
    ">
      <button onclick="this.closest('div[style*=fixed]').remove(); document.body.style.overflow = '';" style="
        position: absolute;
        top: 15px;
        right: 15px;
        background: transparent;
        border: none;
        color: #e0e6f0;
        font-size: 24px;
        cursor: pointer;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background 0.2s;
      " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">×</button>
      
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">📱 Зачем привязывать Telegram?</h3>
      
      <div style="line-height: 1.6;">
        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">🔔 Уведомления и напоминания</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <p style="margin: 0 0 10px 0;">Получайте важные уведомления прямо в Telegram:</p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li><strong>Напоминания о матчах</strong> — не пропустите начало матча и успейте сделать ставку</li>
            <li><strong>Результаты матчей</strong> — узнавайте о завершении матчей и своих выигрышах</li>
            <li><strong>Новые турниры</strong> — будьте в курсе новых турниров и событий</li>
            <li><strong>Важные обновления</strong> — получайте информацию об изменениях в системе</li>
          </ul>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">🔐 Безопасность</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <p style="margin: 0 0 10px 0;">Дополнительная защита вашего аккаунта:</p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li><strong>Двухфакторная аутентификация</strong> — подтверждение входа через бота для максимальной безопасности</li>
            <li><strong>Уведомления о входе</strong> — получайте оповещения о каждом входе в аккаунт</li>
            <li><strong>Контроль доступа</strong> — мгновенно узнавайте о подозрительной активности</li>
          </ul>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">🤖 Функционал бота</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <p style="margin: 0 0 10px 0;">Управляйте своим аккаунтом через Telegram:</p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li><strong>Быстрый доступ</strong> — просматривайте свою статистику и результаты</li>
            <li><strong>Управление уведомлениями</strong> — настраивайте, какие уведомления получать</li>
            <li><strong>Информация о турнирах</strong> — получайте актуальную информацию о текущих турнирах</li>
            <li><strong>Поддержка</strong> — связывайтесь с администрацией напрямую через бота</li>
          </ul>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">🔒 Конфиденциальность</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li>Ваш Telegram используется <strong>только для уведомлений</strong> и связи с вами</li>
            <li>Мы <strong>не передаем</strong> ваши данные третьим лицам</li>
            <li>Вы можете <strong>отключить уведомления</strong> в любой момент в настройках</li>
            <li>Вы можете <strong>отвязать Telegram</strong> в любое время</li>
          </ul>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;">🚀 Как привязать?</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px;">
          <ol style="margin: 5px 0; padding-left: 20px;">
            <li>Нажмите кнопку <strong>"🔗 Привязать свой ТГ"</strong></li>
            <li>Откроется бот <strong>@OnexBetLineBoomBot</strong> в Telegram</li>
            <li>Нажмите <strong>/start</strong> или кнопку "Начать"</li>
            <li>Бот автоматически привяжет ваш аккаунт</li>
            <li>Готово! Теперь вы будете получать уведомления</li>
          </ol>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

// Удалить Telegram username
export async function deleteTelegramUsername() {
  if (!state.currentUser) {
    await showCustomAlert('Сначала войдите в систему', 'Ошибка', '❌');
    return;
  }

  if (!state.currentUser.telegram_username) {
    await showCustomAlert('Telegram логин не привязан', 'Ошибка', '❌');
    return;
  }

  const confirmed = await showCustomConfirm(
    'Для удаления Telegram логина требуется подтверждение. Вам будет отправлено сообщение в Telegram с кодом подтверждения. Продолжить?',
    'Подтверждение удаления',
    '⚠️'
  );
  
  if (!confirmed) {
    return;
  }

  try {
    // Запрашиваем код подтверждения
    const response = await fetch(`/api/user/${state.currentUser.id}/telegram/request-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await response.json();

    if (response.ok) {
      // Показываем поле для ввода кода
      const code = await showCustomPrompt(
        'Введите код подтверждения, отправленный вам в Telegram:',
        'Подтверждение',
        '🔐',
        'Код из Telegram'
      );
      if (!code) return;

      // Подтверждаем удаление
      const confirmResponse = await fetch(`/api/user/${state.currentUser.id}/telegram/confirm-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation_code: code }),
      });

      const confirmResult = await confirmResponse.json();

      if (confirmResponse.ok) {
        await showCustomAlert('Telegram логин успешно удален!', 'Успех', '✅');
        state.currentUser.telegram_username = null;
        loadSettings();
      } else {
        await showCustomAlert(confirmResult.error, 'Ошибка', '❌');
      }
    } else {
      await showCustomAlert(result.error, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка при удалении Telegram логина:', error);
    await showCustomAlert('Ошибка при удалении Telegram логина', 'Ошибка', '❌');
  }
}

// ===== TELEGRAM УВЕДОМЛЕНИЯ =====

// Открыть детальные настройки Telegram уведомлений (личные)
export async function openDetailedNotificationsModal() {
  if (!state.currentUser) {
    await showCustomAlert('Войдите в систему', 'Ошибка', '❌');
    return;
  }

  // Проверяем привязку Telegram
  if (!state.currentUser.telegram_username) {
    await showCustomAlert(
      'Для настройки уведомлений необходимо привязать Telegram аккаунт.\n\nПерейдите в настройки профиля и свяжите свой аккаунт с ботом.',
      'Telegram не привязан',
      '📱'
    );
    return;
  }

  const modal = document.getElementById('detailedNotificationsModal');
  if (modal) {
    // Загружаем текущие настройки
    await loadDetailedNotificationSettings();
    
    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    modal.style.display = 'flex';
  }
}

// Закрыть модальное окно детальных настроек уведомлений
export function closeDetailedNotificationsModal() {
  const modal = document.getElementById('detailedNotificationsModal');
  if (modal) {
    // Разблокируем скролл body
    document.body.style.overflow = '';
    modal.style.display = 'none';
  }
}

// Загрузить детальные настройки уведомлений
export async function loadDetailedNotificationSettings() {
  if (!state.currentUser) return;

  try {
    const response = await fetch(`/api/user/${state.currentUser.id}/notification-settings`);
    
    if (response.ok) {
      const settings = await response.json();
      
      // Устанавливаем значения чекбоксов
      document.getElementById('notifMatchReminders').checked = settings.match_reminders !== false;
      document.getElementById('notifThreeHourReminders').checked = settings.three_hour_reminders !== false;
      document.getElementById('notifOnlyActiveTournaments').checked = settings.only_active_tournaments === true;
      document.getElementById('notifTournamentAnnouncements').checked = settings.tournament_announcements !== false;
      document.getElementById('notifMatchResults').checked = settings.match_results !== false;
      document.getElementById('notifSystemMessages').checked = settings.system_messages !== false;
      
      // Обновляем состояние disabled для зависимой настройки
      updateOnlyActiveTournamentsState();
    }
    
    // Загружаем настройку уведомлений о просмотре
    const notifyOnViewResponse = await fetch(`/api/user/${state.currentUser.id}/notify-on-view`);
    if (notifyOnViewResponse.ok) {
      const notifyOnViewData = await notifyOnViewResponse.json();
      document.getElementById('notifOnView').checked = notifyOnViewData.notify_on_view !== 0;
    }
  } catch (error) {
    console.error('Ошибка загрузки настроек уведомлений:', error);
  }
}

// Обновить состояние настройки "Только по турнирам с моими ставками"
export function updateOnlyActiveTournamentsState() {
  const threeHourRemindersCheckbox = document.getElementById('notifThreeHourReminders');
  const onlyActiveTournamentsCheckbox = document.getElementById('notifOnlyActiveTournaments');
  
  if (threeHourRemindersCheckbox && onlyActiveTournamentsCheckbox) {
    const isThreeHourRemindersEnabled = threeHourRemindersCheckbox.checked;
    
    // Если напоминания за 3 часа включаются - автоматически включаем фильтр
    if (isThreeHourRemindersEnabled && onlyActiveTournamentsCheckbox.disabled) {
      onlyActiveTournamentsCheckbox.checked = true;
    }
    
    // Если напоминания за 3 часа выключены - делаем настройку disabled
    onlyActiveTournamentsCheckbox.disabled = !isThreeHourRemindersEnabled;
    
    // Визуально затемняем родительский блок если disabled
    const parentDiv = onlyActiveTournamentsCheckbox.closest('.notification-setting-item');
    if (parentDiv) {
      if (!isThreeHourRemindersEnabled) {
        parentDiv.style.opacity = '0.5';
        parentDiv.style.pointerEvents = 'none';
      } else {
        parentDiv.style.opacity = '1';
        parentDiv.style.pointerEvents = 'auto';
      }
    }
  }
}

// Сохранить детальные настройки уведомлений
export async function saveDetailedNotificationSettings() {
  if (!state.currentUser) return;

  const settings = {
    match_reminders: document.getElementById('notifMatchReminders').checked,
    three_hour_reminders: document.getElementById('notifThreeHourReminders').checked,
    only_active_tournaments: document.getElementById('notifOnlyActiveTournaments').checked,
    tournament_announcements: document.getElementById('notifTournamentAnnouncements').checked,
    match_results: document.getElementById('notifMatchResults').checked,
    system_messages: document.getElementById('notifSystemMessages').checked,
  };

  try {
    const response = await fetch(`/api/user/${state.currentUser.id}/notification-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Ошибка сохранения настроек:', error);
    }
    
    // Обновляем состояние disabled для зависимой настройки
    updateOnlyActiveTournamentsState();
    
    // Обновляем видимость кнопки колокольчика если изменилась настройка напоминаний
    if (state.currentEventId) {
      const event = state.events.find((e) => e.id === state.currentEventId);
      const isLocked = event && event.locked_reason;
      const isUpcoming = event && event.start_date && new Date(event.start_date) > new Date();
      
      if (!isLocked && !isUpcoming) {
        checkMatchRemindersSettingAndUpdateButton();
      }
    }
  } catch (error) {
    console.error('Ошибка сохранения настроек уведомлений:', error);
  }
}

// Проверить настройку "Напоминания о матчах" и обновить видимость кнопки
export async function checkMatchRemindersSettingAndUpdateButton() {
  const matchRemindersBtn = document.getElementById('matchRemindersBtn');
  
  if (!matchRemindersBtn || !state.currentUser) {
    if (matchRemindersBtn) matchRemindersBtn.style.display = 'none';
    return;
  }
  
  try {
    const response = await fetch(`/api/user/${state.currentUser.id}/notification-settings`);
    
    if (response.ok) {
      const settings = await response.json();
      
      // Если настройка "Напоминания о матчах" выключена - скрываем кнопку
      if (settings.match_reminders === false) {
        matchRemindersBtn.style.display = 'none';
        const { updateReminderIndicator } = await import('./reminders.js');
        updateReminderIndicator(false);
      } else {
        matchRemindersBtn.style.display = 'flex';
        // Загружаем настройки напоминаний для обновления индикатора
        const { loadMatchReminders } = await import('./reminders.js');
        loadMatchReminders();
      }
    } else {
      // Если настроек нет - показываем кнопку (по умолчанию включено)
      matchRemindersBtn.style.display = 'flex';
      const { loadMatchReminders } = await import('./reminders.js');
      loadMatchReminders();
    }
  } catch (error) {
    console.error('Ошибка проверки настроек напоминаний:', error);
    // При ошибке показываем кнопку
    matchRemindersBtn.style.display = 'flex';
    const { loadMatchReminders } = await import('./reminders.js');
    loadMatchReminders();
  }
}

// Сохранить настройку "Уведомления о просмотре"
export async function saveNotifyOnViewSettings() {
  if (!state.currentUser) return;

  try {
    const notifyOnView = document.getElementById('notifOnView').checked ? 1 : 0;
    await fetch(`/api/user/${state.currentUser.id}/notify-on-view`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notify_on_view: notifyOnView }),
    });
  } catch (error) {
    console.error('Ошибка сохранения настройки уведомлений о просмотре:', error);
  }
}

// Сохранить настройки Telegram уведомлений
export async function saveTelegramNotificationSettings() {
  try {
    if (!state.currentUser) {
      await showCustomAlert('Сначала войдите в систему', 'Ошибка', '❌');
      return;
    }

    const checkbox = document.getElementById('telegramNotificationsCheckbox');
    const isEnabled = checkbox.checked;

    showSaveStatus('telegramNotificationsStatus', 'saving');

    const response = await fetch(`/api/user/${state.currentUser.id}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_notifications_enabled: isEnabled ? 1 : 0 })
    });

    const result = await response.json();

    if (response.ok) {
      state.currentUser.telegram_notifications_enabled = isEnabled ? 1 : 0;
      localStorage.setItem('currentUser', JSON.stringify(state.currentUser));
      showSaveStatus('telegramNotificationsStatus', 'saved');
    } else {
      console.error('Ошибка сохранения настроек Telegram:', result.error);
      checkbox.checked = !isEnabled;
      showSaveStatus('telegramNotificationsStatus', 'error');
      await showCustomAlert(result.error || 'Ошибка при сохранении настроек', 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка при сохранении настроек Telegram уведомлений:', error);
    showSaveStatus('telegramNotificationsStatus', 'error');
    await showCustomAlert('Ошибка при сохранении настроек', 'Ошибка', '❌');
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

// ===== НАСТРОЙКИ ПЕРЕКЛЮЧАТЕЛЕЙ =====

// Переключить видимость карточки напоминаний группы
export async function toggleGroupRemindersCardVisibility() {
  if (!state.currentUser || !state.currentUser.isAdmin) {
    await showCustomAlert('У вас нет прав для этого действия', 'Ошибка', '❌');
    return;
  }
  try {
    const card = document.getElementById('groupRemindersCard');
    const btn = document.getElementById('toggleGroupRemindersCardBtn');
    const isCurrentlyHidden = card ? card.style.display === 'none' : false;
    const newVisibility = !isCurrentlyHidden;
    const response = await fetch('/api/admin/group-reminders-card-visibility', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: newVisibility, admin_username: state.currentUser.username })
    });
    const result = await response.json();
    if (response.ok) {
      if (card) card.style.display = newVisibility ? 'none' : 'block';
      if (btn) {
        btn.textContent = newVisibility ? '👁️ Показать напоминания ТГ' : '🚫 Скрыть напоминания ТГ';
        btn.style.background = newVisibility ? 'rgba(76, 175, 80, 0.7)' : 'rgba(255, 87, 34, 0.7)';
        btn.style.color = newVisibility ? '#c8e6c9' : '#ffe0d6';
        btn.style.borderColor = newVisibility ? '#4caf50' : '#ff5722';
      }
      await showCustomAlert(
        newVisibility ? 'Карточка скрыта для всех пользователей' : 'Карточка показана для всех пользователей',
        'Успешно', '✅'
      );
    } else {
      await showCustomAlert(result.error || 'Не удалось изменить видимость карточки', 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка при переключении видимости карточки:', error);
    await showCustomAlert('Не удалось изменить видимость карточки.\n\nПроверьте подключение к серверу.', 'Ошибка', '❌');
  }
}

// Сохранить настройку подтверждения логина через бота
export async function saveLogin2faSettings() {
  if (!state.currentUser) { alert('Сначала войдите в систему'); return; }
  try {
    const checkbox = document.getElementById('login2faCheckbox');
    const isEnabled = checkbox.checked;
    if (isEnabled && !state.currentUser.telegram_username) {
      alert('Для включения подтверждения логина необходимо сначала привязать Telegram в настройках выше');
      checkbox.checked = false;
      return;
    }
    showSaveStatus('login2faStatus', 'saving');
    const response = await fetch(`/api/user/${state.currentUser.id}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ require_login_2fa: isEnabled ? 1 : 0 })
    });
    const result = await response.json();
    if (response.ok) {
      state.currentUser.require_login_2fa = isEnabled ? 1 : 0;
      localStorage.setItem('currentUser', JSON.stringify(state.currentUser));
      showSaveStatus('login2faStatus', 'saved');
    } else {
      showSaveStatus('login2faStatus', 'error');
      console.error('Ошибка:', result.error);
    }
  } catch (error) {
    console.error('Ошибка при сохранении настройки 2FA:', error);
    showSaveStatus('login2faStatus', 'error');
  }
}

// Сохранить настройку звука в LIVE матчах
export async function saveLiveSoundSettings() {
  if (!state.currentUser) { alert('Сначала войдите в систему'); return; }
  try {
    const checkbox = document.getElementById('liveSoundCheckbox');
    const isEnabled = checkbox.checked;
    showSaveStatus('liveSoundStatus', 'saving');
    const response = await fetch(`/api/user/${state.currentUser.id}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ live_sound: isEnabled ? 1 : 0 })
    });
    const result = await response.json();
    if (response.ok) {
      state.currentUser.live_sound = isEnabled ? 1 : 0;
      localStorage.setItem('currentUser', JSON.stringify(state.currentUser));
      showSaveStatus('liveSoundStatus', 'saved');
    } else {
      showSaveStatus('liveSoundStatus', 'error');
      console.error('Ошибка:', result.error);
    }
  } catch (error) {
    console.error('Ошибка при сохранении настройки звука LIVE:', error);
    showSaveStatus('liveSoundStatus', 'error');
  }
}

// Сохранить настройку показа победителя на завершённых турнирах
export async function saveShowTournamentWinnerSettings() {
  try {
    const checkbox = document.getElementById('showTournamentWinnerCheckbox');
    const showWinner = checkbox.checked;
    showSaveStatus('tournamentWinnerStatus', 'saving');
    const response = await fetch('/api/settings/show-tournament-winner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        show_tournament_winner: showWinner,
        username: state.currentUser?.username || 'Unknown',
        telegram_username: state.currentUser?.telegram_username || 'Not set'
      })
    });
    const result = await response.json();
    if (response.ok) {
      showSaveStatus('tournamentWinnerStatus', 'saved');
    } else {
      showSaveStatus('tournamentWinnerStatus', 'error');
      console.error('Ошибка:', result.error);
    }
  } catch (error) {
    console.error('Ошибка при сохранении настройки показа победителя:', error);
    showSaveStatus('tournamentWinnerStatus', 'error');
  }
}

// Сохранить настройку видимости ставок
export async function saveShowBetsSettings() {
  if (!state.currentUser) { alert('Сначала войдите в систему'); return; }
  try {
    const select = document.getElementById('showBetsSelect');
    const showBets = select.value;
    showSaveStatus('showBetsStatus', 'saving');
    const response = await fetch(`/api/user/${state.currentUser.id}/show-bets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_bets: showBets })
    });
    const result = await response.json();
    if (response.ok) {
      state.currentUser.show_bets = showBets;
      localStorage.setItem('currentUser', JSON.stringify(state.currentUser));
      showSaveStatus('showBetsStatus', 'saved');
    } else {
      showSaveStatus('showBetsStatus', 'error');
      console.error('Ошибка:', result.error);
    }
  } catch (error) {
    console.error('Ошибка при сохранении настройки:', error);
    showSaveStatus('showBetsStatus', 'error');
  }
}

// Сохранить настройку кнопки "Мне повезёт"
export async function saveLuckyButtonSettings() {
  if (!state.currentUser) { alert('Сначала войдите в систему'); return; }
  try {
    const select = document.getElementById('showLuckyButtonSelect');
    const showLuckyButton = parseInt(select.value);
    showSaveStatus('luckyButtonStatus', 'saving');
    const response = await fetch(`/api/user/${state.currentUser.id}/show-lucky-button`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_lucky_button: showLuckyButton })
    });
    const result = await response.json();
    if (response.ok) {
      state.currentUser.show_lucky_button = showLuckyButton;
      localStorage.setItem('currentUser', JSON.stringify(state.currentUser));
      showSaveStatus('luckyButtonStatus', 'saved');
    } else {
      showSaveStatus('luckyButtonStatus', 'error');
      console.error('Ошибка:', result.error);
    }
  } catch (error) {
    console.error('Ошибка при сохранении настройки:', error);
    showSaveStatus('luckyButtonStatus', 'error');
  }
}

// Сохранить настройку кнопки xG
export async function saveXgButtonSettings() {
  if (!state.currentUser) { alert('Сначала войдите в систему'); return; }
  try {
    const select = document.getElementById('showXgButtonSelect');
    const showXgButton = parseInt(select.value);
    showSaveStatus('xgButtonStatus', 'saving');
    const response = await fetch(`/api/user/${state.currentUser.id}/show-xg-button`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_xg_button: showXgButton })
    });
    const result = await response.json();
    if (response.ok) {
      state.currentUser.show_xg_button = showXgButton;
      localStorage.setItem('currentUser', JSON.stringify(state.currentUser));
      await loadMatches(state.currentEventId);
      showSaveStatus('xgButtonStatus', 'saved');
    } else {
      showSaveStatus('xgButtonStatus', 'error');
      console.error('Ошибка:', result.error);
    }
  } catch (error) {
    console.error('Ошибка при сохранении настройки кнопки xG:', error);
    showSaveStatus('xgButtonStatus', 'error');
  }
}

// Обновить логи (миграция)
export async function migrateLogs() {
  if (!isAdmin()) {
    await showCustomAlert('Недостаточно прав', 'Доступ запрещён', '❌');
    return;
  }
  const confirmed = await showCustomConfirm(
    'Обновить файл логов, добавив код отображения размера файла?\n\nСодержимое логов НЕ будет удалено.',
    'Обновление логов', '🔄'
  );
  if (!confirmed) return;
  try {
    const response = await fetch('/api/admin/migrate-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: state.currentUser.username })
    });
    const result = await response.json();
    if (response.ok) {
      if (result.alreadyMigrated) {
        await showCustomAlert(result.message, 'Информация', 'ℹ️');
      } else {
        await showCustomAlert(result.message + '\n\nОбновите страницу логов чтобы увидеть изменения.', 'Успешно', '✅');
      }
    } else {
      await showCustomAlert(result.error, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка при обновлении логов:', error);
    await showCustomAlert('Ошибка при обновлении логов', 'Ошибка', '❌');
  }
}

// Очистить логи
export async function clearLogs() {
  if (!canViewLogs()) {
    await showCustomAlert('Недостаточно прав', 'Доступ запрещён', '❌');
    return;
  }
  const confirmed = await showCustomConfirm(
    'Вы уверены, что хотите очистить все логи ставок?',
    'Очистка логов', '⚠️'
  );
  if (!confirmed) return;
  try {
    const response = await fetch('/api/admin/clear-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: state.currentUser.username })
    });
    const result = await response.json();
    if (response.ok) {
      await showCustomAlert('Логи успешно очищены!', 'Успешно', '✅');
    } else {
      await showCustomAlert(result.error, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка при очистке логов:', error);
    await showCustomAlert('Ошибка при очистке логов', 'Ошибка', '❌');
  }
}
