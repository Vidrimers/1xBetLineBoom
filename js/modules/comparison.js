import * as state from './state.js';
import { showCustomAlert } from './ui.js';

// ===== СРАВНЕНИЕ УЧАСТНИКОВ =====

// Открыть модальное окно сравнения участников
export async function openComparisonModal() {
  if (!state.currentEventId) {
    await showCustomAlert('Ошибка: турнир не выбран', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  // Блокируем body
  document.body.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  // Закрытие по клику вне модалки
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      document.body.style.overflow = '';
    }
  });

  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;"><svg class="icon" aria-hidden="true"><use href="#icon-compare"></use></svg> Сравнение участников</h3>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; color: #e0e6f0; margin-bottom: 8px;">Первый участник:</label>
        <select id="compareUser1" style="
          width: 100%;
          padding: 12px;
          border: 1px solid #3a7bd5;
          border-radius: 8px;
          background: #2a3a4a;
          color: #e0e6f0;
          font-size: 16px;
        ">
          <option value="">Выберите участника...</option>
        </select>
      </div>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; color: #e0e6f0; margin-bottom: 8px;">Второй участник:</label>
        <select id="compareUser2" style="
          width: 100%;
          padding: 12px;
          border: 1px solid #3a7bd5;
          border-radius: 8px;
          background: #2a3a4a;
          color: #e0e6f0;
          font-size: 16px;
        ">
          <option value="">Выберите участника...</option>
        </select>
      </div>
      
      <div style="display: flex; gap: 10px;">
        <button onclick="showComparison()" style="
          flex: 1;
          background: #4caf50;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Сравнить</button>
        <button onclick="this.closest('div[style*=fixed]').remove(); document.body.style.overflow = '';" style="
          flex: 1;
          background: #f44336;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Отмена</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Загружаем список участников
  try {
    const response = await fetch(`/api/events/${state.currentEventId}/tournament-participants`);
    const participants = await response.json();

    const select1 = document.getElementById('compareUser1');
    const select2 = document.getElementById('compareUser2');

    participants.forEach(p => {
      const option1 = document.createElement('option');
      option1.value = p.id;
      option1.textContent = `${p.username} (${p.event_won || 0} очков)`;
      select1.appendChild(option1);

      const option2 = document.createElement('option');
      option2.value = p.id;
      option2.textContent = `${p.username} (${p.event_won || 0} очков)`;
      select2.appendChild(option2);
    });
  } catch (error) {
    console.error('Ошибка загрузки участников:', error);
  }
}

