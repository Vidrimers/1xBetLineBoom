// ========== МОДУЛЬ ADMIN USERS ==========
// Управление пользователями, синхронизация Telegram, тест уведомлений

import { currentUser, ADMIN_DB_NAME } from './state.js';
import { showCustomAlert, showCustomConfirm, showCustomPrompt, unlockBodyScroll } from './ui.js';
import { showBannedNameAlert } from './bannedNames.js';
import {
  isAdmin,
  hasModeratorPermission,
  canViewUsers,
  canEditUsers,
  canDeleteUsers,
  canCheckBot,
  canViewSettings,
} from './admin.js';

// Локальный список пользователей
let adminUsers = [];

// Отобразить список пользователей в модальном окне
function displayAdminUsersModal() {
  const adminUsersList = document.getElementById("adminUsersList");

  if (adminUsers.length === 0) {
    adminUsersList.innerHTML =
      '<div class="empty-message">Пользователей не найдено</div>';
    return;
  }

  adminUsersList.innerHTML = adminUsers
    .map(
      (user) => `
    <div class="admin-user-item">
      <div class="admin-user-info">
        <div class="admin-user-name">${user.username}</div>
        <div class="admin-user-stats">
          Регистрация: ${
            user.created_at
              ? new Date(user.created_at).toLocaleDateString("ru-RU")
              : "неизвестно"
          }
        </div>
      </div>
      <div class="admin-user-actions">
        ${canCheckBot() ? `
        <button class="admin-btn admin-btn-bot-check" onclick="checkUserBotContact(${
          user.id
        }, '${user.username}')" title="Проверка писал ли пользователь боту"><svg class="icon" aria-hidden="true"><use href="#icon-bot"></use></svg></button>
        ` : ''}
        ${canViewSettings() ? `
        <button class="admin-btn admin-btn-settings" onclick="sendUserSettingsToAdmin(${
          user.id
        }, '${user.username}')" title="Получить настройки пользователя в ТГ"><svg class="icon" aria-hidden="true"><use href="#icon-settings"></use></svg></button>
        ` : ''}
        ${canEditUsers() && (isAdmin() || user.username !== ADMIN_DB_NAME) ? `
        <button class="admin-btn admin-btn-rename" onclick="renameUser(${
          user.id
        }, '${user.username}')" title="Переименовать пользователя"><svg class="icon" aria-hidden="true"><use href="#icon-edit"></use></svg></button>
        ` : ''}
        ${canDeleteUsers() && user.username !== ADMIN_DB_NAME ? `
        <button class="admin-btn admin-btn-delete" onclick="deleteUser(${
          user.id
        }, '${user.username}')" title="Удалить пользователя"><svg class="icon" aria-hidden="true"><use href="#icon-delete"></use></svg></button>
        ` : ''}
      </div>
    </div>
  `
    )
    .join("");
}

