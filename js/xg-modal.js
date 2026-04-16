// ===== МОДАЛКА XG ПРОГНОЗОВ =====
import * as state from './modules/state.js';
import { lockBodyScroll, unlockBodyScroll, showCustomAlert } from './modules/ui.js';
import { loadMatches } from './modules/matches.js';

// Открыть модалку с прогнозами xG и Glicko-2
export async function openXgModal() {
  console.log('📊 Открытие модалки xG прогнозов');
  
  if (!state.currentUser) {
    await showCustomAlert('Сначала войдите в аккаунт', 'Требуется авторизация', '🔒');
    return;
  }
  
  if (!state.currentEventId) {
    await showCustomAlert('Сначала выберите турнир', 'Ошибка', '❌');
    return;
  }
  
  // Получаем название текущего турнира
  const currentEvent = state.events.find(e => e.id === state.currentEventId);
  const eventName = currentEvent ? currentEvent.name : 'Неизвестный турнир';
  
  // Получаем текущий тур
  const currentRound = state.currentRoundFilter || 'all';
  const roundName = currentRound === 'all' ? 'Все туры' : currentRound;
  
  // Если выбрано "Все туры" - предупреждаем пользователя
  if (currentRound === 'all') {
    await showCustomAlert(
      'Пожалуйста, выберите конкретный тур для просмотра прогнозов xG.\n\nЭто поможет сэкономить лимит запросов к API.',
      'Выберите тур',
      '⚠️'
    );
    return;
  }
  
  // Отправляем уведомление админу
  try {
    await fetch('/api/notify-xg-modal-opened', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.currentUser.username,
        eventName: eventName,
        round: roundName
      })
    });
  } catch (err) {
    console.error('Ошибка отправки уведомления:', err);
  }
  
  // Сначала пытаемся заполнить sstats_match_id для будущих матчей
  try {
    console.log('🔄 Попытка заполнить sstats_match_id для будущих матчей...');
    const fillResponse = await fetch('/api/admin/fill-upcoming-sstats-ids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        eventId: state.currentEventId,
        round: currentRound // Передаем текущий тур
      })
    });
    
    if (fillResponse.ok) {
      const fillResult = await fillResponse.json();
      console.log(`✅ Заполнение sstats_match_id завершено: ${fillResult.matchesUpdated} матчей обновлено`);
      
      // Если были обновления - перезагружаем матчи
      if (fillResult.matchesUpdated > 0) {
        console.log('🔄 Перезагрузка матчей после обновления sstats_match_id...');
        await loadMatches();
      }
    } else {
      console.error('❌ Ошибка при заполнении sstats_match_id:', await fillResponse.text());
    }
  } catch (err) {
    console.warn('⚠️ Не удалось заполнить sstats_match_id:', err);
  }
  
  // Получаем матчи текущего тура (после возможного обновления)
  const matchesForRound = state.matches.filter(m => m.round === currentRound);
  
  if (matchesForRound.length === 0) {
    await showCustomAlert('Нет матчей для отображения прогнозов', 'Информация', 'ℹ️');
    return;
  }
  
  // ТОЛЬКО ПОСЛЕ заполнения sstats_match_id создаем модальное окно
  const modal = document.createElement('div');
  modal.id = 'xgModal';
  modal.className = 'modal';
  modal.style.display = 'flex';
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
      <div class="modal-header">
        <h2>🎯 Прогнозы xG и Glicko-2</h2>
        <div style="display: flex; gap: 10px; align-items: center;">
          <button 
            class="btn-secondary" 
            onclick="refreshXgData()"
            style="padding: 8px 16px; font-size: 0.9em;"
            title="Обновить данные из API"
          >
            🔄 Обновить
          </button>
          <button class="modal-close" onclick="closeXgModal()">&times;</button>
        </div>
      </div>
      <div style="padding: 20px;">
        <div style="margin-bottom: 15px; color: #b0b8c8;">
          <strong>Турнир:</strong> ${eventName}<br>
          <strong>Тур:</strong> ${currentRound === 'all' ? 'Все туры' : currentRound}
        </div>
        <div id="xgMatchesList" style="display: flex; flex-direction: column; gap: 15px;">
          <div style="text-align: center; padding: 20px; color: #b0b8c8;">
            Загрузка прогнозов...
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  lockBodyScroll();
  
  // Закрытие по клику вне контента
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeXgModal();
    }
  });
  
  // Загружаем данные для каждого матча
  loadXgDataForMatches(matchesForRound);
}

