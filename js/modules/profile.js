import { currentUser } from './state.js';

// ===== ПРОФИЛЬ =====

export async function loadProfile() {
  if (!currentUser) {
    alert("Пожалуйста, сначала войдите в аккаунт");
    return;
  }

  try {
    const response = await fetch(`/api/user/${currentUser.id}/profile?viewerUsername=${encodeURIComponent(currentUser.username)}`);
    const profile = await response.json();
    displayProfile(profile);
  } catch (error) {
    console.error("Ошибка при загрузке профиля:", error);
    document.getElementById("profileContainer").innerHTML =
      '<div class="empty-message">Ошибка при загрузке профиля</div>';
  }
}

export function displayProfile(profile) {
  const profileContainer = document.getElementById("profileContainer");

  const createdDate = new Date(profile.created_at).toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Проверяем localStorage сначала для быстрой загрузки
  let avatarSrc = localStorage.getItem(`avatar_${profile.id}`);
  if (!avatarSrc) {
    // Если нет в localStorage, используем из профиля (с сервера)
    avatarSrc = profile.avatar || "img/default-avatar.jpg";
    // И сохраняем в localStorage для следующего раза
    if (profile.avatar) {
      localStorage.setItem(`avatar_${profile.id}`, profile.avatar);
    }
  }

  profileContainer.innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar-container" onclick="this.classList.toggle('flipped')" style="
        width: 100px;
        height: 100px;
        perspective: 1000px;
        cursor: pointer;
        margin: 0 auto;
      ">
        <div class="profile-avatar-flipper" style="
          position: relative;
          width: 100%;
          height: 100%;
          transition: transform 0.6s;
          transform-style: preserve-3d;
        ">
          <!-- Передняя сторона (аватарка) -->
          <div class="profile-avatar-front" style="
            position: absolute;
            width: 100%;
            height: 100%;
            backface-visibility: hidden;
            border-radius: 30%;
            overflow: hidden;
          ">
            <img src="${avatarSrc}" style="width: 100%; height: 100%; object-fit: cover;">
          </div>
          
          <!-- Задняя сторона (кнопка редактирования) -->
          <div class="profile-avatar-back" style="
            position: absolute;
            width: 100%;
            height: 100%;
            backface-visibility: hidden;
            transform: rotateY(180deg);
            background: url('img/default-avatar.jpg') center/cover;
            border-radius: 30%;
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <button id="avatarEditBtn" onclick="event.stopPropagation(); openAvatarModal()" style="
              background: rgba(44, 50, 63, 0.9);
              border: 2px solid white;
              color: white;
              width: 60px;
              height: 60px;
              border-radius: 50%;
              cursor: pointer;
              font-size: 27px;
              display: flex;
              justify-content: center;
              transition: all 0.3s ease;
              
            " onmouseover="this.style.background='rgba(255, 255, 255, 0.3)'; this.style.transform='scale(1.1)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.2)'; this.style.transform='scale(1)'">📷</button>
          </div>
        </div>
      </div>
      <div class="profile-username" onclick="editUsername()" onmouseover="document.getElementById('editUsernameBtn').style.display='inline'" onmouseout="document.getElementById('editUsernameBtn').style.display='none'" style="cursor: pointer;">
        <span id="usernameDisplay">${profile.username}</span>
        <button id="editUsernameBtn" onclick="event.stopPropagation(); editUsername()" style="
          background: transparent;
          color: #0088cc;
          border: none;
          padding: 0;
          cursor: pointer;
          font-size: .5em;
          transition: all 0.3s ease;
          display: none;
          box-shadow: none;
          position: absolute;
          bottom: 5px;
        " title="Изменить имя">✏️</button>
      </div>
      <div class="profile-member-since">Участник с ${createdDate}</div>
    </div>

    <div class="profile-stats-grid">
      <div class="stat-card">
        <div class="stat-label">Ставок за всё время</div>
        <div class="stat-value">${profile.total_bets}</div>
      </div>
      <div class="stat-card won">
        <div class="stat-label">✅ Угаданных ставок</div>
        <div class="stat-value">${profile.won_bets}</div>
      </div>
      <div class="stat-card" style="background: rgba(76, 175, 80, 0.15); border-left: 4px solid #4caf50; cursor: help;" title="${profile.max_win_streak_event ? `Турнир: ${profile.max_win_streak_event}` : 'Нет серии'}">
        <div class="stat-label">🔥 Угаданных подряд</div>
        <div class="stat-value" style="color: #4caf50;">${
          profile.max_win_streak || 0
        }</div>
      </div>
      <div class="stat-card lost">
        <div class="stat-label">❌ Неугаданных ставок</div>
        <div class="stat-value">${profile.lost_bets}</div>
      </div>
      <div class="stat-card pending">
        <div class="stat-label">⏳ В ожидании</div>
        <div class="stat-value">${profile.pending_bets}</div>
      </div>
      <div class="stat-card won" style="background: rgba(76, 175, 80, 0.15); border-left: 4px solid #4caf50;">
        <div class="stat-label">✅ Угаданных в сетке</div>
        <div class="stat-value">${profile.bracket_correct || 0}</div>
      </div>
      <div class="stat-card lost" style="background: rgba(244, 67, 54, 0.15); border-left: 4px solid #f44336;">
        <div class="stat-label">❌ Неугаданных в сетке</div>
        <div class="stat-value">${profile.bracket_incorrect || 0}</div>
      </div>
      <div class="stat-card" style="background: rgba(255, 152, 0, 0.15); border-left: 4px solid #ffc107;">
        <div class="stat-label">🏆 Побед в турнирах</div>
        <div class="stat-value" style="color: #ffc107;">${
          profile.tournament_wins || 0
        }</div>
      </div>
    </div>

    <div class="profile-section">
      <div class="profile-section-title">📊 Статистика</div>
      <div class="profile-section-content">
        <p><strong>Процент побед:</strong> ${
          profile.total_bets > 0
            ? ((profile.won_count / profile.total_bets) * 100).toFixed(1)
            : 0
        }%</p>
      </div>
    </div>

    <div class="profile-section" id="awardsSection" style="display: none;">
      <div class="profile-section-title">🏆 НАГРАДЫ</div>
      <div class="profile-section-content" id="awardsContainer">
        Загружаем награды...
      </div>
    </div>
  `;

  // Загружаем награды после отображения профиля
  loadUserAwards(profile.id);
}

export async function loadUserAwards(userId) {
  try {
    console.log(`🏆 Загружаем награды для пользователя ${userId}`);

    // Загружаем награды за победу в турнирах (автоматические)
    const response1 = await fetch(`/api/user/${userId}/awards`);
    const tournamentAwards = await response1.json();

    // Загружаем пользовательские награды (выданные админом)
    const response2 = await fetch(`/api/user/${userId}/custom-awards`);
    const customAwards = await response2.json();

    console.log("Награды за турниры:", tournamentAwards);
    console.log("Пользовательские награды:", customAwards);

    const awardsSection = document.getElementById("awardsSection");
    const awardsContainer = document.getElementById("awardsContainer");

    // Объединяем обе массива
    const allAwards = [...(tournamentAwards || []), ...(customAwards || [])];

    if (!allAwards || allAwards.length === 0) {
      console.log("Нет наград для отображения");
      awardsSection.style.display = "none";
      return;
    }

    awardsSection.style.display = "block";

    let awardsHTML = '<div class="awards-grid">';

    // Отображаем автоматические награды за турниры
    tournamentAwards.forEach((award) => {
      const awardDate = new Date(award.awarded_at).toLocaleDateString("ru-RU");
      const icon = award.event_icon || "🏆";
      const awardIcon = icon.startsWith("img/")
        ? `<img src="${icon}" alt="trophy" class="tournament-icon">`
        : icon;

      awardsHTML += `
        <div class="award-card">
          <div class="award-icon">${awardIcon}</div>
          <div class="award-title">Победитель в турнире "${award.event_name}"</div>
          <div class="award-date">${awardDate}</div>
        </div>
      `;
    });

    // Отображаем пользовательские награды
    const awardTypeText = {
      participant: "👤 Участник турнира",
      winner: "🥇 Победитель",
      best_result: "⭐ Лучший результат",
      special: "🎖️ Специальная награда",
    };

    customAwards.forEach((award) => {
      const awardDate = new Date(award.created_at).toLocaleDateString("ru-RU");
      const eventText = award.event_name
        ? ` в турнире "${award.event_name}"`
        : "";
      const descText = award.description
        ? `<div class="award-info-small">${award.description}</div>`
        : "";

      awardsHTML += `
        <div class="award-card" style="background: linear-gradient(135deg, rgba(255, 193, 7, 0.2), rgba(255, 152, 0, 0.2));">
          <div class="award-icon">${getAwardIcon(award.award_type)}</div>
          <div class="award-title">${
            awardTypeText[award.award_type] || award.award_type
          }${eventText}</div>
          ${descText}
          <div class="award-date">${awardDate}</div>
        </div>
      `;
    });

    awardsHTML += "</div>";

    awardsContainer.innerHTML = awardsHTML;
    console.log("✅ Награды успешно отображены");
  } catch (error) {
    console.error("Ошибка при загрузке наград:", error);
    document.getElementById("awardsContainer").innerHTML =
      "Ошибка при загрузке наград";
  }
}

// Функция для получения иконки награды
export function getAwardIcon(awardType) {
  const icons = {
    participant: "👤",
    winner: "🥇",
    best_result: "⭐",
    special: "🎖️",
  };
  return icons[awardType] || "🏆";
}
