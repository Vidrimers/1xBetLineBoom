import * as state from './state.js';
import { lockBodyScroll, unlockBodyScroll, showCustomAlert, showCustomConfirm } from './ui.js';
import { initCustomSelect, setCustomSelectValue } from './customSelect.js';
import { loadEventsList } from './events.js';

// Открыть модальное окно создания турнира
export function openCreateEventModal() {
  console.log("🔧 openCreateEventModal called");
  const modal = document.getElementById("createEventModal");
  console.log("🔧 modal element:", modal);
  if (modal) {
    lockBodyScroll();
    modal.style.display = "flex";
    document
      .getElementById("customIconCheckbox")
      .addEventListener("change", handleCreateEventIconChange);
    initCustomSelect("eventIconSelect");
    console.log("🔧 modal opened successfully");
  } else {
    console.error("🔧 createEventModal not found!");
  }
}

// Закрыть модальное окно создания турнира
export function closeCreateEventModal() {
  document.getElementById("createEventModal").style.display = "none";
  unlockBodyScroll();
  document.getElementById("createEventForm").reset();
  document.getElementById("customIconGroup").style.display = "none";
  document
    .getElementById("customIconCheckbox")
    .removeEventListener("change", handleCreateEventIconChange);
}

// Открыть модальное окно редактирования турнира
export function openEditEventModal(eventId) {
  console.log("🔧 openEditEventModal called with eventId:", eventId);
  // Загружаем данные о турнире
  fetch(`/api/events/${eventId}`)
    .then((response) => {
      console.log("🔧 fetch response status:", response.status);
      return response.json();
    })
    .then((event) => {
      console.log("🔧 fetched event data:", event);
      // Заполняем форму данными
      document.getElementById("editEventId").value = event.id;
      document.getElementById("editEventName").value = event.name;
      document.getElementById("editEventDescription").value =
        event.description || "";
      document.getElementById("editEventDate").value = event.start_date
        ? event.start_date.split("T")[0]
        : "";
      document.getElementById("editEventEndDate").value = event.end_date
        ? event.end_date.split("T")[0]
        : "";

      // Устанавливаем иконку
      const customIconCheckbox = document.getElementById(
        "editCustomIconCheckbox"
      );
      const customIconGroup = document.getElementById("editCustomIconGroup");
      const customIconInput = document.getElementById("editEventCustomIcon");

      if (event.icon) {
        // Проверяем, есть ли такая опция в кастомном select
        const item = document.querySelector(
          `#editEventIconSelect div[data-value="${event.icon}"]`
        );
        if (item) {
          setCustomSelectValue("editEventIconSelect", event.icon);
          customIconCheckbox.checked = false;
          customIconGroup.style.display = "none";
        } else {
          // Это кастомная иконка
          customIconCheckbox.checked = true;
          customIconInput.value = event.icon;
          customIconGroup.style.display = "block";
        }
      } else {
        setCustomSelectValue("editEventIconSelect", "icon-trophy");
        customIconCheckbox.checked = false;
        customIconGroup.style.display = "none";
      }

      // Устанавливаем цвет фона
      document.getElementById("editEventBackgroundColor").value =
        event.background_color || "transparent";
      
      // Устанавливаем team_file
      document.getElementById("editEventTeamFile").value = event.team_file || "";

      // Показываем модальное окно
      const modal = document.getElementById("editEventModal");
      console.log("🔧 editEventModal element:", modal);
      if (modal) {
        lockBodyScroll();
        modal.style.display = "flex";
        document
          .getElementById("editCustomIconCheckbox")
          .addEventListener("change", handleEditEventIconChange);
        initCustomSelect("editEventIconSelect");
        console.log("🔧 edit modal opened successfully");
      } else {
        console.error("🔧 editEventModal not found!");
      }
    })
    .catch((error) => {
      console.error("❌ Ошибка при загрузке данных турнира:", error);
      alert("Ошибка при загрузке данных турнира: " + error.message);
    });
}

// Закрыть модальное окно редактирования турнира
export function closeEditEventModal() {
  document.getElementById("editEventModal").style.display = "none";
  unlockBodyScroll();
  document.getElementById("editEventForm").reset();
  document.getElementById("editCustomIconGroup").style.display = "none";
  document
    .getElementById("editCustomIconCheckbox")
    .removeEventListener("change", handleEditEventIconChange);
}

