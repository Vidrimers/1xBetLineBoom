import { Router } from 'express';
import { db } from '../database/db.js';
import { awardImageUpload } from '../middleware/upload.js';

const router = Router();

// POST /api/awards/upload-image
router.post("/api/awards/upload-image", (req, res) => {
  awardImageUpload.single("image")(req, res, (error) => {
    if (error) {
      return res.status(400).json({ success: false, error: error.message });
    }

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "Файл не был получен" });
    }

    const relativePath = `/uploads/award-images/${req.file.filename}`;
    res.json({ success: true, url: relativePath });
  });
});

// GET /api/awards
router.get("/api/awards", (req, res) => {
  try {
    const awards = db
      .prepare(
        `
      SELECT ua.id, ua.user_id, u.username, ua.event_id, e.name as event_name,
             ua.award_type, ua.description, ua.image_url, ua.background_opacity,
             ua.award_color, ua.award_emoji, ua.created_at
      FROM user_awards ua
      JOIN users u ON ua.user_id = u.id
      LEFT JOIN events e ON ua.event_id = e.id
      ORDER BY ua.created_at DESC
    `
      )
      .all();

    res.json(awards);
  } catch (error) {
    console.error("Ошибка при получении наград:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/awards - выдать новую награду
router.post("/api/awards", (req, res) => {
  try {
    let {
      user_id,
      event_id,
      award_type,
      description,
      image_url,
      background_opacity,
      award_color,
      award_emoji,
    } = req.body;

    // Преобразуем в числа
    user_id = user_id ? parseInt(user_id, 10) : null;
    event_id = event_id ? parseInt(event_id, 10) : null;

    // Проверяем валидность ID
    if (!user_id || isNaN(user_id)) {
      return res
        .status(400)
        .json({ error: "user_id обязателен и должен быть числом" });
    }

    if (!award_type || typeof award_type !== "string") {
      return res
        .status(400)
        .json({ error: "award_type обязателен и должен быть строкой" });
    }

    // Проверяем существует ли пользователь
    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(user_id);

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Если указан event_id, проверяем существует ли событие
    if (event_id && !isNaN(event_id)) {
      const event = db
        .prepare("SELECT id FROM events WHERE id = ?")
        .get(event_id);

      if (!event) {
        return res.status(404).json({ error: "Турнир не найден" });
      }
    } else {
      event_id = null;
    }

    // Валидируем прозрачность
    const opacity =
      background_opacity !== undefined ? parseFloat(background_opacity) : 1;
    if (opacity < 0 || opacity > 1) {
      return res
        .status(400)
        .json({ error: "Прозрачность должна быть от 0 до 1" });
    }

    // Валидируем цвет (должен быть hex формат или пустой)
    const color = award_color || "#fbc02d";
    if (!color.match(/^#[0-9A-F]{6}$/i)) {
      return res
        .status(400)
        .json({ error: "Цвет должен быть в формате #RRGGBB" });
    }

    // Валидируем эмодзи (не более 2 символов)
    const emoji = award_emoji || "🏆";
    if (emoji.length > 2) {
      return res
        .status(400)
        .json({ error: "Эмодзи не может быть длиннее 2 символов" });
    }

    // Добавляем награду
    const result = db
      .prepare(
        "INSERT INTO user_awards (user_id, event_id, award_type, description, image_url, background_opacity, award_color, award_emoji) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        user_id,
        event_id || null,
        award_type,
        description || null,
        image_url || null,
        opacity,
        color,
        emoji
      );

    console.log(`✓ Награда выдана пользователю ${user_id}: ${award_type}`);

    // Создаём автоматическую новость о награде
    try {
      const awardUser = db.prepare("SELECT username FROM users WHERE id = ?").get(user_id);
      const eventInfo = event_id ? db.prepare("SELECT name FROM events WHERE id = ?").get(event_id) : null;
      
      const awardTypeNames = {
        'winner': 'Победитель турнира',
        'top3': 'Топ-3 турнира',
        'best_predictor': 'Лучший прогнозист',
        'lucky': 'Счастливчик',
        'milestone': 'Достижение',
        'special': 'Особая награда',
        'custom': 'Награда'
      };
      
      const awardName = awardTypeNames[award_type] || 'Награда';
      
      let newsTitle = `🏆 ${awardUser.username} получил награду!`;
      let newsMessage = `${emoji} ${awardName}`;
      
      if (eventInfo) {
        newsMessage += `\n🏆 Турнир: ${eventInfo.name}`;
      }
      
      if (description) {
        newsMessage += `\n📝 ${description}`;
      }
      
      db.prepare(`
        INSERT INTO news (type, title, message, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('achievement', newsTitle, newsMessage);
      
      console.log(`✓ Создана новость о награде для ${awardUser.username}`);
    } catch (newsError) {
      console.error("⚠️ Ошибка создания новости о награде:", newsError);
      // Не прерываем выполнение, награда уже выдана
    }

    res.json({
      success: true,
      message: "Награда успешно выдана",
      id: result.lastInsertRowid,
    });
  } catch (error) {
    console.error("Ошибка при выдачи награды:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/awards/:awardId - получить данные награды
router.get("/api/awards/:awardId", (req, res) => {
  try {
    const { awardId } = req.params;

    const award = db
      .prepare("SELECT * FROM user_awards WHERE id = ?")
      .get(awardId);

    if (!award) {
      return res.status(404).json({ error: "Награда не найдена" });
    }

    res.json(award);
  } catch (error) {
    console.error("Ошибка при получении награды:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/awards/:awardId - редактировать награду
router.put("/api/awards/:awardId", (req, res) => {
  try {
    const { awardId } = req.params;
    const {
      award_type,
      description,
      image_url,
      background_opacity,
      award_color,
      award_emoji,
    } = req.body;

    // Валидация
    if (!award_type) {
      return res.status(400).json({ error: "Тип награды не указан" });
    }

    const validTypes = ["participant", "winner", "best_result", "special"];
    if (!validTypes.includes(award_type)) {
      return res.status(400).json({ error: "Неверный тип награды" });
    }

    // Валидация прозрачности
    const opacity = background_opacity !== undefined ? background_opacity : 1;
    if (opacity < 0 || opacity > 1) {
      return res
        .status(400)
        .json({ error: "Прозрачность должна быть от 0 до 1" });
    }

    // Валидируем цвет (должен быть hex формат или пустой)
    const color = award_color || "#fbc02d";
    if (!color.match(/^#[0-9A-F]{6}$/i)) {
      return res
        .status(400)
        .json({ error: "Цвет должен быть в формате #RRGGBB" });
    }

    // Валидируем эмодзи (не более 2 символов)
    const emoji = award_emoji || "🏆";
    if (emoji.length > 2) {
      return res
        .status(400)
        .json({ error: "Эмодзи не может быть длиннее 2 символов" });
    }

    // Обновляем награду
    const result = db
      .prepare(
        "UPDATE user_awards SET award_type = ?, description = ?, image_url = ?, background_opacity = ?, award_color = ?, award_emoji = ? WHERE id = ?"
      )
      .run(
        award_type,
        description || null,
        image_url || null,
        opacity,
        color,
        emoji,
        awardId
      );

    if (result.changes === 0) {
      return res.status(404).json({ error: "Награда не найдена" });
    }

    console.log(`✓ Награда обновлена: ${awardId}`);

    res.json({
      success: true,
      message: "Награда успешно обновлена",
    });
  } catch (error) {
    console.error("Ошибка при обновлении награды:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/awards/:awardId - удалить награду
router.delete("/api/awards/:awardId", (req, res) => {
  try {
    const { awardId } = req.params;

    const result = db
      .prepare("DELETE FROM user_awards WHERE id = ?")
      .run(awardId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Награда не найдена" });
    }

    console.log(`✓ Награда удалена: ${awardId}`);

    res.json({
      success: true,
      message: "Награда удалена",
    });
  } catch (error) {
    console.error("Ошибка при удалении награды:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
