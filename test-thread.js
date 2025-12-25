import { sendGroupNotification } from "./OnexBetLineBoombot.js";

// Даём боту время на инициализацию
setTimeout(async () => {
  console.log("Тестируем отправку сообщения в группу...");
  try {
    await sendGroupNotification("🧪 Тестовое сообщение для проверки потока");
    console.log("✅ Сообщение отправлено!");
  } catch (err) {
    console.error("❌ Ошибка при отправке:", err.message);
  }
  process.exit(0);
}, 3000);