// Обработчик изменения иконки для создания турнира
export function handleEventIconChange() {
  const select = document.getElementById("eventIcon");
  const customGroup = document.getElementById("customIconGroup");
  customGroup.style.display = select.value === "custom" ? "block" : "none";
}

// Обработчик изменения чекбокса кастомной иконки для редактирования турнира
export function handleEditEventIconChange() {
  console.log("handleEditEventIconChange called");
  const customIconGroup = document.getElementById("editCustomIconGroup");
  console.log("edit customIconGroup:", customIconGroup);
  if (customIconGroup) {
    customIconGroup.style.display = this.checked ? "block" : "none";
    console.log("Set edit display to:", customIconGroup.style.display);
  }
}

// Обработчик изменения чекбокса кастомной иконки для создания турнира
export function handleCreateEventIconChange() {
  console.log("handleCreateEventIconChange called");
  const customIconGroup = document.getElementById("customIconGroup");
  console.log("create customIconGroup:", customIconGroup);
  if (customIconGroup) {
    customIconGroup.style.display = this.checked ? "block" : "none";
    console.log("Set create display to:", customIconGroup.style.display);
  }
}

// Отправить форму создания турнира
export async function submitCreateEvent(event) {
  event.preventDefault();

  const eventData = {
    username: state.currentUser.username,
    name: document.getElementById("eventName").value,
    description: document.getElementById("eventDescription").value,
    start_date: document.getElementById("eventDate").value || null,
    end_date: document.getElementById("eventEndDate").value || null,
    team_file: document.getElementById("eventTeamFile").value || null,
    sendToUsers: document.getElementById("sendToUsersCheckbox").checked,
    sendToGroup: document.getElementById("sendToGroupCheckbox").checked,
  };

  // Определяем иконку
  const iconSelect = document.getElementById("eventIcon");
  if (iconSelect.value === "custom") {
    eventData.icon = document.getElementById("eventCustomIcon").value;
  } else {
    eventData.icon = iconSelect.value;
  }

  // Определяем цвет фона
  eventData.background_color = document.getElementById(
    "eventBackgroundColor"
  ).value;

  try {
    const response = await fetch("/api/admin/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventData),
    });

    const result = await response.json();

    if (response.ok) {
      closeCreateEventModal();
      loadEventsList();
    } else {
      alert(result.error || "Ошибка при создании турнира");
    }
  } catch (error) {
    console.error("Ошибка:", error);
    alert("Ошибка при создании турнира");
  }
}

