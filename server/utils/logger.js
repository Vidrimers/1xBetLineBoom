import fs from 'fs';
import {
  LOG_FILE_PATH,
  MAX_LOG_SIZE,
  TERMINAL_LOGS_PATH,
  MAX_TERMINAL_LOGS_SIZE,
} from '../config.js';

// Массив логов терминала (в памяти)
export let terminalLogs = [];

// Функция для добавления логов в массив терминала
export function addTerminalLog(message) {
  const timestamp = new Date().toLocaleString('ru-RU');
  const logEntry = `[${timestamp}] ${message}`;

  terminalLogs.push(logEntry);

  // Ограничиваем размер массива (максимум 10000 строк)
  if (terminalLogs.length > 10000) {
    terminalLogs = terminalLogs.slice(-5000);
  }

  // Также пишем в файл для персистентности
  try {
    fs.appendFileSync(TERMINAL_LOGS_PATH, logEntry + '\n', 'utf-8');

    // Проверяем размер файла и очищаем если нужно
    const stats = fs.statSync(TERMINAL_LOGS_PATH);
    if (stats.size > MAX_TERMINAL_LOGS_SIZE) {
      const lines = fs.readFileSync(TERMINAL_LOGS_PATH, 'utf-8').split('\n');
      const lastLines = lines.slice(-2500).join('\n');
      fs.writeFileSync(TERMINAL_LOGS_PATH, lastLines, 'utf-8');
    }
  } catch (err) {
    // Игнорируем ошибки записи файла
  }
}