// Загрузить список всех пользователей
export async function loadAdminUsers() {
  if (!canViewUsers()) {
    await showCustomAlert("У вас нет прав для просмотра пользователей", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  try {
    const response = await fetch(
      `/api/admin/users?username=${currentUser.username}`
    );
    adminUsers = await response.json();
    displayAdminUsersModal();

    // Показываем/скрываем кнопку синхронизации в зависимости от прав
    const syncBtn = document.getElementById('syncTelegramIdsBtn');
    if (syncBtn) {
      if (isAdmin() || hasModeratorPermission('sync_telegram_ids')) {
        syncBtn.style.display = 'inline-block';
      } else {
        syncBtn.style.display = 'none';
      }
    }

    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    document.getElementById("adminModal").style.display = "flex";
  } catch (error) {
    console.error("Ошибка при загрузке пользователей:", error);
    await showCustomAlert("Ошибка при загрузке пользователей", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Закрыть модальное окно
export function closeAdminModal() {
  document.getElementById("adminModal").style.display = "none";
  // Разблокируем скролл body
  document.body.style.overflow = '';
  unlockBodyScroll();
}

// Синхронизировать telegram_id для всех пользователей
export async function syncAllTelegramIds() {
  if (!isAdmin() && !hasModeratorPermission('sync_telegram_ids')) {
    await showCustomAlert("У вас нет прав", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const shouldContinue = await showCustomConfirm(
    'Эта операция обновит telegram_id (chat_id) для всех пользователей с привязанным Telegram. Продолжить?',
    'Синхронизация Telegram ID',
    '<svg class="icon" aria-hidden="true"><use href="#icon-bot"></use></svg>'
  );

  if (!shouldContinue) {
    return;
  }

  try {
    const response = await fetch('/api/admin/sync-telegram-ids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username })
    });

    const result = await response.json();

    if (!response.ok) {
      await showCustomAlert(result.error, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      return;
    }

    let message = `
      <div style="text-align: left; line-height: 1.8;">
        <div style="margin-bottom: 15px; font-size: 16px; font-weight: bold; color: #4caf50;">
          <svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Синхронизация завершена успешно!
        </div>
        
        <div style="margin-bottom: 10px; font-size: 15px; font-weight: bold; color: #fff;">
          <svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Общая статистика:
        </div>
        <div style="border-top: 1px solid rgba(255,255,255,0.2); margin-bottom: 10px;"></div>
        
        <div style="margin-bottom: 8px;"><svg class="icon" aria-hidden="true"><use href="#icon-participants"></use></svg> Всего пользователей с Telegram: <strong>${result.total}</strong></div>
        <div style="margin-bottom: 8px; color: #4caf50;"><svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Обновлено telegram_id: <strong>${result.updated}</strong></div>
        <div style="margin-bottom: 8px; color: #2196f3;"><svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Уже были актуальны: <strong>${result.skipped}</strong></div>
        <div style="margin-bottom: 15px; color: #ff9800;"><svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg> Не найдены в telegram_users: <strong>${result.not_found}</strong></div>
    `;

    if (result.updated > 0) {
      message += `
        <div style="background: rgba(76, 175, 80, 0.1); padding: 12px; border-radius: 6px; margin-bottom: 15px; border-left: 3px solid #4caf50;">
          <div style="font-weight: bold; margin-bottom: 5px; color: #4caf50;"><svg class="icon" aria-hidden="true"><use href="#icon-hint"></use></svg> Что это значит:</div>
          <div style="font-size: 14px;">
            Для ${result.updated} пользовател${result.updated === 1 ? 'я' : 'ей'} был найден и сохранен chat_id из таблицы telegram_users.<br>
            Теперь они смогут получать коды подтверждения через бота.
          </div>
        </div>
      `;
    }

    if (result.not_found > 0) {
      message += `
        <div style="background: rgba(255, 152, 0, 0.1); padding: 12px; border-radius: 6px; margin-bottom: 15px; border-left: 3px solid #ff9800;">
          <div style="font-weight: bold; margin-bottom: 5px; color: #ff9800;"><svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg> Внимание:</div>
          <div style="font-size: 14px;">
            ${result.not_found} пользовател${result.not_found === 1 ? 'ь' : 'ей'} не найден${result.not_found === 1 ? '' : 'ы'} в telegram_users.<br>
            Это значит, что они:<br>
            <div style="margin-left: 15px; margin-top: 5px; margin-bottom: 10px;">
              • Привязали Telegram username в настройках<br>
              • Но НЕ писали боту /start в личку<br>
              • Не смогут получать коды подтверждения
            </div>
      `;

      if (result.not_found_users && result.not_found_users.length > 0) {
        message += `
          <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255, 152, 0, 0.3);">
            <div style="font-weight: bold; margin-bottom: 8px; color: #ff9800;">Список пользователей:</div>
        `;

        result.not_found_users.forEach(user => {
          message += `
            <div style="background: rgba(0, 0, 0, 0.2); padding: 8px; border-radius: 4px; margin-bottom: 6px;">
              <div style="font-weight: bold;"><svg class="icon" aria-hidden="true"><use href="#icon-profile"></use></svg> ${user.username}</div>
              <div style="font-size: 13px; color: #aaa; margin-left: 20px;">
                <svg class="icon" aria-hidden="true"><use href="#icon-telegram"></use></svg> @${user.telegram_username}
              </div>
            </div>
          `;
        });

        message += `</div>`;
      }

      message += `
          </div>
        </div>
      `;
    }

    if (result.details && result.details.length > 0) {
      message += `
        <div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 15px 0 10px 0;"></div>
        <div style="font-weight: bold; margin-bottom: 10px; color: #fff;"><svg class="icon" aria-hidden="true"><use href="#icon-manual"></use></svg> Обновленные пользователи:</div>
      `;

      result.details.forEach(detail => {
        message += `
          <div style="background: rgba(255, 255, 255, 0.05); padding: 10px; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid #2196f3;">
            <div style="font-weight: bold; margin-bottom: 3px;"><svg class="icon" aria-hidden="true"><use href="#icon-profile"></use></svg> ${detail.username}</div>
            <div style="font-size: 13px; color: #aaa; margin-left: 20px;">
              <svg class="icon" aria-hidden="true"><use href="#icon-telegram"></use></svg> @${detail.telegram_username}<br>
              <svg class="icon" aria-hidden="true"><use href="#icon-group"></use></svg> Chat ID: ${detail.telegram_id}
            </div>
          </div>
        `;
      });
    }

    if (result.without_telegram > 0 && result.without_telegram_users) {
      message += `
        <div style="border-top: 1px solid rgba(255,255,255,0.2); margin: 15px 0 10px 0;"></div>
        <div style="background: rgba(244, 67, 54, 0.1); padding: 12px; border-radius: 6px; margin-bottom: 15px; border-left: 3px solid #f44336;">
          <div style="font-weight: bold; margin-bottom: 5px; color: #f44336;"><svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Без Telegram:</div>
          <div style="font-size: 14px; margin-bottom: 10px;">
            ${result.without_telegram} пользовател${result.without_telegram === 1 ? 'ь' : 'ей'} не привязал${result.without_telegram === 1 ? '' : 'и'} Telegram.<br>
            Они не смогут использовать функции с подтверждением через бота.
          </div>
          <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(244, 67, 54, 0.3);">
            <div style="font-weight: bold; margin-bottom: 8px; color: #f44336;">Список пользователей:</div>
      `;

      result.without_telegram_users.forEach(user => {
        message += `
          <div style="background: rgba(0, 0, 0, 0.2); padding: 8px; border-radius: 4px; margin-bottom: 6px;">
            <div style="font-weight: bold;"><svg class="icon" aria-hidden="true"><use href="#icon-profile"></use></svg> ${user.username}</div>
            <div style="font-size: 13px; color: #aaa; margin-left: 20px;">
              <svg class="icon" aria-hidden="true"><use href="#icon-telegram"></use></svg> Telegram не привязан
            </div>
          </div>
        `;
      });

      message += `
          </div>
        </div>
      `;
    }

    if (result.updated === 0 && result.not_found === 0 && result.without_telegram === 0) {
      message += `
        <div style="background: rgba(76, 175, 80, 0.1); padding: 12px; border-radius: 6px; border-left: 3px solid #4caf50;">
          <div style="font-size: 14px; color: #4caf50;">
            <svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Все пользователи уже имеют актуальный telegram_id.<br>
            Дополнительных действий не требуется.
          </div>
        </div>
      `;
    }

    message += `</div>`;

    await showCustomAlert(message, 'Синхронизация завершена', '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');

    // Перезагружаем список пользователей
    await loadAdminUsers();
  } catch (error) {
    console.error("Ошибка при синхронизации:", error);
    await showCustomAlert('Ошибка при синхронизации telegram_id', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Тест уведомлений в группу
export async function testGroupNotification() {
  if (!isAdmin()) {
    await showCustomAlert("У вас нет прав", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const testRealGroup = document.getElementById('testRealGroupCheckbox')?.checked || false;

  try {
    const response = await fetch("/api/admin/test-group-notification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser.username,
        testMode: !testRealGroup // Если чекбокс выключен - тестовый режим (только админу)
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert("Ошибка: " + result.error);
      return;
    }

    await showCustomAlert(
      testRealGroup
        ? 'Тестовое уведомление отправлено в группу'
        : 'Тестовое уведомление отправлено только админу',
      'Успешно',
      '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
    );
    console.log(`✅ Тестовое уведомление отправлено ${testRealGroup ? 'в группу' : 'админу'}`);
  } catch (error) {
    console.error("Ошибка при отправке тестового уведомления:", error);
    await showCustomAlert("Ошибка при отправке уведомления", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// ===== ФУНКЦИИ УПРАВЛЕНИЯ ПОЛЬЗОВАТЕЛЯМИ =====

export async function renameUser(userId, currentUsername) {
  if (!canEditUsers()) { await showCustomAlert('У вас нет прав', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'); return; }
  if (currentUsername === ADMIN_DB_NAME && !isAdmin()) {
    await showCustomAlert('Модератор не может переименовать администратора!', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const newUsername = await showCustomPrompt(`Новое имя для ${currentUsername}:`, 'Переименование', '<svg class="icon" aria-hidden="true"><use href="#icon-edit"></use></svg>');
  if (!newUsername || newUsername.trim() === '') return;

  try {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username, newUsername: newUsername.trim() }),
    });
    const result = await response.json();
    if (!response.ok) {
      // Обработка запретного имени
      if (result.error === 'BANNED_NAME') {
        const { newName } = await showBannedNameAlert(result.reason || 'Это имя запрещено к использованию на сайте');
        if (newName) {
          // Рекурсивно пробуем с новым именем
          const retryResponse = await fetch(`/api/admin/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser.username, newUsername: newName.trim() }),
          });
          const retryResult = await retryResponse.json();
          if (!retryResponse.ok) {
            await showCustomAlert('Ошибка: ' + (retryResult.reason || retryResult.error), 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
            return;
          }
          await showCustomAlert(retryResult.message, 'Успех', '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');
          loadAdminUsers();
        }
        return;
      }
      await showCustomAlert('Ошибка: ' + result.error, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      return;
    }
    await showCustomAlert(result.message, 'Успех', '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');
    loadAdminUsers();
  } catch (e) {
    console.error('Ошибка при переименовании:', e);
    await showCustomAlert('Ошибка при переименовании пользователя', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

export async function deleteUser(userId, username) {
  if (!canDeleteUsers()) { await showCustomAlert('У вас нет прав', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'); return; }
  if (username === ADMIN_DB_NAME) { await showCustomAlert('Нельзя удалить администратора!', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'); return; }

  const confirmed = await showCustomConfirm(
    `Вы уверены, что хотите удалить пользователя "${username}"?\nВсе его ставки будут удалены!`,
    'Удаление пользователя',
    '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'
  );
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username }),
    });
    const result = await response.json();
    if (!response.ok) { await showCustomAlert('Ошибка: ' + result.error, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'); return; }
    loadAdminUsers();
  } catch (e) {
    console.error('Ошибка при удалении:', e);
    await showCustomAlert('Ошибка при удалении пользователя', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

export async function checkUserBotContact(userId, username) {
  if (!canCheckBot()) { await showCustomAlert('У вас нет прав', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'); return; }

  try {
    const response = await fetch(`/api/admin/users/${userId}/bot-contact-check?username=${currentUser.username}`);
    const result = await response.json();
    if (!response.ok) { await showCustomAlert(result.error, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'); return; }

    let message = `<div style="text-align:left;line-height:1.8;"><div style="margin-bottom:15px;font-size:16px;font-weight:bold;">👤 Пользователь: ${username}</div>`;

    if (result.telegram_username) {
      message += `<div style="margin-bottom:15px;padding:10px;background:rgba(255,255,255,0.05);border-radius:6px;"><div>📱 Telegram: <strong>@${result.telegram_username}</strong></div></div>`;
      if (result.has_bot_contact) {
        message += `<div style="background:rgba(76,175,80,0.1);padding:12px;border-radius:6px;border-left:3px solid #4caf50;"><div style="font-weight:bold;color:#4caf50;">✅ Писал боту в личку</div><div style="font-size:14px;">💬 Chat ID: <strong>${result.telegram_id}</strong><br>🔐 2FA: <strong>${result.require_login_2fa ? 'Включено' : 'Отключено'}</strong></div></div>`;
      } else {
        message += `<div style="background:rgba(244,67,54,0.1);padding:12px;border-radius:6px;border-left:3px solid #f44336;"><div style="font-weight:bold;color:#f44336;">❌ НЕ писал боту в личку</div><div style="font-size:14px;margin-top:8px;">💡 Нужно написать боту <strong>@OnexBetLineBoomBot</strong> команду <code>/start</code></div></div>`;
      }
    } else {
      message += `<div style="background:rgba(244,67,54,0.1);padding:12px;border-radius:6px;border-left:3px solid #f44336;"><div style="font-weight:bold;color:#f44336;">❌ Telegram не привязан</div></div>`;
    }

    message += '</div>';
    await showCustomAlert(message, 'Проверка контакта с ботом', '🤖');
  } catch (e) {
    console.error('Ошибка:', e);
    await showCustomAlert('Ошибка при проверке контакта с ботом', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

export async function sendUserSettingsToAdmin(userId, username) {
  if (!canViewSettings()) { await showCustomAlert('У вас нет прав', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'); return; }

  try {
    const response = await fetch(`/api/admin/user-settings/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username }),
    });
    const result = await response.json();
    if (!response.ok) { await showCustomAlert('Ошибка: ' + result.error, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'); }
  } catch (e) {
    console.error('Ошибка при отправке настроек:', e);
    await showCustomAlert('Ошибка при отправке настроек', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}