// Отправить форму редактирования турнира
export async function submitEditEvent(event) {
  event.preventDefault();

  const eventId = document.getElementById("editEventId").value;
  const eventData = {
    username: state.currentUser.username,
    name: document.getElementById("editEventName").value.trim(),
    description: document.getElementById("editEventDescription").value.trim(),
    start_date: document.getElementById("editEventDate").value || null,
    end_date: document.getElementById("editEventEndDate").value || null,
    team_file: document.getElementById("editEventTeamFile").value || null,
  };

  // Проверяем обязательные поля
  if (!eventData.name) {
    alert("Название турнира обязательно");
    return;
  }

  // Определяем иконку
  const iconSelect = document.getElementById("editEventIcon");
  const customIconCheckbox = document.getElementById("editCustomIconCheckbox");
  if (customIconCheckbox.checked) {
    eventData.icon = document.getElementById("editEventCustomIcon").value;
  } else {
    eventData.icon = iconSelect.value;
  }

  // Определяем цвет фона
  eventData.background_color = document.getElementById(
    "editEventBackgroundColor"
  ).value;

  try {
    const response = await fetch(`/api/admin/events/${eventId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventData),
    });

    const result = await response.json();

    if (response.ok) {
      closeEditEventModal();
      loadEventsList();
    } else {
      alert(result.error || "Ошибка при обновлении турнира");
    }
  } catch (error) {
    console.error("Ошибка:", error);
    alert("Ошибка при обновлении турнира");
  }
}

// Предпросмотр объявления о турнире
export function previewTournamentAnnouncement(event) {
  event.preventDefault();
  
  // Собираем данные турнира
  const name = document.getElementById("eventName").value.trim();
  const description = document.getElementById("eventDescription").value.trim();
  const startDate = document.getElementById("eventDate").value;
  const endDate = document.getElementById("eventEndDate").value;
  
  if (!name) {
    alert('Введите название турнира');
    return;
  }
  
  // Форматируем даты
  let dateText = '';
  if (startDate && endDate) {
    const start = new Date(startDate).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const end = new Date(endDate).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    dateText = `<svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> Даты: ${start} - ${end}`;
  } else if (startDate) {
    const start = new Date(startDate).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    dateText = `<svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> Начало: ${start}`;
  }
  
  // Формируем сообщение
  let message = `<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> <b>НОВЫЙ ТУРНИР!</b>\n\n`;
  message += `<b>${name}</b>\n\n`;
  
  if (description) {
    message += `<svg class="icon" aria-hidden="true"><use href="#icon-manual"></use></svg> ${description}\n\n`;
  }
  
  if (dateText) {
    message += `${dateText}\n\n`;
  }
  
  message += `Приготовьтесь делать прогнозы! <svg class="icon" aria-hidden="true"><use href="#icon-custom-tournament"></use></svg>\n\n`;
  message += `<svg class="icon" aria-hidden="true"><use href="#icon-telegram"></use></svg> <a href="http://${window.location.hostname}:${window.location.port}">Открыть сайт</a>`;
  
  // Показываем предпросмотр (конвертируем HTML в читаемый текст)
  const previewText = message
    .replace(/<b>/g, '**')
    .replace(/<\/b>/g, '**')
    .replace(/<a href="[^"]*">/g, '')
    .replace(/<\/a>/g, '')
    .replace(/\n/g, '\n');
  
  document.getElementById('announcementPreview').innerHTML = previewText.replace(/\n/g, '<br>');
  
  // Сохраняем данные для отправки
  window.tournamentAnnouncementData = {
    name,
    description,
    startDate,
    endDate,
    message
  };
  
  // Открываем модальное окно предпросмотра
  document.getElementById('tournamentAnnouncementModal').style.display = 'flex';
  lockBodyScroll();
}

// Закрыть модальное окно предпросмотра объявления
export function closeTournamentAnnouncementModal() {
  document.getElementById('tournamentAnnouncementModal').style.display = 'none';
  unlockBodyScroll();
}

// Форматирование текста в textarea
export function formatText(type) {
  const textarea = document.getElementById('announcementText');
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = textarea.value.substring(start, end);
  
  if (!selectedText && (type === 'bold' || type === 'italic' || type === 'code')) {
    alert('Выделите текст для форматирования');
    return;
  }
  
  let formattedText = '';
  let cursorOffset = 0;
  
  switch(type) {
    case 'bold':
      formattedText = `*${selectedText}*`;
      cursorOffset = selectedText.length + 2;
      break;
    case 'italic':
      formattedText = `_${selectedText}_`;
      cursorOffset = selectedText.length + 2;
      break;
    case 'code':
      formattedText = `\`${selectedText}\``;
      cursorOffset = selectedText.length + 2;
      break;
    case 'bullet':
      // Если текст выделен - добавляем маркер к каждой строке
      if (selectedText) {
        formattedText = selectedText.split('\n').map(line => line.trim() ? `• ${line}` : line).join('\n');
        cursorOffset = formattedText.length;
      } else {
        // Если ничего не выделено - вставляем шаблон
        formattedText = '• ';
        cursorOffset = 2;
      }
      break;
    case 'number':
      // Если текст выделен - добавляем нумерацию к каждой строке
      if (selectedText) {
        let counter = 1;
        formattedText = selectedText.split('\n').map(line => line.trim() ? `${counter++}. ${line}` : line).join('\n');
        cursorOffset = formattedText.length;
      } else {
        // Если ничего не выделено - вставляем шаблон
        formattedText = '1. ';
        cursorOffset = 3;
      }
      break;
  }
  
  // Заменяем выделенный текст на отформатированный
  textarea.value = textarea.value.substring(0, start) + formattedText + textarea.value.substring(end);
  
  // Устанавливаем курсор в конец отформатированного текста
  textarea.focus();
  textarea.setSelectionRange(start + cursorOffset, start + cursorOffset);
  
  // Обновляем предпросмотр
  textarea.dispatchEvent(new Event('input'));
}

// Вставка эмодзи в позицию курсора
export function insertEmoji(emoji) {
  const textarea = document.getElementById('announcementText');
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  
  // Вставляем эмодзи в позицию курсора
  textarea.value = textarea.value.substring(0, start) + emoji + textarea.value.substring(end);
  
  // Устанавливаем курсор после эмодзи
  const newPosition = start + emoji.length;
  textarea.focus();
  textarea.setSelectionRange(newPosition, newPosition);
  
  // Обновляем предпросмотр
  textarea.dispatchEvent(new Event('input'));
}

// Открыть модальное окно объявления о новых функциях
export function openAnnouncementModal() {
  document.getElementById('featureAnnouncementModal').style.display = 'flex';
  lockBodyScroll();
  
  // Добавляем обработчик для предпросмотра
  const titleInput = document.getElementById('announcementTitle');
  const textInput = document.getElementById('announcementText');
  const preview = document.getElementById('announcementPreviewText');
  
  function updatePreview() {
    const title = titleInput.value.trim();
    const text = textInput.value.trim();
    
    if (!title && !text) {
      preview.innerHTML = 'Введите текст чтобы увидеть предпросмотр...';
      return;
    }
    
    let previewText = '';
    if (title) {
      previewText += `<b>${title}</b>\n\n`;
    }
    if (text) {
      // Применяем то же форматирование что и на сервере
      let formatted = text;
      
      // *текст* → жирный
      formatted = formatted.replace(/\*([^*]+)\*/g, '<b>$1</b>');
      
      // _текст_ → курсив
      formatted = formatted.replace(/_([^_]+)_/g, '<i>$1</i>');
      
      // `текст` → моноширинный
      formatted = formatted.replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 3px;">$1</code>');
      
      // Списки с • или -
      formatted = formatted.replace(/^[•\-]\s+(.+)$/gm, '  ▪️ $1');
      
      // Цифровые списки
      formatted = formatted.replace(/^(\d+)\.\s+(.+)$/gm, '  <b>$1.</b> $2');
      
      // Подпункты
      formatted = formatted.replace(/^\s{2,}([•\-])\s+(.+)$/gm, '     ◦ $2');
      
      previewText += formatted;
    }
    
    preview.innerHTML = previewText.replace(/\n/g, '<br>');
  }
  
  titleInput.addEventListener('input', updatePreview);
  textInput.addEventListener('input', updatePreview);
  
  updatePreview();
}

// Закрыть модальное окно объявления
export function closeAnnouncementModal() {
  document.getElementById('featureAnnouncementModal').style.display = 'none';
  unlockBodyScroll();
  document.getElementById('featureAnnouncementForm').reset();
  document.getElementById('announcementPreviewText').innerHTML = 'Введите текст чтобы увидеть предпросмотр...';
}

// Отправить объявление себе для проверки
export async function sendAnnouncementToSelf() {
  const title = document.getElementById('announcementTitle').value.trim();
  const text = document.getElementById('announcementText').value.trim();
  
  if (!title || !text) {
    alert('Заполните все поля');
    return;
  }
  
  try {
    const response = await fetch('/api/admin/send-feature-announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser.username,
        title,
        text,
        testMode: true
      })
    });
    
    const result = await response.json();
    
    if (response.ok) {
      if (typeof showCustomAlert === 'function') {
        showCustomAlert('Тестовое сообщение отправлено вам в Telegram', 'Успешно', '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');
      } else {
        alert('Тестовое сообщение отправлено вам в Telegram');
      }
    } else {
      alert(result.error || 'Ошибка при отправке');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    alert('Ошибка при отправке');
  }
}

