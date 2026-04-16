import * as state from './state.js';
import { setRoundsOrder, setTempRoundsOrder, setDraggedItem, setADMIN_LOGIN, setADMIN_DB_NAME } from './state.js';
import { showCustomAlert, showCustomConfirm } from './ui.js';

// Загрузить порядок туров из БД
export async function loadRoundsOrder() {
  try {
    if (!state.currentEventId) {
      setRoundsOrder([]);
      return;
    }
    const response = await fetch(`/api/rounds-order/${state.currentEventId}`);
    if (response.ok) {
      setRoundsOrder(await response.json());
    } else {
      setRoundsOrder([]);
    }
  } catch (e) {
    console.error("Ошибка загрузки порядка туров:", e);
    setRoundsOrder([]);
  }
}

// Сохранить порядок туров в БД (только админ)
export async function saveRoundsOrderToStorage() {
  try {
    if (!state.currentEventId) {
      console.error("Нет выбранного турнира");
      return;
    }
    const response = await fetch("/api/admin/rounds-order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rounds: state.roundsOrder,
        event_id: state.currentEventId,
      }),
    });

    if (!response.ok) {
      throw new Error("Ошибка сохранения");
    }
  } catch (e) {
    console.error("Ошибка сохранения порядка туров:", e);
    alert("Ошибка сохранения порядка туров");
  }
}

// Открыть модальное окно редактирования порядка туров
export function openRoundsOrderModal() {
  // Собираем все туры (включая финал если есть финальные матчи)
  const uniqueRounds = [
    ...new Set(state.matches.map((m) => m.round).filter((r) => r && r.trim())),
  ];

  // Добавляем "<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> Финал" если есть финальные матчи
  const hasFinalMatches = state.matches.some(
    (m) => m.is_final === 1 || m.is_final === true
  );
  if (hasFinalMatches && !uniqueRounds.includes("<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> Финал")) {
    uniqueRounds.push("<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> Финал");
  }

  // Убедимся, что финал есть в roundsOrder если он есть в uniqueRounds
  if (hasFinalMatches && !state.roundsOrder.includes("<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> Финал")) {
    setRoundsOrder([...state.roundsOrder, "<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> Финал"]);
  }

  // Сортируем туры по сохраненному порядку
  setTempRoundsOrder(sortRoundsByOrder(uniqueRounds));

  renderRoundsOrderList();
  document.getElementById("roundsOrderModal").classList.add("active");

  // Блокируем скролл body
  document.body.style.overflow = 'hidden';
}

// Закрыть модальное окно
export function closeRoundsOrderModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById("roundsOrderModal").classList.remove("active");

  // Разблокируем скролл body
  document.body.style.overflow = '';
}

// Отрисовать список туров в модальном окне
export function renderRoundsOrderList() {
  const list = document.getElementById("roundsOrderList");
  list.innerHTML = state.tempRoundsOrder
    .map(
      (round, index) => `
      <li class="rounds-order-item" draggable="true" data-index="${index}">
        <span class="drag-handle"><svg class="icon" aria-hidden="true"><use href="#icon-settings"></use></svg></span>
        <span class="round-name">${round}</span>
        <button class="delete-round-btn" onclick="deleteRound('${round.replace(/'/g, "\\'")}', ${index})" title="Удалить тур и все его матчи">×</button>
      </li>
    `
    )
    .join("");

  // Добавляем обработчики drag-and-drop
  const items = list.querySelectorAll(".rounds-order-item");
  items.forEach((item) => {
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragend", handleDragEnd);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("drop", handleDrop);
    item.addEventListener("dragenter", handleDragEnter);
    item.addEventListener("dragleave", handleDragLeave);
  });
}

// Удалить тур и все его матчи
export async function deleteRound(roundName, index) {
  const confirmed = await showCustomConfirm(
    `Вы уверены, что хотите удалить тур "${roundName}" и все его матчи?`,
    "Подтверждение удаления",
    "<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>️"
  );

  if (!confirmed) {
    return;
  }

  try {
    // Удаляем тур из временного массива
    const newTempOrder = [...state.tempRoundsOrder];
    newTempOrder.splice(index, 1);
    setTempRoundsOrder(newTempOrder);

    // Удаляем матчи этого тура из базы данных
    const response = await fetch(`/api/admin/rounds/${encodeURIComponent(roundName)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser.username,
        event_id: state.currentEventId,
      }),
    });

    if (!response.ok) {
      throw new Error('Ошибка при удалении тура');
    }

    // Обновляем глобальный массив туров
    setRoundsOrder([...state.tempRoundsOrder]);
    await saveRoundsOrderToStorage();

    // Перезагружаем матчи
    const { loadMatches } = await import('./matches.js');
    await loadMatches();

    // Перерисовываем список туров в модалке
    renderRoundsOrderList();
  } catch (error) {
    console.error('Ошибка при удалении тура:', error);
    await showCustomAlert('Не удалось удалить тур', "Ошибка", "<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>");
  }
}

// ===== Drag-and-drop обработчики =====

function handleDragStart(e) {
  setDraggedItem(this);
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}

function handleDragEnd(e) {
  this.classList.remove("dragging");
  document.querySelectorAll(".rounds-order-item").forEach((item) => {
    item.classList.remove("drag-over");
  });
  setDraggedItem(null);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}

function handleDragEnter(e) {
  e.preventDefault();
  if (this !== state.draggedItem) {
    this.classList.add("drag-over");
  }
}

function handleDragLeave(e) {
  this.classList.remove("drag-over");
}

function handleDrop(e) {
  e.preventDefault();
  this.classList.remove("drag-over");

  if (state.draggedItem && this !== state.draggedItem) {
    const fromIndex = parseInt(state.draggedItem.dataset.index);
    const toIndex = parseInt(this.dataset.index);

    // Перемещаем элемент в массиве
    const newOrder = [...state.tempRoundsOrder];
    const item = newOrder.splice(fromIndex, 1)[0];
    newOrder.splice(toIndex, 0, item);
    setTempRoundsOrder(newOrder);

    // Перерисовываем список
    renderRoundsOrderList();
  }
}

// Сохранить порядок туров
export async function saveRoundsOrder() {
  setRoundsOrder([...state.tempRoundsOrder]);
  await saveRoundsOrderToStorage();
  closeRoundsOrderModal();
  const { displayMatches } = await import('./matches.js');
  displayMatches();
}

// Сортировать туры по сохраненному порядку
export function sortRoundsByOrder(rounds) {
  return rounds.sort((a, b) => {
    const indexA = state.roundsOrder.indexOf(a);
    const indexB = state.roundsOrder.indexOf(b);

    // Если оба в сохраненном порядке - сортируем по индексу
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }
    // Если только a в порядке - a идет первым
    if (indexA !== -1) return -1;
    // Если только b в порядке - b идет первым
    if (indexB !== -1) return 1;
    // Если оба не в порядке - оставляем как есть
    return 0;
  });
}

// Загрузить конфигурацию сервера
export async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    setADMIN_LOGIN(config.ADMIN_LOGIN);
    setADMIN_DB_NAME(config.ADMIN_DB_NAME);
  } catch (error) {
    console.error("❌ Ошибка при загрузке конфигурации:", error);
  }
}
