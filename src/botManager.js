"use strict";

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const path = require("path");
const os = require("os");
const fs = require("fs"); // Dosya işlemleri için

const db = require("./db");
const Router = require("./router");

/**
 * Multi-bot WhatsApp manager.
 * * Özellikler:
 * - İnsansı Davranış: Rastgele bekleme, okuma süresi, yazma simülasyonu.
 * - Stabilite: Mesaj kuyruğu (Lock mekanizması).
 * - Sesli Mesaj: Transkripsiyon desteği.
 */
class BotManager {
  constructor(config) {
    this.config = config;
    this.clients = new Map(); // clientId -> Client
    this.db = db;
    this.router = null;
    this.qrCodes = new Map(); // clientId -> dataUrl
    this.io = null;

    // chatId bazlı sıraya alma (aynı kişiye aynı anda iki cevap yazma)
    this.chatLocks = new Map(); // chatId -> Promise

    // runtime cache
    this._settingsCache = new Map();
    this._settingsCacheAt = 0;
  }

  setIO(io) {
    this.io = io;
  }
getDefaultCharacters() {
  return [
    {
      id: "soft",
      name: "Sıcak & Samimi",
      prompt: "Sıcak, insani ve sohbet eder gibi konuş. Kardeşim hitabını kullan. Kısa ama içten ol."
    },
    {
      id: "formal",
      name: "Resmi",
      prompt: "Daha resmi, ölçülü ve bilgilendirici konuş."
    },
    {
      id: "empathy",
      name: "Duygusal Destek",
      prompt: "Önce duyguyu yansıt, sakinleştirici ve anlayışlı ol."
    },
    {
      id: "wise",
      name: "Bilge",
      prompt: "Az konuş ama derin konuş. Hikmetli ve yumuşak bir üslup kullan."
    }
  ];
}

  async init() {
    await this.db.connect();
    await this.db.ensureSchema();

    // Router'ı başlat
    this.router = new Router(this);

    // Kayıtlı botları yükle
    const botClients = await this.db.getClients();
    console.log(`📱 ${botClients.length} bot yükleniyor...`);

    for (const bot of botClients) {
      await this.addClient(bot.id, bot.name);
    }
  }

