// Точка входа — импорт всех модулей и инициализация приложения

// ===== ИМПОРТЫ =====
import * as state from './modules/state.js';
import { setCurrentUser, setSessionCheckInterval, setMatchUpdateInterval } from './modules/state.js';
import { originalFetch } from './modules/api.js';
import {
  showCustomAlert,
  showCustomConfirm,
  showCustomSaveConfirm,
  showCustomPrompt,
  lockBodyScroll,
  unlockBodyScroll,
  closeModalOnOutsideClick,
  openModalWithAnimation,
  closeModalWithAnimation,
  showSaveStatus,
} from './modules/ui.js';
import {
  initUser,
  loginFromModal,
  closeLoginModal,
  openLoginModal,
  logoutUser,
  loginWithTelegram,
  checkTelegramAuthStatus,
  initGuestMode,
  blockBettingForGuests,
  exitGuestMode,
  getDeviceInfo,
  moveAuthButtonToProfile,
  moveAuthButtonToLoginForm,
  setAuthButtonToLogoutState,
  setAuthButtonToLoginState,
  hideTelegramAuthButtons,
  showTelegramAuthButtons,
} from './modules/auth.js';
import { previewTheme, saveTheme, changeTheme, loadSavedTheme } from './modules/themes.js';
import {
  loadConfig,
  loadRoundsOrder,
  saveRoundsOrderToStorage,
  openRoundsOrderModal,
  closeRoundsOrderModal,
  renderRoundsOrderList,
  deleteRound,
  saveRoundsOrder,
  sortRoundsByOrder,
} from './modules/config.js';
import {
  loadEventsList,
  generateEventHTML,
  displayEvents,
  selectEvent,
  toggleAdminButtons,
  closeAdminButtons,
  initEventItemClickHandlers,
  restoreMobileActiveEvent,
  initEventAdminToggles,
} from './modules/events.js';
import {
  loadMatches,
  displayMatches,
  filterByRound,
  initToggleStates,
  initMatchResultToggles,
  initAdminActionToggles,
  initMatchRowClickHandlers,
  getMatchStatusByDate,
  displayTournamentWinner,
} from './modules/matches.js';
import {
  placeBet,
  placeScorePrediction,
  cancelScorePrediction,
  syncScoreInputs,
  showScoreAlert,
  closeScoreAlert,
  unlockFinalParameter,
  lockFinalParameter,
  placeFinalBet,
  loadMyBets,
  displayMyBets,
  generateBetHTML,
  toggleTournamentBets,
  deleteBet,
} from './modules/bets.js';
import {
  loadParticipants,
  displayParticipants,
  loadTournamentsList,
  displayTournaments,
  loadTournamentParticipants,
  startTournamentParticipantsPolling,
  stopTournamentParticipantsPolling,
  calculateMaxWinStreak,
  displayTournamentParticipants,
  backToTournaments,
  showTournamentParticipantBets,
  displayTournamentParticipantBets,
  filterTournamentParticipantBets,
  closeTournamentParticipantBetsModal,
} from './modules/participants.js';
import { loadProfile, displayProfile, loadUserAwards, getAwardIcon, closeAvatarModal, saveAvatar, deleteAvatar } from './modules/profile.js';
import {
  loadSettings,
  openTelegramBindInfoModal,
  deleteTelegramUsername,
  initTimezoneSettings,
  loadUserTimezone,
  saveTimezoneSettings,
  openUpdateSstatsModal,
  updateSstatsIds,
  openDeactivateEventsModal,
  deactivateSelectedEvents,
  saveTelegramNotificationSettings,
  openDetailedNotificationsModal,
  closeDetailedNotificationsModal,
  loadDetailedNotificationSettings,
  updateOnlyActiveTournamentsState,
  saveDetailedNotificationSettings,
  checkMatchRemindersSettingAndUpdateButton,
  saveNotifyOnViewSettings,
  toggleGroupRemindersCardVisibility,
  saveLogin2faSettings,
  saveLiveSoundSettings,
  saveShowTournamentWinnerSettings,
  saveShowBetsSettings,
  saveLuckyButtonSettings,
  saveXgButtonSettings,
  migrateLogs,
  clearLogs,
  updateLuckyButtonVisibility,
} from './modules/settings.js';
import {
  openCreateMatchModal,
  closeCreateMatchModal,
  submitCreateMatch,
  openImportMatchesModal,
  closeImportMatchesModal,
  updateImportSeparatorPreview,
  submitImportMatches,
  openBulkParseModal,
  closeBulkParseModal,
  openBulkEditDatesModal,
  closeBulkEditDatesModal,
  loadBulkEditMatches,
  saveBulkEditDates,
  loadMatchTeams,
  openMatchTeamFileSelector,
  selectMatchTeamFile,
  closeMatchTeamFileSelector,
  initTeamAutocomplete,
  updateSelectedItem,
  selectTeam,
  hideSuggestions,
  toggleTeamDropdown,
  loadRoundsForModal,
  selectExistingRound,
  loadParsePreview,
  toggleRoundSelection,
  submitBulkParse,
  updateParsePreview,
} from './modules/matchCreate.js';
import {
  toggleFinalMatch,
  openEditMatchModal,
  closeEditMatchModal,
  submitEditMatch,
  deleteMatch,
  openFinalMatchResultModal,
  closeFinalMatchResultModal,
  setFinalResult,
  saveFinalMatchResult,
  openScoreMatchResultModal,
  syncScoreModalInputs,
  setScoreResult,
  closeScoreMatchResultModal,
  saveScoreMatchResult,
} from './modules/matchEdit.js';
import {
  openCreateEventModal,
  closeCreateEventModal,
  openEditEventModal,
  closeEditEventModal,
  handleEventIconChange,
  handleEditEventIconChange,
  handleCreateEventIconChange,
  submitCreateEvent,
  submitEditEvent,
  previewTournamentAnnouncement,
  closeTournamentAnnouncementModal,
  formatText,
  insertEmoji,
  openAnnouncementModal,
  closeAnnouncementModal,
  sendAnnouncementToSelf,
  sendAnnouncementToAll,
  sendTournamentAnnouncementToAdmin,
  openTournamentInfoModal,
  openEventTeamFileSelector,
  selectEventTeamFile,
  closeEventTeamFileSelector,
  closeLockEventModal,
} from './modules/eventModals.js';
import {
  loadLiveMatches,
  showLiveEventMatches,
  backToLiveEvents,
  loadCompletedDays,
  renderCompletedDays,
  renderCompletedDayMatches,
  toggleCompletedDay,
  toggleYesterdayMatches,
  startLiveMatchesAutoUpdate,
  stopLiveMatchesAutoUpdate,
} from './modules/live.js';
import {
  getFavoriteMatches,
  saveFavoriteMatches,
  getFavoriteMatchData,
  saveFavoriteMatchData,
  removeFavoriteMatchData,
  updateFavoriteMatchesData,
  toggleFavoriteMatch,
  updateFavoriteStars,
  updateLiveIndicator,
  startFavoriteMatchesPolling,
  stopFavoriteMatchesPolling,
  cleanupOldFavorites,
  pollFavoriteMatches,
} from './modules/liveFavorites.js';
import {
  showGoalNotification,
  closeGoalNotification,
  processNotificationQueue,
  addNotificationToQueue,
  playGoalSound,
  processMatches,
  updateDesktopNotification,
  smoothScrollNotifications,
  handleScroll,
  checkMatchEventsForNotifications,
  saveDeletedFinishedMatches,
} from './modules/goalNotifications.js';
import {
  showLiveTeamStats,
  displayBasicStats,
  displayDetailedStats,
  switchLiveStatsTab,
  renderStatistics,
  renderLineups,
  renderEvents,
  closeLiveTeamStatsModal,
  loadPlayerNamesDict,
  translatePlayerName,
  determineTournamentCode,
  openPlayerNameEditor,
  selectPlayer,
  savePlayerName,
  loadSavedEventPlayers,
  loadPlayersDictionary,
} from './modules/liveStats.js';
import {
  openRssNewsModal,
  closeRssNewsModal,
  loadRssNews,
  filterRssNews,
  openRssKeywordsModal,
  closeRssKeywordsModal,
  loadRssKeywords,
  filterKeywordsByTournament,
  addRssKeyword,
  deleteRssKeyword,
} from './modules/news.js';
import {
  openNewsModal,
  closeNewsModal,
  openNewsModalSite,
  closeNewsViewModal,
  loadNewsForSite,
  loadNewsTab,
  loadNewsList,
  loadMoreNews,
  filterNews,
  reactToNews,
  showReactionTooltip,
  scheduleHideTooltip,
  hideReactionTooltip,
  deleteNews,
  selectNewsType,
  publishNews,
} from './modules/newsTab.js';
import {
  openComparisonModal,
  showComparison,
  displayComparisonModal,
  closeComparisonModal,
  switchComparisonTab,
  generateBetsComparison,
  filterComparisonByRound,
  generateStatsComparison,
  openGlobalComparisonModal,
  showGlobalComparison,
  displayGlobalComparisonModal,
  closeGlobalComparisonModal,
} from './modules/comparison.js';
import {
  showMatchRemindersModal,
  closeMatchRemindersModal,
  selectReminderTime,
  updateReminderIndicator,
  loadMatchReminders,
  saveMatchReminders,
  deleteMatchReminders,
} from './modules/reminders.js';
import { loadAndDisplayBetStats, animateCounter } from './modules/betStats.js';
import {
  showUserBracketPredictions,
  showUserBracketPredictionsInline,
} from './modules/bracketPredictions.js';
import {
  isAdmin,
  isModerator,
  hasModeratorPermission,
  hasPermission,
  canManageMatches,
  canCreateMatches,
  canEditMatches,
  canDeleteMatches,
  canManageResults,
  canManageTournaments,
  canEditTournaments,
  canDeleteTournaments,
  canCreateTournaments,
  canViewLogs,
  canViewCounting,
  canBackupDB,
  canDownloadBackup,
  canRestoreDB,
  canDeleteBackup,
  canAccessDatabasePanel,
  canManageOrphaned,
  canViewUsers,
  canEditUsers,
  canDeleteUsers,
  canCheckBot,
  canViewSettings,
  hasAdminPanelAccess,
  isAdminOrModerator,
  loadModeratorPermissions,
  backupDatabase,
  openRestoreDBModal,
  closeRestoreDBModal,
  openDatabaseModal,
  closeDatabaseModal,
  selectBackup,
  updateBackupButtons,
  restoreSelectedBackup,
  downloadSelectedBackup,
  toggleBackupLock,
  deleteSelectedBackup,
  restoreBackup,
  checkOrphanedData,
  cleanupOrphanedData,
} from './modules/admin.js';
import {
  openModeratorsPanel,
  closeModeratorsPanel,
  loadModeratorsList,
  loadUsersList,
  getPermissionsText,
  assignModerator,
  removeModerator,
  openEditModeratorModal,
  closeEditModeratorModal,
  toggleUserSubPermissions,
  toggleDBSubPermissions,
  toggleMatchesSubPermissions,
  toggleTournamentsSubPermissions,
  toggleEditUserSubPermissions,
  toggleEditDBSubPermissions,
  toggleEditMatchesSubPermissions,
  toggleEditTournamentsSubPermissions,
  saveModeratorPermissions,
} from './modules/moderators.js';
import {
  openAwardsPanel,
  closeAwardsPanel,
  loadAwardsList,
  loadEventsForAwards,
  loadTournamentParticipantsForAward,
  uploadAwardImageFile,
  assignAward,
  openEditAwardModal,
  closeEditAwardModal,
  saveEditAward,
  removeAward,
} from './modules/awards.js';
import {
  openNotificationsModal,
  showUserDetails,
  toggleUserNotifications,
  enableNotificationsForAll,
} from './modules/users.js';
import {
  loadAdminPanelConfig,
  renderAdminPanelAccordion,
  renderButton,
  toggleCategory,
  openConfigureCategoriesModal,
  closeConfigureCategoriesModal,
  switchConfigTab,
  renderCategoriesTab,
  renderButtonsTab,
  renderResetTab,
  updateCategoryName,
  toggleCategoryCollapsed,
  moveCategoryUp,
  moveCategoryDown,
  deleteCategory,
  addNewCategory,
  moveButtonToCategory,
  resetToDefaultConfig,
  saveConfigChanges,
} from './modules/adminPanel.js';
import {
  runUtilityScript,
  formatUtilityOutput,
  openDatesManagementModal,
  loadDatesData,
  clearProcessedDates,
} from './modules/adminUtils.js';
import {
  openTerminalModal,
  closeTerminalModal,
  refreshTerminalLogs,
  escapeHtml,
  clearTerminalLogs,
  saveTerminalLogs,
  toggleTerminalAutoScroll,
} from './modules/terminal.js';
import {
  toggleAutoCounting,
  loadAutoCountingStatus,
} from './modules/autocounting.js';
import { switchTab, showMobileSection, toggleMobileMenu } from './modules/tabs.js';
import { initCustomSelect, setCustomSelectValue } from './modules/customSelect.js';
import {
  initDragToScroll,
  initHorizontalDragScroll,
  initPageScrollOnHeaders,
} from './modules/dragScroll.js';
import {
  luckyBetForCurrentRound,
  updateDicePosition,
  startDicePositionTracking,
  stopDicePositionTracking,
  getIconTitle,
} from './modules/luckyBet.js';
import { openTelegramInfoModal, closeTelegramInfoModal } from './modules/telegramInfo.js';
import {
  openBugReportModal,
  closeBugReportModal,
  sendBugReport,
  closeBugReportsModal,
  filterBugReports,
  closeBugReportImagesModal,
  navigateBugReportImage,
  addBugReportImages,
  handleBugReportImages,
  removeBugReportImage,
  openBugReportImagesModal,
  changeBugStatus,
  deleteBugReport,
  initBugReportListeners,
  openBugReportsModal,
} from './modules/bugReport.js';
import { openDevicesModal, closeDevicesModal, logoutDevice, toggleTrustedDevice } from './modules/devices.js';
import {
  sendCountingResults,
  openRecountModal,
  closeRecountModal,
  confirmRecount,
  loadEventsForRecount,
  loadRoundsForRecount,
  initRecountListeners,
} from './modules/recount.js';
import {
  loadAdminUsers,
  closeAdminModal,
  syncAllTelegramIds,
  testGroupNotification,
} from './modules/adminUsers.js';
import {
  openBracketModal,
  closeBracketModal,
  openCreateBracketModal,
  closeCreateBracketModal,
  createBracket,
} from './modules/bracket.js';
import { openXgModal, closeXgModal, refreshXgData, toggleXgButton } from './xg-modal.js';
import { loadCounting, selectCompetition, calculateCountingResults } from './counting.js';

