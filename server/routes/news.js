import { Router } from 'express';
import { db } from '../database/db.js';
import { writeBetLog } from '../utils/logger.js';
import { notifyAdmin } from '../services/notificationService.js';
import { rssParser, rssNewsCache, filterNewsByTournament } from '../services/rssService.js';
import { sendAdminNotification } from '../../OnexBetLineBoombot.js';

const router = Router();

// GET /api/news - Получить последние новости
router.get("/api/news", (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const type = req.query.type; // Фильтр по типу (опционально)
    const username = req.query.username; // Для получения реакций пользователя
    
    let query = `
      SELECT 
        n.*,
        (SELECT COUNT(*) FROM news_reactions WHERE news_id = n.id AND reaction = 'like') as likes,
        (SELECT COUNT(*) FROM news_reactions WHERE news_id = n.id AND reaction = 'dislike') as dislikes
    `;
    
    // Если передан username, добавляем реакцию пользователя
    if (username) {
      query += `,
        (SELECT reaction FROM news_reactions WHERE news_id = n.id AND username = ?) as user_reaction
      `;
    }
    
    query += " FROM news n";
    
    let params = [];
    
    // Добавляем username в параметры если он есть
    if (username) {
      params.push(username);
    }
    
    if (type && type !== 'all') {
      query += " WHERE n.type = ?";
      params.push(type);
    }
    
    query += " ORDER BY n.created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    
    const news = db.prepare(query).all(...params);
    
    res.json({ success: true, news });
  } catch (error) {
    console.error("❌ Ошибка получения новостей:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/news/:id/reaction - Добавить/изменить реакцию на новость
router.post("/api/news/:id/reaction", async (req, res) => {
  try {
    const newsId = parseInt(req.params.id);
    const { username, reaction } = req.body;
    
    // Проверка обязательных полей
    if (!username || !reaction) {
      return res.status(400).json({ error: "Не указаны обязательные поля" });
    }
    
    // Проверка типа реакции
    if (!['like', 'dislike'].includes(reaction)) {
      return res.status(400).json({ error: "Неверный тип реакции" });
    }
    
    // Проверяем существует ли новость
    const news = db.prepare("SELECT * FROM news WHERE id = ?").get(newsId);
    if (!news) {
      return res.status(404).json({ error: "Новость не найдена" });
    }
    
    // Проверяем существует ли уже реакция пользователя
    const existingReaction = db.prepare(`
      SELECT * FROM news_reactions WHERE news_id = ? AND username = ?
    `).get(newsId, username);
    
    if (existingReaction) {
      if (existingReaction.reaction === reaction) {
        // Если пользователь нажал на ту же кнопку - удаляем реакцию
        db.prepare(`
          DELETE FROM news_reactions WHERE news_id = ? AND username = ?
        `).run(newsId, username);
      } else {
        // Если пользователь изменил реакцию - обновляем
        db.prepare(`
          UPDATE news_reactions SET reaction = ? WHERE news_id = ? AND username = ?
        `).run(reaction, newsId, username);
      }
    } else {
      // Добавляем новую реакцию
      db.prepare(`
        INSERT INTO news_reactions (news_id, username, reaction)
        VALUES (?, ?, ?)
      `).run(newsId, username, reaction);
    }
    
    // Получаем обновленные счетчики
    const likes = db.prepare(`
      SELECT COUNT(*) as count FROM news_reactions WHERE news_id = ? AND reaction = 'like'
    `).get(newsId).count;
    
    const dislikes = db.prepare(`
      SELECT COUNT(*) as count FROM news_reactions WHERE news_id = ? AND reaction = 'dislike'
    `).get(newsId).count;
    
    // Получаем текущую реакцию пользователя
    const userReaction = db.prepare(`
      SELECT reaction FROM news_reactions WHERE news_id = ? AND username = ?
    `).get(newsId, username);
    
    // Отправляем уведомление админу
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username, telegram_username FROM users WHERE username = ?").get(username);
    
    const reactionEmoji = reaction === 'like' ? '👍' : '👎';
    const reactionText = reaction === 'like' ? 'Лайк' : 'Дизлайк';
    
    const time = new Date().toLocaleString("ru-RU", {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const adminMessage = 
      `📢 <b>ОЦЕНКА НОВОСТИ</b>\n\n` +
      `👤 Пользователь: ${user.username}\n` +
      (user.telegram_username ? `📱 Telegram: @${user.telegram_username}\n` : '') +
      `📰 Новость: ${news.title}\n` +
      `${reactionEmoji} Оценка: ${reactionText}\n\n` +
      `🕐 Время: ${time}`;
    
    try {
      await sendAdminNotification(adminMessage);
    } catch (error) {
      console.error("Ошибка отправки уведомления админу:", error);
    }
    
    res.json({ 
      success: true, 
      likes, 
      dislikes,
      user_reaction: userReaction ? userReaction.reaction : null
    });
  } catch (error) {
    console.error("❌ Ошибка добавления реакции:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/news/:id/reactions/:type - Получить список пользователей, поставивших реакцию
router.get("/api/news/:id/reactions/:type", async (req, res) => {
  try {
    const newsId = parseInt(req.params.id);
    const reactionType = req.params.type;
    
    // Проверка типа реакции
    if (!['like', 'dislike'].includes(reactionType)) {
      return res.status(400).json({ error: "Неверный тип реакции" });
    }
    
    // Получаем список пользователей с их реакциями и аватарками
    const users = db.prepare(`
      SELECT nr.username, nr.created_at, u.avatar, u.id as user_id
      FROM news_reactions nr
      LEFT JOIN users u ON nr.username = u.username
      WHERE nr.news_id = ? AND nr.reaction = ?
      ORDER BY nr.created_at DESC
    `).all(newsId, reactionType);
    
    res.json({ 
      success: true, 
      users: users.map(u => ({
        userId: u.user_id,
        username: u.username,
        avatar: u.avatar
      }))
    });
  } catch (error) {
    console.error("❌ Ошибка получения реакций:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/news/:id - Удалить новость (только для админа)
router.delete("/api/admin/news/:id", async (req, res) => {
  try {
    const newsId = parseInt(req.params.id);
    const { username } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    // Проверяем существует ли новость
    const news = db.prepare("SELECT * FROM news WHERE id = ?").get(newsId);
    if (!news) {
      return res.status(404).json({ error: "Новость не найдена" });
    }
    
    // Удаляем реакции на новость
    db.prepare("DELETE FROM news_reactions WHERE news_id = ?").run(newsId);
    
    // Удаляем новость
    db.prepare("DELETE FROM news WHERE id = ?").run(newsId);
    
    // Логируем действие
    writeBetLog("admin", {
      username: username,
      action: "Удалена новость",
      details: `ID: ${newsId}, Заголовок: ${news.title}`
    });
    
    // Отправляем уведомление админу
    const time = new Date().toLocaleString("ru-RU", {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const adminMessage = 
      `🗑️ <b>НОВОСТЬ УДАЛЕНА</b>\n\n` +
      `📰 Заголовок: ${news.title}\n` +
      `💬 Текст: ${news.message}\n\n` +
      `👤 Удалил: ${username}\n` +
      `🕐 Время: ${time}`;
    
    try {
      await sendAdminNotification(adminMessage);
    } catch (error) {
      console.error("Ошибка отправки уведомления админу:", error);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Ошибка удаления новости:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rss-news - Получить RSS новости с фильтрацией по турнирам
router.get("/api/rss-news", async (req, res) => {
  try {
    const tournament = req.query.tournament || 'all';
    
    // Проверяем кэш
    const now = Date.now();
    if (rssNewsCache.data && (now - rssNewsCache.timestamp) < rssNewsCache.ttl) {
      console.log("📰 Возвращаем RSS новости из кэша");
      const filteredNews = filterNewsByTournament(rssNewsCache.data, tournament);
      return res.json({ success: true, news: filteredNews, cached: true });
    }
    
    console.log("📰 Загружаем свежие RSS новости...");
    
    // Парсим RSS ленты
    const sources = [
      'http://www.sports.ru/rss/rubric.xml?s=208', // Sports.ru футбол
      'https://www.gazeta.ru/export/rss/sport.xml', // Gazeta.ru спорт
      'https://www.sport-express.ru/services/materials/news/football/se/' // Спорт-Экспресс футбол
    ];
    
    let allNews = [];
    
    for (const source of sources) {
      try {
        const feed = await rssParser.parseURL(source);
        
        // Определяем источник по URL
        let sourceName = 'Неизвестный источник';
        if (source.includes('sports.ru')) {
          sourceName = 'Sports.ru';
        } else if (source.includes('gazeta.ru')) {
          sourceName = 'Gazeta.ru';
        } else if (source.includes('sport-express.ru')) {
          sourceName = 'Спорт-Экспресс';
        }
        
        const newsItems = feed.items.map(item => ({
          title: item.title,
          link: item.link,
          description: item.contentSnippet || item.content || '',
          pubDate: item.pubDate,
          source: sourceName
        }));
        allNews = allNews.concat(newsItems);
      } catch (error) {
        console.error(`❌ Ошибка парсинга ${source}:`, error.message);
      }
    }
    
    // Сортируем по дате (новые первыми)
    allNews.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    
    // Ограничиваем до 100 новостей
    allNews = allNews.slice(0, 100);
    
    // Сохраняем в кэш
    rssNewsCache.data = allNews;
    rssNewsCache.timestamp = now;
    
    console.log(`✅ Загружено ${allNews.length} RSS новостей`);
    
    // Фильтруем по турниру
    const filteredNews = filterNewsByTournament(allNews, tournament);
    
    res.json({ success: true, news: filteredNews, cached: false });
  } catch (error) {
    console.error("❌ Ошибка получения RSS новостей:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rss-keywords - Получить все ключевые слова
router.get("/api/rss-keywords", (req, res) => {
  try {
    const keywords = db.prepare(`
      SELECT * FROM rss_keywords 
      ORDER BY tournament, priority DESC, keyword
    `).all();
    
    res.json({ success: true, keywords });
  } catch (error) {
    console.error("❌ Ошибка получения ключевых слов:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rss-keywords/:tournament - Получить ключевые слова для турнира
router.get("/api/rss-keywords/:tournament", (req, res) => {
  try {
    const { tournament } = req.params;
    
    const keywords = db.prepare(`
      SELECT * FROM rss_keywords 
      WHERE tournament = ? OR tournament = 'all'
      ORDER BY type DESC, priority DESC, keyword
    `).all(tournament);
    
    res.json({ success: true, keywords });
  } catch (error) {
    console.error("❌ Ошибка получения ключевых слов:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/rss-keywords - Добавить ключевое слово (только для админа)
router.post("/api/admin/rss-keywords", (req, res) => {
  try {
    const { username, tournament, keyword, type, priority } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    if (!tournament || !keyword || !type) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    // Проверяем, не существует ли уже такое ключевое слово
    const existing = db.prepare(`
      SELECT id FROM rss_keywords 
      WHERE tournament = ? AND keyword = ? AND type = ?
    `).get(tournament, keyword, type);
    
    if (existing) {
      return res.status(400).json({ error: "Keyword already exists" });
    }
    
    const result = db.prepare(`
      INSERT INTO rss_keywords (tournament, keyword, type, priority)
      VALUES (?, ?, ?, ?)
    `).run(tournament, keyword, type, priority || 0);
    
    const newKeyword = db.prepare("SELECT * FROM rss_keywords WHERE id = ?").get(result.lastInsertRowid);
    
    // Очищаем кэш RSS новостей
    rssNewsCache.data = null;
    rssNewsCache.timestamp = 0;
    
    // Уведомление админу
    const typeEmojis = { 'include': '✅', 'exclude': '❌' };
    const adminMessage = 
      `${typeEmojis[type]} <b>ДОБАВЛЕНО КЛЮЧЕВОЕ СЛОВО</b>\n\n` +
      `🏆 Турнир: ${tournament}\n` +
      `🔑 Слово: "${keyword}"\n` +
      `📊 Тип: ${type}\n` +
      `⭐ Приоритет: ${priority || 0}\n\n` +
      `👤 Админ: ${username}`;
    
    notifyAdmin(adminMessage).catch(err => {
      console.error("⚠️ Не удалось отправить уведомление админу:", err);
    });
    
    res.json({ success: true, keyword: newKeyword });
  } catch (error) {
    console.error("❌ Ошибка добавления ключевого слова:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/rss-keywords/:id - Удалить ключевое слово (только для админа)
router.delete("/api/admin/rss-keywords/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    // Получаем информацию о ключевом слове перед удалением
    const keyword = db.prepare("SELECT * FROM rss_keywords WHERE id = ?").get(id);
    
    if (!keyword) {
      return res.status(404).json({ error: "Keyword not found" });
    }
    
    db.prepare("DELETE FROM rss_keywords WHERE id = ?").run(id);
    
    // Очищаем кэш RSS новостей
    rssNewsCache.data = null;
    rssNewsCache.timestamp = 0;
    
    // Уведомление админу
    const typeEmojis = { 'include': '✅', 'exclude': '❌' };
    const adminMessage = 
      `${typeEmojis[keyword.type]} <b>УДАЛЕНО КЛЮЧЕВОЕ СЛОВО</b>\n\n` +
      `🏆 Турнир: ${keyword.tournament}\n` +
      `🔑 Слово: "${keyword.keyword}"\n` +
      `📊 Тип: ${keyword.type}\n\n` +
      `👤 Админ: ${username}`;
    
    notifyAdmin(adminMessage).catch(err => {
      console.error("⚠️ Не удалось отправить уведомление админу:", err);
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Ошибка удаления ключевого слова:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/rss-keywords/:id - Обновить ключевое слово (только для админа)
router.put("/api/admin/rss-keywords/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { username, keyword, type, priority } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const existing = db.prepare("SELECT * FROM rss_keywords WHERE id = ?").get(id);
    
    if (!existing) {
      return res.status(404).json({ error: "Keyword not found" });
    }
    
    db.prepare(`
      UPDATE rss_keywords 
      SET keyword = ?, type = ?, priority = ?
      WHERE id = ?
    `).run(keyword, type, priority, id);
    
    const updated = db.prepare("SELECT * FROM rss_keywords WHERE id = ?").get(id);
    
    // Очищаем кэш RSS новостей
    rssNewsCache.data = null;
    rssNewsCache.timestamp = 0;
    
    res.json({ success: true, keyword: updated });
  } catch (error) {
    console.error("❌ Ошибка обновления ключевого слова:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notify-news-view - Уведомление админу о просмотре новостей
router.post("/api/notify-news-view", async (req, res) => {
  try {
    const { username, type } = req.body; // type: 'news' или 'rss'
    
    if (!username || !type) {
      return res.status(400).json({ error: "Missing username or type" });
    }
    
    const typeEmojis = {
      'news': '📢',
      'rss': '🌐'
    };
    
    const typeNames = {
      'news': 'Новости',
      'rss': 'Другие новости (RSS)'
    };
    
    const emoji = typeEmojis[type] || '📰';
    const typeName = typeNames[type] || type;
    
    const time = new Date().toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    
    const adminMessage = 
      `${emoji} <b>ПРОСМОТР: ${typeName}</b>\n\n` +
      `👤 Пользователь: <b>${username}</b>\n` +
      `🕐 Время: ${time}`;
    
    // Отправляем уведомление асинхронно
    notifyAdmin(adminMessage).catch(err => {
      console.error("⚠️ Не удалось отправить уведомление админу:", err);
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/news - Добавить новость (только для админа)
router.post("/api/admin/news", async (req, res) => {
  try {
    const { username, type, title, message } = req.body;
    
    // Проверка прав админа
    const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
    const user = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    
    if (!user || user.username !== ADMIN_DB_NAME) {
      return res.status(403).json({ error: "Доступ запрещен" });
    }
    
    // Проверка обязательных полей
    if (!type || !title || !message) {
      return res.status(400).json({ error: "Не указаны обязательные поля" });
    }
    
    // Проверка типа новости
    const validTypes = ['tournament', 'system', 'achievement', 'announcement'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: "Неверный тип новости" });
    }
    
    // Добавляем новость
    const result = db.prepare(`
      INSERT INTO news (type, title, message)
      VALUES (?, ?, ?)
    `).run(type, title, message);
    
    const newsId = result.lastInsertRowid;
    
    // Получаем добавленную новость
    const news = db.prepare("SELECT * FROM news WHERE id = ?").get(newsId);
    
    // Логируем действие
    writeBetLog("admin", {
      username: username,
      action: "Добавлена новость",
      details: `Тип: ${type}, Заголовок: ${title}`
    });
    
    // Отправляем уведомление админу
    const typeEmojis = {
      'tournament': '🏆',
      'system': '⚙️',
      'achievement': '🏅',
      'announcement': '📣'
    };
    
    const time = new Date().toLocaleString("ru-RU", {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const adminMessage = 
      `📢 <b>НОВОСТЬ ОПУБЛИКОВАНА</b>\n\n` +
      `${typeEmojis[type]} Тип: ${type}\n` +
      `📝 Заголовок: ${title}\n` +
      `💬 Текст: ${message}\n\n` +
      `👤 Автор: ${username}\n` +
      `🕐 Время: ${time}`;
    
    try {
      await sendAdminNotification(adminMessage);
    } catch (error) {
      console.error("Ошибка отправки уведомления админу:", error);
    }
    
    res.json({ success: true, news });
  } catch (error) {
    console.error("❌ Ошибка добавления новости:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
