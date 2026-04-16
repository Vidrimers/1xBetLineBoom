// ===== ПРОГНОЗЫ ПОЛЬЗОВАТЕЛЕЙ В СЕТКЕ ПЛЕЙ-ОФФ =====

import { currentUser, currentEventId } from './state.js';
import { showCustomAlert } from './ui.js';

// Показать прогнозы пользователя в сетке плей-офф
export async function showUserBracketPredictions(bracketId, userId) {
  try {
    // Загружаем прогнозы пользователя с передачей viewerId
    const currentUserId = currentUser ? currentUser.id : null;
    const url = `/api/brackets/${bracketId}/predictions/${userId}${currentUserId ? `?viewerId=${currentUserId}` : ''}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('Ошибка загрузки прогнозов');
    }

    const data = await response.json();

    // Проверяем, скрыты ли прогнозы
    if (data.hidden) {
      const betsContainer = document.getElementById('tournamentParticipantBetsContainer');
      if (betsContainer) {
        betsContainer.innerHTML = `
          <div style="padding: 40px; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 20px;"><svg class="icon" aria-hidden="true"><use href="#icon-hidden"></use></svg></div>
            <div style="font-size: 18px; color: #b0b8c8; margin-bottom: 10px;">Прогнозы скрыты</div>
            <div style="font-size: 14px; color: #888;">${data.message || 'Пользователь скрыл свои прогнозы до начала плей-офф'}</div>
          </div>
        `;
      }
      return;
    }

    const predictions = data.predictions || data; // Поддержка старого формата

    // Формируем HTML для отображения прогнозов
    let html = '<div style="padding: 20px;">';

    if (predictions.length === 0) {
      html += '<div class="empty-message">Пользователь не сделал прогнозов в этой сетке</div>';
    } else {
      // Группируем прогнозы по стадиям
      const stageNames = {
        'round_of_16': '1/16 финала',
        'round_of_8': '1/8 финала',
        'quarter_finals': '1/4 финала',
        'semi_finals': '1/2 финала',
        'final': 'Финал'
      };

      const groupedPredictions = {};
      predictions.forEach(p => {
        if (!groupedPredictions[p.stage]) {
          groupedPredictions[p.stage] = [];
        }
        groupedPredictions[p.stage].push(p);
      });

      // Отображаем прогнозы по стадиям
      const stageOrder = ['round_of_16', 'round_of_8', 'quarter_finals', 'semi_finals', 'final'];
      stageOrder.forEach(stage => {
        if (groupedPredictions[stage]) {
          html += `<h3 style="color: #5a9fd4; margin-top: 20px; margin-bottom: 10px;">${stageNames[stage]}</h3>`;
          html += '<div style="display: flex; flex-direction: column; gap: 8px;">';

          groupedPredictions[stage].forEach(p => {
            html += `
              <div style="background: rgba(40, 44, 54, 0.6); border: 1px solid rgba(90, 159, 212, 0.3); border-radius: 5px; padding: 10px;">
                <div style="color: #5a9fd4; font-weight: 600;">Матч ${p.match_index + 1}</div>
                <div style="color: #e0e6f0; margin-top: 5px;">Прогноз: <strong>${p.predicted_winner}</strong></div>
              </div>
            `;
          });

          html += '</div>';
        }
      });
    }

    html += '</div>';

    // Отображаем в контейнере ставок
    const betsContainer = document.getElementById('tournamentParticipantBetsContainer');
    if (betsContainer) {
      betsContainer.innerHTML = html;
    }

    // Обновляем активную кнопку
    document.querySelectorAll("#tournamentRoundsFilterScroll .round-filter-btn").forEach(btn => {
      btn.classList.remove("active");
    });
    document.querySelectorAll("#tournamentRoundsFilterScroll .bracket-filter-btn").forEach(btn => {
      if (btn.onclick && btn.onclick.toString().includes(`showUserBracketPredictions(${bracketId}`)) {
        btn.classList.add("active");
      }
    });

  } catch (error) {
    console.error('Ошибка при загрузке прогнозов пользователя:', error);
    const betsContainer = document.getElementById('tournamentParticipantBetsContainer');
    if (betsContainer) {
      betsContainer.innerHTML = '<div class="empty-message">Ошибка загрузки прогнозов</div>';
    }
  }
}

// Показать прогнозы пользователя в сетке (открыть модалку)
export async function showUserBracketPredictionsInline(userId, username = 'Пользователь') {
  try {
    // Находим сетку для текущего турнира (используем window.currentEventId или currentEventId)
    const eventId = window.currentEventId || currentEventId;

    if (!eventId) {
      if (typeof showCustomAlert === 'function') {
        await showCustomAlert('Сначала выберите турнир', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      } else {
        alert('Сначала выберите турнир');
      }
      return;
    }

    const brackets = await window.loadBracketsForEvent(eventId);
    if (!brackets || brackets.length === 0) {
      if (typeof showCustomAlert === 'function') {
        await showCustomAlert('Для этого турнира нет сетки плей-офф', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      } else {
        alert('Для этого турнира нет сетки плей-офф');
      }
      return;
    }

    const bracket = brackets[0];

    // Отправляем уведомление о просмотре сетки (если смотрит не владелец)
    if (currentUser && currentUser.id !== userId) {
      fetch('/api/notify-view-bracket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewedUserId: userId,
          eventId: eventId
        })
      }).catch(err => console.error('Ошибка отправки уведомления о просмотре сетки:', err));
    }

    // Сохраняем username для использования в модалке
    window.viewingUserBracketName = username;

    // Напрямую открываем модалку сетки с прогнозами пользователя
    await window.openBracketModal(bracket.id, userId);
  } catch (error) {
    console.error('Ошибка при открытии прогнозов сетки:', error);
    if (typeof showCustomAlert === 'function') {
      await showCustomAlert('Не удалось загрузить прогнозы сетки', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    } else {
      alert('Не удалось загрузить прогнозы сетки');
    }
  }
}
