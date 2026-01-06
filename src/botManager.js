"use strict";

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const path = require("path");
const os = require("os");
const fs = require("fs"); 

const db = require("./db");
const Router = require("./router");

class BotManager {
  constructor(config) {
    this.config = config;
    this.clients = new Map(); 
    this.db = db;
    this.router = null;
    this.qrCodes = new Map(); 
    this.io = null;

    this.chatLocks = new Map(); 

    this._settingsCache = new Map();
    this._settingsCacheAt = 0;
  }

  setIO(io) {
    this.io = io;
  }

  getDefaultCharacters() {
    return [
      { id: "soft", name: "Sıcak & Samimi", prompt: "Sıcak, insani ve sohbet eder gibi konuş. Kardeşim hitabını kullan." },
      { id: "formal", name: "Resmi", prompt: "Daha resmi, ölçülü ve bilgilendirici konuş." },
      { id: "empathy", name: "Duygusal Destek", prompt: "Önce duyguyu yansıt, sakinleştirici ve anlayışlı ol." },
      { id: "wise", name: "Bilge", prompt: "Az konuş ama derin konuş. Hikmetli ve yumuşak bir üslup kullan." }
    ];
  }

  async init() {
    await this.db.connect();
    await this.db.ensureSchema();
    this.router = new Router(this);
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
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-accelerated-2d-canvas", "--no-first-run", "--no-zygote", "--disable-gpu"],
      },
    });

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

    client.on("message", async (msg) => {
      if (msg.fromMe) return;

      // ÇİFT MESAJ KONTROLÜ (KRİTİK BÖLÜM - BURASI KORUNDU)
      const isProcessed = await this.db.messageExists(msg.id.id);
      if (isProcessed) {
        console.log(`⚠️ Tekrar eden mesaj engellendi: ${msg.id.id}`);
        return;
      }

      // ENGELLİ KONTROLÜ
      const profileCheck = await this.db.getProfile(msg.from, id);
      if (profileCheck && profileCheck.is_blocked) {
        console.log(`🚫 Engelli kullanıcıdan mesaj geldi: ${msg.from}`);
        return;
      }

      if (String(msg.from || "").includes("@g.us")) return;

      const chatId = msg.from;
      const work = async () => {
        try {
          const botRow = await this.db.getClient(id);
          if (botRow?.frozen) {
            const frozenMessage = botRow?.frozen_message || "Şu anda müsait değilim.";
            const redirectPhone = botRow?.redirect_phone;
            const out = redirectPhone ? `${frozenMessage}\n\nGüncel numara: ${redirectPhone}` : frozenMessage;
            await this._humanSend(client, chatId, out, { incomingText: msg.body || "" });
            return;
          }

          const inbound = await this._extractInboundText(msg);
          const body = (inbound || "").trim();
          if (!body) return;
          console.log(`[${id}] Gelen: ${body.substring(0, 70)}...`);

          let profile = await this.db.getProfile(chatId, id);
          if (!profile) profile = await this.db.createProfile(chatId, id);

          let contactName = "kardeşim";
          try {
            const contact = await msg.getContact();
            contactName = contact?.pushname || contact?.name || profile?.full_name || "kardeşim";
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
              wwebId: msg.id.id
            })
          );

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

          // Router üzerinden mesajı işle
          const response = await this.router.handleMessage(msg, client, id, {
            name: contactName,
            profile,
            inboundText: body,
          });

          const replyText = this._normalizeRouterReply(response);
          if (!replyText) return;

          const delayService = this.router.messageDelay;
          let readWait = 0;
          if (delayService && delayService.calculateDelays) {
            const delays = await delayService.calculateDelays(body, replyText);
            readWait = delays.readDelay;
          }

          if (readWait > 0) {
            console.log(`[${id}] ⏳ Düşünme: ${(readWait / 1000).toFixed(1)} sn...`);
            await new Promise(resolve => setTimeout(resolve, readWait));
          }

          await this._humanSend(client, chatId, replyText);

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

      const prev = this.chatLocks.get(chatId) || Promise.resolve();
      const next = prev.catch(() => {}).then(work).finally(() => {
        if (this.chatLocks.get(chatId) === next) this.chatLocks.delete(chatId);
      });
      this.chatLocks.set(chatId, next);
    });

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
    try { await client.initialize(); } catch (err) {
      console.error(`❌ Bot ${id} başlatma hatası:`, err?.message || err);
      try { await this.db.updateClient(id, this._sanitizeValues({ status: "disconnected" })); } catch (_) {}
    }
  }

  async removeClient(id) {
    const client = this.clients.get(id);
    if (client) { try { await client.destroy(); } catch (_) {} this.clients.delete(id); }
    await this.db.deleteClient(id);
    this.qrCodes.delete(id);
    console.log(`🗑️ Bot ${id} silindi`);
  }

  async freezeClient(id, message, redirectPhone) {
    await this.db.updateClient(id, this._sanitizeValues({ frozen: 1, frozen_message: message || null, redirect_phone: redirectPhone || null }));
  }

  async unfreezeClient(id) {
    await this.db.updateClient(id, this._sanitizeValues({ frozen: 0, frozen_message: null, redirect_phone: null }));
  }

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
  getClientStatus(id) { const client = this.clients.get(id); if (!client) return "not_found"; return client.info ? "ready" : "initializing"; }

  _sanitizeValues(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) { out[k] = v === undefined ? null : v; }
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
    const configStr = await this.db.getSetting("humanization_config");
    let config = { enabled: true, show_typing_indicator: true, split_messages: true, split_threshold: 240, chunk_delay: 800, cpm_typing: 300, typing_variance: 20 };
    try { if (configStr) { Object.assign(config, JSON.parse(configStr)); } } catch (_) {}
    const chunks = config.split_messages ? this._splitResponse(String(text || ""), config.split_threshold || 240) : [String(text || "")];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
      let typeTime = 0;
      if (config.enabled) {
        const charCount = chunk.length;
        typeTime = (charCount / (config.cpm_typing || 300)) * 60;
        const variance = (Math.random() * (config.typing_variance || 20) * 2 - (config.typing_variance || 20)) / 100;
        typeTime = typeTime * (1 + variance);
        if (typeTime < 1.5) typeTime = 1.5;
      }
      if (config.enabled && config.show_typing_indicator && typeTime > 0) {
        try { const chat = await client.getChatById(chatId); if (chat?.sendStateTyping) await chat.sendStateTyping(); } catch (_) {}
        await new Promise(r => setTimeout(r, typeTime * 1000));
      } else if (config.enabled && typeTime > 0) {
        await new Promise(r => setTimeout(r, typeTime * 1000));
      }
      await client.sendMessage(chatId, chunk);
      if (i < chunks.length - 1) {
        const baseDelay = config.chunk_delay || 800;
        const variance = baseDelay * 0.3;
        const delay = baseDelay + (Math.random() * variance * 2 - variance);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  _splitResponse(text, maxLen = 240) {
    const cleaned = String(text || "").trim();
    if (!cleaned) return [];
    if (cleaned.length <= maxLen) return [cleaned];
    const parts = cleaned.split(/(?<=[\.\!\?…])\s+/).map((s) => s.trim()).filter(Boolean);
    const out = []; let buf = "";
    for (const p of parts) { if (!buf) { buf = p; continue; } if ((buf + " " + p).length <= maxLen) { buf += " " + p; } else { out.push(buf); buf = p; } }
    if (buf) out.push(buf);
    const finalOut = [];
    for (const chunk of out) {
      if (chunk.length <= maxLen) finalOut.push(chunk);
      else { for (let i = 0; i < chunk.length; i += maxLen) finalOut.push(chunk.slice(i, i + maxLen)); }
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
        tmpPath = path.join(os.tmpdir(), `voice_${Date.now()}_${Math.random().toString(16).slice(2)}.ogg`);
        fs.writeFileSync(tmpPath, buf);
        const transcript = await this.router?.transcribeVoice?.(tmpPath);
        if (transcript && typeof transcript === "string") return transcript.trim();
        return "";
      } catch (err) { console.error("🔊 Sesli mesaj hatası:", err?.message || err); return ""; } finally { if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) {} } }
    }
    return msg.body || "";
  }
}

module.exports = BotManager;