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

export function setCurrentLiveEventId(val) { currentLiveEventId = val; }
export function setCompletedDaysData(val) { completedDaysData = val; }

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

// ===== SETTERS =====
export function setCurrentUser(val) { currentUser = val; }
export function setCurrentEventId(val) { currentEventId = val; }
export function setEvents(val) { events = val; }
export function setMatches(val) { matches = val; }
export function setUserBets(val) { userBets = val; }
export function setADMIN_LOGIN(val) { ADMIN_LOGIN = val; }
export function setADMIN_DB_NAME(val) { ADMIN_DB_NAME = val; }
export function setCropper(val) { cropper = val; }
export function setRoundsOrder(val) { roundsOrder = val; }
export function setTempRoundsOrder(val) { tempRoundsOrder = val; }
export function setCurrentRoundFilter(val) { currentRoundFilter = val; }
export function setDraggedItem(val) { draggedItem = val; }
export function setEventItemClickHandlersInit(val) { eventItemClickHandlersInit = val; }
export function setMobileActiveEventId(val) { mobileActiveEventId = val; }
export function setSelectedBackupFilename(val) { selectedBackupFilename = val; }
export function setLastCreatedBackupFilename(val) { lastCreatedBackupFilename = val; }
export function setSelectedBackupIsProtected(val) { selectedBackupIsProtected = val; }
export function setEditingModeratorId(val) { editingModeratorId = val; }
export function setSelectedNewsType(val) { selectedNewsType = val; }
export function setNewsOffset(val) { newsOffset = val; }
export function setCurrentNewsFilter(val) { currentNewsFilter = val; }
export function setHasMoreNews(val) { hasMoreNews = val; }
export function setCurrentRssTournament(val) { currentRssTournament = val; }
export function setAllRssKeywords(val) { allRssKeywords = val; }
export function setTooltipTimeout(val) { tooltipTimeout = val; }
export function setCurrentTooltip(val) { currentTooltip = val; }
export function setHideTooltipTimeout(val) { hideTooltipTimeout = val; }
export function setBugReportImages(val) { bugReportImages = val; }
export function setCurrentBugReportImages(val) { currentBugReportImages = val; }
export function setCurrentImageIndex(val) { currentImageIndex = val; }
export function setAllBugReports(val) { allBugReports = val; }
export function setCurrentBugReportFilter(val) { currentBugReportFilter = val; }
export function setAdminUsers(val) { adminUsers = val; }
export function setMatchTeamsList(val) { matchTeamsList = val; }
export function setSelectedMatchTeamFile(val) { selectedMatchTeamFile = val; }
export function setCurrentFinalMatchId(val) { currentFinalMatchId = val; }
export function setCurrentFinalResult(val) { currentFinalResult = val; }
export function setCurrentScoreMatchId(val) { currentScoreMatchId = val; }
export function setCurrentScoreMatchResult(val) { currentScoreMatchResult = val; }
export function setParsedMatches(val) { parsedMatches = val; }
export function setScrollTimeout(val) { scrollTimeout = val; }
export function setTargetScrollY(val) { targetScrollY = val; }
export function setCurrentScrollY(val) { currentScrollY = val; }
export function setPlayerNamesDict(val) { playerNamesDict = val; }
export function setCurrentPlayersDictTournament(val) { currentPlayersDictTournament = val; }
export function setYesterdayMatchesLoaded(val) { yesterdayMatchesLoaded = val; }
export function setSelectedReminderHours(val) { selectedReminderHours = val; }
export function setBlockAutoLoadStats(val) { blockAutoLoadStats = val; }
export function setCurrentEditingConfig(val) { currentEditingConfig = val; }
export function setIsMatchUpdatingEnabled(val) { isMatchUpdatingEnabled = val; }
export function setIsRenamingUser(val) { isRenamingUser = val; }
export function setTerminalAutoScroll(val) { terminalAutoScroll = val; }
export function setIsShowingNotification(val) { isShowingNotification = val; }
export function setDicePositionInterval(val) { dicePositionInterval = val; }
export function setTournamentParticipantsInterval(val) { tournamentParticipantsInterval = val; }
export function setMatchUpdateInterval(val) { matchUpdateInterval = val; }
export function setSessionCheckInterval(val) { sessionCheckInterval = val; }
export function setAuthCheckInterval(val) { authCheckInterval = val; }
export function setTerminalRefreshInterval(val) { terminalRefreshInterval = val; }
export function setLiveMatchesUpdateInterval(val) { liveMatchesUpdateInterval = val; }
export function setFavoriteMatchesInterval(val) { favoriteMatchesInterval = val; }
export function setCompletedDaysLoaded(val) { completedDaysLoaded = val; }
export function setNewsLimit(val) { newsLimit = val; }
