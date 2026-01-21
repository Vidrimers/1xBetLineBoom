const SERVER_URL = 'http://localhost:1984';

async function triggerAutoCounting() {
  try {
    console.log('\n🤖 Запуск автоподсчета для 2026-01-20 | Тур 7...\n');
    
    const response = await fetch(`${SERVER_URL}/api/admin/trigger-auto-counting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: 22,
        date: '2026-01-20',
        round: 'Тур 7'
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅', data.message);
    } else {
      console.log('❌ Ошибка:', response.status);
    }
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

triggerAutoCounting();
