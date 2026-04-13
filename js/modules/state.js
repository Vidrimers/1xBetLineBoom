// Глобальное состояние приложения

// ===== ПОЛЬЗОВАТЕЛЬ И СОБЫТИЯ =====
export let currentUser = null;
export let currentEventId = null;
export let events = [];
export let matches = [];
export let userBets = [];

// ===== КОНСТАНТЫ АДМИНИСТРАТОРА =====
export let ADMIN_LOGIN = null;
export let ADMIN_DB_NAME = null;

// ===== КРОППЕР АВАТАРА =====
export let cropper = null;

// ===== ИНТЕРВАЛЫ =====
export let dicePositionInterval = null;
export let tournamentParticipantsInterval = null;
export let matchUpdateInterval = null;
export let sessionCheckInterval = null;
export let authCheckInterval = null;
export let terminalRefreshInterval = null;
export let liveMatchesUpdateInterval = null;
export let favoriteMatchesInterval = null;

// ===== ФЛАГИ =====
export let isMatchUpdatingEnabled = true;
export let isRenamingUser = false; // Флаг для блокировки автовыхода при переименовании
export let terminalAutoScroll = true;
export let isShowingNotification = false;

// ===== ФИЛЬТРЫ И ПОРЯДОК ТУРОВ =====
export let currentRoundFilter = "all"; // Текущий фильтр по туру
export let roundsOrder = []; // Порядок туров из БД
export let tempRoundsOrder = []; // Временный порядок для редактирования

// ===== DRAG & DROP =====
export let draggedItem = null;

// ===== СОБЫТИЯ (ТУРНИРЫ) — UI =====
export const EVENT_ADMIN_MOBILE_BREAKPOINT = 768;
export let eventItemClickHandlersInit = false;
export let mobileActiveEventId = null;

// ===== БЭКАПЫ =====
export let selectedBackupFilename = null;
export let lastCreatedBackupFilename = null;
export let selectedBackupIsProtected = false;

// ===== МОДЕРАТОРЫ =====
export let editingModeratorId = null;

// ===== НОВОСТИ (RSS) =====
export let selectedNewsType = null;
export let newsOffset = 0;
export let newsLimit = 50;
export let currentNewsFilter = 'all';
export let hasMoreNews = true;
export let currentRssTournament = 'all';
export let allRssKeywords = [];

// ===== ТУЛТИПЫ =====
export let tooltipTimeout = null;
export let currentTooltip = null;
export let hideTooltipTimeout = null;

// ===== БАГ-РЕПОРТЫ =====
export let bugReportImages = [];
export let currentBugReportImages = [];
export let currentImageIndex = 0;
export let allBugReports = []; // Все багрепорты
export let currentBugReportFilter = 'new'; // Текущий фильтр

// ===== ПОЛЬЗОВАТЕЛИ (АДМИН) =====
export let adminUsers = [];

// ===== МАТЧИ — КОМАНДЫ =====
export let matchTeamsList = [];
export let selectedMatchTeamFile = localStorage.getItem('selectedMatchTeamFile') || '/names/LeagueOfChampionsTeams.json';

// ===== ФИНАЛЬНЫЕ СТАВКИ =====
export let currentFinalMatchId = null;
export let currentFinalResult = null;

// ===== ПРОГНОЗ НА СЧЁТ =====
export let currentScoreMatchId = null;
export let currentScoreMatchResult = null;

// ===== ПАРСИНГ МАТЧЕЙ =====
export let parsedMatches = [];

// ===== МАППИНГ ИКОНОК ТУРНИРОВ =====
export const ICON_TO_COMPETITION = {
  'img/cups/champions-league.png': 'CL',
  'img/cups/european-league.png': 'EL',
  'img/cups/conference-league.png': 'ECL',
  'img/cups/england-premier-league.png': 'PL',
  'img/cups/bundesliga.png': 'BL1',
  'img/cups/spain-la-liga.png': 'PD',
  'img/cups/serie-a.png': 'SA',
  'img/cups/france-league-ligue-1.png': 'FL1',
  'img/cups/rpl.png': 'RPL',
  'img/cups/world-cup.png': 'WC',
  'img/cups/uefa-euro.png': 'EC',
  '🇳🇱': 'DED'  // Eredivisie (эмодзи флага Нидерландов)
};

// ===== СКРОЛЛ УВЕДОМЛЕНИЙ =====
export let scrollTimeout;
export let targetScrollY = 0;
export let currentScrollY = 0;

// ===== СЛОВАРЬ ИМЁН ИГРОКОВ =====
export let playerNamesDict = null;
export let currentPlayersDictTournament = null; // Код турнира для которого загружен словарь

export const PLAYERS_DICT_FILES = {
  'CL': 'names/LeagueOfChampionsPlayers.json',
  'EL': 'names/EuropaLeaguePlayers.json',
  'PL': 'names/PremierLeaguePlayers.json',
  'BL1': 'names/BundesligaPlayers.json',
  'PD': 'names/LaLigaPlayers.json',
  'SA': 'names/SerieAPlayers.json',
  'FL1': 'names/Ligue1Players.json',
  'DED': 'names/EredivisiePlayers.json',
  'RPL': 'names/RussianPremierLeaguePlayers.json',
  'WC': 'names/PlayerNames.json',
  'EC': 'names/PlayerNames.json'
};

// ===== LIVE МАТЧИ =====
export let currentLiveEventId = null;
export let completedDaysLoaded = {};
export let completedDaysData = null; // Сохраняем данные с сервера
export let yesterdayMatchesLoaded = false;

// ===== УВЕДОМЛЕНИЯ О ГОЛАХ =====
export const matchScores = {};
export const matchFinishTimes = {};
export const deletedFinishedMatches = new Set(
  JSON.parse(localStorage.getItem('deletedFinishedMatches') || '[]')
);
export const notificationQueue = [];

// ===== НАПОМИНАНИЯ =====
export let selectedReminderHours = null;

// ===== СТАТИСТИКА СТАВОК =====
export const displayedBetStats = new Map();
export let blockAutoLoadStats = false;

// ===== КОНФИГ АДМИН-ПАНЕЛИ =====
export let currentEditingConfig = null;

// ===== ИКОНКИ КУБИКА =====
export const iconTitles = {
  "🏆": "Стандартный",
  "img/cups/world-cup.png": "Чемпионат мира",
  "img/cups/champions-league.png": "Лига чемпионов",
  "img/cups/european-league.png": "Лига европы",
  "img/cups/conference-league.png": "Лига конференций",
  "img/cups/serie-a.png": "Serie A",
  "img/cups/england-premier-league.png": "Английская премьер лига",
  "img/cups/spain-la-liga.png": "Ла Лига",
  "img/cups/france-league-ligue-1.png": "Лига 1",
  "img/cups/bundesliga.png": "Бундеслига",
};
