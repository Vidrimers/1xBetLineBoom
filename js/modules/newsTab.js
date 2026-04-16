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
