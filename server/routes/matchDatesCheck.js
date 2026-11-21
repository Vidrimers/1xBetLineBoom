// ========== API ПРОВЕРКИ ДАТ МАТЧЕЙ ==========
// Ручная проверка/исправление дат + управление автопроверкой

import express from "express";
import { db } from "../database/db.js";
import {
  checkEventMatches,
  applyDateFixes,
  getAutoCheckEnabled,
  setAutoCheckEnabled,
} from "../services/matchDatesCheckService.js";

const router = express.Router();

function requireAdmin(req, res) {
  const ADMIN_DB_NAME = process.env.ADMIN_DB_NAME;
  if (req.authenticatedUsername !== ADMIN_DB_NAME) {
    res.status(403).json({ error: "Доступ запрещён" });
    return false;
  }
  return true;
}

// POST /api/admin/match-dates/check - Сверить даты матчей с SStats
// body: { eventId: number, round?: string } — без round проверяются все туры
router.post("/api/admin/match-dates/check", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const { eventId, round } = req.body;
  if (!eventId) {
    return res.status(400).json({ error: "Не указан турнир" });
  }

  try {
    const result = await checkEventMatches(eventId, round || null);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("❌ Ошибка проверки дат матчей:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/match-dates/fix - Исправить даты (только pending)
// body: { fixes: [{ match_id, match_date }] }
router.post("/api/admin/match-dates/fix", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const { fixes } = req.body;
  if (!Array.isArray(fixes) || fixes.length === 0) {
    return res.status(400).json({ error: "Нет данных для исправления" });
  }

  try {
    const result = applyDateFixes(fixes);
    console.log(`🔧 Ручное исправление дат: применено ${result.applied.length}, пропущено ${result.skipped.length}`);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("❌ Ошибка исправления дат матчей:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/match-dates/settings - Статус автопроверки
router.get("/api/admin/match-dates/settings", (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const enabled = getAutoCheckEnabled();
    const lastRow = db
      .prepare("SELECT value FROM system_settings WHERE key = 'match_dates_last_check'")
      .get();
    res.json({
      success: true,
      autocheck_enabled: enabled,
      last_check: lastRow ? lastRow.value : null,
    });
  } catch (error) {
    console.error("❌ Ошибка чтения настроек проверки дат:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/match-dates/settings - Включить/выключить автопроверку
// body: { enabled: boolean }
router.post("/api/admin/match-dates/settings", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const { enabled } = req.body;
  try {
    setAutoCheckEnabled(!!enabled);
    console.log(`🔍 Автопроверка дат матчей: ${enabled ? "включена" : "выключена"}`);
    res.json({ success: true, autocheck_enabled: !!enabled });
  } catch (error) {
    console.error("❌ Ошибка сохранения настройки проверки дат:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
