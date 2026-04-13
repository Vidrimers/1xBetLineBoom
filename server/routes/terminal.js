import { Router } from 'express';
import fs from 'fs';
import { terminalLogs, clearTerminalLogs } from '../utils/logger.js';
import { TERMINAL_LOGS_PATH } from '../config.js';

const router = Router();

// GET /api/terminal-logs - получить логи терминала
router.get("/api/terminal-logs", (req, res) => {
  try {
    const logs = terminalLogs.join("\n");
    res.json({
      success: true,
      logs: logs || "[Логи пусты]",
      count: terminalLogs.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// DELETE /api/terminal-logs - очистить логи терминала
router.delete("/api/terminal-logs", (req, res) => {
  try {
    clearTerminalLogs();

    // Очищаем файл логов
    try {
      fs.writeFileSync(TERMINAL_LOGS_PATH, "", "utf-8");
    } catch (err) {
      console.error("Ошибка при очистке файла логов:", err);
    }

    res.json({
      success: true,
      message: "✅ Логи терминала очищены",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