// ===== ЭКСПОРТ В ГЛОБАЛЬНЫЙ SCOPE (для onclick в HTML) =====
// Все функции которые вызываются из HTML через onclick="..."
Object.assign(window, {
  // auth
  initUser, loginFromModal, closeLoginModal, openLoginModal, logoutUser,
  loginWithTelegram, checkTelegramAuthStatus, initGuestMode, exitGuestMode,
  getDeviceInfo, moveAuthButtonToProfile, moveAuthButtonToLoginForm,
  setAuthButtonToLogoutState, setAuthButtonToLoginState,
  hideTelegramAuthButtons, showTelegramAuthButtons,
  // themes
  previewTheme, saveTheme, changeTheme, loadSavedTheme,
  // config
  loadConfig, loadRoundsOrder, saveRoundsOrderToStorage,
  openRoundsOrderModal, closeRoundsOrderModal, renderRoundsOrderList,
  deleteRound, saveRoundsOrder, sortRoundsByOrder,
  // events
  loadEventsList, generateEventHTML, displayEvents, selectEvent,
  toggleAdminButtons, closeAdminButtons, initEventItemClickHandlers,
  restoreMobileActiveEvent, initEventAdminToggles,
  // matches
  loadMatches, displayMatches, filterByRound, initToggleStates,
  initMatchResultToggles, initAdminActionToggles, initMatchRowClickHandlers,
  getMatchStatusByDate, displayTournamentWinner,
  // bets
  placeBet, placeScorePrediction, cancelScorePrediction, syncScoreInputs,
  showScoreAlert, closeScoreAlert, unlockFinalParameter, lockFinalParameter,
  placeFinalBet, loadMyBets, displayMyBets, generateBetHTML,
  toggleTournamentBets, deleteBet,
  // participants
  loadParticipants, displayParticipants, loadTournamentsList, displayTournaments,
  loadTournamentParticipants, startTournamentParticipantsPolling,
  stopTournamentParticipantsPolling, calculateMaxWinStreak,
  displayTournamentParticipants, backToTournaments, showTournamentParticipantBets,
  displayTournamentParticipantBets, filterTournamentParticipantBets,
  closeTournamentParticipantBetsModal,
  // profile
  loadProfile, displayProfile, loadUserAwards, getAwardIcon,
  closeAvatarModal, saveAvatar, deleteAvatar,
  // settings
  loadSettings, openTelegramBindInfoModal, deleteTelegramUsername,
  initTimezoneSettings, loadUserTimezone, saveTimezoneSettings,
  openUpdateSstatsModal, updateSstatsIds, openDeactivateEventsModal,
  deactivateSelectedEvents, saveTelegramNotificationSettings,
  openDetailedNotificationsModal, closeDetailedNotificationsModal,
  loadDetailedNotificationSettings, updateOnlyActiveTournamentsState,
  saveDetailedNotificationSettings, checkMatchRemindersSettingAndUpdateButton,
  saveNotifyOnViewSettings,
  toggleGroupRemindersCardVisibility, saveLogin2faSettings, saveLiveSoundSettings,
  saveShowTournamentWinnerSettings, saveShowBetsSettings, saveLuckyButtonSettings,
  saveXgButtonSettings, migrateLogs, clearLogs,
  updateLuckyButtonVisibility,
  // matchCreate
  openCreateMatchModal, closeCreateMatchModal, submitCreateMatch,
  openImportMatchesModal, closeImportMatchesModal, updateImportSeparatorPreview,
  submitImportMatches, openBulkParseModal, closeBulkParseModal,
  openBulkEditDatesModal, closeBulkEditDatesModal,
  loadBulkEditMatches, saveBulkEditDates, loadMatchTeams,
  openMatchTeamFileSelector, selectMatchTeamFile, closeMatchTeamFileSelector,
  initTeamAutocomplete, updateSelectedItem, selectTeam, hideSuggestions,
  toggleTeamDropdown, loadRoundsForModal, selectExistingRound,
  loadParsePreview, toggleRoundSelection, submitBulkParse, updateParsePreview,
  // matchEdit
  toggleFinalMatch, openEditMatchModal, closeEditMatchModal, submitEditMatch,
  deleteMatch, openFinalMatchResultModal, closeFinalMatchResultModal,
  setFinalResult, saveFinalMatchResult, openScoreMatchResultModal,
  syncScoreModalInputs, setScoreResult, closeScoreMatchResultModal,
  saveScoreMatchResult,
  // eventModals
  openCreateEventModal, closeCreateEventModal, openEditEventModal,
  closeEditEventModal, handleEventIconChange, handleEditEventIconChange,
  handleCreateEventIconChange, submitCreateEvent, submitEditEvent,
  previewTournamentAnnouncement, closeTournamentAnnouncementModal,
  formatText, insertEmoji, openAnnouncementModal, closeAnnouncementModal,
  sendAnnouncementToSelf, sendAnnouncementToAll, sendTournamentAnnouncementToAdmin,
  openTournamentInfoModal,
  openEventTeamFileSelector, selectEventTeamFile, closeEventTeamFileSelector,
  closeLockEventModal,
  // live
  loadLiveMatches, showLiveEventMatches, backToLiveEvents, loadCompletedDays,
  renderCompletedDays, renderCompletedDayMatches, toggleCompletedDay,
  toggleYesterdayMatches, startLiveMatchesAutoUpdate, stopLiveMatchesAutoUpdate,
  // liveFavorites
  getFavoriteMatches, saveFavoriteMatches, getFavoriteMatchData,
  saveFavoriteMatchData, removeFavoriteMatchData, updateFavoriteMatchesData,
  toggleFavoriteMatch, updateFavoriteStars, updateLiveIndicator,
  startFavoriteMatchesPolling, stopFavoriteMatchesPolling, cleanupOldFavorites,
  pollFavoriteMatches,
  // goalNotifications
  showGoalNotification, closeGoalNotification, processNotificationQueue,
  addNotificationToQueue, playGoalSound, processMatches, updateDesktopNotification,
  smoothScrollNotifications, handleScroll, checkMatchEventsForNotifications,
  saveDeletedFinishedMatches,
  // liveStats
  showLiveTeamStats, displayBasicStats, displayDetailedStats, switchLiveStatsTab,
  renderStatistics, renderLineups, renderEvents, closeLiveTeamStatsModal,
  loadPlayerNamesDict, translatePlayerName, determineTournamentCode,
  openPlayerNameEditor, selectPlayer, savePlayerName, loadSavedEventPlayers,
  loadPlayersDictionary,
  // news
  openRssNewsModal, closeRssNewsModal, loadRssNews, filterRssNews,
  openRssKeywordsModal, closeRssKeywordsModal, loadRssKeywords,
  filterKeywordsByTournament, addRssKeyword, deleteRssKeyword,
  // newsTab
  openNewsModal, closeNewsModal, openNewsModalSite, closeNewsViewModal,
  loadNewsForSite, loadNewsTab, loadNewsList, loadMoreNews, filterNews,
  reactToNews, showReactionTooltip, scheduleHideTooltip, hideReactionTooltip,
  deleteNews, selectNewsType, publishNews,
  // comparison
  openComparisonModal, showComparison, displayComparisonModal, closeComparisonModal,
  switchComparisonTab, generateBetsComparison, filterComparisonByRound,
  generateStatsComparison, openGlobalComparisonModal, showGlobalComparison,
  displayGlobalComparisonModal, closeGlobalComparisonModal,
  // reminders
  showMatchRemindersModal, closeMatchRemindersModal, selectReminderTime,
  updateReminderIndicator, loadMatchReminders, saveMatchReminders,
  deleteMatchReminders,
  // betStats
  loadAndDisplayBetStats, animateCounter,
  // bracketPredictions
  showUserBracketPredictions, showUserBracketPredictionsInline,
  // admin
  isAdmin, isModerator, hasModeratorPermission, hasPermission,
  canManageMatches, canCreateMatches, canEditMatches, canDeleteMatches,
  canManageResults, canManageTournaments, canEditTournaments, canDeleteTournaments,
  canCreateTournaments, canViewLogs, canViewCounting, canBackupDB,
  canDownloadBackup, canRestoreDB, canDeleteBackup, canAccessDatabasePanel,
  canManageOrphaned, canViewUsers, canEditUsers, canDeleteUsers,
  canCheckBot, canViewSettings, hasAdminPanelAccess, isAdminOrModerator,
  loadModeratorPermissions, backupDatabase, openRestoreDBModal, closeRestoreDBModal,
  openDatabaseModal, closeDatabaseModal, selectBackup, updateBackupButtons,
  restoreSelectedBackup, downloadSelectedBackup, toggleBackupLock,
  deleteSelectedBackup, restoreBackup, checkOrphanedData, cleanupOrphanedData,
  // moderators
  openModeratorsPanel, closeModeratorsPanel, loadModeratorsList, loadUsersList,
  getPermissionsText, assignModerator, removeModerator, openEditModeratorModal,
  closeEditModeratorModal, toggleUserSubPermissions, toggleDBSubPermissions,
  toggleMatchesSubPermissions, toggleTournamentsSubPermissions,
  toggleEditUserSubPermissions, toggleEditDBSubPermissions,
  toggleEditMatchesSubPermissions, toggleEditTournamentsSubPermissions,
  saveModeratorPermissions,
  // awards
  openAwardsPanel, closeAwardsPanel, loadAwardsList, loadEventsForAwards,
  loadTournamentParticipantsForAward, uploadAwardImageFile, assignAward,
  openEditAwardModal, closeEditAwardModal, saveEditAward, removeAward,
  // users
  openNotificationsModal, showUserDetails, toggleUserNotifications,
  enableNotificationsForAll,
  // adminPanel
  loadAdminPanelConfig, renderAdminPanelAccordion, renderButton, toggleCategory,
  openConfigureCategoriesModal, closeConfigureCategoriesModal, switchConfigTab,
  renderCategoriesTab, renderButtonsTab, renderResetTab, updateCategoryName,
  toggleCategoryCollapsed, moveCategoryUp, moveCategoryDown, deleteCategory,
  addNewCategory, moveButtonToCategory, resetToDefaultConfig, saveConfigChanges,
  // adminUtils
  runUtilityScript, formatUtilityOutput, openDatesManagementModal, loadDatesData,
  clearProcessedDates,
  // terminal
  openTerminalModal, closeTerminalModal, refreshTerminalLogs, escapeHtml,
  clearTerminalLogs, saveTerminalLogs, toggleTerminalAutoScroll,
  // autocounting
  toggleAutoCounting, loadAutoCountingStatus,
  // tabs
  switchTab, showMobileSection, toggleMobileMenu,
  // customSelect
  initCustomSelect, setCustomSelectValue,
  // luckyBet
  luckyBetForCurrentRound, updateDicePosition, startDicePositionTracking,
  stopDicePositionTracking, getIconTitle,
  // telegramInfo
  openTelegramInfoModal, closeTelegramInfoModal,
  // bugReport
  openBugReportModal, closeBugReportModal, sendBugReport,
  closeBugReportsModal, filterBugReports, closeBugReportImagesModal,
  navigateBugReportImage, addBugReportImages, handleBugReportImages,
  removeBugReportImage, openBugReportImagesModal, changeBugStatus,
  deleteBugReport, openBugReportsModal,
  // devices
  openDevicesModal, closeDevicesModal, logoutDevice, toggleTrustedDevice,
  // recount
  sendCountingResults, openRecountModal, closeRecountModal, confirmRecount,
  loadEventsForRecount, loadRoundsForRecount,
  // adminUsers
  loadAdminUsers, closeAdminModal, syncAllTelegramIds, testGroupNotification,
  // bracket
  openBracketModal, closeBracketModal, openCreateBracketModal,
  closeCreateBracketModal, createBracket,
  // xg-modal
  openXgModal, closeXgModal, refreshXgData, toggleXgButton,
  // counting
  loadCounting, selectCompetition, calculateCountingResults,
  // ui
  showCustomAlert, showCustomConfirm, showCustomSaveConfirm, showCustomPrompt,
  lockBodyScroll, unlockBodyScroll, closeModalOnOutsideClick,
  openModalWithAnimation, closeModalWithAnimation, showSaveStatus,
});


