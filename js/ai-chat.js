// AI Chat Frontend
class AIChat {
  constructor() {
    this.messages = [];
    this.isOpen = false;
    this.isTyping = false;
    this.userAvatar = '/img/default-avatar.jpg'; // Дефолтный аватар
    
    this.init();
  }

  async init() {
    // Создаём элементы чата
    this.createChatElements();
    
    // Привязываем события
    this.bindEvents();
    
    // Загружаем аватар пользователя
    await this.loadUserAvatar();
    
    // Загружаем историю из localStorage
    this.loadHistory();
  }

  async loadUserAvatar() {
    // Получаем текущего пользователя
    if (window.currentUser && window.currentUser.id) {
      try {
        const response = await fetch(`/api/user/${window.currentUser.id}/profile?viewerUsername=${encodeURIComponent(window.currentUser.username)}`);
        if (response.ok) {
          const userData = await response.json();
          this.userAvatar = userData.avatar || '/img/default-avatar.jpg';
        }
      } catch (error) {
        console.error('Ошибка загрузки аватара:', error);
      }
    }
  }

  createChatElements() {
    // Плавающая кнопка
    const chatBtn = document.createElement('button');
    chatBtn.className = 'ai-chat-btn';
    chatBtn.id = 'aiChatBtn';
    chatBtn.innerHTML = `
      <span style="font-size: 36px; position: relative;">
        ⚽
        <span style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 14px; font-weight: bold; color: #667eea; text-shadow: 0 0 3px white, 0 0 3px white, 0 0 3px white;">AI</span>
      </span>
    `;
    document.body.appendChild(chatBtn);

    // Окно чата
    const chatWindow = document.createElement('div');
    chatWindow.className = 'ai-chat-window';
    chatWindow.id = 'aiChatWindow';
    chatWindow.innerHTML = `
      <div class="ai-chat-header">
        <h3>🤖 AI Помощник</h3>
        <button class="ai-chat-close" id="aiChatClose">×</button>
      </div>
      <div class="ai-chat-messages" id="aiChatMessages"></div>
      <div class="ai-chat-input-area">
        <input 
          type="text" 
          class="ai-chat-input" 
          id="aiChatInput" 
          placeholder="Спроси что-нибудь..."
          autocomplete="off"
        >
        <button class="ai-chat-send" id="aiChatSend">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `;
    document.body.appendChild(chatWindow);

    // Сохраняем ссылки на элементы
    this.chatBtn = chatBtn;
    this.chatWindow = chatWindow;
    this.chatMessages = document.getElementById('aiChatMessages');
    this.chatInput = document.getElementById('aiChatInput');
    this.chatSend = document.getElementById('aiChatSend');
    this.chatClose = document.getElementById('aiChatClose');
  }

  bindEvents() {
    // Открытие чата
    this.chatBtn.addEventListener('click', () => this.open());
    
    // Закрытие чата
    this.chatClose.addEventListener('click', () => this.close());
    
    // Отправка сообщения
    this.chatSend.addEventListener('click', () => this.sendMessage());
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
  }

  open() {
    this.isOpen = true;
    this.chatWindow.classList.add('active');
    this.chatInput.focus();
    
    // Показываем приветствие если чат пустой
    if (this.messages.length === 0) {
      this.addWelcomeMessage();
    }
  }

  close() {
    this.isOpen = false;
    this.chatWindow.classList.remove('active');
  }

  addWelcomeMessage() {
    this.addAIMessage('Привет! 👋 Я AI-помощник по ставкам на футбол. Могу помочь с анализом матчей, статистикой команд и поиском выгодных ставок. Что тебя интересует?');
  }