  async addClient(id, name) {
    if (this.clients.has(id)) {
      console.log(`⚠️ Bot ${id} zaten mevcut`);
      return;
    }

    console.log(`🔄 Bot ${id} başlatılıyor...`);

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: id,
        dataPath: path.join(this.config.dataDir, "sessions"),
      }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
        ],
      },
    });

    // QR Code
    client.on("qr", async (qr) => {
      try {
        console.log(`📱 Bot ${id} için QR kod oluşturuldu`);
        qrcodeTerminal.generate(qr, { small: true });

        const qrImage = await qrcode.toDataURL(qr);
        this.qrCodes.set(id, qrImage);
        await this.db.updateClient(id, this._sanitizeValues({ status: "qr_pending", qr: qrImage }));

        if (this.io) this.io.emit("qr", { clientId: id, qr: qrImage });
      } catch (err) {
        console.error(`❌ Bot ${id} QR işleme hatası:`, err?.message || err);
      }
    });

    // Ready
    client.on("ready", async () => {
      try {
        const phone = client.info?.wid?.user || "Bilinmiyor";
        console.log(`✅ Bot ${name || id} (${phone}) hazır`);
        await this.db.updateClient(id, this._sanitizeValues({ status: "ready", phone, qr: null }));
        this.qrCodes.delete(id);
        if (this.io) this.io.emit("clientReady", { clientId: id, phone });
      } catch (err) {
        console.error(`❌ Bot ${id} ready handler hatası:`, err?.message || err);
      }
    });

    // Incoming message
    client.on("message", async (msg) => {
      // Kendi mesajlarımızı atla
      if (msg.fromMe) return;
// ÇİFT MESAJ KONTROLÜ (YENİ)
      // Mesaj ID'si veritabanında var mı?
      const isProcessed = await this.db.messageExists(msg.id.id);
      if (isProcessed) {
        console.log(`⚠️ Tekrar eden mesaj engellendi: ${msg.id.id}`);
        return;
      }
      // ENGELLEME KONTROLÜ (YENİ)
      const profileCheck = await this.db.getProfile(msg.from, id);
      if (profileCheck && profileCheck.is_blocked) {
        console.log(`🚫 Engelli kullanıcıdan mesaj geldi, yoksayılıyor: ${msg.from}`);
        return; // Hiçbir şey yapma
      }
      // Grup mesajlarını atla
      if (String(msg.from || "").includes("@g.us")) return;

      const chatId = msg.from;
      const work = async () => {
        try {
          // Bot dondurma / yönlendirme
          const botRow = await this.db.getClient(id);
          if (botRow?.frozen) {
            const frozenMessage = botRow?.frozen_message || "Şu anda müsait değilim, biraz sonra tekrar yazabilir misiniz?";
            const redirectPhone = botRow?.redirect_phone;
            const out = redirectPhone ? `${frozenMessage}\n\nGüncel numara: ${redirectPhone}` : frozenMessage;
            // Dondurulmuş olsa bile insansı gönder
            await this._humanSend(client, chatId, out, { incomingText: msg.body || "" });
            return;
          }

          // Mesaj içeriği (sesli mesaj varsa transcript üret)
          const inbound = await this._extractInboundText(msg);
          const body = (inbound || "").trim();

          if (!body) return;
          console.log(`[${id}] Gelen: ${body.substring(0, 70)}...`);

          // Profil oluştur / al
          let profile = await this.db.getProfile(chatId, id);
          if (!profile) profile = await this.db.createProfile(chatId, id);

          // Ad bilgisini al
          let contactName = "kardeşim";
          try {
            const contact = await msg.getContact();
            contactName = contact?.pushname || contact?.name || profile?.full_name || "kardeşim";

            // Profil foto URL güncelle
            try {
              const url = await contact.getProfilePicUrl();
              if (url && url !== profile?.profile_photo_url) {
                await this.db.updateProfile(chatId, id, this._sanitizeValues({ profile_photo_url: url }));
                profile.profile_photo_url = url;
              }
            } catch (_) {}
          } catch (_) {
            contactName = profile?.full_name || "kardeşim";
          }

          // Gelen Mesajı kaydet
         await this.db.saveMessage(
            this._sanitizeValues({
              chatId,
              profileId: profile?.id,
              clientId: id,
              direction: "incoming",
              content: body,
              type: (msg.type || "chat").substring(0, 50),
              senderName: profile?.full_name || contactName || "Kullanıcı",
              mediaType: msg.type || null,
              wwebId: msg.id.id // <--- YENİ EKLENEN KISIM
            })
          );

          // Panel'e bildir
          if (this.io) {
            this.io.emit("newMessage", {
              clientId: id,
              chatId,
              from: contactName,
              body,
              direction: "incoming",
              timestamp: Date.now(),
            });
          }

          // Router ile cevabı üret (AMA HENÜZ GÖNDERME)
          const response = await this.router.handleMessage(msg, client, id, {
            name: contactName,
            profile,
            inboundText: body,
          });

          const replyText = this._normalizeRouterReply(response);
          if (!replyText) return;

          // --- İNSANSI BEKLEME MANTIĞI (Burada başlıyor) ---
          const delayService = this.router.messageDelay;
          let readWait = 0;

          // Eğer delay servisi varsa hesaplat
          if (delayService && delayService.calculateDelays) {
            // calculateDelays bize { readDelay, typeDelay } döner.
            // readDelay: Okuma süresi + Rastgele bekleme (1-10 dk) + Uzun mesaj bonusu
            const delays = await delayService.calculateDelays(body, replyText);
            readWait = delays.readDelay;
          }

          // 1. ADIM: Okuma ve Düşünme Beklemesi (Hiçbir şey yapmadan bekle)
          if (readWait > 0) {
            console.log(`[${id}] ⏳ Düşünme Molası: ${(readWait / 1000).toFixed(1)} sn boyunca bekleniyor...`);
            // İstersen burada "görüldü" atabilirsin: await msg.markSeen();
            await new Promise(resolve => setTimeout(resolve, readWait));
          }

          // 2. ADIM: Yazma Efekti ve Gönderme (Parçalı)
          // _humanSend fonksiyonu metni parçalara böler ve her parça için "Yazıyor..." efekti verir.
          await this._humanSend(client, chatId, replyText);

          // Kaydet (outgoing)
          await this.db.saveMessage(
            this._sanitizeValues({
              chatId,
              profileId: profile?.id,
              clientId: id,
              direction: "outgoing",
              content: replyText,
              type: "chat",
              senderName: "Bot",
            })
          );
          console.log(`[${id}] Yanıt gönderildi.`);

        } catch (err) {
          console.error(`[${id}] Mesaj işleme hatası:`, err?.message || err);
        }
      };

      // Chat bazlı lock (Sıraya alma)
      const prev = this.chatLocks.get(chatId) || Promise.resolve();
      const next = prev
        .catch(() => {})
        .then(work)
        .finally(() => {
          if (this.chatLocks.get(chatId) === next) this.chatLocks.delete(chatId);
        });
      this.chatLocks.set(chatId, next);
    });

    // Disconnected handler
    client.on("disconnected", async (reason) => {
      console.log(`⚠️ Bot ${id} bağlantısı kesildi:`, reason);
      try { await this.db.updateClient(id, this._sanitizeValues({ status: "disconnected" })); } catch (_) {}
      if (this.io) this.io.emit("clientDisconnected", { clientId: id, reason });
      this.clients.delete(id);
      setTimeout(() => {
        console.log(`🔄 Bot ${id} yeniden bağlanıyor...`);
        this.addClient(id, name);
      }, 10000);
    });

    client.on("auth_failure", async (msg) => {
      console.error(`❌ Bot ${id} kimlik doğrulama hatası:`, msg);
      try { await this.db.updateClient(id, this._sanitizeValues({ status: "disconnected" })); } catch (_) {}
    });

    this.clients.set(id, client);
    try {
      await client.initialize();
    } catch (err) {
      console.error(`❌ Bot ${id} başlatma hatası:`, err?.message || err);
      try { await this.db.updateClient(id, this._sanitizeValues({ status: "disconnected" })); } catch (_) {}
    }
  }

  async removeClient(id) {
    const client = this.clients.get(id);
    if (client) {
      try { await client.destroy(); } catch (_) {}
      this.clients.delete(id);
    }
    await this.db.deleteClient(id);
    this.qrCodes.delete(id);
    console.log(`🗑️ Bot ${id} silindi`);
  }

  async freezeClient(id, message, redirectPhone) {
    await this.db.updateClient(id, this._sanitizeValues({ frozen: 1, frozen_message: message || null, redirect_phone: redirectPhone || null }));
    console.log(`❄️ Bot ${id} donduruldu`);
  }

  async unfreezeClient(id) {
    await this.db.updateClient(id, this._sanitizeValues({ frozen: 0, frozen_message: null, redirect_phone: null }));
    console.log(`🔥 Bot ${id} aktif edildi`);
  }

  // Admin panelinden manuel mesaj gönderimi
  async sendMessage(clientId, chatId, message) {
    const client = this.clients.get(clientId);
    if (!client) throw new Error("Bot bulunamadı");

    await this._humanSend(client, chatId, message);

    const profile = await this.db.getProfile(chatId, clientId);
    await this.db.saveMessage(
      this._sanitizeValues({
        chatId,
        profileId: profile?.id,
        clientId,
        direction: "outgoing",
        content: message,
        type: "chat",
        senderName: "Admin",
      })
    );
    return true;
  }

  getQRCode(id) { return this.qrCodes.get(id); }

  getClientStatus(id) {
    const client = this.clients.get(id);
    if (!client) return "not_found";
    return client.info ? "ready" : "initializing";
  }

  // -------------------- helpers --------------------

  _sanitizeValues(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      out[k] = v === undefined ? null : v;
    }
    return out;
  }

  _normalizeRouterReply(routerResult) {
    if (!routerResult) return "";
    if (typeof routerResult === "string") return routerResult;
    if (typeof routerResult.reply === "string") return routerResult.reply;
    if (typeof routerResult.text === "string") return routerResult.text;
    return "";
  }

  async _humanSend(client, chatId, text) {
    // Ayarları DB'den çek (JSON formatında)
    const configStr = await this.db.getSetting("humanization_config");
    let config = {
      enabled: true,
      split_messages: true,
      split_threshold: 240,
      cpm_typing: 300, // Varsayılan yazma hızı (Karakter/Dakika)
      typing_variance: 20
    };
    
    try {
      if (configStr) {
        const parsed = JSON.parse(configStr);
        Object.assign(config, parsed);
        // Eski ayarlarla uyumluluk (ayrı key'ler varsa)
        config.split_messages = await this._getBoolSetting("split_messages", true);
        const st = await this.db.getSetting("split_threshold");
        if (st) config.split_threshold = Number(st);
      }
    } catch (_) {}

    // Parçalara böl
    const chunks = config.split_messages 
      ? this._splitResponse(String(text || ""), config.split_threshold || 240) 
      : [String(text || "")];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;

      // Yazma Hızı Hesaplama (Karakter Sayısı / CPM * 60)
      let typeTime = 0;
      if (config.enabled) {
        const charCount = chunk.length;
        // CPM (Characters Per Minute) -> Saniye
        typeTime = (charCount / (config.cpm_typing || 300)) * 60;
        
        // Varyasyon ekle (Doğallık için ±%variance)
        const variance = (Math.random() * (config.typing_variance || 20) * 2 - (config.typing_variance || 20)) / 100;
        typeTime = typeTime * (1 + variance);
        
        // Minimum 1.5 saniye yazıyor görünsün
        if (typeTime < 1.5) typeTime = 1.5;
      }

      // "Yazıyor..." gönder
      if (config.enabled && typeTime > 0) {
        try {
          const chat = await client.getChatById(chatId);
          if (chat?.sendStateTyping) await chat.sendStateTyping();
        } catch (_) {}
        
        // Hesaplanan süre kadar bekle
        await new Promise(r => setTimeout(r, typeTime * 1000));
      }

      // Mesajı Gönder
      await client.sendMessage(chatId, chunk);

      // Parçalar arası küçük bir nefes (0.5 - 1 sn)
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      }
    }
  }

  // Helper: Eski tip boolean ayarları desteklemek için
  async _getBoolSetting(key, fallback = false) {
    try {
      const v = await this.db.getSetting(key);
      if (v === null || v === undefined || v === "") return fallback;
      return String(v).toLowerCase() === "true" || String(v) === "1" || String(v).toLowerCase() === "on";
    } catch (_) { return fallback; }
  }

  _splitResponse(text, maxLen = 240) {
    const cleaned = String(text || "").trim();
    if (!cleaned) return [];
    if (cleaned.length <= maxLen) return [cleaned];

    const parts = cleaned.split(/(?<=[\.\!\?…])\s+/).map((s) => s.trim()).filter(Boolean);
    const out = [];
    let buf = "";
    for (const p of parts) {
      if (!buf) { buf = p; continue; }
      if ((buf + " " + p).length <= maxLen) { buf += " " + p; } 
      else { out.push(buf); buf = p; }
    }
    if (buf) out.push(buf);

    const finalOut = [];
    for (const chunk of out) {
      if (chunk.length <= maxLen) finalOut.push(chunk);
      else {
        for (let i = 0; i < chunk.length; i += maxLen) finalOut.push(chunk.slice(i, i + maxLen));
      }
    }
    return finalOut;
  }

  async _extractInboundText(msg) {
    if (msg.type === "chat") return msg.body || "";

    const voiceTypes = new Set(["ptt", "audio"]);
    if (voiceTypes.has(msg.type) && msg.hasMedia) {
      let tmpPath = null;
      try {
        const media = await msg.downloadMedia();
        if (!media?.data) return "";
        const buf = Buffer.from(media.data, "base64");
        
        // Geçici dosya oluştur
        tmpPath = path.join(os.tmpdir(), `voice_${Date.now()}_${Math.random().toString(16).slice(2)}.ogg`);
        fs.writeFileSync(tmpPath, buf);

        // Transcribe et
        const transcript = await this.router?.transcribeVoice?.(tmpPath);
        if (transcript && typeof transcript === "string") return transcript.trim();
        return "";
      } catch (err) {
        console.error("🔊 Sesli mesaj işleme hatası:", err?.message || err);
        return "";
      } finally {
        // Dosyayı her durumda temizle
        if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) {} }
      }
    }
    return msg.body || "";
  }
}

module.exports = BotManager;