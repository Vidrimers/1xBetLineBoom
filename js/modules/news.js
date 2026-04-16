// ===== МОДУЛЬ: RSS НОВОСТИ =====
// Функции для работы с RSS новостями и управления ключевыми словами

import { currentUser } from './state.js';
import { showCustomAlert, showCustomConfirm } from './ui.js';

// ============================================
// RSS НОВОСТИ (МОДАЛЬНОЕ ОКНО)
// ============================================

let currentRssTournament = 'all';

// Открыть модалку RSS новостей
export async function openRssNewsModal() {
  const modal = document.getElementById("rssNewsModal");
  if (modal) {
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";

    // Отправляем уведомление админу о просмотре RSS новостей
    if (currentUser && currentUser.username) {
      fetch("/api/notify-news-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: currentUser.username,
          type: 'rss'
        })
      }).catch(err => {
        console.error("⚠️ Ошибка отправки уведомления:", err);
      });
    }

    // Загружаем новости
    await loadRssNews('all');
  }
}

// Закрыть модалку RSS новостей
export function closeRssNewsModal() {
  const modal = document.getElementById("rssNewsModal");
  if (modal) {
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// Загрузить RSS новости
export async function loadRssNews(tournament) {
  currentRssTournament = tournament;
  const container = document.getElementById("rssNewsContainer");

  if (!container) return;

  // Показываем загрузку
  container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;"><div class="spinner"></div><p>Загрузка новостей...</p></div>';

  try {
    const response = await fetch(`/api/rss-news?tournament=${tournament}`);

    if (!response.ok) {
      throw new Error("Ошибка загрузки RSS новостей");
    }

    const data = await response.json();
    const news = data.news;

    if (!news || news.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;"><svg class="icon" aria-hidden="true"><use href="#icon-news"></use></svg> Новостей не найдено</div>';
      return;
    }

    // Формируем HTML с новостями
    let html = '';

    news.forEach((item) => {
      // Форматируем дату
      const newsDate = new Date(item.pubDate);
      const formattedDate = newsDate.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });

      // Обрезаем описание до 200 символов
      let description = item.description || '';
      if (description.length > 200) {
        description = description.substring(0, 200) + '...';
      }

      html += `
        <div class="rss-news-item">
          <div>
            <a href="${item.link}" target="_blank" rel="noopener noreferrer">
              ${item.title}
            </a>
            <span class="rss-news-source">${item.source}</span>
          </div>
          ${description ? `<div class="rss-news-description">${description}</div>` : ''}
          <div class="rss-news-date"><svg class="icon" aria-hidden="true"><use href="#icon-tournaments"></use></svg> ${formattedDate}</div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Показываем информацию о кэше
    if (data.cached) {
      console.log("📰 RSS новости загружены из кэша");
    } else {
      console.log(`📰 Загружено ${news.length} свежих RSS новостей`);
    }

  } catch (error) {
    console.error("❌ Ошибка загрузки RSS новостей:", error);
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: #f44336;"><svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка загрузки новостей</div>';
  }
}

// Фильтр RSS новостей по турниру
export async function filterRssNews(tournament) {
  currentRssTournament = tournament;

  // Обновляем активную кнопку фильтра
  document.querySelectorAll('.rss-filter-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.tournament === tournament) {
      btn.classList.add('active');
    }
  });

  // Загружаем новости
  await loadRssNews(tournament);
}

// ============================================
// УПРАВЛЕНИЕ КЛЮЧЕВЫМИ СЛОВАМИ RSS
// ============================================

let allRssKeywords = [];

// Открыть модалку управления ключевыми словами
export async function openRssKeywordsModal() {
  const modal = document.getElementById("rssKeywordsModal");
  if (modal) {
    document.body.style.overflow = 'hidden';
    modal.style.display = "flex";

    // Загружаем ключевые слова
    await loadRssKeywords();
  }
}

// Закрыть модалку управления ключевыми словами
export function closeRssKeywordsModal() {
  const modal = document.getElementById("rssKeywordsModal");
  if (modal) {
    document.body.style.overflow = '';
    modal.style.display = "none";
  }
}

// Загрузить все ключевые слова
export async function loadRssKeywords() {
  const container = document.getElementById("rssKeywordsList");

  if (!container) return;

  // Показываем загрузку
  container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;"><div class="spinner"></div><p>Загрузка ключевых слов...</p></div>';

  try {
    const response = await fetch("/api/rss-keywords");

    if (!response.ok) {
      throw new Error("Ошибка загрузки ключевых слов");
    }

    const data = await response.json();
    allRssKeywords = data.keywords;

    // Применяем фильтр
    filterKeywordsByTournament();

  } catch (error) {
    console.error("❌ Ошибка загрузки ключевых слов:", error);
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: #f44336;"><svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка загрузки ключевых слов</div>';
  }
}

// Фильтровать ключевые слова по турниру
export function filterKeywordsByTournament() {
  const container = document.getElementById("rssKeywordsList");
  const filterSelect = document.getElementById("keywordsFilterTournament");

  if (!container || !filterSelect) return;

  const selectedTournament = filterSelect.value;

  // Фильтруем ключевые слова
  let filteredKeywords = allRssKeywords;
  if (selectedTournament !== 'all_view') {
    filteredKeywords = allRssKeywords.filter(kw => kw.tournament === selectedTournament);
  }

  if (filteredKeywords.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: #b0b8c8;"><svg class="icon" aria-hidden="true"><use href="#icon-manual"></use></svg> Ключевых слов не найдено</div>';
    return;
  }

  // Группируем по турнирам
  const grouped = {};
  filteredKeywords.forEach(kw => {
    if (!grouped[kw.tournament]) {
      grouped[kw.tournament] = [];
    }
    grouped[kw.tournament].push(kw);
  });

  // Названия турниров
  const tournamentNames = {
    'all': '<svg class="icon" aria-hidden="true"><use href="#icon-globe"></use></svg> Глобальные (все турниры)',
    'ucl': '<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> Лига чемпионов',
    'uel': '<svg class="icon" aria-hidden="true"><use href="#icon-conference"></use></svg> Лига Европы',
    'uecl': '<svg class="icon" aria-hidden="true"><use href="#icon-conference"></use></svg> Лига конференций',
    'supercup': '<svg class="icon" aria-hidden="true"><use href="#icon-conference"></use></svg> Суперкубок УЕФА',
    'worldcup': '<svg class="icon" aria-hidden="true"><use href="#icon-world-cup"></use></svg> Чемпионат мира',
    'euro': '🇪🇺 Евро',
    'epl': '<svg class="icon" aria-hidden="true"><use href="#icon-england"></use></svg>󠁧󠁢󠁥󠁮󠁧󠁿 АПЛ',
    'rpl': '🇷🇺 РПЛ',
    'seriea': '🇮🇹 Серия А',
    'bundesliga': '🇩🇪 Бундеслига',
    'ligue1': '🇫🇷 Лига 1'
  };

  // Формируем HTML
  let html = '';

  Object.keys(grouped).sort().forEach(tournament => {
    const keywords = grouped[tournament];
    const tournamentName = tournamentNames[tournament] || tournament;

    html += `
      <div style="
        background: rgba(30, 35, 45, 0.5);
        border: 1px solid rgba(90, 159, 212, 0.3);
        border-radius: 8px;
        padding: 15px;
      ">
        <h4 style="margin: 0 0 10px 0; color: #5a9fd4;">${tournamentName}</h4>
        <div style="display: flex; flex-direction: column; gap: 8px;">
    `;

    keywords.forEach(kw => {
      const typeEmoji = kw.type === 'include' ? '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>' : '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>';
      const typeColor = kw.type === 'include' ? '#4caf50' : '#f44336';

      html += `
        <div class="keyword-item" style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px;
          background: rgba(20, 25, 35, 0.5);
          border: 1px solid rgba(90, 159, 212, 0.2);
          border-radius: 4px;
        ">
          <div class="keyword-info" style="display: flex; align-items: center; gap: 10px; flex: 1;">
            <span style="font-size: 1.2em;">${typeEmoji}</span>
            <span style="color: #e0e6f0; font-size: 0.95em;">${kw.keyword}</span>
            <span style="
              padding: 2px 8px;
              background: ${typeColor}33;
              color: ${typeColor};
              border-radius: 4px;
              font-size: 0.85em;
            ">${kw.type === 'include' ? 'Включить' : 'Исключить'}</span>
            <span style="
              padding: 2px 8px;
              background: rgba(255, 152, 0, 0.2);
              color: #ff9800;
              border-radius: 4px;
              font-size: 0.85em;
            ">⭐ ${kw.priority}</span>
          </div>
          <button class="keyword-delete-btn" onclick="deleteRssKeyword(${kw.id})" style="
            padding: 6px 12px;
            background: rgba(244, 67, 54, 0.7);
            color: #ffb3b3;
            border: 1px solid #f44336;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.3s ease;
          ">
            <svg class="icon" aria-hidden="true"><use href="#icon-delete"></use></svg>️ Удалить
          </button>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// Добавить новое ключевое слово
export async function addRssKeyword() {
  const tournament = document.getElementById("newKeywordTournament").value;
  const keyword = document.getElementById("newKeywordText").value.trim();
  const type = document.getElementById("newKeywordType").value;
  const priority = parseInt(document.getElementById("newKeywordPriority").value);

  if (!keyword) {
    await showCustomAlert("Введите ключевое слово");
    return;
  }

  if (!currentUser || !currentUser.username) {
    await showCustomAlert("Ошибка: пользователь не авторизован");
    return;
  }

  try {
    const response = await fetch("/api/admin/rss-keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentUser.username,
        tournament,
        keyword,
        type,
        priority
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Ошибка добавления ключевого слова");
    }

    // Очищаем форму
    document.getElementById("newKeywordText").value = "";
    document.getElementById("newKeywordPriority").value = "5";

    // Перезагружаем список
    await loadRssKeywords();

    await showCustomAlert("<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Ключевое слово добавлено");

  } catch (error) {
    console.error("❌ Ошибка добавления ключевого слова:", error);
    await showCustomAlert(`<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка: ${error.message}`);
  }
}

// Удалить ключевое слово
export async function deleteRssKeyword(id) {
  const confirmed = await showCustomConfirm("Вы уверены, что хотите удалить это ключевое слово?");

  if (!confirmed) return;

  if (!currentUser || !currentUser.username) {
    await showCustomAlert("Ошибка: пользователь не авторизован");
    return;
  }

  try {
    const response = await fetch(`/api/admin/rss-keywords/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentUser.username
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Ошибка удаления ключевого слова");
    }

    // Перезагружаем список
    await loadRssKeywords();

    await showCustomAlert("<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Ключевое слово удалено");

  } catch (error) {
    console.error("❌ Ошибка удаления ключевого слова:", error);
    await showCustomAlert(`<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка: ${error.message}`);
  }
}
