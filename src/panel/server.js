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

  // Basic Auth (Tüm sayfalar şifreli)
  const adminUser = process.env.ADMIN_USER || "admin";
  const adminPass = process.env.ADMIN_PASS || "diyanet123";
  app.use(
    basicAuth({
      users: { [adminUser]: adminPass },
      challenge: true,
    })
  );

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