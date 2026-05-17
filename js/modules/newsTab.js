// ===== МОДУЛЬ: НОВОСТИ НА САЙТЕ (ВКЛАДКА) =====
// Функции для вкладки новостей, публикации и реакций

import { currentUser } from './state.js';
import { showCustomAlert, showCustomConfirm } from './ui.js';

// ============================================
// ПЕРЕМЕННЫЕ ПАГИНАЦИИ
// ============================================

let newsOffset = 0;
let newsLimit = 50;
let currentNewsFilter = 'all';
let hasMoreNews = true;

// ============================================
// МОДАЛКА ДОБАВЛЕНИЯ НОВОСТИ (АДМИН)
// ============================================

let selectedNewsType = null;

// Открыть модальное окно добавления новости
export function openNewsModal() {
  const modal = document.getElementById("newsModal");
  if (modal) {
    // Сбрасываем форму
    document.getElementById("newsTitle").value = "";
    document.getElementById("newsMessage").value = "";
    selectedNewsType = null;

    // Сбрасываем выделение кнопок типа
    document.querySelectorAll('.news-type-btn').forEach(btn => {
      btn.style.opacity = '0.6';
      btn.style.borderWidth = '2px';
    });

    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";
  }
}

// Закрыть модальное окно добавления новости
export function closeNewsModal() {
  const modal = document.getElementById("newsModal");
  if (modal) {
    // Разблокируем скролл body
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// Открыть модальное окно просмотра новостей на сайте
export async function openNewsModalSite() {
  const modal = document.getElementById("newsViewModal");
  if (modal) {
    // Блокируем скролл body
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";

    // Загружаем новости
    await loadNewsForSite();
  }
}

// Закрыть модальное окно просмотра новостей
export function closeNewsViewModal() {
  const modal = document.getElementById("newsViewModal");
  if (modal) {
    // Разблокируем скролл body
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// Загрузить новости для отображения на сайте
export async function loadNewsForSite() {
  const container = document.getElementById("newsViewContainer");

  if (!container) return;

  // Показываем загрузку
  container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;"><div class="spinner"></div><p>Загрузка новостей...</p></div>';

  try {
    const response = await fetch("/api/news?limit=20");

    if (!response.ok) {
      throw new Error("Ошибка загрузки новостей");
    }

    const data = await response.json();
    const news = data.news;

    if (!news || news.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;"><svg class="icon" aria-hidden="true"><use href="#icon-news"></use></svg> Новостей пока нет</div>';
      return;
    }

    // Эмодзи для типов новостей
    const typeEmojis = {
      'tournament': '<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg>',
      'system': '<svg class="icon" aria-hidden="true"><use href="#icon-settings"></use></svg>',
      'achievement': '<svg class="icon" aria-hidden="true"><use href="#icon-conference"></use></svg>',
      'announcement': '<svg class="icon" aria-hidden="true"><use href="#icon-announcements"></use></svg>'
    };

    const typeNames = {
      'tournament': 'Турниры',
      'system': 'Система',
      'achievement': 'Достижения',
      'announcement': 'Анонсы'
    };

    const typeColors = {
      'tournament': 'rgba(255, 152, 0, 0.2)',
      'system': 'rgba(33, 150, 243, 0.2)',
      'achievement': 'rgba(76, 175, 80, 0.2)',
      'announcement': 'rgba(156, 39, 176, 0.2)'
    };

    const typeBorderColors = {
      'tournament': 'rgba(255, 152, 0, 0.5)',
      'system': 'rgba(33, 150, 243, 0.5)',
      'achievement': 'rgba(76, 175, 80, 0.5)',
      'announcement': 'rgba(156, 39, 176, 0.5)'
    };

    // Формируем HTML с новостями
    let html = '';

    news.forEach((item) => {
      // Форматируем дату
      const newsDate = new Date(item.created_at);
      const formattedDate = newsDate.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });

      const emoji = typeEmojis[item.type] || '<svg class="icon" aria-hidden="true"><use href="#icon-news"></use></svg>';
      const typeName = typeNames[item.type] || item.type;
      const bgColor = typeColors[item.type] || 'rgba(255, 255, 255, 0.05)';
      const borderColor = typeBorderColors[item.type] || 'rgba(255, 255, 255, 0.1)';

      html += `
        <div style="
          background: ${bgColor};
          border: 1px solid ${borderColor};
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 15px;
          transition: all 0.3s;
        ">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.5em;">${emoji}</span>
              <span style="
                background: rgba(255, 255, 255, 0.1);
                padding: 4px 12px;
                border-radius: 12px;
                font-size: 0.85em;
                color: #b0b8c8;
              ">${typeName}</span>
            </div>
            <span style="color: #7a8394; font-size: 0.9em;"><svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> ${formattedDate}</span>
          </div>

          <h3 style="
            color: #e0e6f0;
            margin: 0 0 10px 0;
            font-size: 1.1em;
            font-weight: 600;
          ">${item.title}</h3>

          <p style="
            color: #b0b8c8;
            margin: 0;
            line-height: 1.6;
            white-space: pre-wrap;
          ">${item.message}</p>
        </div>
      `;
    });

    container.innerHTML = html;
  } catch (error) {
    console.error("Ошибка загрузки новостей:", error);
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: #f44336;"><svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка загрузки новостей</div>';
  }
}

// ============================================
// ВКЛАДКА НОВОСТЕЙ НА САЙТЕ
// ============================================

// Загрузить вкладку новостей
export async function loadNewsTab() {
  // Сбрасываем пагинацию при открытии вкладки
  newsOffset = 0;
  hasMoreNews = true;
  currentNewsFilter = 'all';

  // Сбрасываем активный фильтр
  document.querySelectorAll('.news-filter-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.type === 'all') {
      btn.classList.add('active');
    }
  });

  // Загружаем новости
  await loadNewsList(true);
}