// Показать сравнение двух участников
export async function showComparison() {
  const user1Id = document.getElementById('compareUser1').value;
  const user2Id = document.getElementById('compareUser2').value;

  if (!user1Id || !user2Id) {
    await showCustomAlert('Выберите обоих участников', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  if (user1Id === user2Id) {
    await showCustomAlert('Выберите разных участников', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  // Закрываем модалку выбора
  document.querySelector('div[style*="z-index: 10000"]').remove();

  // Загружаем данные для сравнения
  try {
    const [bets1Response, bets2Response] = await Promise.all([
      fetch(`/api/events/${state.currentEventId}/user-bets/${user1Id}`),
      fetch(`/api/events/${state.currentEventId}/user-bets/${user2Id}`)
    ]);

    const bets1 = await bets1Response.json();
    const bets2 = await bets2Response.json();

    // Отправляем уведомление админу
    try {
      await fetch('/api/notify-comparison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewerUsername: state.currentUser?.username || 'Неизвестный',
          user1Username: bets1.user.username,
          user2Username: bets2.user.username,
          eventName: window.currentEventName || null
        })
      });
    } catch (notifyError) {
      console.error('Ошибка отправки уведомления:', notifyError);
    }

    displayComparisonModal(bets1, bets2);
  } catch (error) {
    console.error('Ошибка загрузки данных:', error);
    await showCustomAlert('Ошибка загрузки данных для сравнения', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Отобразить модалку сравнения
export function displayComparisonModal(data1, data2) {
  // Блокируем body
  document.body.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.className = 'comparison-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  // Закрытие по клику вне модалки
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeComparisonModal();
    }
  });

  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 900px;
      width: 95%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      position: relative;
    ">
      <button class="modal-close" onclick="closeComparisonModal()" style="
        position: absolute;
        top: 15px;
        right: 15px;
        background: transparent;
        border: none;
        color: #e0e6f0;
        font-size: 24px;
        cursor: pointer;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background 0.2s;
      " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">×</button>
      
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4; padding-right: 30px;"><svg class="icon" aria-hidden="true"><use href="#icon-compare"></use></svg> ${data1.user.username} vs ${data2.user.username}</h3>
      
      <div style="display: flex; gap: 10px; margin-bottom: 20px;">
        <button onclick="switchComparisonTab('bets')" id="comparisonTabBets" style="
          flex: 1;
          background: #2196f3;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Ставки</button>
        <button onclick="switchComparisonTab('stats')" id="comparisonTabStats" style="
          flex: 1;
          background: #607d8b;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Статистика</button>
      </div>
      
      <div id="comparisonContent"></div>
    </div>
  `;

  document.body.appendChild(modal);

  // Сохраняем данные для переключения вкладок
  window.comparisonData = { data1, data2 };

  // Показываем вкладку ставок по умолчанию
  switchComparisonTab('bets');
}

// Закрыть модалку сравнения
export function closeComparisonModal() {
  const modal = document.querySelector('.comparison-modal');
  if (modal) {
    modal.remove();
  }
  // Разблокируем body
  document.body.style.overflow = '';
}

// Переключить вкладку сравнения
export function switchComparisonTab(tab) {
  const { data1, data2 } = window.comparisonData;

  // Обновляем стили кнопок
  document.getElementById('comparisonTabBets').style.background = tab === 'bets' ? '#2196f3' : '#607d8b';
  document.getElementById('comparisonTabStats').style.background = tab === 'stats' ? '#2196f3' : '#607d8b';

  const content = document.getElementById('comparisonContent');

  if (tab === 'bets') {
    const selectedRound = window.comparisonSelectedRound || 'all';
    content.innerHTML = generateBetsComparison(data1, data2, selectedRound);
  } else {
    content.innerHTML = generateStatsComparison(data1, data2);
  }
}

// Генерировать сравнение ставок
export function generateBetsComparison(data1, data2, selectedRound = 'all') {
  const bets1Map = new Map(data1.bets.map(b => [b.match_id, b]));
  const bets2Map = new Map(data2.bets.map(b => [b.match_id, b]));

  // Функция для форматирования прогноза
  const formatPrediction = (prediction, match) => {
    if (!prediction) return '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Нет ставки';
    if (prediction === 'team1') return match?.team1_name || 'Команда 1';
    if (prediction === 'team2') return match?.team2_name || 'Команда 2';
    if (prediction === 'draw') return 'Ничья';
    return prediction;
  };

  // Находим различия
  const differences = [];
  const allMatchIds = new Set([...bets1Map.keys(), ...bets2Map.keys()]);

  allMatchIds.forEach(matchId => {
    const bet1 = bets1Map.get(matchId);
    const bet2 = bets2Map.get(matchId);

    if (!bet1 || !bet2 || bet1.prediction !== bet2.prediction) {
      differences.push({
        match: bet1?.match || bet2?.match,
        round: bet1?.round || bet2?.round,
        bet1: bet1,
        bet2: bet2
      });
    }
  });

  // Получаем уникальные туры только из различий
  const rounds = [...new Set(differences.map(d => d.round).filter(r => r))].sort();

  // Фильтруем по выбранному туру
  const filteredDifferences = selectedRound === 'all'
    ? differences
    : differences.filter(d => d.round === selectedRound);

  if (differences.length === 0) {
    return '<div style="color: #4caf50; text-align: center; padding: 20px;"><svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Все ставки одинаковые</div>';
  }

  return `
    <div style="color: #e0e6f0;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
        <h4 style="color: #ff9800; margin: 0;"><svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg> Различия в ставках (${filteredDifferences.length})</h4>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button onclick="filterComparisonByRound('all')" style="
            background: ${selectedRound === 'all' ? '#2196f3' : '#607d8b'};
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9em;
          ">Все туры</button>
          ${rounds.map(round => {
            const escapedRound = round.replace(/'/g, "\\'");
            return `
            <button onclick="filterComparisonByRound('${escapedRound}')" style="
              background: ${selectedRound === round ? '#2196f3' : '#607d8b'};
              color: white;
              border: none;
              padding: 8px 16px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 0.9em;
            ">${round}</button>
          `;
          }).join('')}
        </div>
      </div>
      ${filteredDifferences.map(diff => `
        <div style="
          background: #2a3a4a;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 10px;
        ">
          <div style="font-weight: bold; margin-bottom: 10px;">
            ${diff.round ? `<span style="color: #999; font-size: 0.85em;">${diff.round}</span><br/>` : ''}
            ${diff.match?.team1_name || 'Матч'} vs ${diff.match?.team2_name || ''}
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div style="background: #1e2a3a; padding: 10px; border-radius: 6px;">
              <div style="color: #5a9fd4; font-size: 0.9em; margin-bottom: 5px;">${data1.user.username}</div>
              <div>${formatPrediction(diff.bet1?.prediction, diff.match)}</div>
              ${diff.bet1 ? `<div style="color: ${diff.bet1.is_won ? '#4caf50' : diff.bet1.is_lost ? '#f44336' : '#999'}; font-size: 0.85em; margin-top: 5px;">
                ${diff.bet1.is_won ? '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Выиграл' : diff.bet1.is_lost ? '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Проиграл' : '<svg class="icon" aria-hidden="true"><use href="#icon-pending"></use></svg> Ожидание'}
              </div>` : ''}
            </div>
            <div style="background: #1e2a3a; padding: 10px; border-radius: 6px;">
              <div style="color: #5a9fd4; font-size: 0.9em; margin-bottom: 5px;">${data2.user.username}</div>
              <div>${formatPrediction(diff.bet2?.prediction, diff.match)}</div>
              ${diff.bet2 ? `<div style="color: ${diff.bet2.is_won ? '#4caf50' : diff.bet2.is_lost ? '#f44336' : '#999'}; font-size: 0.85em; margin-top: 5px;">
                ${diff.bet2.is_won ? '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Выиграл' : diff.bet2.is_lost ? '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Проиграл' : '<svg class="icon" aria-hidden="true"><use href="#icon-pending"></use></svg> Ожидание'}
              </div>` : ''}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// Фильтровать сравнение по туру
export function filterComparisonByRound(round) {
  const { data1, data2 } = window.comparisonData;
  window.comparisonSelectedRound = round;
  const content = document.getElementById('comparisonContent');
  content.innerHTML = generateBetsComparison(data1, data2, round);
}

// Генерировать сравнение статистики
export function generateStatsComparison(data1, data2) {
  const stats = [
    { label: 'Очки', key: 'event_won', better: 'higher' },
    { label: 'Всего ставок', key: 'event_bets', better: 'higher' },
    { label: 'Выиграно', key: 'event_won_count', better: 'higher' },
    { label: 'Проиграно', key: 'event_lost', better: 'lower' },
    { label: 'Ожидание', key: 'event_pending', better: 'none' }
  ];

  return `
    <div style="color: #e0e6f0;">
      <h4 style="color: #5a9fd4; margin-bottom: 15px;"><svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Статистика турнира</h4>
      <div style="background: #2a3a4a; padding: 15px; border-radius: 8px;">
        ${stats.map(stat => {
          const val1 = data1.stats[stat.key] || 0;
          const val2 = data2.stats[stat.key] || 0;
          const isDiff = val1 !== val2;
          const winner = stat.better === 'higher' ? (val1 > val2 ? 1 : val1 < val2 ? 2 : 0) :
                        stat.better === 'lower' ? (val1 < val2 ? 1 : val1 > val2 ? 2 : 0) : 0;

          return `
            <div style="
              display: grid;
              grid-template-columns: 1fr auto auto;
              gap: 15px;
              padding: 10px 0;
              border-bottom: 1px solid #1e2a3a;
              align-items: center;
            ">
              <div style="font-weight: ${isDiff ? 'bold' : 'normal'}; color: ${isDiff ? '#ff9800' : '#e0e6f0'};">
                ${stat.label}
              </div>
              <div style="
                text-align: center;
                padding: 5px 15px;
                background: ${winner === 1 ? '#4caf50' : '#1e2a3a'};
                border-radius: 6px;
                font-weight: ${winner === 1 ? 'bold' : 'normal'};
                min-width: 60px;
              ">
                ${val1}
              </div>
              <div style="
                text-align: center;
                padding: 5px 15px;
                background: ${winner === 2 ? '#4caf50' : '#1e2a3a'};
                border-radius: 6px;
                font-weight: ${winner === 2 ? 'bold' : 'normal'};
                min-width: 60px;
              ">
                ${val2}
              </div>
            </div>
          `;
        }).join('')}
        
        <div style="
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 15px;
          padding-top: 10px;
          align-items: center;
          font-size: 0.9em;
          color: #999;
        ">
          <div></div>
          <div style="text-align: center; min-width: 60px;">${data1.user.username}</div>
          <div style="text-align: center; min-width: 60px;">${data2.user.username}</div>
        </div>
      </div>
    </div>
  `;
}

// Открыть модальное окно сравнения участников (глобальное)
export async function openGlobalComparisonModal() {
  // Блокируем body
  document.body.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  // Закрытие по клику вне модалки
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      document.body.style.overflow = '';
    }
  });

  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4;"><svg class="icon" aria-hidden="true"><use href="#icon-compare"></use></svg> Сравнение участников</h3>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; color: #e0e6f0; margin-bottom: 8px;">Первый участник:</label>
        <select id="globalCompareUser1" style="
          width: 100%;
          padding: 12px;
          border: 1px solid #3a7bd5;
          border-radius: 8px;
          background: #2a3a4a;
          color: #e0e6f0;
          font-size: 16px;
        ">
          <option value="">Выберите участника...</option>
        </select>
      </div>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; color: #e0e6f0; margin-bottom: 8px;">Второй участник:</label>
        <select id="globalCompareUser2" style="
          width: 100%;
          padding: 12px;
          border: 1px solid #3a7bd5;
          border-radius: 8px;
          background: #2a3a4a;
          color: #e0e6f0;
          font-size: 16px;
        ">
          <option value="">Выберите участника...</option>
        </select>
      </div>
      
      <div style="display: flex; gap: 10px;">
        <button onclick="showGlobalComparison()" style="
          flex: 1;
          background: #4caf50;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Сравнить</button>
        <button onclick="this.closest('div[style*=fixed]').remove(); document.body.style.overflow = '';" style="
          flex: 1;
          background: #f44336;
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
        ">Отмена</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Загружаем список всех участников
  try {
    const response = await fetch('/api/participants');
    const participants = await response.json();

    const select1 = document.getElementById('globalCompareUser1');
    const select2 = document.getElementById('globalCompareUser2');

    participants.forEach(p => {
      const option1 = document.createElement('option');
      option1.value = p.id;
      option1.textContent = p.username;
      select1.appendChild(option1);

      const option2 = document.createElement('option');
      option2.value = p.id;
      option2.textContent = p.username;
      select2.appendChild(option2);
    });
  } catch (error) {
    console.error('Ошибка загрузки участников:', error);
  }
}

// Показать глобальное сравнение
export async function showGlobalComparison() {
  const user1Id = document.getElementById('globalCompareUser1').value;
  const user2Id = document.getElementById('globalCompareUser2').value;

  if (!user1Id || !user2Id) {
    await showCustomAlert('Выберите обоих участников', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  if (user1Id === user2Id) {
    await showCustomAlert('Выберите разных участников', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  // Закрываем модалку выбора
  document.querySelector('div[style*="z-index: 10000"]').remove();

  // Загружаем глобальную статистику
  try {
    const [stats1Response, stats2Response] = await Promise.all([
      fetch(`/api/users/${user1Id}/global-stats`),
      fetch(`/api/users/${user2Id}/global-stats`)
    ]);

    const stats1 = await stats1Response.json();
    const stats2 = await stats2Response.json();

    // Отправляем уведомление админу
    try {
      await fetch('/api/notify-comparison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewerUsername: state.currentUser?.username || 'Неизвестный',
          user1Username: stats1.user.username,
          user2Username: stats2.user.username,
          eventName: null
        })
      });
    } catch (notifyError) {
      console.error('Ошибка отправки уведомления:', notifyError);
    }

    displayGlobalComparisonModal(stats1, stats2);
  } catch (error) {
    console.error('Ошибка загрузки данных:', error);
    await showCustomAlert('Ошибка загрузки данных для сравнения', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

// Отобразить модалку глобального сравнения
export function displayGlobalComparisonModal(data1, data2) {
  // Блокируем body
  document.body.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.className = 'comparison-modal global-comparison-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  // Закрытие по клику вне модалки
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeGlobalComparisonModal();
    }
  });

  const stats = [
    { label: 'Всего очков', key: 'won_bets', better: 'higher' },
    { label: 'Побед в турнирах', key: 'tournament_wins', better: 'higher' },
    { label: 'Точность угадывания', key: 'win_accuracy', better: 'higher', suffix: '%' },
    { label: 'Турниров', key: 'tournaments_count', better: 'higher' },
    { label: 'Всего ставок', key: 'total_bets', better: 'higher' },
    { label: 'Выиграно ставок', key: 'won_count', better: 'higher' },
    { label: 'Проиграно ставок', key: 'lost_bets', better: 'lower' },
    { label: 'Ожидание', key: 'pending_bets', better: 'none' },
    { label: 'Плей-офф угадано', key: 'bracket_correct', better: 'higher' },
    { label: 'Плей-офф не угадано', key: 'bracket_incorrect', better: 'lower' }
  ];

  modal.innerHTML = `
    <div style="
      background: #1e2a3a;
      padding: 30px;
      border-radius: 12px;
      max-width: 700px;
      width: 95%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      position: relative;
    ">
      <button class="modal-close" onclick="closeGlobalComparisonModal()" style="
        position: absolute;
        top: 15px;
        right: 15px;
        background: transparent;
        border: none;
        color: #e0e6f0;
        font-size: 24px;
        cursor: pointer;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background 0.2s;
      " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">×</button>
      
      <h3 style="margin: 0 0 20px 0; color: #5a9fd4; padding-right: 30px;"><svg class="icon" aria-hidden="true"><use href="#icon-compare"></use></svg> ${data1.user.username} vs ${data2.user.username}</h3>
      
      <div style="color: #e0e6f0;">
        <h4 style="color: #5a9fd4; margin-bottom: 15px;"><svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Статистика профиля</h4>
        <div style="background: #2a3a4a; padding: 15px; border-radius: 8px;">
          ${stats.map(stat => {
            const val1 = data1.stats[stat.key] || 0;
            const val2 = data2.stats[stat.key] || 0;
            const isDiff = val1 !== val2;
            const winner = stat.better === 'higher' ? (val1 > val2 ? 1 : val1 < val2 ? 2 : 0) :
                          stat.better === 'lower' ? (val1 < val2 ? 1 : val1 > val2 ? 2 : 0) : 0;

            return `
              <div style="
                display: grid;
                grid-template-columns: 1fr auto auto;
                gap: 15px;
                padding: 10px 0;
                border-bottom: 1px solid #1e2a3a;
                align-items: center;
              ">
                <div style="font-weight: ${isDiff ? 'bold' : 'normal'}; color: ${isDiff ? '#ff9800' : '#e0e6f0'};">
                  ${stat.label}
                </div>
                <div style="
                  text-align: center;
                  padding: 5px 15px;
                  background: ${winner === 1 ? '#4caf50' : '#1e2a3a'};
                  border-radius: 6px;
                  font-weight: ${winner === 1 ? 'bold' : 'normal'};
                  min-width: 60px;
                ">
                  ${val1}${stat.suffix || ''}
                </div>
                <div style="
                  text-align: center;
                  padding: 5px 15px;
                  background: ${winner === 2 ? '#4caf50' : '#1e2a3a'};
                  border-radius: 6px;
                  font-weight: ${winner === 2 ? 'bold' : 'normal'};
                  min-width: 60px;
                ">
                  ${val2}${stat.suffix || ''}
                </div>
              </div>
            `;
          }).join('')}
          
          <div style="
            display: grid;
            grid-template-columns: 1fr auto auto;
            gap: 15px;
            padding-top: 10px;
            align-items: center;
            font-size: 0.9em;
            color: #999;
          ">
            <div></div>
            <div style="text-align: center; min-width: 60px;">${data1.user.username}</div>
            <div style="text-align: center; min-width: 60px;">${data2.user.username}</div>
          </div>
        </div>
        
        ${data1.awards.length > 0 || data2.awards.length > 0 ? `
          <h4 style="color: #5a9fd4; margin: 20px 0 15px 0;"><svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> Награды</h4>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
            <div style="background: #2a3a4a; padding: 15px; border-radius: 8px;">
              <div style="color: #5a9fd4; font-weight: bold; margin-bottom: 10px;">${data1.user.username}</div>
              ${data1.awards.length > 0 ? data1.awards.map(award => `
                <div style="
                  background: #1e2a3a;
                  padding: 10px;
                  border-radius: 6px;
                  margin-bottom: 8px;
                  display: flex;
                  align-items: center;
                  gap: 10px;
                ">
                  ${award.event_icon ? (award.event_icon.startsWith('img/') || award.event_icon.startsWith('/img/') ?
                    `<img src="${award.event_icon.startsWith('/') ? award.event_icon : '/' + award.event_icon}" style="width: 30px; height: 30px; object-fit: contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';" /><span style="display: none; font-size: 1.5em;"><svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg></span>` :
                    `<span style="font-size: 1.5em;">${award.event_icon}</span>`) : '<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg>'}
                  <div style="flex: 1;">
                    <div style="font-weight: bold; font-size: 0.9em;">${award.event_name}</div>
                    <div style="color: #999; font-size: 0.85em;">${award.won_bets} очков</div>
                  </div>
                </div>
              `).join('') : '<div style="color: #999; text-align: center; padding: 20px;">Нет наград</div>'}
            </div>
            <div style="background: #2a3a4a; padding: 15px; border-radius: 8px;">
              <div style="color: #5a9fd4; font-weight: bold; margin-bottom: 10px;">${data2.user.username}</div>
              ${data2.awards.length > 0 ? data2.awards.map(award => `
                <div style="
                  background: #1e2a3a;
                  padding: 10px;
                  border-radius: 6px;
                  margin-bottom: 8px;
                  display: flex;
                  align-items: center;
                  gap: 10px;
                ">
                  ${award.event_icon ? (award.event_icon.startsWith('img/') || award.event_icon.startsWith('/img/') ?
                    `<img src="${award.event_icon.startsWith('/') ? award.event_icon : '/' + award.event_icon}" style="width: 30px; height: 30px; object-fit: contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';" /><span style="display: none; font-size: 1.5em;"><svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg></span>` :
                    `<span style="font-size: 1.5em;">${award.event_icon}</span>`) : '<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg>'}
                  <div style="flex: 1;">
                    <div style="font-weight: bold; font-size: 0.9em;">${award.event_name}</div>
                    <div style="color: #999; font-size: 0.85em;">${award.won_bets} очков</div>
                  </div>
                </div>
              `).join('') : '<div style="color: #999; text-align: center; padding: 20px;">Нет наград</div>'}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

// Закрыть модалку глобального сравнения
export function closeGlobalComparisonModal() {
  const modal = document.querySelector('.global-comparison-modal');
  if (modal) {
    modal.remove();
    document.body.style.overflow = '';
  }
}
