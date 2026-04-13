// Модуль управления темами

import { currentUser } from './state.js';

// Вспомогательная функция для показа статуса сохранения
// (showSaveStatus определена в index.js / main.js)
function _showSaveStatus(id, status) {
  if (typeof showSaveStatus === 'function') {
    showSaveStatus(id, status);
  }
}

// Предварительный просмотр темы (без сохранения на сервере)
export function previewTheme(themeName) {
  console.log(`🎨 Предпросмотр темы: ${themeName}`);

  // Удаляем все классы тем
  document.body.classList.remove(
    "theme-default",
    "theme-hacker-green",
    "theme-solarized",
    "theme-matrix",
    "theme-cyberpunk",
    "theme-leagueChampions",
    "theme-leagueEurope"
  );

  // Добавляем новый класс темы
  document.body.classList.add(themeName);

  console.log(`✅ Тема ${themeName} применена для предпросмотра`);
}

// Сохранить выбранную тему
export async function saveTheme() {
  if (!currentUser) {
    alert("Сначала войдите в систему");
    return;
  }

  const themeSelect = document.getElementById("themeSelect");
  const themeName = themeSelect.value;

  try {
    _showSaveStatus('themeStatus', 'saving');

    const response = await fetch(`/api/user/${currentUser.id}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: themeName }),
    });

    if (response.ok) {
      localStorage.setItem("selectedTheme", themeName);

      // Применяем тему
      document.body.classList.remove(
        "theme-default",
        "theme-hacker-green",
        "theme-solarized",
        "theme-matrix",
        "theme-cyberpunk",
        "theme-leagueChampions",
        "theme-leagueEurope"
      );
      document.body.classList.add(themeName);

      _showSaveStatus('themeStatus', 'saved');
    } else {
      throw new Error("Ошибка сохранения");
    }
  } catch (error) {
    console.error("❌ Ошибка сохранения темы на сервере:", error);
    _showSaveStatus('themeStatus', 'error');
  }
}

// Изменить тему (используется при загрузке сохраненной темы)
export async function changeTheme(themeName) {
  console.log(`🎨 Смена темы на: ${themeName}`);

  // Удаляем все классы тем
  document.body.classList.remove(
    "theme-default",
    "theme-hacker-green",
    "theme-solarized",
    "theme-matrix",
    "theme-cyberpunk",
    "theme-leagueChampions",
    "theme-leagueEurope"
  );

  // Добавляем новый класс темы
  document.body.classList.add(themeName);

  console.log(`✅ Тема ${themeName} применена`);
}

// Загрузить сохраненную тему при загрузке страницы
export async function loadSavedTheme() {
  // Сначала загружаем из localStorage для быстрого применения
  let savedTheme = localStorage.getItem("selectedTheme") || "theme-default";

  console.log(`📂 Загружена тема из localStorage: ${savedTheme}`);

  // Применяем тему
  document.body.classList.add(savedTheme);

  // Устанавливаем правильное значение в select
  const themeSelect = document.getElementById("themeSelect");
  if (themeSelect) {
    themeSelect.value = savedTheme;
  }

  // Если пользователь залогинен, загружаем тему с сервера
  if (currentUser) {
    try {
      const response = await fetch(`/api/user/${currentUser.id}/notifications`);
      if (response.ok) {
        const data = await response.json();
        if (data.theme && data.theme !== savedTheme) {
          // Если тема на сервере отличается, применяем её
          savedTheme = data.theme;
          localStorage.setItem("selectedTheme", savedTheme);

          // Удаляем старую тему и применяем новую
          document.body.classList.remove(
            "theme-default",
            "theme-hacker-green",
            "theme-solarized",
            "theme-matrix",
            "theme-cyberpunk",
            "theme-leagueChampions",
            "theme-leagueEurope"
          );
          document.body.classList.add(savedTheme);

          if (themeSelect) {
            themeSelect.value = savedTheme;
          }

          console.log(`📂 Тема обновлена с сервера: ${savedTheme}`);
        }
      }
    } catch (error) {
      console.error("❌ Ошибка загрузки темы с сервера:", error);
    }
  }
}
