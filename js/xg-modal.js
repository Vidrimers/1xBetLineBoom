// ===== МОДАЛКА XG ПРОГНОЗОВ =====

// Открыть модалку с прогнозами xG и Glicko-2
async function openXgModal() {
  console.log('📊 Открытие модалки xG прогнозов');
  
  if (!currentUser) {
    await showCustomAlert('Сначала войдите в аккаунт', 'Требуется авторизация', '🔒');
    return;
  }
  
  if (!currentEventId) {
    await showCustomAlert('Сначала выберите турнир', 'Ошибка', '❌');
    return;
  }
  
  // Получаем название текущего турнира
  const currentEvent = events.find(e => e.id === currentEventId);
  const eventName = currentEvent ? currentEvent.name : 'Неизвестный турнир';
  
  // Отправляем уведомление админу
  try {
    await fetch('/api/notify-xg-modal-opened', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        eventName: eventName
      })
    });
  } catch (err) {
    console.error('Ошибка отправки уведомления:', err);
  }
  
  // Получаем матчи текущего тура
  const currentRound = currentRoundFilter || 'all';
  const matchesForRound = matches.filter(m => {
    if (currentRound === 'all') return true;
    return m.round === currentRound;
  });
  
  if (matchesForRound.length === 0) {
    await showCustomAlert('Нет матчей для отображения прогнозов', 'Информация', 'ℹ️');
    return;
  }
  
  // Создаем модальное окно
  const modal = document.createElement('div');
  modal.id = 'xgModal';
  modal.className = 'modal';
  modal.style.display = 'flex';
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
      <div class="modal-header">
        <h2>🎯 Прогнозы xG и Glicko-2</h2>
        <button class="modal-close" onclick="closeXgModal()">&times;</button>
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
  
  // Загружаем данные для каждого матча
  loadXgDataForMatches(matchesForRound);
}

// Загрузить данные xG для матчей
async function loadXgDataForMatches(matchesList) {
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
    
    // Загружаем данные для этого матча
    try {
      const response = await fetch(`/api/match-glicko/${match.id}`);
      const dataContainer = document.getElementById(`xg-data-${match.id}`);
      
      if (!dataContainer) continue;
      
      if (!response.ok) {
        dataContainer.innerHTML = '<span style="color: #ff9800;">Данные недоступны</span>';
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
        </div>
      `;
      
    } catch (err) {
      console.error(`Ошибка загрузки данных xG для матча ${match.id}:`, err);
      const dataContainer = document.getElementById(`xg-data-${match.id}`);
      if (dataContainer) {
        dataContainer.innerHTML = '<span style="color: #f44336;">Ошибка загрузки</span>';
      }
    }
  }
}

// Закрыть модалку xG
function closeXgModal() {
  const modal = document.getElementById('xgModal');
  if (modal) {
    modal.remove();
  }
  unlockBodyScroll();
}


// Переключить видимость кнопки xG для всех пользователей (только для админа)
async function toggleXgButton() {
  if (!currentUser || !currentUser.isAdmin) {
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
        admin_username: currentUser.username,
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
      await loadMatches();
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
