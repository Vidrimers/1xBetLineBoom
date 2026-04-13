// Middleware: проверка авторизации администратора
// Используется для /admin/notifications/* эндпоинтов

/**
 * Простая защита: требует ADMIN_LOGIN как query param (?admin=ADMIN_LOGIN)
 * или в заголовке x-admin-token
 * @returns {boolean} true если авторизован
 */
function checkAdminAuth(req, res) {
  const admin = req.query.admin || req.headers["x-admin-token"];
  if (!process.env.ADMIN_LOGIN) return false;
  return admin && admin === process.env.ADMIN_LOGIN;
}

export { checkAdminAuth };