// ===== DOMContentLoaded — ГЛАВНЫЙ БЛОК ИНИЦИАЛИЗАЦИИ =====
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🔄 DOMContentLoaded - начало загрузки");

  // Экспортируем состояние в window для доступа из AI чата
  window.state = state;

  // Очищаем старые завершенные матчи из избранного
  cleanupOldFavorites();

  // Запускаем отслеживание позиции кубика
  startDicePositionTracking();

  // Загружаем конфиг сначала
  await loadConfig();

  // Порядок туров загружается в loadMatches() после выбора турнира

  // Проверяем, есть ли пользователь в localStorage
  const savedUser = localStorage.getItem("currentUser");

  if (savedUser) {
    const user = JSON.parse(savedUser);
    setCurrentUser(user);

    // Загружаем настройку show_lucky_button с сервера
    try {
      const response = await fetch(`/api/user/${user.id}/show-lucky-button`);
      if (response.ok) {
        const data = await response.json();
        state.currentUser.show_lucky_button = data.show_lucky_button !== undefined ? data.show_lucky_button : 1;
        localStorage.setItem("currentUser", JSON.stringify(state.currentUser));
      }
    } catch (err) {
      console.error("⚠ Ошибка загрузки настройки show_lucky_button:", err);
      state.currentUser.show_lucky_button = 1;
    }

    // Загружаем настройку show_bets с сервера
    try {
      const response = await fetch(`/api/user/${user.id}/show-bets`);
      if (response.ok) {
        const data = await response.json();
        state.currentUser.show_bets = data.show_bets || "always";
        localStorage.setItem("currentUser", JSON.stringify(state.currentUser));
      }
    } catch (err) {
      console.error("⚠ Ошибка загрузки настройки show_bets:", err);
      state.currentUser.show_bets = "always";
    }

    // Обновляем видимость кнопки сразу после загрузки настройки
    if (typeof updateLuckyButtonVisibility === 'function') updateLuckyButtonVisibility();

    // Проверяем валидность сессии
    const sessionToken = localStorage.getItem("sessionToken");
    if (sessionToken) {
      try {
        const validateResponse = await fetch(`/api/sessions/${sessionToken}/validate`);
        if (!validateResponse.ok) {
          console.log("⚠ Сессия недействительна при загрузке, выполняется выход");
          localStorage.removeItem("currentUser");
          localStorage.removeItem("sessionToken");
          location.reload();
          return;
        }
      } catch (err) {
        console.warn("⚠ Не удалось проверить сессию при загрузке (возможно временная проблема с БД):", err.message);
      }
    } else {
      // Если нет токена сессии, создаем новую
      const deviceData = getDeviceInfo();
      try {
        const sessionResponse = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: state.currentUser.id,
            device_info: deviceData.deviceInfo,
            browser: deviceData.browser,
            os: deviceData.os
          })
        });

        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json();
          localStorage.setItem("sessionToken", sessionData.session_token);
          console.log("✅ Сессия создана при загрузке:", sessionData.session_token);
        }
      } catch (err) {
        console.error("⚠ Ошибка создания сессии при загрузке:", err);
      }
    }

    // Обновляем классы контейнера для показа контента
    const container = document.querySelector(".container");
    container.classList.remove("not-logged-in");
    container.classList.add("logged-in");

    // Меняем логотип с анимированного на обычный
    document.getElementById("headerLogo").src = "img/logo_nobg.png";

    // Показываем ссылку на Google Sheets когда залогинен
    document.getElementById("headerLogoLink").style.display = "block";
    document.getElementById("headerLogoDefault").style.display = "none";

    // Показываем информацию о пользователе
    document.getElementById("userStatus").style.display = "block";
    document.getElementById("usernameBold").textContent = user.username;
    document.getElementById("username").value = user.username;
    document.getElementById("username").disabled = true;

    setAuthButtonToLogoutState();

    // Показываем админ-кнопки если это админ
    if (user.isAdmin) {
      document.getElementById("adminBtn").style.display = "inline-block";
      document.getElementById("countingBtn").style.display = "inline-block";
      document.getElementById("adminSettingsPanel").style.display = "block";
    }

    // Загружаем права модератора
    await loadModeratorPermissions();

    // Показываем кнопки модератора если есть права
    if (isModerator()) {
      // Кнопка создания турнира
      if (canCreateTournaments()) {
        document.getElementById("adminBtn").style.display = "inline-block";
      }

      // Кнопка подсчета результатов
      if (canViewCounting()) {
        document.getElementById("countingBtn").style.display = "inline-block";
      }

      // Панель модератора в настройках
      if (hasAdminPanelAccess()) {
        console.log("✅ Пользователь - модератор, показываем панель модератора");
        document.getElementById("moderatorSettingsPanel").style.display = "block";

        // Показываем кнопки в зависимости от прав
        if (canViewLogs()) {
          document.getElementById("modViewLogsBtn").style.display = "inline-block";
        }
        if (canAccessDatabasePanel()) {
          document.getElementById("modBackupDBBtn").style.display = "inline-block";
        }
        if (canManageOrphaned()) {
          document.getElementById("modOrphanedBtn").style.display = "inline-block";
        }
        if (canViewUsers()) {
          document.getElementById("modUsersBtn").style.display = "inline-block";
        }
      }
    }

    // Загружаем тему с сервера после установки currentUser
    await loadSavedTheme();

    loadEventsList();
    await loadMyBets();

    // Запускаем обновление индикатора LIVE
    updateLiveIndicator();

    // Запускаем polling избранных матчей (работает на всех вкладках и устройствах)
    startFavoriteMatchesPolling();
  } else {
    setAuthButtonToLoginState();
    loadEventsList();

    // Загружаем тему из localStorage для незалогиненных пользователей
    await loadSavedTheme();

    // Включаем гостевой режим для незалогиненных пользователей
    initGuestMode();
  }

  // Запускаем периодическую проверку сессии каждые 60 секунд
  let sessionCheckFailures = 0;
  setSessionCheckInterval(setInterval(async () => {
    // Пропускаем проверку если идет переименование пользователя
    if (state.isRenamingUser) {
      console.log("⏸ Проверка сессии пропущена (идет переименование)");
      return;
    }

    const token = localStorage.getItem("sessionToken");
    const user = localStorage.getItem("currentUser");
    if (token && user) {
      try {
        const validateResponse = await fetch(`/api/sessions/${token}/validate`);
        if (!validateResponse.ok) {
          sessionCheckFailures++;
          console.log(`⚠ Проверка сессии не прошла (попытка ${sessionCheckFailures}/3)`);

          if (sessionCheckFailures >= 3) {
            console.log("❌ Сессия недействительна после 3 попыток, выполняется выход");
            localStorage.removeItem("currentUser");
            localStorage.removeItem("sessionToken");
            location.reload();
          }
        } else {
          sessionCheckFailures = 0;
        }
      } catch (err) {
        sessionCheckFailures++;
        console.error(`⚠ Ошибка проверки сессии (попытка ${sessionCheckFailures}/3):`, err.message);

        if (sessionCheckFailures >= 3) {
          console.log("❌ Множественные ошибки проверки сессии, выполняется выход");
          localStorage.removeItem("currentUser");
          localStorage.removeItem("sessionToken");
          location.reload();
        }
      }
    }
  }, 60000));

  // Запускаем обновление статусов матчей каждые 30 секунд
  setMatchUpdateInterval(setInterval(() => {
    if (state.matches.length > 0 && state.isMatchUpdatingEnabled) {
      displayMatches();
    }
  }, 30000));

  // Обновляем настройки когда пользователь возвращается на вкладку
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.currentUser) {
      const settingsContainer = document.getElementById("settingsContainer");
      if (settingsContainer && settingsContainer.offsetParent !== null) {
        console.log("👁 Вкладка стала видимой, обновляем настройки");
        loadSettings();
      }
    }
  });
});

