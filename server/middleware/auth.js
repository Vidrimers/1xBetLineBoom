import { db } from '../database/db.js';

/**
 * Middleware: проверяет x-session-token заголовок.
 * При успехе кладёт req.authenticatedUserId.
 * Возвращает 401 если токен отсутствует или невалидный.
 */
function requireAuth(req, res, next) {
  const sessionToken = req.headers['x-session-token'];

  if (!sessionToken) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  const session = db.prepare(`
    SELECT user_id FROM sessions WHERE session_token = ?
  `).get(sessionToken);

  if (!session) {
    return res.status(401).json({ error: 'Недействительная сессия' });
  }

  // Обновляем last_activity
  db.prepare(`
    UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE session_token = ?
  `).run(sessionToken);

  req.authenticatedUserId = session.user_id;
  next();
}

/**
 * Middleware: проверяет что req.authenticatedUserId совпадает
 * с user_id/userId из тела или параметров запроса.
 * Админ (ADMIN_DB_NAME) обходит проверку.
 */
function requireOwnership(req, res, next) {
  const authId = req.authenticatedUserId;

  const claimedUserId = parseInt(
    req.body.user_id ?? req.body.userId ?? req.params.userId,
    10
  );

  if (!claimedUserId) {
    return res.status(400).json({ error: 'Не указан user_id' });
  }

  if (authId !== claimedUserId) {
    const authUser = db.prepare('SELECT username FROM users WHERE id = ?').get(authId);
    if (!authUser || authUser.username !== process.env.ADMIN_DB_NAME) {
      return res.status(403).json({ error: 'Нет прав для этого действия' });
    }
  }

  next();
}

/**
 * Простая защита: требует ADMIN_LOGIN как query param или в заголовке x-admin-token
 * @returns {boolean} true если авторизован
 */
function checkAdminAuth(req, res) {
  const admin = req.query.admin || req.headers["x-admin-token"];
  if (!process.env.ADMIN_LOGIN) return false;
  return admin && admin === process.env.ADMIN_LOGIN;
}

export { requireAuth, requireOwnership, checkAdminAuth };
