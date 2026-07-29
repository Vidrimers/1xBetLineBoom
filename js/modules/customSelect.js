// Маппинг иконок на словари команд (для автоподстановки team_file)
const ICON_TO_TEAM_FILE = {
  'img/cups/champions-league.png': 'names/LeagueOfChampionsTeams.json',
  'img/cups/european-league.png': 'names/EuropaLeague.json',
  'img/cups/conference-league.png': 'names/ConferenceLeague.json',
  'img/cups/england-premier-league.png': 'names/PremierLeague.json',
  'img/cups/bundesliga.png': 'names/Bundesliga.json',
  'img/cups/spain-la-liga.png': 'names/LaLiga.json',
  'img/cups/serie-a.png': 'names/SerieA.json',
  'img/cups/france-league-ligue-1.png': 'names/Ligue1.json',
  'img/cups/rpl.png': 'names/RussianPremierLeague.json',
  'img/cups/world-cup.png': 'names/Countries.json',
  'img/cups/uefa-euro.png': 'names/Countries.json',
};

// Инициализация кастомного select
export function initCustomSelect(selectId) {
  const customSelect = document.getElementById(selectId);
  if (!customSelect || customSelect.dataset.initialized) return;

  customSelect.dataset.initialized = "true";

  const selectSelected = customSelect.querySelector(".select-selected");
  const selectItems = customSelect.querySelector(".select-items");
  const hiddenInput = customSelect.querySelector('input[type="hidden"]');

  // Открытие/закрытие списка
  selectSelected.addEventListener("click", function () {
    selectItems.classList.toggle("select-hide");
    // Закрыть другие открытые select
    document.querySelectorAll(".select-items").forEach((item) => {
      if (item !== selectItems) {
        item.classList.add("select-hide");
      }
    });
  });

  // Выбор опции
  selectItems.querySelectorAll("div").forEach((item) => {
    item.addEventListener("click", function () {
      const value = this.getAttribute("data-value");
      const text = this.innerHTML;

      hiddenInput.value = value;
      selectSelected.innerHTML = text;
      selectItems.classList.add("select-hide");

      // Автоподстановка team_file при выборе иконки турнира
      if (selectId === "eventIconSelect" || selectId === "editEventIconSelect") {
        const teamFileInputId = selectId === "eventIconSelect" ? "eventTeamFile" : "editEventTeamFile";
        const teamFileInput = document.getElementById(teamFileInputId);
        if (teamFileInput && ICON_TO_TEAM_FILE[value]) {
          teamFileInput.value = ICON_TO_TEAM_FILE[value];
        }
      }
    });
  });
}

// Глобальный listener для закрытия select при клике вне
document.addEventListener("click", function (e) {
  if (!e.target.closest(".custom-select")) {
    document.querySelectorAll(".select-items").forEach((item) => {
      item.classList.add("select-hide");
    });
  }
});

// Установка значения для кастомного select
export function setCustomSelectValue(selectId, value) {
  const customSelect = document.getElementById(selectId);
  if (!customSelect) return;

  const selectSelected = customSelect.querySelector(".select-selected");
  const hiddenInput = customSelect.querySelector('input[type="hidden"]');
  const item = customSelect.querySelector(`div[data-value="${value}"]`);

  if (item) {
    hiddenInput.value = value;
    selectSelected.innerHTML = item.innerHTML;
  }
}
