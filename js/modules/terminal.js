import { terminalRefreshInterval, terminalAutoScroll } from './state.js';
import * as state from './state.js';
import { setTerminalRefreshInterval, setTerminalAutoScroll } from './state.js';

// ===== ТЕРМИНАЛ =====

// Функция для экранирования HTML
export function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Открыть модальное окно терминала
export function openTerminalModal() {
  const modal = document.getElementById("terminalModal");
  if (modal) {
    modal.classList.add("active");
    console.log("✅ Терминал открыт");
    refreshTerminalLogs();
    if (state.terminalRefreshInterval) clearInterval(state.terminalRefreshInterval);
    setTerminalRefreshInterval(setInterval(refreshTerminalLogs, 1000));
  }
}

// Закрыть модальное окно терминала
export function closeTerminalModal(event) {
  const modal = document.getElementById("terminalModal");
  if (modal) {
    modal.classList.remove("active");
    if (state.terminalRefreshInterval) {
      clearInterval(state.terminalRefreshInterval);
      setTerminalRefreshInterval(null);
    }
  }
}

// Получить логи терминала с сервера
export async function refreshTerminalLogs() {
  try {
    const response = await fetch("/api/terminal-logs");

    if (!response.ok) throw new Error("Ошибка загрузки логов");

    const data = await response.json();

    const content = document.getElementById("terminalContent");

    if (content) {
      if (data.logs) {
        const lines = data.logs.split("\n");

        // Создаем HTML разноцветный вывод
        const htmlContent = lines
          .map((line) => {
            let color = "#00ff00"; // зелёный по умолчанию
            let className = "";

            // Определяем цвет в зависимости от типа лога
            if (line.includes("<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>") || line.includes("ERROR")) {
              color = "#ff3333"; // красный для ошибок
              className = "error";
            } else if (line.includes("<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>️") || line.includes("WARN")) {
              color = "#ffff00"; // жёлтый для предупреждений
              className = "warn";
            } else if (line.includes("<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>") || line.includes("успешно")) {
              color = "#00ff00"; // зелёный для успеха
              className = "success";
            } else if (line.includes("<svg class="icon" aria-hidden="true"><use href="#icon-telegram"></use></svg>") || line.includes("сообщение")) {
              color = "#00ffff"; // голубой для сообщений
              className = "info";
            } else if (line.includes("<svg class="icon" aria-hidden="true"><use href="#icon-telegram"></use></svg>") || line.includes("Telegram")) {
              color = "#00bfff"; // синий для телеграма
              className = "telegram";
            } else if (line.includes("[")) {
              color = "#888888"; // серый для времени
              className = "time";
            }

            return `<div style="color: ${color}" class="log-line ${className}">${escapeHtml(
              line
            )}</div>`;
          })
          .join("");

        content.innerHTML = htmlContent || "[Логи пусты]";

        // Автоскролл в конец если включен
        if (state.terminalAutoScroll) {
          content.scrollTop = content.scrollHeight;
        }
      }
    }
  } catch (error) {
    const content = document.getElementById("terminalContent");
    if (content) {
      content.innerHTML = `<div style="color: #ff3333"><svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка загрузки логов: ${escapeHtml(
        error.message
      )}</div>`;
    }
  }
}

// Очистить логи терминала
export async function clearTerminalLogs() {
  if (!confirm("Вы уверены, что хотите очистить логи?")) return;

  try {
    const response = await fetch("/api/terminal-logs", {
      method: "DELETE",
    });

    if (!response.ok) throw new Error("Ошибка очистки логов");

    const content = document.getElementById("terminalContent");
    if (content) {
      content.textContent = "[<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Логи очищены]";
    }

    // Обновляем логи через 500мс
    setTimeout(refreshTerminalLogs, 500);
  } catch (error) {
    console.error("Ошибка при очистке логов:", error);
    alert("Ошибка при очистке логов: " + error.message);
  }
}

// Сохранить логи терминала на ПК
export async function saveTerminalLogs() {
  try {
    const response = await fetch("/api/terminal-logs");
    if (!response.ok) throw new Error("Ошибка загрузки логов");

    const data = await response.json();
    if (!data.logs) {
      alert("<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Нет логов для сохранения");
      return;
    }

    const blob = new Blob([data.logs], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, -5);
    a.download = `terminal-logs-${timestamp}.txt`;

    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    console.log("✅ Логи сохранены на ПК");
  } catch (error) {
    console.error("Ошибка при сохранении логов:", error);
    alert("<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Ошибка при сохранении логов: " + error.message);
  }
}

// Переключить автоскролл
export function toggleTerminalAutoScroll() {
  setTerminalAutoScroll(!state.terminalAutoScroll);
  const btn = document.getElementById("terminalAutoScrollBtn");
  if (btn) {
    if (state.terminalAutoScroll) {
      btn.style.background = "rgba(76, 175, 80, 0.7)";
      btn.style.borderColor = "#4caf50";
      btn.textContent = "⬇️ Auto";
      // Сразу скроллим вниз
      const content = document.getElementById("terminalContent");
      if (content) content.scrollTop = content.scrollHeight;
    } else {
      btn.style.background = "rgba(255, 87, 34, 0.7)";
      btn.style.borderColor = "#ff5722";
      btn.textContent = "⏸️ Стоп";
    }
  }
}
