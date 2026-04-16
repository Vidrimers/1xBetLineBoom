// Модуль: управление устройствами (активные сессии пользователя)

import * as state from './state.js';
import { showCustomAlert, showCustomConfirm, showCustomPrompt } from './ui.js';

// ===== ОТКРЫТИЕ/ЗАКРЫТИЕ МОДАЛЬНОГО ОКНА УСТРОЙСТВ =====

// Открыть модальное окно устройств
export async function openDevicesModal() {
  const modal = document.getElementById("devicesModal");
  if (modal) {
    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";
    await loadDevicesList();
  }
}

// Закрыть модальное окно устройств
export function closeDevicesModal() {
  const modal = document.getElementById("devicesModal");
  if (modal) {
    // Разблокируем скролл body
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// ===== ЗАГРУЗКА СПИСКА УСТРОЙСТВ =====

// Загрузить список устройств
async function loadDevicesList() {
  if (!state.currentUser) return;

  try {
    const response = await fetch(`/api/user/${state.currentUser.id}/sessions`);
    const sessions = await response.json();

    const listContainer = document.getElementById("devicesList");

    if (!Array.isArray(sessions) || sessions.length === 0) {
      listContainer.innerHTML = '<div class="empty-message">Нет активных устройств</div>';
      return;
    }

    // Получаем текущий session_token из localStorage
    const currentSessionToken = localStorage.getItem("sessionToken");

    listContainer.innerHTML = sessions.map(session => {
      const isCurrentDevice = session.session_token === currentSessionToken;
      const isTrusted = session.is_trusted === 1;
      const deviceIcon = getDeviceIcon(session.device_info, session.os);
      // Добавляем 'Z' чтобы указать что время в UTC, затем конвертируем в локальное
      const lastActivity = new Date(session.last_activity + 'Z').toLocaleString("ru-RU");
      const createdAt = new Date(session.created_at + 'Z').toLocaleString("ru-RU");

      return `
        <div class="device-item ${isCurrentDevice ? 'current-device' : ''} ${isTrusted ? 'trusted-device' : ''}">
          <div class="device-info">
            <div class="device-name">
              ${deviceIcon} ${session.device_info || 'Неизвестное устройство'}
              ${isCurrentDevice ? '<span class="device-current-badge">Текущее устройство</span>' : ''}
              ${isTrusted ? '<span class="device-trusted-badge"><svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Доверенное</span>' : ''}
            </div>
            <div class="device-details">
              <div><svg class="icon" aria-hidden="true"><use href="#icon-globe"></use></svg> Браузер: ${session.browser || 'Неизвестно'}</div>
              <div><svg class="icon" aria-hidden="true"><use href="#icon-tools"></use></svg> ОС: ${session.os || 'Неизвестно'}</div>
              <div><svg class="icon" aria-hidden="true"><use href="#icon-world-cup"></use></svg> IP: ${session.ip_address || 'Неизвестно'}</div>
              <div><svg class="icon" aria-hidden="true"><use href="#icon-clock"></use></svg> Последняя активность: ${lastActivity}</div>
              <div><svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> Вход: ${createdAt}</div>
            </div>
          </div>
          <div class="device-actions">
            <button 
              class="device-trust-btn ${isTrusted ? 'trusted' : ''}" 
              onclick="toggleTrustedDevice('${session.session_token}', ${isTrusted})"
              title="${isTrusted ? 'Убрать из доверенных' : 'Добавить в доверенные'}"
            >
              ${isTrusted ? '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Доверенное' : '<svg class="icon" aria-hidden="true"><use href="#icon-hidden"></use></svg> Доверенное'}
            </button>
            <button 
              class="device-logout-btn" 
              onclick="logoutDevice('${session.session_token}')"
              ${isCurrentDevice ? 'disabled' : ''}
            >
              ${isCurrentDevice ? '<svg class="icon" aria-hidden="true"><use href="#icon-hidden"></use></svg> Текущее' : '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Выйти'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error("❌ Ошибка загрузки устройств:", error);
    document.getElementById("devicesList").innerHTML =
      '<div class="empty-message">Ошибка загрузки устройств</div>';
  }
}

// Получить иконку устройства
function getDeviceIcon(deviceInfo, os) {
  const device = (deviceInfo || '').toLowerCase();
  const osLower = (os || '').toLowerCase();

  if (device.includes('mobile') || device.includes('phone')) return '<svg class="icon" aria-hidden="true"><use href="#icon-telegram"></use></svg>';
  if (device.includes('tablet') || device.includes('ipad')) return '<svg class="icon" aria-hidden="true"><use href="#icon-telegram"></use></svg>';
  if (osLower.includes('android')) return '<svg class="icon" aria-hidden="true"><use href="#icon-telegram"></use></svg>';
  if (osLower.includes('ios')) return '<svg class="icon" aria-hidden="true"><use href="#icon-telegram"></use></svg>';
  if (osLower.includes('windows')) return '<svg class="icon" aria-hidden="true"><use href="#icon-tools"></use></svg>';
  if (osLower.includes('mac')) return '<svg class="icon" aria-hidden="true"><use href="#icon-tools"></use></svg>';
  if (osLower.includes('linux')) return '<svg class="icon" aria-hidden="true"><use href="#icon-tools"></use></svg>';

  return '<svg class="icon" aria-hidden="true"><use href="#icon-tools"></use></svg>️';
}

// ===== УПРАВЛЕНИЕ СЕССИЯМИ =====

// Выйти с устройства
export async function logoutDevice(sessionToken) {
  if (!state.currentUser) return;

  // Проверяем, привязан ли Telegram
  if (!state.currentUser.telegram_username) {
    await showCustomAlert('Для выхода с устройства необходимо привязать Telegram в настройках', 'Требуется Telegram', '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>️');
    return;
  }

  const shouldContinue = await showCustomConfirm(
    'Для завершения сеанса на этом устройстве требуется подтверждение. Вам будет отправлено сообщение в Telegram с кодом подтверждения.',
    'Подтверждение выхода',
    '<svg class="icon" aria-hidden="true"><use href="#icon-login"></use></svg>'
  );

  if (!shouldContinue) {
    return;
  }

  try {
    // Запрашиваем код подтверждения
    const response = await fetch(`/api/user/${state.currentUser.id}/sessions/${sessionToken}/request-logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await response.json();

    if (response.ok) {
      // Показываем поле для ввода кода
      const code = await showCustomPrompt(
        'Код подтверждения отправлен вам в Telegram. Введите его ниже:',
        'Введите код',
        '<svg class="icon" aria-hidden="true"><use href="#icon-login"></use></svg>',
        '123456'
      );

      if (!code) return;

      // Подтверждаем выход
      const confirmResponse = await fetch(`/api/user/${state.currentUser.id}/sessions/${sessionToken}/confirm-logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation_code: code })
      });

      const confirmResult = await confirmResponse.json();

      if (confirmResponse.ok) {
        await loadDevicesList();
      } else {
        await showCustomAlert(confirmResult.error, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      }
    } else {
      await showCustomAlert(result.error, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error("❌ Ошибка при выходе с устройства:", error);
    await showCustomAlert('Ошибка при выходе с устройства', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Переключить доверенное устройство
export async function toggleTrustedDevice(sessionToken, isTrusted) {
  if (!state.currentUser) return;

  // Проверяем, привязан ли Telegram
  if (!state.currentUser.telegram_username) {
    await showCustomAlert('Для управления доверенными устройствами необходимо привязать Telegram в настройках', 'Требуется Telegram', '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>️');
    return;
  }

  const action = isTrusted ? 'убрать из доверенных' : 'добавить в доверенные';

  const shouldContinue = await showCustomConfirm(
    `Для того чтобы ${action} это устройство, требуется подтверждение. Вам будет отправлено сообщение в Telegram с кодом подтверждения.`,
    isTrusted ? 'Убрать из доверенных' : 'Добавить в доверенные',
    isTrusted ? '<svg class="icon" aria-hidden="true"><use href="#icon-login"></use></svg>' : '<svg class="icon" aria-hidden="true"><use href="#icon-hidden"></use></svg>'
  );

  if (!shouldContinue) {
    return;
  }

  try {
    // Запрашиваем код подтверждения
    const response = await fetch(`/api/user/${state.currentUser.id}/sessions/${sessionToken}/request-trust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_trusted: !isTrusted })
    });

    const result = await response.json();

    if (response.ok) {
      // Показываем поле для ввода кода
      const code = await showCustomPrompt(
        'Код подтверждения отправлен вам в Telegram. Введите его ниже:',
        'Введите код',
        '<svg class="icon" aria-hidden="true"><use href="#icon-login"></use></svg>',
        '123456'
      );

      if (!code) return;

      // Подтверждаем изменение
      const confirmResponse = await fetch(`/api/user/${state.currentUser.id}/sessions/${sessionToken}/confirm-trust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation_code: code,
          is_trusted: !isTrusted
        })
      });

      const confirmResult = await confirmResponse.json();

      if (confirmResponse.ok) {
        await loadDevicesList();
        await showCustomAlert(
          `Устройство успешно ${isTrusted ? 'убрано из доверенных' : 'добавлено в доверенные'}`,
          'Успешно',
          '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
        );
      } else {
        await showCustomAlert(confirmResult.error, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      }
    } else {
      await showCustomAlert(result.error, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error("❌ Ошибка при изменении статуса доверенного устройства:", error);
    await showCustomAlert('Ошибка при изменении статуса доверенного устройства', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}
