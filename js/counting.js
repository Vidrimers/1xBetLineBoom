// ===== ПОДСЧЁТ =====

function loadCounting() {
  if (!isAdmin()) {
    alert("У вас нет прав");
    return;
  }

  const countingContainer = document.getElementById("countingContainer");

  if (countingContainer) {
    // Получаем сегодняшнюю дату и вчерашнюю
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const todayStr = formatDate(today);
    const yesterdayStr = formatDate(yesterday);

    countingContainer.innerHTML = `
      <div style="display: flex; gap: 10px; margin-bottom: 20px; align-items: center; flex-wrap: wrap;">
        <button id="prevDayBtn" onclick="setCountingPreviousDay()" style="
          padding: 8px 16px;
          background: rgba(58, 123, 213, 0.7);
          color: #e0e6f0;
          border: 1px solid #3a7bd5;
          border-radius: 5px;
          cursor: pointer;
          font-size: 0.9em;
          transition: all 0.3s ease;
        " onmouseover="this.style.background='rgba(58, 123, 213, 0.95)'" onmouseout="this.style.background='rgba(58, 123, 213, 0.7)'">
          ← Предыдущая дата
        </button>

        <button id="todayBtn" onclick="setCountingToday()" style="
          padding: 8px 16px;
          background: rgba(76, 175, 80, 0.7);
          color: #c8e6c9;
          border: 1px solid #4caf50;
          border-radius: 5px;
          cursor: pointer;
          font-size: 0.9em;
          transition: all 0.3s ease;
        " onmouseover="this.style.background='rgba(76, 175, 80, 0.95)'" onmouseout="this.style.background='rgba(76, 175, 80, 0.7)'">
          Сегодня
        </button>

        <div style="display: flex; gap: 5px; flex-wrap: wrap; flex-direction: column; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <label for="countingDateFrom" style="color: #b0b8c8; font-weight: 500;">Дата от:</label>
            <input type="date" id="countingDateFrom" value="${yesterdayStr}" style="
              padding: 6px 10px;
              background: rgba(58, 123, 213, 0.1);
              border: 1px solid #3a7bd5;
              border-radius: 4px;
              color: #e0e6f0;
              font-size: 0.9em;
              cursor: pointer;
            ">
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <label for="countingDateTo" style="color: #b0b8c8; font-weight: 500;">Дата до:</label>
            <input type="date" id="countingDateTo" value="${todayStr}" style="
              padding: 6px 10px;
              background: rgba(58, 123, 213, 0.1);
              border: 1px solid #3a7bd5;
              border-radius: 4px;
              color: #e0e6f0;
              font-size: 0.9em;
              cursor: pointer;
            ">
          </div>
        </div>

        <button id="updateCountingBtn" onclick="updateCountingResults()" style="
          padding: 8px 16px;
          background: rgba(255, 193, 7, 0.7);
          color: #fff8e1;
          border: 1px solid #fbc02d;
          border-radius: 5px;
          cursor: pointer;
          font-size: 0.9em;
          font-weight: 500;
          transition: all 0.3s ease;
        " onmouseover="this.style.background='rgba(255, 193, 7, 0.95)'" onmouseout="this.style.background='rgba(255, 193, 7, 0.7)'">
          🔄 Обновить
        </button>

        <button id="countingCalculateBtn" style="
          padding: 8px 16px;
          background: rgba(76, 175, 80, 0.7);
          color: #c8e6c9;
          border: 1px solid #4caf50;
          border-radius: 5px;
          cursor: pointer;
          font-size: 0.9em;
          font-weight: 500;
          transition: all 0.3s ease;
          margin-left: 8px;
        " onmouseover="this.style.background='rgba(76, 175, 80, 0.95)'" onmouseout="this.style.background='rgba(76, 175, 80, 0.7)'">
          📊 Считать
        </button>
      </div>

      <div id="countingResults" style="margin-top: 20px;">
        <div class="empty-message">Нажмите "Обновить" для загрузки ставок</div>
      </div>
    `;

    // Автоматически загружаем ставки на сегодня
    updateCountingResults();
  }
}

