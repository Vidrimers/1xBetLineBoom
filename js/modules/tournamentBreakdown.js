// ========== МОДУЛЬ TOURNAMENT BREAKDOWN ==========
// Разбивка очков турнира по категориям

import { showCustomAlert, showCustomConfirm } from './ui.js';

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

function getAdjustedTotal(user, enabledCategories) {
  const disabledKeys = CATEGORIES.filter(c => !enabledCategories.includes(c.key)).map(c => c.key);
  const disabledSum = disabledKeys.reduce((sum, key) => sum + (user[key] || 0), 0);
  return user.total_points - disabledSum;
}

export async function openTournamentBreakdownModal(isAdmin = true) {
  const modal = document.createElement('div');
  modal.id = 'tournamentBreakdownModal';
  modal.className = 'modal';
  modal.style.cssText = 'display:flex;';

  modal.innerHTML = `
    <div class="modal-content" style="max-width:1300px;width:95%;max-height:90vh;display:flex;flex-direction:column;padding:30px;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="margin:0;color:var(--text-primary, #5a9fd4);"><svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Статистика турниров</h3>
        <button onclick="closeTournamentBreakdownModal()" style="background:none;border:none;color:var(--text-muted, #888);font-size:1.5em;cursor:pointer;padding:0 5px;">&times;</button>
      </div>

      <div style="margin-bottom:20px;">
        <div style="display:flex;gap:15px;align-items:flex-end;margin-bottom:12px;">
          <div style="flex:1;min-width:200px;">
            <label style="color:var(--text-secondary, #b0b8c8);font-size:0.9em;display:block;margin-bottom:5px;">Турнир</label>
            <select id="breakdownTournamentSelect" style="width:100%;padding:10px;background:var(--input-bg, #2a3a4a);color:var(--text-primary, #e0e6f0);border:1px solid rgba(90,159,212,0.3);border-radius:6px;font-size:0.95em;">
              <option value="">Загрузка...</option>
            </select>
          </div>
          <button id="breakdownCalcBtn" onclick="calculateBreakdown()" style="padding:10px 20px;background:#5a9fd4;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.95em;white-space:nowrap;">Рассчитать</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${CATEGORIES.map(cat => `
            <label style="display:flex;align-items:center;gap:5px;padding:6px 10px;background:rgba(90,159,212,0.1);border:1px solid rgba(90,159,212,0.3);border-radius:6px;cursor:pointer;font-size:0.85em;color:var(--text-secondary, #b0b8c8);white-space:nowrap;">
              <input type="checkbox" class="breakdown-cat-checkbox" value="${cat.key}" ${cat.default ? 'checked' : ''} style="cursor:pointer;">
              ${cat.label}
            </label>
          `).join('')}
          <label style="display:flex;align-items:center;gap:5px;padding:6px 10px;background:rgba(76,175,80,0.1);border:1px solid rgba(76,175,80,0.3);border-radius:6px;cursor:pointer;font-size:0.85em;color:var(--accent, #c8e6c9);white-space:nowrap;">
            <input type="checkbox" id="breakdownShowObservations" checked style="cursor:pointer;">
            Наблюдения
          </label>
        </div>
      </div>

      <div id="breakdownResults" style="flex:1;overflow:auto;min-height:100px;">
        <div style="color:#888;text-align:center;padding:40px;">Выберите турнир и нажмите "Рассчитать"</div>
      </div>

      <div style="display:flex;gap:10px;margin-top:15px;justify-content:flex-end;flex-wrap:wrap;">
        ${isAdmin ? `
        <div style="position:relative;display:none;" id="breakdownSendWrapper">
          <button id="breakdownSendBtn" onclick="toggleBreakdownSendMenu()" style="padding:10px 20px;background:#ff9800;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.95em;">📤 Отправить ▾</button>
          <div id="breakdownSendMenu" style="display:none;position:absolute;bottom:100%;right:0;margin-bottom:5px;background:rgba(40,44,54,0.98);border:1px solid rgba(90,159,212,0.3);border-radius:8px;overflow:hidden;z-index:10;min-width:200px;box-shadow:0 4px 12px rgba(0,0,0,0.4);">
            <button onclick="sendBreakdownTo('group')" style="display:block;width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e6f0;cursor:pointer;text-align:left;font-size:0.9em;">📤 В группу</button>
            <button onclick="sendBreakdownTo('all')" style="display:block;width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e6f0;cursor:pointer;text-align:left;font-size:0.9em;border-top:1px solid rgba(90,159,212,0.2);">📤 Всем участникам</button>
            <button onclick="sendBreakdownTo('self')" style="display:block;width:100%;padding:10px 16px;background:transparent;border:none;color:#e0e6f0;cursor:pointer;text-align:left;font-size:0.9em;border-top:1px solid rgba(90,159,212,0.2);">📤 Себе</button>
          </div>
        </div>
        ` : ''}
        <button id="breakdownExportJpg" onclick="exportBreakdownJpg()" style="display:none;padding:10px 20px;background:#4caf50;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.95em;">💾 JPG</button>
        <button id="breakdownExportMd" onclick="exportBreakdownMd()" style="display:none;padding:10px 20px;background:#2196f3;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.95em;">📄 .md</button>
        <button onclick="closeTournamentBreakdownModal()" style="padding:10px 20px;background:#607d8b;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.95em;">Закрыть</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  // Close dropdown when clicking outside, close modal when clicking on overlay
  modal.addEventListener('click', (e) => {
    const menu = document.getElementById('breakdownSendMenu');
    const btn = document.getElementById('breakdownSendBtn');
    if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
      menu.style.display = 'none';
    }
    if (e.target === modal) {
      closeTournamentBreakdownModal();
    }
  });

  await loadTournamentsForBreakdown();

  modal.querySelectorAll('.breakdown-cat-checkbox, #breakdownShowObservations').forEach(cb => {
    cb.addEventListener('change', () => {
      if (currentBreakdownData) renderBreakdownTable(currentBreakdownData);
    });
  });
}

export function closeTournamentBreakdownModal() {
  const modal = document.getElementById('tournamentBreakdownModal');
  if (modal) modal.remove();
  document.body.style.overflow = '';
  currentBreakdownData = null;
}

export async function openPublicTournamentBreakdownModal() {
  return openTournamentBreakdownModal(false);
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

    document.getElementById('breakdownSendWrapper').style.display = 'block';
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

  const sortedUsers = [...data.users].sort((a, b) => getAdjustedTotal(b, enabledCategories) - getAdjustedTotal(a, enabledCategories));

  container.style.opacity = '0';
  container.style.transition = 'opacity 0.15s ease';

  setTimeout(() => {
  let html = `
    <div id="breakdownTableContainer" style="border-radius:8px;padding:15px;border:1px solid rgba(90,159,212,0.2);">
      <div style="color:var(--text-primary, #5a9fd4);font-size:1.1em;font-weight:600;margin-bottom:5px;">${data.tournament.name}</div>
      <div style="color:var(--text-muted, #888);font-size:0.85em;margin-bottom:15px;">Матчей: ${data.matches.total} (завершено: ${data.matches.completed})</div>
      <div>
        <table style="border-collapse:collapse;font-size:0.9em;">
          <thead>
            <tr style="border-bottom:2px solid rgba(90,159,212,0.3);">
              <th style="padding:10px 12px;text-align:center;color:var(--text-primary, #5a9fd4);">#</th>
              <th style="padding:10px 12px;text-align:left;color:var(--text-primary, #5a9fd4);">Игрок</th>
              ${enabledCategories.map(key => {
                const cat = CATEGORIES.find(c => c.key === key);
                return '<th style="padding:10px 12px;text-align:center;color:var(--text-primary, #5a9fd4);">' + cat.label + '</th>';
              }).join('')}
              <th style="padding:10px 12px;text-align:center;color:var(--accent, #4caf50);font-weight:700;">Итого</th>
            </tr>
          </thead>
          <tbody>
            ${sortedUsers.map((user, idx) => `
              <tr style="border-bottom:1px solid rgba(90,159,212,0.1);${idx % 2 === 0 ? 'background:rgba(90,159,212,0.05);' : ''}">
                <td style="padding:10px 12px;text-align:center;color:var(--text-muted, #888);">${idx + 1}</td>
                <td style="padding:10px 12px;color:var(--text-primary, #e0e6f0);font-weight:500;">${user.username}</td>
                ${enabledCategories.map(key => {
                  const val = user[key] || 0;
                  return '<td style="padding:10px 12px;text-align:center;color:' + (val > 0 ? 'var(--text-primary, #e0e6f0)' : 'var(--text-muted, #555)') + ';">' + val + '</td>';
                }).join('')}
                <td style="padding:10px 12px;text-align:center;color:var(--accent, #4caf50);font-weight:700;">${getAdjustedTotal(user, enabledCategories)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
  `;

  if (showObservations && sortedUsers.length > 0) {
    const sortedData = { ...data, users: sortedUsers };
    const observations = generateObservations(sortedData, enabledCategories);
    if (observations.length > 0) {
      html += `
        <div style="margin-top:15px;padding:15px;background:rgba(90,159,212,0.1);border-radius:8px;border:1px solid rgba(90,159,212,0.2);">
          <div style="color:var(--text-primary, #5a9fd4);font-weight:600;margin-bottom:10px;">Наблюдения</div>
          <ul style="margin:0;padding-left:20px;color:var(--text-secondary, #b0b8c8);line-height:1.8;">
            ${observations.map(obs => '<li>' + obs + '</li>').join('')}
          </ul>
        </div>
      `;
    }
  }

  html += '</div>';
  container.innerHTML = html;
  container.style.opacity = '1';
  }, 150);
}

