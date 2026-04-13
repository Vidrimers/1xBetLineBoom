import Parser from "rss-parser";
import { db } from "../database/db.js";

// Инициализация RSS парсера
const rssParser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});

// Кэш для RSS новостей (обновляется раз в 30 минут)
let rssNewsCache = {
  data: null,
  timestamp: 0,
  ttl: 30 * 60 * 1000 // 30 минут
};

// Фильтрация новостей по турниру
function filterNewsByTournament(news, tournament) {
  if (tournament === 'all') {
    return news;
  }

  const includeKeywords = db.prepare(`
    SELECT keyword, priority FROM rss_keywords 
    WHERE tournament = ? AND type = 'include'
    ORDER BY priority DESC
  `).all(tournament);

  const excludeKeywords = db.prepare(`
    SELECT keyword FROM rss_keywords 
    WHERE (tournament = ? OR tournament = 'all') AND type = 'exclude'
  `).all(tournament);

  if (includeKeywords.length === 0) {
    return [];
  }

  const filteredNews = news.filter(item => {
    const text = `${item.title} ${item.description}`.toLowerCase();

    const hasExclude = excludeKeywords.some(kw =>
      text.includes(kw.keyword.toLowerCase())
    );

    if (hasExclude) return false;

    const matchedKeyword = includeKeywords.find(kw =>
      text.includes(kw.keyword.toLowerCase())
    );

    if (matchedKeyword) {
      item._priority = matchedKeyword.priority;
      return true;
    }

    return false;
  });

  filteredNews.sort((a, b) => (b._priority || 0) - (a._priority || 0));
  filteredNews.forEach(item => delete item._priority);

  return filteredNews;
}

export { rssParser, rssNewsCache, filterNewsByTournament };