// Загрузить список новостей
export async function loadNewsList(reset = false) {
  const container = document.getElementById("newsListContainer");

  if (!container) return;

  // Если reset, очищаем контейнер и сбрасываем offset
  if (reset) {
    newsOffset = 0;
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;"><div class="spinner"></div><p>Загрузка новостей...</p></div>';
  } else {
    // Показываем загрузку в кнопке
    const loadMoreBtn = document.getElementById("loadMoreNewsBtn");
    if (loadMoreBtn) {
      loadMoreBtn.innerHTML = '<div class="spinner" style="width: 20px; height: 20px; margin: 0 auto;"></div>';
      loadMoreBtn.disabled = true;
    }
  }

  try {
    // Формируем URL с параметрами
    let url = `/api/news?limit=${newsLimit}&offset=${newsOffset}`;
    if (currentNewsFilter !== 'all') {
      url += `&type=${currentNewsFilter}`;
    }
    // Добавляем username для получения реакций пользователя
    if (currentUser) {
      url += `&username=${encodeURIComponent(currentUser.username)}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Ошибка загрузки новостей");
    }

    const data = await response.json();
    const news = data.news;

    // Проверяем есть ли еще новости
    hasMoreNews = news.length === newsLimit;

    // Обновляем offset для следующей загрузки
    newsOffset += news.length;

    if (reset && (!news || news.length === 0)) {
      container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;"><svg class="icon" aria-hidden="true"><use href="#icon-news"></use></svg> Новостей пока нет</div>';
      document.getElementById("loadMoreNewsContainer").style.display = "none";
      return;
    }

    // Эмодзи для типов новостей
    const typeEmojis = {
      'tournament': '<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg>',
      'system': '<svg class="icon" aria-hidden="true"><use href="#icon-settings"></use></svg>',
      'achievement': '<svg class="icon" aria-hidden="true"><use href="#icon-conference"></use></svg>',
      'announcement': '<svg class="icon" aria-hidden="true"><use href="#icon-announcements"></use></svg>'
    };

    const typeNames = {
      'tournament': 'Турниры',
      'system': 'Система',
      'achievement': 'Достижения',
      'announcement': 'Анонсы'
    };

    const typeColors = {
      'tournament': 'rgba(255, 152, 0, 0.2)',
      'system': 'rgba(33, 150, 243, 0.2)',
      'achievement': 'rgba(76, 175, 80, 0.2)',
      'announcement': 'rgba(156, 39, 176, 0.2)'
    };

    const typeBorderColors = {
      'tournament': 'rgba(255, 152, 0, 0.5)',
      'system': 'rgba(33, 150, 243, 0.5)',
      'achievement': 'rgba(76, 175, 80, 0.5)',
      'announcement': 'rgba(156, 39, 176, 0.5)'
    };

    // Формируем HTML с новостями
    let html = reset ? '' : container.innerHTML;

    news.forEach((item) => {
      // Форматируем дату
      const newsDate = new Date(item.created_at);
      const formattedDate = newsDate.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });

      const emoji = typeEmojis[item.type] || '<svg class="icon" aria-hidden="true"><use href="#icon-news"></use></svg>';
      const typeName = typeNames[item.type] || item.type;
      const bgColor = typeColors[item.type] || 'rgba(255, 255, 255, 0.05)';
      const borderColor = typeBorderColors[item.type] || 'rgba(255, 255, 255, 0.1)';

      // Проверяем является ли пользователь админом
      const isAdmin = currentUser && currentUser.isAdmin === true;

      // Проверяем: это карточка завершения турнира (JSON в message)?
      let isTournamentCompletion = false;
      let tournamentData = null;
      if (item.type === 'tournament' && item.message && item.message.startsWith('{')) {
        try {
          tournamentData = JSON.parse(item.message);
          isTournamentCompletion = true;
        } catch (e) {
          // Не JSON — обычная новость
        }
      }

      if (isTournamentCompletion && tournamentData) {
        // Рендерим специальную карточку завершения турнира
        html += renderTournamentCompletionCard(item, tournamentData, formattedDate, isAdmin);
      } else {
        html += `
          <div class="news-item" style="
            background: ${bgColor};
            border: 1px solid ${borderColor};
          " data-news-id="${item.id}">
            ${isAdmin ? `<button class="news-delete-btn" onclick="deleteNews(${item.id})" title="Удалить новость">×</button>` : ''}

            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.5em;">${emoji}</span>
                <span style="
                  background: rgba(255, 255, 255, 0.1);
                  padding: 4px 12px;
                  border-radius: 12px;
                  font-size: 0.85em;
                  color: #b0b8c8;
                ">${typeName}</span>
              </div>
              <span style="color: #7a8394; font-size: 0.9em;"><svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> ${formattedDate}</span>
            </div>

            <h3 style="
              color: #e0e6f0;
              margin: 0 0 10px 0;
              font-size: 1.1em;
              font-weight: 600;
            ">${item.title}</h3>

            <p style="
              color: #b0b8c8;
              margin: 0 0 15px 0;
              line-height: 1.6;
              white-space: pre-wrap;
            ">${item.message}</p>

            <div style="display: flex; gap: 10px; align-items: center;">
              <button
                class="news-reaction-btn ${item.user_reaction === 'like' ? 'active' : ''}"
                onclick="reactToNews(${item.id}, 'like')"
                onmouseenter="showReactionTooltip(${item.id}, 'like', this)"
                onmouseleave="scheduleHideTooltip()"
                data-news-id="${item.id}"
                data-reaction="like"
              >
                <svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> <span class="like-count">${item.likes || 0}</span>
              </button>
              <button
                class="news-reaction-btn dislike ${item.user_reaction === 'dislike' ? 'active' : ''}"
                onclick="reactToNews(${item.id}, 'dislike')"
                onmouseenter="showReactionTooltip(${item.id}, 'dislike', this)"
                onmouseleave="scheduleHideTooltip()"
                data-news-id="${item.id}"
                data-reaction="dislike"
              >
                <svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> <span class="dislike-count">${item.dislikes || 0}</span>
              </button>
            </div>
          </div>
        `;
      }
    });

    container.innerHTML = html;

    // Показываем/скрываем кнопку "Еще ранее"
    const loadMoreContainer = document.getElementById("loadMoreNewsContainer");
    if (hasMoreNews) {
      loadMoreContainer.style.display = "block";
      const loadMoreBtn = document.getElementById("loadMoreNewsBtn");
      if (loadMoreBtn) {
        loadMoreBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-earlier"></use></svg> Еще ранее';
        loadMoreBtn.disabled = false;
      }
    } else {
      loadMoreContainer.style.display = "none";
    }

  } catch (error) {
    console.error("❌ Ошибка загрузки новостей:", error);
    if (reset) {
      container.innerHTML = '<div style="text-align: center; padding: 40px; color: #f44336;"><svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка загрузки новостей</div>';
    } else {
      const loadMoreBtn = document.getElementById("loadMoreNewsBtn");
      if (loadMoreBtn) {
        loadMoreBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка';
        loadMoreBtn.disabled = false;
      }
    }
  }
}

// Загрузить еще новости
export async function loadMoreNews() {
  await loadNewsList(false);
}

// Фильтр новостей по типу
export async function filterNews(type) {
  currentNewsFilter = type;

  // Обновляем активную кнопку фильтра
  document.querySelectorAll('.news-filter-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.type === type) {
      btn.classList.add('active');
    }
  });

  // Перезагружаем новости
  await loadNewsList(true);
}

// Реакция на новость (лайк/дизлайк)
export async function reactToNews(newsId, reaction) {
  if (!currentUser) {
    await showCustomAlert("Сначала войдите в аккаунт", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  try {
    const response = await fetch(`/api/news/${newsId}/reaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: currentUser.username,
        reaction: reaction
      })
    });

    if (!response.ok) {
      throw new Error("Ошибка отправки реакции");
    }

    const data = await response.json();

    // Обновляем счетчики и активные кнопки
    const newsItem = document.querySelector(`.news-item[data-news-id="${newsId}"]`);
    if (newsItem) {
      const likeBtn = newsItem.querySelector('[data-reaction="like"]');
      const dislikeBtn = newsItem.querySelector('[data-reaction="dislike"]');
      const likeCount = likeBtn.querySelector('.like-count');
      const dislikeCount = dislikeBtn.querySelector('.dislike-count');

      // Обновляем счетчики
      likeCount.textContent = data.likes || 0;
      dislikeCount.textContent = data.dislikes || 0;

      // Обновляем активные кнопки
      likeBtn.classList.remove('active');
      dislikeBtn.classList.remove('active');

      if (data.user_reaction === 'like') {
        likeBtn.classList.add('active');
      } else if (data.user_reaction === 'dislike') {
        dislikeBtn.classList.add('active');
      }
    }

  } catch (error) {
    console.error("❌ Ошибка реакции на новость:", error);
    await showCustomAlert("Ошибка отправки реакции", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// ============================================
// TOOLTIP РЕАКЦИЙ
// ============================================

let tooltipTimeout = null;
let currentTooltip = null;
let hideTooltipTimeout = null;

// Показать tooltip с пользователями, поставившими реакцию
export async function showReactionTooltip(newsId, reactionType, buttonElement) {
  // Очищаем таймауты
  if (tooltipTimeout) {
    clearTimeout(tooltipTimeout);
  }
  if (hideTooltipTimeout) {
    clearTimeout(hideTooltipTimeout);
  }

  // Удаляем старый tooltip если он есть
  if (currentTooltip) {
    currentTooltip.remove();
    currentTooltip = null;
  }

  // Небольшая задержка перед показом tooltip
  tooltipTimeout = setTimeout(async () => {
    try {
      const response = await fetch(`/api/news/${newsId}/reactions/${reactionType}`);
      if (!response.ok) {
        throw new Error("Ошибка загрузки данных");
      }

      const data = await response.json();

      if (data.users && data.users.length > 0) {
        // Создаем tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'reaction-tooltip';

        // Формируем HTML с аватарками и именами
        const usersHtml = data.users.map(user => {
          const avatarUrl = user.avatar || '/img/default-avatar.jpg';
          return `
            <div class="tooltip-user" onclick="showUserProfile(${user.userId}, '${user.username.replace(/'/g, "\\'")}'); hideReactionTooltip();">
              <img src="${avatarUrl}" alt="${user.username}" class="tooltip-avatar" onerror="this.src='/img/default-avatar.jpg'">
              <span class="tooltip-username">${user.username}</span>
            </div>
          `;
        }).join('');

        tooltip.innerHTML = usersHtml;

        // Позиционируем tooltip
        const rect = buttonElement.getBoundingClientRect();
        tooltip.style.position = 'fixed';
        tooltip.style.left = rect.left + 'px';
        tooltip.style.top = (rect.top - 10) + 'px';
        tooltip.style.transform = 'translateY(-100%)';

        // Добавляем обработчики для tooltip
        tooltip.addEventListener('mouseenter', () => {
          if (hideTooltipTimeout) {
            clearTimeout(hideTooltipTimeout);
          }
        });

        tooltip.addEventListener('mouseleave', () => {
          scheduleHideTooltip();
        });

        document.body.appendChild(tooltip);
        currentTooltip = tooltip;
      }
    } catch (error) {
      console.error("❌ Ошибка загрузки списка пользователей:", error);
    }
  }, 300); // Задержка 300мс перед показом
}

export function scheduleHideTooltip() {
  hideTooltipTimeout = setTimeout(() => {
    hideReactionTooltip();
  }, 200); // Небольшая задержка перед скрытием
}

export function hideReactionTooltip() {
  // Очищаем таймауты
  if (tooltipTimeout) {
    clearTimeout(tooltipTimeout);
    tooltipTimeout = null;
  }
  if (hideTooltipTimeout) {
    clearTimeout(hideTooltipTimeout);
    hideTooltipTimeout = null;
  }

  // Удаляем tooltip
  if (currentTooltip) {
    currentTooltip.remove();
    currentTooltip = null;
  }
}

// Удалить новость (только админ)
export async function deleteNews(newsId) {
  if (!currentUser) {
    await showCustomAlert("Сначала войдите в аккаунт", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const confirmed = await showCustomConfirm(
    "Вы уверены, что хотите удалить эту новость?",
    "Удаление новости",
    '<svg class="icon" aria-hidden="true"><use href="#icon-delete"></use></svg>'
  );

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(`/api/admin/news/${newsId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: currentUser.username
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Ошибка удаления новости");
    }

    // Удаляем элемент из DOM
    const newsItem = document.querySelector(`.news-item[data-news-id="${newsId}"]`);
    if (newsItem) {
      newsItem.style.opacity = '0';
      newsItem.style.transform = 'translateX(-20px)';
      setTimeout(() => {
        newsItem.remove();

        // Проверяем остались ли новости
        const container = document.getElementById("newsListContainer");
        if (container && container.children.length === 0) {
          container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;"><svg class="icon" aria-hidden="true"><use href="#icon-news"></use></svg> Новостей пока нет</div>';
          document.getElementById("loadMoreNewsContainer").style.display = "none";
        }
      }, 300);
    }

    await showCustomAlert("Новость успешно удалена", "Успех", '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');

  } catch (error) {
    console.error("❌ Ошибка удаления новости:", error);
    await showCustomAlert(error.message || "Ошибка удаления новости", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Выбрать тип новости
export function selectNewsType(type) {
  selectedNewsType = type;

  // Обновляем визуальное состояние кнопок
  document.querySelectorAll('.news-type-btn').forEach(btn => {
    if (btn.getAttribute('data-type') === type) {
      btn.style.opacity = '1';
      btn.style.borderWidth = '3px';
    } else {
      btn.style.opacity = '0.6';
      btn.style.borderWidth = '2px';
    }
  });
}

// Опубликовать новость
export async function publishNews() {
  const title = document.getElementById("newsTitle").value.trim();
  const message = document.getElementById("newsMessage").value.trim();

  // Валидация
  if (!selectedNewsType) {
    await showCustomAlert("Выберите тип новости", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  if (!title) {
    await showCustomAlert("Введите заголовок новости", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  if (!message) {
    await showCustomAlert("Введите текст новости", "Ошибка", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  try {
    const response = await fetch("/api/admin/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentUser.username,
        type: selectedNewsType,
        title: title,
        message: message
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Ошибка при публикации новости");
    }

    await showCustomAlert(
      `Новость успешно опубликована!\n\nТип: ${selectedNewsType}\nЗаголовок: ${title}`,
      "Успех",
      '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
    );

    closeNewsModal();
  } catch (error) {
    console.error("Ошибка публикации новости:", error);
    await showCustomAlert(
      `Не удалось опубликовать новость:\n${error.message}`,
      "Ошибка",
      '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>'
    );
  }
}

// ============================================
// КАРТОЧКА ЗАВЕРШЕНИЯ ТУРНИРА
// ============================================

/**
 * Рендерит специальную карточку завершения турнира
 */
function renderTournamentCompletionCard(item, data, formattedDate, isAdmin) {
  const w = data.winner;
  const f = data.finalMatch;
  const participants = data.participants || [];

  // Формируем строку счёта финала (только если есть финальный матч)
  let scoreHtml = '';
  let finalDateStr = '';
  if (f && f.score) {
    scoreHtml = `
      <div style="display: inline-flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 8px 18px; margin-bottom: 10px;">
        <span style="font-size: 14px; font-weight: 600; color: ${f.winnerTeam === f.team1 ? '#ffd54f' : '#c9d1d9'};">${f.team1}</span>
        <span style="font-size: 22px; font-weight: 800; color: #e6edf3; letter-spacing: 2px;">${f.score.replace(':', ' : ')}</span>
        <span style="font-size: 14px; font-weight: 600; color: ${f.winnerTeam === f.team2 ? '#ffd54f' : '#c9d1d9'};">${f.team2}</span>
      </div>
    `;
  }

  if (f && f.date) {
    const fDate = new Date(f.date);
    finalDateStr = fDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // Статистика победителя
  const accuracy = w.accuracy || 0;

  // Формируем список участников
  let participantsHtml = '';
  participants.forEach((p, idx) => {
    const isFirst = idx === 0;
    const placeBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.08);font-size:12px;font-weight:700;color:#8b949e;">${p.position}</span>`;
    const avatarUrl = p.avatar || '/img/default-avatar.jpg';
    const avatarBorder = isFirst ? 'border:2px solid #ffc107;box-shadow:0 0 10px rgba(255,193,7,0.4);' : '';
    const nameStyle = isFirst ? 'font-weight:700;color:#ffd54f;' : 'font-weight:500;color:#c9d1d9;';
    const pointsStyle = isFirst
      ? 'color:#ffc107;background:rgba(255,193,7,0.12);border:1px solid rgba(255,193,7,0.35);'
      : 'color:#5a9fd4;background:rgba(90,159,212,0.1);border:1px solid rgba(90,159,212,0.25);';
    const rowBg = isFirst
      ? 'background:rgba(255,193,7,0.1);border-color:rgba(255,193,7,0.35);'
      : 'background:rgba(255,255,255,0.03);border-color:rgba(255,255,255,0.06);';

    // Склонение "очков"
    const pointsWord = getPointsWord(p.totalPoints);

    participantsHtml += `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;border:1px solid;${rowBg}">
        <span style="font-size:18px;line-height:1;min-width:28px;text-align:center;">${placeBadge}</span>
        <img src="${avatarUrl}" alt="${p.username}" onerror="this.src='/img/default-avatar.jpg'" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;${avatarBorder}">
        <span style="flex:1;font-size:14px;${nameStyle}">${p.username}</span>
        <span style="font-size:14px;font-weight:700;border-radius:6px;padding:3px 10px;white-space:nowrap;${pointsStyle}">${p.totalPoints} ${pointsWord}</span>
      </div>
    `;
  });

  return `
    <div class="news-item tournament-completion-card" style="
      background: rgba(255, 152, 0, 0.07);
      border: 1px solid rgba(255, 152, 0, 0.5);
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,152,0,0.1);
      padding: 0;
    " data-news-id="${item.id}">
      ${isAdmin ? `<button class="news-delete-btn" onclick="deleteNews(${item.id})" title="Удалить новость" style="position:absolute;top:10px;right:10px;z-index:5;">×</button>` : ''}

      <!-- Шапка -->
      <div style="display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid rgba(255,152,0,0.2);background:rgba(255,152,0,0.08);">
        <span style="font-size:20px;line-height:1;">🏆</span>
        <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:12px;background:rgba(255,152,0,0.25);border:1px solid rgba(255,152,0,0.5);color:#ff9800;font-size:12px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;">🏆 Турниры</span>
        <span style="margin-left:auto;font-size:12px;color:#8b949e;">${formattedDate}</span>
      </div>

      <!-- Тело -->
      <div style="padding:20px 18px;">

        <!-- Заголовок -->
        <div style="font-size:18px;font-weight:700;color:#e6edf3;margin-bottom:20px;line-height:1.4;">${item.title}</div>

        <!-- Блок победителя -->
        <div style="background:linear-gradient(135deg,rgba(255,193,7,0.12) 0%,rgba(255,152,0,0.08) 100%);border:1px solid rgba(255,193,7,0.35);border-radius:12px;padding:22px 18px;text-align:center;margin-bottom:20px;position:relative;overflow:hidden;">
          <div style="font-size:52px;line-height:1;margin-bottom:8px;filter:drop-shadow(0 0 12px rgba(255,193,7,0.5));">🏆</div>
          <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#ffc107;margin-bottom:6px;opacity:0.85;">Победитель турнира</div>
          <div style="font-size:28px;font-weight:800;color:#ffd54f;letter-spacing:0.5px;margin-bottom:12px;text-shadow:0 0 20px rgba(255,213,79,0.3);">${w.username}</div>
          ${scoreHtml}
          ${finalDateStr ? `<div style="font-size:12px;color:#8b949e;margin-top:4px;">Финал · ${finalDateStr}</div>` : ''}
        </div>

        <!-- Статистика победителя -->
        <div style="margin-bottom:22px;">
          <div style="font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8b949e;margin-bottom:12px;">Статистика ${w.username} в турнире</div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px;">
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 8px;text-align:center;">
              <div style="font-size:22px;font-weight:700;color:#5a9fd4;line-height:1;margin-bottom:4px;">${w.totalBets}</div>
              <div style="font-size:11px;color:#8b949e;font-weight:500;">Прогнозов</div>
            </div>
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 8px;text-align:center;">
              <div style="font-size:22px;font-weight:700;color:#3fb950;line-height:1;margin-bottom:4px;">${w.totalPoints}</div>
              <div style="font-size:11px;color:#8b949e;font-weight:500;">Очков</div>
            </div>
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 8px;text-align:center;">
              <div style="font-size:22px;font-weight:700;color:#ffc107;line-height:1;margin-bottom:4px;">${w.wonCount}</div>
              <div style="font-size:11px;color:#8b949e;font-weight:500;">Угадано</div>
            </div>
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 8px;text-align:center;">
              <div style="font-size:22px;font-weight:700;color:#f85149;line-height:1;margin-bottom:4px;">${w.lostCount}</div>
              <div style="font-size:11px;color:#8b949e;font-weight:500;">Не угадано</div>
            </div>
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 8px;text-align:center;">
              <div style="font-size:22px;font-weight:700;color:#ff9800;line-height:1;margin-bottom:4px;">${accuracy}%</div>
              <div style="font-size:11px;color:#8b949e;font-weight:500;">Точность</div>
            </div>
          </div>
        </div>

        <!-- Разделитель -->
        <div style="display:flex;align-items:center;gap:12px;margin:22px 0 16px;">
          <div style="flex:1;height:1px;background:rgba(255,255,255,0.1);"></div>
          <span style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8b949e;white-space:nowrap;">Участники турнира</span>
          <div style="flex:1;height:1px;background:rgba(255,255,255,0.1);"></div>
        </div>

        <!-- Список участников -->
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:20px;">
          ${participantsHtml}
        </div>

        <!-- Поздравление -->
        <div style="background:linear-gradient(135deg,rgba(90,159,212,0.1) 0%,rgba(255,152,0,0.08) 100%);border:1px solid rgba(90,159,212,0.25);border-radius:12px;padding:16px 18px;margin-bottom:20px;text-align:center;">
          <div style="font-size:28px;margin-bottom:8px;">🎉</div>
          <div style="font-size:14px;color:#c9d1d9;line-height:1.6;">
            Поздравляем победителя турнира <strong style="color:#ffd54f;font-weight:700;">${w.username}</strong>!<br>
            Отличная игра на протяжении всего турнира <strong style="color:#ffd54f;font-weight:700;">${data.eventName}</strong>!<br>
            <span style="font-size:12px;color:#8b949e;margin-top:6px;display:inline-block;">${w.totalPoints} ${getPointsWord(w.totalPoints)} · ${w.totalBets} прогнозов · ${accuracy}% точность</span>
          </div>
        </div>

        <!-- Реакции -->
        <div style="display:flex;gap:10px;align-items:center;">
          <button
            class="news-reaction-btn ${item.user_reaction === 'like' ? 'active' : ''}"
            onclick="reactToNews(${item.id}, 'like')"
            onmouseenter="showReactionTooltip(${item.id}, 'like', this)"
            onmouseleave="scheduleHideTooltip()"
            data-news-id="${item.id}"
            data-reaction="like"
          >
            <svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> <span class="like-count">${item.likes || 0}</span>
          </button>
          <button
            class="news-reaction-btn dislike ${item.user_reaction === 'dislike' ? 'active' : ''}"
            onclick="reactToNews(${item.id}, 'dislike')"
            onmouseenter="showReactionTooltip(${item.id}, 'dislike', this)"
            onmouseleave="scheduleHideTooltip()"
            data-news-id="${item.id}"
            data-reaction="dislike"
          >
            <svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> <span class="dislike-count">${item.dislikes || 0}</span>
          </button>
        </div>

      </div>
    </div>
  `;
}

/**
 * Склонение слова "очко/очка/очков"
 */
function getPointsWord(n) {
  const abs = Math.abs(n) % 100;
  const lastDigit = abs % 10;
  if (abs >= 11 && abs <= 19) return 'очков';
  if (lastDigit === 1) return 'очко';
  if (lastDigit >= 2 && lastDigit <= 4) return 'очка';
  return 'очков';
}
