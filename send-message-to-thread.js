// Одноразовый скрипт для отправки сообщения в тред группы.
// Запустить: node send-message-to-thread.js
// Текст сообщения менять в переменной MESSAGE ниже.

import 'dotenv/config';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = parseInt(process.env.TELEGRAM_CHAT_ID);
const THREAD_ID = parseInt(process.env.THREAD_ID);

const MESSAGE = 'СООБЩЕНИЕ, КОТОРОЕ ОТПРАВИТСЯ в THREAD';

async function send() {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      message_thread_id: THREAD_ID,
      text: MESSAGE,
      parse_mode: 'HTML'
    })
  });
  const data = await response.json();
  if (data.ok) {
    console.log('✅ Сообщение отправлено!');
  } else {
    console.error('❌ Ошибка:', data.description);
  }
}

send();
