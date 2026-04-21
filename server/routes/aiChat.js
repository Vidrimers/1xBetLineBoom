import { Router } from 'express';
import { sendToAI } from '../services/aiChatService.js';
import { buildFullAIContext } from '../utils/aiContext.js';

const router = Router();

/**
 * Очищает markdown разметку для веб-интерфейса
 * @param {string} text - Текст с markdown
 * @returns {string} Очищенный текст
 */
function cleanMarkdownForWeb(text) {
  if (!text) return text;
  
  return text
    // Убираем жирный текст **text** -> text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    // Убираем курсив *text* -> text
    .replace(/\*(.*?)\*/g, '$1')
    // Убираем подчеркивание __text__ -> text
    .replace(/__(.*?)__/g, '$1')
    // Убираем зачеркивание ~~text~~ -> text
    .replace(/~~(.*?)~~/g, '$1')
    // Убираем код `text` -> text
    .replace(/`(.*?)`/g, '$1')
    // Убираем заголовки # -> пустота
    .replace(/^#+\s*/gm, '')
    // Убираем списки - и * в начале строк
    .replace(/^[\s]*[-*]\s+/gm, '• ')
    // Убираем лишние пробелы
    .replace(/\s+/g, ' ')
    .trim();
}

router.post('/api/ai-chat', async (req, res) => {
  console.log('🤖 AI Chat - получен запрос:', req.body);
  
  try {
    const { messages, username, context } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Неверный формат запроса' });
    }

    console.log('🤖 AI Chat - обработка запроса от:', username);

    // Полный контекст из БД
    const lastMessage = messages[messages.length - 1]?.content || '';
    const dbContext = buildFullAIContext(null, username, null, lastMessage);

    // Контекст страницы
    if (context) {
      dbContext.pageContext = `Секция: ${context.section || 'неизвестно'}\nТурнир: ${context.event?.name || 'не выбран'}\nТур: ${context.round || 'не выбран'}\nМодальное окно: ${context.modal || 'закрыто'}`;
    }

    console.log('🤖 AI Chat - отправляем в AI, контекст:', Object.keys(dbContext));

    const result = await sendToAI(messages, dbContext);

    console.log('🤖 AI Chat - ответ от AI получен:', result.success, result.provider);

    if (!result.success) {
      return res.json({ error: result.text, text: result.text });
    }

    // Очищаем markdown разметку для веб-интерфейса
    const cleanText = cleanMarkdownForWeb(result.text);

    res.json({ text: cleanText, provider: result.provider });

  } catch (error) {
    console.error('❌ Ошибка AI-чата:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера', text: 'Произошла ошибка. Попробуй позже.' });
  }
});

export default router;
