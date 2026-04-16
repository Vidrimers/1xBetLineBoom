// Модуль пересчёта результатов
import * as state from './state.js';
import { showCustomAlert, showCustomConfirm } from './ui.js';
import { canViewCounting } from './admin.js';

// Отправить результаты подсчёта
export async function sendCountingResults() {
  if (!canViewCounting()) {
    alert("У вас нет прав");
    return;
  }

  const dateFrom = document.getElementById("countingDateFrom")?.value;
  const dateTo = document.getElementById("countingDateTo")?.value;

  if (!dateFrom || !dateTo) {
    alert("Выберите период дат");
    return;
  }

  try {
    const response = await fetch('/api/admin/send-counting-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateFrom, dateTo })
    });

    if (response.ok) {
      await showCustomAlert("Результаты отправлены в группу!", "Успешно", "✅");
    } else {
      const error = await response.json();
      await showCustomAlert(error.error || "Не удалось отправить результаты", "Ошибка", "❌");
    }
  } catch (error) {
    console.error("Ошибка отправки результатов:", error);
    await showCustomAlert("Ошибка при отправке результатов", "Ошибка", "❌");
  }
}

// Открыть модалку пересчёта
export async function openRecountModal() {
  if (!canViewCounting()) {
    alert("У вас нет прав");
    return;
  }

  try {
    // Очищаем прогнозы для матчей с отключёнными чекбоксами
    const cleanupResponse = await fetch('/api/admin/cleanup-disabled-predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser.username
      })
    });

    if (cleanupResponse.ok) {
      const result = await cleanupResponse.json();
      console.log('✅ Очистка прогнозов:', result);
    }
  } catch (error) {
    console.error("⚠️ Ошибка очистки прогнозов:", error);
  }

  // Устанавливаем текущую дату по умолчанию
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('recountDate').value = today;

  // Загружаем список турниров
  await loadEventsForRecount(today);

  document.getElementById('recountModal').style.display = 'flex';
}

// Загрузить список турниров для выбранной даты
export async function loadEventsForRecount(date) {
  try {
    const response = await fetch(`/api/admin/get-events-for-date?date=${date}`);

    if (response.ok) {
      const data = await response.json();
      const eventSelect = document.getElementById('recountEvent');
      const roundSelect = document.getElementById('recountRound');

      // Очищаем списки
      eventSelect.innerHTML = '<option value="">Выберите турнир...</option>';
      roundSelect.innerHTML = '<option value="">Сначала выберите турнир...</option>';
      roundSelect.disabled = true;

      // Добавляем турниры
      if (data.events && data.events.length > 0) {
        data.events.forEach(event => {
          const option = document.createElement('option');
          option.value = event.event_id;
          option.textContent = `${event.event_name} (${event.matches_count} матчей)`;
          eventSelect.appendChild(option);
        });
      } else {
        eventSelect.innerHTML = '<option value="">Нет турниров для этой даты</option>';
      }
    }
  } catch (error) {
    console.error("Ошибка загрузки турниров:", error);
  }
}

// Загрузить список туров для выбранного турнира и даты
export async function loadRoundsForRecount(eventId, date) {
  try {
    const response = await fetch(`/api/admin/get-rounds-for-event?eventId=${eventId}&date=${date}`);

    if (response.ok) {
      const data = await response.json();
      const roundSelect = document.getElementById('recountRound');

      // Очищаем список
      roundSelect.innerHTML = '<option value="">Выберите тур...</option>';
      roundSelect.disabled = false;

      // Добавляем туры
      if (data.rounds && data.rounds.length > 0) {
        data.rounds.forEach(round => {
          const option = document.createElement('option');
          option.value = round.round;
          option.textContent = `${round.round} (${round.matches_count} матчей, завершено: ${round.finished_count})`;
          roundSelect.appendChild(option);
        });
      } else {
        roundSelect.innerHTML = '<option value="">Нет туров для этого турнира</option>';
      }
    }
  } catch (error) {
    console.error("Ошибка загрузки туров:", error);
  }
}

