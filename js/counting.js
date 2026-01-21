// ===== ПОДСЧЁТ =====

// Маппинг кодов турниров на файлы словарей команд
const COMPETITION_DICTIONARY_MAPPING = {
  'CL': '/names/LeagueOfChampionsTeams.json',
  'EL': '/names/EuropaLeague.json',
  'PL': '/names/PremierLeague.json',
  'BL1': '/names/Bundesliga.json',
  'PD': '/names/LaLiga.json',
  'SA': '/names/SerieA.json',
  'FL1': '/names/Ligue1.json',
  'DED': '/names/Eredivisie.json',
  'RPL': '/names/RussianPremierLeague.json',
  'WC': '/names/Countries.json',
  'EC': '/names/Countries.json'
};

// Переменная для хранения выбранной лиги
let selectedCompetition = "CL"; // По умолчанию Champions League

// Маппинг команд из JSON файлов (русское название -> английское из API)
let teamMappings = {};

// Загрузить маппинг команд для турнира
async function loadTeamMapping(competition) {
  const filePath = COMPETITION_DICTIONARY_MAPPING[competition];
  if (!filePath) {
    console.warn(`⚠️ Нет файла маппинга для турнира ${competition}`);
    return {};
  }

  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      console.warn(`⚠️ Не удалось загрузить ${filePath}`);
      return {};
    }

    const data = await response.json();
    
    // Поддержка старого формата (массив) и нового (объект)
    if (Array.isArray(data.teams)) {
      // Старый формат - возвращаем пустой маппинг
      console.log(`ℹ️ Файл ${filePath} использует старый формат (массив)`);
      return {};
    } else if (typeof data.teams === 'object') {
      // Новый формат - возвращаем маппинг
      console.log(`✅ Загружен маппинг команд для ${competition}: ${Object.keys(data.teams).length} команд`);
      return data.teams;
    }

    return {};
  } catch (error) {
    console.error(`❌ Ошибка загрузки маппинга для ${competition}:`, error);
    return {};
  }
}

