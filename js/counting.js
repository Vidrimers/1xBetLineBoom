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

        <div style="display: flex; gap: 15px; flex-wrap: wrap;">
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
      </div>

      <div id="countingResults" style="margin-top: 20px;">
        <div class="empty-message">Выберите даты и нажмите "Обновить"</div>
      </div>
    `;
  }
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