// Загрузить данные xG для матчей
async function loadXgDataForMatches(matchesList, refresh = false) {
  const container = document.getElementById('xgMatchesList');
  if (!container) return;
  
  container.innerHTML = '';
  
  for (const match of matchesList) {
    const matchCard = document.createElement('div');
    matchCard.style.cssText = 'background: rgba(40, 44, 54, 0.5); border: 1px solid rgba(90, 159, 212, 0.2); border-radius: 8px; padding: 15px;';
    
    matchCard.innerHTML = `
      <div style="margin-bottom: 10px;">
        <strong style="color: #e0e6f0;">${match.team1_name} vs ${match.team2_name}</strong>
        <div style="font-size: 0.85em; color: #b0b8c8; margin-top: 4px;">
          ${new Date(match.match_date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
      <div id="xg-data-${match.id}" style="color: #b0b8c8; font-size: 0.9em;">
        Загрузка...
      </div>
    `;
    
    container.appendChild(matchCard);
    
    // Загружаем данные для этого матча с задержкой чтобы не превысить лимит API
    try {
      const url = refresh 
        ? `/api/match-glicko/${match.id}?refresh=true`
        : `/api/match-glicko/${match.id}`;
      
      const response = await fetch(url);
      const dataContainer = document.getElementById(`xg-data-${match.id}`);
      
      if (!dataContainer) continue;
      
      if (!response.ok) {
        // Проверяем причину ошибки
        try {
          const errorData = await response.json();
          if (errorData.reason === 'future_match') {
            dataContainer.innerHTML = '<span style="color: #ff9800;">⏳ Аналитика будет доступна ближе к началу матча</span>';
          } else {
            dataContainer.innerHTML = '<span style="color: #ff9800;">Данные недоступны</span>';
          }
        } catch {
          dataContainer.innerHTML = '<span style="color: #ff9800;">Данные недоступны</span>';
        }
        continue;
      }
      
      const data = await response.json();
      const glicko = data.glicko;
      
      if (!glicko) {
        dataContainer.innerHTML = '<span style="color: #ff9800;">Данные недоступны</span>';
        continue;
      }
      
      // Определяем фаворита по рейтингу
      let favoriteText = '';
      if (glicko.homeRating && glicko.awayRating) {
        const diff = glicko.homeRating - glicko.awayRating;
        if (Math.abs(diff) < 50) {
          favoriteText = '<span style="color: #ff9800;">Равные силы</span>';
        } else if (diff > 0) {
          favoriteText = `<span style="color: #4caf50;">Фаворит: ${data.team1}</span>`;
        } else {
          favoriteText = `<span style="color: #4caf50;">Фаворит: ${data.team2}</span>`;
        }
      }
      
      // Индикатор кэша
      const cacheIndicator = data.cached 
        ? `<div style="font-size: 0.8em; color: #888; margin-top: 8px;">💾 Из кэша (${new Date(data.cachedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})</div>`
        : '';
      
      dataContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${glicko.homeRating && glicko.awayRating ? `
            <div>
              <strong>Рейтинг Glicko-2:</strong><br>
              ${data.team1}: <span style="color: #5a9fd4;">${Math.round(glicko.homeRating)}</span> 
              vs 
              ${data.team2}: <span style="color: #5a9fd4;">${Math.round(glicko.awayRating)}</span>
            </div>
          ` : ''}
          
          ${glicko.homeXg !== null && glicko.awayXg !== null ? `
            <div>
              <strong>Прогноз xG:</strong><br>
              ${data.team1}: <span style="color: #ffd700;">${glicko.homeXg.toFixed(2)}</span> 
              vs 
              ${data.team2}: <span style="color: #ffd700;">${glicko.awayXg.toFixed(2)}</span>
            </div>
          ` : ''}
          
          ${glicko.homeWinProbability !== null && glicko.awayWinProbability !== null ? `
            <div>
              <strong>Вероятность победы:</strong><br>
              ${data.team1}: <span style="color: #4caf50;">${(glicko.homeWinProbability * 100).toFixed(1)}%</span> 
              | 
              Ничья: <span style="color: #ff9800;">${((1 - glicko.homeWinProbability - glicko.awayWinProbability) * 100).toFixed(1)}%</span>
              | 
              ${data.team2}: <span style="color: #4caf50;">${(glicko.awayWinProbability * 100).toFixed(1)}%</span>
            </div>
          ` : ''}
          
          ${favoriteText ? `<div style="margin-top: 5px;">${favoriteText}</div>` : ''}
          ${cacheIndicator}
        </div>
      `;
      
    } catch (err) {
      console.error(`Ошибка загрузки данных xG для матча ${match.id}:`, err);
      const dataContainer = document.getElementById(`xg-data-${match.id}`);
      if (dataContainer) {
        dataContainer.innerHTML = '<span style="color: #f44336;">Ошибка загрузки</span>';
      }
    }
    
    // Задержка 1 секунда между запросами чтобы не превысить лимит API (60 запросов в минуту)
    if (matchesList.indexOf(match) < matchesList.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Закрыть модалку xG
export function closeXgModal() {
  const modal = document.getElementById('xgModal');
  if (modal) {
    modal.remove();
  }
  unlockBodyScroll();
}


// Переключить видимость кнопки xG для всех пользователей (только для админа)
export async function toggleXgButton() {
  if (!state.currentUser || !state.currentUser.isAdmin) {
    await showCustomAlert("У вас нет прав для этого действия", "Ошибка", "❌");
    return;
  }

  try {
    // Получаем текущее состояние
    const response = await fetch('/api/xg-button-visibility');
    if (!response.ok) {
      throw new Error('Ошибка получения статуса кнопки xG');
    }

    const { hidden } = await response.json();
    const newHidden = !hidden;

    // Отправляем запрос на изменение
    const updateResponse = await fetch('/api/admin/toggle-xg-button', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_username: state.currentUser.username,
        hidden: newHidden
      })
    });

    if (!updateResponse.ok) {
      throw new Error('Ошибка изменения видимости кнопки xG');
    }

    const result = await updateResponse.json();

    await showCustomAlert(
      result.message,
      'Успех',
      '✅'
    );

    // Перезагружаем матчи чтобы обновить кнопки
    if (typeof loadMatches === 'function') {
      await loadMatches(state.currentEventId);
    }

  } catch (error) {
    console.error('Ошибка при переключении видимости кнопки xG:', error);
    await showCustomAlert(
      'Не удалось изменить видимость кнопки xG',
      'Ошибка',
      '❌'
    );
  }
}


// Обновить данные xG из API
export async function refreshXgData() {
  // Показываем предупреждение с подтверждением
  const confirmed = await showXgConfirm(
    'Частые запросы на сервер парсинга нежелательны, поэтому обновление данных ограничено один раз в 6 часов.\n\nВы уверены что хотите обновить данные?',
    'Обновление данных xG',
    '⚠️'
  );
  
  if (!confirmed) {
    return;
  }
  
  // Получаем текущий тур
  const currentRound = state.currentRoundFilter || 'all';
  
  // Получаем матчи текущего тура
  const matchesForRound = state.matches.filter(m => m.round === currentRound);
  
  if (matchesForRound.length === 0) {
    await showCustomAlert('Нет матчей для обновления', 'Информация', 'ℹ️');
    return;
  }
  
  // Проверяем время последнего обновления для каждого матча
  let canUpdate = false;
  const now = new Date();
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  
  for (const match of matchesForRound) {
    try {
      const response = await fetch(`/api/match-glicko/${match.id}`);
      if (response.ok) {
        const data = await response.json();
        if (data.cached && data.cachedAt) {
          const cachedDate = new Date(data.cachedAt);
          if (cachedDate < sixHoursAgo) {
            canUpdate = true;
            break;
          }
        } else if (!data.cached) {
          // Если данных нет в кэше - можно обновлять
          canUpdate = true;
          break;
        }
      } else {
        // Если данных нет - можно обновлять
        canUpdate = true;
        break;
      }
    } catch (err) {
      console.error('Ошибка проверки времени кэша:', err);
      canUpdate = true;
      break;
    }
  }
  
  if (!canUpdate) {
    await showCustomAlert(
      'Данные были обновлены менее 6 часов назад. Пожалуйста, подождите перед следующим обновлением.',
      'Слишком частое обновление',
      '⏱️'
    );
    return;
  }
  
  // Показываем индикатор загрузки
  const container = document.getElementById('xgMatchesList');
  if (container) {
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #b0b8c8;">🔄 Обновление данных из API...</div>';
  }
  
  // Перезагружаем данные с параметром refresh=true
  await loadXgDataForMatches(matchesForRound, true);
}

// Функция для показа кастомного confirm диалога для xG модалки
async function showXgConfirm(message, title = 'Подтверждение', icon = '❓') {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.style.zIndex = '100002'; // Выше чем модалка xG (100000)
    
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 500px;">
        <div class="modal-header">
          <h2>${icon} ${title}</h2>
        </div>
        <div style="padding: 20px;">
          <p style="color: #e0e6f0; line-height: 1.6; white-space: pre-line;">${message}</p>
          <div style="display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;">
            <button 
              class="btn-secondary" 
              id="confirmCancel" 
              style="
                padding: 10px 20px;
                background: rgba(60, 64, 74, 0.8);
                border: 1px solid rgba(90, 159, 212, 0.3);
                color: #b0b8c8;
                cursor: pointer;
                border-radius: 6px;
                font-size: 1em;
                transition: all 0.2s;
              "
              onmouseover="this.style.background='rgba(70, 74, 84, 0.9)'"
              onmouseout="this.style.background='rgba(60, 64, 74, 0.8)'"
            >
              Отмена
            </button>
            <button 
              class="btn-primary" 
              id="confirmYes" 
              style="
                padding: 10px 20px;
                background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
                border: 1px solid #4caf50;
                color: white;
                cursor: pointer;
                border-radius: 6px;
                font-size: 1em;
                font-weight: 500;
                transition: all 0.2s;
                box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
              "
              onmouseover="this.style.background='linear-gradient(135deg, #45a049 0%, #3d8b40 100%)'; this.style.boxShadow='0 4px 12px rgba(76, 175, 80, 0.4)'"
              onmouseout="this.style.background='linear-gradient(135deg, #4caf50 0%, #45a049 100%)'; this.style.boxShadow='0 2px 8px rgba(76, 175, 80, 0.3)'"
            >
              Да, обновить
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const handleYes = () => {
      document.body.removeChild(modal);
      resolve(true);
    };
    
    const handleCancel = () => {
      document.body.removeChild(modal);
      resolve(false);
    };
    
    document.getElementById('confirmYes').addEventListener('click', handleYes);
    document.getElementById('confirmCancel').addEventListener('click', handleCancel);
    
    // Закрытие по клику вне контента
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    });
  });
}
