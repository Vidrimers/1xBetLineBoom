// ========== МОДУЛЬ ADMIN PANEL ==========
// Конфигурация и управление аккордеоном админ-панели

import { currentUser } from './state.js';
import { showCustomAlert, showCustomConfirm } from './ui.js';

// Глобальная переменная для хранения текущей конфигурации в редакторе
let currentEditingConfig = null;

// Загрузить конфигурацию админ-панели
export async function loadAdminPanelConfig() {
  const container = document.getElementById('adminPanelAccordion');
  if (!container) return;

  try {
    const response = await fetch('/api/admin/panel-config');
    if (!response.ok) throw new Error('Ошибка загрузки конфигурации');

    const data = await response.json();
    renderAdminPanelAccordion(data.config);
  } catch (error) {
    console.error('❌ Ошибка загрузки конфигурации админ-панели:', error);
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#f44336;">❌ Ошибка загрузки админ-панели</div>';
  }
}

// Отрисовать аккордеон админ-панели
export function renderAdminPanelAccordion(config) {
  const container = document.getElementById('adminPanelAccordion');
  if (!container || !config || !config.categories) return;

  let html = '';

  config.categories.forEach(category => {
    const isCollapsed = category.collapsed !== false;

    html += `
      <div class="admin-category" style="background:rgba(30,35,45,0.5);border:1px solid rgba(90,159,212,0.3);border-radius:8px;overflow:hidden;">
        <div class="admin-category-header" onclick="toggleCategory('${category.id}')" style="padding:5px 15px;background:rgba(90,159,212,0.1);cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background 0.3s ease;" onmouseover="this.style.background='rgba(90,159,212,0.2)'" onmouseout="this.style.background='rgba(90,159,212,0.1)'">
          <span style="color:#5a9fd4;font-weight:600;font-size:1em;">${category.name}</span>
          <span id="category-arrow-${category.id}" style="color:#5a9fd4;font-size:1.2em;transition:transform 0.3s ease;${isCollapsed ? '' : 'transform:rotate(180deg);'}">▼</span>
        </div>
        <div id="category-content-${category.id}" class="admin-category-content" style="display:${isCollapsed ? 'none' : 'flex'};flex-direction:row;flex-wrap:wrap;gap:10px;padding:15px;">
          ${category.buttons.map(button => renderButton(button)).join('')}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// Отрисовать кнопку
export function renderButton(button) {
  let bgColor, borderColor, textColor;

  if (button.type === 'toggle') {
    bgColor = 'rgba(76,175,80,0.7)';
    borderColor = '#4caf50';
    textColor = '#c8e6c9';
  } else if (button.type === 'external') {
    bgColor = 'rgba(120,120,120,0.7)';
    borderColor = '#888';
    textColor = '#e0e0e0';
  } else {
    bgColor = 'rgba(90,159,212,0.7)';
    borderColor = '#3a7bd5';
    textColor = '#e0e6f0';
  }

  let buttonText = button.text;
  if (button.type === 'toggle' && !buttonText.includes('���')) buttonText = buttonText + ' ���';
  else if (button.type === 'external' && !buttonText.includes('���')) buttonText = buttonText + ' ���';

  if (button.type === 'external') {
    return `<a href="#" onclick='${button.action}; return false;' style="display:flex;align-items:center;justify-content:center;background:${bgColor};color:${textColor};text-decoration:none;padding:12px 20px;border-radius:8px;font-size:0.95em;transition:all 0.3s ease;border:1px solid ${borderColor};white-space:nowrap;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">${buttonText}</a>`;
  }

  return `<button onclick='${button.action}' style="background:${bgColor};color:${textColor};border:1px solid ${borderColor};padding:12px 20px;border-radius:8px;cursor:pointer;font-size:0.95em;transition:all 0.3s ease;white-space:nowrap;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">${buttonText}</button>`;
}

// Переключить категорию (свернуть/развернуть)
export function toggleCategory(categoryId) {
  const content = document.getElementById('category-content-' + categoryId);
  const arrow = document.getElementById('category-arrow-' + categoryId);

  if (!content || !arrow) return;

  const isCollapsed = content.style.display === 'none';

  if (isCollapsed) {
    content.style.display = 'flex';
    arrow.style.transform = 'rotate(180deg)';
  } else {
    content.style.display = 'none';
    arrow.style.transform = 'rotate(0deg)';
  }
}

// Открыть модалку настройки категорий
export async function openConfigureCategoriesModal() {
  try {
    const response = await fetch('/api/admin/panel-config');
    if (!response.ok) throw new Error('Ошибка загрузки конфигурации');

    const data = await response.json();
    currentEditingConfig = JSON.parse(JSON.stringify(data.config));
  } catch (error) {
    console.error('❌ Ошибка загрузки конфигурации:', error);
    await showCustomAlert('Ошибка загрузки конфигурации', 'Ошибка', '❌');
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'configureCategoriesModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;';

  modal.innerHTML = `
    <div style="background:#1e2a3a;padding:30px;border-radius:12px;max-width:900px;width:95%;max-height:90vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 20px 0;color:#5a9fd4;">⚙️ Настройка категорий админ-панели</h3>
      <div style="display:flex;gap:10px;margin-bottom:20px;border-bottom:2px solid rgba(255,255,255,0.1);">
        <button onclick="switchConfigTab('categories')" id="configTab-categories" style="flex:1;padding:5px 15px;background:rgba(90,159,212,0.3);border:none;border-bottom:3px solid #5a9fd4;color:#e0e6f0;cursor:pointer;font-size:0.95em;transition:all 0.3s;">��� Категории</button>
        <button onclick="switchConfigTab('buttons')" id="configTab-buttons" style="flex:1;padding:5px 15px;background:transparent;border:none;border-bottom:3px solid transparent;color:#b0b8c8;cursor:pointer;font-size:0.95em;transition:all 0.3s;">��� Кнопки</button>
        <button onclick="switchConfigTab('reset')" id="configTab-reset" style="flex:1;padding:5px 15px;background:transparent;border:none;border-bottom:3px solid transparent;color:#b0b8c8;cursor:pointer;font-size:0.95em;transition:all 0.3s;">��� Сброс</button>
      </div>
      <div id="configTabContent" style="min-height:300px;margin-bottom:20px;"></div>
      <div style="display:flex;gap:10px;">
        <button onclick="saveConfigChanges()" style="flex:1;background:#4caf50;color:white;border:none;padding:12px;border-radius:8px;cursor:pointer;font-size:16px;">��� Сохранить</button>
        <button onclick="closeConfigureCategoriesModal()" style="flex:1;background:#f44336;color:white;border:none;padding:12px;border-radius:8px;cursor:pointer;font-size:16px;">❌ Отмена</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  switchConfigTab('categories');
}

// Закрыть модалку настройки категорий
export function closeConfigureCategoriesModal() {
  const modal = document.getElementById('configureCategoriesModal');
  if (modal) modal.remove();
  currentEditingConfig = null;
}

// Переключить вкладку в модалке настройки
export function switchConfigTab(tab) {
  ['categories', 'buttons', 'reset'].forEach(t => {
    const btn = document.getElementById('configTab-' + t);
    if (btn) {
      if (t === tab) {
        btn.style.background = 'rgba(90,159,212,0.3)';
        btn.style.borderBottom = '3px solid #5a9fd4';
        btn.style.color = '#e0e6f0';
      } else {
        btn.style.background = 'transparent';
        btn.style.borderBottom = '3px solid transparent';
        btn.style.color = '#b0b8c8';
      }
    }
  });

  const content = document.getElementById('configTabContent');
  if (!content) return;

  if (tab === 'categories') content.innerHTML = renderCategoriesTab();
  else if (tab === 'buttons') content.innerHTML = renderButtonsTab();
  else if (tab === 'reset') content.innerHTML = renderResetTab();
}

// Отрисовать вкладку категорий
export function renderCategoriesTab() {
  if (!currentEditingConfig || !currentEditingConfig.categories) {
    return '<div style="text-align:center;padding:40px;color:#f44336;">Ошибка загрузки конфигурации</div>';
  }

  let html = `
    <div style="margin-bottom:15px;">
      <button onclick="addNewCategory()" style="width:100%;padding:12px;background:rgba(76,175,80,0.7);color:#c8e6c9;border:1px solid #4caf50;border-radius:8px;cursor:pointer;font-size:0.95em;transition:all 0.3s ease;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">➕ Добавить категорию</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
  `;

  currentEditingConfig.categories.forEach((category, index) => {
    const buttonCount = category.buttons ? category.buttons.length : 0;

    html += `
      <div style="background:rgba(30,35,45,0.5);border:1px solid rgba(90,159,212,0.3);border-radius:8px;padding:15px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div style="flex:1;">
            <input type="text" value="${category.name}" onchange="updateCategoryName(${index}, this.value)" style="width:100%;padding:8px;background:rgba(20,25,35,0.5);border:1px solid rgba(90,159,212,0.3);border-radius:4px;color:#e0e6f0;font-size:0.95em;"/>
            <div style="color:#b0b8c8;font-size:0.85em;margin-top:5px;">ID: ${category.id} | Кнопок: ${buttonCount}</div>
          </div>
          <div style="display:flex;gap:5px;margin-left:10px;">
            ${index > 0 ? '<button onclick="moveCategoryUp(' + index + ')" style="padding:8px 12px;background:rgba(90,159,212,0.7);color:#e0e6f0;border:1px solid #3a7bd5;border-radius:4px;cursor:pointer;font-size:0.9em;" title="Переместить вверх">⬆️</button>' : ''}
            ${index < currentEditingConfig.categories.length - 1 ? '<button onclick="moveCategoryDown(' + index + ')" style="padding:8px 12px;background:rgba(90,159,212,0.7);color:#e0e6f0;border:1px solid #3a7bd5;border-radius:4px;cursor:pointer;font-size:0.9em;" title="Переместить вниз">⬇️</button>' : ''}
            <button onclick="deleteCategory(${index})" style="padding:8px 12px;background:rgba(244,67,54,0.7);color:#ffb3b3;border:1px solid #f44336;border-radius:4px;cursor:pointer;font-size:0.9em;" title="Удалить категорию">���️</button>
          </div>
        </div>
        <div style="background:rgba(20,25,35,0.5);padding:10px;border-radius:4px;border:1px solid rgba(90,159,212,0.2);">
          <label style="display:flex;align-items:center;gap:8px;color:#b0b8c8;font-size:0.9em;">
            <input type="checkbox" ${category.collapsed !== false ? 'checked' : ''} onchange="toggleCategoryCollapsed(${index}, this.checked)" style="width:18px;height:18px;cursor:pointer;"/>
            Свернута по умолчанию
          </label>
        </div>
      </div>
    `;
  });

  html += '</div>';
  return html;
}

// Отрисовать вкладку кнопок
export function renderButtonsTab() {
  if (!currentEditingConfig || !currentEditingConfig.categories) {
    return '<div style="text-align:center;padding:40px;color:#f44336;">Ошибка загрузки конфигурации</div>';
  }

  let html = `
    <div style="background:rgba(255,152,0,0.2);border-left:4px solid #ff9800;padding:15px;border-radius:4px;margin-bottom:15px;color:#ffe0b2;font-size:0.9em;">
      ��� Выберите категорию для каждой кнопки. Кнопки будут отображаться в выбранной категории.
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
  `;

  currentEditingConfig.categories.forEach((category, catIndex) => {
    if (!category.buttons || category.buttons.length === 0) return;

    category.buttons.forEach((button, btnIndex) => {
      html += `
        <div style="background:rgba(30,35,45,0.5);border:1px solid rgba(90,159,212,0.3);border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center;">
          <div style="flex:1;">
            <div style="color:#e0e6f0;font-weight:600;margin-bottom:5px;">${button.text}</div>
            <div style="color:#b0b8c8;font-size:0.85em;">ID: ${button.id}</div>
          </div>
          <select onchange="moveButtonToCategory(${catIndex}, ${btnIndex}, this.value)" style="padding:8px 12px;background:rgba(20,25,35,0.5);border:1px solid rgba(90,159,212,0.3);border-radius:4px;color:#e0e6f0;font-size:0.9em;cursor:pointer;min-width:200px;">
            ${currentEditingConfig.categories.map((cat, idx) => '<option value="' + idx + '" ' + (idx === catIndex ? 'selected' : '') + '>' + cat.name + '</option>').join('')}
          </select>
        </div>
      `;
    });
  });

  html += '</div>';
  return html;
}

// Отрисовать вкладку сброса
export function renderResetTab() {
  return `
    <div style="text-align:center;padding:40px;">
      <div style="background:rgba(244,67,54,0.2);border:2px solid #f44336;border-radius:12px;padding:30px;margin-bottom:20px;">
        <div style="font-size:3em;margin-bottom:15px;">⚠️</div>
        <h4 style="margin:0 0 15px 0;color:#f44336;font-size:1.2em;">Сброс к дефолтным настройкам</h4>
        <p style="color:#ffb3b3;margin:0 0 20px 0;line-height:1.6;">Это действие вернёт конфигурацию админ-панели к исходному состоянию.<br/>Все ваши изменения (категории, порядок кнопок) будут потеряны.</p>
        <button onclick="resetToDefaultConfig()" style="padding:15px 30px;background:#f44336;color:white;border:none;border-radius:8px;cursor:pointer;font-size:1em;font-weight:600;transition:all 0.3s ease;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">��� Сбросить к дефолту</button>
      </div>
      <div style="color:#b0b8c8;font-size:0.9em;line-height:1.6;"><p style="margin:0;">Дефолтная конфигурация включает 6 категорий:<br/>��� Система и логи, ��� Пользователи и модерация,<br/>��� Контент и новости, ⚙️ Настройки интерфейса,<br/>��� Уведомления, ���️ Утилиты и инструменты</p></div>
    </div>
  `;
}

// Обновить название категории
export function updateCategoryName(index, newName) {
  if (!currentEditingConfig || !currentEditingConfig.categories[index]) return;
  currentEditingConfig.categories[index].name = newName;
}

// Переключить свернутость категории
export function toggleCategoryCollapsed(index, collapsed) {
  if (!currentEditingConfig || !currentEditingConfig.categories[index]) return;
  currentEditingConfig.categories[index].collapsed = collapsed;
}

// Переместить категорию вверх
export function moveCategoryUp(index) {
  if (!currentEditingConfig || index <= 0) return;
  const categories = currentEditingConfig.categories;
  [categories[index - 1], categories[index]] = [categories[index], categories[index - 1]];
  switchConfigTab('categories');
}

// Переместить категорию вниз
export function moveCategoryDown(index) {
  if (!currentEditingConfig || index >= currentEditingConfig.categories.length - 1) return;
  const categories = currentEditingConfig.categories;
  [categories[index], categories[index + 1]] = [categories[index + 1], categories[index]];
  switchConfigTab('categories');
}

// Удалить категорию
export async function deleteCategory(index) {
  if (!currentEditingConfig || !currentEditingConfig.categories[index]) return;

  const category = currentEditingConfig.categories[index];
  const buttonCount = category.buttons ? category.buttons.length : 0;

  if (buttonCount > 0) {
    const confirmed = await showCustomConfirm(
      'В категории "' + category.name + '" есть ' + buttonCount + ' кнопок.\n\nКуда переместить кнопки?',
      'Удаление категории', '⚠️'
    );

    if (!confirmed) return;

    if (currentEditingConfig.categories.length > 1) {
      const targetIndex = index === 0 ? 1 : 0;
      currentEditingConfig.categories[targetIndex].buttons.push(...category.buttons);
    }
  }

  currentEditingConfig.categories.splice(index, 1);
  switchConfigTab('categories');
}

// Добавить новую категорию
export function addNewCategory() {
  if (!currentEditingConfig) return;

  const newId = 'custom_' + Date.now();
  const newCategory = {
    id: newId,
    name: '��� Новая категория',
    icon: '���',
    collapsed: false,
    buttons: []
  };

  currentEditingConfig.categories.push(newCategory);
  switchConfigTab('categories');
}

// Переместить кнопку в другую категорию
export function moveButtonToCategory(fromCatIndex, btnIndex, toCatIndex) {
  if (!currentEditingConfig) return;

  toCatIndex = parseInt(toCatIndex);
  if (fromCatIndex === toCatIndex) return;

  const button = currentEditingConfig.categories[fromCatIndex].buttons[btnIndex];
  currentEditingConfig.categories[fromCatIndex].buttons.splice(btnIndex, 1);
  currentEditingConfig.categories[toCatIndex].buttons.push(button);

  switchConfigTab('buttons');
}

// Сбросить к дефолтной конфигурации
export async function resetToDefaultConfig() {
  const confirmed = await showCustomConfirm(
    'Вы уверены что хотите сбросить конфигурацию к дефолтным настройкам?\n\nВсе ваши изменения будут потеряны.',
    'Подтверждение сброса', '⚠️'
  );

  if (!confirmed) return;

  try {
    const response = await fetch('/api/admin/panel-config/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser?.username })
    });

    if (!response.ok) throw new Error('Ошибка сброса конфигурации');

    await showCustomAlert('Конфигурация сброшена к дефолтным настройкам', 'Успешно', '✅');
    closeConfigureCategoriesModal();
    await loadAdminPanelConfig();
  } catch (error) {
    console.error('❌ Ошибка сброса конфигурации:', error);
    await showCustomAlert('Ошибка сброса конфигурации', 'Ошибка', '❌');
  }
}

// Сохранить изменения конфигурации
export async function saveConfigChanges() {
  if (!currentEditingConfig || !currentUser) return;

  try {
    const response = await fetch('/api/admin/panel-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username, config: currentEditingConfig })
    });

    if (!response.ok) throw new Error('Ошибка сохранения конфигурации');

    await showCustomAlert('Конфигурация успешно сохранена', 'Успешно', '✅');
    closeConfigureCategoriesModal();
    await loadAdminPanelConfig();
  } catch (error) {
    console.error('❌ Ошибка сохранения конфигурации:', error);
    await showCustomAlert('Ошибка сохранения конфигурации', 'Ошибка', '❌');
  }
}
