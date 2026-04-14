// ========== МОДУЛЬ AWARDS ==========
// Управление наградами (только для админа)

import { isAdmin } from './admin.js';

// Открыть панель управления наградами
export async function openAwardsPanel() {
  console.log("��� Открытие панели управления наградами");

  if (!isAdmin()) {
    alert("❌ У вас нет прав для управления наградами");
    return;
  }

  const modal = document.getElementById("awardsModal");
  if (!modal) {
    console.error("❌ Элемент awardsModal не найден!");
    alert("❌ Ошибка: модальное окно не найдено");
    return;
  }

  modal.style.display = "flex";

  console.log("��� Загрузка списка наград...");
  loadAwardsList();

  console.log("��� Загрузка списка турниров...");
  loadEventsForAwards();
}

// Закрыть панель управления наградами
export function closeAwardsPanel() {
  const modal = document.getElementById("awardsModal");
  if (modal) modal.style.display = "none";
}

// Загрузить список наград
export async function loadAwardsList() {
  try {
    const response = await fetch("/api/awards");
    const awards = await response.json();

    const listContainer = document.getElementById("awardsList");

    if (!Array.isArray(awards) || awards.length === 0) {
      listContainer.innerHTML = '<div class="empty-message">Наград не найдено</div>';
      return;
    }

    const awardTypeText = {
      participant: "��� Участник турнира",
      winner: "��� Победитель",
      best_result: "⭐ Лучший результат",
      special: "���️ Специальная награда",
    };

    listContainer.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
        ${awards.map(award => {
          const awardColor = award.award_color || "#fbc02d";
          const awardEmoji = award.award_emoji || "���";
          let bgStyle = 'rgba(255,193,7,0.1)';
          let bgHoverStyle = 'rgba(255,193,7,0.2)';
          let borderColor = 'rgba(251,192,45,0.5)';
          let textColor = '#fbc02d';

          if (awardColor && awardColor !== "#fbc02d") {
            const rgb = parseInt(awardColor.slice(1), 16);
            const r = (rgb >> 16) & 255;
            const g = (rgb >> 8) & 255;
            const b = rgb & 255;
            bgStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.1)';
            bgHoverStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.2)';
            borderColor = 'rgba(' + r + ',' + g + ',' + b + ',0.5)';
            textColor = awardColor;
          }

          if (award.image_url) {
            const opacity = award.background_opacity !== undefined ? award.background_opacity : 1;
            bgStyle = 'linear-gradient(rgba(0,0,0,' + (1 - opacity) + '),rgba(0,0,0,' + (1 - opacity) + ')),url(\'' + award.image_url + '\'); background-size:cover;background-position:center;';
            bgHoverStyle = 'linear-gradient(rgba(0,0,0,' + (0.8 - opacity) + '),rgba(0,0,0,' + (0.8 - opacity) + ')),url(\'' + award.image_url + '\'); background-size:cover;background-position:center;';
          }

          return `
          <div style="background:${bgStyle};border:1px solid ${borderColor};padding:10px;border-radius:6px;display:flex;flex-direction:column;justify-content:space-between;transition:all 0.3s ease;cursor:pointer;position:relative;"
            onmouseover="this.style.background='${bgHoverStyle}';this.style.borderColor='${borderColor}'"
            onmouseout="this.style.background='${bgStyle}';this.style.borderColor='${borderColor}'">
            <div style="margin-bottom:8px;flex-grow:1;">
              <div style="color:${textColor};font-weight:bold;margin-bottom:4px;font-size:0.95em;word-break:break-word;text-shadow:1px 1px 2px rgba(0,0,0,0.5)">${awardEmoji} ${award.username}</div>
              <div style="color:#b0b0b0;font-size:0.8em;margin-bottom:3px;text-shadow:1px 1px 1px rgba(0,0,0,0.5)">${awardTypeText[award.award_type] || award.award_type}</div>
              <div style="color:#888;font-size:0.75em;margin-bottom:3px;text-shadow:1px 1px 1px rgba(0,0,0,0.5)">${award.event_name ? '��� ' + award.event_name : 'Общая'}</div>
              ${award.description ? '<div style="color:#ddd;font-size:0.75em;font-style:italic;margin-top:4px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;text-shadow:1px 1px 1px rgba(0,0,0,0.5)">"' + award.description + '"</div>' : ''}
            </div>
            <div style="display:flex;gap:6px;margin-top:8px;">
              <button onclick="openEditAwardModal(${award.id},'${award.username}','${award.award_type}','${award.description || ''}','${award.event_name || ''}')" style="background:rgba(33,150,243,0.7);color:#87ceeb;border:1px solid #2196f3;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:0.8em;flex:1;transition:all 0.2s;" onmouseover="this.style.background='rgba(33,150,243,0.9)'" onmouseout="this.style.background='rgba(33,150,243,0.7)'">✏️ Редакт.</button>
              <button onclick="removeAward(${award.id})" style="background:rgba(244,67,54,0.7);color:#ffb3b3;border:1px solid #f44336;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:0.8em;flex:1;transition:all 0.2s;" onmouseover="this.style.background='rgba(244,67,54,0.9)'" onmouseout="this.style.background='rgba(244,67,54,0.7)'">���️ Удал.</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
  } catch (error) {
    console.error("Ошибка при загрузке наград:", error);
    document.getElementById("awardsList").innerHTML = '<div class="empty-message">Ошибка загрузки наград</div>';
  }
}

// Загрузить список турниров для выбора
export async function loadEventsForAwards() {
  try {
    const response = await fetch("/api/events");
    const events = await response.json();

    const select = document.getElementById("eventSelectForAward");

    while (select.options.length > 1) {
      select.remove(1);
    }

    events.forEach(event => {
      const option = document.createElement("option");
      option.value = event.id;
      option.textContent = event.name;
      select.appendChild(option);
    });

    select.onchange = () => {
      console.log('��� Выбран турнир: ' + select.value);
      if (select.value) {
        loadTournamentParticipantsForAward(select.value);
      } else {
        document.getElementById("participantSelectForAward").innerHTML = '<option value="">-- Выбрать участника --</option>';
      }
    };
  } catch (error) {
    console.error("Ошибка при загрузке турниров:", error);
  }
}

// Загрузить участников турнира
export async function loadTournamentParticipantsForAward(eventId) {
  try {
    console.log('��� Загрузка участников для турнира ' + eventId);
    const response = await fetch('/api/events/' + eventId + '/tournament-participants');

    if (!response.ok) throw new Error('Ошибка сервера: ' + response.status);

    const participants = await response.json();

    console.log("✅ Загруженные участники:", participants);
    console.log('��� Количество участников: ' + participants.length);

    const select = document.getElementById("participantSelectForAward");

    if (!select) {
      console.error("❌ Элемент participantSelectForAward не найден!");
      return;
    }

    select.innerHTML = '<option value="">-- Выбрать участника --</option>';

    if (!Array.isArray(participants) || participants.length === 0) {
      select.innerHTML = '<option value="">-- Участников не найдено --</option>';
      console.warn("⚠️ В турнире нет участников со ставками");
      return;
    }

    participants.forEach(participant => {
      const option = document.createElement("option");
      const userId = participant.id;
      option.value = String(userId);
      option.textContent = participant.username;
      select.appendChild(option);
      console.log('➕ Добавлен участник: ' + participant.username + ', ID: ' + userId);
    });

    console.log('✅ Всего добавлено участников: ' + participants.length);
  } catch (error) {
    console.error("❌ Ошибка при загрузке участников:", error);
    const select = document.getElementById("participantSelectForAward");
    if (select) select.innerHTML = '<option value="">-- Ошибка загрузки --</option>';
  }
}

// Загрузить изображение награды
export async function uploadAwardImageFile(file) {
  if (!file) return null;

  const formData = new FormData();
  formData.append("image", file);

  try {
    const response = await fetch("/api/awards/upload-image", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      const errorMessage = data.error || "Не удалось загрузить изображение";
      throw new Error(errorMessage);
    }

    return data.url;
  } catch (error) {
    console.error("Ошибка при загрузке изображения:", error);
    alert('❌ Не удалось загрузить изображение: ' + error.message);
    throw error;
  }
}

// Выдать новую награду
export async function assignAward() {
  const eventId = document.getElementById("eventSelectForAward").value;
  const userIdStr = document.getElementById("participantSelectForAward").value;
  const awardType = document.getElementById("awardTypeSelect").value;
  const description = document.getElementById("awardDescriptionInput").value;
  const awardColor = document.getElementById("awardColorInput").value || "#fbc02d";
  const awardEmoji = document.getElementById("awardEmojiInput").value || "���";
  const imageUrl = document.getElementById("awardImageUrlInput").value;
  const opacity = parseFloat(document.getElementById("awardOpacityInput").value);

  const imageFileInput = document.getElementById("awardImageFileInput");
  let uploadedImageUrl = null;

  if (imageFileInput && imageFileInput.files.length > 0) {
    try {
      uploadedImageUrl = await uploadAwardImageFile(imageFileInput.files[0]);
      document.getElementById("awardImageUrlInput").value = uploadedImageUrl;
    } catch (uploadError) {
      return;
    }
  }

  const finalImageUrl = uploadedImageUrl || (imageUrl ? imageUrl.trim() : null);

  if (!userIdStr || !awardType) {
    alert("❌ Выберите участника и тип награды");
    return;
  }

  const userId = parseInt(userIdStr, 10);

  if (isNaN(userId)) {
    alert("❌ Ошибка: некорректный ID участника. Выбранное значение: " + userIdStr);
    return;
  }

  try {
    const response = await fetch("/api/awards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        event_id: eventId || null,
        award_type: awardType,
        description: description || null,
        image_url: finalImageUrl || null,
        background_opacity: opacity,
        award_color: awardColor,
        award_emoji: awardEmoji,
      }),
    });

    const data = await response.json();

    if (data.success) {
      alert("✅ Награда успешно выдана");

      document.getElementById("eventSelectForAward").value = "";
      document.getElementById("participantSelectForAward").innerHTML = '<option value="">-- Выбрать участника --</option>';
      document.getElementById("awardTypeSelect").value = "";
      document.getElementById("awardDescriptionInput").value = "";
      document.getElementById("awardColorInput").value = "#fbc02d";
      document.getElementById("awardColorTextInput").value = "#fbc02d";
      document.getElementById("awardEmojiInput").value = "���";
      document.getElementById("awardImageUrlInput").value = "";
      if (imageFileInput) imageFileInput.value = "";
      document.getElementById("awardOpacityInput").value = "1";
      document.getElementById("awardOpacityValue").textContent = "1";

      loadAwardsList();
    } else {
      alert('❌ Ошибка: ' + (data.error || "Неизвестная ошибка"));
    }
  } catch (error) {
    console.error("Ошибка при выдачи награды:", error);
    alert('❌ Ошибка при выдачи награды: ' + error.message);
  }
}

// Открыть модальное окно редактирования награды
export async function openEditAwardModal(awardId, username, awardType, description, eventName) {
  try {
    const response = await fetch('/api/awards/' + awardId);
    const awardData = await response.json();

    const imageUrl = awardData.image_url || "";
    const opacity = awardData.background_opacity !== undefined ? awardData.background_opacity : 1;

    let editModal = document.getElementById("editAwardModal");

    if (!editModal) {
      editModal = document.createElement("div");
      editModal.id = "editAwardModal";
      editModal.style.cssText = "display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:1000;justify-content:center;align-items:center;";
      document.body.appendChild(editModal);
    }

    editModal.dataset.awardId = awardId;

    editModal.innerHTML = `
    <div style="background:#1a1e28;border:1px solid #444;padding:30px;border-radius:8px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="color:#5a9fd4;margin:0;">✏️ Редактировать награду</h2>
        <button onclick="closeEditAwardModal()" style="background:none;border:none;color:#888;font-size:28px;cursor:pointer;padding:0;">&times;</button>
      </div>
      <div style="margin-bottom:15px;"><label style="display:block;margin-bottom:8px;color:#e0e0e0;font-weight:bold;">��� Участник:</label><div style="background:#2a2e3a;padding:10px;border-radius:4px;color:#fbc02d;border:1px solid rgba(251,192,45,0.5);">${username}</div></div>
      <div style="margin-bottom:15px;"><label style="display:block;margin-bottom:8px;color:#e0e0e0;font-weight:bold;">��� Турнир:</label><div style="background:#2a2e3a;padding:10px;border-radius:4px;color:#b0b0b0;border:1px solid #444;">${eventName || 'Общая награда'}</div></div>
      <div style="margin-bottom:15px;"><label style="display:block;margin-bottom:8px;color:#e0e0e0;font-weight:bold;">��� Тип награды:</label>
        <select id="editAwardTypeSelect" style="width:100%;padding:10px;background:#2a2e3a;color:#e0e0e0;border:1px solid #444;border-radius:4px;">
          <option value="participant" ${awardType === 'participant' ? 'selected' : ''}>��� Участник турнира</option>
          <option value="winner" ${awardType === 'winner' ? 'selected' : ''}>��� Победитель</option>
          <option value="best_result" ${awardType === 'best_result' ? 'selected' : ''}>⭐ Лучший результат</option>
          <option value="special" ${awardType === 'special' ? 'selected' : ''}>���️ Специальная награда</option>
        </select>
      </div>
      <div style="margin-bottom:20px;"><label style="display:block;margin-bottom:8px;color:#e0e0e0;font-weight:bold;">��� Описание (опционально):</label><textarea id="editAwardDescriptionInput" style="width:100%;padding:10px;background:#2a2e3a;color:#e0e0e0;border:1px solid #444;border-radius:4px;min-height:80px;font-family:Arial,sans-serif;resize:vertical;">${description || ''}</textarea></div>
      <div style="margin-bottom:15px;"><label style="display:block;margin-bottom:8px;color:#e0e0e0;font-weight:bold;">��� Цвет награды:</label><div style="display:flex;gap:10px;align-items:center;"><input type="color" id="editAwardColorInput" style="width:60px;height:40px;cursor:pointer;border:1px solid #555;border-radius:4px;"/><input type="text" id="editAwardColorTextInput" style="flex:1;padding:8px;background:#2a2e3a;color:#e0e0e0;border:1px solid #444;border-radius:4px;"/></div></div>
      <div style="margin-bottom:15px;"><label style="display:block;margin-bottom:8px;color:#e0e0e0;font-weight:bold;">��� Эмодзи награды:</label><input type="text" id="editAwardEmojiInput" maxlength="2" style="width:100%;padding:10px;background:#2a2e3a;color:#e0e0e0;border:1px solid #444;border-radius:4px;font-size:1.2em;"/><small style="color:#999;">Выберите эмодзи для награды (максимум 1 символ)</small></div>
      <div style="margin-bottom:15px;"><label style="display:block;margin-bottom:8px;color:#e0e0e0;font-weight:bold;">���️ Фоновое изображение (URL, опционально):</label><input type="text" id="editAwardImageUrl" placeholder="https://example.com/image.jpg" style="width:100%;padding:10px;background:#2a2e3a;color:#e0e0e0;border:1px solid #444;border-radius:4px;font-family:Arial,sans-serif;"/><small style="color:#999;display:block;margin-top:4px;">Укажите URL картинки для фона награды</small></div>
      <div style="margin-bottom:15px;"><label style="display:block;margin-bottom:8px;color:#e0e0e0;font-weight:bold;">��� Загрузить изображение с устройства:</label><input type="file" id="editAwardImageFileInput" accept="image/*" style="width:100%;padding:6px;background:#2a2e3a;color:#e0e0e0;border:1px solid #444;border-radius:4px;"/><small style="color:#999;display:block;margin-top:4px;">Выберите файл, чтобы загрузить новое изображение</small></div>
      <div style="margin-bottom:20px;"><label style="display:block;margin-bottom:8px;color:#e0e0e0;font-weight:bold;">��� Прозрачность фона: <span id="opacityValue" style="color:#fbc02d;">1</span></label><input type="range" id="editAwardOpacity" min="0" max="1" step="0.1" value="1" style="width:100%;cursor:pointer;" onchange="document.getElementById('opacityValue').textContent=this.value"/><small style="color:#999;">0 = полностью прозрачный, 1 = полностью видимый</small></div>
      <div style="display:flex;gap:10px;">
        <button onclick="saveEditAward()" style="flex:1;background:rgba(76,175,80,0.7);color:#a8d5a8;border:1px solid #4caf50;padding:12px;border-radius:4px;cursor:pointer;font-size:1em;font-weight:bold;transition:all 0.2s;" onmouseover="this.style.background='rgba(76,175,80,0.9)'" onmouseout="this.style.background='rgba(76,175,80,0.7)'">✅ Сохранить</button>
        <button onclick="closeEditAwardModal()" style="flex:1;background:rgba(158,158,158,0.5);color:#d0d0d0;border:1px solid #999;padding:12px;border-radius:4px;cursor:pointer;font-size:1em;transition:all 0.2s;" onmouseover="this.style.background='rgba(158,158,158,0.7)'" onmouseout="this.style.background='rgba(158,158,158,0.5)'">❌ Отмена</button>
      </div>
    </div>`;

    setTimeout(() => {
      const imageInput = document.getElementById("editAwardImageUrl");
      const opacityInput = document.getElementById("editAwardOpacity");
      const colorInput = document.getElementById("editAwardColorInput");
      const colorText = document.getElementById("editAwardColorTextInput");
      const emojiInput = document.getElementById("editAwardEmojiInput");

      if (imageInput) imageInput.value = imageUrl;
      if (opacityInput) { opacityInput.value = opacity; document.getElementById("opacityValue").textContent = opacity; }

      const awardColorVal = awardData.award_color || "#fbc02d";
      const awardEmojiVal = awardData.award_emoji || "���";

      if (colorInput) colorInput.value = awardColorVal;
      if (colorText) colorText.value = awardColorVal;
      if (emojiInput) emojiInput.value = awardEmojiVal;
    }, 0);

    editModal.style.display = "flex";
  } catch (error) {
    console.error("Ошибка при загрузке данных награды:", error);
    alert("❌ Ошибка при загрузке данных награды");
  }
}

// Закрыть модаль редактирования
export function closeEditAwardModal() {
  const editModal = document.getElementById("editAwardModal");
  const editFileInput = document.getElementById("editAwardImageFileInput");
  if (editFileInput) editFileInput.value = "";
  if (editModal) editModal.style.display = "none";
}

// Сохранить изменения награды
export async function saveEditAward() {
  const editModal = document.getElementById("editAwardModal");
  const awardId = editModal.dataset.awardId;
  const newAwardType = document.getElementById("editAwardTypeSelect").value;
  const newDescription = document.getElementById("editAwardDescriptionInput").value;
  const newImageUrl = document.getElementById("editAwardImageUrl").value;
  const newOpacity = parseFloat(document.getElementById("editAwardOpacity").value);
  const newAwardColor = document.getElementById("editAwardColorInput").value || "#fbc02d";
  const newAwardEmoji = document.getElementById("editAwardEmojiInput").value || "���";

  const editImageFileInput = document.getElementById("editAwardImageFileInput");
  let uploadedEditImageUrl = null;

  if (editImageFileInput && editImageFileInput.files.length > 0) {
    try {
      uploadedEditImageUrl = await uploadAwardImageFile(editImageFileInput.files[0]);
      document.getElementById("editAwardImageUrl").value = uploadedEditImageUrl;
    } catch (uploadError) {
      return;
    }
  }

  const finalEditImageUrl = uploadedEditImageUrl || (newImageUrl ? newImageUrl.trim() : null);

  try {
    const response = await fetch('/api/awards/' + awardId, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        award_type: newAwardType,
        description: newDescription || null,
        image_url: finalEditImageUrl || null,
        background_opacity: newOpacity,
        award_color: newAwardColor,
        award_emoji: newAwardEmoji,
      }),
    });

    const data = await response.json();

    if (data.success) {
      alert("✅ Награда успешно обновлена");
      if (editImageFileInput) editImageFileInput.value = "";
      closeEditAwardModal();
      loadAwardsList();
    } else {
      alert('❌ Ошибка: ' + (data.error || "Неизвестная ошибка"));
    }
  } catch (error) {
    console.error("Ошибка при обновлении награды:", error);
    alert('❌ Ошибка при обновлении награды: ' + error.message);
  }
}

// Закрытие модалки при клике вне её
document.addEventListener("click", function(event) {
  const editModal = document.getElementById("editAwardModal");
  if (editModal && event.target === editModal) {
    closeEditAwardModal();
  }
});

// Удалить награду
export async function removeAward(awardId) {
  if (!confirm("⚠️ Вы уверены? Награда будет удалена")) return;

  try {
    const response = await fetch('/api/awards/' + awardId, { method: "DELETE" });
    const data = await response.json();

    if (data.success) {
      alert("✅ Награда удалена");
      loadAwardsList();
    } else {
      alert('❌ Ошибка: ' + (data.error || "Неизвестная ошибка"));
    }
  } catch (error) {
    console.error("Ошибка при удалении награды:", error);
    alert('❌ Ошибка при удалении награды: ' + error.message);
  }
}
