import * as state from './state.js';
import { setEvents, setCurrentEventId, setMobileActiveEventId, setEventItemClickHandlersInit } from './state.js';

// ===== СПИСОК СОБЫТИЙ (ТУРНИРОВ) =====

// Загрузить список событий с сервера
export async function loadEventsList() {
  try {
    const response = await fetch("/api/events");
    setEvents(await response.json());
    displayEvents();

    // При первой загрузке выбираем турнир (только на десктопе)
    if (!state.currentEventId && state.events.length > 0 && window.innerWidth > 768) {
      // Пытаемся восстановить последний выбранный турнир из localStorage
      const savedEventId = localStorage.getItem('selectedEventId');
      const savedEvent = savedEventId ? state.events.find(e => e.id === parseInt(savedEventId)) : null;

      // Если сохраненный турнир существует, выбираем его
      if (savedEvent) {
        selectEvent(savedEvent.id);
      } else {
        // Иначе выбираем первый активный турнир, или первый предстоящий, или первый доступный
        const now = new Date();
        const firstActiveEvent = state.events.find(
          (e) => !e.locked_reason && e.start_date && new Date(e.start_date) <= now
        );
        const firstUpcomingEvent = state.events.find(
          (e) =>
            !e.locked_reason && (!e.start_date || new Date(e.start_date) > now)
        );
        const eventToSelect =
          firstActiveEvent ||
          firstUpcomingEvent ||
          state.events.find((e) => !e.locked_reason) ||
          state.events[0];
        if (eventToSelect) {
          selectEvent(eventToSelect.id);
        }
      }
    }

    // Обновляем видимость кнопки "Мне повезет" после загрузки турниров
    if (typeof updateLuckyButtonVisibility === 'function') updateLuckyButtonVisibility();
  } catch (error) {
    console.error("Ошибка при загрузке событий:", error);
    document.getElementById("eventsList").innerHTML =
      '<div class="empty-message">Ошибка при загрузке событий</div>';
  }
}