function loadCounting() {
  if (!canViewCounting()) {
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
          Предыдущая дата
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

        <button id="countingCalculateBtn" onclick="calculateCountingResults()" style="
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

      <div class="countTournaments" style="display: flex; gap: 8px; margin-bottom: 20px; align-items: center; flex-wrap: wrap; justify-content: center;">
        <button id="comp-WC" onclick="selectCompetition('WC')" title="World Cup">
          <img src="img/cups/world-cup.png" alt="WC" style="width: 20px; height: 20px; object-fit: contain;" />
          World Cup
        </button>
        <button id="comp-CL" onclick="selectCompetition('CL')" title="Champions League">
          <img src="img/cups/champions-league.png" alt="CL" style="width: 20px; height: 20px; object-fit: contain;" />
          Champions League
        </button>
        <button id="comp-EL" onclick="selectCompetition('EL')" title="Europa League">
          <img src="img/cups/european-league.png" alt="EL" style="width: 20px; height: 20px; object-fit: contain;" />
          Europa League
        </button>
        <button id="comp-EC" onclick="selectCompetition('EC')" title="Euro">
          <img src="img/cups/uefa-euro.png" alt="EC" style="width: 20px; height: 20px; object-fit: contain;" />
          Euro
        </button>
        <button id="comp-BL1" onclick="selectCompetition('BL1')" title="Bundesliga">
          <img src="img/cups/bundesliga.png" alt="BL1" style="width: 20px; height: 20px; object-fit: contain;" />
          Bundesliga
        </button>
        <button id="comp-DED" onclick="selectCompetition('DED')" title="Eredivisie">
          🇳🇱 Eredivisie
        </button>
        <button id="comp-PD" onclick="selectCompetition('PD')" title="La Liga">
          <img src="img/cups/spain-la-liga.png" alt="PD" style="width: 20px; height: 20px; object-fit: contain;" />
          La Liga
        </button>
        <button id="comp-FL1" onclick="selectCompetition('FL1')" title="Ligue 1">
          <img src="img/cups/france-league-ligue-1.png" alt="FL1" style="width: 20px; height: 20px; object-fit: contain;" />
          Ligue 1
        </button>
        <button id="comp-PL" onclick="selectCompetition('PL')" title="Premier League">
          <img src="img/cups/england-premier-league.png" alt="PL" style="width: 20px; height: 20px; object-fit: contain;" />
          Premier League
        </button>
        <button id="comp-RPL" onclick="selectCompetition('RPL')" title="Russian Premier League">
          <img src="img/cups/rpl.png" alt="RPL" style="width: 20px; height: 20px; object-fit: contain;" />
          РПЛ
        </button>
        <button id="comp-SA" onclick="selectCompetition('SA')" title="Serie A">
          <img src="img/cups/serie-a.png" alt="SA" style="width: 20px; height: 20px; object-fit: contain;" />
          Serie A
        </button>
      </div>

      <div id="countingResults" style="margin-top: 20px;">
        <div class="empty-message">Нажмите "Обновить" для загрузки ставок</div>
      </div>
    `;

    // Автоматически загружаем ставки на сегодня
    updateCountingResults();

    // Подсветим кнопку выбранной лиги по умолчанию (CL)
    selectCompetition(selectedCompetition || "CL");
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
      <div style="background: rgba(90, 159, 212, .1);; padding: 10px; border-radius: 8px; margin-bottom: 5px; border-left: 3px solid #5a9fd4;">
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
      const formattedMatchDate = bet.match_date
        ? new Date(bet.match_date).toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Дата неизвестна";

      // Проверяем есть ли прогноз на счет
      let scorePredictionHtml = '';
      if (bet.score_team1 !== null && bet.score_team2 !== null) {
        scorePredictionHtml = `
          <div style="color: #ffa726; font-size: 0.85em; margin-top: 4px; padding: 4px 6px; background: rgba(255, 167, 38, 0.2); border-radius: 4px; border-left: 2px solid #ffa726;">
            🎯 Прогноз счета: <strong>${bet.score_team1}:${bet.score_team2}</strong>
          </div>
        `;
      }

      html += `
        <div style="background: rgba(58, 123, 213, 0.2); padding: 12px; border-radius: 6px; border-left: 2px solid #4db8a8;">
          <div style="color: #b0b8c8; font-size: 0.85em; margin-bottom: 8px;">${matchInfo}</div>
          <div style="color: #fff; font-weight: 500; margin-bottom: 6px;">📌 ${betDisplay}</div>
          ${scorePredictionHtml}
          <div style="color: #999; font-size: 0.8em; margin-top: 4px;">
            ${formattedMatchDate}
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

// Выбрать соревнование
function selectCompetition(code) {
  selectedCompetition = code;
  
  console.log(`🏆 Выбран турнир: ${code}`);
  
  // Загружаем маппинг команд для выбранного турнира
  loadTeamMapping(code).then(mapping => {
    teamMappings = mapping;
    console.log(`📋 Маппинг команд для ${code} загружен:`, mapping);
    console.log(`📊 Количество команд в маппинге: ${Object.keys(mapping).length}`);
  });
  
  const competitionNames = {
    WC: "World Cup",
    CL: "Champions League",
    EL: "Europa League",
    EC: "Euro",
    BL1: "Bundesliga",
    DED: "Eredivisie",
    PD: "La Liga",
    FL1: "Ligue 1",
    PL: "Premier League",
    RPL: "Russian Premier League",
    SA: "Serie A",
  };

  // Убираем выделение со всех кнопок
  const allButtons = document.querySelectorAll("[id^='comp-']");
  allButtons.forEach((btn) => {
    btn.classList.remove('active');
  });

  // Выделяем выбранную кнопку
  const selectedBtn = document.getElementById(`comp-${code}`);
  if (selectedBtn) {
    selectedBtn.classList.add('active');
  }

  console.log("Выбрана лига:", competitionNames[code]);
}

// Подсчитать результаты ставок
async function calculateCountingResults() {
  const dateFrom = document.getElementById("countingDateFrom")?.value;
  const dateTo = document.getElementById("countingDateTo")?.value;
  const resultsDiv = document.getElementById("countingResults");

  if (!dateFrom || !dateTo) {
    alert("Выберите даты");
    return;
  }

  resultsDiv.innerHTML =
    '<div class="empty-message">⏳ Загружаем матчи и проверяем ставки...</div>';

  try {
    // Получаем все ставки
    const betsResponse = await fetch(
      `/api/counting-bets?dateFrom=${dateFrom}&dateTo=${dateTo}`
    );

    if (!betsResponse.ok) {
      throw new Error("Ошибка при загрузке ставок");
    }

    const bets = await betsResponse.json();

    if (!bets || bets.length === 0) {
      resultsDiv.innerHTML =
        '<div class="empty-message">Нет ставок в статусе "В ожидании" за выбранный период</div>';
      return;
    }

    // Получаем матчи через серверный прокси
    const matchesResponse = await fetch(
      `/api/fd-matches?competition=${encodeURIComponent(
        selectedCompetition
      )}&dateFrom=${dateFrom}&dateTo=${dateTo}`
    );

    if (!matchesResponse.ok) {
      const errorText = await matchesResponse.text();
      throw new Error(
        `Ошибка при загрузке матчей: ${errorText || matchesResponse.statusText}`
      );
    }

    const matchesData = await matchesResponse.json();
    const matches = matchesData.matches || [];

    // Проверяем ставки и определяем результаты
    const results = checkBetsResults(bets, matches);

    // Пытаемся подтвердить результаты для матчей (обновляем статус и победителя)
    await confirmMatchesFromCounting(results);

    // Обновляем список ставок, чтобы вкладка «Мои ставки» увидела финальную разбивку
    await loadMyBets();

    // Отображаем результаты
    displayCalculationResults(results, bets);

    // Отправляем уведомление в Telegram
    try {
      await fetch("/api/notify-counting-results", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateFrom,
          dateTo,
          results,
        }),
      });
      console.log("✅ Уведомление о подсчете отправлено в Telegram");
    } catch (error) {
      console.error("❌ Ошибка отправки уведомления в Telegram:", error);
    }
  } catch (error) {
    console.error("Ошибка при подсчете:", error);
    resultsDiv.innerHTML = `<div class="empty-message">❌ Ошибка: ${error.message}</div>`;
  }
}

