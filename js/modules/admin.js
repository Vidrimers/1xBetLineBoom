// ========== МОДУЛЬ ADMIN ==========
// Права доступа, управление БД, orphaned данные

import { currentUser } from './state.js';
import { showCustomAlert, showCustomConfirm } from './ui.js';

// ===== ПРОВЕРКА ПРАВ =====

export function isAdmin() {
  return currentUser && currentUser.isAdmin === true;
}

// Загрузить права модератора для текущего пользователя
export async function loadModeratorPermissions() {
  if (!currentUser) {
    console.log("❌ currentUser не определен");
    return;
  }

  if (currentUser.isAdmin) {
    currentUser.isModerator = false;
    currentUser.moderatorPermissions = [];
    console.log("👑 Пользователь - админ, права модератора не нужны");
    return;
  }

  try {
    console.log("📡 Запрос списка модераторов...");
    const response = await fetch("/api/moderators");
    const moderators = await response.json();

    console.log("📋 Получено модераторов:", moderators);
    console.log("🔎 Ищем модератора с user_id:", currentUser.id);

    const moderator = moderators.find(mod => mod.user_id === currentUser.id);

    if (moderator) {
      currentUser.isModerator = true;
      currentUser.moderatorPermissions = moderator.permissions || [];
      console.log("✅ Права модератора загружены:", currentUser.moderatorPermissions);
      console.log("👤 currentUser после загрузки:", currentUser);
    } else {
      currentUser.isModerator = false;
      currentUser.moderatorPermissions = [];
      console.log("ℹ Пользователь не является модератором");
    }
  } catch (error) {
    console.error("❌ Ошибка загрузки прав модератора:", error);
    currentUser.isModerator = false;
    currentUser.moderatorPermissions = [];
  }
}

export function isModerator() {
  return currentUser && currentUser.isModerator === true;
}

export function hasModeratorPermission(permission) {
  if (!currentUser) return false;
  if (currentUser.isAdmin) return true;
  if (!currentUser.isModerator) return false;
  return currentUser.moderatorPermissions && currentUser.moderatorPermissions.includes(permission);
}

export function hasPermission(permission) {
  if (isAdmin()) return true;
  if (!isModerator()) return false;
  return currentUser.moderatorPermissions.includes(permission);
}

export function canManageMatches() {
  return hasPermission('manage_matches');
}

export function canCreateMatches() {
  return hasPermission('create_matches');
}

export function canEditMatches() {
  return hasPermission('edit_matches');
}

export function canDeleteMatches() {
  return hasPermission('delete_matches');
}

export function canManageResults() {
  return hasPermission('manage_results');
}

export function canManageTournaments() {
  return hasPermission('manage_tournaments');
}

export function canEditTournaments() {
  return hasPermission('edit_tournaments');
}

export function canDeleteTournaments() {
  return hasPermission('delete_tournaments');
}

export function canCreateTournaments() {
  return hasPermission('create_tournaments');
}

export function canViewLogs() {
  return hasPermission('view_logs');
}

export function canViewCounting() {
  return hasPermission('view_counting');
}

export function canBackupDB() {
  return hasPermission('backup_db');
}

export function canDownloadBackup() {
  return hasPermission('download_backup');
}

export function canRestoreDB() {
  return hasPermission('restore_db');
}

export function canDeleteBackup() {
  return hasPermission('delete_backup');
}

export function canAccessDatabasePanel() {
  return canBackupDB() || canDownloadBackup() || canRestoreDB() || canDeleteBackup();
}

export function canManageOrphaned() {
  return hasPermission('manage_orphaned');
}

export function canViewUsers() {
  return hasPermission('view_users');
}

export function canEditUsers() {
  return hasPermission('edit_users');
}

export function canDeleteUsers() {
  return hasPermission('delete_users');
}

export function canCheckBot() {
  return isAdmin() || hasPermission('check_bot');
}

export function canViewSettings() {
  return isAdmin() || hasPermission('view_settings');
}

export function hasAdminPanelAccess() {
  if (isAdmin()) return true;
  if (!isModerator()) return false;
  const adminPanelPerms = ['view_logs', 'backup_db', 'download_backup', 'restore_db', 'delete_backup', 'manage_orphaned', 'view_users'];
  return currentUser.moderatorPermissions.some(perm => adminPanelPerms.includes(perm));
}

export function isAdminOrModerator() {
  return isAdmin() || isModerator();
}