// Генерация HTML для одного события
export function generateEventHTML(
  event,
  positionNumber,
  isCompleted = false,
  isActive = false
) {
  // Если турнир завершен, показываем индикатор
  const lockedBadge = isCompleted
    ? `<div style="display: flex; align-items: center; justify-content: center; gap: 5px; margin-top: 8px; padding: 5px 8px; background: rgba(244, 67, 54, 0.2); border-radius: 3px; font-size: 0.85em;">
          <span style="color: #f44336; font-weight: bold; font-size: 0.8em;">🔒</span>
          <span style="color: #b0b8c8; font-size: 0.85em;">${event.locked_reason}</span>
        </div>`
    : "";

  return `
    <div style="display: flex; align-items: flex-start; gap: 10px;">
      <div style="font-size: 1em; font-weight: bold; color: #5a9fd4; min-width: 30px; text-align: center; padding-top: 5px;">#${positionNumber}</div>
      <div class="event-item ${isCompleted ? "locked" : ""} ${
    isActive ? "active-tournament" : ""
  } ${event.id === state.currentEventId ? "active" : ""}" data-event-id="${
    event.id
  }" style="flex: 1;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; position: relative;">
          <div onclick="selectEvent(${event.id}, '${
    event.name
  }')" style="flex: 1; cursor: ${isCompleted ? "not-allowed" : "pointer"};">
            <strong>${
              event.icon
                ? event.icon.startsWith("img/") || event.icon.startsWith("http")
                  ? `<img class="event-icon" src="${
                      event.icon
                    }" alt="иконка" title="${getIconTitle(
                      event.icon
                    )}" style="width: 35px; height: 35px; vertical-align: middle; margin-right: 8px; background: ${
                      event.background_color === "transparent" ||
                      !event.background_color
                        ? "rgba(224, 230, 240, .4)"
                        : event.background_color
                    }; padding: 2px; border-radius: 3px;">`
                  : `<span style="display: inline-block; margin-right: 8px; background: ${
                      event.background_color === "transparent" ||
                      !event.background_color
                        ? "rgba(224, 230, 240, .4)"
                        : event.background_color
                    }; padding: 2px; width: 35px; height: 35px; vertical-align: middle; text-align: center; line-height: 1.8; border-radius: 3px;" title="${getIconTitle(
                      event.icon
                    )}">${event.icon}</span>`
                : ""
            }${event.name}</strong>
            <p style="font-size: 0.9em; opacity: 0.7; margin-top: 5px;">${
              event.description || "Нет описания"
            }</p>
            ${
              event.start_date || event.end_date
                ? `<p style="font-size: 0.85em; opacity: 0.6; margin-top: 3px;">
                ${
                  event.start_date
                    ? `📅 с ${new Date(event.start_date).toLocaleDateString(
                        "ru-RU"
                      )}`
                    : ""
                }
                ${
                  event.end_date
                    ? ` по ${new Date(event.end_date).toLocaleDateString(
                        "ru-RU"
                      )}`
                    : ""
                }
              </p>`
                : ""
            }
            ${lockedBadge}
          </div>
          ${
            event.id === state.currentEventId
              ? '<div style="color: #4caf50; font-weight: bold; position: absolute; right: 0px; bottom: 0px;">●</div>'
              : ""
          }
        </div>
        ${
          canManageTournaments()
            ? `<div class="event-admin-actions">
          <div class="event-admin-controls" data-event-id="${event.id}">
            ${canEditTournaments() ? `<button onclick="openEditEventModal(${
              event.id
            })" style="background: transparent; padding: 5px; font-size: 0.7em; border: 1px solid #3a7bd5; color: #7ab0e0; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(33, 150, 243, 0.5)'" onmouseout="this.style.background='transparent'">✏️</button>` : ''}
            ${
              isCompleted
                ? `<button onclick="unlockEvent(${event.id})" style="background: rgba(76, 175, 80, 0.3); padding: 5px; font-size: 0.8em; border: 1px solid #4caf50; color: #7ed321; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(76, 175, 80, 0.5)'" onmouseout="this.style.background='rgba(76, 175, 80, 0.3)'">🔓</button>`
                : `<button onclick="openLockEventModal(${event.id}, '${event.name.replace(/'/g, "\\'")}')  style="background: transparent; padding: 5px; font-size: 0.7em; border: 1px solid #f57c00; color: #ffe0b2; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(255, 152, 0, 0.5)'" onmouseout="this.style.background='transparent'">🔒</button>`
            }
            ${canDeleteTournaments() ? `<button class="event-delete-btn" onclick="deleteEvent(${
              event.id
            })" style="background: transparent; padding: 5px; font-size: 0.7em; border: 1px solid #f44336; color: #ffb3b3; border-radius: 3px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(244, 67, 54, 0.5)'" onmouseout="this.style.background='transparent'">✕</button>` : ''}
          </div>
          <button class="event-admin-toggle" data-event-id="${
            event.id
          }" type="button" aria-expanded="false" title="Дополнительные действия">&lt;</button>
        </div>`
            : ""
        }
      </div>
    </div>`;
}