// ===== DOMContentLoaded — bugReport listeners =====
document.addEventListener('DOMContentLoaded', () => {
  initBugReportListeners();
});

// ===== DOMContentLoaded — recount listeners =====
document.addEventListener('DOMContentLoaded', () => {
  initRecountListeners();
});

// ===== DOMContentLoaded — recountDate/recountEvent handlers =====
document.addEventListener('DOMContentLoaded', () => {
  const recountDateInput = document.getElementById('recountDate');
  if (recountDateInput) {
    recountDateInput.addEventListener('change', (e) => {
      if (typeof loadEventsForRecount === 'function') loadEventsForRecount(e.target.value);
    });
  }

  const recountEventSelect = document.getElementById('recountEvent');
  if (recountEventSelect) {
    recountEventSelect.addEventListener('change', (e) => {
      const eventId = e.target.value;
      const date = document.getElementById('recountDate').value;
      if (eventId && date) {
        if (typeof loadRoundsForRecount === 'function') loadRoundsForRecount(eventId, date);
      } else {
        const roundSelect = document.getElementById('recountRound');
        roundSelect.innerHTML = '<option value="">Сначала выберите турнир...</option>';
        roundSelect.disabled = true;
      }
    });
  }
});

// ===== DOMContentLoaded — importSeparator handler =====
document.addEventListener("DOMContentLoaded", function () {
  const separatorSelect = document.getElementById("importSeparator");
  if (separatorSelect) {
    separatorSelect.addEventListener("change", updateImportSeparatorPreview);
  }
});

