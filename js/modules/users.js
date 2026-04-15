// ========== МОДУЛЬ USERS ==========
// Управление пользователями (уведомления)

import { currentUser } from './state.js';
import { showCustomAlert, showCustomConfirm } from './ui.js';

// Открыть модальное окно управления уведомлениями
export async function openNotificationsModal() {
  let usersListHTML = '<div style="color:#999;text-align:center;padding:10px;">Загрузка...</div>';

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;';

  modal.innerHTML = `
    <div style="background:#1e2a3a;padding:30px;border-radius:12px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 20px 0;color:#5a9fd4;">✅ Управление уведомлениями</h3>
      <div id="usersListContainer" style="margin-bottom:20px;padding:15px;background:#2a3a4a;border-radius:8px;max-height:400px;overflow-y:auto;">${usersListHTML}</div>
      <div style="display:flex;gap:10px;">
        <button onclick="enableNotificationsForAll()" style="flex:1;background:#4caf50;color:white;border:none;padding:12px;border-radius:8px;cursor:pointer;font-size:16px;">✅ Включить для всех</button>
        <button onclick="this.closest('div[style*=fixed]').remove()" style="flex:1;background:#f44336;color:white;border:none;padding:12px;border-radius:8px;cursor:pointer;font-size:16px;">Закрыть</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  try {
    const response = await fetch('/api/users');
    if (response.ok) {
      const users = await response.json();

      usersListHTML = users.map(user => {
        const notifStatus = user.telegram_notifications_enabled ? '✅ Вкл' : '❌ Выкл';
        const telegramStatus = user.telegram_username ? '@' + user.telegram_username : '❌ Нет TG';

        return `
          <div style="padding:12px;margin-bottom:8px;background:#1e2a3a;border-radius:6px;cursor:pointer;transition:background 0.2s;"
            onmouseover="this.style.background='#2a3a4a'"
            onmouseout="this.style.background='#1e2a3a'"
            onclick="showUserDetails(${user.id},'${user.username.replace(/'/g, "\\'")}','${user.telegram_username || ''}',${user.telegram_notifications_enabled})">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="color:#e0e6f0;font-weight:bold;margin-bottom:4px;">${user.username}</div>
                <div style="color:#999;font-size:0.85em;">${telegramStatus}</div>
              </div>
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="color:#5a9fd4;font-weight:bold;">ID: ${user.id}</span>
                <span style="font-size:0.9em;">${notifStatus}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');

      if (users.length === 0) {
        usersListHTML = '<div style="color:#999;text-align:center;padding:10px;">Нет пользователей</div>';
      }

      document.getElementById('usersListContainer').innerHTML = usersListHTML;
    }
  } catch (error) {
    console.error('Ошибка загрузки пользователей:', error);
    document.getElementById('usersListContainer').innerHTML = '<div style="color:#f44336;text-align:center;padding:10px;">Ошибка загрузки</div>';
  }
}

// Показать детали пользователя
export async function showUserDetails(userId, username, telegramUsername, notificationsEnabled) {
  try {
    const response = await fetch('/api/admin/user-details/' + userId);
    if (!response.ok) throw new Error('HTTP error! status: ' + response.status);

    const data = await response.json();

    const telegramInfo = data.telegramUser
      ? '<div style="color:#4caf50;margin-top:10px;">✅ <strong>Telegram привязка:</strong><br/>Chat ID: ' + data.telegramUser.chat_id + '<br/>Имя: ' + data.telegramUser.first_name + '</div>'
      : '<div style="color:#ff9800;margin-top:10px;">⚠️ Нет записи в telegram_users</div>';

    const notifStatusText = notificationsEnabled ? '✅ Включены' : '❌ Отключены';

    const detailsModal = document.createElement('div');
    detailsModal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10001;';

    detailsModal.innerHTML = `
      <div style="background:#1e2a3a;padding:30px;border-radius:12px;max-width:500px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
        <h3 style="margin:0 0 20px 0;color:#5a9fd4;">✅ ${username}</h3>
        <div style="padding:15px;background:#2a3a4a;border-radius:8px;margin-bottom:20px;color:#e0e6f0;line-height:1.8;">
          <div><strong>ID:</strong> ${userId}</div>
          <div><strong>Username:</strong> ${username}</div>
          <div><strong>Telegram:</strong> ${telegramUsername || 'не привязан'}</div>
          <div><strong>Уведомления:</strong> ${notifStatusText}</div>
          ${telegramInfo}
        </div>
        <div style="display:flex;gap:10px;">
          ${!notificationsEnabled ? `
            <button onclick="toggleUserNotifications(${userId}, true)" style="flex:1;background:#4caf50;color:white;border:none;padding:12px;border-radius:8px;cursor:pointer;font-size:16px;">✅ Включить уведомления</button>
          ` : `
            <button onclick="toggleUserNotifications(${userId}, false)" style="flex:1;background:#ff9800;color:white;border:none;padding:12px;border-radius:8px;cursor:pointer;font-size:16px;">❌ Отключить уведомления</button>
          `}
          <button onclick="this.closest('div[style*=fixed]').remove()" style="flex:1;background:#f44336;color:white;border:none;padding:12px;border-radius:8px;cursor:pointer;font-size:16px;">Закрыть</button>
        </div>
      </div>
    `;

    document.body.appendChild(detailsModal);
  } catch (error) {
    console.error('Ошибка загрузки деталей пользователя:', error);
    await showCustomAlert('Ошибка загрузки деталей пользователя', 'Ошибка', '❌');
  }
}

// Переключить уведомления для пользователя
export async function toggleUserNotifications(userId, enable) {
  try {
    const response = await fetch('/api/admin/run-utility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script: 'enable-notifications',
        username: currentUser?.username,
        args: [userId, enable ? '1' : '0']
      })
    });

    if (!response.ok) throw new Error('HTTP error! status: ' + response.status);

    const data = await response.json();

    if (data.success) {
      const modals = document.querySelectorAll('div[style*="z-index: 10001"], div[style*="z-index: 10000"]');
      modals.forEach(m => m.remove());
      openNotificationsModal();
    } else {
      await showCustomAlert(data.error, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await showCustomAlert('Ошибка при изменении настроек', 'Ошибка', '❌');
  }
}

// Включить уведомления для всех пользователей
export async function enableNotificationsForAll() {
  const confirmed = await showCustomConfirm(
    'Включить уведомления для всех пользователей с привязанным Telegram?',
    'Подтверждение', '✅'
  );

  if (!confirmed) return;

  try {
    const response = await fetch('/api/admin/run-utility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script: 'enable-notifications-for-all',
        username: currentUser?.username,
        args: []
      })
    });

    if (!response.ok) throw new Error('HTTP error! status: ' + response.status);

    const data = await response.json();

    if (data.success) {
      await showCustomAlert(data.output, data.title, '✅');
      document.querySelector('div[style*="z-index: 10000"]').remove();
      openNotificationsModal();
    } else {
      await showCustomAlert(data.error, 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await showCustomAlert('Ошибка при включении уведомлений', 'Ошибка', '❌');
  }
}