// Отобразить список событий
export function displayEvents() {
  const eventsList = document.getElementById("eventsList");

  if (state.events.length === 0) {
    eventsList.innerHTML =
      '<div class="empty-message">Событий не найдено</div>';
    return;
  }

  // Получаем текущую дату для сравнения
  const now = new Date();

  // Разделяем события на категории
  const upcomingEvents = state.events.filter((event) => {
    if (event.locked_reason) return false;
    if (!event.start_date) return true; // Если нет даты начала, считаем предстоящим
    return new Date(event.start_date) > now;
  });

  const activeEvents = state.events.filter((event) => {
    if (event.locked_reason) return false;
    if (!event.start_date) return false;
    return new Date(event.start_date) <= now;
  });

  const completedEvents = state.events.filter((event) => event.locked_reason);

  let html = "";
  let activeIndex = 1;
  let upcomingIndex = 1;
  let completedIndex = 1;

  // Активные турниры
  if (activeEvents.length > 0) {
    html +=
      '<div style="text-align: center; color: #b0b8c8; font-size: 0.7em;margin: 15px 0;">━━━ АКТИВНЫЕ ТУРНИРЫ ━━━</div>';
    html += activeEvents
      .map((event) => {
        const positionNumber = activeIndex++;
        return generateEventHTML(event, positionNumber, false, true);
      })
      .join("");
  }

  // Предстоящие турниры
  if (upcomingEvents.length > 0) {
    html +=
      '<div style="text-align: center; color: #b0b8c8; font-size: 0.7em;margin: 15px 0;">━━━ ПРЕДСТОЯЩИЕ ТУРНИРЫ ━━━</div>';
    html += upcomingEvents
      .map((event) => {
        const positionNumber = upcomingIndex++;
        return generateEventHTML(event, positionNumber);
      })
      .join("");
  }

  // Завершенные турниры
  if (completedEvents.length > 0) {
    html +=
      '<div style="text-align: center; color: #b0b8c8; font-size: 0.7em;margin: 15px 0;">━━━ ЗАВЕРШЕННЫЕ ТУРНИРЫ ━━━</div>';
    html += completedEvents
      .map((event) => {
        const positionNumber = completedIndex++;
        return generateEventHTML(event, positionNumber, true);
      })
      .join("");
  }

  eventsList.innerHTML = html;
  initEventAdminToggles();
  initEventItemClickHandlers();
  restoreMobileActiveEvent();
}

// Выбрать событие (турнир)
export async function selectEvent(eventId, eventName) {
  // Проверяем, заблокирован ли турнир
  const event = state.events.find((e) => e.id === eventId);

  // Если турнир заблокирован — разрешаем выбор, но можно показать подсказку (не блокируя действие)
  if (event && event.locked_reason) {
    console.info(
      `Выбрана завершённая/заблокированная карточка турнира (id=${eventId}). Причина: ${event.locked_reason}`
    );
  }

  setCurrentEventId(eventId);
  displayEvents(); // Обновляем выделение

  // Очищаем кнопки сетки сразу при переключении турнира
  const matchesBracketButtons = document.getElementById('matchesBracketButtons');
  if (matchesBracketButtons) {
    matchesBracketButtons.innerHTML = '';
  }

  // Обновляем видимость кнопки "Мне повезет"
  if (typeof updateLuckyButtonVisibility === 'function') updateLuckyButtonVisibility();

  // Скрываем/показываем кнопку напоминаний в зависимости от статуса турнира
  const matchRemindersBtn = document.getElementById('matchRemindersBtn');
  if (matchRemindersBtn) {
    // Показываем только для активных турниров (не завершенных и не предстоящих)
    const isLocked = event && event.locked_reason;
    const isUpcoming = event && event.start_date && new Date(event.start_date) > new Date();

    if (isLocked || isUpcoming) {
      matchRemindersBtn.style.display = 'none';
      if (typeof updateReminderIndicator === 'function') updateReminderIndicator(false);
    } else {
      // Проверяем настройку "Напоминания о матчах"
      if (typeof checkMatchRemindersSettingAndUpdateButton === 'function') checkMatchRemindersSettingAndUpdateButton();
    }
  }

  // Скрываем контейнер админских кнопок при переключении турнира
  const adminButtonsContainer = document.getElementById('adminButtonsContainer');
  if (adminButtonsContainer) {
    adminButtonsContainer.style.display = 'none';
  }

  // Показываем кнопку настроек админа если есть права
  const adminSettingsBtn = document.getElementById('adminSettingsBtn');
  if (adminSettingsBtn && (canCreateMatches() || canManageTournaments() || (state.currentUser && state.currentUser.isAdmin))) {
    adminSettingsBtn.style.display = 'inline-block';

    // Заполняем контейнер админских кнопок
    if (adminButtonsContainer) {
      let buttonsHTML = '';

      if (canCreateMatches()) {
        buttonsHTML += `
          <button id="addMatchBtn" onclick="openCreateMatchModal(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #3a7bd5; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Добавить матч">
            ➕
          </button>
          <button id="bulkParseBtn" onclick="openBulkParseModal(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #3a7bd5; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Массовый парсинг матчей">
            🔍
          </button>
        `;
      }

      if (state.currentUser && state.currentUser.isAdmin) {
        buttonsHTML += `
          <button id="addBracketBtn" onclick="openCreateBracketModal(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #3a7bd5; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Создать сетку плей-офф">
            🏆
          </button>
          <button id="autoCountingBtn" onclick="toggleAutoCounting(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #4caf50; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Автоподсчет">
            A
          </button>
        `;
      }

      if (canManageTournaments()) {
        buttonsHTML += `
          <button id="editRoundsBtn" onclick="openRoundsOrderModal(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #3a7bd5; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Изменить порядок туров">
            ✎
          </button>
        `;
      }

      if (canCreateMatches()) {
        buttonsHTML += `
          <button id="importMatchesBtn" onclick="openImportMatchesModal(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #4caf50; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Импортировать матчи">
            📥
          </button>
          <button id="bulkEditDatesBtn" onclick="openBulkEditDatesModal(); closeAdminButtons();" style="padding: 5px; font-size: .9em; background: transparent; border: 1px solid #4caf50; border-radius: 3px; cursor: pointer; color: #b0b8c8;" title="Массовое редактирование дат">
            📅
          </button>
        `;
      }

      adminButtonsContainer.innerHTML = buttonsHTML;

      // Загружаем статус автоподсчета для обновления кнопки
      if (state.currentUser && state.currentUser.isAdmin) {
        if (typeof loadAutoCountingStatus === 'function') loadAutoCountingStatus();
      }
    }
  } else if (adminSettingsBtn) {
    adminSettingsBtn.style.display = 'none';
  }

  const { loadMatches } = await import('./matches.js');
  loadMatches(eventId);
}