// Отправить объявление всем пользователям
export async function sendAnnouncementToAll() {
  const title = document.getElementById('announcementTitle').value.trim();
  const text = document.getElementById('announcementText').value.trim();
  
  if (!title || !text) {
    await showCustomAlert('Заполните все поля');
    return;
  }
  
  const confirmed = await showCustomConfirm('Отправить объявление всем пользователям с включенными уведомлениями?');
  if (!confirmed) {
    return;
  }
  
  try {
    const response = await fetch('/api/admin/send-feature-announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser.username,
        title,
        text,
        testMode: false
      })
    });
    
    const result = await response.json();
    
    if (response.ok) {
      closeAnnouncementModal();
      if (typeof showCustomAlert === 'function') {
        showCustomAlert(
          `Объявление отправлено: ${result.successCount} успешно, ${result.errorCount} ошибок`,
          'Успешно',
          '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
        );
      } else {
        alert(`Объявление отправлено: ${result.successCount} успешно, ${result.errorCount} ошибок`);
      }
    } else {
      alert(result.error || 'Ошибка при отправке');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    alert('Ошибка при отправке');
  }
}

// Отправить объявление о турнире админу
export async function sendTournamentAnnouncementToAdmin() {
  if (!window.tournamentAnnouncementData) {
    alert('Ошибка: данные турнира не найдены');
    return;
  }
  
  try {
    const response = await fetch('/api/admin/send-tournament-announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser.username,
        ...window.tournamentAnnouncementData
      })
    });
    
    const result = await response.json();
    
    if (response.ok) {
      closeTournamentAnnouncementModal();
      if (typeof showCustomAlert === 'function') {
        showCustomAlert('Объявление отправлено админу на проверку', 'Успешно', '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');
      } else {
        alert('Объявление отправлено админу на проверку');
      }
    } else {
      alert(result.error || 'Ошибка при отправке объявления');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    alert('Ошибка при отправке объявления');
  }
}