// Закрыть модалку пересчёта
export function closeRecountModal() {
  document.getElementById('recountModal').style.display = 'none';
}

// Подтвердить пересчёт
export async function confirmRecount() {
  const date = document.getElementById('recountDate').value;
  const round = document.getElementById('recountRound').value.trim();
  const eventId = document.getElementById('recountEvent').value;
  const sendToGroup = document.getElementById('recountSendToGroup').checked;
  const sendToUsers = document.getElementById('recountSendToUsers').checked;

  if (!date) {
    await showCustomAlert("Выберите дату", "Ошибка", "❌");
    return;
  }

  if (!round) {
    await showCustomAlert("Выберите тур", "Ошибка", "❌");
    return;
  }

  // Форматируем дату для отображения
  const dateObj = new Date(date);
  const formattedDate = dateObj.toLocaleDateString('ru-RU');

  // Формируем сообщение подтверждения
  let confirmMessage = `<div style="text-align: left; line-height: 1.8;">
    <p style="margin-bottom: 15px;"><strong>Вы уверены что хотите пересчитать результаты?</strong></p>
    
    <div style="background: rgba(255, 152, 0, 0.1); padding: 12px; border-radius: 5px; margin-bottom: 15px;">
      <div style="margin-bottom: 8px;">📅 <strong>Дата:</strong> ${formattedDate}</div>
      <div>🏆 <strong>Тур:</strong> ${round}</div>
    </div>
    
    <p style="margin-bottom: 10px;"><strong>Это действие:</strong></p>
    <ul style="margin: 0; padding-left: 20px;">
      <li>Сбросит результаты матчей</li>
      <li>Пересчитает их заново</li>`;

  if (sendToGroup) {
    confirmMessage += `\n      <li style="color: rgb(76, 175, 80);">✅ Отправит результаты в группу</li>`;
  }

  if (sendToUsers) {
    confirmMessage += `\n      <li style="color: rgb(76, 175, 80);">✅ Отправит результаты пользователям в ЛС</li>`;
  }

  confirmMessage += `
    </ul>
  </div>`;

  const confirmed = await showCustomConfirm(confirmMessage, "Подтверждение пересчёта", "⚠️");

  if (!confirmed) {
    return;
  }

  try {
    closeRecountModal();

    // Показываем индикатор загрузки
    await showCustomAlert("Пересчёт результатов...", "Обработка", "⏳");

    const response = await fetch('/api/admin/recount-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser.username,
        date,
        round,
        eventId,
        sendToGroup,
        sendToUsers
      })
    });

    if (response.ok) {
      const result = await response.json();
      await showCustomAlert(
        result.message || "Результаты успешно пересчитаны!",
        "Успешно",
        "✅"
      );

      // Обновляем данные подсчёта если они отображаются
      const countingContent = document.getElementById('counting-content');
      if (countingContent && countingContent.style.display !== 'none') {
        if (typeof window.loadCounting === 'function') window.loadCounting();
      }
    } else {
      const error = await response.json();
      await showCustomAlert(
        error.error || "Не удалось пересчитать результаты",
        "Ошибка",
        "❌"
      );
    }
  } catch (error) {
    console.error("Ошибка пересчёта результатов:", error);
    await showCustomAlert("Ошибка при пересчёте результатов", "Ошибка", "❌");
  }
}

// Инициализация обработчиков событий для модалки пересчёта
export function initRecountListeners() {
  const recountDateInput = document.getElementById('recountDate');
  if (recountDateInput) {
    recountDateInput.addEventListener('change', (e) => {
      loadEventsForRecount(e.target.value);
    });
  }

  const recountEventSelect = document.getElementById('recountEvent');
  if (recountEventSelect) {
    recountEventSelect.addEventListener('change', (e) => {
      const eventId = e.target.value;
      const date = document.getElementById('recountDate').value;
      if (eventId && date) {
        loadRoundsForRecount(eventId, date);
      } else {
        const roundSelect = document.getElementById('recountRound');
        roundSelect.innerHTML = '<option value="">Сначала выберите турнир...</option>';
        roundSelect.disabled = true;
      }
    });
  }
}