// Переключение видимости админских кнопок
export function toggleAdminButtons(event) {
  event.stopPropagation(); // Предотвращаем всплытие события

  const container = document.getElementById('adminButtonsContainer');
  const btn = document.getElementById('adminSettingsBtn');

  if (container && btn) {
    if (container.style.display === 'none' || !container.style.display) {
      container.style.display = 'flex';

      // Функция для обновления позиции
      const updatePosition = () => {
        const rect = btn.getBoundingClientRect();
        const containerHeight = container.offsetHeight;

        // Позиционируем контейнер над кнопкой с отступом
        container.style.top = (rect.top - containerHeight - 8) + 'px';
        container.style.left = rect.left + 'px';

        // Корректируем позицию если контейнер выходит за пределы экрана
        const containerRect = container.getBoundingClientRect();
        if (containerRect.top < 0) {
          // Если не помещается сверху, показываем снизу
          container.style.top = (rect.bottom + 8) + 'px';
        }
      };

      // Обновляем позицию сразу
      updatePosition();

      // Добавляем анимацию появления
      setTimeout(() => {
        container.style.opacity = '1';
        container.style.transform = 'translateY(0)';
      }, 10);

      // Сохраняем функцию обновления для использования при скролле
      container._updatePosition = updatePosition;

      // Добавляем обработчик скролла
      const scrollHandler = () => {
        if (container.style.display === 'flex') {
          updatePosition();
        }
      };
      container._scrollHandler = scrollHandler;

      // Находим scrollable контейнер (matchesSection)
      const matchesSection = document.getElementById('matchesSection');
      if (matchesSection) {
        matchesSection.addEventListener('scroll', scrollHandler);
      }
      window.addEventListener('scroll', scrollHandler);

      // Добавляем обработчик клика по документу для закрытия меню
      const clickHandler = (e) => {
        // Проверяем, что клик был не по кнопке и не по контейнеру
        if (!btn.contains(e.target) && !container.contains(e.target)) {
          closeAdminButtons();
        }
      };
      container._clickHandler = clickHandler;
      setTimeout(() => {
        document.addEventListener('click', clickHandler);
      }, 0);

    } else {
      closeAdminButtons();
    }
  }
}