// Открыть модальное окно информации о турнире
export async function openTournamentInfoModal() {
  // Отправляем уведомление админу
  try {
    await fetch('/api/notify-tournament-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser?.username || 'Неизвестный',
        eventName: window.currentEventName || null
      })
    });
  } catch (notifyError) {
    console.error('Ошибка отправки уведомления:', notifyError);
  }

  // Блокируем body
  document.body.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  // Закрытие по клику вне модалки
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      document.body.style.overflow = '';
    }
  });
  
  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 700px;
      width: 95%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      position: relative;
      color: #e0e6f0;
    ">
      <button onclick="this.closest('div[style*=fixed]').remove(); document.body.style.overflow = '';" style="
        position: absolute;
        top: 15px;
        right: 15px;
        background: transparent;
        border: none;
        color: #e0e6f0;
        font-size: 24px;
        cursor: pointer;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background 0.2s;
      " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">×</button>
      
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">ℹ️ Информация о турнире</h3>
      
      <div style="line-height: 1.6;">
        <h4 style="color: #ff9800; margin: 20px 0 10px 0;"><svg class="icon" aria-hidden="true"><use href="#icon-custom-tournament"></use></svg> Система начисления очков</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <div style="margin-bottom: 10px;">
            <strong style="color: #4caf50;">Обычные матчи:</strong>
            <ul style="margin: 5px 0; padding-left: 20px;">
              <li><strong>1 очко</strong> — за угаданный результат (победа команды 1, победа команды 2 или ничья)</li>
              <li><strong>+1 очко</strong> — дополнительно за точный счет (если угадан результат)</li>
            </ul>
          </div>
          <div style="margin-bottom: 10px;">
            <strong style="color: #4caf50;">Финальные матчи:</strong>
            <ul style="margin: 5px 0; padding-left: 20px;">
              <li><strong>3 очка</strong> — за угаданный результат</li>
              <li><strong>+1 очко</strong> — дополнительно за точный счет</li>
            </ul>
          </div>
          <div>
            <strong style="color: #4caf50;">Финальные параметры:</strong>
            <ul style="margin: 5px 0; padding-left: 20px;">
              <li><strong>1 очко</strong> — за каждый угаданный параметр (желтые карточки, красные карточки, угловые, точный счет, пенальти в игре, дополнительное время, серия пенальти)</li>
            </ul>
          </div>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;"><svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Сортировка участников</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <p style="margin: 0 0 10px 0;">Участники сортируются по следующим критериям (в порядке приоритета):</p>
          <ol style="margin: 5px 0; padding-left: 20px;">
            <li><strong>Больше очков</strong> — чем больше очков набрано, тем выше место</li>
            <li><strong>Больше выигранных ставок</strong> — при равных очках учитывается количество угаданных результатов</li>
            <li><strong>Меньше проигранных ставок</strong> — при равных очках и выигрышах учитывается количество проигранных ставок</li>
            <li><strong>Больше всего ставок</strong> — при полностью одинаковых показателях учитывается общее количество сделанных ставок</li>
          </ol>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;"><svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> Одинаковые показатели</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <p style="margin: 0 0 10px 0;">Если у нескольких участников <strong>полностью одинаковые</strong> показатели по всем критериям:</p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li>Все участники получают <strong>одинаковое место</strong></li>
            <li>Следующее место рассчитывается с учетом количества участников на предыдущем месте</li>
            <li><strong>Пример:</strong> если два участника на 1-м месте, следующий будет на 2-м месте (не на 3-м)</li>
          </ul>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;"><svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Отображение статистики</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px;">
          <p style="margin: 0;">В карточке каждого участника отображается:</p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li><strong>Место</strong> — позиция в рейтинге турнира</li>
            <li><strong>Очки</strong> — общее количество набранных очков</li>
            <li><strong>Всего ставок</strong> — количество сделанных ставок</li>
            <li><strong>Выиграно</strong> — количество угаданных результатов</li>
            <li><strong>Проиграно</strong> — количество неугаданных результатов</li>
            <li><strong>Ожидание</strong> — количество ставок, результаты которых еще не известны</li>
          </ul>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

