// Socket.IO bağlantısı
const socket = io();

// Aktif sohbet
window.activeChatId = null;
window.activeClientId = null;

// Toast göster
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6'
  };

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.borderLeft = `4px solid ${colors[type] || colors.info}`;
  toast.innerHTML = `
    <div class="toast-header">
      <strong>${title}</strong>
      <small>şimdi</small>
    </div>
    <div class="toast-body">${message}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// Socket.IO event'leri
socket.on('connect', () => {
  console.log('Panel bağlandı');
});

socket.on('newMessage', (data) => {
  showToast('Yeni Mesaj', `${data.from || 'Bilinmeyen'}: ${(data.body || '').substring(0, 50)}...`, 'info');
  
  if (window.activeChatId === data.chatId) {
    loadMessages(window.activeChatId);
  }
  
  updateChatList(data);
});

socket.on('clientReady', (data) => {
  showToast('Bot Hazır', `${data.phone || data.clientId} bağlandı`, 'success');
  if (window.location.pathname === '/bots') {
    setTimeout(() => location.reload(), 1000);
  }
});

socket.on('clientDisconnected', (data) => {
  showToast('Bağlantı Kesildi', `Bot ${data.clientId} bağlantısı kesildi`, 'warning');
});

socket.on('qr', (data) => {
  showToast('QR Kod', `Bot ${data.clientId} için QR kod hazır`, 'info');
  
  const qrContainer = document.getElementById(`qr-${data.clientId}`);
  if (qrContainer) {
    qrContainer.innerHTML = `<img src="${data.qr}" alt="QR Code" style="max-width: 200px;">`;
  }
});

// Mobil menü toggle
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sidebar.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!sidebar.classList.contains('open')) return;
      const insideSidebar = sidebar.contains(e.target);
      const insideToggle = toggle.contains(e.target);
      if (!insideSidebar && !insideToggle) {
        sidebar.classList.remove('open');
      }
    });
  }
});

// Sohbet listesini güncelle
function updateChatList(data) {
  const chatList = document.getElementById('chat-list');
  if (!chatList) return;

  const chatItem = chatList.querySelector(`[data-chat-id="${data.chatId}"]`);
  if (chatItem) {
    const preview = chatItem.querySelector('.chat-preview');
    if (preview) {
      preview.textContent = (data.body || '').substring(0, 40) + '...';
    }
    chatList.prepend(chatItem);
  }
}

// Sohbet seç
function selectChat(chatId, clientId) {
  window.activeChatId = chatId;
  window.activeClientId = clientId;
  
  document.querySelectorAll('.chat-item').forEach(item => {
    item.classList.remove('active');
  });
  
  const activeItem = document.querySelector(`[data-chat-id="${chatId}"]`);
  if (activeItem) {
    activeItem.classList.add('active');
  }
  
  loadMessages(chatId);
  loadProfile(chatId);
  
  const emptyChat = document.querySelector('.empty-chat');
  if (emptyChat) {
    emptyChat.style.display = 'none';
  }
  
  const chatContent = document.getElementById('chat-content');
  if (chatContent) {
    chatContent.style.display = 'flex';
  }
}

// Mesajları yükle
async function loadMessages(chatId) {
  try {
    const response = await fetch(`/api/chat/${encodeURIComponent(chatId)}/messages`);
    const result = await response.json();
    
    if (result.success && result.messages) {
      const container = document.getElementById('message-container');
      if (container) {
        container.innerHTML = result.messages.map(msg => {
          const isOut = msg.direction === 'outgoing';
          const time = new Date(msg.created_at).toLocaleTimeString('tr-TR', {
            hour: '2-digit',
            minute: '2-digit'
          });
          return `
            <div class="message ${isOut ? 'message-out' : 'message-in'}">
              <div class="message-text">${msg.content || ''}</div>
              <div class="message-time">${time}</div>
            </div>
          `;
        }).join('');
        container.scrollTop = container.scrollHeight;
      }
    }
  } catch (err) {
    console.error('Mesaj yükleme hatası:', err);
  }
}

// Profil yükle
async function loadProfile(chatId) {
  try {
    const response = await fetch(`/api/chat/${encodeURIComponent(chatId)}/profile`);
    const result = await response.json();
    
    if (result.success && result.profile) {
      const p = result.profile;
      
      const elements = {
        'profile-name': p.full_name || '-',
        'profile-phone': p.chat_id?.split('@')[0] || '-',
        'profile-city': p.city || '-',
        'profile-mother': p.mother_name || '-',
        'profile-birth': p.birth_date || '-',
        'profile-subject': p.subject || '-',
        'profile-status': p.status || 'new'
      };
      
      for (const [id, value] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) {
          if (el.tagName === 'SELECT') {
            el.value = value;
          } else {
            el.textContent = value;
          }
        }
      }
    }
  } catch (err) {
    console.error('Profil yükleme hatası:', err);
  }
}

// Mesaj gönder
async function sendMessage(clientId, chatId, message) {
  try {
    const response = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, chatId, message })
    });
    
    const result = await response.json();
    
    if (result.success) {
      loadMessages(chatId);
      return true;
    } else {
      showToast('Hata', result.error || 'Mesaj gönderilemedi', 'error');
      return false;
    }
  } catch (err) {
    showToast('Hata', err.message, 'error');
    return false;
  }
}

// Sohbet devral
async function takeoverChat(chatId) {
  if (!chatId) return;
  try {
    const response = await fetch(`/api/chat/${encodeURIComponent(chatId)}/takeover`, {
      method: 'POST'
    });
    const result = await response.json();
    if (result.success) {
      showToast('Başarılı', 'Sohbet devralındı', 'success');
    } else {
      showToast('Hata', result.error || 'Devralma başarısız', 'error');
    }
  } catch (err) {
    showToast('Hata', err.message, 'error');
  }
}

// Sohbet bırak
async function releaseChat(chatId) {
  if (!chatId) return;
  try {
    const response = await fetch(`/api/chat/${encodeURIComponent(chatId)}/release`, {
      method: 'POST'
    });
    const result = await response.json();
    if (result.success) {
      showToast('Başarılı', 'Sohbet bota bırakıldı', 'success');
    } else {
      showToast('Hata', result.error || 'İşlem başarısız', 'error');
    }
  } catch (err) {
    showToast('Hata', err.message, 'error');
  }
}

// Profil durumu güncelle
async function updateProfileStatus(chatId, status) {
  if (!chatId) return;
  try {
    const response = await fetch(`/api/chat/${encodeURIComponent(chatId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const result = await response.json();
    if (result.success) {
      showToast('Başarılı', 'Durum güncellendi', 'success');
    } else {
      showToast('Hata', result.error || 'Güncelleme başarısız', 'error');
    }
  } catch (err) {
    showToast('Hata', err.message, 'error');
  }
}

