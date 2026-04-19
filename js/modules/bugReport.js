// Модуль: багрепорты (отправка пользователем и просмотр администратором)

import * as state from './state.js';
import { showCustomAlert, showCustomConfirm } from './ui.js';

// ===== ИНДИКАТОР ИКОНКИ НАСТРОЕК =====

// Обновить состояние иконки #icon-settings на кнопке настроек
export function updateSettingsIconState(bugReports) {
  const settingsBtn = document.getElementById('settingsTabBtn');
  if (!settingsBtn) return;

  const svgIcon = document.getElementById('settings-tab-icon');
  const reports = bugReports || allBugReports;
  const hasNew = reports.some(r => r.status === 'new');
  const hasInProgress = reports.some(r => r.status === 'in_progress');

  // Сброс
  settingsBtn.classList.remove('settings-icon--new', 'settings-icon--in-progress');
  if (svgIcon) {
    svgIcon.style.animation = '';
    svgIcon.style.transformOrigin = '';
    svgIcon.style.transformBox = '';
    svgIcon.style.display = '';
    svgIcon.setAttribute('stroke', 'currentColor');
  }

  if (hasNew) {
    settingsBtn.classList.add('settings-icon--new');
    if (svgIcon) {
      svgIcon.setAttribute('stroke', '#f44336');
      svgIcon.style.animation = 'settings-pulse 1.2s ease-in-out infinite';
      svgIcon.style.transformOrigin = 'center';
      svgIcon.style.transformBox = 'fill-box';
      svgIcon.style.display = 'inline-block';
    }
  } else if (hasInProgress) {
    settingsBtn.classList.add('settings-icon--in-progress');
    if (svgIcon) {
      svgIcon.setAttribute('stroke', '#4caf50');
      svgIcon.style.animation = 'settings-spin 2s linear infinite';
      svgIcon.style.transformOrigin = 'center';
      svgIcon.style.transformBox = 'fill-box';
      svgIcon.style.display = 'inline-block';
    }
  }
}

// Запросить багрепорты с сервера и обновить иконку (для вызова при логине)
export async function checkBugReportsForAdmin() {
  if (!state.currentUser) return;
  try {
    const response = await fetch(`/api/admin/bug-reports?username=${state.currentUser.username}`);
    if (!response.ok) return;
    const bugReports = await response.json();
    updateSettingsIconState(bugReports);
  } catch (e) {
    // тихо игнорируем
  }
}

// Массив для хранения изображений багрепорта
let bugReportImages = [];

// Переменные для просмотра изображений багрепорта
let currentBugReportImages = [];
let currentImageIndex = 0;
let allBugReports = [];
let currentBugReportFilter = 'new';

// ===== ОТКРЫТИЕ/ЗАКРЫТИЕ МОДАЛЬНОГО ОКНА БАГРЕПОРТА =====

