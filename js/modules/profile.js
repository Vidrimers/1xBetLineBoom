import { currentUser } from './state.js';
import { showCustomAlert, showCustomPrompt } from './ui.js';

// ===== ПРОФИЛЬ =====

export async function loadProfile() {
  if (!currentUser) {
    await showCustomAlert("Пожалуйста, сначала войдите в аккаунт", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
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
              
            " onmouseover="this.style.background='rgba(255, 255, 255, 0.3)'; this.style.transform='scale(1.1)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.2)'; this.style.transform='scale(1)'"><svg class="icon" aria-hidden="true"><use href="#icon-photo"></use></svg></button>
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
        " title="Изменить имя"><svg class="icon" aria-hidden="true"><use href="#icon-edit"></use></svg></button>
      </div>
      <div class="profile-member-since">Участник с ${createdDate}</div>
    </div>

    <div class="profile-stats-grid">
      <div class="stat-card">
        <div class="stat-label">Ставок за всё время</div>
        <div class="stat-value">${profile.total_bets}</div>
      </div>
      <div class="stat-card won">
        <div class="stat-label"><svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Угаданных ставок</div>
        <div class="stat-value">${profile.won_bets}</div>
      </div>
      <div class="stat-card" style="background: rgba(76, 175, 80, 0.15); border-left: 4px solid #4caf50; cursor: help;" title="${profile.max_win_streak_event ? `Турнир: ${profile.max_win_streak_event}` : 'Нет серии'}">
        <div class="stat-label"><svg class="icon" aria-hidden="true"><use href="#icon-streak"></use></svg> Угаданных подряд</div>
        <div class="stat-value" style="color: #4caf50;">${
          profile.max_win_streak || 0
        }</div>
      </div>
      <div class="stat-card lost">
        <div class="stat-label"><svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Неугаданных ставок</div>
        <div class="stat-value">${profile.lost_bets}</div>
      </div>
      <div class="stat-card pending">
        <div class="stat-label"><svg class="icon" aria-hidden="true"><use href="#icon-pending"></use></svg> В ожидании</div>
        <div class="stat-value">${profile.pending_bets}</div>
      </div>
      <div class="stat-card won" style="background: rgba(76, 175, 80, 0.15); border-left: 4px solid #4caf50;">
        <div class="stat-label"><svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg> Угаданных в сетке</div>
        <div class="stat-value">${profile.bracket_correct || 0}</div>
      </div>
      <div class="stat-card lost" style="background: rgba(244, 67, 54, 0.15); border-left: 4px solid #f44336;">
        <div class="stat-label"><svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg> Неугаданных в сетке</div>
        <div class="stat-value">${profile.bracket_incorrect || 0}</div>
      </div>
      <div class="stat-card" style="background: rgba(255, 152, 0, 0.15); border-left: 4px solid #ffc107;">
        <div class="stat-label"><svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> Побед в турнирах</div>
        <div class="stat-value" style="color: #ffc107;">${
          profile.tournament_wins || 0
        }</div>
      </div>
    </div>

    <div class="profile-section">
      <div class="profile-section-title"><svg class="icon" aria-hidden="true"><use href="#icon-stats"></use></svg> Статистика</div>
      <div class="profile-section-content">
        <p><strong>Процент побед:</strong> ${
          profile.total_bets > 0
            ? ((profile.won_count / profile.total_bets) * 100).toFixed(1)
            : 0
        }%</p>
      </div>
    </div>

    <div class="profile-section" id="awardsSection" style="display: none;">
      <div class="profile-section-title"><svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg> НАГРАДЫ</div>
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
      const icon = award.event_icon || '<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg>';
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
      participant: '<svg class="icon" aria-hidden="true"><use href="#icon-profile"></use></svg>' + ' Участник турнира',
      winner: '<svg class="icon" aria-hidden="true"><use href="#icon-winner"></use></svg>' + ' Победитель',
      best_result: "⭐ Лучший результат",
      special: '<svg class="icon" aria-hidden="true"><use href="#icon-special-award"></use></svg>' + ' Специальная награда',
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
    participant: '<svg class="icon" aria-hidden="true"><use href="#icon-profile"></use></svg>',
    winner: '<svg class="icon" aria-hidden="true"><use href="#icon-winner"></use></svg>',
    best_result: "⭐",
    special: '<svg class="icon" aria-hidden="true"><use href="#icon-special-award"></use></svg>',
  };
  return icons[awardType] || '<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg>';
}

// ===== АВАТАР =====

// Переменная для хранения экземпляра Cropper
let cropper = null;

export function closeAvatarModal(event) {
  if (event && event.target.id !== "avatarModal") {
    return;
  }
  document.getElementById("avatarModal").style.display = "none";
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }

  // Удаляем обработчики GIF drag-and-drop
  if (window.gifMouseMoveHandler) {
    document.removeEventListener("mousemove", window.gifMouseMoveHandler);
  }
  if (window.gifMouseUpHandler) {
    document.removeEventListener("mouseup", window.gifMouseUpHandler);
  }
  if (window.gifWheelHandler) {
    const gifPreviewColumn = document.getElementById("gifPreviewColumn");
    if (gifPreviewColumn) {
      gifPreviewColumn.removeEventListener("wheel", window.gifWheelHandler);
    }
  }

  // Очищаем сохраненные GIF данные
  window.gifAvatarData = null;
  window.gifBase64 = null;
  window.gifPositionX = 0;
  window.gifPositionY = 0;
  window.gifZoom = 1;
  window.gifMouseMoveHandler = null;
  window.gifMouseUpHandler = null;
  window.gifWheelHandler = null;

  // Сбрасываем трансформацию GIF изображения
  const gifPreview = document.getElementById("gifFullPreview");
  if (gifPreview) {
    gifPreview.style.transform = "scale(1)";
    gifPreview.src = "";
  }

  // Очищаем результаты превью
  const gifCropResult = document.getElementById("gifCropResult");
  if (gifCropResult) {
    gifCropResult.src = "";
  }

  // Скрываем контейнеры редактирования
  document.getElementById("gifPreviewColumn").style.display = "none";
  document.getElementById("gifResultPreview").style.display = "none";
  document.getElementById("pngPreviewContainer").style.display = "none";
  document.getElementById("cropperContainer").style.display = "none";
  document.querySelector(".avatar-result-container").style.display = "none";
  document.getElementById("avatarImage").src = "";

  // Разблокируем скролл страницы при закрытии модального окна
  document.body.style.overflow = "";
}

