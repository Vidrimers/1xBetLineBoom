import { currentUser, currentEventId, selectedReminderHours } from './state.js';
import * as state from './state.js';
import { setSelectedReminderHours } from './state.js';
import { showCustomAlert } from './ui.js';

// ===== НАПОМИНАНИЯ О МАТЧАХ =====

// Показать модалку напоминаний о матчах
export async function showMatchRemindersModal(event) {
  if (event) event.stopPropagation();

  // Проверяем авторизацию
  if (!currentUser) {
    if (typeof showCustomAlert === 'function') {
      showCustomAlert('Войдите в систему чтобы настроить напоминания', 'Требуется авторизация', '<svg class="icon" aria-hidden="true"><use href="#icon-hidden"></use></svg>');
    }
    return;
  }

  // Проверяем выбран ли турнир
  if (!currentEventId) {
    if (typeof showCustomAlert === 'function') {
      showCustomAlert('Выберите турнир чтобы настроить напоминания', 'Турнир не выбран', '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>️');
    }
    return;
  }

  const modal = document.getElementById('matchRemindersModal');
  if (modal) {
    modal.style.display = 'flex';
    setSelectedReminderHours(null);

    // Сбрасываем выбор
    document.querySelectorAll('.reminder-time-btn').forEach(btn => {
      btn.classList.remove('selected');
    });

    // Загружаем текущие настройки
    await loadMatchReminders();
  }
}

// Закрыть модалку напоминаний
export function closeMatchRemindersModal() {
  const modal = document.getElementById('matchRemindersModal');
  if (modal) {
    modal.style.display = 'none';
    setSelectedReminderHours(null);
  }
}

// Выбрать время напоминания
export function selectReminderTime(hours) {
  setSelectedReminderHours(hours);

  // Обновляем визуальное состояние кнопок
  document.querySelectorAll('.reminder-time-btn').forEach(btn => {
    if (parseInt(btn.dataset.hours) === hours) {
      btn.classList.add('selected');
    } else {
      btn.classList.remove('selected');
    }
  });
}

// Обновить индикатор напоминаний
export function updateReminderIndicator(hasReminder) {
  const indicator = document.getElementById('reminderIndicator');
  if (indicator) {
    indicator.style.display = hasReminder ? 'block' : 'none';
  }
}

// Загрузить текущие настройки напоминаний
export async function loadMatchReminders() {
  if (!currentUser || !currentEventId) return;

  try {
    const response = await fetch(`/api/user/${currentUser.id}/event/${currentEventId}/reminders`);

    if (response.ok) {
      const data = await response.json();

      if (data.hours_before) {
        setSelectedReminderHours(data.hours_before);

        // Выделяем соответствующую кнопку
        document.querySelectorAll('.reminder-time-btn').forEach(btn => {
          if (parseInt(btn.dataset.hours) === data.hours_before) {
            btn.classList.add('selected');
          }
        });

        // Показываем кнопку удаления
        const deleteBtn = document.getElementById('deleteReminderBtn');
        if (deleteBtn) {
          deleteBtn.style.display = 'block';
        }

        // Показываем индикатор
        updateReminderIndicator(true);
      } else {
        // Скрываем кнопку удаления если напоминаний нет
        const deleteBtn = document.getElementById('deleteReminderBtn');
        if (deleteBtn) {
          deleteBtn.style.display = 'none';
        }

        // Скрываем индикатор
        updateReminderIndicator(false);
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки настроек напоминаний:', error);
  }
}

// Сохранить настройки напоминаний
export async function saveMatchReminders() {
  if (!currentUser || !currentEventId) return;

  if (!state.selectedReminderHours) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Выберите время напоминания', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>️');
    }
    return;
  }

  // Проверяем привязку Telegram
  if (!currentUser.telegram_username) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(
        'Для получения напоминаний необходимо привязать Telegram аккаунт.\n\nПерейдите в настройки профиля и свяжите свой аккаунт с ботом.',
        'Telegram не привязан',
        '<svg class="icon" aria-hidden="true"><use href="#icon-telegram"></use></svg>'
      );
    }
    closeMatchRemindersModal();
    return;
  }

  // Проверяем включены ли уведомления
  if (currentUser.telegram_notifications_enabled !== 1) {
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(
        'У вас отключено получение личных сообщений от бота.\n\nВключите уведомления в настройках профиля чтобы получать напоминания.',
        'Уведомления отключены',
        '<svg class="icon" aria-hidden="true"><use href="#icon-muted"></use></svg>'
      );
    }
    closeMatchRemindersModal();
    return;
  }

  try {
    const response = await fetch(`/api/user/${currentUser.id}/event/${currentEventId}/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours_before: state.selectedReminderHours })
    });

    if (response.ok) {
      // Показываем индикатор
      updateReminderIndicator(true);

      if (typeof showCustomAlert === 'function') {
        await showCustomAlert(
          `Напоминания настроены! Вы будете получать уведомления за ${state.selectedReminderHours} ${state.selectedReminderHours === 1 ? 'час' : state.selectedReminderHours < 5 ? 'часа' : 'часов'} до начала матчей турнира.`,
          'Успешно',
          '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
        );
      }
      closeMatchRemindersModal();
    } else {
      const error = await response.json();
      if (typeof showCustomAlert === 'function') {
        await showCustomAlert(
          error.error || 'Не удалось сохранить настройки напоминаний',
          'Ошибка',
          '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'
        );
      }
    }
  } catch (error) {
    console.error('Ошибка сохранения настроек напоминаний:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(
        'Произошла ошибка при сохранении настроек',
        'Ошибка',
        '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'
      );
    }
  }
}

// Удалить настройки напоминаний
export async function deleteMatchReminders() {
  if (!currentUser || !currentEventId) return;

  try {
    const response = await fetch(`/api/user/${currentUser.id}/event/${currentEventId}/reminders`, {
      method: 'DELETE'
    });

    if (response.ok) {
      // Скрываем индикатор
      updateReminderIndicator(false);

      if (typeof showCustomAlert === 'function') {
        await showCustomAlert(
          'Напоминания для этого турнира отключены',
          'Успешно',
          '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
        );
      }
      closeMatchRemindersModal();
    } else {
      if (typeof showCustomAlert === 'function') {
        await showCustomAlert(
          'Не удалось удалить настройки напоминаний',
          'Ошибка',
          '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'
        );
      }
    }
  } catch (error) {
    console.error('Ошибка удаления настроек напоминаний:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert(
        'Произошла ошибка при удалении настроек',
        'Ошибка',
        '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'
      );
    }
  }
}