function generateObservations(data, enabledCategories) {
  const obs = [];
  const users = data.users;
  if (users.length === 0) return obs;

  const leader = users[0];
  const leaderTotal = getAdjustedTotal(leader, enabledCategories);
  if (users.length > 1) {
    const secondTotal = getAdjustedTotal(users[1], enabledCategories);
    const gap = leaderTotal - secondTotal;
    obs.push('<b>' + leader.username + '</b> лидирует с <b>' + leaderTotal + '</b> очками, опережая <b>' + users[1].username + '</b> на <b>' + gap + '</b> очков.');
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
  const minTotal = getAdjustedTotal(minUser, enabledCategories);
  if (users.length > 1 && minTotal < leaderTotal) {
    obs.push('<b>' + minUser.username + '</b> замыкает таблицу с <b>' + minTotal + '</b> очками.');
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

  // Build a standalone render container with inline-resolved styles
  const data = currentBreakdownData;
  const enabledCategories = Array.from(document.querySelectorAll('.breakdown-cat-checkbox:checked')).map(cb => cb.value);
  const showObservations = document.getElementById('breakdownShowObservations')?.checked;

  // Get actual computed colors from the visible table
  const cs = window.getComputedStyle(tableContainer);
  const bgColor = cs.backgroundColor;
  const textColor = cs.color;

  let renderHtml = `
    <div style="background:${bgColor};color:${textColor};padding:20px;font-family:'Segoe UI',Tahoma,sans-serif;white-space:nowrap;">
      <div style="font-size:18px;font-weight:600;margin-bottom:5px;">${data.tournament.name}</div>
      <div style="font-size:13px;opacity:0.7;margin-bottom:15px;">Матчей: ${data.matches.total} (завершено: ${data.matches.completed})</div>
      <table style="border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="border-bottom:2px solid rgba(90,159,212,0.3);">
            <th style="padding:10px 14px;text-align:center;">#</th>
            <th style="padding:10px 14px;text-align:left;">Игрок</th>
            ${enabledCategories.map(key => {
              const cat = CATEGORIES.find(c => c.key === key);
              return '<th style="padding:10px 14px;text-align:center;">' + cat.label + '</th>';
            }).join('')}
            <th style="padding:10px 14px;text-align:center;font-weight:700;">Итого</th>
          </tr>
        </thead>
        <tbody>
          ${data.users.map((user, idx) => `
            <tr style="border-bottom:1px solid rgba(90,159,212,0.1);${idx % 2 === 0 ? 'background:rgba(90,159,212,0.05);' : ''}">
              <td style="padding:10px 14px;text-align:center;opacity:0.5;">${idx + 1}</td>
              <td style="padding:10px 14px;font-weight:500;">${user.username}</td>
              ${enabledCategories.map(key => {
                const val = user[key] || 0;
                return '<td style="padding:10px 14px;text-align:center;' + (val === 0 ? 'opacity:0.3;' : '') + '">' + val + '</td>';
              }).join('')}
              <td style="padding:10px 14px;text-align:center;font-weight:700;">${getAdjustedTotal(user, enabledCategories)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
  `;

  if (showObservations && data.users.length > 0) {
    const observations = generateObservations(data, enabledCategories);
    if (observations.length > 0) {
      renderHtml += `
        <div style="margin-top:15px;padding:15px;background:rgba(90,159,212,0.1);border-radius:8px;border:1px solid rgba(90,159,212,0.2);">
          <div style="font-weight:600;margin-bottom:10px;">Наблюдения</div>
          <ul style="margin:0;padding-left:20px;line-height:1.8;">
            ${observations.map(obs => '<li>' + obs.replace(/<[^>]+>/g, '') + '</li>').join('')}
          </ul>
        </div>
      `;
    }
  }

  renderHtml += '</div>';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;opacity:1;';
  wrapper.innerHTML = renderHtml;
  document.body.appendChild(wrapper);
  const renderTarget = wrapper.firstElementChild;

  html2canvas(renderTarget, {
    scale: 2,
    useCORS: true,
    logging: false
  }).then(canvas => {
    document.body.removeChild(wrapper);
    const link = document.createElement('a');
    link.download = 'tournament_breakdown_' + data.tournament.id + '.jpg';
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
  }).catch(err => {
    document.body.removeChild(wrapper);
    console.error('Ошибка экспорта JPG:', err);
    showCustomAlert('Ошибка экспорта: ' + err.message, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  });
}

export function exportBreakdownMd() {
  if (!currentBreakdownData) return;

  const data = currentBreakdownData;
  const enabledCategories = Array.from(document.querySelectorAll('.breakdown-cat-checkbox:checked')).map(cb => cb.value);
  const showObservations = document.getElementById('breakdownShowObservations')?.checked;

  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU');

  let md = '# Статистика турниров: ' + data.tournament.name + '\n\n';
  md += '> Дата отчёта: ' + dateStr + '\n';
  md += '> Матчей: ' + data.matches.total + ' (завершено: ' + data.matches.completed + ')\n\n';

  // Table
  const headers = ['#', 'Игрок'];
  for (const key of enabledCategories) {
    const cat = CATEGORIES.find(c => c.key === key);
    headers.push(cat.label);
  }
  headers.push('**Итого**');

  md += '| ' + headers.join(' | ') + ' |\n';
  md += '| ' + headers.map((_, i) => i === 0 ? '---' : ':---:').join(' | ') + ' |\n';

  data.users.forEach((user, idx) => {
    const row = [String(idx + 1), user.username];
    for (const key of enabledCategories) {
      const val = user[key] || 0;
      row.push(val === 0 ? '—' : String(val));
    }
    row.push('**' + getAdjustedTotal(user, enabledCategories) + '**');
    md += '| ' + row.join(' | ') + ' |\n';
  });

  // Summary
  if (data.users.length > 0) {
    const leaderTotal = getAdjustedTotal(data.users[0], enabledCategories);
    md += '\n---\n\n## Сводка\n\n';
    md += '- **Лидер:** ' + data.users[0].username + ' — ' + leaderTotal + ' очков\n';
    if (data.users.length > 1) {
      const secondTotal = getAdjustedTotal(data.users[1], enabledCategories);
      const gap = leaderTotal - secondTotal;
      md += '- **Отрыв от 2-го места:** ' + gap + ' очков\n';
    }
    if (data.users.length > 2) {
      const leaderCount = data.users.filter(u => getAdjustedTotal(u, enabledCategories) === leaderTotal).length;
      if (leaderCount > 1) {
        md += '- **Лидеров с одинаковым счётом:** ' + leaderCount + '\n';
      }
    }
  }

  // Category leaders
  if (enabledCategories.length > 0) {
    md += '\n## Лидеры по категориям\n\n';
    for (const key of enabledCategories) {
      const cat = CATEGORIES.find(c => c.key === key);
      let maxVal = 0;
      let maxUsers = [];
      for (const user of data.users) {
        const val = user[key] || 0;
        if (val > maxVal) {
          maxVal = val;
          maxUsers = [user.username];
        } else if (val === maxVal && val > 0) {
          maxUsers.push(user.username);
        }
      }
      if (maxVal > 0) {
        md += '- **' + cat.label + ':** ' + maxUsers.join(', ') + ' (' + maxVal + ')\n';
      }
    }
  }

  // Observations
  if (showObservations && data.users.length > 0) {
    const observations = generateObservations(data, enabledCategories);
    if (observations.length > 0) {
      md += '\n## Наблюдения\n\n';
      for (const obs of observations) {
        const plain = obs.replace(/<[^>]+>/g, '');
        md += '- ' + plain + '\n';
      }
    }
  }

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a');
  link.download = 'tournament_breakdown_' + data.tournament.id + '.md';
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

// ===== ОТПРАВКА В TG =====

export function toggleBreakdownSendMenu() {
  const menu = document.getElementById('breakdownSendMenu');
  if (menu) {
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }
}

export async function sendBreakdownTo(target) {
  const menu = document.getElementById('breakdownSendMenu');
  if (menu) menu.style.display = 'none';

  if (!currentBreakdownData) {
    await showCustomAlert('Сначала рассчитайте разбивку', 'Внимание', '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  const targetLabels = {
    group: 'в группу',
    all: 'всем участникам турнира',
    self: 'себе (админу)'
  };

  const confirmed = await showCustomConfirm(
    `Отправить разбивку турнира "${currentBreakdownData.tournament.name}" ${targetLabels[target]}?`,
    'Подтверждение отправки',
    '<svg class="icon" aria-hidden="true"><use href="#icon-telegram"></use></svg>'
  );

  if (!confirmed) return;

  try {
    // Генерируем JPG в base64
    const tableContainer = document.getElementById('breakdownTableContainer');
    if (!tableContainer) return;

    // Build render HTML for export
    const data = currentBreakdownData;
    const enabledCategories = Array.from(document.querySelectorAll('.breakdown-cat-checkbox:checked')).map(cb => cb.value);
    const cs = window.getComputedStyle(tableContainer);
    const bgColor = cs.backgroundColor;
    const textColor = cs.color;

    let renderHtml = `
      <div style="background:${bgColor};color:${textColor};padding:20px;font-family:'Segoe UI',Tahoma,sans-serif;white-space:nowrap;">
        <div style="font-size:18px;font-weight:600;margin-bottom:5px;">${data.tournament.name}</div>
        <div style="font-size:13px;opacity:0.7;margin-bottom:15px;">Матчей: ${data.matches.total} (завершено: ${data.matches.completed})</div>
        <table style="border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="border-bottom:2px solid rgba(90,159,212,0.3);">
              <th style="padding:10px 14px;text-align:center;">#</th>
              <th style="padding:10px 14px;text-align:left;">Игрок</th>
              ${enabledCategories.map(key => {
                const cat = CATEGORIES.find(c => c.key === key);
                return '<th style="padding:10px 14px;text-align:center;">' + cat.label + '</th>';
              }).join('')}
              <th style="padding:10px 14px;text-align:center;font-weight:700;">Итого</th>
            </tr>
          </thead>
          <tbody>
            ${data.users.map((user, idx) => `
              <tr style="border-bottom:1px solid rgba(90,159,212,0.1);${idx % 2 === 0 ? 'background:rgba(90,159,212,0.05);' : ''}">
                <td style="padding:10px 14px;text-align:center;opacity:0.5;">${idx + 1}</td>
                <td style="padding:10px 14px;font-weight:500;">${user.username}</td>
                ${enabledCategories.map(key => {
                  const val = user[key] || 0;
                  return '<td style="padding:10px 14px;text-align:center;' + (val === 0 ? 'opacity:0.3;' : '') + '">' + val + '</td>';
                }).join('')}
                <td style="padding:10px 14px;text-align:center;font-weight:700;">${getAdjustedTotal(user, enabledCategories)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
    `;

    if (document.getElementById('breakdownShowObservations')?.checked && data.users.length > 0) {
      const observations = generateObservations(data, enabledCategories);
      if (observations.length > 0) {
        renderHtml += `
          <div style="margin-top:15px;padding:15px;background:rgba(90,159,212,0.1);border-radius:8px;border:1px solid rgba(90,159,212,0.2);">
            <div style="font-weight:600;margin-bottom:10px;">Наблюдения</div>
            <ul style="margin:0;padding-left:20px;line-height:1.8;">
              ${observations.map(obs => '<li>' + obs.replace(/<[^>]+>/g, '') + '</li>').join('')}
            </ul>
          </div>
        `;
      }
    }

    renderHtml += '</div>';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;opacity:1;';
    wrapper.innerHTML = renderHtml;
    document.body.appendChild(wrapper);
    const renderTarget = wrapper.firstElementChild;

    const canvas = await html2canvas(renderTarget, {
      scale: 2,
      useCORS: true,
      logging: false
    });

    document.body.removeChild(wrapper);

    const imageBase64 = canvas.toDataURL('image/jpeg', 0.95);

    const response = await fetch('/api/admin/send-breakdown-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64,
        eventId: data.tournament.id,
        target
      })
    });

    const result = await response.json();

    if (result.success) {
      await showCustomAlert(result.message, 'Отправлено', '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>');
    } else {
      await showCustomAlert(result.error || 'Ошибка отправки', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    }
  } catch (error) {
    console.error('Ошибка отправки:', error);
    await showCustomAlert('Ошибка: ' + error.message, 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}
