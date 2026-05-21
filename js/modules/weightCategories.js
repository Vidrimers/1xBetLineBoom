// ========== МОДУЛЬ WEIGHT CATEGORIES (Веса турниров) ==========
// Управление категориями весов турниров из админ-панели

import { currentUser } from './state.js';
import { showCustomAlert } from './ui.js';
import { isAdmin } from './admin.js';

// Открыть модалку управления весами турниров
export async function openWeightCategoriesModal() {
  if (!isAdmin()) {
    await showCustomAlert('Недостаточно прав', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'custom-modal-overlay';
  overlay.id = 'weightCategoriesOverlay';

  overlay.innerHTML = `
    <div class="custom-modal" style="max-width: 550px; width: 90%;">
      <div class="custom-modal-title">
        ⚖️ Веса турниров
      </div>
      <div style="margin-bottom: 15px;">
        <div style="display: flex; gap: 8px; align-items: center;">
          <input type="number" id="weightCategoryWeightInput" placeholder="Вес" min="0" style="
            width: 70px;
            padding: 10px 14px;
            background: rgba(30, 35, 45, 0.8);
            border: 1px solid rgba(90, 159, 212, 0.4);
            border-radius: 6px;
            color: #e0e6f0;
            font-size: 0.95em;
            outline: none;
          ">
          <input type="text" id="weightCategoryLabelInput" placeholder="Описание (напр. ЧМ и ЧЕ)" style="
            flex: 1;
            padding: 10px 14px;
            background: rgba(30, 35, 45, 0.8);
            border: 1px solid rgba(90, 159, 212, 0.4);
            border-radius: 6px;
            color: #e0e6f0;
            font-size: 0.95em;
            outline: none;
          ">
          <button onclick="addWeightCategory()" style="
            padding: 10px 16px;
            background: rgba(76, 175, 80, 0.8);
            color: white;
            border: 1px solid #4caf50;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.95em;
            white-space: nowrap;
            transition: all 0.3s ease;
          " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">Добавить</button>
        </div>
      </div>
      <div id="weightCategoriesList" style="
        max-height: 350px;
        overflow-y: auto;
        border: 1px solid rgba(90, 159, 212, 0.2);
        border-radius: 6px;
        background: rgba(20, 25, 35, 0.5);
      ">
        <div style="text-align: center; padding: 20px; color: #b0b8c8;">
          <div class="spinner"></div> Загрузка...
        </div>
      </div>
      <div style="margin-top: 12px; font-size: 0.8em; color: #888; line-height: 1.4;">
        💡 Вес определяет значимость турнира при сортировке участников.<br>
        💡 Чем больше вес — тем выше ценится победа в турнире этой категории.
      </div>
      <div class="custom-modal-buttons" style="margin-top: 15px;">
        <button class="custom-modal-btn custom-modal-btn-secondary" onclick="closeWeightCategoriesModal()">Закрыть</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Закрытие по клику на оверлей
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeWeightCategoriesModal();
  });

  // Загружаем список
  await loadWeightCategories();
}

// Закрыть модалку
export function closeWeightCategoriesModal() {
  const overlay = document.getElementById('weightCategoriesOverlay');
  if (overlay) overlay.remove();
}

// Загрузить список категорий весов
export async function loadWeightCategories() {
  try {
    const response = await fetch('/api/admin/weight-categories');
    const data = await response.json();

    const container = document.getElementById('weightCategoriesList');
    if (!container) return;

    if (!data.categories || data.categories.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 20px; color: #b0b8c8;">Категории не найдены</div>';
      return;
    }

    container.innerHTML = data.categories.map(cat => `
      <div style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid rgba(90, 159, 212, 0.15);" id="weight-cat-${cat.id}">
        <input type="number" value="${cat.weight}" min="0" style="
          width: 60px;
          padding: 8px 10px;
          background: rgba(30, 35, 45, 0.8);
          border: 1px solid rgba(90, 159, 212, 0.3);
          border-radius: 4px;
          color: #e0e6f0;
          font-size: 0.95em;
          text-align: center;
        " onchange="updateWeightCategory(${cat.id}, this.value, null)">
        <input type="text" value="${cat.label}" style="
          flex: 1;
          padding: 8px 10px;
          background: rgba(30, 35, 45, 0.8);
          border: 1px solid rgba(90, 159, 212, 0.3);
          border-radius: 4px;
          color: #e0e6f0;
          font-size: 0.95em;
        " onchange="updateWeightCategory(${cat.id}, null, this.value)">
        <button onclick="deleteWeightCategory(${cat.id})" style="
          padding: 8px 12px;
          background: rgba(244, 67, 54, 0.7);
          color: #ffb3b3;
          border: 1px solid #f44336;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.9em;
          transition: all 0.3s ease;
        " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'" title="Удалить">🗑️</button>
      </div>
    `).join('');
  } catch (error) {
    console.error('❌ Ошибка загрузки категорий весов:', error);
    const container = document.getElementById('weightCategoriesList');
    if (container) {
      container.innerHTML = '<div style="text-align: center; padding: 20px; color: #f44336;">Ошибка загрузки</div>';
    }
  }
}

// Добавить категорию веса
export async function addWeightCategory() {
  const weightInput = document.getElementById('weightCategoryWeightInput');
  const labelInput = document.getElementById('weightCategoryLabelInput');

  const weight = parseInt(weightInput.value);
  const label = labelInput.value.trim();

  if (!label) {
    await showCustomAlert('Введите описание категории', 'Ошибка');
    return;
  }

  if (isNaN(weight) || weight < 0) {
    await showCustomAlert('Введите корректный вес (число >= 0)', 'Ошибка');
    return;
  }

  try {
    const response = await fetch('/api/admin/weight-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username, weight, label })
    });

    const data = await response.json();

    if (!response.ok) {
      await showCustomAlert(data.error || 'Ошибка добавления', 'Ошибка');
      return;
    }

    // Очищаем поля
    weightInput.value = '';
    labelInput.value = '';

    // Перезагружаем список
    await loadWeightCategories();
  } catch (error) {
    console.error('❌ Ошибка добавления категории веса:', error);
    await showCustomAlert('Ошибка сети', 'Ошибка');
  }
}

// Обновить категорию веса
export async function updateWeightCategory(id, newWeight, newLabel) {
  // Получаем текущие значения из DOM
  const row = document.getElementById(`weight-cat-${id}`);
  if (!row) return;

  const inputs = row.querySelectorAll('input');
  const weight = newWeight !== null ? parseInt(newWeight) : parseInt(inputs[0].value);
  const label = newLabel !== null ? newLabel.trim() : inputs[1].value.trim();

  if (!label) {
    await showCustomAlert('Описание не может быть пустым', 'Ошибка');
    await loadWeightCategories();
    return;
  }

  if (isNaN(weight) || weight < 0) {
    await showCustomAlert('Вес должен быть положительным числом', 'Ошибка');
    await loadWeightCategories();
    return;
  }

  try {
    const response = await fetch(`/api/admin/weight-categories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username, weight, label })
    });

    const data = await response.json();

    if (!response.ok) {
      await showCustomAlert(data.error || 'Ошибка обновления', 'Ошибка');
      await loadWeightCategories();
    }
  } catch (error) {
    console.error('❌ Ошибка обновления категории веса:', error);
    await showCustomAlert('Ошибка сети', 'Ошибка');
  }
}

// Удалить категорию веса
export async function deleteWeightCategory(id) {
  try {
    const response = await fetch(`/api/admin/weight-categories/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username })
    });

    const data = await response.json();

    if (!response.ok) {
      await showCustomAlert(data.error || 'Ошибка удаления', 'Ошибка');
      return;
    }

    // Перезагружаем список
    await loadWeightCategories();
  } catch (error) {
    console.error('❌ Ошибка удаления категории веса:', error);
    await showCustomAlert('Ошибка сети', 'Ошибка');
  }
}
