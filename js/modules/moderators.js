// ========== МОДУЛЬ MODERATORS ==========
// Управление модераторами

import { currentUser, ADMIN_LOGIN, ADMIN_DB_NAME } from './state.js';
import { isAdmin } from './admin.js';

// Глобальная переменная для хранения ID редактируемого модератора
let editingModeratorId = null;

// Открыть панель управления модераторами
export async function openModeratorsPanel() {
  if (!isAdmin()) {
    alert("<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> У вас нет прав для управления модераторами");
    return;
  }

  const modal = document.getElementById("moderatorsModal");
  modal.style.display = "flex";

  loadModeratorsList();
  loadUsersList();
}

// Закрыть панель управления модераторами
export function closeModeratorsPanel() {
  const modal = document.getElementById("moderatorsModal");
  modal.style.display = "none";
}

// Загрузить список модераторов
export async function loadModeratorsList() {
  try {
    const response = await fetch("/api/moderators");
    const moderators = await response.json();

    const listContainer = document.getElementById("moderatorsList");

    if (!Array.isArray(moderators) || moderators.length === 0) {
      listContainer.innerHTML = '<div class="empty-message">Модераторов нет</div>';
      return;
    }

    listContainer.innerHTML = moderators.map(mod => `
      <div style="background:rgba(156,39,176,0.2);border:1px solid #9c27b0;padding:12px;margin-bottom:10px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
        <div style="flex:1;">
          <div style="color:#e0e0e0;font-weight:bold;">${mod.username}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button onclick="openEditModeratorModal(${mod.id}, '${mod.username}', ${JSON.stringify(mod.permissions || []).replace(/"/g, '&quot;')})" style="background:rgba(90,159,212,0.7);color:#e0e6f0;border:1px solid #3a7bd5;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.9em;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'"><svg class="icon" aria-label="Редактировать"><use href="#icon-edit"></use></svg>️ Изменить</button>
          <button onclick="removeModerator(${mod.id})" style="background:rgba(244,67,54,0.7);color:#ffb3b3;border:1px solid #f44336;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.9em;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'"><svg class="icon" aria-label="Правильно"><use href="#icon-correct"></use></svg>️ Удалить</button>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error("Ошибка при загрузке модераторов:", error);
    document.getElementById("moderatorsList").innerHTML = '<div class="empty-message">Ошибка загрузки модераторов</div>';
  }
}

// Загрузить список пользователей для выбора
export async function loadUsersList() {
  try {
    const response = await fetch("/api/users");
    const users = await response.json();

    const modsResponse = await fetch("/api/moderators");
    const moderators = await modsResponse.json();
    const moderatorUserIds = new Set(moderators.map(mod => mod.user_id));

    const select = document.getElementById("userSelectForModerator");

    while (select.options.length > 1) {
      select.remove(1);
    }

    users.forEach(user => {
      if (user.username === ADMIN_LOGIN) return;
      if (user.username === ADMIN_DB_NAME) return;
      if (moderatorUserIds.has(user.id)) return;
      if (!user.telegram_username) return;

      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = user.username;
      select.appendChild(option);
    });
  } catch (error) {
    console.error("Ошибка при загрузке пользователей:", error);
  }
}

// Получить текст разрешений
export function getPermissionsText(permissions) {
  const permText = {
    manage_matches: "матчи",
    create_matches: "создание матчей",
    edit_matches: "редактирование матчей",
    delete_matches: "удаление матчей",
    manage_results: "результаты",
    manage_tournaments: "турниры (блокировка)",
    edit_tournaments: "редактирование турниров",
    delete_tournaments: "удаление турниров",
    create_tournaments: "создание турниров",
    view_logs: "логи",
    view_counting: "подсчет результатов",
    manage_db: "управление БД",
    backup_db: "создание бэкапов",
    download_backup: "скачивание бэкапов",
    restore_db: "восстановление БД",
    delete_backup: "удаление бэкапов",
    manage_orphaned: "orphaned данные",
    view_users: "пользователи",
    check_bot: "проверка бота",
    view_settings: "настройки пользователей",
    sync_telegram_ids: "синхронизация Telegram ID",
    edit_users: "редактирование пользователей",
    delete_users: "удаление пользователей",
  };

  if (permissions.length === 0) return "нет";
  return permissions.map(p => permText[p] || p).join(", ");
}

// Назначить нового модератора
export async function assignModerator() {
  const userId = document.getElementById("userSelectForModerator").value;

  if (!userId) {
    alert("<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Выберите пользователя");
    return;
  }

  const permissions = [];
  const permIds = [
    'permManageMatches','permCreateMatches','permEditMatches','permDeleteMatches',
    'permManageResults','permManageTournaments','permEditTournaments','permDeleteTournaments',
    'permCreateTournaments','permViewLogs','permViewCounting','permManageDB',
    'permBackupDB','permDownloadBackup','permRestoreDB','permDeleteBackup',
    'permManageOrphaned','permViewUsers','permCheckBot','permViewSettings',
    'permSyncTelegramIds','permEditUsers','permDeleteUsers'
  ];
  const permKeys = [
    'manage_matches','create_matches','edit_matches','delete_matches',
    'manage_results','manage_tournaments','edit_tournaments','delete_tournaments',
    'create_tournaments','view_logs','view_counting','manage_db',
    'backup_db','download_backup','restore_db','delete_backup',
    'manage_orphaned','view_users','check_bot','view_settings',
    'sync_telegram_ids','edit_users','delete_users'
  ];

  permIds.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el && el.checked) permissions.push(permKeys[i]);
  });

  if (permissions.length === 0) {
    alert("<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Выберите хотя бы одно разрешение");
    return;
  }

  try {
    const response = await fetch("/api/moderators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, permissions })
    });

    const data = await response.json();

    if (data.success) {
      alert("<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Модератор успешно назначен");

      document.getElementById("userSelectForModerator").value = "";
      permIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
      });
      const subDivs = ["userSubPermissions","dbSubPermissions","matchesSubPermissions","tournamentsSubPermissions"];
      subDivs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
      });

      loadModeratorsList();
      loadUsersList();
    } else {
      alert('<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка: ' + (data.error || "Неизвестная ошибка"));
    }
  } catch (error) {
    console.error("Ошибка при назначении модератора:", error);
    alert('<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка при назначении модератора: ' + error.message);
  }
}

// Удалить модератора
export async function removeModerator(moderatorId) {
  if (!confirm("<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>️ Вы уверены? Модератор будет удален из системы")) return;

  try {
    const response = await fetch('/api/moderators/' + moderatorId, { method: "DELETE" });
    const data = await response.json();

    if (data.success) {
      alert("<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Модератор удален");
      loadModeratorsList();
      loadUsersList();
    } else {
      alert('<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка: ' + (data.error || "Неизвестная ошибка"));
    }
  } catch (error) {
    console.error("Ошибка при удалении модератора:", error);
    alert('<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка при удалении модератора: ' + error.message);
  }
}

// Открыть модальное окно редактирования прав модератора
export function openEditModeratorModal(moderatorId, username, permissions) {
  editingModeratorId = moderatorId;

  document.getElementById("editModeratorUsername").textContent = 'Модератор: ' + username;

  const editPermIds = [
    'editPermManageMatches','editPermCreateMatches','editPermEditMatches','editPermDeleteMatches',
    'editPermManageResults','editPermManageTournaments','editPermEditTournaments','editPermDeleteTournaments',
    'editPermCreateTournaments','editPermViewLogs','editPermViewCounting','editPermManageDB',
    'editPermBackupDB','editPermDownloadBackup','editPermRestoreDB','editPermDeleteBackup',
    'editPermManageOrphaned','editPermViewUsers','editPermCheckBot','editPermViewSettings',
    'editPermSyncTelegramIds','editPermEditUsers','editPermDeleteUsers'
  ];
  const editPermKeys = [
    'manage_matches','create_matches','edit_matches','delete_matches',
    'manage_results','manage_tournaments','edit_tournaments','delete_tournaments',
    'create_tournaments','view_logs','view_counting','manage_db',
    'backup_db','download_backup','restore_db','delete_backup',
    'manage_orphaned','view_users','check_bot','view_settings',
    'sync_telegram_ids','edit_users','delete_users'
  ];

  editPermIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });

  const editSubDivs = ["editUserSubPermissions","editDBSubPermissions","editMatchesSubPermissions","editTournamentsSubPermissions"];
  editSubDivs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  if (Array.isArray(permissions)) {
    editPermIds.forEach((id, i) => {
      if (permissions.includes(editPermKeys[i])) {
        const el = document.getElementById(id);
        if (el) el.checked = true;
      }
    });

    if (permissions.includes("manage_matches")) {
      const el = document.getElementById("editMatchesSubPermissions");
      if (el) el.style.display = "block";
    }
    if (permissions.includes("manage_tournaments")) {
      const el = document.getElementById("editTournamentsSubPermissions");
      if (el) el.style.display = "block";
    }
    if (permissions.includes("manage_db")) {
      const el = document.getElementById("editDBSubPermissions");
      if (el) el.style.display = "block";
    }
    if (permissions.includes("view_users")) {
      const el = document.getElementById("editUserSubPermissions");
      if (el) el.style.display = "block";
    }
  }

  document.getElementById("editModeratorModal").style.display = "flex";
}

// Закрыть модальное окно редактирования прав модератора
export function closeEditModeratorModal() {
  document.getElementById("editModeratorModal").style.display = "none";
  editingModeratorId = null;
}

// Переключить видимость подчекбоксов пользователей (форма назначения)
export function toggleUserSubPermissions() {
  const viewUsersCheckbox = document.getElementById("permViewUsers");
  const subPermissionsDiv = document.getElementById("userSubPermissions");

  if (viewUsersCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    ["permCheckBot","permViewSettings","permSyncTelegramIds","permEditUsers","permDeleteUsers"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = true;
    });
  } else {
    subPermissionsDiv.style.display = "none";
    ["permCheckBot","permViewSettings","permSyncTelegramIds","permEditUsers","permDeleteUsers"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
  }
}

// Переключить видимость подчекбоксов БД (форма назначения)
export function toggleDBSubPermissions() {
  const manageDBCheckbox = document.getElementById("permManageDB");
  const subPermissionsDiv = document.getElementById("dbSubPermissions");

  if (manageDBCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    ["permBackupDB","permDownloadBackup","permRestoreDB","permDeleteBackup"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = true;
    });
  } else {
    subPermissionsDiv.style.display = "none";
    ["permBackupDB","permDownloadBackup","permRestoreDB","permDeleteBackup"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
  }
}

// Переключить видимость подчекбоксов матчей (форма назначения)
export function toggleMatchesSubPermissions() {
  const manageMatchesCheckbox = document.getElementById("permManageMatches");
  const subPermissionsDiv = document.getElementById("matchesSubPermissions");

  if (manageMatchesCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    ["permCreateMatches","permEditMatches","permDeleteMatches"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = true;
    });
  } else {
    subPermissionsDiv.style.display = "none";
    ["permCreateMatches","permEditMatches","permDeleteMatches"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
  }
}

// Переключить видимость подчекбоксов турниров (форма назначения)
export function toggleTournamentsSubPermissions() {
  const manageTournamentsCheckbox = document.getElementById("permManageTournaments");
  const subPermissionsDiv = document.getElementById("tournamentsSubPermissions");

  if (manageTournamentsCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    ["permEditTournaments","permDeleteTournaments","permCreateTournaments"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = true;
    });
  } else {
    subPermissionsDiv.style.display = "none";
    ["permEditTournaments","permDeleteTournaments","permCreateTournaments"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
  }
}

// Переключить видимость подчекбоксов пользователей (форма редактирования)
export function toggleEditUserSubPermissions() {
  const viewUsersCheckbox = document.getElementById("editPermViewUsers");
  const subPermissionsDiv = document.getElementById("editUserSubPermissions");

  if (viewUsersCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    ["editPermCheckBot","editPermViewSettings","editPermSyncTelegramIds","editPermEditUsers","editPermDeleteUsers"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = true;
    });
  } else {
    subPermissionsDiv.style.display = "none";
    ["editPermCheckBot","editPermViewSettings","editPermSyncTelegramIds","editPermEditUsers","editPermDeleteUsers"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
  }
}

// Переключить видимость подчекбоксов БД (форма редактирования)
export function toggleEditDBSubPermissions() {
  const manageDBCheckbox = document.getElementById("editPermManageDB");
  const subPermissionsDiv = document.getElementById("editDBSubPermissions");

  if (manageDBCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    ["editPermBackupDB","editPermDownloadBackup","editPermRestoreDB","editPermDeleteBackup"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = true;
    });
  } else {
    subPermissionsDiv.style.display = "none";
    ["editPermBackupDB","editPermDownloadBackup","editPermRestoreDB","editPermDeleteBackup"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
  }
}

// Переключить видимость подчекбоксов матчей (форма редактирования)
export function toggleEditMatchesSubPermissions() {
  const manageMatchesCheckbox = document.getElementById("editPermManageMatches");
  const subPermissionsDiv = document.getElementById("editMatchesSubPermissions");

  if (manageMatchesCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    ["editPermCreateMatches","editPermEditMatches","editPermDeleteMatches"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = true;
    });
  } else {
    subPermissionsDiv.style.display = "none";
    ["editPermCreateMatches","editPermEditMatches","editPermDeleteMatches"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
  }
}

// Переключить видимость подчекбоксов турниров (форма редактирования)
export function toggleEditTournamentsSubPermissions() {
  const manageTournamentsCheckbox = document.getElementById("editPermManageTournaments");
  const subPermissionsDiv = document.getElementById("editTournamentsSubPermissions");

  if (manageTournamentsCheckbox.checked) {
    subPermissionsDiv.style.display = "block";
    ["editPermEditTournaments","editPermDeleteTournaments","editPermCreateTournaments"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = true;
    });
  } else {
    subPermissionsDiv.style.display = "none";
    ["editPermEditTournaments","editPermDeleteTournaments","editPermCreateTournaments"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
  }
}

// Сохранить изменения прав модератора
export async function saveModeratorPermissions() {
  if (!editingModeratorId) {
    alert("<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка: ID модератора не определен");
    return;
  }

  const permissions = [];
  const editPermIds = [
    'editPermManageMatches','editPermCreateMatches','editPermEditMatches','editPermDeleteMatches',
    'editPermManageResults','editPermManageTournaments','editPermEditTournaments','editPermDeleteTournaments',
    'editPermCreateTournaments','editPermViewLogs','editPermViewCounting','editPermManageDB',
    'editPermBackupDB','editPermDownloadBackup','editPermRestoreDB','editPermDeleteBackup',
    'editPermManageOrphaned','editPermViewUsers','editPermCheckBot','editPermViewSettings',
    'editPermSyncTelegramIds','editPermEditUsers','editPermDeleteUsers'
  ];
  const editPermKeys = [
    'manage_matches','create_matches','edit_matches','delete_matches',
    'manage_results','manage_tournaments','edit_tournaments','delete_tournaments',
    'create_tournaments','view_logs','view_counting','manage_db',
    'backup_db','download_backup','restore_db','delete_backup',
    'manage_orphaned','view_users','check_bot','view_settings',
    'sync_telegram_ids','edit_users','delete_users'
  ];

  editPermIds.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el && el.checked) permissions.push(editPermKeys[i]);
  });

  if (permissions.length === 0) {
    alert("<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Выберите хотя бы одно разрешение");
    return;
  }

  try {
    const response = await fetch('/api/moderators/' + editingModeratorId + '/permissions', {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions })
    });

    const data = await response.json();

    if (data.success) {
      alert("<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Права модератора успешно обновлены");
      closeEditModeratorModal();
      loadModeratorsList();
    } else {
      alert('<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка: ' + (data.error || "Неизвестная ошибка"));
    }
  } catch (error) {
    console.error("Ошибка при обновлении прав модератора:", error);
    alert('<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка при обновлении прав: ' + error.message);
  }
}
