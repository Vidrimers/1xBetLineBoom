import * as state from './state.js';
import { showCustomAlert, showCustomConfirm } from './ui.js';
import { loadMatches } from './matches.js';

// ===== АВТОПОДСЧЁТ =====

/**
 * Переключить автоподсчет (включить/выключить)
 */
export async function toggleAutoCounting() {
  if (!state.currentUser || !state.currentUser.isAdmin) {
    alert('Недостаточно прав');
    return;
  }

  try {
    // Получаем текущий статус
    const statusResponse = await fetch('/api/admin/auto-counting-status');
    const statusData = await statusResponse.json();

    // Переключаем
    const response = await fetch('/api/admin/toggle-auto-counting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: state.currentUser.username })
    });

    if (response.ok) {
      const data = await response.json();
      const newStatus = data.enabled;

      // Обновляем кнопку
      const btn = document.getElementById('autoCountingBtn');
      if (btn) {
        btn.style.borderColor = newStatus ? '#4caf50' : '#f44336';
        btn.style.color = newStatus ? '#4caf50' : '#f44336';
        btn.title = `Автоподсчет: ${newStatus ? 'включен' : 'выключен'}`;
      }

      await showCustomAlert(
        data.message,
        newStatus ? '✅ Включено' : '⏸️ Выключено',
        newStatus ? '✅' : '⏸️'
      );
    } else {
      const error = await response.json();
      await showCustomAlert(error.error || 'Ошибка переключения', 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка переключения автоподсчета:', error);
    await showCustomAlert('Ошибка переключения автоподсчета', 'Ошибка', '❌');
  }
}

/**
 * Загрузить статус автоподсчета при загрузке страницы
 */
export async function loadAutoCountingStatus() {
  if (!state.currentUser || !state.currentUser.isAdmin) {
    return;
  }

  try {
    const response = await fetch('/api/admin/auto-counting-status');
    const data = await response.json();

    const btn = document.getElementById('autoCountingBtn');
    if (btn) {
      btn.style.borderColor = data.enabled ? '#4caf50' : '#f44336';
      btn.style.color = data.enabled ? '#4caf50' : '#f44336';
      btn.title = `Автоподсчет: ${data.enabled ? 'включен' : 'выключен'}`;
    }
  } catch (error) {
    console.error('Ошибка загрузки статуса автоподсчета:', error);
  }
}

// ============================================
// МОДАЛКА ТЕСТОВ
// ============================================

/**
 * Открыть модалку тестов
 */
export async function openTestsModal() {
  const modal = document.getElementById('testsModal');
  if (modal) {
    modal.style.display = 'flex';

    // Загружаем настройку из localStorage
    const testRealGroup = localStorage.getItem('testRealGroup') === 'true';
    const checkbox = document.getElementById('testRealGroupCheckbox');
    if (checkbox) {
      checkbox.checked = testRealGroup;
    }

    // Загружаем список турниров
    try {
      const response = await fetch('/api/events');
      const events = await response.json();

      const select = document.getElementById('testEventSelect');
      if (select) {
        select.innerHTML = '<option value="">Выберите турнир...</option>';

        events.forEach(event => {
          const option = document.createElement('option');
          option.value = event.id;
          option.textContent = event.name;
          select.appendChild(option);
        });

        // Если есть выбранный турнир, выбираем его
        if (state.currentEventId) {
          select.value = state.currentEventId;
        }
      }
    } catch (error) {
      console.error('Ошибка загрузки турниров:', error);
    }
  }
}

/**
 * Закрыть модалку тестов
 */
export function closeTestsModal() {
  const modal = document.getElementById('testsModal');
  if (modal) {
    modal.style.display = 'none';

    // Сохраняем настройку в localStorage
    const checkbox = document.getElementById('testRealGroupCheckbox');
    if (checkbox) {
      localStorage.setItem('testRealGroup', checkbox.checked);
    }
  }
}

/**
 * Тест автоподсчета
 */
export async function testAutoCounting() {
  if (!state.currentUser || !state.currentUser.isAdmin) {
    await showCustomAlert('Недостаточно прав', 'Ошибка', '❌');
    return;
  }

  // Берем турнир из селекта в модалке
  const select = document.getElementById('testEventSelect');
  const eventId = select ? parseInt(select.value) : null;

  if (!eventId) {
    await showCustomAlert('Выберите турнир из списка', 'Ошибка', '❌');
    return;
  }

  const testRealGroup = document.getElementById('testRealGroupCheckbox')?.checked || false;

  const confirmed = await showCustomConfirm(
    `Запустить тест автоподсчета для выбранного турнира?\n\n` +
    `Режим: ${testRealGroup ? '📢 Отправка в реальную группу' : '👤 Только админу'}\n\n` +
    `Это симулирует завершение всех матчей и запустит автоподсчет.`,
    'Подтверждение',
    '🧪'
  );

  if (!confirmed) return;

  try {
    const response = await fetch('/api/admin/test-auto-counting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser.username,
        eventId: eventId,
        testMode: !testRealGroup
      })
    });

    if (response.ok) {
      const data = await response.json();
      await showCustomAlert(
        data.message || 'Тест автоподсчета запущен',
        'Успешно',
        '✅'
      );

      // Закрываем модалку
      closeTestsModal();

      // Если это текущий турнир, перезагружаем матчи
      if (state.currentEventId && state.currentEventId === eventId) {
        setTimeout(() => {
          loadMatches(eventId);
        }, 2000);
      }
    } else {
      const error = await response.json();
      await showCustomAlert(error.error || 'Ошибка теста', 'Ошибка', '❌');
    }
  } catch (error) {
    console.error('Ошибка теста автоподсчета:', error);
    await showCustomAlert('Ошибка теста автоподсчета', 'Ошибка', '❌');
  }
}
