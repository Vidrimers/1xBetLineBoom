import * as state from './state.js';
import { lockBodyScroll, unlockBodyScroll, showCustomAlert, showCustomConfirm } from './ui.js';
import { initCustomSelect, setCustomSelectValue } from './customSelect.js';
import { loadEventsList } from './events.js';
import { canDeleteTournaments } from './admin.js';
import { displayMatches } from './matches.js';

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
    loadWeightCategoriesSelect("eventWeightCategory");
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

      // Загружаем категории весов и устанавливаем текущую
      loadWeightCategoriesSelect("editEventWeightCategory", event.weight_category_id);

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
    weight_category_id: document.getElementById("eventWeightCategory").value || null,
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
    await showCustomAlert("Ошибка при создании турнира", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
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
    weight_category_id: document.getElementById("editEventWeightCategory").value || null,
  };

  // Проверяем обязательные поля
  if (!eventData.name) {
    await showCustomAlert("Название турнира обязательно", "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>');
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
    await showCustomAlert("Ошибка при обновлении турнира", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Предпросмотр объявления о турнире
export async function previewTournamentAnnouncement(event) {
  event.preventDefault();
  
  // Собираем данные турнира
  const name = document.getElementById("eventName").value.trim();
  const description = document.getElementById("eventDescription").value.trim();
  const startDate = document.getElementById("eventDate").value;
  const endDate = document.getElementById("eventEndDate").value;
  
  if (!name) {
    await showCustomAlert('Введите название турнира', "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
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
export async function formatText(type) {
  const textarea = document.getElementById('announcementText');
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = textarea.value.substring(start, end);

  // Типы, требующие выделения
  const requiresSelection = ['bold', 'italic', 'underline', 'strikethrough', 'code', 'spoiler'];
  if (!selectedText && requiresSelection.includes(type)) {
    await showCustomAlert('Выделите текст для форматирования', 'Уведомление', '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>');
    return;
  }

  let formattedText = '';
  let cursorOffset = 0;

  switch (type) {
    case 'bold':
      formattedText = `*${selectedText}*`;
      cursorOffset = selectedText.length + 2;
      break;
    case 'italic':
      formattedText = `_${selectedText}_`;
      cursorOffset = selectedText.length + 2;
      break;
    case 'underline':
      // Telegram: __текст__
      formattedText = `__${selectedText}__`;
      cursorOffset = selectedText.length + 4;
      break;
    case 'strikethrough':
      // Telegram: ~текст~
      formattedText = `~${selectedText}~`;
      cursorOffset = selectedText.length + 2;
      break;
    case 'code':
      formattedText = `\`${selectedText}\``;
      cursorOffset = selectedText.length + 2;
      break;
    case 'spoiler':
      // Telegram: ||текст||
      formattedText = `||${selectedText}||`;
      cursorOffset = selectedText.length + 4;
      break;
    case 'quote':
      // Telegram: >текст (каждая строка)
      if (selectedText) {
        formattedText = selectedText.split('\n').map(line => `>${line}`).join('\n');
        cursorOffset = formattedText.length;
      } else {
        formattedText = '>';
        cursorOffset = 1;
      }
      break;
    case 'bullet':
      if (selectedText) {
        formattedText = selectedText.split('\n').map(line => line.trim() ? `• ${line}` : line).join('\n');
        cursorOffset = formattedText.length;
      } else {
        formattedText = '• ';
        cursorOffset = 2;
      }
      break;
    case 'number':
      if (selectedText) {
        let counter = 1;
        formattedText = selectedText.split('\n').map(line => line.trim() ? `${counter++}. ${line}` : line).join('\n');
        cursorOffset = formattedText.length;
      } else {
        formattedText = '1. ';
        cursorOffset = 3;
      }
      break;
    case 'divider':
      // Разделитель — вставляем на новой строке
      formattedText = '\n——————————\n';
      cursorOffset = formattedText.length;
      break;
    case 'link': {
      // Запрашиваем URL через prompt (простой способ без доп. модала)
      const url = window.prompt('Введите URL ссылки:', 'https://');
      if (!url) return;
      const linkText = selectedText || 'текст ссылки';
      formattedText = `[${linkText}](${url})`;
      cursorOffset = formattedText.length;
      break;
    }
    default:
      return;
  }

  textarea.value = textarea.value.substring(0, start) + formattedText + textarea.value.substring(end);
  textarea.focus();
  textarea.setSelectionRange(start + cursorOffset, start + cursorOffset);
  textarea.dispatchEvent(new Event('input'));
}

// Очистить текст объявления
export function clearAnnouncementText() {
  const textarea = document.getElementById('announcementText');
  if (textarea.value && !window.confirm('Очистить текст объявления?')) return;
  textarea.value = '';
  textarea.dispatchEvent(new Event('input'));
  textarea.focus();
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

// Глобальный обработчик предпросмотра (чтобы можно было снять)
let _announcementPreviewHandler = null;

// Открыть модальное окно объявления о новых функциях
export function openAnnouncementModal() {
  document.getElementById('featureAnnouncementModal').style.display = 'flex';
  lockBodyScroll();

  // Предпросмотры: десктопный и мобильный
  const previewDesktop = document.getElementById('announcementPreviewText');
  const previewMobile = document.getElementById('announcementPreviewTextMobile');

  function buildPreviewHtml(title, text) {
    if (!title && !text) return 'Введите текст чтобы увидеть предпросмотр...';

    let result = '';
    if (title) result += `<b>${escapeHtml(title)}</b>\n\n`;
    if (text) {
      let f = escapeHtml(text);

      // Порядок совпадает с сервером
      // Подчёркнутый __текст__
      f = f.replace(/__([^_\n]+)__/g, '<u>$1</u>');
      // Жирный *текст*
      f = f.replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
      // Зачёркнутый ~текст~
      f = f.replace(/~([^~\n]+)~/g, '<s>$1</s>');
      // Курсив _текст_
      f = f.replace(/_([^_\n]+)_/g, '<i>$1</i>');
      // Спойлер ||текст||
      f = f.replace(/\|\|([^|]+)\|\|/g, '<span style="background:#555;color:#555;border-radius:3px;padding:0 2px;cursor:pointer;" title="Спойлер (нажмите чтобы раскрыть)" onclick="this.style.color=\'#e0e6f0\'">$1</span>');
      // Код `текст`
      f = f.replace(/`([^`\n]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;font-family:monospace;">$1</code>');
      // Ссылка [текст](url)
      f = f.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" style="color:#5a9fd4;" target="_blank">$1</a>');
      // Цитата >текст → blockquote
      f = f.replace(/^&gt;(.+)$/gm, '<div style="border-left:3px solid #5a9fd4;padding-left:8px;color:#b0c8e0;margin:2px 0;">$1</div>');
      // Разделитель
      f = f.replace(/^——————————$/gm, '<hr style="border:none;border-top:1px solid rgba(90,159,212,0.3);margin:6px 0;">');
      // Маркированный список
      f = f.replace(/^• (.+)$/gm, '  ▪️ $1');
      // Нумерованный список
      f = f.replace(/^(\d+)\. (.+)$/gm, '  <b>$1.</b> $2');

      result += f;
    }
    return result.replace(/\n/g, '<br>');
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function updatePreview() {
    // Читаем актуальные элементы из DOM каждый раз
    const title = document.getElementById('announcementTitle').value.trim();
    const text = document.getElementById('announcementText').value;
    const html = buildPreviewHtml(title, text);

    if (previewDesktop) previewDesktop.innerHTML = html;
    if (previewMobile) previewMobile.innerHTML = html;

    // Счётчик символов
    const charCounter = document.getElementById('announcementCharCount');
    const len = text.length;
    if (charCounter) {
      charCounter.textContent = len;
      const counter = charCounter.parentElement;
      counter.classList.remove('ann-char-warn', 'ann-char-over');
      if (len > 4096) counter.classList.add('ann-char-over');
      else if (len > 3500) counter.classList.add('ann-char-warn');
    }
  }

  // Снимаем предыдущий обработчик если был, вешаем новый на форму (делегирование)
  const form = document.getElementById('featureAnnouncementForm');
  if (_announcementPreviewHandler) {
    form.removeEventListener('input', _announcementPreviewHandler);
  }
  _announcementPreviewHandler = updatePreview;
  form.addEventListener('input', _announcementPreviewHandler);

  updatePreview();
}

// Закрыть модальное окно объявления
export function closeAnnouncementModal() {
  document.getElementById('featureAnnouncementModal').style.display = 'none';
  unlockBodyScroll();
  document.getElementById('featureAnnouncementForm').reset();
  const placeholder = 'Введите текст чтобы увидеть предпросмотр...';
  const d = document.getElementById('announcementPreviewText');
  const m = document.getElementById('announcementPreviewTextMobile');
  if (d) d.innerHTML = placeholder;
  if (m) m.innerHTML = placeholder;
  const counter = document.getElementById('announcementCharCount');
  if (counter) {
    counter.textContent = '0';
    counter.parentElement.classList.remove('ann-char-warn', 'ann-char-over');
  }
}

// Отправить объявление себе для проверки
export async function sendAnnouncementToSelf() {
  const title = document.getElementById('announcementTitle').value.trim();
  const text = document.getElementById('announcementText').value.trim();
  
  if (!title || !text) {
    await showCustomAlert('Заполните все поля', "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
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
        await showCustomAlert('Тестовое сообщение отправлено вам в Telegram', "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>');
      }
    } else {
      alert(result.error || 'Ошибка при отправке');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await showCustomAlert('Ошибка при отправке', "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
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
        await showCustomAlert(`Объявление отправлено: ${result.successCount} успешно, ${result.errorCount} ошибок`, "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      }
    } else {
      alert(result.error || 'Ошибка при отправке');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await showCustomAlert('Ошибка при отправке', "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Отправить объявление о турнире админу
export async function sendTournamentAnnouncementToAdmin() {
  if (!window.tournamentAnnouncementData) {
    await showCustomAlert('Ошибка: данные турнира не найдены', "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
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
        await showCustomAlert('Объявление отправлено админу на проверку', "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>');
      }
    } else {
      alert(result.error || 'Ошибка при отправке объявления');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    await showCustomAlert('Ошибка при отправке объявления', "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
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

  // Загружаем категории весов для динамического отображения
  let weightCategoriesHtml = '<div style="color: #b0b8c8; font-style: italic;">Не удалось загрузить категории</div>';
  try {
    const wcResponse = await fetch('/api/admin/weight-categories');
    const wcData = await wcResponse.json();
    if (wcData.categories && wcData.categories.length > 0) {
      weightCategoriesHtml = wcData.categories
        .sort((a, b) => b.weight - a.weight)
        .map(cat => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-bottom: 1px solid rgba(90, 159, 212, 0.15);">
            <span>${cat.label}</span>
            <span style="color: #ff9800; font-weight: bold; min-width: 40px; text-align: right;">×${cat.weight}</span>
          </div>
        `).join('');
    } else {
      weightCategoriesHtml = '<div style="color: #b0b8c8; font-style: italic; padding: 6px 10px;">Категории весов не настроены</div>';
    }
  } catch (e) {
    console.error('Ошибка загрузки категорий весов:', e);
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
      
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;">ℹ Информация о турнире</h3>
      
      <div style="line-height: 1.6;">
        <h4 style="color: #ff9800; margin: 20px 0 10px 0;"><svg class="icon" aria-hidden="true"><use href="#icon-custom-tournament"></use></svg> Система начисления очков</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <div style="margin-bottom: 12px;">
            <strong style="color: #4caf50;">Обычные матчи (туры):</strong>
            <ul style="margin: 5px 0; padding-left: 20px;">
              <li><strong>1 очко</strong> — за угаданный результат (победа команды 1, победа команды 2 или ничья)</li>
              <li><strong>+1 очко</strong> — за угаданный точный счёт (если угадан результат)</li>
              <li><strong>+1 очко</strong> — за угаданные жёлтые карточки (если включено в матче)</li>
              <li><strong>+1 очко</strong> — за угаданные красные карточки (если включено в матче)</li>
            </ul>
            <div style="background: #1a2530; border-left: 3px solid #f44336; padding: 8px 12px; margin-top: 8px; border-radius: 0 6px 6px 0; font-size: 0.9em;">
              <strong>⚠️ Важно:</strong> Если результат матча не угадан — бонусы за счёт, жёлтые и красные карточки <strong>не засчитываются</strong>, даже если они угаданы верно.
            </div>
            <div style="background: #1a2530; border-left: 3px solid #ff9800; padding: 8px 12px; margin-top: 8px; border-radius: 0 6px 6px 0; font-size: 0.9em;">
              <strong>Пример:</strong> Угадал результат + точный счёт + жёлтые = 1 + 1 + 1 = <strong>3 очка</strong>
            </div>
          </div>
          
          <div style="margin-bottom: 12px;">
            <strong style="color: #4caf50;">Финальные матчи:</strong>
            <ul style="margin: 5px 0; padding-left: 20px;">
              <li><strong>3 очка</strong> — за угаданный результат (только победа команды 1 или команды 2, ничьей нет)</li>
            </ul>
          </div>
          
          <div style="margin-bottom: 12px;">
            <strong style="color: #4caf50;">Финальные параметры:</strong>
            <ul style="margin: 5px 0; padding-left: 20px;">
              <li><strong>2 очка</strong> — за каждый угаданный параметр:</li>
              <ul style="list-style: disc; margin-top: 3px;">
                <li>Жёлтые карточки</li>
                <li>Красные карточки</li>
                <li>Угловые</li>
                <li>Точный счёт</li>
                <li>Пенальти в игре</li>
                <li>Дополнительное время</li>
                <li>Серия пенальти</li>
              </ul>
            </ul>
            <div style="background: #1a2530; border-left: 3px solid #4caf50; padding: 8px 12px; margin-top: 8px; border-radius: 0 6px 6px 0; font-size: 0.9em;">
              <strong>✅ Важно:</strong> Финальные параметры оцениваются <strong>независимо от результата матча</strong>. Даже если результат не угадан, очки за параметры всё равно начисляются.
            </div>
            <div style="background: #1a2530; border-left: 3px solid #ff9800; padding: 8px 12px; margin-top: 8px; border-radius: 0 6px 6px 0; font-size: 0.9em;">
              <strong>Пример:</strong> Угадал угловые + пенальти в игре = 2 + 2 = <strong>4 очка</strong>
            </div>
          </div>
          
          <div>
            <strong style="color: #4caf50;">Сетка турнира (если есть):</strong>
            <ul style="margin: 5px 0; padding-left: 20px;">
              <li><strong>1 очко</strong> — за угаданного победителя в обычной стадии</li>
              <li><strong>3 очка</strong> — за угаданного победителя в финале сетки</li>
            </ul>
            <div style="background: #1a2530; border-left: 3px solid #ff9800; padding: 8px 12px; margin-top: 8px; border-radius: 0 6px 6px 0; font-size: 0.9em;">
              <strong>Пример:</strong> Угадал 3 матча обычных стадий + финал сетки = 3 + 3 = <strong>6 очков</strong>
            </div>
          </div>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;"><svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Сортировка участников в турнире</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <p style="margin: 0 0 10px 0;">Участники внутри турнира сортируются по следующим критериям (в порядке приоритета):</p>
          <ol style="margin: 5px 0; padding-left: 20px;">
            <li><strong>Больше очков</strong> — основной критерий</li>
            <li><strong>Длиннее серия побед подряд</strong> — при равных очках учитывается максимальная серия угаданных ставок подряд</li>
            <li><strong>Меньше проигрышей</strong> — при равных очках и серии учитывается количество неугаданных ставок</li>
          </ol>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;"><svg class="icon" aria-hidden="true"><use href="#icon-members"></use></svg> Сортировка в общем списке участников</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <p style="margin: 0 0 10px 0;">В общем списке всех участников сортировка идёт по:</p>
          <ol style="margin: 5px 0; padding-left: 20px;">
            <li><strong>Суммарный вес выигранных турниров</strong> — каждый турнир имеет свой вес, победы в более значимых турнирах ценятся выше</li>
            <li><strong>Количество побед в турнирах</strong> — при равном весе учитывается число выигранных турниров</li>
            <li><strong>Алфавитный порядок</strong> — при полном равенстве — по имени</li>
          </ol>
          <div style="margin-top: 12px;">
            <strong style="color: #5a9fd4; font-size: 0.9em;">⚖️ Категории весов:</strong>
            <div style="background: #1a2530; border-radius: 6px; margin-top: 6px; overflow: hidden;">
              ${weightCategoriesHtml}
            </div>
            <div style="margin-top: 8px; font-size: 0.85em; color: #b0b8c8; line-height: 1.4;">
              Вес определяет значимость турнира при сортировке участников.<br>
              Чем больше вес — тем выше ценится победа в турнире этой категории.
            </div>
          </div>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;"><svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> Одинаковые показатели</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <p style="margin: 0 0 10px 0;">Если у нескольких участников <strong>полностью одинаковые</strong> показатели по всем критериям:</p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li>Все участники получают <strong>одинаковое место</strong></li>
            <li>Следующее место пропускается с учётом количества участников на предыдущем</li>
          </ul>
          <div style="background: #1a2530; border-left: 3px solid #ff9800; padding: 8px 12px; margin-top: 8px; border-radius: 0 6px 6px 0; font-size: 0.9em;">
            <strong>Пример:</strong> Два участника на 1-м месте → следующий будет на <strong>3-м</strong> месте (не на 2-м)
          </div>
        </div>

        <h4 style="color: #ff9800; margin: 20px 0 10px 0;"><svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Отображение статистики</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px;">
          <p style="margin: 0;">В карточке каждого участника турнира отображается:</p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li><strong>Место</strong> — позиция в рейтинге турнира</li>
            <li><strong>Очки</strong> — общее количество набранных очков</li>
            <li><strong>Всего ставок</strong> — количество сделанных ставок</li>
            <li><strong>Выиграно</strong> — количество угаданных результатов</li>
            <li><strong>Проиграно</strong> — количество неугаданных результатов</li>
            <li><strong>Ожидание</strong> — ставки, результаты которых ещё не известны</li>
            <li><strong>Серия побед</strong> — максимальная серия угаданных ставок подряд</li>
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
      await showCustomAlert('Не найдено файлов команд в папке names', "Уведомление", '<svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>');
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
    await showCustomAlert('Не удалось загрузить список файлов', "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Выбрать файл команд для турнира
export async function selectEventTeamFile(filePath, mode) {
  if (mode === 'create') {
    document.getElementById('eventTeamFile').value = filePath;
  } else if (mode === 'edit') {
    document.getElementById('editEventTeamFile').value = filePath;
  }

  closeEventTeamFileSelector();
  await showCustomAlert(`Словарь команд выбран: ${filePath.split('/').pop()}\n\nОн будет использоваться по умолчанию при создании матчей в этом турнире.`, "Успех", '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');
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

// ===== БЛОКИРОВКА / РАЗБЛОКИРОВКА / УДАЛЕНИЕ ТУРНИРА =====

export function openLockEventModal(eventId, eventName) {
  const modal = document.getElementById('lockEventModal');
  if (modal) {
    lockBodyScroll();
    modal.style.display = 'flex';
    document.getElementById('lockEventForm').dataset.eventId = eventId;
  }
}

export async function submitLockEvent(e) {
  e.preventDefault();
  const form = document.getElementById('lockEventForm');
  const eventId = form.dataset.eventId;
  const reason = document.getElementById('eventLockReason').value.trim();

  if (!reason) return;

  try {
    const response = await fetch(`/api/admin/events/${eventId}/lock`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: window.state?.currentUser?.username, reason }),
    });
    const result = await response.json();

    if (response.ok) {
      closeLockEventModal();
      loadEventsList();
      await showCustomAlert(
        `Турнир заблокирован${result.winner ? `\n\n🏆 Победитель: ${result.winner.username}` : ''}`,
        'Турнир заблокирован',
        '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
      );
    } else {
      await showCustomAlert(`Ошибка: ${result.error}`, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error('Ошибка блокировки турнира:', error);
    await showCustomAlert('Ошибка при блокировке турнира', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

export async function unlockEvent(eventId) {
  const confirmed = await showCustomConfirm(
    'Вы уверены, что хотите разблокировать этот турнир?',
    'Разблокировка турнира',
    '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'
  );
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/admin/events/${eventId}/unlock`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: window.state?.currentUser?.username }),
    });
    const result = await response.json();
    if (response.ok) {
      loadEventsList();
    } else {
      await showCustomAlert(`Ошибка при разблокировке турнира: ${result.error || response.status}`, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (e) {
    console.error('Ошибка:', e);
    await showCustomAlert(`Ошибка при разблокировке турнира: ${e.message}`, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

export async function deleteEvent(eventId) {
  if (!canDeleteTournaments()) {
    await showCustomAlert('Только администратор или модератор с правами может удалять турниры', 'Недостаточно прав', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const confirmed = await showCustomConfirm(
    'Вы уверены, что хотите удалить этот турнир?\n\nВсе матчи и ставки этого турнира также будут удалены.',
    'Удаление турнира',
    '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>'
  );
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/admin/events/${eventId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: window.state?.currentUser?.username }),
    });
    const result = await response.json();

    if (response.ok) {
      await loadEventsList();
      if (window.state?.currentEventId === eventId) {
        window.state.currentEventId = null;
        displayMatches();
      }
    } else {
      await showCustomAlert(`Ошибка: ${result.error}`, 'Ошибка удаления', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (e) {
    console.error('Ошибка при удалении турнира:', e);
    await showCustomAlert('Ошибка при удалении турнира', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Загрузить категории весов в select
async function loadWeightCategoriesSelect(selectId, selectedValue = null) {
  const select = document.getElementById(selectId);
  if (!select) return;

  try {
    const response = await fetch('/api/admin/weight-categories');
    const data = await response.json();

    // Сохраняем первую опцию "Не выбрано"
    select.innerHTML = '<option value="">— Не выбрано —</option>';

    if (data.categories && data.categories.length > 0) {
      data.categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = `${cat.weight} (${cat.label})`;
        if (selectedValue && String(cat.id) === String(selectedValue)) {
          option.selected = true;
        }
        select.appendChild(option);
      });
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки категорий весов:', error);
  }
}