// Bot dondur
async function freezeClient(clientId) {
  const message = prompt('Dondurma mesajı (boş bırakılabilir):');
  const redirectPhone = prompt('Yönlendirme numarası (boş bırakılabilir):');
  
  try {
    const response = await fetch(`/api/clients/${clientId}/freeze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, redirectPhone })
    });
    const result = await response.json();
    if (result.success) {
      showToast('Başarılı', 'Bot donduruldu', 'success');
      setTimeout(() => location.reload(), 1000);
    } else {
      showToast('Hata', result.error || 'Dondurma başarısız', 'error');
    }
  } catch (err) {
    showToast('Hata', err.message, 'error');
  }
}

// Bot çöz
async function unfreezeClient(clientId) {
  try {
    const response = await fetch(`/api/clients/${clientId}/unfreeze`, {
      method: 'POST'
    });
    const result = await response.json();
    if (result.success) {
      showToast('Başarılı', 'Bot aktif edildi', 'success');
      setTimeout(() => location.reload(), 1000);
    } else {
      showToast('Hata', result.error || 'İşlem başarısız', 'error');
    }
  } catch (err) {
    showToast('Hata', err.message, 'error');
  }
}

// Bot sil
async function deleteClient(clientId) {
  if (!confirm('Bu botu silmek istediğinizden emin misiniz?')) return;
  
  try {
    const response = await fetch(`/api/clients/${clientId}`, {
      method: 'DELETE'
    });
    const result = await response.json();
    if (result.success) {
      showToast('Başarılı', 'Bot silindi', 'success');
      setTimeout(() => location.reload(), 1000);
    } else {
      showToast('Hata', result.error || 'Silme başarısız', 'error');
    }
  } catch (err) {
    showToast('Hata', err.message, 'error');
  }
}

// Yeni bot ekle
async function addClient() {
  const name = prompt('Bot adı:');
  if (!name) return;
  
  try {
    const response = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const result = await response.json();
    if (result.success) {
      showToast('Başarılı', 'Bot eklendi. QR kodu bekleyin...', 'success');
      setTimeout(() => location.reload(), 2000);
    } else {
      showToast('Hata', result.error || 'Bot eklenemedi', 'error');
    }
  } catch (err) {
    showToast('Hata', err.message, 'error');
  }
}

// Randevu durumu güncelle
async function updateAppointmentStatus(id, status) {
  try {
    const response = await fetch(`/api/appointments/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const result = await response.json();
    if (result.success) {
      showToast('Başarılı', 'Randevu durumu güncellendi', 'success');
      setTimeout(() => location.reload(), 1000);
    } else {
      showToast('Hata', result.error || 'Güncelleme başarısız', 'error');
    }
  } catch (err) {
    showToast('Hata', err.message, 'error');
  }
}

// Sohbet ara
function searchChats(query) {
  const items = document.querySelectorAll('.chat-item');
  const lower = query.toLowerCase();
  
  items.forEach(item => {
    const name = item.querySelector('.chat-name')?.textContent.toLowerCase() || '';
    const preview = item.querySelector('.chat-preview')?.textContent.toLowerCase() || '';
    
    if (name.includes(lower) || preview.includes(lower)) {
      item.style.display = '';
    } else {
      item.style.display = 'none';
    }
  });
}

// Bot filtrele
function filterByClient(clientId) {
  const items = document.querySelectorAll('.chat-item');
  
  items.forEach(item => {
    if (clientId === 'all' || item.dataset.clientId === clientId) {
      item.style.display = '';
    } else {
      item.style.display = 'none';
    }
  });
}

// Sohbetleri yükle
async function loadChats() {
  try {
    const response = await fetch('/api/profiles');
    const result = await response.json();
    
    if (result.success && result.profiles) {
      const container = document.getElementById('chat-list');
      if (container) {
        container.innerHTML = result.profiles.map(p => `
          <div class="chat-item" data-chat-id="${p.chat_id}" data-client-id="${p.client_id}" onclick="selectChat('${p.chat_id}', '${p.client_id}')">
            <div class="chat-avatar">${(p.full_name || 'İ')[0].toUpperCase()}</div>
            <div class="chat-info">
              <div class="chat-name">${p.full_name || 'İsimsiz'}</div>
              <div class="chat-preview">${p.subject || 'Henüz konu yok'}</div>
            </div>
            <div class="chat-meta">
              <span class="badge badge-${p.status === 'new' ? 'info' : p.status === 'waiting' ? 'warning' : 'success'}">${p.status}</span>
            </div>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Sohbet yükleme hatası:', err);
  }
}

// Dashboard istatistiklerini yükle
async function loadDashboardStats() {
  try {
    const response = await fetch('/api/stats');
    const result = await response.json();
    
    if (result.success && result.stats) {
      const s = result.stats;
      const elements = {
        'total-bots': s.totalBots,
        'active-bots': s.activeBots,
        'total-profiles': s.totalProfiles,
        'waiting-profiles': s.waitingProfiles,
        'pending-appointments': s.pendingAppointments,
        'today-messages': s.todayMessages
      };
      
      for (const [id, value] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) el.textContent = value || 0;
      }
    }
  } catch (err) {
    console.error('Stats yükleme hatası:', err);
  }
}

// Sayfa yüklendiğinde
document.addEventListener('DOMContentLoaded', () => {
  console.log('Diyanet Bot Panel yüklendi');
  
  // Mesaj formu
  const messageForm = document.getElementById('message-form');
  if (messageForm) {
    messageForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('message-input');
      const message = input.value.trim();
      
      if (!message || !window.activeChatId || !window.activeClientId) return;
      
      const success = await sendMessage(window.activeClientId, window.activeChatId, message);
      if (success) {
        input.value = '';
      }
    });
  }
  
  // Ayarlar formu
  const settingsForm = document.getElementById('settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(settingsForm);
      const data = Object.fromEntries(formData.entries());
      
      try {
        const response = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await response.json();
        if (result.success) {
          showToast('Başarılı', 'Ayarlar kaydedildi', 'success');
        } else {
          showToast('Hata', result.error || 'Kaydetme başarısız', 'error');
        }
      } catch (err) {
        showToast('Hata', err.message, 'error');
      }
    });
  }
  
  // Dashboard'da istatistikleri yükle
  if (window.location.pathname === '/' || window.location.pathname === '/dashboard') {
    loadDashboardStats();
  }

  // Karakter sayfası
  const saveCharactersBtn = document.getElementById('saveCharactersBtn');
  if (saveCharactersBtn) {
    const addBtn = document.getElementById('addCharacterBtn');
    const activeSelect = document.getElementById('activeCharacterSelect');

    const collectCharacters = () => {
      const list = [];
      document.querySelectorAll('.char-name').forEach(inp => {
        const id = inp.getAttribute('data-id');
        const name = inp.value.trim();
        const promptEl = document.querySelector(`.char-prompt[data-id="${id}"]`);
        const prompt = promptEl ? promptEl.value : "";
        if (id && name) list.push({ id, name, prompt });
      });
      return list;
    };

    saveCharactersBtn.addEventListener('click', async () => {
      const characters = collectCharacters();
      const activeCharacterId = activeSelect?.value || (characters[0]?.id || "");
      try {
        const resp = await fetch('/api/characters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characters, activeCharacterId })
        });
        const res = await resp.json();
        if (res.success) showToast('Başarılı', 'Karakter ayarları kaydedildi', 'success');
        else showToast('Hata', res.error || 'Kaydetme başarısız', 'error');
      } catch (e) {
        showToast('Hata', e.message, 'error');
      }
    });

    document.querySelectorAll('.deleteCharacterBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const card = btn.closest('.mini-card');
        if (card) card.remove();

        // Select'ten de kaldır
        if (activeSelect) {
          const opt = activeSelect.querySelector(`option[value="${id}"]`);
          if (opt) opt.remove();
        }
      });
    });

    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const id = 'c_' + Math.random().toString(16).slice(2, 8);
        const container = document.getElementById('characterList');
        if (!container) return;

        const card = document.createElement('div');
        card.className = 'card mini-card';
        card.innerHTML = `
          <div class="mini-card-header">
            <div>
              <div class="mini-title">Yeni Karakter</div>
              <div class="mini-sub text-muted">id: ${id}</div>
            </div>
            <button class="btn btn-sm btn-danger deleteCharacterBtn" data-id="${id}">
              <i class="fas fa-trash"></i>
            </button>
          </div>

          <div class="form-group">
            <label class="form-label">İsim</label>
            <input class="form-control char-name" data-id="${id}" value="Yeni Karakter">
          </div>

          <div class="form-group">
            <label class="form-label">Prompt / Üslup Metni</label>
            <textarea class="form-control char-prompt" data-id="${id}" rows="6">Kısa, insani ve anlaşılır konuş. Çok uzun yazma.</textarea>
            <small class="text-muted">Değişkenler: {bot_name}, {full_name}, {city}, {phone}</small>
          </div>
        `;
        container.prepend(card);

        // Yeni option
        if (activeSelect) {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = 'Yeni Karakter';
          activeSelect.appendChild(opt);
          activeSelect.value = id;
        }

        // Delete handler
        card.querySelector('.deleteCharacterBtn')?.addEventListener('click', () => {
          card.remove();
          const opt = activeSelect?.querySelector(`option[value="${id}"]`);
          if (opt) opt.remove();
        });
      });
    }
  }
});