  async sendMessage() {
    const text = this.chatInput.value.trim();
    if (!text || this.isTyping) return;

    // Добавляем сообщение пользователя
    this.addUserMessage(text);
    this.chatInput.value = '';

    // Сохраняем в историю
    this.messages.push({ role: 'user', content: text });
    this.saveHistory();

    // Показываем индикатор печатает
    this.showTyping();

    try {
      // Отправляем на сервер
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: this.messages
        })
      });

      const data = await response.json();
      
      this.hideTyping();

      if (data.error) {
        this.addAIMessage('Извини, произошла ошибка. Попробуй ещё раз.');
        return;
      }

      // Добавляем ответ AI
      this.addAIMessage(data.text, data.buttons, data.buttonType);
      
      // Сохраняем в историю
      this.messages.push({ role: 'assistant', content: data.text });
      this.saveHistory();

    } catch (error) {
      console.error('Ошибка отправки сообщения:', error);
      this.hideTyping();
      this.addAIMessage('Не удалось отправить сообщение. Проверь подключение к интернету.');
    }
  }

  addUserMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user';
    
    messageDiv.innerHTML = `
      <div class="message-avatar">
        <img src="${this.userAvatar}" alt="User" onerror="this.src='/img/default-avatar.jpg'">
      </div>
      <div class="message-content">${this.escapeHtml(text)}</div>
    `;
    this.chatMessages.appendChild(messageDiv);
    this.scrollToBottom();
  }

  addAIMessage(text, buttons = null, buttonType = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ai';
    
    let buttonsHTML = '';
    if (buttons && buttons.length > 0) {
      buttonsHTML = '<div class="message-buttons">';
      buttons.forEach(btn => {
        buttonsHTML += `<button class="message-button" data-action="${buttonType}" data-value="${btn.id}">${this.escapeHtml(btn.label)}</button>`;
      });
      buttonsHTML += '</div>';
    }
    
    messageDiv.innerHTML = `
      <div class="message-avatar">
        <img src="/img/default-avatar.jpg" alt="AI" onerror="this.src='/img/default-avatar.jpg'">
      </div>
      <div class="message-content">
        ${this.escapeHtml(text)}
        ${buttonsHTML}
      </div>
    `;
    
    this.chatMessages.appendChild(messageDiv);
    
    // Привязываем события к кнопкам
    if (buttons) {
      const buttonElements = messageDiv.querySelectorAll('.message-button');
      buttonElements.forEach(btn => {
        btn.addEventListener('click', () => this.handleButtonClick(btn));
      });
    }
    
    this.scrollToBottom();
  }

  async handleButtonClick(button) {
    const action = button.dataset.action;
    const value = button.dataset.value;
    const label = button.textContent;

    // Добавляем выбор пользователя как сообщение
    this.addUserMessage(label);
    this.messages.push({ role: 'user', content: label });

    // Показываем индикатор
    this.showTyping();

    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: this.messages,
          action: action === 'tournaments' ? 'select_tournament' : 'select_match',
          actionData: value
        })
      });

      const data = await response.json();
      this.hideTyping();

      if (data.error) {
        this.addAIMessage('Извини, произошла ошибка.');
        return;
      }

      this.addAIMessage(data.text, data.buttons, data.buttonType);
      this.messages.push({ role: 'assistant', content: data.text });
      this.saveHistory();

    } catch (error) {
      console.error('Ошибка обработки кнопки:', error);
      this.hideTyping();
      this.addAIMessage('Не удалось обработать запрос.');
    }
  }

  showTyping() {
    this.isTyping = true;
    this.chatSend.disabled = true;
    
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message ai typing-message';
    typingDiv.innerHTML = `
      <div class="message-avatar">
        <img src="/img/default-avatar.jpg" alt="AI" onerror="this.src='/img/default-avatar.jpg'">
      </div>
      <div class="message-content typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    `;
    this.chatMessages.appendChild(typingDiv);
    this.scrollToBottom();
  }

  hideTyping() {
    this.isTyping = false;
    this.chatSend.disabled = false;
    
    const typingMsg = this.chatMessages.querySelector('.typing-message');
    if (typingMsg) {
      typingMsg.remove();
    }
  }

  scrollToBottom() {
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  saveHistory() {
    try {
      // Сохраняем только последние 20 сообщений
      const recentMessages = this.messages.slice(-20);
      localStorage.setItem('ai-chat-history', JSON.stringify(recentMessages));
    } catch (error) {
      console.error('Ошибка сохранения истории:', error);
    }
  }

  loadHistory() {
    try {
      const saved = localStorage.getItem('ai-chat-history');
      if (saved) {
        this.messages = JSON.parse(saved);
        
        // Восстанавливаем сообщения в UI
        this.messages.forEach(msg => {
          if (msg.role === 'user') {
            this.addUserMessage(msg.content);
          } else {
            this.addAIMessage(msg.content);
          }
        });
      }
    } catch (error) {
      console.error('Ошибка загрузки истории:', error);
      this.messages = [];
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  window.aiChat = new AIChat();
});