// Закрытие админских кнопок
export function closeAdminButtons() {
  const container = document.getElementById('adminButtonsContainer');
  if (container) {
    // Анимация закрытия
    container.style.opacity = '0';
    container.style.transform = 'translateY(-10px)';

    setTimeout(() => {
      container.style.display = 'none';

      // Удаляем обработчики
      if (container._scrollHandler) {
        const matchesSection = document.getElementById('matchesSection');
        if (matchesSection) {
          matchesSection.removeEventListener('scroll', container._scrollHandler);
        }
        window.removeEventListener('scroll', container._scrollHandler);
        delete container._scrollHandler;
        delete container._updatePosition;
      }

      if (container._clickHandler) {
        document.removeEventListener('click', container._clickHandler);
        delete container._clickHandler;
      }
    }, 200); // Ждем завершения анимации
  }
}

// Инициализация toggle-кнопок для событий (турниров)
export function initEventAdminToggles() {
  const toggles = document.querySelectorAll(".event-admin-toggle");

  toggles.forEach((toggle) => {
    const eventId = toggle.dataset.eventId;
    const panel = document.querySelector(
      `.event-admin-controls[data-event-id="${eventId}"]`
    );
    if (!panel) return;

    toggle.addEventListener("click", () => {
      const isVisible = panel.classList.toggle("visible");
      toggle.setAttribute("aria-expanded", isVisible ? "true" : "false");
      toggle.textContent = isVisible ? "×" : "<";
    });
  });
}

// Восстановить активное событие на мобильных
export function restoreMobileActiveEvent() {
  const eventsList = document.getElementById("eventsList");
  if (!eventsList || !state.mobileActiveEventId) {
    return;
  }

  eventsList
    .querySelectorAll(".event-item.hovered")
    .forEach((item) => item.classList.remove("hovered"));

  const target = eventsList.querySelector(
    `.event-item[data-event-id="${state.mobileActiveEventId}"]`
  );

  if (target) {
    target.classList.add("hovered");
  }
}

// Инициализация обработчиков кликов по событиям (мобильный UX)
export function initEventItemClickHandlers() {
  if (state.eventItemClickHandlersInit) {
    return;
  }

  const eventsList = document.getElementById("eventsList");
  if (!eventsList) {
    return;
  }

  const mobileQuery = window.matchMedia(
    `(max-width: ${state.EVENT_ADMIN_MOBILE_BREAKPOINT}px)`
  );

  const clearHovered = () => {
    setMobileActiveEventId(null);
    eventsList
      .querySelectorAll(".event-item.hovered")
      .forEach((item) => item.classList.remove("hovered"));
  };

  const handleItemClick = (event) => {
    if (!mobileQuery.matches) {
      return;
    }

    const item = event.target.closest(".event-item");
    if (!item || event.target.closest(".event-admin-actions")) {
      return;
    }

    const eventId = item.dataset.eventId;
    if (!eventId) {
      return;
    }

    const isActive = state.mobileActiveEventId === eventId;
    setMobileActiveEventId(isActive ? null : eventId);
    restoreMobileActiveEvent();
  };

  eventsList.addEventListener("click", handleItemClick);

  document.addEventListener("click", (event) => {
    if (!mobileQuery.matches) {
      return;
    }

    if (event.target.closest(".event-item")) {
      return;
    }

    clearHovered();
  });

  const handleMediaChange = (event) => {
    if (!event.matches) {
      clearHovered();
    }
  };

  if (typeof mobileQuery.addEventListener === "function") {
    mobileQuery.addEventListener("change", handleMediaChange);
  } else if (typeof mobileQuery.addListener === "function") {
    mobileQuery.addListener(handleMediaChange);
  }

  setEventItemClickHandlersInit(true);
}
