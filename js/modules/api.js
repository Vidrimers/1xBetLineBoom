// Wrapper для fetch с автоматической отправкой session_token
const originalFetch = window.fetch;
window.fetch = function(...args) {
  let [url, options] = args;
  
  // Если options не передан или это не объект, создаем пустой объект
  if (!options || typeof options !== 'object') {
    options = {};
  }
  
  // Добавляем session_token в заголовки если он есть
  const sessionToken = localStorage.getItem("sessionToken");
  if (sessionToken) {
    // Создаем новый объект headers чтобы не мутировать оригинальный
    options.headers = {
      ...(options.headers || {}),
      'x-session-token': sessionToken
    };
  }
  
  return originalFetch(url, options);
};

export { originalFetch };
