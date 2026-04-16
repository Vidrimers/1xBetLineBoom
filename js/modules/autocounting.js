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