// ===== ВЫБОР ФАЙЛА КОМАНД ДЛЯ ТУРНИРА =====

// Открыть модалку выбора файла команд для турнира
export async function openEventTeamFileSelector(mode) {
  try {
    const response = await fetch('/api/team-files');
    if (!response.ok) throw new Error('Не удалось загрузить список файлов');

    const files = await response.json();

    if (!files || files.length === 0) {
      alert('Не найдено файлов команд в папке names');
      return;
    }

    // Получаем текущий выбранный файл из формы
    const currentFile = mode === 'create'
      ? document.getElementById('eventTeamFile').value
      : document.getElementById('editEventTeamFile').value;

    const fileListHtml = files.map(file => {
      const isSelected = file.path === currentFile;
      const icon = file.name.endsWith('.json') ? '<svg class="icon" aria-hidden="true"><use href="#icon-manual"></use></svg>' : file.name.endsWith('.txt') ? '<svg class="icon" aria-hidden="true"><use href="#icon-manual"></use></svg>' : '<svg class="icon" aria-hidden="true"><use href="#icon-earlier"></use></svg>';
      return `
        <div class="team-file-item ${isSelected ? 'selected' : ''}"
             onclick="selectEventTeamFile('${file.path}', '${mode}')"
             style="padding: 12px; margin: 8px 0; background: ${isSelected ? 'rgba(90, 159, 212, 0.2)' : 'rgba(40, 44, 54, 0.5)'};
                    border: 1px solid ${isSelected ? 'rgba(90, 159, 212, 0.5)' : 'rgba(90, 159, 212, 0.2)'};
                    border-radius: 8px; cursor: pointer; transition: all 0.2s;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.5em;">${icon}</span>
            <div style="flex: 1;">
              <div style="font-weight: 500; color: #e0e6f0;">${file.name}</div>
              <div style="font-size: 0.85em; color: #b0b8c8; margin-top: 2px;">${file.path}</div>
            </div>
            ${isSelected ? '<span style="color: #4caf50; font-size: 1.2em;"><svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg></span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    const modalHtml = `
      <div id="eventTeamFileSelectorModal" class="modal" style="display: flex;" onclick="closeEventTeamFileSelector()">
        <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
          <div class="modal-header">
            <h2><svg class="icon" aria-hidden="true"><use href="#icon-import"></use></svg> Выбор словаря команд для турнира</h2>
            <button class="modal-close" onclick="closeEventTeamFileSelector()">&times;</button>
          </div>
          <div style="padding: 20px;">
            <p style="color: #b0b8c8; margin-bottom: 15px;">
              Этот словарь будет использоваться по умолчанию при создании матчей в этом турнире:
            </p>
            ${fileListHtml}
          </div>
        </div>
      </div>
    `;

    const existingModal = document.getElementById('eventTeamFileSelectorModal');
    if (existingModal) {
      existingModal.remove();
    }

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    lockBodyScroll();
  } catch (error) {
    console.error('Ошибка при открытии выбора файла:', error);
    alert('Не удалось загрузить список файлов');
  }
}

// Выбрать файл команд для турнира
export function selectEventTeamFile(filePath, mode) {
  if (mode === 'create') {
    document.getElementById('eventTeamFile').value = filePath;
  } else if (mode === 'edit') {
    document.getElementById('editEventTeamFile').value = filePath;
  }

  closeEventTeamFileSelector();
  alert(`Словарь команд выбран: ${filePath.split('/').pop()}\n\nОн будет использоваться по умолчанию при создании матчей в этом турнире.`);
}

// Закрыть модалку выбора файла для турнира
export function closeEventTeamFileSelector() {
  const modal = document.getElementById('eventTeamFileSelectorModal');
  if (modal) {
    modal.remove();
  }
  unlockBodyScroll();
}

// ===== БЛОКИРОВКА ТУРНИРА =====

// Закрыть модальное окно для блокировки турнира
export function closeLockEventModal() {
  const modal = document.getElementById('lockEventModal');
  if (modal) {
    modal.style.display = 'none';
    unlockBodyScroll();
  }
  // Очищаем форму
  document.getElementById('lockEventForm').reset();
}
