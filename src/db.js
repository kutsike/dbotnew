"use strict";

const mysql = require("mysql2/promise");

class Database {
  constructor() {
    this.pool = null;
  }

  _sanitizeValues(obj = {}) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      out[k] = v === undefined ? null : v;
    }
    return out;
  }

  async connect() {
    try {
      this.pool = mysql.createPool({
        host: process.env.DB_HOST || "127.0.0.1",
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        charset: "utf8mb4"
      });

      await this.pool.execute("SELECT 1");
      console.log("✅ MySQL bağlantısı başarılı");

      await this.createTables();
      return true;
    } catch (err) {
      console.error("❌ MySQL bağlantı hatası:", err.message);
      throw err;
    }
  }
async createTables() {
  }

async ensureSchema() {
  return true;
}


  async createTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS clients (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100),
        phone VARCHAR(20),
        status ENUM('initializing', 'qr_pending', 'ready', 'disconnected', 'frozen') DEFAULT 'initializing',
        frozen TINYINT(1) DEFAULT 0,
        frozen_message TEXT,
        redirect_phone VARCHAR(20),
        qr TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS profiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        chat_id VARCHAR(100) UNIQUE NOT NULL,
        client_id VARCHAR(50),
        full_name VARCHAR(100),
        phone VARCHAR(20),
        city VARCHAR(50),
        mother_name VARCHAR(100),
        birth_date VARCHAR(50),
        subject TEXT,
        status ENUM('new', 'collecting', 'waiting', 'appointment_scheduled', 'called', 'customer', 'admin') DEFAULT 'new',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_client (client_id)
      )`,
      `CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        chat_id VARCHAR(100) NOT NULL,
        profile_id INT,
        client_id VARCHAR(50),
        direction ENUM('incoming', 'outgoing') NOT NULL,
        content TEXT,
        type VARCHAR(50) DEFAULT 'chat',
        sender_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_chat (chat_id),
        INDEX idx_created (created_at)
      )`,
      `CREATE TABLE IF NOT EXISTS appointments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        profile_id INT NOT NULL,
        client_id VARCHAR(50),
        notes TEXT,
        status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
        scheduled_at DATETIME,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_status (status)
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(100) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS bad_words (
        id INT AUTO_INCREMENT PRIMARY KEY,
        word VARCHAR(100) NOT NULL,
        severity ENUM('low', 'medium', 'high') DEFAULT 'medium'
      )`,
      `CREATE TABLE IF NOT EXISTS duas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200),
        category VARCHAR(50),
        arabic TEXT,
        transliteration TEXT,
        turkish TEXT,
        source VARCHAR(200)
      )`,
      `CREATE TABLE IF NOT EXISTS activity_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        chat_id VARCHAR(100),
        profile_id INT,
        client_id VARCHAR(50),
        action VARCHAR(100),
        details JSON,
        performed_by VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_chat (chat_id),
        INDEX idx_action (action)
      )`,
      `CREATE TABLE IF NOT EXISTS bot_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id VARCHAR(50) NOT NULL,
        character_id VARCHAR(50) DEFAULT 'warm',
        character_name VARCHAR(100) DEFAULT 'Sicak ve Samimi',
        character_prompt TEXT,
        humanization_enabled TINYINT(1) DEFAULT 1,
        show_typing_indicator TINYINT(1) DEFAULT 1,
        split_messages TINYINT(1) DEFAULT 1,
        min_response_delay INT DEFAULT 60,
        max_response_delay INT DEFAULT 600,
        wpm_reading INT DEFAULT 200,
        cpm_typing INT DEFAULT 300,
        typing_variance INT DEFAULT 20,
        long_message_threshold INT DEFAULT 150,
        long_message_extra_delay INT DEFAULT 60,
        split_threshold INT DEFAULT 240,
        chunk_delay INT DEFAULT 800,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY idx_client (client_id)
      )`,
      `CREATE TABLE IF NOT EXISTS keyword_responses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id VARCHAR(50) NOT NULL,
        keyword VARCHAR(200) NOT NULL,
        match_type ENUM('contains', 'exact', 'starts_with', 'ends_with', 'regex') DEFAULT 'contains',
        response TEXT NOT NULL,
        is_active TINYINT(1) DEFAULT 1,
        priority INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_client (client_id),
        INDEX idx_active (is_active)
      )`,
      `CREATE TABLE IF NOT EXISTS bot_triggers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id VARCHAR(50) NOT NULL,
        trigger_event ENUM('first_message', 'profile_complete', 'appointment_scheduled', 'status_change', 'keyword_match', 'time_based', 'message_count') NOT NULL,
        trigger_condition JSON,
        action_type ENUM('send_message', 'change_status', 'notify_admin', 'set_variable', 'call_webhook') NOT NULL,
        action_data JSON,
        is_active TINYINT(1) DEFAULT 1,
        priority INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_client (client_id),
        INDEX idx_event (trigger_event),
        INDEX idx_active (is_active)
      )`,
      `CREATE TABLE IF NOT EXISTS characters (
        id INT AUTO_INCREMENT PRIMARY KEY,
        char_id VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        prompt TEXT,
        is_default TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const sql of tables) {
      try {
        await this.pool.execute(sql);
      } catch (err) {
        // Tablo zaten varsa hata verme
        if (!err.message.includes("already exists")) {
          console.error("Tablo oluşturma hatası:", err.message);
        }
      }
    }

    // Varsayılan ayarları ekle
    await this.initDefaultSettings();
    
    // Varsayılan bot ekle
    await this.initDefaultClient();

    // Şema yükseltmeleri (eski kurulumlarda kolon yoksa ekle)
    await this.ensureSchemaUpgrades();
  }

  async ensureSchemaUpgrades() {
    // profiles tablosu ek kolonlar
    const alters = [
      "ALTER TABLE profiles ADD COLUMN last_question_key VARCHAR(50) NULL",
      "ALTER TABLE profiles ADD COLUMN last_question_at DATETIME NULL",
      "ALTER TABLE profiles ADD COLUMN last_message_at DATETIME NULL",
      "ALTER TABLE profiles ADD COLUMN conversation_started_at DATETIME NULL",
      "ALTER TABLE profiles ADD COLUMN msg_count INT NOT NULL DEFAULT 0",
      
      // HATA 1 ÇÖZÜMÜ: Bu satırı ekleyin (Eksik olan sütun)
      "ALTER TABLE profiles ADD COLUMN last_seen_at DATETIME NULL",

      // HATA 2 ÇÖZÜMÜ (Öneri): BotManager.js 'profile_photo_url' kullanıyor ama burada 'profile_pic_url' denmiş. 
      // Doğrusu 'profile_photo_url' olmalı:
      "ALTER TABLE profiles ADD COLUMN profile_photo_url TEXT NULL",
      // (Eski satır: "ALTER TABLE profiles ADD COLUMN profile_pic_url TEXT NULL" şeklindeydi, değiştirebilirsiniz)
      "ALTER TABLE messages ADD COLUMN message_wweb_id VARCHAR(255) UNIQUE NULL",
      "ALTER TABLE profiles ADD COLUMN is_blocked TINYINT(1) DEFAULT 0",
      "ALTER TABLE profiles ADD COLUMN ai_analysis TEXT NULL",
      "ALTER TABLE profiles ADD COLUMN job VARCHAR(100) NULL" // Meslek alanı eksikse
    ];

    for (const sql of alters) {
      try {
        await this.pool.execute(sql);
      } catch (e) {
        // Kolon zaten varsa geç
      }
    }
  }
  // Ayrıca profili engelleme metodu ekleyelim
  async toggleBlockProfile(chatId, blockStatus) {
    await this.pool.execute("UPDATE profiles SET is_blocked = ? WHERE chat_id = ?", [blockStatus ? 1 : 0, chatId]);
  }
  
  // AI Analizini kaydetme metodu
  async saveAiAnalysis(chatId, analysis) {
    await this.pool.execute("UPDATE profiles SET ai_analysis = ? WHERE chat_id = ?", [analysis, chatId]);
  }
