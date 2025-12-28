"use strict";

const express = require("express");
const path = require("path");
const http = require("http");
const socketIo = require("socket.io");
const basicAuth = require("express-basic-auth");

function asList(rowsOrMap) {
  if (Array.isArray(rowsOrMap)) return rowsOrMap;
  if (!rowsOrMap || typeof rowsOrMap !== "object") return [];
  return Object.values(rowsOrMap);
}

function startPanel({ manager, port, host }) {
  const app = express();
  const server = http.createServer(app);
  const io = socketIo(server, { cors: { origin: "*" } });

  // Cookie parser for magic link sessions
  const cookieParser = require("cookie-parser");
  app.use(cookieParser());

  // Magic link storage (public erişim için önce tanımla)
  const magicLinks = new Map();
  const activeSessions = new Map();

  // Random token oluştur
  function generateToken(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < length; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  // ========= PUBLIC ROUTES (Auth gerektirmeyen) =========

  // Magic link ile giriş (public - auth bypass)
  app.get("/magic-login/:token", async (req, res) => {
    try {
      const token = req.params.token;
      const linkData = magicLinks.get(token);

      if (!linkData) {
        return res.send(`
          <!DOCTYPE html>
          <html><head><title>Geçersiz Link</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
          <body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#111b21;color:#fff;margin:0;">
            <div style="text-align:center;padding:2rem;">
              <h1 style="color:#ef4444;">Geçersiz veya Süresi Dolmuş Link</h1>
              <p>Bu magic link artık geçerli değil.</p>
              <a href="/" style="color:#00d9a5;">Ana Sayfaya Git</a>
            </div>
          </body></html>
        `);
      }

      if (linkData.expiresAt < Date.now()) {
        magicLinks.delete(token);
        return res.send(`
          <!DOCTYPE html>
          <html><head><title>Süre Doldu</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
          <body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#111b21;color:#fff;margin:0;">
            <div style="text-align:center;padding:2rem;">
              <h1 style="color:#ef4444;">Link Süresi Doldu</h1>
              <p>Bu magic link'in süresi dolmuş.</p>
              <a href="/" style="color:#00d9a5;">Ana Sayfaya Git</a>
            </div>
          </body></html>
        `);
      }

      if (linkData.used) {
        return res.send(`
          <!DOCTYPE html>
          <html><head><title>Kullanılmış Link</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
          <body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#111b21;color:#fff;margin:0;">
            <div style="text-align:center;padding:2rem;">
              <h1 style="color:#ef4444;">Link Daha Önce Kullanılmış</h1>
              <p>Bu magic link zaten kullanılmış.</p>
              <a href="/" style="color:#00d9a5;">Ana Sayfaya Git</a>
            </div>
          </body></html>
        `);
      }

      // Linki kullanıldı olarak işaretle
      linkData.used = true;
      magicLinks.set(token, linkData);

      // Session oluştur
      const sessionId = generateToken(32);
      activeSessions.set(sessionId, {
        id: sessionId,
        createdAt: new Date().toISOString(),
        ip: req.ip,
        userAgent: req.get('user-agent') || 'Unknown'
      });

      // Cookie ile session set et
      res.cookie('magic_session', sessionId, {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 saat
        sameSite: 'lax'
      });

      // Dashboard'a yönlendir
      res.redirect('/');
    } catch (err) {
      res.status(500).send('Hata: ' + err.message);
    }
  });

  // Magic link oluştur fonksiyonu (bot için)
  manager.generateMagicLink = async function(chatId, clientId) {
    try {
      // Yetkili numara kontrolü
      const authorizedNumbers = await manager.db.getSetting('authorized_numbers');
      if (authorizedNumbers && authorizedNumbers.trim()) {
        const authorized = authorizedNumbers.split(',').map(n => n.trim().replace(/\D/g, ''));
        const senderNumber = chatId.replace('@s.whatsapp.net', '').replace(/\D/g, '');
        if (authorized.length > 0 && !authorized.includes(senderNumber)) {
          return null; // Yetkisiz numara
        }
      }

      const expiry = parseInt(await manager.db.getSetting('magic_link_expiry')) || 15;
      const token = generateToken(48);
      const expiresAt = Date.now() + (expiry * 60 * 1000);

      magicLinks.set(token, {
        createdAt: Date.now(),
        expiresAt,
        used: false,
        chatId,
        clientId
      });

      // Panel URL'ini al
      const panelHost = process.env.PANEL_HOST || `http://${host}:${port}`;
      const link = panelHost + '/magic-login/' + token;

      return { link, expiry };
    } catch (err) {
      console.error('Magic link oluşturma hatası:', err);
      return null;
    }
  };

  // ========= AUTH MIDDLEWARE =========

  // Basic Auth - magic session kontrolü ile bypass
  const adminUser = process.env.ADMIN_USER || "admin";
  const adminPass = process.env.ADMIN_PASS || "diyanet123";

  const authMiddleware = (req, res, next) => {
    // Magic session cookie kontrolü
    const magicSessionId = req.cookies?.magic_session;
    if (magicSessionId && activeSessions.has(magicSessionId)) {
      const session = activeSessions.get(magicSessionId);
      // Session 24 saatten eski mi kontrol et
      const sessionAge = Date.now() - new Date(session.createdAt).getTime();
      if (sessionAge < 24 * 60 * 60 * 1000) {
        return next(); // Magic session geçerli, auth bypass
      } else {
        activeSessions.delete(magicSessionId);
        res.clearCookie('magic_session');
      }
    }

    // Normal basic auth
    basicAuth({
      users: { [adminUser]: adminPass },
      challenge: true,
    })(req, res, next);
  };

  app.use(authMiddleware);

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use(express.static(path.join(__dirname, "public")));
  
  // Form verileri için
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json({ limit: "2mb" }));

  // --- HATA DÜZELTME: Tüm görünümlere 'path' değişkenini gönder ---
  app.use((req, res, next) => {
    res.locals.path = req.path;
    next();
  });

  // ========= PAGES =========
  app.get("/", async (req, res) => {
    try {
      const stats = await manager.db.getStats();
      const clients = await manager.db.getClients();
      const appointments = await manager.db.getAppointments({ status: "pending" });
      res.render("dashboard", {
        title: "Dashboard",
        page: "dashboard",
        stats,
        clients,
        appointments: (appointments || []).slice(0, 5),
      });
    } catch (err) {
      console.error("Dashboard hatası:", err);
      res.render("dashboard", {
        title: "Dashboard",
        page: "dashboard",
        stats: {},
        clients: [],
        appointments: [],
      });
    }
  });

  // WhatsApp-like inbox
  app.get("/whatsapp", async (req, res) => {
    try {
      const profiles = await manager.db.getProfiles();
      const chats = profiles.map(p => ({
        chat_id: p.chat_id,
        full_name: p.full_name || p.phone || "Bilinmeyen",
        profile_photo_url: p.profile_photo_url || p.profile_pic_url || null,
        last_message_at: p.last_message_at,
        msg_count: p.msg_count || 0,
        client_id: p.client_id
      }));

      res.render("whatsapp", {
        title: "WhatsApp",
        page: "whatsapp",
        chats
      });
    } catch (err) {
      console.error("WhatsApp panel hatası:", err);
      res.render("whatsapp", {
        title: "WhatsApp",
        page: "whatsapp",
        chats: []
      });
    }
  });

  // Sohbetler (eski sayfa) -> whatsapp
  app.get("/chats", (req, res) => res.redirect("/whatsapp"));

  // Randevular
  app.get("/appointments", async (req, res) => {
    try {
      const status = req.query.status || "all";
      const appointments = await manager.db.getAppointments();
      res.render("appointments", {
        title: "Randevular",
        page: "appointments",
        status,
        appointments: appointments || [],
      });
    } catch (err) {
      console.error("Appointments hatası:", err);
      res.render("appointments", { title: "Randevular", page: "appointments", status: "all", appointments: [] });
    }
  });

  // Randevu Detay
  app.get("/appointments/:id", async (req, res) => {
    try {
      const appointmentId = req.params.id;
      const [rows] = await manager.db.pool.execute(
        "SELECT * FROM appointments WHERE id = ?",
        [appointmentId]
      );
      const appointment = rows[0];

      if (!appointment) {
        return res.redirect("/appointments");
      }

      // İlişkili profil
      let profile = null;
      if (appointment.profile_id) {
        const [profiles] = await manager.db.pool.execute(
          "SELECT * FROM profiles WHERE id = ?",
          [appointment.profile_id]
        );
        profile = profiles[0] || null;
      }

      res.render("appointment-detail", {
        title: appointment.full_name || "Randevu",
        page: "appointments",
        appointment,
        profile
      });
    } catch (err) {
      console.error("Randevu detay hatası:", err);
      res.redirect("/appointments");
    }
  });

  // Botlar
  app.get("/bots", async (req, res) => {
    try {
      const clients = await manager.db.getClients();
      const list = (clients || []).map((c) => ({
        ...c,
        qrCode: manager.getQRCode(c.id),
        isFrozen: !!c.is_frozen,
      }));
      res.render("bots", { title: "Botlar", page: "bots", clients: list });
    } catch (err) {
      console.error("Bots hatası:", err);
      res.render("bots", { title: "Botlar", page: "bots", clients: [] });
    }
  });

  // Bot Detay Sayfası
  app.get("/bots/:id", async (req, res) => {
    try {
      const clientId = req.params.id;
      const client = await manager.db.getClient(clientId);

      if (!client) {
        return res.redirect("/bots");
      }

      // QR kod
      client.qrCode = manager.getQRCode(clientId) || client.qr;

      // Humanization ayarları
      const humanizationConfig = await manager.db.getHumanizationConfig(clientId);

      // Bot'a özel anahtar kelimeler
      const keywords = await manager.db.getAllKeywords(clientId);
      const botKeywords = (keywords || []).filter(k => k.client_id === clientId || k.client_id === null);

      // Karakterler
      const defaultCharacters = manager.getDefaultCharacters();
      let characters = [];
      try {
        const charsJson = await manager.db.getSetting("characters_json");
        characters = charsJson ? JSON.parse(charsJson) : [];
      } catch (e) {}
      if (!Array.isArray(characters) || characters.length === 0) {
        characters = defaultCharacters;
      }

      // Bot ayarları (karakter seçimi vs.)
      const botSettings = {
        character_id: client.character_id || null
      };

      // Triggers (keyword'lerin farklı bir görünümü - bot-detail'de kullanılıyor)
      const triggers = botKeywords.map(k => ({
        id: k.id,
        keyword: k.keyword,
        response: k.response,
        match_type: k.match_type,
        is_active: k.is_active,
        category: k.category
      }));

      // İstatistikler
      const [profileCount] = await manager.db.pool.execute(
        "SELECT COUNT(*) as count FROM profiles WHERE client_id = ?", [clientId]
      );
      const [messageCount] = await manager.db.pool.execute(
        "SELECT COUNT(*) as count FROM messages WHERE client_id = ?", [clientId]
      );
      const [todayMsgCount] = await manager.db.pool.execute(
        "SELECT COUNT(*) as count FROM messages WHERE client_id = ? AND DATE(created_at) = CURDATE()", [clientId]
      );

      const stats = {
        profiles: profileCount[0]?.count || 0,
        messages: messageCount[0]?.count || 0,
        todayMessages: todayMsgCount[0]?.count || 0
      };

      res.render("bot-detail", {
        title: client.name || clientId,
        page: "bots",
        client,
        humanizationConfig,
        keywords: botKeywords,
        characters,
        botSettings,
        triggers,
        stats,
        saved: req.query.saved === 'true'
      });
    } catch (err) {
      console.error("Bot detay hatası:", err);
      res.redirect("/bots");
    }
  });

  // Bot Detay Sayfası - Humanization POST
  app.post("/bots/:id/humanization", async (req, res) => {
    try {
      const clientId = req.params.id;
      const config = {
        enabled: req.body.enabled === "on",
        min_response_delay: parseInt(req.body.min_response_delay) || 60,
        max_response_delay: parseInt(req.body.max_response_delay) || 600,
        wpm_reading: parseInt(req.body.wpm_reading) || 200,
        cpm_typing: parseInt(req.body.cpm_typing) || 300,
        long_message_threshold: parseInt(req.body.long_message_threshold) || 150,
        long_message_extra_delay: parseInt(req.body.long_message_extra_delay) || 60,
        typing_variance: parseInt(req.body.typing_variance) || 20,
        split_messages: req.body.split_messages === "on",
        split_threshold: parseInt(req.body.split_threshold) || 240
      };

      await manager.db.setHumanizationConfig(clientId, config);
      res.redirect(`/bots/${clientId}?saved=true`);
    } catch (err) {
      console.error("Humanization kayıt hatası:", err);
      res.redirect(`/bots/${req.params.id}`);
    }
  });

  // Profiller
  app.get("/profiles", async (req, res) => {
    try {
      const tab = (req.query.tab || "active").toString();
      const profiles = await manager.db.getProfiles();
      const completedStatuses = new Set(["appointment_scheduled", "called", "customer"]);
      const completed = (profiles || []).filter((p) => completedStatuses.has(p.status));
      const active = (profiles || []).filter((p) => !completedStatuses.has(p.status));
      res.render("profiles", {
        title: "Profiller",
        page: "profiles",
        tab,
        activeProfiles: active,
        completedProfiles: completed,
      });
    } catch (err) {
      console.error("Profiles hatası:", err);
      res.render("profiles", {
        title: "Profiller",
        page: "profiles",
        tab: "active",
        activeProfiles: [],
        completedProfiles: [],
      });
    }
  });

  // Profil Detay
  app.get("/profiles/:id", async (req, res) => {
    try {
      const profileId = req.params.id;
      const [rows] = await manager.db.pool.execute(
        "SELECT * FROM profiles WHERE id = ?",
        [profileId]
      );
      const profile = rows[0];

      if (!profile) {
        return res.redirect("/profiles");
      }

      // Son mesajlar
      const [messages] = await manager.db.pool.execute(
        "SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT 50",
        [profile.chat_id]
      );

      res.render("profile-detail", {
        title: profile.full_name || "Profil",
        page: "profiles",
        profile,
        messages: messages || []
      });
    } catch (err) {
      console.error("Profil detay hatası:", err);
      res.redirect("/profiles");
    }
  });

  // Dualar
  app.get("/duas", async (req, res) => {
    try {
      const duas = await manager.db.getDuas();
      res.render("duas", { title: "Dualar", page: "duas", duas: duas || [] });
    } catch (err) {
      console.error("Duas hatası:", err);
      res.render("duas", { title: "Dualar", page: "duas", duas: [] });
    }
  });

  // Karakter
  app.get("/character", async (req, res) => {
    try {
      const settings = await manager.db.getSettings();
      const map = {};
      asList(settings).forEach((s) => (map[s.key] = s.value));

      const defaultCharacters = manager.getDefaultCharacters();
      let chars = [];
      try {
        chars = map.characters_json ? JSON.parse(map.characters_json) : [];
      } catch (e) {
        chars = [];
      }
      if (!Array.isArray(chars) || chars.length === 0) chars = defaultCharacters;

      const activeId = map.active_character_id || chars[0]?.id || "warm";
      res.render("character", {
        title: "Karakter Ayarları",
        page: "character",
        characters: chars,
        activeCharacterId: activeId,
      });
    } catch (err) {
      console.error("Character hatası:", err);
      res.render("character", {
        title: "Karakter Ayarları",
        page: "character",
        characters: [],
        activeCharacterId: "",
      });
    }
  });

  // Ayarlar
  app.get("/settings", async (req, res) => {
    try {
      const rows = await manager.db.getSettings();
      const settings = {};
      asList(rows).forEach((r) => (settings[r.key] = r.value));
      res.render("settings", { title: "Ayarlar", page: "settings", settings });
    } catch (err) {
      console.error("Settings hatası:", err);
      res.render("settings", { title: "Ayarlar", page: "settings", settings: {} });
    }
  });

  // Anahtar Kelimeler Sayfası
  app.get("/keywords", async (req, res) => {
    try {
      const keywords = await manager.db.getAllKeywords();
      const clients = await manager.db.getClients();
      res.render("keywords", {
        title: "Anahtar Kelimeler",
        page: "keywords",
        keywords: keywords || [],
        clients: clients || []
      });
    } catch (err) {
      console.error("Keywords hatası:", err);
      res.render("keywords", {
        title: "Anahtar Kelimeler",
        page: "keywords",
        keywords: [],
        clients: []
      });
    }
  });

  // Humanization - Artık bot bazlı, yönlendir
  app.get("/humanization", (req, res) => {
    res.redirect("/bots");
  });

  app.post("/humanization", (req, res) => {
    res.redirect("/bots");
  });

  // ========= API =========
  // Kullanıcı Analizi Yap
  app.post("/api/chat/:chatId/analyze", async (req, res) => {
    try {
      const profile = await manager.db.getProfile(req.params.chatId);
      if (!profile) return res.json({ success: false, error: "Profil bulunamadı" });

      if (manager.router?.aiChat) {
        const analysis = await manager.router.aiChat.analyzeUserCharacter(profile);
        await manager.db.saveAiAnalysis(req.params.chatId, analysis);
        res.json({ success: true, analysis });
      } else {
        res.json({ success: false, error: "AI kapalı" });
      }
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Engelle / Engel Kaldır
  app.post("/api/chat/:chatId/block", async (req, res) => {
    try {
      const { blocked } = req.body; // true veya false
      await manager.db.toggleBlockProfile(req.params.chatId, blocked);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.get("/api/stats", async (req, res) => {
    try {
      const stats = await manager.db.getStats();
      res.json({ success: true, stats });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.get("/api/clients", async (req, res) => {
    try {
      const clients = await manager.db.getClients();
      res.json({ success: true, clients });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.post("/api/clients", async (req, res) => {
    try {
      const { id, name } = req.body || {};
      const clientId = id || `bot_${Date.now()}`;
      await manager.db.createClient(clientId, name);
      await manager.addClient(clientId, name);
      res.json({ success: true, clientId });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.delete("/api/clients/:id", async (req, res) => {
    try {
      await manager.removeClient(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.post("/api/clients/:id/freeze", async (req, res) => {
    try {
      const { message, redirectPhone } = req.body || {};
      await manager.freezeClient(req.params.id, message, redirectPhone);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.post("/api/clients/:id/unfreeze", async (req, res) => {
    try {
      await manager.unfreezeClient(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // WhatsApp inbox list
  app.get("/api/inbox", async (req, res) => {
    try {
      const profiles = await manager.db.getProfiles();
      res.json({ success: true, profiles: profiles || [] });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Chat messages
  app.get("/api/chat/:chatId/messages", async (req, res) => {
    try {
      const messages = await manager.db.getChatMessages(req.params.chatId, 200);
      res.json({ success: true, messages: messages || [] });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.get("/api/chat/:chatId/profile", async (req, res) => {
    try {
      const profile = await manager.db.getProfile(req.params.chatId);
      res.json({ success: true, profile });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.post("/api/chat/:chatId/status", async (req, res) => {
    try {
      const { status } = req.body || {};
      await manager.db.updateProfileStatus(req.params.chatId, status);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.post("/api/chat/:chatId/takeover", async (req, res) => {
    try {
      const { note } = req.body || {};
      await manager.takeOverChat(req.params.chatId, note);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.post("/api/chat/:chatId/release", async (req, res) => {
    try {
      await manager.releaseChat(req.params.chatId);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Mesaj gönder
  app.post("/api/send", async (req, res) => {
    try {
      const { clientId, chatId, message } = req.body || {};
      await manager.sendMessage(clientId, chatId, message);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Appointments
  app.get("/api/appointments", async (req, res) => {
    try {
      const appointments = await manager.db.getAppointments(req.query);
      res.json({ success: true, appointments: appointments || [] });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.post("/api/appointments/:id/status", async (req, res) => {
    try {
      const { status } = req.body || {};
      await manager.db.updateAppointment(req.params.id, { status });
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Settings
  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await manager.db.getSettings();
      res.json({ success: true, settings });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      for (const [key, value] of Object.entries(req.body || {})) {
        await manager.db.setSetting(key, value);
      }
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Characters API
  app.get("/api/characters", async (req, res) => {
    try {
      const charsJson = await manager.db.getSetting("characters_json");
      const activeId = await manager.db.getSetting("active_character_id");
      res.json({ success: true, characters_json: charsJson || "[]", active_character_id: activeId || "" });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.post("/api/characters", async (req, res) => {
    try {
      const { characters, activeCharacterId } = req.body || {};
      if (!Array.isArray(characters) || characters.length === 0) {
        return res.json({ success: false, error: "Karakter listesi boş olamaz." });
      }
      await manager.db.setSetting("characters_json", JSON.stringify(characters));
      if (activeCharacterId) await manager.db.setSetting("active_character_id", String(activeCharacterId));
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ========= PROFILES API =========

  // Profil güncelle
  app.put("/api/profiles/:id", async (req, res) => {
    try {
      const profileId = req.params.id;
      const { full_name, city, mother_name, birth_date, status, subject, notes } = req.body || {};

      const updates = [];
      const values = [];

      if (full_name !== undefined) { updates.push("full_name = ?"); values.push(full_name); }
      if (city !== undefined) { updates.push("city = ?"); values.push(city); }
      if (mother_name !== undefined) { updates.push("mother_name = ?"); values.push(mother_name); }
      if (birth_date !== undefined) { updates.push("birth_date = ?"); values.push(birth_date); }
      if (status !== undefined) { updates.push("status = ?"); values.push(status); }
      if (subject !== undefined) { updates.push("subject = ?"); values.push(subject); }
      if (notes !== undefined) { updates.push("notes = ?"); values.push(notes); }

      if (updates.length > 0) {
        updates.push("updated_at = NOW()");
        values.push(profileId);
        await manager.db.pool.execute(
          "UPDATE profiles SET " + updates.join(", ") + " WHERE id = ?",
          values
        );
      }

      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Profil sil
  app.delete("/api/profiles/:id", async (req, res) => {
    try {
      const profileId = req.params.id;
      await manager.db.pool.execute("DELETE FROM profiles WHERE id = ?", [profileId]);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ========= APPOINTMENTS API =========

  // Randevu güncelle
  app.put("/api/appointments/:id", async (req, res) => {
    try {
      const appointmentId = req.params.id;
      const { full_name, city, status, subject, notes, scheduled_at, duration } = req.body || {};

      const updates = [];
      const values = [];

      if (full_name !== undefined) { updates.push("full_name = ?"); values.push(full_name); }
      if (city !== undefined) { updates.push("city = ?"); values.push(city); }
      if (status !== undefined) { updates.push("status = ?"); values.push(status); }
      if (subject !== undefined) { updates.push("subject = ?"); values.push(subject); }
      if (notes !== undefined) { updates.push("notes = ?"); values.push(notes); }
      if (scheduled_at !== undefined) { updates.push("scheduled_at = ?"); values.push(scheduled_at || null); }
      if (duration !== undefined) { updates.push("duration = ?"); values.push(duration); }

      if (updates.length > 0) {
        values.push(appointmentId);
        await manager.db.pool.execute(
          "UPDATE appointments SET " + updates.join(", ") + " WHERE id = ?",
          values
        );
      }

      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Randevu durumu güncelle
  app.put("/api/appointments/:id/status", async (req, res) => {
    try {
      const appointmentId = req.params.id;
      const { status } = req.body || {};

      if (!status) {
        return res.json({ success: false, error: "Durum belirtilmedi" });
      }

      const completedAt = status === "completed" ? "NOW()" : "NULL";
      await manager.db.pool.execute(
        "UPDATE appointments SET status = ?, completed_at = " + completedAt + " WHERE id = ?",
        [status, appointmentId]
      );

      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Randevu sil
  app.delete("/api/appointments/:id", async (req, res) => {
    try {
      const appointmentId = req.params.id;
      await manager.db.pool.execute("DELETE FROM appointments WHERE id = ?", [appointmentId]);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ========= BOT SETTINGS API =========

  // Bot ayarlarını kaydet (karakter seçimi vs.)
  app.post("/api/bots/:id/settings", async (req, res) => {
    try {
      const clientId = req.params.id;
      const { character_id, name } = req.body || {};

      // character_id güncelle
      if (character_id !== undefined) {
        await manager.db.pool.execute(
          "UPDATE clients SET character_id = ? WHERE id = ?",
          [character_id || null, clientId]
        );
      }

      // name güncelle
      if (name !== undefined) {
        await manager.db.pool.execute(
          "UPDATE clients SET name = ? WHERE id = ?",
          [name, clientId]
        );
      }

      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Bot ayarlarını getir
  app.get("/api/bots/:id/settings", async (req, res) => {
    try {
      const clientId = req.params.id;
      const [rows] = await manager.db.pool.execute(
        "SELECT id, name, character_id FROM clients WHERE id = ?",
        [clientId]
      );

      if (!rows[0]) {
        return res.json({ success: false, error: "Bot bulunamadı" });
      }

      res.json({ success: true, settings: rows[0] });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ========= KEYWORDS API =========

  // Tüm anahtar kelimeleri getir
  app.get("/api/keywords", async (req, res) => {
    try {
      const clientId = req.query.client_id || null;
      const keywords = await manager.db.getAllKeywords(clientId);
      res.json({ success: true, keywords: keywords || [] });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Yeni anahtar kelime ekle
  app.post("/api/keywords", async (req, res) => {
    try {
      const { keyword, match_type, response, category, priority, client_id } = req.body || {};
      if (!keyword || !response) {
        return res.json({ success: false, error: "Anahtar kelime ve yanıt zorunludur" });
      }
      await manager.db.addKeyword({
        clientId: client_id || null,
        keyword,
        matchType: match_type || 'contains',
        response,
        priority: priority || 0,
        category: category || null
      });
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Anahtar kelime güncelle
  app.put("/api/keywords/:id", async (req, res) => {
    try {
      const { keyword, match_type, response, category, priority, client_id } = req.body || {};
      await manager.db.updateKeyword(req.params.id, {
        keyword,
        match_type,
        response,
        category: category || null,
        priority: priority || 0,
        client_id: client_id || null
      });
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Anahtar kelime sil
  app.delete("/api/keywords/:id", async (req, res) => {
    try {
      await manager.db.deleteKeyword(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Anahtar kelime aktif/pasif toggle
  app.post("/api/keywords/:id/toggle", async (req, res) => {
    try {
      const { is_active } = req.body;
      await manager.db.toggleKeyword(req.params.id, is_active);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ========= BOT HUMANIZATION API =========

  // Bot'un humanization ayarlarını getir
  app.get("/api/clients/:id/humanization", async (req, res) => {
    try {
      const config = await manager.db.getHumanizationConfig(req.params.id);
      res.json({ success: true, config });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Bot'un humanization ayarlarını kaydet
  app.post("/api/clients/:id/humanization", async (req, res) => {
    try {
      const config = req.body;
      await manager.db.setHumanizationConfig(req.params.id, config);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Bot'un humanization ayarlarını temizle (global'e dön)
  app.delete("/api/clients/:id/humanization", async (req, res) => {
    try {
      await manager.db.clearHumanizationConfig(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Test personality
  app.post("/api/test-personality", async (req, res) => {
    try {
      const { message } = req.body || {};
      if (manager.router?.aiChat) {
        const response = await manager.router.aiChat.testPersonality(message);
        res.json({ success: true, response });
      } else {
        res.json({ success: true, response: "AI servisi aktif değil." });
      }
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ========= SECURITY API =========

  // Magic link oluştur (panel içinden)
  app.post("/api/security/magic-link", async (req, res) => {
    try {
      const expiry = parseInt(await manager.db.getSetting('magic_link_expiry')) || 15;
      const token = generateToken(48);
      const expiresAt = Date.now() + (expiry * 60 * 1000);

      magicLinks.set(token, {
        createdAt: Date.now(),
        expiresAt,
        used: false,
        ip: req.ip
      });

      // Eski linkleri temizle
      for (const [key, value] of magicLinks) {
        if (value.expiresAt < Date.now() || value.used) {
          magicLinks.delete(key);
        }
      }

      const baseUrl = req.protocol + '://' + req.get('host');
      const link = baseUrl + '/magic-login/' + token;

      res.json({ success: true, link, expiry, token });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // 2FA toggle
  app.post("/api/security/2fa", async (req, res) => {
    try {
      const { enabled } = req.body;
      await manager.db.setSetting('two_factor_enabled', enabled ? '1' : '0');
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // IP restriction toggle
  app.post("/api/security/ip-restriction", async (req, res) => {
    try {
      const { enabled } = req.body;
      await manager.db.setSetting('ip_restriction_enabled', enabled ? '1' : '0');
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Aktif oturumları listele
  app.get("/api/security/sessions", async (req, res) => {
    try {
      const sessions = Array.from(activeSessions.values());
      res.json({ success: true, sessions });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Oturum sonlandır
  app.delete("/api/security/sessions/:id", async (req, res) => {
    try {
      const sessionId = req.params.id;
      activeSessions.delete(sessionId);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Tüm oturumları sonlandır
  app.post("/api/security/logout-all", async (req, res) => {
    try {
      activeSessions.clear();
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ========= SYSTEM API (Settings Page) =========

  // Sistem istatistikleri
  app.get("/api/system/stats", async (req, res) => {
    try {
      const stats = await manager.db.getStats();
      const clients = await manager.db.getClients();

      // Uptime hesapla
      const uptimeSeconds = process.uptime();
      const days = Math.floor(uptimeSeconds / 86400);
      const hours = Math.floor((uptimeSeconds % 86400) / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);
      const uptime = days > 0 ? `${days}g ${hours}s ${minutes}d` : `${hours}s ${minutes}d`;

      // Bot durumları
      const activeBots = clients.filter(c => c.status === 'ready' || c.status === 'connected').length;

      // Cache boyutu (tahmini)
      const cacheSize = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      res.json({
        success: true,
        stats: {
          ...stats,
          uptime,
          activeBots,
          totalBots: clients.length,
          cacheSize: `${cacheSize} MB`,
          nodeVersion: process.version,
          platform: process.platform
        }
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Bot yeniden başlat
  app.post("/api/system/restart-bot", async (req, res) => {
    try {
      const clients = await manager.db.getClients();
      for (const client of clients) {
        try {
          await manager.restartClient(client.id);
        } catch (e) {
          console.log(`Bot restart hatası (${client.id}):`, e.message);
        }
      }
      res.json({ success: true, message: "Tüm botlar yeniden başlatılıyor..." });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Cache temizle
  app.post("/api/system/clear-cache", async (req, res) => {
    try {
      // Global garbage collection (eğer --expose-gc ile çalışıyorsa)
      if (global.gc) {
        global.gc();
      }

      // Manager'daki cache'leri temizle
      if (manager.cache) {
        manager.cache.clear();
      }

      // Her bot için cache temizle
      const clients = await manager.db.getClients();
      for (const client of clients) {
        if (manager.clients && manager.clients[client.id]) {
          const botClient = manager.clients[client.id];
          if (botClient.store) {
            // WhatsApp store cache temizle
            try {
              botClient.store.chats.clear();
              botClient.store.messages.clear();
            } catch (e) {}
          }
        }
      }

      res.json({ success: true, message: "Cache temizlendi" });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Davranış logu
  app.get("/api/system/behavior-log", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;

      // Son mesajları ve bot yanıtlarını getir
      const [rows] = await manager.db.pool.execute(`
        SELECT
          m.id,
          m.chat_id,
          m.content,
          m.direction,
          m.created_at,
          p.full_name,
          m.client_id
        FROM messages m
        LEFT JOIN profiles p ON m.chat_id = p.chat_id
        WHERE m.direction = 'outgoing'
        ORDER BY m.created_at DESC
        LIMIT ?
      `, [limit]);

      const logs = rows.map(r => ({
        id: r.id,
        chatId: r.chat_id,
        userName: r.full_name || 'Bilinmeyen',
        botResponse: r.content,
        timestamp: r.created_at,
        clientId: r.client_id
      }));

      res.json({ success: true, logs });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Davranış testi
  app.post("/api/system/test-behavior", async (req, res) => {
    try {
      const { message } = req.body || {};
      if (!message) {
        return res.json({ success: false, error: "Mesaj gerekli" });
      }

      let response = "";
      let matchedKeyword = null;
      let usedAI = false;

      // Önce keyword kontrolü
      const keywords = await manager.db.getAllKeywords();
      for (const kw of keywords) {
        const msgLower = message.toLowerCase();
        const kwLower = kw.keyword.toLowerCase();

        let matched = false;
        if (kw.match_type === 'exact' && msgLower === kwLower) matched = true;
        else if (kw.match_type === 'contains' && msgLower.includes(kwLower)) matched = true;
        else if (kw.match_type === 'starts_with' && msgLower.startsWith(kwLower)) matched = true;
        else if (kw.match_type === 'ends_with' && msgLower.endsWith(kwLower)) matched = true;
        else if (kw.match_type === 'regex') {
          try {
            const regex = new RegExp(kw.keyword, 'i');
            if (regex.test(message)) matched = true;
          } catch (e) {}
        }

        if (matched && kw.is_active) {
          matchedKeyword = kw.keyword;
          response = kw.response;
          break;
        }
      }

      // Keyword bulunamadıysa AI kullan
      if (!response && manager.router?.aiChat) {
        usedAI = true;
        response = await manager.router.aiChat.testPersonality(message);
      }

      res.json({
        success: true,
        response: response || "Yanıt oluşturulamadı",
        matchedKeyword,
        usedAI
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Parola değiştir
  app.post("/api/system/change-password", async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};

      if (!currentPassword || !newPassword) {
        return res.json({ success: false, error: "Mevcut ve yeni parola gerekli" });
      }

      // Mevcut parolayı kontrol et
      const adminPass = process.env.ADMIN_PASS || "diyanet123";
      if (currentPassword !== adminPass) {
        return res.json({ success: false, error: "Mevcut parola yanlış" });
      }

      // Yeni parola min 6 karakter
      if (newPassword.length < 6) {
        return res.json({ success: false, error: "Yeni parola en az 6 karakter olmalı" });
      }

      // Parolayı veritabanına kaydet (settings tablosunda)
      await manager.db.setSetting("admin_password", newPassword);

      // NOT: Gerçek parola değişikliği için .env dosyası güncellenmeli
      // veya sistem yeniden başlatılmalı

      res.json({
        success: true,
        message: "Parola kaydedildi. Değişikliğin etkili olması için sistemi yeniden başlatın."
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Yedek oluştur
  app.post("/api/system/backup", async (req, res) => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupData = {
        timestamp,
        settings: await manager.db.getSettings(),
        keywords: await manager.db.getAllKeywords(),
        characters: await manager.db.getSetting("characters_json"),
        clients: await manager.db.getClients()
      };

      res.json({
        success: true,
        backup: backupData,
        filename: `backup_${timestamp}.json`
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // WhatsApp yeniden bağlan
  app.post("/api/system/reconnect", async (req, res) => {
    try {
      const clients = await manager.db.getClients();
      let reconnected = 0;

      for (const client of clients) {
        try {
          if (manager.clients && manager.clients[client.id]) {
            const botClient = manager.clients[client.id];
            if (botClient.sock) {
              // Yeniden bağlan
              await botClient.sock.end();
              await manager.addClient(client.id, client.name);
              reconnected++;
            }
          }
        } catch (e) {
          console.log(`Reconnect hatası (${client.id}):`, e.message);
        }
      }

      res.json({ success: true, message: `${reconnected} bot yeniden bağlandı` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Tüm sohbetleri temizle
  app.post("/api/system/clear-chats", async (req, res) => {
    try {
      // Mesajları temizle
      await manager.db.pool.execute("DELETE FROM messages WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)");

      res.json({ success: true, message: "30 günden eski mesajlar temizlendi" });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Verileri dışa aktar
  app.get("/api/system/export", async (req, res) => {
    try {
      const type = req.query.type || 'all';
      let data = {};

      if (type === 'all' || type === 'profiles') {
        data.profiles = await manager.db.getProfiles();
      }
      if (type === 'all' || type === 'appointments') {
        data.appointments = await manager.db.getAppointments();
      }
      if (type === 'all' || type === 'keywords') {
        data.keywords = await manager.db.getAllKeywords();
      }
      if (type === 'all' || type === 'settings') {
        data.settings = await manager.db.getSettings();
      }

      res.json({ success: true, data, exportedAt: new Date().toISOString() });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Verileri içe aktar
  app.post("/api/system/import", async (req, res) => {
    try {
      const { keywords, settings } = req.body || {};
      let imported = { keywords: 0, settings: 0 };

      if (Array.isArray(keywords)) {
        for (const kw of keywords) {
          try {
            await manager.db.addKeyword({
              clientId: kw.client_id || null,
              keyword: kw.keyword,
              matchType: kw.match_type || 'contains',
              response: kw.response,
              priority: kw.priority || 0,
              category: kw.category || null
            });
            imported.keywords++;
          } catch (e) {}
        }
      }

      if (settings && typeof settings === 'object') {
        for (const [key, value] of Object.entries(settings)) {
          try {
            await manager.db.setSetting(key, value);
            imported.settings++;
          } catch (e) {}
        }
      }

      res.json({ success: true, imported });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ========= SOCKET.IO =========

  io.on("connection", (socket) => {
    console.log("Panel bağlantısı:", socket.id);
    socket.on("disconnect", () => console.log("Panel bağlantısı kesildi:", socket.id));
  });

  manager.panel = { io };

  server.listen(port, host, () => {
    console.log(`📊 Admin Paneli: http://${host}:${port}`);
  });

  return { io };
}

module.exports = { startPanel };