async function confirmMatchesFromCounting(results) {
  if (!canViewCounting() || !currentUser) {
    return;
  }

  const toUpdate = {};

  results.forEach((betResult) => {
    const matchId = betResult.match_id;
    const fdMatch = betResult.fdMatch;
    if (matchId && fdMatch) {
      toUpdate[matchId] = fdMatch;
    }
  });

  const adminUsername = currentUser.username;
  const updateEntries = Object.entries(toUpdate);

  for (const [matchId, fdMatch] of updateEntries) {
    const homeScore = fdMatch.score?.fullTime?.home ?? 0;
    const awayScore = fdMatch.score?.fullTime?.away ?? 0;
    const resultKey =
      homeScore > awayScore
        ? "team1_win"
        : homeScore < awayScore
        ? "team2_win"
        : "draw";

    try {
      const response = await fetch(`/api/admin/matches/${matchId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: adminUsername,
          status: "finished",
          result: resultKey,
          score_team1: homeScore,
          score_team2: awayScore,
        }),
      });

      if (!response.ok) {
        console.warn(
          `Не удалось подтвердить матч ${matchId}: ${response.status}`
        );
      } else {
        console.log(`✅ Матч ${matchId} подтвержден со счетом ${homeScore}-${awayScore}`);
      }
    } catch (error) {
      console.error(`Ошибка подтверждения матча ${matchId}:`, error);
    }
  }
}

// Проверить результаты ставок
function removeDiacritics(value) {
  try {
    return (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (e) {
    return value || "";
  }
}

function fixSpaces(value) {
  return (value || "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForComparison(name) {
  // Сначала проверяем маппинг из JSON файла
  if (teamMappings && Object.keys(teamMappings).length > 0) {
    // Ищем точное совпадение (регистронезависимое)
    const nameLower = (name || "").toLowerCase().trim();
    for (const [russianName, englishName] of Object.entries(teamMappings)) {
      if (russianName.toLowerCase() === nameLower || englishName.toLowerCase() === nameLower) {
        // Нормализуем найденное английское название
        return fixSpaces(removeDiacritics(englishName))
          .toLowerCase()
          .replace(/[''`]/g, "")
          .replace(/[^a-z0-9\u0400-\u04FF\s-]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  }
  
  // Если не нашли в маппинге, используем старую логику через dict.js
  const mappedName =
    typeof mapTeamName === "function" ? mapTeamName(name) : name || "";
  return fixSpaces(removeDiacritics(mappedName))
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\u0400-\u04FF\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function checkBetsResults(bets, fdMatches) {
  const results = [];

  bets.forEach((bet) => {
    // Ищем матч в результатах Football-Data
    const matchedFdMatch = fdMatches.find((m) => {
      const homeTeamNormalized = normalizeForComparison(m.homeTeam.name);
      const awayTeamNormalized = normalizeForComparison(m.awayTeam.name);
      const betTeam1Normalized = normalizeForComparison(bet.team1_name);
      const betTeam2Normalized = normalizeForComparison(bet.team2_name);

      // Отладочный лог для первого матча
      if (fdMatches.indexOf(m) === 0 && bets.indexOf(bet) === 0) {
        console.log('🔍 Отладка сопоставления:');
        console.log('API команды:', m.homeTeam.name, 'vs', m.awayTeam.name);
        console.log('API нормализовано:', homeTeamNormalized, 'vs', awayTeamNormalized);
        console.log('Ставка команды:', bet.team1_name, 'vs', bet.team2_name);
        console.log('Ставка нормализовано:', betTeam1Normalized, 'vs', betTeam2Normalized);
        console.log('teamMappings:', teamMappings);
      }

      return (
        (homeTeamNormalized === betTeam1Normalized &&
          awayTeamNormalized === betTeam2Normalized) ||
        (homeTeamNormalized === betTeam2Normalized &&
          awayTeamNormalized === betTeam1Normalized)
      );
    });

    if (matchedFdMatch) {
      const homeScore = matchedFdMatch.score.fullTime.home;
      const awayScore = matchedFdMatch.score.fullTime.away;

      let result = "unknown";
      if (homeScore > awayScore) {
        result = "home";
      } else if (homeScore < awayScore) {
        result = "away";
      } else {
        result = "draw";
      }

      // Определяем выиграла ли ставка на результат
      let isWon = false;
      if (bet.prediction === "draw" && result === "draw") {
        isWon = true;
      } else if (bet.prediction === "team1" && result === "home") {
        isWon = true;
      } else if (bet.prediction === "team2" && result === "away") {
        isWon = true;
      }

      // Проверяем прогноз на счет если есть
      let scoreIsWon = false;
      let hasScorePrediction = false;
      if (bet.score_team1 != null && bet.score_team2 != null) {
        hasScorePrediction = true;
        scoreIsWon = (bet.score_team1 === homeScore && bet.score_team2 === awayScore);
      }

      results.push({
        ...bet,
        fdMatch: matchedFdMatch,
        result: result,
        isWon: isWon,
        score: `${homeScore}:${awayScore}`,
        hasScorePrediction: hasScorePrediction,
        scoreIsWon: scoreIsWon,
        actualScore: { home: homeScore, away: awayScore }
      });
    } else {
      results.push({
        ...bet,
        result: "not_found",
        isWon: false,
        score: "Матч не найден",
        hasScorePrediction: bet.score_team1 != null && bet.score_team2 != null,
        scoreIsWon: false,
      });
    }
  });

  return results;
}

// Отобразить результаты подсчета
function displayCalculationResults(results, originalBets) {
  const resultsDiv = document.getElementById("countingResults");

  // Группируем результаты по пользователям
  const grouped = {};

  results.forEach((result) => {
    const key = result.username;
    if (!grouped[key]) {
      grouped[key] = {
        username: result.username,
        total: 0,
        won: 0,
        lost: 0,
        notFound: 0,
        scoreWon: 0,
        scoreLost: 0,
        bets: [],
      };
    }

    grouped[key].total++;
    if (result.result === "not_found") {
      grouped[key].notFound++;
    } else if (result.isWon) {
      grouped[key].won++;
    } else {
      grouped[key].lost++;
    }

    // Подсчитываем прогнозы на счет
    if (result.hasScorePrediction && result.result !== "not_found") {
      if (result.scoreIsWon) {
        grouped[key].scoreWon++;
      } else {
        grouped[key].scoreLost++;
      }
    }

    grouped[key].bets.push(result);
  });

  // Строим HTML
  let html = `<div style="margin-bottom: 20px;">`;

  Object.values(grouped).forEach((group) => {
    const winRate =
      group.total > 0
        ? ((group.won / (group.total - group.notFound)) * 100).toFixed(1)
        : 0;
    
    const scoreTotal = group.scoreWon + group.scoreLost;
    const scoreRate = scoreTotal > 0 ? ((group.scoreWon / scoreTotal) * 100).toFixed(1) : 0;

    html += `
      <div style="background: rgba(90, 159, 212, .1); padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 3px solid #5a9fd4;">
        <div style="color: #5a9fd4; font-weight: 600; margin-bottom: 8px; font-size: 1.05em;">
          👤 ${group.username}
        </div>
        <div style="display: flex; gap: 20px; margin-bottom: 12px; flex-wrap: wrap;">
          <span style="color: #4db8a8;">📊 Результаты: ${group.won}/${group.total - group.notFound} (${winRate}%)</span>
          ${scoreTotal > 0 ? `<span style="color: #ffa726;">🎯 Счет: ${group.scoreWon}/${scoreTotal} (${scoreRate}%)</span>` : ''}
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px;">
    `;

    group.bets.forEach((bet) => {
      let backgroundColor = "rgba(58, 123, 213, 0.2)";
      let borderColor = "#4db8a8";
      let resultText = "❓";

      if (bet.result === "not_found") {
        backgroundColor = "rgba(255, 152, 0, 0.2)";
        borderColor = "#ff9800";
        resultText = "⚠️ Матч не найден";
      } else if (bet.isWon) {
        backgroundColor = "rgba(76, 175, 80, 0.2)";
        borderColor = "#4caf50";
        resultText = "✅ Выигрыш";
      } else {
        backgroundColor = "rgba(244, 67, 54, 0.2)";
        borderColor = "#f44336";
        resultText = "❌ Проигрыш";
      }

      const matchInfo = `${bet.team1_name} vs ${bet.team2_name}`;
      const betDisplay =
        bet.prediction === "draw"
          ? "Ничья"
          : bet.prediction === "team1"
          ? bet.team1_name
          : bet.team2_name;

      // Определяем фактический результат
      let actualResultDisplay = '';
      if (bet.result !== "not_found") {
        const actualResult = bet.result === "home" ? bet.team1_name :
                            bet.result === "away" ? bet.team2_name :
                            "Ничья";
        actualResultDisplay = ` | Результат: <strong>${actualResult}</strong>`;
      }

      // Информация о прогнозе на счет
      let scorePredictionHtml = '';
      if (bet.hasScorePrediction) {
        if (bet.result !== "not_found") {
          const scoreIcon = bet.scoreIsWon ? '🎯' : '❌';
          const scoreColor = bet.scoreIsWon ? '#4caf50' : '#f44336';
          const scoreBg = bet.scoreIsWon ? 'rgba(76, 175, 80, 0.2)' : 'rgba(244, 67, 54, 0.2)';
          scorePredictionHtml = `
            <div style="font-size: 0.85em; margin-bottom: 4px; padding: 4px 6px; background: ${scoreBg}; border-radius: 4px; border-left: 2px solid ${scoreColor};">
              ${scoreIcon} Прогноз счета: <strong style="color: ${scoreColor};">${bet.score_team1}:${bet.score_team2}</strong> | Факт: <strong>${bet.actualScore.home}:${bet.actualScore.away}</strong>
            </div>
          `;
        } else {
          // Матч не найден, но прогноз был
          scorePredictionHtml = `
            <div style="font-size: 0.85em; margin-bottom: 4px; padding: 4px 6px; background: rgba(255, 152, 0, 0.2); border-radius: 4px; border-left: 2px solid #ff9800;">
              🎯 Прогноз счета: <strong>${bet.score_team1}:${bet.score_team2}</strong>
            </div>
          `;
        }
      }

      html += `
        <div style="background: ${backgroundColor}; padding: 12px; border-radius: 6px; border-left: 2px solid ${borderColor};">
          <div style="color: #b0b8c8; font-size: 0.85em; margin-bottom: 8px;">${matchInfo}</div>
          <div style="color: #fff; font-weight: 500; margin-bottom: 6px;">Ставка: <strong>${betDisplay}</strong>${actualResultDisplay}</div>
          ${scorePredictionHtml}
          <div style="color: #4db8a8; font-weight: 600; font-size: 0.9em;">${resultText}</div>
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
