#!/usr/bin/env node

const Database = require('better-sqlite3');

const db = new Database('1xBetLineBoom.db');

console.log('📅 Проверка дат матчей Лиги чемпионов\n');

try {
  // Получаем матчи за последние 3 дня
  const matches = db.prepare(`
    SELECT 
      m.id,
      m.team1_name,
      m.team2_name,
      m.match_date,
      DATE(m.match_date) as date_only,
      m.status,
      m.round,
      e.name as event_name
    FROM matches m
    JOIN events e ON m.event_id = e.id
    WHERE e.name LIKE '%Лига чемпионов%'
      AND DATE(m.match_date) >= DATE('now', '-3 days')
    ORDER BY m.match_date DESC
  `).all();
  
  console.log(`Найдено матчей: ${matches.length}\n`);
  
  matches.forEach(match => {
    console.log(`ID: ${match.id}`);
    console.log(`  Матч: ${match.team1_name} - ${match.team2_name}`);
    console.log(`  Дата/время: ${match.match_date}`);
    console.log(`  Дата (DATE): ${match.date_only}`);
    console.log(`  Статус: ${match.status}`);
    console.log(`  Тур: ${match.round}`);
    console.log(`  Турнир: ${match.event_name}`);
    console.log('');
  });
  
  // Проверяем что возвращает getActiveDates
  console.log('\n📊 Активные даты (как в getActiveDates):\n');
  
  const activeDates = db.prepare(`
    SELECT DISTINCT 
      m.event_id,
      e.icon,
      m.round,
      DATE(m.match_date) as date,
      COUNT(*) as total_matches,
      COUNT(CASE WHEN m.status = 'finished' THEN 1 END) as finished_matches
    FROM matches m
    JOIN events e ON m.event_id = e.id
    WHERE m.match_date IS NOT NULL
      AND DATE(m.match_date) >= DATE('now', '-2 days')
      AND DATE(m.match_date) <= DATE('now', '+3 days')
    GROUP BY m.event_id, e.icon, m.round, DATE(m.match_date)
    HAVING COUNT(CASE WHEN m.status = 'finished' THEN 1 END) > 0
    ORDER BY m.match_date
  `).all();
  
  activeDates.forEach(date => {
    console.log(`Дата: ${date.date} | Тур: ${date.round}`);
    console.log(`  Event ID: ${date.event_id} | Icon: ${date.icon}`);
    console.log(`  Матчей: ${date.total_matches} | Завершено: ${date.finished_matches}`);
    console.log('');
  });
  
  // Проверяем текущее время сервера
  const serverTime = db.prepare("SELECT datetime('now') as now, date('now') as today").get();
  console.log(`\n⏰ Время сервера (UTC):`);
  console.log(`  Сейчас: ${serverTime.now}`);
  console.log(`  Сегодня: ${serverTime.today}`);
  
} catch (error) {
  console.error('❌ Ошибка:', error.message);
} finally {
  db.close();
}