// Сброс файла логов (создаёт/очищает HTML-шаблон)
export function resetLogFile() {
  const template = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Логи ставок - 1xBetLineBoom</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e0e0e0;
      min-height: 100vh;
      padding: 20px;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding: 20px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .header h1 { color: #5a9fd4; font-size: 2em; margin-bottom: 10px; }
    .header p { color: #b0b8c8; font-size: 0.9em; }
    .logs-container { max-width: 1200px; margin: 0 auto; }
    .log-entry {
      background: rgba(255, 255, 255, 0.03);
      border-left: 4px solid #5a9fd4;
      padding: 15px 20px;
      margin-bottom: 10px;
      border-radius: 0 8px 8px 0;
      transition: all 0.3s ease;
    }
    .log-entry:hover { background: rgba(255, 255, 255, 0.08); transform: translateX(5px); }
    .log-entry.bet-placed { border-left-color: #4caf50; }
    .log-entry.bet-deleted { border-left-color: #f44336; }
    .log-entry.settings-changed { border-left-color: #ff9800; }
    .log-entry.moderator-assigned { border-left-color: #9c27b0; }
    .log-entry.moderator-removed { border-left-color: #f44336; }
    .log-entry.moderator-permissions-changed { border-left-color: #ff9800; }
    .log-entry.match-created { border-left-color: #4caf50; }
    .log-entry.match-edited { border-left-color: #2196f3; }
    .log-entry.match-deleted { border-left-color: #f44336; }
    .log-entry.match-result-set { border-left-color: #ff9800; }
    .log-entry.tournament-created { border-left-color: #9c27b0; }
    .log-entry.tournament-edited { border-left-color: #673ab7; }
    .log-entry.tournament-deleted { border-left-color: #f44336; }
    .log-entry.backup-created { border-left-color: #00bcd4; }
    .log-entry.backup-restored { border-left-color: #ff5722; }
    .log-entry.backup-deleted { border-left-color: #f44336; }
    .log-entry.backup-downloaded { border-left-color: #4caf50; }
    .log-entry.telegram-synced { border-left-color: #03a9f4; }
    .log-entry.orphaned-cleaned { border-left-color: #607d8b; }
    .log-entry.user-renamed { border-left-color: #ffc107; }
    .log-entry.user-deleted { border-left-color: #f44336; }
    .log-time { color: #b0b8c8; font-size: 0.85em; margin-bottom: 5px; }
    .log-action { font-weight: bold; margin-bottom: 8px; }
    .log-action.placed { color: #4caf50; }
    .log-action.deleted { color: #f44336; }
    .log-action.settings { color: #ff9800; }
    .log-action.moderator { color: #9c27b0; }
    .log-action.moderator-removed { color: #f44336; }
    .log-action.moderator-changed { color: #ff9800; }
    .log-action.match-created { color: #4caf50; }
    .log-action.match-edited { color: #2196f3; }
    .log-action.match-deleted { color: #f44336; }
    .log-action.match-result { color: #ff9800; }
    .log-action.tournament-created { color: #9c27b0; }
    .log-action.tournament-edited { color: #673ab7; }
    .log-action.tournament-deleted { color: #f44336; }
    .log-action.backup-created { color: #00bcd4; }
    .log-action.backup-restored { color: #ff5722; }
    .log-action.backup-deleted { color: #f44336; }
    .log-action.backup-downloaded { color: #4caf50; }
    .log-action.telegram-synced { color: #03a9f4; }
    .log-action.orphaned-cleaned { color: #607d8b; }
    .log-action.user-renamed { color: #ffc107; }
    .log-action.user-deleted { color: #f44336; }
    .log-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 10px;
      font-size: 0.9em;
    }
    .log-details span { padding: 5px 10px; background: rgba(0, 0, 0, 0.2); border-radius: 4px; }
    .log-details .user { color: #64b5f6; }
    .log-details .prediction { color: #ffb74d; }
    .log-details .match { color: #81c784; }
    .log-details .event { color: #ce93d8; }
    .log-details .setting { color: #ffcc80; }
    .log-details .permissions { color: #ba68c8; grid-column: 1 / -1; }
    .log-details .permissions-changes { grid-column: 1 / -1; padding: 5px 10px; background: rgba(0, 0, 0, 0.2); border-radius: 4px; }
    .log-details .tournament { color: #ba68c8; }
    .log-details .teams { color: #81c784; }
    .log-details .round { color: #ffb74d; }
    .log-details .score { color: #ff9800; }
    .log-details .backup { color: #00bcd4; }
    .log-details .details { color: #b0b8c8; grid-column: 1 / -1; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📋 Логи ставок</h1>
    <p>История всех ставок и удалений</p>
    <div id="logFileInfo" style="margin-top: 10px; font-size: 0.85em; color: #999;">
      Загрузка информации о файле...
    </div>
  </div>
  <div class="logs-container">
<!-- LOGS_START -->
<!-- LOGS_END -->
  </div>
  
  <script>
    // Загрузить информацию о размере файла логов
    async function loadLogFileInfo() {
      try {
        const response = await fetch('/api/bet-logs-info');
        const data = await response.json();
        
        if (data.success) {
          const infoDiv = document.getElementById('logFileInfo');
          const percentColor = data.percentUsed > 80 ? '#f44336' : data.percentUsed > 50 ? '#ff9800' : '#4caf50';
          
          infoDiv.innerHTML = \`
            📊 Размер файла: <strong style="color: #5a9fd4;">\${data.sizeFormatted}</strong> / \${data.maxSizeFormatted}
            <span style="color: \${percentColor}; margin-left: 10px;">(\${data.percentUsed}% использовано)</span>
          \`;
        }
      } catch (error) {
        console.error('Ошибка загрузки информации о файле:', error);
        document.getElementById('logFileInfo').innerHTML = '⚠️ Не удалось загрузить информацию о файле';
      }
    }
    
    // Загружаем информацию при загрузке страницы
    loadLogFileInfo();
    
    // Обновляем каждые 30 секунд
    setInterval(loadLogFileInfo, 30000);
  </script>
</body>
</html>`;
  fs.writeFileSync(LOG_FILE_PATH, template, 'utf-8');
  console.log('🔄 Файл логов очищен/создан');
}

// Функция записи лога в HTML файл
export function writeBetLog(action, data) {
  try {
    // Проверяем размер файла
    if (fs.existsSync(LOG_FILE_PATH)) {
      const stats = fs.statSync(LOG_FILE_PATH);
      if (stats.size >= MAX_LOG_SIZE) {
        resetLogFile();
      }
    } else {
      resetLogFile();
    }

    const time = new Date().toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Функция преобразования параметра в читаемый вид
    function formatParameterType(paramType) {
      const paramMap = {
        exact_score: 'Точный счет',
        yellow_cards: 'Желтые карточки',
        red_cards: 'Красные карточки',
        corners: 'Угловые',
        penalties_in_game: 'Пенальти в игре',
        extra_time: 'Доп. время',
        penalties_at_end: 'Пенальти в конце',
      };
      return paramMap[paramType] || paramType;
    }

    let logEntry = '';
    if (action === 'placed') {
      let predictionText = data.prediction;
      if (predictionText === 'team1') {
        predictionText = data.team1;
      } else if (predictionText === 'team2') {
        predictionText = data.team2;
      } else if (predictionText === 'draw') {
        predictionText = 'Ничья';
      }

      let finalBadge = '';
      let isFinalbet = data.is_final_bet || data.is_final_match;
      let roundSpan = '';

      if (isFinalbet) {
        finalBadge = `<span class="final-badge"><div class="log-label">Тур</div>🏆 ФИНАЛ</span>`;
        if (data.parameter_type) {
          predictionText = `${formatParameterType(data.parameter_type)}: ${data.prediction}`;
        }
      } else {
        roundSpan = `<span class="round"><div class="log-label">Тур</div>📅 ${data.round || '??'}</span>`;
      }

      let scoreSpan = '';
      if (data.score_team1 != null && data.score_team2 != null) {
        scoreSpan = `<span class="score-prediction"><div class="log-label">Прогноз счета</div>📊 ${data.score_team1}-${data.score_team2}</span>`;
      }

      logEntry = `
    <div class="log-entry bet-placed">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action placed">✅ СТАВКА СДЕЛАНА</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Пользователь</div>👤 ${data.username}</span>
        <span class="prediction"><div class="log-label">Ставка</div>🎯 ${predictionText}</span>
        ${scoreSpan}
        <span class="match"><div class="log-label">Матч</div>⚽ ${data.team1} vs ${data.team2}</span>
        ${roundSpan}
        ${finalBadge}
        <span class="event"><div class="log-label">Турнир</div>🏆 ${data.eventName || 'Неизвестный турнир'}</span>
      </div>
    </div>`;
    } else if (action === 'deleted') {
      let predictionText = data.prediction;
      if (predictionText === 'team1') {
        predictionText = data.team1;
      } else if (predictionText === 'team2') {
        predictionText = data.team2;
      } else if (predictionText === 'draw') {
        predictionText = 'Ничья';
      }

      let finalBadge = '';
      let isFinalbet = data.is_final_bet || data.is_final_match;
      let roundSpan = '';

      if (isFinalbet) {
        finalBadge = `<span class="final-badge"><div class="log-label">Тур</div>🏆 ФИНАЛ</span>`;
        if (data.parameter_type) {
          predictionText = `${formatParameterType(data.parameter_type)}: ${data.prediction}`;
        }
      } else {
        roundSpan = `<span class="round"><div class="log-label">Тур</div>📅 ${data.round || '??'}</span>`;
      }

      let scoreSpan = '';
      if (data.score_team1 != null && data.score_team2 != null) {
        scoreSpan = `<span class="score-prediction"><div class="log-label">Прогноз счета</div>📊 ${data.score_team1}-${data.score_team2}</span>`;
      }

      logEntry = `
    <div class="log-entry bet-deleted">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action deleted">❌ СТАВКА УДАЛЕНА</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Пользователь</div>👤 ${data.username}</span>
        <span class="prediction"><div class="log-label">Ставка</div>🎯 ${predictionText}</span>
        ${scoreSpan}
        <span class="match"><div class="log-label">Матч</div>⚽ ${data.team1} vs ${data.team2}</span>
        ${roundSpan}
        ${finalBadge}
        <span class="event"><div class="log-label">Турнир</div>🏆 ${data.eventName || 'Неизвестный турнир'}</span>
      </div>
    </div>`;
    } else if (action === 'settings') {
      logEntry = `
    <div class="log-entry settings-changed">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action settings">⚙️ НАСТРОЙКИ ИЗМЕНЕНЫ</div>
      <div class="log-details">
        <span class="user">👤 ${data.username}</span>
        <span class="setting">📝 ${data.setting}: ${data.oldValue ? `${data.oldValue} → ` : ''}${data.newValue || 'удалено'}</span>
      </div>
    </div>`;
    } else if (action === 'moderator_assigned') {
      logEntry = `
    <div class="log-entry moderator-assigned">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action moderator">🛡️ МОДЕРАТОР НАЗНАЧЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Пользователь</div>👤 ${data.username}</span>
        <span class="permissions"><div class="log-label">Выданные права</div>📋 ${data.permissions.replace(/\n/g, '<br>')}</span>
      </div>
    </div>`;
    } else if (action === 'moderator_removed') {
      logEntry = `
    <div class="log-entry moderator-removed">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action moderator-removed">🗑️ МОДЕРАТОР УДАЛЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Пользователь</div>👤 ${data.username}</span>
      </div>
    </div>`;
    } else if (action === 'moderator_permissions_changed') {
      let changesHtml = '';
      if (data.added) {
        const addedLines = data.added.split('\n').map(line =>
          `<div style="color: #81c784; margin: 2px 0;">➕ ${line}</div>`
        ).join('');
        changesHtml += addedLines;
      }
      if (data.removed) {
        const removedLines = data.removed.split('\n').map(line =>
          `<div style="color: #ef5350; margin: 2px 0;">➖ ${line}</div>`
        ).join('');
        changesHtml += removedLines;
      }
      logEntry = `
    <div class="log-entry moderator-permissions-changed">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action moderator-changed">🔄 ПРАВА МОДЕРАТОРА ИЗМЕНЕНЫ</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Пользователь</div>👤 ${data.username}</span>
        <div class="permissions-changes"><div class="log-label">Изменения</div>${changesHtml}</div>
      </div>
    </div>`;
    } else if (action === 'match_created') {
      logEntry = `
    <div class="log-entry match-created">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action match-created">⚽ МАТЧ СОЗДАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="teams"><div class="log-label">Команды</div>⚽ ${data.team1} vs ${data.team2}</span>
        <span class="tournament"><div class="log-label">Турнир</div>🏆 ${data.tournament}</span>
        <span class="round"><div class="log-label">Тур</div>📅 ${data.round}</span>
        ${data.is_final ? '<span class="round"><div class="log-label">Тип</div>🏅 Финальный матч</span>' : ''}
      </div>
    </div>`;
    } else if (action === 'match_edited') {
      logEntry = `
    <div class="log-entry match-edited">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action match-edited">✏️ МАТЧ ОТРЕДАКТИРОВАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="teams"><div class="log-label">Команды</div>⚽ ${data.team1} vs ${data.team2}</span>
        <span class="tournament"><div class="log-label">Турнир</div>🏆 ${data.tournament}</span>
        <span class="round"><div class="log-label">Тур</div>📅 ${data.round}</span>
      </div>
    </div>`;
    } else if (action === 'match_deleted') {
      logEntry = `
    <div class="log-entry match-deleted">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action match-deleted">🗑️ МАТЧ УДАЛЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="teams"><div class="log-label">Команды</div>⚽ ${data.team1} vs ${data.team2}</span>
        <span class="tournament"><div class="log-label">Турнир</div>🏆 ${data.tournament}</span>
        <span class="round"><div class="log-label">Тур</div>📅 ${data.round}</span>
      </div>
    </div>`;
    } else if (action === 'match_result_set') {
      logEntry = `
    <div class="log-entry match-result-set">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action match-result">📊 РЕЗУЛЬТАТ МАТЧА УСТАНОВЛЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="teams"><div class="log-label">Команды</div>⚽ ${data.team1} vs ${data.team2}</span>
        <span class="score"><div class="log-label">Счет</div>⚽ ${data.score}</span>
        <span class="tournament"><div class="log-label">Турнир</div>🏆 ${data.tournament}</span>
      </div>
    </div>`;
    } else if (action === 'tournament_created') {
      logEntry = `
    <div class="log-entry tournament-created">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action tournament-created">🏆 ТУРНИР СОЗДАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="tournament"><div class="log-label">Название</div>🏆 ${data.name}</span>
        ${data.dates ? `<span class="details"><div class="log-label">Даты</div>📅 ${data.dates}</span>` : ''}
      </div>
    </div>`;
    } else if (action === 'tournament_edited') {
      logEntry = `
    <div class="log-entry tournament-edited">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action tournament-edited">✏️ ТУРНИР ОТРЕДАКТИРОВАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="tournament"><div class="log-label">Название</div>🏆 ${data.name}</span>
      </div>
    </div>`;
    } else if (action === 'tournament_deleted') {
      const userLabel = data.is_moderator ? 'Модератор' : 'Администратор';
      logEntry = `
    <div class="log-entry tournament-deleted">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action tournament-deleted">🗑️ ТУРНИР УДАЛЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">${userLabel}</div>👤 ${data.user}</span>
        <span class="tournament"><div class="log-label">Название</div>🏆 ${data.name}</span>
        <span class="tournament"><div class="log-label">ID</div>🔢 ${data.event_id}</span>
      </div>
    </div>`;
    } else if (action === 'backup_created') {
      logEntry = `
    <div class="log-entry backup-created">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action backup-created">💾 БЭКАП СОЗДАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="backup"><div class="log-label">Файл</div>📦 ${data.filename}</span>
        <span class="backup"><div class="log-label">Размер</div>📊 ${data.size}</span>
      </div>
    </div>`;
    } else if (action === 'backup_restored') {
      logEntry = `
    <div class="log-entry backup-restored">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action backup-restored">📥 БАЗА ДАННЫХ ВОССТАНОВЛЕНА</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="backup"><div class="log-label">Из файла</div>📦 ${data.filename}</span>
        ${data.currentBackup ? `<span class="backup"><div class="log-label">Создан бэкап</div>💾 ${data.currentBackup}</span>` : ''}
      </div>
    </div>`;
    } else if (action === 'backup_deleted') {
      logEntry = `
    <div class="log-entry backup-deleted">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action backup-deleted">🗑️ БЭКАП УДАЛЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="backup"><div class="log-label">Файл</div>📦 ${data.filename}</span>
      </div>
    </div>`;
    } else if (action === 'backup_downloaded') {
      logEntry = `
    <div class="log-entry backup-downloaded">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action backup-downloaded">💾 БЭКАП СКАЧАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="backup"><div class="log-label">Файл</div>📦 ${data.filename}</span>
        <span class="backup"><div class="log-label">Размер</div>📊 ${data.size}</span>
      </div>
    </div>`;
    } else if (action === 'telegram_synced') {
      logEntry = `
    <div class="log-entry telegram-synced">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action telegram-synced">🔄 СИНХРОНИЗАЦИЯ TELEGRAM ID</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="details"><div class="log-label">Результат</div>✅ Обновлено: ${data.updated} | ❌ Не найдено: ${data.notFound}</span>
      </div>
    </div>`;
    } else if (action === 'orphaned_cleaned') {
      logEntry = `
    <div class="log-entry orphaned-cleaned">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action orphaned-cleaned">🗑️ ОЧИСТКА ORPHANED ДАННЫХ</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="details"><div class="log-label">Удалено</div>${data.details}</span>
      </div>
    </div>`;
    } else if (action === 'user_renamed') {
      logEntry = `
    <div class="log-entry user-renamed">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action user-renamed">✏️ ПОЛЬЗОВАТЕЛЬ ПЕРЕИМЕНОВАН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="details"><div class="log-label">Изменение</div>👤 ${data.oldName} → ${data.newName}</span>
      </div>
    </div>`;
    } else if (action === 'user_deleted') {
      logEntry = `
    <div class="log-entry user-deleted">
      <div class="log-time">🕐 ${time}</div>
      <div class="log-action user-deleted">🗑️ ПОЛЬЗОВАТЕЛЬ УДАЛЕН</div>
      <div class="log-details">
        <span class="user"><div class="log-label">Модератор</div>👤 ${data.moderator}</span>
        <span class="details"><div class="log-label">Пользователь</div>👤 ${data.username}</span>
        ${data.betsDeleted ? `<span class="details"><div class="log-label">Удалено ставок</div>📊 ${data.betsDeleted}</span>` : ''}
      </div>
    </div>`;
    }

    // Читаем файл и вставляем новый лог после <!-- LOGS_START -->
    let content = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
    content = content.replace('<!-- LOGS_START -->', `<!-- LOGS_START -->${logEntry}`);
    fs.writeFileSync(LOG_FILE_PATH, content, 'utf-8');

    console.log(`📝 Лог записан: ${action} - ${data.username}`);
  } catch (error) {
    console.error('❌ Ошибка записи лога:', error);
  }
}

// Инициализация: загружаем логи из файла при старте
export function initTerminalLogs(TERMINAL_LOGS_PATH_PARAM) {
  try {
    if (fs.existsSync(TERMINAL_LOGS_PATH_PARAM)) {
      const fileContent = fs.readFileSync(TERMINAL_LOGS_PATH_PARAM, 'utf-8');
      terminalLogs = fileContent
        .split('\n')
        .filter((line) => line.trim().length > 0);
      if (terminalLogs.length > 5000) {
        terminalLogs = terminalLogs.slice(-5000);
      }
    }
  } catch (err) {
    console.error('Ошибка при загрузке логов терминала:', err);
  }
}

// Очистить массив логов терминала
export function clearTerminalLogs() {
  terminalLogs = [];
}