async initDefaultSettings() {
    const defaults = [
      ["bot_name", "Hocanın Yardımcısı"],
      ["greeting", "Selamün aleyküm {name} kardeşim, hoş geldin. Nasıl yardımcı olabilirim?"],
      ["handoff_message", "Hocamız şu an dergahtaki namazını kılıyor. En kısa sürede size dönüş yapacağız inşallah."],
      ["busy_message", "Dergahtaki namazımı kıldıktan sonra müsait olabilirim inşallah."],
      ["profile_complete_message", "{name} kardeşim, bilgilerini aldım. Hocamızla görüşüp sana randevu bilgisi ileteceğim inşallah."],
      ["profanity_warning", "Kardeşim, lütfen güzel konuşalım. Dilimizi temiz tutalım inşallah."],
      ["frozen_message", "Şu an müsait değilim, lütfen daha sonra tekrar deneyin."],
      ["prefix", "!"],
      [
        "ai_system_prompt",
        "Sen bir din görevlisinin (imam/hoca) yardımcısı gibi konuşan bir WhatsApp asistanısın. Adın \"{bot_name}\".\n\nKullanıcıya sıcak ve insani bir dille konuş; kısa ve net ol.\n\nKurallar: Fetva verme; genel bilgi ver ve gerektiğinde \"Hocamızla görüşmek en sağlıklısı\" de. Hassas durumlarda sakinleştirip hocaya yönlendir. Tıbbi/psikolojik acil durumda profesyonel yardım/112 öner.\n\nKullanıcı bilgileri: ad={full_name}, şehir={city}."
      ],
      // YENİ İNSANLAŞTIRMA AYARLARI BURAYA EKLENDİ
      ["humanization_config", JSON.stringify({
        enabled: true,
        min_response_delay: 60,   // En az bekleme (saniye) -> 1 dk
        max_response_delay: 600,  // En fazla bekleme (saniye) -> 10 dk
        wpm_reading: 200,         // Okuma hızı (Kelime/Dakika)
        cpm_typing: 300,          // Yazma hızı (Karakter/Dakika)
        long_message_threshold: 150, // Uzun mesaj sınırı (karakter)
        long_message_extra_delay: 60, // Uzun mesaj için ek bekleme (saniye)
        typing_variance: 20       // Yazma hızında % kaç sapma olsun
      })]
    ];

    // Döngü burada başlıyor (Dizinin dışında olmalı)
    for (const [key, value] of defaults) {
      try {
        await this.pool.execute(
          "INSERT IGNORE INTO settings (`key`, value) VALUES (?, ?)",
          [key, value]
        );
      } catch (err) {
        // Hata varsa geç (zaten ekliyse)
      }
    }
  }

  async initDefaultClient() {
    try {
      const [rows] = await this.pool.execute("SELECT COUNT(*) as count FROM clients");
      if (rows[0].count === 0) {
        await this.pool.execute(
          "INSERT INTO clients (id, name, status) VALUES (?, ?, ?)",
          ["default", "Ana Bot", "initializing"]
        );
        console.log("✅ Varsayılan bot oluşturuldu");
      }
    } catch (err) {
      // Hata varsa geç
    }
  }

  // ==================== CLIENT METODLARI ====================

  async getClients() {
    const [rows] = await this.pool.execute("SELECT * FROM clients ORDER BY created_at DESC");
    return rows;
  }

  async getClient(id) {
    const [rows] = await this.pool.execute("SELECT * FROM clients WHERE id = ?", [id]);
    return rows[0];
  }

  async createClient(id, name) {
    await this.pool.execute(
      "INSERT INTO clients (id, name, status) VALUES (?, ?, 'initializing')",
      [id, name || id]
    );
    return this.getClient(id);
  }

  async updateClient(id, data) {
    const cleaned = this._sanitizeValues(data);
    const keys = Object.keys(cleaned);
    if (keys.length === 0) return;
    const fields = keys.map(k => `\`${k}\` = ?`).join(", ");
    const values = [...keys.map(k => cleaned[k]), id];
    await this.pool.execute(`UPDATE clients SET ${fields} WHERE id = ?`, values);
  }

  async deleteClient(id) {
    await this.pool.execute("DELETE FROM clients WHERE id = ?", [id]);
  }

  // ==================== PROFILE METODLARI ====================

  async getProfiles(filters = {}) {
    let sql = "SELECT * FROM profiles";
    const params = [];
    const conditions = [];

    if (filters.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }
    if (filters.clientId) {
      conditions.push("client_id = ?");
      params.push(filters.clientId);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY updated_at DESC";

    const [rows] = await this.pool.execute(sql, params);
    return rows;
  }

  async getProfile(chatId) {
    const [rows] = await this.pool.execute("SELECT * FROM profiles WHERE chat_id = ?", [chatId]);
    return rows[0];
  }

  async createProfile(chatId, clientId) {
    await this.pool.execute(
      "INSERT IGNORE INTO profiles (chat_id, client_id, status, conversation_started_at, msg_count) VALUES (?, ?, 'new', NOW(), 0)",
      [chatId, clientId]
    );
    return this.getProfile(chatId);
  }

  async updateProfile(chatId, clientId, data) {
    // Eğer clientId bir obje ise (eski kullanım), data olarak al
    if (typeof clientId === 'object' && clientId !== null) {
      data = clientId;
      clientId = null;
    }
    
    const cleaned = this._sanitizeValues(data);
    const keys = Object.keys(cleaned);
    if (keys.length === 0) return;
    const fields = keys.map(k => `\`${k}\` = ?`).join(", ");
    const values = [...keys.map(k => cleaned[k]), chatId];
    await this.pool.execute(`UPDATE profiles SET ${fields} WHERE chat_id = ?`, values);
  }

  async updateProfileStatus(chatId, clientId, status) {
    // Eğer clientId bir string ve status undefined ise (eski kullanım)
    if (typeof clientId === 'string' && status === undefined) {
      status = clientId;
      clientId = null;
    }
    await this.pool.execute("UPDATE profiles SET status = ? WHERE chat_id = ?", [status, chatId]);
  }

  // Alias for compatibility
  async getChat(chatId) {
    return this.getProfile(chatId);
  }

  async updateChatStatus(chatId, status) {
    return this.updateProfileStatus(chatId, status);
  }

  // ==================== MESSAGE METODLARI ====================

 // YENİ METOD: Mesajın daha önce işlenip işlenmediğini kontrol et
  async messageExists(wwebId) {
    if (!wwebId) return false;
    const [rows] = await this.pool.execute("SELECT id FROM messages WHERE message_wweb_id = ?", [wwebId]);
    return rows.length > 0;
  }

  // saveMessage metodunu güncelle (wwebId parametresini ekle)
  async saveMessage(data) {
    // wwebId'yi al, yoksa null geç
    const { chatId, profileId, clientId, direction, content, type, senderName, wwebId } = data;
    
    // Eğer ID varsa ve daha önce kaydedildiyse tekrar kaydetme (Güvenlik önlemi)
    if (wwebId && await this.messageExists(wwebId)) {
        return; 
    }

    const safeType = (type || 'chat').substring(0, 50);
    const safeContent = (content === undefined ? null : content);
    
    await this.pool.execute(
      `INSERT INTO messages (chat_id, profile_id, client_id, direction, content, type, sender_name, message_wweb_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [chatId, profileId || null, clientId, direction, safeContent, safeType, senderName || null, wwebId || null]
    );

    // İstatistikleri güncelle
    if (direction === 'incoming') {
        await this.pool.execute(
          "UPDATE profiles SET msg_count = COALESCE(msg_count,0) + 1, last_message_at = NOW(), last_seen_at = NOW() WHERE chat_id = ?",
          [chatId]
        );
    }
  }

  async getChatHistory(chatId, limit = 10) {
    const limitNum = parseInt(limit) || 10;
    const [rows] = await this.pool.execute(
      `SELECT direction, content, sender_name, created_at 
       FROM messages WHERE chat_id = ? 
       ORDER BY created_at DESC LIMIT ${limitNum}`,
      [chatId]
    );
    return rows.reverse();
  }

  async getChatMessages(chatId, limit = 50) {
    const limitNum = parseInt(limit) || 50;
    const [rows] = await this.pool.execute(
      `SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ${limitNum}`,
      [chatId]
    );
    return rows.reverse();
  }

  // ==================== APPOINTMENT METODLARI ====================

  async createAppointment(profileId, clientId, notes = "") {
    await this.pool.execute(
      "INSERT INTO appointments (profile_id, client_id, notes, status) VALUES (?, ?, ?, 'pending')",
      [profileId, clientId, notes]
    );
  }

  async getAppointments(filters = {}) {
    let sql = `
      SELECT a.*, p.full_name, p.chat_id as phone, p.subject, p.city
      FROM appointments a 
      LEFT JOIN profiles p ON a.profile_id = p.id
    `;
    const params = [];
    const conditions = [];

    if (filters.status) {
      conditions.push("a.status = ?");
      params.push(filters.status);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY a.requested_at DESC";

    const [rows] = await this.pool.execute(sql, params);
    return rows;
  }

  async updateAppointment(id, data) {
    const fields = Object.keys(data).map(k => `\`${k}\` = ?`).join(", ");
    const values = [...Object.values(data), id];
    await this.pool.execute(`UPDATE appointments SET ${fields} WHERE id = ?`, values);
  }

  // ==================== SETTINGS METODLARI ====================

  async getSetting(key) {
    try {
      const [rows] = await this.pool.execute("SELECT value FROM settings WHERE `key` = ?", [key]);
      return rows[0]?.value;
    } catch (e) {
      return null;
    }
  }

  async setSetting(key, value) {
    await this.pool.execute(
      "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?",
      [key, value, value]
    );
  }

  async getSettings() {
    const [rows] = await this.pool.execute("SELECT * FROM settings");
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  }

  // ==================== BAD WORDS METODLARI ====================

  async getBadWords() {
    try {
      const [rows] = await this.pool.execute("SELECT word, severity FROM bad_words");
      return rows;
    } catch (e) {
      return [];
    }
  }

  async addBadWord(word, severity = "medium") {
    await this.pool.execute(
      "INSERT IGNORE INTO bad_words (word, severity) VALUES (?, ?)",
      [word.toLowerCase(), severity]
    );
  }

  // ==================== DUA METODLARI ====================

  async getDuas(category = null) {
    if (category) {
      const [rows] = await this.pool.execute("SELECT * FROM duas WHERE category = ?", [category]);
      return rows;
    }
    const [rows] = await this.pool.execute("SELECT * FROM duas");
    return rows;
  }

  async getRandomDua(category = null) {
    let sql = "SELECT * FROM duas";
    const params = [];
    
    if (category) {
      sql += " WHERE category = ?";
      params.push(category);
    }
    
    sql += " ORDER BY RAND() LIMIT 1";
    
    const [rows] = await this.pool.execute(sql, params);
    return rows[0];
  }

  async addDua(data) {
    const { title, category, arabic, transliteration, turkish, source } = data;
    await this.pool.execute(
      `INSERT INTO duas (title, category, arabic, transliteration, turkish, source) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, category, arabic, transliteration, turkish, source]
    );
  }

  // ==================== ACTIVITY LOG METODLARI ====================

  async logActivity(data) {
    const { chatId, profileId, clientId, action, details, performedBy } = data;
    await this.pool.execute(
      `INSERT INTO activity_logs (chat_id, profile_id, client_id, action, details, performed_by) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [chatId, profileId, clientId, action, JSON.stringify(details || {}), performedBy || "system"]
    );
  }

  async getActivityLogs(filters = {}) {
    let sql = "SELECT * FROM activity_logs";
    const params = [];
    const conditions = [];

    if (filters.chatId) {
      conditions.push("chat_id = ?");
      params.push(filters.chatId);
    }
    if (filters.action) {
      conditions.push("action = ?");
      params.push(filters.action);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY created_at DESC LIMIT 100";

    const [rows] = await this.pool.execute(sql, params);
    return rows;
  }

  // ==================== BOT SETTINGS METODLARI ====================

  async getBotSettings(clientId) {
    const [rows] = await this.pool.execute("SELECT * FROM bot_settings WHERE client_id = ?", [clientId]);
    if (rows[0]) return rows[0];

    // Yoksa varsayılan oluştur
    await this.pool.execute(
      `INSERT INTO bot_settings (client_id) VALUES (?) ON DUPLICATE KEY UPDATE client_id = client_id`,
      [clientId]
    );
    const [newRows] = await this.pool.execute("SELECT * FROM bot_settings WHERE client_id = ?", [clientId]);
    return newRows[0];
  }

  async updateBotSettings(clientId, data) {
    const cleaned = this._sanitizeValues(data);
    const keys = Object.keys(cleaned);
    if (keys.length === 0) return;

    // Önce kayıt var mı kontrol et
    await this.pool.execute(
      `INSERT INTO bot_settings (client_id) VALUES (?) ON DUPLICATE KEY UPDATE client_id = client_id`,
      [clientId]
    );

    const fields = keys.map(k => `\`${k}\` = ?`).join(", ");
    const values = [...keys.map(k => cleaned[k]), clientId];
    await this.pool.execute(`UPDATE bot_settings SET ${fields} WHERE client_id = ?`, values);
  }

  // ==================== KEYWORD RESPONSES METODLARI ====================

  async getKeywordResponses(clientId) {
    const [rows] = await this.pool.execute(
      "SELECT * FROM keyword_responses WHERE client_id = ? ORDER BY priority DESC, id ASC",
      [clientId]
    );
    return rows;
  }

  async addKeywordResponse(clientId, data) {
    const { keyword, match_type, response, priority } = data;
    await this.pool.execute(
      `INSERT INTO keyword_responses (client_id, keyword, match_type, response, priority) VALUES (?, ?, ?, ?, ?)`,
      [clientId, keyword, match_type || 'contains', response, priority || 0]
    );
  }

  async updateKeywordResponse(id, data) {
    const cleaned = this._sanitizeValues(data);
    const keys = Object.keys(cleaned);
    if (keys.length === 0) return;
    const fields = keys.map(k => `\`${k}\` = ?`).join(", ");
    const values = [...keys.map(k => cleaned[k]), id];
    await this.pool.execute(`UPDATE keyword_responses SET ${fields} WHERE id = ?`, values);
  }

  async deleteKeywordResponse(id) {
    await this.pool.execute("DELETE FROM keyword_responses WHERE id = ?", [id]);
  }

  async findMatchingKeyword(clientId, message) {
    const keywords = await this.getKeywordResponses(clientId);
    const msgLower = message.toLowerCase();

    for (const kw of keywords) {
      if (!kw.is_active) continue;
      const kwLower = kw.keyword.toLowerCase();

      let matched = false;
      switch (kw.match_type) {
        case 'exact':
          matched = msgLower === kwLower;
          break;
        case 'starts_with':
          matched = msgLower.startsWith(kwLower);
          break;
        case 'ends_with':
          matched = msgLower.endsWith(kwLower);
          break;
        case 'regex':
          try {
            matched = new RegExp(kw.keyword, 'i').test(message);
          } catch (e) {}
          break;
        case 'contains':
        default:
          matched = msgLower.includes(kwLower);
      }

      if (matched) return kw;
    }
    return null;
  }

  // ==================== BOT TRIGGERS METODLARI ====================

  async getBotTriggers(clientId) {
    const [rows] = await this.pool.execute(
      "SELECT * FROM bot_triggers WHERE client_id = ? ORDER BY priority DESC, id ASC",
      [clientId]
    );
    return rows.map(r => ({
      ...r,
      trigger_condition: r.trigger_condition ? JSON.parse(r.trigger_condition) : {},
      action_data: r.action_data ? JSON.parse(r.action_data) : {}
    }));
  }

  async addBotTrigger(clientId, data) {
    const { trigger_event, trigger_condition, action_type, action_data, priority } = data;
    await this.pool.execute(
      `INSERT INTO bot_triggers (client_id, trigger_event, trigger_condition, action_type, action_data, priority)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        clientId,
        trigger_event,
        JSON.stringify(trigger_condition || {}),
        action_type,
        JSON.stringify(action_data || {}),
        priority || 0
      ]
    );
  }

  async updateBotTrigger(id, data) {
    const updates = {};
    if (data.trigger_event) updates.trigger_event = data.trigger_event;
    if (data.trigger_condition !== undefined) updates.trigger_condition = JSON.stringify(data.trigger_condition);
    if (data.action_type) updates.action_type = data.action_type;
    if (data.action_data !== undefined) updates.action_data = JSON.stringify(data.action_data);
    if (data.is_active !== undefined) updates.is_active = data.is_active ? 1 : 0;
    if (data.priority !== undefined) updates.priority = data.priority;

    const keys = Object.keys(updates);
    if (keys.length === 0) return;
    const fields = keys.map(k => `\`${k}\` = ?`).join(", ");
    const values = [...keys.map(k => updates[k]), id];
    await this.pool.execute(`UPDATE bot_triggers SET ${fields} WHERE id = ?`, values);
  }

  async deleteBotTrigger(id) {
    await this.pool.execute("DELETE FROM bot_triggers WHERE id = ?", [id]);
  }

  async getTriggersByEvent(clientId, eventType) {
    const [rows] = await this.pool.execute(
      "SELECT * FROM bot_triggers WHERE client_id = ? AND trigger_event = ? AND is_active = 1 ORDER BY priority DESC",
      [clientId, eventType]
    );
    return rows.map(r => ({
      ...r,
      trigger_condition: r.trigger_condition ? JSON.parse(r.trigger_condition) : {},
      action_data: r.action_data ? JSON.parse(r.action_data) : {}
    }));
  }

  // ==================== CHARACTERS METODLARI ====================

  async getCharacters() {
    const [rows] = await this.pool.execute("SELECT * FROM characters ORDER BY is_default DESC, name ASC");
    return rows;
  }

  async addCharacter(data) {
    const { char_id, name, prompt, is_default } = data;
    await this.pool.execute(
      `INSERT INTO characters (char_id, name, prompt, is_default) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = ?, prompt = ?`,
      [char_id, name, prompt || '', is_default ? 1 : 0, name, prompt || '']
    );
  }

  async updateCharacter(charId, data) {
    const cleaned = this._sanitizeValues(data);
    const keys = Object.keys(cleaned);
    if (keys.length === 0) return;
    const fields = keys.map(k => `\`${k}\` = ?`).join(", ");
    const values = [...keys.map(k => cleaned[k]), charId];
    await this.pool.execute(`UPDATE characters SET ${fields} WHERE char_id = ?`, values);
  }

  async deleteCharacter(charId) {
    await this.pool.execute("DELETE FROM characters WHERE char_id = ? AND is_default = 0", [charId]);
  }

  // ==================== STATS METODLARI ====================

  async getStats() {
    const [clients] = await this.pool.execute("SELECT COUNT(*) as count FROM clients");
    const [activeClients] = await this.pool.execute("SELECT COUNT(*) as count FROM clients WHERE status = 'ready'");
    const [profiles] = await this.pool.execute("SELECT COUNT(*) as count FROM profiles");
    const [waitingProfiles] = await this.pool.execute("SELECT COUNT(*) as count FROM profiles WHERE status IN ('new', 'waiting')");
    const [appointments] = await this.pool.execute("SELECT COUNT(*) as count FROM appointments WHERE status = 'pending'");
    const [todayMessages] = await this.pool.execute(
      "SELECT COUNT(*) as count FROM messages WHERE DATE(created_at) = CURDATE()"
    );

    return {
      totalBots: clients[0].count,
      activeBots: activeClients[0].count,
      totalProfiles: profiles[0].count,
      waitingProfiles: waitingProfiles[0].count,
      pendingAppointments: appointments[0].count,
      todayMessages: todayMessages[0].count
    };
  }
}

module.exports = new Database();
