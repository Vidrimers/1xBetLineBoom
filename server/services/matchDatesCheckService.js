// ========== СЕРВИС ПРОВЕРКИ ДАТ МАТЧЕЙ ==========
// Сверка match_date в БД с реальными датами SStats, исправление расхождений,
// автопроверка раз в сутки (05:00) с уведомлением админу в ТГ

import { db } from "../database/db.js";
import {
  SSTATS_API_KEY,
  SSTATS_API_BASE,
  SSTATS_LEAGUE_MAPPING,
  ICON_TO_COMPETITION,
} from "../config.js";
import {
  normalizeTeamNameForAPI,
  translateTeamNameToEnglish,
} from "../utils/helpers.js";
import { registerCallbackHandler } from "../../OnexBetLineBoombot.js";

// Ключи system_settings:
//   match_dates_autocheck_enabled - 'true'/'false', включена ли автопроверка
//   match_dates_last_check        - 'YYYY-MM-DD' последний запуск автопроверки
const AUTO_CHECK_HOUR = 5; // 05:00

// Хранилище пакетов исправлений для кнопки в ТГ (fixdates:<id>)
db.exec(`
  CREATE TABLE IF NOT EXISTS match_date_fix_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ===== Настройки =====

export function getAutoCheckEnabled() {
  const row = db
    .prepare("SELECT value FROM system_settings WHERE key = 'match_dates_autocheck_enabled'")
    .get();
  return row ? row.value === "true" : false;
}

export function setAutoCheckEnabled(enabled) {
  const value = enabled ? "true" : "false";
  const existing = db
    .prepare("SELECT id FROM system_settings WHERE key = 'match_dates_autocheck_enabled'")
    .get();
  if (existing) {
    db.prepare(
      "UPDATE system_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'match_dates_autocheck_enabled'"
    ).run(value);
  } else {
    db.prepare(
      "INSERT INTO system_settings (key, value) VALUES ('match_dates_autocheck_enabled', ?)"
    ).run(value);
  }
}

function getLastCheckDate() {
  const row = db
    .prepare("SELECT value FROM system_settings WHERE key = 'match_dates_last_check'")
    .get();
  return row ? row.value : null;
}

function setLastCheckDate(dateStr) {
  const existing = db
    .prepare("SELECT id FROM system_settings WHERE key = 'match_dates_last_check'")
    .get();
  if (existing) {
    db.prepare(
      "UPDATE system_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'match_dates_last_check'"
    ).run(dateStr);
  } else {
    db.prepare(
      "INSERT INTO system_settings (key, value) VALUES ('match_dates_last_check', ?)"
    ).run(dateStr);
  }
}

// ===== Работа с SStats =====

// Год сезона: для лиг со сменой года (не кубки) в первой половине года берём предыдущий
function seasonYearFor(dateStr) {
  const d = new Date(dateStr);
  let year = d.getFullYear();
  if (d.getMonth() < 6) year -= 1;
  return year;
}

// Один запрос на турнир: все матчи сезона (как в autoCountingService)
async function fetchSeasonGames(leagueId, year) {
  const url = `${SSTATS_API_BASE}/games/list?LeagueId=${leagueId}&Year=${year}`;
  const response = await fetch(url, { headers: { "X-API-Key": SSTATS_API_KEY } });
  if (!response.ok) {
    throw new Error(`SStats API ошибка: ${response.status}`);
  }
  const data = await response.json();
  if (data.status !== "OK") {
    throw new Error(`SStats API статус: ${data.status}`);
  }
  return data.data || [];
}

// Номер тура из названия: "Тур 12" -> 12, "Regular Season - 4" -> 4, "League Stage - 2" -> 2
function extractRoundNumber(name) {
  const m = String(name || "").match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

function teamPairKey(name1, name2, competitionCode) {
  const n1 = normalizeTeamNameForAPI(translateTeamNameToEnglish(name1, competitionCode));
  const n2 = normalizeTeamNameForAPI(translateTeamNameToEnglish(name2, competitionCode));
  return [n1, n2].sort().join("|");
}

// Поиск матча в API по паре команд. Пара играет дважды за сезон, поэтому
// первый попавшийся — не тот: скоринг кандидатов — тур (+2), дом/гост (+1),
// тай-брейк по ближайшей дате. Для кубковых форматов тур не парсится —
// деградирует на дом/гост + дату.
function findApiGame(dbMatch, apiGames, competitionCode) {
  const dbHome = normalizeTeamNameForAPI(translateTeamNameToEnglish(dbMatch.team1_name, competitionCode));
  const dbAway = normalizeTeamNameForAPI(translateTeamNameToEnglish(dbMatch.team2_name, competitionCode));
  const dbRoundNum = extractRoundNumber(dbMatch.round);
  const dbTime = dbMatch.match_date ? new Date(dbMatch.match_date).getTime() : NaN;

  let best = null;
  let bestScore = -1;
  let bestDateDiff = Infinity;

  for (const g of apiGames) {
    const apiHome = normalizeTeamNameForAPI(translateTeamNameToEnglish(g.homeTeam.name, competitionCode));
    const apiAway = normalizeTeamNameForAPI(translateTeamNameToEnglish(g.awayTeam.name, competitionCode));

    const exact = apiHome === dbHome && apiAway === dbAway;
    const reversed = apiHome === dbAway && apiAway === dbHome;
    if (!exact && !reversed) continue;

    let score = 0;
    const gameRoundNum = extractRoundNumber(g.roundName);
    if (dbRoundNum !== null && gameRoundNum !== null && dbRoundNum === gameRoundNum) score += 2;
    if (exact) score += 1;

    const apiTime = new Date(g.date).getTime();
    const dateDiff = Number.isNaN(dbTime) || Number.isNaN(apiTime) ? Infinity : Math.abs(apiTime - dbTime);

    if (score > bestScore || (score === bestScore && dateDiff < bestDateDiff)) {
      best = g;
      bestScore = score;
      bestDateDiff = dateDiff;
    }
  }

  return best;
}

function formatDateTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ===== Проверка =====

/**
 * Сверить даты матчей турнира с SStats.
 * @param {number} eventId - турнир
 * @param {string|null} roundFilter - тур ("Тур 12") или null = все туры
 * @param {Map} cache - кеш запросов к API (leagueId -> games), чтобы не дублировать
 * @returns {{event, mismatches, notInSstats, notInDb, error?}}
 */
export async function checkEventMatches(eventId, roundFilter = null, cache = new Map()) {
  const event = db.prepare("SELECT id, name, icon FROM events WHERE id = ?").get(eventId);
  if (!event) return { error: "Турнир не найден" };

  const competitionCode = ICON_TO_COMPETITION[event.icon] || null;
  const leagueId = competitionCode ? SSTATS_LEAGUE_MAPPING[competitionCode] : null;
  if (!leagueId) {
    return { error: `Не удалось определить лигу SStats для турнира "${event.name}"` };
  }

  // Все матчи тура/турнира: незавершённые — для сверки дат, все — для поиска "нет в БД"
  const allDbMatches = db
    .prepare(
      `SELECT id, team1_name, team2_name, match_date, status, winner, round
       FROM matches
       WHERE event_id = ? ${roundFilter ? "AND round = ?" : ""}
       ORDER BY match_date`
    )
    .all(...(roundFilter ? [eventId, roundFilter] : [eventId]));

  if (allDbMatches.length === 0) {
    return { error: "Матчи не найдены" };
  }

  // Сверяем только несыгранные pending (правило: начавшиеся/завершённые/отменённые не трогаем)
  const checkMatches = allDbMatches.filter((m) => !m.winner && m.status === "pending");

  // Кеш запросов: один запрос на турнир/сезон
  const sampleMatch = checkMatches.find((m) => m.match_date) || allDbMatches.find((m) => m.match_date);
  const year = sampleMatch ? seasonYearFor(sampleMatch.match_date) : new Date().getFullYear();
  const cacheKey = `${leagueId}:${year}`;
  let apiGames = cache.get(cacheKey);
  if (!apiGames) {
    apiGames = await fetchSeasonGames(leagueId, year);
    cache.set(cacheKey, apiGames);
  }

  const mismatches = [];
  const notInSstats = [];
  const matchedApiIds = new Set();

  for (const m of checkMatches) {
    const apiGame = findApiGame(m, apiGames, competitionCode);
    if (!apiGame) {
      notInSstats.push({
        match_id: m.id,
        team1_name: m.team1_name,
        team2_name: m.team2_name,
        db_date: m.match_date,
        status: m.status,
      });
      continue;
    }
    matchedApiIds.add(apiGame.id);

    const dbTime = new Date(m.match_date).getTime();
    const apiTime = new Date(apiGame.date).getTime();
    if (dbTime !== apiTime) {
      mismatches.push({
        match_id: m.id,
        team1_name: m.team1_name,
        team2_name: m.team2_name,
        round: m.round,
        status: m.status,
        db_date: m.match_date,
        real_date: apiGame.date,
        fixable: m.status === "pending",
      });
    }
  }

  // Матчи, которые есть в sstats, но отсутствуют в БД (в пределах проверяемых туров)
  const roundsInScope = [...new Set(checkMatches.map((m) => m.round))];
  const roundNumbers = roundsInScope.map(extractRoundNumber).filter((n) => n !== null);
  const dbPairKeys = new Set(
    allDbMatches.map((m) => teamPairKey(m.team1_name, m.team2_name, competitionCode))
  );

  const notInDb = [];
  for (const g of apiGames) {
    if (matchedApiIds.has(g.id)) continue;
    const gameRoundNum = extractRoundNumber(g.roundName);
    if (gameRoundNum === null || !roundNumbers.includes(gameRoundNum)) continue;
    const key = teamPairKey(g.homeTeam.name, g.awayTeam.name, competitionCode);
    if (dbPairKeys.has(key)) continue;
    notInDb.push({
      team1_name: g.homeTeam.name,
      team2_name: g.awayTeam.name,
      real_date: g.date,
      round: g.roundName,
    });
  }

  return {
    event: { id: event.id, name: event.name },
    checkedAt: new Date().toISOString(),
    mismatches,
    notInSstats,
    notInDb,
  };
}

// ===== Исправление =====

/**
 * Применить исправления дат. Только матчи со статусом 'pending'.
 * @param {Array<{match_id: number, match_date: string}>} fixes
 */
export function applyDateFixes(fixes) {
  const applied = [];
  const skipped = [];

  for (const f of fixes) {
    const match = db
      .prepare("SELECT id, team1_name, team2_name, match_date, status FROM matches WHERE id = ?")
      .get(f.match_id);
    if (!match) {
      skipped.push({ match_id: f.match_id, reason: "матч не найден" });
      continue;
    }
    if (match.status !== "pending") {
      skipped.push({
        match_id: f.match_id,
        team1_name: match.team1_name,
        team2_name: match.team2_name,
        reason: `статус "${match.status}" — не трогаем`,
      });
      continue;
    }
    db.prepare("UPDATE matches SET match_date = ? WHERE id = ?").run(f.match_date, f.match_id);
    applied.push({
      match_id: f.match_id,
      team1_name: match.team1_name,
      team2_name: match.team2_name,
      old_date: match.match_date,
      new_date: f.match_date,
    });
  }

  return { applied, skipped };
}

// ===== Пакет исправлений для кнопки в ТГ =====

function saveFixBatch(payload) {
  const result = db
    .prepare("INSERT INTO match_date_fix_batches (payload) VALUES (?)")
    .run(JSON.stringify(payload));
  return Number(result.lastInsertRowid);
}

function loadFixBatch(batchId) {
  const row = db.prepare("SELECT payload FROM match_date_fix_batches WHERE id = ?").get(batchId);
  return row ? JSON.parse(row.payload) : null;
}

function cleanupOldFixBatches() {
  db.prepare("DELETE FROM match_date_fix_batches WHERE created_at < datetime('now', '-7 days')").run();
}

// ===== Уведомления админу =====

async function sendAdminWithButton(message, replyMarkup) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
    console.log("⚠️ Telegram не настроен, уведомление о датах не отправлено");
    return false;
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_ADMIN_ID,
        text: message,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления админу (даты):", error.message);
    return false;
  }
}

async function editAdminMessage(messageId, text) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_ADMIN_ID,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      }),
    });
  } catch (error) {
    console.error("❌ Ошибка редактирования сообщения (даты):", error.message);
  }
}

// Текст сообщения с расхождениями
function buildReportMessage(results, fixCount) {
  const lines = [`🔍 <b>Проверка дат матчей</b>`, `🕐 ${formatDateTime(new Date().toISOString())}`, ""];

  for (const r of results) {
    if (r.error) {
      lines.push(`⚠️ <b>${r.event ? r.event.name : "Турнир"}:</b> ${r.error}`);
      continue;
    }
    lines.push(`🏆 <b>${r.event.name}</b>`);

    if (r.mismatches.length > 0) {
      for (const m of r.mismatches) {
        const fixMark = m.fixable ? "" : " ⛔ (не pending)";
        lines.push(
          `⚽ ${m.team1_name} - ${m.team2_name} (${m.round})${fixMark}`,
          `   📅 ${formatDateTime(m.db_date)} → <b>${formatDateTime(m.real_date)}</b>`
        );
      }
    }
    if (r.notInSstats.length > 0) {
      lines.push(`⚠️ <b>Есть в БД, нет в sstats:</b>`);
      for (const m of r.notInSstats) {
        lines.push(`   ⚽ ${m.team1_name} - ${m.team2_name} (${formatDateTime(m.db_date)})`);
      }
    }
    if (r.notInDb.length > 0) {
      lines.push(`⚠️ <b>Есть в sstats, нет в БД:</b>`);
      for (const m of r.notInDb) {
        lines.push(`   ⚽ ${m.team1_name} - ${m.team2_name} (${formatDateTime(m.real_date)})`);
      }
    }
    lines.push("");
  }

  if (fixCount > 0) {
    lines.push(`Всего расхождений с датами: ${fixCount}`);
  }
  return lines.join("\n");
}

// Список исправлений для пакета (только pending)
function collectFixes(results) {
  const fixes = [];
  for (const r of results) {
    for (const m of r.mismatches || []) {
      if (m.fixable) {
        fixes.push({
          match_id: m.match_id,
          match_date: m.real_date,
          team1_name: m.team1_name,
          team2_name: m.team2_name,
          old_date: m.db_date,
          round: m.round,
        });
      }
    }
  }
  return fixes;
}

// ===== Автопроверка =====

/**
 * Проверка всех турниров: от ближайшей даты, только незапущенные матчи.
 * Запросы к API последовательно с паузой — без риска для rate limit.
 */
export async function runDailyCheck() {
  console.log("🔍 Запуск автопроверки дат матчей...");
  cleanupOldFixBatches();

  // Незавершённые pending-матчи, сгруппированные по турниру и туру.
  // Фильтруем даты в JS: SQL-сравнение строк ломается на смещении таймзоны (+03:00 / Z)
  // Scope — все добавленные турниры и даты (только pending; начавшиеся/завершённые не трогаем),
  // порядок — от ближайшей к текущему моменту (сегодняшние неначавшиеся — первыми)
  const allGroups = db
    .prepare(
      `SELECT m.event_id, m.round, MIN(m.match_date) as nearest_date
       FROM matches m
       WHERE m.winner IS NULL AND m.status = 'pending' AND m.match_date IS NOT NULL
       GROUP BY m.event_id, m.round`
    )
    .all();

  const nowMs = Date.now();
  const groups = allGroups
    .map((g) => ({ ...g, dist: Math.abs(new Date(g.nearest_date).getTime() - nowMs) }))
    .sort((a, b) => a.dist - b.dist)
    .map(({ event_id, round, nearest_date }) => ({ event_id, round, nearest_date }));

  if (groups.length === 0) {
    console.log("🔍 Нет предстоящих матчей для проверки дат");
    return;
  }

  const cache = new Map();
  const results = [];
  const processedEvents = new Set();

  for (const group of groups) {
    // Пауза между запросами к API (запрос — один на турнир)
    if (!processedEvents.has(group.event_id) && processedEvents.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    processedEvents.add(group.event_id);

    try {
      const result = await checkEventMatches(group.event_id, group.round, cache);
      results.push(result);
    } catch (error) {
      console.error(`❌ Ошибка проверки дат (event ${group.event_id}):`, error.message);
      results.push({ event: null, error: error.message, mismatches: [], notInSstats: [], notInDb: [] });
    }
  }

  const fixes = collectFixes(results);
  const hasFindings = results.some(
    (r) => (r.mismatches && r.mismatches.length) || (r.notInSstats && r.notInSstats.length) || (r.notInDb && r.notInDb.length)
  );

  if (!hasFindings) {
    console.log("✅ Автопроверка дат: расхождений нет");
    return;
  }

  const message = buildReportMessage(results, fixes.length);
  const replyMarkup =
    fixes.length > 0
      ? { inline_keyboard: [[{ text: `🔧 Исправить даты (${fixes.length})`, callback_data: "" }]] }
      : undefined;

  let batchId = null;
  if (fixes.length > 0) {
    batchId = saveFixBatch(fixes);
    replyMarkup.inline_keyboard[0][0].callback_data = `fixdates:${batchId}`;
  }

  await sendAdminWithButton(message, replyMarkup);
  console.log(
    `📨 Автопроверка дат: отправлено админу (расхождений: ${fixes.length}, batch: ${batchId})`
  );
}

/**
 * Планировщик: раз в сутки в 05:00 (с догоном после перезапуска).
 * Запускать один раз при старте сервера.
 */
export function startMatchDatesDailyCheck() {
  const tick = () => {
    try {
      if (!getAutoCheckEnabled()) return;
      const now = new Date();
      if (now.getHours() < AUTO_CHECK_HOUR) return;

      const today = now.toLocaleDateString("en-CA"); // YYYY-MM-DD по локальному времени сервера
      if (getLastCheckDate() === today) return;

      setLastCheckDate(today);
      runDailyCheck().catch((error) =>
        console.error("❌ Ошибка автопроверки дат матчей:", error)
      );
    } catch (error) {
      console.error("❌ Ошибка планировщика проверки дат:", error);
    }
  };

  tick();
  setInterval(tick, 30 * 60 * 1000);
  console.log("🔍 Планировщик проверки дат матчей запущен (ежедневно в 05:00)");
}

// ===== Callback-кнопка "Исправить даты" в ТГ =====

export function handleFixDatesCallback(data, callbackQuery) {
  if (!data.startsWith("fixdates:")) return false;

  const TELEGRAM_ADMIN_ID = parseInt(process.env.TELEGRAM_ADMIN_ID, 10);
  if (callbackQuery.from?.id !== TELEGRAM_ADMIN_ID) {
    return true; // чужие нажатия игнорируем
  }

  const batchId = parseInt(data.split(":")[1], 10);
  const fixes = loadFixBatch(batchId);

  if (!fixes) {
    editAdminMessage(
      callbackQuery.message?.message_id,
      (callbackQuery.message?.text || "Проверка дат матчей") + "\n\n❌ Пакет исправлений не найден (возможно, устарел)"
    );
    return true;
  }

  const { applied, skipped } = applyDateFixes(fixes);

  // Итоговое сообщение: что и какие даты поправлены
  const lines = [`✅ <b>Даты исправлены: ${applied.length}</b>`, ""];
  for (const a of applied) {
    lines.push(
      `⚽ ${a.team1_name} - ${a.team2_name}`,
      `   📅 ${formatDateTime(a.old_date)} → <b>${formatDateTime(a.new_date)}</b>`
    );
  }
  if (skipped.length > 0) {
    lines.push("", `⏭ <b>Пропущено: ${skipped.length}</b>`);
    for (const s of skipped) {
      lines.push(`   ${s.team1_name ? s.team1_name + " - " + s.team2_name + ": " : ""}${s.reason}`);
    }
  }

  sendAdminWithButton(lines.join("\n"), undefined);

  // Помечаем исходное сообщение обработанным и снимаем кнопку
  if (callbackQuery.message?.message_id) {
    const originalText = callbackQuery.message.text || "Проверка дат матчей";
    editAdminMessage(
      callbackQuery.message.message_id,
      `${originalText}\n\n✅ <b>Обработано ${formatDateTime(new Date().toISOString())}</b> — исправлено: ${applied.length}`
    );
  }

  return true;
}

registerCallbackHandler("fixdates:", handleFixDatesCallback);