// ===== УПРАВЛЕНИЕ БД =====

// Переменные состояния
export let selectedBackupFilename = null;
export let lastCreatedBackupFilename = null;
export let selectedBackupIsProtected = false;

export function setSelectedBackupFilename(val) { selectedBackupFilename = val; }
export function setLastCreatedBackupFilename(val) { lastCreatedBackupFilename = val; }
export function setSelectedBackupIsProtected(val) { selectedBackupIsProtected = val; }

// Функция для создания бэкапа базы данных
export async function backupDatabase() {
  if (!canBackupDB()) {
    await showCustomAlert("У вас нет прав для создания бэкапа БД", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  try {
    const backupBtn = document.querySelector('[onclick="backupDatabase()"]');
    if (backupBtn) {
      backupBtn.textContent = "⏳ Создание бэкапа...";
      backupBtn.disabled = true;
    }

    const response = await fetch("/api/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: currentUser.username })
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && data.filename) {
      lastCreatedBackupFilename = data.filename;
      const databaseModal = document.getElementById("databaseModal");
      if (databaseModal && databaseModal.style.display === "flex") {
        await openDatabaseModal();
      }
    } else {
      await showCustomAlert(data.error || "Неизвестная ошибка", "Ошибка при создании бэкапа", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error("Ошибка при создании бэкапа:", error);
    await showCustomAlert(error.message, "Ошибка при создании бэкапа БД", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  } finally {
    const backupBtn = document.querySelector('[onclick="backupDatabase()"]');
    if (backupBtn) {
      backupBtn.textContent = '<svg class="icon" aria-hidden="true"><use href="#icon-create"></use></svg>' + ' Создать бэкап';
      backupBtn.disabled = false;
    }
  }
}

// Открыть модальное окно восстановления БД
export async function openRestoreDBModal() {
  if (!isAdmin() && !hasModeratorPermission('restore_db')) {
    await showCustomAlert("У вас нет прав для восстановления БД", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  try {
    const response = await fetch("/api/admin/backups");
    const backups = await response.json();

    const backupsList = document.getElementById("backupsList");

    if (backups.length === 0) {
      backupsList.innerHTML = '<div class="empty-message">Нет доступных бэкапов</div>';
    } else {
      backupsList.innerHTML = backups.map(backup => `
        <div style="padding:15px;margin-bottom:10px;background:rgba(30,34,44,0.6);border:1px solid rgba(90,159,212,0.3);border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:bold;color:#5a9fd4;margin-bottom:5px;">${backup.filename}</div>
            <div style="font-size:0.9em;color:#999;"><svg class="icon" aria-hidden="true"><use href="#icon-clock"></use></svg> ${new Date(backup.created).toLocaleString('ru-RU')} | <svg class="icon" aria-hidden="true"><use href="#icon-backup"></use></svg> ${backup.sizeFormatted}</div>
          </div>
          <button onclick="restoreBackup('${backup.filename}')" style="background:rgba(255,152,0,0.7);color:#fff;border:1px solid #ff9800;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:0.9em;transition:all 0.3s ease;" onmouseover="this.style.background='rgba(255,152,0,1)'" onmouseout="this.style.background='rgba(255,152,0,0.7)'"><svg class="icon" aria-label="Обновить"><use href="#icon-refresh"></use></svg> Восстановить</button>
        </div>
      `).join('');
    }

    document.getElementById("restoreDBModal").style.display = "flex";
  } catch (error) {
    console.error("Ошибка при загрузке списка бэкапов:", error);
    await showCustomAlert("Ошибка при загрузке списка бэкапов", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Закрыть модальное окно восстановления БД
export function closeRestoreDBModal() {
  document.getElementById("restoreDBModal").style.display = "none";
}

// Открыть модальное окно управления БД
export async function openDatabaseModal() {
  if (!canAccessDatabasePanel() && !isAdmin()) {
    await showCustomAlert("У вас нет прав для управления БД", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  if (currentUser && !isAdmin()) {
    try {
      await fetch('/api/admin/notify-database-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, userId: currentUser.id })
      });
    } catch (error) {
      console.error('⚠ Не удалось отправить уведомление о доступе к БД:', error);
    }
  }

  document.body.style.overflow = 'hidden';
  selectedBackupFilename = null;
  updateBackupButtons();

  try {
    const response = await fetch("/api/admin/backups");
    const backups = await response.json();

    const backupsList = document.getElementById("databaseBackupsList");
    const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
    const totalSizeFormatted = (totalSize / 1024 / 1024).toFixed(2) + ' MB';

    if (backups.length === 0) {
      backupsList.innerHTML = '<div class="empty-message">Нет доступных бэкапов</div>';
      document.getElementById("backupsListHeader").innerHTML = `<h3 style="color:#5a9fd4;margin:0;"><svg class="icon" aria-hidden="true"><use href="#icon-backup"></use></svg> Доступные бэкапы (выберите один):</h3>`;
    } else {
      document.getElementById("backupsListHeader").innerHTML = `
        <h3 style="color:#5a9fd4;margin:0;"><svg class="icon" aria-hidden="true"><use href="#icon-backup"></use></svg> Доступные бэкапы (выберите один):</h3>
        <div style="color:#999;font-size:0.9em;">Всего: <strong style="color:#5a9fd4;">${backups.length}</strong> | Общий размер: <strong style="color:#5a9fd4;">${totalSizeFormatted}</strong></div>
      `;

      backupsList.innerHTML = backups.map((backup) => {
        const isNew = backup.filename === lastCreatedBackupFilename;
        const isLocked = backup.isLocked || false;
        return `
        <div class="backup-item${isNew ? ' new-backup' : ''}" data-filename="${backup.filename}" data-locked="${isLocked}"
          onclick="selectBackup('${backup.filename}', ${isLocked})"
          style="padding:15px;margin-bottom:10px;background:rgba(30,34,44,0.6);border:2px solid ${isNew ? 'rgba(76,175,80,0.6)' : 'rgba(90,159,212,0.3)'};border-radius:8px;cursor:pointer;transition:all 0.3s ease;position:relative;"
          onmouseover="if(!this.classList.contains('selected')) this.style.borderColor='${isNew ? 'rgba(76,175,80,0.8)' : 'rgba(90,159,212,0.6)'}'"
          onmouseout="if(!this.classList.contains('selected')) this.style.borderColor='${isNew ? 'rgba(76,175,80,0.6)' : 'rgba(90,159,212,0.3)'}'">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;">
            <div style="flex:1;">
              ${isNew ? '<div style="position:absolute;top:10px;right:10px;background:rgba(76,175,80,0.9);color:#fff;padding:4px 12px;border-radius:12px;font-size:0.75em;font-weight:bold;animation:pulse 2s infinite;">NEW</div>' : ''}
              <div style="font-weight:bold;color:${isNew ? '#4caf50' : '#5a9fd4'};margin-bottom:5px;">${backup.filename}</div>
              <div style="font-size:0.9em;color:#999;"><svg class="icon" aria-hidden="true"><use href="#icon-clock"></use></svg> ${new Date(backup.created).toLocaleString('ru-RU')} | <svg class="icon" aria-hidden="true"><use href="#icon-backup"></use></svg> ${backup.sizeFormatted}</div>
              ${backup.createdBy !== 'unknown' ? `<div style="font-size:0.85em;color:#888;margin-top:3px;"><svg class="icon" aria-hidden="true"><use href="#icon-profile"></use></svg> ${backup.createdBy}</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;position:relative;">
              ${isLocked ? '<div style="background:rgba(255,193,7,0.2);color:#ffc107;padding:3px 8px;border-radius:6px;font-size:0.75em;white-space:nowrap;"><svg class="icon" aria-hidden="true"><use href="#icon-hidden"></use></svg> Заблокирован</div>' : ''}
              ${isAdmin() ? `<button class="backup-lock-btn" onclick="event.stopPropagation(); toggleBackupLock('${backup.filename}', ${isLocked})" style="background:${isLocked ? 'rgba(76,175,80,0.7)' : 'transparent'};color:${isLocked ? '#fff' : 'rgb(255,255,255)'};border:${isLocked ? '1px solid #4caf50' : 'medium'};padding:4px 10px;border-radius:6px;cursor:pointer;font-size:${isLocked ? '0.7em' : '0.75em'};transition:${isLocked ? 'all 0.3s ease' : '0.3s'};white-space:nowrap;opacity:0;box-shadow:none;pointer-events:none;position:absolute;right:0;bottom:0;" title="${isLocked ? 'Разблокировать бэкап' : 'Заблокировать бэкап'}">${isLocked ? '<svg class="icon" aria-label="Вход"><use href="#icon-login"></use></svg> Разблокировать' : '<svg class="icon" aria-label="Иконка"><use href="#icon-hidden"></use></svg>'}</button>` : ''}
            </div>
          </div>
        </div>`;
      }).join('');
    }

    document.getElementById("databaseModal").style.display = "flex";

    const createBackupBtn = document.querySelector('[onclick="backupDatabase()"]');
    if (createBackupBtn) {
      createBackupBtn.style.display = canBackupDB() ? 'inline-block' : 'none';
    }
  } catch (error) {
    console.error("Ошибка при загрузке списка бэкапов:", error);
    await showCustomAlert("Ошибка при загрузке списка бэкапов", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    document.body.style.overflow = '';
  }
}

// Закрыть модальное окно управления БД
export function closeDatabaseModal() {
  document.getElementById("databaseModal").style.display = "none";
  selectedBackupFilename = null;
  document.body.style.overflow = '';
}

// Выбрать бэкап
export function selectBackup(filename, isLocked = false) {
  selectedBackupFilename = filename;
  selectedBackupIsProtected = isLocked;

  document.querySelectorAll('.backup-item').forEach(item => {
    item.classList.remove('selected');
    item.style.borderColor = 'rgba(90, 159, 212, 0.3)';
    item.style.background = 'rgba(30, 34, 44, 0.6)';
    const lockBtn = item.querySelector('.backup-lock-btn');
    if (lockBtn) { lockBtn.style.opacity = '0'; lockBtn.style.pointerEvents = 'none'; }
  });

  const selectedItem = document.querySelector('[data-filename="' + filename + '"]');
  if (selectedItem) {
    selectedItem.classList.add('selected');
    selectedItem.style.borderColor = '#5a9fd4';
    selectedItem.style.background = 'rgba(90, 159, 212, 0.2)';
    const lockBtn = selectedItem.querySelector('.backup-lock-btn');
    if (lockBtn) { lockBtn.style.opacity = '1'; lockBtn.style.pointerEvents = 'auto'; }
  }

  updateBackupButtons();
}

// Обновить состояние кнопок
export function updateBackupButtons() {
  const restoreBtn = document.getElementById('restoreBackupBtn');
  const downloadBtn = document.getElementById('downloadBackupBtn');
  const deleteBtn = document.getElementById('deleteBackupBtn');

  if (!canRestoreDB()) { restoreBtn.style.display = 'none'; } else { restoreBtn.style.display = 'inline-block'; }
  if (!canDownloadBackup()) { downloadBtn.style.display = 'none'; } else { downloadBtn.style.display = 'inline-block'; }
  if (!canDeleteBackup()) { deleteBtn.style.display = 'none'; } else { deleteBtn.style.display = 'inline-block'; }

  if (selectedBackupFilename) {
    if (canRestoreDB()) {
      restoreBtn.disabled = false;
      restoreBtn.style.background = 'rgba(255, 152, 0, 0.7)';
      restoreBtn.style.color = '#fff';
      restoreBtn.style.border = '1px solid #ff9800';
      restoreBtn.style.cursor = 'pointer';
    }
    if (canDownloadBackup()) {
      downloadBtn.disabled = false;
      downloadBtn.style.background = 'rgba(90, 159, 212, 0.7)';
      downloadBtn.style.color = '#e0e6f0';
      downloadBtn.style.border = '1px solid #3a7bd5';
      downloadBtn.style.cursor = 'pointer';
    }
    if (canDeleteBackup()) {
      if (selectedBackupIsProtected) {
        deleteBtn.disabled = true;
        deleteBtn.style.background = 'rgba(244, 67, 54, 0.3)';
        deleteBtn.style.color = '#999';
        deleteBtn.style.border = '1px solid #666';
        deleteBtn.style.cursor = 'not-allowed';
        deleteBtn.title = 'Этот бэкап защищен от удаления';
      } else {
        deleteBtn.disabled = false;
        deleteBtn.style.background = 'rgba(244, 67, 54, 0.7)';
        deleteBtn.style.color = '#ffb3b3';
        deleteBtn.style.border = '1px solid #f44336';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.title = '';
      }
    }
  } else {
    if (canRestoreDB()) { restoreBtn.disabled = true; restoreBtn.style.background = 'rgba(255,152,0,0.3)'; restoreBtn.style.color = '#999'; restoreBtn.style.border = '1px solid #666'; restoreBtn.style.cursor = 'not-allowed'; }
    if (canDownloadBackup()) { downloadBtn.disabled = true; downloadBtn.style.background = 'rgba(90,159,212,0.3)'; downloadBtn.style.color = '#999'; downloadBtn.style.border = '1px solid #666'; downloadBtn.style.cursor = 'not-allowed'; }
    if (canDeleteBackup()) { deleteBtn.disabled = true; deleteBtn.style.background = 'rgba(244,67,54,0.3)'; deleteBtn.style.color = '#999'; deleteBtn.style.border = '1px solid #666'; deleteBtn.style.cursor = 'not-allowed'; }
  }
}

// Восстановить выбранный бэкап
export async function restoreSelectedBackup() {
  if (!selectedBackupFilename) {
    await showCustomAlert("Выберите бэкап для восстановления", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const confirmed = await showCustomConfirm(
    'Вы уверены что хотите восстановить БД из бэкапа?\n\n<strong style="color:#5a9fd4;">' + selectedBackupFilename + '</strong>\n\n<div style="color:#ff9800;margin-top:10px;"><svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg> Текущая БД будет заменена. Все текущие данные будут потеряны!</div>\n\n<div style="color:#4caf50;margin-top:10px;"><svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Перед восстановлением будет создан бэкап текущей БД.</div>',
    "Восстановление БД", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'
  );

  if (!confirmed) return;

  try {
    const response = await fetch("/api/admin/restore-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: selectedBackupFilename, username: currentUser.username })
    });

    const data = await response.json();

    if (data.success) {
      await showCustomAlert(
        '<div style="margin-bottom:10px;">БД успешно восстановлена!</div><div style="color:#5a9fd4;"><svg class="icon" aria-hidden="true"><use href="#icon-backup"></use></svg> Восстановлено из: <strong>' + data.restored_from + '</strong></div><div style="color:#4caf50;margin-top:5px;"><svg class="icon" aria-hidden="true"><use href="#icon-backup"></use></svg> Создан бэкап текущей БД: <strong>' + data.backup_created + '</strong></div><div style="color:#ff9800;margin-top:10px;">Страница будет перезагружена...</div>',
        "Успешно", '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
      );
      closeDatabaseModal();
      localStorage.clear();
      setTimeout(() => window.location.reload(), 500);
    } else {
      await showCustomAlert(data.error, "Ошибка при восстановлении БД", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error("Ошибка при восстановлении БД:", error);
    await showCustomAlert(error.message, "Ошибка при восстановлении БД", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Скачать выбранный бэкап
export function downloadSelectedBackup() {
  if (!selectedBackupFilename) {
    showCustomAlert("Выберите бэкап для скачивания", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }
  window.location.href = '/download-backup/' + selectedBackupFilename + '?username=' + encodeURIComponent(currentUser.username);
}

// Заблокировать/разблокировать бэкап (только для админа)
export async function toggleBackupLock(filename, currentLockStatus) {
  if (!isAdmin()) {
    await showCustomAlert("Только админ может блокировать/разблокировать бэкапы", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const action = currentLockStatus ? 'разблокировать' : 'заблокировать';
  const confirmed = await showCustomConfirm(
    'Вы уверены что хотите ' + action + ' бэкап?\n\n<strong style="color:#5a9fd4;">' + filename + '</strong>\n\n' + (currentLockStatus ? '<div style="color:#4caf50;margin-top:10px;">После разблокировки бэкап можно будет удалить.</div>' : '<div style="color:#ffc107;margin-top:10px;"><svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg> Заблокированный бэкап нельзя будет удалить до разблокировки.</div>'),
    currentLockStatus ? "Разблокировка бэкапа" : "Блокировка бэкапа", '<svg class="icon" aria-hidden="true"><use href="#icon-hidden"></use></svg>'
  );

  if (!confirmed) return;

  try {
    const response = await fetch("/api/admin/toggle-backup-lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, username: currentUser.username })
    });

    const data = await response.json();

    if (data.success) {
      await openDatabaseModal();
    } else {
      await showCustomAlert(data.error, "Ошибка при изменении блокировки", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error("Ошибка при изменении блокировки бэкапа:", error);
    await showCustomAlert(error.message, "Ошибка при изменении блокировки бэкапа", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Удалить выбранный бэкап
export async function deleteSelectedBackup() {
  if (!selectedBackupFilename) {
    await showCustomAlert("Выберите бэкап для удаления", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  if (!isAdmin() && !hasPermission('delete_backup')) {
    await showCustomAlert("У вас нет прав для удаления бэкапов", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const confirmed = await showCustomConfirm(
    'Вы уверены что хотите удалить бэкап?\n\n<strong style="color:#5a9fd4;">' + selectedBackupFilename + '</strong>\n\n<div style="color:#f44336;margin-top:10px;"><svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg> Это действие нельзя отменить!</div>',
    "Удаление бэкапа", '<svg class="icon" aria-hidden="true"><use href="#icon-delete"></use></svg>'
  );

  if (!confirmed) return;

  try {
    const response = await fetch("/api/admin/delete-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: selectedBackupFilename, username: currentUser.username })
    });

    const data = await response.json();

    if (data.success) {
      selectedBackupFilename = null;
      openDatabaseModal();
    } else {
      await showCustomAlert(data.error, "Ошибка при удалении бэкапа", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error("Ошибка при удалении бэкапа:", error);
    await showCustomAlert(error.message, "Ошибка при удалении бэкапа", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Восстановить БД из модалки управления БД (совместимость)
export async function restoreBackupFromModal(filename) {
  selectedBackupFilename = filename;
  await restoreSelectedBackup();
}

// Восстановить БД из бэкапа (старая функция)
export async function restoreBackup(filename) {
  const confirmed = confirm(
    '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg> ВНИМАНИЕ!\n\nВы уверены что хотите восстановить БД из бэкапа?\n\n' + filename + '\n\nТекущая БД будет заменена. Все текущие данные будут потеряны!\n\nПеред восстановлением будет создан бэкап текущей БД.'
  );

  if (!confirmed) return;

  try {
    const response = await fetch("/api/admin/restore-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, username: currentUser.username })
    });

    const data = await response.json();

    if (data.success) {
      alert('БД успешно восстановлена!\n\nВосстановлено из: ' + data.restored_from + '\nСоздан бэкап текущей БД: ' + data.backup_created + '\n\nСтраница будет перезагружена.');
      closeRestoreDBModal();
      setTimeout(() => window.location.reload(), 1000);
    } else {
      alert('Ошибка при восстановлении БД: ' + data.error);
    }
  } catch (error) {
    console.error("Ошибка при восстановлении БД:", error);
    alert('Ошибка при восстановлении БД:\n' + error.message);
  }
}

// Проверить orphaned данные в БД
export async function checkOrphanedData() {
  if (!canManageOrphaned()) {
    await showCustomAlert("У вас нет прав для проверки orphaned данных", "Доступ запрещён", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  try {
    const btn = document.querySelector('[onclick="checkOrphanedData()"]');
    if (btn) { btn.textContent = "⏳ Проверка..."; btn.disabled = true; }

    const response = await fetch('/api/admin/orphaned-data?username=' + encodeURIComponent(currentUser.username));

    if (!response.ok) throw new Error('HTTP error! status: ' + response.status);

    const data = await response.json();
    const totalOrphaned = data.total_orphaned;
    const totalCount = totalOrphaned.matches + totalOrphaned.bets + totalOrphaned.final_bets + totalOrphaned.reminders + totalOrphaned.awards + totalOrphaned.final_parameters;

    if (totalCount === 0) {
      await showCustomAlert(
        '<div style="text-align:center;padding:20px;"><div style="font-size:3em;margin-bottom:15px;"><svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg></div><div style="font-size:1.2em;color:#4caf50;font-weight:600;margin-bottom:10px;">БД ЧИСТАЯ!</div><div style="color:#b0b8c8;">Orphaned данных не найдено</div></div>',
        "Проверка завершена", '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
      );
    } else {
      const message =
        '<div style="padding:10px;">' +
        '<div style="font-size:1.1em;color:#ff9800;font-weight:600;margin-bottom:15px;text-align:center;"><svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg> Найдено ' + totalCount + ' orphaned записей</div>' +
        '<div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:8px;margin-bottom:15px;">' +
        '<div style="display:grid;grid-template-columns:1fr auto;gap:10px;font-size:0.95em;">' +
        '<div style="color:#e0e6f0;"><svg class="icon" aria-hidden="true"><use href="#icon-matches"></use></svg> Матчи без события:</div><div style="color:#f44336;font-weight:600;text-align:right;">' + totalOrphaned.matches + '</div>' +
        '<div style="color:#e0e6f0;"><svg class="icon" aria-hidden="true"><use href="#icon-custom-tournament"></use></svg> Ставки на удалённые матчи:</div><div style="color:#f44336;font-weight:600;text-align:right;">' + totalOrphaned.bets + '</div>' +
        '<div style="color:#e0e6f0;"><svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> Финальные ставки:</div><div style="color:#f44336;font-weight:600;text-align:right;">' + totalOrphaned.final_bets + '</div>' +
        '<div style="color:#e0e6f0;"><svg class="icon" aria-hidden="true"><use href="#icon-bell"></use></svg> Напоминания:</div><div style="color:#f44336;font-weight:600;text-align:right;">' + totalOrphaned.reminders + '</div>' +
        '<div style="color:#e0e6f0;"><svg class="icon" aria-hidden="true"><use href="#icon-conference"></use></svg> Награды:</div><div style="color:#f44336;font-weight:600;text-align:right;">' + totalOrphaned.awards + '</div>' +
        '<div style="color:#e0e6f0;"><svg class="icon" aria-hidden="true"><use href="#icon-settings"></use></svg> Параметры финала:</div><div style="color:#f44336;font-weight:600;text-align:right;">' + totalOrphaned.final_parameters + '</div>' +
        '</div></div>' +
        '<div style="color:#b0b8c8;font-size:0.9em;text-align:center;line-height:1.5;">Очистить orphaned данные?<br/><span style="color:#888;">(Это удалит все найденные orphaned данные из БД)</span></div>' +
        '</div>';

      const confirmed = await showCustomConfirm(message, "Очистка orphaned данных", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
      if (confirmed) cleanupOrphanedData();
    }
  } catch (error) {
    console.error("Ошибка при проверке orphaned данных:", error);
    await showCustomAlert('Ошибка при проверке orphaned данных:\n' + error.message, "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  } finally {
    const btn = document.querySelector('[onclick="checkOrphanedData()"]');
    if (btn) { btn.textContent = '<svg class="icon" aria-hidden="true"><use href="#icon-search"></use></svg>' + ' Проверить orphaned'; btn.disabled = false; }
  }
}

// Очистить orphaned данные в БД
export async function cleanupOrphanedData() {
  if (!canManageOrphaned()) {
    await showCustomAlert("У вас нет прав для очистки orphaned данных", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  try {
    const btn = document.querySelector('[onclick="checkOrphanedData()"]');
    if (btn) { btn.textContent = "⏳ Очистка..."; btn.disabled = true; }

    const response = await fetch("/api/admin/cleanup-orphaned-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: currentUser.username })
    });

    if (!response.ok) throw new Error('HTTP error! status: ' + response.status);

    const data = await response.json();

    let message = '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> ORPHANED ДАННЫЕ УДАЛЕНЫ:\n\n';
    message += '<svg class="icon" aria-hidden="true"><use href="#icon-matches"></use></svg>  Матчи: ' + (data.deleted.matches || 0) + '\n';
    message += '<svg class="icon" aria-hidden="true"><use href="#icon-custom-tournament"></use></svg>  Ставки: ' + (data.deleted.bets || 0) + '\n';
    message += '<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg>  Финальные ставки: ' + (data.deleted.final_bets || 0) + '\n';
    message += '<svg class="icon" aria-hidden="true"><use href="#icon-bell"></use></svg>  Напоминания: ' + (data.deleted.reminders || 0) + '\n';
    message += '<svg class="icon" aria-hidden="true"><use href="#icon-conference"></use></svg>  Награды: ' + (data.deleted.awards || 0) + '\n';
    message += '<svg class="icon" aria-hidden="true"><use href="#icon-settings"></use></svg>  Параметры финала: ' + (data.deleted.final_parameters || 0) + '\n\n';
    message += 'БД успешно очищена!';

    alert(message);
  } catch (error) {
    console.error("Ошибка при очистке orphaned данных:", error);
    alert('Ошибка при очистке orphaned данных:\n' + error.message);
  } finally {
    const btn = document.querySelector('[onclick="checkOrphanedData()"]');
    if (btn) { btn.textContent = '<svg class="icon" aria-hidden="true"><use href="#icon-search"></use></svg>' + ' Проверить orphaned'; btn.disabled = false; }
  }
}