// ===== DOMContentLoaded — modal MutationObserver =====
document.addEventListener('DOMContentLoaded', () => {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
        const target = mutation.target;
        if (target.classList.contains('modal') && target.style.display === 'flex') {
          target.classList.remove('closing');
        }
      }
    });
  });

  document.querySelectorAll('.modal').forEach((modal) => {
    observer.observe(modal, { attributes: true, attributeFilter: ['style'] });
  });
});

// ===== EVENT LISTENERS (верхний уровень) =====

// Закрытие мобильного меню при клике вне его
document.addEventListener('click', (e) => {
  const userSection = document.querySelector('.user-section');
  const toggleBtn = document.getElementById('mobileMenuToggle');

  if (userSection && toggleBtn &&
      userSection.classList.contains('active') &&
      !userSection.contains(e.target) &&
      !toggleBtn.contains(e.target)) {
    userSection.classList.remove('active');
    toggleBtn.classList.remove('active');
  }
});

// Навигация по изображениям в bugReport по клавишам
document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('bugReportImagesModal');
  if (modal && modal.style.display === 'flex') {
    if (e.key === 'ArrowLeft') {
      if (typeof navigateBugReportImage === 'function') navigateBugReportImage(-1);
    } else if (e.key === 'ArrowRight') {
      if (typeof navigateBugReportImage === 'function') navigateBugReportImage(1);
    } else if (e.key === 'Escape') {
      if (typeof closeBugReportImagesModal === 'function') closeBugReportImagesModal();
    }
  }
});

// Закрытие editAwardModal при клике вне его
document.addEventListener("click", function (event) {
  const editModal = document.getElementById("editAwardModal");
  if (editModal && event.target === editModal) {
    closeEditAwardModal();
  }
});

// Закрытие кастомного select при клике вне него
document.addEventListener("click", function (e) {
  if (!e.target.closest(".custom-select")) {
    document.querySelectorAll(".select-items").forEach((item) => {
      item.classList.add("select-hide");
    });
  }
});

// Закрытие loginModal при клике на backdrop
document.addEventListener('click', (e) => {
  const modal = document.getElementById('loginModal');
  if (modal && e.target === modal) {
    closeLoginModal();
  }
});

// Закрытие loginModal по Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('loginModal');
    if (modal && modal.style.display === 'flex') {
      closeLoginModal();
    }
  }
});
