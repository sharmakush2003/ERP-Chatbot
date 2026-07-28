(function () {
  if (window.DigifyERPChatbotInitialized) return;
  window.DigifyERPChatbotInitialized = true;

  let scriptSrc = '';
  if (document.currentScript) {
    scriptSrc = document.currentScript.src;
  } else {
    const scripts = document.getElementsByTagName('script');
    for (let s of scripts) {
      if (s.src && s.src.includes('widget.js')) {
        scriptSrc = s.src;
        break;
      }
    }
  }

  let serverBaseUrl = 'http://localhost:3000';
  if (scriptSrc) {
    try {
      const url = new URL(scriptSrc);
      serverBaseUrl = url.origin;
    } catch (e) {}
  }

  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap';
  document.head.appendChild(fontLink);

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = serverBaseUrl + '/widget.css';
  document.head.appendChild(styleLink);

  const container = document.createElement('div');
  container.id = 'digify-chatbot-root';
  container.innerHTML = `
    <button class="digify-chat-trigger" id="digifyTriggerBtn" title="Chat with Digify ERP AI">
      <svg viewBox="0 0 24 24">
        <path d="M12 2C6.477 2 2 6.477 2 12c0 1.82.487 3.53 1.338 5.008L2.05 21.364a1 1 0 0 0 1.22 1.22l4.356-1.288A9.957 9.957 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.96 7.96 0 0 1-4.218-1.2l-.33-.2-.105-.064-2.83.837.837-2.83-.064-.105-.2-.33A7.96 7.96 0 0 1 4 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/>
        <path d="M8 11h8v2H8zm0-4h8v2H8zm0 8h5v2H8z"/>
      </svg>
    </button>

    <div class="digify-chat-window" id="digifyChatWindow">
      <div class="digify-chat-header">
        <div class="digify-header-info">
          <div class="digify-avatar">🤖</div>
          <div class="digify-header-text">
            <h3>Digify ERP AI <span class="digify-badge">Groq API</span></h3>
            <p>Real-time ERP Search Assistant</p>
          </div>
        </div>
        <button class="digify-close-btn" id="digifyCloseBtn" title="Close Chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="digify-chat-body" id="digifyChatBody">
        <div class="digify-msg ai">
          <div class="digify-msg-content">
            👋 **Welcome to Digify Soft ERP AI!**<br>
            I'm connected directly to your ERP REST APIs.<br><br>
            *Select an enquiry option below:*
            - 🛒 **Sales Reports** (Month / Day / Year)
            - 📦 **Purchase Reports** (Month / Day / Year)
          </div>
          <span class="digify-msg-time">Just now</span>
        </div>
      </div>

      <div class="digify-chips-container">
        <button class="digify-chip" data-prompt="Sales">🛒 Sales</button>
        <button class="digify-chip" data-prompt="Purchases">📦 Purchases</button>
        <button class="digify-chip" data-prompt="Dispatch for the Month">🚚 Dispatch Report</button>
        <button class="digify-chip" data-prompt="Total Inventory Summary">🏭 Inventory Total</button>
        <button class="digify-chip" data-prompt="Inventory for Bath Rug">🔎 Product Lookup</button>
        <button class="digify-chip" data-prompt="Top Customers and Vendors">🏆 Top Customers</button>
        <button class="digify-chip" data-prompt="Low Stock Alerts">⚠️ Low Stock</button>
      </div>

      <div class="digify-chat-footer">
        <div class="digify-input-wrapper">
          <input type="text" id="digifyInput" placeholder="Ask anything about ERP data..." autocomplete="off">
          <button class="digify-mic-btn" id="digifyMicBtn" title="Voice Search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </button>
          <button class="digify-send-btn" id="digifySendBtn" title="Send Message">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  const triggerBtn = document.getElementById('digifyTriggerBtn');
  const closeBtn = document.getElementById('digifyCloseBtn');
  const chatWindow = document.getElementById('digifyChatWindow');
  const chatBody = document.getElementById('digifyChatBody');
  const inputEl = document.getElementById('digifyInput');
  const sendBtn = document.getElementById('digifySendBtn');
  const micBtn = document.getElementById('digifyMicBtn');
  const chips = document.querySelectorAll('.digify-chip');

  let history = [];
  let isThinking = false;

  function toggleWindow() {
    chatWindow.classList.toggle('active');
    if (chatWindow.classList.contains('active')) {
      inputEl.focus();
    }
  }

  triggerBtn.addEventListener('click', toggleWindow);
  closeBtn.addEventListener('click', toggleWindow);

  function parseMarkdown(text) {
    if (!text) return '';
    let html = text
      .replace(/<(?!(\/?(div|button|span|p|strong|em|code|table|tr|th|td|br|h[1-6])\b))/gi, '&lt;')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/^\- (.*$)/gim, '• $1<br>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
    return html;
  }

  function appendMessage(sender, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `digify-msg ${sender}`;

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgDiv.innerHTML = `
      <div class="digify-msg-content">${parseMarkdown(text)}</div>
      <span class="digify-msg-time">${timeStr}</span>
    `;

    chatBody.appendChild(msgDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'digify-msg ai';
    typingDiv.id = 'digifyTyping';
    typingDiv.innerHTML = `
      <div class="digify-msg-content">
        <div class="digify-typing-indicator">
          <div class="digify-typing-dot"></div>
          <div class="digify-typing-dot"></div>
          <div class="digify-typing-dot"></div>
        </div>
      </div>
    `;
    chatBody.appendChild(typingDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function removeTypingIndicator() {
    const indicator = document.getElementById('digifyTyping');
    if (indicator) indicator.remove();
  }

  async function sendMessage(text) {
    const msg = text || inputEl.value.trim();
    if (!msg || isThinking) return;

    inputEl.value = '';
    appendMessage('user', msg);
    history.push({ role: 'user', content: msg });

    isThinking = true;
    showTypingIndicator();

    try {
      const response = await fetch(serverBaseUrl + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: history })
      });

      const data = await response.json();
      removeTypingIndicator();

      if (data.reply) {
        appendMessage('ai', data.reply);
        history.push({ role: 'assistant', content: data.reply });
      } else {
        appendMessage('ai', '⚠️ Received empty response from server.');
      }
    } catch (err) {
      removeTypingIndicator();
      appendMessage('ai', `❌ Network Error: Could not reach ERP Chatbot server.`);
    } finally {
      isThinking = false;
    }
  }

  sendBtn.addEventListener('click', () => sendMessage());
  inputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      sendMessage(prompt);
    });
  });

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;

    micBtn.addEventListener('click', () => {
      if (micBtn.classList.contains('listening')) {
        recognition.stop();
      } else {
        recognition.start();
      }
    });

    recognition.onstart = () => {
      micBtn.classList.add('listening');
      inputEl.placeholder = 'Listening... Speak now';
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      inputEl.value = transcript;
      sendMessage(transcript);
    };

    recognition.onend = () => {
      micBtn.classList.remove('listening');
      inputEl.placeholder = 'Ask anything about ERP data...';
    };
  } else {
    micBtn.style.display = 'none';
  }

})();