// Обновляем аватар в профиле без перезагрузки страницы
function updateAvatarInProfile(avatarPath) {
  const profileAvatar = document.querySelector(".profile-avatar img");
  if (profileAvatar) {
    const timestamp = new Date().getTime();
    profileAvatar.src = avatarPath + `?v=${timestamp}`;
    console.log(`✅ Аватар обновлен в профиле: ${avatarPath}`);
  }
}

export async function saveAvatar() {
  console.log("saveAvatar вызвана");

  // Проверяем если это GIF
  if (window.gifAvatarData) {
    console.log("Обнаружен GIF, вызываю saveGifAvatar");
    return saveGifAvatar();
  }

  console.log("cropper:", cropper);

  if (!cropper) {
    await showCustomAlert("Пожалуйста, выберите изображение", "Внимание", '<svg class="icon" aria-hidden="true"><use href="#icon-warning"></use></svg>');
    return;
  }

  try {
    console.log("Получаю обрезанный canvas...");
    const canvas = cropper.getCroppedCanvas({
      maxWidth: 200,
      maxHeight: 200,
      fillColor: "rgba(0, 0, 0, 0)",
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
    });
    console.log("✅ Canvas получен", canvas);

    const avatarData = canvas.toDataURL("image/png", 0.8);
    const fileType = "image/png";
    console.log("✅ Avatar data получен, размер:", avatarData.length);

    console.log("Отправляю на сервер...");
    const response = await fetch(`/api/user/${currentUser.id}/avatar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ avatarData, fileType }),
    });

    const result = await response.json();
    console.log("Ответ сервера:", result);

    if (!response.ok) {
      console.error(
        '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>' + ' Ошибка при сохранении аватара: ' +
          (result.error || "Неизвестная ошибка")
      );
      return;
    }

    console.log("✅ Аватар сохранен на сервер");

    if (result.avatarPath) {
      localStorage.setItem(`avatar_${currentUser.id}`, result.avatarPath);
      console.log("✅ Аватар сохранен в localStorage");
    }

    closeAvatarModal();
    if (result.avatarPath) {
      updateAvatarInProfile(result.avatarPath);
    }
  } catch (error) {
    console.error("❌ Ошибка при сохранении аватара:", error);
  }
}

async function saveGifAvatar() {
  try {
    let avatarData = window.gifAvatarData;
    const fileType = "image/gif";

    if (!avatarData) {
      console.error("❌ GIF не выбран");
      return;
    }

    const gifSize = avatarData.length;
    console.log(`📊 Размер GIF: ${(gifSize / 1024 / 1024).toFixed(2)} MB`);

    if (gifSize > 2 * 1024 * 1024) {
      console.warn("⚠ GIF слишком большой, пытаюсь сжать...");

      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 200;
        canvas.height = 200;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "rgba(0, 0, 0, 0)";
        ctx.fillRect(0, 0, 200, 200);
        ctx.drawImage(img, 0, 0, 200, 200);

        if (gifSize < 5 * 1024 * 1024) {
          console.log("✅ GIF в пределах лимита, сохраняю оригинальный");
        } else {
          console.error(
            "GIF слишком большой (более 5MB). Рекомендуется использовать меньший файл."
          );
          return;
        }
      };
      img.src = avatarData;

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log("Отправляю GIF на сервер...");
    const response = await fetch(`/api/user/${currentUser.id}/avatar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        avatarData,
        fileType,
        gifPositionX: window.gifPositionX || 0,
        gifPositionY: window.gifPositionY || 0,
        gifZoom: window.gifZoom || 1,
      }),
    });

    const result = await response.json();
    console.log("Ответ сервера:", result);

    if (!response.ok) {
      console.error(
        '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>' + ' Ошибка при сохранении GIF: ' +
          (result.error || "Неизвестная ошибка")
      );
      return;
    }

    console.log("✅ GIF аватар сохранен на сервер");

    if (result.fileSize) {
      const sizeMB = (result.fileSize / 1024 / 1024).toFixed(2);
      console.log(`📊 Финальный размер: ${sizeMB} MB`);
    }

    if (result.avatarPath) {
      localStorage.setItem(`avatar_${currentUser.id}`, result.avatarPath);
      console.log("✅ GIF аватар сохранен в localStorage");
    }

    closeAvatarModal();
    if (result.avatarPath) {
      updateAvatarInProfile(result.avatarPath);
    }
  } catch (error) {
    console.error("❌ Ошибка при сохранении GIF аватара:", error);
  }
}

