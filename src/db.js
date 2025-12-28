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
      `CREATE TABLE IF NOT EXISTS keywords (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id VARCHAR(50) DEFAULT NULL,
        keyword VARCHAR(255) NOT NULL,
        match_type ENUM('exact', 'contains', 'startswith', 'regex') DEFAULT 'contains',
        response TEXT NOT NULL,
        is_active TINYINT(1) DEFAULT 1,
        priority INT DEFAULT 0,
        category VARCHAR(50) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_client (client_id),
        INDEX idx_active (is_active),
        INDEX idx_priority (priority)
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
      "ALTER TABLE profiles ADD COLUMN job VARCHAR(100) NULL", // Meslek alanı eksikse
      // Bot bazlı humanization ayarları
      "ALTER TABLE clients ADD COLUMN humanization_config JSON NULL",
      // Bot bazlı karakter seçimi
      "ALTER TABLE clients ADD COLUMN character_id VARCHAR(50) NULL"
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

  // ==================== KEYWORD METODLARI ====================

  /**
   * Tüm anahtar kelimeleri getir (opsiyonel client_id filtresi)
   */
  async getKeywords(clientId = null) {
    let sql = "SELECT * FROM keywords WHERE is_active = 1";
    const params = [];

    if (clientId) {
      sql += " AND (client_id = ? OR client_id IS NULL)";
      params.push(clientId);
    }

    sql += " ORDER BY priority DESC, id ASC";

    const [rows] = await this.pool.execute(sql, params);
    return rows;
  }

  /**
   * Tüm anahtar kelimeleri getir (admin panel için - aktif/pasif dahil)
   */
  async getAllKeywords(clientId = null) {
    let sql = "SELECT * FROM keywords";
    const params = [];

    if (clientId) {
      sql += " WHERE client_id = ? OR client_id IS NULL";
      params.push(clientId);
    }

    sql += " ORDER BY priority DESC, created_at DESC";

    const [rows] = await this.pool.execute(sql, params);
    return rows;
  }

  /**
   * Tek bir anahtar kelime getir
   */
  async getKeyword(id) {
    const [rows] = await this.pool.execute("SELECT * FROM keywords WHERE id = ?", [id]);
    return rows[0];
  }

  /**
   * Anahtar kelime ekle
   */
  async addKeyword(data) {
    const { clientId, keyword, matchType, response, priority, category } = data;
    await this.pool.execute(
      `INSERT INTO keywords (client_id, keyword, match_type, response, priority, category, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [clientId || null, keyword, matchType || 'contains', response, priority || 0, category || null]
    );
  }

  /**
   * Anahtar kelime güncelle
   */
  async updateKeyword(id, data) {
    const cleaned = this._sanitizeValues(data);
    const keys = Object.keys(cleaned);
    if (keys.length === 0) return;
    const fields = keys.map(k => `\`${k}\` = ?`).join(", ");
    const values = [...keys.map(k => cleaned[k]), id];
    await this.pool.execute(`UPDATE keywords SET ${fields} WHERE id = ?`, values);
  }

  /**
   * Anahtar kelime sil
   */
  async deleteKeyword(id) {
    await this.pool.execute("DELETE FROM keywords WHERE id = ?", [id]);
  }

  /**
   * Anahtar kelime aktif/pasif toggle
   */
  async toggleKeyword(id, isActive) {
    await this.pool.execute("UPDATE keywords SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, id]);
  }

  /**
   * Mesajı anahtar kelimelere göre eşleştir
   * @returns {object|null} Eşleşen keyword veya null
   */
  async matchKeyword(message, clientId = null) {
    const keywords = await this.getKeywords(clientId);
    const lowerMessage = message.toLowerCase().trim();

    for (const kw of keywords) {
      const keywordLower = kw.keyword.toLowerCase().trim();
      let matched = false;

      switch (kw.match_type) {
        case 'exact':
          matched = lowerMessage === keywordLower;
          break;
        case 'contains':
          matched = lowerMessage.includes(keywordLower);
          break;
        case 'startswith':
          matched = lowerMessage.startsWith(keywordLower);
          break;
        case 'regex':
          try {
            const regex = new RegExp(kw.keyword, 'i');
            matched = regex.test(message);
          } catch (e) {
            // Geçersiz regex - atla
            matched = false;
          }
          break;
        default:
          matched = lowerMessage.includes(keywordLower);
      }

      if (matched) {
        return kw;
      }
    }

    return null;
  }

  // ==================== BOT HUMANIZATION METODLARI ====================

  /**
   * Bot'un humanization ayarlarını getir
   * Önce bot bazlı, yoksa global ayarları döndür
   */
  async getHumanizationConfig(clientId = null) {
    // Varsayılan ayarlar
    const defaultConfig = {
      enabled: true,
      min_response_delay: 60,
      max_response_delay: 600,
      wpm_reading: 200,
      cpm_typing: 300,
      long_message_threshold: 150,
      long_message_extra_delay: 60,
      typing_variance: 20,
      split_messages: true,
      split_threshold: 240
    };

    // Bot bazlı ayar var mı?
    if (clientId) {
      try {
        const [rows] = await this.pool.execute(
          "SELECT humanization_config FROM clients WHERE id = ?",
          [clientId]
        );
        if (rows[0]?.humanization_config) {
          const botConfig = typeof rows[0].humanization_config === 'string'
            ? JSON.parse(rows[0].humanization_config)
            : rows[0].humanization_config;
          return { ...defaultConfig, ...botConfig, _source: 'bot' };
        }
      } catch (e) {
        // Bot ayarı yoksa global'e düş
      }
    }

    // Global ayar
    try {
      const globalStr = await this.getSetting("humanization_config");
      if (globalStr) {
        const globalConfig = JSON.parse(globalStr);
        return { ...defaultConfig, ...globalConfig, _source: 'global' };
      }
    } catch (e) {}

    return { ...defaultConfig, _source: 'default' };
  }

  /**
   * Bot'un humanization ayarlarını kaydet
   */
  async setHumanizationConfig(clientId, config) {
    const configJson = JSON.stringify(config);
    await this.pool.execute(
      "UPDATE clients SET humanization_config = ? WHERE id = ?",
      [configJson, clientId]
    );
  }

  /**
   * Bot'un humanization ayarlarını temizle (global ayarlara dön)
   */
  async clearHumanizationConfig(clientId) {
    await this.pool.execute(
      "UPDATE clients SET humanization_config = NULL WHERE id = ?",
      [clientId]
    );
  }
}

module.exports = new Database();
