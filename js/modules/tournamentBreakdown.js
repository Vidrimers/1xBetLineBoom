// ========== МОДУЛЬ TOURNAMENT BREAKDOWN ==========
// Разбивка очков турнира по категориям

import { showCustomAlert } from './ui.js';

const CATEGORIES = [
  { key: 'result_pts', label: 'Результат', default: true },
  { key: 'exact_score_pts', label: 'Точный счет', default: true },
  { key: 'diff_goals_pts', label: 'Разница голов', default: true },
  { key: 'yellow_cards_pts', label: 'Желтые карточки', default: true },
  { key: 'red_cards_pts', label: 'Красные карточки', default: true },
  { key: 'final_bets_pts', label: 'Финальные ставки', default: true },
  { key: 'bracket_pts', label: 'Сетка', default: true }
];

let currentBreakdownData = null;

export async function openTournamentBreakdownModal() {
  const modal = document.createElement('div');
  modal.id = 'tournamentBreakdownModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;';

  modal.innerHTML = `
    <div style="background:#1e2a3a;padding:30px;border-radius:12px;max-width:1100px;width:95%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="margin:0;color:#5a9fd4;"><svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Разбивка турнира</h3>
        <button onclick="closeTournamentBreakdownModal()" style="background:none;border:none;color:#888;font-size:1.5em;cursor:pointer;padding:0 5px;">&times;</button>
      </div>

      <div style="display:flex;gap:15px;margin-bottom:20px;flex-wrap:wrap;align-items:flex-end;">
        <div style="flex:1;min-width:200px;">
          <label style="color:#b0b8c8;font-size:0.9em;display:block;margin-bottom:5px;">Турнир</label>
          <select id="breakdownTournamentSelect" style="width:100%;padding:10px;background:#2a3a4a;color:#e0e6f0;border:1px solid rgba(90,159,212,0.3);border-radius:6px;font-size:0.95em;">
            <option value="">Загрузка...</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${CATEGORIES.map(cat => `
            <label style="display:flex;align-items:center;gap:5px;padding:6px 10px;background:rgba(90,159,212,0.1);border:1px solid rgba(90,159,212,0.3);border-radius:6px;cursor:pointer;font-size:0.85em;color:#b0b8c8;white-space:nowrap;">
              <input type="checkbox" class="breakdown-cat-checkbox" value="${cat.key}" ${cat.default ? 'checked' : ''} style="cursor:pointer;">
              ${cat.label}
            </label>
          `).join('')}
          <label style="display:flex;align-items:center;gap:5px;padding:6px 10px;background:rgba(76,175,80,0.1);border:1px solid rgba(76,175,80,0.3);border-radius:6px;cursor:pointer;font-size:0.85em;color:#c8e6c9;white-space:nowrap;">
            <input type="checkbox" id="breakdownShowObservations" checked style="cursor:pointer;">
            Наблюдения
          </label>
        </div>
        <button id="breakdownCalcBtn" onclick="calculateBreakdown()" style="padding:10px 20px;background:#5a9fd4;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.95em;white-space:nowrap;">Рассчитать</button>
      </div>

      <div id="breakdownResults" style="flex:1;overflow:auto;min-height:100px;">
        <div style="color:#888;text-align:center;padding:40px;">Выберите турнир и нажмите "Рассчитать"</div>
      </div>

      <div style="display:flex;gap:10px;margin-top:15px;justify-content:flex-end;">
        <button id="breakdownExportJpg" onclick="exportBreakdownJpg()" style="display:none;padding:10px 20px;background:#4caf50;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.95em;">💾 JPG</button>
        <button id="breakdownExportMd" onclick="exportBreakdownMd()" style="display:none;padding:10px 20px;background:#2196f3;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.95em;">📄 .md</button>
        <button onclick="closeTournamentBreakdownModal()" style="padding:10px 20px;background:#607d8b;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.95em;">Закрыть</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  await loadTournamentsForBreakdown();
}

export function closeTournamentBreakdownModal() {
  const modal = document.getElementById('tournamentBreakdownModal');
  if (modal) modal.remove();
  currentBreakdownData = null;
}

async function loadTournamentsForBreakdown() {
  const select = document.getElementById('breakdownTournamentSelect');
  if (!select) return;

  try {
    const response = await fetch('/api/events');
    if (!response.ok) throw new Error('Ошибка загрузки турниров');
    const events = await response.json();

    select.innerHTML = '<option value="">-- Выберите турнир --</option>' +
      events.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  } catch (error) {
    select.innerHTML = '<option value="">Ошибка загрузки</option>';
    console.error('Ошибка загрузки турниров:', error);
  }
}

export async function calculateBreakdown() {
  const select = document.getElementById('breakdownTournamentSelect');
  const container = document.getElementById('breakdownResults');
  const calcBtn = document.getElementById('breakdownCalcBtn');
  if (!select || !container) return;

  const eventId = select.value;
  if (!eventId) {
    await showCustomAlert('Выберите турнир', 'Внимание', '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  calcBtn.disabled = true;
  calcBtn.textContent = 'Загрузка...';
  container.innerHTML = '<div style="color:#888;text-align:center;padding:40px;">Подсчет очков...</div>';

  try {
    const response = await fetch(`/api/admin/tournament-breakdown?eventId=${eventId}`);
    if (!response.ok) throw new Error('Ошибка загрузки данных');
    const data = await response.json();

    currentBreakdownData = data;
    renderBreakdownTable(data);

    document.getElementById('breakdownExportJpg').style.display = 'inline-block';
    document.getElementById('breakdownExportMd').style.display = 'inline-block';
  } catch (error) {
    container.innerHTML = `<div style="color:#f44336;text-align:center;padding:20px;">Ошибка: ${error.message}</div>`;
    console.error('Ошибка подсчета:', error);
  } finally {
    calcBtn.disabled = false;
    calcBtn.textContent = 'Рассчитать';
  }
}

function renderBreakdownTable(data) {
  const container = document.getElementById('breakdownResults');
  if (!container) return;

  const enabledCategories = Array.from(document.querySelectorAll('.breakdown-cat-checkbox:checked')).map(cb => cb.value);
  const showObservations = document.getElementById('breakdownShowObservations')?.checked;

  let html = `
    <div id="breakdownTableContainer" style="background:#1a2332;border-radius:8px;padding:15px;border:1px solid rgba(90,159,212,0.2);">
      <div style="color:#5a9fd4;font-size:1.1em;font-weight:600;margin-bottom:5px;">${data.tournament.name}</div>
      <div style="color:#888;font-size:0.85em;margin-bottom:15px;">Матчей: ${data.matches.total} (завершено: ${data.matches.completed})</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.9em;">
          <thead>
            <tr style="border-bottom:2px solid rgba(90,159,212,0.3);">
              <th style="padding:10px 8px;text-align:left;color:#5a9fd4;white-space:nowrap;">#</th>
              <th style="padding:10px 8px;text-align:left;color:#5a9fd4;white-space:nowrap;">Игрок</th>
              ${enabledCategories.map(key => {
                const cat = CATEGORIES.find(c => c.key === key);
                return '<th style="padding:10px 8px;text-align:center;color:#5a9fd4;white-space:nowrap;">' + cat.label + '</th>';
              }).join('')}
              <th style="padding:10px 8px;text-align:center;color:#4caf50;font-weight:700;white-space:nowrap;">Итого</th>
            </tr>
          </thead>
          <tbody>
            ${data.users.map((user, idx) => `
              <tr style="border-bottom:1px solid rgba(90,159,212,0.1);${idx % 2 === 0 ? 'background:rgba(90,159,212,0.05);' : ''}">
                <td style="padding:10px 8px;color:#888;">${idx + 1}</td>
                <td style="padding:10px 8px;color:#e0e6f0;font-weight:500;white-space:nowrap;">${user.username}</td>
                ${enabledCategories.map(key => {
                  const val = user[key] || 0;
                  return '<td style="padding:10px 8px;text-align:center;color:' + (val > 0 ? '#e0e6f0' : '#555') + ';">' + val + '</td>';
                }).join('')}
                <td style="padding:10px 8px;text-align:center;color:#4caf50;font-weight:700;">${user.total_points}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
  `;

  if (showObservations && data.users.length > 0) {
    const observations = generateObservations(data, enabledCategories);
    if (observations.length > 0) {
      html += `
        <div style="margin-top:15px;padding:15px;background:rgba(90,159,212,0.1);border-radius:8px;border:1px solid rgba(90,159,212,0.2);">
          <div style="color:#5a9fd4;font-weight:600;margin-bottom:10px;">Наблюдения</div>
          <ul style="margin:0;padding-left:20px;color:#b0b8c8;line-height:1.8;">
            ${observations.map(obs => '<li>' + obs + '</li>').join('')}
          </ul>
        </div>
      `;
    }
  }

  html += '</div>';
  container.innerHTML = html;
}

function generateObservations(data, enabledCategories) {
  const obs = [];
  const users = data.users;
  if (users.length === 0) return obs;

  const leader = users[0];
  if (users.length > 1) {
    const gap = leader.total_points - users[1].total_points;
    obs.push('<b>' + leader.username + '</b> лидирует с <b>' + leader.total_points + '</b> очками, опережая <b>' + users[1].username + '</b> на <b>' + gap + '</b> очков.');
  }

  const categoryLeaders = {};
  for (const key of enabledCategories) {
    let maxVal = 0;
    let maxUser = '';
    for (const user of users) {
      const val = user[key] || 0;
      if (val > maxVal) {
        maxVal = val;
        maxUser = user.username;
      }
    }
    if (maxVal > 0) {
      const cat = CATEGORIES.find(c => c.key === key);
      categoryLeaders[key] = { user: maxUser, value: maxVal, label: cat.label };
      obs.push('Лучший по "' + cat.label + '": <b>' + maxUser + '</b> (' + maxVal + ' очков).');
    }
  }

  const minUser = users[users.length - 1];
  if (users.length > 1 && minUser.total_points < leader.total_points) {
    obs.push('<b>' + minUser.username + '</b> замыкает таблицу с <b>' + minUser.total_points + '</b> очками.');
  }

  for (const key of enabledCategories) {
    const zeroUsers = users.filter(u => (u[key] || 0) === 0);
    if (zeroUsers.length > 0 && zeroUsers.length < users.length) {
      const cat = CATEGORIES.find(c => c.key === key);
      obs.push('Ноль очков за "' + cat.label + '": ' + zeroUsers.map(u => '<b>' + u.username + '</b>').join(', ') + '.');
    }
  }

  return obs;
}

export function exportBreakdownJpg() {
  if (!currentBreakdownData) return;

  const tableContainer = document.getElementById('breakdownTableContainer');
  if (!tableContainer) return;

  if (typeof html2canvas === 'undefined') {
    showCustomAlert('Библиотека html2canvas не загружена', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  html2canvas(tableContainer, {
    backgroundColor: '#1a2332',
    scale: 2
  }).then(canvas => {
    const link = document.createElement('a');
    link.download = 'tournament_breakdown_' + currentBreakdownData.tournament.id + '.jpg';
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
  }).catch(err => {
    console.error('Ошибка экспорта JPG:', err);
    showCustomAlert('Ошибка экспорта: ' + err.message, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  });
}

export function exportBreakdownMd() {
  if (!currentBreakdownData) return;

  const data = currentBreakdownData;
  const enabledCategories = Array.from(document.querySelectorAll('.breakdown-cat-checkbox:checked')).map(cb => cb.value);

  let md = '# Разбивка турнира: ' + data.tournament.name + '\n\n';
  md += 'Матчей: ' + data.matches.total + ' (завершено: ' + data.matches.completed + ')\n\n';

  const headers = ['#', 'Игрок'];
  for (const key of enabledCategories) {
    const cat = CATEGORIES.find(c => c.key === key);
    headers.push(cat.label);
  }
  headers.push('Итого');

  md += '| ' + headers.join(' | ') + ' |\n';
  md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';

  data.users.forEach((user, idx) => {
    const row = [String(idx + 1), user.username];
    for (const key of enabledCategories) {
      row.push(String(user[key] || 0));
    }
    row.push(String(user.total_points));
    md += '| ' + row.join(' | ') + ' |\n';
  });

  const blob = new Blob([md], { type: 'text/markdown' });
  const link = document.createElement('a');
  link.download = 'tournament_breakdown_' + data.tournament.id + '.md';
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}