export async function deleteAvatar() {
  if (!confirm("Вы уверены, что хотите удалить аватар?")) {
    return;
  }

  try {
    console.log("Удаляю аватар...");
    const response = await fetch(`/api/user/${currentUser.id}/avatar`, {
      method: "DELETE",
    });

    const result = await response.json();
    console.log("Ответ сервера:", result);

    if (!response.ok) {
      console.error(
        '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>' + ' Ошибка при удалении аватара: ' +
          (result.error || "Неизвестная ошибка")
      );
      return;
    }

    console.log("✅ Аватар удален");

    localStorage.removeItem(`avatar_${currentUser.id}`);
    console.log("✅ Аватар удален из localStorage");

    closeAvatarModal();
    updateAvatarInProfile("img/default-avatar.jpg");
  } catch (error) {
    console.error("❌ Ошибка при удалении аватара:", error);
  }
}

// ===== РЕДАКТИРОВАНИЕ ИМЕНИ ПОЛЬЗОВАТЕЛЯ =====

export async function saveUsername(newUsername) {
  try {
    const forbiddenBase = newUsername.toLowerCase().replace(/[\s\d.\-]/g, '');
    if (forbiddenBase === 'мемослав' || forbiddenBase === 'memoslav' || forbiddenBase === 'memoslave') {
      await showCustomAlert('Are you ohuel tam?', 'Ошибка', '🚫');
      return;
    }

    const response = await fetch(`/api/user/${currentUser.id}/username`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUsername }),
    });

    const result = await response.json();

    if (!response.ok) {
      await showCustomAlert(result.error || 'Не удалось изменить имя', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
      return;
    }

    await showCustomAlert(
      `Имя успешно изменено на "${newUsername}".\n\nВы будете разлогинены со всех устройств.\nВойдите заново с новым именем.`,
      'Имя изменено',
      '<svg class="icon" aria-hidden="true"><use href="#icon-correct"></use></svg>'
    );

    localStorage.removeItem('currentUser');
    localStorage.removeItem('sessionToken');
    window.location.reload();
  } catch (e) {
    console.error('Ошибка при изменении имени:', e);
    await showCustomAlert('Ошибка при изменении имени', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
  }
}

export async function editUsername() {
  const currentUsername = document.getElementById('usernameDisplay').textContent;
  const newUsername = await showCustomPrompt(
    'Введите новое имя пользователя:',
    'Изменение имени',
    '<svg class="icon" aria-hidden="true"><use href="#icon-edit"></use></svg>',
    currentUsername
  );

  if (!newUsername) return;
  if (newUsername === currentUsername) return;
  if (newUsername.trim().length === 0) {
    await showCustomAlert('Имя не может быть пустым', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }
  if (newUsername.length > 30) {
    await showCustomAlert('Имя не может быть длиннее 30 символов', 'Ошибка', '<svg class="icon" aria-hidden="true"><use href="#icon-wrong"></use></svg>');
    return;
  }

  const capitalized = newUsername.charAt(0).toUpperCase() + newUsername.slice(1);
  await saveUsername(capitalized);
}
