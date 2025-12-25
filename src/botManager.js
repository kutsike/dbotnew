"use strict";

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const path = require("path");
const os = require("os");

const db = require("./db");
const Router = require("./router");

/**
 * Multi-bot WhatsApp manager.
 *
 * Goals:
 * - Stabil: undefined SQL bind hatalarını engelle
 * - Mesajların karışmasını/döngüye girmesini önle
 * - İnsansı his: okuma+yazma gecikmesi + typing
 * - Voice/ptt desteği: varsa transcribe edip metin olarak işle
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
      id: "warm",
      name: "Sıcak & Samimi",
      prompt: `Sıcak, samimi ve içten bir üslup kullan.
- "Kardeşim" hitabını doğal şekilde kullan
- Kısa ve öz cevaplar ver (2-4 cümle)
- Emoji kullanma
- Sohbet eder gibi, akıcı konuş
- Empati göster, dinlediğini hissettir`
    },
    {
      id: "professional",
      name: "Profesyonel",
      prompt: `Profesyonel ve ölçülü bir üslup kullan.
- Saygılı ama mesafeli ol
- Net ve bilgilendirici cevaplar ver
- Gereksiz samimiyetten kaçın
- "Siz" hitabını tercih et
- İş odaklı ve çözüm merkezli ol`
    },
    {
      id: "empathetic",
      name: "Empatik Dinleyici",
      prompt: `Empatik ve anlayışlı bir üslup kullan.
- Önce duyguyu yansıt ve onayla
- Sakinleştirici ve destekleyici ol
- "Anlıyorum", "Haklısın" gibi ifadeler kullan
- Yargılamadan dinle
- Çözüm sunmadan önce dinlediğini göster`
    },
    {
      id: "wise",
      name: "Bilge & Sakin",
      prompt: `Bilge ve sakin bir üslup kullan.
- Az ama öz konuş
- Hikmetli ve düşündürücü cümleler kur
- Acele etme, sabırlı ol
- Nasihat verirken yumuşak ol
- Derin ve anlamlı cevaplar ver`
    },
    {
      id: "friendly",
      name: "Arkadaş Canlısı",
      prompt: `Arkadaş canlısı ve enerjik bir üslup kullan.
- Pozitif ve neşeli ol
- Rahat ve samimi konuş
- Espri yapabilirsin (uygun zamanda)
- Motive edici ol
- "Sen" hitabını kullan`
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
            await this._humanSend(client, chatId, out, { incomingText: msg.body || "" });
            return;
          }

          // Mesaj içeriği (sesli mesaj varsa transcript üret)
          const inbound = await this._extractInboundText(msg);
          const body = (inbound || "").trim();

          if (!body) return;
          console.log(`[${id}] Gelen: ${body.substring(0, 70)}...`);

          // Profil oluştur / al (bot bazlı ayır)
          let profile = await this.db.getProfile(chatId, id);
          if (!profile) profile = await this.db.createProfile(chatId, id);

          // Ad bilgisini al
          let contactName = "kardeşim";
          try {
            const contact = await msg.getContact();
            contactName = contact?.pushname || contact?.name || profile?.full_name || "kardeşim";

            // profil foto URL (best-effort)
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

          // Mesajı kaydet
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
            })
          );

          // Panel'e bildir (incoming)
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

          // Router
          const response = await this.router.handleMessage(msg, client, id, {
            name: contactName,
            profile,
            inboundText: body,
          });

          const replyText = this._normalizeRouterReply(response);
          if (!replyText) return;

          // Gönder (insansı)
          await this._humanSend(client, chatId, replyText, { incomingText: body });

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
          console.log(`[${id}] Yanıt: ${replyText.substring(0, 70)}...`);

        } catch (err) {
          console.error(`[${id}] Mesaj işleme hatası:`, err?.message || err);
          // Kullanıcıya tek satır özür (sonsuz döngü olmasın diye burada send yok)
        }
      };

      // Chat bazlı lock
      const prev = this.chatLocks.get(chatId) || Promise.resolve();
      const next = prev
        .catch(() => {})
        .then(work)
        .finally(() => {
          if (this.chatLocks.get(chatId) === next) this.chatLocks.delete(chatId);
        });
      this.chatLocks.set(chatId, next);
    });

    // Disconnected
    client.on("disconnected", async (reason) => {
      console.log(`⚠️ Bot ${id} bağlantısı kesildi:`, reason);
      try {
        await this.db.updateClient(id, this._sanitizeValues({ status: "disconnected" }));
      } catch (_) {}
      if (this.io) this.io.emit("clientDisconnected", { clientId: id, reason });
      this.clients.delete(id);

      // reconnect
      setTimeout(() => {
        console.log(`🔄 Bot ${id} yeniden bağlanıyor...`);
        this.addClient(id, name);
      }, 10000);
    });

    client.on("auth_failure", async (msg) => {
      console.error(`❌ Bot ${id} kimlik doğrulama hatası:`, msg);
      try {
        await this.db.updateClient(id, this._sanitizeValues({ status: "disconnected" }));
      } catch (_) {}
    });

    this.clients.set(id, client);
    try {
      await client.initialize();
    } catch (err) {
      console.error(`❌ Bot ${id} başlatma hatası:`, err?.message || err);
      try {
        await this.db.updateClient(id, this._sanitizeValues({ status: "disconnected" }));
      } catch (_) {}
    }
  }

  async removeClient(id) {
    const client = this.clients.get(id);
    if (client) {
      try {
        await client.destroy();
      } catch (_) {}
      this.clients.delete(id);
    }
    await this.db.deleteClient(id);
    this.qrCodes.delete(id);
    console.log(`🗑️ Bot ${id} silindi`);
  }

  async freezeClient(id, message, redirectPhone) {
    await this.db.updateClient(
      id,
      this._sanitizeValues({ frozen: 1, frozen_message: message || null, redirect_phone: redirectPhone || null })
    );
    console.log(`❄️ Bot ${id} donduruldu`);
  }

  async unfreezeClient(id) {
    await this.db.updateClient(id, this._sanitizeValues({ frozen: 0, frozen_message: null, redirect_phone: null }));
    console.log(`🔥 Bot ${id} aktif edildi`);
  }

  async sendMessage(clientId, chatId, message) {
    const client = this.clients.get(clientId);
    if (!client) throw new Error("Bot bulunamadı");

    await this._humanSend(client, chatId, message, { incomingText: "" });

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

  getQRCode(id) {
    return this.qrCodes.get(id);
  }

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

  async _getSettingCached(key) {
    const now = Date.now();
    if (now - this._settingsCacheAt > 30_000) {
      this._settingsCache.clear();
      this._settingsCacheAt = now;
    }
    if (this._settingsCache.has(key)) return this._settingsCache.get(key);
    const v = await this.db.getSetting(key);
    this._settingsCache.set(key, v);
    return v;
  }

  async _getBoolSetting(key, fallback = false) {
    try {
      const v = await this._getSettingCached(key);
      if (v === null || v === undefined || v === "") return fallback;
      return String(v).toLowerCase() === "true" || String(v) === "1" || String(v).toLowerCase() === "on";
    } catch (_) {
      return fallback;
    }
  }

  async _humanSend(client, chatId, text, { incomingText }) {
    const showTyping = await this._getBoolSetting("show_typing_indicator", true);
    const splitEnabled = await this._getBoolSetting("split_messages", true);
    const splitThreshold = Number(await this._getSettingCached("split_threshold")) || 240;
    const chunks = splitEnabled ? this._splitResponse(String(text || ""), splitThreshold) : [String(text || "")];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;

      // okuma/yazma gecikmesi
      try {
        const delaySvc = this.router?.messageDelay;
        if (delaySvc?.applyDelay) {
          await delaySvc.applyDelay(incomingText || "", chunk);
        }
      } catch (_) {}

      if (showTyping) {
        try {
          const chat = await client.getChatById(chatId);
          if (chat?.sendStateTyping) await chat.sendStateTyping();
        } catch (_) {}
      }

      await client.sendMessage(chatId, chunk);

      if (i < chunks.length - 1) {
        // parçalar arası küçük nefes
        try {
          const delaySvc = this.router?.messageDelay;
          if (delaySvc?.delay) await delaySvc.delay(350 + Math.round(Math.random() * 450));
        } catch (_) {}
      }
    }
  }

  _splitResponse(text, maxLen = 240) {
    const cleaned = String(text || "").trim();
    if (!cleaned) return [];
    if (cleaned.length <= maxLen) return [cleaned];

    const parts = cleaned
      .split(/(?<=[\.\!\?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const out = [];
    let buf = "";
    for (const p of parts) {
      if (!buf) {
        buf = p;
        continue;
      }
      if ((buf + " " + p).length <= maxLen) {
        buf += " " + p;
      } else {
        out.push(buf);
        buf = p;
      }
    }
    if (buf) out.push(buf);

    // hâlâ uzunsa sert kes
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
    // Text mesaj
    if (msg.type === "chat") return msg.body || "";

    // Sesli mesaj (ptt) / audio
    const voiceTypes = new Set(["ptt", "audio"]);
    if (voiceTypes.has(msg.type) && msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();
        if (!media?.data) return "";
        const buf = Buffer.from(media.data, "base64");

        const tmp = path.join(os.tmpdir(), `voice_${Date.now()}_${Math.random().toString(16).slice(2)}.ogg`);
        require("fs").writeFileSync(tmp, buf);

        // Router üzerinden transcribe (OpenAI varsa)
        const transcript = await this.router?.transcribeVoice?.(tmp);
        try { require("fs").unlinkSync(tmp); } catch (_) {}

        if (transcript && typeof transcript === "string") {
          return transcript.trim();
        }
        return "";
      } catch (err) {
        console.error("🔊 Sesli mesaj işleme hatası:", err?.message || err);
        return "";
      }
    }

    // Diğer medya türleri için: varsa body
    return msg.body || "";
  }
}

module.exports = BotManager;