// Открыть модальное окно багрепорта
export function openBugReportModal() {
  if (!state.currentUser) {
    showCustomAlert("Войдите в систему, чтобы отправить сообщение об ошибке", "Требуется вход", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  const modal = document.getElementById("bugReportModal");
  if (modal) {
    document.getElementById("bugReportText").value = "";
    bugReportImages = [];
    updateBugReportImagesPreview();
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";
  }
}

// Закрыть модальное окно багрепорта
export function closeBugReportModal() {
  const modal = document.getElementById("bugReportModal");
  if (modal) {
    bugReportImages = [];
    updateBugReportImagesPreview();
    document.getElementById("bugReportText").value = "";
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// ===== ИЗОБРАЖЕНИЯ В БАГРЕПОРТЕ =====

// Обработка загрузки изображений через input
export async function handleBugReportImages(event) {
  const files = Array.from(event.target.files);
  await addBugReportImages(files);
  event.target.value = '';
}

// Добавление изображений в багрепорт
export async function addBugReportImages(files) {
  const maxImages = 6;
  const maxSizeBytes = 1024 * 1024; // 1 МБ

  if (bugReportImages.length >= maxImages) {
    await showCustomAlert(`Максимум ${maxImages} изображений`, "Ограничение", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  const imageFiles = files.filter(file => file.type.startsWith('image/'));

  if (imageFiles.length === 0) {
    await showCustomAlert("Выберите изображения", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const availableSlots = maxImages - bugReportImages.length;
  const filesToProcess = imageFiles.slice(0, availableSlots);

  if (imageFiles.length > availableSlots) {
    await showCustomAlert(
      `Можно добавить только ${availableSlots} изображений. Остальные будут пропущены.`,
      "Ограничение",
      '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'
    );
  }

  for (const file of filesToProcess) {
    try {
      const compressedBlob = await compressImage(file, maxSizeBytes);
      const base64 = await blobToBase64(compressedBlob);
      bugReportImages.push({
        name: file.name,
        data: base64,
        size: compressedBlob.size
      });
    } catch (error) {
      console.error('Ошибка обработки изображения:', error);
      await showCustomAlert(`Ошибка обработки ${file.name}`, "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  }

  updateBugReportImagesPreview();
}

// Удаление изображения из багрепорта
export function removeBugReportImage(index) {
  bugReportImages.splice(index, 1);
  updateBugReportImagesPreview();
}

// Обновление превью изображений
function updateBugReportImagesPreview() {
  const preview = document.getElementById('bugReportImagesPreview');
  if (!preview) return;

  if (bugReportImages.length === 0) {
    preview.style.display = 'none';
    preview.innerHTML = '';
    return;
  }

  preview.style.display = 'flex';
  preview.innerHTML = bugReportImages.map((img, index) => `
    <div style="
      position: relative;
      width: 100px;
      height: 100px;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.2);
    ">
      <img
        src="${img.data}"
        alt="${img.name}"
        style="width: 100%; height: 100%; object-fit: cover;"
      />
      <button
        onclick="removeBugReportImage(${index})"
        style="
          position: absolute;
          top: 4px;
          right: 4px;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: rgba(244, 67, 54, 0.9);
          color: white;
          border: none;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        "
        title="Удалить"
      >×</button>
      <div style="
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        font-size: 10px;
        padding: 2px 4px;
        text-align: center;
      ">
        ${(img.size / 1024).toFixed(0)} КБ
      </div>
    </div>
  `).join('');
}

// ===== СЖАТИЕ И КОНВЕРТАЦИЯ ИЗОБРАЖЕНИЙ =====

// Сжатие изображения до нужного размера
async function compressImage(file, maxSizeBytes) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        let width = img.width;
        let height = img.height;
        let quality = 0.9;

        const tryCompress = () => {
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Ошибка создания blob'));
              return;
            }

            if (blob.size <= maxSizeBytes || quality <= 0.1) {
              resolve(blob);
              return;
            }

            if (quality > 0.5) {
              quality -= 0.1;
            } else {
              width = Math.floor(width * 0.9);
              height = Math.floor(height * 0.9);
              quality = 0.9;
            }

            tryCompress();
          }, file.type || 'image/jpeg', quality);
        };

        tryCompress();
      };

      img.onerror = () => reject(new Error('Ошибка загрузки изображения'));
      img.src = e.target.result;
    };

    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsDataURL(file);
  });
}

// Конвертация Blob в Base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ===== ОТПРАВКА БАГРЕПОРТА =====

// Отправить багрепорт
export async function sendBugReport() {
  if (!state.currentUser) {
    await showCustomAlert("Войдите в систему", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const bugText = document.getElementById("bugReportText").value.trim();

  if (!bugText) {
    await showCustomAlert("Пожалуйста, опишите проблему", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  try {
    const response = await fetch("/api/bug-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: state.currentUser.id,
        username: state.currentUser.username,
        bugText: bugText,
        images: bugReportImages.map(img => ({
          name: img.name,
          data: img.data,
          size: img.size
        }))
      })
    });

    const result = await response.json();

    if (response.ok) {
      closeBugReportModal();
      await showCustomAlert(
        "Спасибо за сообщение! Администратор получил ваш отчет об ошибке.",
        "Отправлено",
        '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
      );
    } else {
      await showCustomAlert(result.error || "Ошибка при отправке", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error("Ошибка при отправке багрепорта:", error);
    await showCustomAlert("Ошибка при отправке сообщения", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// ===== МОДАЛЬНОЕ ОКНО БАГРЕПОРТОВ (АДМИН) =====

// Закрыть модальное окно багрепортов (для админа)
export function closeBugReportsModal() {
  const modal = document.getElementById("bugReportsModal");
  if (modal) {
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// Загрузить список багрепортов
async function loadBugReports() {
  if (!state.currentUser) return;

  try {
    const response = await fetch(`/api/admin/bug-reports?username=${state.currentUser.username}`);
    const bugReports = await response.json();

    allBugReports = bugReports;

    updateBugReportFilterCounts();
    updateSettingsIconState();

    const hasNew = bugReports.some(r => r.status === 'new');
    const hasInProgress = bugReports.some(r => r.status === 'in_progress');

    if (hasNew) {
      currentBugReportFilter = 'new';
    } else if (hasInProgress) {
      currentBugReportFilter = 'in_progress';
    } else {
      currentBugReportFilter = 'new';
    }

    filterBugReports(currentBugReportFilter);
  } catch (error) {
    console.error("Ошибка при загрузке багрепортов:", error);
    document.getElementById("bugReportsList").innerHTML =
      '<div class="empty-message">Ошибка загрузки багрепортов</div>';
  }
}

// Фильтрация багрепортов по статусу
export function filterBugReports(status) {
  currentBugReportFilter = status;

  document.querySelectorAll('.bug-filter-btn').forEach(btn => {
    if (btn.dataset.status === status) {
      btn.classList.add('active');
      btn.style.background = 'rgba(90, 159, 212, 0.2)';
      btn.style.color = '#5a9fd4';
      btn.style.borderColor = '#5a9fd4';
    } else {
      btn.classList.remove('active');
      btn.style.background = 'rgba(255, 255, 255, 0.05)';
      btn.style.color = '#aaa';
      btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    }
  });

  const filteredReports = allBugReports.filter(r => r.status === status);
  const listContainer = document.getElementById("bugReportsList");

  if (filteredReports.length === 0) {
    const statusText = {
      'new': 'новых',
      'in_progress': 'в работе',
      'resolved': 'решенных',
      'rejected': 'отклоненных'
    }[status] || 'багрепортов';

    listContainer.innerHTML = `<div class="empty-message">Нет ${statusText} багрепортов</div>`;
    return;
  }

  listContainer.innerHTML = filteredReports.map(report => {
    const createdAt = new Date(report.created_at).toLocaleString("ru-RU");
    const statusIcon = {
      'new': '🆕',
      'in_progress': '<svg class="icon" aria-hidden="true"><use href="#icon-refresh"></use></svg>',
      'resolved': '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>',
      'rejected': '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'
    }[report.status] || '<svg class="icon" aria-hidden="true"><use href="#icon-question"></use></svg>';

    const statusText = {
      'new': 'Новый',
      'in_progress': 'В работе',
      'resolved': 'Решено',
      'rejected': 'Отклонено'
    }[report.status] || 'Неизвестно';

    const imagesHtml = report.images && report.images.length > 0 ? `
      <div class="bug-report-images" style="
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      ">
        <div style="color: #aaa; font-size: 12px; width: 100%; margin-bottom: 5px;">
          <svg class="icon" aria-hidden="true"><use href="#icon-attach"></use></svg> Прикрепленные изображения (${report.images.length}):
        </div>
        ${report.images.map((img, index) => `
          <div
            class="bug-report-image-thumb"
            onclick="openBugReportImagesModal(${report.id}, ${index})"
            style="
              width: 80px;
              height: 80px;
              border-radius: 6px;
              overflow: hidden;
              border: 2px solid rgba(90, 159, 212, 0.3);
              cursor: pointer;
              transition: all 0.3s ease;
              position: relative;
            "
            onmouseover="this.style.borderColor='rgba(90, 159, 212, 0.8)'; this.style.transform='scale(1.05)'"
            onmouseout="this.style.borderColor='rgba(90, 159, 212, 0.3)'; this.style.transform='scale(1)'"
            title="Нажмите для просмотра"
          >
            <img
              src="${img.image_data}"
              alt="${img.image_name || 'Изображение'}"
              style="width: 100%; height: 100%; object-fit: cover;"
            />
            <div style="
              position: absolute;
              bottom: 0;
              left: 0;
              right: 0;
              background: rgba(0, 0, 0, 0.7);
              color: white;
              font-size: 9px;
              padding: 2px;
              text-align: center;
            ">
              ${(img.image_size / 1024).toFixed(0)} КБ
            </div>
          </div>
        `).join('')}
      </div>
    ` : '';

    return `
      <div class="bug-report-card" data-status="${report.status}">
        <div class="bug-report-header">
          <div class="bug-report-id">#${report.id}</div>
          <div class="bug-report-user">
            <svg class="icon" aria-hidden="true"><use href="#icon-profile"></use></svg> ${report.username}
            ${report.telegram_username ? `<span class="bug-report-telegram">@${report.telegram_username}</span>` : ''}
          </div>
          <div class="bug-report-date"><svg class="icon" aria-hidden="true"><use href="#icon-clock"></use></svg> ${createdAt}</div>
          <button
            class="bug-report-delete-btn"
            onclick="deleteBugReport(${report.id})"
            title="Удалить багрепорт"
            style="
              position: absolute;
              top: 10px;
              right: 10px;
              width: 28px;
              height: 28px;
              border-radius: 50%;
              background: rgba(244, 67, 54, 0.2);
              color: #f44336;
              border: 1px solid #f44336;
              cursor: pointer;
              font-size: 18px;
              line-height: 1;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 0;
              transition: all 0.3s ease;
            "
            onmouseover="this.style.background='rgba(244, 67, 54, 0.4)'"
            onmouseout="this.style.background='rgba(244, 67, 54, 0.2)'"
          >×</button>
        </div>
        <div class="bug-report-text">${report.bug_text}</div>
        ${imagesHtml}
        <div class="bug-report-footer">
          <div class="bug-report-status">
            ${statusIcon} <span>${statusText}</span>
          </div>
          <select
            class="bug-report-status-select"
            onchange="changeBugStatus(${report.id}, this.value)"
          >
            <option value="new" ${report.status === 'new' ? 'selected' : ''}>🆕 Новый</option>
            <option value="in_progress" ${report.status === 'in_progress' ? 'selected' : ''}><svg class="icon" aria-hidden="true"><use href="#icon-refresh"></use></svg> В работе</option>
            <option value="resolved" ${report.status === 'resolved' ? 'selected' : ''}><svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Решено</option>
            <option value="rejected" ${report.status === 'rejected' ? 'selected' : ''}><svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Отклонено</option>
          </select>
        </div>
      </div>
    `;
  }).join('');
}

// Обновить счетчики на кнопках фильтра
function updateBugReportFilterCounts() {
  const counts = {
    new: allBugReports.filter(r => r.status === 'new').length,
    in_progress: allBugReports.filter(r => r.status === 'in_progress').length,
    resolved: allBugReports.filter(r => r.status === 'resolved').length,
    rejected: allBugReports.filter(r => r.status === 'rejected').length
  };

  document.querySelectorAll('.bug-filter-btn').forEach(btn => {
    const status = btn.dataset.status;
    const count = counts[status] || 0;

    const labels = {
      'new': '🆕 Новый',
      'in_progress': '<svg class="icon" aria-hidden="true"><use href="#icon-refresh"></use></svg> В работе',
      'resolved': '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Решено',
      'rejected': '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Отклонено'
    };

    btn.innerHTML = `${labels[status]} (${count})`;
  });
}

// Изменить статус багрепорта
export async function changeBugStatus(id, status) {
  if (!state.currentUser) return;

  try {
    const response = await fetch(`/api/admin/bug-reports/${id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: status,
        username: state.currentUser.username
      })
    });

    const result = await response.json();

    if (response.ok) {
      await loadBugReports();
    } else {
      await showCustomAlert(result.error || "Ошибка при обновлении статуса", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error("Ошибка при изменении статуса:", error);
    await showCustomAlert("Ошибка при обновлении статуса", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Удалить багрепорт
export async function deleteBugReport(id) {
  if (!state.currentUser) return;

  const confirmed = await showCustomConfirm(
    "Вы уверены, что хотите удалить этот багрепорт? Все связанные изображения также будут удалены.",
    "Подтверждение удаления",
    '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'
  );

  if (!confirmed) return;

  try {
    const response = await fetch(`/api/admin/bug-reports/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: state.currentUser.username })
    });

    const result = await response.json();

    if (response.ok) {
      await showCustomAlert("Багрепорт успешно удален", "Успех", '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');
      await loadBugReports();
    } else {
      await showCustomAlert(result.error || "Ошибка при удалении", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error("Ошибка при удалении багрепорта:", error);
    await showCustomAlert("Ошибка при удалении багрепорта", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// ===== ПРОСМОТР ИЗОБРАЖЕНИЙ БАГРЕПОРТА =====

// Открыть модальное окно просмотра изображений багрепорта
export async function openBugReportImagesModal(bugReportId, startIndex = 0) {
  try {
    const response = await fetch(`/api/admin/bug-reports?username=${state.currentUser.username}`);
    const bugReports = await response.json();

    const report = bugReports.find(r => r.id === bugReportId);

    if (!report || !report.images || report.images.length === 0) {
      await showCustomAlert("Изображения не найдены", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      return;
    }

    currentBugReportImages = report.images;
    currentImageIndex = startIndex;

    const modal = document.getElementById('bugReportImagesModal');
    const title = document.getElementById('bugReportImagesTitle');

    title.textContent = `<svg class="icon" aria-hidden="true"><use href="#icon-photo"></use></svg> Изображения багрепорта #${bugReportId}`;

    displayCurrentBugReportImage();

    document.body.style.overflow = 'hidden';
    modal.style.display = 'flex';
  } catch (error) {
    console.error("Ошибка при открытии изображений:", error);
    await showCustomAlert("Ошибка при загрузке изображений", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Отобразить текущее изображение
function displayCurrentBugReportImage() {
  const container = document.getElementById('bugReportImagesContainer');
  const counter = document.getElementById('imageCounter');
  const prevBtn = document.getElementById('prevImageBtn');
  const nextBtn = document.getElementById('nextImageBtn');

  if (currentBugReportImages.length === 0) return;

  const img = currentBugReportImages[currentImageIndex];

  container.innerHTML = `
    <div style="
      max-width: 100%;
      max-height: calc(90vh - 200px);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    ">
      <img
        src="${img.image_data}"
        alt="${img.image_name || 'Изображение'}"
        style="
          max-width: 100%;
          max-height: calc(90vh - 250px);
          object-fit: contain;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        "
      />
      <div style="color: #aaa; font-size: 14px; text-align: center;">
        <div>${img.image_name || 'Без названия'}</div>
        <div>Размер: ${(img.image_size / 1024).toFixed(2)} КБ</div>
      </div>
    </div>
  `;

  counter.textContent = `${currentImageIndex + 1} / ${currentBugReportImages.length}`;

  prevBtn.disabled = currentImageIndex === 0;
  nextBtn.disabled = currentImageIndex === currentBugReportImages.length - 1;

  prevBtn.style.opacity = prevBtn.disabled ? '0.5' : '1';
  nextBtn.style.opacity = nextBtn.disabled ? '0.5' : '1';
  prevBtn.style.cursor = prevBtn.disabled ? 'not-allowed' : 'pointer';
  nextBtn.style.cursor = nextBtn.disabled ? 'not-allowed' : 'pointer';
}

// Навигация по изображениям
export function navigateBugReportImage(direction) {
  const newIndex = currentImageIndex + direction;

  if (newIndex >= 0 && newIndex < currentBugReportImages.length) {
    currentImageIndex = newIndex;
    displayCurrentBugReportImage();
  }
}

// Закрыть модальное окно просмотра изображений
export function closeBugReportImagesModal() {
  const modal = document.getElementById('bugReportImagesModal');
  if (modal) {
    document.body.style.overflow = '';
    modal.style.display = 'none';
    currentBugReportImages = [];
    currentImageIndex = 0;
  }
}

// ===== ИНИЦИАЛИЗАЦИЯ ОБРАБОТЧИКОВ СОБЫТИЙ =====

// Инициализация paste и keydown обработчиков для модального окна
export function initBugReportListeners() {
  const bugReportModal = document.getElementById('bugReportModal');

  if (bugReportModal) {
    bugReportModal.addEventListener('paste', async (e) => {
      if (bugReportModal.style.display !== 'flex') return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        await addBugReportImages(imageFiles);
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('bugReportImagesModal');
    if (modal && modal.style.display === 'flex') {
      if (e.key === 'ArrowLeft') {
        navigateBugReportImage(-1);
      } else if (e.key === 'ArrowRight') {
        navigateBugReportImage(1);
      } else if (e.key === 'Escape') {
        closeBugReportImagesModal();
      }
    }
  });
}

// Открыть модальное окно списка багрепортов (для администратора)
export async function openBugReportsModal() {
  if (!state.currentUser || state.currentUser.username !== state.ADMIN_DB_NAME) {
    await showCustomAlert('Недостаточно прав', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }
  const modal = document.getElementById('bugReportsModal');
  if (modal) {
    document.body.style.overflow = 'hidden';
    modal.style.display = 'flex';
    await loadBugReports();
  } else {
    console.error('❌ Модальное окно bugReportsModal не найдено!');
  }
}