async function updateCountingResults() {
  const dateFrom = document.getElementById("countingDateFrom")?.value;
  const dateTo = document.getElementById("countingDateTo")?.value;

  if (!dateFrom || !dateTo) {
    alert("Выберите даты");
    return;
  }

  try {
    // Получаем все ставки со статусом "pending"
    const response = await fetch(
      `/api/counting-bets?dateFrom=${dateFrom}&dateTo=${dateTo}`
    );

    if (!response.ok) {
      throw new Error("Ошибка при загрузке ставок");
    }

    const bets = await response.json();
    displayCountingBets(bets, dateFrom, dateTo);
  } catch (error) {
    console.error("Ошибка:", error);
    document.getElementById("countingResults").innerHTML =
      '<div class="empty-message">Ошибка при загрузке ставок</div>';
  }
}

function displayCountingBets(bets, dateFrom, dateTo) {
  const resultsDiv = document.getElementById("countingResults");

  if (!bets || bets.length === 0) {
    resultsDiv.innerHTML =
      '<div class="empty-message">Нет ставок в статусе "В ожидании" за выбранный период</div>';
    return;
  }

  // Группируем ставки по пользователям и турнирам
  const grouped = {};

  bets.forEach((bet) => {
    const key = `${bet.username}__${bet.event_name}`;
    if (!grouped[key]) {
      grouped[key] = {
        username: bet.username,
        event_name: bet.event_name,
        bets: [],
      };
    }
    grouped[key].bets.push(bet);
  });

  // Строим HTML
  let html = `<div style="margin-bottom: 20px;">`;

  Object.values(grouped).forEach((group) => {
    html += `
      <div style="background: rgba(40, 44, 54, 0.85); padding: 10px; border-radius: 8px; margin-bottom: 5px; border-left: 3px solid #5a9fd4;">
        <div style="color: #5a9fd4; font-weight: 600; margin-bottom: 12px; font-size: 1em;">
          👤 ${group.username} — 🏆 ${group.event_name}
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(185px, 1fr)); gap: 5px;">
    `;

    group.bets.forEach((bet) => {
      const matchInfo = `${bet.team1_name || "Команда1"} vs ${
        bet.team2_name || "Команда2"
      }`;
      const betDisplay = bet.is_final_bet
        ? `${bet.parameter_type}: ${bet.prediction}`
        : bet.prediction === "draw"
        ? "Ничья"
        : bet.prediction === "team1"
        ? bet.team1_name
        : bet.team2_name;

      html += `
        <div style="background: rgba(58, 123, 213, 0.2); padding: 12px; border-radius: 6px; border-left: 2px solid #4db8a8;">
          <div style="color: #b0b8c8; font-size: 0.85em; margin-bottom: 8px;">${matchInfo}</div>
          <div style="color: #fff; font-weight: 500; margin-bottom: 6px;">📌 ${betDisplay}</div>
          <div style="color: #999; font-size: 0.8em;">
            ${
              bet.match_date
                ? new Date(bet.match_date).toLocaleString("ru-RU")
                : "Дата неизвестна"
            }
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  html += `</div>`;
  resultsDiv.innerHTML = html;
}

function setCountingPreviousDay() {
  const dateFromInput = document.getElementById("countingDateFrom");
  const dateToInput = document.getElementById("countingDateTo");

  if (dateFromInput && dateToInput) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const yesterdayStr = formatDate(yesterday);
    dateFromInput.value = yesterdayStr;
    dateToInput.value = yesterdayStr;
  }
}

function setCountingToday() {
  const dateFromInput = document.getElementById("countingDateFrom");
  const dateToInput = document.getElementById("countingDateTo");

  if (dateFromInput && dateToInput) {
    const today = new Date();

    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const todayStr = formatDate(today);
    dateFromInput.value = todayStr;
    dateToInput.value = todayStr;
  }
}
